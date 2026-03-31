use std::{error::Error, fmt, path::{Path, PathBuf}};

use http::Uri;
use rusqlite::{params, Connection};

pub const DEFAULT_TILESET_NAME: &str = "dummy";
pub const DEFAULT_MBTILES_RELATIVE_PATH: &str = "../../../tests/fixtures/tiles/dummy-z1-z3.mbtiles";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TileRequest {
    pub source: String,
    pub z: u32,
    pub x: u32,
    pub y: u32,
    pub ext: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TileResponse {
    pub status: u16,
    pub content_type: &'static str,
    pub body: Vec<u8>,
}

#[derive(Debug)]
pub enum BackendError {
    Sqlite(rusqlite::Error),
}

impl fmt::Display for BackendError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Sqlite(err) => write!(f, "sqlite error: {err}"),
        }
    }
}

impl Error for BackendError {}

impl From<rusqlite::Error> for BackendError {
    fn from(value: rusqlite::Error) -> Self {
        Self::Sqlite(value)
    }
}

/// Resolve the shared deterministic MBTiles fixture path relative to a demo's `src-tauri` directory.
pub fn fixture_mbtiles_path(manifest_dir: &str) -> PathBuf {
    Path::new(manifest_dir).join(DEFAULT_MBTILES_RELATIVE_PATH)
}

/// Convert an XYZ tile row into the MBTiles/TMS row convention.
pub fn xyz_to_tms_row(z: u32, y: u32) -> u32 {
    (1 << z) - 1 - y
}

/// Select the MIME type based on the requested extension.
pub fn detect_mime(ext: &str) -> &'static str {
    match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        _ => "application/octet-stream",
    }
}

/// Parse `/tiles/<source>/<z>/<x>/<y>.<ext>` from the localhost demo.
pub fn parse_localhost_request_path(path: &str) -> Option<TileRequest> {
    let clean_path = path.split('?').next()?;
    let segments = clean_path.trim_start_matches('/').split('/').collect::<Vec<_>>();
    if segments.len() != 5 || segments[0] != "tiles" {
        return None;
    }
    parse_tile_segments(segments[1], segments[2], segments[3], segments[4])
}

/// Parse `<scheme>://<source>/<z>/<x>/<y>.<ext>` from the custom protocol demo.
pub fn parse_protocol_request(uri: &Uri) -> Option<TileRequest> {
    let host = uri.host().unwrap_or(DEFAULT_TILESET_NAME);
    let path = uri.path().trim_start_matches('/');
    let segments = path.split('/').collect::<Vec<_>>();
    if segments.len() == 3 {
        return parse_tile_segments(host, segments[0], segments[1], segments[2]);
    }
    if segments.len() == 4 {
        return parse_tile_segments(segments[0], segments[1], segments[2], segments[3]);
    }
    None
}

fn parse_tile_segments(source: &str, z: &str, x: &str, y_with_ext: &str) -> Option<TileRequest> {
    let (y, ext) = y_with_ext.rsplit_once('.')?;
    Some(TileRequest {
        source: source.to_string(),
        z: z.parse().ok()?,
        x: x.parse().ok()?,
        y: y.parse().ok()?,
        ext: ext.to_ascii_lowercase(),
    })
}

/// Read one tile from the shared MBTiles fixture.
pub fn load_tile_bytes(mbtiles_path: &Path, z: u32, x: u32, y: u32) -> Result<Option<Vec<u8>>, BackendError> {
    let conn = Connection::open(mbtiles_path)?;
    let tms_y = xyz_to_tms_row(z, y);
    let mut stmt = conn.prepare(
        "SELECT tile_data FROM tiles WHERE zoom_level = ?1 AND tile_column = ?2 AND tile_row = ?3",
    )?;
    let mut rows = stmt.query(params![z, x, tms_y])?;
    if let Some(row) = rows.next()? {
        let data: Vec<u8> = row.get(0)?;
        return Ok(Some(data));
    }
    Ok(None)
}

/// Resolve a parsed tile request into a simple HTTP-like response shape.
pub fn resolve_tile_request(mbtiles_path: &Path, request: &TileRequest) -> Result<TileResponse, BackendError> {
    if request.source != DEFAULT_TILESET_NAME {
        return Ok(TileResponse {
            status: 404,
            content_type: "text/plain; charset=utf-8",
            body: Vec::new(),
        });
    }

    let Some(bytes) = load_tile_bytes(mbtiles_path, request.z, request.x, request.y)? else {
        return Ok(TileResponse {
            status: 404,
            content_type: "text/plain; charset=utf-8",
            body: Vec::new(),
        });
    };

    Ok(TileResponse {
        status: 200,
        content_type: detect_mime(&request.ext),
        body: bytes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, time::{SystemTime, UNIX_EPOCH}};

    fn temp_db_path(name: &str) -> PathBuf {
        let unique = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        std::env::temp_dir().join(format!("{name}-{unique}.mbtiles"))
    }

    fn write_test_mbtiles(path: &Path) {
        let conn = Connection::open(path).unwrap();
        conn.execute_batch(
            "
            CREATE TABLE metadata (name TEXT NOT NULL, value TEXT NOT NULL);
            CREATE TABLE tiles (
                zoom_level INTEGER NOT NULL,
                tile_column INTEGER NOT NULL,
                tile_row INTEGER NOT NULL,
                tile_data BLOB NOT NULL
            );
            CREATE UNIQUE INDEX tile_index ON tiles (zoom_level, tile_column, tile_row);
            ",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tiles(zoom_level, tile_column, tile_row, tile_data) VALUES (?1, ?2, ?3, ?4)",
            params![2_u32, 1_u32, xyz_to_tms_row(2, 3), vec![1_u8, 2, 3]],
        )
        .unwrap();
    }

    #[test]
    fn converts_xyz_rows_to_tms() {
        assert_eq!(xyz_to_tms_row(1, 0), 1);
        assert_eq!(xyz_to_tms_row(1, 1), 0);
        assert_eq!(xyz_to_tms_row(3, 5), 2);
    }

    #[test]
    fn parses_localhost_paths() {
        let parsed = parse_localhost_request_path("/tiles/dummy/2/1/3.png").unwrap();
        assert_eq!(parsed.source, "dummy");
        assert_eq!(parsed.z, 2);
        assert_eq!(parsed.x, 1);
        assert_eq!(parsed.y, 3);
        assert_eq!(parsed.ext, "png");
    }

    #[test]
    fn parses_custom_protocol_uris() {
        let uri: Uri = "mbtiles-demo://dummy/2/1/3.png".parse().unwrap();
        let parsed = parse_protocol_request(&uri).unwrap();
        assert_eq!(parsed.source, "dummy");
        assert_eq!(parsed.z, 2);
        assert_eq!(parsed.x, 1);
        assert_eq!(parsed.y, 3);
        assert_eq!(parsed.ext, "png");

        let localhost_style: Uri = "http://mbtiles-demo.localhost/dummy/2/1/3.png".parse().unwrap();
        let parsed_localhost_style = parse_protocol_request(&localhost_style).unwrap();
        assert_eq!(parsed_localhost_style.source, "dummy");
        assert_eq!(parsed_localhost_style.z, 2);
        assert_eq!(parsed_localhost_style.x, 1);
        assert_eq!(parsed_localhost_style.y, 3);
        assert_eq!(parsed_localhost_style.ext, "png");
    }

    #[test]
    fn detects_png_mime() {
        assert_eq!(detect_mime("png"), "image/png");
    }

    #[test]
    fn loads_known_tile_and_returns_missing_for_unknown_tile() {
        let path = temp_db_path("spike-shared-backend");
        write_test_mbtiles(&path);

        let found = load_tile_bytes(&path, 2, 1, 3).unwrap();
        assert_eq!(found, Some(vec![1_u8, 2, 3]));

        let missing = load_tile_bytes(&path, 2, 0, 0).unwrap();
        assert!(missing.is_none());

        fs::remove_file(path).unwrap();
    }
}
