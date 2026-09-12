![Logo](admin/sehybrid.png)

# ioBroker.sehybrid

[![NPM version](https://img.shields.io/npm/v/iobroker.sehybrid.svg)](https://www.npmjs.com/package/iobroker.sehybrid)
[![Downloads](https://img.shields.io/npm/dm/iobroker.sehybrid.svg)](https://www.npmjs.com/package/iobroker.sehybrid)
![Number of Installations](https://iobroker.live/badges/sehybrid-installed.svg)
![Current version in stable repository](https://iobroker.live/badges/sehybrid-stable.svg)
[![NPM](https://nodei.co/npm/iobroker.sehybrid.png?downloads=true)](https://nodei.co/npm/iobroker.sehybrid/)

**Tests:** ![Test and Release](https://github.com/heresiarch/ioBroker.sehybrid/workflows/Test%20and%20Release/badge.svg)

> ⚠️ **Work in progress — use at your own risk.** This adapter is under active development. Interfaces and state
> trees may change between versions.

## SolarEdge hybrid inverter adapter for ioBroker

Monitors and controls SolarEdge hybrid inverters over **Modbus TCP** (SunSpec). It reads PV, battery and
operational data from the inverter and exposes it as ioBroker states. Planned control features include export
power limitation and Storage Control modes.

## Requirements

- A SolarEdge hybrid inverter with **Modbus TCP enabled** and reachable on your network.
- ioBroker with `js-controller` >= 6.0.11 and `admin` >= 7.0.23.

> Modbus TCP is usually enabled in the inverter's SetApp / installer menu. The default TCP port is **502**.

## Installation

Install **sehybrid** from the ioBroker admin (Adapters tab), then create an instance.

## Configuration

Open the instance settings and configure the connection to your inverter:

| Setting | Default | Description |
|---------|---------|-------------|
| Host | *(empty)* | IP address or hostname of the inverter. Polling does not start until this is set. |
| Port | `502` | Modbus TCP port of the inverter. |
| Unit ID | `1` | Modbus unit / slave ID of the inverter. |
| Poll interval | `30` | How often (in seconds) the adapter reads data from the inverter. |

The settings page includes a **Test connection** button that verifies the adapter can reach the inverter and
reads its manufacturer and model before you save.

## States

The adapter organizes the values it reads into channels:

- **info.connection** — `true` while the adapter is successfully polling the inverter, `false` otherwise.
- **Inverter** — power, energy, AC/DC measurements and status from the inverter.
- **Meter** — data from connected SunSpec meters (import/export, power, energy).
- **Battery** — state of charge, power, temperature and status for connected batteries.

The exact list of states depends on your inverter model and the meters/batteries attached to it.

## Troubleshooting

- **No data / `info.connection` stays `false`** — check that the Host is set correctly, Modbus TCP is enabled
  on the inverter, and port `502` is reachable from your ioBroker host.
- **Connection errors in the log** — verify the Unit ID matches your inverter and that no other client is
  holding the single Modbus TCP connection the inverter allows.

## Support

Please report issues at [GitHub Issues](https://github.com/heresiarch/ioBroker.sehybrid/issues).

Developers: see [README_dev.md](README_dev.md) for build, test and release instructions.

## Changelog

<!--
    Placeholder for the next version (at the beginning of the line):
    ### **WORK IN PROGRESS**
-->
### 0.0.2 (2026-09-11)
* (René Meyer) initial release

## License

MIT License

Copyright (c) 2026 René Meyer

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
