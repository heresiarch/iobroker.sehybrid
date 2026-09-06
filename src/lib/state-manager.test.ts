/**
 * Tests for the ioBroker state/object manager (StateManager).
 *
 * Covers:
 * - Property 3 (write side): null values are not written; non-null values are
 *   written acknowledged (task 8.2; Req 3.8, 6.8, 8.1)
 * - Property 7: idempotent channel/state object creation (task 8.3; Req 6.1, 6.2)
 * - Unit tests for channel grouping and derived state metadata (task 8.4; Req 6.3–6.7, 6.9)
 *
 * A lightweight MockAdapter implements the minimal StateManagerAdapter surface and
 * records object/state calls so the manager's behavior can be asserted directly.
 */

import { expect } from 'chai';
import fc from 'fast-check';
import type { ChannelId, IStateManager, StateManagerAdapter } from './state-manager';
import { StateManager } from './state-manager';
import type { SunSpecRegisterDef } from './sunspec-map';
import { getInverterValueDefs, getMeterValueDefs, getValueDefs } from './sunspec-map';

// ---------------------------------------------------------------------------
// Mock adapter
// ---------------------------------------------------------------------------

/** A single recorded state write. */
interface WriteRecord {
    id: string;
    val: ioBroker.StateValue;
    ack: boolean | undefined;
}

/**
 * Minimal StateManagerAdapter implementation for tests.
 *
 * - setObjectNotExistsAsync mimics "not exists" semantics: the first call for an
 *   id records the object; subsequent calls for the same id do NOT overwrite it
 *   but bump a per-id createAttempts counter. Every call bumps createCalls[id].
 * - setStateAsync records the last state per id and appends to the writes[] log.
 */
class MockAdapter implements StateManagerAdapter {
    /** Objects that "exist" on disk, keyed by id (first write wins). */
    readonly objects = new Map<string, ioBroker.SettableObject>();
    /** Total number of setObjectNotExistsAsync calls per id. */
    readonly createCalls = new Map<string, number>();
    /** Number of calls that hit an already-existing id (no overwrite). */
    readonly createAttempts = new Map<string, number>();
    /** Last state written per id. */
    readonly states = new Map<string, ioBroker.SettableState>();
    /** Ordered log of every state write. */
    readonly writes: WriteRecord[] = [];

    setObjectNotExistsAsync(id: string, obj: ioBroker.SettableObject): ioBroker.SetObjectPromise {
        this.createCalls.set(id, (this.createCalls.get(id) ?? 0) + 1);
        if (this.objects.has(id)) {
            // Already present: not-exists semantics => do not overwrite.
            this.createAttempts.set(id, (this.createAttempts.get(id) ?? 0) + 1);
        } else {
            this.objects.set(id, obj);
        }
        return Promise.resolve({ id });
    }

    setStateAsync(id: string, state: ioBroker.SettableState): Promise<string> {
        this.states.set(id, state);
        this.writes.push({ id, val: state.val as ioBroker.StateValue, ack: state.ack });
        return Promise.resolve(id);
    }

    /**
     * Convenience: writes recorded for a given id.
     *
     * @param id
     */
    writesFor(id: string): WriteRecord[] {
        return this.writes.filter(w => w.id === id);
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Inverter models 101/102/103 -> 'inverter'; meter models 201–204 -> 'meter'.
 *
 * @param def
 */
function channelForDef(def: SunSpecRegisterDef): ChannelId {
    return def.model === 201 || def.model === 202 || def.model === 203 || def.model === 204 ? 'meter' : 'inverter';
}

const allValueDefs = getValueDefs();
const inverterValueDefs = getInverterValueDefs();
const meterValueDefs = getMeterValueDefs();

describe('state-manager => StateManager', () => {
    // --------------------------------------------------------------------
    // Task 8.2 — Property 3 (write side): null/ack behavior
    // --------------------------------------------------------------------

    it('Feature: solaredge-sunspec-reader, Property 3: null values are not written, non-null values are written with ack=true', async () => {
        // Choose from the concrete measurement defs, paired with a value that is
        // either null or a number/string.
        const defArb = fc.constantFrom(...allValueDefs);
        const valueArb: fc.Arbitrary<number | string | null> = fc.oneof(
            fc.constant<null>(null),
            fc.double({ noNaN: true }),
            fc.integer(),
            fc.string(),
        );

        await fc.assert(
            fc.asyncProperty(defArb, valueArb, async (def, value) => {
                const adapter = new MockAdapter();
                const manager: IStateManager = new StateManager(adapter);
                const channel = channelForDef(def);
                const id = `${channel}.${def.name}`;

                await manager.writeValue(channel, def, value);

                const writes = adapter.writesFor(id);
                if (value === null) {
                    // No state write recorded for a null value.
                    expect(writes.length).to.equal(0);
                } else {
                    // Exactly one acknowledged write of the exact value.
                    expect(writes.length).to.equal(1);
                    expect(writes[0].val).to.equal(value);
                    expect(writes[0].ack).to.equal(true);
                }
            }),
            { numRuns: 200 },
        );
    });

    // --------------------------------------------------------------------
    // Task 8.3 — Property 7: idempotent object creation
    // --------------------------------------------------------------------

    it('Feature: solaredge-sunspec-reader, Property 7: Idempotent object creation', async () => {
        const defArb = fc.constantFrom(...allValueDefs);
        const repeatArb = fc.integer({ min: 1, max: 10 });

        await fc.assert(
            fc.asyncProperty(defArb, repeatArb, async (def, n) => {
                const adapter = new MockAdapter();
                const manager: IStateManager = new StateManager(adapter);
                const channel = channelForDef(def);
                const stateId = `${channel}.${def.name}`;

                // Ensuring the same state N times issues at most one create call.
                for (let i = 0; i < n; i++) {
                    await manager.ensureState(channel, def);
                }
                expect(adapter.createCalls.get(stateId) ?? 0).to.equal(1);
                expect(adapter.createAttempts.get(stateId) ?? 0).to.equal(0);

                // Ensuring the same channel N times also creates it at most once.
                for (let i = 0; i < n; i++) {
                    await manager.ensureChannel(channel);
                }
                expect(adapter.createCalls.get(channel) ?? 0).to.equal(1);
                expect(adapter.createAttempts.get(channel) ?? 0).to.equal(0);
            }),
            { numRuns: 200 },
        );
    });

    // --------------------------------------------------------------------
    // Task 8.4 — Unit tests: channel grouping & metadata
    // --------------------------------------------------------------------

    describe('ensureChannel', () => {
        it("creates the 'inverter' channel object with type 'channel' and name 'Inverter'", async () => {
            const adapter = new MockAdapter();
            const manager = new StateManager(adapter);
            await manager.ensureChannel('inverter');
            const obj = adapter.objects.get('inverter');
            expect(obj).to.not.equal(undefined);
            expect(obj!.type).to.equal('channel');
            expect((obj!.common as ioBroker.ChannelCommon).name).to.equal('Inverter');
        });

        it("creates the 'meter' channel object with type 'channel' and name 'Meter'", async () => {
            const adapter = new MockAdapter();
            const manager = new StateManager(adapter);
            await manager.ensureChannel('meter');
            const obj = adapter.objects.get('meter');
            expect(obj).to.not.equal(undefined);
            expect(obj!.type).to.equal('channel');
            expect((obj!.common as ioBroker.ChannelCommon).name).to.equal('Meter');
        });
    });

    describe('ensureState metadata', () => {
        /**
         * Find a representative def by name from the value defs.
         *
         * @param name
         */
        function defByName(name: string): SunSpecRegisterDef {
            const def = allValueDefs.find(d => d.name === name);
            expect(def, `expected a value def named ${name}`).to.not.equal(undefined);
            return def!;
        }

        it("derives type/role/read/write/unit for a power value (acPower, unit 'W')", async () => {
            const adapter = new MockAdapter();
            const manager = new StateManager(adapter);
            const def = defByName('acPower');
            await manager.ensureState('inverter', def);

            const obj = adapter.objects.get('inverter.acPower');
            expect(obj).to.not.equal(undefined);
            expect(obj!.type).to.equal('state');
            const common = obj!.common as ioBroker.StateCommon;
            expect(common.type).to.equal(def.iobType);
            expect(common.type).to.equal('number');
            expect(common.role).to.equal('value.power.active');
            expect(common.read).to.equal(true);
            expect(common.write).to.equal(false);
            expect(common.unit).to.equal('W');
        });

        it('maps role -> ioBroker common.role for representative quantities', async () => {
            const adapter = new MockAdapter();
            const manager = new StateManager(adapter);

            // current -> value.current
            await manager.ensureState('inverter', defByName('acCurrent'));
            expect((adapter.objects.get('inverter.acCurrent')!.common as ioBroker.StateCommon).role).to.equal(
                'value.current',
            );

            // energy -> value.energy
            await manager.ensureState('inverter', defByName('acEnergyWh'));
            expect((adapter.objects.get('inverter.acEnergyWh')!.common as ioBroker.StateCommon).role).to.equal(
                'value.energy',
            );

            // status -> indicator
            await manager.ensureState('inverter', defByName('status'));
            expect((adapter.objects.get('inverter.status')!.common as ioBroker.StateCommon).role).to.equal('indicator');
        });

        it("omits the 'unit' key entirely when the def declares no unit (status)", async () => {
            const adapter = new MockAdapter();
            const manager = new StateManager(adapter);
            const def = defByName('status');
            expect(def.unit).to.equal(undefined);

            await manager.ensureState('inverter', def);
            const common = adapter.objects.get('inverter.status')!.common as ioBroker.StateCommon;
            expect(common).to.not.have.property('unit');
        });

        it("includes the 'unit' key iff the def declares a unit (all value defs)", async () => {
            const adapter = new MockAdapter();
            const manager = new StateManager(adapter);
            for (const def of allValueDefs) {
                const channel = channelForDef(def);
                await manager.ensureState(channel, def);
                const common = adapter.objects.get(`${channel}.${def.name}`)!.common as ioBroker.StateCommon;
                if (def.unit !== undefined) {
                    expect(common, `${def.name} should have unit`).to.have.property('unit', def.unit);
                } else {
                    expect(common, `${def.name} should not have unit`).to.not.have.property('unit');
                }
            }
        });
    });

    describe('writeValue', () => {
        it('writes non-null values acknowledged (ack=true)', async () => {
            const adapter = new MockAdapter();
            const manager = new StateManager(adapter);
            const def = getInverterValueDefs().find(d => d.name === 'acPower')!;
            await manager.writeValue('inverter', def, 1234);

            const writes = adapter.writesFor('inverter.acPower');
            expect(writes.length).to.equal(1);
            expect(writes[0].val).to.equal(1234);
            expect(writes[0].ack).to.equal(true);
        });
    });

    describe('channel grouping', () => {
        it("places inverter defs under 'inverter.<name>'", async () => {
            const adapter = new MockAdapter();
            const manager = new StateManager(adapter);
            const def = inverterValueDefs[0];
            await manager.ensureState('inverter', def);
            expect(adapter.objects.has(`inverter.${def.name}`)).to.equal(true);
        });

        it("places meter defs under 'meter.<name>'", async () => {
            const adapter = new MockAdapter();
            const manager = new StateManager(adapter);
            const def = meterValueDefs[0];
            await manager.ensureState('meter', def);
            expect(adapter.objects.has(`meter.${def.name}`)).to.equal(true);
        });

        it('writes inverter and meter values under their respective channels', async () => {
            const adapter = new MockAdapter();
            const manager = new StateManager(adapter);
            const invDef = inverterValueDefs[0];
            const meterDef = meterValueDefs[0];

            await manager.writeValue('inverter', invDef, 1);
            await manager.writeValue('meter', meterDef, 2);

            expect(adapter.writesFor(`inverter.${invDef.name}`).length).to.equal(1);
            expect(adapter.writesFor(`meter.${meterDef.name}`).length).to.equal(1);
        });
    });
});
