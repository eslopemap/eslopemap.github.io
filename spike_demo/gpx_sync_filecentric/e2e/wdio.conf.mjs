import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const binaryPath = path.resolve(__dirname, '../src-tauri/target/debug/gpx_sync_filecentric');

// tauri-plugin-webdriver embeds the W3C server on port 4445 inside the app.
// We launch the app ourselves before the test suite starts.
let appProcess = null;

export const config = {
    runner: 'local',
    hostname: '127.0.0.1',
    port: 4445,
    path: '/',
    specs: ['./tests/**/*.spec.mjs'],
    maxInstances: 1,
    capabilities: [{}],
    logLevel: 'warn',
    bail: 0,
    waitforTimeout: 10000,
    connectionRetryTimeout: 30000,
    connectionRetryCount: 5,
    framework: 'mocha',
    reporters: ['spec'],
    mochaOpts: {
        ui: 'bdd',
        timeout: 60000,
    },

    onPrepare: async function () {
        // Launch the Tauri app (it starts the WebDriver server on 4445)
        appProcess = spawn(binaryPath, [], {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env },
        });
        appProcess.stdout.on('data', (d) => process.stdout.write(`[app] ${d}`));
        appProcess.stderr.on('data', (d) => process.stderr.write(`[app:err] ${d}`));

        // Wait for the WebDriver server to be ready
        const maxWait = 15000;
        const start = Date.now();
        while (Date.now() - start < maxWait) {
            try {
                const res = await fetch('http://127.0.0.1:4445/status');
                if (res.ok) {
                    console.log('[wdio] WebDriver server ready');
                    return;
                }
            } catch (_) { /* not ready yet */ }
            await new Promise(r => setTimeout(r, 300));
        }
        throw new Error('Tauri app WebDriver server did not start within 15s');
    },

    onComplete: async function () {
        if (appProcess) {
            appProcess.kill('SIGTERM');
            appProcess = null;
        }
    },
};
