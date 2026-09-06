// Read-only Modbus TCP client wrapper for the SolarEdge SunSpec reader.
//
// This is a thin wrapper over the `modbus-serial` library that deliberately
// exposes ONLY read operations: FC03 (read holding registers) and FC04 (read
// input registers). No Modbus write function code is exposed or ever issued,
// upholding the strictly read-only invariant of this adapter (design Property 4).
//
// Each network operation is bounded by a 10 second default timeout:
//  - `connect` races the TCP connect against a rejecting timeout and also passes
//    the timeout to the library and applies it via `setTimeout` for subsequent reads.
//  - `readHoldingRegisters` / `readInputRegisters` rely on the library's request
//    timeout (set via `setTimeout`) and additionally race a rejecting timeout so a
//    hung read cannot exceed the deadline.
//  - `close` resolves within 10 seconds even if the underlying close callback stalls.
//
// Validates: Requirements 3.1, 3.2, 3.5, 7.4, 7.6

import ModbusRTU from 'modbus-serial';

/** Default timeout in milliseconds applied to connect and read operations (Req 3.5, 7.4). */
export const DEFAULT_TIMEOUT_MS = 10000;

/** Maximum number of registers a single Modbus read request may cover (Req 3.2). */
export const MAX_REGISTERS_PER_READ = 125;

export interface ModbusReadOptions {
    /** Overall timeout for the operation in ms; defaults to {@link DEFAULT_TIMEOUT_MS} (Req 3.5). */
    timeoutMs?: number;
}

/**
 * READ-ONLY Modbus client. There is deliberately NO write method (Req 3.1).
 *
 * Implementations issue only FC03 (holding registers) and FC04 (input registers).
 */
export interface IModbusClient {
    /** Open a TCP connection with a connect timeout (default 10s) (Req 7.4). */
    connect(host: string, port: number, unitId: number, timeoutMs?: number): Promise<void>;
    /** FC03 read; max 125 registers enforced (Req 3.2). */
    readHoldingRegisters(address: number, length: number, opts?: ModbusReadOptions): Promise<number[]>;
    /** FC04 read; max 125 registers enforced (Req 3.2). */
    readInputRegisters(address: number, length: number, opts?: ModbusReadOptions): Promise<number[]>;
    /** Whether a socket is currently open. */
    isConnected(): boolean;
    /** Close the socket; resolves within 10s and is a no-op when not connected (Req 7.6). */
    close(): Promise<void>;
}

/**
 * Reject with the given error after `ms` milliseconds. The returned object carries
 * the timer handle so it can be cleared once the raced operation settles, preventing
 * a dangling timer from keeping the process alive.
 *
 * @param ms
 * @param message
 */
function rejectAfter(ms: number, message: string): { promise: Promise<never>; cancel: () => void } {
    let handle: ReturnType<typeof setTimeout>;
    const promise = new Promise<never>((_resolve, reject) => {
        handle = setTimeout(() => reject(new Error(message)), ms);
    });
    return { promise, cancel: () => clearTimeout(handle) };
}

/**
 * Read-only Modbus TCP client backed by `modbus-serial`.
 *
 * Holds a single `ModbusRTU` instance internally. Only read function codes are ever
 * issued; the class exposes no write surface (Req 3.1).
 */
export class ModbusClient implements IModbusClient {
    private readonly client: ModbusRTU;
    /** Our own connected flag, combined with the library's `isOpen` in {@link isConnected}. */
    private connected = false;

    constructor() {
        this.client = new ModbusRTU();
    }

    /**
     * Open a TCP connection to the inverter and select the Modbus unit id.
     *
     * The connect attempt is bounded by `timeoutMs` (default 10s, Req 7.4): the
     * library connect timeout is set via the TCP options and the whole attempt is
     * additionally raced against a rejecting timeout. The same timeout is applied
     * via `setTimeout` so subsequent read requests inherit the deadline (Req 3.5).
     *
     * @param host
     * @param port
     * @param unitId
     * @param timeoutMs
     */
    async connect(host: string, port: number, unitId: number, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<void> {
        const timeout = rejectAfter(timeoutMs, `Modbus connect to ${host}:${port} timed out after ${timeoutMs} ms`);
        try {
            await Promise.race([this.client.connectTCP(host, { port, timeout: timeoutMs }), timeout.promise]);
            this.client.setID(unitId);
            this.client.setTimeout(timeoutMs);
            this.connected = true;
        } catch (err) {
            this.connected = false;
            // Best-effort cleanup of a partially-opened socket; ignore close errors.
            try {
                await this.close();
            } catch {
                /* ignore */
            }
            throw new Error(`Failed to connect to ${host}:${port} (unit ${unitId}): ${describeError(err)}`);
        } finally {
            timeout.cancel();
        }
    }

    /**
     * FC03 — read holding registers.
     *
     * @param address
     * @param length
     * @param opts
     */
    async readHoldingRegisters(address: number, length: number, opts?: ModbusReadOptions): Promise<number[]> {
        return this.read('readHoldingRegisters', address, length, opts);
    }

    /**
     * FC04 — read input registers.
     *
     * @param address
     * @param length
     * @param opts
     */
    async readInputRegisters(address: number, length: number, opts?: ModbusReadOptions): Promise<number[]> {
        return this.read('readInputRegisters', address, length, opts);
    }

    isConnected(): boolean {
        return this.connected && this.client.isOpen;
    }

    /**
     * Close the socket. Safe to call when not connected (no-op). Resolves within
     * `DEFAULT_TIMEOUT_MS` even if the underlying close callback never fires (Req 7.6).
     */
    async close(): Promise<void> {
        this.connected = false;
        if (!this.client.isOpen) {
            return;
        }
        await new Promise<void>(resolve => {
            const handle = setTimeout(resolve, DEFAULT_TIMEOUT_MS);
            try {
                this.client.close(() => {
                    clearTimeout(handle);
                    resolve();
                });
            } catch {
                clearTimeout(handle);
                resolve();
            }
        });
    }

    /**
     * Shared implementation for the two read function codes. Guards the register
     * count (Req 3.2), enforces the per-request timeout (Req 3.5), requires an open
     * connection, and returns the numeric register data. Rejects with a descriptive
     * Error rather than throwing synchronously.
     *
     * @param fn
     * @param address
     * @param length
     * @param opts
     */
    private async read(
        fn: 'readHoldingRegisters' | 'readInputRegisters',
        address: number,
        length: number,
        opts?: ModbusReadOptions,
    ): Promise<number[]> {
        const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

        if (!Number.isInteger(length) || length < 1) {
            throw new Error(`Invalid register length ${length}: must be a positive integer`);
        }
        if (length > MAX_REGISTERS_PER_READ) {
            throw new Error(`Cannot read ${length} registers in one request: maximum is ${MAX_REGISTERS_PER_READ}`);
        }
        if (!this.isConnected()) {
            throw new Error('Modbus client is not connected');
        }

        // Apply the per-request timeout to the underlying client, then race against a
        // rejecting timeout so a hung read cannot exceed the deadline (Req 3.5).
        this.client.setTimeout(timeoutMs);
        const timeout = rejectAfter(timeoutMs, `Modbus ${fn} at ${address}+${length} timed out after ${timeoutMs} ms`);
        try {
            const result = await Promise.race([this.client[fn](address, length), timeout.promise]);
            return result.data;
        } catch (err) {
            throw new Error(`Modbus ${fn} at address ${address} (length ${length}) failed: ${describeError(err)}`);
        } finally {
            timeout.cancel();
        }
    }
}

/**
 * Extract a readable message from an unknown thrown value.
 *
 * @param err
 */
function describeError(err: unknown): string {
    if (err instanceof Error) {
        return err.message;
    }
    return String(err);
}
