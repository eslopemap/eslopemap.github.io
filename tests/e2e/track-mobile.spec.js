// @ts-check
const {
  test, expect, clickMap, clickDrawBtn,
  getActiveTrackPointCount, getTrackCount, evalInScope,
} = require('./helpers');

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

    await expect(page.locator('#draw-crosshair')).toHaveClass(/visible/);
    await page.keyboard.press('Escape');
  });

  test('Tap inserts point at map center (crosshair position)', async ({ mapPage: page }) => {
    await clickDrawBtn(page);
    await page.waitForTimeout(300);

    const centerBefore = await evalInScope(page, '({ lng: map.getCenter().lng, lat: map.getCenter().lat })');

    await page.locator('#map canvas').tap({ position: { x: 100, y: 500 }, force: true });
    await page.waitForTimeout(200);

    expect(await getActiveTrackPointCount(page)).toBe(1);

    const coord = await evalInScope(page, "(function(){ var t = tracks.find(function(tr){return tr.id===activeTrackId}); return t && t.coords[0] ? { lng: t.coords[0][0], lat: t.coords[0][1] } : null; })()");
    expect(coord).not.toBeNull();
    expect(coord.lng).toBeCloseTo(centerBefore.lng, 1);
    expect(coord.lat).toBeCloseTo(centerBefore.lat, 1);

    await page.keyboard.press('Escape');
  });

  test('Toggle mobile mode off -- switches to desktop behavior', async ({ mapPage: page }) => {
    await clickDrawBtn(page);
    await page.waitForTimeout(300);

    await page.locator('#map canvas').tap({ position: { x: 195, y: 500 }, force: true });
    await page.waitForTimeout(200);

    await expect(page.locator('#mobile-mode-btn')).toBeVisible();
    expect(await evalInScope(page, 'mobileFriendlyMode')).toBe(true);

    await page.locator('#mobile-mode-btn').click();
    await page.waitForTimeout(150);

    expect(await evalInScope(page, 'mobileFriendlyMode')).toBe(false);
    await expect(page.locator('#draw-crosshair')).not.toHaveClass(/visible/);

    await page.keyboard.press('Escape');
  });

  test('Mobile mode button visible only when editing with points', async ({ mapPage: page }) => {
    await expect(page.locator('#mobile-mode-btn')).toBeHidden();

    await clickDrawBtn(page);

    await page.locator('#map canvas').tap({ position: { x: 195, y: 500 }, force: true });
    await page.waitForTimeout(150);

    await expect(page.locator('#mobile-mode-btn')).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('Multiple taps create multiple points', async ({ mapPage: page }) => {
    await clickDrawBtn(page);
    await page.waitForTimeout(300);

    await page.locator('#map canvas').tap({ position: { x: 100, y: 500 }, force: true });
    await page.waitForTimeout(150);
    await page.locator('#map canvas').tap({ position: { x: 200, y: 550 }, force: true });
    await page.waitForTimeout(150);
    await page.locator('#map canvas').tap({ position: { x: 150, y: 600 }, force: true });
    await page.waitForTimeout(150);

    expect(await getActiveTrackPointCount(page)).toBe(3);
    await page.keyboard.press('Escape');
  });
});
