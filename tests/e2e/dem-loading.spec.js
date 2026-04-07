// E2E tests for DEM rendering — runs in NORMAL mode (not test_mode).
// Uses synthetic Terrarium-encoded DEM tiles served via route interception.

const { expect } = require('@playwright/test');
const { test } = require('./helpers');
const fs = require('fs');
const path = require('path');

const DEM_FIXTURES = path.resolve(__dirname, '../fixtures/tiles/dem');

// Default location with explicit coords so map position is deterministic
const BASE_HASH = 'lat=45.8326&lng=6.8652&zoom=12&basemap=none&opacity=1';
const NORMAL_URL = `/app/index.html#${BASE_HASH}&mode=color-relief`;

/**
 * Intercept mapterhorn DEM tile requests and serve synthetic local tiles.
 * Falls back to a 1x1 transparent PNG for tiles not in the fixture set.
 */
async function interceptDemTiles(page) {
  const served = [];
  // 1x1 transparent PNG fallback
  const EMPTY_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQAB' +
    'Nl7BcQAAAABJRU5ErkJggg==', 'base64'
  );

  await page.route('**/tiles.mapterhorn.com/**', async (route) => {
    const url = route.request().url();
    const match = url.match(/\/(\d+)\/(\d+)\/(\d+)\.\w+$/);
    if (!match) {
      await route.fulfill({ status: 404, body: 'not found' });
      return;
    }
    const [, z, x, y] = match;
    const filePath = path.join(DEM_FIXTURES, z, x, `${y}.png`);
    served.push(`${z}/${x}/${y}`);

    if (fs.existsSync(filePath)) {
      const body = fs.readFileSync(filePath);
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body,
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: EMPTY_PNG,
      });
    }
  });
  return served;
}

/**
 * Read pixels from WebGL canvas inside a render frame.
 * Returns { nonWhite, total, ratio }.
 */
async function readMapPixels(page) {
  return page.evaluate(() => {
    return new Promise((resolve) => {
      const map = (0, eval)('map');
      map.once('render', () => {
        const canvas = map.getCanvas();
        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
        if (!gl) { resolve({ error: 'no webgl context' }); return; }

        const w = gl.drawingBufferWidth;
        const h = gl.drawingBufferHeight;
        const stripH = 40;
        const yOff = Math.floor(h / 2) - Math.floor(stripH / 2);
        const pixels = new Uint8Array(w * stripH * 4);
        gl.readPixels(0, yOff, w, stripH, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

        let nonWhite = 0, total = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          total++;
          const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2], a = pixels[i + 3];
          if (a > 0 && (r < 240 || g < 240 || b < 240)) nonWhite++;
        }
        resolve({ nonWhite, total, ratio: nonWhite / total });
      });
      map.triggerRepaint();
    });
  });
}

/** Wait for the map to be fully loaded and idle. */
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

/** Get DEM layer diagnostic info. */
async function getDemDiagnostic(page) {
  return page.evaluate(() => {
    const map = (0, eval)('map');
    const reliefLayer = map.getLayer('analysis-relief');
    const analysisLayer = map.getLayer('analysis');
    const demSource = map.getSource('dem-hd');
    return {
      reliefExists: !!reliefLayer,
      reliefVisibility: reliefLayer ? map.getLayoutProperty('analysis-relief', 'visibility') : null,
      analysisExists: !!analysisLayer,
      analysisVisibility: analysisLayer ? map.getLayoutProperty('analysis', 'visibility') : null,
      demSourceExists: !!demSource,
      mapLoaded: map.loaded(),
    };
  });
}

/**
 * Wait for DEM tiles to be decoded and rendered.
 * Polls the map idle state + triggers repaints.
 */
async function waitForDemRender(page, { maxMs = 8000 } = {}) {
  const start = Date.now();
  // Give initial time for tile requests + decode
  await page.waitForTimeout(1500);
  // Poll until either non-white pixels appear or time runs out
  while (Date.now() - start < maxMs) {
    await page.evaluate(() => (0, eval)('map').triggerRepaint());
    await page.waitForTimeout(400);
    const check = await page.evaluate(() => {
      const map = (0, eval)('map');
      const canvas = map.getCanvas();
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      if (!gl) return { ready: false };
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      const pixels = new Uint8Array(w * 40 * 4);
      gl.readPixels(0, Math.floor(h / 2) - 20, w, 40, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let nonWhite = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] > 0 && (pixels[i] < 240 || pixels[i + 1] < 240 || pixels[i + 2] < 240)) nonWhite++;
      }
      return { ready: nonWhite > 10, nonWhite };
    });
    if (check.ready) return;
  }
}

test.describe('DEM Rendering (normal mode, synthetic tiles)', () => {
  // DEM rendering with SwiftShader is slow — use generous timeout
  test.describe.configure({ timeout: 30_000 });

  test('color-relief mode shows elevation colors', async ({ page }) => {
    const served = await interceptDemTiles(page);

    await page.goto(NORMAL_URL, { waitUntil: 'load' });
    await page.evaluate(() => localStorage.clear());
    await page.goto(NORMAL_URL, { waitUntil: 'load' });

    await waitForMapReady(page);
    await waitForDemRender(page);

    const zoom = await page.evaluate(() => (0, eval)('map').getZoom());
    const diag = await getDemDiagnostic(page);
    console.log('Map zoom:', zoom);
    console.log('DEM diag:', JSON.stringify(diag));
    console.log(`DEM tiles served (${served.length}):`, JSON.stringify(served));

    expect(diag.reliefExists).toBe(true);
    expect(diag.reliefVisibility).toBe('visible');
    expect(served.length).toBeGreaterThan(0);

    const pixels = await readMapPixels(page);
    console.log('Pixels:', JSON.stringify(pixels));
    expect(pixels.ratio).toBeGreaterThan(0.05);

    // Screenshot comparison — update baseline with: npx playwright test --update-snapshots
    await expect(page).toHaveScreenshot('dem-color-relief.png', {
      maxDiffPixelRatio: 0.05,
    });
  });

  test('slope+relief mode shows slope colors over relief', async ({ page }) => {
    const served = await interceptDemTiles(page);
    const url = `/app/index.html#${BASE_HASH}&mode=slope%2Brelief`;

    await page.goto(url, { waitUntil: 'load' });
    await page.evaluate(() => localStorage.clear());
    await page.goto(url, { waitUntil: 'load' });

    await waitForMapReady(page);
    await waitForDemRender(page);

    const pixels = await readMapPixels(page);
    console.log('slope+relief pixels:', JSON.stringify(pixels));
    expect(pixels.ratio).toBeGreaterThan(0.05);

    await expect(page).toHaveScreenshot('dem-slope-relief.png', {
      maxDiffPixelRatio: 0.05,
    });
  });

  test('slope mode shows slope colors', async ({ page }) => {
    const served = await interceptDemTiles(page);
    const url = `/app/index.html#${BASE_HASH}&mode=slope`;

    await page.goto(url, { waitUntil: 'load' });
    await page.evaluate(() => localStorage.clear());
    await page.goto(url, { waitUntil: 'load' });

    await waitForMapReady(page);
    await waitForDemRender(page);

    const pixels = await readMapPixels(page);
    console.log('slope pixels:', JSON.stringify(pixels));
    expect(pixels.ratio).toBeGreaterThan(0.05);

    await expect(page).toHaveScreenshot('dem-slope.png', {
      maxDiffPixelRatio: 0.05,
    });
  });
});
