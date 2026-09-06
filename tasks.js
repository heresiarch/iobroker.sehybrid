/**
 * Build orchestrator for the sehybrid admin UI.
 *
 * The admin UI lives in the self-contained Vite project `src-admin/`. This script
 * installs its dependencies, builds it with Vite and copies the result into `admin/`,
 * so that ioBroker serves `admin/index.html` (instance config) and `admin/tab.html`
 * (admin tab) together with the hashed asset bundle in `admin/assets/`.
 *
 * Usage:
 *   node tasks              full pipeline (clean -> npm -> build -> copy -> patch)
 *   node tasks --0-clean    remove generated admin output and src-admin/build
 *   node tasks --1-npm      install src-admin dependencies
 *   node tasks --2-build    run the Vite build
 *   node tasks --3-copy     copy src-admin/build into admin/
 *   node tasks --4-patch    patch the served html (socket.io include, tab.html)
 *
 * MIT License
 */
'use strict';

const fs = require('node:fs');
const { deleteFoldersRecursive, npmInstall, buildReact, copyFiles } = require('@iobroker/build-tools');

const SRC = 'src-admin';

function copyAllFiles() {
    // Keep hand-maintained static admin files (png, json config, css); drop generated output.
    deleteFoldersRecursive('admin', ['.png', '.json', '.css', 'i18n']);
    copyFiles([`${SRC}/build/**`, `!${SRC}/build/index.html`, `!${SRC}/build/stats.html`], 'admin');
    copyFiles(`${SRC}/build/index.html`, 'admin');
}

function clean() {
    deleteFoldersRecursive('admin', ['.png', '.json', '.css', 'i18n']);
    deleteFoldersRecursive(`${SRC}/build`);
}

function installNpmLocal() {
    if (fs.existsSync(`${SRC}/node_modules`)) {
        return Promise.resolve();
    }
    return npmInstall(`${__dirname.replace(/\\/g, '/')}/${SRC}/`);
}

/**
 * Rewrite the dev-only socket.io loader shim to the production include, and
 * provide a `tab.html` alongside `index.html` for the admin tab. Both html files
 * load the same bundle; the `?tab` query selects the Tab component at runtime.
 */
function patchFiles() {
    const indexPath = `${__dirname}/admin/index.html`;
    if (fs.existsSync(indexPath)) {
        let code = fs.readFileSync(indexPath).toString('utf8');
        code = code.replace(
            /<script>[\s\S]*?document\.head\.appendChild\(script\);[\s\S]*?<\/script>/,
            `<script type="text/javascript" src="./../../lib/js/socket.io.js"></script>`,
        );
        fs.writeFileSync(indexPath, code);

        // Provide tab.html for the admin tab (same bundle, ?tab selects the Tab view).
        const tabCode = code.replace(/<title>[^<]*<\/title>/, '<title>sehybrid Tab</title>');
        fs.writeFileSync(`${__dirname}/admin/tab.html`, tabCode);
    }
}

if (process.argv.find(arg => arg === '--0-clean')) {
    clean();
} else if (process.argv.find(arg => arg === '--1-npm')) {
    npmInstall(`${__dirname.replace(/\\/g, '/')}/${SRC}/`).catch(e => {
        console.error(`Cannot install: ${e}`);
        process.exit(1);
    });
} else if (process.argv.find(arg => arg === '--2-build')) {
    buildReact(`${__dirname}/${SRC}`, { rootDir: __dirname, vite: true }).catch(e => {
        console.error(`Cannot build: ${e}`);
        process.exit(1);
    });
} else if (process.argv.find(arg => arg === '--3-copy')) {
    copyAllFiles();
} else if (process.argv.find(arg => arg === '--4-patch')) {
    patchFiles();
} else {
    clean();
    installNpmLocal()
        .then(() => buildReact(`${__dirname}/${SRC}`, { rootDir: __dirname, vite: true }))
        .then(() => copyAllFiles())
        .then(() => patchFiles())
        .catch(e => {
            console.error(`Cannot build admin: ${e}`);
            process.exit(1);
        });
}
