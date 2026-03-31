fn main() {
    // Re-embed frontend assets when individual files change
    println!("cargo:rerun-if-changed=../frontend/index.html");
    println!("cargo:rerun-if-changed=../frontend/styles.css");
    tauri_build::build()
}
