# sehybrid admin UI

The ioBroker admin configuration UI for the `sehybrid` adapter. This is a
self-contained [Vite](https://vitejs.dev/) + React + TypeScript project.

It is built and copied into the parent `admin/` folder by the root-level
`tasks.js` orchestrator, so you normally do not build it directly.

## Available scripts

Run these from inside `src-admin/`:

### `npm start`

Runs the app in development mode on [http://localhost:3000](http://localhost:3000).
To talk to a running ioBroker admin instance, append its host/port as query
parameters, e.g. `http://localhost:3000/?host=localhost&port=8081`.

### `npm run build`

Builds the production bundle into `src-admin/build`.

### `npm run lint`

Lints the sources with the ioBroker ESLint config.

### `npm run check`

Type-checks the sources with `tsc --noEmit`.

## Building from the adapter root

From the repository root, `npm run build` (or `npm run build:react`) installs the
`src-admin` dependencies, runs the Vite build, and copies the result into `admin/`.
