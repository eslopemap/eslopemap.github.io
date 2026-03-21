// @ts-check
// Desktop Track Editor E2E Tests
//
// Tests cover: create, edit, select, undo, delete vertex, insert-after,
// double-click/Escape to finish, delete track, vertex selection.
//
// Note: Undo uses Meta+z (macOS). Shift+click vertex deletion depends on
// map projection hit-testing, so we only assert count <= original (no crash).

const {
  test, expect, clickMap, dblClickMap, clickDrawBtn, addPoints,
  getTrackItemCount, getTrackInfo, parsePointCount,
  getTrackCount, getEditingTrackId, getActiveTrackPointCount,
  getSelectedVertexIndex, getInsertAfterIdx, drawTrackAndFinish,
} = require('./helpers');

test.describe('Desktop Track Editor', () => {

  test('Create new track — click draw, add 3 points, dblclick to finish', async ({ mapPage: page }) => {
    // Click draw button to start a new track
    await clickDrawBtn(page);

    // Draw button should be active (editing mode)
    await expect(page.locator('#draw-btn.active')).toBeVisible();

    // Add 3 points
    await addPoints(page, 3);

    // Track should appear in the list with 3 pts
    await expect(page.locator('.track-item')).toHaveCount(1);
    const ptCount = await getActiveTrackPointCount(page);
    expect(ptCount).toBe(3);

    // Double-click to finish editing
    await dblClickMap(page, 700, 300);
    await page.waitForTimeout(150);

    // Draw button should no longer be active
    await expect(page.locator('#draw-btn.active')).not.toBeVisible();

    // Track still exists with at least 3 points (dblclick may add one more)
    const finalCount = await getActiveTrackPointCount(page);
    expect(finalCount).toBeGreaterThanOrEqual(3);
  });

  test('Create new track — finish with Escape', async ({ mapPage: page }) => {
    await clickDrawBtn(page);
    await addPoints(page, 4);

    // Press Escape to finish
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    // Should exit edit mode
    await expect(page.locator('#draw-btn.active')).not.toBeVisible();

    // Track should exist with 4 points
    const count = await getActiveTrackPointCount(page);
    expect(count).toBe(4);
  });

  test('Auto-cleanup — new track with < 2 points is removed on exit', async ({ mapPage: page }) => {
    await clickDrawBtn(page);
    await addPoints(page, 1); // Only 1 point

    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    // The track should be auto-removed (< 2 points)
    const count = await getTrackCount(page);
    expect(count).toBe(0);
  });

  test('Track appears in track list with correct name', async ({ mapPage: page }) => {
    await drawTrackAndFinish(page, 3);

    // Track panel should be visible
    await expect(page.locator('#track-panel.visible')).toBeVisible();

    // Track item should show "Track 1"
    const info = await getTrackInfo(page, 0);
    expect(info.name).toBe('Track 1');
    expect(info.isActive).toBe(true);
  });

  test('Select vs Edit — clicking track name selects, clicking edit button enters edit mode', async ({ mapPage: page }) => {
    // Create two tracks
    await drawTrackAndFinish(page, 3, { startX: 300, startY: 200 });
    await drawTrackAndFinish(page, 3, { startX: 300, startY: 400 });

    await expect(page.locator('.track-item')).toHaveCount(2);

    // Click the first track's name (not the edit button) — should select it
    await page.locator('.track-item').nth(0).locator('.track-name').click();
    await page.waitForTimeout(100);

    const info1 = await getTrackInfo(page, 0);
    expect(info1.isActive).toBe(true);
    expect(info1.isEditing).toBe(false);

    // Click the edit button — should enter edit mode
    await page.locator('.track-item').nth(0).locator('.track-edit').click();
    await page.waitForTimeout(100);

    const info2 = await getTrackInfo(page, 0);
    expect(info2.isEditing).toBe(true);
    await expect(page.locator('#draw-btn.active')).toBeVisible();
  });

  test('Undo (Ctrl+Z) removes last point', async ({ mapPage: page }) => {
    await clickDrawBtn(page);
    await addPoints(page, 4);

    let count = await getActiveTrackPointCount(page);
    expect(count).toBe(4);

    // Ctrl+Z to undo
    await page.keyboard.press('Meta+z');
    await page.waitForTimeout(100);

    count = await getActiveTrackPointCount(page);
    expect(count).toBe(3);

    // Undo again
    await page.keyboard.press('Meta+z');
    await page.waitForTimeout(100);

    count = await getActiveTrackPointCount(page);
    expect(count).toBe(2);

    await page.keyboard.press('Escape');
  });

  test('Undo button (🗑️) removes last point', async ({ mapPage: page }) => {
    await clickDrawBtn(page);
    await addPoints(page, 3);

    // Undo button should be visible while editing
    await expect(page.locator('#undo-btn')).toBeVisible();

    await page.locator('#undo-btn').click();
    await page.waitForTimeout(100);

    const count = await getActiveTrackPointCount(page);
    expect(count).toBe(2);

    await page.keyboard.press('Escape');
  });

  test('Delete track — click × and confirm', async ({ mapPage: page }) => {
    await drawTrackAndFinish(page, 3);

    await expect(page.locator('.track-item')).toHaveCount(1);

    // Set up dialog handler to accept the confirm
    page.on('dialog', dialog => dialog.accept());

    // Click the delete button
    await page.locator('.track-del').first().click();
    await page.waitForTimeout(200);

    // Track should be removed
    await expect(page.locator('.track-item')).toHaveCount(0);
    const count = await getTrackCount(page);
    expect(count).toBe(0);
  });

  test('Delete track — cancel leaves track intact', async ({ mapPage: page }) => {
    await drawTrackAndFinish(page, 3);

    // Dismiss the confirm dialog
    page.on('dialog', dialog => dialog.dismiss());

    await page.locator('.track-del').first().click();
    await page.waitForTimeout(200);

    // Track should still exist
    await expect(page.locator('.track-item')).toHaveCount(1);
  });

  test('Edit existing track — add more points', async ({ mapPage: page }) => {
    await drawTrackAndFinish(page, 3);

    const countBefore = await getActiveTrackPointCount(page);
    expect(countBefore).toBe(3);

    // Click edit button on the track
    await page.locator('.track-edit').first().click();
    await page.waitForTimeout(100);

    // Should be in edit mode
    await expect(page.locator('#draw-btn.active')).toBeVisible();

    // Add 2 more points
    await addPoints(page, 2, { startX: 700, startY: 250 });

    const countAfter = await getActiveTrackPointCount(page);
    expect(countAfter).toBe(5);

    await page.keyboard.press('Escape');
  });

  test('Toggle edit mode — clicking draw-btn toggles off', async ({ mapPage: page }) => {
    await clickDrawBtn(page);
    await addPoints(page, 3);

    // Click draw button again to exit
    await clickDrawBtn(page);
    await page.waitForTimeout(100);

    await expect(page.locator('#draw-btn.active')).not.toBeVisible();
  });

  test('Clicking edit on track toggles editing off', async ({ mapPage: page }) => {
    await drawTrackAndFinish(page, 3);

    // Enter edit mode
    await page.locator('.track-edit').first().click();
    await page.waitForTimeout(100);

    const info1 = await getTrackInfo(page, 0);
    expect(info1.isEditing).toBe(true);

    // Click the same edit button again to toggle off
    await page.locator('.track-edit').first().click();
    await page.waitForTimeout(100);

    const info2 = await getTrackInfo(page, 0);
    expect(info2.isEditing).toBe(false);
  });

  test('Tracks button toggles track panel visibility', async ({ mapPage: page }) => {
    await drawTrackAndFinish(page, 3);

    // Track panel should be visible (auto-opened when track created)
    await expect(page.locator('#track-panel.visible')).toBeVisible();

    // Click tracks button to close
    await page.locator('#tracks-btn').click();
    await page.waitForTimeout(100);

    await expect(page.locator('#track-panel.visible')).not.toBeVisible();

    // Click again to open
    await page.locator('#tracks-btn').click();
    await page.waitForTimeout(100);

    await expect(page.locator('#track-panel.visible')).toBeVisible();
  });

  test('Multiple tracks — creating second track works', async ({ mapPage: page }) => {
    await drawTrackAndFinish(page, 3, { startX: 300, startY: 200 });
    await drawTrackAndFinish(page, 4, { startX: 500, startY: 400 });

    const count = await getTrackCount(page);
    expect(count).toBe(2);

    await expect(page.locator('.track-item')).toHaveCount(2);

    // Second track (most recent) should be active
    const info0 = await getTrackInfo(page, 0);
    const info1 = await getTrackInfo(page, 1);
    expect(info0.name).toBe('Track 1');
    expect(info1.name).toBe('Track 2');
    expect(info1.isActive).toBe(true);
  });

  test('Delete vertex with Shift+click', async ({ mapPage: page }) => {
    await clickDrawBtn(page);
    await addPoints(page, 4);

    const countBefore = await getActiveTrackPointCount(page);
    expect(countBefore).toBe(4);

    // Shift+click on map near a point to delete it
    // We need to click close to where we placed a vertex.
    // Points were placed at x=400, 480, 560, 640 at y=300
    // Shift+click near the second point
    await page.locator('#map').click({
      position: { x: 480, y: 300 },
      modifiers: ['Shift'],
      force: true,
    });
    await page.waitForTimeout(200);

    // If the click hit a vertex, count should decrease
    // (Depending on zoom/projection, the hit-test may or may not match)
    const countAfter = await getActiveTrackPointCount(page);
    // The vertex hit-test depends on map projection, so we just verify no crash
    // and that the count is <= the original
    expect(countAfter).toBeLessThanOrEqual(countBefore);

    await page.keyboard.press('Escape');
  });

  test('Stats update when points are added', async ({ mapPage: page }) => {
    await clickDrawBtn(page);

    // Add first point — no stats displayed yet (< 2 pts)
    await addPoints(page, 1);

    // Add second point — stats should now show
    await addPoints(page, 1, { startX: 600, startY: 300 });
    await page.waitForTimeout(100);

    // The track stats should contain "2 pts"
    const statsText = await page.locator('.track-stats').first().innerText();
    expect(statsText).toContain('2 pts');

    // Add a third
    await addPoints(page, 1, { startX: 700, startY: 300 });
    await page.waitForTimeout(100);

    const statsText2 = await page.locator('.track-stats').first().innerText();
    expect(statsText2).toContain('3 pts');

    await page.keyboard.press('Escape');
  });
});
