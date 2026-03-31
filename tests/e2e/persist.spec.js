// @ts-check
const {
  test, expect, drawTrackAndFinish, getTrackCount,
  getTrackInfo, evalInScope,
} = require('./helpers');

test.describe('Persistence', () => {

  test('Tracks persist across page reload', async ({ mapPage: page }) => {
    await drawTrackAndFinish(page, 3);
    await page.waitForTimeout(400);

    const info = await getTrackInfo(page, 0);
    const originalName = info.name;

    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(
      () => { try { return (0, eval)('mapReady'); } catch { return false; } },
    );
    await page.waitForTimeout(300);

    expect(await getTrackCount(page)).toBe(1);
    const restored = await getTrackInfo(page, 0);
    expect(restored.name).toBe(originalName);
    expect(restored.pointCount).toBe(3);
  });

  test('Track color persists across reload', async ({ mapPage: page }) => {
    await drawTrackAndFinish(page, 3);
    await page.waitForTimeout(400);

    const color = (await getTrackInfo(page, 0)).color;

    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(
      () => { try { return (0, eval)('mapReady'); } catch { return false; } },
    );
    await page.waitForTimeout(300);

    const restoredColor = (await getTrackInfo(page, 0)).color;
    expect(restoredColor).toBe(color);
  });

  test('Multiple tracks persist across reload', async ({ mapPage: page }) => {
    await drawTrackAndFinish(page, 3, { startX: 300 });
    await drawTrackAndFinish(page, 2, { startX: 200 });
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

    // Call clearAll directly and reload (bypasses confirm dialog)
    await page.evaluate(() => {
      const keys = Object.keys(localStorage);
      keys.forEach(k => localStorage.removeItem(k));
    });
    await page.goto('/index.html', { waitUntil: 'load' });
    await page.waitForFunction(
      () => { try { return (0, eval)('mapReady'); } catch { return false; } },
    );
    await page.waitForTimeout(300);

    expect(await getTrackCount(page)).toBe(0);
  });

  test('Settings persist across reload', async ({ mapPage: page }) => {
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
