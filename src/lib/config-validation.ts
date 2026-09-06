// Pure, shared configuration validation for the SolarEdge SunSpec reader.
//
// Used by both the adapter (on start and in the `testConnection` message handler)
// and the admin form. This module intentionally has no ioBroker/adapter imports so
// it stays a pure function and is easy to property-test (design Property 5).
//
// Validates: Requirements 1.1, 1.2, 1.4, 2.4, 5.1

/** Bounds applied by {@link validateConfig}. All ranges are inclusive. */
export const CONFIG_BOUNDS = {
    /** Inverter host string length, 1..253 chars (Req 1.1). */
    host: { minLength: 1, maxLength: 253 },
    /** Modbus TCP port, integer 1..65535 (Req 1.2). */
    port: { min: 1, max: 65535 },
    /** Modbus unit identifier, integer 0..247 (Req 1.4). */
    unitId: { min: 0, max: 247 },
    /** Polling interval in seconds, integer 5..3600 (Req 5.1). */
    pollInterval: { min: 5, max: 3600 },
} as const;

/** Fields that {@link validateConfig} can report an error for. */
export type ConfigField = 'host' | 'port' | 'unitId' | 'pollInterval';

export interface ConfigValidationResult {
    /** True if and only if `errors` is empty. */
    valid: boolean;
    /** Per-field validation messages, keyed by the offending field. */
    errors: Partial<Record<ConfigField, string>>;
}

/**
 * Validate a (partial) adapter configuration against the documented bounds.
 *
 * The configuration is accepted if and only if:
 * - `host` is a string of length 1..253,
 * - `port` is an integer in [1, 65535],
 * - `unitId` is an integer in [0, 247],
 * - `pollInterval` is an integer in [5, 3600].
 *
 * Any input violating a bound is rejected with an error naming the offending field.
 *
 * @param cfg
 */
export function validateConfig(cfg: Partial<ioBroker.AdapterConfig>): ConfigValidationResult {
    const errors: Partial<Record<ConfigField, string>> = {};

    // host: must be a string of length 1..253 (Req 1.1)
    const { host } = cfg;
    if (typeof host !== 'string') {
        errors.host = 'host must be a string';
    } else if (host.length < CONFIG_BOUNDS.host.minLength) {
        errors.host = 'host must not be empty';
    } else if (host.length > CONFIG_BOUNDS.host.maxLength) {
        errors.host = `host must be at most ${CONFIG_BOUNDS.host.maxLength} characters`;
    }

    // port: integer in [1, 65535] (Req 1.2)
    const { port } = cfg;
    if (!Number.isInteger(port)) {
        errors.port = 'port must be an integer';
    } else if ((port as number) < CONFIG_BOUNDS.port.min || (port as number) > CONFIG_BOUNDS.port.max) {
        errors.port = `port must be between ${CONFIG_BOUNDS.port.min} and ${CONFIG_BOUNDS.port.max}`;
    }

    // unitId: integer in [0, 247] (Req 1.4)
    const { unitId } = cfg;
    if (!Number.isInteger(unitId)) {
        errors.unitId = 'unitId must be an integer';
    } else if ((unitId as number) < CONFIG_BOUNDS.unitId.min || (unitId as number) > CONFIG_BOUNDS.unitId.max) {
        errors.unitId = `unitId must be between ${CONFIG_BOUNDS.unitId.min} and ${CONFIG_BOUNDS.unitId.max}`;
    }

    // pollInterval: integer in [5, 3600] seconds (Req 5.1)
    const { pollInterval } = cfg;
    if (!Number.isInteger(pollInterval)) {
        errors.pollInterval = 'pollInterval must be an integer';
    } else if (
        (pollInterval as number) < CONFIG_BOUNDS.pollInterval.min ||
        (pollInterval as number) > CONFIG_BOUNDS.pollInterval.max
    ) {
        errors.pollInterval = `pollInterval must be between ${CONFIG_BOUNDS.pollInterval.min} and ${CONFIG_BOUNDS.pollInterval.max} seconds`;
    }

    return { valid: Object.keys(errors).length === 0, errors };
}
