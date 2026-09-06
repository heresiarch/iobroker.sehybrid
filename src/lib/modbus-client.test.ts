import { expect } from 'chai';
import fc from 'fast-check';
import type { IModbusClient, ModbusReadOptions } from './modbus-client';
import { ModbusClient } from './modbus-client';
import type { InverterModelId, MeterModelId } from './sunspec-reader';
import { SunSpecReader } from './sunspec-reader';

// ---------------------------------------------------------------------------
// TASK 6.2 — Property 4: Read-only invariant
// Validates: Requirements 3.1
//
// Over any sequence of reader operations against the Modbus client, ONLY read
// function codes (FC03 readHoldingRegisters, FC04 readInputRegisters) are ever
// issued, and the IModbusClient interface / ModbusClient class exposes NO write
// method.
// ---------------------------------------------------------------------------

// The set of method names the read-only client legitimately exposes. Every call
// recorded by the RecordingClient must be one of these.
const ALLOWED_CALLS = ['connect', 'close', 'isConnected', 'readHoldingRegisters', 'readInputRegisters'];

// Common Modbus write-style method names that must never be present on the
// read-only client surface, nor ever recorded as a call.
const FORBIDDEN_WRITE_METHODS = [
    'writeRegister',
    'writeRegisters',
    'writeCoil',
    'writeCoils',
    'writeFC5',
    'writeFC6',
    'writeFC15',
    'writeFC16',
    'writeHoldingRegister',
    'writeHoldingRegisters',
    'writeSingleRegister',
    'writeMultipleRegisters',
    'writeSingleCoil',
    'writeMultipleCoils',
];

/**
 * A test double implementing {@link IModbusClient} that records the name of every
 * method invoked. Reads return canned data: an array of the requested length whose
 * first element is `firstWord` (so detection reads can report a valid SunSpec model
 * id) and whose remaining elements are 0. No real socket is opened.
 */
class RecordingClient implements IModbusClient {
    readonly calls: string[] = [];
    private connected = false;
    /** Value returned as the first register of every read (drives model detection). */
    private readonly firstWord: number;

    constructor(firstWord: number) {
        this.firstWord = firstWord;
    }

    connect(_host: string, _port: number, _unitId: number, _timeoutMs?: number): Promise<void> {
        this.calls.push('connect');
        this.connected = true;
        return Promise.resolve();
    }

    readHoldingRegisters(_address: number, length: number, _opts?: ModbusReadOptions): Promise<number[]> {
        this.calls.push('readHoldingRegisters');
        return Promise.resolve(this.cannedData(length));
    }

    readInputRegisters(_address: number, length: number, _opts?: ModbusReadOptions): Promise<number[]> {
        this.calls.push('readInputRegisters');
        return Promise.resolve(this.cannedData(length));
    }

    isConnected(): boolean {
        this.calls.push('isConnected');
        return this.connected;
    }

    close(): Promise<void> {
        this.calls.push('close');
        this.connected = false;
        return Promise.resolve();
    }

    /**
     * An array of `length` words: first element `firstWord`, the rest zero.
     *
     * @param length
     */
    private cannedData(length: number): number[] {
        const data = new Array<number>(Math.max(length, 0)).fill(0);
        if (length >= 1) {
            data[0] = this.firstWord;
        }
        return data;
    }
}

/** The reader operations the property drives, each against a fresh client. */
type Op =
    | { kind: 'detectInverterModel' }
    | { kind: 'detectMeterModel' }
    | { kind: 'readInverter'; model: InverterModelId }
    | { kind: 'readMeter'; model: MeterModelId };

const inverterModels: InverterModelId[] = [101, 102, 103];
const meterModels: MeterModelId[] = [201, 202, 203, 204];

const RUNS = { numRuns: 100 };

describe('modbus-client', () => {
    describe('Feature: solaredge-sunspec-reader, Property 4: Read-only invariant', () => {
        it('Feature: solaredge-sunspec-reader, Property 4: Read-only invariant', async () => {
            // Generator for an arbitrary reader operation with a random valid model.
            const opArb: fc.Arbitrary<Op> = fc.oneof(
                fc.constant<Op>({ kind: 'detectInverterModel' }),
                fc.constant<Op>({ kind: 'detectMeterModel' }),
                fc.constantFrom(...inverterModels).map<Op>(model => ({ kind: 'readInverter', model })),
                fc.constantFrom(...meterModels).map<Op>(model => ({ kind: 'readMeter', model })),
            );

            // The first word each read returns. Using a valid inverter DID (101) lets
            // detectInverterModel succeed; detectMeterModel simply returns null for that
            // value, which still exercises the read path without any writes.
            const firstWordArb = fc.constantFrom(101, 102, 103, 201, 202, 203, 204, 0, 0xffff);

            await fc.assert(
                fc.asyncProperty(fc.array(opArb, { minLength: 1, maxLength: 12 }), firstWordArb, async (ops, first) => {
                    const client = new RecordingClient(first);
                    const reader = new SunSpecReader();

                    for (const op of ops) {
                        switch (op.kind) {
                            case 'detectInverterModel':
                                await reader.detectInverterModel(client);
                                break;
                            case 'detectMeterModel':
                                await reader.detectMeterModel(client);
                                break;
                            case 'readInverter':
                                await reader.readInverter(client, op.model);
                                break;
                            case 'readMeter':
                                await reader.readMeter(client, op.model);
                                break;
                        }
                    }

                    // Every recorded call must be an allowed read/connection-management
                    // method, and none may be a write-style method (Req 3.1).
                    for (const call of client.calls) {
                        expect(ALLOWED_CALLS, `unexpected call "${call}"`).to.include(call);
                        expect(FORBIDDEN_WRITE_METHODS, `write call "${call}" was issued`).to.not.include(call);
                    }
                }),
                RUNS,
            );
        });

        // -------------------------------------------------------------------
        // Static read-only surface guard: the ModbusClient class (and thus the
        // IModbusClient contract it implements) must expose no write method,
        // neither on the instance nor on its prototype chain (Req 3.1).
        // -------------------------------------------------------------------
        it('Feature: solaredge-sunspec-reader, Property 4: ModbusClient exposes no write method', () => {
            const client = new ModbusClient();

            for (const name of FORBIDDEN_WRITE_METHODS) {
                expect((client as any)[name], `ModbusClient should not expose "${name}"`).to.equal(undefined);
            }

            // The only callable methods on the read-only surface are the allowed ones.
            for (const name of ALLOWED_CALLS) {
                expect((client as any)[name], `ModbusClient should expose "${name}"`).to.be.a('function');
            }
        });
    });
});
