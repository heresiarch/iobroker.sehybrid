/**
 * Tests for the pure configuration validation module.
 *
 * Covers:
 * - Property 5: Configuration validation boundaries (task 2.2)
 * - Config defaults / boundary example tests (task 2.3)
 */

import { expect } from 'chai';
import fc from 'fast-check';
import type { ConfigValidationResult } from './config-validation';
import { validateConfig, CONFIG_BOUNDS } from './config-validation';

// The four fields validateConfig cares about. We build partial configs from these.
type TestConfig = {
    host?: unknown;
    port?: unknown;
    unitId?: unknown;
    pollInterval?: unknown;
};

// Independent oracle mirroring the documented bounds. Kept intentionally simple.
function isValidHost(host: unknown): boolean {
    return (
        typeof host === 'string' &&
        host.length >= CONFIG_BOUNDS.host.minLength &&
        host.length <= CONFIG_BOUNDS.host.maxLength
    );
}
function isValidInt(value: unknown, min: number, max: number): boolean {
    return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}
function isValidPort(port: unknown): boolean {
    return isValidInt(port, CONFIG_BOUNDS.port.min, CONFIG_BOUNDS.port.max);
}
function isValidUnitId(unitId: unknown): boolean {
    return isValidInt(unitId, CONFIG_BOUNDS.unitId.min, CONFIG_BOUNDS.unitId.max);
}
function isValidPollInterval(pollInterval: unknown): boolean {
    return isValidInt(pollInterval, CONFIG_BOUNDS.pollInterval.min, CONFIG_BOUNDS.pollInterval.max);
}

describe('config-validation => validateConfig', () => {
    // --------------------------------------------------------------------
    // Task 2.2 — Property-based test (design Property 5)
    // --------------------------------------------------------------------

    // Arbitraries producing a mix of valid and invalid values for each field.
    // For each field we cover: in-range, out-of-range, non-integer, and wrong-type.
    const hostArb: fc.Arbitrary<unknown> = fc.oneof(
        // valid strings (length 1..253)
        fc.string({ minLength: 1, maxLength: 253 }),
        // invalid: empty string
        fc.constant(''),
        // invalid: too long (254..300)
        fc.string({ minLength: 254, maxLength: 300 }),
        // invalid: wrong types
        fc.integer(),
        fc.boolean(),
        fc.constant(undefined),
        fc.constant(null),
    );

    const portArb: fc.Arbitrary<unknown> = fc.oneof(
        // valid integers inside [1, 65535]
        fc.integer({ min: 1, max: 65535 }),
        // invalid integers outside the range
        fc.integer({ min: -1000, max: 0 }),
        fc.integer({ min: 65536, max: 200000 }),
        // non-integers
        fc.double({ min: -1000, max: 200000, noNaN: true }).filter(n => !Number.isInteger(n)),
        // wrong types
        fc.string(),
        fc.constant(undefined),
    );

    const unitIdArb: fc.Arbitrary<unknown> = fc.oneof(
        // valid integers inside [0, 247]
        fc.integer({ min: 0, max: 247 }),
        // invalid integers outside the range
        fc.integer({ min: -100, max: -1 }),
        fc.integer({ min: 248, max: 1000 }),
        // non-integers
        fc.double({ min: -100, max: 1000, noNaN: true }).filter(n => !Number.isInteger(n)),
        // wrong types
        fc.string(),
        fc.constant(undefined),
    );

    const pollIntervalArb: fc.Arbitrary<unknown> = fc.oneof(
        // valid integers inside [5, 3600]
        fc.integer({ min: 5, max: 3600 }),
        // invalid integers outside the range
        fc.integer({ min: -100, max: 4 }),
        fc.integer({ min: 3601, max: 100000 }),
        // non-integers
        fc.double({ min: -100, max: 100000, noNaN: true }).filter(n => !Number.isInteger(n)),
        // wrong types
        fc.string(),
        fc.constant(undefined),
    );

    const configArb: fc.Arbitrary<TestConfig> = fc.record({
        host: hostArb,
        port: portArb,
        unitId: unitIdArb,
        pollInterval: pollIntervalArb,
    });

    it('Feature: solaredge-sunspec-reader, Property 5: Configuration validation boundaries', () => {
        fc.assert(
            fc.property(configArb, cfg => {
                const hostOk = isValidHost(cfg.host);
                const portOk = isValidPort(cfg.port);
                const unitIdOk = isValidUnitId(cfg.unitId);
                const pollOk = isValidPollInterval(cfg.pollInterval);
                const expectedValid = hostOk && portOk && unitIdOk && pollOk;

                const result: ConfigValidationResult = validateConfig(cfg as Partial<ioBroker.AdapterConfig>);

                // Validity matches the independent oracle.
                expect(result.valid).to.equal(expectedValid);

                // valid === (errors empty)
                expect(result.valid).to.equal(Object.keys(result.errors).length === 0);

                // Every out-of-bounds field must be named in the errors object.
                if (!hostOk) {
                    expect(result.errors).to.have.property('host');
                }
                if (!portOk) {
                    expect(result.errors).to.have.property('port');
                }
                if (!unitIdOk) {
                    expect(result.errors).to.have.property('unitId');
                }
                if (!pollOk) {
                    expect(result.errors).to.have.property('pollInterval');
                }
            }),
            { numRuns: 200 },
        );
    });

    // --------------------------------------------------------------------
    // Task 2.3 — Unit / example tests for defaults & boundary behavior
    // --------------------------------------------------------------------

    // A helper to build a config with the documented defaults, overriding fields as needed.
    function withDefaults(overrides: Partial<TestConfig> = {}): TestConfig {
        return { host: 'inverter.local', port: 502, unitId: 1, pollInterval: 30, ...overrides };
    }

    it('accepts the documented io-package defaults (host set, port 502, unitId 1, pollInterval 30)', () => {
        const result = validateConfig(withDefaults() as Partial<ioBroker.AdapterConfig>);
        expect(result.valid).to.equal(true);
        expect(result.errors).to.deep.equal({});
    });

    describe('port boundaries', () => {
        it('accepts port 1 (lower bound)', () => {
            expect(validateConfig(withDefaults({ port: 1 }) as Partial<ioBroker.AdapterConfig>).valid).to.equal(true);
        });
        it('accepts port 65535 (upper bound)', () => {
            expect(validateConfig(withDefaults({ port: 65535 }) as Partial<ioBroker.AdapterConfig>).valid).to.equal(
                true,
            );
        });
        it('rejects port 0 (below lower bound)', () => {
            const result = validateConfig(withDefaults({ port: 0 }) as Partial<ioBroker.AdapterConfig>);
            expect(result.valid).to.equal(false);
            expect(result.errors).to.have.property('port');
        });
        it('rejects port 65536 (above upper bound)', () => {
            const result = validateConfig(withDefaults({ port: 65536 }) as Partial<ioBroker.AdapterConfig>);
            expect(result.valid).to.equal(false);
            expect(result.errors).to.have.property('port');
        });
    });

    describe('unitId boundaries', () => {
        it('accepts unitId 0 (lower bound)', () => {
            expect(validateConfig(withDefaults({ unitId: 0 }) as Partial<ioBroker.AdapterConfig>).valid).to.equal(true);
        });
        it('accepts unitId 247 (upper bound)', () => {
            expect(validateConfig(withDefaults({ unitId: 247 }) as Partial<ioBroker.AdapterConfig>).valid).to.equal(
                true,
            );
        });
        it('rejects unitId -1 (below lower bound)', () => {
            const result = validateConfig(withDefaults({ unitId: -1 }) as Partial<ioBroker.AdapterConfig>);
            expect(result.valid).to.equal(false);
            expect(result.errors).to.have.property('unitId');
        });
        it('rejects unitId 248 (above upper bound)', () => {
            const result = validateConfig(withDefaults({ unitId: 248 }) as Partial<ioBroker.AdapterConfig>);
            expect(result.valid).to.equal(false);
            expect(result.errors).to.have.property('unitId');
        });
    });

    describe('pollInterval boundaries', () => {
        it('accepts pollInterval 5 (lower bound)', () => {
            expect(validateConfig(withDefaults({ pollInterval: 5 }) as Partial<ioBroker.AdapterConfig>).valid).to.equal(
                true,
            );
        });
        it('accepts pollInterval 3600 (upper bound)', () => {
            expect(
                validateConfig(withDefaults({ pollInterval: 3600 }) as Partial<ioBroker.AdapterConfig>).valid,
            ).to.equal(true);
        });
        it('rejects pollInterval 4 (below lower bound)', () => {
            const result = validateConfig(withDefaults({ pollInterval: 4 }) as Partial<ioBroker.AdapterConfig>);
            expect(result.valid).to.equal(false);
            expect(result.errors).to.have.property('pollInterval');
        });
        it('rejects pollInterval 3601 (above upper bound)', () => {
            const result = validateConfig(withDefaults({ pollInterval: 3601 }) as Partial<ioBroker.AdapterConfig>);
            expect(result.valid).to.equal(false);
            expect(result.errors).to.have.property('pollInterval');
        });
    });

    describe('host boundaries', () => {
        it("rejects empty host ''", () => {
            const result = validateConfig(withDefaults({ host: '' }) as Partial<ioBroker.AdapterConfig>);
            expect(result.valid).to.equal(false);
            expect(result.errors).to.have.property('host');
        });
        it("accepts single-character host 'a'", () => {
            expect(validateConfig(withDefaults({ host: 'a' }) as Partial<ioBroker.AdapterConfig>).valid).to.equal(true);
        });
        it('accepts a 253-character host (upper bound)', () => {
            const host = 'a'.repeat(253);
            expect(validateConfig(withDefaults({ host }) as Partial<ioBroker.AdapterConfig>).valid).to.equal(true);
        });
        it('rejects a 254-character host (above upper bound)', () => {
            const host = 'a'.repeat(254);
            const result = validateConfig(withDefaults({ host }) as Partial<ioBroker.AdapterConfig>);
            expect(result.valid).to.equal(false);
            expect(result.errors).to.have.property('host');
        });
    });
});
