import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '../screenshots');

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
