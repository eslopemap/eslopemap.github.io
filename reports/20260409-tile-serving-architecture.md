# Local Tile Serving Architecture

This report explains how adding and serving local tiles (`.mbtiles`, `.pmtiles`) works in the application, mapping the flow from the UI down to the Rust backend and back. 

## 1. How Adding and Serving Local Tiles Works

When a user adds a local tile source (via drag-and-drop or scanning a folder), the application follows a circular flow:

1. **User Action (Frontend):** The user drops a file or selects a folder (`app/js/io.js`).
2. **Registration (Backend):** The frontend invokes a Tauri command (`add_tile_source` or `scan_tile_folder`) which registers the absolute file path and its format (`mbtiles`/`pmtiles`) into the Rust backend's `ManagedState::tile_sources`.
3. **Descriptor Generation (Backend):** The Rust backend runs a local HTTP tile server (`src-tauri/src/tile_server.rs`). This server exposes a `/tilejson` endpoint that lists standard TileJSON descriptors for the registered sources (currently for both `mbtiles` and `pmtiles`).
4. **Discovery (Frontend):** The frontend fetches `http://127.0.0.1:14321/tilejson` via `fetchAvailableSources()` to discover what the backend is serving.
5. **Catalog Construction (Frontend):** The frontend takes the discovered TileJSON object and converts it into a MapLibre-compatible `CatalogEntry` via `buildCatalogEntryFromTileJson()`. It registers this entry into the `layerRegistry` and updates the UI layer dropdown.
6. **Rendering (Frontend -> Backend):** When the user activates the layer, MapLibre requests the tiles. For `mbtiles`, it fetches XYZ PNG tiles from the Rust backend's `/tiles/...` endpoint. For `pmtiles`, the PMTiles JS protocol handles HTTP Range requests against the backend's `/pmtiles/...` endpoint.

### Architecture Diagram

```mermaid
sequenceDiagram
    participant User as User (UI)
    participant IO as io.js (Frontend)
    participant Tauri as Tauri Bridge (Frontend)
    participant Backend as tile_server.rs (Rust)
    participant Registry as layerRegistry (Frontend)
    participant Map as MapLibre GL JS

    User->>IO: Drops .mbtiles / .pmtiles file
    IO->>Tauri: addTileSource(name, path)
    Tauri->>Backend: invoke('add_tile_source')
    Backend-->>Backend: Update ManagedState
    Backend-->>Tauri: OK

    IO->>Tauri: fetchAvailableSources()
    Tauri->>Backend: GET /tilejson
    Backend-->>Backend: Build TileJSON from MBTiles metadata
    Backend-->>Tauri: [{ name: "alps", tiles: [".../tiles/alps/{z}/{x}/{y}.png"], ... }]
    Tauri-->>IO: Return Array of TileJSON

    IO->>Tauri: buildCatalogEntryFromTileJson(tj)
    Tauri-->>IO: MapLibre CatalogEntry
    IO->>Registry: registerUserSource(entry)
    IO->>User: Update "Add layer" dropdown

    User->>Registry: Select Layer
    Registry->>Map: map.addSource() / map.addLayer()
    Map->>Backend: Fetch XYZ Tiles / PMTiles Range requests
    Backend-->>Map: Tile Data
```
