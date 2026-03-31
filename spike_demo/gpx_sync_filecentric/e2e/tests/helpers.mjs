import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '../screenshots');

// ---------------------------------------------------------------------------
// Embedded GPX samples — no fixture files needed
// ---------------------------------------------------------------------------

export const GPX_SAMPLES = {
    simple: `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="e2e-test">
  <trk><name>Morning Ride</name>
    <trkseg>
      <trkpt lat="45.1" lon="6.1"><ele>1000</ele></trkpt>
      <trkpt lat="45.2" lon="6.2"><ele>1100</ele></trkpt>
    </trkseg>
  </trk>
</gpx>`,

    simple2: `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="e2e-test">
  <trk><name>Afternoon Walk</name>
    <trkseg>
      <trkpt lat="44.0" lon="5.0"><ele>500</ele></trkpt>
      <trkpt lat="44.1" lon="5.1"><ele>520</ele></trkpt>
    </trkseg>
  </trk>
</gpx>`,

    multiTrack: `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="e2e-test">
  <trk><name>Col du Galibier</name>
    <trkseg>
      <trkpt lat="45.06" lon="6.40"><ele>2000</ele></trkpt>
      <trkpt lat="45.07" lon="6.41"><ele>2100</ele></trkpt>
    </trkseg>
  </trk>
  <trk><name>Col du Lautaret</name>
    <trkseg>
      <trkpt lat="45.04" lon="6.40"><ele>2058</ele></trkpt>
    </trkseg>
  </trk>
</gpx>`,
};

// ---------------------------------------------------------------------------
// Temp folder management
// ---------------------------------------------------------------------------

/** Create a fresh temp dir and optionally write GPX files into it. */
export function createTestFolder(files = {}) {
    // Resolve symlinks (macOS: /var -> /private/var) to avoid path mismatches
    const tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gpx-sync-e2e-')));
    for (const [name, content] of Object.entries(files)) {
        fs.writeFileSync(path.join(tmpDir, name), content, 'utf-8');
    }
    return tmpDir;
}

export function cleanupTestFolder(tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
}

export function readTestFile(tmpDir, filename) {
    return fs.readFileSync(path.join(tmpDir, filename), 'utf-8');
}

export function writeTestFile(tmpDir, filename, content) {
    fs.writeFileSync(path.join(tmpDir, filename), content, 'utf-8');
}

export function deleteTestFile(tmpDir, filename) {
    fs.unlinkSync(path.join(tmpDir, filename));
}

export function renameTestFile(tmpDir, oldName, newName) {
    fs.renameSync(path.join(tmpDir, oldName), path.join(tmpDir, newName));
}

// ---------------------------------------------------------------------------
// App bootstrap — works around WKWebView isolated content worlds
//
// The webdriver plugin evaluates JS in an isolated WKWebView content world
// that shares the DOM but NOT the page script's variables. We call Tauri IPC
// directly via window.__TAURI_INTERNALS__ which IS available in both worlds.
// ---------------------------------------------------------------------------

/** Wait for the Tauri runtime to be ready. */
export async function waitForTauri(browser, timeout = 10000) {
    await browser.waitUntil(
        async () => browser.execute(() => Boolean(window.__TAURI_INTERNALS__)),
        { timeout, timeoutMsg: 'Tauri runtime not available' }
    );
}

/** Invoke a Tauri command from the test world. */
export async function tauriInvoke(browser, cmd, args = {}) {
    const result = await browser.executeAsync(async (c, a, done) => {
        try {
            const r = await window.__TAURI_INTERNALS__.invoke(c, a);
            done({ ok: true, value: r });
        } catch (e) {
            done({ ok: false, error: String(e) });
        }
    }, cmd, args);
    if (!result.ok) throw new Error(`tauriInvoke(${cmd}) failed: ${result.error}`);
    return result.value;
}

/** Watch a folder via Tauri IPC; returns the snapshot. */
export async function watchFolder(browser, folderPath) {
    await waitForTauri(browser);
    const result = await tauriInvoke(browser, 'pick_and_watch_folder', { folderPath });
    // Update DOM: set folder path display
    await browser.execute((fp) => {
        const el = document.getElementById('folder-path');
        if (el) el.textContent = fp;
    }, folderPath);
    return result.snapshot;
}

/** Load a GPX file via IPC; returns the content string. */
export async function loadGpx(browser, filePath) {
    return tauriInvoke(browser, 'load_gpx', { path: filePath });
}

/** Save GPX content via IPC. */
export async function saveGpx(browser, filePath, content) {
    return tauriInvoke(browser, 'save_gpx', { path: filePath, content });
}

/** Mark a file dirty via IPC. */
export async function markDirty(browser, filePath) {
    return tauriInvoke(browser, 'mark_dirty', { path: filePath });
}

/** Accept a disk change via IPC. */
export async function acceptChange(browser, filePath) {
    return tauriInvoke(browser, 'accept_change', { path: filePath });
}

/** Resolve conflict via IPC. */
export async function resolveConflict(browser, filePath, keep, appContent = null) {
    return tauriInvoke(browser, 'resolve_conflict', {
        path: filePath, keep, appContent,
    });
}

// ---------------------------------------------------------------------------
// DOM interaction helpers
// ---------------------------------------------------------------------------

/** Click a file in the sidebar by filename (short name). */
export async function selectFile(browser, filename) {
    const items = await browser.$$('.file-item');
    for (const item of items) {
        const nameEl = await item.$('.filename');
        const text = await nameEl.getText();
        if (text === filename) {
            await item.click();
            await browser.pause(300);
            return;
        }
    }
    throw new Error(`File not found in list: ${filename}`);
}

/** Get the editor textarea value. */
export async function getEditorContent(browser) {
    return browser.$('#editor').then(el => el.getValue());
}

/** Set editor textarea value. */
export async function setEditorContent(browser, content) {
    const editor = await browser.$('#editor');
    await editor.setValue(content);
    await browser.pause(100);
}

/** Get text of all log entries (newest first). */
export async function getLogEntries(browser) {
    const entries = await browser.$$('.log-entry');
    const texts = [];
    for (const e of entries) texts.push(await e.getText());
    return texts;
}

/** Check if the conflict bar has the 'visible' class. */
export async function isConflictVisible(browser) {
    const cls = await browser.$('#conflict-bar').then(el => el.getAttribute('class'));
    return cls.includes('visible');
}

/** Get a file's status class from the sidebar dot. */
export async function getFileStatus(browser, filename) {
    const items = await browser.$$('.file-item');
    for (const item of items) {
        const text = await item.$('.filename').then(el => el.getText());
        if (text === filename) {
            const cls = await item.$('.status-dot').then(el => el.getAttribute('class'));
            return cls.replace('status-dot', '').trim();
        }
    }
    return null;
}

/** Wait for the file list to contain exactly `count` items. */
export async function waitForFileCount(browser, count, timeout = 5000) {
    await browser.waitUntil(
        async () => (await browser.$$('.file-item')).length === count,
        { timeout, timeoutMsg: `Expected ${count} files, got ${(await browser.$$('.file-item')).length}` }
    );
}

// ---------------------------------------------------------------------------
// Screenshot primitive
// ---------------------------------------------------------------------------

/** Take a screenshot and return its path. Asserts the file was created. */
export async function takeScreenshot(browser, name) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    const filepath = path.join(SCREENSHOTS_DIR, `${name}.png`);
    await browser.saveScreenshot(filepath);
    if (!fs.existsSync(filepath)) {
        throw new Error(`Screenshot not created: ${filepath}`);
    }
    const stat = fs.statSync(filepath);
    if (stat.size === 0) {
        throw new Error(`Screenshot is empty: ${filepath}`);
    }
    return filepath;
}

// ---------------------------------------------------------------------------
// Tauri log check primitive
//
// Since the page script runs in a separate world, we read the event log DOM
// directly — it's the authoritative source for what the app logged.
// ---------------------------------------------------------------------------

/** Wait for a log entry matching a regex pattern. */
export async function waitForLog(browser, pattern, timeout = 5000) {
    const re = pattern instanceof RegExp ? pattern : new RegExp(pattern);
    await browser.waitUntil(
        async () => {
            const entries = await getLogEntries(browser);
            return entries.some(e => re.test(e));
        },
        { timeout, timeoutMsg: `No log entry matching ${pattern} within ${timeout}ms` }
    );
}

/** Assert that at least one log entry matches the pattern. */
export async function assertLogContains(browser, pattern) {
    const re = pattern instanceof RegExp ? pattern : new RegExp(pattern);
    const entries = await getLogEntries(browser);
    const found = entries.find(e => re.test(e));
    if (!found) {
        throw new Error(
            `Expected log matching ${pattern}, got:\n${entries.join('\n') || '(empty)'}`
        );
    }
    return found;
}
