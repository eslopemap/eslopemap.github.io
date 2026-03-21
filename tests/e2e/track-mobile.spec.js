// @ts-check
// Mobile Track Editor E2E Tests (emulated touchscreen)
//
// Tests cover: mobile-friendly mode, crosshair, tap-to-insert at center,
// toggle mobile mode off, mobile defaults.
//
// Key decisions:
// • Crosshair (#draw-crosshair) has width:0 height:0 — all visuals are rendered
//   via ::before/::after pseudo-elements. Playwright reports it as "hidden",
//   so we assert on the CSS class (toHaveClass(/visible/)) instead of toBeVisible().
// • Taps use `page.locator('#map canvas').tap({ force: true })` because the
//   #controls-wrapper <label> overlay intercepts pointer events at tap positions.
// • Meta+z (not Ctrl+z) for undo on macOS.

const {
  test, expect, clickMap, clickDrawBtn,
  getActiveTrackPointCount, getTrackCount, evalInScope,
} = require('./helpers');

// Mobile device emulation
const mobileDevice = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
};

test.describe('Mobile Track Editor', () => {
  test.use(mobileDevice);

  test('Mobile-friendly mode defaults to active on mobile', async ({ mapPage: page }) => {
    const mobileFriendly = await evalInScope(page, 'mobileFriendlyMode');
    expect(mobileFriendly).toBe(true);
  });

  test('Crosshair class added when entering edit mode on mobile', async ({ mapPage: page }) => {
    await clickDrawBtn(page);
    await page.waitForTimeout(300);

    // The crosshair div gets .visible class (element itself is 0×0, visuals via pseudo-elements)
    await expect(page.locator('#draw-crosshair')).toHaveClass(/visible/);

    await page.keyboard.press('Escape');
  });

  test('Tap inserts point at map center (crosshair position)', async ({ mapPage: page }) => {
    await clickDrawBtn(page);
    await page.waitForTimeout(300);

    // Get map center before tap
    const centerBefore = await evalInScope(page, '({ lng: map.getCenter().lng, lat: map.getCenter().lat })');

    // Tap on the map canvas — in mobile-friendly mode, point goes to center
    await page.locator('#map canvas').tap({ position: { x: 100, y: 500 }, force: true });
    await page.waitForTimeout(200);

    const ptCount = await getActiveTrackPointCount(page);
    expect(ptCount).toBe(1);

    // The inserted point should be near the map center, not at tap position
    const coord = await evalInScope(page, '(function(){ var t = tracks.find(function(tr){return tr.id===activeTrackId}); return t && t.coords[0] ? { lng: t.coords[0][0], lat: t.coords[0][1] } : null; })()');
    expect(coord).not.toBeNull();
    expect(coord.lng).toBeCloseTo(centerBefore.lng, 1);
    expect(coord.lat).toBeCloseTo(centerBefore.lat, 1);

    await page.keyboard.press('Escape');
  });

  test('Toggle mobile mode off — switches to desktop behavior', async ({ mapPage: page }) => {
    await clickDrawBtn(page);
    await page.waitForTimeout(300);

    // Add a point first so the mobile button becomes visible
    await page.locator('#map canvas').tap({ position: { x: 195, y: 500 }, force: true });
    await page.waitForTimeout(200);

    // Mobile mode button should now be visible and active
    await expect(page.locator('#mobile-mode-btn')).toBeVisible();
    const isActive = await evalInScope(page, 'mobileFriendlyMode');
    expect(isActive).toBe(true);

    // Toggle mobile mode off
    await page.locator('#mobile-mode-btn').click();
    await page.waitForTimeout(150);

    // mobileFriendlyMode should be false
    const afterToggle = await evalInScope(page, 'mobileFriendlyMode');
    expect(afterToggle).toBe(false);

    // Crosshair class should be removed
    await expect(page.locator('#draw-crosshair')).not.toHaveClass(/visible/);

    await page.keyboard.press('Escape');
  });

  test('Mobile mode button visible only when editing with points', async ({ mapPage: page }) => {
    // Before editing: mobile button should be hidden
    await expect(page.locator('#mobile-mode-btn')).toBeHidden();

    await clickDrawBtn(page);

    // Add a point via tap
    await page.locator('#map canvas').tap({ position: { x: 195, y: 500 }, force: true });
    await page.waitForTimeout(150);

    // With at least one point while editing: mobile button should be visible
    await expect(page.locator('#mobile-mode-btn')).toBeVisible();

    await page.keyboard.press('Escape');
  });

  test('Multiple taps create multiple points', async ({ mapPage: page }) => {
    await clickDrawBtn(page);
    await page.waitForTimeout(300);

    // Tap 3 times
    await page.locator('#map canvas').tap({ position: { x: 100, y: 500 }, force: true });
    await page.waitForTimeout(150);
    await page.locator('#map canvas').tap({ position: { x: 200, y: 550 }, force: true });
    await page.waitForTimeout(150);
    await page.locator('#map canvas').tap({ position: { x: 150, y: 600 }, force: true });
    await page.waitForTimeout(150);

    const ptCount = await getActiveTrackPointCount(page);
    expect(ptCount).toBe(3);

    await page.keyboard.press('Escape');
  });
});
