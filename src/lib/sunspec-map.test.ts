// Property tests for the static SunSpec register map and its non-scale value
// selector helpers.
//
// - Property 6: State metadata mapping is total and correct (Req 6.3-6.7)
// - Property 9: Value selector yields one row per SunSpec value with name,
//   datatype, model (Req 4.1, 4.2, 4.3)

import { expect } from 'chai';
import fc from 'fast-check';

import type { SunSpecRegisterDef, SunSpecRole } from './sunspec-map';
import {
    BATTERY_DID_BASE,
    BATTERY_MAP,
    BATTERY_REGISTER_OFFSETS,
    BATTERY_TEMPLATE_BASE,
    METER_BASE,
    METER_DID_BASE,
    METER_REGISTER_OFFSETS,
    SUNSPEC_MAP,
    getBatteryBase,
    getBatteryDidAddress,
    getBatteryValueDefs,
    getDeviceRegisterAddress,
    getInverterValueDefs,
    getMeterBase,
    getMeterDidAddress,
    getMeterValueDefs,
    getValueDefs,
} from './sunspec-map';

/** All datatypes that resolve to an ioBroker `number` state. */
const NUMERIC_DATATYPES = new Set([
    'int16',
    'uint16',
    'int32',
    'uint32',
    'acc32',
    'float32',
    'float32le',
    'uint32le',
    'uint64',
    'uint64le',
    'sunssf',
]);

/** The complete `SunSpecDatatype` set (mirrors `sunspec-decode.ts`). */
const DATATYPES = new Set([...NUMERIC_DATATYPES, 'string']);

/** All allowed `SunSpecRole` union members. */
const ALL_ROLES: SunSpecRole[] = [
    'current',
    'voltage',
    'power',
    'power.reactive',
    'power.apparent',
    'powerFactor',
    'frequency',
    'energy',
    'temperature',
    'percent',
    'status',
    'info',
];

/** Measurement roles (everything except the internal-plumbing `info`). */
const MEASUREMENT_ROLES = new Set<SunSpecRole>(ALL_ROLES.filter(r => r !== 'info'));

/** Inverter / meter numeric model tags. */
const INVERTER_MODELS = new Set([101, 102, 103]);
const METER_MODELS = new Set([201, 202, 203, 204]);
const VALUE_MODELS = new Set([...INVERTER_MODELS, ...METER_MODELS]);

/**
 * Assertions shared by every def in the map (Property 6 body).
 *
 * @param def
 */
function assertMetadataValid(def: SunSpecRegisterDef): void {
    // Req 6.3: iobType is total over datatype: string -> 'string', else 'number'.
    expect(def.iobType, `iobType for ${def.name}`).to.equal(def.datatype === 'string' ? 'string' : 'number');
    // Req 6.4: role is a known union member.
    expect(ALL_ROLES, `role for ${def.name}`).to.include(def.role);
    // Req 6.5/6.6: unit is a non-empty string or undefined (never null/empty).
    if (def.unit === undefined) {
        expect(def.unit, `unit for ${def.name}`).to.equal(undefined);
    } else {
        expect(def.unit, `unit for ${def.name}`).to.be.a('string');
        expect(def.unit.length, `unit length for ${def.name}`).to.be.greaterThan(0);
    }
    // Req 6.7: name/offset/length are well-formed.
    expect(def.name, `name for ${def.name}`).to.be.a('string');
    expect(def.name.length, `name length`).to.be.greaterThan(0);
    expect(Number.isInteger(def.offset), `offset integer for ${def.name}`).to.equal(true);
    expect(def.offset, `offset non-negative for ${def.name}`).to.be.at.least(0);
    expect(def.length, `length for ${def.name}`).to.be.at.least(1);
}

describe('sunspec-map', () => {
    describe('Feature: solaredge-sunspec-reader, Property 6: State metadata mapping is total and correct', () => {
        it('every def in SUNSPEC_MAP has correct, total metadata (exhaustive)', () => {
            expect(SUNSPEC_MAP.length).to.be.greaterThan(0);
            for (const def of SUNSPEC_MAP) {
                assertMetadataValid(def);
            }
        });

        it('sampled defs from SUNSPEC_MAP satisfy the metadata mapping (property)', () => {
            fc.assert(
                fc.property(fc.constantFrom(...SUNSPEC_MAP), def => {
                    assertMetadataValid(def);
                }),
                { numRuns: 100 },
            );
        });

        it('every measurement value def carries a measurement role (not info)', () => {
            const values = getValueDefs(SUNSPEC_MAP);
            expect(values.length).to.be.greaterThan(0);
            fc.assert(
                fc.property(fc.constantFrom(...values), def => {
                    expect(def.role).to.not.equal('info');
                    expect(MEASUREMENT_ROLES.has(def.role), `measurement role for ${def.name}`).to.equal(true);
                }),
                { numRuns: 100 },
            );
        });
    });

    describe('Feature: solaredge-sunspec-reader, Property 9: Value selector yields one row per SunSpec value with name, datatype, model', () => {
        it('getValueDefs returns exactly the non-info defs, deduped, no sunssf/common', () => {
            const values = getValueDefs(SUNSPEC_MAP);
            const expected = SUNSPEC_MAP.filter(d => d.role !== 'info');

            // Exactly the non-info defs, one entry each.
            expect(values.length).to.equal(expected.length);

            // No duplicates by name+model.
            const keys = values.map(d => `${d.name}@${d.model}`);
            expect(new Set(keys).size, 'unique name+model keys').to.equal(values.length);

            // None sunssf, none from the common identity block.
            for (const def of values) {
                expect(def.datatype, `datatype for ${def.name}`).to.not.equal('sunssf');
                expect(def.model, `model for ${def.name}`).to.not.equal('common');
            }
        });

        it('sampled value defs have valid name, datatype and value model (property)', () => {
            const values = getValueDefs(SUNSPEC_MAP);
            fc.assert(
                fc.property(fc.constantFrom(...values), def => {
                    expect(def.name).to.be.a('string');
                    expect(def.name.length).to.be.greaterThan(0);
                    expect(def.datatype).to.be.a('string');
                    expect(DATATYPES.has(def.datatype), `datatype in set for ${def.name}`).to.equal(true);
                    expect(VALUE_MODELS.has(def.model as number), `model for ${def.name}`).to.equal(true);
                    expect(def.model).to.not.equal('common');
                }),
                { numRuns: 100 },
            );
        });

        it('inverter/meter selectors partition getValueDefs and are disjoint', () => {
            const values = getValueDefs(SUNSPEC_MAP);
            const inverter = getInverterValueDefs(SUNSPEC_MAP);
            const meter = getMeterValueDefs(SUNSPEC_MAP);

            // Model membership.
            for (const def of inverter) {
                expect(INVERTER_MODELS.has(def.model as number), `inverter model for ${def.name}`).to.equal(true);
            }
            for (const def of meter) {
                expect(METER_MODELS.has(def.model as number), `meter model for ${def.name}`).to.equal(true);
            }

            // Disjoint.
            const inverterKeys = new Set(inverter.map(d => `${d.name}@${d.model}`));
            for (const def of meter) {
                expect(inverterKeys.has(`${def.name}@${def.model}`), `disjoint for ${def.name}`).to.equal(false);
            }

            // Union equals getValueDefs.
            expect(inverter.length + meter.length).to.equal(values.length);
            const unionKeys = new Set([
                ...inverter.map(d => `${d.name}@${d.model}`),
                ...meter.map(d => `${d.name}@${d.model}`),
            ]);
            const valueKeys = new Set(values.map(d => `${d.name}@${d.model}`));
            expect(unionKeys.size).to.equal(valueKeys.size);
            for (const key of valueKeys) {
                expect(unionKeys.has(key), `union covers ${key}`).to.equal(true);
            }
        });

        it('getValueDefs([]) returns an empty array (empty-map indication)', () => {
            expect(getValueDefs([])).to.deep.equal([]);
        });
    });

    describe('Feature: solaredge-sunspec-reader, Property 10: Per-device addressing is base + offset', () => {
        const METER_SLOTS = [1, 2, 3] as const;
        const BATTERY_SLOTS = [1, 2] as const;

        it('meter slot base/DID == template base + slot offset', () => {
            for (const slot of METER_SLOTS) {
                const off = METER_REGISTER_OFFSETS[slot - 1];
                expect(getMeterBase(slot), `meter base slot ${slot}`).to.equal(METER_BASE + off);
                expect(getMeterDidAddress(slot), `meter DID slot ${slot}`).to.equal(METER_DID_BASE + off);
            }
        });

        it('battery slot base/DID == template base + slot offset', () => {
            for (const slot of BATTERY_SLOTS) {
                const off = BATTERY_REGISTER_OFFSETS[slot - 1];
                expect(getBatteryBase(slot), `battery base slot ${slot}`).to.equal(BATTERY_TEMPLATE_BASE + off);
                expect(getBatteryDidAddress(slot), `battery DID slot ${slot}`).to.equal(BATTERY_DID_BASE + off);
            }
        });

        it('getDeviceRegisterAddress(base, def) == base + def.offset for every meter def and slot (property)', () => {
            const meterDefs = getMeterValueDefs(SUNSPEC_MAP);
            expect(meterDefs.length).to.be.greaterThan(0);
            fc.assert(
                fc.property(fc.constantFrom(...meterDefs), fc.constantFrom(...METER_SLOTS), (def, slot) => {
                    const base = getMeterBase(slot);
                    const addr = getDeviceRegisterAddress(base, def);
                    // Address is base + offset, i.e. the absolute address for this slot.
                    expect(addr).to.equal(base + def.offset);
                    expect(addr).to.equal(METER_BASE + METER_REGISTER_OFFSETS[slot - 1] + def.offset);
                }),
                { numRuns: 100 },
            );
        });

        it('getDeviceRegisterAddress(base, def) == base + def.offset for every battery def and slot (property)', () => {
            expect(BATTERY_MAP.length).to.be.greaterThan(0);
            fc.assert(
                fc.property(fc.constantFrom(...BATTERY_MAP), fc.constantFrom(...BATTERY_SLOTS), (def, slot) => {
                    const base = getBatteryBase(slot);
                    const addr = getDeviceRegisterAddress(base, def);
                    expect(addr).to.equal(base + def.offset);
                    // For slot 1, address equals the absolute base-0 register address.
                    if (slot === 1) {
                        expect(addr).to.equal(BATTERY_TEMPLATE_BASE + def.offset);
                    }
                    expect(addr).to.equal(BATTERY_TEMPLATE_BASE + BATTERY_REGISTER_OFFSETS[slot - 1] + def.offset);
                }),
                { numRuns: 100 },
            );
        });

        it('getBatteryValueDefs excludes role "info" rows and includes soh/soe/status', () => {
            const values = getBatteryValueDefs();
            const names = new Set(values.map(d => d.name));

            // No info rows (identity strings, event logs).
            for (const def of values) {
                expect(def.role, `role for ${def.name}`).to.not.equal('info');
            }
            // Identity strings and event logs are excluded.
            for (const excluded of ['c_manufacturer', 'c_model', 'c_serialnumber', 'eventLog', 'eventLogInternal']) {
                expect(names.has(excluded), `excluded ${excluded}`).to.equal(false);
            }
            // Measurement values are included.
            for (const included of ['soh', 'soe', 'status', 'statusInternal', 'instantaneousPower']) {
                expect(names.has(included), `included ${included}`).to.equal(true);
            }
        });
    });
});
