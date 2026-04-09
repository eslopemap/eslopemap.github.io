import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
    waitForTauri,
    tauriInvoke,
    resetDesktopTestState,
    installErrorCapture,
    assertNoCapturedErrors,
    getMapDebugSnapshot,
    takeScreenshot,
    takeCroppedScreenshot,
    assertScreenshotMatch,
} from './helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, '../../fixtures/tiles');
const MBTILES_PATH = path.join(FIXTURES_DIR, 'dummy-z1-z3.mbtiles');
const PMTILES_PATH = path.join(FIXTURES_DIR, 'dummy-z1-z3.pmtiles');
const SOURCE_NAME = 'custom-mbtiles';
const PMTILES_SOURCE_NAME = 'custom-pmtiles';
const CATALOG_ID = `tilejson-${SOURCE_NAME}`;
const DISPLAY_NAME = 'dummy-z1-z3';

async function waitForCustomMapOption(browser, value, timeout = 20000) {
    await browser.waitUntil(
        async () => browser.execute((expectedValue) => {
            const select = document.getElementById('add-layer');
            return Array.from(select?.options || []).some(option => option.value === expectedValue);
        }, value),
        { timeout, timeoutMsg: `Custom map option ${value} not found in add-layer select` }
    );
}

async function waitForCustomMapLabel(browser, label, timeout = 20000) {
    await browser.waitUntil(
        async () => browser.execute((expectedLabel) => {
            const select = document.getElementById('add-layer');
            const layerOrder = document.getElementById('layer-order-list');
            const addLayerHasLabel = Array.from(select?.options || []).some(option => option.textContent === expectedLabel);
            const layerOrderHasLabel = layerOrder?.textContent?.includes(expectedLabel) || false;
            return addLayerHasLabel || layerOrderHasLabel;
        }, label),
        { timeout, timeoutMsg: `Custom map label ${label} not found in UI controls` }
    );
}

async function selectAddLayerOption(browser, value) {
    const result = await browser.execute((selectedValue) => {
        const select = document.getElementById('add-layer');
        if (!select) return { ok: false, error: '#add-layer not found' };
        const option = Array.from(select.options).find(opt => opt.value === selectedValue);
        if (!option) return { ok: false, error: `Option not found: ${selectedValue}` };
        select.value = selectedValue;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, label: option.textContent };
    }, value);
    assert.strictEqual(result.ok, true, result.error || 'Selecting custom map should succeed');
    return result.label;
}

async function selectAddLayerOptionByLabel(browser, label) {
    const result = await browser.execute((expectedLabel) => {
        const select = document.getElementById('add-layer');
        if (!select) return { ok: false, error: '#add-layer not found' };
        const option = Array.from(select.options).find(opt => opt.textContent === expectedLabel);
        if (!option) return { ok: false, error: `Option not found for label: ${expectedLabel}` };
        select.value = option.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, label: option.textContent, value: option.value };
    }, label);
    assert.strictEqual(result.ok, true, result.error || 'Selecting custom map by label should succeed');
    return result;
}


async function seedPersistedCustomSource(browser, tileJson) {
    await browser.execute((tj) => {
        const stableId = tj.id || tj.name || 'unknown';
        const entryId = `tilejson-${stableId}`;
        const sourceId = `src-tj-${stableId}`;
        const existingSources = JSON.parse(localStorage.getItem('slope:user-sources') || '[]');
        const filteredSources = existingSources.filter(entry => entry?.id !== entryId);

        const sourceDef = tj.protocol === 'pmtiles'
            ? { type: 'raster', url: tj.url, tileSize: 256 }
            : { type: 'raster', tiles: tj.tiles || [], tileSize: 256 };

        if (tj.minzoom != null) sourceDef.minzoom = tj.minzoom;
        if (tj.maxzoom != null) sourceDef.maxzoom = tj.maxzoom;
        if (tj.attribution) sourceDef.attribution = tj.attribution;
        if (tj.bounds) sourceDef.bounds = tj.bounds;

        filteredSources.push({
            id: entryId,
            label: tj.name || 'unknown',
            category: 'basemap',
            region: tj.bounds || null,
            defaultView: tj.center ? { center: [tj.center[0], tj.center[1]], zoom: tj.center[2] || 10 } : null,
            userDefined: true,
            tileJson: tj,
            sources: { [sourceId]: sourceDef },
            layers: [
                {
                    id: `basemap-${entryId}`,
                    type: 'raster',
                    source: sourceId,
                    paint: { 'raster-opacity': 1 },
                }
            ],
        });
        localStorage.setItem('slope:user-sources', JSON.stringify(filteredSources));

        const settings = JSON.parse(localStorage.getItem('slope:settings') || '{}');
        settings.basemapStack = [entryId];
        localStorage.setItem('slope:settings', JSON.stringify(settings));
    }, tileJson);
}

async function getCenterNonWhiteRatio(browser) {
    return browser.execute(() => {
        const canvas = document.querySelector('#map canvas');
        if (!canvas) return { ok: false, error: 'Map canvas not found' };
        const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true })
            || canvas.getContext('webgl', { preserveDrawingBuffer: true });
        if (!gl) return { ok: false, error: 'WebGL context not available' };
        const width = Math.min(200, canvas.width || 0);
        const height = Math.min(200, canvas.height || 0);
        if (!width || !height) return { ok: false, error: `Invalid canvas size: ${canvas.width}x${canvas.height}` };
        const x = Math.max(0, Math.floor((canvas.width - width) / 2));
        const y = Math.max(0, Math.floor((canvas.height - height) / 2));
        const pixels = new Uint8Array(width * height * 4);
        gl.readPixels(x, y, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let nonWhite = 0;
        for (let i = 0; i < pixels.length; i += 4) {
            if (pixels[i] !== 255 || pixels[i + 1] !== 255 || pixels[i + 2] !== 255) nonWhite += 1;
        }
        return {
            ok: true,
            canvasWidth: canvas.width,
            canvasHeight: canvas.height,
            sampleWidth: width,
            sampleHeight: height,
            nonWhiteRatio: nonWhite / (width * height),
        };
    });
}

describe('Custom Tile Serving (Tauri desktop)', () => {
    beforeEach(async () => {
        await waitForTauri(browser);
        await installErrorCapture(browser);
    });

    afterEach(async () => {
        await assertNoCapturedErrors(browser);
    });

    it('registers a local MBTiles source, exposes it via TileJSON, and makes it available in the UI', async () => {
        if (!fs.existsSync(MBTILES_PATH)) {
            throw new Error(`Missing MBTiles fixture: ${MBTILES_PATH}`);
        }

        await resetDesktopTestState(browser, { tileSourceNames: [SOURCE_NAME] });
        await installErrorCapture(browser);

        await tauriInvoke(browser, 'add_tile_source', { name: SOURCE_NAME, path: MBTILES_PATH });

        const listedSources = await tauriInvoke(browser, 'list_tile_sources');
        const listed = listedSources.find(source => source.name === SOURCE_NAME);
        assert.ok(listed, 'Source should be present in Tauri tile registry');

        const config = await tauriInvoke(browser, 'get_desktop_config');
        console.log(`[test] desktop config: ${JSON.stringify(config)}`);
        assert.strictEqual(config.test_mode, true, 'Desktop config should report test mode during WDIO runs');
        assert.ok(config.config_path.includes('slopemapper-tauri-e2e'), `Expected isolated test config path, got ${config.config_path}`);
        assert.ok(config.cache_root.includes('slopemapper-tauri-e2e'), `Expected isolated test cache root, got ${config.cache_root}`);
        assert.ok(Array.isArray(config.cached_source_names) && config.cached_source_names.includes('dem'), 'Desktop config should expose cached upstream source names');

        const tileJsonResult = await browser.executeAsync((baseUrl, done) => {
            fetch(`${baseUrl}/tilejson`)
                .then(async (res) => done({ ok: true, status: res.status, body: await res.json() }))
                .catch((e) => done({ ok: false, error: String(e) }));
        }, config.tile_base_url);
        const singleSourceResult = await browser.executeAsync((baseUrl, sourceName, done) => {
            fetch(`${baseUrl}/tilejson/${sourceName}`)
                .then(async (res) => done({ ok: true, status: res.status, body: await res.json() }))
                .catch((e) => done({ ok: false, error: String(e) }));
        }, config.tile_base_url, SOURCE_NAME);
        const tileResult = await browser.executeAsync((baseUrl, sourceName, done) => {
            fetch(`${baseUrl}/tiles/${sourceName}/2/2/2.png`)
                .then(async (res) => {
                    const buffer = await res.arrayBuffer();
                    done({ ok: true, status: res.status, size: buffer.byteLength, type: res.headers.get('content-type') });
                })
                .catch((e) => done({ ok: false, error: String(e) }));
        }, config.tile_base_url, SOURCE_NAME);

        assert.strictEqual(tileJsonResult.ok, true, tileJsonResult.error || 'TileJSON flow should succeed');
        assert.strictEqual(tileJsonResult.status, 200, 'TileJSON index should return 200');
        assert(Array.isArray(tileJsonResult.body), 'TileJSON index should be an array');
        assert.strictEqual(singleSourceResult.ok, true, singleSourceResult.error || 'Single-source TileJSON should succeed');
        assert.strictEqual(singleSourceResult.status, 200, 'Single-source TileJSON should return 200');
        assert.strictEqual(singleSourceResult.body.id, SOURCE_NAME, 'TileJSON id should match the stable registered source id');
        assert.strictEqual(singleSourceResult.body.name, DISPLAY_NAME, 'TileJSON display name should preserve fixture metadata name');
        assert(Array.isArray(singleSourceResult.body.tiles), 'MBTiles TileJSON should expose tiles');
        assert.strictEqual(tileResult.ok, true, tileResult.error || 'Direct tile fetch should succeed');
        assert.strictEqual(tileResult.status, 200, 'Fixture tile should be served with 200');
        assert.ok(tileResult.size > 0, 'Fixture tile body should not be empty');

        await seedPersistedCustomSource(browser, singleSourceResult.body);

        // Set zoom=2 so only z1-z3 fixture tiles are requested (no internet needed)
        await browser.execute(() => {
            window.location.hash = 'test_mode=true&zoom=2&lng=0&lat=0';
        });
        await browser.pause(500);
        await browser.refresh();
        await waitForTauri(browser);
        await installErrorCapture(browser);

        await waitForCustomMapLabel(browser, DISPLAY_NAME);

        const uiStateBefore = await browser.execute((displayName) => {
            const select = document.getElementById('add-layer');
            const options = Array.from(select?.options || []).filter(opt => opt.textContent === displayName);
            const layerOrderText = document.getElementById('layer-order-list')?.textContent || '';
            return {
                addLayerLabels: options.map(opt => opt.textContent || ''),
                addLayerValues: options.map(opt => opt.value || ''),
                layerOrderText,
                alreadyActive: layerOrderText.includes(displayName),
            };
        }, DISPLAY_NAME);

        assert.ok(
            uiStateBefore.addLayerLabels.length > 0 || uiStateBefore.alreadyActive,
            `Custom map should appear in the UI with the metadata label, got add-layer=${uiStateBefore.addLayerLabels.join(',')} layerOrder=${uiStateBefore.alreadyActive}`,
        );

        if (uiStateBefore.alreadyActive) {
            console.log('[test] custom source already active in layer order');
        } else {
            await selectAddLayerOptionByLabel(browser, DISPLAY_NAME);
        }

        await browser.waitUntil(
            async () => browser.execute((displayName) => {
                const layerOrderText = document.getElementById('layer-order-list')?.textContent || '';
                return layerOrderText.includes(displayName);
            }, DISPLAY_NAME),
            { timeout: 20000, timeoutMsg: 'Custom map did not become active in the UI' }
        );

        await browser.pause(2000);

        const debugSnapshot = await getMapDebugSnapshot(browser);
        console.log(`[test] map debug snapshot: ${JSON.stringify(debugSnapshot)}`);

        const ratioResult = await getCenterNonWhiteRatio(browser);
        console.log(`[test] custom tile center non-white ratio: ${JSON.stringify(ratioResult)}`);

        await takeScreenshot(browser, '02-custom-mbtiles-active');

        assert.strictEqual(ratioResult.ok, true, ratioResult.error || 'Canvas probe should succeed');
        assert.ok(ratioResult.nonWhiteRatio > 0.01, `Expected visible non-white pixels, got ratio ${ratioResult.nonWhiteRatio}`);

        // Cropped map-center screenshot — only map content, no UI chrome
        const croppedPath = await takeCroppedScreenshot(browser, '02-custom-mbtiles-map', { width: 400, height: 400 });
        assertScreenshotMatch(croppedPath, '02-custom-mbtiles-map', { maxDiffRatio: 0.08 });
    });

    it('registers a local PMTiles source, activates it, and verifies map rendering', async () => {
        if (!fs.existsSync(PMTILES_PATH)) {
            throw new Error(`Missing PMTiles fixture: ${PMTILES_PATH}`);
        }

        await resetDesktopTestState(browser, { tileSourceNames: [PMTILES_SOURCE_NAME] });
        await installErrorCapture(browser);

        // Register the PMTiles source
        await tauriInvoke(browser, 'add_tile_source', { name: PMTILES_SOURCE_NAME, path: PMTILES_PATH });

        const listedSources = await tauriInvoke(browser, 'list_tile_sources');
        const listed = listedSources.find(source => source.name === PMTILES_SOURCE_NAME);
        assert.ok(listed, 'PMTiles source should be present in Tauri tile registry');

        // Get TileJSON for the PMTiles source
        const config = await tauriInvoke(browser, 'get_desktop_config');
        const singleSourceResult = await browser.executeAsync((baseUrl, sourceName, done) => {
            fetch(`${baseUrl}/tilejson/${sourceName}`)
                .then(async (res) => done({ ok: true, status: res.status, body: await res.json() }))
                .catch((e) => done({ ok: false, error: String(e) }));
        }, config.tile_base_url, PMTILES_SOURCE_NAME);

        assert.strictEqual(singleSourceResult.ok, true, singleSourceResult.error || 'PMTiles TileJSON should succeed');
        assert.strictEqual(singleSourceResult.status, 200, 'PMTiles TileJSON should return 200');

        // Seed the user source into localStorage and reload at z2 (within fixture range z1-z3)
        await seedPersistedCustomSource(browser, singleSourceResult.body);
        await browser.execute(() => {
            window.location.hash = 'test_mode=true&zoom=2&lng=0&lat=0';
        });
        await browser.pause(500);
        await browser.refresh();
        await waitForTauri(browser);
        await installErrorCapture(browser);

        // PMTiles TileJSON uses the registered source name as display name
        const pmDisplayName = singleSourceResult.body.name || PMTILES_SOURCE_NAME;
        console.log(`[test] PMTiles display name: ${pmDisplayName}`);
        await waitForCustomMapLabel(browser, pmDisplayName);

        const uiState = await browser.execute((displayName) => {
            const layerOrderText = document.getElementById('layer-order-list')?.textContent || '';
            return { alreadyActive: layerOrderText.includes(displayName) };
        }, pmDisplayName);

        if (!uiState.alreadyActive) {
            await selectAddLayerOptionByLabel(browser, pmDisplayName);
        }

        await browser.waitUntil(
            async () => browser.execute((displayName) => {
                const layerOrderText = document.getElementById('layer-order-list')?.textContent || '';
                return layerOrderText.includes(displayName);
            }, pmDisplayName),
            { timeout: 20000, timeoutMsg: 'PMTiles custom map did not become active in the UI' }
        );

        await browser.pause(2000);

        const ratioResult = await getCenterNonWhiteRatio(browser);
        console.log(`[test] PMTiles center non-white ratio: ${JSON.stringify(ratioResult)}`);

        assert.strictEqual(ratioResult.ok, true, ratioResult.error || 'Canvas probe should succeed');
        assert.ok(ratioResult.nonWhiteRatio > 0.01, `Expected visible non-white pixels for PMTiles, got ratio ${ratioResult.nonWhiteRatio}`);

        const croppedPath = await takeCroppedScreenshot(browser, '03-custom-pmtiles-map', { width: 400, height: 400 });
        assertScreenshotMatch(croppedPath, '03-custom-pmtiles-map', { maxDiffRatio: 0.08 });
    });
});
