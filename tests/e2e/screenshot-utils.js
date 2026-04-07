// Screenshot utilities for e2e tests.
// Provides center-crop to avoid UI chrome/decorations affecting baselines.

const { expect } = require('@playwright/test');

/**
 * Take a screenshot of the map canvas, cropped to a centered rectangle.
 * This avoids UI chrome (panels, buttons, controls) from affecting baselines.
 * @param {import('@playwright/test').Page} page
 * @param {object} [opts]
 * @param {number} [opts.width=400] — crop width
 * @param {number} [opts.height=400] — crop height
 * @returns {Promise<Buffer>} PNG buffer of the cropped region
 */
async function screenshotCenter(page, opts = {}) {
  const width = opts.width ?? 400;
  const height = opts.height ?? 400;
  const viewport = page.viewportSize();
  const x = Math.round((viewport.width - width) / 2);
  const y = Math.round((viewport.height - height) / 2);
  return page.screenshot({
    clip: { x, y, width, height },
  });
}

/**
 * Assert that a center-cropped screenshot matches a baseline.
 * @param {import('@playwright/test').Page} page
 * @param {string} name — snapshot name (without extension)
 * @param {object} [opts]
 * @param {number} [opts.width] — crop width
 * @param {number} [opts.height] — crop height
 * @param {number} [opts.maxDiffPixelRatio] — tolerance (default 0.02)
 */
async function expectCenterScreenshot(page, name, opts = {}) {
  const buf = await screenshotCenter(page, opts);
  expect(buf).toMatchSnapshot(`${name}.png`, {
    maxDiffPixelRatio: opts.maxDiffPixelRatio ?? 0.02,
  });
}

module.exports = { screenshotCenter, expectCenterScreenshot };
