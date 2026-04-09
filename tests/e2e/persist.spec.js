// @ts-nocheck — helpers.js custom fixtures aren't typed
const {
  APP_URL,
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

    // Navigate to a same-origin static resource (no app JS runs there)
    // so we can safely clear localStorage without the app re-saving.
    await page.goto('/app/favicon.svg', { waitUntil: 'load' });
    await page.evaluate(() => localStorage.clear());
    await page.goto(APP_URL, { waitUntil: 'load' });
    await page.waitForFunction(
      () => { try { return (0, eval)('mapReady'); } catch { return false; } },
      { timeout: 5_000 }
    );
    await page.waitForTimeout(300);

    expect(await getTrackCount(page)).toBe(0);
  });

  test('Settings persist across reload', async ({ mapPage: page }) => {
    // Test a setting that test_mode does NOT override.
    // Ensure Settings panel is visible, then change pause threshold.
    const controlsPanel = page.locator('#controls');
    if (await controlsPanel.evaluate(el => el.classList.contains('collapsed'))) {
      await page.locator('#settings-controls-toggle').click();
      await page.waitForTimeout(100);
    }
    // Use evaluate to set range input value (fill() unreliable for range inputs)
    await page.evaluate(() => {
      const el = document.getElementById('pauseThreshold');
      el.value = '12';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(400);

    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(
      () => { try { return (0, eval)('mapReady'); } catch { return false; } },
    );
    await page.waitForTimeout(300);

    const val = await page.locator('#pauseThreshold').inputValue();
    expect(val).toBe('12');
  });
});
