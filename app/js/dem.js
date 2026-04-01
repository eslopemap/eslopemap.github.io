// Elevation sampling from DEM tiles.

import { DEM_HD_SOURCE_ID, DEM_MAX_Z } from './constants.js';

// ---- Elevation sampling ----

export function sampleElevationFromDEMData(dem, fx, fy) {
  if (!dem || typeof dem.get !== 'function' || typeof dem.dim !== 'number') return null;
  const dim = dem.dim;
  const px = Math.max(0, Math.min(dim - 1, fx * dim));
  const py = Math.max(0, Math.min(dim - 1, fy * dim));

  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const x1 = Math.min(x0 + 1, dim - 1);
  const y1 = Math.min(y0 + 1, dim - 1);

  const tx = px - x0;
  const ty = py - y0;

  const e00 = dem.get(x0, y0);
  const e10 = dem.get(x1, y0);
  const e01 = dem.get(x0, y1);
  const e11 = dem.get(x1, y1);

  return (1 - tx) * (1 - ty) * e00 + tx * (1 - ty) * e10 + (1 - tx) * ty * e01 + tx * ty * e11;
}

export function queryLoadedElevationAtLngLat(map, lngLat) {
  const style = map && map.style;
  const tileManager = style && style.tileManagers && style.tileManagers[DEM_HD_SOURCE_ID];
  if (!tileManager || !tileManager.getRenderableIds || !tileManager.getTileByID) return null;

  const tilesByCanonical = new Map();
  for (const id of tileManager.getRenderableIds()) {
    const tile = tileManager.getTileByID(id);
    if (!tile || !tile.dem || !tile.tileID || !tile.tileID.canonical) continue;
    const c = tile.tileID.canonical;
    tilesByCanonical.set(`${c.z}/${c.x}/${c.y}`, tile);
  }

  const lat = Math.max(-85.051129, Math.min(85.051129, lngLat.lat));
  const lngWrapped = ((lngLat.lng + 180) % 360 + 360) % 360 - 180;
  const rad = lat * Math.PI / 180;
  const mx = Math.max(0, Math.min(1 - 1e-15, (lngWrapped + 180) / 360));
  const my = Math.max(0, Math.min(1 - 1e-15, (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2));

  const maxZ = Math.min(typeof tileManager.maxzoom === 'number' ? tileManager.maxzoom : DEM_MAX_Z, DEM_MAX_Z);
  const minZ = Math.max(typeof tileManager.minzoom === 'number' ? tileManager.minzoom : 0, 0);

  for (let z = maxZ; z >= minZ; z--) {
    const n = Math.pow(2, z);
    const x = Math.min(Math.floor(mx * n), n - 1);
    const y = Math.min(Math.floor(my * n), n - 1);
    const tile = tilesByCanonical.get(`${z}/${x}/${y}`);
    if (!tile || !tile.dem) continue;

    const fx = mx * n - x;
    const fy = my * n - y;
    const elevation = sampleElevationFromDEMData(tile.dem, fx, fy);
    if (elevation === null) continue;

    // Compute slope via central differences on the DEM grid
    const dim = tile.dem.dim;
    const px = fx * dim, py = fy * dim;
    const dx = 1; // 1 pixel offset
    const eL = sampleElevationFromDEMData(tile.dem, Math.max(0, (px - dx)) / dim, fy);
    const eR = sampleElevationFromDEMData(tile.dem, Math.min(dim - 1, (px + dx)) / dim, fy);
    const eD = sampleElevationFromDEMData(tile.dem, fx, Math.max(0, (py - dx)) / dim);
    const eU = sampleElevationFromDEMData(tile.dem, fx, Math.min(dim - 1, (py + dx)) / dim);
    let slopeDeg = null;
    if (eL != null && eR != null && eD != null && eU != null) {
      const latRad = lat * Math.PI / 180;
      const cellMeters = (40075016.7 / n / dim) * Math.cos(latRad);
      const dzx = (eR - eL) / (2 * cellMeters);
      const dzy = (eU - eD) / (2 * cellMeters);
      slopeDeg = Math.atan(Math.sqrt(dzx * dzx + dzy * dzy)) * 180 / Math.PI;
    }

    return {elevation, slopeDeg, tileZoom: z};
  }

  return null;
}
