import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
    waitForTauri,
    tauriInvoke,
    takeScreenshot,
    installErrorCapture,
    getCapturedErrors,
    filterErrors,
} from './helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, '../../fixtures/tiles/dem');

/** Read a fixture tile and return its base64 encoding. */
function readFixtureB64(z, x, y, ext = 'png') {
    const filePath = path.join(FIXTURES_DIR, `${z}/${x}/${y}.${ext}`);
    return fs.readFileSync(filePath).toString('base64');
}

describe('DEM Tile Serving (Tauri desktop)', () => {

    it('Tauri runtime is available', async () => {
        await waitForTauri(browser);
        const hasTauri = await browser.execute(() => Boolean(window.__TAURI_INTERNALS__));
        assert.strictEqual(hasTauri, true, 'Tauri runtime should be present');
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
            const data = readFixtureB64(t.z, t.x, t.y, 'png');
            // Inject as .webp extension since that's what the frontend requests
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

    it('no fetch errors for injected DEM tiles', async () => {
        await waitForTauri(browser);
        await installErrorCapture(browser);

        const config = await tauriInvoke(browser, 'get_desktop_config');

        // Fetch each injected tile and verify no errors
        const tiles = [
            { z: 10, x: 530, y: 363 },
            { z: 10, x: 530, y: 364 },
            { z: 10, x: 530, y: 365 },
            { z: 10, x: 531, y: 363 },
        ];

        for (const t of tiles) {
            const result = await browser.executeAsync(async (baseUrl, z, x, y, done) => {
                try {
                    const res = await fetch(`${baseUrl}/tiles/dem/${z}/${x}/${y}.webp`);
                    done({ status: res.status });
                } catch (e) {
                    done({ error: e.message });
                }
            }, config.tile_base_url, t.z, t.x, t.y);

            assert.strictEqual(result.status, 200,
                `dem/${t.z}/${t.x}/${t.y}.webp should be 200, got ${result.status}`);
        }

        // Verify no fetch errors were captured
        const allErrors = await getCapturedErrors(browser);
        const demErrors = filterErrors(allErrors, /tiles\/dem\/.*(363|364|365).*\.webp/);
        assert.strictEqual(demErrors.length, 0,
            `Expected no fetch errors for injected tiles, got: ${demErrors.map(e => e.message).join(', ')}`);

        await takeScreenshot(browser, '01-dem-tile-cache-working');
    });
});
