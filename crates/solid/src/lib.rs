//! Host-neutral solid modeling contract.
//!
//! Rust owns persistent feature definitions, rollback/recompute planning,
//! stable topology ids, reference validation, and serialized mesh DTOs.
//! Native OCCT and browser OpenCascade.js consume the same [`RecomputePlanDto`]
//! and return the same [`KernelSceneDto`].

mod dto;
mod history;
mod profile;
mod stable;
mod thread;

pub use dto::*;
pub use history::{SolidDocument, SolidError};
pub use profile::{
    canonicalize_profile_curves, extract_closed_loops, extract_closed_loops_allow_open,
    ProfileError, Segment2,
};
pub use thread::{
    iso_metric_grade6_envelope, iso_metric_thread_envelope, IsoMetricThreadEnvelope, ThreadFit,
};
