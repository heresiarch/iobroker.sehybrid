import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import { defineConfig } from 'vite';

// Vite config for the sehybrid admin UI.
// The build output goes to src-admin/build and is copied into admin/ by ../tasks.js.
//
// Set ANALYZE=1 to also emit build/stats.html with the treemap of the bundle.
const analyze = process.env.ANALYZE === '1';

export default defineConfig({
    plugins: [
        react(),
        analyze &&
            visualizer({
                filename: 'build/stats.html',
                gzipSize: true,
                brotliSize: true,
            }),
    ],
    base: './',
    resolve: {
        // Some transitive deps pull in the CommonJS `lodash` while others use `lodash-es`,
        // which would bundle lodash twice. Force everything onto the ES build.
        alias: {
            lodash: 'lodash-es',
        },
    },
    build: {
        outDir: 'build',
        // The ioBroker admin framework (GenericApp) is inherently large; split it and
        // the big vendor libs into separate, cacheable chunks so the browser can load
        // them in parallel and reuse them across page loads.
        chunkSizeWarningLimit: 1500,
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (!id.includes('node_modules')) {
                        return undefined;
                    }
                    if (id.includes('@sentry')) {
                        return 'vendor-sentry';
                    }
                    if (id.includes('@mui/icons-material') || id.includes('react-icons')) {
                        return 'vendor-icons';
                    }
                    if (id.includes('@mui/') || id.includes('@emotion/')) {
                        return 'vendor-mui';
                    }
                    if (id.includes('react-color') || id.includes('react-colorful') || id.includes('react-cropper')) {
                        return 'vendor-pickers';
                    }
                    if (
                        id.includes('/react/') ||
                        id.includes('/react-dom/') ||
                        id.includes('/scheduler/') ||
                        id.includes('/react-is/')
                    ) {
                        return 'vendor-react';
                    }
                    if (id.includes('@iobroker/')) {
                        return 'vendor-iobroker';
                    }
                    return 'vendor';
                },
            },
        },
    },
    server: {
        port: 3000,
        host: true,
    },
});
