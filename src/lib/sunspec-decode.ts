// SunSpec register decoding (pure functions).
//
// Registers are 16-bit unsigned words (0..65535) in BIG-ENDIAN order. Multi-word
// values (int32/uint32/acc32/float32) occupy two words, most-significant word first.
// See design.md "Decode Functions" and "NOT_IMPLEMENTED Handling" (Req 3.6, 3.7, 3.8, 3.10).

/** SunSpec/Modbus datatype of a register value (Req 3.7). */
export type SunSpecDatatype =
    | 'int16'
    | 'uint16'
    | 'int32'
    | 'uint32'
    | 'acc32'
    | 'float32'
    | 'float32le' // IEEE-754 float32 with little-endian WORD order (two 16-bit words swapped)
    | 'uint32le' // unsigned 32-bit with little-endian WORD order (words[0] = low word)
    | 'uint64' // four words hi..lo, big-endian word order, returned as JS number (exact to 2^53)
    | 'uint64le' // four words with little-endian WORD order (words[0] = lowest word)
    | 'sunssf' // scale factor, stored as int16
    | 'string';

/** NOT_IMPLEMENTED sentinel for single-word signed datatypes (int16 / sunssf). */
const SENTINEL_INT16 = 0x8000;
/** NOT_IMPLEMENTED sentinel for single-word unsigned datatypes (uint16). */
const SENTINEL_UINT16 = 0xffff;
/** NOT_IMPLEMENTED sentinel for two-word signed datatype (int32). */
const SENTINEL_INT32 = 0x80000000;
/** NOT_IMPLEMENTED sentinel for two-word unsigned datatypes (uint32 / acc32). */
const SENTINEL_UINT32 = 0xffffffff;

/**
 * Combine two big-endian 16-bit words (hi first) into an unsigned 32-bit value.
 *
 * @param hi
 * @param lo
 */
function toUint32(hi: number, lo: number): number {
    // `>>> 0` forces the result into the unsigned 32-bit range.
    return (((hi & 0xffff) << 16) | (lo & 0xffff)) >>> 0;
}

/**
 * Interpret an unsigned 16-bit value as two's-complement signed int16.
 *
 * @param u
 */
function asInt16(u: number): number {
    const v = u & 0xffff;
    return v >= 0x8000 ? v - 0x10000 : v;
}

/**
 * Interpret an unsigned 32-bit value as two's-complement signed int32.
 *
 * @param u
 */
function asInt32(u: number): number {
    // `| 0` reinterprets the low 32 bits as signed.
    return u | 0;
}

/**
 * True when the raw words equal the NOT_IMPLEMENTED sentinel for the datatype (Req 3.8).
 *
 * `string` has no numeric sentinel and therefore never reports NOT_IMPLEMENTED.
 *
 * @param words
 * @param datatype
 */
export function isNotImplemented(words: readonly number[], datatype: SunSpecDatatype): boolean {
    switch (datatype) {
        case 'int16':
        case 'sunssf':
            return (words[0] & 0xffff) === SENTINEL_INT16;
        case 'uint16':
            return (words[0] & 0xffff) === SENTINEL_UINT16;
        case 'int32':
            return toUint32(words[0], words[1]) === SENTINEL_INT32;
        case 'uint32':
        case 'acc32':
            return toUint32(words[0], words[1]) === SENTINEL_UINT32;
        case 'uint32le':
            // Same all-ones sentinel; word order does not affect the check.
            return toUint32(words[0], words[1]) === SENTINEL_UINT32;
        case 'uint64':
        case 'uint64le':
            // All-ones sentinel 0xFFFFFFFFFFFFFFFF: every one of the four words is 0xFFFF.
            // Word order does not affect this check.
            return (
                (words[0] & 0xffff) === 0xffff &&
                (words[1] & 0xffff) === 0xffff &&
                (words[2] & 0xffff) === 0xffff &&
                (words[3] & 0xffff) === 0xffff
            );
        case 'float32':
        case 'float32le':
        case 'string':
            return false;
        default:
            return false;
    }
}

/**
 * Decode raw big-endian registers into a typed primitive.
 *
 * Returns `null` when the raw value equals the NOT_IMPLEMENTED sentinel for the
 * datatype (Req 3.8). For `string`, an all-zero / empty field decodes to the empty
 * string, never `null`.
 *
 * @param words
 * @param datatype
 */
export function decodeRegisters(words: readonly number[], datatype: SunSpecDatatype): number | string | null {
    if (isNotImplemented(words, datatype)) {
        return null;
    }

    switch (datatype) {
        case 'int16':
        case 'sunssf':
            return asInt16(words[0]);
        case 'uint16':
            return words[0] & 0xffff;
        case 'int32':
            return asInt32(toUint32(words[0], words[1]));
        case 'uint32':
        case 'acc32':
            return toUint32(words[0], words[1]);
        case 'uint32le':
            // Little-endian WORD order: words[0] is the low word, words[1] the high word.
            return toUint32(words[1], words[0]);
        case 'float32': {
            const buf = Buffer.allocUnsafe(4);
            buf.writeUInt16BE(words[0] & 0xffff, 0);
            buf.writeUInt16BE(words[1] & 0xffff, 2);
            return buf.readFloatBE(0);
        }
        case 'float32le': {
            // Little-endian WORD order: bytes within each 16-bit word stay big-endian,
            // but the two words are swapped (words[0] is the low word). Equivalent to
            // pymodbus wordorder=LITTLE, byteorder=BIG.
            const buf = Buffer.allocUnsafe(4);
            buf.writeUInt16BE(words[1] & 0xffff, 0);
            buf.writeUInt16BE(words[0] & 0xffff, 2);
            return buf.readFloatBE(0);
        }
        case 'uint64': {
            // Four big-endian words (hi..lo) combined as a JS number. Exact up to 2^53.
            const hi = toUint32(words[0], words[1]);
            const lo = toUint32(words[2], words[3]);
            return hi * 4294967296 + lo;
        }
        case 'uint64le': {
            // Little-endian WORD order: words[0] is the lowest 16-bit word, words[3] the
            // highest. Bytes within each word stay big-endian (pymodbus wordorder=LITTLE,
            // byteorder=BIG). Combined as a JS number, exact up to 2^53.
            const hi = toUint32(words[3], words[2]);
            const lo = toUint32(words[1], words[0]);
            return hi * 4294967296 + lo;
        }
        case 'string':
            return decodeString(words);
        default:
            return null;
    }
}

/**
 * Decode packed big-endian byte pairs into an ASCII/latin1 string, trimming trailing
 * NUL and space padding (Req 3.7).
 *
 * @param words
 */
function decodeString(words: readonly number[]): string {
    const buf = Buffer.allocUnsafe(words.length * 2);
    for (let i = 0; i < words.length; i++) {
        buf.writeUInt16BE(words[i] & 0xffff, i * 2);
    }
    // Strip trailing NUL and space padding used by SunSpec fixed-width strings.
    let end = buf.length;
    while (end > 0 && (buf[end - 1] === 0x00 || buf[end - 1] === 0x20)) {
        end--;
    }
    return buf.toString('latin1', 0, end);
}

/**
 * Apply a SunSpec scale factor: engineering value = raw * 10^sf (Req 3.6).
 *
 * Throws when `sf` is not an integer in `[-10, 10]` so callers can skip the value
 * and log a warning (Req 3.10).
 *
 * @param raw
 * @param sf
 */
export function applyScaleFactor(raw: number, sf: number): number {
    if (!Number.isInteger(sf) || sf < -10 || sf > 10) {
        throw new Error(`Scale factor ${sf} is out of range [-10, 10]`);
    }
    return raw * Math.pow(10, sf);
}
