// ESLint config for the sehybrid admin UI (React + TypeScript, built with Vite).
// This is a self-contained project, so it carries its own eslint config; the
// root eslint config ignores the whole src-admin/ folder.
import config from '@iobroker/eslint-config';
import globals from 'globals';

export default [
    ...config,
    {
        ignores: ['build/', 'node_modules/', 'vite.config.ts', 'eslint.config.mjs'],
    },
    {
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                ...globals.browser,
            },
            parserOptions: {
                ecmaFeatures: { jsx: true },
            },
        },
    },
];
