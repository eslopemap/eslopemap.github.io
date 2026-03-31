# Tauri Desktop Architecture — Slope

## 1. Executive Summary

Wrap the existing zero-build web app in a **Tauri v2** shell, adding native capabilities (filesystem sync, tile caching, offline maps) via Rust backends exposed through Tauri's IPC. The web codebase remains the single source of truth — no fork, no bundler — with third-party frontend dependencies vendored into the repository and referenced via explicit local paths in **both** browser and Tauri. A thin adapter layer detects the runtime environment and routes calls to either browser APIs or stable public Tauri APIs.

---

## 2. Constraints

| Constraint | Implication |
|---|---|
| Web version stays fully static / GitHub Pages | No build step introduced. No bundler. Third-party JS/CSS must be shippable as static vendored assets. |
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

### 4.1 Third-Party Dependency Strategy

| Dependency | Issue | Resolution |
|---|---|---|
| `@eslopemap/maplibre-gl` | Browser and desktop must behave identically offline. | Vendor into `vendor/maplibre-gl/` and reference with explicit relative paths in `index.html` / JS. |
| `maplibre-contour` | Same | Vendor into `vendor/maplibre-contour/` and import explicitly. |
| `chart.js`, `chartjs-plugin-annotation` | Same | Vendor into `vendor/chart.js/` and `vendor/chartjs-plugin-annotation/`. |
| `@we-gold/gpxjs` | Import-map support varies across WebViews. | Vendor the ESM files and import by explicit path. Do not rely on import maps in the core runtime path. |

> **DECISION POINT 1: Vendoring strategy**
>
> **Option A — Vendor all frontend deps into a `vendor/` dir and reference them via explicit local paths in both web and desktop.** Deterministic, offline-friendly, and keeps both runtimes aligned. ✅ Recommended.
> **Option B — Keep the web app on local paths, but rewrite paths or import maps only for desktop.** Avoids a bundler, but creates two runtime behaviors.
> **Option C — Introduce a lightweight bundler (esbuild) for Tauri only.** Potentially maintainable later, but adds a build path we do not currently want.

**Recommendation**:

Commit vendored frontend dependencies to `vendor/` and update `index.html` and JS modules to use explicit local URLs in both runtimes. This removes CDN fragility, removes the need for import-map rewriting, and makes the browser and desktop asset graph identical.

```html
<link rel="stylesheet" href="./vendor/maplibre-gl/maplibre-gl.css" />
<script type="module" src="./js/main.js"></script>
```

> **Recommendation**: Use the same vendored asset paths in web and desktop. This is slightly less pure than zero-touch HTML preservation, but it is simpler, deterministic, offline-ready, and much easier to test.


### 4.2 WebView API Compatibility

| API | macOS (WKWebView) | Windows (WebView2) | Linux (WebKitGTK) | Notes |
|---|---|---|---|---|
| ES Modules | ✅ | ✅ | ✅ | |
| Import Maps | ✅ (Safari 16.4+/macOS 13+) | ✅ | ⚠️ WebKitGTK 2.44+ | No longer required in the core path if all dependencies use explicit local imports |
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

User picks a local folder (e.g., `~/GPX/`). The app watches it for changes and syncs bidirectionally with the in-app model. **In v1, the sync unit is the whole GPX file.**

### 5.2 Architecture

```
Filesystem (~/GPX/)           Rust Watcher            WebView state
  track-a.gpx       ──notify──▸ FsWatcher ──IPC──▸  createTrack()
  track-b.gpx       ◂──write── save_gpx() ◂──IPC──  exportTrack()
```

**Rust side** (`src-tauri/src/gpx_sync.rs`):
- Uses `notify` crate (cross-platform filesystem watcher).
- On file change: read file, hash it (SHA-256), compare with known hash → if different, emit `gpx:file-changed` event to WebView with `{ path, content }`.
- On app-side save: receive `save_gpx` command with `{ path, content }`, write atomically (write to `.tmp` + rename), update hash cache, and suppress watcher echo where possible.
- Maintains a `HashMap<PathBuf, FileState>` where `FileState = { hash: [u8; 32], mtime: SystemTime, dirty_in_app: bool }`.
- Treats a GPX file as the durable identity in v1; it does not attempt per-`<trk>` merge semantics.

**WebView side** (`js/tauri-bridge.js`):
- Listens for `gpx:file-changed` events → calls existing `importFileContent()`.
- On save → serializes the full owning GPX file and calls `save_gpx(path, content)`.
- Tracks a simple per-file dirty flag to support conflict prompts.

### 5.3 Conflict Resolution

> **DECISION POINT 2: Conflict strategy**
>
> **Option A — Last-write-wins.** Simple. External edit overwrites in-app state; in-app save overwrites file. Risk: data loss if both change simultaneously.
>
> **Option B — Prompt on conflict.** If both sides changed since last sync, show a dialog: "File changed externally. Keep yours / Load external / Show diff". Safer. ✅ Recommended.
> **Option C — Merge at GPX trackpoint level.** Very complex, GPX is not easily mergeable. Not recommended.

In v1, a conflict is detected at the **file** level: the file changed on disk since last import and the same file is dirty in-app. This is intentionally narrower than track-level merge logic.

### 5.4 V1 Scope and Tree Mapping

The existing workspace tree (`gpx-tree.js`) maps to the folder structure:
- Tree folder nodes → filesystem subdirectories
- Tree file nodes → `.gpx` files
- Track nodes within a file → derived UI structure read from the file contents, but **not** independent sync identities

V1 operations:
- Rename/move folder nodes → rename/move on filesystem
- Rename/move file nodes → rename/move `.gpx` files on filesystem
- Editing a track inside a file → rewrite the owning GPX file atomically
- Track-level rename/move as standalone sync operations → deferred until after the file-centric model is proven

---

## 6. Mapterhorn Elevation Tile Cache

### 6.1 Problem

DEM tiles from `tiles.mapterhorn.com` are fetched repeatedly. On desktop, we can cache them persistently for offline use and performance.

### 6.2 Architecture

**Rust localhost tile service** serves DEM tile requests and cache hits over loopback HTTP:

```
WebView                        Rust                              Internet
  MapLibre requests            TileCache + axum                  mapterhorn.com
  /dem/{z}/{x}/{y}.webp  ──▸  check SQLite  ──cache miss──▸    fetch tile
                          ◂──  return cached  ◂──store──────    return .webp
```

**Implementation approach — loopback HTTP + official localhost support**:

Spawn a localhost-only HTTP server (e.g., `axum`) and enable production localhost access through Tauri's official `tauri-plugin-localhost` plugin:

```rust
// src-tauri/src/tile_cache.rs
tauri::Builder::default()
    .plugin(tauri_plugin_localhost::Builder::new(14321).build())
    .setup(|app| {
        // Spawn axum bound to 127.0.0.1:14321
        // Expose base URL to the app-owned desktop bootstrap config
        Ok(())
    })
```

WebView-side: when running in Tauri, rewrite the DEM source URL:

```js
// js/tauri-bridge.js
const DEM_URL_DESKTOP = `${getDesktopTileBaseUrl()}/dem/{z}/{x}/{y}.webp`;
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
> **Option A — Cache DEM tiles only.** Simplest. Base map tiles change more often and are larger.
>
> **Option B — Cache all raster tile sources** (OSM, OTM, IGN, etc.). More useful offline but raises attribution/licensing questions with some tile providers. ✅ Recommended.

Recommendation: Option B

---

## 7. Offline Maps via MBTiles / PMTiles

### 7.1 Problem

For true offline use, the user needs base map tiles available locally. MBTiles (SQLite-based) and PMTiles (single-file, HTTP-range-request-friendly) are the two dominant formats.

### 7.2 Architecture

> **DECISION POINT 4: Tile serving approach**
>
> **Option A — Rust-side tile server on localhost.** Spawn an HTTP server (e.g., `actix-web` or `axum`) on a random port, serve tiles as `http://127.0.0.1:{port}/{source}/{z}/{x}/{y}.{ext}`. MapLibre points its sources at this URL.
>
> Pros: Clean separation. MapLibre works normally with HTTP URLs. Supports both raster and vector tiles. Easy to add multiple tile sources. Tauri v2 now has an official `localhost` plugin, which makes this a supported production pattern rather than a workaround. ✅ Recommended.
> Cons: Extra port, potential firewall issues on some locked-down machines.
>
> **Option B — Tauri custom protocol (`mbtiles://`, `pmtiles://`).** No HTTP server needed. Tauri intercepts the custom scheme and serves tile data directly.
>
> Pros: No open port. Simpler deployment. Tighter integration.
> Cons: Custom protocol URLs may confuse MapLibre's internal caching / fetch logic. Need to verify MapLibre handles custom schemes for `raster` and `vector` sources correctly.
>
> **Secondary path only**: evaluate custom protocol in Spike 1 after the localhost path is working end-to-end.

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

**Localhost tile service:**

```rust
// Bind an axum server to 127.0.0.1:{port}
// Route format: /tiles/:source/:z/:x/:y.:ext
// source maps to a configured .mbtiles or .pmtiles file
// Read tile, set Content-Type (image/png, application/x-protobuf, etc.)
// Return 200 with data or 404
```

**WebView tile source configuration:**

```js
// When offline sources are configured, override map style sources:
map.addSource('offline-osm', {
    type: 'raster', // or 'vector' for PBF
    tiles: [`${getDesktopTileBaseUrl()}/tiles/osm/{z}/{x}/{y}.png`],
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

const runtime = globalThis.__SLOPE_RUNTIME__ ?? 'web';
const desktopConfig = globalThis.__SLOPE_DESKTOP_CONFIG__ ?? null;

/** @returns {boolean} */
export function isTauri() {
    return runtime === 'tauri';
}

async function tauriCore() {
    if (!isTauri()) return null;
    return import('../vendor/tauri-api/core.js');
}

async function tauriEvent() {
    if (!isTauri()) return null;
    return import('../vendor/tauri-api/event.js');
}

// --- Tile URL rewriting ---
export function getDesktopTileBaseUrl() {
    return desktopConfig?.tileBaseUrl ?? '';
}

export function getDemTileUrl() {
    return isTauri()
        ? `${getDesktopTileBaseUrl()}/dem/{z}/{x}/{y}.webp`
        : 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp';
}

// --- GPX I/O ---
export async function saveGpxFile(path, content) {
    if (isTauri()) {
        const { invoke } = await tauriCore();
        return invoke('save_gpx', { path, content });
    }
    // fallback: browser download
    downloadFile(path.split('/').pop(), content, 'application/gpx+xml');
}

export async function pickGpxFolder() {
    if (isTauri()) {
        const { invoke } = await tauriCore();
        return invoke('pick_and_watch_folder');
    }
    // fallback: browser folder picker
    return pickFolderBrowser();
}

// --- Persistence ---
export async function loadState(key) {
    if (isTauri()) {
        const { invoke } = await tauriCore();
        return invoke('load_state', { key });
    }
    return JSON.parse(localStorage.getItem(key));
}

export async function saveState(key, value) {
    if (isTauri()) {
        const { invoke } = await tauriCore();
        return invoke('save_state', { key, value: JSON.stringify(value) });
    }
    localStorage.setItem(key, JSON.stringify(value));
}

export async function onGpxFileChanged(handler) {
    if (!isTauri()) return () => {};
    const { listen } = await tauriEvent();
    return listen('gpx:file-changed', handler);
}

```

`__SLOPE_RUNTIME__` and `__SLOPE_DESKTOP_CONFIG__` are **app-owned bootstrap values**, set by the desktop shell at startup. They are not Tauri internals. The bridge imports the vendored public `@tauri-apps/api` modules (`core`, `event`, etc.) only when desktop mode is active.

Existing modules (`io.js`, `persist.js`, `main.js`) import from `tauri-bridge.js` and call the unified API. Browser behavior is unchanged.

---

## 9. Tauri Project Structure

```
slopedothtml/
├── index.html                  # shared web + desktop entry point, explicit vendor paths
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
│   ├── gpxjs/
│   └── tauri-api/
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
│   ├── fixtures/
│   │   ├── gpx/
│   │   └── tiles/
│   └── ...
├── spike_demo/
│   ├── mbtiles_custom_protocol/
│   ├── mbtiles_to_localhost/
│   └── gpx_sync_filecentric/
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
tauri-plugin-localhost = "2"    # production localhost access for tile/http services
tauri-plugin-shell = "2"        # open URLs in browser
serde = { version = "1", features = ["derive"] }
serde_json = "1"
axum = "0.8"
rusqlite = { version = "0.32", features = ["bundled"] }
notify = "7"                    # filesystem watcher
reqwest = { version = "0.12", features = ["rustls-tls"] }
tokio = { version = "1", features = ["full"] }
sha2 = "0.10"                  # for file change detection
pmtiles = "0.12"               # PMTiles reader
```

Pin exact Tauri core and plugin versions once the scaffold lands. Recent Tauri guidance is that plugin APIs can evolve faster than core, so version pinning matters here.

---

## 10. Validation and Testing Strategy

### 10.1 Recent Tauri v2 Changes That Help This Design

Recent Tauri v2 documentation and release notes reinforce a few design choices:

- The official **plugin ecosystem** is now central to Tauri. Prefer official plugins where they fit instead of leaning on internals or ad hoc shell behavior.
- Tauri v2 replaced the old allowlist model with **permissions, scopes, and capabilities**. This is directly relevant for filesystem sync, offline tile archives, and localhost access.
- Tauri v2's **IPC rewrite** added support for raw payloads, reducing friction for larger command payloads when needed. This is useful for GPX import/export and metadata transfer, though tile delivery should still stay on HTTP paths rather than IPC.
- Tauri now has an official **localhost plugin**, which makes localhost serving a first-class supported deployment model for production apps.

### 10.2 Design for Testability

The design should optimize for deterministic tests from the start:

- **Vendored frontend deps**: browser and desktop both load the same local assets, so tests do not depend on CDN availability.
- **Tiny deterministic tile fixtures**: keep small demo/test MBTiles files in `tests/fixtures/tiles/`, including a generated z1/z2/z3 raster set with coordinates rendered into each PNG.
- **Pure Rust service boundaries**: keep MBTiles reading, cache eviction, GPX conflict detection, and watcher debounce logic in testable Rust modules independent of the WebView.
- **Single bridge seam**: make `js/tauri-bridge.js` the only place that knows about desktop-vs-browser behavior; this makes JS unit tests easy to mock.
- **Explicit bootstrap contract**: `__SLOPE_RUNTIME__` and `__SLOPE_DESKTOP_CONFIG__` are app-owned and can be trivially faked in tests.
- **Fixture-first GPX sync**: maintain a set of sample GPX files for rename, conflict, multi-track, and external-edit scenarios.

### 10.3 Testing Layers

- **JavaScript unit tests**: `tauri-bridge.js`, tile URL rewriting, and browser fallbacks
- **Rust unit tests**: MBTiles reader, PMTiles reader, tile cache eviction, GPX hash/conflict logic
- **Rust integration tests**: temporary directories for watcher behavior, atomic save semantics, MBTiles fixture serving
- **Playwright browser smoke tests**: shared frontend against vendored assets
- **Spike/demo validation tests**: scripted checks for the localhost and custom-protocol demonstrators before architecture commitment

### 10.4 Validation Phase Gate

Before committing to the final tile-serving architecture, Phase 0 must answer these questions with demonstrators and tests:

- Does MapLibre behave cleanly with localhost-served MBTiles raster sources in Tauri?
- Does a custom protocol provide any real advantage once localhost is working?
- Does the file-centric GPX watcher model stay understandable under save, rename, delete, and external-edit scenarios?
- Are the vendored dependencies enough to run browser and desktop test suites fully offline?

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

### Phase 0: Validation + Test Foundations

1. Vendor frontend dependencies into `vendor/` and switch the shared frontend to explicit local paths
2. Add the desktop bootstrap contract (`__SLOPE_RUNTIME__`, `__SLOPE_DESKTOP_CONFIG__`) and keep all Tauri API usage inside `js/tauri-bridge.js`
3. Create deterministic fixtures in `tests/fixtures/gpx/` and `tests/fixtures/tiles/`
4. Run Spike 1 (`mbtiles_to_localhost` vs `mbtiles_custom_protocol`) and Spike 2 (`gpx_sync_filecentric`)
5. Record pass/fail results and commit the architecture only after the serving and sync questions are answered
6. **Deliverable**: a validated architecture with reproducible fixtures and test harnesses

### Phase 1: Scaffold + Prove Shared Frontend in Tauri

1. `cargo tauri init` in the project root
2. Configure `tauri.conf.json` with `frontendDist: "../"`
3. Verify the existing vendored frontend loads correctly in the Tauri WebView
4. Add the desktop bootstrap values and verify `tauri-bridge.js` uses only vendored public Tauri API modules
5. Identify and fix remaining WebView compatibility issues (mostly WebGL / platform specifics, not import maps)
6. **Deliverable**: app runs identically in Tauri and browser

### Phase 2: Localhost Tile Service + Cache

1. Implement the localhost tile server (`axum`) and enable it through `tauri-plugin-localhost`
2. Implement `tile_cache.rs` with SQLite cache for DEM and selected base-map sources
3. Add `tauri-bridge.js` support for desktop tile base URLs and DEM URL rewriting
4. Modify `main.js` and `dem.js` to use the bridge for tile URLs
5. Add cache stats/clear UI in settings panel (desktop-only section)
6. **Deliverable**: DEM and selected base-map tiles cached locally, app works offline for visited areas

### Phase 3: GPX Folder Sync (File-Centric v1)

1. Implement `gpx_sync.rs` with `notify` watcher
2. Add Tauri commands: `pick_and_watch_folder`, `save_gpx`, `list_folder_gpx`
3. Wire `tauri-bridge.js` ↔ `io.js` for bidirectional file sync
4. Implement file-level conflict detection dialog
5. Support folder/file rename and move semantics; keep track-level sync operations out of scope for v1
6. **Deliverable**: GPX files sync between filesystem and app

### Phase 4: Offline Map Tiles (MBTiles/PMTiles)

1. Implement `offline_tiles.rs` behind the localhost serving interface
2. Ship MBTiles first; add PMTiles support behind the same routing layer once the interface is proven
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
| 1 | Vendoring frontend deps | **Explicit vendored local paths used by both web and desktop** | Desktop-only rewrite; esbuild for desktop |
| 2 | GPX conflict resolution | **Prompt on conflict** (safe, reasonable UX) | Last-write-wins; GPX-level merge |
| 3 | Tile cache scope | **DEM and base maps** |  |
| 4 | Offline tile serving | **Localhost HTTP (`axum` + official localhost plugin)** | Custom protocol only if Spike 1 proves a real advantage |
| 5 | Desktop bridge API | **App-owned bootstrap + vendored public `@tauri-apps/api` modules** | Tauri internals / magic globals |
| 6 | Desktop entry point | **Same `index.html`** + explicit vendored asset paths | Separate `desktop.html`; build-time template |

---

## 14. Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| Localhost serving behaves differently on some managed machines | Medium — could affect offline tiles | Use loopback-only binding, validate with Spike 1, and keep custom protocol as a fallback path if needed. |
| Vendored dependencies drift or become stale | Medium — browser and desktop can silently diverge from upstream | Add a documented vendor refresh workflow and keep versions pinned/recorded. |
| WebGL fails in Linux WebKitGTK | Medium — no map rendering | Document minimum driver requirements. Consider Electron as Linux-only fallback (not recommended). |
| Large MBTiles files (>10GB) slow to read | Low — perf issue only | Use WAL mode, mmap, prepared statements. PMTiles has better random access. |
| `notify` crate misses or duplicates events on some filesystems (NFS, FUSE, cloud sync folders) | Medium | Periodic polling fallback, event debounce, and file-centric conflict detection. |
| Plugin APIs may change faster than Tauri core | Medium | Pin exact Tauri core/plugin versions and upgrade intentionally. |
| Capability/scoping mistakes expose too much filesystem surface | High | Use narrow capabilities, validate paths in commands, and scope access to user-selected directories/files only. |

---

## 15. What Changes in Existing Code

| File | Change | Impact on Web |
|---|---|---|
| `js/main.js` | Import `tauri-bridge.js`, use bridge for DEM/base-map URLs | None — bridge returns web URLs when not in Tauri |
| `js/dem.js` | Accept DEM URL from bridge instead of hardcoding | None |
| `js/io.js` | Use bridge for save/load when in Tauri; serialize full GPX files for sync | None — bridge falls back to existing browser APIs |
| `js/persist.js` | Optionally delegate to bridge for state storage | None — bridge falls back to localStorage |
| `js/constants.js` | Possibly move shared web URLs / tile defaults here | Neutral |
| `index.html` | Replace CDN/import-map references with explicit local `vendor/` paths | Web remains static and becomes more deterministic/offline-friendly |
| `css/main.css` | Minor: hide/show desktop-only UI sections | `.tauri-only { display: none }` by default, shown via JS |

**Total web-side changes: still modest, but no longer zero-touch.** The main deliberate change is moving third-party assets to explicit vendored local paths so browser and desktop stay aligned.
