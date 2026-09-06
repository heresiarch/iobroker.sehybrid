# Requirements Document

## Introduction

This feature adds read-only monitoring of SolarEdge hybrid inverters to the `sehybrid` ioBroker adapter. The adapter connects to a SolarEdge inverter over Modbus TCP and reads SunSpec-encoded register maps for the inverter model (SunSpec models 101/102/103) and the connected meter models (SunSpec models 201–204), as described in the SolarEdge SunSpec implementation technical note (`input/sunspec-implementation-technical-note-10.pdf`).

The adapter provides connection configuration (host/IP and TCP port) in the admin page, a connection test action, and a reference table listing the readable SunSpec values with their Modbus datatypes. Values are polled on a configurable interval and exposed as acknowledged ioBroker state objects. The adapter maintains the standard `info.connection` indicator and follows ioBroker adapter lifecycle conventions.

This feature is strictly READ-ONLY. No Modbus write operations, export limitation, or storage control behavior is included in this feature, even where the adapter package description mentions such capabilities.

## Glossary

- **Adapter**: The ioBroker `sehybrid` adapter instance that runs in daemon mode and polls the inverter.
- **Inverter**: A SolarEdge hybrid inverter exposing SunSpec register maps over Modbus TCP.
- **Modbus_Client**: The component within the Adapter responsible for establishing and using the Modbus TCP connection to the Inverter.
- **SunSpec_Model**: A standardized block of Modbus registers defined by the SunSpec specification. Relevant models are Inverter models 101, 102, 103 and Meter models 201, 202, 203, 204.
- **SunSpec_Register_Map**: The complete set of SunSpec_Model register definitions the Adapter reads, including register address, Modbus datatype, and associated scale factor.
- **Modbus_Datatype**: The SunSpec/Modbus data type of a register value (for example int16, uint16, int32, uint32, acc32, float32, sunssf, string).
- **Scale_Factor**: A SunSpec `sunssf` register value that is applied as a power-of-ten multiplier to a related raw register value to produce the engineering value.
- **Admin_Page**: The adapter configuration UI rendered by ioBroker admin (materialize/JSON config).
- **Connection_Config**: The user-provided settings identifying the Inverter endpoint: host (IP address or hostname) and TCP port.
- **Connection_Test**: An Admin_Page action that attempts to reach the configured Inverter Modbus TCP endpoint and reports the result.
- **Value_Table**: A read-only table displayed in the Admin_Page listing SunSpec values and their Modbus_Datatypes.
- **Polling_Interval**: The configurable time period between successive reads of the SunSpec_Register_Map from the Inverter.
- **State_Object**: An ioBroker object of type `state` created by the Adapter to hold a polled SunSpec value.
- **Connection_Indicator**: The `info.connection` State_Object of type boolean that reflects current Modbus connectivity.
- **Meter_Base_Address**: The base-0 Modbus register at which a specific meter's SunSpec block begins (40121 for the 1st meter, 40295 for the 2nd, 40469 for the 3rd).

## Requirements

### Requirement 1: Connection Configuration in Admin Page

**User Story:** As an ioBroker user, I want to configure the inverter host and Modbus TCP port in the admin page, so that the adapter knows which device to read from.

#### Acceptance Criteria

1. THE Admin_Page SHALL provide an input field for the Inverter host that accepts a non-empty string of 1 to 253 characters representing an IPv4 address or a hostname.
2. THE Admin_Page SHALL provide an input field for the Modbus TCP port that accepts an integer between 1 and 65535 inclusive.
3. WHERE the user has not set a Modbus TCP port, THE Admin_Page SHALL default the port to 502.
4. THE Admin_Page SHALL provide an input field for the Modbus unit identifier that accepts an integer between 0 and 247 inclusive.
5. WHERE the user has not set a Modbus unit identifier, THE Admin_Page SHALL default the unit identifier to 1.
6. WHEN the user saves the Connection_Config and the host is a non-empty string of 1 to 253 characters, the port is an integer between 1 and 65535 inclusive, and the unit identifier is an integer between 0 and 247 inclusive, THE Admin_Page SHALL persist the host, port, and unit identifier into the adapter instance `native` configuration.
7. IF the user saves the Connection_Config while the Inverter host is empty or exceeds 253 characters, THEN THE Admin_Page SHALL reject the save, display a validation error indicating an invalid host, and retain the previously persisted Connection_Config unchanged.
8. IF the user saves the Connection_Config while the Modbus TCP port is not an integer between 1 and 65535 inclusive, THEN THE Admin_Page SHALL reject the save, display a validation error indicating an invalid port, and retain the previously persisted Connection_Config unchanged.
9. IF the user saves the Connection_Config while the Modbus unit identifier is not an integer between 0 and 247 inclusive, THEN THE Admin_Page SHALL reject the save, display a validation error indicating an invalid unit identifier, and retain the previously persisted Connection_Config unchanged.

### Requirement 2: Connection Test Action

**User Story:** As an ioBroker user, I want to test the connection from the admin page, so that I can confirm the inverter is reachable before saving.

#### Acceptance Criteria

1. THE Admin_Page SHALL provide a Connection_Test action control.
2. WHEN the user activates the Connection_Test and the Adapter establishes a Modbus TCP connection to the Inverter at the configured host, port, and unit identifier and reads the SunSpec identifier register block within 10 seconds, THE Adapter SHALL report a success result to the Admin_Page.
3. IF the Adapter cannot establish a Modbus TCP connection to the configured host and port, or does not complete the SunSpec identifier read within 10 seconds, when the Connection_Test is activated, THEN THE Adapter SHALL report a failure result to the Admin_Page with an error message indicating the cause of the failure.
4. IF the configured host is empty, or the port is outside the range 1 to 65535, or the unit identifier is outside the range 0 to 247, when the Connection_Test is activated, THEN THE Adapter SHALL report a validation error result to the Admin_Page within 1 second and SHALL NOT attempt a Modbus TCP connection.
5. WHEN the Connection_Test completes, THE Adapter SHALL close any Modbus TCP connection opened for the Connection_Test.

### Requirement 3: Read-Only SunSpec Register Reading over Modbus TCP

**User Story:** As an ioBroker user, I want the adapter to read SunSpec inverter and meter values over Modbus TCP without changing anything on the device, so that I can monitor my system safely.

#### Acceptance Criteria

1. WHEN the Adapter reads from the Inverter, THE Modbus_Client SHALL issue only Modbus read function codes and SHALL NOT issue any Modbus write function code.
2. WHEN the Modbus_Client reads a contiguous register block from the Inverter, THE Modbus_Client SHALL request at most 125 registers per Modbus read request.
3. WHEN a polling cycle runs, THE Modbus_Client SHALL identify the present Inverter SunSpec_Model by reading the model identifier register and SHALL read the register block for whichever of models 101, 102, and 103 that identifier reports.
4. WHEN a polling cycle runs, THE Modbus_Client SHALL identify the present Meter SunSpec_Model by reading the model identifier register and SHALL read the register block for whichever of models 201, 202, 203, and 204 that identifier reports.
5. WHEN the Modbus_Client issues a read request to the Inverter, THE Modbus_Client SHALL complete the read or report a read failure within 10 seconds.
6. WHEN a raw register value has an associated Scale_Factor register whose value is an integer between -10 and 10 inclusive, THE Adapter SHALL compute the engineering value by multiplying the raw value by ten raised to the power of the Scale_Factor value.
7. WHEN the Adapter decodes a SunSpec value, THE Adapter SHALL interpret the register bytes according to the value's Modbus_Datatype as defined in the SunSpec_Register_Map.
8. IF a decoded raw register value equals the SunSpec not-implemented sentinel for its Modbus_Datatype, THEN THE Adapter SHALL treat the value as unavailable and SHALL NOT write an engineering value to the corresponding State_Object for that polling cycle.
9. IF a required SunSpec_Model block is absent from the Inverter response during a polling cycle, THEN THE Adapter SHALL log a warning identifying the missing SunSpec_Model and SHALL continue processing the remaining SunSpec_Model blocks.
10. IF a raw register value has an associated Scale_Factor register that is missing or reports a value outside the range -10 to 10 inclusive, THEN THE Adapter SHALL skip the affected value, SHALL log a warning identifying the affected SunSpec value, and SHALL continue processing the remaining values in the polling cycle.

### Requirement 4: SunSpec Value Table in Admin Page

**User Story:** As an ioBroker user, I want to see a table of available SunSpec values and their Modbus datatypes in the admin page, so that I understand which values the adapter can read.

#### Acceptance Criteria

1. WHEN the Admin_Page is displayed, THE Admin_Page SHALL display a Value_Table containing exactly one row for each SunSpec value defined in the SunSpec_Register_Map.
2. THE Value_Table SHALL display, for each listed SunSpec value, the value name and the Modbus_Datatype in separate columns.
3. THE Value_Table SHALL display, for each listed SunSpec value, the SunSpec_Model identifier (one of 101, 102, 103, 201, 202, 203, 204) to which the value belongs.
4. THE Value_Table SHALL present all of its cells as read-only text, and SHALL NOT provide any editable input control, selection control, or action control within the table.
5. IF the SunSpec_Register_Map contains no SunSpec values when the Admin_Page is displayed, THEN THE Admin_Page SHALL display the Value_Table with zero data rows and an indication that no values are available.

### Requirement 5: Configurable Polling Interval

**User Story:** As an ioBroker user, I want to configure how often values are refreshed, so that I can balance data freshness against load on the inverter.

#### Acceptance Criteria

1. THE Admin_Page SHALL provide an input field for the Polling_Interval that accepts an integer value between 5 and 3600 seconds inclusive.
2. IF the user enters a Polling_Interval value that is non-integer or outside the range 5 to 3600 seconds inclusive, THEN THE Admin_Page SHALL reject the value, retain the last valid Polling_Interval, and display an error indication identifying the accepted range.
3. WHERE the user has not set a Polling_Interval, THE Admin_Page SHALL default the Polling_Interval to 30 seconds.
4. WHILE the Adapter is running with a valid Connection_Config, THE Adapter SHALL read the SunSpec_Register_Map from the Inverter once per Polling_Interval.
5. IF a scheduled read of the SunSpec_Register_Map does not complete within the current Polling_Interval, THEN THE Adapter SHALL abort that read attempt, retain the previously stored register values, and set the Connection_Indicator to false.
6. WHEN a read of the SunSpec_Register_Map fails, THE Adapter SHALL continue scheduling subsequent reads at the configured Polling_Interval without stopping the adapter instance.
7. WHEN the user changes and saves the Polling_Interval, THE Adapter SHALL apply the updated Polling_Interval after the adapter instance restarts.

### Requirement 6: Mapping SunSpec Values to ioBroker State Objects

**User Story:** As an ioBroker user, I want polled values available as ioBroker states with correct metadata, so that I can use them in visualizations, scripts, and history.

#### Acceptance Criteria

1. WHEN the Adapter reads a SunSpec value during a polling cycle AND no State_Object exists for that value, THE Adapter SHALL create a State_Object for that value.
2. IF a State_Object already exists for a SunSpec value when the Adapter reads that value, THEN THE Adapter SHALL reuse the existing State_Object without recreating it.
3. WHEN the Adapter creates a State_Object, THE Adapter SHALL set the State_Object `common.type` so that a SunSpec value with a numeric Modbus_Datatype (int16, uint16, int32, uint32, acc32, float32, sunssf) is set to `number`, and a SunSpec value with a string Modbus_Datatype is set to `string`.
4. WHEN the Adapter creates a State_Object, THE Adapter SHALL set the State_Object `common.role` to a valid ioBroker state role that corresponds to the SunSpec value's measured quantity.
5. IF a SunSpec value has a defined physical unit in the SunSpec_Register_Map, THEN THE Adapter SHALL set the State_Object `common.unit` to that unit.
6. IF a SunSpec value has no defined physical unit in the SunSpec_Register_Map, THEN THE Adapter SHALL create the State_Object without a `common.unit` property.
7. WHEN the Adapter creates a State_Object, THE Adapter SHALL set `common.read` to true and `common.write` to false.
8. WHEN the Adapter obtains an engineering value during a polling cycle, THE Adapter SHALL write that value to the corresponding State_Object with the acknowledged flag set to true within the same polling cycle.
9. THE Adapter SHALL organize the State_Objects into two channels that group values by their SunSpec source, with one channel containing all Inverter SunSpec_Model values and one channel containing all Meter SunSpec_Model values.

### Requirement 7: Connection Indicator and Adapter Lifecycle

**User Story:** As an ioBroker user, I want the adapter to report its connection status and start and stop cleanly, so that I can trust the state of my system.

#### Acceptance Criteria

1. WHEN the Adapter starts, THE Adapter SHALL create the Connection_Indicator State_Object if it does not already exist and SHALL set the Connection_Indicator to false before attempting the first read.
2. WHEN a polling cycle successfully reads the complete SunSpec_Register_Map, THE Adapter SHALL set the Connection_Indicator to true within the same polling cycle.
3. IF a polling cycle fails to read from the Inverter, THEN THE Adapter SHALL set the Connection_Indicator to false and SHALL log the failure reason at the error level while retaining the last acknowledged State_Object values.
4. IF the Modbus TCP connection to the Inverter is lost, THEN THE Adapter SHALL attempt to reestablish the connection on the next polling cycle, applying a connection attempt timeout of 10 seconds per attempt.
5. WHEN a reconnection attempt on a subsequent polling cycle succeeds and the SunSpec_Register_Map is read, THE Adapter SHALL set the Connection_Indicator to true.
6. WHEN the Adapter is unloaded, THE Adapter SHALL clear all active timers and intervals and SHALL close any open Modbus TCP connection to the Inverter within 10 seconds.

### Requirement 8: Standard ioBroker Adapter Compliance

**User Story:** As an ioBroker maintainer, I want the adapter to follow ioBroker conventions, so that it integrates correctly with the platform.

#### Acceptance Criteria

1. WHEN the Adapter writes a value received from the Inverter to a State_Object, THE Adapter SHALL set the acknowledged flag to true.
2. IF a recoverable error occurs during a polling cycle, where a recoverable error is any error that does not terminate the adapter process (for example a Modbus read timeout, a connection loss, or an absent SunSpec_Model block), THEN THE Adapter SHALL log the error at the warn level and SHALL continue running so that the next polling cycle begins at the next Polling_Interval.
3. THE Adapter SHALL emit each log message at exactly one ioBroker logging level determined by the following mapping: debug for routine register reads, info for lifecycle events (start, unload, connection established), warn for recoverable anomalies, and error for failures that set the Connection_Indicator to false.
4. IF the adapter instance configuration lacks a host value when the Adapter starts, THEN THE Adapter SHALL log an error indicating the missing host configuration, SHALL set the Connection_Indicator to false, and SHALL NOT start any polling cycle.
5. IF 10 consecutive polling cycles each end in a recoverable error, THEN THE Adapter SHALL set the Connection_Indicator to false and SHALL log an error indicating repeated read failures while continuing to attempt the next polling cycle at the next Polling_Interval.

### Requirement 9: Multiple Meter Support (Optional / Future)

> Status: Optional / not yet implemented — future enhancement. This requirement is out of scope for the current implementation, which reads only the 1st meter block and exposes it under a single `meter` channel. The exact per-meter channel naming will be decided in the design phase.

**User Story:** As an ioBroker user with more than one meter connected to my SolarEdge inverter, I want the adapter to read every enabled meter, so that I can monitor all of my meters without their values colliding.

#### Acceptance Criteria

1. WHEN a polling cycle runs, THE Adapter SHALL determine the number of enabled meters present, from 0 up to 3 inclusive, by reading the C_SunSpec_DID register located at each Meter_Base_Address plus a fixed offset for the 1st, 2nd, and 3rd meter blocks (Meter_Base_Address values 40121, 40295, and 40469).
2. WHEN the Adapter reads a meter block's C_SunSpec_DID register and the value equals one of 201, 202, 203, or 204, THE Adapter SHALL treat that meter block as present and enabled and SHALL read its SunSpec meter model register block relative to that meter block's Meter_Base_Address rather than a single hardcoded base address.
3. WHEN the Adapter reads two or more enabled meter blocks in a polling cycle, THE Adapter SHALL expose each meter block's values under a distinct per-meter channel indexed by the meter block position (for example `meter.1.*`, `meter.2.*`, `meter.3.*`) so that values from different meter blocks do not share State_Objects.
4. IF a meter block's C_SunSpec_DID register value is not one of 201, 202, 203, or 204 during a polling cycle, THEN THE Adapter SHALL skip that meter slot, SHALL NOT create any State_Object for that meter slot, SHALL log a warning identifying the skipped meter slot position, and SHALL continue processing the remaining meter blocks.
5. WHEN exactly one enabled meter block is present during a polling cycle, THE Adapter SHALL continue to expose that meter's values in a backward-compatible layout, retaining the State_Objects at the paths used by the single-meter implementation so that existing consumers continue to resolve those State_Objects (the design phase decides whether this is the existing `meter.*` layout or `meter.1.*`).
6. WHEN the Adapter reads any meter block under this feature, THE Modbus_Client SHALL issue only Modbus read function codes and SHALL NOT issue any Modbus write function code.
