# Implementation Plan: SolarEdge SunSpec Reader

## Overview

This plan converts the design into incremental, test-driven coding steps for the read-only
SolarEdge SunSpec Modbus TCP monitor. Pure/leaf modules (config validation, decoding, register
map) come first with their property tests, then the Modbus client, reader, and state manager,
then `main.ts` lifecycle wiring, then the admin React UI, then integration tests, then final
verification.

Each task builds on prior tasks and ends by wiring new code into the adapter so no code is left
orphaned. Property-based tests use `fast-check`; unit/example/integration tests use the project's
existing mocha (`test:ts`) and `@iobroker/testing` (`test:integration`) tooling. Sub-tasks marked
with `*` are optional (tests) or require the live inverter and are not implemented by the coding
agent as part of core delivery.

Implementation language: **TypeScript** (per the design; sources under `src/` and `admin/src`).

## Tasks

- [x] 1. Project dependencies, config type, and adapter defaults
  - [x] 1.1 Add dependencies and update adapter config type
    - Add `modbus-serial@8.0.25` to `package.json` `dependencies`; add `fast-check` to `devDependencies`
    - Update `src/lib/adapter-config.d.ts` to replace `option1`/`option2` with `host: string`, `port: number`, `unitId: number`, `pollInterval: number` on the `ioBroker.AdapterConfig` augmentation
    - _Requirements: 1.1, 1.2, 1.4, 5.1_

  - [x] 1.2 Update io-package.json native defaults and message box
    - Set `native` defaults: `host` "", `port` 502, `unitId` 1, `pollInterval` 30
    - Set `common.messagebox: true` to enable `sendTo`/`onMessage` for the connection test
    - _Requirements: 1.3, 1.5, 2.1, 5.3_

- [x] 2. Config validation module (pure)
  - [x] 2.1 Implement validateConfig with bounds
    - Create `src/lib/config-validation.ts` exporting `ConfigValidationResult` and `validateConfig(cfg)`
    - Enforce host length 1..253, port integer 1..65535, unitId integer 0..247, pollInterval integer 5..3600; return per-field error keyed by `host`/`port`/`unitId`/`pollInterval`
    - _Requirements: 1.1, 1.2, 1.4, 2.4, 5.1_

  - [x]* 2.2 Write property test for config validation boundaries
    - **Property 5: Configuration validation boundaries**
    - **Validates: Requirements 1.1, 1.2, 1.4, 2.4, 5.1**
    - `src/lib/config-validation.test.ts`, min 100 iterations, tag `Feature: solaredge-sunspec-reader / 5`

  - [x]* 2.3 Write unit tests for config defaults
    - Assert unset fields default to port 502, unitId 1, pollInterval 30
    - _Requirements: 1.3, 1.5, 5.3_

- [x] 3. SunSpec decode module (pure)
  - [x] 3.1 Implement decodeRegisters, isNotImplemented, applyScaleFactor
    - Create `src/lib/sunspec-decode.ts` with `SunSpecDatatype` union and the three functions
    - `decodeRegisters` interprets big-endian words per datatype (int16/uint16/int32/uint32/acc32/float32/sunssf/string); returns `null` on NOT_IMPLEMENTED sentinel
    - `isNotImplemented` matches sentinels (int16/sunssf `0x8000`, uint16 `0xFFFF`, int32 `0x80000000`, uint32/acc32 `0xFFFFFFFF`)
    - `applyScaleFactor(raw, sf)` returns `raw * 10^sf`; rejects `sf` outside `[-10, 10]`
    - _Requirements: 3.6, 3.7, 3.8, 3.10_

  - [x]* 3.2 Write property test for datatype decode round-trip
    - **Property 1: Datatype decode round-trip (big-endian)**
    - **Validates: Requirements 3.7**
    - `src/lib/sunspec-decode.test.ts`, min 100 iterations

  - [x]* 3.3 Write property test for scale-factor application and domain
    - **Property 2: Scale-factor application and domain**
    - **Validates: Requirements 3.6, 3.10**

  - [x]* 3.4 Write property test for NOT_IMPLEMENTED sentinel decode (decode side)
    - **Property 3 (partial): sentinel words decode to null (unavailable)**
    - **Validates: Requirements 3.8**

- [x] 4. SunSpec register map (static data)
  - [x] 4.1 Define register def type and static map
    - Create `src/lib/sunspec-map.ts` with `SunSpecRole`, `SunSpecRegisterDef`, base constants (`COMMON_BASE` 40000, `INVERTER_BASE` 40069, `METER_BASE`), and `SUNSPEC_MAP`
    - Populate Common (40000), Inverter models 101/102/103 (base 40069) per the design tables, and Meter models 201–204
    - Populate concrete meter register offsets from `input/sunspec-implementation-technical-note-10.pdf`, keeping datatypes/units/roles/scale-factor refs as specified
    - _Requirements: 3.7, 4.1, 4.2, 4.3, 6.3, 6.4, 6.5, 6.6, 6.7_

  - [x] 4.2 Add non-scale value selector helper
    - Add a helper that returns the non-scale (non-`sunssf`, non-identity) value definitions used by the value table and reader
    - _Requirements: 4.1, 6.9_

  - [x]* 4.3 Write property test for register map metadata totality
    - **Property 6: State metadata mapping is total and correct**
    - **Validates: Requirements 6.3, 6.4, 6.5, 6.6, 6.7**

  - [x]* 4.4 Write property test for value-selector helper (value-table backing)
    - **Property 9 (helper): one non-scale row per SunSpec value with name, datatype, model**
    - **Validates: Requirements 4.1, 4.2, 4.3**

- [x] 5. Checkpoint - pure modules
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Modbus client (read-only wrapper)
  - [x] 6.1 Implement IModbusClient over modbus-serial
    - Create `src/lib/modbus-client.ts` implementing `connect`/`readHoldingRegisters`/`readInputRegisters`/`isConnected`/`close`
    - Use only FC03/FC04 reads; enforce 10 s connect and read timeouts; expose no write method
    - _Requirements: 3.1, 3.2, 3.5, 7.4, 7.6_

  - [x]* 6.2 Write property test for read-only invariant
    - **Property 4: Read-only invariant**
    - **Validates: Requirements 3.1**
    - Use a recording mock client asserting only read function codes are issued

- [x] 7. SunSpec reader (detect + decode + chunk)
  - [x] 7.1 Implement model detection
    - Create `src/lib/sunspec-reader.ts` implementing `detectInverterModel` (101/102/103) and `detectMeterModel` (201–204), returning `null` when a block is absent
    - _Requirements: 3.3, 3.4, 3.9_

  - [x] 7.2 Implement block read/decode with chunking and scale resolution
    - Read the detected inverter/meter blocks, chunking Modbus reads to ≤125 registers and covering the block exactly once
    - Decode each register via the decoders, skip NOT_IMPLEMENTED sentinels, resolve scale factors, and skip values whose SF is missing or out of `[-10, 10]` with a warning
    - Log a warning and continue when a required model block is missing
    - _Requirements: 3.2, 3.3, 3.4, 3.6, 3.8, 3.9, 3.10_

  - [x]* 7.3 Write property test for read-request chunking
    - **Property 8: Read requests never exceed 125 registers**
    - **Validates: Requirements 3.2**

  - [x]* 7.4 Write unit tests for detection and missing-block handling
    - For each inverter model 101/102/103 and meter model 201–204, a mock DID drives the correct block read; a missing block produces a warning and continues
    - _Requirements: 3.3, 3.4, 3.9_

- [x] 8. State manager (channels + objects + ack writes)
  - [x] 8.1 Implement IStateManager
    - Create `src/lib/state-manager.ts` implementing `ensureChannel`, `ensureState` (idempotent, metadata derived from def: type/role/unit/read=true/write=false), and `writeValue` (ack=true, no-op on null)
    - Group states into `inverter` and `meter` channels
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 8.1_

  - [x]* 8.2 Write property test for null/ack write behavior
    - **Property 3: NOT_IMPLEMENTED → unavailable, null → no write, non-null → ack write**
    - **Validates: Requirements 3.8, 6.8, 8.1**

  - [x]* 8.3 Write property test for idempotent object creation
    - **Property 7: Idempotent object creation**
    - **Validates: Requirements 6.1, 6.2**

  - [x]* 8.4 Write unit tests for channel grouping and metadata
    - Mocked `ioBroker.Adapter`: inverter/meter grouping and representative object metadata
    - _Requirements: 6.9_

- [x] 9. Checkpoint - I/O and object modules
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Adapter lifecycle and orchestration (main.ts)
  - [x] 10.1 Implement onReady startup and scheduler
    - In `src/main.ts`: validate config, guard on missing host (log error, set `info.connection=false`, do not start polling), create/ensure `info.connection` (false initially), ensure channels, start the poll timer at `pollInterval`
    - _Requirements: 5.4, 7.1, 8.3, 8.4_

  - [x] 10.2 Implement one polling cycle orchestration
    - Detect + read inverter and meter blocks via the reader, write states via the state manager, set `info.connection` true on full success and false on failure, retain last values on failure, maintain the consecutive-failure counter and emit repeated-failure error at 10
    - Map log levels: debug routine reads, info lifecycle, warn recoverable, error connection-false failures
    - _Requirements: 3.3, 3.4, 5.4, 5.5, 5.6, 6.8, 7.2, 7.3, 7.5, 8.2, 8.3, 8.5_

  - [x] 10.3 Implement onMessage testConnection handler
    - Handle `testConnection`: validate config (reply `validationError` within 1 s, no TCP), else probe SunSpec identity block within 10 s, close the socket, reply `success` (with manufacturer/model) or `failure` with cause
    - _Requirements: 2.2, 2.3, 2.4, 2.5_

  - [x] 10.4 Implement onUnload cleanup
    - Clear the polling timer/interval and close any open Modbus socket within 10 s, then invoke the callback
    - _Requirements: 7.6_

  - [x]* 10.5 Write unit tests for lifecycle guards and counter
    - Missing-host guard (8.4), unload clears timer + closes socket (7.6), log-level mapping on representative events (8.3), 10-consecutive-failure boundary (8.5)
    - _Requirements: 7.6, 8.3, 8.4, 8.5_

- [x] 11. Admin React UI
  - [x] 11.1 Extend settings with connection form
    - In `admin/src/components`, add a connection form for host/port/unitId/pollInterval using `validateConfig`, rejecting invalid saves and retaining the last valid value on invalid input
    - Add required i18n keys
    - _Requirements: 1.1, 1.2, 1.4, 1.6, 1.7, 1.8, 1.9, 5.1, 5.2_

  - [x] 11.2 Add Test Connection button
    - Add a control that calls `sendTo('testConnection', {host, port, unitId})` and displays success/failure/validationError
    - _Requirements: 2.1_

  - [x] 11.3 Add read-only SunSpec Value Table
    - Render one row per non-scale value from `SUNSPEC_MAP` with name, Modbus datatype, and SunSpec model columns; all cells read-only with no editable/action controls; show empty-map indication when no values
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x]* 11.4 Write component tests for admin UI
    - Connection form reject/retain (1.6–1.9, 5.2), Test Connection button present (2.1), value table read-only + empty-map indication (4.4, 4.5)
    - _Requirements: 1.6, 1.7, 1.8, 1.9, 2.1, 4.4, 4.5, 5.2_

- [x] 12. Checkpoint - full adapter and admin
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. Integration tests (mock Modbus TCP server)
  - [x]* 13.1 Write full polling cycle integration test
    - Under `test/integration` with `@iobroker/testing` + a mock Modbus TCP server serving Common + inverter + meter blocks: states created with correct values and `info.connection=true`
    - _Requirements: 3.3, 3.4, 5.4, 6.8, 7.2_

  - [x]* 13.2 Write testConnection integration tests
    - Reachable mock → `success`; unreachable/slow → `failure` within ~10 s; invalid config → `validationError` within 1 s and no connection attempt; socket closed after test
    - _Requirements: 2.2, 2.3, 2.4, 2.5_

  - [x]* 13.3 Write timeout/reconnect/retention integration test
    - Non-responding then recovering mock exercises the 10 s read timeout, `info.connection` false→true transition, and value retention
    - _Requirements: 3.5, 5.5, 7.3, 7.4, 7.5_

- [x] 14. Final verification
  - [x] 14.1 Run build, lint, and test suites
    - Run `npm run check` (tsc), `npm run lint`, `npm run test:ts`, and `npm run test:package`; fix any failures
    - _Requirements: 8.3_

  - [ ]* 14.2 Manual live-inverter verification (requires hardware)
    - Confirm detected model, spot-check scaled values against the SolarEdge portal, and confirm no writes occur; manual, not automated
    - _Requirements: 3.1_

## Notes

- Tasks marked with `*` are optional; they cover automated tests (skippable for a faster MVP) and the manual live-inverter check (task 14.2 requires physical hardware and is not run by the coding agent).
- Each task references specific requirements for traceability, and property-test tasks reference their design property number.
- Checkpoints ensure incremental validation between module groups.
- Property tests validate universal correctness properties (P1–P9); unit and integration tests validate examples, edge cases, lifecycle, and connectivity.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1", "3.1", "4.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "3.2", "3.3", "3.4", "4.2", "6.1"] },
    { "id": 3, "tasks": ["4.3", "4.4", "6.2", "7.1", "8.1"] },
    { "id": 4, "tasks": ["7.2", "8.2", "8.3", "8.4"] },
    { "id": 5, "tasks": ["7.3", "7.4", "10.1"] },
    { "id": 6, "tasks": ["10.2", "10.3", "10.4"] },
    { "id": 7, "tasks": ["10.5", "11.1", "11.2", "11.3"] },
    { "id": 8, "tasks": ["11.4", "13.1", "13.2", "13.3"] },
    { "id": 9, "tasks": ["14.1", "14.2"] }
  ]
}
```
