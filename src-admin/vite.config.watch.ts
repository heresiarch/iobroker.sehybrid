import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';

// Watch-mode Vite config used by `npm run watch:react` and the ioBroker dev-server.
//
// Unlike the production build (vite.config.ts, output to src-admin/build, then copied
// into admin/ by ../tasks.js), this config writes directly into ../admin so the
// dev-server's browser-sync can serve and hot-reload the files it watches.
//
// A tiny plugin runs after every rebuild to reproduce the two things tasks.js does
// in its patch step: swap the dev socket.io shim for the production include, and
// emit admin/tab.html next to admin/index.html.
const ADMIN_DIR = path.resolve(__dirname, '../admin');

function patchAdminHtml() {
    return {
        name: 'patch-admin-html',
        closeBundle() {
            const indexPath = path.join(ADMIN_DIR, 'index.html');
            if (!fs.existsSync(indexPath)) {
                return;
            }
            let code = fs.readFileSync(indexPath, 'utf8');
            code = code.replace(
                /<script>[\s\S]*?document\.head\.appendChild\(script\);[\s\S]*?<\/script>/,
                `<script type="text/javascript" src="./../../lib/js/socket.io.js"></script>`,
            );
            fs.writeFileSync(indexPath, code);

            const tabCode = code.replace(/<title>[^<]*<\/title>/, '<title>sehybrid Tab</title>');
            fs.writeFileSync(path.join(ADMIN_DIR, 'tab.html'), tabCode);
        },
    };
}

export default defineConfig({
    plugins: [react(), patchAdminHtml()],
    base: './',
    resolve: {
        // Match the production config: force the single ES build of lodash.
        alias: {
            lodash: 'lodash-es',
        },
    },
    build: {
        outDir: ADMIN_DIR,
        emptyOutDir: false,
        chunkSizeWarningLimit: 1500,
        watch: {},
    },
});
