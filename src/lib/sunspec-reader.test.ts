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
import { INVERTER_BASE, SUNSPEC_MAP, getInverterValueDefs, getMeterValueDefs } from './sunspec-map';
import type { DecodedValue, InverterModelId, Logger, MeterModelId } from './sunspec-reader';
import { METER_DID_ADDRESS, SunSpecReader, planReadChunks } from './sunspec-reader';

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
});
