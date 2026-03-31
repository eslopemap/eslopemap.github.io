use http::{header::CONTENT_TYPE, Response, StatusCode, Uri};
use spike_shared_backend::{fixture_mbtiles_path, parse_protocol_request, resolve_tile_request};
use tauri::WebviewUrl;

fn main() {
    let mbtiles_path = fixture_mbtiles_path(env!("CARGO_MANIFEST_DIR"));
    println!("[protocol-demo] using fixture {}", mbtiles_path.display());

    tauri::Builder::default()
        .register_uri_scheme_protocol("mbtiles-demo", move |_app, request| {
            let uri: Uri = request.uri().to_string().parse().unwrap_or_else(|_| Uri::from_static("mbtiles-demo://dummy/invalid/0/0.png"));
            let Some(parsed) = parse_protocol_request(&uri) else {
                println!("[protocol-demo] 404 invalid path: {}", request.uri());
                return Response::builder()
                    .status(StatusCode::NOT_FOUND)
                    .body(Vec::new())
                    .expect("failed to build 404 response");
            };

            match resolve_tile_request(&mbtiles_path, &parsed) {
                Ok(tile_response) => {
                    println!(
                        "[protocol-demo] {} {} -> {}",
                        parsed.source,
                        request.uri(),
                        tile_response.status
                    );
                    Response::builder()
                        .status(tile_response.status)
                        .header(CONTENT_TYPE, tile_response.content_type)
                        .body(tile_response.body)
                        .expect("failed to build tile response")
                }
                Err(error) => {
                    println!("[protocol-demo] 500 {} ({error})", request.uri());
                    Response::builder()
                        .status(StatusCode::INTERNAL_SERVER_ERROR)
                        .header(CONTENT_TYPE, "text/plain; charset=utf-8")
                        .body(error.to_string().into_bytes())
                        .expect("failed to build error response")
                }
            }
        })
        .setup(|app| {
            tauri::webview::WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index-protocol.html".into()))
                .title("Spike 1 — MBTiles custom protocol")
                .inner_size(1360.0, 900.0)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running custom protocol spike demo");
}
