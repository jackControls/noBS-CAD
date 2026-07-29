//! Sync filament catalog into the frontend mirror on every `nbcad-export` build.
//! Source of truth remains `presets/catalog.json`.

use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let source = manifest_dir.join("presets/catalog.json");
    println!("cargo:rerun-if-changed={}", source.display());

    let dest = manifest_dir.join("../../src/materials/catalog.json");
    if let Some(parent) = dest.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let bytes = fs::read(&source).expect("read presets/catalog.json");
    match fs::read(&dest) {
        Ok(existing) if existing == bytes => {}
        _ => {
            fs::write(&dest, &bytes).expect("mirror catalog.json into src/materials/");
        }
    }
}
