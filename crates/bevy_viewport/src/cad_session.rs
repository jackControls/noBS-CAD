//! Rust-side CAD session bridge (stand-in for kernel/UI co-link).
//!
//! UI and the viewport both read/write this resource. Later this maps to
//! `SketchManager` / MCP document session without React ownership.

use bevy::prelude::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum CadMode {
    Sketch,
    #[default]
    Solid,
}

impl CadMode {
    pub fn label(self) -> &'static str {
        match self {
            CadMode::Sketch => "Sketch",
            CadMode::Solid => "Solid",
        }
    }
}

/// Shared session state — the Bevy shell's stand-in for appStore + engine.
#[derive(Resource, Debug, Clone)]
pub struct CadSession {
    pub mode: CadMode,
    pub material_name: String,
    pub color: Color,
    pub selection: String,
    pub body_name: String,
}

impl Default for CadSession {
    fn default() -> Self {
        Self {
            mode: CadMode::Solid,
            material_name: "PLA Red".into(),
            color: Color::srgb(0.85, 0.35, 0.2),
            selection: "Nothing selected — click the orange body.".into(),
            body_name: "FixtureCube".into(),
        }
    }
}

/// Preset swatches ported from body-appearance workflow.
pub const COLOR_PRESETS: &[(&str, &str, f32, f32, f32)] = &[
    ("PLA Red", "Bambu-ish red", 0.85, 0.35, 0.2),
    ("PLA White", "Jade white", 0.92, 0.92, 0.90),
    ("PETG Blue", "Tooling blue", 0.20, 0.45, 0.85),
    ("ABS Black", "Enclosure", 0.12, 0.12, 0.14),
];
