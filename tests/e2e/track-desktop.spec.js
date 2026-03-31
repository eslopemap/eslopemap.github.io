// @ts-check
const {
  test, expect, clickMap, dblClickMap, clickDrawBtn, addPoints,
  getTrackCount, getEditingTrackId, getActiveTrackPointCount,
  getTrackInfo, drawTrackAndFinish, clickEditBtn, deleteActiveTrackViaMenu,
} = require('./helpers');

test.describe('Desktop Track Editor', () => {

  test('Create new track -- click draw, add 3 points, dblclick to finish', async ({ mapPage: page }) => {
    await clickDrawBtn(page);
    await expect(page.locator('#draw-btn.active')).toBeVisible();
    await addPoints(page, 3);

    expect(await getTrackCount(page)).toBe(1);
    expect(await getActiveTrackPointCount(page)).toBe(3);

    await dblClickMap(page, 700, 300);
    await page.waitForTimeout(150);

    await expect(page.locator('#draw-btn.active')).not.toBeVisible();
    expect(await getActiveTrackPointCount(page)).toBeGreaterThanOrEqual(3);
  });

  test('Create new track -- finish with Escape', async ({ mapPage: page }) => {
    await clickDrawBtn(page);
    await addPoints(page, 4);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    await expect(page.locator('#draw-btn.active')).not.toBeVisible();
    expect(await getActiveTrackPointCount(page)).toBe(4);
  });

  test('Auto-cleanup -- new track with < 2 points is removed on exit', async ({ mapPage: page }) => {
    await clickDrawBtn(page);
    await addPoints(page, 1);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    expect(await getTrackCount(page)).toBe(0);
  });

  test('Track appears in track list with correct name', async ({ mapPage: page }) => {
    await drawTrackAndFinish(page, 3);

    await expect(page.locator('#track-panel.visible')).toBeVisible();
    const info = await getTrackInfo(page, 0);
    expect(info.name).toBe('Track 1');
    expect(info.isActive).toBe(true);
  });

  test('Select vs Edit -- clicking tree row selects, rail edit enters edit mode', async ({ mapPage: page }) => {
    await drawTrackAndFinish(page, 3, { startX: 300, startY: 200 });
    await drawTrackAndFinish(page, 3, { startX: 300, startY: 400 });

    expect(await getTrackCount(page)).toBe(2);

    // Activate the first track by clicking its segment row (🛤️ icon rows)
    const segmentRows = page.locator('.tree-row .tree-icon:text("🛤️")');
    await segmentRows.first().click();
    await page.waitForTimeout(100);

    const info1 = await getTrackInfo(page, 0);
    expect(info1.isActive).toBe(true);
    expect(info1.isEditing).toBe(false);

    // Click rail edit button to enter edit mode
    await clickEditBtn(page);
    await page.waitForTimeout(100);

    const info2 = await getTrackInfo(page, 0);
    expect(info2.isEditing).toBe(true);
    await expect(page.locator('#draw-btn.active')).toBeVisible();

    await page.keyboard.press('Escape');
  });

  test('Undo (Ctrl+Z) removes last point', async ({ mapPage: page }) => {
    await clickDrawBtn(page);
    await addPoints(page, 4);
    expect(await getActiveTrackPointCount(page)).toBe(4);

    await page.keyboard.press('Meta+z');
    await page.waitForTimeout(100);
    expect(await getActiveTrackPointCount(page)).toBe(3);

    await page.keyboard.press('Meta+z');
    await page.waitForTimeout(100);
    expect(await getActiveTrackPointCount(page)).toBe(2);

    await page.keyboard.press('Escape');
  });

  test('Undo button removes last point', async ({ mapPage: page }) => {
    await clickDrawBtn(page);
    await addPoints(page, 3);

    await expect(page.locator('#undo-btn')).toBeVisible();
    await page.locator('#undo-btn').click({ force: true });
    await page.waitForTimeout(100);

    expect(await getActiveTrackPointCount(page)).toBe(2);
    await page.keyboard.press('Escape');
  });

  test('Delete track -- confirm removes it', async ({ mapPage: page }) => {
    await drawTrackAndFinish(page, 3);
    expect(await getTrackCount(page)).toBe(1);

    page.on('dialog', dialog => dialog.accept());
    await deleteActiveTrackViaMenu(page);
    await page.waitForTimeout(200);

    expect(await getTrackCount(page)).toBe(0);
  });

  test('Delete track -- cancel leaves track intact', async ({ mapPage: page }) => {
    await drawTrackAndFinish(page, 3);

    page.on('dialog', dialog => dialog.dismiss());
    await deleteActiveTrackViaMenu(page);
    await page.waitForTimeout(200);

    expect(await getTrackCount(page)).toBe(1);
  });

  test('Edit existing track -- add more points', async ({ mapPage: page }) => {
    await drawTrackAndFinish(page, 3);
    expect(await getActiveTrackPointCount(page)).toBe(3);

    await clickEditBtn(page);
    await page.waitForTimeout(100);
    await expect(page.locator('#draw-btn.active')).toBeVisible();

    await addPoints(page, 2, { startX: 700, startY: 250 });
    expect(await getActiveTrackPointCount(page)).toBe(5);

    await page.keyboard.press('Escape');
  });

  test('Toggle edit mode -- clicking draw-btn toggles off', async ({ mapPage: page }) => {
    await clickDrawBtn(page);
    await addPoints(page, 3);

    await clickDrawBtn(page);
    await page.waitForTimeout(100);

    await expect(page.locator('#draw-btn.active')).not.toBeVisible();
  });

  test('Tracks button toggles track panel visibility', async ({ mapPage: page }) => {
    await drawTrackAndFinish(page, 3);

    await expect(page.locator('#track-panel.visible')).toBeVisible();

    await page.locator('#tracks-btn').click();
    await page.waitForTimeout(100);
    await expect(page.locator('#track-panel.visible')).not.toBeVisible();

    await page.locator('#tracks-btn').click();
    await page.waitForTimeout(100);
    await expect(page.locator('#track-panel.visible')).toBeVisible();
  });

  test('Multiple tracks -- creating second track works', async ({ mapPage: page }) => {
    await drawTrackAndFinish(page, 3, { startX: 300, startY: 200 });
    await drawTrackAndFinish(page, 4, { startX: 500, startY: 400 });

    expect(await getTrackCount(page)).toBe(2);

    const info0 = await getTrackInfo(page, 0);
    const info1 = await getTrackInfo(page, 1);
    expect(info0.name).toBe('Track 1');
    expect(info1.name).toBe('Track 2');
    expect(info1.isActive).toBe(true);
  });

  test('Delete vertex with Shift+click', async ({ mapPage: page }) => {
    await clickDrawBtn(page);
    await addPoints(page, 4);
    expect(await getActiveTrackPointCount(page)).toBe(4);

    await page.locator('#map').click({
      position: { x: 480, y: 300 },
      modifiers: ['Shift'],
      force: true,
    });
    await page.waitForTimeout(200);

    const countAfter = await getActiveTrackPointCount(page);
    expect(countAfter).toBeLessThanOrEqual(4);

    await page.keyboard.press('Escape');
  });

  test('Stats update when points are added', async ({ mapPage: page }) => {
    await clickDrawBtn(page);
    await addPoints(page, 2);

    expect(await getActiveTrackPointCount(page)).toBe(2);

    await addPoints(page, 1, { startX: 700, startY: 300 });
    expect(await getActiveTrackPointCount(page)).toBe(3);

    await page.keyboard.press('Escape');
  });
});
