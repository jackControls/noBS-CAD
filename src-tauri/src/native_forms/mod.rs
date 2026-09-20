//! Typed, host-neutral feature editors over the existing engine request DTOs.
//! These are form state and validation, not another command or schema catalog.

mod build;
mod measurement;

pub(crate) use build::{
    ApplyTicket, BuildField, BuildFieldView, BuildForm, BuildKind, FormModel, ProfileSource,
};
pub(crate) use measurement::{DimensionKind, MeasurementInput, ParameterValue};
