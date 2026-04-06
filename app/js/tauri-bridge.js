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
// Tauri API lazy-loaders (only imported when in desktop mode)
// ---------------------------------------------------------------------------

let _tauriCore = null;
let _tauriEvent = null;

async function tauriCore() {
  if (!isTauri()) return null;
  if (!_tauriCore) {
    // @tauri-apps/api is available via Tauri's built-in module loader
    _tauriCore = await import('https://unpkg.com/@tauri-apps/api/core');
  }
  return _tauriCore;
}

async function tauriEvent() {
  if (!isTauri()) return null;
  if (!_tauriEvent) {
    _tauriEvent = await import('https://unpkg.com/@tauri-apps/api/event');
  }
  return _tauriEvent;
}

// In Tauri v2, the IPC is injected by the runtime — we use window.__TAURI__
// which is the standard way to access invoke/listen without importing modules.
function getTauriInternals() {
  return globalThis.__TAURI_INTERNALS__ ?? globalThis.__TAURI__;
}

async function invoke(cmd, args) {
  const internals = getTauriInternals();
  if (internals?.invoke) {
    return internals.invoke(cmd, args);
  }
  // Fallback: try dynamic import
  const core = await tauriCore();
  if (core?.invoke) {
    return core.invoke(cmd, args);
  }
  throw new Error(`Tauri invoke not available for command: ${cmd}`);
}

async function listen(event, handler) {
  const internals = getTauriInternals();
  if (internals?.event?.listen) {
    return internals.event.listen(event, handler);
  }
  const eventMod = await tauriEvent();
  if (eventMod?.listen) {
    return eventMod.listen(event, handler);
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
