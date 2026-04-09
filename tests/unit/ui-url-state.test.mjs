import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let getDefaultViewState;
let parseHashParams;

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

function installWindow(hash = '') {
  globalThis.window = {
    location: {
      hash,
      pathname: '/app/index.html',
      search: '',
    },
    history: {
      replaceState() {},
    },
  };
}

describe('ui URL state parsing', () => {
  beforeEach(async () => {
    vi.resetModules();
    installCanvasDocumentMock();
    installWindow('');
    ({ getDefaultViewState, parseHashParams } = await import('../../app/js/ui.js'));
  });

  afterEach(() => {
    delete globalThis.document;
    delete globalThis.window;
    vi.restoreAllMocks();
  });

  it('returns default view state separately from URL overrides', () => {
    expect(getDefaultViewState()).toEqual({
      center: [6.8652, 45.8326],
      zoom: 12,
      basemap: null,
      mode: 'slope+relief',
      slopeOpacity: 0.45,
      terrain3d: false,
      terrainExaggeration: 1.4,
      testMode: false,
      bearing: 0,
      pitch: 0,
    });
  });

  it('returns no overrides when the hash is empty', () => {
    expect(parseHashParams()).toEqual({});
  });

  it('returns only explicitly provided valid URL keys', () => {
    installWindow('#lng=6.9&lat=45.8&zoom=9&mode=slope&terrain=1');

    expect(parseHashParams()).toEqual({
      center: [6.9, 45.8],
      zoom: 9,
      mode: 'slope',
      terrain3d: true,
    });
  });

  it('does not inject fallback values for partial hashes', () => {
    installWindow('#mode=color-relief');

    expect(parseHashParams()).toEqual({
      mode: 'color-relief',
    });
  });

  it('ignores invalid values instead of overriding persisted state', () => {
    installWindow('#zoom=bogus&terrain=maybe&pitch=200&basemap=missing');

    expect(parseHashParams()).toEqual({});
  });

  it('accepts valid catalog-backed basemap overrides', () => {
    installWindow('#basemap=osm&bearing=22.5&pitch=40');

    expect(parseHashParams()).toEqual({
      basemap: 'osm',
      basemapStack: ['osm'],
      bearing: 22.5,
      pitch: 40,
    });
  });

  it('parses comma-separated basemap stack from URL hash', () => {
    installWindow('#basemap=osm,otm');

    expect(parseHashParams()).toEqual({
      basemap: 'osm',
      basemapStack: ['osm', 'otm'],
    });
  });

  it('filters invalid basemap ids from comma list', () => {
    installWindow('#basemap=osm,missing,otm');

    expect(parseHashParams()).toEqual({
      basemap: 'osm',
      basemapStack: ['osm', 'otm'],
    });
  });
});
