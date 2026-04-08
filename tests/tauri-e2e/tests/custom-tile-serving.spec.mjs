import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
    waitForTauri,
    tauriInvoke,
    installErrorCapture,
    getCapturedErrors,
    filterErrors,
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
            if (!select) return false;
            return Array.from(select.options).some(option => option.value === expectedValue);
        }, value),
        { timeout, timeoutMsg: `Custom map option ${value} not found in add-layer select` }
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

    it('registers a local MBTiles source, exposes it via TileJSON, and makes it available in the UI', async () => {
        if (!fs.existsSync(MBTILES_PATH)) {
            throw new Error(`Missing MBTiles fixture: ${MBTILES_PATH}`);
        }

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

        await waitForCustomMapOption(browser, `basemap:${CATALOG_ID}`);

        const uiStateBefore = await browser.execute((catalogId) => {
            const select = document.getElementById('add-layer');
            const option = Array.from(select?.options || []).find(opt => opt.value === `basemap:${catalogId}`);
            const basemapPrimary = document.getElementById('basemap-primary');
            return {
                optionLabel: option?.textContent || null,
                primaryValue: basemapPrimary?.value || null,
                layerOrderText: document.getElementById('layer-order-list')?.textContent || '',
            };
        }, CATALOG_ID);

        assert.strictEqual(uiStateBefore.optionLabel, DISPLAY_NAME, 'Custom map should appear in the add-layer UI with the metadata label');

        await selectAddLayerOption(browser, `basemap:${CATALOG_ID}`);

        await browser.waitUntil(
            async () => browser.execute((catalogId) => {
                const layerOrderText = document.getElementById('layer-order-list')?.textContent || '';
                const select = document.getElementById('add-layer');
                const stillOffered = Array.from(select?.options || []).some(opt => opt.value === `basemap:${catalogId}`);
                return layerOrderText.includes('dummy-z1-z3') && !stillOffered;
            }, CATALOG_ID),
            { timeout: 20000, timeoutMsg: 'Custom map did not become active in the UI' }
        );

        await browser.pause(2000);

        const ratioResult = await getCenterNonWhiteRatio(browser);
        console.log(`[test] custom tile center non-white ratio: ${JSON.stringify(ratioResult)}`);

        const relevantErrors = filterErrors(
            await getCapturedErrors(browser),
            /custom-mbtiles|dummy-z1-z3|tilejson|tiles\/custom-mbtiles|Map error/i,
        );
        console.log(`[test] captured relevant errors: ${JSON.stringify(relevantErrors)}`);

        await takeScreenshot(browser, '02-custom-mbtiles-active');

        assert.strictEqual(ratioResult.ok, true, ratioResult.error || 'Canvas probe should succeed');
        assert.strictEqual(relevantErrors.length, 0, `Expected no relevant errors, got: ${relevantErrors.map(e => e.message).join(' | ')}`);
        assert.ok(ratioResult.nonWhiteRatio > 0.01, `Expected visible non-white pixels, got ratio ${ratioResult.nonWhiteRatio}`);
    });
});
