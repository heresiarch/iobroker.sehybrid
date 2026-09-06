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
    | 'status'
    | 'info';

/** One SunSpec register value definition (design "Components and Interfaces"). */
export interface SunSpecRegisterDef {
    /** Stable key used as the ioBroker state id leaf, e.g. "acPower". */
    name: string;
    /** SunSpec model this value belongs to (Req 4.3). `'common'` = identity block. */
    model: 101 | 102 | 103 | 201 | 202 | 203 | 204 | 'common';
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
