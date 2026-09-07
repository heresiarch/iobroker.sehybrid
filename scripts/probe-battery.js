#!/usr/bin/env node
/* eslint-disable */
// Standalone Modbus probe for diagnosing battery detection.
// Reads the SolarEdge battery presence registers and identity block directly,
// mirroring what SunSpecReader.detectBatteries evaluates.
//
// Usage: node scripts/probe-battery.js [host] [port] [unitId]

const ModbusRTU = require('modbus-serial');

const host = process.argv[2] || '192.168.178.4';
const port = parseInt(process.argv[3] || '1502', 10);
const unitId = parseInt(process.argv[4] || '1', 10);

const BATTERY_TEMPLATE_BASE = 0xe100;
const BATTERY_DID_BASE = 0xe140;
const OFFSETS = [0, 256]; // slot 1, slot 2

function hex(n) {
    return '0x' + (n & 0xffff).toString(16).toUpperCase().padStart(4, '0');
}

async function readSafe(client, addr, len, label) {
    try {
        const res = await client.readHoldingRegisters(addr, len);
        console.log(`  OK   ${label} @ ${hex(addr)} (${addr}) len ${len}: [${res.data.map(hex).join(', ')}]`);
        return res.data;
    } catch (e) {
        console.log(`  FAIL ${label} @ ${hex(addr)} (${addr}) len ${len}: ${e.message || e}`);
        return null;
    }
}

async function main() {
    const client = new ModbusRTU();
    client.setTimeout(10000);
    console.log(`Connecting to ${host}:${port} unit ${unitId} ...`);
    await client.connectTCP(host, { port });
    client.setID(unitId);
    console.log('Connected.\n');

    for (let slot = 1; slot <= 2; slot++) {
        const off = OFFSETS[slot - 1];
        const didAddr = BATTERY_DID_BASE + off;
        const baseAddr = BATTERY_TEMPLATE_BASE + off;
        console.log(`=== Battery slot ${slot} ===`);

        // Presence probe exactly as detectBatteries does: 1 register at DID base.
        const did = await readSafe(client, didAddr, 1, 'presence/c_deviceaddress');
        if (did) {
            const probe = did[0] & 0xffff;
            const absent = probe === 0xffff || probe === 255 || probe === 0;
            console.log(`       -> probe value = ${probe} (${hex(probe)}) => ${absent ? 'ABSENT (skipped)' : 'PRESENT'}`);
        }

        // Extra context: identity string base + a couple more block words.
        await readSafe(client, baseAddr, 4, 'block base (identity)');
        await readSafe(client, baseAddr + 0x42, 2, 'batch2 start');
        console.log('');
    }

    await client.close(() => {});
    process.exit(0);
}

if (process.argv[5] !== 'seg') {
    main().catch(e => {
        console.error('Probe failed:', e.message || e);
        process.exit(1);
    });
}

// --- segmented read reproduction (call with `seg` as 5th arg) ---------------
async function probeSegments() {
    const ModbusRTU2 = require('modbus-serial');
    const client = new ModbusRTU2();
    client.setTimeout(10000);
    await client.connectTCP(host, { port });
    client.setID(unitId);
    const base = BATTERY_TEMPLATE_BASE; // slot 1
    const segments = [
        { offset: 0x00, length: 66 },
        { offset: 0x42, length: 82 },
    ];
    console.log('\n=== Reproducing readBatterySlot segmented reads (slot 1) ===');
    for (const s of segments) {
        const addr = base + s.offset;
        try {
            const res = await client.readHoldingRegisters(addr, s.length);
            console.log(`  OK   segment @ ${hex(addr)} len ${s.length}: got ${res.data.length} words`);
        } catch (e) {
            console.log(`  FAIL segment @ ${hex(addr)} len ${s.length}: ${e.message || e}`);
        }
    }
    await client.close(() => {});
}

if (process.argv[5] === 'seg') {
    probeSegments().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}
