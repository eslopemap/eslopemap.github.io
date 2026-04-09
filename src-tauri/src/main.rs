// Slope desktop app — Tauri v2 entry point.
// Combines GPX sync + localhost tile server with the existing web frontend.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod config;
mod gpx_sync;
mod tile_cache;
mod tile_server;

use std::path::PathBuf;
use std::sync::Mutex;

use gpx_sync::{
    new_shared_manager, start_watcher, FileState, FolderSnapshot, SharedSyncManager,
};
use serde_json::Value;
use tile_cache::{CachedUpstreamSource, SharedCachedSources, TileCache};
use tile_server::{SharedTileSources, TileSourceEntry, TileSourceKind, ScannedTileSource, detect_source_kind, scan_tile_folder as do_scan_tile_folder};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------

struct AppState {
    manager: SharedSyncManager,
    #[allow(dead_code)]
    watcher: Option<notify_debouncer_mini::Debouncer<notify::RecommendedWatcher>>,
    tile_port: u16,
    tile_sources: SharedTileSources,
    cached_sources: SharedCachedSources,
    tile_cache: TileCache,
}

type ManagedState = Mutex<AppState>;

fn get_config_value_by_key(cfg: &config::AppConfig, key: &str) -> Result<Value, String> {
    match key {
        "cache.max_size_mb" => Ok(serde_json::json!(cfg.cache.max_size_mb)),
        "sources.folders" => Ok(serde_json::json!(cfg.sources.folders)),
        "sources.files" => Ok(serde_json::json!(cfg.sources.files)),
        "sources.custom_tilejsons" => Ok(serde_json::json!(cfg.sources.custom_tilejsons)),
        _ => Err(format!("Unsupported config key: {key}")),
    }
}

fn set_config_value_by_key(cfg: &mut config::AppConfig, key: &str, value: Value) -> Result<(), String> {
    match key {
        "cache.max_size_mb" => {
            cfg.cache.max_size_mb = serde_json::from_value(value)
                .map_err(|e| format!("invalid cache.max_size_mb: {e}"))?;
            Ok(())
        }
        "sources.folders" => {
            cfg.sources.folders = serde_json::from_value(value)
                .map_err(|e| format!("invalid sources.folders: {e}"))?;
            Ok(())
        }
        "sources.files" => {
            cfg.sources.files = serde_json::from_value(value)
                .map_err(|e| format!("invalid sources.files: {e}"))?;
            Ok(())
        }
        "sources.custom_tilejsons" => {
            cfg.sources.custom_tilejsons = serde_json::from_value(value)
                .map_err(|e| format!("invalid sources.custom_tilejsons: {e}"))?;
            Ok(())
        }
        _ => Err(format!("Unsupported config key: {key}")),
    }
}

// ---------------------------------------------------------------------------
// Tauri commands — GPX sync
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize)]
struct PickResult {
    snapshot: FolderSnapshot,
}

#[tauri::command]
fn pick_and_watch_folder(
    app: AppHandle,
    state: State<'_, ManagedState>,
    folder_path: String,
) -> Result<PickResult, String> {
    let folder = PathBuf::from(&folder_path);
    if !folder.is_dir() {
        return Err(format!("Not a directory: {folder_path}"));
    }

    let mut app_state = state.lock().map_err(|e| e.to_string())?;

    {
        let mut mgr = app_state.manager.lock().map_err(|e| e.to_string())?;
        let snapshot = mgr.watch_folder(&folder).map_err(|e| e.to_string())?;

        drop(mgr);
        let app_clone = app.clone();
        let watcher = start_watcher(&folder, app_state.manager.clone(), move |events| {
            for event in &events {
                println!(
                    "[gpx-sync] event: {}",
                    serde_json::to_string(event).unwrap_or_default()
                );
            }
            let _ = app_clone.emit("gpx:sync-events", &events);
        })
        .map_err(|e| e.to_string())?;

        app_state.watcher = Some(watcher);

        Ok(PickResult { snapshot })
    }
}

#[tauri::command]
fn list_folder_gpx(state: State<'_, ManagedState>) -> Result<FolderSnapshot, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let mgr = app_state.manager.lock().map_err(|e| e.to_string())?;
    Ok(mgr.snapshot())
}

#[tauri::command]
fn load_gpx(state: State<'_, ManagedState>, path: String) -> Result<String, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let mgr = app_state.manager.lock().map_err(|e| e.to_string())?;
    mgr.load_gpx(&PathBuf::from(path))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn mark_dirty(state: State<'_, ManagedState>, path: String) -> Result<(), String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let mut mgr = app_state.manager.lock().map_err(|e| e.to_string())?;
    mgr.mark_dirty(&PathBuf::from(path));
    Ok(())
}

#[tauri::command]
fn save_gpx(
    state: State<'_, ManagedState>,
    path: String,
    content: String,
) -> Result<FileState, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let mut mgr = app_state.manager.lock().map_err(|e| e.to_string())?;
    mgr.save_gpx(&PathBuf::from(path), &content)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn accept_change(state: State<'_, ManagedState>, path: String) -> Result<(), String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let mut mgr = app_state.manager.lock().map_err(|e| e.to_string())?;
    mgr.accept_disk_change(&PathBuf::from(path));
    Ok(())
}

#[tauri::command]
fn resolve_conflict(
    state: State<'_, ManagedState>,
    path: String,
    keep: String,
    app_content: Option<String>,
) -> Result<String, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let mut mgr = app_state.manager.lock().map_err(|e| e.to_string())?;
    let p = PathBuf::from(&path);

    match keep.as_str() {
        "disk" => mgr.resolve_keep_disk(&p).map_err(|e| e.to_string()),
        "app" => {
            let content = app_content.ok_or("app_content required when keep=app")?;
            mgr.resolve_keep_app(&p, &content)
                .map(|_| content)
                .map_err(|e| e.to_string())
        }
        _ => Err(format!("Invalid keep value: {keep}. Use 'disk' or 'app'.")),
    }
}

#[tauri::command]
fn get_snapshot(state: State<'_, ManagedState>) -> Result<FolderSnapshot, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let mgr = app_state.manager.lock().map_err(|e| e.to_string())?;
    Ok(mgr.snapshot())
}

// ---------------------------------------------------------------------------
// Tauri commands — tile source management
// ---------------------------------------------------------------------------

#[tauri::command]
fn add_tile_source(
    state: State<'_, ManagedState>,
    name: String,
    path: String,
) -> Result<TileSourceEntry, String> {
    let file_path = PathBuf::from(&path);
    if !file_path.exists() {
        return Err(format!("File not found: {path}"));
    }
    let kind = detect_source_kind(&file_path)
        .ok_or_else(|| format!("Unsupported file type: {path}. Use .mbtiles or .pmtiles"))?;

    let entry = TileSourceEntry {
        name: name.clone(),
        path: file_path,
        kind,
    };

    let app_state = state.lock().map_err(|e| e.to_string())?;
    let mut sources = app_state.tile_sources.lock().map_err(|e| e.to_string())?;

    // Replace existing source with same name
    sources.retain(|e| e.name != name);
    sources.push(entry.clone());
    println!("[tile-server] added source '{}' ({:?}) -> {}", entry.name, entry.kind, entry.path.display());

    let mut cfg = config::load_config();
    let persisted_path = entry.path.to_string_lossy().to_string();
    if !cfg.sources.files.iter().any(|existing| existing == &persisted_path) {
        cfg.sources.files.push(persisted_path);
        config::save_config(&cfg)?;
    }

    Ok(entry)
}

#[tauri::command]
fn list_tile_sources(state: State<'_, ManagedState>) -> Result<Vec<TileSourceEntry>, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let sources = app_state.tile_sources.lock().map_err(|e| e.to_string())?;
    Ok(sources.clone())
}

#[tauri::command]
fn remove_tile_source(state: State<'_, ManagedState>, name: String) -> Result<bool, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let mut sources = app_state.tile_sources.lock().map_err(|e| e.to_string())?;
    let removed_entry = sources.iter().find(|e| e.name == name).cloned();
    let before = sources.len();
    sources.retain(|e| e.name != name);
    let removed = sources.len() < before;
    if removed {
        println!("[tile-server] removed source '{name}'");
        if let Some(entry) = removed_entry {
            let persisted_path = entry.path.to_string_lossy().to_string();
            let mut cfg = config::load_config();
            let original_len = cfg.sources.files.len();
            cfg.sources.files.retain(|existing| existing != &persisted_path);
            if cfg.sources.files.len() != original_len {
                config::save_config(&cfg)?;
            }
        }
    }
    Ok(removed)
}

/// Scan a folder for .mbtiles/.pmtiles files and auto-register them as tile sources.
#[tauri::command]
fn scan_tile_folder(
    state: State<'_, ManagedState>,
    folder_path: String,
) -> Result<Vec<ScannedTileSource>, String> {
    let dir = PathBuf::from(&folder_path);
    let scanned = do_scan_tile_folder(&dir).map_err(|e| e.to_string())?;

    // Auto-register all found sources
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let mut sources = app_state.tile_sources.lock().map_err(|e| e.to_string())?;

    for s in &scanned {
        let entry = TileSourceEntry {
            name: s.name.clone(),
            path: s.path.clone(),
            kind: s.kind,
        };
        sources.retain(|e| e.name != entry.name);
        sources.push(entry);
        println!("[tile-server] auto-registered '{}' ({:?}) from scan", s.name, s.kind);
    }

    let mut cfg = config::load_config();
    if !cfg.sources.folders.iter().any(|existing| existing == &folder_path) {
        cfg.sources.folders.push(folder_path);
        config::save_config(&cfg)?;
    }

    Ok(scanned)
}

// ---------------------------------------------------------------------------
// Tauri commands — desktop config
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
struct DesktopConfig {
    runtime: String,
    tile_base_url: String,
    test_mode: bool,
    config_path: String,
    cache_root: String,
    cached_source_names: Vec<String>,
}

#[tauri::command]
fn get_desktop_config(state: State<'_, ManagedState>) -> Result<DesktopConfig, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let cached_source_names = app_state
        .cached_sources
        .lock()
        .map_err(|e| e.to_string())?
        .iter()
        .map(|source| source.name.clone())
        .collect();
    Ok(DesktopConfig {
        runtime: "tauri".to_string(),
        tile_base_url: format!("http://127.0.0.1:{}", app_state.tile_port),
        test_mode: std::env::var("TAURI_E2E_TESTS")
            .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
            .unwrap_or(false),
        config_path: config::effective_config_file_path()
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_default(),
        cache_root: app_state.tile_cache.root().to_string_lossy().to_string(),
        cached_source_names,
    })
}

#[tauri::command]
fn get_config_value(key: String) -> Result<Value, String> {
    let cfg = config::load_config();
    get_config_value_by_key(&cfg, &key)
}

#[tauri::command]
fn set_config_value(state: State<'_, ManagedState>, key: String, value: Value) -> Result<Value, String> {
    let mut cfg = config::load_config();
    set_config_value_by_key(&mut cfg, &key, value)?;
    config::save_config(&cfg)?;

    if key == "cache.max_size_mb" {
        let app_state = state.lock().map_err(|e| e.to_string())?;
        app_state.tile_cache.set_max_size(cfg.cache.max_size_mb * 1024 * 1024);
        app_state.tile_cache.evict_if_needed();
    }

    get_config_value_by_key(&cfg, &key)
}

// ---------------------------------------------------------------------------
// Tauri commands — tile cache
// ---------------------------------------------------------------------------

#[tauri::command]
fn get_cache_stats(state: State<'_, ManagedState>) -> Result<tile_cache::CacheStats, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    Ok(app_state.tile_cache.stats())
}

#[tauri::command]
fn clear_tile_cache(state: State<'_, ManagedState>) -> Result<bool, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let root = app_state.tile_cache.root();
    let removed = crate::tile_cache::clear_cache_dir(&root);
    Ok(removed)
}

/// Inject a tile directly into the disk cache (for testing).
/// `data` is a base64-encoded string of the tile contents.
#[tauri::command]
fn inject_cached_tile(
    state: State<'_, ManagedState>,
    source: String,
    z: u32,
    x: u32,
    y: u32,
    ext: String,
    data: String,
) -> Result<String, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&data)
        .map_err(|e| format!("base64 decode: {e}"))?;
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let path = app_state
        .tile_cache
        .inject_tile(&source, z, x, y, &ext, &bytes)?;
    Ok(path.to_string_lossy().to_string())
}

/// Update the tile cache maximum size (in MB) at runtime and persist to config.
#[tauri::command]
fn set_cache_max_size(state: State<'_, ManagedState>, max_size_mb: u64) -> Result<(), String> {
    set_config_value(state, "cache.max_size_mb".to_string(), serde_json::json!(max_size_mb))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// DEM upstream URL
// ---------------------------------------------------------------------------

const DEM_UPSTREAM_URL: &str = "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp";

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

fn main() {
    let app_config = config::load_config();
    let cache_dir = config::resolve_cache_dir(&app_config);
    let max_cache_bytes = app_config.cache.max_size_mb * 1024 * 1024;

    let manager = new_shared_manager();
    let tile_port = tile_server::DEFAULT_TILE_PORT;

    // Shared tile source registry (MBTiles / PMTiles)
    let tile_sources: SharedTileSources = std::sync::Arc::new(Mutex::new(Vec::new()));

    // Seed with test fixture if it exists
    let fixture_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../tests/fixtures/tiles/dummy-z1-z3.mbtiles");
    if fixture_path.exists() {
        tile_sources.lock().unwrap().push(TileSourceEntry {
            name: "dummy".to_string(),
            path: fixture_path,
            kind: TileSourceKind::Mbtiles,
        });
    }

    // Auto-scan configured source folders
    for folder in &app_config.sources.folders {
        let dir = PathBuf::from(folder);
        if !dir.is_dir() {
            eprintln!("[startup] configured source folder not found: {folder}");
            continue;
        }
        match do_scan_tile_folder(&dir) {
            Ok(scanned) => {
                let mut sources = tile_sources.lock().unwrap();
                for s in &scanned {
                    let entry = TileSourceEntry {
                        name: s.name.clone(),
                        path: s.path.clone(),
                        kind: s.kind,
                    };
                    sources.retain(|e| e.name != entry.name);
                    sources.push(entry);
                    println!("[startup] auto-registered '{}' ({:?}) from {folder}", s.name, s.kind);
                }
            }
            Err(e) => eprintln!("[startup] error scanning {folder}: {e}"),
        }
    }

    for file in &app_config.sources.files {
        let path = PathBuf::from(file);
        if !path.is_file() {
            eprintln!("[startup] configured source file not found: {file}");
            continue;
        }
        let Some(kind) = detect_source_kind(&path) else {
            eprintln!("[startup] configured source file has unsupported type: {file}");
            continue;
        };
        let name = path.file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or("unknown")
            .to_string();
        let entry = TileSourceEntry {
            name: name.clone(),
            path: path.clone(),
            kind,
        };
        let mut sources = tile_sources.lock().unwrap();
        sources.retain(|existing| existing.name != entry.name);
        sources.push(entry);
        println!("[startup] registered '{}' ({:?}) from file {}", name, kind, file);
    }

    // Cached upstream sources (fetched from internet, cached on disk)
    let cached_sources: SharedCachedSources = std::sync::Arc::new(Mutex::new(vec![
        CachedUpstreamSource {
            name: "dem".to_string(),
            upstream_url: DEM_UPSTREAM_URL.to_string(),
        },
    ]));

    // Disk tile cache
    let tile_cache = TileCache::new(cache_dir, max_cache_bytes);

    tile_server::spawn_tile_server(
        tile_port,
        tile_sources.clone(),
        cached_sources.clone(),
        tile_cache.clone(),
    );

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init());
    #[cfg(feature = "webdriver")]
    let builder = builder.plugin(tauri_plugin_webdriver::init());
    builder
        .manage(Mutex::new(AppState {
            manager,
            watcher: None,
            tile_port,
            tile_sources,
            cached_sources,
            tile_cache,
        }))
        .invoke_handler(tauri::generate_handler![
            pick_and_watch_folder,
            list_folder_gpx,
            load_gpx,
            mark_dirty,
            save_gpx,
            accept_change,
            resolve_conflict,
            get_snapshot,
            get_desktop_config,
            get_config_value,
            set_config_value,
            add_tile_source,
            list_tile_sources,
            remove_tile_source,
            scan_tile_folder,
            get_cache_stats,
            clear_tile_cache,
            inject_cached_tile,
            set_cache_max_size,
        ])
        .setup(move |app| {
            // Inject the desktop bootstrap globals into the webview
            let tile_port_val = tile_port;
            let window = app.get_webview_window("main")
                .expect("main window not found");
            let script = format!(
                r#"window.__SLOPE_RUNTIME__ = 'tauri';
window.__SLOPE_DESKTOP_CONFIG__ = {{
    tileBaseUrl: 'http://127.0.0.1:{tile_port_val}'
}};
// Forward uncaught JS errors to console.error so they appear in cargo tauri dev output
window.addEventListener('error', function(e) {{
    console.error('[SLOPE JS ERROR]', e.message, 'at', e.filename + ':' + e.lineno + ':' + e.colno);
}});
window.addEventListener('unhandledrejection', function(e) {{
    console.error('[SLOPE UNHANDLED REJECTION]', e.reason);
}});"#
            );
            window.eval(&script).ok();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Slope desktop");
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn get_config_value_cache_max_size() {
        let mut cfg = config::AppConfig::default();
        cfg.cache.max_size_mb = 500;
        let val = get_config_value_by_key(&cfg, "cache.max_size_mb").unwrap();
        assert_eq!(val, json!(500));
    }

    #[test]
    fn get_config_value_sources_folders() {
        let mut cfg = config::AppConfig::default();
        cfg.sources.folders = vec!["/tiles".to_string()];
        let val = get_config_value_by_key(&cfg, "sources.folders").unwrap();
        assert_eq!(val, json!(["/tiles"]));
    }

    #[test]
    fn get_config_value_sources_files() {
        let mut cfg = config::AppConfig::default();
        cfg.sources.files = vec!["/a.mbtiles".to_string(), "/b.pmtiles".to_string()];
        let val = get_config_value_by_key(&cfg, "sources.files").unwrap();
        assert_eq!(val, json!(["/a.mbtiles", "/b.pmtiles"]));
    }

    #[test]
    fn get_config_value_custom_tilejsons() {
        let mut cfg = config::AppConfig::default();
        cfg.sources.custom_tilejsons = vec![json!({"id": "test", "tiles": ["https://example.test/{z}/{x}/{y}.png"]})];
        let val = get_config_value_by_key(&cfg, "sources.custom_tilejsons").unwrap();
        assert_eq!(val.as_array().unwrap().len(), 1);
    }

    #[test]
    fn get_config_value_unsupported_key() {
        let cfg = config::AppConfig::default();
        let err = get_config_value_by_key(&cfg, "nonexistent.key").unwrap_err();
        assert!(err.contains("Unsupported config key"));
    }

    #[test]
    fn set_config_value_cache_max_size() {
        let mut cfg = config::AppConfig::default();
        set_config_value_by_key(&mut cfg, "cache.max_size_mb", json!(250)).unwrap();
        assert_eq!(cfg.cache.max_size_mb, 250);
    }

    #[test]
    fn set_config_value_sources_folders() {
        let mut cfg = config::AppConfig::default();
        set_config_value_by_key(&mut cfg, "sources.folders", json!(["/a", "/b"])).unwrap();
        assert_eq!(cfg.sources.folders, vec!["/a", "/b"]);
    }

    #[test]
    fn set_config_value_sources_files() {
        let mut cfg = config::AppConfig::default();
        set_config_value_by_key(&mut cfg, "sources.files", json!(["/x.mbtiles"])).unwrap();
        assert_eq!(cfg.sources.files, vec!["/x.mbtiles"]);
    }

    #[test]
    fn set_config_value_custom_tilejsons() {
        let mut cfg = config::AppConfig::default();
        let tilejsons = json!([{"id": "tj1", "tiles": ["https://example.test/{z}/{x}/{y}.png"]}]);
        set_config_value_by_key(&mut cfg, "sources.custom_tilejsons", tilejsons).unwrap();
        assert_eq!(cfg.sources.custom_tilejsons.len(), 1);
    }

    #[test]
    fn set_config_value_invalid_type() {
        let mut cfg = config::AppConfig::default();
        let err = set_config_value_by_key(&mut cfg, "cache.max_size_mb", json!("not a number")).unwrap_err();
        assert!(err.contains("invalid cache.max_size_mb"));
    }

    #[test]
    fn set_config_value_unsupported_key() {
        let mut cfg = config::AppConfig::default();
        let err = set_config_value_by_key(&mut cfg, "bad.key", json!(42)).unwrap_err();
        assert!(err.contains("Unsupported config key"));
    }

    #[test]
    fn roundtrip_config_value() {
        let mut cfg = config::AppConfig::default();
        set_config_value_by_key(&mut cfg, "cache.max_size_mb", json!(300)).unwrap();
        set_config_value_by_key(&mut cfg, "sources.folders", json!(["/maps"])).unwrap();
        set_config_value_by_key(&mut cfg, "sources.files", json!(["/f.mbtiles"])).unwrap();
        let tilejsons = json!([{"id": "x", "tiles": ["https://example.test/{z}/{x}/{y}.png"]}]);
        set_config_value_by_key(&mut cfg, "sources.custom_tilejsons", tilejsons).unwrap();

        assert_eq!(get_config_value_by_key(&cfg, "cache.max_size_mb").unwrap(), json!(300));
        assert_eq!(get_config_value_by_key(&cfg, "sources.folders").unwrap(), json!(["/maps"]));
        assert_eq!(get_config_value_by_key(&cfg, "sources.files").unwrap(), json!(["/f.mbtiles"]));
        assert_eq!(get_config_value_by_key(&cfg, "sources.custom_tilejsons").unwrap().as_array().unwrap().len(), 1);
    }
}
