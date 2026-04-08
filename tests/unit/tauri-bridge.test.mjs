// Unit tests for app/js/tauri-bridge.js
// Tests runtime detection, tile URL rewriting, and command routing.
// The bridge reads globals lazily, so we can set/clear them between tests.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isTauri, getRuntime, getDemTileUrl, getDesktopTileBaseUrl,
  getDesktopConfig, onGpxSyncEvents,
  pickAndWatchFolder, listFolderGpx, loadGpx, markDirty,
  saveGpxFile, acceptChange, resolveConflict, getSnapshot,
  addTileSource, listTileSources, removeTileSource,
} from '../../app/js/tauri-bridge.js';

function clearGlobals() {
  delete globalThis.__SLOPE_RUNTIME__;
  delete globalThis.__SLOPE_DESKTOP_CONFIG__;
  delete globalThis.__TAURI_INTERNALS__;
  delete globalThis.__TAURI__;
}

describe('tauri-bridge in web mode (default)', () => {
  beforeEach(clearGlobals);
  afterEach(clearGlobals);

  it('detects web runtime', () => {
    expect(isTauri()).toBe(false);
    expect(getRuntime()).toBe('web');
  });

  it('returns online DEM tile URL in web mode', () => {
    expect(getDemTileUrl()).toBe('https://tiles.mapterhorn.com/{z}/{x}/{y}.webp');
  });

  it('returns empty desktop tile base URL in web mode', () => {
    expect(getDesktopTileBaseUrl()).toBe('');
  });

  it('getDesktopConfig returns null in web mode', async () => {
    const config = await getDesktopConfig();
    expect(config).toBeNull();
  });

  it('onGpxSyncEvents returns noop unlisten in web mode', async () => {
    const unlisten = await onGpxSyncEvents(() => {});
    expect(typeof unlisten).toBe('function');
    unlisten();
  });

  it('GPX sync commands throw in web mode', async () => {
    await expect(pickAndWatchFolder('/tmp')).rejects.toThrow('requires Tauri');
    await expect(listFolderGpx()).rejects.toThrow('requires Tauri');
    await expect(loadGpx('/tmp/a.gpx')).rejects.toThrow('requires Tauri');
    await expect(markDirty('/tmp/a.gpx')).rejects.toThrow('requires Tauri');
    await expect(saveGpxFile('/tmp/a.gpx', '<gpx/>')).rejects.toThrow('requires Tauri');
    await expect(acceptChange('/tmp/a.gpx')).rejects.toThrow('requires Tauri');
    await expect(resolveConflict('/tmp/a.gpx', 'disk')).rejects.toThrow('requires Tauri');
    await expect(getSnapshot()).rejects.toThrow('requires Tauri');
  });

  it('tile source commands: listTileSources returns empty in web, add/remove throw', async () => {
    expect(await listTileSources()).toEqual([]);
    await expect(addTileSource('dem', '/tmp/dem.mbtiles')).rejects.toThrow('requires Tauri');
    await expect(removeTileSource('dem')).rejects.toThrow('requires Tauri');
  });
});

describe('tauri-bridge in desktop mode', () => {
  let invokeLog;

  beforeEach(() => {
    invokeLog = [];
    globalThis.__SLOPE_RUNTIME__ = 'tauri';
    globalThis.__SLOPE_DESKTOP_CONFIG__ = {
      tileBaseUrl: 'http://127.0.0.1:14321',
    };
    globalThis.__TAURI_INTERNALS__ = {
      invoke: (cmd, args) => {
        invokeLog.push({ cmd, args });
        if (cmd === 'get_desktop_config') {
          return Promise.resolve({
            runtime: 'tauri',
            tile_base_url: 'http://127.0.0.1:14321',
            test_mode: true,
            config_path: '/tmp/slopemapper-tauri-e2e/slopemapper.toml',
            cache_root: '/tmp/slopemapper-tauri-e2e/tiles',
            cached_source_names: ['dem'],
          });
        }
        if (cmd === 'get_snapshot') {
          return Promise.resolve({ folder: '/tmp/gpx', files: [] });
        }
        return Promise.resolve({ ok: true });
      },
      event: {
        listen: (event, handler) => Promise.resolve(() => {}),
      },
    };
  });

  afterEach(clearGlobals);

  it('detects tauri runtime', () => {
    expect(isTauri()).toBe(true);
    expect(getRuntime()).toBe('tauri');
  });

  it('returns localhost DEM tile URL in desktop mode', () => {
    expect(getDemTileUrl()).toBe('http://127.0.0.1:14321/tiles/dem/{z}/{x}/{y}.webp');
  });

  it('returns desktop tile base URL', () => {
    expect(getDesktopTileBaseUrl()).toBe('http://127.0.0.1:14321');
  });

  it('getDesktopConfig invokes Tauri command', async () => {
    const config = await getDesktopConfig();
    expect(config.runtime).toBe('tauri');
    expect(config.test_mode).toBe(true);
    expect(config.cached_source_names).toEqual(['dem']);
    expect(invokeLog.some(l => l.cmd === 'get_desktop_config')).toBe(true);
  });

  it('pickAndWatchFolder invokes correct command', async () => {
    await pickAndWatchFolder('/tmp/gpx');
    expect(invokeLog).toEqual([
      { cmd: 'pick_and_watch_folder', args: { folderPath: '/tmp/gpx' } },
    ]);
  });

  it('saveGpxFile invokes correct command', async () => {
    await saveGpxFile('/tmp/track.gpx', '<gpx/>');
    expect(invokeLog).toEqual([
      { cmd: 'save_gpx', args: { path: '/tmp/track.gpx', content: '<gpx/>' } },
    ]);
  });

  it('getSnapshot invokes correct command', async () => {
    const snap = await getSnapshot();
    expect(snap.folder).toBe('/tmp/gpx');
    expect(invokeLog.some(l => l.cmd === 'get_snapshot')).toBe(true);
  });

  it('onGpxSyncEvents registers listener', async () => {
    const unlisten = await onGpxSyncEvents(() => {});
    expect(typeof unlisten).toBe('function');
  });

  it('addTileSource invokes correct command', async () => {
    await addTileSource('dem', '/tmp/dem.mbtiles');
    expect(invokeLog).toEqual([
      { cmd: 'add_tile_source', args: { name: 'dem', path: '/tmp/dem.mbtiles' } },
    ]);
  });

  it('listTileSources invokes correct command', async () => {
    await listTileSources();
    expect(invokeLog.some(l => l.cmd === 'list_tile_sources')).toBe(true);
  });

  it('removeTileSource invokes correct command', async () => {
    await removeTileSource('dem');
    expect(invokeLog).toEqual([
      { cmd: 'remove_tile_source', args: { name: 'dem' } },
    ]);
  });
});
