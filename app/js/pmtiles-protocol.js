// PMTiles protocol integration for MapLibre GL JS.
// Registers the pmtiles:// custom protocol so MapLibre can fetch tiles
// from local PMTiles files served via the Tauri tile server's Range endpoint.
//
// Uses dynamic import() to avoid blocking the module graph if the import map
// hasn't been processed yet.

let _protocol = null;

/**
 * Initialize the PMTiles protocol and register it with MapLibre.
 * Safe to call multiple times — only registers once.
 * Returns a promise that resolves when the protocol is ready.
 * @param {typeof import('maplibre-gl')} maplibregl
 */
export async function initPmtilesProtocol(maplibregl) {
  if (_protocol) return;
  try {
    const { Protocol } = await import('pmtiles');
    _protocol = new Protocol();
    maplibregl.addProtocol('pmtiles', _protocol.tile);
  } catch (e) {
    console.warn('[pmtiles] Failed to load pmtiles library:', e.message);
  }
}

/**
 * Remove the PMTiles protocol from MapLibre.
 */
export function removePmtilesProtocol(maplibregl) {
  if (!_protocol) return;
  maplibregl.removeProtocol('pmtiles');
  _protocol = null;
}
