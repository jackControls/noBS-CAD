//! Typed, host-neutral feature editors over the existing engine request DTOs.
//! These are form state and validation, not another command or schema catalog.

mod feature;
mod measurement;

pub(crate) use feature::{
    ApplyTicket, SolidField, SolidFieldView, SolidForm, SolidFormKind, FormModel, ProfileSource,
};
pub(crate) use measurement::{DimensionKind, MeasurementInput, ParameterValue};
