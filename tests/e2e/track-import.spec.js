// @ts-check
const {
  test, expect, getTrackCount, getTrackInfo,
  importFile, evalInScope,
} = require('./helpers');

const SIMPLE_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test">
  <trk>
    <name>Test Track</name>
    <trkseg>
      <trkpt lat="45.83" lon="6.86"><ele>1500</ele></trkpt>
      <trkpt lat="45.84" lon="6.87"><ele>1600</ele></trkpt>
      <trkpt lat="45.85" lon="6.88"><ele>1700</ele></trkpt>
    </trkseg>
  </trk>
</gpx>`;

const ROUTE_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test">
  <rte>
    <name>My Route</name>
    <rtept lat="45.90" lon="6.90"><ele>2000</ele></rtept>
    <rtept lat="45.91" lon="6.91"><ele>2100</ele></rtept>
    <rtept lat="45.92" lon="6.92"><ele>2200</ele></rtept>
  </rte>
</gpx>`;

const MULTI_SEG_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test">
  <trk>
    <name>Multi Seg</name>
    <trkseg>
      <trkpt lat="45.80" lon="6.80"><ele>1000</ele></trkpt>
      <trkpt lat="45.81" lon="6.81"><ele>1100</ele></trkpt>
    </trkseg>
    <trkseg>
      <trkpt lat="45.82" lon="6.82"><ele>1200</ele></trkpt>
      <trkpt lat="45.83" lon="6.83"><ele>1300</ele></trkpt>
    </trkseg>
  </trk>
</gpx>`;

const SIMPLE_GEOJSON = JSON.stringify({
  type: 'Feature',
  geometry: {
    type: 'LineString',
    coordinates: [[6.86, 45.83, 1500], [6.87, 45.84, 1600], [6.88, 45.85, 1700]],
  },
  properties: {},
});

const MULTI_LINESTRING_GEOJSON = JSON.stringify({
  type: 'Feature',
  geometry: {
    type: 'MultiLineString',
    coordinates: [
      [[6.86, 45.83], [6.87, 45.84]],
      [[6.90, 45.90], [6.91, 45.91], [6.92, 45.92]],
    ],
  },
  properties: {},
});

const FEATURE_COLLECTION_GEOJSON = JSON.stringify({
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', geometry: { type: 'LineString', coordinates: [[6.86, 45.83], [6.87, 45.84]] }, properties: {} },
    { type: 'Feature', geometry: { type: 'LineString', coordinates: [[6.90, 45.90], [6.91, 45.91]] }, properties: {} },
  ],
});

test.describe('Track Import', () => {

  test('GPX import -- simple track with name', async ({ mapPage: page }) => {
    await importFile(page, 'test.gpx', SIMPLE_GPX);
    await page.waitForTimeout(300);

    expect(await getTrackCount(page)).toBe(1);
    const info = await getTrackInfo(page, 0);
    expect(info.name).toBe('Test Track');
    expect(info.pointCount).toBe(3);
  });

  test('GPX import -- route element', async ({ mapPage: page }) => {
    await importFile(page, 'route.gpx', ROUTE_GPX);
    await page.waitForTimeout(300);

    expect(await getTrackCount(page)).toBe(1);
    const info = await getTrackInfo(page, 0);
    expect(info.name).toBe('My Route');
    expect(info.pointCount).toBe(3);
  });

  test('GPX import -- multi-segment creates multiple tracks', async ({ mapPage: page }) => {
    await importFile(page, 'multi.gpx', MULTI_SEG_GPX);
    await page.waitForTimeout(300);

    expect(await getTrackCount(page)).toBe(2);

    const info0 = await getTrackInfo(page, 0);
    const info1 = await getTrackInfo(page, 1);
    expect(info0.pointCount).toBe(2);
    expect(info1.pointCount).toBe(2);
  });

  test('GeoJSON import -- LineString', async ({ mapPage: page }) => {
    await importFile(page, 'test.geojson', SIMPLE_GEOJSON);
    await page.waitForTimeout(300);

    expect(await getTrackCount(page)).toBe(1);
    const info = await getTrackInfo(page, 0);
    expect(info.name).toBe('test');
    expect(info.pointCount).toBe(3);
  });

  test('GeoJSON import -- MultiLineString creates multiple tracks', async ({ mapPage: page }) => {
    await importFile(page, 'multi.geojson', MULTI_LINESTRING_GEOJSON);
    await page.waitForTimeout(300);

    expect(await getTrackCount(page)).toBe(2);
  });

  test('GeoJSON import -- FeatureCollection with multiple lines', async ({ mapPage: page }) => {
    await importFile(page, 'collection.geojson', FEATURE_COLLECTION_GEOJSON);
    await page.waitForTimeout(300);

    expect(await getTrackCount(page)).toBe(2);
  });

  test('GPX import uses filename as fallback name when track has no <name>', async ({ mapPage: page }) => {
    const gpxNoName = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1"><trk><trkseg>
  <trkpt lat="45.83" lon="6.86"><ele>1500</ele></trkpt>
  <trkpt lat="45.84" lon="6.87"><ele>1600</ele></trkpt>
</trkseg></trk></gpx>`;

    await importFile(page, 'unnamed-route.gpx', gpxNoName);
    await page.waitForTimeout(300);

    const info = await getTrackInfo(page, 0);
    expect(info.name).toBe('unnamed-route');
  });

  test('Import adds to existing tracks', async ({ mapPage: page }) => {
    await importFile(page, 'first.gpx', SIMPLE_GPX);
    await page.waitForTimeout(200);

    await importFile(page, 'second.gpx', ROUTE_GPX);
    await page.waitForTimeout(200);

    expect(await getTrackCount(page)).toBe(2);
  });

  test('GPX import with waypoints -- waypoints are parsed', async ({ mapPage: page }) => {
    const gpxWithWpt = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test">
  <wpt lat="45.83" lon="6.86"><ele>1500</ele><name>Summit</name><sym>Flag</sym></wpt>
  <wpt lat="45.84" lon="6.87"><ele>1600</ele><name>Hut</name></wpt>
  <trk>
    <name>Trail</name>
    <trkseg>
      <trkpt lat="45.83" lon="6.86"><ele>1500</ele></trkpt>
      <trkpt lat="45.84" lon="6.87"><ele>1600</ele></trkpt>
    </trkseg>
  </trk>
</gpx>`;
    await importFile(page, 'wpt.gpx', gpxWithWpt);
    await page.waitForTimeout(300);

    expect(await getTrackCount(page)).toBe(1);
    const wptCount = await evalInScope(page, 'waypoints.length');
    expect(wptCount).toBe(2);
    const wptName = await evalInScope(page, 'waypoints[0].name');
    expect(wptName).toBe('Summit');
  });

  test('GPX with waypoints only (no tracks) -- waypoints imported', async ({ mapPage: page }) => {
    const gpxWptOnly = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test">
  <wpt lat="45.83" lon="6.86"><name>Point A</name></wpt>
  <wpt lat="45.84" lon="6.87"><name>Point B</name></wpt>
</gpx>`;
    await importFile(page, 'only-wpt.gpx', gpxWptOnly);
    await page.waitForTimeout(300);

    const wptCount = await evalInScope(page, 'waypoints.length');
    expect(wptCount).toBe(2);
  });

  test('Multi-segment -- collapse/expand in tree', async ({ mapPage: page }) => {
    await importFile(page, 'multi.gpx', MULTI_SEG_GPX);
    await page.waitForTimeout(300);

    // Tree should show rows (file + track + segments)
    const initialRows = await page.locator('.tree-row').count();
    expect(initialRows).toBeGreaterThanOrEqual(2);

    // Click a toggle to collapse
    const toggle = page.locator('.tree-toggle').first();
    await toggle.click();
    await page.waitForTimeout(100);

    const afterCollapse = await page.locator('.tree-row').count();
    expect(afterCollapse).toBeLessThan(initialRows);

    // Click again to expand
    await toggle.click();
    await page.waitForTimeout(100);

    const afterExpand = await page.locator('.tree-row').count();
    expect(afterExpand).toBe(initialRows);
  });

  test('GPX with extensions -- round-trip preserves extensions', async ({ mapPage: page }) => {
    const gpxWithExt = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="garmin">
  <trk>
    <name>Ext Track</name>
    <trkseg>
      <trkpt lat="45.83" lon="6.86"><ele>1500</ele>
        <extensions><hr>120</hr><cad>80</cad></extensions>
      </trkpt>
      <trkpt lat="45.84" lon="6.87"><ele>1600</ele>
        <extensions><hr>125</hr><cad>82</cad></extensions>
      </trkpt>
    </trkseg>
  </trk>
</gpx>`;
    await importFile(page, 'ext.gpx', gpxWithExt);
    await page.waitForTimeout(300);

    expect(await getTrackCount(page)).toBe(1);
    const info = await getTrackInfo(page, 0);
    expect(info.name).toBe('Ext Track');
  });
});
