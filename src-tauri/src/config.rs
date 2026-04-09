// App configuration loaded from slopemapper.toml.
// Config file location follows OS conventions:
//   macOS:  ~/Library/Application Support/slopemapper/slopemapper.toml
//   Linux:  $XDG_CONFIG_HOME/slopemapper/slopemapper.toml  (default ~/.config/…)
//   Windows: {FOLDERID_RoamingAppData}\slopemapper\slopemapper.toml

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Public config types
// ---------------------------------------------------------------------------

/// Top-level configuration.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct AppConfig {
    pub cache: CacheConfig,
    pub sources: SourcesConfig,
}

/// Tile cache settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct CacheConfig {
    /// Maximum disk cache size in megabytes.
    pub max_size_mb: u64,
    /// Override the cache directory (absolute path). If empty, uses OS default.
    pub path: String,
}

/// Tile source discovery settings.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct SourcesConfig {
    /// Folders to scan for .mbtiles/.pmtiles files on startup.
    pub folders: Vec<String>,
}

impl Default for CacheConfig {
    fn default() -> Self {
        Self {
            max_size_mb: 100,
            path: String::new(),
        }
    }
}

// ---------------------------------------------------------------------------
// Config file I/O
// ---------------------------------------------------------------------------

/// Resolve the OS-standard config directory for slopemapper.
pub fn config_dir() -> Option<PathBuf> {
    dirs::config_dir().map(|d| d.join("slopemapper"))
}

/// Resolve the OS-standard cache directory for slopemapper.
pub fn cache_dir() -> Option<PathBuf> {
    dirs::cache_dir().map(|d| d.join("slopemapper"))
}

/// Full path to slopemapper.toml.
pub fn config_file_path() -> Option<PathBuf> {
    config_dir().map(|d| d.join("slopemapper.toml"))
}

fn tauri_e2e_tests_enabled() -> bool {
    match std::env::var("TAURI_E2E_TESTS") {
        Ok(value) => value == "1" || value.eq_ignore_ascii_case("true"),
        Err(_) => false,
    }
}

pub fn test_state_root() -> PathBuf {
    std::env::temp_dir().join("slopemapper-tauri-e2e")
}

pub fn effective_config_file_path() -> Option<PathBuf> {
    if tauri_e2e_tests_enabled() {
        return Some(test_state_root().join("slopemapper.toml"));
    }
    config_file_path()
}

/// Load config from the default location. Returns defaults if file is missing.
pub fn load_config() -> AppConfig {
    let Some(path) = effective_config_file_path() else {
        println!("[config] no config dir available, using defaults");
        return AppConfig::default();
    };
    load_config_from(&path)
}

/// Load config from a specific path. Returns defaults if file is missing.
pub fn load_config_from(path: &Path) -> AppConfig {
    match std::fs::read_to_string(path) {
        Ok(contents) => match toml::from_str::<AppConfig>(&contents) {
            Ok(cfg) => {
                println!("[config] loaded from {}", path.display());
                cfg
            }
            Err(e) => {
                eprintln!("[config] parse error in {}: {e}", path.display());
                AppConfig::default()
            }
        },
        Err(_) => {
            println!("[config] {} not found, using defaults", path.display());
            AppConfig::default()
        }
    }
}

/// Resolve the effective tile cache directory from config.
pub fn resolve_cache_dir(cfg: &AppConfig) -> PathBuf {
    if tauri_e2e_tests_enabled() {
        return test_state_root().join("tiles");
    }
    if !cfg.cache.path.is_empty() {
        return PathBuf::from(&cfg.cache.path);
    }
    cache_dir()
        .map(|d| d.join("tiles"))
        .unwrap_or_else(|| PathBuf::from("/tmp/slopemapper/tiles"))
}

/// Save config to the default location.
pub fn save_config(cfg: &AppConfig) -> Result<(), String> {
    let Some(path) = effective_config_file_path() else {
        return Err("no config dir available".to_string());
    };
    save_config_to(cfg, &path)
}

/// Save config to a specific path.
pub fn save_config_to(cfg: &AppConfig, path: &Path) -> Result<(), String> {
    let contents = toml::to_string_pretty(cfg).map_err(|e| format!("serialize: {e}"))?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir: {e}"))?;
    }
    std::fs::write(path, contents).map_err(|e| format!("write: {e}"))?;
    println!("[config] saved to {}", path.display());
    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_has_sane_values() {
        let cfg = AppConfig::default();
        assert_eq!(cfg.cache.max_size_mb, 100);
        assert!(cfg.cache.path.is_empty());
        assert!(cfg.sources.folders.is_empty());
    }

    #[test]
    fn parses_minimal_toml() {
        let toml_str = r#"
[cache]
max_size_mb = 500
"#;
        let cfg: AppConfig = toml::from_str(toml_str).unwrap();
        assert_eq!(cfg.cache.max_size_mb, 500);
        assert!(cfg.cache.path.is_empty());
    }

    #[test]
    fn parses_full_toml() {
        let toml_str = r#"
[cache]
max_size_mb = 250
path = "/custom/tile-cache"
"#;
        let cfg: AppConfig = toml::from_str(toml_str).unwrap();
        assert_eq!(cfg.cache.max_size_mb, 250);
        assert_eq!(cfg.cache.path, "/custom/tile-cache");
    }

    #[test]
    fn empty_toml_gives_defaults() {
        let cfg: AppConfig = toml::from_str("").unwrap();
        assert_eq!(cfg.cache.max_size_mb, 100);
    }

    #[test]
    fn resolve_cache_dir_uses_override() {
        let mut cfg = AppConfig::default();
        cfg.cache.path = "/my/cache".to_string();
        assert_eq!(resolve_cache_dir(&cfg), PathBuf::from("/my/cache"));
    }

    #[test]
    fn resolve_cache_dir_uses_os_default() {
        let cfg = AppConfig::default();
        let dir = resolve_cache_dir(&cfg);
        // Should end in slopemapper/tiles (or /tmp fallback)
        let s = dir.to_string_lossy();
        assert!(s.contains("slopemapper") || s.contains("tmp"), "got: {s}");
    }

    #[test]
    fn config_dir_returns_some() {
        // On all supported platforms this should be Some
        assert!(config_dir().is_some());
    }

    #[test]
    fn parses_sources_folders() {
        let toml_str = r#"
[sources]
folders = ["/home/user/maps", "/data/tiles"]
"#;
        let cfg: AppConfig = toml::from_str(toml_str).unwrap();
        assert_eq!(cfg.sources.folders.len(), 2);
        assert_eq!(cfg.sources.folders[0], "/home/user/maps");
    }

    #[test]
    fn full_config_with_sources_and_cache() {
        let toml_str = r#"
[cache]
max_size_mb = 200

[sources]
folders = ["/tiles"]
"#;
        let cfg: AppConfig = toml::from_str(toml_str).unwrap();
        assert_eq!(cfg.cache.max_size_mb, 200);
        assert_eq!(cfg.sources.folders, vec!["/tiles"]);
    }
}
