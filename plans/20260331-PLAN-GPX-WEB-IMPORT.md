# GPX Web Import Plan

## Premise

Users can paste a URL from supported outdoor sites (or a direct GPX link) into the app, and the GPX track is loaded and displayed automatically.

## Supported Sources — Feasibility Summary

### 1. skitour.fr — FULLY SUPPORTED

- **URL pattern**: `https://skitour.fr/sorties/{id}`
- **GPX endpoint**: `https://skitour.fr/downloadGPX/sorties/{id}`
- **CORS**: `Access-Control-Allow-Origin: *` — works from browser
- **Format**: Standard GPX 1.1 XML
- **Implementation**: Extract `{id}` from URL regex, fetch GPX directly

### 2. camptocamp.org — SUPPORTED (full GPX generation)

- **URL pattern**: `https://www.camptocamp.org/outings/{id}/...`
- **API endpoint**: `https://api.camptocamp.org/outings/{id}`
- **CORS**: `Access-Control-Allow-Origin: *` — works from browser
- **No server-side GPX endpoint** — the c2c website generates GPX **client-side** using OpenLayers' GPX writer from the API's GeoJSON data (confirmed via rodney browser automation: clicking the "GPX" button creates a `Blob` with `application/gpx+xml` from the already-loaded geometry).
- **Format**: JSON with `geometry.geom_detail` containing a stringified GeoJSON LineString in **EPSG:3857** (Web Mercator), with 4D coordinates `[x, y, ele, unix_timestamp]`
  - Example: `[816067.602277, 5485013.83074, 2107.4, 1769926173.0]` → lon/lat + 2107m + 2026-02-01T07:09:33Z
  - 1000 trackpoints for a typical outing
  - Title in `locales[0].title`
- **Implementation**:
  1. Extract `{id}` from URL regex
  2. Fetch JSON from `api.camptocamp.org/outings/{id}`
  3. Parse `geom_detail` (stringified GeoJSON)
  4. **Reproject EPSG:3857 → EPSG:4326** (lon/lat) — 5 lines of inverse Mercator math, no library needed
  5. **Generate proper GPX XML** with `<trkpt lat="" lon=""><ele/><time/></trkpt>` from the 4D coordinates (elevation + timestamps are available)
  6. Parse the generated GPX with existing GPX parser, or feed coords directly to track model

### 3. gulliver.it — PARTIALLY SUPPORTED

- **URL pattern**: `https://www.gulliver.it/itinerari/{slug}/`
- **GPX file**: Embedded in page HTML as `<a href=".../*.gpx">` — URL is **NOT predictable** from slug (contains date path and hash suffix)
- **Page CORS**: **NONE** — cannot fetch the HTML page from browser
- **GPX file CORS**: `Access-Control-Allow-Origin: *` — the GPX file itself is fetchable
- **WP REST API**: Itinerari are not exposed (custom post type or plugin, not in standard `/wp-json/wp/v2/posts`)

**Decision Point**: Gulliver page URLs cannot be resolved to GPX URLs from the browser due to CORS.
**Options**:
- A) Skip gulliver entirely — simplest
- B) Support only direct gulliver GPX URLs (`*.gulliver.it/*.gpx`)
- C) Add a CORS proxy (adds dependency, privacy concern)
- **Recommendation**: Option B — detect `gulliver.it` URLs, if URL ends in `.gpx` fetch directly, otherwise show error message "Paste the direct GPX download link from Gulliver (right-click the GPX button)"

### 4. Direct GPX URLs — BEST EFFORT

- Any URL ending in `.gpx` (or with `content-type: application/gpx+xml`)
- Fetch and parse — will work if the server sends CORS headers
- If CORS blocked, show clear error message

## Architecture

### URL Input UI

Add a button for 'import gpx from URL (should also work with Ctr+V if clipboard starts with either `http[s]://` or `<?xml version="1.0" ?><gpx ...>`)

The button should be left of existing 'open file'.

### URL Router (`js/web-import.js`)

```js
const URL_HANDLERS = [
  {
    name: 'skitour',
    match: /skitour\.fr\/sorties\/(\d+)/,
    resolve: (m) => `https://skitour.fr/downloadGPX/sorties/${m[1]}`,
    format: 'gpx'
  },
  {
    name: 'camptocamp',
    match: /camptocamp\.org\/outings\/(\d+)/,
    resolve: (m) => `https://api.camptocamp.org/outings/${m[1]}`,
    format: 'c2c-json'
  },
  {
    name: 'gulliver-gpx',
    match: /gulliver\.it\/.*\.gpx$/i,
    resolve: (m) => m[0].startsWith('http') ? m[0] : `https://${m[0]}`,
    format: 'gpx'
  },
  {
    name: 'gulliver-page',
    match: /gulliver\.it\/itinerari\//,
    resolve: () => null,  // cannot resolve
    format: null,
    error: 'Gulliver page URLs are not supported due to CORS. Paste the direct GPX download link instead (right-click → Copy link on the GPX button).'
  },
  {
    name: 'direct-gpx',
    match: /\.gpx(\?.*)?$/i,
    resolve: (m) => m.input,
    format: 'gpx'
  }
];
```

### Fetch + Parse Logic

```js
async function importFromUrl(url) {
  for (const handler of URL_HANDLERS) {
    const m = url.match(handler.match);
    if (!m) continue;
    if (handler.error) throw new Error(handler.error);
    const fetchUrl = handler.resolve(m);
    
    const resp = await fetch(fetchUrl);
    if (!resp.ok) throw new Error(`HTTP ${resp.status} from ${handler.name}`);
    
    if (handler.format === 'gpx') {
      const text = await resp.text();
      return parseGpx(text);  // existing GPX parser
    }
    if (handler.format === 'c2c-json') {
      const data = await resp.json();
      const gpxText = convertC2cToGpx(data);  // generate full GPX with ele+time
      return parseGpx(gpxText);
    }
  }
  // Fallback: try as raw GPX
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const text = await resp.text();
  return parseGpx(text);
}
```

### C2C → Full GPX Generation (EPSG:3857 → GPX XML)

The c2c API returns GeoJSON in EPSG:3857 with 4D coordinates `[x, y, ele, unix_timestamp]`.
We generate a proper GPX file client-side (same approach c2c's own frontend uses with OpenLayers):

```js
function mercatorToLonLat(x, y) {
  const lon = (x / 20037508.342789244) * 180;
  let lat = (y / 20037508.342789244) * 180;
  lat = (180 / Math.PI) * (2 * Math.atan(Math.exp(lat * Math.PI / 180)) - Math.PI / 2);
  return [lon, lat];
}

function convertC2cToGpx(data) {
  const geom = JSON.parse(data.geometry.geom_detail);
  const title = data.locales?.[0]?.title || 'C2C outing';
  
  const trkpts = geom.coordinates.map(([x, y, ele, ts]) => {
    const [lon, lat] = mercatorToLonLat(x, y);
    const time = new Date(ts * 1000).toISOString();
    return `      <trkpt lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}"><ele>${ele.toFixed(1)}</ele><time>${time}</time></trkpt>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="slope.html (c2c import)"
     xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${escapeXml(title)}</name></metadata>
  <trk>
    <name>${escapeXml(title)}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;
}

function escapeXml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
```

This produces a standard GPX 1.1 file with elevation and timestamps, which can then be parsed by the existing GPX parser.

### Error Handling

- **CORS blocked**: `fetch()` will throw a `TypeError`. Catch and display: "Cannot load: the server doesn't allow cross-origin requests. Try downloading the file and importing it manually."
- **404 / invalid ID**: Display HTTP status with source name
- **Invalid GPX**: Display parse error
- **No matching handler**: Try as raw GPX fetch, then show "Unsupported URL format"

All errors displayed in a `#importUrlStatus` span next to the button.

## Decision Points Summary

| # | Question | Recommendation |
|---|----------|---------------|
| 1 | Gulliver support level | Option B: Direct GPX URLs only, show guidance for page URLs |
| 2 | Where to put import UI | Sidebar section above track list, or toolbar button opening modal |
| 3 | C2C coordinate handling | Client-side EPSG:3857→4326 conversion (5 lines of math, no library) |
| 4 | Track naming | Use source title (c2c: `locales[0].title`, skitour: GPX `<name>`, gulliver: filename) |
| 5 | Multiple tracks in GPX | Same behavior as file import — load all tracks found |
| 6 | Adding more sites later | The `URL_HANDLERS` table pattern makes it trivial to add new sources |

## CORS Test Results

| Source | Endpoint | CORS | Status |
|--------|----------|------|--------|
| skitour.fr | `/downloadGPX/sorties/{id}` | `*` | OK |
| camptocamp.org | `api.camptocamp.org/outings/{id}` | `*` | OK |
| gulliver.it | Page HTML | None | BLOCKED |
| gulliver.it | `.gpx` file | `*` | OK (if URL known) |
