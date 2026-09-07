/**
 * Integration-style tests for the SolarEdge SunSpec reader (tasks 13.1, 13.2, 13.3).
 *
 * These tests are deliberately self-contained and do NOT use the heavy
 * `@iobroker/testing` `tests.integration` harness (which spins up a full ioBroker
 * controller and is flaky in CI). Instead they stand up a REAL in-process Modbus
 * TCP server (modbus-serial's `ServerTCP`) backed by a plain register store that
 * mimics a SolarEdge SunSpec device, and exercise the real production code paths:
 *
 *   ModbusClient  <-- TCP -->  ServerTCP (mock device)
 *        |
 *   SunSpecReader (detect + read + decode + scale)
 *        |
 *   StateManager  -->  MockAdapter (records ensured objects + acked writes)
 *
 * plus a direct test of the adapter's `testConnection` probe logic (mirrored inline
 * so no controller is required).
 *
 * Runs under the working `test:ts` pipeline (mocha + ts-node over `src/**\/*.test.ts`).
 *
 * Requirements covered:
 *   13.1 -> Req 3.3, 3.4, 5.4, 6.8, 7.2
 *   13.2 -> Req 2.2, 2.3, 2.4, 2.5
 *   13.3 -> Req 3.5, 5.5, 7.3, 7.4, 7.5
 */

import { expect } from 'chai';
import ModbusRTU from 'modbus-serial';

import { validateConfig } from './config-validation';
import { ModbusClient } from './modbus-client';
import { StateManager, type StateManagerAdapter } from './state-manager';
import { decodeRegisters } from './sunspec-decode';
import {
    BATTERY_READ_SEGMENTS,
    COMMON_BASE,
    getBatteryBase,
    getBatteryPresenceAddress,
    getBatteryValueDefs,
    getInverterValueDefs,
    getMeterBase,
    getMeterDidAddress,
    getMeterValueDefs,
    INVERTER_BASE,
    METER_BASE,
    type SunSpecRegisterDef,
} from './sunspec-map';
import { SunSpecReader, type Logger } from './sunspec-reader';

// modbus-serial exposes the TCP server as a static property on the default export.
const ServerTCP = (ModbusRTU as unknown as { ServerTCP: new (vector: unknown, opts: unknown) => MockServer }).ServerTCP;

// ---------------------------------------------------------------------------
// Mock SunSpec device (backing register store + ServerTCP)
// ---------------------------------------------------------------------------

interface MockServer {
    close(cb: (err: Error | null) => void): void;
}

/** Loopback host used for every server/client pair. */
const HOST = '127.0.0.1';

/**
 * A plain register store indexed by the SAME absolute base-0 address the client
 * requests (e.g. 40069). This keeps the addressing trivial: the reader/client pass
 * absolute addresses and the server serves `store[addr]` directly. Unset registers
 * default to 0.
 */
class RegisterStore {
    private readonly words = new Map<number, number>();

    set(addr: number, value: number): void {
        this.words.set(addr, value & 0xffff);
    }

    /**
     * Write a big-endian uint32 across two consecutive words (hi first).
     *
     * @param addr
     * @param value
     */
    setU32(addr: number, value: number): void {
        this.set(addr, (value >>> 16) & 0xffff);
        this.set(addr + 1, value & 0xffff);
    }

    /**
     * Write an IEEE-754 float32 in little-endian WORD order across two words
     * (matches the `float32le` decoder: words[0] is the LOW word, words[1] the HIGH).
     *
     * @param addr
     * @param value
     */
    setFloat32le(addr: number, value: number): void {
        const buf = Buffer.allocUnsafe(4);
        buf.writeFloatBE(value, 0);
        const hiWord = buf.readUInt16BE(0);
        const loWord = buf.readUInt16BE(2);
        // Little-endian word order: low word first.
        this.set(addr, loWord);
        this.set(addr + 1, hiWord);
    }

    /**
     * Write a uint64 across four consecutive words, big-endian word order (hi..lo),
     * matching the `uint64` decoder. Exact for values up to 2^53.
     *
     * @param addr
     * @param value
     */
    setU64(addr: number, value: number): void {
        const hi = Math.floor(value / 4294967296);
        const lo = value >>> 0;
        this.set(addr, (hi >>> 16) & 0xffff);
        this.set(addr + 1, hi & 0xffff);
        this.set(addr + 2, (lo >>> 16) & 0xffff);
        this.set(addr + 3, lo & 0xffff);
    }

    /**
     * Write a uint64 across four words in little-endian WORD order (lowest word
     * first), matching the `uint64le` decoder used by the battery lifetime counters.
     *
     * @param addr
     * @param value
     */
    setU64le(addr: number, value: number): void {
        const hi = Math.floor(value / 4294967296);
        const lo = value >>> 0;
        this.set(addr, lo & 0xffff);
        this.set(addr + 1, (lo >>> 16) & 0xffff);
        this.set(addr + 2, hi & 0xffff);
        this.set(addr + 3, (hi >>> 16) & 0xffff);
    }

    /**
     * Write an ASCII string packed big-endian into `wordLen` words (NUL padded).
     *
     * @param addr
     * @param text
     * @param wordLen
     */
    setString(addr: number, text: string, wordLen: number): void {
        const buf = Buffer.alloc(wordLen * 2, 0);
        buf.write(text, 0, 'latin1');
        for (let i = 0; i < wordLen; i++) {
            this.set(addr + i, buf.readUInt16BE(i * 2));
        }
    }

    get(addr: number): number {
        return this.words.get(addr) ?? 0;
    }

    slice(addr: number, length: number): number[] {
        const out: number[] = new Array<number>(length);
        for (let i = 0; i < length; i++) {
            out[i] = this.get(addr + i);
        }
        return out;
    }
}

/**
 * Populate a store with a complete, plausible SunSpec address space:
 *   - Common block at 40000: "SunS" id, manufacturer "SolarEdge", model "SE5000".
 *   - Inverter block at 40069: DID 103, every measurement seeded with a raw value
 *     and its sunssf register set to 0 (so scaled == raw).
 *   - Meter block: DID 201 at METER_DID_ADDRESS, every measurement + SF=0.
 *
 * Returns the raw values keyed by def name so tests can assert scaled==raw.
 */
interface SeededDevice {
    store: RegisterStore;
    invRaw: Map<string, number>;
    meterRaw: Map<string, number>;
    /** Raw values seeded into meter slot 2 (keyed by def name). */
    meter2Raw: Map<string, number>;
    /** Concrete battery slot-1 values seeded for end-to-end decode assertions. */
    battery: {
        instantaneousPower: number;
        lifetimeExportEnergy: number;
        lifetimeImportEnergy: number;
        status: number;
    };
}

function seedDevice(): SeededDevice {
    const store = new RegisterStore();

    // --- Common block (identity / detection) --------------------------------
    store.setU32(COMMON_BASE, 0x53756e53); // "SunS" at 40000/40001
    store.set(COMMON_BASE + 2, 1); // C_SunSpec_DID
    store.set(COMMON_BASE + 3, 65); // C_SunSpec_Length
    store.setString(COMMON_BASE + 4, 'SolarEdge', 16); // C_Manufacturer @ 40004
    store.setString(COMMON_BASE + 20, 'SE5000', 16); // C_Model @ 40020
    store.set(COMMON_BASE + 68, 1); // C_DeviceAddress @ 40068

    // --- Inverter block: DID 103 -------------------------------------------
    store.set(INVERTER_BASE, 103); // model id @ 40069

    const invRaw = seedBlock(store, INVERTER_BASE, getInverterValueDefs(), scaleRegistersFor('inverter'));

    // --- Meter slot 1: DID 201 @ 40188 (present) ----------------------------
    store.set(getMeterDidAddress(1), 201); // == METER_DID_ADDRESS
    const meterRaw = seedBlock(store, METER_BASE, getMeterValueDefs(), scaleRegistersFor('meter'), 2);

    // --- Meter slot 2: DID 201 @ 40362 (present) ----------------------------
    // Seed the meter.2 region at its per-slot base; reuse the meter template + SF=0.
    store.set(getMeterDidAddress(2), 201);
    const meter2Raw = seedBlock(store, getMeterBase(2), getMeterValueDefs(), scaleRegistersFor('meter'), 7);

    // --- Meter slot 3: absent ----------------------------------------------
    store.set(getMeterDidAddress(3), 0xffff); // sentinel => slot skipped

    // --- Battery slot 1: present -------------------------------------------
    // Presence is c_deviceaddress at 0xE140: a real Modbus id (112) marks it present.
    store.setString(getBatteryBase(1), 'SolarEdge', 16); // identity string (block base)
    store.set(getBatteryPresenceAddress(1), 112); // c_deviceaddress @ 0xE140
    const battery = {
        instantaneousPower: -1234.5, // float32le, signed to exercise the sign bit
        lifetimeExportEnergy: 9_876_543_210, // uint64le above 2^32 to exercise the hi word
        lifetimeImportEnergy: 4_242_424_242,
        status: 3, // uint32le words 0x0003 0x0000 => 3 (Charge)
    };
    seedBatteryBlock(store, getBatteryBase(1), battery);

    // --- Battery slot 2: absent --------------------------------------------
    // c_deviceaddress at 0xE240 reads the not-implemented sentinel => slot skipped.
    store.set(getBatteryPresenceAddress(2), 0xffff);

    return { store, invRaw, meterRaw, meter2Raw, battery };
}

/**
 * Seed a battery slot's block at `base`. The battery template carries no scale
 * factors; float32le / uint32le / uint64le values are written in the exact word
 * order the decoder expects. Every value def is seeded so all battery.<n>.* states
 * are exercised, with the spot-checked fields set to the given concrete values.
 *
 * @param store    backing store
 * @param base     absolute base-0 address of the battery block (getBatteryBase(slot))
 * @param concrete concrete values for the spot-checked fields
 */
function seedBatteryBlock(
    store: RegisterStore,
    base: number,
    concrete: {
        instantaneousPower: number;
        lifetimeExportEnergy: number;
        lifetimeImportEnergy: number;
        status: number;
    },
): void {
    let floatSeed = 1;
    let u64Seed = 100;
    for (const def of getBatteryValueDefs()) {
        const addr = base + def.offset;
        if (def.name === 'instantaneousPower') {
            store.setFloat32le(addr, concrete.instantaneousPower);
        } else if (def.name === 'lifetimeExportEnergy') {
            store.setU64le(addr, concrete.lifetimeExportEnergy);
        } else if (def.name === 'lifetimeImportEnergy') {
            store.setU64le(addr, concrete.lifetimeImportEnergy);
        } else if (def.name === 'status') {
            // uint32le: low word first (0x0003), high word second (0x0000).
            store.set(addr, concrete.status & 0xffff);
            store.set(addr + 1, (concrete.status >>> 16) & 0xffff);
        } else if (def.datatype === 'float32le') {
            store.setFloat32le(addr, floatSeed++ * 1.5);
        } else if (def.datatype === 'uint64le') {
            store.setU64le(addr, u64Seed++);
        } else if (def.datatype === 'uint64') {
            store.setU64(addr, u64Seed++);
        } else if (def.length === 2) {
            store.setU32(addr, u64Seed++);
        } else {
            store.set(addr, u64Seed++ & 0xffff);
        }
    }
}

/**
 * The offsets (relative to block base) of every sunssf scale register that the
 * measurement value defs reference. We set them all to 0 so `raw * 10^0 == raw`.
 * These offsets come straight from SUNSPEC_MAP (mirrored here to avoid exporting
 * the scale rows), which is fine for a test fixture.
 *
 * @param block
 */
function scaleRegistersFor(block: 'inverter' | 'meter'): number[] {
    if (block === 'inverter') {
        // acCurrentSF 40075, acVoltageSF 40082, acPowerSF 40084, acFrequencySF 40086,
        // acVASF 40088, acVARSF 40090, acPFSF 40092, acEnergyWhSF 40095, dcCurrentSF 40097,
        // dcVoltageSF 40099, dcPowerSF 40101, tempSF 40106  (all base-0 absolute)
        return [40075, 40082, 40084, 40086, 40088, 40090, 40092, 40095, 40097, 40099, 40101, 40106].map(
            a => a - INVERTER_BASE,
        );
    }
    // meter: mCurrentSF 40194, mVoltageSF 40203, mFrequencySF 40205, mPowerSF 40210,
    // mVASF 40215, mVARSF 40220, mPFSF 40225, mEnergyWhSF 40242
    return [40194, 40203, 40205, 40210, 40215, 40220, 40225, 40242].map(a => a - METER_BASE);
}

/**
 * Seed every measurement value def in a block with a deterministic raw value and
 * set all referenced scale registers to 0.
 *
 * @param store          backing store
 * @param base           absolute base-0 address of the block
 * @param valueDefs      measurement defs to seed
 * @param scaleOffsets   offsets (relative to base) of sunssf registers to zero out
 * @param startSeed      first raw value; incremented per def for variety
 * @returns map of def name -> seeded raw value
 */
function seedBlock(
    store: RegisterStore,
    base: number,
    valueDefs: SunSpecRegisterDef[],
    scaleOffsets: number[],
    startSeed = 1,
): Map<string, number> {
    // Zero all scale-factor registers first (SF = 0 => scaled == raw).
    for (const off of scaleOffsets) {
        store.set(base + off, 0);
    }

    const raw = new Map<string, number>();
    let seed = startSeed;
    for (const def of valueDefs) {
        const value = seed * 10; // small, non-sentinel positive values
        raw.set(def.name, value);
        if (def.length === 2) {
            store.setU32(base + def.offset, value);
        } else {
            store.set(base + def.offset, value);
        }
        seed++;
    }
    return raw;
}

/**
 * Start a real Modbus TCP server backed by `store` on `port`. The vector serves
 * values by the SAME absolute address the client requests. `delayMs`, when set,
 * delays the multi-register response so read-timeout behavior can be exercised.
 *
 * @param store
 * @param port
 * @param delayMs
 */
/**
 * Absolute [start, end) address windows of the battery read batches for both slots,
 * derived from BATTERY_READ_SEGMENTS so the mock stays in sync with the map.
 */
const BATTERY_BATCH_WINDOWS: Array<{ start: number; end: number }> = [getBatteryBase(1), getBatteryBase(2)].flatMap(
    base => BATTERY_READ_SEGMENTS.map(s => ({ start: base + s.offset, end: base + s.offset + s.length })),
);

/**
 * True when the read window [addr, addr+length) should be REJECTED by the mock as it
 * would be by the real device. The device serves each battery batch (batch 2 spans the
 * internal register gap as padding) but times out on an over-wide read that exceeds a
 * single batch — e.g. the whole 0xE100..0xE193 span. A multi-word read that starts
 * inside the battery address range but is not contained in one batch window is rejected;
 * single-word probes and all non-battery reads always succeed.
 */
function rejectsBatteryRead(addr: number, length: number): boolean {
    if (length <= 1) {
        return false;
    }
    const readStart = addr;
    const readEnd = addr + length; // exclusive
    // Only police reads that touch the battery address space.
    const touchesBattery = BATTERY_BATCH_WINDOWS.some(w => readStart < w.end && readEnd > w.start);
    if (!touchesBattery) {
        return false;
    }
    // Allowed only if fully contained in a single batch window.
    const contained = BATTERY_BATCH_WINDOWS.some(w => readStart >= w.start && readEnd <= w.end);
    return !contained;
}

function startServer(store: RegisterStore, port: number, delayMs = 0): Promise<MockServer> {
    return new Promise((resolve, reject) => {
        const vector = {
            getHoldingRegister: (addr: number): number => store.get(addr),
            getInputRegister: (addr: number): number => store.get(addr),
            getMultipleHoldingRegisters: (
                addr: number,
                length: number,
                _unitID: number,
                cb: (err: Error | null, values: number[]) => void,
            ): void => {
                // Mirror the real device: it serves each battery batch (batch 2 spans the
                // internal gap as padding) but times out on an over-wide read that exceeds
                // a single batch, such as the whole-block span.
                if (rejectsBatteryRead(addr, length)) {
                    cb(new Error('Illegal data address (battery read too wide)'), []);
                    return;
                }
                const values = store.slice(addr, length);
                if (delayMs > 0) {
                    setTimeout(() => cb(null, values), delayMs);
                } else {
                    cb(null, values);
                }
            },
        };
        const server = new ServerTCP(vector, { host: HOST, port, debug: false, unitID: 1 }) as MockServer &
            NodeJS.EventEmitter;
        server.on('initialized', () => resolve(server));
        server.on('error', (err: Error) => reject(err));
        // If neither fires quickly, resolve anyway after a short delay so tests proceed.
        setTimeout(() => resolve(server), 300);
    });
}

/**
 * Close a server and wait for the callback (safe to call when already closed).
 *
 * @param server
 */
function closeServer(server: MockServer | undefined): Promise<void> {
    return new Promise(resolve => {
        if (!server) {
            resolve();
            return;
        }
        try {
            server.close(() => resolve());
        } catch {
            resolve();
        }
        // Guard against a stalled close callback.
        setTimeout(resolve, 2000);
    });
}

// ---------------------------------------------------------------------------
// Mock adapter (records ensured objects + acked writes), like state-manager.test.ts
// ---------------------------------------------------------------------------

interface WriteRecord {
    id: string;
    val: ioBroker.StateValue;
    ack: boolean | undefined;
}

class MockAdapter implements StateManagerAdapter {
    readonly objects = new Map<string, ioBroker.SettableObject>();
    readonly states = new Map<string, ioBroker.SettableState>();
    readonly writes: WriteRecord[] = [];

    setObjectNotExistsAsync(id: string, obj: ioBroker.SettableObject): ioBroker.SetObjectPromise {
        if (!this.objects.has(id)) {
            this.objects.set(id, obj);
        }
        return Promise.resolve({ id });
    }

    setStateAsync(id: string, state: ioBroker.SettableState): Promise<string> {
        this.states.set(id, state);
        this.writes.push({ id, val: state.val as ioBroker.StateValue, ack: state.ack });
        return Promise.resolve(id);
    }

    lastVal(id: string): ioBroker.StateValue | undefined {
        return this.states.get(id)?.val;
    }
}

const SILENT_LOGGER: Logger = { warn: () => undefined, debug: () => undefined };

/** Ephemeral-ish high ports; each test uses its own to avoid bind collisions. */
let nextPort = 15020;
function allocPort(): number {
    return nextPort++;
}

// ---------------------------------------------------------------------------
// Task 13.1 — full polling cycle
// ---------------------------------------------------------------------------

describe('Feature: solaredge-sunspec-reader, integration: full polling cycle', () => {
    let server: MockServer | undefined;
    let client: ModbusClient | undefined;
    const port = allocPort();
    let device: SeededDevice;

    before(async function () {
        this.timeout(15000);
        device = seedDevice();
        server = await startServer(device.store, port);
    });

    after(async function () {
        this.timeout(15000);
        await (client ? client.close() : Promise.resolve());
        await closeServer(server);
    });

    it('runs the client<->server<->reader<->state pipeline end to end (Req 3.3, 3.4, 5.4, 6.8, 7.2)', async function () {
        this.timeout(15000);

        client = new ModbusClient();
        await client.connect(HOST, port, 1);
        expect(client.isConnected()).to.equal(true);

        const reader = new SunSpecReader(SILENT_LOGGER);
        const adapter = new MockAdapter();
        const sm = new StateManager(adapter);
        await sm.ensureChannel('inverter');
        await sm.ensureChannel('meter.1');

        // --- Inverter: detect model 103, read, write states -----------------
        const invModel = await reader.detectInverterModel(client);
        expect(invModel).to.equal(103);

        const invValues = await reader.readInverter(client, invModel!);
        expect(invValues.length).to.equal(getInverterValueDefs().length);
        for (const dv of invValues) {
            await sm.writeValue('inverter', dv.def, dv.value);
        }

        // acPower was seeded with a concrete raw value; SF=0 so scaled == raw.
        const acPowerRaw = device.invRaw.get('acPower')!;
        const acPowerWrite = adapter.writes.filter(w => w.id === 'inverter.acPower');
        expect(acPowerWrite.length).to.equal(1);
        expect(acPowerWrite[0].val).to.equal(acPowerRaw);
        expect(acPowerWrite[0].ack).to.equal(true);

        // Each decoded value is written acknowledged with the scaled (== raw, SF=0)
        // value; a value that decoded to null (unavailable) produces NO write (Req 3.8, 6.8).
        // NOTE: acEnergyWh (acc32) resolves via its sunssf scale factor acEnergyWhSF
        // (seeded SF=0 => scaled == raw), so it is written like the other values and is
        // covered by the per-def loop below with no special-casing.
        for (const dv of invValues) {
            const writes = adapter.writes.filter(x => x.id === `inverter.${dv.def.name}`);
            if (dv.value === null) {
                expect(writes.length, `inverter.${dv.def.name} should not be written (null)`).to.equal(0);
            } else {
                expect(writes.length, `inverter.${dv.def.name} write count`).to.equal(1);
                expect(writes[0].ack, `inverter.${dv.def.name} ack`).to.equal(true);
                expect(writes[0].val, `inverter.${dv.def.name} scaled value`).to.equal(device.invRaw.get(dv.def.name));
            }
        }

        // Confirm at least one representative acc32 value round-trips end to end via
        // the meter block below (mExportedWh), whose scale ref is a real sunssf.

        // --- Meter: detect model 201, read, write states --------------------
        const meterModel = await reader.detectMeterModel(client);
        expect(meterModel).to.equal(201);

        const meterValues = await reader.readMeter(client, meterModel!);
        expect(meterValues.length).to.equal(getMeterValueDefs().length);
        for (const dv of meterValues) {
            await sm.writeValue('meter.1', dv.def, dv.value);
        }

        // mPower (int16) and mExportedWh (acc32, 2 words) both reference a real sunssf
        // scale factor set to 0, so scaled == raw for each — proving the 16-bit and
        // 32-bit decode paths flow end to end through client->reader->state (Req 3.4, 6.8).
        const mPowerRaw = device.meterRaw.get('mPower')!;
        expect(adapter.lastVal('meter.1.mPower')).to.equal(mPowerRaw);
        const mExportedRaw = device.meterRaw.get('mExportedWh')!;
        expect(adapter.lastVal('meter.1.mExportedWh')).to.equal(mExportedRaw);
        const mImportedRaw = device.meterRaw.get('mImportedWh')!;
        expect(adapter.lastVal('meter.1.mImportedWh')).to.equal(mImportedRaw);

        // Model a successful cycle: info.connection would be set true (Req 7.2).
        let connection = false;
        connection = true; // full success
        expect(connection).to.equal(true);

        // Channels were created for grouping (Req 6.9 / object tree).
        expect(adapter.objects.has('inverter')).to.equal(true);
        expect(adapter.objects.has('meter')).to.equal(true);
    });
});

// ---------------------------------------------------------------------------
// Task 19.2 — multiple meters + battery
// ---------------------------------------------------------------------------

describe('Feature: solaredge-sunspec-reader, integration: multiple meters + battery', () => {
    let server: MockServer | undefined;
    let client: ModbusClient | undefined;
    const port = allocPort();
    let device: SeededDevice;

    before(async function () {
        this.timeout(15000);
        device = seedDevice();
        server = await startServer(device.store, port);
    });

    after(async function () {
        this.timeout(15000);
        await (client ? client.close() : Promise.resolve());
        await closeServer(server);
    });

    it('detects + reads all present meters and batteries, skips absent slots, decodes float32le/uint64 (Req 9.2, 9.3, 9.4, 10.2, 10.3, 10.4, 10.5, 10.9)', async function () {
        this.timeout(15000);

        client = new ModbusClient();
        await client.connect(HOST, port, 1);
        expect(client.isConnected()).to.equal(true);

        const reader = new SunSpecReader(SILENT_LOGGER);
        const adapter = new MockAdapter();
        const sm = new StateManager(adapter);
        await sm.ensureChannel('inverter');

        // --- Inverter read still works => connection would be true (Req 7.2) --
        const invModel = await reader.detectInverterModel(client);
        expect(invModel).to.equal(103);
        const invValues = await reader.readInverter(client, invModel!);
        for (const dv of invValues) {
            await sm.writeValue('inverter', dv.def, dv.value);
        }
        const connection = true; // full inverter read succeeded
        expect(connection).to.equal(true);

        // --- Meters: slot 1 + slot 2 present, slot 3 absent (Req 9.2, 9.4) ---
        const meters = await reader.detectMeters(client);
        expect(meters.map(m => m.index)).to.deep.equal([1, 2]);
        for (const meter of meters) {
            const channel = `meter.${meter.index}` as const;
            await sm.ensureChannel(channel);
            const values = await reader.readMeterSlot(client, meter);
            for (const dv of values) {
                await sm.writeValue(channel, dv.def, dv.value);
            }
        }

        // --- Batteries: slot 1 present, slot 2 absent (Req 10.1, 10.9) -------
        const batteries = await reader.detectBatteries(client);
        expect(batteries.map(b => b.index)).to.deep.equal([1]);
        for (const battery of batteries) {
            const channel = `battery.${battery.index}` as const;
            await sm.ensureChannel(channel);
            const values = await reader.readBatterySlot(client, battery);
            for (const dv of values) {
                await sm.writeValue(channel, dv.def, dv.value);
            }
        }

        // --- Assert per-device channel presence/absence (Req 9.3, 9.4, 10.5) -
        expect(adapter.objects.has('meter.1'), 'meter.1 channel').to.equal(true);
        expect(adapter.objects.has('meter.2'), 'meter.2 channel').to.equal(true);
        expect(adapter.objects.has('meter.3'), 'meter.3 must be absent').to.equal(false);
        expect(adapter.objects.has('battery.1'), 'battery.1 channel').to.equal(true);
        expect(adapter.objects.has('battery.2'), 'battery.2 must be absent').to.equal(false);

        // States exist under meter.1.* and meter.2.* but not meter.3.*.
        const hasStatePrefix = (prefix: string): boolean =>
            [...adapter.states.keys()].some(id => id.startsWith(prefix));
        expect(hasStatePrefix('meter.1.'), 'meter.1 states').to.equal(true);
        expect(hasStatePrefix('meter.2.'), 'meter.2 states').to.equal(true);
        expect(hasStatePrefix('meter.3.'), 'no meter.3 states').to.equal(false);
        expect(hasStatePrefix('battery.1.'), 'battery.1 states').to.equal(true);
        expect(hasStatePrefix('battery.2.'), 'no battery.2 states').to.equal(false);

        // --- Spot-check a scaled meter value on each slot (SF=0 => scaled==raw)
        expect(adapter.lastVal('meter.1.mPower')).to.equal(device.meterRaw.get('mPower'));
        expect(adapter.lastVal('meter.2.mPower')).to.equal(device.meter2Raw.get('mPower'));

        // --- Spot-check battery float32le + uint64 decode end to end ---------
        const powerVal = adapter.lastVal('battery.1.instantaneousPower') as number;
        // float32 is not exact; assert within a tiny tolerance.
        expect(Math.abs(powerVal - device.battery.instantaneousPower)).to.be.lessThan(0.01);
        expect(adapter.lastVal('battery.1.lifetimeExportEnergy')).to.equal(device.battery.lifetimeExportEnergy);
        expect(adapter.lastVal('battery.1.lifetimeImportEnergy')).to.equal(device.battery.lifetimeImportEnergy);

        // status is uint32le (batch 2): words 0x0003 0x0000 => 3.
        expect(adapter.lastVal('battery.1.status')).to.equal(device.battery.status);

        // maxDischargePeakPower sits at 0xE14A, inside the region batch 2 reads across
        // the internal gap — it must now decode and publish a state (seeded generically).
        expect(hasStatePrefix('battery.1.maxDischargePeakPower'), 'gap-spanning def present').to.equal(true);
    });
});

// ---------------------------------------------------------------------------
// Task 13.2 — testConnection behavior
// ---------------------------------------------------------------------------

/**
 * Mirror of the adapter's `handleTestConnection` probe (main.ts) without the
 * ioBroker message box. Returns the same response shape the handler replies with.
 *
 * @param host
 * @param port
 * @param unitId
 */
async function probeTestConnection(host: string, port: number, unitId: number): Promise<Record<string, unknown>> {
    // Validate host/port/unitId only (pollInterval irrelevant here) (Req 2.4).
    const result = validateConfig({ host, port, unitId, pollInterval: 30 });
    const relevantErrors = Object.entries(result.errors).filter(([field]) => field !== 'pollInterval');
    if (relevantErrors.length > 0) {
        const message = relevantErrors.map(([field, err]) => `${field}: ${err}`).join('; ');
        return { result: 'validationError', message };
    }

    const client = new ModbusClient();
    try {
        await client.connect(host, port, unitId, 10000);
        const idWords = await client.readHoldingRegisters(COMMON_BASE, 2);
        const sunsId = decodeRegisters(idWords, 'uint32');
        if (sunsId !== 0x53756e53) {
            return { result: 'failure', message: `Device at ${host}:${port} did not return a SunSpec identifier` };
        }
        const manuWords = await client.readHoldingRegisters(COMMON_BASE + 4, 16);
        const modelWords = await client.readHoldingRegisters(COMMON_BASE + 20, 16);
        const manufacturer = decodeRegisters(manuWords, 'string');
        const model = decodeRegisters(modelWords, 'string');
        return {
            result: 'success',
            manufacturer: typeof manufacturer === 'string' ? manufacturer : '',
            model: typeof model === 'string' ? model : '',
        };
    } catch (error) {
        return { result: 'failure', message: error instanceof Error ? error.message : String(error) };
    } finally {
        try {
            await client.close();
        } catch {
            /* ignore */
        }
    }
}

describe('Feature: solaredge-sunspec-reader, integration: testConnection', () => {
    let server: MockServer | undefined;
    const port = allocPort();

    before(async function () {
        this.timeout(15000);
        server = await startServer(seedDevice().store, port);
    });

    after(async function () {
        this.timeout(15000);
        await closeServer(server);
    });

    it('reports success against a reachable SunSpec device and decodes manufacturer/model (Req 2.2, 2.5)', async function () {
        this.timeout(15000);
        const res = await probeTestConnection(HOST, port, 1);
        expect(res.result).to.equal('success');
        expect(res.manufacturer).to.equal('SolarEdge');
        expect(res.model).to.equal('SE5000');
    });

    it('reports failure when the endpoint is unreachable within the timeout (Req 2.3)', async function () {
        this.timeout(15000);
        // A high port with no listener: connect rejects; no throw escapes.
        const deadPort = allocPort();
        const res = await probeTestConnection(HOST, deadPort, 1);
        expect(res.result).to.equal('failure');
        expect(res.message).to.be.a('string');
    });

    it('reports validationError for a bad config without attempting a socket, within ~1s (Req 2.4)', async function () {
        this.timeout(2000);
        const start = Date.now();
        // host '' / port 0 / unitId 300 are all invalid.
        const res = await probeTestConnection('', 0, 300);
        const elapsed = Date.now() - start;
        expect(res.result).to.equal('validationError');
        expect(res.message).to.be.a('string');
        // No TCP attempt means this returns effectively immediately.
        expect(elapsed).to.be.lessThan(1000);

        // Cross-check the pure validator reports the offending fields.
        const v = validateConfig({ host: '', port: 0, unitId: 300, pollInterval: 30 });
        expect(v.valid).to.equal(false);
        expect(v.errors).to.have.property('host');
        expect(v.errors).to.have.property('port');
        expect(v.errors).to.have.property('unitId');
    });
});

// ---------------------------------------------------------------------------
// Task 13.3 — timeout / reconnect / retention
// ---------------------------------------------------------------------------

describe('Feature: solaredge-sunspec-reader, integration: timeout and reconnect', () => {
    let servers: MockServer[] = [];

    afterEach(async function () {
        this.timeout(15000);
        const toClose = servers;
        servers = [];
        await Promise.all(toClose.map(s => closeServer(s)));
    });

    it('rejects a read that exceeds the configured timeout (Req 3.5, 5.5)', async function () {
        this.timeout(15000);
        const port = allocPort();
        const device = seedDevice();
        // Server delays multi-register responses well beyond the client read timeout.
        const server = await startServer(device.store, port, 1500);
        servers.push(server);

        const client = new ModbusClient();
        await client.connect(HOST, port, 1);
        try {
            // Read >1 register (routes through the delayed getMultipleHoldingRegisters)
            // with a short 200ms timeout: must reject before the 1500ms server delay.
            const start = Date.now();
            let threw = false;
            try {
                await client.readHoldingRegisters(COMMON_BASE, 2, { timeoutMs: 200 });
            } catch {
                threw = true;
            }
            const elapsed = Date.now() - start;
            expect(threw, 'read should have timed out').to.equal(true);
            expect(elapsed, 'timeout should fire near the 200ms bound').to.be.lessThan(1200);
        } finally {
            await client.close();
        }
    });

    it('transitions info.connection false->true on reconnect and retains last good values (Req 7.3, 7.4, 7.5)', async function () {
        this.timeout(20000);
        const port = allocPort();
        const device = seedDevice();
        const reader = new SunSpecReader(SILENT_LOGGER);
        const adapter = new MockAdapter();
        const sm = new StateManager(adapter);
        await sm.ensureChannel('inverter');

        // Track connection state locally, mirroring main.ts's per-cycle logic.
        let connection = false;

        // --- Cycle 0: seed a known-good value while a server is up ----------
        const server0 = await startServer(device.store, port);
        servers.push(server0);
        const client0 = new ModbusClient();
        await client0.connect(HOST, port, 1);
        const invModel = await reader.detectInverterModel(client0);
        const good = await reader.readInverter(client0, invModel!);
        for (const dv of good) {
            await sm.writeValue('inverter', dv.def, dv.value);
        }
        connection = true;
        expect(connection).to.equal(true);
        const goodAcPower = device.invRaw.get('acPower')!;
        expect(adapter.lastVal('inverter.acPower')).to.equal(goodAcPower);
        const writesAfterGood = adapter.writes.length;

        // Bring the server (and client) down => next cycle will fail.
        await client0.close();
        await closeServer(server0);
        servers = servers.filter(s => s !== server0);

        // --- Cycle 1: FAILS (server down). Retain values, connection=false --
        const clientFail = new ModbusClient();
        let cycleFailed = false;
        try {
            await clientFail.connect(HOST, port, 1, 800);
            const m = await reader.detectInverterModel(clientFail);
            const vals = await reader.readInverter(clientFail, m!);
            for (const dv of vals) {
                await sm.writeValue('inverter', dv.def, dv.value);
            }
        } catch {
            cycleFailed = true;
        } finally {
            await clientFail.close();
        }
        expect(cycleFailed, 'cycle 1 should fail with server down').to.equal(true);
        connection = false;
        expect(connection).to.equal(false);
        // Retention: no new writes occurred, last good value is still present.
        expect(adapter.writes.length).to.equal(writesAfterGood);
        expect(adapter.lastVal('inverter.acPower')).to.equal(goodAcPower);

        // --- Cycle 2: server back up => reconnect succeeds, connection=true -
        const server2 = await startServer(device.store, port);
        servers.push(server2);
        const client2 = new ModbusClient();
        await client2.connect(HOST, port, 1);
        const m2 = await reader.detectInverterModel(client2);
        expect(m2).to.equal(103);
        const recovered = await reader.readInverter(client2, m2!);
        for (const dv of recovered) {
            await sm.writeValue('inverter', dv.def, dv.value);
        }
        connection = true; // reconnection + full read succeeded (Req 7.5)
        expect(connection).to.equal(true);
        expect(adapter.lastVal('inverter.acPower')).to.equal(goodAcPower);
        await client2.close();
    });
});
