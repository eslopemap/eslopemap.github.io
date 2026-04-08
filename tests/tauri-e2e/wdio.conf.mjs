import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import net from 'net';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve the debug binary built by `cargo build` in src-tauri/
const binaryPath = path.resolve(__dirname, '../../src-tauri/target/debug/slope-desktop');

// tauri-plugin-webdriver embeds the W3C server on port 4445 inside the app.
// We launch the app ourselves before the test suite starts.
let appProcess = null;

function isPortOpen(port) {
    return new Promise((resolve) => {
        const socket = net.createConnection({ host: '127.0.0.1', port });
        socket.once('connect', () => {
            socket.destroy();
            resolve(true);
        });
        socket.once('error', () => {
            socket.destroy();
            resolve(false);
        });
    });
}

export const config = {
    runner: 'local',
    hostname: '127.0.0.1',
    port: 4445,
    path: '/',
    specs: ['./tests/**/*.spec.mjs'],
    maxInstances: 1,
    capabilities: [{}],
    logLevel: 'info',
    bail: 0,
    waitforTimeout: 10000,
    connectionRetryTimeout: 30000,
    connectionRetryCount: 5,
    framework: 'mocha',
    reporters: ['spec'],
    mochaOpts: {
        ui: 'bdd',
        timeout: 120000,
    },

    onPrepare: async function () {
        console.log(`[wdio] launching Tauri app: ${binaryPath}`);

        const webdriverPortBusy = await isPortOpen(4445);
        const tileServerPortBusy = await isPortOpen(14321);
        if (webdriverPortBusy || tileServerPortBusy) {
            throw new Error(
                `[wdio] Refusing to start because required ports are already in use: ` +
                `4445=${webdriverPortBusy} 14321=${tileServerPortBusy}. ` +
                `A stale slope-desktop process is likely still running; stop it before rerunning Tauri e2e.`
            );
        }

        // Launch the Tauri app (it starts the WebDriver server on 4445)
        appProcess = spawn(binaryPath, [], {
            stdio: ["ignore", "pipe", "pipe"],
            env: {
                ...process.env,
                TAURI_E2E_TESTS: '1',
                RUST_LOG: "tauri=debug,tauri_plugin_webdriver=trace,webdriver=trace",  // for debugging tauri-driver issues
            },
        });
        appProcess.stdout.on('data', (d) => process.stdout.write(`[app] ${d}`));
        appProcess.stderr.on('data', (d) => process.stderr.write(`[app:err] ${d}`));

        appProcess.on('error', (err) => {
            console.error(`[wdio] failed to spawn app: ${err.message}`);
        });
        appProcess.on('exit', (code, signal) => {
            console.log(`[wdio] app exited with code=${code} signal=${signal}`);
        });

        // Wait for the WebDriver server to be ready
        const maxWait = 10000;
        const start = Date.now();
        while (Date.now() - start < maxWait) {
            try {
                const res = await fetch('http://127.0.0.1:4445/status');
                if (res.ok) {
                    console.log('[wdio] WebDriver server ready');
                    return;
                }
            } catch (e) { // not ready yet
                if (Date.now() - start > maxWait - 1000) {
                    console.log('[wdio] waiting for WD server:', e);
                }
            }
            await new Promise(r => setTimeout(r, 500));
        }
        throw new Error(`Tauri app WebDriver server did not start within ${maxWait/1000}s`);
    },

    onComplete: async function () {
        if (appProcess) {
            console.log('[wdio] shutting down Tauri app');
            appProcess.kill('SIGTERM');
            // Give it a moment to shut down gracefully
            await new Promise(r => setTimeout(r, 1000));
            if (appProcess && !appProcess.killed) {
                appProcess.kill('SIGKILL');
            }
            appProcess = null;
        }
    },
};
