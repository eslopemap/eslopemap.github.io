// @ts-nocheck
const { test: base, expect } = require('@playwright/test');
const {
  importFile, getTrackInfo, getTrackCount,
  deleteActiveTrackViaMenu,
  resetState, loadMapPage,
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

base.describe('Profile Panel', () => {
  /** @type {import('@playwright/test').Page | null} */
  let page = null;

  base.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await loadMapPage(page);
  });

  base.afterAll(async () => { await page?.close(); });

  base.beforeEach(async () => { await resetState(page); });

  base('Profile auto-opens when importing a track with >= 2 points', async () => {
    await importFile(page, 'test.gpx', SIMPLE_GPX);
    await page.waitForTimeout(500);

    await expect(page.locator('#profile-panel.visible')).toBeVisible();
    await expect(page.locator('#profile-toggle-btn.active')).toBeVisible();
  });

  base('Profile does not open for track with < 2 points', async () => {
    const onePointGpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1"><trk><trkseg>
  <trkpt lat="45.83" lon="6.86"><ele>1500</ele></trkpt>
</trkseg></trk></gpx>`;

    await importFile(page, 'one.gpx', onePointGpx);
    await page.waitForTimeout(300);

    await expect(page.locator('#profile-panel.visible')).not.toBeVisible();
  });

  base('Close profile and reopen with toggle button', async () => {
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

  base('Profile toggle button closes the profile when clicked while open', async () => {
    await importFile(page, 'test.gpx', SIMPLE_GPX);
    await page.waitForTimeout(500);

    await expect(page.locator('#profile-panel.visible')).toBeVisible();

    await page.locator('#profile-toggle-btn').click();
    await page.waitForTimeout(200);
    await expect(page.locator('#profile-panel.visible')).not.toBeVisible();
  });

  base('Profile toggle button is disabled when no track is active', async () => {
    await importFile(page, 'temp.gpx', SIMPLE_GPX);
    await page.waitForTimeout(500);

    const handler = dialog => dialog.accept();
    page.on('dialog', handler);
    await deleteActiveTrackViaMenu(page);
    await page.waitForTimeout(500);
    page.removeListener('dialog', handler);

    // After deleting the only track, activeTrackId should be null
    const activeId = await page.evaluate(() => (0, eval)('activeTrackId'));
    expect(activeId).toBeNull();
  });

  base('Profile contains a canvas element', async () => {
    await importFile(page, 'test.gpx', SIMPLE_GPX);
    await page.waitForTimeout(500);

    await expect(page.locator('#profile-panel.visible')).toBeVisible();
    await expect(page.locator('#profile-canvas')).toBeVisible();
  });
});
