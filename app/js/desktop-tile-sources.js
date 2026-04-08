import { registerUserSource } from './layer-registry.js';
import {
  addTileSource,
  fetchAvailableSources,
  buildCatalogEntryFromTileJson,
  isTauri,
  scanTileFolder,
} from './tauri-bridge.js';

/**
 * Register discovered TileJSON sources in the layer catalog.
 * @param {Array<Object>} tileJsonSources
 * @returns {number}
 */
export function registerDiscoveredTileJsonSources(tileJsonSources) {
  let registeredCount = 0;
  for (const tj of tileJsonSources ?? []) {
    if (!tj || tj.name === 'dem') continue;
    registerUserSource(buildCatalogEntryFromTileJson(tj));
    registeredCount += 1;
  }
  return registeredCount;
}

/**
 * Register catalog entries for already-available desktop tile sources.
 * @param {{ refreshUi?: (() => void) | null, logPrefix?: string }} [options]
 * @returns {Promise<number>}
 */
export async function discoverAndRegisterDesktopTileSources(options = {}) {
  if (!isTauri()) return 0;
  const { refreshUi = null, logPrefix = '[tile-sources]' } = options;
  const sources = await fetchAvailableSources();
  const registeredCount = registerDiscoveredTileJsonSources(sources);
  if (registeredCount > 0) {
    console.info(`${logPrefix} registered ${registeredCount} custom map(s) from tile server`);
    refreshUi?.();
  }
  return registeredCount;
}

/**
 * Register a single tile file on the desktop tile server, then expose it in the catalog.
 * @param {string} name
 * @param {string} path
 * @param {{ refreshUi?: (() => void) | null, logPrefix?: string }} [options]
 * @returns {Promise<string|null>}
 */
export async function registerDesktopTileSource(name, path, options = {}) {
  if (!isTauri()) return null;
  const { refreshUi = null, logPrefix = '[tile-sources]' } = options;
  const cleanName = name.replace(/\.(mbtiles|pmtiles)$/i, '');

  await addTileSource(cleanName, path);

  const sources = await fetchAvailableSources();
  const tj = sources.find(source => source.id === cleanName || source.name === cleanName);
  if (!tj) {
    console.warn(`${logPrefix} TileJSON not found for '${cleanName}'`);
    return null;
  }

  const entry = buildCatalogEntryFromTileJson(tj);
  registerUserSource(entry);
  console.info(`${logPrefix} registered '${cleanName}' as layer`);
  refreshUi?.();
  return entry.id;
}

/**
 * Ask the desktop runtime to scan and register tile files from a folder, then expose them in the catalog.
 * @param {string} folderPath
 * @param {{ refreshUi?: (() => void) | null, logPrefix?: string }} [options]
 * @returns {Promise<{ tiles: Array<{name: string, path: string, kind: string, metadata: object | null}>, registeredCount: number }>}
 */
export async function scanAndRegisterDesktopTileFolder(folderPath, options = {}) {
  if (!isTauri()) return { tiles: [], registeredCount: 0 };
  const { refreshUi = null, logPrefix = '[tile-sources]' } = options;
  const tiles = await scanTileFolder(folderPath);
  if (!tiles.length) return { tiles, registeredCount: 0 };

  const names = new Set(tiles.map(tile => tile.name));
  const sources = await fetchAvailableSources();
  const registeredCount = registerDiscoveredTileJsonSources(
    sources.filter(source => names.has(source.name) && source.name !== 'dem')
  );

  if (registeredCount > 0) {
    console.info(`${logPrefix} registered ${registeredCount} tile source(s) from folder`);
    refreshUi?.();
  }

  return { tiles, registeredCount };
}
