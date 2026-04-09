import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
    waitForTauri,
    tauriInvoke,
    takeScreenshot,
    resetDesktopTestState,
    installErrorCapture,
    getCapturedErrors,
    filterErrors,
    assertScreenshotMatch,
} from './helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, '../../fixtures/tiles/dem');
const EMPTY_UI_HASH = 'test_mode=true';
const NORMAL_DEM_HASH = 'lat=45.8326&lng=6.8652&zoom=12&basemap=none&opacity=1&mode=slope%2Brelief';

/** Read a fixture tile and return its base64 encoding. */
function readFixtureB64(z, x, y, ext = 'png') {
    const filePath = path.join(FIXTURES_DIR, `${z}/${x}/${y}.${ext}`);
    return fs.readFileSync(filePath).toString('base64');
}

async function convertPngBase64ToWebpBase64(browser, pngBase64) {
    const result = await browser.executeAsync((inputBase64, done) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                done({ ok: false, error: '2d canvas context unavailable' });
                return;
            }
            ctx.drawImage(img, 0, 0);
            const webpUrl = canvas.toDataURL('image/webp');
            done({ ok: true, base64: webpUrl.split(',')[1] || '' });
        };
        img.onerror = () => done({ ok: false, error: 'failed to decode PNG fixture' });
        img.src = `data:image/png;base64,${inputBase64}`;
    }, pngBase64);

    assert.strictEqual(result.ok, true, `PNG→WebP conversion should succeed: ${result.error || 'unknown error'}`);
    assert.ok(result.base64, 'Converted WebP payload should not be empty');
    return result.base64;
}

async function waitForMapReady(browser, timeout = 15000) {
    await browser.waitUntil(
        async () => browser.execute(() => {
            try {
                const map = window.map;
                if (!map) return false;
                const canvas = map.getCanvas?.();
                return Boolean(canvas && canvas.width > 0 && canvas.height > 0);
            } catch {
                return false;
            }
        }),
        { timeout, timeoutMsg: `Map did not become ready within ${timeout}ms` },
    );
}

async function waitForEmptyUiReady(browser, timeout = 15000) {
    await browser.waitUntil(
        async () => browser.execute(() => {
            try {
                const map = window.map;
                if (!map) return false;
                const canvas = map.getCanvas?.();
                const layerOrder = document.getElementById('layer-order-list');
                return Boolean(
                    canvas &&
                    canvas.width > 0 &&
                    canvas.height > 0 &&
                    layerOrder &&
                    layerOrder.textContent?.includes('None (primary)')
                );
            } catch {
                return false;
            }
        }),
        { timeout, timeoutMsg: `Empty UI did not become ready within ${timeout}ms` },
    );
}

async function getDemDiagnostic(browser) {
    return browser.execute(() => {
        const reliefLayer = window.map?.getLayer('analysis-relief');
        const analysisLayer = window.map?.getLayer('analysis');
        const demSource = window.map?.getSource('dem-hd');
        const modeEl = document.getElementById('mode');
        return {
            mode: modeEl ? modeEl.value : null,
            hash: window.location.hash,
            reliefExists: !!reliefLayer,
            reliefVisibility: reliefLayer ? window.map.getLayoutProperty('analysis-relief', 'visibility') : null,
            analysisExists: !!analysisLayer,
            analysisVisibility: analysisLayer ? window.map.getLayoutProperty('analysis', 'visibility') : null,
            demSourceExists: !!demSource,
            mapLoaded: !!window.map?.loaded?.(),
            zoom: window.map?.getZoom?.() ?? null,
            center: window.map ? [window.map.getCenter().lng, window.map.getCenter().lat] : null,
        };
    });
}

async function readMapPixels(browser) {
    return browser.executeAsync((done) => {
        const map = window.map;
        if (!map) {
            done({ error: 'map unavailable' });
            return;
        }

        function samplePixels() {
            const canvas = map.getCanvas();
            const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
            if (!gl) {
                done({ error: 'no webgl context' });
                return;
            }

            const w = gl.drawingBufferWidth;
            const h = gl.drawingBufferHeight;
            const stripH = 40;
            const yOff = Math.floor(h / 2) - Math.floor(stripH / 2);
            const pixels = new Uint8Array(w * stripH * 4);
            gl.readPixels(0, yOff, w, stripH, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

            let nonWhite = 0;
            let total = 0;
            for (let i = 0; i < pixels.length; i += 4) {
                total += 1;
                const r = pixels[i];
                const g = pixels[i + 1];
                const b = pixels[i + 2];
                const a = pixels[i + 3];
                if (a > 0 && (r < 240 || g < 240 || b < 240)) nonWhite += 1;
            }
            done({ nonWhite, total, ratio: nonWhite / total });
        }

        map.triggerRepaint();
        requestAnimationFrame(() => {
            requestAnimationFrame(samplePixels);
        });
    });
}

async function waitForDemRenderReady(browser, timeout = 15000) {
    await browser.waitUntil(
        async () => {
            const diag = await getDemDiagnostic(browser);
            if (!diag.demSourceExists || !diag.analysisExists || !diag.reliefExists) return false;
            if (diag.mode !== 'slope+relief') return false;
            if (!diag.hash.includes('basemap=none')) return false;
            if (!(diag.analysisVisibility === 'visible' || diag.reliefVisibility === 'visible')) return false;
            const pixels = await readMapPixels(browser);
            return !pixels.error && pixels.ratio > 0.05;
        },
        { timeout, timeoutMsg: `DEM render did not become ready within ${timeout}ms` },
    );
}

async function navigateWithHash(browser, hash) {
    await browser.execute((nextHash) => {
        window.location.hash = nextHash;
    }, hash);
    await browser.pause(500);
    await browser.refresh();
    await waitForTauri(browser);
    await waitForMapReady(browser);
}

describe('DEM Tile Serving (Tauri desktop)', () => {

    it('Tauri runtime is available', async () => {
        await waitForTauri(browser);
        const hasTauri = await browser.execute(() => Boolean(window.__TAURI_INTERNALS__));
        assert.strictEqual(hasTauri, true, 'Tauri runtime should be present');
    });

    it('empty UI state matches baseline (no basemap, DEM 404)', async () => {
        // Clean up any leftover state from prior specs
        await resetDesktopTestState(browser, {
            tileSourceNames: ['custom-mbtiles', 'custom-pmtiles', 'test-tile'],
        });
        await navigateWithHash(browser, EMPTY_UI_HASH);
        await waitForEmptyUiReady(browser);
        const screenshotPath = await takeScreenshot(browser, '01-dem-tile-404');
        assertScreenshotMatch(screenshotPath, '01-dem-tile-404', { maxDiffRatio: 0.08 });
    });

    it('desktop config exposes tile server URL', async () => {
        await waitForTauri(browser);
        const config = await tauriInvoke(browser, 'get_desktop_config');
        assert.ok(config, 'get_desktop_config should return a value');
        assert.strictEqual(config.runtime, 'tauri');
        assert.ok(
            config.tile_base_url.startsWith('http://127.0.0.1:'),
            `tile_base_url should be localhost, got: ${config.tile_base_url}`
        );
        console.log(`[test] tile server at: ${config.tile_base_url}`);
    });

    it('tile server is reachable from the browser', async () => {
        await waitForTauri(browser);
        const config = await tauriInvoke(browser, 'get_desktop_config');

        // Probe the tile server directly from the webview
        const result = await browser.executeAsync(async (baseUrl, done) => {
            try {
                const res = await fetch(`${baseUrl}/tiles/nonexistent/0/0/0.png`);
                done({ status: res.status, ok: res.ok });
            } catch (e) {
                done({ error: e.message });
            }
        }, config.tile_base_url);

        assert.ok(!result.error, `Tile server should be reachable, got error: ${result.error}`);
        assert.strictEqual(result.status, 404, 'Should get 404 for unknown tile source');
    });

    it('cache stats are available', async () => {
        await waitForTauri(browser);
        const stats = await tauriInvoke(browser, 'get_cache_stats');
        console.log(`[test] cache stats: ${JSON.stringify(stats)}`);

        assert.ok(stats.root, 'cache root should be set');
        assert.ok(stats.max_size_bytes > 0, 'max cache size should be positive');
        console.log(`[test] cache at: ${stats.root} (max ${stats.max_size_bytes / 1024 / 1024} MB)`);
    });

    it('inject DEM fixture tiles into the cache', async () => {
        await waitForTauri(browser);

        // Inject a few z10 tiles from the fixture set
        const tiles = [
            { z: 10, x: 530, y: 363 },
            { z: 10, x: 530, y: 364 },
            { z: 10, x: 530, y: 365 },
            { z: 10, x: 531, y: 363 },
        ];

        for (const t of tiles) {
            const pngBase64 = readFixtureB64(t.z, t.x, t.y, 'png');
            const data = await convertPngBase64ToWebpBase64(browser, pngBase64);
            // Inject as real .webp payloads since that's what the frontend requests
            const cachedPath = await tauriInvoke(browser, 'inject_cached_tile', {
                source: 'dem',
                z: t.z, x: t.x, y: t.y,
                ext: 'webp',
                data,
            });
            console.log(`[test] injected dem/${t.z}/${t.x}/${t.y}.webp -> ${cachedPath}`);
        }

        // Verify cache stats updated
        const stats = await tauriInvoke(browser, 'get_cache_stats');
        assert.ok(stats.file_count >= tiles.length,
            `Expected at least ${tiles.length} cached files, got ${stats.file_count}`);
        console.log(`[test] cache now has ${stats.file_count} files (${stats.total_size_bytes} bytes)`);
    });

    it('cached DEM tiles are served with HTTP 200', async () => {
        await waitForTauri(browser);
        const config = await tauriInvoke(browser, 'get_desktop_config');

        // Request a tile we just injected — should be served from cache
        const result = await browser.executeAsync(async (baseUrl, done) => {
            try {
                const res = await fetch(`${baseUrl}/tiles/dem/10/530/365.webp`);
                const blob = await res.blob();
                done({ status: res.status, size: blob.size, type: res.headers.get('content-type') });
            } catch (e) {
                done({ error: e.message });
            }
        }, config.tile_base_url);

        console.log(`[test] cached tile: status=${result.status} size=${result.size} type=${result.type}`);
        assert.ok(!result.error, `Fetch should succeed: ${result.error}`);
        assert.strictEqual(result.status, 200, `Cached DEM tile should return 200, got ${result.status}`);
        assert.ok(result.size > 0, 'Tile body should not be empty');
    });

    it('non-cached DEM tiles attempt upstream fetch (may 502 in test env)', async () => {
        // A tile that is NOT in our injected set will trigger an upstream fetch
        // to tiles.mapterhorn.com. In the test environment this may succeed (if
        // internet is available) or fail with 502. Either way, it should NOT 404
        // because "dem" is now a recognized cached upstream source.
        await waitForTauri(browser);
        const config = await tauriInvoke(browser, 'get_desktop_config');

        const result = await browser.executeAsync(async (baseUrl, done) => {
            try {
                const res = await fetch(`${baseUrl}/tiles/dem/0/0/0.webp`);
                done({ status: res.status });
            } catch (e) {
                done({ error: e.message });
            }
        }, config.tile_base_url);

        console.log(`[test] non-cached tile: status=${result.status}`);
        assert.ok(!result.error, `Fetch should not throw: ${result.error}`);
        // Should be 200 (upstream success) or 502 (upstream unreachable) — not 404
        assert.ok(
            [200, 502].includes(result.status),
            `Expected 200 or 502, got ${result.status}`
        );
    });

    it('cache-backed DEM tiles drive slope+relief rendering in normal mode', async () => {
        await resetDesktopTestState(browser, {
            tileSourceNames: ['custom-mbtiles', 'custom-pmtiles', 'test-tile'],
        });
        const renderTiles = [
            { z: 12, x: 2125, y: 1458 },
            { z: 12, x: 2125, y: 1459 },
            { z: 12, x: 2125, y: 1460 },
            { z: 12, x: 2126, y: 1458 },
            { z: 12, x: 2126, y: 1459 },
            { z: 12, x: 2126, y: 1460 },
            { z: 12, x: 2127, y: 1458 },
            { z: 12, x: 2127, y: 1459 },
            { z: 12, x: 2127, y: 1460 },
        ];

        for (const t of renderTiles) {
            const pngBase64 = readFixtureB64(t.z, t.x, t.y, 'png');
            const webpBase64 = await convertPngBase64ToWebpBase64(browser, pngBase64);
            const cachedPath = await tauriInvoke(browser, 'inject_cached_tile', {
                source: 'dem',
                z: t.z,
                x: t.x,
                y: t.y,
                ext: 'webp',
                data: webpBase64,
            });
            console.log(`[test] injected render dem/${t.z}/${t.x}/${t.y}.webp -> ${cachedPath}`);
        }

        await navigateWithHash(browser, NORMAL_DEM_HASH);
        await installErrorCapture(browser);
        await waitForDemRenderReady(browser);
        const diag = await getDemDiagnostic(browser);
        const pixels = await readMapPixels(browser);
        const errors = filterErrors(await getCapturedErrors(browser), [
            /Failed to fetch/i,
            /NetworkError/i,
            /Load failed/i,
        ]);

        console.log(`[test] dem diagnostic: ${JSON.stringify(diag)}`);
        console.log(`[test] dem pixels: ${JSON.stringify(pixels)}`);
        console.log(`[test] dem errors: ${JSON.stringify(errors)}`);

        assert.strictEqual(diag.demSourceExists, true, 'DEM source should exist in normal mode');
        assert.strictEqual(diag.analysisExists, true, 'Analysis layer should exist');
        assert.strictEqual(diag.reliefExists, true, 'Relief companion layer should exist');
        assert.ok(
            diag.analysisVisibility === 'visible' || diag.reliefVisibility === 'visible',
            `Expected a DEM analysis layer to be visible, got analysis=${diag.analysisVisibility} relief=${diag.reliefVisibility}`,
        );
        assert.ok(!pixels.error, `Pixel probe should succeed: ${pixels.error}`);
        assert.ok(pixels.ratio > 0.05, `Expected visible DEM rendering, got pixel ratio ${pixels.ratio}`);
        assert.strictEqual(errors.length, 0, `Expected no fetch/runtime errors during DEM render, got: ${errors.map(e => `[${e.type}] ${e.message}`).join(' | ')}`);

        const screenshotPath = await takeScreenshot(browser, '01-dem-tile-cache-working');
        assertScreenshotMatch(screenshotPath, '01-dem-tile-cache-working', { maxDiffRatio: 0.08 });
    });
});
