// Unit tests for app/js/constants.js — ramp parsing and legend CSS generation

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

function installCanvasDocumentMock() {
  const context = {
    clearRect() {}, fillRect() {},
    getImageData() { return { data: new Uint8ClampedArray([255, 255, 255, 255]) }; },
    set fillStyle(v) { this._fs = v; }, get fillStyle() { return this._fs; },
  };
  globalThis.document = {
    createElement(t) {
      if (t !== 'canvas') throw new Error(`Unsupported: ${t}`);
      return { width: 0, height: 0, getContext() { return context; } };
    },
  };
}

let mod;
beforeEach(async () => {
  vi.resetModules();
  installCanvasDocumentMock();
  mod = await import('../../app/js/constants.js');
});
afterEach(() => { delete globalThis.document; vi.restoreAllMocks(); });

describe('parseStepRamp / parseInterpolateStops', () => {
  it('rejects malformed expressions', () => {
    expect(() => mod.parseStepRamp(['interpolate'], 'slope')).toThrow('step expression');
    expect(() => mod.parseStepRamp(['step', ['wrong'], '#fff'], 'slope')).toThrow('slope');
    expect(() => mod.parseInterpolateStops(['step'], 'elevation')).toThrow('interpolate');
  });
});

describe('legend CSS generation', () => {
  it('rampToLegendCss produces valid CSS gradient', () => {
    const css = mod.rampToLegendCss('slope');
    expect(css).toMatch(/^linear-gradient\(to right,/);
    expect(css).toContain('rgb(');
    // Verify it covers full range (0% to 100%)
    expect(css).toContain('0.00%');
    expect(css).toContain('100.00%');
  });

  it('interpolateStopsToLegendCss produces valid CSS gradient', () => {
    const css = mod.interpolateStopsToLegendCss(mod.COLOR_RELIEF_STOPS);
    expect(css).toMatch(/^linear-gradient\(to right,/);
  });
});
