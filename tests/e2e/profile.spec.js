// @ts-check
// Profile Panel E2E Tests
//
// Tests cover: profile auto-opens with track, profile close/reopen,
// profile toggle button state.
//
// Key decision: the "disabled" test imports a GPX then deletes the track first,
// because the profile-toggle-btn isn't HTML-disabled on initial load — it becomes
// disabled only after a track is removed and no active track remains.

const {
  test, expect, importFile, getTrackInfo, drawTrackAndFinish,
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

  test('Profile auto-opens when importing a track with ≥ 2 points', async ({ mapPage: page }) => {
    await importFile(page, 'test.gpx', SIMPLE_GPX);
    await page.waitForTimeout(500);

    // Profile panel should be visible
    await expect(page.locator('#profile-panel.visible')).toBeVisible();

    // Profile toggle button should show active state
    await expect(page.locator('#profile-toggle-btn.active')).toBeVisible();
  });

  test('Profile does not open for track with < 2 points', async ({ mapPage: page }) => {
    // Import a track with only 1 point
    const onePointGpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1"><trk><trkseg>
  <trkpt lat="45.83" lon="6.86"><ele>1500</ele></trkpt>
</trkseg></trk></gpx>`;

    await importFile(page, 'one.gpx', onePointGpx);
    await page.waitForTimeout(300);

    // Profile panel should NOT be visible (only 1 point)
    await expect(page.locator('#profile-panel.visible')).not.toBeVisible();
  });

  test('Close profile and reopen with toggle button', async ({ mapPage: page }) => {
    await importFile(page, 'test.gpx', SIMPLE_GPX);
    await page.waitForTimeout(500);

    // Profile should be open
    await expect(page.locator('#profile-panel.visible')).toBeVisible();

    // Close it using the × button
    await page.locator('#profile-close').click();
    await page.waitForTimeout(200);

    await expect(page.locator('#profile-panel.visible')).not.toBeVisible();

    // The toggle button should now say "Show Profile" (not active)
    await expect(page.locator('#profile-toggle-btn.active')).not.toBeVisible();

    // Reopen with toggle button
    await page.locator('#profile-toggle-btn').click();
    await page.waitForTimeout(300);

    await expect(page.locator('#profile-panel.visible')).toBeVisible();
    await expect(page.locator('#profile-toggle-btn.active')).toBeVisible();
  });

  test('Profile toggle button closes the profile when clicked while open', async ({ mapPage: page }) => {
    await importFile(page, 'test.gpx', SIMPLE_GPX);
    await page.waitForTimeout(500);

    await expect(page.locator('#profile-panel.visible')).toBeVisible();

    // Click toggle button to close
    await page.locator('#profile-toggle-btn').click();
    await page.waitForTimeout(200);

    await expect(page.locator('#profile-panel.visible')).not.toBeVisible();
  });

  test('Profile toggle button is disabled when no track is active', async ({ mapPage: page }) => {
    // Import a track so the panel shows, then delete it
    await importFile(page, 'temp.gpx', SIMPLE_GPX);
    await page.waitForTimeout(500);

    // Delete the track
    page.on('dialog', dialog => dialog.accept());
    await page.locator('.track-del').first().click();
    await page.waitForTimeout(300);

    // Now the button should be disabled (no active track with ≥ 2 pts)
    await expect(page.locator('#profile-toggle-btn')).toBeDisabled();
  });

  test('Profile contains a canvas element', async ({ mapPage: page }) => {
    await importFile(page, 'test.gpx', SIMPLE_GPX);
    await page.waitForTimeout(500);

    await expect(page.locator('#profile-panel.visible')).toBeVisible();
    await expect(page.locator('#profile-canvas')).toBeVisible();
  });
});
