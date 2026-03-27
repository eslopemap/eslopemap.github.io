const { chromium } = require('@playwright/test');
const fs = require('fs');
const log = (...args) => { const line = args.join(' ') + '\n'; fs.appendFileSync('/tmp/debug-test.log', line); };
fs.writeFileSync('/tmp/debug-test.log', '');
(async () => {
  try {
    const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
    const page = await browser.newPage();
    page.on('pageerror', err => log('PAGE_ERR:', err.message.slice(0, 300)));
    page.on('console', msg => {
      if (msg.type() === 'error') log('CONSOLE_ERR:', msg.text().slice(0, 300));
    });
    page.on('dialog', async d => {
      log('DIALOG:', d.type(), d.message().slice(0, 200));
      await d.accept();
    });
    await page.goto('http://localhost:8089/slope.html', { waitUntil: 'load', timeout: 15000 });
    log('1-Page loaded');
    await page.waitForFunction(() => { try { return (0, eval)('mapReady'); } catch { return false; } }, { timeout: 20000 });
    log('2-MAP_READY');
    try {
      await page.locator('#draw-btn').click({ timeout: 5000 });
      log('3-draw-btn clicked via Playwright');
    } catch (e) {
      log('3-draw-btn Playwright click FAILED: ' + e.message.slice(0, 200));
      await page.evaluate(() => document.getElementById('draw-btn').click());
      log('3b-draw-btn JS clicked');
    }
    await page.waitForTimeout(300);
    log('4-waited');
    const mapEl = page.locator('#map');
    for (let i = 0; i < 3; i++) {
      await mapEl.click({ position: { x: 400 + i * 80, y: 300 }, force: true });
      await page.waitForTimeout(80);
    }
    log('5-points added');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    log('6-escaped');
    const trackCount = await page.evaluate(() => (0, eval)('tracks.length'));
    log('7-trackCount: ' + trackCount);
    await page.waitForTimeout(500);
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(
      () => { try { return (0, eval)('mapReady'); } catch { return false; } },
      { timeout: 20000 }
    );
    log('8-reloaded, mapReady');
    await page.waitForTimeout(300);
    const restoredCount = await page.evaluate(() => (0, eval)('tracks.length'));
    log('9-restoredCount: ' + restoredCount);
    await browser.close();
    log('10-DONE');
  } catch (e) {
    log('FATAL: ' + e.message);
    process.exit(1);
  }
})();
