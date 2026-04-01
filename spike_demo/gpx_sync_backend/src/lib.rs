use std::{
    collections::HashMap,
    fmt,
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::SystemTime,
};

use notify_debouncer_mini::{new_debouncer, DebouncedEventKind};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// Possible states for a watched GPX file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FileStatus {
    /// Content matches the last known disk state.
    Clean,
    /// Modified in-app but not yet saved.
    DirtyInApp,
    /// Changed on disk while the app copy was clean.
    ChangedOnDisk,
    /// Changed on disk while the app copy was dirty — needs user resolution.
    Conflict,
    /// Deleted on disk.
    DeletedOnDisk,
}

/// Per-file tracking state kept by the watcher.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileState {
    pub path: PathBuf,
    pub status: FileStatus,
    /// SHA-256 hex digest of the last known content.
    pub content_hash: String,
    /// Last known modification time (seconds since UNIX epoch).
    pub mtime_secs: u64,
}

/// Events emitted to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SyncEvent {
    FileAdded { path: String, content: String },
    FileChanged { path: String, content: String },
    FileRemoved { path: String },
    FileRenamed { old_path: String, new_path: String, content: String },
    Conflict { path: String, disk_content: String },
}

/// Snapshot of all tracked files, returned to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderSnapshot {
    pub folder: String,
    pub files: Vec<FileState>,
}

/// Errors produced by the sync backend.
#[derive(Debug)]
pub enum SyncError {
    Io(io::Error),
    Watch(notify::Error),
}

impl fmt::Display for SyncError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(e) => write!(f, "io error: {e}"),
            Self::Watch(e) => write!(f, "watcher error: {e}"),
        }
    }
}

impl std::error::Error for SyncError {}
impl From<io::Error> for SyncError { fn from(e: io::Error) -> Self { Self::Io(e) } }
impl From<notify::Error> for SyncError { fn from(e: notify::Error) -> Self { Self::Watch(e) } }

// ---------------------------------------------------------------------------
// Core: content hashing
// ---------------------------------------------------------------------------

/// Compute the SHA-256 hex digest of the given bytes.
pub fn content_hash(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    format!("{:x}", hasher.finalize())
}

// ---------------------------------------------------------------------------
// Core: atomic file write
// ---------------------------------------------------------------------------

/// Write `content` to `path` atomically (write to .tmp then rename).
/// Returns the SHA-256 hash of the written content.
pub fn atomic_write(path: &Path, content: &[u8]) -> Result<String, SyncError> {
    let tmp_path = path.with_extension("gpx.tmp");
    {
        let mut f = fs::File::create(&tmp_path)?;
        f.write_all(content)?;
        f.sync_all()?;
    }
    fs::rename(&tmp_path, path)?;
    Ok(content_hash(content))
}

// ---------------------------------------------------------------------------
// Core: scan a folder for .gpx files
// ---------------------------------------------------------------------------

/// List all `.gpx` files in `folder` (non-recursive) and build initial state.
pub fn scan_folder(folder: &Path) -> Result<HashMap<PathBuf, FileState>, SyncError> {
    let mut map = HashMap::new();
    for entry in fs::read_dir(folder)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("gpx") && path.is_file() {
            let data = fs::read(&path)?;
            let hash = content_hash(&data);
            let mtime = entry
                .metadata()?
                .modified()
                .unwrap_or(SystemTime::UNIX_EPOCH);
            let mtime_secs = mtime
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            map.insert(
                path.clone(),
                FileState {
                    path,
                    status: FileStatus::Clean,
                    content_hash: hash,
                    mtime_secs,
                },
            );
        }
    }
    Ok(map)
}

// ---------------------------------------------------------------------------
// GpxSyncManager — the central state holder
// ---------------------------------------------------------------------------

pub struct GpxSyncManager {
    /// Currently watched folder.
    pub folder: Option<PathBuf>,
    /// Per-file state map.
    pub files: HashMap<PathBuf, FileState>,
    /// Paths we just wrote ourselves — suppress the next watcher event for these.
    pub self_write_suppression: Vec<PathBuf>,
    /// Accumulated events for the frontend to poll (simple model for the spike).
    pub pending_events: Vec<SyncEvent>,
}

impl GpxSyncManager {
    pub fn new() -> Self {
        Self {
            folder: None,
            files: HashMap::new(),
            self_write_suppression: Vec::new(),
            pending_events: Vec::new(),
        }
    }

    /// Set the watched folder and perform initial scan.
    pub fn watch_folder(&mut self, folder: &Path) -> Result<FolderSnapshot, SyncError> {
        self.files = scan_folder(folder)?;
        self.folder = Some(folder.to_path_buf());
        self.self_write_suppression.clear();
        self.pending_events.clear();
        Ok(self.snapshot())
    }

    /// Build a snapshot of all tracked files.
    pub fn snapshot(&self) -> FolderSnapshot {
        FolderSnapshot {
            folder: self.folder.as_ref().map(|p| p.display().to_string()).unwrap_or_default(),
            files: self.files.values().cloned().collect(),
        }
    }

    /// Load a specific GPX file's content.
    pub fn load_gpx(&self, path: &Path) -> Result<String, SyncError> {
        Ok(fs::read_to_string(path)?)
    }

    /// Mark a file as dirty in-app (the frontend edited it).
    pub fn mark_dirty(&mut self, path: &Path) {
        if let Some(state) = self.files.get_mut(path) {
            if state.status == FileStatus::Clean {
                state.status = FileStatus::DirtyInApp;
            }
        }
    }

    /// Save GPX content from the app. Atomic write + suppress watcher echo.
    pub fn save_gpx(&mut self, path: &Path, content: &str) -> Result<FileState, SyncError> {
        let hash = atomic_write(path, content.as_bytes())?;
        let mtime = fs::metadata(path)?
            .modified()
            .unwrap_or(SystemTime::UNIX_EPOCH)
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        // Suppress the upcoming watcher event for this path
        self.self_write_suppression.push(path.to_path_buf());

        let state = FileState {
            path: path.to_path_buf(),
            status: FileStatus::Clean,
            content_hash: hash,
            mtime_secs: mtime,
        };
        self.files.insert(path.to_path_buf(), state.clone());
        Ok(state)
    }

    /// Process a filesystem notification. Returns any events to forward to the frontend.
    pub fn handle_fs_event(&mut self, path: &Path) -> Result<Vec<SyncEvent>, SyncError> {
        let mut events = Vec::new();

        // Check suppression list first
        if let Some(pos) = self.self_write_suppression.iter().position(|p| p == path) {
            self.self_write_suppression.remove(pos);
            return Ok(events);
        }

        let is_gpx = path.extension().and_then(|e| e.to_str()) == Some("gpx");
        if !is_gpx {
            return Ok(events);
        }

        let path_str = path.display().to_string();

        if !path.exists() {
            // File was deleted
            if self.files.remove(path).is_some() {
                events.push(SyncEvent::FileRemoved { path: path_str });
            }
            return Ok(events);
        }

        let data = fs::read(path)?;
        let hash = content_hash(&data);
        let mtime = fs::metadata(path)?
            .modified()
            .unwrap_or(SystemTime::UNIX_EPOCH)
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let content = String::from_utf8_lossy(&data).to_string();

        if let Some(existing) = self.files.get_mut(path) {
            if existing.content_hash == hash {
                // Same content — ignore (touch, metadata-only change)
                return Ok(events);
            }

            match existing.status {
                FileStatus::DirtyInApp | FileStatus::Conflict => {
                    // External change while app has unsaved modifications → conflict
                    existing.status = FileStatus::Conflict;
                    existing.content_hash = hash;
                    existing.mtime_secs = mtime;
                    events.push(SyncEvent::Conflict {
                        path: path_str,
                        disk_content: content,
                    });
                }
                _ => {
                    // Clean or already changed-on-disk — just update
                    existing.status = FileStatus::ChangedOnDisk;
                    existing.content_hash = hash;
                    existing.mtime_secs = mtime;
                    events.push(SyncEvent::FileChanged {
                        path: path_str,
                        content,
                    });
                }
            }
        } else {
            // New file appeared
            self.files.insert(
                path.to_path_buf(),
                FileState {
                    path: path.to_path_buf(),
                    status: FileStatus::Clean,
                    content_hash: hash,
                    mtime_secs: mtime,
                },
            );
            events.push(SyncEvent::FileAdded {
                path: path_str,
                content,
            });
        }

        Ok(events)
    }

    /// After the frontend has consumed a FileChanged event, mark the file clean.
    pub fn accept_disk_change(&mut self, path: &Path) {
        if let Some(state) = self.files.get_mut(path) {
            if state.status == FileStatus::ChangedOnDisk {
                state.status = FileStatus::Clean;
            }
        }
    }

    /// Resolve a conflict by choosing the disk version (reload).
    pub fn resolve_keep_disk(&mut self, path: &Path) -> Result<String, SyncError> {
        let content = fs::read_to_string(path)?;
        if let Some(state) = self.files.get_mut(path) {
            state.status = FileStatus::Clean;
            state.content_hash = content_hash(content.as_bytes());
        }
        Ok(content)
    }

    /// Resolve a conflict by choosing the app version (overwrite disk).
    pub fn resolve_keep_app(&mut self, path: &Path, app_content: &str) -> Result<FileState, SyncError> {
        self.save_gpx(path, app_content)
    }

    /// Drain and return all pending events.
    pub fn drain_events(&mut self) -> Vec<SyncEvent> {
        std::mem::take(&mut self.pending_events)
    }
}

/// Convenience type for thread-safe shared access.
pub type SharedSyncManager = Arc<Mutex<GpxSyncManager>>;

/// Create a new shared manager.
pub fn new_shared_manager() -> SharedSyncManager {
    Arc::new(Mutex::new(GpxSyncManager::new()))
}

// ---------------------------------------------------------------------------
// Watcher setup
// ---------------------------------------------------------------------------

/// Start watching a folder. Filesystem events are processed through the manager
/// and the `on_event` callback is called with any resulting sync events.
///
/// Returns a handle that keeps the watcher alive. Drop it to stop watching.
pub fn start_watcher<F>(
    folder: &Path,
    manager: SharedSyncManager,
    on_event: F,
) -> Result<notify_debouncer_mini::Debouncer<notify::RecommendedWatcher>, SyncError>
where
    F: Fn(Vec<SyncEvent>) + Send + 'static,
{
    let manager_clone = manager.clone();
    let mut debouncer = new_debouncer(
        std::time::Duration::from_millis(500),
        move |res: Result<Vec<notify_debouncer_mini::DebouncedEvent>, notify::Error>| {
            let events = match res {
                Ok(debounced_events) => debounced_events,
                Err(e) => {
                    eprintln!("[gpx-sync] watcher error: {e}");
                    return;
                }
            };

            let mut all_sync_events = Vec::new();
            for event in events {
                if event.kind != DebouncedEventKind::Any {
                    continue;
                }
                let mut mgr = manager_clone.lock().unwrap();
                match mgr.handle_fs_event(&event.path) {
                    Ok(sync_events) => all_sync_events.extend(sync_events),
                    Err(e) => eprintln!("[gpx-sync] error handling event for {:?}: {e}", event.path),
                }
            }

            if !all_sync_events.is_empty() {
                on_event(all_sync_events);
            }
        },
    )?;

    debouncer
        .watcher()
        .watch(folder, notify::RecursiveMode::NonRecursive)?;

    Ok(debouncer)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn make_temp_dir(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("gpx-sync-test-{name}-{unique}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn sample_gpx(name: &str) -> String {
        format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>{name}</name><trkseg>
    <trkpt lat="45.0" lon="6.0"><ele>100</ele></trkpt>
  </trkseg></trk>
</gpx>"#
        )
    }

    // --- content_hash ---

    #[test]
    fn hash_same_content_is_stable() {
        let h1 = content_hash(b"hello");
        let h2 = content_hash(b"hello");
        assert_eq!(h1, h2);
    }

    #[test]
    fn hash_different_content_differs() {
        let h1 = content_hash(b"hello");
        let h2 = content_hash(b"world");
        assert_ne!(h1, h2);
    }

    // --- atomic_write ---

    #[test]
    fn atomic_write_creates_file() {
        let dir = make_temp_dir("atomic-write");
        let path = dir.join("test.gpx");
        let hash = atomic_write(&path, b"<gpx/>").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "<gpx/>");
        assert_eq!(hash, content_hash(b"<gpx/>"));
        // No leftover .tmp file
        assert!(!dir.join("test.gpx.tmp").exists());
        fs::remove_dir_all(dir).unwrap();
    }

    // --- scan_folder ---

    #[test]
    fn scan_finds_gpx_files() {
        let dir = make_temp_dir("scan");
        fs::write(dir.join("a.gpx"), "<gpx>a</gpx>").unwrap();
        fs::write(dir.join("b.gpx"), "<gpx>b</gpx>").unwrap();
        fs::write(dir.join("c.txt"), "not gpx").unwrap();

        let files = scan_folder(&dir).unwrap();
        assert_eq!(files.len(), 2);
        assert!(files.contains_key(&dir.join("a.gpx")));
        assert!(files.contains_key(&dir.join("b.gpx")));
        assert!(!files.contains_key(&dir.join("c.txt")));

        fs::remove_dir_all(dir).unwrap();
    }

    // --- GpxSyncManager ---

    #[test]
    fn watch_folder_returns_snapshot() {
        let dir = make_temp_dir("watch-snap");
        fs::write(dir.join("track.gpx"), sample_gpx("Track")).unwrap();

        let mut mgr = GpxSyncManager::new();
        let snap = mgr.watch_folder(&dir).unwrap();
        assert_eq!(snap.files.len(), 1);
        assert_eq!(snap.files[0].status, FileStatus::Clean);

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn mark_dirty_changes_status() {
        let dir = make_temp_dir("dirty");
        let gpx_path = dir.join("a.gpx");
        fs::write(&gpx_path, sample_gpx("A")).unwrap();

        let mut mgr = GpxSyncManager::new();
        mgr.watch_folder(&dir).unwrap();

        assert_eq!(mgr.files[&gpx_path].status, FileStatus::Clean);
        mgr.mark_dirty(&gpx_path);
        assert_eq!(mgr.files[&gpx_path].status, FileStatus::DirtyInApp);

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn save_gpx_clears_dirty_and_updates_hash() {
        let dir = make_temp_dir("save");
        let gpx_path = dir.join("a.gpx");
        fs::write(&gpx_path, sample_gpx("A")).unwrap();

        let mut mgr = GpxSyncManager::new();
        mgr.watch_folder(&dir).unwrap();
        mgr.mark_dirty(&gpx_path);

        let new_content = sample_gpx("A modified");
        let state = mgr.save_gpx(&gpx_path, &new_content).unwrap();
        assert_eq!(state.status, FileStatus::Clean);
        assert_eq!(state.content_hash, content_hash(new_content.as_bytes()));
        assert_eq!(fs::read_to_string(&gpx_path).unwrap(), new_content);

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn handle_fs_event_suppresses_self_writes() {
        let dir = make_temp_dir("suppress");
        let gpx_path = dir.join("a.gpx");
        fs::write(&gpx_path, sample_gpx("A")).unwrap();

        let mut mgr = GpxSyncManager::new();
        mgr.watch_folder(&dir).unwrap();
        mgr.save_gpx(&gpx_path, &sample_gpx("A saved")).unwrap();

        // The next watcher event should be suppressed
        let events = mgr.handle_fs_event(&gpx_path).unwrap();
        assert!(events.is_empty());
        assert_eq!(mgr.files[&gpx_path].status, FileStatus::Clean);

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn handle_fs_event_detects_external_change_on_clean() {
        let dir = make_temp_dir("ext-change");
        let gpx_path = dir.join("a.gpx");
        fs::write(&gpx_path, sample_gpx("Original")).unwrap();

        let mut mgr = GpxSyncManager::new();
        mgr.watch_folder(&dir).unwrap();

        // Simulate external edit
        fs::write(&gpx_path, sample_gpx("External Edit")).unwrap();
        let events = mgr.handle_fs_event(&gpx_path).unwrap();

        assert_eq!(events.len(), 1);
        assert!(matches!(&events[0], SyncEvent::FileChanged { .. }));
        assert_eq!(mgr.files[&gpx_path].status, FileStatus::ChangedOnDisk);

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn handle_fs_event_detects_conflict_when_dirty() {
        let dir = make_temp_dir("conflict");
        let gpx_path = dir.join("a.gpx");
        fs::write(&gpx_path, sample_gpx("Original")).unwrap();

        let mut mgr = GpxSyncManager::new();
        mgr.watch_folder(&dir).unwrap();
        mgr.mark_dirty(&gpx_path);

        // Simulate external edit while dirty
        fs::write(&gpx_path, sample_gpx("External Conflict")).unwrap();
        let events = mgr.handle_fs_event(&gpx_path).unwrap();

        assert_eq!(events.len(), 1);
        assert!(matches!(&events[0], SyncEvent::Conflict { .. }));
        assert_eq!(mgr.files[&gpx_path].status, FileStatus::Conflict);

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn handle_fs_event_detects_delete() {
        let dir = make_temp_dir("delete");
        let gpx_path = dir.join("a.gpx");
        fs::write(&gpx_path, sample_gpx("ToDelete")).unwrap();

        let mut mgr = GpxSyncManager::new();
        mgr.watch_folder(&dir).unwrap();
        assert!(mgr.files.contains_key(&gpx_path));

        fs::remove_file(&gpx_path).unwrap();
        let events = mgr.handle_fs_event(&gpx_path).unwrap();

        assert_eq!(events.len(), 1);
        assert!(matches!(&events[0], SyncEvent::FileRemoved { .. }));
        assert!(!mgr.files.contains_key(&gpx_path));

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn handle_fs_event_detects_new_file() {
        let dir = make_temp_dir("new-file");
        fs::write(dir.join("existing.gpx"), sample_gpx("Existing")).unwrap();

        let mut mgr = GpxSyncManager::new();
        mgr.watch_folder(&dir).unwrap();
        assert_eq!(mgr.files.len(), 1);

        // New file appears
        let new_path = dir.join("new.gpx");
        fs::write(&new_path, sample_gpx("Brand New")).unwrap();
        let events = mgr.handle_fs_event(&new_path).unwrap();

        assert_eq!(events.len(), 1);
        assert!(matches!(&events[0], SyncEvent::FileAdded { .. }));
        assert_eq!(mgr.files.len(), 2);

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn same_content_does_not_trigger_event() {
        let dir = make_temp_dir("same-content");
        let gpx_path = dir.join("a.gpx");
        let content = sample_gpx("Same");
        fs::write(&gpx_path, &content).unwrap();

        let mut mgr = GpxSyncManager::new();
        mgr.watch_folder(&dir).unwrap();

        // "Change" the file but with identical content
        fs::write(&gpx_path, &content).unwrap();
        let events = mgr.handle_fs_event(&gpx_path).unwrap();
        assert!(events.is_empty());
        assert_eq!(mgr.files[&gpx_path].status, FileStatus::Clean);

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn resolve_keep_disk_clears_conflict() {
        let dir = make_temp_dir("resolve-disk");
        let gpx_path = dir.join("a.gpx");
        fs::write(&gpx_path, sample_gpx("Original")).unwrap();

        let mut mgr = GpxSyncManager::new();
        mgr.watch_folder(&dir).unwrap();
        mgr.mark_dirty(&gpx_path);

        // External edit triggers conflict
        let external = sample_gpx("External");
        fs::write(&gpx_path, &external).unwrap();
        mgr.handle_fs_event(&gpx_path).unwrap();
        assert_eq!(mgr.files[&gpx_path].status, FileStatus::Conflict);

        // Resolve by keeping disk version
        let content = mgr.resolve_keep_disk(&gpx_path).unwrap();
        assert_eq!(content, external);
        assert_eq!(mgr.files[&gpx_path].status, FileStatus::Clean);

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn resolve_keep_app_overwrites_disk() {
        let dir = make_temp_dir("resolve-app");
        let gpx_path = dir.join("a.gpx");
        fs::write(&gpx_path, sample_gpx("Original")).unwrap();

        let mut mgr = GpxSyncManager::new();
        mgr.watch_folder(&dir).unwrap();
        mgr.mark_dirty(&gpx_path);

        // External edit triggers conflict
        fs::write(&gpx_path, sample_gpx("External")).unwrap();
        mgr.handle_fs_event(&gpx_path).unwrap();

        // Resolve by keeping app version
        let app_content = sample_gpx("App Version Wins");
        let state = mgr.resolve_keep_app(&gpx_path, &app_content).unwrap();
        assert_eq!(state.status, FileStatus::Clean);
        assert_eq!(fs::read_to_string(&gpx_path).unwrap(), app_content);

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn ignores_non_gpx_files() {
        let dir = make_temp_dir("non-gpx");
        fs::write(dir.join("a.gpx"), sample_gpx("A")).unwrap();

        let mut mgr = GpxSyncManager::new();
        mgr.watch_folder(&dir).unwrap();

        let txt_path = dir.join("notes.txt");
        fs::write(&txt_path, "some notes").unwrap();
        let events = mgr.handle_fs_event(&txt_path).unwrap();
        assert!(events.is_empty());
        assert_eq!(mgr.files.len(), 1);

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn accept_disk_change_clears_status() {
        let dir = make_temp_dir("accept");
        let gpx_path = dir.join("a.gpx");
        fs::write(&gpx_path, sample_gpx("V1")).unwrap();

        let mut mgr = GpxSyncManager::new();
        mgr.watch_folder(&dir).unwrap();

        fs::write(&gpx_path, sample_gpx("V2")).unwrap();
        mgr.handle_fs_event(&gpx_path).unwrap();
        assert_eq!(mgr.files[&gpx_path].status, FileStatus::ChangedOnDisk);

        mgr.accept_disk_change(&gpx_path);
        assert_eq!(mgr.files[&gpx_path].status, FileStatus::Clean);

        fs::remove_dir_all(dir).unwrap();
    }

    // --- Integration: live watcher ---
    //
    // These tests exercise the real `notify` watcher + debouncer. Key details:
    // - macOS resolves /tmp → /private/var/..., so we canonicalize all paths.
    // - The debouncer has a 500ms window; we sleep 800ms after the action to
    //   let it fire, and use a generous recv timeout.
    // - We collect events across multiple callback batches for robustness.

    fn make_canonical_temp_dir(name: &str) -> PathBuf {
        let dir = make_temp_dir(name);
        // Resolve symlinks (macOS: /var → /private/var) to match watcher paths
        fs::canonicalize(&dir).unwrap_or(dir)
    }

    /// Collect all sync events arriving within `duration`, across multiple batches.
    fn collect_events(
        rx: &std::sync::mpsc::Receiver<Vec<SyncEvent>>,
        duration: std::time::Duration,
    ) -> Vec<SyncEvent> {
        let deadline = std::time::Instant::now() + duration;
        let mut all = Vec::new();
        loop {
            let remaining = deadline.saturating_duration_since(std::time::Instant::now());
            if remaining.is_zero() { break; }
            match rx.recv_timeout(remaining) {
                Ok(batch) => all.extend(batch),
                Err(_) => break,
            }
        }
        all
    }

    #[test]
    fn live_watcher_detects_external_create() {
        let dir = make_canonical_temp_dir("live-create");
        fs::write(dir.join("existing.gpx"), sample_gpx("Existing")).unwrap();

        let manager = new_shared_manager();
        {
            let mut mgr = manager.lock().unwrap();
            mgr.watch_folder(&dir).unwrap();
        }

        let (tx, rx) = std::sync::mpsc::channel::<Vec<SyncEvent>>();
        let _watcher = start_watcher(&dir, manager.clone(), move |events| {
            let _ = tx.send(events);
        })
        .unwrap();

        // Let watcher settle past initial registration noise
        std::thread::sleep(std::time::Duration::from_millis(800));

        fs::write(dir.join("new.gpx"), sample_gpx("New")).unwrap();

        let events = collect_events(&rx, std::time::Duration::from_secs(5));
        assert!(
            events.iter().any(|e| matches!(e, SyncEvent::FileAdded { .. })),
            "Expected FileAdded, got: {events:?}"
        );

        let mgr = manager.lock().unwrap();
        assert_eq!(mgr.files.len(), 2);

        drop(_watcher);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn live_watcher_detects_external_modify() {
        let dir = make_canonical_temp_dir("live-modify");
        let gpx_path = dir.join("track.gpx");
        fs::write(&gpx_path, sample_gpx("Original")).unwrap();

        let manager = new_shared_manager();
        {
            let mut mgr = manager.lock().unwrap();
            mgr.watch_folder(&dir).unwrap();
        }

        let (tx, rx) = std::sync::mpsc::channel::<Vec<SyncEvent>>();
        let _watcher = start_watcher(&dir, manager.clone(), move |events| {
            let _ = tx.send(events);
        })
        .unwrap();

        std::thread::sleep(std::time::Duration::from_millis(800));

        fs::write(&gpx_path, sample_gpx("Modified")).unwrap();

        let events = collect_events(&rx, std::time::Duration::from_secs(5));
        assert!(
            events.iter().any(|e| matches!(e, SyncEvent::FileChanged { .. })),
            "Expected FileChanged, got: {events:?}"
        );

        let mgr = manager.lock().unwrap();
        assert_eq!(mgr.files[&gpx_path].status, FileStatus::ChangedOnDisk);

        drop(_watcher);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn live_watcher_detects_external_delete() {
        let dir = make_canonical_temp_dir("live-delete");
        let gpx_path = dir.join("track.gpx");
        fs::write(&gpx_path, sample_gpx("ToDelete")).unwrap();

        let manager = new_shared_manager();
        {
            let mut mgr = manager.lock().unwrap();
            mgr.watch_folder(&dir).unwrap();
        }

        let (tx, rx) = std::sync::mpsc::channel::<Vec<SyncEvent>>();
        let _watcher = start_watcher(&dir, manager.clone(), move |events| {
            let _ = tx.send(events);
        })
        .unwrap();

        std::thread::sleep(std::time::Duration::from_millis(800));

        fs::remove_file(&gpx_path).unwrap();

        let events = collect_events(&rx, std::time::Duration::from_secs(5));
        assert!(
            events.iter().any(|e| matches!(e, SyncEvent::FileRemoved { .. })),
            "Expected FileRemoved, got: {events:?}"
        );

        let mgr = manager.lock().unwrap();
        assert!(mgr.files.is_empty());

        drop(_watcher);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn live_watcher_suppresses_self_write() {
        let dir = make_canonical_temp_dir("live-suppress");
        let gpx_path = dir.join("track.gpx");
        fs::write(&gpx_path, sample_gpx("Original")).unwrap();

        let manager = new_shared_manager();
        {
            let mut mgr = manager.lock().unwrap();
            mgr.watch_folder(&dir).unwrap();
        }

        let (tx, rx) = std::sync::mpsc::channel::<Vec<SyncEvent>>();
        let _watcher = start_watcher(&dir, manager.clone(), move |events| {
            let _ = tx.send(events);
        })
        .unwrap();

        std::thread::sleep(std::time::Duration::from_millis(800));

        // Save via manager (adds path to suppression list)
        {
            let mut mgr = manager.lock().unwrap();
            mgr.save_gpx(&gpx_path, &sample_gpx("App Save")).unwrap();
        }

        // Collect events over a window; suppression means either no events or empty batches.
        let events = collect_events(&rx, std::time::Duration::from_secs(3));
        assert!(
            events.is_empty(),
            "Expected no sync events after self-write, got: {events:?}"
        );

        let mgr = manager.lock().unwrap();
        assert_eq!(mgr.files[&gpx_path].status, FileStatus::Clean);

        drop(_watcher);
        fs::remove_dir_all(dir).unwrap();
    }
}
