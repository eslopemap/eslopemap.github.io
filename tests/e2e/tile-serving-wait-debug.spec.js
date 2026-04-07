// Debug test to check if tiles are actually loading
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

test('Debug: Wait for tiles to actually render', async ({ page, tileServer }) => {
  const url = `/app/index.html#${BASE_HASH}`;
  await page.goto(url, { waitUntil: 'load' });
  
  await page.waitForFunction(
    () => { try { return typeof (0, eval)('map') !== 'undefined'; } catch { return false; } },
    { timeout: 10000 }
  );

  // Track tile load events
  const tileEvents = [];
  await page.evaluate(() => {
    const map = (0, eval)('map');
    window.__tileEvents__ = [];
    map.on('data', (e) => {
      if (e.dataType === 'source' && e.sourceDataType === 'content') {
        window.__tileEvents__.push({ type: 'data', sourceId: e.sourceId, time: Date.now() });
      }
    });
    map.on('sourcedata', (e) => {
      window.__tileEvents__.push({ type: 'sourcedata', sourceId: e.sourceId, isSourceLoaded: e.isSourceLoaded, time: Date.now() });
    });
    map.on('idle', () => {
      window.__tileEvents__.push({ type: 'idle', time: Date.now() });
    });
  });

  const result = await page.evaluate(({ tileBaseUrl }) => {
    const map = (0, eval)('map');
    const registry = (0, eval)('layerRegistry');
    
    // Set global state FIRST
    if (typeof map.setGlobalStateProperty === 'function') {
      map.setGlobalStateProperty('basemapOpacity', 1.0);
    }
    
    // Build and register source
    const entry = registry.buildCatalogEntryFromTileSource(
      { name: 'dummy-mbt', path: '/fixtures/dummy-mbt', kind: 'mbtiles' },
      tileBaseUrl,
      'basemap'
    );
    
    // Add source and layer
    const sourceId = Object.keys(entry.sources)[0];
    const sourceDef = entry.sources[sourceId];
    map.addSource(sourceId, sourceDef);
    
    const layer = entry.layers[0];
    map.addLayer(layer);
    
    return {
      sourceId,
      layerId: layer.id,
      tilesUrl: sourceDef.tiles[0],
    };
  }, { tileBaseUrl: tileServer.url });

  console.log('Added source/layer:', result);

  // Wait for map to be idle
  await page.waitForFunction(
    () => {
      const map = (0, eval)('map');
      return map.loaded() && !map.isMoving();
    },
    { timeout: 10000 }
  );

  // Wait a bit more for tiles
  await page.waitForTimeout(5000);

  // Force repaint
  await page.evaluate(() => {
    const map = (0, eval)('map');
    map.triggerRepaint();
  });
  await page.waitForTimeout(1000);

  // Check tile events
  const events = await page.evaluate(() => window.__tileEvents__);
  console.log('Tile events:', events.length);
  events.forEach(e => console.log('  -', JSON.stringify(e)));

  // Check if source is loaded
  const sourceStatus = await page.evaluate((sourceId) => {
    const map = (0, eval)('map');
    const source = map.getSource(sourceId);
    return {
      exists: !!source,
      loaded: source ? map.isSourceLoaded(sourceId) : false,
    };
  }, result.sourceId);
  console.log('Source status:', sourceStatus);

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
    let coloredPixels = 0;
    const samplePixels = [];
    for (let i = 0; i < pixels.length; i += 4) {
      if (i < 40) {
        samplePixels.push([pixels[i], pixels[i+1], pixels[i+2], pixels[i+3]]);
      }
      if (pixels[i+3] > 0) {
        nonTransparent++;
      }
      // Check for actual color (not just black or white)
      if (pixels[i+3] > 0 && (pixels[i] !== 0 || pixels[i+1] !== 0 || pixels[i+2] !== 0) &&
          (pixels[i] !== 255 || pixels[i+1] !== 255 || pixels[i+2] !== 255)) {
        coloredPixels++;
      }
    }
    
    return {
      nonTransparent,
      coloredPixels,
      totalPixels: w * h,
      samplePixels,
    };
  });

  console.log('Pixel check:', JSON.stringify(pixelCheck, null, 2));
  
  // Take a screenshot for manual inspection
  await page.screenshot({ path: '/tmp/tile-debug.png' });
  console.log('Screenshot saved to /tmp/tile-debug.png');
});
