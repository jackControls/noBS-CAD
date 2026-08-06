//! Native OCCT adapter.
//!
//! The C++ bridge is enabled by the `native-occt` feature in the Tauri
//! shell. Keeping the feature off lets the host-neutral workspace and WASM
//! target build on machines that do not have the OCCT SDK installed.

use nbcad_core::BodyId;
#[cfg(not(feature = "native-occt"))]
use nbcad_solid::{KernelSceneDto, RecomputePlanDto};
use serde::{Deserialize, Serialize};

/// Orthographic hidden-line projection request. `direction` points from the
/// model toward the viewer; `up` is the desired page-up direction.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DrawingProjectionRequest {
    #[serde(default)]
    pub body_ids: Vec<BodyId>,
    pub direction: [f64; 3],
    pub up: [f64; 3],
    #[serde(default)]
    pub include_hidden: bool,
    #[serde(default)]
    pub include_tangent_edges: bool,
    #[serde(default = "default_projection_deflection")]
    pub deflection: f64,
}

fn default_projection_deflection() -> f64 {
    0.05
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DrawingPolylineDto {
    pub points: Vec<[f64; 2]>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DrawingProjectionDto {
    pub visible: Vec<DrawingPolylineDto>,
    pub hidden: Vec<DrawingPolylineDto>,
    /// min x, min y, max x, max y in model millimetres.
    pub bounds: [f64; 4],
}

#[derive(Debug, Clone)]
pub struct OcctError(pub String);

impl std::fmt::Display for OcctError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::error::Error for OcctError {}

/// Stateful native kernel. The feature-enabled implementation is supplied
/// by `native.rs`; this placeholder keeps non-native workspace builds clean.
#[cfg(not(feature = "native-occt"))]
#[derive(Debug, Default)]
pub struct OcctKernel;

#[cfg(not(feature = "native-occt"))]
impl OcctKernel {
    pub fn new() -> Result<Self, OcctError> {
        Err(OcctError(
            "native OCCT support was not enabled at compile time".to_string(),
        ))
    }

    pub fn recompute(&mut self, _plan: &RecomputePlanDto) -> Result<KernelSceneDto, OcctError> {
        Err(OcctError(
            "native OCCT support was not enabled at compile time".to_string(),
        ))
    }

    pub fn drawing_projection(
        &self,
        _request: &DrawingProjectionRequest,
    ) -> Result<DrawingProjectionDto, OcctError> {
        Err(OcctError(
            "native OCCT support was not enabled at compile time".to_string(),
        ))
    }
}

#[cfg(feature = "native-occt")]
mod native;
#[cfg(feature = "native-occt")]
pub use native::OcctKernel;
