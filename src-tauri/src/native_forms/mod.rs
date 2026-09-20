//! Typed, host-neutral feature editors over the existing engine request DTOs.
//! These are form state and validation, not another command or schema catalog.

mod feature;
#[cfg(feature = "dev-bevy-host")]
pub(crate) mod joint;
#[cfg(feature = "dev-bevy-host")]
pub(crate) mod motion_study;
mod measurement;

pub(crate) use feature::{
    MoveMode, ApplyTicket, SolidField, SolidFieldView, SolidForm, SolidFormKind, FormModel, ProfileSource,
};
pub(crate) use measurement::{DimensionKind, MeasurementInput, ParameterValue};
