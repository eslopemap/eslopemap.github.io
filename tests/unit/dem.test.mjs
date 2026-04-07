// Unit tests for app/js/dem.js — bilinear elevation sampling

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

let sampleElevationFromDEMData;

beforeEach(async () => {
  vi.resetModules();
  installCanvasDocumentMock();
  sampleElevationFromDEMData = (await import('../../app/js/dem.js')).sampleElevationFromDEMData;
});
afterEach(() => { delete globalThis.document; vi.restoreAllMocks(); });

function makeDem(dim, fn) {
  const d = new Float32Array(dim * dim);
  for (let y = 0; y < dim; y++) for (let x = 0; x < dim; x++) d[y * dim + x] = fn(x, y);
  return { dim, get(x, y) { return d[y * dim + x]; } };
}

describe('sampleElevationFromDEMData', () => {
  it('returns null for invalid DEM input', () => {
    expect(sampleElevationFromDEMData(null, 0.5, 0.5)).toBeNull();
    expect(sampleElevationFromDEMData({ dim: 4 }, 0.5, 0.5)).toBeNull();
    expect(sampleElevationFromDEMData({ get: () => 0 }, 0.5, 0.5)).toBeNull();
  });

  it('bilinear interpolation on a gradient DEM', () => {
    // elevation = x * 100 (linear gradient in x). At fx=0.5 on a 4px grid → pixel x=2 → 200
    const dem = makeDem(4, (x) => x * 100);
    expect(sampleElevationFromDEMData(dem, 0.5, 0.5)).toBeCloseTo(200, 1);
    // Uniform → constant everywhere
    const flat = makeDem(4, () => 500);
    expect(sampleElevationFromDEMData(flat, 0.3, 0.7)).toBeCloseTo(500, 5);
  });
});
