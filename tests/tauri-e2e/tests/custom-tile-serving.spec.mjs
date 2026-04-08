import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
    waitForTauri,
    tauriInvoke,
    installErrorCapture,
    assertNoCapturedErrors,
    takeScreenshot,
} from './helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, '../../fixtures/tiles');
const MBTILES_PATH = path.join(FIXTURES_DIR, 'dummy-z1-z3.mbtiles');
const SOURCE_NAME = 'custom-mbtiles';
const CATALOG_ID = `tilejson-${SOURCE_NAME}`;
const DISPLAY_NAME = 'dummy-z1-z3';

async function waitForCustomMapOption(browser, value, timeout = 20000) {
    await browser.waitUntil(
        async () => browser.execute((expectedValue) => {
            const select = document.getElementById('add-layer');
            const primary = document.getElementById('basemap-primary');
            const addLayerHasOption = Array.from(select?.options || []).some(option => option.value === expectedValue);
            const primaryHasOption = Array.from(primary?.options || []).some(option => option.value === expectedValue.replace(/^basemap:/, ''));
            return addLayerHasOption || primaryHasOption;
        }, value),
        { timeout, timeoutMsg: `Custom map option ${value} not found in add-layer select` }
    );
}

async function waitForCustomMapLabel(browser, label, timeout = 20000) {
    await browser.waitUntil(
        async () => browser.execute((expectedLabel) => {
            const select = document.getElementById('add-layer');
            const primary = document.getElementById('basemap-primary');
            const addLayerHasLabel = Array.from(select?.options || []).some(option => option.textContent === expectedLabel);
            const primaryHasLabel = Array.from(primary?.options || []).some(option => option.textContent === expectedLabel);
            return addLayerHasLabel || primaryHasLabel;
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

async function selectPrimaryBasemap(browser, value) {
    const result = await browser.execute((selectedValue) => {
        const select = document.getElementById('basemap-primary');
        if (!select) return { ok: false, error: '#basemap-primary not found' };
        const option = Array.from(select.options).find(opt => opt.value === selectedValue);
        if (!option) return { ok: false, error: `Primary basemap option not found: ${selectedValue}` };
        select.value = selectedValue;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, label: option.textContent };
    }, value);
    assert.strictEqual(result.ok, true, result.error || 'Selecting primary basemap should succeed');
    return result.label;
}

async function selectPrimaryBasemapByLabel(browser, label) {
    const result = await browser.execute((expectedLabel) => {
        const select = document.getElementById('basemap-primary');
        if (!select) return { ok: false, error: '#basemap-primary not found' };
        const option = Array.from(select.options).find(opt => opt.textContent === expectedLabel);
        if (!option) return { ok: false, error: `Primary basemap option not found for label: ${expectedLabel}` };
        select.value = option.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, label: option.textContent, value: option.value };
    }, label);
    assert.strictEqual(result.ok, true, result.error || 'Selecting primary basemap by label should succeed');
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
        settings.basemap = entryId;
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

        await browser.execute(() => {
            localStorage.removeItem('slope:user-sources');
            localStorage.removeItem('slope:settings');
        });
        await browser.refresh();
        await waitForTauri(browser);
        await installErrorCapture(browser);

        await tauriInvoke(browser, 'remove_tile_source', { name: SOURCE_NAME }).catch(() => {});
        await tauriInvoke(browser, 'add_tile_source', { name: SOURCE_NAME, path: MBTILES_PATH });

        const listedSources = await tauriInvoke(browser, 'list_tile_sources');
        const listed = listedSources.find(source => source.name === SOURCE_NAME);
        assert.ok(listed, 'Source should be present in Tauri tile registry');

        const config = await tauriInvoke(browser, 'get_desktop_config');
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

        await browser.refresh();
        await waitForTauri(browser);
        await installErrorCapture(browser);

        await waitForCustomMapLabel(browser, DISPLAY_NAME);

        const uiStateBefore = await browser.execute((displayName) => {
            const select = document.getElementById('add-layer');
            const options = Array.from(select?.options || []).filter(opt => opt.textContent === displayName);
            const basemapPrimary = document.getElementById('basemap-primary');
            const primaryOption = Array.from(basemapPrimary?.options || []).find(opt => opt.textContent === displayName);
            return {
                addLayerLabels: options.map(opt => opt.textContent || ''),
                addLayerValues: options.map(opt => opt.value || ''),
                primaryOptionLabel: primaryOption?.textContent || null,
                primaryValue: basemapPrimary?.value || null,
                primarySelectedLabel: basemapPrimary?.selectedOptions?.[0]?.textContent || null,
                layerOrderText: document.getElementById('layer-order-list')?.textContent || '',
            };
        }, DISPLAY_NAME);

        assert.ok(
            uiStateBefore.addLayerLabels.length > 0 || uiStateBefore.primaryOptionLabel === DISPLAY_NAME,
            `Custom map should appear in the UI with the metadata label, got add-layer=${uiStateBefore.addLayerLabels.join(',')} primary=${uiStateBefore.primaryOptionLabel}`,
        );

        if (uiStateBefore.primarySelectedLabel === DISPLAY_NAME) {
            console.log('[test] custom source already active as primary basemap');
        } else if (uiStateBefore.primaryOptionLabel === DISPLAY_NAME) {
            await selectPrimaryBasemapByLabel(browser, DISPLAY_NAME);
        } else {
            await selectAddLayerOptionByLabel(browser, DISPLAY_NAME);
        }

        await browser.waitUntil(
            async () => browser.execute((displayName) => {
                const layerOrderText = document.getElementById('layer-order-list')?.textContent || '';
                const primarySelectedLabel = document.getElementById('basemap-primary')?.selectedOptions?.[0]?.textContent || '';
                return layerOrderText.includes(displayName) || primarySelectedLabel === displayName;
            }, DISPLAY_NAME),
            { timeout: 20000, timeoutMsg: 'Custom map did not become active in the UI' }
        );

        await browser.pause(2000);

        const ratioResult = await getCenterNonWhiteRatio(browser);
        console.log(`[test] custom tile center non-white ratio: ${JSON.stringify(ratioResult)}`);

        await takeScreenshot(browser, '02-custom-mbtiles-active');

        assert.strictEqual(ratioResult.ok, true, ratioResult.error || 'Canvas probe should succeed');
        assert.ok(ratioResult.nonWhiteRatio > 0.01, `Expected visible non-white pixels, got ratio ${ratioResult.nonWhiteRatio}`);
    });
});
