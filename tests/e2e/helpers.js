// Shared Playwright fixtures for track editor E2E tests
//
// GPX Tree UI: the track list uses a tree view (gpx-tree.js). Track items are
// .tree-row elements. Edit/delete use context menu or rail buttons.
// Track info queries use JS evaluation for reliability.

const { test: base, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const APP_URL = '/app/index.html#test_mode=true';
const MAP_READY_TIMEOUT_MS = 5_000;
const E2E_COVERAGE = process.env.E2E_COVERAGE === '1';
const COVERAGE_DIR = path.join(__dirname, '..', '..', 'coverage', 'e2e-v8');
let _covCounter = 0;

const NON_LOCAL_HTTP_URL = /^https?:\/\/(?!(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)).+/i;

async function installOfflineRouteGuard(page, options = {}) {
  if (page.__offlineRouteGuardInstalled) return;
  const allowedUrls = options.allowedUrls || [];
  await page.route(NON_LOCAL_HTTP_URL, async (route) => {
    const url = route.request().url();
    if (allowedUrls.some(pattern => pattern.test(url))) {
      await route.fallback();
      return;
    }
    await route.fulfill({ status: 404, body: 'offline test guard' });
  });
  page.__offlineRouteGuardInstalled = true;
 }

const test = base.extend({
  mapPage: async ({ page }, use) => {
    await installOfflineRouteGuard(page);
    if (E2E_COVERAGE) await page.coverage.startJSCoverage({ resetOnNavigation: false });
    await page.goto(APP_URL, { waitUntil: 'load' });
    await page.evaluate(() => localStorage.clear());
    await page.goto(APP_URL, { waitUntil: 'load' });
    await page.waitForFunction(
      () => { try { return (0, eval)('mapReady'); } catch { return false; } },
      { timeout: MAP_READY_TIMEOUT_MS }
    );
    await use(page);
    if (E2E_COVERAGE) {
      const entries = await page.coverage.stopJSCoverage();
      const appEntries = entries.filter(e => e.url.includes('/app/js/') && !e.url.includes('/vendor/'));
      if (appEntries.length) {
        fs.mkdirSync(COVERAGE_DIR, { recursive: true });
        fs.writeFileSync(path.join(COVERAGE_DIR, `cov-${++_covCounter}.json`), JSON.stringify(appEntries));
      }
    }
  },
});

async function resetState(page) {
  await page.evaluate(() => (0, eval)('resetForTest')());
  await page.waitForTimeout(50);
}

async function loadMapPage(page) {
  await installOfflineRouteGuard(page);
  if (E2E_COVERAGE) await page.coverage.startJSCoverage({ resetOnNavigation: false });
  await page.goto(APP_URL, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.goto(APP_URL, { waitUntil: 'load' });
  await page.waitForFunction(
    () => { try { return (0, eval)('mapReady'); } catch { return false; } },
    { timeout: MAP_READY_TIMEOUT_MS }
  );
}

async function clickMap(page, x, y) {
  // Fire MapLibre GL click event directly — Playwright force-click on #map
  // doesn't reach MapLibre when canvas overlays exist after drawing tracks
  await page.evaluate(([cx, cy]) => {
    const map = (0, eval)('map');
    const point = { x: cx, y: cy };
    const lngLat = map.unproject(point);
    map.fire('click', { point, lngLat, originalEvent: new MouseEvent('click') });
  }, [x, y]);
}

async function dblClickMap(page, x, y) {
  await page.evaluate(([cx, cy]) => {
    const map = (0, eval)('map');
    const point = { x: cx, y: cy };
    const lngLat = map.unproject(point);
    const evt = { point, lngLat, originalEvent: new MouseEvent('dblclick'), preventDefault() {} };
    map.fire('dblclick', evt);
  }, [x ?? 640, y ?? 360]);
}

async function clickDrawBtn(page) {
  await page.evaluate(() => document.getElementById('draw-btn').click());
}

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

async function evalInScope(page, expr) {
  return page.evaluate((e) => (0, eval)(e), expr);
}

async function getTrackCount(page) {
  return evalInScope(page, 'tracks.length');
}

async function getEditingTrackId(page) {
  return evalInScope(page, 'editingTrackId');
}

async function getActiveTrackId(page) {
  return evalInScope(page, 'activeTrackId');
}

async function getActiveTrackPointCount(page) {
  return evalInScope(page, "(function(){ var t = tracks.find(function(tr){return tr.id===activeTrackId}); return t ? t.coords.length : 0; })()");
}

async function getTrackInfo(page, index = 0) {
  return page.evaluate((idx) => {
    const t = (0, eval)('tracks')[idx];
    if (!t) return null;
    const editingId = (0, eval)('editingTrackId');
    const activeId = (0, eval)('activeTrackId');
    return {
      name: t.name,
      isActive: t.id === activeId,
      isEditing: t.id === editingId,
      color: t.color,
      pointCount: t.coords.length,
    };
  }, index);
}

async function getSelectedVertexIndex(page) {
  return evalInScope(page, 'selectedVertexIndex');
}

async function getInsertAfterIdx(page) {
  return evalInScope(page, 'insertAfterIdx');
}

async function drawTrackAndFinish(page, pointCount, opts = {}) {
  await clickDrawBtn(page);
  await addPoints(page, pointCount, opts);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  // Dismiss info editor overlay that opens for new tracks
  await dismissInfoEditor(page);
}

async function dismissInfoEditor(page) {
  const overlay = page.locator('#info-editor-overlay.visible');
  if (await overlay.isVisible({ timeout: 500 }).catch(() => false)) {
    await page.locator('#info-editor-overlay button', { hasText: 'Cancel' }).click();
    await page.waitForTimeout(100);
  }
}

async function importFile(page, filename, content) {
  await page.evaluate(({ filename, content }) => {
    (0, eval)('importFileContent')(filename, content);
  }, { filename, content });
}

async function clickEditBtn(page) {
  await page.locator('#rail-edit-btn').click({ force: true });
}

async function deleteActiveTrackViaMenu(page) {
  await page.locator('.tree-row.active .tree-kebab').click();
  await page.locator('.ctx-item', { hasText: 'Delete' }).click();
}

module.exports = {
  APP_URL, MAP_READY_TIMEOUT_MS,
  installOfflineRouteGuard,
  test, expect, clickMap, dblClickMap, clickDrawBtn, addPoints,
  evalInScope, getTrackCount, getEditingTrackId, getActiveTrackId,
  getActiveTrackPointCount, getTrackInfo, getSelectedVertexIndex,
  getInsertAfterIdx, drawTrackAndFinish, importFile,
  clickEditBtn, deleteActiveTrackViaMenu,
  resetState, loadMapPage,
};
