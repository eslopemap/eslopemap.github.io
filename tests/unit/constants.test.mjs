// Unit tests for app/js/constants.js — color ramp parsing, legend CSS

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// constants.js calls cssColorToRgb01 at module-load time, which needs a canvas mock
function installCanvasDocumentMock() {
  const context = {
    clearRect() {},
    fillRect() {},
    getImageData() {
      return { data: new Uint8ClampedArray([255, 255, 255, 255]) };
    },
    set fillStyle(value) { this._fillStyle = value; },
    get fillStyle() { return this._fillStyle; },
  };
  globalThis.document = {
    createElement(tagName) {
      if (tagName !== 'canvas') throw new Error(`Unsupported: ${tagName}`);
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

afterEach(() => {
  delete globalThis.document;
  vi.restoreAllMocks();
});

describe('parseStepRamp', () => {
  it('parses the slope ramp', () => {
    const ramp = mod.parseStepRamp(mod.ANALYSIS_COLOR.slope, 'slope');
    expect(ramp.stepCount).toBeGreaterThan(0);
    expect(ramp.stepCount).toBeLessThanOrEqual(mod.MAX_STEP_STOPS);
    expect(ramp.values).toBeInstanceOf(Float32Array);
    expect(ramp.colors).toBeInstanceOf(Float32Array);
  });

  it('parses the aspect ramp', () => {
    const ramp = mod.parseStepRamp(mod.ANALYSIS_COLOR.aspect, 'aspect');
    expect(ramp.stepCount).toBe(4); // 4 compass quadrants
  });

  it('throws on non-step expression', () => {
    expect(() => mod.parseStepRamp(['interpolate'], 'slope')).toThrow('step expression');
  });

  it('throws on wrong input', () => {
    expect(() => mod.parseStepRamp(['step', ['wrong'], '#fff'], 'slope')).toThrow('slope');
  });
});

describe('parseInterpolateStops', () => {
  it('parses color-relief stops', () => {
    const stops = mod.parseInterpolateStops(mod.ANALYSIS_COLOR['color-relief'], 'elevation');
    expect(stops.length).toBeGreaterThan(5);
    expect(stops[0]).toHaveProperty('value');
    expect(stops[0]).toHaveProperty('color');
  });

  it('throws on non-interpolate expression', () => {
    expect(() => mod.parseInterpolateStops(['step'], 'elevation')).toThrow('interpolate');
  });
});

describe('PARSED_RAMPS', () => {
  it('has slope and aspect pre-parsed', () => {
    expect(mod.PARSED_RAMPS.slope.stepCount).toBeGreaterThan(0);
    expect(mod.PARSED_RAMPS.aspect.stepCount).toBeGreaterThan(0);
  });
});

describe('COLOR_RELIEF_STOPS', () => {
  it('is an array of stops with value and color', () => {
    expect(Array.isArray(mod.COLOR_RELIEF_STOPS)).toBe(true);
    expect(mod.COLOR_RELIEF_STOPS.length).toBeGreaterThan(0);
    expect(mod.COLOR_RELIEF_STOPS[0]).toHaveProperty('value');
    expect(mod.COLOR_RELIEF_STOPS[0]).toHaveProperty('color');
  });
});

describe('rampToLegendCss', () => {
  it('generates a CSS linear-gradient for slope', () => {
    const css = mod.rampToLegendCss('slope');
    expect(css).toContain('linear-gradient');
    expect(css).toContain('rgb(');
  });

  it('generates a CSS linear-gradient for aspect', () => {
    const css = mod.rampToLegendCss('aspect');
    expect(css).toContain('linear-gradient');
  });
});

describe('interpolateStopsToLegendCss', () => {
  it('generates a CSS linear-gradient from stops', () => {
    const css = mod.interpolateStopsToLegendCss(mod.COLOR_RELIEF_STOPS);
    expect(css).toContain('linear-gradient');
  });
});

describe('basemapOpacityExpr', () => {
  it('returns coalesce expression without multiplier', () => {
    const expr = mod.basemapOpacityExpr();
    expect(expr[0]).toBe('coalesce');
    expect(expr[1]).toEqual(['global-state', 'basemapOpacity']);
  });

  it('wraps in multiply when multiplier != 1', () => {
    const expr = mod.basemapOpacityExpr(0.5);
    expect(expr[0]).toBe('*');
    expect(expr[1]).toBe(0.5);
  });
});

describe('constants', () => {
  it('DEM_MAX_Z is a reasonable zoom level', () => {
    expect(mod.DEM_MAX_Z).toBeGreaterThanOrEqual(10);
    expect(mod.DEM_MAX_Z).toBeLessThanOrEqual(20);
  });

  it('ANALYSIS_RANGE has expected keys', () => {
    expect(mod.ANALYSIS_RANGE).toHaveProperty('slope');
    expect(mod.ANALYSIS_RANGE).toHaveProperty('aspect');
    expect(mod.ANALYSIS_RANGE).toHaveProperty('color-relief');
  });
});
