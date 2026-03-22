// Shared Playwright fixtures for slope.html track editor tests
//
// Key design decisions:
//
// • KISS — no network mocking. The full page loads with real tiles, DEM, and
//   CDN libraries. Mocking MapLibre's raster-dem source broke the map.on('load')
//   event (stubs couldn't be decoded), so we let everything load naturally.
//   We only test track editing logic — tile content doesn't matter.
//
// • python3 http.server — `npx serve` crashed mid-suite (ERR_CONNECTION_REFUSED
//   after ~3 tests). Python's stdlib server is rock-solid. See playwright.config.js.
//
// • ES module + window getters — app code is a <script type="module">, so all
//   variables are module-scoped. js/main.js exposes key vars (tracks, activeTrackId,
//   etc.) via Object.defineProperties(window, ...) with getters. Tests read them
//   through (0, eval)('varName') which resolves through the global scope.
//
// • force:true on map clicks — the #controls-wrapper overlay intercepts pointer
//   events at many positions. `force: true` bypasses Playwright's actionability
//   check so clicks always reach the map canvas.
//
// • WebGL — headless Chromium needs --use-gl=angle --use-angle=swiftshader
//   for MapLibre GL JS to initialize.

const { test: base, expect } = require('@playwright/test');

const test = base.extend({
  /** Page with map fully loaded and ready for track operations */
  mapPage: async ({ page }, use) => {
    await page.goto('/slope.html', { waitUntil: 'load' });

    // Wait for mapReady (set in the second map.on('load') callback).
    // Variables are let/const in <script> scope — use indirect eval to access.
    await page.waitForFunction(
      () => { try { return (0, eval)('mapReady'); } catch { return false; } },
    );

    await use(page);
  },
});

// ---------- Page helpers (DOM-based + eval for scoped vars) ----------

/** Click on the map canvas at offset (x, y) from the #map element */
async function clickMap(page, x, y) {
  await page.locator('#map').click({ position: { x, y }, force: true });
}

/** Double-click on the map canvas */
async function dblClickMap(page, x, y) {
  await page.locator('#map').dblclick({ position: { x: x ?? 640, y: y ?? 360 }, force: true });
}

/** Click the draw button to start/stop a new track */
async function clickDrawBtn(page) {
  await page.locator('#draw-btn').click();
}

/** Add N points spread horizontally across the map */
async function addPoints(page, count, opts = {}) {
  const startX = opts.startX ?? 400;
  const startY = opts.startY ?? 300;
  const stepX = opts.stepX ?? 80;
  const stepY = opts.stepY ?? 0;
  for (let i = 0; i < count; i++) {
    await clickMap(page, startX + i * stepX, startY + i * stepY);
    await page.waitForTimeout(80);
  }
}

/** Get the number of tracks visible in the track list */
async function getTrackItemCount(page) {
  return page.locator('.track-item').count();
}

/** Get track info by reading the DOM (name, stats text, active, editing) */
async function getTrackInfo(page, index = 0) {
  const item = page.locator('.track-item').nth(index);
  const name = await item.locator('.track-name').innerText().then(t => t.split('\n')[0].trim());
  const statsText = await item.locator('.track-stats').first().innerText().catch(() => '');
  const isActive = (await item.getAttribute('class')).includes('active');
  const editBtn = item.locator('.track-edit');
  const isEditing = (await editBtn.getAttribute('class')).includes('active');
  return { name, statsText, isActive, isEditing };
}

/** Extract point count from stats text like "3 pts" or "1.2 km ... 5 pts" */
function parsePointCount(statsText) {
  const m = statsText.match(/(\d+)\s*pts/);
  return m ? parseInt(m[1]) : 0;
}

/** Use eval() in page to read a scoped variable */
async function evalInScope(page, expr) {
  return page.evaluate((e) => (0, eval)(e), expr);
}

/** Get track count from JS */
async function getTrackCount(page) {
  return evalInScope(page, 'tracks.length');
}

/** Get editing track id from JS */
async function getEditingTrackId(page) {
  return evalInScope(page, 'editingTrackId');
}

/** Get active track id from JS */
async function getActiveTrackId(page) {
  return evalInScope(page, 'activeTrackId');
}

/** Get coords count of active track */
async function getActiveTrackPointCount(page) {
  return evalInScope(page, '(function(){ var t = tracks.find(function(tr){return tr.id===activeTrackId}); return t ? t.coords.length : 0; })()');
}

/** Get selectedVertexIndex */
async function getSelectedVertexIndex(page) {
  return evalInScope(page, 'selectedVertexIndex');
}

/** Get insertAfterIdx */
async function getInsertAfterIdx(page) {
  return evalInScope(page, 'insertAfterIdx');
}

/** Start a new track, add N points, finish with Escape. */
async function drawTrackAndFinish(page, pointCount, opts = {}) {
  await clickDrawBtn(page);
  await addPoints(page, pointCount, opts);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
}

/** Import a file by calling importFileContent() directly */
async function importFile(page, filename, content) {
  await page.evaluate(({ filename, content }) => {
    (0, eval)('importFileContent')(filename, content);
  }, { filename, content });
}

module.exports = {
  test,
  expect,
  clickMap,
  dblClickMap,
  clickDrawBtn,
  addPoints,
  getTrackItemCount,
  getTrackInfo,
  parsePointCount,
  evalInScope,
  getTrackCount,
  getEditingTrackId,
  getActiveTrackId,
  getActiveTrackPointCount,
  getSelectedVertexIndex,
  getInsertAfterIdx,
  drawTrackAndFinish,
  importFile,
};
