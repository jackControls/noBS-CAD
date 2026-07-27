//! Native OCCT adapter.
//!
//! The C++ bridge is enabled by the `native-occt` feature in the Tauri
//! shell. Keeping the feature off lets the host-neutral workspace and WASM
//! target build on machines that do not have the OCCT SDK installed.

#[cfg(not(feature = "native-occt"))]
use nbcad_solid::{KernelSceneDto, RecomputePlanDto};

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
}

#[cfg(feature = "native-occt")]
mod native;
#[cfg(feature = "native-occt")]
pub use native::OcctKernel;
