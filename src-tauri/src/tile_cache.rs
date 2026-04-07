// Disk-backed tile cache with LRU eviction.
//
// Layout:  <cache_root>/<source>/<z>/<x>/<y>.<ext>
// Example: ~/.cache/slopemapper/tiles/dem/10/530/365.webp
//
// The cache acts as a transparent proxy: if a tile is on disk, serve it.
// Otherwise fetch from the upstream URL, write to disk, then serve.
// When total size exceeds the configured limit, the oldest-accessed files
// are evicted.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Cached upstream source definition
// ---------------------------------------------------------------------------

/// A tile source backed by a remote URL with a local disk cache.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedUpstreamSource {
    /// Source name (e.g. "dem").
    pub name: String,
    /// Upstream URL template with `{z}`, `{x}`, `{y}` placeholders.
    pub upstream_url: String,
}

pub type SharedCachedSources = Arc<Mutex<Vec<CachedUpstreamSource>>>;

// ---------------------------------------------------------------------------
// Tile cache
// ---------------------------------------------------------------------------

/// Thread-safe disk tile cache.
#[derive(Debug, Clone)]
pub struct TileCache {
    inner: Arc<Mutex<TileCacheInner>>,
}

#[derive(Debug)]
struct TileCacheInner {
    root: PathBuf,
    max_bytes: u64,
}

impl TileCache {
    /// Create a new cache rooted at `root` with a maximum size in bytes.
    pub fn new(root: PathBuf, max_bytes: u64) -> Self {
        if let Err(e) = fs::create_dir_all(&root) {
            eprintln!("[tile-cache] failed to create cache dir {}: {e}", root.display());
        }
        println!(
            "[tile-cache] initialized at {} (max {} MB)",
            root.display(),
            max_bytes / (1024 * 1024)
        );
        Self {
            inner: Arc::new(Mutex::new(TileCacheInner { root, max_bytes })),
        }
    }

    /// Return the cache root directory.
    pub fn root(&self) -> PathBuf {
        self.inner.lock().unwrap().root.clone()
    }

    /// Get a tile from cache, or fetch from upstream if missing.
    /// Returns `(status_code, content_type, body)`.
    pub fn get_or_fetch(
        &self,
        source: &str,
        z: u32,
        x: u32,
        y: u32,
        ext: &str,
        upstream_url: &str,
    ) -> (u16, &'static str, Vec<u8>) {
        let rel = format!("{source}/{z}/{x}/{y}.{ext}");
        let file_path = {
            let inner = self.inner.lock().unwrap();
            inner.root.join(&rel)
        };

        // Cache hit
        if file_path.exists() {
            // Touch access time for LRU
            touch_file(&file_path);
            match fs::read(&file_path) {
                Ok(data) => {
                    return (200, mime_for_ext(ext), data);
                }
                Err(e) => {
                    eprintln!("[tile-cache] read error {}: {e}", file_path.display());
                    // Fall through to upstream fetch
                }
            }
        }

        // Resolve the full upstream URL
        let url = upstream_url
            .replace("{z}", &z.to_string())
            .replace("{x}", &x.to_string())
            .replace("{y}", &y.to_string());

        // Fetch from upstream
        match ureq::get(&url).call() {
            Ok(response) => {
                let status = response.status();
                if status != 200 {
                    return (status, "text/plain; charset=utf-8", Vec::new());
                }
                let mut body = Vec::new();
                if let Err(e) = response.into_reader().read_to_end(&mut body) {
                    eprintln!("[tile-cache] upstream read error for {url}: {e}");
                    return (502, "text/plain; charset=utf-8", b"upstream read error".to_vec());
                }

                // Write to cache
                if let Some(parent) = file_path.parent() {
                    let _ = fs::create_dir_all(parent);
                }
                match fs::File::create(&file_path) {
                    Ok(mut f) => {
                        if let Err(e) = f.write_all(&body) {
                            eprintln!("[tile-cache] write error {}: {e}", file_path.display());
                        }
                    }
                    Err(e) => {
                        eprintln!("[tile-cache] create error {}: {e}", file_path.display());
                    }
                }

                // Async eviction: don't block the response
                let cache = self.clone();
                std::thread::spawn(move || {
                    cache.evict_if_needed();
                });

                (200, mime_for_ext(ext), body)
            }
            Err(e) => {
                eprintln!("[tile-cache] upstream fetch error for {url}: {e}");
                // Try to distinguish 404 from network errors
                if let Some(status) = extract_status_from_ureq_error(&e) {
                    (status, "text/plain; charset=utf-8", Vec::new())
                } else {
                    (502, "text/plain; charset=utf-8", format!("upstream error: {e}").into_bytes())
                }
            }
        }
    }

    /// Directly inject a tile into the cache (used by tests).
    pub fn inject_tile(
        &self,
        source: &str,
        z: u32,
        x: u32,
        y: u32,
        ext: &str,
        data: &[u8],
    ) -> Result<PathBuf, String> {
        let rel = format!("{source}/{z}/{x}/{y}.{ext}");
        let file_path = {
            let inner = self.inner.lock().unwrap();
            inner.root.join(&rel)
        };
        if let Some(parent) = file_path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("mkdir: {e}"))?;
        }
        fs::write(&file_path, data).map_err(|e| format!("write: {e}"))?;
        Ok(file_path)
    }

    /// Compute total cache size in bytes.
    pub fn total_size_bytes(&self) -> u64 {
        let root = self.root();
        dir_size(&root)
    }

    /// Evict oldest-accessed files until cache is under the limit.
    pub fn evict_if_needed(&self) {
        let (root, max_bytes) = {
            let inner = self.inner.lock().unwrap();
            (inner.root.clone(), inner.max_bytes)
        };

        let total = dir_size(&root);
        if total <= max_bytes {
            return;
        }

        let to_free = total - max_bytes;
        let mut entries = collect_cache_files(&root);

        // Sort by access time ascending (oldest first)
        entries.sort_by_key(|(_, _, atime)| *atime);

        let mut freed: u64 = 0;
        let mut removed = 0;
        for (path, size, _) in &entries {
            if freed >= to_free {
                break;
            }
            if fs::remove_file(path).is_ok() {
                freed += size;
                removed += 1;
            }
        }

        if removed > 0 {
            println!(
                "[tile-cache] evicted {removed} files, freed {} KB",
                freed / 1024
            );
        }
    }

    /// Get cache stats.
    pub fn stats(&self) -> CacheStats {
        let root = self.root();
        let files = collect_cache_files(&root);
        CacheStats {
            root: root.to_string_lossy().to_string(),
            total_size_bytes: files.iter().map(|(_, s, _)| s).sum(),
            file_count: files.len() as u64,
            max_size_bytes: self.inner.lock().unwrap().max_bytes,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CacheStats {
    pub root: String,
    pub total_size_bytes: u64,
    pub file_count: u64,
    pub max_size_bytes: u64,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn mime_for_ext(ext: &str) -> &'static str {
    match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "pbf" => "application/x-protobuf",
        _ => "application/octet-stream",
    }
}

fn touch_file(path: &Path) {
    // Update the file's modification time to "now" for LRU tracking.
    // We use mtime since atime is unreliable on many filesystems.
    let now = filetime::FileTime::now();
    let _ = filetime::set_file_mtime(path, now);
}

fn dir_size(path: &Path) -> u64 {
    let mut total = 0;
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            let ft = entry.file_type().unwrap_or_else(|_| unreachable!());
            if ft.is_file() {
                total += entry.metadata().map(|m| m.len()).unwrap_or(0);
            } else if ft.is_dir() {
                total += dir_size(&entry.path());
            }
        }
    }
    total
}

/// Collect all files under `root` with (path, size, mtime).
fn collect_cache_files(root: &Path) -> Vec<(PathBuf, u64, SystemTime)> {
    let mut out = Vec::new();
    collect_files_recursive(root, &mut out);
    out
}

fn collect_files_recursive(dir: &Path, out: &mut Vec<(PathBuf, u64, SystemTime)>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            if let Ok(meta) = path.metadata() {
                let mtime = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
                out.push((path, meta.len(), mtime));
            }
        } else if path.is_dir() {
            collect_files_recursive(&path, out);
        }
    }
}

fn extract_status_from_ureq_error(e: &ureq::Error) -> Option<u16> {
    match e {
        ureq::Error::Status(code, _) => Some(*code),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    use std::sync::atomic::{AtomicU64, Ordering};
    static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn temp_cache() -> (TileCache, PathBuf) {
        let id = TEST_COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!(
            "slope-cache-test-{}-{id}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let cache = TileCache::new(dir.clone(), 1024 * 1024); // 1 MB
        (cache, dir)
    }

    fn cleanup(dir: &Path) {
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn inject_and_read_tile() {
        let (cache, dir) = temp_cache();

        let data = b"fake-png-tile-data";
        let path = cache.inject_tile("dem", 10, 530, 365, "webp", data).unwrap();
        assert!(path.exists());

        // Read it back via the cache (should be a hit, no upstream fetch)
        // We can't use get_or_fetch without a real upstream, but we can check the file
        let read_back = fs::read(&path).unwrap();
        assert_eq!(read_back, data);

        cleanup(&dir);
    }

    #[test]
    fn total_size_tracks_files() {
        let (cache, dir) = temp_cache();

        cache.inject_tile("dem", 1, 0, 0, "png", &[0; 100]).unwrap();
        cache.inject_tile("dem", 1, 0, 1, "png", &[0; 200]).unwrap();

        assert_eq!(cache.total_size_bytes(), 300);

        cleanup(&dir);
    }

    #[test]
    fn eviction_removes_oldest() {
        let dir = std::env::temp_dir().join(format!(
            "slope-cache-evict-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        // Max 500 bytes
        let cache = TileCache::new(dir.clone(), 500);

        // Inject 3 files of 200 bytes each = 600 bytes (over 500 limit)
        cache.inject_tile("src", 0, 0, 0, "png", &[0; 200]).unwrap();
        std::thread::sleep(Duration::from_millis(50));
        cache.inject_tile("src", 0, 0, 1, "png", &[1; 200]).unwrap();
        std::thread::sleep(Duration::from_millis(50));
        cache.inject_tile("src", 0, 0, 2, "png", &[2; 200]).unwrap();

        assert_eq!(cache.total_size_bytes(), 600);

        cache.evict_if_needed();

        // Should have evicted at least the oldest file to get under 500
        let remaining = cache.total_size_bytes();
        assert!(remaining <= 500, "remaining={remaining}");

        cleanup(&dir);
    }

    #[test]
    fn stats_reports_correctly() {
        let (cache, dir) = temp_cache();

        cache.inject_tile("dem", 5, 0, 0, "webp", &[0; 1000]).unwrap();
        cache.inject_tile("dem", 5, 0, 1, "webp", &[0; 2000]).unwrap();

        let stats = cache.stats();
        assert_eq!(stats.total_size_bytes, 3000);
        assert_eq!(stats.file_count, 2);
        assert_eq!(stats.max_size_bytes, 1024 * 1024);

        cleanup(&dir);
    }

    #[test]
    fn cache_hit_returns_correct_data() {
        let (cache, dir) = temp_cache();

        let tile_data = b"test-webp-content";
        cache.inject_tile("dem", 10, 530, 365, "webp", tile_data).unwrap();

        // get_or_fetch with a bogus upstream should still return cached data
        let (status, ct, body) = cache.get_or_fetch(
            "dem", 10, 530, 365, "webp",
            "http://localhost:1/SHOULD-NOT-BE-CALLED/{z}/{x}/{y}.webp",
        );
        assert_eq!(status, 200);
        assert_eq!(ct, "image/webp");
        assert_eq!(body, tile_data);

        cleanup(&dir);
    }
}
