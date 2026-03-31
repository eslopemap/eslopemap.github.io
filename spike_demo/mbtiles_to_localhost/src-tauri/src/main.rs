use std::thread;

use http::StatusCode;
use spike_shared_backend::{fixture_mbtiles_path, parse_localhost_request_path, resolve_tile_request};
use tauri::{webview::WebviewWindowBuilder, WebviewUrl};
use tiny_http::{Header, Response, Server};

const FRONTEND_PORT: u16 = 14320;
const TILE_PORT: u16 = 14321;

fn spawn_tile_server(manifest_dir: &'static str) {
    let mbtiles_path = fixture_mbtiles_path(manifest_dir);
    thread::spawn(move || {
        let server = Server::http(("127.0.0.1", TILE_PORT)).expect("failed to bind tile server");
        println!("[localhost-demo] tile server listening on http://127.0.0.1:{TILE_PORT}");
        println!("[localhost-demo] using fixture {}", mbtiles_path.display());

        for request in server.incoming_requests() {
            let raw_url = request.url().to_string();
            let Some(parsed) = parse_localhost_request_path(&raw_url) else {
                println!("[localhost-demo] 404 invalid path: {raw_url}");
                let response = Response::empty(StatusCode::NOT_FOUND.as_u16());
                let _ = request.respond(response);
                continue;
            };

            match resolve_tile_request(&mbtiles_path, &parsed) {
                Ok(tile_response) => {
                    println!(
                        "[localhost-demo] {} {} -> {}",
                        parsed.source,
                        raw_url,
                        tile_response.status
                    );
                    let mut response = Response::from_data(tile_response.body)
                        .with_status_code(tile_response.status);
                    if let Ok(header) = Header::from_bytes("Content-Type", tile_response.content_type) {
                        response = response.with_header(header);
                    }
                    let _ = request.respond(response);
                }
                Err(error) => {
                    println!("[localhost-demo] 500 {} ({error})", raw_url);
                    let response = Response::from_string(error.to_string())
                        .with_status_code(StatusCode::INTERNAL_SERVER_ERROR.as_u16());
                    let _ = request.respond(response);
                }
            }
        }
    });
}

fn main() {
    let manifest_dir: &'static str = env!("CARGO_MANIFEST_DIR");
    spawn_tile_server(manifest_dir);

    tauri::Builder::default()
        .plugin(tauri_plugin_localhost::Builder::new(FRONTEND_PORT).build())
        .setup(|app| {
            let url = format!("http://localhost:{FRONTEND_PORT}/index-localhost.html")
                .parse()
                .expect("invalid localhost frontend URL");
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("Spike 1 — MBTiles to localhost")
                .inner_size(1360.0, 900.0)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running localhost spike demo");
}
