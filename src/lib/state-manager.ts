// ioBroker state/object manager for the SolarEdge SunSpec reader.
//
// Owns idempotent channel/object creation and acknowledged value writes for the
// polled SunSpec values. State objects are grouped into two channels — `inverter`
// and `meter` (Req 6.9) — and their metadata is derived deterministically from the
// register definition: type, role, unit, read=true/write=false (Req 6.3–6.7).
//
// The manager keeps the adapter dependency minimal and structural (only the two
// object/state methods it actually uses) so it can be unit- and property-tested
// with a lightweight mock adapter (design Properties 3 & 7). Created channels and
// ensured states are tracked in Sets so repeat calls are genuine no-ops (Req 6.1,
// 6.2; Property 7) and rely on `setObjectNotExistsAsync` so pre-existing objects
// on disk are reused rather than recreated.
//
// Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 8.1

import type { SunSpecRegisterDef, SunSpecRole } from './sunspec-map';

/** The two channels values are grouped into (Req 6.9). */
export type ChannelId = 'inverter' | 'meter';

/**
 * Minimal structural view of the running ioBroker adapter. Only the object/state
 * methods the state manager actually calls are required, which keeps the manager
 * decoupled from the full `ioBroker.Adapter` surface and easy to mock in tests.
 */
export interface StateManagerAdapter {
    setObjectNotExistsAsync(id: string, obj: ioBroker.SettableObject): ioBroker.SetObjectPromise;
    setStateAsync(id: string, state: ioBroker.SettableState): Promise<string>;
}

/** State/object manager contract used by the reader/orchestrator (design Req 6, 7.1). */
export interface IStateManager {
    /** Create the channel object once (inverter | meter); reused thereafter (Req 6.9). */
    ensureChannel(channel: ChannelId): Promise<void>;
    /** Create the state object once from its register def; reuse if present (Req 6.1–6.7). */
    ensureState(channel: ChannelId, def: SunSpecRegisterDef): Promise<void>;
    /** Write an engineering value with ack=true; no-op when value is null (Req 3.8, 6.8, 8.1). */
    writeValue(channel: ChannelId, def: SunSpecRegisterDef, value: number | string | null): Promise<void>;
}

/** Human-readable channel display names for `common.name` (Req 6.9). */
const CHANNEL_NAMES: Record<ChannelId, string> = {
    inverter: 'Inverter',
    meter: 'Meter',
};

/**
 * Map a logical SunSpec role to a valid ioBroker `common.role` string (Req 6.4).
 *
 * Every {@link SunSpecRole} has an entry so the mapping is total. The chosen roles
 * are standard ioBroker state roles (`value.*` for measurements, `indicator` for
 * status flags, plain `value` for unitless/dimensionless quantities).
 */
const ROLE_MAP: Record<SunSpecRole, string> = {
    current: 'value.current',
    voltage: 'value.voltage',
    power: 'value.power.active',
    'power.apparent': 'value.power',
    'power.reactive': 'value.power',
    powerFactor: 'value',
    frequency: 'value.frequency',
    energy: 'value.energy',
    temperature: 'value.temperature',
    status: 'indicator',
    info: 'value',
};

/**
 * Idempotent ioBroker object/channel creator and acknowledged-value writer.
 *
 * Instantiated once per adapter run with the running adapter instance. Channel and
 * state creation are cached in-memory so repeat calls within a run do not re-issue
 * `setObjectNotExistsAsync`; combined with the "not exists" semantics this makes
 * `ensureChannel`/`ensureState` idempotent both in-process and against pre-existing
 * objects (Req 6.1, 6.2; Property 7).
 */
export class StateManager implements IStateManager {
    private readonly adapter: StateManagerAdapter;
    /** Channels already created this run, to skip redundant object calls. */
    private readonly createdChannels = new Set<ChannelId>();
    /** State ids already ensured this run, to make ensureState a no-op on repeat. */
    private readonly ensuredStates = new Set<string>();

    constructor(adapter: StateManagerAdapter) {
        this.adapter = adapter;
    }

    async ensureChannel(channel: ChannelId): Promise<void> {
        if (this.createdChannels.has(channel)) {
            return;
        }
        await this.adapter.setObjectNotExistsAsync(channel, {
            type: 'channel',
            common: {
                name: CHANNEL_NAMES[channel],
            },
            native: {},
        });
        this.createdChannels.add(channel);
    }

    async ensureState(channel: ChannelId, def: SunSpecRegisterDef): Promise<void> {
        const id = `${channel}.${def.name}`;
        if (this.ensuredStates.has(id)) {
            return;
        }

        // Derive the state metadata deterministically from the register def
        // (Req 6.3 type, 6.4 role, 6.5/6.6 unit, 6.7 read/write).
        const common: ioBroker.StateCommon = {
            name: def.name,
            type: def.iobType,
            role: ROLE_MAP[def.role],
            read: true,
            write: false,
        };
        // Set `common.unit` only when the def declares a unit; omit the property
        // entirely otherwise (Req 6.5, 6.6).
        if (def.unit !== undefined) {
            common.unit = def.unit;
        }

        await this.adapter.setObjectNotExistsAsync(id, {
            type: 'state',
            common,
            native: {},
        });
        this.ensuredStates.add(id);
    }

    async writeValue(channel: ChannelId, def: SunSpecRegisterDef, value: number | string | null): Promise<void> {
        // NOT_IMPLEMENTED / skipped values arrive as null and must not be written;
        // the previously acknowledged value (if any) is retained (Req 3.8).
        if (value === null) {
            return;
        }
        // Defensive: guarantee the object exists before writing (idempotent).
        await this.ensureState(channel, def);
        // Every value received from the inverter is written acknowledged (Req 6.8, 8.1).
        await this.adapter.setStateAsync(`${channel}.${def.name}`, { val: value, ack: true });
    }
}
