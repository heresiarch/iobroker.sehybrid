// Root postinstall hook.
//
// The admin UI in src-admin/ is a self-contained sub-project with its own
// package.json / node_modules. CI (and local dev) needs those deps installed
// so the type-aware ESLint run and the React build have @types/react etc.
//
// IMPORTANT: src-admin/ is NOT shipped in the published npm tarball (it is not
// in package.json "files"). When the adapter is installed as a dependency
// (e.g. by @iobroker/testing during integration tests, or by end users), this
// hook must be a no-op. Otherwise npm tries to install a folder that does not
// exist and the whole adapter install aborts with ENOENT, which makes the
// js-controller report "Unknown packet name".
//
// So: only install src-admin deps when src-admin/package.json actually exists.

const { existsSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');

const srcAdminDir = join(__dirname, '..', 'src-admin');

if (!existsSync(join(srcAdminDir, 'package.json'))) {
    // Installed as a dependency (published tarball) — nothing to do.
    process.exit(0);
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

// Prefer a clean install; fall back to a regular install if the lockfile is
// out of sync (npm ci is strict about that).
let result = spawnSync(npm, ['ci', '--prefix', srcAdminDir], { stdio: 'inherit' });
if (result.status !== 0) {
    result = spawnSync(npm, ['install', '--prefix', srcAdminDir], { stdio: 'inherit' });
}

process.exit(result.status ?? 0);
