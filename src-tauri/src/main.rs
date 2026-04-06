// Slope desktop app — Tauri v2 entry point.
// Combines GPX sync + localhost tile server with the existing web frontend.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod gpx_sync;
mod tile_server;

use std::path::PathBuf;
use std::sync::Mutex;

use gpx_sync::{
    new_shared_manager, start_watcher, FileState, FolderSnapshot, SharedSyncManager,
};
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
}

type ManagedState = Mutex<AppState>;

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
// Tauri commands — desktop config
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
struct DesktopConfig {
    runtime: String,
    tile_base_url: String,
}

#[tauri::command]
fn get_desktop_config(state: State<'_, ManagedState>) -> Result<DesktopConfig, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    Ok(DesktopConfig {
        runtime: "tauri".to_string(),
        tile_base_url: format!("http://127.0.0.1:{}", app_state.tile_port),
    })
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

fn main() {
    let manager = new_shared_manager();
    let tile_port = tile_server::DEFAULT_TILE_PORT;

    // Start the tile server (initially with no sources; sources added via commands later)
    // For now, serve the test fixture if it exists
    let fixture_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../tests/fixtures/tiles/dummy-z1-z3.mbtiles");
    let mut sources = Vec::new();
    if fixture_path.exists() {
        sources.push(("dummy".to_string(), fixture_path));
    }
    tile_server::spawn_tile_server(tile_port, sources);

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(Mutex::new(AppState {
            manager,
            watcher: None,
            tile_port,
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
}};"#
            );
            window.eval(&script).ok();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Slope desktop");
}
