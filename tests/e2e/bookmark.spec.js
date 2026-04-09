// @ts-nocheck — helpers.js custom fixtures aren't typed
const { test, expect } = require('./helpers');

// Helpers to reduce boilerplate
async function setupState(page, stateOverrides) {
  await page.evaluate((overrides) => {
    const state = (0, eval)('state');
    const map = (0, eval)('map');
    Object.assign(state, overrides);
    (0, eval)('applyModeState')(map, state);
    (0, eval)('applyAllOverlays')(map, state);
    (0, eval)('applyHillshadeVisibility')(map, state);
    (0, eval)('applyContourVisibility')(map, state);
    (0, eval)('syncLayerOrder')(state);
  }, stateOverrides);
  await page.waitForTimeout(300);
}

async function saveBookmark(page) {
  await page.evaluate(() => (0, eval)('createBookmark')((0, eval)('state')));
  await page.waitForTimeout(200);
}

async function restoreBookmark(page, index = 0) {
  await page.evaluate((i) => {
    const state = (0, eval)('state');
    (0, eval)('applyBookmark')((0, eval)('map'), state, state.bookmarks[i]);
  }, index);
  await page.waitForTimeout(500);
}

async function getState(page, keys) {
  return page.evaluate((ks) => {
    const state = (0, eval)('state');
    const result = {};
    for (const k of ks) result[k] = state[k];
    return result;
  }, keys);
}

test.describe('Bookmarks', () => {

  test('Save and restore bookmark with overlay and analysis', async ({ mapPage: page }) => {
    // Set basemap to osm first (test_mode starts with 'none')
    await page.evaluate(() => (0, eval)('setBasemap')((0, eval)('map'), (0, eval)('state'), 'osm', false));
    await page.waitForTimeout(200);
    await setupState(page, { mode: 'slope+relief', slopeOpacity: 0.7, activeOverlays: ['openskimap'] });
    await saveBookmark(page);

    // Change state away
    await page.evaluate(() => (0, eval)('setBasemap')((0, eval)('map'), (0, eval)('state'), 'otm', false));
    await setupState(page, { mode: '', slopeOpacity: 0.45, activeOverlays: [] });

    await restoreBookmark(page);

    const s = await getState(page, ['mode', 'slopeOpacity', 'activeOverlays', 'basemap', 'layerOrder']);
    expect(s.mode).toBe('slope+relief');
    expect(s.slopeOpacity).toBe(0.7);
    expect(s.activeOverlays).toEqual(['openskimap']);
    expect(s.basemap).toBe('osm');
    expect(s.layerOrder).toContain('_analysis');
    expect(s.layerOrder).toContain('openskimap');
  });

  test('Bookmark restores hillshade and contours state', async ({ mapPage: page }) => {
    await setupState(page, { showHillshade: true, hillshadeOpacity: 0.25, showContours: true });
    await saveBookmark(page);

    await setupState(page, { showHillshade: false, hillshadeOpacity: 0.10, showContours: false });

    await restoreBookmark(page);

    const s = await getState(page, ['showHillshade', 'hillshadeOpacity', 'showContours', 'layerOrder']);
    expect(s.showHillshade).toBe(true);
    expect(s.hillshadeOpacity).toBe(0.25);
    expect(s.showContours).toBe(true);
    expect(s.layerOrder).toContain('_hillshade');
    expect(s.layerOrder).toContain('_contours');
  });

  test('Bookmark with multi-basemap stack and multiple overlays', async ({ mapPage: page }) => {
    await page.evaluate(() => {
      const state = (0, eval)('state');
      state.basemapOpacities = { osm: 0.5, otm: 0.8 };
      (0, eval)('setBasemapStack')((0, eval)('map'), state, ['osm', 'otm']);
    });
    await page.waitForTimeout(300);
    await setupState(page, { activeOverlays: ['openskimap', 'swisstopo-ski'], mode: 'slope', slopeOpacity: 0.6 });
    await saveBookmark(page);

    // Reset
    await page.evaluate(() => {
      const state = (0, eval)('state');
      state.basemapOpacities = {};
      (0, eval)('setBasemapStack')((0, eval)('map'), state, ['none']);
    });
    await setupState(page, { activeOverlays: [], mode: '' });

    await restoreBookmark(page);

    const s = await getState(page, ['basemapStack', 'basemapOpacities', 'activeOverlays', 'mode', 'slopeOpacity', 'layerOrder']);
    expect(s.basemapStack).toEqual(['osm', 'otm']);
    expect(s.basemapOpacities.osm).toBe(0.5);
    expect(s.basemapOpacities.otm).toBe(0.8);
    expect(s.activeOverlays).toEqual(['openskimap', 'swisstopo-ski']);
    expect(s.mode).toBe('slope');
    expect(s.slopeOpacity).toBe(0.6);
    for (const id of ['osm', 'otm', 'openskimap', 'swisstopo-ski', '_analysis'])
      expect(s.layerOrder).toContain(id);
  });

  test('Layer order panel shows system layers after bookmark restore', async ({ mapPage: page }) => {
    await setupState(page, { activeOverlays: ['openskimap'], mode: 'slope+relief', showHillshade: true });
    await page.evaluate(() => (0, eval)('renderLayerOrderPanel')());
    await saveBookmark(page);

    // Clear and restore
    await setupState(page, { activeOverlays: [], mode: '', showHillshade: false });
    await restoreBookmark(page);
    await page.evaluate(() => (0, eval)('renderLayerOrderPanel')());
    await page.waitForTimeout(200);

    const layerNames = await page.locator('#layer-order-list .layer-order-name').allTextContents();
    expect(layerNames).toContain('Terrain analysis');
    expect(layerNames).toContain('Hillshade');
    expect(layerNames).toContain('OpenSkiMap');
    // System layers always present even when hidden
    expect(layerNames).toContain('Contours');
  });

  test('System layers always present in layerOrder', async ({ mapPage: page }) => {
    // Even with everything disabled, system layers should be in layerOrder
    await setupState(page, { mode: '', showHillshade: false, showContours: false, activeOverlays: [] });
    const s = await getState(page, ['layerOrder']);
    expect(s.layerOrder).toContain('_hillshade');
    expect(s.layerOrder).toContain('_analysis');
    expect(s.layerOrder).toContain('_contours');
  });

});
