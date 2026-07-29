//! Viewport trait boundary (ADR 0002).

use crate::app::run_bevy_app;
use crate::soup::TessellatedTriangleSoup;

#[derive(Debug)]
pub struct ViewportError(pub String);

impl std::fmt::Display for ViewportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::error::Error for ViewportError {}

/// Swap rendering backends without touching B-rep / feature history.
pub trait ViewportBackend {
    fn name(&self) -> &'static str;
    fn run(&mut self, mesh: TessellatedTriangleSoup) -> Result<(), ViewportError>;
}

/// Bevy 0.19 implementation of [`ViewportBackend`].
#[derive(Debug, Default)]
pub struct BevyViewportBackend;

impl ViewportBackend for BevyViewportBackend {
    fn name(&self) -> &'static str {
        "bevy-0.19"
    }

    fn run(&mut self, mesh: TessellatedTriangleSoup) -> Result<(), ViewportError> {
        run_bevy_app(mesh)
    }
}
