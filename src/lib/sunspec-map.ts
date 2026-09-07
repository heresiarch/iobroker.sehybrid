// Static SunSpec register map for the SolarEdge SunSpec reader.
//
// This module is pure, static data describing every SunSpec register the adapter
// reads: name, model, word offset from the model block base, register length,
// datatype, scale-factor reference, unit, logical role, and resolved ioBroker type.
// It is shared by the SunSpecReader (to read/decode blocks) and the admin value
// table (Req 4). Addresses follow the SolarEdge SunSpec implementation technical
// note (`input/sunspec-implementation-technical-note-10.pdf`). All words are
// big-endian; multi-word values (int32/uint32/acc32/float32) occupy 2 registers,
// most-significant word first.
//
// Requirements: 3.7, 4.1, 4.2, 4.3, 6.3, 6.4, 6.5, 6.6, 6.7

import type { SunSpecDatatype } from './sunspec-decode';

/**
 * Logical physical quantity of a value, used to pick the ioBroker `common.role`
 * when the state object is created (Req 6.4).
 */
export type SunSpecRole =
    | 'current'
    | 'voltage'
    | 'power'
    | 'power.reactive'
    | 'power.apparent'
    | 'powerFactor'
    | 'frequency'
    | 'energy'
    | 'temperature'
    | 'percent'
    | 'status'
    | 'info';

/** One SunSpec register value definition (design "Components and Interfaces"). */
export interface SunSpecRegisterDef {
    /** Stable key used as the ioBroker state id leaf, e.g. "acPower". */
    name: string;
    /** SunSpec model this value belongs to (Req 4.3). `'common'` = identity block, `'battery'` = battery block. */
    model: 101 | 102 | 103 | 201 | 202 | 203 | 204 | 'common' | 'battery';
    /**
     * Register offset in words from the model block base address
     * (base-0 register number minus the block base constant).
     */
    offset: number;
    /** Number of 16-bit registers occupied by this value. */
    length: number;
    datatype: SunSpecDatatype;
    /** Name of the `sunssf` register that scales this value, if any (Req 3.6). */
    scaleFactorRef?: string;
    /** Physical unit for `common.unit`; omitted when unitless (Req 6.5, 6.6). */
    unit?: string;
    /** Logical quantity, drives role selection (Req 6.4). */
    role: SunSpecRole;
    /** Resolved ioBroker `common.type` (Req 6.3). */
    iobType: 'number' | 'string';
    /** Human-readable SunSpec register name + description (for the admin value table). */
    description?: string;
}

/** Common block base: C_SunSpec_ID "SunS" at 40000 (base-0). */
export const COMMON_BASE = 40000;
/** Inverter block base: model id at 40069 (base-0). */
export const INVERTER_BASE = 40069;
/**
 * Meter block base: the 1st meter's block region begins at 40000 + 121 = 40121
 * (base-0), per the technical note's "Meter's base address" table. All meter
 * offsets below are computed relative to this constant.
 */
export const METER_BASE = 40121;

// -----------------------------------------------------------------------------
// Device-block bases + per-device word offsets (Req 9, 10)
// -----------------------------------------------------------------------------
// A device block pairs a register template (defs expressed as word offsets from a
// block base) with a per-device word offset and a DID (presence) register. The meter
// and battery templates are declared once and instantiated per device by adding the
// slot's offset to the template base. Values are grounded in the SolarEdge technical
// note and the nmakel/solaredge_modbus reference register maps.

/** Meter DID (presence) register base: meter.1 DID at 40188 (0x9CFC, base-0). */
export const METER_DID_BASE = 40188;
/** Per-meter word offsets: meter.1/2/3 at +0 / +174 (0xAE) / +348 (0x15C). */
export const METER_REGISTER_OFFSETS = [0, 174, 348] as const;
/** Battery block template base: battery.1 base at 0xE100 (57600, base-0). */
export const BATTERY_TEMPLATE_BASE = 0xe100;
/** Battery DID (presence) register base: battery.1 DID at 0xE140 (57664, base-0). */
export const BATTERY_DID_BASE = 0xe140;
/** Per-battery word offsets: battery.1/2 at +0 / +256 (0x100). */
export const BATTERY_REGISTER_OFFSETS = [0, 256] as const;

// NOTE on model tagging for shared blocks:
// SolarEdge exposes a single register layout that all three inverter models
// (101 single-phase / 102 split-phase / 103 three-phase) share, and a single
// meter layout shared by all four meter models (201/202/203/204). The register
// map only needs ONE row per value, so the inverter rows are tagged with the
// canonical model 101 and the meter rows with the canonical model 201. The
// reader (a later task) reads the actual DID from the device and applies the
// detected model at read time; the value table uses these canonical tags to
// show which SunSpec family a value belongs to (Req 4.3).

/**
 * The complete static SunSpec register map. Identity (`'common'`, role `'info'`)
 * and scale-factor (`sunssf`) rows are retained here; the non-scale value selector
 * helper (task 4.2) filters them for the value table and the reader.
 */
export const SUNSPEC_MAP: SunSpecRegisterDef[] = [
    // --- Common block (base 40000): identity / detection (Req 3.3) ---------------
    // C_SunSpec_ID must equal 0x53756e53 ("SunS"). These are not measurement states.
    {
        name: 'C_SunSpec_ID',
        model: 'common',
        offset: 40000 - COMMON_BASE,
        length: 2,
        datatype: 'uint32',
        role: 'info',
        iobType: 'number',
    },
    {
        name: 'C_SunSpec_DID',
        model: 'common',
        offset: 40002 - COMMON_BASE,
        length: 1,
        datatype: 'uint16',
        role: 'info',
        iobType: 'number',
    },
    {
        name: 'C_SunSpec_Length',
        model: 'common',
        offset: 40003 - COMMON_BASE,
        length: 1,
        datatype: 'uint16',
        role: 'info',
        iobType: 'number',
    },
    {
        name: 'C_Manufacturer',
        model: 'common',
        offset: 40004 - COMMON_BASE,
        length: 16,
        datatype: 'string',
        role: 'info',
        iobType: 'string',
    },
    {
        name: 'C_Model',
        model: 'common',
        offset: 40020 - COMMON_BASE,
        length: 16,
        datatype: 'string',
        role: 'info',
        iobType: 'string',
    },
    {
        name: 'C_DeviceAddress',
        model: 'common',
        offset: 40068 - COMMON_BASE,
        length: 1,
        datatype: 'uint16',
        role: 'info',
        iobType: 'number',
    },

    // --- Inverter block (models 101/102/103, base 40069) -------------------------
    // Tagged with canonical model 101 (see NOTE above). offset = addr - INVERTER_BASE.
    {
        name: 'acCurrent',
        model: 101,
        offset: 40071 - INVERTER_BASE,
        length: 1,
        datatype: 'uint16',
        scaleFactorRef: 'acCurrentSF',
        unit: 'A',
        role: 'current',
        iobType: 'number',
        description: 'I_AC_Current — AC Total Current value',
    },
    {
        name: 'acCurrentA',
        model: 101,
        offset: 40072 - INVERTER_BASE,
        length: 1,
        datatype: 'uint16',
        scaleFactorRef: 'acCurrentSF',
        unit: 'A',
        role: 'current',
        iobType: 'number',
        description: 'I_AC_CurrentA — AC Phase A Current value',
    },
    {
        name: 'acCurrentB',
        model: 101,
        offset: 40073 - INVERTER_BASE,
        length: 1,
        datatype: 'uint16',
        scaleFactorRef: 'acCurrentSF',
        unit: 'A',
        role: 'current',
        iobType: 'number',
        description: 'I_AC_CurrentB — AC Phase B Current value',
    },
    {
        name: 'acCurrentC',
        model: 101,
        offset: 40074 - INVERTER_BASE,
        length: 1,
        datatype: 'uint16',
        scaleFactorRef: 'acCurrentSF',
        unit: 'A',
        role: 'current',
        iobType: 'number',
        description: 'I_AC_CurrentC — AC Phase C Current value',
    },
    {
        name: 'acCurrentSF',
        model: 101,
        offset: 40075 - INVERTER_BASE,
        length: 1,
        datatype: 'sunssf',
        role: 'info',
        iobType: 'number',
    },
    {
        name: 'acVoltageAB',
        model: 101,
        offset: 40076 - INVERTER_BASE,
        length: 1,
        datatype: 'uint16',
        scaleFactorRef: 'acVoltageSF',
        unit: 'V',
        role: 'voltage',
        iobType: 'number',
        description: 'I_AC_VoltageAB — AC Voltage Phase AB value',
    },
    {
        name: 'acVoltageBC',
        model: 101,
        offset: 40077 - INVERTER_BASE,
        length: 1,
        datatype: 'uint16',
        scaleFactorRef: 'acVoltageSF',
        unit: 'V',
        role: 'voltage',
        iobType: 'number',
        description: 'I_AC_VoltageBC — AC Voltage Phase BC value',
    },
    {
        name: 'acVoltageCA',
        model: 101,
        offset: 40078 - INVERTER_BASE,
        length: 1,
        datatype: 'uint16',
        scaleFactorRef: 'acVoltageSF',
        unit: 'V',
        role: 'voltage',
        iobType: 'number',
        description: 'I_AC_VoltageCA — AC Voltage Phase CA value',
    },
    {
        name: 'acVoltageAN',
        model: 101,
        offset: 40079 - INVERTER_BASE,
        length: 1,
        datatype: 'uint16',
        scaleFactorRef: 'acVoltageSF',
        unit: 'V',
        role: 'voltage',
        iobType: 'number',
        description: 'I_AC_VoltageAN — AC Voltage Phase A to N value',
    },
    {
        name: 'acVoltageBN',
        model: 101,
        offset: 40080 - INVERTER_BASE,
        length: 1,
        datatype: 'uint16',
        scaleFactorRef: 'acVoltageSF',
        unit: 'V',
        role: 'voltage',
        iobType: 'number',
        description: 'I_AC_VoltageBN — AC Voltage Phase B to N value',
    },
    {
        name: 'acVoltageCN',
        model: 101,
        offset: 40081 - INVERTER_BASE,
        length: 1,
        datatype: 'uint16',
        scaleFactorRef: 'acVoltageSF',
        unit: 'V',
        role: 'voltage',
        iobType: 'number',
        description: 'I_AC_VoltageCN — AC Voltage Phase C to N value',
    },
    {
        name: 'acVoltageSF',
        model: 101,
        offset: 40082 - INVERTER_BASE,
        length: 1,
        datatype: 'sunssf',
        role: 'info',
        iobType: 'number',
    },
    {
        name: 'acPower',
        model: 101,
        offset: 40083 - INVERTER_BASE,
        length: 1,
        datatype: 'int16',
        scaleFactorRef: 'acPowerSF',
        unit: 'W',
        role: 'power',
        iobType: 'number',
        description: 'I_AC_Power — AC Power value',
    },
    {
        name: 'acPowerSF',
        model: 101,
        offset: 40084 - INVERTER_BASE,
        length: 1,
        datatype: 'sunssf',
        role: 'info',
        iobType: 'number',
    },
    {
        name: 'acFrequency',
        model: 101,
        offset: 40085 - INVERTER_BASE,
        length: 1,
        datatype: 'uint16',
        scaleFactorRef: 'acFrequencySF',
        unit: 'Hz',
        role: 'frequency',
        iobType: 'number',
        description: 'I_AC_Frequency — AC Frequency value',
    },
    {
        name: 'acFrequencySF',
        model: 101,
        offset: 40086 - INVERTER_BASE,
        length: 1,
        datatype: 'sunssf',
        role: 'info',
        iobType: 'number',
    },
    {
        name: 'acVA',
        model: 101,
        offset: 40087 - INVERTER_BASE,
        length: 1,
        datatype: 'int16',
        scaleFactorRef: 'acVASF',
        unit: 'VA',
        role: 'power.apparent',
        iobType: 'number',
        description: 'I_AC_VA — Apparent Power',
    },
    {
        name: 'acVASF',
        model: 101,
        offset: 40088 - INVERTER_BASE,
        length: 1,
        datatype: 'sunssf',
        role: 'info',
        iobType: 'number',
    },
    {
        name: 'acVAR',
        model: 101,
        offset: 40089 - INVERTER_BASE,
        length: 1,
        datatype: 'int16',
        scaleFactorRef: 'acVARSF',
        unit: 'var',
        role: 'power.reactive',
        iobType: 'number',
        description: 'I_AC_VAR — Reactive Power',
    },
    {
        name: 'acVARSF',
        model: 101,
        offset: 40090 - INVERTER_BASE,
        length: 1,
        datatype: 'sunssf',
        role: 'info',
        iobType: 'number',
    },
    {
        name: 'acPF',
        model: 101,
        offset: 40091 - INVERTER_BASE,
        length: 1,
        datatype: 'int16',
        scaleFactorRef: 'acPFSF',
        unit: '%',
        role: 'powerFactor',
        iobType: 'number',
        description: 'I_AC_PF — Power Factor',
    },
    {
        name: 'acPFSF',
        model: 101,
        offset: 40092 - INVERTER_BASE,
        length: 1,
        datatype: 'sunssf',
        role: 'info',
        iobType: 'number',
    },
    {
        name: 'acEnergyWh',
        model: 101,
        offset: 40093 - INVERTER_BASE,
        length: 2,
        datatype: 'acc32',
        scaleFactorRef: 'acEnergyWhSF',
        unit: 'Wh',
        role: 'energy',
        iobType: 'number',
        description: 'I_AC_Energy_WH — AC Lifetime Energy production',
    },
    {
        name: 'acEnergyWhSF',
        model: 101,
        offset: 40095 - INVERTER_BASE,
        length: 1,
        datatype: 'sunssf',
        role: 'info',
        iobType: 'number',
    },
    {
        name: 'dcCurrent',
        model: 101,
        offset: 40096 - INVERTER_BASE,
        length: 1,
        datatype: 'uint16',
        scaleFactorRef: 'dcCurrentSF',
        unit: 'A',
        role: 'current',
        iobType: 'number',
        description: 'I_DC_Current — DC Current value',
    },
    {
        name: 'dcCurrentSF',
        model: 101,
        offset: 40097 - INVERTER_BASE,
        length: 1,
        datatype: 'sunssf',
        role: 'info',
        iobType: 'number',
    },
    {
        name: 'dcVoltage',
        model: 101,
        offset: 40098 - INVERTER_BASE,
        length: 1,
        datatype: 'uint16',
        scaleFactorRef: 'dcVoltageSF',
        unit: 'V',
        role: 'voltage',
        iobType: 'number',
        description: 'I_DC_Voltage — DC Voltage value',
    },
    {
        name: 'dcVoltageSF',
        model: 101,
        offset: 40099 - INVERTER_BASE,
        length: 1,
        datatype: 'sunssf',
        role: 'info',
        iobType: 'number',
    },
    {
        name: 'dcPower',
        model: 101,
        offset: 40100 - INVERTER_BASE,
        length: 1,
        datatype: 'int16',
        scaleFactorRef: 'dcPowerSF',
        unit: 'W',
        role: 'power',
        iobType: 'number',
        description: 'I_DC_Power — DC Power value',
    },
    {
        name: 'dcPowerSF',
        model: 101,
        offset: 40101 - INVERTER_BASE,
        length: 1,
        datatype: 'sunssf',
        role: 'info',
        iobType: 'number',
    },
    {
        name: 'tempSink',
        model: 101,
        offset: 40103 - INVERTER_BASE,
        length: 1,
        datatype: 'int16',
        scaleFactorRef: 'tempSF',
        unit: '°C',
        role: 'temperature',
        iobType: 'number',
        description: 'I_Temp_Sink — Heat Sink Temperature',
    },
    {
        name: 'tempSF',
        model: 101,
        offset: 40106 - INVERTER_BASE,
        length: 1,
        datatype: 'sunssf',
        role: 'info',
        iobType: 'number',
    },
    {
        name: 'status',
        model: 101,
        offset: 40107 - INVERTER_BASE,
        length: 1,
        datatype: 'uint16',
        role: 'status',
        iobType: 'number',
        description: 'I_Status — Operating State',
    },
    {
        name: 'statusVendor',
        model: 101,
        offset: 40108 - INVERTER_BASE,
        length: 1,
        datatype: 'uint16',
        role: 'status',
        iobType: 'number',
        description: 'I_Status_Vendor — Vendor-defined operating state and error codes',
    },

    // --- Meter block (models 201/202/203/204, base 40121) ------------------------
    // Tagged with canonical model 201 (see NOTE above). offset = addr - METER_BASE.
    // Addresses (base-0) from the technical note "Meter 1" MODBUS mapping:
    //   M_AC_Current 40190, M_AC_Current_SF 40194, M_AC_Voltage_LN 40195,
    //   M_AC_Voltage_SF 40203, M_AC_Freq 40204, M_AC_Freq_SF 40205,
    //   M_AC_Power 40206, M_AC_Power_SF 40210, M_Exported 40226 (uint32/acc32),
    //   M_Imported 40234 (uint32/acc32), M_Energy_W_SF 40242.
    {
        name: 'mCurrent',
        model: 201,
        offset: 40190 - METER_BASE,
        length: 1,
        datatype: 'int16',
        scaleFactorRef: 'mCurrentSF',
        unit: 'A',
        role: 'current',
        iobType: 'number',
        description: 'M_AC_Current — AC Current (sum of active phases)',
    },
    {
        name: 'mCurrentA',
        model: 201,
        offset: 40191 - METER_BASE,
        length: 1,
        datatype: 'int16',
        scaleFactorRef: 'mCurrentSF',
        unit: 'A',
        role: 'current',
        iobType: 'number',
        description: 'M_AC_Current_A — Phase A AC Current',
    },
    {
        name: 'mCurrentB',
        model: 201,
        offset: 40192 - METER_BASE,
        length: 1,
        datatype: 'int16',
        scaleFactorRef: 'mCurrentSF',
        unit: 'A',
        role: 'current',
        iobType: 'number',
        description: 'M_AC_Current_B — Phase B AC Current',
    },
    {
        name: 'mCurrentC',
        model: 201,
        offset: 40193 - METER_BASE,
        length: 1,
        datatype: 'int16',
        scaleFactorRef: 'mCurrentSF',
        unit: 'A',
        role: 'current',
        iobType: 'number',
        description: 'M_AC_Current_C — Phase C AC Current',
    },
    {
        name: 'mCurrentSF',
        model: 201,
        offset: 40194 - METER_BASE,
        length: 1,
        datatype: 'sunssf',
        role: 'info',
        iobType: 'number',
    },
    {
        name: 'mVoltageLN',
        model: 201,
        offset: 40195 - METER_BASE,
        length: 1,
        datatype: 'int16',
        scaleFactorRef: 'mVoltageSF',
        unit: 'V',
        role: 'voltage',
        iobType: 'number',
        description: 'M_AC_Voltage_LN — Line to Neutral AC Voltage',
    },
    {
        name: 'mVoltageAN',
        model: 201,
        offset: 40196 - METER_BASE,
        length: 1,
        datatype: 'int16',
        scaleFactorRef: 'mVoltageSF',
        unit: 'V',
        role: 'voltage',
        iobType: 'number',
        description: 'M_AC_Voltage_AN — Phase A to Neutral AC Voltage',
    },
    {
        name: 'mVoltageBN',
        model: 201,
        offset: 40197 - METER_BASE,
        length: 1,
        datatype: 'int16',
        scaleFactorRef: 'mVoltageSF',
        unit: 'V',
        role: 'voltage',
        iobType: 'number',
        description: 'M_AC_Voltage_BN — Phase B to Neutral AC Voltage',
    },
    {
        name: 'mVoltageCN',
        model: 201,
        offset: 40198 - METER_BASE,
        length: 1,
        datatype: 'int16',
        scaleFactorRef: 'mVoltageSF',
        unit: 'V',
        role: 'voltage',
        iobType: 'number',
        description: 'M_AC_Voltage_CN — Phase C to Neutral AC Voltage',
    },
    {
        name: 'mVoltageLL',
        model: 201,
        offset: 40199 - METER_BASE,
        length: 1,
        datatype: 'int16',
        scaleFactorRef: 'mVoltageSF',
        unit: 'V',
        role: 'voltage',
        iobType: 'number',
        description: 'M_AC_Voltage_LL — Line to Line AC Voltage',
    },
    {
        name: 'mVoltageAB',
        model: 201,
        offset: 40200 - METER_BASE,
        length: 1,
        datatype: 'int16',
        scaleFactorRef: 'mVoltageSF',
        unit: 'V',
        role: 'voltage',
        iobType: 'number',
        description: 'M_AC_Voltage_AB — Phase A to Phase B AC Voltage',
    },
    {
        name: 'mVoltageBC',
        model: 201,
        offset: 40201 - METER_BASE,
        length: 1,
        datatype: 'int16',
        scaleFactorRef: 'mVoltageSF',
        unit: 'V',
        role: 'voltage',
        iobType: 'number',
        description: 'M_AC_Voltage_BC — Phase B to Phase C AC Voltage',
    },
    {
        name: 'mVoltageCA',
        model: 201,
        offset: 40202 - METER_BASE,
        length: 1,
        datatype: 'int16',
        scaleFactorRef: 'mVoltageSF',
        unit: 'V',
        role: 'voltage',
        iobType: 'number',
        description: 'M_AC_Voltage_CA — Phase C to Phase A AC Voltage',
    },
    {
        name: 'mVoltageSF',
        model: 201,
        offset: 40203 - METER_BASE,
        length: 1,
        datatype: 'sunssf',
        role: 'info',
        iobType: 'number',
    },
    {
        name: 'mFrequency',
        model: 201,
        offset: 40204 - METER_BASE,
        length: 1,
        datatype: 'int16',
        scaleFactorRef: 'mFrequencySF',
        unit: 'Hz',
        role: 'frequency',
        iobType: 'number',
        description: 'M_AC_Freq — AC Frequency',
    },
    {
        name: 'mFrequencySF',
        model: 201,
        offset: 40205 - METER_BASE,
        length: 1,
        datatype: 'sunssf',
        role: 'info',
        iobType: 'number',
    },
    {
        name: 'mPower',
        model: 201,
        offset: 40206 - METER_BASE,
        length: 1,
        datatype: 'int16',
        scaleFactorRef: 'mPowerSF',
        unit: 'W',
        role: 'power',
        iobType: 'number',
        description: 'M_AC_Power — Total Real Power (sum of active phases)',
    },
    {
        name: 'mPowerA',
        model: 201,
        offset: 40207 - METER_BASE,
        length: 1,
        datatype: 'int16',
        scaleFactorRef: 'mPowerSF',
        unit: 'W',
        role: 'power',
        iobType: 'number',
        description: 'M_AC_Power_A — Phase A AC Real Power',
    },
    {
        name: 'mPowerB',
        model: 201,
        offset: 40208 - METER_BASE,
        length: 1,
        datatype: 'int16',
        scaleFactorRef: 'mPowerSF',
        unit: 'W',
        role: 'power',
        iobType: 'number',
        description: 'M_AC_Power_B — Phase B AC Real Power',
    },
    {
        name: 'mPowerC',
        model: 201,
        offset: 40209 - METER_BASE,
        length: 1,
        datatype: 'int16',
        scaleFactorRef: 'mPowerSF',
        unit: 'W',
        role: 'power',
        iobType: 'number',
        description: 'M_AC_Power_C — Phase C AC Real Power',
    },
    {
        name: 'mPowerSF',
        model: 201,
        offset: 40210 - METER_BASE,
        length: 1,
        datatype: 'sunssf',
        role: 'info',
        iobType: 'number',
    },
    {
        name: 'mVA',
        model: 201,
        offset: 40211 - METER_BASE,
        length: 1,
        datatype: 'int16',
        scaleFactorRef: 'mVASF',
        unit: 'VA',
        role: 'power.apparent',
        iobType: 'number',
        description: 'M_AC_VA — Total AC Apparent Power (sum of active phases)',
    },
    {
        name: 'mVAA',
        model: 201,
        offset: 40212 - METER_BASE,
        length: 1,
        datatype: 'int16',
        scaleFactorRef: 'mVASF',
        unit: 'VA',
        role: 'power.apparent',
        iobType: 'number',
        description: 'M_AC_VA_A — Phase A AC Apparent Power',
    },
    {
        name: 'mVAB',
        model: 201,
        offset: 40213 - METER_BASE,
        length: 1,
        datatype: 'int16',
        scaleFactorRef: 'mVASF',
        unit: 'VA',
        role: 'power.apparent',
        iobType: 'number',
        description: 'M_AC_VA_B — Phase B AC Apparent Power',
    },
    {
        name: 'mVAC',
        model: 201,
        offset: 40214 - METER_BASE,
        length: 1,
        datatype: 'int16',
        scaleFactorRef: 'mVASF',
        unit: 'VA',
        role: 'power.apparent',
        iobType: 'number',
        description: 'M_AC_VA_C — Phase C AC Apparent Power',
    },
    {
        name: 'mVASF',
        model: 201,
        offset: 40215 - METER_BASE,
        length: 1,
        datatype: 'sunssf',
        role: 'info',
        iobType: 'number',
    },
    {
        name: 'mVAR',
        model: 201,
        offset: 40216 - METER_BASE,
        length: 1,
        datatype: 'int16',
        scaleFactorRef: 'mVARSF',
        unit: 'var',
        role: 'power.reactive',
        iobType: 'number',
        description: 'M_AC_VAR — Total AC Reactive Power (sum of active phases)',
    },
    {
        name: 'mVARA',
        model: 201,
        offset: 40217 - METER_BASE,
        length: 1,
        datatype: 'int16',
        scaleFactorRef: 'mVARSF',
        unit: 'var',
        role: 'power.reactive',
        iobType: 'number',
        description: 'M_AC_VAR_A — Phase A AC Reactive Power',
    },
    {
        name: 'mVARB',
        model: 201,
        offset: 40218 - METER_BASE,
        length: 1,
        datatype: 'int16',
        scaleFactorRef: 'mVARSF',
        unit: 'var',
        role: 'power.reactive',
        iobType: 'number',
        description: 'M_AC_VAR_B — Phase B AC Reactive Power',
    },
    {
        name: 'mVARC',
        model: 201,
        offset: 40219 - METER_BASE,
        length: 1,
        datatype: 'int16',
        scaleFactorRef: 'mVARSF',
        unit: 'var',
        role: 'power.reactive',
        iobType: 'number',
        description: 'M_AC_VAR_C — Phase C AC Reactive Power',
    },
    {
        name: 'mVARSF',
        model: 201,
        offset: 40220 - METER_BASE,
        length: 1,
        datatype: 'sunssf',
        role: 'info',
        iobType: 'number',
    },
    {
        name: 'mPF',
        model: 201,
        offset: 40221 - METER_BASE,
        length: 1,
        datatype: 'int16',
        scaleFactorRef: 'mPFSF',
        unit: '%',
        role: 'powerFactor',
        iobType: 'number',
        description: 'M_AC_PF — Average Power Factor',
    },
    {
        name: 'mPFA',
        model: 201,
        offset: 40222 - METER_BASE,
        length: 1,
        datatype: 'int16',
        scaleFactorRef: 'mPFSF',
        unit: '%',
        role: 'powerFactor',
        iobType: 'number',
        description: 'M_AC_PF_A — Phase A Power Factor',
    },
    {
        name: 'mPFB',
        model: 201,
        offset: 40223 - METER_BASE,
        length: 1,
        datatype: 'int16',
        scaleFactorRef: 'mPFSF',
        unit: '%',
        role: 'powerFactor',
        iobType: 'number',
        description: 'M_AC_PF_B — Phase B Power Factor',
    },
    {
        name: 'mPFC',
        model: 201,
        offset: 40224 - METER_BASE,
        length: 1,
        datatype: 'int16',
        scaleFactorRef: 'mPFSF',
        unit: '%',
        role: 'powerFactor',
        iobType: 'number',
        description: 'M_AC_PF_C — Phase C Power Factor',
    },
    {
        name: 'mPFSF',
        model: 201,
        offset: 40225 - METER_BASE,
        length: 1,
        datatype: 'sunssf',
        role: 'info',
        iobType: 'number',
    },
    {
        name: 'mExportedWh',
        model: 201,
        offset: 40226 - METER_BASE,
        length: 2,
        datatype: 'acc32',
        scaleFactorRef: 'mEnergyWhSF',
        unit: 'Wh',
        role: 'energy',
        iobType: 'number',
        description: 'M_Exported — Total Exported Real Energy',
    },
    {
        name: 'mExportedWhA',
        model: 201,
        offset: 40228 - METER_BASE,
        length: 2,
        datatype: 'acc32',
        scaleFactorRef: 'mEnergyWhSF',
        unit: 'Wh',
        role: 'energy',
        iobType: 'number',
        description: 'M_Exported_A — Phase A Exported Real Energy',
    },
    {
        name: 'mExportedWhB',
        model: 201,
        offset: 40230 - METER_BASE,
        length: 2,
        datatype: 'acc32',
        scaleFactorRef: 'mEnergyWhSF',
        unit: 'Wh',
        role: 'energy',
        iobType: 'number',
        description: 'M_Exported_B — Phase B Exported Real Energy',
    },
    {
        name: 'mExportedWhC',
        model: 201,
        offset: 40232 - METER_BASE,
        length: 2,
        datatype: 'acc32',
        scaleFactorRef: 'mEnergyWhSF',
        unit: 'Wh',
        role: 'energy',
        iobType: 'number',
        description: 'M_Exported_C — Phase C Exported Real Energy',
    },
    {
        name: 'mImportedWh',
        model: 201,
        offset: 40234 - METER_BASE,
        length: 2,
        datatype: 'acc32',
        scaleFactorRef: 'mEnergyWhSF',
        unit: 'Wh',
        role: 'energy',
        iobType: 'number',
        description: 'M_Imported — Total Imported Real Energy',
    },
    {
        name: 'mImportedWhA',
        model: 201,
        offset: 40236 - METER_BASE,
        length: 2,
        datatype: 'acc32',
        scaleFactorRef: 'mEnergyWhSF',
        unit: 'Wh',
        role: 'energy',
        iobType: 'number',
        description: 'M_Imported_A — Phase A Imported Real Energy',
    },
    {
        name: 'mImportedWhB',
        model: 201,
        offset: 40238 - METER_BASE,
        length: 2,
        datatype: 'acc32',
        scaleFactorRef: 'mEnergyWhSF',
        unit: 'Wh',
        role: 'energy',
        iobType: 'number',
        description: 'M_Imported_B — Phase B Imported Real Energy',
    },
    {
        name: 'mImportedWhC',
        model: 201,
        offset: 40240 - METER_BASE,
        length: 2,
        datatype: 'acc32',
        scaleFactorRef: 'mEnergyWhSF',
        unit: 'Wh',
        role: 'energy',
        iobType: 'number',
        description: 'M_Imported_C — Phase C Imported Real Energy',
    },
    {
        name: 'mEnergyWhSF',
        model: 201,
        offset: 40242 - METER_BASE,
        length: 1,
        datatype: 'sunssf',
        role: 'info',
        iobType: 'number',
    },
];

/**
 * Absolute base-0 Modbus register address for a def = block base + offset.
 * Common block -> COMMON_BASE, inverter models -> INVERTER_BASE, meter models -> METER_BASE.
 *
 * @param def
 */
export function getRegisterAddress(def: SunSpecRegisterDef): number {
    if (def.model === 'common') {
        return COMMON_BASE + def.offset;
    }
    if (def.model === 201 || def.model === 202 || def.model === 203 || def.model === 204) {
        return METER_BASE + def.offset;
    }
    return INVERTER_BASE + def.offset;
}

// -----------------------------------------------------------------------------
// Non-scale value selectors (task 4.2)
// -----------------------------------------------------------------------------
// The value table (Req 4.1, 4.2, 4.3) and the reader/state-manager (Req 6.9)
// operate on measurement values only: the `sunssf` scale-factor registers
// (including `acEnergyWhSF`) and the `'common'` identity/detection block are
// internal plumbing and must not appear as rows or states.
// Every such row is tagged `role: 'info'` in SUNSPEC_MAP, while every
// measurement row carries a physical role (current/voltage/power/
// power.reactive/power.apparent/powerFactor/frequency/energy/temperature/
// status). Filtering on `role !== 'info'` therefore cleanly leaves exactly the
// non-scale, non-identity measurement value definitions.

/** Numeric inverter SunSpec models (single/split/three-phase share one layout). */
const INVERTER_MODELS: ReadonlySet<SunSpecRegisterDef['model']> = new Set([101, 102, 103]);
/** Numeric meter SunSpec models. */
const METER_MODELS: ReadonlySet<SunSpecRegisterDef['model']> = new Set([201, 202, 203, 204]);

/**
 * Value definitions that become measurement states / value-table rows.
 *
 * Excludes `sunssf` scale-factor registers (including `acEnergyWhSF`) and the
 * `'common'` identity block — all of which are tagged `role: 'info'` in the
 * map. The result contains only measurement values
 * that map to ioBroker states (Req 6.9) and value-table rows (Req 4.1).
 *
 * Pure: returns a new array and never mutates the input.
 *
 * @param map - Register map to filter; defaults to the module `SUNSPEC_MAP`.
 *              An override may be supplied for testing.
 */
export function getValueDefs(map: SunSpecRegisterDef[] = SUNSPEC_MAP): SunSpecRegisterDef[] {
    return map.filter(def => def.role !== 'info');
}

/**
 * Non-scale value defs for the numeric inverter models (101/102/103).
 *
 * @param map
 */
export function getInverterValueDefs(map: SunSpecRegisterDef[] = SUNSPEC_MAP): SunSpecRegisterDef[] {
    return getValueDefs(map).filter(def => INVERTER_MODELS.has(def.model));
}

/**
 * Non-scale value defs for the numeric meter models (201/202/203/204).
 *
 * @param map
 */
export function getMeterValueDefs(map: SunSpecRegisterDef[] = SUNSPEC_MAP): SunSpecRegisterDef[] {
    return getValueDefs(map).filter(def => METER_MODELS.has(def.model));
}

// -----------------------------------------------------------------------------
// Battery register template (model 'battery', base 0xE100) — Req 10.1, 10.2, 10.6, 10.7
// -----------------------------------------------------------------------------
// Offsets are WORD offsets relative to BATTERY_TEMPLATE_BASE (0xE100), i.e.
// offset = absAddr - 0xE100. The template is instantiated per battery slot by adding
// BATTERY_REGISTER_OFFSETS[slot-1] to the base. Battery values are already in
// engineering units (float32le / uint64) and carry NO scaleFactorRef.
//
// The block is NON-CONTIGUOUS (gaps between fields, e.g. 0xE14A..0xE16C); that is fine
// for the static map. The reader (task 17) reads the whole span and slices by offset.
//
// Addresses/datatypes follow the nmakel/solaredge_modbus battery register map. `soh`
// and `soe` use the `percent` role (unit '%') so they surface as value states, since
// value states are selected by `role !== 'info'` and `info` would hide them.
export const BATTERY_MAP: SunSpecRegisterDef[] = [
    {
        name: 'c_manufacturer',
        model: 'battery',
        offset: 0xe100 - BATTERY_TEMPLATE_BASE,
        length: 16,
        datatype: 'string',
        role: 'info',
        iobType: 'string',
        description: 'Battery C_Manufacturer — Manufacturer',
    },
    {
        name: 'c_model',
        model: 'battery',
        offset: 0xe110 - BATTERY_TEMPLATE_BASE,
        length: 16,
        datatype: 'string',
        role: 'info',
        iobType: 'string',
        description: 'Battery C_Model — Model',
    },
    {
        name: 'c_version',
        model: 'battery',
        offset: 0xe120 - BATTERY_TEMPLATE_BASE,
        length: 16,
        datatype: 'string',
        role: 'info',
        iobType: 'string',
        description: 'Battery C_Version — Firmware Version',
    },
    {
        name: 'c_serialnumber',
        model: 'battery',
        offset: 0xe130 - BATTERY_TEMPLATE_BASE,
        length: 16,
        datatype: 'string',
        role: 'info',
        iobType: 'string',
        description: 'Battery C_SerialNumber — Serial Number',
    },
    {
        name: 'c_deviceaddress',
        model: 'battery',
        offset: 0xe140 - BATTERY_TEMPLATE_BASE,
        length: 1,
        datatype: 'uint16',
        role: 'info',
        iobType: 'number',
        description: 'Battery C_DeviceAddress — Modbus ID',
    },
    {
        name: 'c_sunspec_did',
        model: 'battery',
        offset: 0xe141 - BATTERY_TEMPLATE_BASE,
        length: 1,
        datatype: 'uint16',
        role: 'info',
        iobType: 'number',
        description: 'Battery C_SunSpec_DID — SunSpec DID',
    },
    {
        name: 'ratedEnergy',
        model: 'battery',
        offset: 0xe142 - BATTERY_TEMPLATE_BASE,
        length: 2,
        datatype: 'float32le',
        unit: 'Wh',
        role: 'energy',
        iobType: 'number',
        description: 'Battery Rated_Energy — Rated Energy',
    },
    {
        name: 'maxChargeContinuousPower',
        model: 'battery',
        offset: 0xe144 - BATTERY_TEMPLATE_BASE,
        length: 2,
        datatype: 'float32le',
        unit: 'W',
        role: 'power',
        iobType: 'number',
        description: 'Battery Max_Charge_Continuous_Power — Maximum Charge Continuous Power',
    },
    {
        name: 'maxDischargeContinuousPower',
        model: 'battery',
        offset: 0xe146 - BATTERY_TEMPLATE_BASE,
        length: 2,
        datatype: 'float32le',
        unit: 'W',
        role: 'power',
        iobType: 'number',
        description: 'Battery Max_Discharge_Continuous_Power — Maximum Discharge Continuous Power',
    },
    {
        name: 'maxChargePeakPower',
        model: 'battery',
        offset: 0xe148 - BATTERY_TEMPLATE_BASE,
        length: 2,
        datatype: 'float32le',
        unit: 'W',
        role: 'power',
        iobType: 'number',
        description: 'Battery Max_Charge_Peak_Power — Maximum Charge Peak Power',
    },
    {
        name: 'maxDischargePeakPower',
        model: 'battery',
        offset: 0xe14a - BATTERY_TEMPLATE_BASE,
        length: 2,
        datatype: 'float32le',
        unit: 'W',
        role: 'power',
        iobType: 'number',
        description: 'Battery Max_Discharge_Peak_Power — Maximum Discharge Peak Power',
    },
    {
        name: 'averageTemperature',
        model: 'battery',
        offset: 0xe16c - BATTERY_TEMPLATE_BASE,
        length: 2,
        datatype: 'float32le',
        unit: '°C',
        role: 'temperature',
        iobType: 'number',
        description: 'Battery Average_Temperature — Average Temperature',
    },
    {
        name: 'maximumTemperature',
        model: 'battery',
        offset: 0xe16e - BATTERY_TEMPLATE_BASE,
        length: 2,
        datatype: 'float32le',
        unit: '°C',
        role: 'temperature',
        iobType: 'number',
        description: 'Battery Maximum_Temperature — Maximum Temperature',
    },
    {
        name: 'instantaneousVoltage',
        model: 'battery',
        offset: 0xe170 - BATTERY_TEMPLATE_BASE,
        length: 2,
        datatype: 'float32le',
        unit: 'V',
        role: 'voltage',
        iobType: 'number',
        description: 'Battery Instantaneous_Voltage — Instantaneous Voltage',
    },
    {
        name: 'instantaneousCurrent',
        model: 'battery',
        offset: 0xe172 - BATTERY_TEMPLATE_BASE,
        length: 2,
        datatype: 'float32le',
        unit: 'A',
        role: 'current',
        iobType: 'number',
        description: 'Battery Instantaneous_Current — Instantaneous Current',
    },
    {
        name: 'instantaneousPower',
        model: 'battery',
        offset: 0xe174 - BATTERY_TEMPLATE_BASE,
        length: 2,
        datatype: 'float32le',
        unit: 'W',
        role: 'power',
        iobType: 'number',
        description: 'Battery Instantaneous_Power — Instantaneous Power',
    },
    {
        name: 'lifetimeExportEnergy',
        model: 'battery',
        offset: 0xe176 - BATTERY_TEMPLATE_BASE,
        length: 4,
        datatype: 'uint64le',
        unit: 'Wh',
        role: 'energy',
        iobType: 'number',
        description: 'Battery Lifetime_Export_Energy — Total Exported Energy',
    },
    {
        name: 'lifetimeImportEnergy',
        model: 'battery',
        offset: 0xe17a - BATTERY_TEMPLATE_BASE,
        length: 4,
        datatype: 'uint64le',
        unit: 'Wh',
        role: 'energy',
        iobType: 'number',
        description: 'Battery Lifetime_Import_Energy — Total Imported Energy',
    },
    {
        name: 'maximumEnergy',
        model: 'battery',
        offset: 0xe17e - BATTERY_TEMPLATE_BASE,
        length: 2,
        datatype: 'float32le',
        unit: 'Wh',
        role: 'energy',
        iobType: 'number',
        description: 'Battery Maximum_Energy — Maximum Energy',
    },
    {
        name: 'availableEnergy',
        model: 'battery',
        offset: 0xe180 - BATTERY_TEMPLATE_BASE,
        length: 2,
        datatype: 'float32le',
        unit: 'Wh',
        role: 'energy',
        iobType: 'number',
        description: 'Battery Available_Energy — Available Energy',
    },
    {
        name: 'soh',
        model: 'battery',
        offset: 0xe182 - BATTERY_TEMPLATE_BASE,
        length: 2,
        datatype: 'float32le',
        unit: '%',
        role: 'percent',
        iobType: 'number',
        description: 'Battery SOH — State of Health',
    },
    {
        name: 'soe',
        model: 'battery',
        offset: 0xe184 - BATTERY_TEMPLATE_BASE,
        length: 2,
        datatype: 'float32le',
        unit: '%',
        role: 'percent',
        iobType: 'number',
        description: 'Battery SOE — State of Energy',
    },
    {
        name: 'status',
        model: 'battery',
        offset: 0xe186 - BATTERY_TEMPLATE_BASE,
        length: 2,
        datatype: 'uint32le',
        role: 'status',
        iobType: 'number',
        description: 'Battery Status — Status (0 Off,1 Standby,2 Init,3 Charge,4 Discharge,5 Fault,6 Idle)',
    },
    {
        name: 'statusInternal',
        model: 'battery',
        offset: 0xe188 - BATTERY_TEMPLATE_BASE,
        length: 2,
        datatype: 'uint32le',
        role: 'status',
        iobType: 'number',
        description: 'Battery Status_Internal — Internal Status',
    },
    {
        name: 'eventLog',
        model: 'battery',
        offset: 0xe18a - BATTERY_TEMPLATE_BASE,
        length: 1,
        datatype: 'uint16',
        role: 'info',
        iobType: 'number',
        description: 'Battery Event_Log — Event Log',
    },
    {
        name: 'eventLogInternal',
        model: 'battery',
        offset: 0xe192 - BATTERY_TEMPLATE_BASE,
        length: 1,
        datatype: 'uint16',
        role: 'info',
        iobType: 'number',
        description: 'Battery Event_Log_Internal — Internal Event Log',
    },
];

// -----------------------------------------------------------------------------
// Per-device address + presence helpers (task 16.2, Req 9.2, 10.2)
// -----------------------------------------------------------------------------

/**
 * Absolute base-0 Modbus register address for a def within a device block =
 * this device's block base address + the def's word offset.
 *
 * @param baseAddress - Absolute base-0 address of the device's block.
 * @param def - Register definition whose word offset is relative to that base.
 */
export function getDeviceRegisterAddress(baseAddress: number, def: SunSpecRegisterDef): number {
    return baseAddress + def.offset;
}

/**
 * Absolute base-0 address of a meter slot's block = METER_BASE + the slot's word offset.
 *
 * @param slot - 1-based meter slot (1, 2 or 3).
 */
export function getMeterBase(slot: 1 | 2 | 3): number {
    return METER_BASE + METER_REGISTER_OFFSETS[slot - 1];
}

/**
 * Absolute base-0 address of a meter slot's DID (presence) register =
 * METER_DID_BASE + the slot's word offset.
 *
 * @param slot - 1-based meter slot (1, 2 or 3).
 */
export function getMeterDidAddress(slot: 1 | 2 | 3): number {
    return METER_DID_BASE + METER_REGISTER_OFFSETS[slot - 1];
}

/**
 * Absolute base-0 address of a battery slot's block = BATTERY_TEMPLATE_BASE + the slot's offset.
 *
 * @param slot - 1-based battery slot (1 or 2).
 */
export function getBatteryBase(slot: 1 | 2): number {
    return BATTERY_TEMPLATE_BASE + BATTERY_REGISTER_OFFSETS[slot - 1];
}

/**
 * Absolute base-0 address of a battery slot's DID (presence) register =
 * BATTERY_DID_BASE + the slot's word offset.
 *
 * @param slot - 1-based battery slot (1 or 2).
 */
export function getBatteryDidAddress(slot: 1 | 2): number {
    return BATTERY_DID_BASE + BATTERY_REGISTER_OFFSETS[slot - 1];
}

/**
 * Battery measurement value defs (powers, temps, V/I/P, energies, soh, soe, status,
 * statusInternal) — excludes identity strings and event logs, which are tagged
 * `role: 'info'` analogous to {@link getValueDefs}.
 *
 * Pure: returns a new array and never mutates the input.
 *
 * @param map - Battery register map to filter; defaults to {@link BATTERY_MAP}.
 */
export function getBatteryValueDefs(map: SunSpecRegisterDef[] = BATTERY_MAP): SunSpecRegisterDef[] {
    return map.filter(def => def.role !== 'info');
}

// -----------------------------------------------------------------------------
// Battery block read segments (bug fix, verified against a live SolarEdge
// "Home Battery 48V - 2 modules" at 192.168.178.4:1502).
// -----------------------------------------------------------------------------
// Battery read layout — mirrors the nmakel/solaredge_modbus reference library.
//
// The battery block is read in two "batches", exactly as the reference library
// groups its registers (the `batch` field). This is NOT a split at the physical
// register gap (0xE14B..0xE16B) — batch 2 deliberately spans that gap in a single
// contiguous read, and the device returns the gap words as padding. The problem
// with our earlier approach was READ WIDTH: a whole-block 147-word sweep times
// out, and oddly-sized windows are flaky. Reading the two reference batches
// (66 words then 82 words) each as one request succeeds on the first try.
//
// Verified live (192.168.178.4:1502, unit 1):
//   read(0xE100, 66)  OK  -> batch 1 (identity + DID)
//   read(0xE142, 82)  OK  -> batch 2 (spans the 0xE14B..0xE16B gap), status=3, etc.
//
// Segments are expressed as WORD offsets relative to BATTERY_TEMPLATE_BASE (0xE100),
// matching the def offsets in BATTERY_MAP. The reader reads each segment as its own
// contiguous request and reassembles the words by absolute offset.
export interface BatterySegment {
    /** Word offset of the segment start, relative to the battery block base (0xE100). */
    offset: number;
    /** Number of 16-bit registers in the segment. */
    length: number;
}

/**
 * The battery read batches (word offsets relative to the battery block base), mirroring
 * the reference library's register batching.
 *
 * Batch 1: offset 0x00 (0xE100), length 66 -> 0xE100..0xE141 (identity strings + DID).
 * Batch 2: offset 0x42 (0xE142), length 82 -> 0xE142..0xE193 (rated/charge powers,
 *          temps, instantaneous V/I/P, energies, soh, soe, status). This batch spans
 *          the unmapped register gap at 0xE14B..0xE16B in one contiguous read, which
 *          the device serves as padding — do NOT split it there.
 */
export const BATTERY_READ_SEGMENTS: readonly BatterySegment[] = [
    { offset: 0x00, length: 66 }, // 0xE100..0xE141
    { offset: 0x42, length: 82 }, // 0xE142..0xE193 (spans the 0xE14B..0xE16B gap)
];

/**
 * Battery-presence probe register: read this word to decide whether a battery slot is
 * populated. The reliable presence signal is `c_deviceaddress` at 0xE140 (+0x100 per
 * slot): a populated slot reports a real Modbus id (e.g. 112) while an absent slot
 * reads the not-implemented sentinel 255 (0x00FF) or 0xFFFF. The block base word
 * (0xE100/0xE200) is NOT reliable — on real devices an absent slot 2 still returns a
 * stale identity word at its base while every other register in the slot times out.
 *
 * @param slot - 1-based battery slot (1 or 2).
 */
export function getBatteryPresenceAddress(slot: 1 | 2): number {
    return BATTERY_DID_BASE + BATTERY_REGISTER_OFFSETS[slot - 1];
}
