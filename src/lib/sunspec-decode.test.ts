import { expect } from 'chai';
import fc from 'fast-check';
import type { SunSpecDatatype } from './sunspec-decode';
import { applyScaleFactor, decodeRegisters, isNotImplemented } from './sunspec-decode';

// ---------------------------------------------------------------------------
// Local big-endian encoders: produce 16-bit register words from JS values.
// These mirror the wire format the decoders consume (hi word first).
// ---------------------------------------------------------------------------

function encUint16(v: number): number[] {
    return [v & 0xffff];
}

function encInt16(v: number): number[] {
    return [v & 0xffff];
}

function encUint32(v: number): number[] {
    const u = v >>> 0;
    return [(u >>> 16) & 0xffff, u & 0xffff];
}

function encInt32(v: number): number[] {
    // int32 shares the uint32 wire layout on the two's-complement bit pattern.
    return encUint32(v >>> 0);
}

function encFloat32(v: number): number[] {
    const buf = Buffer.allocUnsafe(4);
    buf.writeFloatBE(v, 0);
    return [buf.readUInt16BE(0), buf.readUInt16BE(2)];
}

function encFloat32LE(v: number): number[] {
    // Little-endian WORD order: encode as big-endian float32, then swap the two words
    // so decodeRegisters(..., 'float32le') round-trips.
    const buf = Buffer.allocUnsafe(4);
    buf.writeFloatBE(v, 0);
    return [buf.readUInt16BE(2), buf.readUInt16BE(0)];
}

function encUint32LE(v: number): number[] {
    // Little-endian WORD order: low word first, high word second (inverse of encUint32).
    const u = v >>> 0;
    return [u & 0xffff, (u >>> 16) & 0xffff];
}

function encUint64(v: number): number[] {
    // Split a non-negative JS integer (<= Number.MAX_SAFE_INTEGER) into four
    // big-endian 16-bit words (hi..lo).
    const hi = Math.floor(v / 4294967296);
    const lo = v % 4294967296;
    return [(hi >>> 16) & 0xffff, hi & 0xffff, (lo >>> 16) & 0xffff, lo & 0xffff];
}

function encUint64LE(v: number): number[] {
    // Little-endian WORD order: reverse of encUint64 (words[0] = lowest word).
    return encUint64(v).reverse();
}

function encString(s: string, wordLen: number): number[] {
    const bytes = Buffer.alloc(wordLen * 2, 0);
    for (let i = 0; i < s.length && i < wordLen * 2; i++) {
        bytes[i] = s.charCodeAt(i) & 0xff;
    }
    const words: number[] = [];
    for (let i = 0; i < wordLen; i++) {
        words.push(bytes.readUInt16BE(i * 2));
    }
    return words;
}

const RUNS = { numRuns: 100 };

describe('sunspec-decode', () => {
    // -----------------------------------------------------------------------
    // TASK 3.2 — Property 1: Datatype decode round-trip (big-endian)
    // Validates: Requirements 3.7
    // -----------------------------------------------------------------------
    describe('Feature: solaredge-sunspec-reader, Property 1: Datatype decode round-trip (big-endian)', () => {
        it('Feature: solaredge-sunspec-reader, Property 1: Datatype decode round-trip (big-endian)', () => {
            // int16: exclude sentinel -32768 (0x8000).
            fc.assert(
                fc.property(fc.integer({ min: -32767, max: 32767 }), v => {
                    expect(decodeRegisters(encInt16(v), 'int16')).to.equal(v);
                }),
                RUNS,
            );

            // sunssf is stored as int16; same round-trip.
            fc.assert(
                fc.property(fc.integer({ min: -32767, max: 32767 }), v => {
                    expect(decodeRegisters(encInt16(v), 'sunssf')).to.equal(v);
                }),
                RUNS,
            );

            // uint16: exclude sentinel 0xFFFF.
            fc.assert(
                fc.property(fc.integer({ min: 0, max: 0xfffe }), v => {
                    expect(decodeRegisters(encUint16(v), 'uint16')).to.equal(v);
                }),
                RUNS,
            );

            // int32: exclude sentinel -2147483648 (0x80000000).
            fc.assert(
                fc.property(fc.integer({ min: -2147483647, max: 2147483647 }), v => {
                    expect(decodeRegisters(encInt32(v), 'int32')).to.equal(v);
                }),
                RUNS,
            );

            // uint32 / acc32: exclude sentinel 0xFFFFFFFF.
            fc.assert(
                fc.property(fc.integer({ min: 0, max: 0xfffffffe }), v => {
                    expect(decodeRegisters(encUint32(v), 'uint32')).to.equal(v);
                    expect(decodeRegisters(encUint32(v), 'acc32')).to.equal(v);
                }),
                RUNS,
            );

            // float32: fc.float yields 32-bit floats, so encode->decode is exact.
            fc.assert(
                fc.property(fc.float(), v => {
                    const decoded = decodeRegisters(encFloat32(v), 'float32');
                    if (Number.isNaN(v)) {
                        expect(Number.isNaN(decoded)).to.equal(true);
                    } else {
                        expect(decoded).to.equal(v);
                    }
                }),
                RUNS,
            );

            // float32le: little-endian word order; fc.float is exact after float32 round-trip.
            fc.assert(
                fc.property(fc.float(), v => {
                    const decoded = decodeRegisters(encFloat32LE(v), 'float32le');
                    if (Number.isNaN(v)) {
                        expect(Number.isNaN(decoded)).to.equal(true);
                    } else {
                        expect(decoded).to.equal(v);
                    }
                }),
                RUNS,
            );

            // uint32le: little-endian word order (words[0] = low word); exclude sentinel.
            fc.assert(
                fc.property(fc.integer({ min: 0, max: 0xfffffffe }), v => {
                    expect(decodeRegisters(encUint32LE(v), 'uint32le')).to.equal(v);
                }),
                RUNS,
            );

            // uint32le: concrete real-device battery status words 0x0003 0x0000 => 3 (Charge).
            expect(decodeRegisters([0x0003, 0x0000], 'uint32le')).to.equal(3);

            // uint64: four big-endian words -> JS number, exact up to 2^53.
            fc.assert(
                fc.property(fc.integer({ min: 0, max: 2 ** 31 - 1 }), v => {
                    expect(decodeRegisters(encUint64(v), 'uint64')).to.equal(v);
                }),
                RUNS,
            );

            // uint64: explicit large constants beyond fast-check's default integer range.
            for (const v of [3466757, 2 ** 40, 2 ** 52, Number.MAX_SAFE_INTEGER]) {
                expect(decodeRegisters(encUint64(v), 'uint64'), `uint64 ${v}`).to.equal(v);
            }

            // uint64le: little-endian word order (words[0] = lowest word); exclude sentinel.
            fc.assert(
                fc.property(fc.integer({ min: 0, max: 2 ** 31 - 1 }), v => {
                    expect(decodeRegisters(encUint64LE(v), 'uint64le')).to.equal(v);
                }),
                RUNS,
            );

            // uint64le: concrete real-device battery lifetime-energy words 0x0F97 0 0 0 => 3991 Wh.
            expect(decodeRegisters([0x0f97, 0x0000, 0x0000, 0x0000], 'uint64le')).to.equal(3991);
            for (const v of [3466757, 2 ** 40, 2 ** 52, Number.MAX_SAFE_INTEGER]) {
                expect(decodeRegisters(encUint64LE(v), 'uint64le'), `uint64le ${v}`).to.equal(v);
            }

            // string: ASCII without trailing NUL/space (decoder trims those).
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 8 }).chain(wordLen =>
                        fc
                            .string({
                                unit: fc.integer({ min: 0x21, max: 0x7e }).map(c => String.fromCharCode(c)),
                                minLength: 0,
                                maxLength: wordLen * 2,
                            })
                            .map(s => ({ s, wordLen })),
                    ),
                    ({ s, wordLen }) => {
                        expect(decodeRegisters(encString(s, wordLen), 'string')).to.equal(s);
                    },
                ),
                RUNS,
            );
        });
    });

    // -----------------------------------------------------------------------
    // TASK 3.3 — Property 2: Scale-factor application and domain
    // Validates: Requirements 3.6, 3.10
    // -----------------------------------------------------------------------
    describe('Feature: solaredge-sunspec-reader, Property 2: Scale-factor application and domain', () => {
        it('Feature: solaredge-sunspec-reader, Property 2: Scale-factor application and domain', () => {
            // In-domain scale factors: engineering value = raw * 10^sf.
            fc.assert(
                fc.property(
                    fc.integer({ min: -1000000, max: 1000000 }),
                    fc.integer({ min: -10, max: 10 }),
                    (raw, sf) => {
                        expect(applyScaleFactor(raw, sf)).to.equal(raw * Math.pow(10, sf));
                    },
                ),
                RUNS,
            );

            // Out-of-range integer scale factors must throw (Req 3.10).
            fc.assert(
                fc.property(
                    fc.integer({ min: -1000000, max: 1000000 }),
                    fc.oneof(fc.integer({ min: -1000, max: -11 }), fc.integer({ min: 11, max: 1000 })),
                    (raw, sf) => {
                        expect(() => applyScaleFactor(raw, sf)).to.throw();
                    },
                ),
                RUNS,
            );

            // Non-integer scale factors must throw regardless of magnitude (Req 3.10).
            fc.assert(
                fc.property(
                    fc.integer({ min: -1000000, max: 1000000 }),
                    fc.double({ min: -10, max: 10, noNaN: true }).filter(sf => !Number.isInteger(sf)),
                    (raw, sf) => {
                        expect(() => applyScaleFactor(raw, sf)).to.throw();
                    },
                ),
                RUNS,
            );
        });
    });

    // -----------------------------------------------------------------------
    // TASK 3.4 — Property 3: NOT_IMPLEMENTED sentinels decode to null
    // Validates: Requirements 3.8
    // -----------------------------------------------------------------------
    describe('Feature: solaredge-sunspec-reader, Property 3: NOT_IMPLEMENTED sentinels decode to null', () => {
        it('Feature: solaredge-sunspec-reader, Property 3: NOT_IMPLEMENTED sentinels decode to null', () => {
            // Explicit sentinel words per datatype.
            const sentinels: { words: number[]; datatype: SunSpecDatatype }[] = [
                { words: [0x8000], datatype: 'int16' },
                { words: [0x8000], datatype: 'sunssf' },
                { words: [0xffff], datatype: 'uint16' },
                { words: [0x8000, 0x0000], datatype: 'int32' },
                { words: [0xffff, 0xffff], datatype: 'uint32' },
                { words: [0xffff, 0xffff], datatype: 'acc32' },
                { words: [0xffff, 0xffff], datatype: 'uint32le' },
                { words: [0xffff, 0xffff, 0xffff, 0xffff], datatype: 'uint64' },
                { words: [0xffff, 0xffff, 0xffff, 0xffff], datatype: 'uint64le' },
            ];

            for (const { words, datatype } of sentinels) {
                expect(isNotImplemented(words, datatype), `isNotImplemented ${datatype}`).to.equal(true);
                expect(decodeRegisters(words, datatype), `decode ${datatype}`).to.equal(null);
            }

            // Non-sentinel int16 values decode to non-null.
            fc.assert(
                fc.property(fc.integer({ min: -32767, max: 32767 }), v => {
                    expect(isNotImplemented(encInt16(v), 'int16')).to.equal(false);
                    expect(decodeRegisters(encInt16(v), 'int16')).to.not.equal(null);
                }),
                RUNS,
            );

            // Non-sentinel uint16 values decode to non-null.
            fc.assert(
                fc.property(fc.integer({ min: 0, max: 0xfffe }), v => {
                    expect(isNotImplemented(encUint16(v), 'uint16')).to.equal(false);
                    expect(decodeRegisters(encUint16(v), 'uint16')).to.not.equal(null);
                }),
                RUNS,
            );

            // Non-sentinel int32 values decode to non-null.
            fc.assert(
                fc.property(fc.integer({ min: -2147483647, max: 2147483647 }), v => {
                    expect(isNotImplemented(encInt32(v), 'int32')).to.equal(false);
                    expect(decodeRegisters(encInt32(v), 'int32')).to.not.equal(null);
                }),
                RUNS,
            );

            // Non-sentinel uint32/acc32 values decode to non-null.
            fc.assert(
                fc.property(fc.integer({ min: 0, max: 0xfffffffe }), v => {
                    expect(isNotImplemented(encUint32(v), 'uint32')).to.equal(false);
                    expect(decodeRegisters(encUint32(v), 'uint32')).to.not.equal(null);
                    expect(isNotImplemented(encUint32(v), 'acc32')).to.equal(false);
                    expect(decodeRegisters(encUint32(v), 'acc32')).to.not.equal(null);
                }),
                RUNS,
            );

            // Non-sentinel uint64 values decode to a non-null number.
            fc.assert(
                fc.property(fc.integer({ min: 0, max: 2 ** 31 - 1 }), v => {
                    expect(isNotImplemented(encUint64(v), 'uint64')).to.equal(false);
                    const decoded = decodeRegisters(encUint64(v), 'uint64');
                    expect(decoded).to.not.equal(null);
                    expect(typeof decoded).to.equal('number');
                }),
                RUNS,
            );
        });
    });
});
