# WORK IN PROGRESS - USE ONLY AT YOUR OWN RISK!!! #


![Logo](admin/sehybrid.png)
# ioBroker.sehybrid

[![NPM version](https://img.shields.io/npm/v/iobroker.sehybrid.svg)](https://www.npmjs.com/package/iobroker.sehybrid)
[![Downloads](https://img.shields.io/npm/dm/iobroker.sehybrid.svg)](https://www.npmjs.com/package/iobroker.sehybrid)
![Number of Installations](https://iobroker.live/badges/sehybrid-installed.svg)
![Current version in stable repository](https://iobroker.live/badges/sehybrid-stable.svg)
**Tests:** ![Test and Release](https://github.com/heresiarch/ioBroker.sehybrid/workflows/Test%20and%20Release/badge.svg)
[![NPM](https://nodei.co/npm/iobroker.sehybrid.png?downloads=true)](https://nodei.co/npm/iobroker.sehybrid/)

**Tests:** ![Test and Release](https://github.com/heresiarch/ioBroker.sehybrid/workflows/Test%20and%20Release/badge.svg)

## sehybrid adapter for ioBroker

ioBroker adapter for monitoring and controlling SolarEdge hybrid inverters. Provides access to PV, battery, and operational data, with features such as export power limitation and Storage Control modes.

## Developer manual
This section is intended for the developer. It can be deleted later.

### DISCLAIMER

Please make sure that you consider copyrights and trademarks when you use names or logos of a company and add a disclaimer to your README.
You can check other adapters for examples or ask in the developer community. Using a name or logo of a company without permission may cause legal problems for you.

### Getting started

You are almost done, only a few steps left:
1. Create a new repository on GitHub with the name `ioBroker.sehybrid`
1. Initialize the current folder as a new git repository:  
    ```bash
    git init -b main
    git add .
    git commit -m "Initial commit"
    ```
1. Link your local repository with the one on GitHub:  
    ```bash
    git remote add origin https://github.com/heresiarch/ioBroker.sehybrid
    ```

1. Push all files to the GitHub repo:  
    ```bash
    git push origin main
    ```
1. Add a new secret under https://github.com/heresiarch/ioBroker.sehybrid/settings/secrets. It must be named `AUTO_MERGE_TOKEN` and contain a personal access token with push access to the repository, e.g. yours. You can create a new token under https://github.com/settings/tokens.

1. Head over to [src/main.ts](src/main.ts) and start programming!

### Best Practices
We've collected some [best practices](https://github.com/ioBroker/ioBroker.repositories#development-and-coding-best-practices) regarding ioBroker development and coding in general. If you're new to ioBroker or Node.js, you should
check them out. If you're already experienced, you should also take a look at them - you might learn something new :)

### State Roles
When creating state objects, it is important to use the correct role for the state. The role defines how the state should be interpreted by visualizations and other adapters. For a list of available roles and their meanings, please refer to the [state roles documentation](https://www.iobroker.net/#en/documentation/dev/stateroles.md).

**Important:** Do not invent your own custom role names. If you need a role that is not part of the official list, please contact the ioBroker developer community for guidance and discussion about adding new roles.

### Project layout
The adapter is split into two independent parts:

* **Backend** (the actual adapter) — TypeScript in `src/`, compiled with `build-adapter ts` into `build/`.
* **Admin UI** (the configuration page) — a self-contained [Vite](https://vitejs.dev/) + React + TypeScript
  project in `src-admin/`. It is built and copied into `admin/` (as `admin/index.html`, `admin/tab.html`
  and `admin/assets/*`) by the root-level `tasks.js` orchestrator.

The admin UI has its own `package.json` and `node_modules`, so it is installed and linted separately from the
backend. `npm run lint` and `npm run check` cover both parts.

### Building and running in development

Install dependencies (this only installs the backend; the admin UI is installed automatically on first build):

```bash
npm install
```

Build everything (backend + admin UI):

```bash
npm run build
```

Run ioBroker locally with `dev-server` (starts the admin on http://localhost:8081):

```bash
npm run dev-server      # admin-UI work: admin only, adapter not started
npm run dev-server:watch  # backend work: also runs the adapter and restarts it on src/ changes
```

Then open the `sehybrid` instance configuration from the admin UI at http://localhost:8081 to see your
admin page. Both commands run the admin UI in watch mode, so changes to `src-admin/` are rebuilt
automatically — just refresh the browser. Use `dev-server:watch` when you are changing backend code in
`src/`, so the recompiled adapter restarts automatically. Plain `dev-server` only starts the admin and does
not run the adapter, which is lighter when you are only working on the admin page.

> The `dev-server` script runs with `--noBrowserSync` on purpose. BrowserSync (automatic browser reload)
> interferes with the admin socket.io connection in this setup, causing the UI to reconnect endlessly and
> load slowly. Without it, the admin WebSocket connects directly and reliably; the only cost is that you
> refresh the browser manually after a change. If you want to try the auto-reload variant, use
> `npm run dev-server:sync`.

### Scripts in `package.json`
Run them using `npm run <scriptname>`

| Script name | Description |
|-------------|-------------|
| `build` | Build the backend (TypeScript) and the admin UI (Vite). |
| `build:ts` | Build only the backend TypeScript sources into `build/`. |
| `build:react` | Build only the admin UI (`src-admin/`) and copy it into `admin/`. |
| `watch:ts` | Rebuild the backend on change. |
| `watch:react` | Rebuild the admin UI on change (Vite watch, output straight into `admin/`). |
| `dev-server` | Run ioBroker admin on http://localhost:8081 for admin-UI development (adapter itself is not started; no BrowserSync). |
| `dev-server:sync` | Same as `dev-server`, but with BrowserSync auto-reload enabled. |
| `dev-server:watch` | Run ioBroker **and** the adapter in watch mode — backend recompiles and the adapter restarts on changes to `src/`. |
| `dev-server:upload` | Upload the current adapter (needed after `io-package.json` changes). |
| `test:ts` | Run the `*.test.ts` unit tests. |
| `test:package` | Validate `package.json` and `io-package.json`. |
| `test:integration` | Test adapter startup against a real ioBroker instance. |
| `test` | Run the unit tests and package validation. |
| `check` | Type-check the backend and the admin UI (no compilation). |
| `lint` | Lint the backend and the admin UI with ESLint. |
| `translate` | Translate admin texts to all languages, see [`@iobroker/adapter-dev`](https://github.com/ioBroker/adapter-dev#manage-translations). |
| `release` | Create a new release, see [`@alcalzone/release-script`](https://github.com/AlCalzone/release-script#usage). |

### Configuring the compilation
The backend is compiled with [esbuild](https://esbuild.github.io/) via `@iobroker/adapter-dev`; adjust its
settings in `tsconfig.json` / `tsconfig.build.json`. The admin UI is bundled with [Vite](https://vitejs.dev/);
its configuration lives in `src-admin/vite.config.ts` (production build) and `src-admin/vite.config.watch.ts`
(watch build used by `dev-server`).

### Writing tests
When done right, testing code is invaluable, because it gives you the 
confidence to change your code while knowing exactly if and when 
something breaks. A good read on the topic of test-driven development 
is https://hackernoon.com/introduction-to-test-driven-development-tdd-61a13bc92d92. 
Although writing tests before the code might seem strange at first, but it has very 
clear upsides.

The template provides you with basic tests for the adapter startup and package files.
It is recommended that you add your own tests into the mix.

### Publishing the adapter
Using GitHub Actions, you can enable automatic releases on npm whenever you push a new git tag that matches the form 
`v<major>.<minor>.<patch>`. We **strongly recommend** that you do. The necessary steps are described in `.github/workflows/test-and-release.yml`.

Since you installed the release script, you can create a new
release simply by calling:
```bash
npm run release
```
Additional command line options for the release script are explained in the
[release-script documentation](https://github.com/AlCalzone/release-script#command-line).

To get your adapter released in ioBroker, please refer to the documentation 
of [ioBroker.repositories](https://github.com/ioBroker/ioBroker.repositories#requirements-for-adapter-to-get-added-to-the-latest-repository).

### Test the adapter manually with dev-server
Use `dev-server` to run, test and debug the adapter locally:

```bash
npm run dev-server
```

The ioBroker admin interface is then available at http://localhost:8081. Use `npm run dev-server:watch` if you
also want the backend to auto-restart when you change `src/`. Please refer to the
[`dev-server` documentation](https://github.com/ioBroker/dev-server#command-line) for more details.

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