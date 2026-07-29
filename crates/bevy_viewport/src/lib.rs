//! Bevy viewport spike (issue #20 / ADR 0002).
//!
//! **Display / ECS only.** OCCT remains solid truth. This crate draws a
//! tessellated triangle soup, orbits a camera, and reports mesh picks.
//! It does not model B-rep, features, or ribbon UI.
//!
//! Module map: see [`INDEX.md`](../INDEX.md) in this crate.

mod app;
mod backend;
mod camera;
mod mesh_convert;
mod picking;
mod scene;
mod soup;

pub use backend::{BevyViewportBackend, ViewportBackend, ViewportError};
pub use soup::TessellatedTriangleSoup;

/// Entry used by the desktop/wasm binary and the launcher.
pub fn run_desktop() {
    let mut backend = BevyViewportBackend;
    if let Err(error) = backend.run(TessellatedTriangleSoup::unit_cube()) {
        eprintln!("bevy viewport failed: {error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::run_bevy_app;

    #[test]
    fn unit_cube_has_twelve_triangles() {
        let cube = TessellatedTriangleSoup::unit_cube();
        assert_eq!(cube.triangle_count(), 12);
        assert_eq!(cube.positions.len(), 24);
        assert_eq!(cube.indices.len(), 36);
    }

    #[test]
    fn backend_name_is_bevy_019() {
        assert_eq!(BevyViewportBackend.name(), "bevy-0.19");
    }

    #[test]
    fn empty_mesh_is_rejected() {
        let err = run_bevy_app(TessellatedTriangleSoup {
            name: "empty".into(),
            positions: vec![],
            indices: vec![],
        })
        .unwrap_err();
        assert!(err.0.contains("no triangles"));
    }
}
