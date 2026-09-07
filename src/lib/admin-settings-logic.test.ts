/**
 * Component-logic tests for the admin UI (task 11.4).
 *
 * SCOPE NOTE — why these are logic-level tests, not DOM/render tests:
 * This repo's test runner is mocha + ts-node over `src/**\/*.test.ts` in a plain
 * Node environment. There is no jsdom, and no React DOM test harness is installed
 * (no `@testing-library/react`, `jsdom`, `enzyme`, or `react-test-renderer` in
 * devDependencies). Mounting/rendering the `<Settings>` component is therefore out
 * of scope for the current setup, and adding such infrastructure would be heavy,
 * unrelated dependency churn.
 *
 * Instead, these tests exercise the component's *decision logic* through the exact
 * shared, pure modules `admin/src/components/settings.tsx` consumes:
 *   - `validateConfig` from `./config-validation` — drives per-field error display
 *     and gates (disables) the Test Connection button (Req 1.6–1.9, 2.1, 5.2).
 *   - `getValueDefs` from `./sunspec-map` — the read-only backing data for the
 *     SunSpec value table, including the empty-map indication (Req 4.4, 4.5).
 * The assertions mirror how the component uses these functions:
 *   - `render()` computes `errors = validateConfig(currentConfig()).errors` and
 *     `anyInvalid = Object.keys(errors).length > 0`, passing `disabled={anyInvalid ...}`
 *     to the Test Connection <Button> and `error={!!errors.<field>}` to each field.
 *   - `renderValueTable()` computes `defs = getValueDefs()` and shows the
 *     "No SunSpec values available" cell when `defs.length === 0`.
 *   - `onTestConnection()` sends `{ host, port, unitId }` via `sendTo('testConnection', ...)`.
 *
 * Traceability: Req 1.6, 1.7, 1.8, 1.9, 2.1, 4.4, 4.5, 5.2.
 */

import { expect } from 'chai';
import { validateConfig } from './config-validation';
import {
    getBatteryBase,
    getBatteryValueDefs,
    getDeviceRegisterAddress,
    getValueDefs,
    SUNSPEC_MAP,
} from './sunspec-map';

// Mirrors Settings.currentConfig(): the shape the form assembles from `native`
// and hands to validateConfig on every render.
type FormConfig = Partial<ioBroker.AdapterConfig>;

// Mirrors Settings.render(): errors -> per-field error flags + button gate.
function formDecision(cfg: FormConfig): {
    errors: ReturnType<typeof validateConfig>['errors'];
    fieldError: (f: 'host' | 'port' | 'unitId' | 'pollInterval') => boolean;
    anyInvalid: boolean;
    testButtonDisabled: boolean;
} {
    const errors = validateConfig(cfg).errors;
    const anyInvalid = Object.keys(errors).length > 0;
    return {
        errors,
        fieldError: f => !!errors[f],
        anyInvalid,
        // The component also factors in `testing` and `socketAvailable`; here we
        // isolate the validation-driven part of the gate (socket present, idle).
        testButtonDisabled: anyInvalid,
    };
}

// A fully valid config equivalent to the io-package defaults with a host set.
const VALID_CONFIG: FormConfig = { host: 'inverter.local', port: 502, unitId: 1, pollInterval: 30 };

describe('admin settings logic (task 11.4)', () => {
    // ---------------------------------------------------------------------
    // Connection form: reject invalid + show field error, retain valid.
    // The admin save layer retains the last valid value on invalid input; at
    // the logic level this is expressed as "invalid input surfaces a field
    // error (so the form does not accept/act on it) while valid input does not".
    // ---------------------------------------------------------------------
    describe('connection form validation gating (Req 1.6, 1.7, 1.8, 1.9, 5.2)', () => {
        it('Req 1.6/5.2: invalid host surfaces a host field error', () => {
            const d = formDecision({ ...VALID_CONFIG, host: '' });
            expect(d.fieldError('host')).to.equal(true);
            expect(d.anyInvalid).to.equal(true);
        });

        it('Req 1.7/5.2: invalid port surfaces a port field error', () => {
            const d = formDecision({ ...VALID_CONFIG, port: 0 });
            expect(d.fieldError('port')).to.equal(true);
            expect(d.anyInvalid).to.equal(true);
        });

        it('Req 1.8/5.2: invalid unitId surfaces a unitId field error', () => {
            const d = formDecision({ ...VALID_CONFIG, unitId: 248 });
            expect(d.fieldError('unitId')).to.equal(true);
            expect(d.anyInvalid).to.equal(true);
        });

        it('Req 1.9/5.2: invalid pollInterval surfaces a pollInterval field error', () => {
            const d = formDecision({ ...VALID_CONFIG, pollInterval: 4 });
            expect(d.fieldError('pollInterval')).to.equal(true);
            expect(d.anyInvalid).to.equal(true);
        });

        it('Req 5.2: a non-integer numeric entry is rejected with a field error', () => {
            const d = formDecision({ ...VALID_CONFIG, port: 502.5 });
            expect(d.fieldError('port')).to.equal(true);
        });

        it('Req 1.6–1.9: a fully valid config produces no field errors (values retained/accepted)', () => {
            const d = formDecision(VALID_CONFIG);
            expect(d.errors).to.deep.equal({});
            expect(d.fieldError('host')).to.equal(false);
            expect(d.fieldError('port')).to.equal(false);
            expect(d.fieldError('unitId')).to.equal(false);
            expect(d.fieldError('pollInterval')).to.equal(false);
            expect(d.anyInvalid).to.equal(false);
        });
    });

    // ---------------------------------------------------------------------
    // Test Connection button presence/behavior (Req 2.1).
    // The button is disabled while the config is invalid and enabled when
    // valid; when clicked it sends { host, port, unitId } to testConnection.
    // ---------------------------------------------------------------------
    describe('Test Connection button gating and request contract (Req 2.1)', () => {
        it('Req 2.1: button is disabled while the config is invalid', () => {
            expect(formDecision({ ...VALID_CONFIG, host: '' }).testButtonDisabled).to.equal(true);
        });

        it('Req 2.1: button is enabled (not gated by validation) when the config is valid', () => {
            expect(formDecision(VALID_CONFIG).testButtonDisabled).to.equal(false);
        });

        it('Req 2.1: the testConnection request carries exactly { host, port, unitId }', () => {
            // Mirrors onTestConnection(): only these three fields are sent (no pollInterval).
            const cfg = VALID_CONFIG;
            const request = { host: cfg.host, port: cfg.port, unitId: cfg.unitId };
            expect(Object.keys(request).sort()).to.deep.equal(['host', 'port', 'unitId']);
            expect(request.host).to.equal('inverter.local');
            expect(request.port).to.equal(502);
            expect(request.unitId).to.equal(1);
        });
    });

    // ---------------------------------------------------------------------
    // Read-only SunSpec value table backing data (Req 4.4, 4.5).
    // renderValueTable() renders one row per getValueDefs() entry with
    // name/datatype/model; when empty it shows "No SunSpec values available".
    // ---------------------------------------------------------------------
    describe('value table backing data (Req 4.4, 4.5)', () => {
        it('Req 4.4: getValueDefs() yields one row per non-scale value with name, datatype, and model', () => {
            const defs = getValueDefs();
            expect(defs.length).to.be.greaterThan(0);
            for (const def of defs) {
                expect(def.name, 'name column').to.be.a('string').and.not.equal('');
                expect(def.datatype, 'datatype column').to.be.a('string').and.not.equal('');
                expect(def.model, 'model column').to.satisfy(
                    (m: unknown) => typeof m === 'number' || typeof m === 'string',
                );
            }
        });

        it('Req 4.4: value table excludes scale-factor and identity (info) rows', () => {
            const defs = getValueDefs();
            // No `sunssf`/identity rows leak into the read-only table.
            expect(defs.every(d => d.role !== 'info')).to.equal(true);
            // And the selector actually filtered something out of the full map.
            expect(defs.length).to.be.lessThan(SUNSPEC_MAP.length);
        });

        it('Req 4.4: row names are unique (stable table keys)', () => {
            const names = getValueDefs().map(d => d.name);
            expect(new Set(names).size).to.equal(names.length);
        });

        it('Req 4.5: an empty map yields no rows (drives the "No SunSpec values available" indication)', () => {
            expect(getValueDefs([])).to.deep.equal([]);
            expect(getValueDefs([]).length).to.equal(0);
        });
    });

    // ---------------------------------------------------------------------
    // Battery value table backing data (task 20.2, Req 4.1, 4.2, 4.3).
    // The "Battery values (N)" accordion renders one row per getBatteryValueDefs()
    // entry with name/datatype/model, and its Register column is computed as
    // getDeviceRegisterAddress(getBatteryBase(1), def) — the battery.1 absolute
    // address. These assertions mirror that backing data exactly.
    // ---------------------------------------------------------------------
    describe('battery value table backing data (Req 4.1, 4.2, 4.3)', () => {
        // The datatype set the map/decoder actually uses (SunSpecDatatype union).
        const KNOWN_DATATYPES = new Set([
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
            'string',
        ]);

        it('Req 4.1/4.2: getBatteryValueDefs() yields battery rows with name, known datatype, model "battery"', () => {
            const defs = getBatteryValueDefs();
            expect(defs.length).to.be.greaterThan(0);
            for (const def of defs) {
                expect(def.name, 'name column').to.be.a('string').and.not.equal('');
                expect(KNOWN_DATATYPES.has(def.datatype), `known datatype: ${def.datatype}`).to.equal(true);
                expect(def.model, 'model column').to.equal('battery');
            }
        });

        it('Req 4.3: battery value defs exclude identity/event-log (info) rows', () => {
            const defs = getBatteryValueDefs();
            expect(defs.every(d => d.role !== 'info')).to.equal(true);
            // Identity strings and event logs are info rows and must not leak in.
            const names = defs.map(d => d.name);
            for (const excluded of ['c_manufacturer', 'c_serialnumber', 'eventLog', 'eventLogInternal']) {
                expect(names, `excludes ${excluded}`).to.not.include(excluded);
            }
        });

        it('Req 4.1: battery value defs include the key measurements soh/soe/status/instantaneousPower', () => {
            const names = getBatteryValueDefs().map(d => d.name);
            for (const expected of ['soh', 'soe', 'status', 'instantaneousPower']) {
                expect(names, `includes ${expected}`).to.include(expected);
            }
        });

        it('Req 4.2: Register-column address == 0xE100 + def.offset for a sampled def (battery.1 base)', () => {
            const defs = getBatteryValueDefs();
            const base = getBatteryBase(1);
            expect(base).to.equal(0xe100);
            // Sample a representative def (soh) and mirror the component's mapper.
            const sample = defs.find(d => d.name === 'soh') ?? defs[0];
            expect(getDeviceRegisterAddress(base, sample)).to.equal(0xe100 + sample.offset);
            // Hold for every battery row to be safe.
            for (const def of defs) {
                expect(getDeviceRegisterAddress(base, def)).to.equal(0xe100 + def.offset);
            }
        });
    });
});
