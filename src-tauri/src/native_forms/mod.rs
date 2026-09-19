//! Typed, host-neutral feature editors over the existing engine request DTOs.
//! These are form state and validation, not another command or schema catalog.

mod extrude;
mod measurement;

pub(crate) use extrude::{
    ApplyTicket, ExtrudeField, ExtrudeFieldView, ExtrudeForm, ExtrudeSource, FormModel,
};
pub(crate) use measurement::{DimensionKind, MeasurementInput, ParameterValue};
