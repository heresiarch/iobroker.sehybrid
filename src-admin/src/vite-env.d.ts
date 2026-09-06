/// <reference types="vite/client" />

// Allow importing the i18n translation JSON files as modules.
declare module '*.json' {
    const value: Record<string, string>;
    export default value;
}
