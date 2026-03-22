// @ts-check
// Persistence E2E Tests
//
// Tests cover: localStorage save/restore of tracks and settings,
// and the "Clear saved data" button.

const {
  test, expect, clickDrawBtn, addPoints, getTrackCount,
  getTrackInfo, drawTrackAndFinish, evalInScope,
} = require('./helpers');

test.describe('Persistence', () => {

  test('Tracks persist across page reload', async ({ mapPage: page }) => {
    // Create a track
    await drawTrackAndFinish(page, 3);
    await page.waitForTimeout(400); // let debounced save fire

    const info = await getTrackInfo(page, 0);
    const originalName = info.name;

    // Reload the page
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(
      () => { try { return (0, eval)('mapReady'); } catch { return false; } },
    );
    await page.waitForTimeout(300);

    // Track should be restored
    const count = await getTrackCount(page);
    expect(count).toBe(1);

    const restored = await getTrackInfo(page, 0);
    expect(restored.name).toBe(originalName);
    expect(restored.statsText).toContain('3 pts');
  });

  test('Track color persists across reload', async ({ mapPage: page }) => {
    await drawTrackAndFinish(page, 3);
    await page.waitForTimeout(400);

    // Get the track color
    const color = await page.locator('.track-item .track-color').first().evaluate(
      el => el.style.background || getComputedStyle(el).backgroundColor
    );

    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(
      () => { try { return (0, eval)('mapReady'); } catch { return false; } },
    );
    await page.waitForTimeout(300);

    const restoredColor = await page.locator('.track-item .track-color').first().evaluate(
      el => el.style.background || getComputedStyle(el).backgroundColor
    );
    expect(restoredColor).toBe(color);
  });

  test('Multiple tracks persist across reload', async ({ mapPage: page }) => {
    await drawTrackAndFinish(page, 3, { startX: 300 });
    await drawTrackAndFinish(page, 2, { startX: 500 });
    await page.waitForTimeout(400);

    expect(await getTrackCount(page)).toBe(2);

    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(
      () => { try { return (0, eval)('mapReady'); } catch { return false; } },
    );
    await page.waitForTimeout(300);

    expect(await getTrackCount(page)).toBe(2);
  });

  test('Clear saved data removes tracks on reload', async ({ mapPage: page }) => {
    await drawTrackAndFinish(page, 3);
    await page.waitForTimeout(400);
    expect(await getTrackCount(page)).toBe(1);

    // Click "Clear saved data" — dialog will auto-accept
    page.on('dialog', d => d.accept());
    await page.locator('#clear-data-btn').click();

    // Page reloads automatically after clear
    await page.waitForFunction(
      () => { try { return (0, eval)('mapReady'); } catch { return false; } },
    );
    await page.waitForTimeout(300);

    expect(await getTrackCount(page)).toBe(0);
  });

  test('Settings persist across reload', async ({ mapPage: page }) => {
    // Change basemap
    await page.locator('#basemap').selectOption('otm');
    await page.waitForTimeout(400);

    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(
      () => { try { return (0, eval)('mapReady'); } catch { return false; } },
    );
    await page.waitForTimeout(300);

    const basemap = await page.locator('#basemap').inputValue();
    expect(basemap).toBe('otm');
  });
});
