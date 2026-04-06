// Localhost tile server for offline MBTiles + PMTiles serving.
// MBTiles: served via /tiles/{source}/{z}/{x}/{y}.{ext} (server-side tile lookup)
// PMTiles: served via /pmtiles/{source} with HTTP Range support (client-side tile extraction)

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;

use http::StatusCode;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tiny_http::{Header, Response, Server};

pub const DEFAULT_TILE_PORT: u16 = 14321;

// ---------------------------------------------------------------------------
// Tile source types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TileSourceKind {
    Mbtiles,
    Pmtiles,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TileSourceEntry {
    pub name: String,
    pub path: PathBuf,
    pub kind: TileSourceKind,
}

pub type SharedTileSources = Arc<Mutex<Vec<TileSourceEntry>>>;

/// Detect source kind from file extension.
pub fn detect_source_kind(path: &Path) -> Option<TileSourceKind> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "mbtiles" => Some(TileSourceKind::Mbtiles),
        "pmtiles" => Some(TileSourceKind::Pmtiles),
        _ => None,
    }
}

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

/// Resolve a tile request against known sources.
pub fn resolve_tile_request(
    sources: &[TileSourceEntry],
    request: &TileRequest,
) -> TileResponse {
    let entry = sources.iter().find(|e| e.name == request.source);

    let Some(entry) = entry else {
        return TileResponse {
            status: 404,
            content_type: "text/plain; charset=utf-8",
            body: Vec::new(),
        };
    };

    match entry.kind {
        TileSourceKind::Mbtiles => resolve_mbtiles_request(&entry.path, request),
        TileSourceKind::Pmtiles => {
            // PMTiles sources are served via /pmtiles/{source} with Range support.
            // Individual /tiles/ requests are not supported for PMTiles.
            TileResponse {
                status: 400,
                content_type: "text/plain; charset=utf-8",
                body: b"Use /pmtiles/{source} with Range requests for PMTiles".to_vec(),
            }
        }
    }
}

fn resolve_mbtiles_request(mbtiles_path: &Path, request: &TileRequest) -> TileResponse {
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
// PMTiles range serving
// ---------------------------------------------------------------------------

/// Parse `/pmtiles/<source>` from an HTTP request path.
pub fn parse_pmtiles_path(path: &str) -> Option<String> {
    let clean = path.split('?').next()?;
    let segs: Vec<&str> = clean.trim_start_matches('/').split('/').collect();
    if segs.len() == 2 && segs[0] == "pmtiles" && !segs[1].is_empty() {
        Some(segs[1].to_string())
    } else {
        None
    }
}

/// Parse an HTTP Range header value like "bytes=100-199".
fn parse_range_header(value: &str) -> Option<(u64, u64)> {
    let s = value.strip_prefix("bytes=")?;
    let (start_s, end_s) = s.split_once('-')?;
    let start: u64 = start_s.parse().ok()?;
    let end: u64 = if end_s.is_empty() {
        u64::MAX // open-ended range
    } else {
        end_s.parse().ok()?
    };
    Some((start, end))
}

/// Serve a PMTiles file with HTTP Range support.
/// Returns (status, content_type, body, extra_headers).
fn serve_pmtiles_range(
    file_path: &Path,
    range_header: Option<&str>,
) -> (u16, &'static str, Vec<u8>, Vec<(String, String)>) {
    let mut file = match File::open(file_path) {
        Ok(f) => f,
        Err(e) => {
            eprintln!("[tile-server] pmtiles open error: {e}");
            return (500, "text/plain", e.to_string().into_bytes(), vec![]);
        }
    };
    let file_len = match file.metadata() {
        Ok(m) => m.len(),
        Err(e) => {
            return (500, "text/plain", e.to_string().into_bytes(), vec![]);
        }
    };

    let mut headers = vec![
        ("Accept-Ranges".to_string(), "bytes".to_string()),
    ];

    if let Some(range_val) = range_header {
        if let Some((start, end_req)) = parse_range_header(range_val) {
            let end = end_req.min(file_len.saturating_sub(1));
            if start >= file_len {
                headers.push(("Content-Range".to_string(), format!("bytes */{file_len}")));
                return (416, "text/plain", b"Range Not Satisfiable".to_vec(), headers);
            }
            let len = end - start + 1;
            let mut buf = vec![0u8; len as usize];
            if let Err(e) = file.seek(SeekFrom::Start(start)) {
                return (500, "text/plain", format!("seek error: {e}").into_bytes(), vec![]);
            }
            match file.read_exact(&mut buf) {
                Ok(()) => {}
                Err(e) => {
                    // Partial read at end of file
                    let mut buf2 = vec![0u8; len as usize];
                    let _ = file.seek(SeekFrom::Start(start));
                    let n = file.read(&mut buf2).unwrap_or(0);
                    if n == 0 {
                        return (500, "text/plain", format!("read error: {e}").into_bytes(), vec![]);
                    }
                    buf2.truncate(n);
                    let actual_end = start + n as u64 - 1;
                    headers.push(("Content-Range".to_string(), format!("bytes {start}-{actual_end}/{file_len}")));
                    return (206, "application/octet-stream", buf2, headers);
                }
            }
            headers.push(("Content-Range".to_string(), format!("bytes {start}-{end}/{file_len}")));
            return (206, "application/octet-stream", buf, headers);
        }
    }

    // No Range header — serve entire file (for small files / initial probes)
    let mut buf = Vec::with_capacity(file_len as usize);
    if let Err(e) = file.read_to_end(&mut buf) {
        return (500, "text/plain", e.to_string().into_bytes(), vec![]);
    }
    headers.push(("Content-Length".to_string(), file_len.to_string()));
    (200, "application/octet-stream", buf, headers)
}

// ---------------------------------------------------------------------------
// Tile server lifecycle
// ---------------------------------------------------------------------------

/// Spawn a localhost-only tile server on the given port.
/// Routes:
/// - `/tiles/{source}/{z}/{x}/{y}.{ext}` — MBTiles tile lookup
/// - `/pmtiles/{source}` — PMTiles file with Range support
pub fn spawn_tile_server(port: u16, sources: SharedTileSources) {
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
        if let Ok(srcs) = sources.lock() {
            for entry in srcs.iter() {
                println!("[tile-server] source '{}' ({:?}) -> {}", entry.name, entry.kind, entry.path.display());
            }
        }

        for request in server.incoming_requests() {
            let raw_url = request.url().to_string();

            // --- CORS preflight ---
            if request.method().as_str().eq_ignore_ascii_case("OPTIONS") {
                let mut resp = Response::empty(204);
                for (k, v) in [
                    ("Access-Control-Allow-Origin", "*"),
                    ("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS"),
                    ("Access-Control-Allow-Headers", "Range"),
                    ("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges, Content-Length"),
                ] {
                    if let Ok(h) = Header::from_bytes(k, v) { resp = resp.with_header(h); }
                }
                let _ = request.respond(resp);
                continue;
            }

            // --- PMTiles range serving ---
            if let Some(source_name) = parse_pmtiles_path(&raw_url) {
                let srcs = sources.lock().unwrap_or_else(|e| e.into_inner());
                let entry = srcs.iter().find(|e| e.name == source_name && e.kind == TileSourceKind::Pmtiles);

                if let Some(entry) = entry {
                    let range_val = request.headers().iter()
                        .find(|h| h.field.as_str() == "Range" || h.field.as_str() == "range")
                        .map(|h| h.value.as_str().to_string());
                    let file_path = entry.path.clone();
                    drop(srcs); // release lock before I/O

                    let (status, ct, body, extra_headers) =
                        serve_pmtiles_range(&file_path, range_val.as_deref());

                    let mut response = Response::from_data(body).with_status_code(status);
                    if let Ok(h) = Header::from_bytes("Content-Type", ct) { response = response.with_header(h); }
                    if let Ok(h) = Header::from_bytes("Access-Control-Allow-Origin", "*") { response = response.with_header(h); }
                    if let Ok(h) = Header::from_bytes("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges, Content-Length") {
                        response = response.with_header(h);
                    }
                    for (k, v) in extra_headers {
                        if let Ok(h) = Header::from_bytes(k.as_bytes(), v.as_bytes()) { response = response.with_header(h); }
                    }
                    let _ = request.respond(response);
                } else {
                    drop(srcs);
                    let _ = request.respond(Response::empty(StatusCode::NOT_FOUND.as_u16()));
                }
                continue;
            }

            // --- MBTiles tile serving ---
            let Some(parsed) = parse_tile_path(&raw_url) else {
                let _ = request.respond(Response::empty(StatusCode::NOT_FOUND.as_u16()));
                continue;
            };

            let tile_response = {
                let srcs = sources.lock().unwrap_or_else(|e| e.into_inner());
                resolve_tile_request(&srcs, &parsed)
            };
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
        let sources = vec![TileSourceEntry {
            name: "known".to_string(),
            path: PathBuf::from("/nonexistent"),
            kind: TileSourceKind::Mbtiles,
        }];
        let req = TileRequest {
            source: "unknown".to_string(),
            z: 1, x: 0, y: 0, ext: "png".to_string(),
        };
        let resp = resolve_tile_request(&sources, &req);
        assert_eq!(resp.status, 404);
    }

    #[test]
    fn detects_source_kinds() {
        assert_eq!(detect_source_kind(Path::new("foo.mbtiles")), Some(TileSourceKind::Mbtiles));
        assert_eq!(detect_source_kind(Path::new("bar.pmtiles")), Some(TileSourceKind::Pmtiles));
        assert_eq!(detect_source_kind(Path::new("baz.MBTILES")), Some(TileSourceKind::Mbtiles));
        assert_eq!(detect_source_kind(Path::new("nope.zip")), None);
        assert_eq!(detect_source_kind(Path::new("noext")), None);
    }

    #[test]
    fn pmtiles_tile_request_returns_400() {
        let sources = vec![TileSourceEntry {
            name: "pm".to_string(),
            path: PathBuf::from("/some/file.pmtiles"),
            kind: TileSourceKind::Pmtiles,
        }];
        let req = TileRequest {
            source: "pm".to_string(),
            z: 1, x: 0, y: 0, ext: "png".to_string(),
        };
        let resp = resolve_tile_request(&sources, &req);
        assert_eq!(resp.status, 400);
    }

    #[test]
    fn parses_pmtiles_paths() {
        assert_eq!(parse_pmtiles_path("/pmtiles/terrain"), Some("terrain".to_string()));
        assert_eq!(parse_pmtiles_path("/pmtiles/my-source"), Some("my-source".to_string()));
        assert_eq!(parse_pmtiles_path("/pmtiles/my-source?v=1"), Some("my-source".to_string()));
        assert!(parse_pmtiles_path("/pmtiles/").is_none());
        assert!(parse_pmtiles_path("/pmtiles").is_none());
        assert!(parse_pmtiles_path("/tiles/src/1/2/3.png").is_none());
    }

    #[test]
    fn parses_range_headers() {
        assert_eq!(parse_range_header("bytes=0-99"), Some((0, 99)));
        assert_eq!(parse_range_header("bytes=100-199"), Some((100, 199)));
        assert_eq!(parse_range_header("bytes=512-"), Some((512, u64::MAX)));
        assert!(parse_range_header("invalid").is_none());
        assert!(parse_range_header("bytes=abc-def").is_none());
    }

    #[test]
    fn serves_pmtiles_full_file_without_range() {
        let path = std::env::temp_dir().join("test-pmtiles-full.bin");
        fs::write(&path, b"PMTiles-test-data-1234567890").unwrap();

        let (status, ct, body, headers) = serve_pmtiles_range(&path, None);
        assert_eq!(status, 200);
        assert_eq!(ct, "application/octet-stream");
        assert_eq!(body, b"PMTiles-test-data-1234567890");
        assert!(headers.iter().any(|(k, _)| k == "Accept-Ranges"));
        assert!(headers.iter().any(|(k, _)| k == "Content-Length"));

        fs::remove_file(path).unwrap();
    }

    #[test]
    fn serves_pmtiles_range_request() {
        let path = std::env::temp_dir().join("test-pmtiles-range.bin");
        fs::write(&path, b"ABCDEFGHIJKLMNOPQRSTUVWXYZ").unwrap();

        let (status, _, body, headers) = serve_pmtiles_range(&path, Some("bytes=5-9"));
        assert_eq!(status, 206);
        assert_eq!(body, b"FGHIJ");
        let cr = headers.iter().find(|(k, _)| k == "Content-Range").unwrap();
        assert_eq!(cr.1, "bytes 5-9/26");

        fs::remove_file(path).unwrap();
    }

    #[test]
    fn serves_pmtiles_open_ended_range() {
        let path = std::env::temp_dir().join("test-pmtiles-open.bin");
        fs::write(&path, b"0123456789").unwrap();

        let (status, _, body, headers) = serve_pmtiles_range(&path, Some("bytes=7-"));
        assert_eq!(status, 206);
        assert_eq!(body, b"789");
        let cr = headers.iter().find(|(k, _)| k == "Content-Range").unwrap();
        assert_eq!(cr.1, "bytes 7-9/10");

        fs::remove_file(path).unwrap();
    }

    #[test]
    fn serves_pmtiles_416_for_out_of_range() {
        let path = std::env::temp_dir().join("test-pmtiles-416.bin");
        fs::write(&path, b"short").unwrap();

        let (status, _, _, _) = serve_pmtiles_range(&path, Some("bytes=100-200"));
        assert_eq!(status, 416);

        fs::remove_file(path).unwrap();
    }

    #[test]
    fn serves_pmtiles_500_for_missing_file() {
        let (status, _, _, _) = serve_pmtiles_range(Path::new("/nonexistent/file.pmtiles"), None);
        assert_eq!(status, 500);
    }
}
