use std::{
    path::PathBuf,
    sync::Mutex,
};

use gpx_sync_backend::{
    new_shared_manager, start_watcher, FileState, FolderSnapshot, SharedSyncManager,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------

struct AppState {
    manager: SharedSyncManager,
    /// Keep the watcher alive as long as the app is running.
    #[allow(dead_code)]
    watcher: Option<notify_debouncer_mini::Debouncer<notify::RecommendedWatcher>>,
}

type ManagedState = Mutex<AppState>;

// ---------------------------------------------------------------------------
// Tauri commands
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

    // Initialize manager with the folder scan
    {
        let mut mgr = app_state.manager.lock().map_err(|e| e.to_string())?;
        let snapshot = mgr.watch_folder(&folder).map_err(|e| e.to_string())?;

        // Start the filesystem watcher
        drop(mgr); // release lock before starting watcher
        let app_clone = app.clone();
        let watcher = start_watcher(&folder, app_state.manager.clone(), move |events| {
            for event in &events {
                println!("[gpx-sync] event: {}", serde_json::to_string(event).unwrap_or_default());
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
    mgr.load_gpx(&PathBuf::from(path)).map_err(|e| e.to_string())
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
// Entry point
// ---------------------------------------------------------------------------

fn main() {
    let manager = new_shared_manager();

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init());
    #[cfg(debug_assertions)]
    {
        builder = builder.plugin(tauri_plugin_webdriver_automation::init());
    }
    builder
        .manage(Mutex::new(AppState {
            manager,
            watcher: None,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running GPX sync spike demo");
}
