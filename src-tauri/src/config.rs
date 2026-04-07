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
#[derive(Debug, Clone, Serialize, Deserialize)]
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
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct SourcesConfig {
    /// Folders to scan for .mbtiles/.pmtiles files on startup.
    pub folders: Vec<String>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            cache: CacheConfig::default(),
            sources: SourcesConfig::default(),
        }
    }
}

impl Default for SourcesConfig {
    fn default() -> Self {
        Self {
            folders: Vec::new(),
        }
    }
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

/// Load config from the default location. Returns defaults if file is missing.
pub fn load_config() -> AppConfig {
    let Some(path) = config_file_path() else {
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
    if !cfg.cache.path.is_empty() {
        return PathBuf::from(&cfg.cache.path);
    }
    cache_dir()
        .map(|d| d.join("tiles"))
        .unwrap_or_else(|| PathBuf::from("/tmp/slopemapper/tiles"))
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
