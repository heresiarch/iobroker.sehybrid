// This file extends the AdapterConfig type from "@iobroker/types"

// Augment the globally declared type ioBroker.AdapterConfig
declare global {
    namespace ioBroker {
        interface AdapterConfig {
            host: string; // 1..253 chars (Req 1.1)
            port: number; // 1..65535, default 502 (Req 1.2, 1.3)
            unitId: number; // 0..247, default 1 (Req 1.4, 1.5)
            pollInterval: number; // seconds, 5..3600, default 30 (Req 5.1, 5.3)
        }
    }
}

// this is required so the above AdapterConfig is found by TypeScript / type checking
export { };

