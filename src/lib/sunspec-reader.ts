// SunSpec reader: model detection, block reading, decoding, and scale resolution.
//
// This module ties the pure decoders (`sunspec-decode`) and the static register
// map (`sunspec-map`) to the read-only Modbus client (`modbus-client`). It:
//   1. Detects which SunSpec inverter model (101/102/103) and meter model
//      (201/202/203/204) the device exposes by reading the model-identifier
//      register at each block header (Req 3.3, 3.4, 3.9).
//   2. Reads the detected block over Modbus in chunks of at most 125 registers
//      (MAX_REGISTERS_PER_READ), covering the block's register span exactly once
//      with no gaps or overlaps (Req 3.2, design Property 8).
//   3. Decodes every register per its SunSpec datatype (Req 3.7), treats
//      NOT_IMPLEMENTED sentinels as unavailable (Req 3.8), and resolves scale
//      factors from the sunssf registers read in the same block (Req 3.6).
//   4. Skips values whose scale factor is missing or out of range [-10, 10],
//      logging a warning naming the affected value (Req 3.10), and logs a warning
//      when a required model block is absent (Req 3.9).
//
// The reader issues only read requests via IModbusClient, which exposes no write
// surface, preserving the strictly read-only invariant (Req 3.1).
//
// Requirements: 3.2, 3.3, 3.4, 3.6, 3.8, 3.9, 3.10

import type { IModbusClient } from './modbus-client';
import { MAX_REGISTERS_PER_READ } from './modbus-client';
import { decodeRegisters, applyScaleFactor } from './sunspec-decode';
import type { SunSpecRegisterDef } from './sunspec-map';
import { SUNSPEC_MAP, INVERTER_BASE, METER_BASE, getInverterValueDefs, getMeterValueDefs } from './sunspec-map';

/** SunSpec inverter model identifiers: 101 single / 102 split / 103 three phase. */
export type InverterModelId = 101 | 102 | 103;
/** SunSpec meter model identifiers: 201 / 202 / 203 / 204. */
export type MeterModelId = 201 | 202 | 203 | 204;

/** A decoded, scale-resolved value together with its register definition. */
export interface DecodedValue {
    def: SunSpecRegisterDef;
    /** Engineering value, or `null` when unavailable (NOT_IMPLEMENTED / skipped). */
    value: number | string | null;
}

/**
 * Minimal logger surface used to report recoverable anomalies (missing block,
 * missing/out-of-range scale factor). Both methods are optional at the call site
 * because the reader defaults to a no-op logger when none is supplied.
 */
export interface Logger {
    warn(msg: string): void;
    debug(msg: string): void;
}

/** No-op logger used when the caller does not provide one. */
const NOOP_LOGGER: Logger = {
    warn: () => {
        /* no-op */
    },
    debug: () => {
        /* no-op */
    },
};

/**
 * Base-0 Modbus address of the meter block's `C_SunSpec_DID` register, which holds
 * the meter model id (201/202/203/204).
 *
 * Per the SolarEdge SunSpec implementation technical note (Meter 1 map), the meter
 * block is laid out as: Meter Common Block at 40121, then the meter Identification
 * header, with `C_SunSpec_DID` (the "well-known value" that uniquely identifies the
 * meter connection type / model) at base-0 register 40188. The four documented
 * values are 201 (single phase AN/AB), 202 (split single phase ABN), 203 (wye
 * three phase ABCN) and 204 (delta three phase ABC). Expressed relative to
 * {@link METER_BASE} (40121) this is offset 67 (40188 - 40121).
 */
export const METER_DID_ADDRESS = METER_BASE + 67; // 40188 (base-0)

export interface ISunSpecReader {
    /** Read model id at inverter base and return 101/102/103, or null if absent (Req 3.3, 3.9). */
    detectInverterModel(client: IModbusClient): Promise<InverterModelId | null>;
    /** Read the meter DID register and return 201..204, or null if absent (Req 3.4, 3.9). */
    detectMeterModel(client: IModbusClient): Promise<MeterModelId | null>;
    /** Read + decode the detected inverter block (Req 3.2, 3.6, 3.7, 3.8). */
    readInverter(client: IModbusClient, model: InverterModelId): Promise<DecodedValue[]>;
    /** Read + decode the detected meter block (Req 3.2, 3.6, 3.7, 3.8). */
    readMeter(client: IModbusClient, model: MeterModelId): Promise<DecodedValue[]>;
}

/** Set of valid inverter model ids for detection. */
const INVERTER_MODEL_IDS: ReadonlySet<number> = new Set<number>([101, 102, 103]);
/** Set of valid meter model ids for detection. */
const METER_MODEL_IDS: ReadonlySet<number> = new Set<number>([201, 202, 203, 204]);

/**
 * Plan a sequence of Modbus read requests that together cover exactly the register
 * span `[startAddr, startAddr + totalLen)`, splitting it into chunks of at most
 * `maxPerRead` (default {@link MAX_REGISTERS_PER_READ} = 125) registers.
 *
 * The emitted requests are contiguous and non-overlapping: request i+1 starts where
 * request i ends, so decoding the concatenated words reconstructs the whole block
 * exactly once (Req 3.2, design Property 8). A `totalLen` of 0 yields no requests.
 *
 * Pure function so it can be property-tested in isolation.
 *
 * @param startAddr
 * @param totalLen
 * @param maxPerRead
 */
export function planReadChunks(
    startAddr: number,
    totalLen: number,
    maxPerRead: number = MAX_REGISTERS_PER_READ,
): Array<{ address: number; length: number }> {
    const chunks: Array<{ address: number; length: number }> = [];
    let remaining = totalLen;
    let address = startAddr;
    while (remaining > 0) {
        const length = Math.min(remaining, maxPerRead);
        chunks.push({ address, length });
        address += length;
        remaining -= length;
    }
    return chunks;
}

/**
 * Read-only SunSpec reader. Holds no per-device state; each call receives the
 * connected {@link IModbusClient} to operate on.
 */
export class SunSpecReader implements ISunSpecReader {
    private readonly log: Logger;

    constructor(log: Logger = NOOP_LOGGER) {
        this.log = log;
    }

    /**
     * Read the inverter model id at {@link INVERTER_BASE} (base-0 register 40069)
     * and return it when it is 101/102/103. Any other value (including the block
     * being absent, which typically decodes to a sentinel or an unexpected id)
     * yields `null` and a warning (Req 3.3, 3.9).
     *
     * @param client
     */
    async detectInverterModel(client: IModbusClient): Promise<InverterModelId | null> {
        const [raw] = await client.readHoldingRegisters(INVERTER_BASE, 1);
        if (INVERTER_MODEL_IDS.has(raw)) {
            this.log.debug(`Detected inverter model ${raw} at register ${INVERTER_BASE}`);
            return raw as InverterModelId;
        }
        this.log.warn(`No SunSpec inverter block detected: register ${INVERTER_BASE} = ${raw} (expected 101/102/103)`);
        return null;
    }

    /**
     * Read the meter model id (`C_SunSpec_DID`) at {@link METER_DID_ADDRESS}
     * (base-0 register 40188) and return it when it is 201/202/203/204. Any other
     * value yields `null` and a warning (Req 3.4, 3.9).
     *
     * @param client
     */
    async detectMeterModel(client: IModbusClient): Promise<MeterModelId | null> {
        const [raw] = await client.readHoldingRegisters(METER_DID_ADDRESS, 1);
        if (METER_MODEL_IDS.has(raw)) {
            this.log.debug(`Detected meter model ${raw} at register ${METER_DID_ADDRESS}`);
            return raw as MeterModelId;
        }
        this.log.warn(
            `No SunSpec meter block detected: register ${METER_DID_ADDRESS} = ${raw} (expected 201/202/203/204)`,
        );
        return null;
    }

    /**
     * Read and decode the inverter block for the detected `model`. Reads the whole
     * inverter register span (measurement rows and their sunssf scale rows) in
     * chunks of at most 125 registers, decodes each value, resolves scale factors,
     * and returns one {@link DecodedValue} per inverter measurement value
     * (Req 3.2, 3.6, 3.7, 3.8, 3.10).
     *
     * @param client
     * @param model
     */
    async readInverter(client: IModbusClient, model: InverterModelId): Promise<DecodedValue[]> {
        // The map stores a single inverter layout tagged with canonical model 101.
        const blockDefs = SUNSPEC_MAP.filter(d => d.model === 101);
        const valueDefs = getInverterValueDefs();
        return this.readBlock(client, INVERTER_BASE, blockDefs, valueDefs, `inverter (model ${model})`);
    }

    /**
     * Read and decode the meter block for the detected `model`. Same algorithm as
     * {@link readInverter} over the meter layout (rows tagged canonical model 201),
     * returning one {@link DecodedValue} per meter measurement value
     * (Req 3.2, 3.4, 3.6, 3.7, 3.8, 3.10).
     *
     * @param client
     * @param model
     */
    async readMeter(client: IModbusClient, model: MeterModelId): Promise<DecodedValue[]> {
        const blockDefs = SUNSPEC_MAP.filter(d => d.model === 201);
        const valueDefs = getMeterValueDefs();
        return this.readBlock(client, METER_BASE, blockDefs, valueDefs, `meter (model ${model})`);
    }

    /**
     * Shared block read/decode pipeline.
     *
     * @param client    connected read-only Modbus client
     * @param base      base-0 register address of the block (offsets are relative to it)
     * @param blockDefs ALL defs in the block (measurement rows AND sunssf scale rows) —
     *                  scale rows are needed to resolve scale factors
     * @param valueDefs the measurement value defs to emit as {@link DecodedValue}[]
     * @param label     human-readable block label for log messages
     */
    private async readBlock(
        client: IModbusClient,
        base: number,
        blockDefs: SunSpecRegisterDef[],
        valueDefs: SunSpecRegisterDef[],
        label: string,
    ): Promise<DecodedValue[]> {
        // Determine the contiguous span [minOffset, maxOffset+len) that covers every
        // def in the block, so a single chunked sweep reads all of them.
        let minOffset = Infinity;
        let maxEnd = 0;
        for (const def of blockDefs) {
            if (def.offset < minOffset) {
                minOffset = def.offset;
            }
            if (def.offset + def.length > maxEnd) {
                maxEnd = def.offset + def.length;
            }
        }
        const spanLen = maxEnd - minOffset;

        // Read the span in <=125-register chunks and assemble into a single word
        // array indexed by (offset - minOffset).
        const startAddr = base + minOffset;
        const words: number[] = new Array<number>(spanLen);
        const chunks = planReadChunks(startAddr, spanLen);
        for (const chunk of chunks) {
            const data = await client.readHoldingRegisters(chunk.address, chunk.length);
            const writeStart = chunk.address - startAddr;
            for (let i = 0; i < data.length; i++) {
                words[writeStart + i] = data[i];
            }
        }
        this.log.debug(`Read ${label} block: ${spanLen} registers from ${startAddr} in ${chunks.length} chunk(s)`);

        /**
         * Slice the assembled words for a def by its offset relative to the block base.
         *
         * @param def
         */
        const wordsFor = (def: SunSpecRegisterDef): number[] => {
            const start = def.offset - minOffset;
            return words.slice(start, start + def.length);
        };

        // Decode the sunssf scale registers first: build name -> integer SF value.
        // A scale register that decodes to null (its own sentinel) is recorded as
        // null so dependent values are skipped (Req 3.10).
        const scaleValues = new Map<string, number | null>();
        for (const def of blockDefs) {
            if (def.datatype === 'sunssf') {
                const decoded = decodeRegisters(wordsFor(def), def.datatype);
                scaleValues.set(def.name, typeof decoded === 'number' ? decoded : null);
            }
        }

        // Decode each measurement value and resolve its scale factor.
        const results: DecodedValue[] = [];
        for (const def of valueDefs) {
            const raw = decodeRegisters(wordsFor(def), def.datatype);

            // NOT_IMPLEMENTED sentinel: value unavailable this cycle (Req 3.8).
            if (raw === null) {
                results.push({ def, value: null });
                continue;
            }

            // No scale factor (e.g. status): use the raw decoded value directly.
            if (!def.scaleFactorRef) {
                results.push({ def, value: raw });
                continue;
            }

            // Scale factor required: it must be present, numeric, and in range.
            const sf = scaleValues.get(def.scaleFactorRef);
            if (sf === undefined || sf === null) {
                this.log.warn(
                    `Skipping ${label} value "${def.name}": scale factor "${def.scaleFactorRef}" is missing or unavailable`,
                );
                results.push({ def, value: null });
                continue;
            }

            // raw is numeric here because scaleFactorRef only applies to numeric datatypes.
            try {
                const scaled = applyScaleFactor(raw as number, sf);
                results.push({ def, value: scaled });
            } catch {
                this.log.warn(`Skipping ${label} value "${def.name}": scale factor ${sf} is out of range [-10, 10]`);
                results.push({ def, value: null });
            }
        }

        return results;
    }
}
