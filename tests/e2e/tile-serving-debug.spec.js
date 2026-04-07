// Debug test to investigate why tiles render as white
const { test: base, expect } = require('@playwright/test');
const path = require('path');
const { startTileServer, FIXTURES } = require('./tile-server-helper');

const MBTILES_PATH = path.join(FIXTURES, 'dummy-z1-z3.mbtiles');
const BASE_HASH = 'lat=0&lng=0&zoom=2&basemap=none&mode=';

const test = base.extend({
  tileServer: [async ({}, use) => {
    const srv = await startTileServer({
      'dummy-mbt': { path: MBTILES_PATH, kind: 'mbtiles' },
    });
    await use(srv);
    srv.close();
  }, { scope: 'worker' }],
});

test('Debug: Check tile server directly', async ({ tileServer }) => {
  // Test the tile server directly via fetch
  const tileUrl = `${tileServer.url}/tiles/dummy-mbt/2/0/0.png`;
  console.log('Fetching tile from:', tileUrl);
  
  const response = await fetch(tileUrl);
  console.log('Response status:', response.status);
  console.log('Response headers:', Object.fromEntries(response.headers.entries()));
  
  const buffer = await response.arrayBuffer();
  console.log('Tile size:', buffer.byteLength, 'bytes');
  
  expect(response.status).toBe(200);
  expect(buffer.byteLength).toBeGreaterThan(100);
});

test('Debug: Check layer registry buildCatalogEntryFromTileSource', async ({ page, tileServer }) => {
  const url = `/app/index.html#${BASE_HASH}`;
  await page.goto(url, { waitUntil: 'load' });
  
  await page.waitForFunction(
    () => { try { return typeof (0, eval)('map') !== 'undefined'; } catch { return false; } },
    { timeout: 10000 }
  );

  const result = await page.evaluate(({ tileBaseUrl }) => {
    const registry = (0, eval)('layerRegistry');
    const entry = registry.buildCatalogEntryFromTileSource(
      { name: 'dummy-mbt', path: '/fixtures/dummy-mbt', kind: 'mbtiles' },
      tileBaseUrl,
      'basemap'
    );
    
    const sourceId = Object.keys(entry.sources)[0];
    const sourceDef = entry.sources[sourceId];
    
    return {
      entryId: entry.id,
      sourceId,
      sourceType: sourceDef.type,
      hasTiles: Array.isArray(sourceDef.tiles),
      tilesUrl: sourceDef.tiles?.[0],
      layerCount: entry.layers.length,
      firstLayerId: entry.layers[0]?.id,
      firstLayerType: entry.layers[0]?.type,
      firstLayerSource: entry.layers[0]?.source,
    };
  }, { tileBaseUrl: tileServer.url });

  console.log('Layer registry result:', JSON.stringify(result, null, 2));
  
  expect(result.hasTiles).toBe(true);
  expect(result.tilesUrl).toContain('/tiles/dummy-mbt/');
  expect(result.sourceType).toBe('raster');
});

test('Debug: Manually add source and layer, check network requests', async ({ page, tileServer }) => {
  const url = `/app/index.html#${BASE_HASH}`;
  await page.goto(url, { waitUntil: 'load' });
  
  await page.waitForFunction(
    () => { try { return typeof (0, eval)('map') !== 'undefined'; } catch { return false; } },
    { timeout: 10000 }
  );

  // Capture network requests
  const tileRequests = [];
  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('/tiles/')) {
      tileRequests.push({
        url,
        status: response.status(),
        contentType: response.headers()['content-type'],
      });
    }
  });

  const result = await page.evaluate(({ tileBaseUrl }) => {
    const map = (0, eval)('map');
    
    // Manually add source
    const sourceId = 'test-mbtiles-source';
    const tilesUrl = `${tileBaseUrl}/tiles/dummy-mbt/{z}/{x}/{y}.png`;
    
    map.addSource(sourceId, {
      type: 'raster',
      tiles: [tilesUrl],
      tileSize: 256,
      minzoom: 0,
      maxzoom: 3,
    });
    
    // Manually add layer
    map.addLayer({
      id: 'test-mbtiles-layer',
      type: 'raster',
      source: sourceId,
      paint: {
        'raster-opacity': 1.0,
      },
    });
    
    // Check if source/layer exist
    const hasSource = !!map.getSource(sourceId);
    const hasLayer = !!map.getLayer('test-mbtiles-layer');
    
    // Get layer visibility
    const visibility = map.getLayoutProperty('test-mbtiles-layer', 'visibility');
    
    return {
      hasSource,
      hasLayer,
      visibility,
      tilesUrl,
      zoom: map.getZoom(),
      center: map.getCenter(),
    };
  }, { tileBaseUrl: tileServer.url });

  console.log('Manual source/layer result:', JSON.stringify(result, null, 2));
  
  // Wait for tiles to load
  await page.waitForTimeout(3000);
  
  console.log('Tile requests captured:', tileRequests.length);
  tileRequests.forEach(req => console.log('  -', req.url, req.status));
  
  // Check canvas for non-white pixels
  const pixelCheck = await page.evaluate(() => {
    const map = (0, eval)('map');
    const canvas = map.getCanvas();
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return { error: 'No WebGL context' };
    
    const w = 200, h = 200;
    const x = Math.floor((canvas.width - w) / 2);
    const y = Math.floor((canvas.height - h) / 2);
    const pixels = new Uint8Array(w * h * 4);
    gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    
    let nonWhite = 0;
    const samplePixels = [];
    for (let i = 0; i < pixels.length; i += 4) {
      if (i < 40) {
        samplePixels.push([pixels[i], pixels[i+1], pixels[i+2], pixels[i+3]]);
      }
      if (pixels[i] !== 255 || pixels[i+1] !== 255 || pixels[i+2] !== 255) {
        nonWhite++;
      }
    }
    
    return {
      nonWhiteCount: nonWhite,
      totalPixels: w * h,
      nonWhiteRatio: nonWhite / (w * h),
      samplePixels,
    };
  });

  console.log('Pixel check:', JSON.stringify(pixelCheck, null, 2));
  
  expect(result.hasSource).toBe(true);
  expect(result.hasLayer).toBe(true);
  expect(tileRequests.length).toBeGreaterThan(0);
});
