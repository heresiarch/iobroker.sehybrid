/*
 * Created with @iobroker/create-adapter v3.1.5
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
import * as utils from '@iobroker/adapter-core';

import { validateConfig } from './lib/config-validation';
import { DEFAULT_TIMEOUT_MS, ModbusClient } from './lib/modbus-client';
import { StateManager } from './lib/state-manager';
import { decodeRegisters } from './lib/sunspec-decode';
import { COMMON_BASE } from './lib/sunspec-map';
import { SunSpecReader, type Logger } from './lib/sunspec-reader';

/**
 * Number of consecutive recoverable polling failures after which the adapter logs a
 * dedicated repeated-failure error (Req 8.5).
 */
const MAX_CONSECUTIVE_FAILURES = 10;

/**
 * SolarEdge SunSpec reader adapter.
 *
 * Read-only Modbus TCP monitor: on start it validates the configuration, ensures the
 * `info.connection` indicator and the `inverter`/`meter` channels exist, then polls
 * the inverter and meter SunSpec blocks on the configured interval. The adapter never
 * issues Modbus write function codes and never subscribes to state changes — it only
 * writes acknowledged values it read from the device.
 */
class Sehybrid extends utils.Adapter {
    /** Reused Modbus client; reconnected by {@link pollOnce} after a failed cycle. */
    private modbusClient?: ModbusClient;
    /** Object/state manager for the inverter/meter channels. */
    private stateManager?: StateManager;
    /** SunSpec model detection + block decoding. */
    private reader?: SunSpecReader;
    /** Repeating poll timer handle, cleared on unload. */
    private pollTimer?: ioBroker.Interval;
    /** Count of consecutive failed polling cycles; reset to 0 on any success (Req 8.5). */
    private consecutiveFailures = 0;
    /** Overlap guard: true while a polling cycle is in flight (Req 5.5). */
    private polling = false;

    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({
            ...options,
            name: 'sehybrid',
        });
        this.on('ready', this.onReady.bind(this));
        this.on('message', this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    /**
     * Called when databases are connected and the adapter received its configuration.
     *
     * Sets the connection indicator to false, validates the config (guarding on a
     * missing host, Req 8.4), constructs the Modbus client / reader / state manager,
     * ensures the channels, then runs the first poll and schedules the repeating timer
     * (Req 5.4, 7.1, 8.3).
     */
    private async onReady(): Promise<void> {
        // Ensure the connection indicator object exists (it is declared in
        // instanceObjects, but be defensive), then set it false before the first read (Req 7.1).
        await this.setObjectNotExistsAsync('info.connection', {
            type: 'state',
            common: {
                name: 'Device or service connected',
                type: 'boolean',
                role: 'indicator.connected',
                read: true,
                write: false,
                def: false,
            },
            native: {},
        });
        await this.setStateAsync('info.connection', false, true);

        // Validate the persisted configuration.
        const result = validateConfig(this.config);
        if (!result.valid) {
            // A missing/empty host is a hard configuration error: do not start polling (Req 8.4).
            if (result.errors.host) {
                this.log.error(
                    `Invalid host configuration: ${result.errors.host}. Set the inverter host in the adapter settings. Polling will not start.`,
                );
                await this.setStateAsync('info.connection', false, true);
                return;
            }
            // Any other invalid field: log and do not start polling either.
            const messages = Object.entries(result.errors)
                .map(([field, msg]) => `${field}: ${msg}`)
                .join('; ');
            this.log.error(`Invalid configuration, polling will not start: ${messages}`);
            await this.setStateAsync('info.connection', false, true);
            return;
        }

        // Build the runtime collaborators.
        const logger: Logger = {
            warn: (msg: string) => this.log.warn(msg),
            debug: (msg: string) => this.log.debug(msg),
        };
        this.reader = new SunSpecReader(logger);
        this.stateManager = new StateManager(this);
        this.modbusClient = new ModbusClient();

        // Group states into the two channels up front (idempotent) (Req 6.9).
        await this.stateManager.ensureChannel('inverter');
        await this.stateManager.ensureChannel('meter');

        this.log.info(
            `Starting SunSpec polling of ${this.config.host}:${this.config.port} (unit ${this.config.unitId}) every ${this.config.pollInterval}s`,
        );

        // Run one cycle immediately, then schedule the repeating timer (Req 5.4).
        await this.pollOnce();
        this.pollTimer = this.setInterval(() => {
            void this.pollOnce();
        }, this.config.pollInterval * 1000);
    }

    /**
     * Run one polling cycle: (re)connect if needed, detect + read the inverter and
     * meter blocks, and write acknowledged values. Sets `info.connection` true on a
     * successful cycle and false on any thrown error, retaining the last values on
     * failure (Req 3.3, 3.4, 5.4, 5.6, 6.8, 7.2, 7.3, 7.5, 8.2, 8.3, 8.5).
     */
    private async pollOnce(): Promise<void> {
        // Overlap guard: if the previous cycle is still running, skip this tick (Req 5.5).
        if (this.polling) {
            this.log.debug('Previous polling cycle still running; skipping this tick');
            return;
        }
        if (!this.modbusClient || !this.reader || !this.stateManager) {
            // Should not happen once onReady succeeded, but stay defensive.
            return;
        }
        this.polling = true;

        const client = this.modbusClient;
        const reader = this.reader;
        const stateManager = this.stateManager;

        try {
            // Ensure a live connection; reconnect after a prior failure (Req 7.4).
            if (!client.isConnected()) {
                this.log.debug(`Connecting to ${this.config.host}:${this.config.port} (unit ${this.config.unitId})`);
                await client.connect(this.config.host, this.config.port, this.config.unitId, DEFAULT_TIMEOUT_MS);
            }

            // --- Inverter block (Req 3.3) -------------------------------------------
            const inverterModel = await reader.detectInverterModel(client);
            if (inverterModel === null) {
                // A missing inverter block is a recoverable anomaly; the reader already
                // logged a warning (Req 3.9). Nothing to write this cycle.
                this.log.warn('No inverter SunSpec block detected this cycle; retaining previous values');
            } else {
                const inverterValues = await reader.readInverter(client, inverterModel);
                for (const { def, value } of inverterValues) {
                    // writeValue is a no-op for null values (NOT_IMPLEMENTED/skipped) (Req 3.8, 6.8).
                    await stateManager.writeValue('inverter', def, value);
                }
                this.log.debug(`Wrote ${inverterValues.length} inverter value(s) (model ${inverterModel})`);
            }

            // --- Meter block (Req 3.4) ----------------------------------------------
            // A system may legitimately have no meter, so a missing meter block is a
            // warning (already logged by the reader) and never fails the cycle.
            const meterModel = await reader.detectMeterModel(client);
            if (meterModel === null) {
                this.log.warn('No meter SunSpec block detected this cycle; continuing without meter values');
            } else {
                const meterValues = await reader.readMeter(client, meterModel);
                for (const { def, value } of meterValues) {
                    await stateManager.writeValue('meter', def, value);
                }
                this.log.debug(`Wrote ${meterValues.length} meter value(s) (model ${meterModel})`);
            }

            // Cycle completed without throwing: connection is up (Req 7.2, 7.5).
            await this.setStateAsync('info.connection', true, true);
            if (this.consecutiveFailures > 0) {
                this.log.info('Connection to inverter restored');
            }
            this.consecutiveFailures = 0;
        } catch (error) {
            // Any connect/read failure or timeout: mark disconnected, retain last values,
            // and reconnect next cycle (Req 5.6, 7.3, 7.4). Do NOT stop the timer.
            const reason = error instanceof Error ? error.message : String(error);
            this.consecutiveFailures++;
            await this.setStateAsync('info.connection', false, true);
            this.log.error(`Polling cycle failed: ${reason}`);

            // Close the socket so the next cycle performs a fresh connect (Req 7.4).
            try {
                await client.close();
            } catch {
                /* best-effort: ignore close errors */
            }

            // Escalate on repeated failures but keep scheduling (Req 8.5).
            if (this.consecutiveFailures === MAX_CONSECUTIVE_FAILURES) {
                this.log.error(
                    `${MAX_CONSECUTIVE_FAILURES} consecutive polling cycles failed; the inverter appears unreachable. Continuing to retry every ${this.config.pollInterval}s.`,
                );
            }
        } finally {
            this.polling = false;
        }
    }

    /**
     * Handle admin message-box requests. Currently supports `testConnection`, which
     * validates the supplied endpoint and probes the SunSpec identity block without
     * touching the running poll connection (Req 2.2, 2.3, 2.4, 2.5).
     *
     * @param obj - Incoming message; a reply is only sent when `obj.callback` is set.
     */
    private onMessage(obj: ioBroker.Message): void {
        if (typeof obj !== 'object' || !obj.message) {
            return;
        }
        if (obj.command === 'testConnection') {
            void this.handleTestConnection(obj);
        }
    }

    /**
     * Validate the endpoint from the message and probe the SunSpec Common block.
     *
     * Validation failures reply `validationError` within 1 s without opening a socket
     * (Req 2.4). Otherwise a temporary Modbus client connects within 10 s, reads the
     * identity block, and the socket is always closed afterwards (Req 2.2, 2.3, 2.5).
     *
     * @param obj - The `testConnection` message; a reply is sent when `obj.callback` is set.
     */
    private async handleTestConnection(obj: ioBroker.Message): Promise<void> {
        const reply = (response: Record<string, unknown>): void => {
            if (obj.callback) {
                this.sendTo(obj.from, obj.command, response, obj.callback);
            }
        };

        const msg = (obj.message ?? {}) as { host?: unknown; port?: unknown; unitId?: unknown };
        const host = typeof msg.host === 'string' ? msg.host : '';
        const port = typeof msg.port === 'number' ? msg.port : Number(msg.port);
        const unitId = typeof msg.unitId === 'number' ? msg.unitId : Number(msg.unitId);

        // Validate host/port/unitId only; supply a valid pollInterval so it never
        // blocks the connection test (pollInterval is irrelevant here) (Req 2.4).
        const result = validateConfig({ host, port, unitId, pollInterval: 30 });
        const relevantErrors = Object.entries(result.errors).filter(([field]) => field !== 'pollInterval');
        if (relevantErrors.length > 0) {
            const message = relevantErrors.map(([field, err]) => `${field}: ${err}`).join('; ');
            reply({ result: 'validationError', message });
            return;
        }

        const client = new ModbusClient();
        try {
            await client.connect(host, port, unitId, DEFAULT_TIMEOUT_MS);

            // Read the SunSpec identifier ("SunS") plus manufacturer/model identity.
            const idWords = await client.readHoldingRegisters(COMMON_BASE, 2);
            const sunsId = decodeRegisters(idWords, 'uint32');
            // 0x53756e53 == "SunS": the SunSpec well-known marker.
            if (sunsId !== 0x53756e53) {
                reply({
                    result: 'failure',
                    message: `Device at ${host}:${port} did not return a SunSpec identifier`,
                });
                return;
            }

            const manuWords = await client.readHoldingRegisters(COMMON_BASE + 4, 16);
            const modelWords = await client.readHoldingRegisters(COMMON_BASE + 20, 16);
            const manufacturer = decodeRegisters(manuWords, 'string');
            const model = decodeRegisters(modelWords, 'string');

            reply({
                result: 'success',
                manufacturer: typeof manufacturer === 'string' ? manufacturer : '',
                model: typeof model === 'string' ? model : '',
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            reply({ result: 'failure', message });
        } finally {
            // Always release the temporary socket (Req 2.5).
            try {
                await client.close();
            } catch {
                /* best-effort: ignore close errors */
            }
        }
    }

    /**
     * Called when the adapter shuts down. Clears the poll timer and closes any open
     * Modbus socket within 10 s, then invokes the callback under all circumstances (Req 7.6).
     *
     * @param callback - Callback that must be invoked to complete unloading.
     */
    private onUnload(callback: () => void): void {
        try {
            if (this.pollTimer) {
                this.clearInterval(this.pollTimer);
                this.pollTimer = undefined;
            }
            const client = this.modbusClient;
            if (!client) {
                callback();
                return;
            }
            // Close the socket (resolves within 10 s per the client contract, Req 7.6),
            // then always invoke the callback.
            void client
                .close()
                .catch(() => {
                    /* best-effort: ignore close errors during unload */
                })
                .finally(() => callback());
        } catch (error) {
            this.log.error(`Error during unloading: ${(error as Error).message}`);
            callback();
        }
    }
}

if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new Sehybrid(options);
} else {
    // otherwise start the instance directly
    (() => new Sehybrid())();
}
