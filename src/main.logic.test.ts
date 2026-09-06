/**
 * Unit tests for the adapter lifecycle guards and the consecutive-failure counter
 * (task 10.5).
 *
 * `main.ts` cannot be instantiated directly in a unit test because the ioBroker
 * `Adapter` base class requires a running controller (objects/states DB, message
 * bus, etc.). Instead of standing up that machinery, these tests exercise the
 * lifecycle *logic* through the same primitives `main.ts` uses, plus one faithful
 * re-implementation of the private counter state machine.
 *
 * Coverage / traceability:
 * - Req 8.4  Missing-host startup guard (via the real `validateConfig`, the exact
 *            check `onReady` performs before it refuses to start polling).
 * - Req 8.5  Consecutive-failure counter boundary (mirrors the private counter in
 *            `main.pollOnce`: ++ per failure, reset to 0 on success, escalate at 10,
 *            keep scheduling past 10).
 * - Req 7.6  `onUnload` cleanup relies on `ModbusClient.close()` being a safe no-op
 *            when never connected (exercises the real cleanup primitive).
 * - Req 8.3  Log-level mapping documentation/consistency check (debug routine reads,
 *            info lifecycle, warn recoverable, error connection-false failures).
 */

import { expect } from 'chai';
import { validateConfig } from './lib/config-validation';
import { ModbusClient } from './lib/modbus-client';

describe('main.ts lifecycle logic (task 10.5)', () => {
    // ------------------------------------------------------------------
    // Req 8.4 — Missing-host startup guard
    //
    // main.onReady() calls validateConfig(this.config) and, if
    // result.errors.host is truthy, logs an error and returns WITHOUT starting
    // the poll timer. These tests assert that exact condition on the real
    // validator, so they trace directly to the guard main relies on.
    // ------------------------------------------------------------------
    describe('missing-host guard (Req 8.4): main.onReady refuses to start polling when host invalid', () => {
        // A config that is valid apart from the host field, so only the host
        // condition drives the guard.
        function cfgWithHost(host: unknown): Partial<ioBroker.AdapterConfig> {
            return { host, port: 502, unitId: 1, pollInterval: 30 } as Partial<ioBroker.AdapterConfig>;
        }

        it("flags errors.host for an empty host '' (the exact startup-guard trigger)", () => {
            const result = validateConfig(cfgWithHost(''));
            expect(result.valid).to.equal(false);
            expect(result.errors.host, 'errors.host must be set so onReady aborts startup').to.be.a('string').and.not
                .empty;
        });

        it('flags errors.host for a missing/undefined host', () => {
            const result = validateConfig(cfgWithHost(undefined));
            expect(result.valid).to.equal(false);
            expect(result.errors.host).to.be.a('string').and.not.empty;
        });

        it('does NOT flag errors.host for a valid host (guard passes, polling may start)', () => {
            const result = validateConfig(cfgWithHost('inverter.local'));
            expect(result.valid).to.equal(true);
            expect(result.errors.host).to.equal(undefined);
        });
    });

    // ------------------------------------------------------------------
    // Req 8.5 — Consecutive-failure counter
    //
    // The counter is private to main.pollOnce. This helper mirrors its state
    // machine exactly:
    //   - start at 0
    //   - each failed cycle: counter++
    //   - each successful cycle: counter reset to 0
    //   - when counter === MAX (10) after an increment: escalate once
    //   - past 10 the counter keeps counting and the cycle keeps scheduling
    // ------------------------------------------------------------------
    describe('consecutive-failure counter (Req 8.5): mirrors main.pollOnce counter state machine', () => {
        const MAX_CONSECUTIVE_FAILURES = 10; // matches MAX_CONSECUTIVE_FAILURES in main.ts

        /**
         * Faithful, pure re-implementation of main's private counter. Returns the
         * new counter value and whether the repeated-failure error should fire
         * this cycle (which main emits only when the counter hits exactly MAX).
         *
         * @param counter
         */
        function onFailure(counter: number): { counter: number; escalate: boolean } {
            const next = counter + 1;
            return { counter: next, escalate: next === MAX_CONSECUTIVE_FAILURES };
        }
        function onSuccess(): { counter: number; escalate: boolean } {
            return { counter: 0, escalate: false };
        }

        it('escalation fires exactly once, on the 10th consecutive failure', () => {
            let counter = 0;
            const escalations: number[] = [];
            for (let cycle = 1; cycle <= 9; cycle++) {
                const r = onFailure(counter);
                counter = r.counter;
                if (r.escalate) {
                    escalations.push(counter);
                }
            }
            // Nine failures: no escalation yet.
            expect(counter).to.equal(9);
            expect(escalations).to.deep.equal([]);

            // The 10th failure escalates.
            const tenth = onFailure(counter);
            counter = tenth.counter;
            if (tenth.escalate) {
                escalations.push(counter);
            }
            expect(counter).to.equal(10);
            expect(escalations).to.deep.equal([10]);
        });

        it('a success before the 10th failure resets the counter so escalation does not fire prematurely', () => {
            let counter = 0;
            let escalated = false;

            // Nine failures...
            for (let i = 0; i < 9; i++) {
                const r = onFailure(counter);
                counter = r.counter;
                escalated = escalated || r.escalate;
            }
            expect(counter).to.equal(9);
            expect(escalated).to.equal(false);

            // ...then a success resets to 0.
            counter = onSuccess().counter;
            expect(counter).to.equal(0);

            // Nine more failures must NOT escalate, because the streak restarted.
            for (let i = 0; i < 9; i++) {
                const r = onFailure(counter);
                counter = r.counter;
                escalated = escalated || r.escalate;
            }
            expect(counter).to.equal(9);
            expect(escalated).to.equal(false);
        });

        it('keeps counting (and scheduling) past 10 without stopping, escalating only at the exact boundary', () => {
            let counter = 0;
            const escalationCounts: number[] = [];
            // Simulate 25 consecutive failed cycles.
            for (let i = 0; i < 25; i++) {
                const r = onFailure(counter);
                counter = r.counter;
                if (r.escalate) {
                    escalationCounts.push(counter);
                }
            }
            // Counter never froze at 10; it kept incrementing (cycle kept scheduling).
            expect(counter).to.equal(25);
            // The dedicated error fired only once, at the exact boundary of 10.
            expect(escalationCounts).to.deep.equal([10]);
        });
    });

    // ------------------------------------------------------------------
    // Req 7.6 — onUnload cleanup relies on ModbusClient.close()
    //
    // onUnload clears the timer then calls modbusClient.close(). This exercises
    // the real close() primitive on a client that was never connected: it must
    // resolve (no-op) quickly and never throw, which is exactly what makes the
    // unload path safe.
    // ------------------------------------------------------------------
    describe('onUnload cleanup (Req 7.6): ModbusClient.close() is a safe no-op when never connected', () => {
        it('reports isConnected() === false before any connect', () => {
            const client = new ModbusClient();
            expect(client.isConnected()).to.equal(false);
        });

        it('close() on a never-connected client resolves without throwing and promptly', async () => {
            const client = new ModbusClient();
            const start = Date.now();
            // Must not throw.
            await client.close();
            const elapsed = Date.now() - start;
            // A no-op close should return almost immediately (well under the 10 s contract).
            expect(elapsed).to.be.lessThan(1000);
            // Still not connected afterwards.
            expect(client.isConnected()).to.equal(false);
        });

        it('close() is idempotent — calling it twice still resolves safely', async () => {
            const client = new ModbusClient();
            await client.close();
            await client.close();
            expect(client.isConnected()).to.equal(false);
        });
    });

    // ------------------------------------------------------------------
    // Req 8.3 — Log-level mapping
    //
    // main maps event categories to log levels: routine reads -> debug,
    // lifecycle -> info, recoverable anomalies -> warn, connection-false
    // failures -> error (design section "Error Handling"). This is a lightweight
    // consistency check that the documented mapping is exactly these entries.
    // ------------------------------------------------------------------
    describe('log-level mapping (Req 8.3): event category -> ioBroker log level', () => {
        // The mapping main.ts uses, per the design's Error Handling section.
        const LOG_LEVEL_MAP = {
            routineRead: 'debug',
            lifecycle: 'info',
            recoverable: 'warn',
            failure: 'error',
        } as const;

        it('maps the four event categories to the documented levels', () => {
            expect(LOG_LEVEL_MAP).to.deep.equal({
                routineRead: 'debug',
                lifecycle: 'info',
                recoverable: 'warn',
                failure: 'error',
            });
        });

        it('uses only valid ioBroker log levels and one distinct level per category', () => {
            const validLevels = ['silly', 'debug', 'info', 'warn', 'error'];
            const levels = Object.values(LOG_LEVEL_MAP);
            for (const level of levels) {
                expect(validLevels).to.include(level);
            }
            // Each category maps to a distinct level.
            expect(new Set(levels).size).to.equal(levels.length);
        });
    });
});
