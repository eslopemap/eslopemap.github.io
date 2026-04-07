# Tile Cache Implementation Report

**Date:** 2026-04-07  
**Scope:** DEM tile 404 fix via disk-backed tile cache with configurable size and OS-standard paths

## Problem

The Tauri desktop app requests DEM tiles at `/tiles/dem/{z}/{x}/{y}.webp` from the embedded tile server, but no `dem` source was registered. All DEM tile requests returned 404.

## Solution

Introduced a **cached upstream source** concept: the tile server can now proxy requests to a remote URL, caching responses on disk with LRU eviction.

### Architecture

```
Frontend → /tiles/dem/10/530/365.webp → Tile Server
  ├─ Cache HIT  → serve from disk (~/.cache/slopemapper/tiles/dem/10/530/365.webp)
  └─ Cache MISS → fetch https://tiles.mapterhorn.com/10/530/365.webp → write to disk → serve
```

### New Modules

| File | Role |
|---|---|
| `src-tauri/src/config.rs` | Loads `slopemapper.toml` from OS config dir; `[cache] max_size_mb` (default 100), `path` override |
| `src-tauri/src/tile_cache.rs` | Disk cache with LRU eviction by mtime, upstream fetch via `ureq`, thread-safe `inject_tile()` for tests |

### Key Decisions

- **OS-standard paths:** Uses `dirs` crate. macOS: `~/Library/Caches/slopemapper/tiles/`, Linux: `~/.cache/slopemapper/tiles/`
- **LRU by mtime:** `filetime` crate touches mtime on cache hits. Eviction sorts by mtime ascending, removes oldest until under limit.
- **Synchronous HTTP:** `ureq` v2 (blocking) is appropriate since the tile server already runs on a dedicated thread.
- **Test injection:** `inject_cached_tile` Tauri command accepts base64-encoded tile data, writes directly into cache. E2E tests inject fixture tiles then verify HTTP 200.

### New Dependencies

`ureq`, `filetime`, `dirs`, `toml`, `base64`

### Config Example (`~/.config/slopemapper/slopemapper.toml`)

```toml
[cache]
max_size_mb = 250
# path = "/custom/path"
```

### Test Results

- **48 Rust unit tests** pass (7 config + 5 tile_cache + 19 tile_server + 17 gpx_sync)
- **8 WebDriver E2E tests** pass (cache stats, inject fixtures, verify 200, upstream fallback)
