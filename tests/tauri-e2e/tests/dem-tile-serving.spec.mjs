import assert from 'assert';
import {
    waitForTauri,
    tauriInvoke,
    takeScreenshot,
    installErrorCapture,
    getCapturedErrors,
    filterErrors,
    waitForError,
} from './helpers.mjs';

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
        // 404 is expected for nonexistent source — but the server responded
        assert.strictEqual(result.status, 404, 'Should get 404 for unknown tile source');
    });

    it('DEM tile requests to localhost return 404 (no DEM source registered)', async () => {
        // This is the bug: the app requests /tiles/dem/{z}/{x}/{y}.webp
        // from the tile server, but no "dem" tile source is registered.
        //
        // We install error capture hooks, then wait for the map to make
        // DEM tile requests which will fail with 404.

        await waitForTauri(browser);
        await installErrorCapture(browser);

        // Wait for the map to initialize and start requesting DEM tiles.
        // The app loads in normal mode (not test_mode), so it will request DEM tiles.
        // Give it time to make at least a few tile requests.
        await browser.pause(5000);

        // Also probe directly: request a DEM tile that the map would request
        const config = await tauriInvoke(browser, 'get_desktop_config');
        const probeResult = await browser.executeAsync(async (baseUrl, done) => {
            try {
                const res = await fetch(`${baseUrl}/tiles/dem/10/530/366.webp`);
                done({ status: res.status });
            } catch (e) {
                done({ error: e.message });
            }
        }, config.tile_base_url);

        console.log(`[test] Direct DEM tile probe: status=${probeResult.status}`);
        assert.strictEqual(
            probeResult.status, 404,
            `DEM tile should 404 because no "dem" source is registered. Got: ${probeResult.status}`
        );

        // Check for captured fetch errors related to DEM tiles
        const allErrors = await getCapturedErrors(browser);
        const demErrors = filterErrors(allErrors, /tiles\/dem\/.*\.webp/);

        console.log(`[test] Total captured errors: ${allErrors.length}`);
        console.log(`[test] DEM-related errors: ${demErrors.length}`);
        for (const e of demErrors.slice(0, 5)) {
            console.log(`[test]   ${e.type}: ${e.message}`);
        }

        // The DEM tile requests should fail. This test documents the bug:
        // the tile server has no "dem" source registered, so all DEM tile
        // fetches return 404.
        //
        // When this test passes (404s detected), the bug is confirmed.
        // When the bug is fixed (DEM source registered or tiles served),
        // update this test to assert 200 instead.
        assert.ok(
            demErrors.length > 0 || probeResult.status === 404,
            'DEM tile requests should be failing with 404 (bug: no DEM source registered)'
        );

        await takeScreenshot(browser, '01-dem-tile-404');
    });

    it('lists tile sources — dem should NOT be present', async () => {
        await waitForTauri(browser);
        const sources = await tauriInvoke(browser, 'list_tile_sources');
        console.log(`[test] registered tile sources: ${JSON.stringify(sources.map(s => s.name))}`);

        const demSource = sources.find(s => s.name === 'dem');
        assert.strictEqual(
            demSource, undefined,
            `No "dem" tile source should be registered. Found sources: ${sources.map(s => s.name).join(', ')}`
        );
    });
});
