# Plan: custom layers, local layers, and desktop/web persistence

**Date:** 2026-04-09  
**Scope:** unify settings persistence and layer ownership across web mode and Tauri desktop mode.

## Problem summary

The current implementation mixes three different state owners:

- browser `localStorage` for frontend settings and user sources
- desktop Rust config for some backend settings such as cache size
- in-memory desktop tile-server state for local files and scanned folders

That creates ambiguity in a few places:

- `scanAndRegisterDesktopTileFolder(folderPath)` registers runtime sources but did not guarantee persistence in backend config
- cache size had a special setter but no generic config read/write flow
- custom TileJSON sources were fundamentally a UI concept, but desktop mode still needs them restored on restart
- desktop local layers appeared in the same frontend registry as browser-persisted sources, which risks duplicate or misleading state

## Alternatives considered

### Option A — Desktop keeps all persistence server-side

Store everything in Rust config and make the UI fetch it all.

Pros:
- one durable source of truth in desktop mode
- backend starts with the full state it needs
- works well for backend-owned data such as local files, folders, and cache size

Cons:
- web mode still needs separate browser persistence anyway
- frontend-only data would need extra fetch/bridge plumbing even when backend does not use it directly
- if applied blindly, it would over-centralize UI-only concerns

### Option B — Browser keeps all persistence and replays into desktop backend

Persist custom sources and settings in the browser, then push them into the desktop backend at startup.

Pros:
- simpler web parity for UI state
- fewer backend config concepts

Cons:
- backend starts empty and depends on UI replay
- bad fit for local source serving because the server should already know what to expose
- duplicates state between browser and backend for desktop mode
- fragile if UI restore order changes

## Recommended ownership model

Use a split model based on who actually needs the data.

### Desktop backend is authoritative for

- `cache.max_size_mb`
- local source folders scanned by the tile server
- local source files registered with the tile server
- desktop custom TileJSON source descriptors

Reasoning:
- these affect backend startup behavior or runtime serving
- they should survive restarts without requiring frontend replay

### Browser is authoritative for web-only custom TileJSON sources

- web mode custom TileJSON sources stay in `localStorage`
- no backend dependency in web mode

### UI discovery model

- desktop local MBTiles / PMTiles / scanned folders remain backend-owned
- UI discovers those through the desktop tile server’s TileJSON endpoint
- UI does not independently persist those runtime local layers

## Concrete implementation plan

### 1. Add generic desktop config read/write

Expose:
- `get_config_value(key)`
- `set_config_value(key, value)`

Supported keys now:
- `cache.max_size_mb`
- `sources.folders`
- `sources.files`
- `sources.custom_tilejsons`

This removes the need to invent a new one-off getter/setter for each setting.

### 2. Persist local desktop sources in backend config

- `add_tile_source` appends file paths to `sources.files`
- `scan_tile_folder` appends folder paths to `sources.folders`
- desktop startup loads both configured folders and configured files
- `remove_tile_source` removes matching persisted file entries when relevant

### 3. Separate custom TileJSON sources from desktop runtime local layers

Frontend source persistence categories:
- `browser`
- `desktop-config`
- `desktop-runtime`

Rules:
- `browser` sources go to `localStorage`
- `desktop-config` sources go to backend config only
- `desktop-runtime` sources are discovered from backend and not browser-persisted

### 4. Add a web/desktop UI path for custom TileJSON input

- add an `Add TileJSON…` button in the layer panel
- fetch a TileJSON URL and register it as a custom source
- in web mode, persist in browser
- in desktop mode, persist via backend config

### 5. Treat dropped TileJSON files as custom sources

- `.tilejson` and TileJSON-shaped `.json` files register as custom tile sources
- local `.mbtiles` / `.pmtiles` and folders continue to trigger the desktop-server flow instead

## Expected flow after implementation

### Web mode

- add TileJSON URL or drop TileJSON file
- source is registered in UI
- source is persisted in browser storage
- on reload, UI restores it from browser storage

### Desktop mode — custom TileJSON

- add TileJSON URL or drop TileJSON file
- source is registered in UI
- source descriptor is stored in backend config
- on restart, UI reloads it from backend config

### Desktop mode — local file/folder

- drop `.mbtiles` / `.pmtiles` file or scan folder
- backend registers it for serving and persists file/folder path in config
- UI discovers it via backend TileJSON endpoint
- no duplicated browser persistence

## Decision

Adopt the split authority model:

- backend config for desktop-relevant persistent settings and sources
- browser storage for web-only custom TileJSON sources
- backend discovery for desktop local layers

This keeps startup efficient, avoids duplicate source-of-truth problems, and gives both web and desktop a coherent custom-tile workflow.
