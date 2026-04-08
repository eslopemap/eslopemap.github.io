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

use crate::tile_cache::{SharedCachedSources, TileCache};

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
// Folder scanning + MBTiles metadata
// ---------------------------------------------------------------------------

/// Result of scanning a folder for tile sources.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScannedTileSource {
    pub name: String,
    pub path: PathBuf,
    pub kind: TileSourceKind,
    pub metadata: Option<TileSourceMetadata>,
}

/// Metadata extracted from an MBTiles `metadata` table.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TileSourceMetadata {
    pub name: Option<String>,
    pub format: Option<String>,
    pub bounds: Option<[f64; 4]>,
    pub center: Option<[f64; 3]>,
    pub minzoom: Option<u32>,
    pub maxzoom: Option<u32>,
    pub description: Option<String>,
}

/// Scan a directory for `.mbtiles` and `.pmtiles` files.
pub fn scan_tile_folder(dir: &Path) -> std::io::Result<Vec<ScannedTileSource>> {
    let mut results = Vec::new();
    if !dir.is_dir() {
        return Err(std::io::Error::new(std::io::ErrorKind::NotFound, "Not a directory"));
    }
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(kind) = detect_source_kind(&path) else { continue };
        let stem = path.file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("unknown")
            .to_string();

        let metadata = if kind == TileSourceKind::Mbtiles {
            read_mbtiles_metadata(&path).ok()
        } else {
            None
        };

        let display_name = metadata.as_ref()
            .and_then(|m| m.name.clone())
            .unwrap_or_else(|| stem.clone());

        results.push(ScannedTileSource {
            name: display_name,
            path,
            kind,
            metadata,
        });
    }
    results.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(results)
}

/// Read the `metadata` table from an MBTiles file.
pub fn read_mbtiles_metadata(path: &Path) -> Result<TileSourceMetadata, rusqlite::Error> {
    let conn = Connection::open(path)?;
    let mut stmt = conn.prepare("SELECT name, value FROM metadata")?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;

    let mut meta = TileSourceMetadata {
        name: None, format: None, bounds: None, center: None,
        minzoom: None, maxzoom: None, description: None,
    };

    for row in rows {
        let (key, value) = row?;
        match key.as_str() {
            "name" => meta.name = Some(value),
            "format" => meta.format = Some(value),
            "description" => meta.description = Some(value),
            "minzoom" => meta.minzoom = value.parse().ok(),
            "maxzoom" => meta.maxzoom = value.parse().ok(),
            "bounds" => {
                let parts: Vec<f64> = value.split(',')
                    .filter_map(|s| s.trim().parse().ok())
                    .collect();
                if parts.len() == 4 {
                    meta.bounds = Some([parts[0], parts[1], parts[2], parts[3]]);
                }
            }
            "center" => {
                let parts: Vec<f64> = value.split(',')
                    .filter_map(|s| s.trim().parse().ok())
                    .collect();
                if parts.len() == 3 {
                    meta.center = Some([parts[0], parts[1], parts[2]]);
                }
            }
            _ => {}
        }
    }
    Ok(meta)
}

// ---------------------------------------------------------------------------
// TileJSON generation
// ---------------------------------------------------------------------------

/// Generate a TileJSON document for an MBTiles source.
pub fn build_tilejson_for_mbtiles(entry: &TileSourceEntry, base_url: &str) -> serde_json::Value {
    let meta = read_mbtiles_metadata(&entry.path).ok();
    let name = meta.as_ref().and_then(|m| m.name.clone()).unwrap_or_else(|| entry.name.clone());
    let format = meta.as_ref().and_then(|m| m.format.clone()).unwrap_or_else(|| "png".to_string());
    let tile_url = [base_url, "/tiles/", &entry.name, "/{z}/{x}/{y}.", &format].concat();

    let mut tj = serde_json::json!({
        "tilejson": "3.0.0",
        "name": name,
        "tiles": [tile_url],
        "scheme": "xyz",
        "format": format,
    });

    if let Some(ref m) = meta {
        if let Some(bounds) = m.bounds {
            tj["bounds"] = serde_json::json!(bounds);
        }
        if let Some(center) = m.center {
            tj["center"] = serde_json::json!(center);
        }
        if let Some(minzoom) = m.minzoom {
            tj["minzoom"] = serde_json::json!(minzoom);
        }
        if let Some(maxzoom) = m.maxzoom {
            tj["maxzoom"] = serde_json::json!(maxzoom);
        }
        if let Some(ref desc) = m.description {
            tj["description"] = serde_json::json!(desc);
        }
    }

    tj
}

pub fn build_tilejson_for_pmtiles(entry: &TileSourceEntry, base_url: &str) -> serde_json::Value {
    // PMTiles does not use standard XYZ URLs. MapLibre's PMTiles integration uses the pmtiles:// protocol.
    // We emit a pseudo-TileJSON descriptor so the frontend can build the source correctly.
    let url = [base_url, "/pmtiles/", &entry.name].concat();

    serde_json::json!({
        "tilejson": "3.0.0",
        "name": entry.name.clone(),
        "protocol": "pmtiles",
        "url": format!("pmtiles://{url}"),
        "format": "pmtiles",
    })
}

/// Generate a TileJSON document for a cached upstream source (e.g. DEM).
pub fn build_tilejson_for_cached(name: &str, upstream_url: &str, base_url: &str) -> serde_json::Value {
    let tile_url = [base_url, "/tiles/", name, "/{z}/{x}/{y}.webp"].concat();
    serde_json::json!({
        "tilejson": "3.0.0",
        "name": name,
        "tiles": [tile_url],
        "scheme": "xyz",
        "format": "webp",
        "description": format!("Cached upstream: {upstream_url}"),
    })
}

/// Parse `/tilejson/{source}` from a URL path.
pub fn parse_tilejson_path(path: &str) -> Option<String> {
    let clean = path.split('?').next()?;
    let segments: Vec<&str> = clean.trim_start_matches('/').split('/').collect();
    if segments.len() == 2 && segments[0] == "tilejson" && !segments[1].is_empty() {
        Some(segments[1].to_string())
    } else {
        None
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

/// Helper: add CORS headers to a tiny_http Response.
fn with_cors<R: std::io::Read>(mut resp: Response<R>) -> Response<R> {
    if let Ok(h) = Header::from_bytes("Access-Control-Allow-Origin", "*") {
        resp = resp.with_header(h);
    }
    resp
}

/// Spawn a localhost-only tile server on the given port.
/// Routes:
/// - `/tiles/{source}/{z}/{x}/{y}.{ext}` — cached upstream or MBTiles tile lookup
/// - `/pmtiles/{source}` — PMTiles file with Range support
pub fn spawn_tile_server(
    port: u16,
    sources: SharedTileSources,
    cached_sources: SharedCachedSources,
    tile_cache: TileCache,
) {
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
        if let Ok(csrcs) = cached_sources.lock() {
            for cs in csrcs.iter() {
                println!("[tile-server] cached upstream '{}' -> {}", cs.name, cs.upstream_url);
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

            // --- TileJSON endpoint ---
            let base_url = format!("http://127.0.0.1:{port}");
            if raw_url == "/tilejson" || raw_url == "/tilejson/" {
                // List all available TileJSON endpoints
                let mut all = Vec::new();
                {
                    let csrcs = cached_sources.lock().unwrap_or_else(|e| e.into_inner());
                    for cs in csrcs.iter() {
                        all.push(build_tilejson_for_cached(&cs.name, &cs.upstream_url, &base_url));
                    }
                }
                {
                    let srcs = sources.lock().unwrap_or_else(|e| e.into_inner());
                    for entry in srcs.iter() {
                        if entry.kind == TileSourceKind::Mbtiles {
                            all.push(build_tilejson_for_mbtiles(entry, &base_url));
                        } else if entry.kind == TileSourceKind::Pmtiles {
                            all.push(build_tilejson_for_pmtiles(entry, &base_url));
                        }
                    }
                }
                let body = serde_json::to_vec(&all).unwrap_or_default();
                let resp = Response::from_data(body).with_status_code(200);
                let resp = if let Ok(h) = Header::from_bytes("Content-Type", "application/json") {
                    resp.with_header(h)
                } else { resp };
                let _ = request.respond(with_cors(resp));
                continue;
            }

            if let Some(source_name) = parse_tilejson_path(&raw_url) {
                // Check cached upstream sources first
                let cached_match = {
                    let csrcs = cached_sources.lock().unwrap_or_else(|e| e.into_inner());
                    csrcs.iter().find(|cs| cs.name == source_name).cloned()
                };
                let tj = if let Some(cs) = cached_match {
                    Some(build_tilejson_for_cached(&cs.name, &cs.upstream_url, &base_url))
                } else {
                    let srcs = sources.lock().unwrap_or_else(|e| e.into_inner());
                    srcs.iter().find(|e| e.name == source_name).map(|e| {
                        if e.kind == TileSourceKind::Mbtiles {
                            build_tilejson_for_mbtiles(e, &base_url)
                        } else {
                            build_tilejson_for_pmtiles(e, &base_url)
                        }
                    })
                };
                if let Some(tj) = tj {
                    let body = serde_json::to_vec(&tj).unwrap_or_default();
                    let resp = Response::from_data(body).with_status_code(200);
                    let resp = if let Ok(h) = Header::from_bytes("Content-Type", "application/json") {
                        resp.with_header(h)
                    } else { resp };
                    let _ = request.respond(with_cors(resp));
                } else {
                    let _ = request.respond(with_cors(Response::empty(404)));
                }
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
                    response = with_cors(response);
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

            // --- Tile requests: /tiles/{source}/{z}/{x}/{y}.{ext} ---
            let Some(parsed) = parse_tile_path(&raw_url) else {
                let _ = request.respond(Response::empty(StatusCode::NOT_FOUND.as_u16()));
                continue;
            };

            // Check cached upstream sources first (e.g. "dem")
            let cached_match = {
                let csrcs = cached_sources.lock().unwrap_or_else(|e| e.into_inner());
                csrcs.iter().find(|cs| cs.name == parsed.source).cloned()
            };

            if let Some(cs) = cached_match {
                let (status, ct, body) = tile_cache.get_or_fetch(
                    &parsed.source,
                    parsed.z, parsed.x, parsed.y,
                    &parsed.ext,
                    &cs.upstream_url,
                );
                let mut response = Response::from_data(body).with_status_code(status);
                if let Ok(h) = Header::from_bytes("Content-Type", ct) {
                    response = response.with_header(h);
                }
                let _ = request.respond(with_cors(response));
                continue;
            }

            // Fall back to MBTiles sources
            let tile_response = {
                let srcs = sources.lock().unwrap_or_else(|e| e.into_inner());
                resolve_tile_request(&srcs, &parsed)
            };
            let mut response = Response::from_data(tile_response.body)
                .with_status_code(tile_response.status);
            if let Ok(header) = Header::from_bytes("Content-Type", tile_response.content_type) {
                response = response.with_header(header);
            }
            let _ = request.respond(with_cors(response));
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

    #[test]
    fn scans_folder_for_tile_sources() {
        let dir = std::env::temp_dir().join("scan-test-tiles");
        let _ = fs::create_dir_all(&dir);
        // Create test files
        let mb_path = dir.join("topo.mbtiles");
        write_test_mbtiles(&mb_path);
        // Add metadata
        let conn = Connection::open(&mb_path).unwrap();
        conn.execute("INSERT INTO metadata (name, value) VALUES ('name', 'My Topo')", []).unwrap();
        conn.execute("INSERT INTO metadata (name, value) VALUES ('format', 'png')", []).unwrap();
        conn.execute("INSERT INTO metadata (name, value) VALUES ('bounds', '5.0,45.0,10.0,48.0')", []).unwrap();
        conn.execute("INSERT INTO metadata (name, value) VALUES ('minzoom', '1')", []).unwrap();
        conn.execute("INSERT INTO metadata (name, value) VALUES ('maxzoom', '14')", []).unwrap();
        drop(conn);

        let pm_path = dir.join("terrain.pmtiles");
        fs::write(&pm_path, b"PMTiles-fake").unwrap();

        // Also create a non-tile file that should be ignored
        fs::write(dir.join("readme.txt"), b"ignore me").unwrap();

        let results = scan_tile_folder(&dir).unwrap();
        assert_eq!(results.len(), 2);

        let mb = results.iter().find(|s| s.kind == TileSourceKind::Mbtiles).unwrap();
        assert_eq!(mb.name, "My Topo");
        let meta = mb.metadata.as_ref().unwrap();
        assert_eq!(meta.format.as_deref(), Some("png"));
        assert_eq!(meta.bounds, Some([5.0, 45.0, 10.0, 48.0]));
        assert_eq!(meta.minzoom, Some(1));
        assert_eq!(meta.maxzoom, Some(14));

        let pm = results.iter().find(|s| s.kind == TileSourceKind::Pmtiles).unwrap();
        assert_eq!(pm.name, "terrain"); // filename stem, no metadata
        assert!(pm.metadata.is_none());

        // Cleanup
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn scan_folder_returns_error_for_nonexistent_dir() {
        let result = scan_tile_folder(Path::new("/nonexistent/dir"));
        assert!(result.is_err());
    }

    #[test]
    fn reads_mbtiles_metadata() {
        let path = temp_db_path("metadata-test");
        write_test_mbtiles(&path);
        let conn = Connection::open(&path).unwrap();
        conn.execute("INSERT INTO metadata (name, value) VALUES ('name', 'Test Map')", []).unwrap();
        conn.execute("INSERT INTO metadata (name, value) VALUES ('center', '6.8,45.9,12')", []).unwrap();
        conn.execute("INSERT INTO metadata (name, value) VALUES ('description', 'A test map')", []).unwrap();
        drop(conn);

        let meta = read_mbtiles_metadata(&path).unwrap();
        assert_eq!(meta.name.as_deref(), Some("Test Map"));
        assert_eq!(meta.center, Some([6.8, 45.9, 12.0]));
        assert_eq!(meta.description.as_deref(), Some("A test map"));

        fs::remove_file(path).unwrap();
    }

    #[test]
    fn parses_tilejson_paths() {
        assert_eq!(parse_tilejson_path("/tilejson/dem"), Some("dem".to_string()));
        assert_eq!(parse_tilejson_path("/tilejson/my-map"), Some("my-map".to_string()));
        assert_eq!(parse_tilejson_path("/tilejson/"), None);
        assert_eq!(parse_tilejson_path("/tiles/dem/1/0/0.png"), None);
    }

    #[test]
    fn builds_tilejson_for_mbtiles() {
        let path = temp_db_path("tilejson-test");
        write_test_mbtiles(&path);
        let conn = Connection::open(&path).unwrap();
        conn.execute("INSERT INTO metadata (name, value) VALUES ('name', 'Alps')", []).unwrap();
        conn.execute("INSERT INTO metadata (name, value) VALUES ('format', 'png')", []).unwrap();
        conn.execute("INSERT INTO metadata (name, value) VALUES ('minzoom', '5')", []).unwrap();
        conn.execute("INSERT INTO metadata (name, value) VALUES ('maxzoom', '14')", []).unwrap();
        drop(conn);

        let entry = TileSourceEntry { name: "alps".to_string(), path: path.clone(), kind: TileSourceKind::Mbtiles };
        let tj = build_tilejson_for_mbtiles(&entry, "http://127.0.0.1:14321");
        assert_eq!(tj["tilejson"], "3.0.0");
        assert_eq!(tj["name"], "Alps");
        assert_eq!(tj["format"], "png");
        assert_eq!(tj["minzoom"], 5);
        assert_eq!(tj["maxzoom"], 14);
        let tiles = tj["tiles"].as_array().unwrap();
        assert!(tiles[0].as_str().unwrap().contains("/{z}/{x}/{y}.png"));

        fs::remove_file(path).unwrap();
    }

    #[test]
    fn builds_tilejson_for_cached() {
        let tj = build_tilejson_for_cached("dem", "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp", "http://127.0.0.1:14321");
        assert_eq!(tj["tilejson"], "3.0.0");
        assert_eq!(tj["name"], "dem");
        assert_eq!(tj["format"], "webp");
        let tiles = tj["tiles"].as_array().unwrap();
        assert_eq!(tiles[0].as_str().unwrap(), "http://127.0.0.1:14321/tiles/dem/{z}/{x}/{y}.webp");
    }
}
