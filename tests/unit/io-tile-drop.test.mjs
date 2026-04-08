import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let resolveDroppedTilePath;

function installCanvasDocumentMock() {
  const context = {
    clearRect() {},
    fillRect() {},
    getImageData() { return { data: new Uint8ClampedArray([255, 255, 255, 255]) }; },
    set fillStyle(v) { this._fs = v; },
    get fillStyle() { return this._fs; },
  };
  globalThis.document = {
    createElement(tagName) {
      if (tagName !== 'canvas') throw new Error(`Unsupported element in test mock: ${tagName}`);
      return {
        width: 0,
        height: 0,
        getContext() { return context; },
      };
    },
    getElementById() {
      return null;
    },
  };
}

describe('io tile drop path resolution', () => {
  beforeEach(async () => {
    vi.resetModules();
    installCanvasDocumentMock();
    ({ resolveDroppedTilePath } = await import('../../app/js/io.js'));
  });

  afterEach(() => {
    delete globalThis.document;
    vi.restoreAllMocks();
  });

  it('prefers the absolute file.path over entry.fullPath', () => {
    expect(resolveDroppedTilePath(
      { fullPath: '/relative/from-drop/test.mbtiles' },
      { path: '/Users/me/data/test.mbtiles' },
    )).toBe('/Users/me/data/test.mbtiles');
  });

  it('falls back to entry.fullPath when file.path is unavailable', () => {
    expect(resolveDroppedTilePath(
      { fullPath: '/Users/me/data/test.mbtiles' },
      { path: '' },
    )).toBe('/Users/me/data/test.mbtiles');
  });

  it('returns an empty string when no path information is available', () => {
    expect(resolveDroppedTilePath({}, {})).toBe('');
  });
});
