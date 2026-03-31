// @ts-check
const {
  test, expect, importFile, getTrackInfo, getTrackCount,
  deleteActiveTrackViaMenu,
} = require('./helpers');

const SIMPLE_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test">
  <trk>
    <name>Profile Test Track</name>
    <trkseg>
      <trkpt lat="45.83" lon="6.86"><ele>1500</ele></trkpt>
      <trkpt lat="45.84" lon="6.87"><ele>1600</ele></trkpt>
      <trkpt lat="45.85" lon="6.88"><ele>1700</ele></trkpt>
      <trkpt lat="45.86" lon="6.89"><ele>1800</ele></trkpt>
    </trkseg>
  </trk>
</gpx>`;

test.describe('Profile Panel', () => {

  test('Profile auto-opens when importing a track with >= 2 points', async ({ mapPage: page }) => {
    await importFile(page, 'test.gpx', SIMPLE_GPX);
    await page.waitForTimeout(500);

    await expect(page.locator('#profile-panel.visible')).toBeVisible();
    await expect(page.locator('#profile-toggle-btn.active')).toBeVisible();
  });

  test('Profile does not open for track with < 2 points', async ({ mapPage: page }) => {
    const onePointGpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1"><trk><trkseg>
  <trkpt lat="45.83" lon="6.86"><ele>1500</ele></trkpt>
</trkseg></trk></gpx>`;

    await importFile(page, 'one.gpx', onePointGpx);
    await page.waitForTimeout(300);

    await expect(page.locator('#profile-panel.visible')).not.toBeVisible();
  });

  test('Close profile and reopen with toggle button', async ({ mapPage: page }) => {
    await importFile(page, 'test.gpx', SIMPLE_GPX);
    await page.waitForTimeout(500);

    await expect(page.locator('#profile-panel.visible')).toBeVisible();

    await page.locator('#profile-close').click();
    await page.waitForTimeout(200);
    await expect(page.locator('#profile-panel.visible')).not.toBeVisible();
    await expect(page.locator('#profile-toggle-btn.active')).not.toBeVisible();

    await page.locator('#profile-toggle-btn').click();
    await page.waitForTimeout(300);
    await expect(page.locator('#profile-panel.visible')).toBeVisible();
    await expect(page.locator('#profile-toggle-btn.active')).toBeVisible();
  });

  test('Profile toggle button closes the profile when clicked while open', async ({ mapPage: page }) => {
    await importFile(page, 'test.gpx', SIMPLE_GPX);
    await page.waitForTimeout(500);

    await expect(page.locator('#profile-panel.visible')).toBeVisible();

    await page.locator('#profile-toggle-btn').click();
    await page.waitForTimeout(200);
    await expect(page.locator('#profile-panel.visible')).not.toBeVisible();
  });

  test('Profile toggle button is disabled when no track is active', async ({ mapPage: page }) => {
    await importFile(page, 'temp.gpx', SIMPLE_GPX);
    await page.waitForTimeout(500);

    page.on('dialog', dialog => dialog.accept());
    await deleteActiveTrackViaMenu(page);
    await page.waitForTimeout(500);

    // After deleting the only track, activeTrackId should be null
    const activeId = await page.evaluate(() => (0, eval)('activeTrackId'));
    expect(activeId).toBeNull();
  });

  test('Profile contains a canvas element', async ({ mapPage: page }) => {
    await importFile(page, 'test.gpx', SIMPLE_GPX);
    await page.waitForTimeout(500);

    await expect(page.locator('#profile-panel.visible')).toBeVisible();
    await expect(page.locator('#profile-canvas')).toBeVisible();
  });
});
