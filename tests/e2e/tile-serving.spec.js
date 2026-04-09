// E2E tests for MBTiles and PMTiles tile serving + user catalog integration.
// Uses a real Node.js tile server to serve fixture tiles and verifies
// that user-registered sources render visible tiles on the map.

const { test: base, expect } = require('@playwright/test');
const path = require('path');
const { installOfflineRouteGuard } = require('./helpers');
const { startTileServer, FIXTURES } = require('./tile-server-helper');
const { expectCenterScreenshot } = require('./screenshot-utils');

const MBTILES_PATH = path.join(FIXTURES, 'dummy-z1-z3.mbtiles');
const PMTILES_PATH = path.join(FIXTURES, 'dummy-z1-z3.pmtiles');

// Use zoom 1 and center 0,0 to match the dummy tiles (z1-z3, global coverage)
// At zoom=1, MapLibre requests z=2 tiles (with overzoom for retina), which exist
// test_mode=true disables hillshade which would otherwise obscure tile colors
const BASE_HASH = 'lat=0&lng=0&zoom=1&basemap=none&mode=&test_mode=true';

const test = base.extend({
  tileServer: [async ({}, use) => {
    const srv = await startTileServer({
      'dummy-mbt': { path: MBTILES_PATH, kind: 'mbtiles' },
      'dummy-pmt': { path: PMTILES_PATH, kind: 'pmtiles' },
    });
    await use(srv);
    srv.close();
  }, { scope: 'worker' }],
});

/** Wait for map to be loaded and idle */
async function waitForMapReady(page, timeout = 15000) {
  await page.waitForFunction(
    () => {
      try {
        const map = (0, eval)('map');
        return map && map.loaded() && !map.isMoving();
      } catch { return false; }
    },
    { timeout }
  );
}

/**
 * Navigate to the app with a user source registered.
 * Injects the tile server URL and registers a user source via the JS API.
 */
async function loadWithUserSource(page, tileServerUrl, opts) {
  const { sourceName, sourceKind, hash } = opts;
  const url = `/app/index.html#${hash}`;

  await installOfflineRouteGuard(page);
  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.goto(url, { waitUntil: 'load' });

  // Wait for the app modules to be available
  await page.waitForFunction(
    () => { try { return typeof (0, eval)('map') !== 'undefined'; } catch { return false; } },
    { timeout: 10000 }
  );

  // Register the user source via the tauri-bridge API logic which expects a TileJSON
  await page.evaluate(({ tileBaseUrl, name, kind }) => {
    const tj = kind === 'pmtiles' ? {
      name,
      protocol: 'pmtiles',
      url: `pmtiles://${tileBaseUrl}/pmtiles/${name}`,
      format: 'pmtiles'
    } : {
      name,
      tiles: [`${tileBaseUrl}/tiles/${name}/{z}/{x}/{y}.png`],
      format: 'png'
    };

    // Access the tauri-bridge module via layerRegistry proxy if possible
    const registry = (0, eval)('layerRegistry');
    const entry = registry.buildCatalogEntryFromTileJson(tj, 'basemap');
    registry.registerUserSource(entry);

    // Add the source and layer to the map
    const map = (0, eval)('map');
    
    // CRITICAL: Set basemapOpacity global state for opacity expressions to work
    if (typeof map.setGlobalStateProperty === 'function') {
      map.setGlobalStateProperty('basemapOpacity', 1.0);
    }
    
    const sources = entry.sources;
    for (const [srcId, srcDef] of Object.entries(sources)) {
      if (!map.getSource(srcId)) map.addSource(srcId, srcDef);
    }
    for (const layer of entry.layers) {
      if (!map.getLayer(layer.id)) {
        // Override paint to use fixed opacity instead of global state expression
        // Add without beforeId to place at end of layer list (top of rendering stack)
        const modifiedLayer = { ...layer, paint: { 'raster-opacity': 1.0 } };
        map.addLayer(modifiedLayer);
      }
    }
  }, { tileBaseUrl: tileServerUrl, name: sourceName, kind: sourceKind });

  // Wait for tiles to load
  await waitForMapReady(page);
  await page.waitForTimeout(2000);
  await page.evaluate(() => (0, eval)('map').triggerRepaint());
  await page.waitForTimeout(500);
}

test.describe('Tile Serving (MBTiles)', () => {
  test('MBTiles user source renders visible tiles', async ({ page, tileServer }) => {
    await loadWithUserSource(page, tileServer.url, {
      sourceName: 'dummy-mbt',
      sourceKind: 'mbtiles',
      hash: `${BASE_HASH}`,
    });

    // Check that the map has non-transparent pixels in the center
    const nonWhiteRatio = await page.evaluate(() => {
      const map = (0, eval)('map');
      const canvas = map.getCanvas();
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      if (!gl) return 0;
      const w = 200, h = 200;
      const x = Math.floor((canvas.width - w) / 2);
      const y = Math.floor((canvas.height - h) / 2);
      const pixels = new Uint8Array(w * h * 4);
      gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let nonWhite = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] !== 255 || pixels[i+1] !== 255 || pixels[i+2] !== 255) nonWhite++;
      }
      return nonWhite / (w * h);
    });

    console.log(`MBTiles non-white ratio: ${(nonWhiteRatio * 100).toFixed(1)}%`);
    expect(nonWhiteRatio).toBeGreaterThan(0.01);

    await expectCenterScreenshot(page, 'mbtiles-user-source');
  });
});

test.describe('Tile Serving (PMTiles)', () => {
  test('PMTiles user source renders visible tiles via Range requests', async ({ page, tileServer }) => {
    await loadWithUserSource(page, tileServer.url, {
      sourceName: 'dummy-pmt',
      sourceKind: 'pmtiles',
      hash: `${BASE_HASH}`,
    });

    const nonWhiteRatio = await page.evaluate(() => {
      const map = (0, eval)('map');
      const canvas = map.getCanvas();
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      if (!gl) return 0;
      const w = 200, h = 200;
      const x = Math.floor((canvas.width - w) / 2);
      const y = Math.floor((canvas.height - h) / 2);
      const pixels = new Uint8Array(w * h * 4);
      gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let nonWhite = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] !== 255 || pixels[i+1] !== 255 || pixels[i+2] !== 255) nonWhite++;
      }
      return nonWhite / (w * h);
    });

    console.log(`PMTiles non-white ratio: ${(nonWhiteRatio * 100).toFixed(1)}%`);
    expect(nonWhiteRatio).toBeGreaterThan(0.01);

    await expectCenterScreenshot(page, 'pmtiles-user-source');
  });
});

test.describe('User Catalog Integration', () => {
  test('registerUserSource makes entry available in catalog', async ({ page, tileServer }) => {
    const url = `/app/index.html#test_mode=true`;
    await installOfflineRouteGuard(page);
    await page.goto(url, { waitUntil: 'load' });
    await page.evaluate(() => localStorage.clear());
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(
      () => { try { return (0, eval)('mapReady'); } catch { return false; } },
      { timeout: 10000 }
    );

    const result = await page.evaluate(({ tileBaseUrl }) => {
      const registry = (0, eval)('layerRegistry');
      registry.clearUserSources();

      // Register MBTiles source
      const mbtEntry = registry.buildCatalogEntryFromTileJson({
        name: 'test-mbt',
        tiles: [`${tileBaseUrl}/tiles/test-mbt/{z}/{x}/{y}.png`],
        format: 'png'
      }, 'basemap');
      registry.registerUserSource(mbtEntry);

      // Register PMTiles source
      const pmtEntry = registry.buildCatalogEntryFromTileJson({
        name: 'test-pmt',
        protocol: 'pmtiles',
        url: `pmtiles://${tileBaseUrl}/pmtiles/test-pmt`,
        format: 'pmtiles'
      }, 'basemap');
      registry.registerUserSource(pmtEntry);

      // Verify catalog
      const all = registry.getAllEntries();
      const userEntries = all.filter(e => e.userDefined);
      const basemaps = registry.getBasemaps();
      const userBasemaps = basemaps.filter(e => e.userDefined);

      // Verify PMTiles source uses pmtiles:// protocol
      const pmtSrc = pmtEntry.sources[Object.keys(pmtEntry.sources)[0]];

      // Verify MBTiles source uses tiles array
      const mbtSrc = mbtEntry.sources[Object.keys(mbtEntry.sources)[0]];

      registry.clearUserSources();

      return {
        userCount: userEntries.length,
        userBasemapCount: userBasemaps.length,
        pmtUsesProtocol: pmtSrc.url && pmtSrc.url.startsWith('pmtiles://'),
        mbtUsesTiles: Array.isArray(mbtSrc.tiles),
        pmtUrl: pmtSrc.url,
        mbtTileUrl: mbtSrc.tiles?.[0],
      };
    }, { tileBaseUrl: tileServer.url });

    expect(result.userCount).toBe(2);
    expect(result.userBasemapCount).toBe(2);
    expect(result.pmtUsesProtocol).toBe(true);
    expect(result.mbtUsesTiles).toBe(true);
    expect(result.pmtUrl).toContain('/pmtiles/test-pmt');
    expect(result.mbtTileUrl).toContain('/tiles/test-mbt/');
    console.log('Catalog verification:', JSON.stringify(result, null, 2));
  });

  test('unregisterUserSource removes entry from catalog', async ({ page }) => {
    const url = `/app/index.html#test_mode=true`;
    await installOfflineRouteGuard(page);
    await page.goto(url, { waitUntil: 'load' });
    await page.evaluate(() => localStorage.clear());
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(
      () => { try { return (0, eval)('mapReady'); } catch { return false; } },
      { timeout: 10000 }
    );

    const result = await page.evaluate(() => {
      const registry = (0, eval)('layerRegistry');
      registry.clearUserSources();

      registry.registerUserSource({
        id: 'user-test',
        label: 'Test',
        category: 'basemap',
        userDefined: true,
        sources: {},
        layers: [],
      });

      const beforeCount = registry.getAllEntries().filter(e => e.userDefined).length;
      registry.unregisterUserSource('user-test');
      const afterCount = registry.getAllEntries().filter(e => e.userDefined).length;
      registry.clearUserSources();

      return { beforeCount, afterCount };
    });

    expect(result.beforeCount).toBe(1);
    expect(result.afterCount).toBe(0);
  });
});
