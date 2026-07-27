//! noBS CAD desktop entry point.

// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    nbcad_lib::run();
}
