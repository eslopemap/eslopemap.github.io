import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let isTileJsonLike, addCustomTileSource, removeCustomTileSource, loadPersistedCustomTileSources;
let registry;

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
      return { width: 0, height: 0, getContext() { return context; } };
    },
    getElementById() { return null; },
  };
}

function clearGlobals() {
  delete globalThis.__SLOPE_RUNTIME__;
  delete globalThis.__SLOPE_DESKTOP_CONFIG__;
  delete globalThis.__TAURI_INTERNALS__;
  delete globalThis.document;
}

// ── isTileJsonLike ──────────────────────────────────────────────────────

describe('isTileJsonLike', () => {
  beforeEach(async () => {
    vi.resetModules();
    clearGlobals();
    installCanvasDocumentMock();
    ({ isTileJsonLike } = await import('../../app/js/custom-tile-sources.js'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearGlobals();
  });

  it('returns true for object with tilejson field', () => {
    expect(isTileJsonLike({ tilejson: '3.0.0', tiles: [] })).toBe(true);
  });

  it('returns true for object with non-empty tiles array', () => {
    expect(isTileJsonLike({ tiles: ['https://example.test/{z}/{x}/{y}.png'] })).toBe(true);
  });

  it('returns true for pmtiles descriptor', () => {
    expect(isTileJsonLike({ protocol: 'pmtiles', url: 'pmtiles://http://example.test/tiles' })).toBe(true);
  });

  it('returns false for empty object', () => {
    expect(isTileJsonLike({})).toBe(false);
  });

  it('returns false for null', () => {
    expect(isTileJsonLike(null)).toBe(false);
  });

  it('returns false for array', () => {
    expect(isTileJsonLike([])).toBe(false);
  });

  it('returns false for GeoJSON-like object', () => {
    expect(isTileJsonLike({ type: 'FeatureCollection', features: [] })).toBe(false);
  });

  it('returns false for object with empty tiles array', () => {
    expect(isTileJsonLike({ tiles: [] })).toBe(false);
  });
});

// ── addCustomTileSource (web mode) ──────────────────────────────────────

describe('addCustomTileSource — web mode', () => {
  beforeEach(async () => {
    vi.resetModules();
    clearGlobals();
    installCanvasDocumentMock();
    // web mode — no __SLOPE_RUNTIME__
    ({ addCustomTileSource, removeCustomTileSource } = await import('../../app/js/custom-tile-sources.js'));
    registry = await import('../../app/js/layer-registry.js');
    registry.clearUserSources();
  });

  afterEach(() => {
    registry.clearUserSources();
    vi.restoreAllMocks();
    clearGlobals();
  });

  it('registers a custom tile source with browser persistence', async () => {
    const entry = await addCustomTileSource({
      id: 'test-src',
      name: 'Test Source',
      tiles: ['https://example.test/{z}/{x}/{y}.png'],
    });

    expect(entry.id).toBe('tilejson-test-src');
    expect(entry.persistence).toBe('browser');
    expect(entry.userDefined).toBe(true);
    expect(registry.getCatalogEntry('tilejson-test-src')).toBeTruthy();
  });

  it('auto-generates id from name when id is missing', async () => {
    const entry = await addCustomTileSource({
      name: 'Auto Named',
      tiles: ['https://example.test/{z}/{x}/{y}.png'],
    });
    expect(entry.id).toBe('tilejson-Auto Named');
  });

  it('throws for empty tileJson', async () => {
    await expect(addCustomTileSource(null)).rejects.toThrow('TileJSON object is required');
  });

  it('throws for tileJson without tiles or pmtiles url', async () => {
    await expect(addCustomTileSource({ id: 'bad' })).rejects.toThrow('must define tiles[]');
  });

  it('replaces existing entry with same id', async () => {
    await addCustomTileSource({
      id: 'dup', name: 'V1', tiles: ['https://example.test/v1/{z}/{x}/{y}.png'],
    });
    await addCustomTileSource({
      id: 'dup', name: 'V2', tiles: ['https://example.test/v2/{z}/{x}/{y}.png'],
    });
    expect(registry.getUserSources()).toHaveLength(1);
    expect(registry.getCatalogEntry('tilejson-dup').label).toBe('V2');
  });

  it('calls refreshUi when provided', async () => {
    const refreshUi = vi.fn();
    await addCustomTileSource({
      id: 'x', tiles: ['https://example.test/{z}/{x}/{y}.png'],
    }, { refreshUi });
    expect(refreshUi).toHaveBeenCalledTimes(1);
  });
});

// ── removeCustomTileSource (web mode) ────────────────────────────────────

describe('removeCustomTileSource — web mode', () => {
  beforeEach(async () => {
    vi.resetModules();
    clearGlobals();
    installCanvasDocumentMock();
    ({ addCustomTileSource, removeCustomTileSource } = await import('../../app/js/custom-tile-sources.js'));
    registry = await import('../../app/js/layer-registry.js');
    registry.clearUserSources();
  });

  afterEach(() => {
    registry.clearUserSources();
    vi.restoreAllMocks();
    clearGlobals();
  });

  it('removes a previously added custom source', async () => {
    await addCustomTileSource({
      id: 'to-remove', tiles: ['https://example.test/{z}/{x}/{y}.png'],
    });
    expect(registry.getUserSources()).toHaveLength(1);

    const removed = await removeCustomTileSource('tilejson-to-remove');
    expect(removed).toBe(true);
    expect(registry.getUserSources()).toHaveLength(0);
  });

  it('returns false for non-existent source', async () => {
    const removed = await removeCustomTileSource('tilejson-nonexistent');
    expect(removed).toBe(false);
  });

  it('calls refreshUi when provided', async () => {
    await addCustomTileSource({
      id: 'rem', tiles: ['https://example.test/{z}/{x}/{y}.png'],
    });
    const refreshUi = vi.fn();
    await removeCustomTileSource('tilejson-rem', { refreshUi });
    expect(refreshUi).toHaveBeenCalledTimes(1);
  });
});

// ── addCustomTileSource (desktop mode) ──────────────────────────────────

describe('addCustomTileSource — desktop mode', () => {
  let invokeLog;

  beforeEach(async () => {
    vi.resetModules();
    clearGlobals();
    installCanvasDocumentMock();

    invokeLog = [];
    globalThis.__SLOPE_RUNTIME__ = 'tauri';
    globalThis.__SLOPE_DESKTOP_CONFIG__ = { tileBaseUrl: 'http://127.0.0.1:14321' };
    globalThis.__TAURI_INTERNALS__ = {
      invoke: (cmd, args) => {
        invokeLog.push({ cmd, args });
        if (cmd === 'get_config_value') return Promise.resolve([]);
        if (cmd === 'set_config_value') return Promise.resolve(args.value);
        return Promise.resolve({ ok: true });
      },
    };

    ({ addCustomTileSource, removeCustomTileSource, loadPersistedCustomTileSources } = await import('../../app/js/custom-tile-sources.js'));
    registry = await import('../../app/js/layer-registry.js');
    registry.clearUserSources();
  });

  afterEach(() => {
    registry.clearUserSources();
    vi.restoreAllMocks();
    clearGlobals();
  });

  it('registers with desktop-config persistence and invokes set_config_value', async () => {
    const entry = await addCustomTileSource({
      id: 'desktop-src',
      name: 'Desktop Source',
      tiles: ['https://example.test/{z}/{x}/{y}.png'],
    });

    expect(entry.persistence).toBe('desktop-config');
    expect(invokeLog.some(l => l.cmd === 'get_config_value' && l.args.key === 'sources.custom_tilejsons')).toBe(true);
    expect(invokeLog.some(l => l.cmd === 'set_config_value' && l.args.key === 'sources.custom_tilejsons')).toBe(true);
  });

  it('removeCustomTileSource invokes set_config_value for desktop-config sources', async () => {
    await addCustomTileSource({
      id: 'dt', name: 'DT', tiles: ['https://example.test/{z}/{x}/{y}.png'],
    });
    invokeLog.length = 0;

    await removeCustomTileSource('tilejson-dt');
    expect(invokeLog.some(l => l.cmd === 'get_config_value')).toBe(true);
    expect(invokeLog.some(l => l.cmd === 'set_config_value')).toBe(true);
  });

  it('loadPersistedCustomTileSources reads from backend config', async () => {
    // Override invoke to return a custom tilejson list
    globalThis.__TAURI_INTERNALS__.invoke = (cmd, args) => {
      invokeLog.push({ cmd, args });
      if (cmd === 'get_config_value' && args.key === 'sources.custom_tilejsons') {
        return Promise.resolve([
          { id: 'restored', name: 'Restored', tiles: ['https://example.test/{z}/{x}/{y}.png'] },
        ]);
      }
      return Promise.resolve({ ok: true });
    };

    const result = await loadPersistedCustomTileSources();
    expect(result).toHaveLength(1);
    expect(registry.getCatalogEntry('tilejson-restored')).toBeTruthy();
    expect(registry.getCatalogEntry('tilejson-restored').persistence).toBe('desktop-config');
  });

  it('loadPersistedCustomTileSources returns empty in web mode', async () => {
    // Switch back to web mode
    delete globalThis.__SLOPE_RUNTIME__;
    vi.resetModules();
    installCanvasDocumentMock();
    const mod = await import('../../app/js/custom-tile-sources.js');
    const result = await mod.loadPersistedCustomTileSources();
    expect(result).toEqual([]);
  });
});
