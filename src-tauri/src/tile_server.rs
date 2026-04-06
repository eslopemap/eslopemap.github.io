// Localhost tile server for offline MBTiles serving.
// Refactored from spike_demo/shared_backend + spike_demo/mbtiles_to_localhost.

use std::path::{Path, PathBuf};
use std::thread;

use http::StatusCode;
use rusqlite::{params, Connection};
use tiny_http::{Header, Response, Server};

pub const DEFAULT_TILE_PORT: u16 = 14321;

// ---------------------------------------------------------------------------
// Tile request/response types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// MBTiles helpers
// ---------------------------------------------------------------------------

/// Convert XYZ y to TMS y (MBTiles convention).
pub fn xyz_to_tms_row(z: u32, y: u32) -> u32 {
    (1 << z) - 1 - y
}

pub fn detect_mime(ext: &str) -> &'static str {
    match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "pbf" => "application/x-protobuf",
        _ => "application/octet-stream",
    }
}

/// Parse `/tiles/<source>/<z>/<x>/<y>.<ext>` from an HTTP request path.
pub fn parse_tile_path(path: &str) -> Option<TileRequest> {
    let clean_path = path.split('?').next()?;
    let segments: Vec<&str> = clean_path.trim_start_matches('/').split('/').collect();
    if segments.len() != 5 || segments[0] != "tiles" {
        return None;
    }
    let (y_str, ext) = segments[4].rsplit_once('.')?;
    Some(TileRequest {
        source: segments[1].to_string(),
        z: segments[2].parse().ok()?,
        x: segments[3].parse().ok()?,
        y: y_str.parse().ok()?,
        ext: ext.to_ascii_lowercase(),
    })
}

/// Read one tile from an MBTiles file.
pub fn load_tile_bytes(mbtiles_path: &Path, z: u32, x: u32, y: u32) -> Result<Option<Vec<u8>>, rusqlite::Error> {
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

/// Resolve a tile request against a known MBTiles source.
pub fn resolve_tile_request(
    sources: &[(String, PathBuf)],
    request: &TileRequest,
) -> TileResponse {
    let mbtiles_path = sources.iter().find(|(name, _)| name == &request.source).map(|(_, p)| p);

    let Some(mbtiles_path) = mbtiles_path else {
        return TileResponse {
            status: 404,
            content_type: "text/plain; charset=utf-8",
            body: Vec::new(),
        };
    };

    match load_tile_bytes(mbtiles_path, request.z, request.x, request.y) {
        Ok(Some(bytes)) => TileResponse {
            status: 200,
            content_type: detect_mime(&request.ext),
            body: bytes,
        },
        Ok(None) => TileResponse {
            status: 404,
            content_type: "text/plain; charset=utf-8",
            body: Vec::new(),
        },
        Err(e) => {
            eprintln!("[tile-server] sqlite error: {e}");
            TileResponse {
                status: 500,
                content_type: "text/plain; charset=utf-8",
                body: e.to_string().into_bytes(),
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Tile server lifecycle
// ---------------------------------------------------------------------------

/// Spawn a localhost-only tile server on the given port.
/// `sources` maps source names to MBTiles file paths.
pub fn spawn_tile_server(port: u16, sources: Vec<(String, PathBuf)>) {
    thread::spawn(move || {
        let addr = format!("127.0.0.1:{port}");
        let server = match Server::http(&addr) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[tile-server] failed to bind {addr}: {e}");
                return;
            }
        };
        println!("[tile-server] listening on http://{addr}");
        for (name, path) in &sources {
            println!("[tile-server] source '{name}' -> {}", path.display());
        }

        for request in server.incoming_requests() {
            let raw_url = request.url().to_string();
            let Some(parsed) = parse_tile_path(&raw_url) else {
                let _ = request.respond(Response::empty(StatusCode::NOT_FOUND.as_u16()));
                continue;
            };

            let tile_response = resolve_tile_request(&sources, &parsed);
            let mut response = Response::from_data(tile_response.body)
                .with_status_code(tile_response.status);
            if let Ok(header) = Header::from_bytes("Content-Type", tile_response.content_type) {
                response = response.with_header(header);
            }
            if let Ok(header) = Header::from_bytes("Access-Control-Allow-Origin", "*") {
                response = response.with_header(header);
            }
            let _ = request.respond(response);
        }
    });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

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
    fn parses_tile_paths() {
        let parsed = parse_tile_path("/tiles/dummy/2/1/3.png").unwrap();
        assert_eq!(parsed.source, "dummy");
        assert_eq!(parsed.z, 2);
        assert_eq!(parsed.x, 1);
        assert_eq!(parsed.y, 3);
        assert_eq!(parsed.ext, "png");
    }

    #[test]
    fn parses_tile_path_with_query() {
        let parsed = parse_tile_path("/tiles/osm/5/10/15.png?v=1").unwrap();
        assert_eq!(parsed.source, "osm");
        assert_eq!(parsed.z, 5);
        assert_eq!(parsed.y, 15);
    }

    #[test]
    fn rejects_invalid_paths() {
        assert!(parse_tile_path("/invalid/path").is_none());
        assert!(parse_tile_path("/tiles/src").is_none());
        assert!(parse_tile_path("/tiles/src/1/2/nope").is_none());
    }

    #[test]
    fn detects_mime_types() {
        assert_eq!(detect_mime("png"), "image/png");
        assert_eq!(detect_mime("webp"), "image/webp");
        assert_eq!(detect_mime("pbf"), "application/x-protobuf");
    }

    #[test]
    fn loads_known_tile_and_returns_none_for_unknown() {
        let path = temp_db_path("tile-server-test");
        write_test_mbtiles(&path);

        let found = load_tile_bytes(&path, 2, 1, 3).unwrap();
        assert_eq!(found, Some(vec![1_u8, 2, 3]));

        let missing = load_tile_bytes(&path, 2, 0, 0).unwrap();
        assert!(missing.is_none());

        fs::remove_file(path).unwrap();
    }

    #[test]
    fn resolve_returns_404_for_unknown_source() {
        let sources = vec![("known".to_string(), PathBuf::from("/nonexistent"))];
        let req = TileRequest {
            source: "unknown".to_string(),
            z: 1, x: 0, y: 0, ext: "png".to_string(),
        };
        let resp = resolve_tile_request(&sources, &req);
        assert_eq!(resp.status, 404);
    }
}
