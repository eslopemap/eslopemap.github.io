import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const binaryPath = path.resolve(__dirname, '../src-tauri/target/debug/gpx_sync_filecentric');

export const config = {
    runner: 'local',
    port: 4444,
    specs: ['./tests/**/*.spec.mjs'],
    maxInstances: 1,
    capabilities: [{
        'tauri:options': {
            binary: binaryPath,
        },
    }],
    logLevel: 'warn',
    bail: 0,
    waitforTimeout: 10000,
    connectionRetryTimeout: 30000,
    connectionRetryCount: 3,
    framework: 'mocha',
    reporters: ['spec'],
    mochaOpts: {
        ui: 'bdd',
        timeout: 60000,
    },
};
