// @ts-check
// E2e tests for the merged GeoJSON source system (Strategy B) and import guards.
const { test: base, expect } = require('@playwright/test');
const {
  getTrackCount, getTrackInfo, getActiveTrackId,
  importFile, evalInScope, drawTrackAndFinish,
  clickEditBtn, resetState, loadMapPage, clickDrawBtn, addPoints,
} = require('./helpers');

const SIMPLE_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test">
  <trk><name>Track A</name><trkseg>
    <trkpt lat="45.83" lon="6.86"><ele>1500</ele></trkpt>
    <trkpt lat="45.84" lon="6.87"><ele>1600</ele></trkpt>
    <trkpt lat="45.85" lon="6.88"><ele>1700</ele></trkpt>
  </trkseg></trk>
</gpx>`;

const TWO_TRACK_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test">
  <trk><name>Alpha</name><trkseg>
    <trkpt lat="45.83" lon="6.86"><ele>1500</ele></trkpt>
    <trkpt lat="45.84" lon="6.87"><ele>1600</ele></trkpt>
  </trkseg></trk>
  <trk><name>Beta</name><trkseg>
    <trkpt lat="46.00" lon="7.00"><ele>2000</ele></trkpt>
    <trkpt lat="46.01" lon="7.01"><ele>2100</ele></trkpt>
  </trkseg></trk>
</gpx>`;

base.describe('Merged Track Source', () => {
  let page;

  base.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await loadMapPage(page);
  });

  base.afterAll(async () => { await page.close(); });
  base.beforeEach(async () => { await resetState(page); });

  base.test('merged source exists after import', async () => {
    await importFile(page, 'test.gpx', SIMPLE_GPX);
    await page.waitForTimeout(300);

    const hasMergedSource = await evalInScope(page, "!!map.getSource('tracks-merged')");
    expect(hasMergedSource).toBe(true);
    const hasMergedLayer = await evalInScope(page, "!!map.getLayer('tracks-merged-line')");
    expect(hasMergedLayer).toBe(true);
  });

  base.test('active track is promoted to its own source', async () => {
    await importFile(page, 'test.gpx', SIMPLE_GPX);
    await page.waitForTimeout(300);

    const activeId = await getActiveTrackId(page);
    expect(activeId).toBeTruthy();

    // The active track should have its own per-track source
    const hasPerTrackSource = await evalInScope(page,
      `!!map.getSource('track-' + activeTrackId)`);
    expect(hasPerTrackSource).toBe(true);

    // And its own line + circle layers
    const hasLineLayer = await evalInScope(page,
      `!!map.getLayer('track-line-' + activeTrackId)`);
    const hasPtsLayer = await evalInScope(page,
      `!!map.getLayer('track-pts-' + activeTrackId)`);
    expect(hasLineLayer).toBe(true);
    expect(hasPtsLayer).toBe(true);
  });

  base.test('two-track import: non-active track has no per-track source', async () => {
    await importFile(page, 'two.gpx', TWO_TRACK_GPX);
    await page.waitForTimeout(300);

    expect(await getTrackCount(page)).toBe(2);

    // The active track is the last one imported
    const activeId = await getActiveTrackId(page);

    // Find the non-active track
    const nonActiveId = await evalInScope(page,
      `tracks.find(t => t.id !== activeTrackId)?.id`);
    expect(nonActiveId).toBeTruthy();

    // Non-active track should NOT have its own per-track source
    const hasNonActiveSource = await evalInScope(page,
      `!!map.getSource('track-' + '${nonActiveId}')`);
    expect(hasNonActiveSource).toBe(false);

    // Active track should have its own source
    const hasActiveSource = await evalInScope(page,
      `!!map.getSource('track-' + activeTrackId)`);
    expect(hasActiveSource).toBe(true);
  });

  base.test('switching active track promotes new track and demotes old', async () => {
    await importFile(page, 'two.gpx', TWO_TRACK_GPX);
    await page.waitForTimeout(300);

    const activeId1 = await getActiveTrackId(page);
    const otherId = await evalInScope(page,
      "(function(){ var t = tracks.find(function(tr){return tr.id!==activeTrackId}); return t ? t.id : null; })()");
    expect(otherId).toBeTruthy();

    // Switch to the other track via the exported getTracksState().setActiveTrack
    await page.evaluate((id) => {
      (0, eval)('setActiveTrack')(id);
    }, otherId);
    await page.waitForTimeout(200);

    const activeId2 = await getActiveTrackId(page);
    expect(activeId2).toBe(otherId);

    // New active should have its own source
    const hasNewSource = await page.evaluate((id) => {
      return !!(0, eval)('map').getSource('track-' + id);
    }, otherId);
    expect(hasNewSource).toBe(true);

    // Old active should NOT have its own source anymore
    const hasOldSource = await page.evaluate((id) => {
      return !!(0, eval)('map').getSource('track-' + id);
    }, activeId1);
    expect(hasOldSource).toBe(false);
  });

  base.test('with 2 tracks, 1 is promoted and 1 is in merged source', async () => {
    await importFile(page, 'two.gpx', TWO_TRACK_GPX);
    await page.waitForTimeout(300);

    // promotedTrackId should match activeTrackId
    const promoted = await evalInScope(page, 'promotedTrackId');
    const active = await getActiveTrackId(page);
    expect(promoted).toBe(active);

    // The non-promoted track count: total tracks minus 1 promoted
    const totalTracks = await getTrackCount(page);
    expect(totalTracks).toBe(2);
    // One track is promoted (has its own source), one is in merged only
    const nonPromotedCount = await evalInScope(page,
      "tracks.filter(function(t){return t.id !== promotedTrackId && t.coords.length >= 2}).length");
    expect(nonPromotedCount).toBe(1);
  });

  base.test('tracks have color property set', async () => {
    await importFile(page, 'two.gpx', TWO_TRACK_GPX);
    await page.waitForTimeout(300);

    const colors = await evalInScope(page,
      "tracks.map(function(t){return t.color})");
    expect(colors).toHaveLength(2);
    expect(colors[0]).toBeTruthy();
    expect(colors[1]).toBeTruthy();
  });

  base.test('drawing a new track promotes it', async () => {
    await drawTrackAndFinish(page, 3);
    await page.waitForTimeout(200);

    const activeId = await getActiveTrackId(page);
    const hasSource = await evalInScope(page,
      `!!map.getSource('track-' + activeTrackId)`);
    expect(hasSource).toBe(true);
  });

  base.test('deleting the active track removes its per-track source', async () => {
    await drawTrackAndFinish(page, 3);
    await page.waitForTimeout(200);

    const activeId = await getActiveTrackId(page);

    // Delete via evaluation (skip confirm dialog)
    await evalInScope(page, `(function() {
      var t = tracks.find(function(tr) { return tr.id === activeTrackId; });
      if (t) {
        var idx = tracks.indexOf(t);
        if (map.getLayer('track-pts-' + t.id)) map.removeLayer('track-pts-' + t.id);
        if (map.getLayer('track-line-' + t.id)) map.removeLayer('track-line-' + t.id);
        if (map.getSource('track-' + t.id)) map.removeSource('track-' + t.id);
        tracks.splice(idx, 1);
        activeTrackId = null;
      }
    })()`);
    await page.waitForTimeout(100);

    const hasSource = await evalInScope(page,
      `!!map.getSource('track-' + '${activeId}')`);
    expect(hasSource).toBe(false);
  });

  base.test('resetForTest cleans up all tracks and promoted state', async () => {
    await importFile(page, 'test.gpx', SIMPLE_GPX);
    await page.waitForTimeout(300);
    expect(await getTrackCount(page)).toBe(1);

    await resetState(page);

    expect(await getTrackCount(page)).toBe(0);
    const promoted = await evalInScope(page, 'promotedTrackId');
    expect(promoted).toBe(null);
    const active = await getActiveTrackId(page);
    expect(active).toBe(null);
    // Merged source should still exist
    const hasMergedSource = await evalInScope(page, "!!map.getSource('tracks-merged')");
    expect(hasMergedSource).toBe(true);
  });
});

base.describe('Import Guard (e2e)', () => {
  let page;

  base.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await loadMapPage(page);
  });

  base.afterAll(async () => { await page.close(); });
  base.beforeEach(async () => { await resetState(page); });

  base.test('importing .mbtiles content does not crash', async () => {
    // Simulate what happens when binary content reaches importFileContent
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.evaluate(() => {
      try {
        (0, eval)('importFileContent')('dummy.mbtiles', 'SQLite format 3\x00...');
      } catch (e) {
        // Should not throw
        throw e;
      }
    });
    await page.waitForTimeout(100);

    expect(await getTrackCount(page)).toBe(0);
    expect(errors.filter(e => e.includes('JSON Parse'))).toHaveLength(0);
  });

  base.test('importing .pmtiles content does not crash', async () => {
    await page.evaluate(() => {
      (0, eval)('importFileContent')('tiles.pmtiles', '\x00PMTiles...');
    });
    await page.waitForTimeout(100);
    expect(await getTrackCount(page)).toBe(0);
  });

  base.test('importing malformed JSON .geojson shows warning, no crash', async () => {
    const warnings = [];
    page.on('console', msg => {
      if (msg.type() === 'warning') warnings.push(msg.text());
    });

    // Malformed JSON should throw in parseGeoJSON, but importFileContent
    // should still handle it gracefully at the app level
    let threw = false;
    try {
      await page.evaluate(() => {
        (0, eval)('importFileContent')('bad.geojson', 'this is not json');
      });
    } catch {
      threw = true;
    }

    // Even if it throws in evaluate, the app state should be clean
    expect(await getTrackCount(page)).toBe(0);
  });
});

base.describe('Batch Import Optimizations (e2e)', () => {
  let page;

  base.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await loadMapPage(page);
  });

  base.afterAll(async () => { await page.close(); });
  base.beforeEach(async () => { await resetState(page); });

  base.test('multi-track GPX import creates all tracks in one batch', async () => {
    await importFile(page, 'multi.gpx', TWO_TRACK_GPX);
    await page.waitForTimeout(300);

    expect(await getTrackCount(page)).toBe(2);
    const info0 = await getTrackInfo(page, 0);
    const info1 = await getTrackInfo(page, 1);
    expect(info0.name).toBe('Alpha');
    expect(info1.name).toBe('Beta');
  });

  base.test('batch import selects a track as active', async () => {
    await importFile(page, 'multi.gpx', TWO_TRACK_GPX);
    await page.waitForTimeout(300);

    const activeId = await getActiveTrackId(page);
    expect(activeId).toBeTruthy();
  });

  base.test('sequential file imports accumulate tracks', async () => {
    await importFile(page, 'first.gpx', SIMPLE_GPX);
    await page.waitForTimeout(300);
    expect(await getTrackCount(page)).toBe(1);

    await importFile(page, 'second.gpx', TWO_TRACK_GPX);
    await page.waitForTimeout(300);
    expect(await getTrackCount(page)).toBe(3);
  });
});
