// Runtime adapter: routes calls to Tauri IPC or browser fallbacks.
// This is the ONLY file that knows about desktop-vs-browser behavior.
//
// Desktop bootstrap globals (injected by src-tauri/main.rs):
//   window.__SLOPE_RUNTIME__       = 'tauri'
//   window.__SLOPE_DESKTOP_CONFIG__ = { tileBaseUrl: 'http://127.0.0.1:14321' }

// ---------------------------------------------------------------------------
// Runtime detection (reads globals lazily so tests can override)
// ---------------------------------------------------------------------------

/** @returns {boolean} */
export function isTauri() {
  return (globalThis.__SLOPE_RUNTIME__ ?? 'web') === 'tauri';
}

/** @returns {string} */
export function getRuntime() {
  return globalThis.__SLOPE_RUNTIME__ ?? 'web';
}

function desktopConfig() {
  return globalThis.__SLOPE_DESKTOP_CONFIG__ ?? null;
}

// ---------------------------------------------------------------------------
// Tauri v2 IPC — injected by the runtime via window.__TAURI_INTERNALS__
// ---------------------------------------------------------------------------

function getTauriInternals() {
  return globalThis.__TAURI_INTERNALS__ ?? globalThis.__TAURI__;
}

async function invoke(cmd, args) {
  const internals = getTauriInternals();
  if (internals?.invoke) {
    return internals.invoke(cmd, args);
  }
  throw new Error(`Tauri invoke not available for command: ${cmd}`);
}

async function listen(event, handler) {
  const internals = getTauriInternals();
  if (internals?.event?.listen) {
    return internals.event.listen(event, handler);
  }
  throw new Error(`Tauri event listener not available for: ${event}`);
}

// ---------------------------------------------------------------------------
// Tile URL rewriting
// ---------------------------------------------------------------------------

/** @returns {string} Base URL for the desktop tile server, or empty string */
export function getDesktopTileBaseUrl() {
  return desktopConfig()?.tileBaseUrl ?? '';
}

/** @returns {string} DEM tile URL template (with {z}/{x}/{y} placeholders) */
export function getDemTileUrl() {
  const cfg = desktopConfig();
  if (isTauri() && cfg?.tileBaseUrl) {
    return `${cfg.tileBaseUrl}/tiles/dem/{z}/{x}/{y}.webp`;
  }
  return 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp';
}

// ---------------------------------------------------------------------------
// GPX sync commands (desktop only; browser uses existing io.js/persist.js)
// ---------------------------------------------------------------------------

export async function pickAndWatchFolder(folderPath) {
  if (!isTauri()) throw new Error('pickAndWatchFolder requires Tauri');
  return invoke('pick_and_watch_folder', { folderPath });
}

export async function listFolderGpx() {
  if (!isTauri()) throw new Error('listFolderGpx requires Tauri');
  return invoke('list_folder_gpx');
}

export async function loadGpx(path) {
  if (!isTauri()) throw new Error('loadGpx requires Tauri');
  return invoke('load_gpx', { path });
}

export async function markDirty(path) {
  if (!isTauri()) throw new Error('markDirty requires Tauri');
  return invoke('mark_dirty', { path });
}

export async function saveGpxFile(path, content) {
  if (!isTauri()) throw new Error('saveGpxFile requires Tauri');
  return invoke('save_gpx', { path, content });
}

export async function acceptChange(path) {
  if (!isTauri()) throw new Error('acceptChange requires Tauri');
  return invoke('accept_change', { path });
}

export async function resolveConflict(path, keep, appContent) {
  if (!isTauri()) throw new Error('resolveConflict requires Tauri');
  return invoke('resolve_conflict', { path, keep, appContent });
}

export async function getSnapshot() {
  if (!isTauri()) throw new Error('getSnapshot requires Tauri');
  return invoke('get_snapshot');
}

export async function getDesktopConfig() {
  if (!isTauri()) return null;
  return invoke('get_desktop_config');
}

// ---------------------------------------------------------------------------
// Tile source management (desktop only)
// ---------------------------------------------------------------------------

export async function addTileSource(name, path) {
  if (!isTauri()) throw new Error('addTileSource requires Tauri');
  return invoke('add_tile_source', { name, path });
}

export async function listTileSources() {
  if (!isTauri()) return [];
  return invoke('list_tile_sources');
}

export async function removeTileSource(name) {
  if (!isTauri()) throw new Error('removeTileSource requires Tauri');
  return invoke('remove_tile_source', { name });
}

/**
 * Scan a folder for .mbtiles/.pmtiles files and auto-register them as tile sources.
 * @param {string} folderPath - absolute path to folder
 * @returns {Promise<Array<{name: string, path: string, kind: string, metadata: object|null}>>}
 */
export async function scanTileFolder(folderPath) {
  if (!isTauri()) throw new Error('scanTileFolder requires Tauri');
  return invoke('scan_tile_folder', { folderPath });
}

// ---------------------------------------------------------------------------
// TileJSON-based source discovery
// ---------------------------------------------------------------------------

/**
 * Fetch all available TileJSON descriptors from the tile server.
 * Each entry is a standard TileJSON object.
 * @returns {Promise<Array<Object>>}
 */
export async function fetchAvailableSources() {
  const cfg = desktopConfig();
  if (!isTauri() || !cfg?.tileBaseUrl) return [];
  try {
    const res = await fetch(`${cfg.tileBaseUrl}/tilejson`);
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

/**
 * Build a CatalogEntry from a TileJSON object.
 * This is a universal approach — works for any TileJSON source, not just local.
 * @param {Object} tj - TileJSON object
 * @param {'basemap'|'overlay'} [category='basemap']
 * @returns {import('./layer-registry.js').CatalogEntry}
 */
export function buildCatalogEntryFromTileJson(tj, category = 'basemap') {
  const name = tj.name || 'unknown';
  const id = `tilejson-${name}`;
  const sourceId = `src-tj-${name}`;
  const format = tj.format || 'png';
  const tiles = tj.tiles || [];

  const sourceDef = {
    type: 'raster',
    tiles,
    tileSize: 256,
  };
  if (tj.minzoom != null) sourceDef.minzoom = tj.minzoom;
  if (tj.maxzoom != null) sourceDef.maxzoom = tj.maxzoom;
  if (tj.attribution) sourceDef.attribution = tj.attribution;
  if (tj.bounds) sourceDef.bounds = tj.bounds;

  return {
    id,
    label: name,
    category,
    region: tj.bounds || null,
    defaultView: tj.center ? { center: [tj.center[0], tj.center[1]], zoom: tj.center[2] || 10 } : null,
    userDefined: true,
    tileJson: tj,
    sources: { [sourceId]: sourceDef },
    layers: [
      {
        id: `basemap-${id}`,
        type: 'raster',
        source: sourceId,
        paint: { 'raster-opacity': 1 },
      }
    ]
  };
}

// ---------------------------------------------------------------------------
// Tile cache management (desktop only)
// ---------------------------------------------------------------------------

/**
 * Get tile cache stats (root path, total size, file count, max size).
 * @returns {Promise<{root: string, total_size_bytes: number, file_count: number, max_size_bytes: number}|null>}
 */
export async function getCacheStats() {
  if (!isTauri()) return null;
  return invoke('get_cache_stats');
}

/**
 * Clear the server-side tile cache by removing all cached files.
 * @returns {Promise<boolean>}
 */
export async function clearTileCache() {
  if (!isTauri()) return false;
  return invoke('clear_tile_cache');
}

// ---------------------------------------------------------------------------
// Event listeners (desktop only)
// ---------------------------------------------------------------------------

/**
 * Listen for GPX sync events from the Rust watcher.
 * @param {function} handler - receives array of SyncEvent objects
 * @returns {Promise<function>} unlisten function
 */
export async function onGpxSyncEvents(handler) {
  if (!isTauri()) return () => {};
  return listen('gpx:sync-events', (event) => {
    handler(event.payload);
  });
}
