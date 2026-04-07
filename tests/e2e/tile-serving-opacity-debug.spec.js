// Debug test to check basemapOpacity global state
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

test('Debug: Check basemapOpacity global state', async ({ page, tileServer }) => {
  const url = `/app/index.html#${BASE_HASH}`;
  await page.goto(url, { waitUntil: 'load' });
  
  await page.waitForFunction(
    () => { try { return typeof (0, eval)('map') !== 'undefined'; } catch { return false; } },
    { timeout: 10000 }
  );

  const result = await page.evaluate(({ tileBaseUrl }) => {
    const map = (0, eval)('map');
    const registry = (0, eval)('layerRegistry');
    
    // Check initial global state
    const initialOpacity = map.getGlobalStateProperty ? map.getGlobalStateProperty('basemapOpacity') : null;
    
    // Build and register source
    const entry = registry.buildCatalogEntryFromTileSource(
      { name: 'dummy-mbt', path: '/fixtures/dummy-mbt', kind: 'mbtiles' },
      tileBaseUrl,
      'basemap'
    );
    registry.registerUserSource(entry);
    
    // Add source and layer
    const sourceId = Object.keys(entry.sources)[0];
    const sourceDef = entry.sources[sourceId];
    map.addSource(sourceId, sourceDef);
    
    const layer = entry.layers[0];
    map.addLayer(layer);
    
    // Check layer paint properties
    const layerOpacity = map.getPaintProperty(layer.id, 'raster-opacity');
    
    // Set global state explicitly
    if (typeof map.setGlobalStateProperty === 'function') {
      map.setGlobalStateProperty('basemapOpacity', 1.0);
    }
    const afterSetOpacity = map.getGlobalStateProperty ? map.getGlobalStateProperty('basemapOpacity') : null;
    
    // Force repaint
    map.triggerRepaint();
    
    return {
      initialOpacity,
      afterSetOpacity,
      layerOpacity,
      layerId: layer.id,
      sourceId,
    };
  }, { tileBaseUrl: tileServer.url });

  console.log('Opacity check:', JSON.stringify(result, null, 2));
  
  // Wait for tiles to load
  await page.waitForTimeout(3000);
  
  // Check pixels
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
    
    let nonTransparent = 0;
    let nonWhite = 0;
    const samplePixels = [];
    for (let i = 0; i < pixels.length; i += 4) {
      if (i < 40) {
        samplePixels.push([pixels[i], pixels[i+1], pixels[i+2], pixels[i+3]]);
      }
      if (pixels[i+3] > 0) {
        nonTransparent++;
      }
      if (pixels[i] !== 255 || pixels[i+1] !== 255 || pixels[i+2] !== 255) {
        nonWhite++;
      }
    }
    
    return {
      nonTransparent,
      nonWhite,
      totalPixels: w * h,
      samplePixels,
    };
  });

  console.log('Pixel check:', JSON.stringify(pixelCheck, null, 2));
  
  expect(pixelCheck.nonTransparent).toBeGreaterThan(0);
});
