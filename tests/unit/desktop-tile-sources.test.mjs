import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let registerDiscoveredTileJsonSources;
let discoverAndRegisterDesktopTileSources;
let registerDesktopTileSource;
let scanAndRegisterDesktopTileFolder;

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

function clearGlobals() {
  delete globalThis.__SLOPE_RUNTIME__;
  delete globalThis.__SLOPE_DESKTOP_CONFIG__;
  delete globalThis.__TAURI_INTERNALS__;
  delete globalThis.fetch;
  delete globalThis.document;
}

describe('desktop tile source helpers', () => {
  beforeEach(async () => {
    vi.resetModules();
    clearGlobals();
    installCanvasDocumentMock();
    globalThis.__SLOPE_RUNTIME__ = 'tauri';
    globalThis.__SLOPE_DESKTOP_CONFIG__ = {
      tileBaseUrl: 'http://127.0.0.1:14321',
    };
    const invokeLog = [];
    globalThis.__TAURI_INTERNALS__ = {
      invoke: (cmd, args) => {
        invokeLog.push({ cmd, args });
        if (cmd === 'scan_tile_folder') {
          return Promise.resolve([
            { name: 'folder-a', path: '/tiles/folder-a.mbtiles', kind: 'mbtiles', metadata: null },
            { name: 'dem', path: '/tiles/dem.mbtiles', kind: 'mbtiles', metadata: null },
          ]);
        }
        return Promise.resolve({ ok: true });
      },
    };
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ([
        { name: 'folder-a', tiles: ['http://127.0.0.1:14321/tiles/folder-a/{z}/{x}/{y}.png'] },
        { name: 'drop-a', tiles: ['http://127.0.0.1:14321/tiles/drop-a/{z}/{x}/{y}.png'] },
        { name: 'existing-a', tiles: ['http://127.0.0.1:14321/tiles/existing-a/{z}/{x}/{y}.png'] },
        { name: 'dem', tiles: ['http://127.0.0.1:14321/tiles/dem/{z}/{x}/{y}.png'] },
      ]),
    }));

    ({
      registerDiscoveredTileJsonSources,
      discoverAndRegisterDesktopTileSources,
      registerDesktopTileSource,
      scanAndRegisterDesktopTileFolder,
    } = await import('../../app/js/desktop-tile-sources.js'));
  });

  afterEach(async () => {
    const registry = await import('../../app/js/layer-registry.js');
    registry.clearUserSources();
    vi.restoreAllMocks();
    clearGlobals();
  });

  it('registerDiscoveredTileJsonSources skips dem and registers user catalog entries', async () => {
    const registry = await import('../../app/js/layer-registry.js');
    const count = registerDiscoveredTileJsonSources([
      { name: 'existing-a', tiles: ['http://127.0.0.1:14321/tiles/existing-a/{z}/{x}/{y}.png'] },
      { name: 'dem', tiles: ['http://127.0.0.1:14321/tiles/dem/{z}/{x}/{y}.png'] },
    ]);

    expect(count).toBe(1);
    expect(registry.getCatalogEntry('tilejson-existing-a')).toBeTruthy();
    expect(registry.getCatalogEntry('tilejson-dem')).toBeNull();
  });

  it('discoverAndRegisterDesktopTileSources refreshes UI only when custom sources are found', async () => {
    const refreshUi = vi.fn();
    const registered = await discoverAndRegisterDesktopTileSources({ refreshUi, logPrefix: '[test]' });

    expect(registered).toBe(3);
    expect(refreshUi).toHaveBeenCalledTimes(1);
  });

  it('registerDesktopTileSource adds a single source and refreshes UI', async () => {
    const refreshUi = vi.fn();
    const catalogId = await registerDesktopTileSource('drop-a.mbtiles', '/tiles/drop-a.mbtiles', { refreshUi, logPrefix: '[drop]' });
    const registry = await import('../../app/js/layer-registry.js');

    expect(catalogId).toBe('tilejson-drop-a');
    expect(refreshUi).toHaveBeenCalledTimes(1);
    expect(registry.getCatalogEntry('tilejson-drop-a')).toBeTruthy();
  });

  it('scanAndRegisterDesktopTileFolder reuses server-side scan results and registers matching catalog entries', async () => {
    const refreshUi = vi.fn();
    const result = await scanAndRegisterDesktopTileFolder('/tiles', { refreshUi, logPrefix: '[folder]' });
    const registry = await import('../../app/js/layer-registry.js');

    expect(result.tiles).toHaveLength(2);
    expect(result.registeredCount).toBe(1);
    expect(refreshUi).toHaveBeenCalledTimes(1);
    expect(registry.getCatalogEntry('tilejson-folder-a')).toBeTruthy();
    expect(registry.getCatalogEntry('tilejson-dem')).toBeNull();
  });
});
