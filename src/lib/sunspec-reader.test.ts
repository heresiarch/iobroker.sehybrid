/**
 * Tests for the SunSpec reader: chunking, model detection, missing-block handling,
 * and scale-factor skip behavior.
 *
 * Covers:
 * - Property 8: Read requests never exceed 125 registers (task 7.3, Req 3.2)
 * - Detection & missing-block handling unit tests (task 7.4, Req 3.3, 3.4, 3.9)
 * - Scale-factor skip behavior (Req 3.10)
 */

import { expect } from 'chai';
import fc from 'fast-check';
import type { IModbusClient, ModbusReadOptions } from './modbus-client';
import { MAX_REGISTERS_PER_READ } from './modbus-client';
import {
    BATTERY_MAP,
    BATTERY_READ_SEGMENTS,
    INVERTER_BASE,
    SUNSPEC_MAP,
    getBatteryBase,
    getBatteryPresenceAddress,
    getBatteryValueDefs,
    getInverterValueDefs,
    getMeterBase,
    getMeterDidAddress,
    getMeterValueDefs,
} from './sunspec-map';
import type { DecodedValue, InverterModelId, Logger, MeterModelId } from './sunspec-reader';
import { METER_DID_ADDRESS, SunSpecReader, planReadChunks } from './sunspec-reader';

// -----------------------------------------------------------------------------
// Encoders (inverse of the decoders in sunspec-decode) used to seed the MockClient.
// -----------------------------------------------------------------------------

/**
 * Encode an IEEE-754 float32 into two 16-bit words in little-endian WORD order,
 * matching `decodeRegisters(..., 'float32le')` (words swapped, bytes big-endian).
 *
 * @param value
 */
function encodeFloat32le(value: number): [number, number] {
    const buf = Buffer.allocUnsafe(4);
    buf.writeFloatBE(value, 0);
    const hiWord = buf.readUInt16BE(0);
    const loWord = buf.readUInt16BE(2);
    // Decoder reads words[1] into offset 0 and words[0] into offset 2, so swap.
    return [loWord, hiWord];
}

/**
 * Encode an unsigned integer (exact to 2^53) into four 16-bit words in little-endian
 * WORD order (lowest word first), matching `decodeRegisters(..., 'uint64le')`.
 *
 * @param value
 */
function encodeUint64LE(value: number): [number, number, number, number] {
    const hi = Math.floor(value / 4294967296);
    const lo = value >>> 0;
    // Little-endian WORD order: lowest word first (matches decodeRegisters(..., 'uint64le')).
    return [lo & 0xffff, (lo >>> 16) & 0xffff, hi & 0xffff, (hi >>> 16) & 0xffff];
}

// -----------------------------------------------------------------------------
// Test doubles
// -----------------------------------------------------------------------------

/**
 * Configurable read-only Modbus client for tests. Serves register reads from a
 * sparse backing store keyed by absolute base-0 address; unset addresses default
 * to `defaultWord` (0). Only read function codes are implemented, matching the
 * read-only contract of {@link IModbusClient}.
 */
class MockClient implements IModbusClient {
    private readonly store = new Map<number, number>();
    private readonly defaultWord: number;
    private connected = true;

    constructor(defaultWord = 0) {
        this.defaultWord = defaultWord & 0xffff;
    }

    /**
     * Set a single register word at an absolute base-0 address.
     *
     * @param address
     * @param value
     */
    setWord(address: number, value: number): this {
        this.store.set(address, value & 0xffff);
        return this;
    }

    /**
     * Set consecutive register words starting at an absolute base-0 address.
     *
     * @param address
     * @param values
     */
    setWords(address: number, values: number[]): this {
        values.forEach((v, i) => this.setWord(address + i, v));
        return this;
    }

    private readAt(address: number, length: number): number[] {
        const out: number[] = new Array<number>(length);
        for (let i = 0; i < length; i++) {
            out[i] = this.store.has(address + i) ? (this.store.get(address + i) as number) : this.defaultWord;
        }
        return out;
    }

    connect(): Promise<void> {
        this.connected = true;
        return Promise.resolve();
    }

    readHoldingRegisters(address: number, length: number, _opts?: ModbusReadOptions): Promise<number[]> {
        return Promise.resolve(this.readAt(address, length));
    }

    readInputRegisters(address: number, length: number, _opts?: ModbusReadOptions): Promise<number[]> {
        return Promise.resolve(this.readAt(address, length));
    }

    isConnected(): boolean {
        return this.connected;
    }

    close(): Promise<void> {
        this.connected = false;
        return Promise.resolve();
    }
}

/** Logger stub that records every warning (and debug) message for assertions. */
class RecordingLogger implements Logger {
    readonly warnings: string[] = [];
    readonly debugs: string[] = [];
    warn(msg: string): void {
        this.warnings.push(msg);
    }
    debug(msg: string): void {
        this.debugs.push(msg);
    }
}

describe('sunspec-reader', () => {
    // -------------------------------------------------------------------------
    // Task 7.3 — Property 8: Read requests never exceed 125 registers (Req 3.2)
    // -------------------------------------------------------------------------

    it('Feature: solaredge-sunspec-reader, Property 8: Read requests never exceed 125 registers', () => {
        const startArb = fc.integer({ min: 0, max: 50000 });
        const lenArb = fc.integer({ min: 0, max: 1000 });
        const maxArb = fc.option(fc.integer({ min: 1, max: 125 }), { nil: undefined });

        fc.assert(
            fc.property(startArb, lenArb, maxArb, (startAddr, totalLen, maxPerRead) => {
                const effectiveMax = maxPerRead ?? MAX_REGISTERS_PER_READ;
                const chunks =
                    maxPerRead === undefined
                        ? planReadChunks(startAddr, totalLen)
                        : planReadChunks(startAddr, totalLen, maxPerRead);

                // totalLen === 0 yields an empty array.
                if (totalLen === 0) {
                    expect(chunks).to.deep.equal([]);
                    return;
                }

                expect(chunks.length).to.be.greaterThan(0);

                let expectedAddr = startAddr;
                let sum = 0;
                for (const chunk of chunks) {
                    // Each chunk covers at least 1 and at most maxPerRead (<= 125) registers.
                    expect(chunk.length).to.be.greaterThanOrEqual(1);
                    expect(chunk.length).to.be.lessThanOrEqual(effectiveMax);
                    expect(effectiveMax).to.be.lessThanOrEqual(MAX_REGISTERS_PER_READ);

                    // Contiguous & non-overlapping: chunk i+1 starts where chunk i ends.
                    expect(chunk.address).to.equal(expectedAddr);
                    expectedAddr += chunk.length;
                    sum += chunk.length;
                }

                // The chunks exactly cover the span once.
                expect(chunks[0].address).to.equal(startAddr);
                expect(sum).to.equal(totalLen);
                expect(expectedAddr).to.equal(startAddr + totalLen);
            }),
            { numRuns: 200 },
        );
    });

    // -------------------------------------------------------------------------
    // Task 7.4 — Detection & missing-block handling (Req 3.3, 3.4, 3.9)
    // -------------------------------------------------------------------------

    describe('detectInverterModel', () => {
        for (const model of [101, 102, 103] as InverterModelId[]) {
            it(`resolves to ${model} when register ${INVERTER_BASE} holds ${model}`, async () => {
                const log = new RecordingLogger();
                const reader = new SunSpecReader(log);
                const client = new MockClient().setWord(INVERTER_BASE, model);
                const detected = await reader.detectInverterModel(client);
                expect(detected).to.equal(model);
                expect(log.warnings).to.deep.equal([]);
            });
        }

        for (const invalid of [0, 0xffff]) {
            it(`resolves null and warns when the inverter DID is invalid (${invalid})`, async () => {
                const log = new RecordingLogger();
                const reader = new SunSpecReader(log);
                const client = new MockClient().setWord(INVERTER_BASE, invalid);
                const detected = await reader.detectInverterModel(client);
                expect(detected).to.equal(null);
                expect(log.warnings.length).to.be.greaterThan(0);
            });
        }
    });

    describe('detectMeterModel', () => {
        for (const model of [201, 202, 203, 204] as MeterModelId[]) {
            it(`resolves to ${model} when register ${METER_DID_ADDRESS} holds ${model}`, async () => {
                const log = new RecordingLogger();
                const reader = new SunSpecReader(log);
                const client = new MockClient().setWord(METER_DID_ADDRESS, model);
                const detected = await reader.detectMeterModel(client);
                expect(detected).to.equal(model);
                expect(log.warnings).to.deep.equal([]);
            });
        }

        for (const invalid of [0, 0xffff]) {
            it(`resolves null and warns when the meter DID is invalid (${invalid})`, async () => {
                const log = new RecordingLogger();
                const reader = new SunSpecReader(log);
                const client = new MockClient().setWord(METER_DID_ADDRESS, invalid);
                const detected = await reader.detectMeterModel(client);
                expect(detected).to.equal(null);
                expect(log.warnings.length).to.be.greaterThan(0);
            });
        }
    });

    // -------------------------------------------------------------------------
    // Task 7.4 — Block read/decode returns one value per value def (Req 3.6-3.8)
    // -------------------------------------------------------------------------

    describe('readInverter / readMeter with all-zero registers', () => {
        it('readInverter returns one DecodedValue per inverter value def', async () => {
            const reader = new SunSpecReader(new RecordingLogger());
            const client = new MockClient(0);
            const values: DecodedValue[] = await reader.readInverter(client, 101);
            expect(values.length).to.equal(getInverterValueDefs().length);
            // Every emitted value is a number, string, or null.
            for (const v of values) {
                expect(v.value === null || typeof v.value === 'number' || typeof v.value === 'string').to.equal(true);
            }
            // Spot-check a couple of well-known inverter values.
            const acPower = values.find(v => v.def.name === 'acPower');
            expect(acPower, 'acPower present').to.not.equal(undefined);
            expect(acPower!.value === null || typeof acPower!.value === 'number').to.equal(true);
            const status = values.find(v => v.def.name === 'status');
            expect(status, 'status present').to.not.equal(undefined);
        });

        it('readMeter returns one DecodedValue per meter value def', async () => {
            const reader = new SunSpecReader(new RecordingLogger());
            const client = new MockClient(0);
            const values: DecodedValue[] = await reader.readMeter(client, 201);
            expect(values.length).to.equal(getMeterValueDefs().length);
            for (const v of values) {
                expect(v.value === null || typeof v.value === 'number' || typeof v.value === 'string').to.equal(true);
            }
            const mPower = values.find(v => v.def.name === 'mPower');
            expect(mPower, 'mPower present').to.not.equal(undefined);
            expect(mPower!.value === null || typeof mPower!.value === 'number').to.equal(true);
        });
    });

    // -------------------------------------------------------------------------
    // Task 7.4 — Scale-factor skip behavior (Req 3.10)
    // -------------------------------------------------------------------------

    describe('scale-factor unavailable => value skipped with warning', () => {
        it('skips acPower (value null) and warns when acPowerSF holds the sunssf sentinel 0x8000', async () => {
            const log = new RecordingLogger();
            const reader = new SunSpecReader(log);

            // Resolve the absolute addresses of acPower and its scale-factor register.
            const acPowerDef = SUNSPEC_MAP.find(d => d.name === 'acPower');
            const acPowerSfDef = SUNSPEC_MAP.find(d => d.name === 'acPowerSF');
            expect(acPowerDef, 'acPower def').to.not.equal(undefined);
            expect(acPowerSfDef, 'acPowerSF def').to.not.equal(undefined);
            expect(acPowerDef!.scaleFactorRef).to.equal('acPowerSF');

            const acPowerAddr = INVERTER_BASE + acPowerDef!.offset;
            const acPowerSfAddr = INVERTER_BASE + acPowerSfDef!.offset;

            const client = new MockClient(0)
                // A normal (non-sentinel) raw power reading.
                .setWord(acPowerAddr, 1234)
                // Scale factor register set to the sunssf NOT_IMPLEMENTED sentinel.
                .setWord(acPowerSfAddr, 0x8000);

            const values = await reader.readInverter(client, 101);
            const acPower = values.find(v => v.def.name === 'acPower');
            expect(acPower, 'acPower present').to.not.equal(undefined);
            expect(acPower!.value).to.equal(null);

            // A warning naming the affected value was logged.
            const named = log.warnings.some(w => w.includes('acPower'));
            expect(named, `a warning should name acPower; got: ${JSON.stringify(log.warnings)}`).to.equal(true);
        });
    });

    // -------------------------------------------------------------------------
    // Task 17.3 — detectMeters (Req 9.1, 9.2)
    // -------------------------------------------------------------------------

    describe('detectMeters', () => {
        it('returns only present meter slots (1 & 3), skipping the absent slot 2', async () => {
            const log = new RecordingLogger();
            const reader = new SunSpecReader(log);
            const client = new MockClient(0)
                .setWord(getMeterDidAddress(1), 203) // meter.1 present, model 203
                .setWord(getMeterDidAddress(2), 0xffff) // meter.2 absent (sentinel)
                .setWord(getMeterDidAddress(3), 201); // meter.3 present, model 201

            const detected = await reader.detectMeters(client);
            expect(detected).to.deep.equal([
                { index: 1, model: 203 },
                { index: 3, model: 201 },
            ]);
        });

        it('treats a zero DID as an absent meter slot', async () => {
            const reader = new SunSpecReader(new RecordingLogger());
            const client = new MockClient(0); // all slots read 0
            const detected = await reader.detectMeters(client);
            expect(detected).to.deep.equal([]);
        });
    });

    // -------------------------------------------------------------------------
    // Task 17.3 — detectBatteries (Req 10.1)
    // -------------------------------------------------------------------------

    describe('detectBatteries', () => {
        it('returns present battery slot 1 (c_deviceaddress at 0xE140) and skips the sentinel slot 2', async () => {
            const reader = new SunSpecReader(new RecordingLogger());
            // Default = uint16 sentinel => absent. Slot 1 c_deviceaddress reads a real
            // Modbus id (e.g. 112 on a live SolarEdge Home Battery), which marks it present.
            const client = new MockClient(0xffff).setWord(getBatteryPresenceAddress(1), 112);

            const detected = await reader.detectBatteries(client);
            expect(detected).to.deep.equal([{ index: 1, did: 112 }]);
        });

        it('treats a presence word of 255 as an absent battery slot', async () => {
            const reader = new SunSpecReader(new RecordingLogger());
            const client = new MockClient(0xffff).setWord(getBatteryPresenceAddress(1), 255);
            const detected = await reader.detectBatteries(client);
            expect(detected).to.deep.equal([]);
        });

        it('treats a presence word of 0 as an absent battery slot', async () => {
            const reader = new SunSpecReader(new RecordingLogger());
            const client = new MockClient(0); // all reads 0 => absent
            const detected = await reader.detectBatteries(client);
            expect(detected).to.deep.equal([]);
        });
    });

    // -------------------------------------------------------------------------
    // Task 17.3 — readBatterySlot (Req 10.2, 10.3, 10.4, 10.8)
    // -------------------------------------------------------------------------

    describe('readBatterySlot (per-batch reads mirroring the reference library)', () => {
        /**
         * Client that mimics the real device: it REJECTS any read whose window is not
         * fully inside one of the battery read batches ({@link BATTERY_READ_SEGMENTS}).
         * A too-wide read (e.g. the whole 0xE100..0xE193 span) or a misaligned window
         * is rejected, guaranteeing the reader issues exactly the two per-batch reads.
         * Batch 2 deliberately spans the unmapped register gap (0xE14B..0xE16B), which
         * the device serves as padding — so a read equal to that batch must SUCCEED.
         *
         * @param base battery block base (getBatteryBase(slot))
         */
        class SegmentedBatteryClient extends MockClient {
            private readonly segAbs: Array<{ start: number; end: number }>;
            constructor(base: number) {
                super(0);
                this.segAbs = BATTERY_READ_SEGMENTS.map(s => ({
                    start: base + s.offset,
                    end: base + s.offset + s.length, // exclusive
                }));
            }
            readHoldingRegisters(address: number, length: number, opts?: ModbusReadOptions): Promise<number[]> {
                const inSegment = this.segAbs.some(s => address >= s.start && address + length <= s.end);
                // Single-word reads (presence probe) are always allowed.
                if (!inSegment && length > 1) {
                    return Promise.reject(new Error(`Timed out (read ${address}+${length} not a battery batch)`));
                }
                return super.readHoldingRegisters(address, length, opts);
            }
        }

        it('reads each batch separately and decodes float32le/uint32le/uint64le incl. the gap-spanning batch', async () => {
            const reader = new SunSpecReader(new RecordingLogger());
            const base = getBatteryBase(1);

            const powerDef = BATTERY_MAP.find(d => d.name === 'instantaneousPower')!; // batch 2 float32le
            const exportDef = BATTERY_MAP.find(d => d.name === 'lifetimeExportEnergy')!; // batch 2 uint64le
            const statusDef = BATTERY_MAP.find(d => d.name === 'status')!; // batch 2 uint32le
            const ratedDef = BATTERY_MAP.find(d => d.name === 'ratedEnergy')!; // batch 2 float32le
            // maxDischargePeakPower @0xE14A sits in the gap that batch 2 spans; it must now decode.
            const peakDef = BATTERY_MAP.find(d => d.name === 'maxDischargePeakPower')!;
            expect(powerDef.datatype).to.equal('float32le');
            expect(exportDef.datatype).to.equal('uint64le');
            expect(statusDef.datatype).to.equal('uint32le');

            const powerValue = -1234.5;
            const exportValue = 987654321;
            const ratedValue = 9700;
            const peakValue = 5000;

            const client = new SegmentedBatteryClient(base)
                .setWords(base + ratedDef.offset, encodeFloat32le(ratedValue))
                .setWords(base + peakDef.offset, encodeFloat32le(peakValue))
                .setWords(base + powerDef.offset, encodeFloat32le(powerValue))
                .setWords(base + exportDef.offset, encodeUint64LE(exportValue))
                // status words 0x0003 0x0000 => uint32le 3 (Charge)
                .setWords(base + statusDef.offset, [0x0003, 0x0000]);

            const values = await reader.readBatterySlot(client, { index: 1, did: 112 });
            const byName = new Map(values.map(v => [v.def.name, v.value]));

            expect(byName.get('ratedEnergy')).to.be.closeTo(ratedValue, 1e-2);
            expect(byName.get('instantaneousPower')).to.be.closeTo(powerValue, 1e-2);
            expect(byName.get('lifetimeExportEnergy')).to.equal(exportValue);
            expect(byName.get('status')).to.equal(3);
            // The formerly gap-straddling def now decodes because batch 2 spans the gap.
            expect(byName.get('maxDischargePeakPower')).to.be.closeTo(peakValue, 1e-2);

            // Every emitted value belongs to a def fully inside a read batch.
            const inSeg = (off: number, len: number): boolean =>
                BATTERY_READ_SEGMENTS.some(s => off >= s.offset && off + len <= s.offset + s.length);
            for (const v of values) {
                expect(inSeg(v.def.offset, v.def.length), `${v.def.name} within a batch`).to.equal(true);
            }
            // And the emitted set equals the in-batch battery value defs (all of them now).
            const expectedCount = getBatteryValueDefs().filter(d => inSeg(d.offset, d.length)).length;
            expect(values.length).to.equal(expectedCount);
        });
    });

    // -------------------------------------------------------------------------
    // Task 17.3 — readMeterSlot for slot 2 (Req 9.2, 9.3)
    // -------------------------------------------------------------------------

    describe('readMeterSlot', () => {
        it('reads meter slot 2 at its per-slot base with scale factor applied', async () => {
            const reader = new SunSpecReader(new RecordingLogger());
            const base = getMeterBase(2);

            const powerDef = SUNSPEC_MAP.find(d => d.name === 'mPower');
            const powerSfDef = SUNSPEC_MAP.find(d => d.name === 'mPowerSF');
            expect(powerDef, 'mPower def').to.not.equal(undefined);
            expect(powerSfDef, 'mPowerSF def').to.not.equal(undefined);

            const client = new MockClient(0)
                .setWord(base + powerDef!.offset, 4321) // raw mPower
                .setWord(base + powerSfDef!.offset, 0); // SF = 0 => scaled == raw

            const values = await reader.readMeterSlot(client, { index: 2, model: 203 });
            const power = values.find(v => v.def.name === 'mPower');
            expect(power, 'mPower present').to.not.equal(undefined);
            expect(power!.value).to.equal(4321);
        });
    });

    // -------------------------------------------------------------------------
    // Task 17.3 — Property 11: Presence detection gates exposure (Req 9.2, 9.4, 10.1, 10.9)
    // -------------------------------------------------------------------------

    describe('Feature: solaredge-sunspec-reader, Property 11: Presence detection gates exposure', () => {
        it('returns present meter/battery slots and omits absent ones', async () => {
            const reader = new SunSpecReader(new RecordingLogger());

            // Meters: slot 1 present (201), slot 2 absent (0), slot 3 present (204).
            // Batteries: slot 1 present, slot 2 absent (sentinel).
            const client = new MockClient(0)
                .setWord(getMeterDidAddress(1), 201)
                .setWord(getMeterDidAddress(2), 0)
                .setWord(getMeterDidAddress(3), 204)
                .setWord(getBatteryPresenceAddress(1), 112)
                .setWord(getBatteryPresenceAddress(2), 0xffff);

            const meters = await reader.detectMeters(client);
            const batteries = await reader.detectBatteries(client);

            // Present slots are exposed.
            expect(meters.map(m => m.index)).to.deep.equal([1, 3]);
            expect(batteries.map(b => b.index)).to.deep.equal([1]);

            // Absent slots are omitted.
            expect(meters.some(m => m.index === 2)).to.equal(false);
            expect(batteries.some(b => b.index === 2)).to.equal(false);
        });
    });
});
