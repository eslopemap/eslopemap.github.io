# Tauri Desktop Architecture — Slope

## 1. Executive Summary

Wrap the existing zero-build web app in a **Tauri v2** shell, adding native capabilities (filesystem sync, tile caching, offline maps) via Rust backends exposed through Tauri's IPC. The web codebase remains the single source of truth — no fork, no bundler — with a thin adapter layer that detects the runtime environment and routes calls to either browser APIs or Tauri commands.

---

## 2. Constraints

| Constraint | Implication |
|---|---|
| Web version stays fully static / GitHub Pages | No build step introduced. No bundler. CDN dependencies stay as-is for web. |
| Zero-build vanilla ES modules | Tauri must serve the same `index.html` + JS modules. No Vite/webpack wrapping of the frontend. |
| Forked MapLibre GL JS (`@eslopemap/maplibre-gl`) | Must ship with Tauri or load from CDN. See §4.1. |
| localStorage-only persistence today | Desktop version upgrades to filesystem-backed persistence. |

---

## 3. High-Level Architecture

```
┌──────────────────────────────────────────────────┐
│                  Tauri v2 Shell                   │
│  ┌────────────────────────────────────────────┐  │
│  │            WebView (WKWebView/WebView2)     │  │
│  │  ┌──────────────────────────────────────┐  │  │
│  │  │   Existing web app (index.html)      │  │  │
│  │  │   + js/tauri-bridge.js (adapter)     │  │  │
│  │  └──────────────────────────────────────┘  │  │
│  └─────────────┬──────────────────────────────┘  │
│                │ Tauri IPC (invoke / events)      │
│  ┌─────────────▼──────────────────────────────┐  │
│  │           Rust Backend                      │  │
│  │  ┌────────────┐ ┌────────────┐             │  │
│  │  │ GPX Sync   │ │ Tile Cache │             │  │
│  │  │ Module     │ │ (SQLite)   │             │  │
│  │  └────────────┘ └────────────┘             │  │
│  │  ┌────────────┐ ┌────────────┐             │  │
│  │  │ Tile Server│ │ Settings   │             │  │
│  │  │ (PMTiles/  │ │ Store      │             │  │
│  │  │  MBTiles)  │ │            │             │  │
│  │  └────────────┘ └────────────┘             │  │
│  └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

---

## 4. Compatibility Analysis

### 4.1 CDN Dependencies in Tauri WebView

| Dependency | Issue | Resolution |
|---|---|---|
| `@eslopemap/maplibre-gl` (unpkg) | Works if online. Offline = broken. | **Bundle locally.** Copy dist files into `src-tauri/frontend-assets/` or a `vendor/` folder. Tauri serves them via its asset protocol. Web version keeps CDN. |
| `maplibre-contour` (unpkg) | Same | Same approach: local copy for Tauri, CDN for web. |
| `chart.js`, `chartjs-plugin-annotation` (jsdelivr) | Same | Same. |
| `@we-gold/gpxjs` (jsdelivr, import map) | Import maps work in WebView2 (Windows) and modern WKWebView (macOS 14+). **Older macOS may fail.** | Vendor locally. Override import map in Tauri build. |

> **DECISION POINT 1: Vendoring strategy**
>
> **Option A — Vendor all deps into a `vendor/` dir, switch import paths via a `<script>` that rewrites the import map when Tauri is detected.** Simple, no build tool. ✅ Recommended.
>
> **Option B — Introduce a lightweight bundler (esbuild) for the Tauri build only.** More maintainable long-term but adds a build step for desktop.
>
> **Option C — Use Tauri's asset protocol to proxy CDN URLs.** Fragile, not recommended.

### 4.2 WebView API Compatibility

| API | macOS (WKWebView) | Windows (WebView2) | Linux (WebKitGTK) | Notes |
|---|---|---|---|---|
| ES Modules | ✅ | ✅ | ✅ | |
| Import Maps | ✅ (Safari 16.4+/macOS 13+) | ✅ | ⚠️ WebKitGTK 2.44+ | Vendor fallback needed for older Linux |
| WebGL 2 | ✅ | ✅ | ⚠️ Driver-dependent | MapLibre needs WebGL. Linux may need SW fallback. |
| File System Access API | ❌ WKWebView | ✅ WebView2 | ❌ | Replaced by Tauri FS commands — not an issue |
| `localStorage` | ✅ (persistent in Tauri) | ✅ | ✅ | Keep as fallback; primary storage moves to Rust |
| Drag-and-drop | ✅ | ✅ | ✅ | Tauri has its own DnD plugin too |
| `navigator.geolocation` | ⚠️ Requires entitlement | ✅ | ⚠️ | Use Tauri geolocation plugin |

### 4.3 MapLibre-Specific Concerns

- **WebGL context creation**: WKWebView on macOS generally works. Linux (WebKitGTK) is the weakest link — users may need recent Mesa drivers.
- **Terrain analysis layer** (custom fork): No Rust-side concern; it's pure GPU. Will work if WebGL works.
- **`raster-dem` tile fetching**: In offline mode, tiles must be intercepted. See §6.

---

## 5. GPX Folder Sync (Two-Way)

### 5.1 Concept

User picks a local folder (e.g., `~/GPX/`). The app watches it for changes and syncs bidirectionally with the in-app track model.

### 5.2 Architecture

```
Filesystem (~/GPX/)           Rust Watcher            WebView state
  track-a.gpx       ──notify──▸ FsWatcher ──IPC──▸  createTrack()
  track-b.gpx       ◂──write── save_gpx() ◂──IPC──  exportTrack()
```

**Rust side** (`src-tauri/src/gpx_sync.rs`):
- Uses `notify` crate (cross-platform filesystem watcher).
- On file change: read file, hash it (SHA-256), compare with known hash → if different, emit `gpx:file-changed` event to WebView with `{ path, content }`.
- On app-side save: receive `save_gpx` command with `{ path, content }`, write atomically (write to `.tmp` + rename), update hash cache.
- Maintains a `HashMap<PathBuf, FileState>` where `FileState = { hash: [u8; 32], mtime: SystemTime }`.

**WebView side** (`js/tauri-bridge.js`):
- Listens for `gpx:file-changed` events → calls existing `importFileContent()`.
- On track edit save → calls `invoke('save_gpx', { path, content })`.

### 5.3 Conflict Resolution

> **DECISION POINT 2: Conflict strategy**
>
> **Option A — Last-write-wins.** Simple. External edit overwrites in-app state; in-app save overwrites file. Risk: data loss if both change simultaneously.
>
> **Option B — Prompt on conflict.** If both sides changed since last sync, show a dialog: "File changed externally. Keep yours / Load external / Show diff". Safer. ✅ Recommended.
>
> **Option C — Merge at GPX trackpoint level.** Very complex, GPX is not easily mergeable. Not recommended.

### 5.4 Tree ↔ Folder Mapping

The existing workspace tree (`gpx-tree.js`) maps to the folder structure:
- Tree folder nodes → filesystem subdirectories
- Tree file nodes → `.gpx` files
- Track nodes within a file → `<trk>` elements within the GPX

Rename/move in tree → rename/move on filesystem (and vice-versa).

---

## 6. Mapterhorn Elevation Tile Cache

### 6.1 Problem

DEM tiles from `tiles.mapterhorn.com` are fetched repeatedly. On desktop, we can cache them persistently for offline use and performance.

### 6.2 Architecture

**Rust HTTP proxy** intercepts DEM tile requests:

```
WebView                        Rust                              Internet
  MapLibre requests            TileCache                         mapterhorn.com
  /dem/{z}/{x}/{y}.webp  ──▸  check SQLite  ──cache miss──▸    fetch tile
                          ◂──  return cached  ◂──store──────    return .webp
```

**Implementation approach — Tauri custom protocol**:

Register a custom protocol `slope-tiles://` in Tauri:

```rust
// src-tauri/src/tile_cache.rs
tauri::Builder::default()
    .register_asynchronous_uri_scheme_protocol("slope-tiles", |ctx, request, responder| {
        // Parse z/x/y from URL
        // Check SQLite cache
        // If miss: fetch from upstream, store, return
        // If hit: return from cache
    })
```

WebView-side: when running in Tauri, rewrite the DEM source URL:
```js
// js/tauri-bridge.js
const DEM_URL_DESKTOP = 'slope-tiles://dem/{z}/{x}/{y}.webp';
const DEM_URL_WEB     = 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp';
```

**SQLite cache schema** (using `rusqlite`):

```sql
CREATE TABLE tiles (
    source  TEXT NOT NULL,        -- 'mapterhorn', 'osm', etc.
    z       INTEGER NOT NULL,
    x       INTEGER NOT NULL,
    y       INTEGER NOT NULL,
    data    BLOB NOT NULL,
    fetched INTEGER NOT NULL,     -- unix timestamp
    etag    TEXT,
    PRIMARY KEY (source, z, x, y)
);
CREATE INDEX idx_tiles_fetched ON tiles(fetched);
```

### 6.3 Cache Management

- **Max size**: configurable, default 2 GB. LRU eviction by `fetched` timestamp.
- **Staleness**: re-validate after 30 days (DEM tiles rarely change). Use `If-None-Match` with stored `etag`.
- **Pre-fetch**: optional "Download area" feature — user draws a bounding box, app downloads all DEM tiles at zoom 0–14 for that region.
- **Cache location**: `app_data_dir()/tile-cache.sqlite3`.

> **DECISION POINT 3: Cache scope**
>
> **Option A — Cache DEM tiles only.** Simplest. Base map tiles change more often and are larger. ✅ Recommended for v1.
>
> **Option B — Cache all raster tile sources** (OSM, OTM, IGN, etc.). More useful offline but raises attribution/licensing questions with some tile providers.

---

## 7. Offline Maps via MBTiles / PMTiles

### 7.1 Problem

For true offline use, the user needs base map tiles available locally. MBTiles (SQLite-based) and PMTiles (single-file, HTTP-range-request-friendly) are the two dominant formats.

### 7.2 Architecture

> **DECISION POINT 4: Tile serving approach**
>
> **Option A — Rust-side tile server on localhost.** Spawn an HTTP server (e.g., `actix-web` or `axum`) on a random port, serve tiles as `http://127.0.0.1:{port}/{source}/{z}/{x}/{y}.{ext}`. MapLibre points its sources at this URL.
>
> Pros: Clean separation. MapLibre works normally with HTTP URLs. Supports both raster and vector tiles. Easy to add multiple tile sources.
> Cons: Extra port, potential firewall issues on corporate machines.
>
> **Option B — Tauri custom protocol (`mbtiles://`, `pmtiles://`).** No HTTP server needed. Tauri intercepts the custom scheme and serves tile data directly.
>
> Pros: No open port. Simpler deployment. Tighter integration.
> Cons: Custom protocol URLs may confuse MapLibre's internal caching / fetch logic. Need to verify MapLibre handles custom schemes for `raster` and `vector` sources correctly.
>
> ✅ **Recommended: Option B (custom protocol), with Option A as fallback if MapLibre has issues with custom schemes.** Test with a spike early.

### 7.3 Implementation

**Rust modules:**

```rust
// src-tauri/src/offline_tiles.rs

/// MBTiles reader (SQLite)
fn read_mbtile(path: &Path, z: u32, x: u32, y: u32) -> Option<Vec<u8>> {
    // MBTiles uses TMS y-flip: y_tms = (1 << z) - 1 - y
    // SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?
}

/// PMTiles reader (single-file archive)
fn read_pmtile(path: &Path, z: u32, x: u32, y: u32) -> Option<Vec<u8>> {
    // Use `pmtiles` crate — random-access reads from the file
}
```

**Custom protocol registration:**

```rust
.register_asynchronous_uri_scheme_protocol("offline-tiles", |ctx, req, responder| {
    // URL format: offline-tiles://source-name/{z}/{x}/{y}.pbf
    // source-name maps to a configured .mbtiles or .pmtiles file
    // Read tile, set Content-Type (image/png, application/x-protobuf, etc.)
    // Return 200 with data or 404
})
```

**WebView tile source configuration:**

```js
// When offline sources are configured, override map style sources:
map.addSource('offline-osm', {
    type: 'raster', // or 'vector' for PBF
    tiles: ['offline-tiles://osm/{z}/{x}/{y}.png'],
    maxzoom: 14
});
```

### 7.4 Source Management UI

Add a "Tile Sources" panel in settings (desktop-only):
- List configured offline tile sources
- "Add source" → native file picker for `.mbtiles` / `.pmtiles`
- Show metadata (name, format, bounds, zoom range) from the file's metadata table
- Enable/disable per source
- Configuration stored in `app_data_dir()/config.json`

### 7.5 PMTiles vs MBTiles

| | MBTiles | PMTiles |
|---|---|---|
| Format | SQLite database | Single binary file |
| Rust crate | `rusqlite` (mature) | `pmtiles` (newer, works) |
| Concurrent reads | SQLite WAL mode | Direct file I/O (excellent) |
| Widely available | Yes (TileMill, tippecanoe, QGIS) | Growing (Protomaps, tippecanoe) |
| Supports vector + raster | Yes | Yes |

**Support both.** Detect format by file extension or magic bytes.

---

## 8. Dual-Mode Adapter (`js/tauri-bridge.js`)

This is the key file that makes the same web app work in both browser and Tauri:

```js
// js/tauri-bridge.js

/** @returns {boolean} */
export function isTauri() {
    return '__TAURI_INTERNALS__' in window;
}

// --- Tile URL rewriting ---
export function getDemTileUrl() {
    return isTauri()
        ? 'slope-tiles://dem/{z}/{x}/{y}.webp'
        : 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp';
}

// --- GPX I/O ---
export async function saveGpxFile(path, content) {
    if (isTauri()) {
        const { invoke } = window.__TAURI_INTERNALS__;
        return invoke('save_gpx', { path, content });
    }
    // fallback: browser download
    downloadFile(path.split('/').pop(), content, 'application/gpx+xml');
}

export async function pickGpxFolder() {
    if (isTauri()) {
        const { invoke } = window.__TAURI_INTERNALS__;
        return invoke('pick_and_watch_folder');
    }
    // fallback: browser folder picker
    return pickFolderBrowser();
}

// --- Persistence ---
export async function loadState(key) {
    if (isTauri()) {
        const { invoke } = window.__TAURI_INTERNALS__;
        return invoke('load_state', { key });
    }
    return JSON.parse(localStorage.getItem(key));
}

export async function saveState(key, value) {
    if (isTauri()) {
        const { invoke } = window.__TAURI_INTERNALS__;
        return invoke('save_state', { key, value: JSON.stringify(value) });
    }
    localStorage.setItem(key, JSON.stringify(value));
}
```

Existing modules (`io.js`, `persist.js`, `main.js`) import from `tauri-bridge.js` and call the unified API. Browser behavior is unchanged.

---

## 9. Tauri Project Structure

```
slopedothtml/
├── index.html                  # unchanged (web entry point)
├── css/
├── js/
│   ├── tauri-bridge.js         # NEW: runtime adapter
│   └── ... (existing modules)
├── vendor/                     # NEW: vendored CDN deps for offline desktop
│   ├── maplibre-gl.js
│   ├── maplibre-gl.css
│   ├── maplibre-contour.min.js
│   ├── chart.umd.min.js
│   ├── chartjs-plugin-annotation.min.js
│   └── gpxjs/
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── capabilities/
│   │   └── default.json        # permissions for fs, dialog, etc.
│   ├── src/
│   │   ├── main.rs             # Tauri entry point
│   │   ├── gpx_sync.rs         # GPX folder watcher + 2-way sync
│   │   ├── tile_cache.rs       # DEM tile cache (SQLite)
│   │   ├── offline_tiles.rs    # MBTiles/PMTiles reader
│   │   └── state_store.rs      # Persistent app state (replaces localStorage)
│   └── icons/
├── tests/
├── package.json
└── CNAME
```

### 9.1 `tauri.conf.json` Key Settings

```jsonc
{
  "productName": "Slope",
  "identifier": "com.slope.app",
  "build": {
    "frontendDist": "../",      // serve from project root — same files as web
    "devUrl": "http://localhost:8089"  // dev mode uses existing python server
  },
  "app": {
    "withGlobalTauri": true,    // exposes __TAURI_INTERNALS__ on window
    "windows": [{
      "title": "Slope",
      "width": 1400,
      "height": 900,
      "minWidth": 800,
      "minHeight": 600
    }]
  },
  "bundle": {
    "active": true,
    "targets": ["dmg", "msi", "appimage"],
    "icon": ["icons/icon.png"]
  }
}
```

### 9.2 Rust Dependencies (`Cargo.toml`)

```toml
[dependencies]
tauri = { version = "2", features = ["protocol-asset"] }
tauri-plugin-dialog = "2"       # native file/folder pickers
tauri-plugin-fs = "2"           # filesystem access
tauri-plugin-shell = "2"        # open URLs in browser
serde = { version = "1", features = ["derive"] }
serde_json = "1"
rusqlite = { version = "0.32", features = ["bundled"] }
notify = "7"                    # filesystem watcher
reqwest = { version = "0.12", features = ["rustls-tls"] }
tokio = { version = "1", features = ["full"] }
sha2 = "0.10"                  # for file change detection
pmtiles = "0.12"               # PMTiles reader
```

---

## 10. Desktop-Only `index.html` Loader

To avoid modifying `index.html` (keeping it web-pure), use a thin **desktop entry point**:

```
src-tauri/
  desktop-loader.html
```

This file:
1. Rewrites `<script>` CDN URLs to `vendor/` local paths
2. Adjusts the import map
3. Inserts `<script type="module" src="/js/tauri-bridge.js">`
4. Includes the original `index.html` content via an `<iframe>` or inlines it

> **DECISION POINT 5: Desktop entry point strategy**
>
> **Option A — Use the same `index.html`, detect Tauri at runtime, dynamically rewrite script sources.** Zero duplication. Risk: first load fetches CDN then switches. ✅ Recommended if CDN fallback is acceptable.
>
> **Option B — Separate `desktop.html` that vendors all scripts.** Clean separation but duplication to maintain.
>
> **Option C — Build-time template** (`index.html.tmpl` → generates both `index.html` and `desktop.html`). Most maintainable long-term but adds tooling.

**Recommended approach for v1 (Option A implementation):**

```js
// At the top of js/main.js (or a new js/boot.js loaded first)
if ('__TAURI_INTERNALS__' in window) {
    // Tauri detected — all deps already loaded from vendor/ via tauri.conf.json
    // No CDN rewriting needed if frontendDist includes vendor/
}
```

Actually simpler: Tauri's `frontendDist` serves from project root. Add a `vendor/` dir with local copies. In `index.html`, add a small inline script before all other `<script>` tags:

```html
<script>
  // Detect Tauri and rewrite CDN URLs to local vendor copies
  if ('__TAURI_INTERNALS__' in window) {
      document.addEventListener('DOMContentLoaded', () => {
          // Scripts already loaded by this point — this approach won't work for <script> tags
      });
  }
</script>
```

Better: use `<script>` tags that check both:

```html
<script>
    window.__SLOPE_VENDOR_PREFIX__ = '__TAURI_INTERNALS__' in window ? '/vendor' : '';
</script>
<!-- Then in module scripts: -->
<script>
    const p = window.__SLOPE_VENDOR_PREFIX__;
    if (p) {
        // Dynamically load from vendor
        const s = document.createElement('script');
        s.src = `${p}/maplibre-gl.js`;
        document.head.appendChild(s);
    }
</script>
```

This gets awkward. **Simplest actual solution**: keep CDN `<script>` tags as-is. They work when online (even in Tauri). For offline Tauri use, register a Tauri protocol handler that intercepts CDN domains and serves from local vendor copies:

```rust
// Intercept requests to CDN domains, serve from vendor/
.register_asynchronous_uri_scheme_protocol("https", |ctx, req, responder| {
    let url = req.uri();
    if url.host() == "unpkg.com" || url.host() == "cdn.jsdelivr.net" {
        // Serve from app bundle's vendor/ directory
    } else {
        // Pass through to network
    }
})
```

> **Final recommendation for DECISION POINT 5**: Use Tauri's **custom protocol** approach to transparently intercept CDN requests and serve vendored copies. Zero changes to `index.html`. The web version is completely unaffected.

---

## 11. Development Workflow

```
# Web development (unchanged)
python3 -m http.server 8089
# open browser to localhost:8089

# Desktop development
cd src-tauri
cargo tauri dev
# Tauri opens WebView pointing at devUrl (localhost:8089)
# Rust changes hot-reload, frontend changes reload via devUrl

# Desktop build
cargo tauri build
# Produces .dmg (macOS), .msi (Windows), .AppImage (Linux)
```

---

## 12. Migration Path / Phased Plan

### Phase 1: Scaffold + Prove Feasibility
1. `cargo tauri init` in the project root
2. Configure `tauri.conf.json` with `frontendDist: "../"`
3. Verify the existing app loads correctly in the Tauri WebView
4. Identify and fix any WebView compatibility issues (import maps, WebGL)
5. Vendor CDN deps into `vendor/`, implement CDN interception protocol
6. **Deliverable**: app runs identically in Tauri and browser

### Phase 2: DEM Tile Cache
1. Implement `tile_cache.rs` with SQLite cache
2. Register `slope-tiles://` custom protocol
3. Add `tauri-bridge.js` with `isTauri()` detection and DEM URL rewriting
4. Modify `main.js` and `dem.js` to use bridge for tile URLs
5. Add cache stats/clear UI in settings panel (desktop-only section)
6. **Deliverable**: DEM tiles cached locally, app works offline for visited areas

### Phase 3: GPX Folder Sync
1. Implement `gpx_sync.rs` with `notify` watcher
2. Add Tauri commands: `pick_and_watch_folder`, `save_gpx`, `list_folder_gpx`
3. Wire `tauri-bridge.js` ↔ `io.js` for bidirectional sync
4. Implement conflict detection dialog
5. Map tree structure to folder structure
6. **Deliverable**: GPX files sync between filesystem and app

### Phase 4: Offline Map Tiles (MBTiles/PMTiles)
1. Implement `offline_tiles.rs` (both MBTiles + PMTiles readers)
2. Register `offline-tiles://` custom protocol
3. Add "Tile Sources" management UI
4. Implement source switching logic in `main.js`
5. **Deliverable**: fully offline-capable mapping with user-provided tile archives

### Phase 5: Polish + Distribution
1. App icons, native menus (File→Open GPX, etc.)
2. Auto-updater (Tauri's built-in updater)
3. Keyboard shortcuts mapped to native menu accelerators
4. CI/CD for multi-platform builds (GitHub Actions with `tauri-action`)
5. Code signing (macOS notarization, Windows signing)
6. **Deliverable**: distributable desktop app

---

## 13. Decision Summary

| # | Decision | Recommended | Alternatives |
|---|---|---|---|
| 1 | Vendoring CDN deps | **Custom protocol interception** (transparent, zero HTML changes) | Vendor dir + script rewriting; esbuild for desktop |
| 2 | GPX conflict resolution | **Prompt on conflict** (safe, reasonable UX) | Last-write-wins; GPX-level merge |
| 3 | Tile cache scope | **DEM only (v1)**, expand to base maps later | Cache all sources from day 1 |
| 4 | Offline tile serving | **Custom protocol (`offline-tiles://`)**, fall back to localhost HTTP if MapLibre has issues | localhost `axum` server |
| 5 | Desktop entry point | **Same `index.html`** + protocol-level CDN interception | Separate `desktop.html`; build-time template |

---

## 14. Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| MapLibre doesn't work with custom protocol URLs for tile sources | High — blocks offline tiles | Spike test in Phase 1. Fallback: localhost HTTP tile server. |
| WKWebView import map support on older macOS | Medium — breaks module loading | Vendor `@we-gold/gpxjs` as a regular ES module file, bypass import map. |
| WebGL fails in Linux WebKitGTK | Medium — no map rendering | Document minimum driver requirements. Consider Electron as Linux-only fallback (not recommended). |
| Large MBTiles files (>10GB) slow to read | Low — perf issue only | Use WAL mode, mmap, prepared statements. PMTiles has better random access. |
| `notify` crate misses events on some filesystems (NFS, FUSE) | Low | Periodic polling fallback (every 5s) as complement to fs events. |
| Tauri v2 breaking changes during development | Medium | Pin exact Tauri version in `Cargo.toml`. |

---

## 15. What Changes in Existing Code

| File | Change | Impact on Web |
|---|---|---|
| `js/main.js` | Import `tauri-bridge.js`, use bridge for DEM URL | None — bridge returns CDN URL when not in Tauri |
| `js/dem.js` | Accept DEM URL from bridge instead of hardcoding | None |
| `js/io.js` | Use bridge for save/load when in Tauri | None — bridge falls back to existing browser APIs |
| `js/persist.js` | Optionally delegate to bridge for state storage | None — bridge falls back to localStorage |
| `js/constants.js` | Possibly move DEM URL here if not already | Neutral |
| `index.html` | **No changes** | ✅ Fully preserved |
| `css/main.css` | Minor: hide/show desktop-only UI sections | `.tauri-only { display: none }` by default, shown via JS |

**Total web-side changes: minimal.** The bridge pattern ensures all modifications are additive and gated behind `isTauri()`.
