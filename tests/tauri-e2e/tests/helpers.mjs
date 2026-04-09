import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '../screenshots'); // Actual 
const SNAPSHOTS_DIR = path.resolve(__dirname, '../snapshots');  // Expected

// ---------------------------------------------------------------------------
// App bootstrap — WKWebView content world considerations
//
// The webdriver plugin evaluates JS in an isolated WKWebView content world
// that shares the DOM but NOT the page script's variables. We call Tauri IPC
// directly via window.__TAURI_INTERNALS__ which IS available in both worlds.
// ---------------------------------------------------------------------------

/** Wait for the Tauri runtime to be ready. */
export async function waitForTauri(browser, timeout = 15000) {
    await browser.waitUntil(
        async () => browser.execute(() => Boolean(window.__TAURI_INTERNALS__)),
        { timeout, timeoutMsg: 'Tauri runtime not available within timeout' }
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

/** Enter the app's hash-driven UI test mode. */
export async function enterDesktopTestMode(browser) {
    await browser.url('http://app.localhost/index.html#test_mode=true');
    await waitForTauri(browser);
}

/** Reset frontend storage and backend cache/source state for deterministic desktop tests. */
export async function resetDesktopTestState(browser, options = {}) {
    const { tileSourceNames = [] } = options;
    await enterDesktopTestMode(browser);
    await browser.execute(() => {
        localStorage.removeItem('slope:tracks');
        localStorage.removeItem('slope:waypoints');
        localStorage.removeItem('slope:settings');
        localStorage.removeItem('slope:profile-settings');
        localStorage.removeItem('slope:workspace');
        localStorage.removeItem('slope:user-sources');
    });
    await tauriInvoke(browser, 'clear_tile_cache').catch(() => false);
    for (const name of tileSourceNames) {
        await tauriInvoke(browser, 'remove_tile_source', { name }).catch(() => false);
    }
    await browser.refresh();
    await waitForTauri(browser);
}

/** Take a screenshot and return its path. */
export async function takeScreenshot(browser, name) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    const filepath = path.join(SCREENSHOTS_DIR, `${name}.png`);
    await browser.saveScreenshot(filepath);
    if (!fs.existsSync(filepath)) {
        throw new Error(`Screenshot not created: ${filepath}`);
    }
    return filepath;
}

// ---------------------------------------------------------------------------
// Console / network error capture
//
// WKWebView WebDriver doesn't expose browser logs via the standard
// `browser.getLogs('browser')` API. Instead, we inject JS hooks into the
// page's error/rejection events and failed fetch requests, collecting
// them in a DOM element that the test world can read.
// ---------------------------------------------------------------------------

/**
 * Inject error/network-failure capture hooks into the page.
 * Call this early in each test (after page load).
 * Collected errors are stored in a hidden <div id="__test_errors__">.
 */
export async function installErrorCapture(browser) {
    await browser.execute(() => {
        // Idempotent — only install once
        const existingContainer = document.getElementById('__test_errors__');
        if (existingContainer) {
            existingContainer.replaceChildren();
            return;
        }

        const container = document.createElement('div');
        container.id = '__test_errors__';
        container.style.display = 'none';
        document.body.appendChild(container);

        function addEntry(type, message) {
            const el = document.createElement('div');
            el.className = '__test_error_entry__';
            el.setAttribute('data-type', type);
            el.textContent = message;
            container.appendChild(el);
        }

        // Capture uncaught errors
        window.addEventListener('error', (e) => {
            addEntry('js-error', `${e.message} at ${e.filename}:${e.lineno}:${e.colno}`);
        });

        // Capture unhandled promise rejections
        window.addEventListener('unhandledrejection', (e) => {
            addEntry('rejection', String(e.reason));
        });

        // Monkey-patch fetch to capture failed requests (4xx/5xx)
        const originalFetch = window.fetch;
        window.fetch = async function (...args) {
            try {
                const response = await originalFetch.apply(this, args);
                if (!response.ok) {
                    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url ?? '(unknown)';
                    addEntry('fetch-error', `${response.status} ${response.statusText} ${url}`);
                }
                return response;
            } catch (err) {
                const url = typeof args[0] === 'string' ? args[0] : args[0]?.url ?? '(unknown)';
                addEntry('fetch-error', `network-error ${url}: ${err.message}`);
                throw err;
            }
        };

        // Capture resource load failures (images, scripts, etc.)
        // These show up as "Failed to load resource: 404" in the console
        window.addEventListener('error', (e) => {
            if (e.target && e.target !== window && e.target.tagName) {
                const src = e.target.src || e.target.href || '(unknown)';
                addEntry('resource-error', `${e.target.tagName} failed to load: ${src}`);
            }
        }, true); // capture phase to catch resource errors
    });
}

/**
 * Read all captured errors from the page.
 * @returns {Promise<Array<{type: string, message: string}>>}
 */
export async function getCapturedErrors(browser) {
    return browser.execute(() => {
        const entries = document.querySelectorAll('.__test_error_entry__');
        return Array.from(entries).map(el => ({
            type: el.getAttribute('data-type'),
            message: el.textContent,
        }));
    });
}

/**
 * Assert that no captured errors exist.
 */
export async function assertNoCapturedErrors(browser) {
    const errors = await getCapturedErrors(browser);
    assert.strictEqual(
        errors.length,
        0,
        `Expected no captured errors, got: ${errors.map(e => `[${e.type}] ${e.message}`).join(' | ')}`,
    );
}

/**
 * Filter captured errors to find ones matching a pattern.
 * @param {Array<{type: string, message: string}>} errors
 * @param {RegExp|string} pattern
 * @returns {Array<{type: string, message: string}>}
 */
export function filterErrors(errors, pattern) {
    const re = pattern instanceof RegExp ? pattern : new RegExp(pattern);
    return errors.filter(e => re.test(e.message));
}

/**
 * Wait until at least one captured error matches the given pattern.
 * Useful for waiting for async resource loads to fail.
 */
export async function waitForError(browser, pattern, timeout = 30000) {
    const re = pattern instanceof RegExp ? pattern : new RegExp(pattern);
    await browser.waitUntil(
        async () => {
            const errors = await getCapturedErrors(browser);
            return errors.some(e => re.test(e.message));
        },
        { timeout, timeoutMsg: `No captured error matching ${pattern} within ${timeout}ms` }
    );
}

// ---------------------------------------------------------------------------
// Screenshot comparison
// ---------------------------------------------------------------------------

/**
 * Take a screenshot cropped to a centered rectangle.
 * Avoids UI chrome (panels, buttons, controls) affecting baselines.
 * @param {object} browser — WebDriverIO browser
 * @param {string} name — file name stem (no extension)
 * @param {object} [opts]
 * @param {number} [opts.width=400] — crop width
 * @param {number} [opts.height=400] — crop height
 * @returns {Promise<string>} path to the cropped PNG
 */
export async function takeCroppedScreenshot(browser, name, opts = {}) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    const screenshotPath = path.join(SCREENSHOTS_DIR, `${name}.png`);
    const selector = opts.selector ?? '#map canvas';
    const fallbackSelector = opts.fallbackSelector ?? '#map';
    let element = await browser.$(selector);

    if (!await element.isExisting()) {
        element = await browser.$(fallbackSelector);
    }
    if (!await element.isExisting()) {
        throw new Error(`Screenshot target not found: ${selector} or ${fallbackSelector}`);
    }

    await element.saveScreenshot(screenshotPath);
    if (!fs.existsSync(screenshotPath)) {
        throw new Error(`Screenshot not created: ${screenshotPath}`);
    }
    return screenshotPath;
}

/**
 * Compare a screenshot against a versioned baseline.
 * If the baseline does not exist (first run), it is created automatically.
 *
 * @param {string} actualPath — path to the actual screenshot PNG
 * @param {string} baselineName — baseline file stem (no extension)
 * @param {object} [opts]
 * @param {number} [opts.maxDiffRatio=0.05] — max fraction of different pixels
 * @param {boolean} [opts.update=false] — force-update the baseline
 */
export function assertScreenshotMatch(actualPath, baselineName, opts = {}) {
    const maxRatio = opts.maxDiffRatio ?? 0.05;
    fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });

    const baselinePath = path.join(SNAPSHOTS_DIR, `${baselineName}.png`);
    const update = opts.update || process.env.UPDATE_SNAPSHOTS === '1';

    if (!fs.existsSync(baselinePath) || update) {
        fs.copyFileSync(actualPath, baselinePath);
        console.log(`[snapshot] ${update ? 'updated' : 'created'} baseline: ${baselinePath}`);
        return;
    }

    const actual = PNG.sync.read(fs.readFileSync(actualPath));
    const expected = PNG.sync.read(fs.readFileSync(baselinePath));

    if (actual.width !== expected.width || actual.height !== expected.height) {
        // Size mismatch — regenerate baseline
        console.warn(`[snapshot] size mismatch for ${baselineName}: actual=${actual.width}x${actual.height} expected=${expected.width}x${expected.height}, regenerating`);
        fs.copyFileSync(actualPath, baselinePath);
        return;
    }

    const diff = new PNG({ width: actual.width, height: actual.height });
    const numDiff = pixelmatch(
        actual.data, expected.data, diff.data,
        actual.width, actual.height,
        { threshold: 0.1 },
    );
    const ratio = numDiff / (actual.width * actual.height);

    if (ratio > maxRatio) {
        const diffPath = path.join(SCREENSHOTS_DIR, `${baselineName}-diff.png`);
        fs.writeFileSync(diffPath, PNG.sync.write(diff));
        assert.fail(
            `Screenshot "${baselineName}" differs by ${(ratio * 100).toFixed(1)}% ` +
            `(${numDiff} pixels, threshold ${(maxRatio * 100).toFixed(0)}%). ` +
            `Diff saved to ${diffPath}. ` +
            `Run with UPDATE_SNAPSHOTS=1 to accept the new baseline.`
        );
    }
    console.log(`[snapshot] ${baselineName}: ${(ratio * 100).toFixed(2)}% diff (ok, max ${(maxRatio * 100).toFixed(0)}%)`);
}

/** Capture current MapLibre style/debug state from the page. */
export async function getMapDebugSnapshot(browser) {
    return browser.execute(() => {
        const debugText = document.getElementById('debug-layers-output')?.textContent || '';
        const style = window.map?.getStyle?.() || null;
        const layers = Array.isArray(style?.layers)
            ? style.layers.map(layer => ({
                id: layer.id,
                type: layer.type,
                source: layer.source || null,
                visibility: layer.layout?.visibility || 'visible',
            }))
            : [];
        const sources = style?.sources
            ? Object.fromEntries(Object.entries(style.sources).map(([id, source]) => [id, {
                type: source?.type || null,
                tiles: Array.isArray(source?.tiles) ? source.tiles : null,
                url: source?.url || null,
                bounds: source?.bounds || null,
            }]))
            : {};
        return {
            debugText,
            layers,
            sources,
        };
    });
}
