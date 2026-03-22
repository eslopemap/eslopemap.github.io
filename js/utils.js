// Pure utility functions — no DOM or map dependencies.

// ---- Haversine ----
export function haversineKm(a, b) {
  const R = 6371;
  const dLat = (b[1] - a[1]) * Math.PI / 180;
  const dLon = (b[0] - a[0]) * Math.PI / 180;
  const la = a[1] * Math.PI / 180, lb = b[1] * Math.PI / 180;
  const h = Math.sin(dLat/2)**2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

// ---- Tile math (Web Mercator) ----
export function normalizeTileX(x, z) {
  const n = Math.pow(2, z);
  return ((x % n) + n) % n;
}

export function lonLatToTile(lon, lat, z) {
  const n = Math.pow(2, z);
  const x = Math.floor((lon + 180) / 360 * n);
  const latRad = lat * Math.PI / 180;
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
  return {x, y};
}

export function tileLatCenter(y, z) {
  const n = Math.pow(2, z);
  const northRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n)));
  const southRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 1) / n)));
  return (northRad + southRad) * 90 / Math.PI;
}

export function tileToLngLatBounds(x, y, z) {
  const n = Math.pow(2, z);
  const west = x / n * 360 - 180;
  const east = (x + 1) / n * 360 - 180;
  const northRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n)));
  const southRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 1) / n)));
  return {
    west,
    east,
    north: northRad * 180 / Math.PI,
    south: southRad * 180 / Math.PI
  };
}

export function mercatorVertsForTile(z, x, y, wrap) {
  const n = Math.pow(2, z);
  const x0 = x / n + wrap;
  const x1 = (x + 1) / n + wrap;
  const y0 = y / n;
  const y1 = (y + 1) / n;
  return new Float32Array([
    x0, y0, 0, 0,
    x0, y1, 0, 1,
    x1, y0, 1, 0,
    x1, y1, 1, 1
  ]);
}

// ---- Terrarium codec ----
export function decodeTerrarium(r, g, b) {
  return (r * 256.0 + g + b / 256.0) - 32768.0;
}

export function encodeTerrarium(elevation, out, byteIndex) {
  const v = elevation + 32768.0;
  let r = Math.floor(v / 256.0);
  let g = Math.floor(v - r * 256.0);
  let b = Math.round((v - r * 256.0 - g) * 256.0);

  r = Math.max(0, Math.min(255, r));
  g = Math.max(0, Math.min(255, g));
  b = Math.max(0, Math.min(255, b));

  out[byteIndex] = r;
  out[byteIndex + 1] = g;
  out[byteIndex + 2] = b;
  out[byteIndex + 3] = 255;
}

// ---- Color utilities ----
const colorCanvas = document.createElement('canvas');
colorCanvas.width = 1;
colorCanvas.height = 1;
const colorCtx = colorCanvas.getContext('2d', {willReadFrequently: true});

export function cssColorToRgb01(color) {
  colorCtx.clearRect(0, 0, 1, 1);
  colorCtx.fillStyle = '#000000';
  colorCtx.fillStyle = color;
  colorCtx.fillRect(0, 0, 1, 1);
  const pixel = colorCtx.getImageData(0, 0, 1, 1).data;
  return [pixel[0] / 255, pixel[1] / 255, pixel[2] / 255];
}

// ---- File download ----
export function downloadFile(name, content, mime) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: mime }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---- Boolean param parsing ----
export function parseBooleanParam(value) {
  if (value == null || value === '') return null;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return null;
}
