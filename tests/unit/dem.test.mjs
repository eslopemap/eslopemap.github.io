// Unit tests for app/js/dem.js — elevation sampling from DEM data

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// dem.js imports constants.js which calls cssColorToRgb01 at module-load time
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

let sampleElevationFromDEMData;

beforeEach(async () => {
  vi.resetModules();
  installCanvasDocumentMock();
  const mod = await import('../../app/js/dem.js');
  sampleElevationFromDEMData = mod.sampleElevationFromDEMData;
});

afterEach(() => {
  delete globalThis.document;
  vi.restoreAllMocks();
});

function makeDem(dim, valueFn) {
  const data = new Float32Array(dim * dim);
  for (let y = 0; y < dim; y++) {
    for (let x = 0; x < dim; x++) {
      data[y * dim + x] = valueFn(x, y);
    }
  }
  return {
    dim,
    get(x, y) { return data[y * dim + x]; },
  };
}

describe('sampleElevationFromDEMData', () => {
  it('returns null for null dem', () => {
    expect(sampleElevationFromDEMData(null, 0.5, 0.5)).toBeNull();
  });

  it('returns null for dem without get function', () => {
    expect(sampleElevationFromDEMData({ dim: 4 }, 0.5, 0.5)).toBeNull();
  });

  it('returns null for dem without dim', () => {
    expect(sampleElevationFromDEMData({ get: () => 0 }, 0.5, 0.5)).toBeNull();
  });

  it('returns exact value at grid center for uniform DEM', () => {
    const dem = makeDem(4, () => 1000);
    const elev = sampleElevationFromDEMData(dem, 0.5, 0.5);
    expect(elev).toBeCloseTo(1000, 5);
  });

  it('interpolates between values bilinearly', () => {
    // DEM where elevation = x * 100 (linear in x)
    const dem = makeDem(4, (x, _y) => x * 100);
    // fx=0.5 maps to px=2.0, which is exactly on pixel x=2 -> elev 200
    const elev = sampleElevationFromDEMData(dem, 0.5, 0.5);
    expect(elev).toBeCloseTo(200, 1);
  });

  it('clamps coordinates to [0, dim-1]', () => {
    const dem = makeDem(4, (x, y) => x + y);
    // Should not throw for out-of-range coordinates
    const e1 = sampleElevationFromDEMData(dem, -1, -1);
    expect(typeof e1).toBe('number');
    const e2 = sampleElevationFromDEMData(dem, 2, 2);
    expect(typeof e2).toBe('number');
  });

  it('returns corner values correctly', () => {
    const dem = makeDem(2, (x, y) => x * 10 + y);
    // fx=0, fy=0 -> px=0, py=0 -> value at (0,0) = 0
    const e00 = sampleElevationFromDEMData(dem, 0, 0);
    expect(e00).toBeCloseTo(0, 5);
  });
});
