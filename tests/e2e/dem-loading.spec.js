// E2E test: verify DEM data loads and renders color-relief on a non-white canvas.
// Reproduces: basemap=none + mode=color-relief should show colored elevation data.

const { expect } = require('@playwright/test');
const { test } = require('./helpers');

// Known Alpine location with DEM data, non-test-mode so DEM layers are active
const DEM_URL = '/app/index.html#lat=46.8&lng=8.2&zoom=10&mode=color-relief&basemap=none';

test.describe('DEM Loading', () => {
  test('color-relief mode renders non-white canvas (DEM tiles load)', async ({ page }) => {
    // Monitor DEM tile network requests
    const demRequests = [];
    page.on('request', req => {
      if (req.url().includes('mapterhorn')) demRequests.push({ url: req.url(), method: req.method() });
    });
    const demResponses = [];
    page.on('response', res => {
      if (res.url().includes('mapterhorn')) demResponses.push({ url: res.url(), status: res.status() });
    });

    await page.goto(DEM_URL, { waitUntil: 'load' });
    await page.evaluate(() => localStorage.clear());
    await page.goto(DEM_URL, { waitUntil: 'load' });

    // Wait for map idle (tiles loaded)
    await page.waitForFunction(
      () => {
        try {
          const map = (0, eval)('map');
          return map && map.loaded() && !map.isMoving();
        } catch { return false; }
      },
      { timeout: 15000 }
    );

    // Extra wait for DEM tile decoding + render
    await page.waitForTimeout(3000);
    await page.evaluate(() => (0, eval)('map').triggerRepaint());
    await page.waitForTimeout(500);

    // Diagnostic: check analysis-relief layer visibility and DEM source state
    const diag = await page.evaluate(() => {
      const map = (0, eval)('map');
      const reliefLayer = map.getLayer('analysis-relief');
      const demSource = map.getSource('dem-hd');
      return {
        reliefExists: !!reliefLayer,
        reliefVisibility: reliefLayer ? map.getLayoutProperty('analysis-relief', 'visibility') : null,
        demSourceExists: !!demSource,
        demSourceType: demSource?.type,
        mapLoaded: map.loaded(),
        style: {
          sourceCount: Object.keys(map.getStyle()?.sources || {}).length,
          layerCount: (map.getStyle()?.layers || []).length,
        },
      };
    });
    console.log('DEM diagnostic:', JSON.stringify(diag));
    console.log(`DEM requests: ${demRequests.length}, responses: ${demResponses.length}`);
    if (demResponses.length > 0) {
      console.log('DEM response samples:', JSON.stringify(demResponses.slice(0, 3)));
    }

    // Collect JS console errors
    const consoleErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

    // Read pixels during the render frame (WebGL clears buffer after compositing,
    // so we must read inside a 'render' event handler)
    const pixelInfo = await page.evaluate(() => {
      return new Promise((resolve) => {
        const map = (0, eval)('map');
        map.once('render', () => {
          const canvas = map.getCanvas();
          const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
          if (!gl) { resolve({ error: 'no webgl context' }); return; }

          const w = gl.drawingBufferWidth;
          const h = gl.drawingBufferHeight;
          const stripH = 20;
          const y = Math.floor(h / 2) - Math.floor(stripH / 2);
          const pixels = new Uint8Array(w * stripH * 4);
          gl.readPixels(0, y, w, stripH, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

          let nonWhite = 0;
          let total = 0;
          for (let i = 0; i < pixels.length; i += 4) {
            total++;
            const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2], a = pixels[i + 3];
            if (a > 0 && (r < 240 || g < 240 || b < 240)) {
              nonWhite++;
            }
          }
          resolve({ nonWhite, total, ratio: nonWhite / total, width: w, stripH });
        });
        map.triggerRepaint();
      });
    });

    console.log('DEM pixels:', JSON.stringify(pixelInfo));

    expect(pixelInfo.error).toBeUndefined();
    // At least 5% of sampled strip should be non-white if DEM color relief renders
    expect(pixelInfo.ratio).toBeGreaterThan(0.05);
  });
});
