use super::{DimensionKind, MeasurementInput, ParameterValue};
use nbcad_core::{BodyId, DocumentDto, FeatureId, FeatureKind};
use nbcad_interface::{ChoiceOption, DocumentContext, Field};
use nbcad_solid::{
    EditExtrudeRequest, ExtrudeDefinitionDto, ExtrudeExtent, ExtrudeOperation, ExtrudeRequest,
    PlanarFaceSourceDto, ProfileCatalogItemDto, SolidSceneDto,
};
use serde_json::{json, Value};
use std::sync::Arc;

/// Borrow one coherent native snapshot under the document publisher lease.
/// Parameters belong to the accepted source sketch and use canonical units.
pub(crate) struct FormModel<'a> {
    pub owner: &'a DocumentContext,
    pub engine_revision: u64,
    pub document: &'a DocumentDto,
    pub profiles: &'a [ProfileCatalogItemDto],
    pub scene: &'a SolidSceneDto,
    pub parameters: &'a [ParameterValue],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(crate) enum ExtrudeField {
    Source,
    Operation,
    Extent,
    Distance,
    SecondDistance,
    Taper,
    Flip,
    Targets,
    StopFace,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum ExtrudeSource {
    None,
    Profiles {
        sketch_name: String,
        indices: Vec<u32>,
    },
    Face(PlanarFaceSourceDto),
}

#[derive(Clone, Debug)]
pub(crate) struct ExtrudeFieldView {
    pub field: ExtrudeField,
    pub label: String,
    pub value: Field,
    pub error: Option<String>,
    pub visible: bool,
    pub enabled: bool,
}

#[derive(Clone, Debug)]
struct Stamp {
    identity: Arc<()>,
    owner: DocumentContext,
    model_revision: u64,
    edit: u64,
}

#[derive(Clone, Debug)]
pub(crate) struct PreviewTicket {
    stamp: Stamp,
    request: ExtrudeRequest,
}
impl PreviewTicket {
    pub(crate) fn request(&self) -> &ExtrudeRequest {
        &self.request
    }
}

#[derive(Clone, Debug)]
pub(crate) struct ApplyTicket {
    stamp: Stamp,
    operation: &'static str,
    arguments: Value,
}
impl ApplyTicket {
    pub(crate) fn operation(&self) -> &'static str {
        self.operation
    }
    pub(crate) fn arguments(&self) -> &Value {
        &self.arguments
    }
    pub(crate) fn owner(&self) -> &DocumentContext {
        &self.stamp.owner
    }
    pub(crate) fn model_revision(&self) -> u64 {
        self.stamp.model_revision
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Phase {
    Editing,
    Applying,
    Closed,
}

/// Actual Extrude fields, separated from rendering and event delivery. The
/// payload is always the established nbcad-solid DTO consumed by MCP too.
#[derive(Debug)]
pub(crate) struct ExtrudeForm {
    stamp: Stamp,
    feature: Option<FeatureId>,
    source: ExtrudeSource,
    operation: ExtrudeOperation,
    operation_manual: bool,
    extent: ExtrudeExtent,
    distance: MeasurementInput,
    second_distance: MeasurementInput,
    taper: MeasurementInput,
    flip: bool,
    targets: Vec<BodyId>,
    stop_face: Option<PlanarFaceSourceDto>,
    phase: Phase,
    engine_error: Option<String>,
}

impl ExtrudeForm {
    pub(crate) fn new(model: &FormModel<'_>) -> Self {
        let units = model.document.settings.units;
        Self {
            stamp: Stamp {
                identity: Arc::new(()),
                owner: model.owner.clone(),
                model_revision: model.engine_revision,
                edit: 0,
            },
            feature: None,
            source: ExtrudeSource::None,
            operation: ExtrudeOperation::NewBody,
            operation_manual: false,
            extent: ExtrudeExtent::default(),
            distance: MeasurementInput::new(DimensionKind::Length, 10., units),
            second_distance: MeasurementInput::new(DimensionKind::Length, 10., units),
            taper: MeasurementInput::new(DimensionKind::Angle, 0., units),
            flip: false,
            targets: Vec::new(),
            stop_face: None,
            phase: Phase::Editing,
            engine_error: None,
        }
    }

    pub(crate) fn edit(
        definition: &ExtrudeDefinitionDto,
        model: &FormModel<'_>,
    ) -> Result<Self, String> {
        if !model.document.features.iter().any(|feature| {
            feature.id == definition.feature_id && feature.kind == FeatureKind::Extrude
        }) {
            return Err("The Extrude feature is no longer in this document".into());
        }
        let mut form = Self::new(model);
        form.feature = Some(definition.feature_id);
        form.source = definition
            .source_face
            .map(ExtrudeSource::Face)
            .unwrap_or_else(|| ExtrudeSource::Profiles {
                sketch_name: definition.sketch_name.clone(),
                indices: definition.profile_indices.clone(),
            });
        form.operation = definition.operation;
        form.operation_manual = true;
        form.extent = definition.extent;
        form.flip = definition.flip;
        form.targets = definition.target_body_ids.clone();
        let units = model.document.settings.units;
        match definition.extent {
            ExtrudeExtent::Distance { distance } | ExtrudeExtent::Symmetric { distance } => {
                form.distance = MeasurementInput::new(DimensionKind::Length, distance, units)
            }
            ExtrudeExtent::TwoSides {
                distance,
                second_distance,
            } => {
                form.distance = MeasurementInput::new(DimensionKind::Length, distance, units);
                form.second_distance =
                    MeasurementInput::new(DimensionKind::Length, second_distance, units);
            }
            ExtrudeExtent::ToFace { face_id } => {
                let mut found = model.scene.bodies.iter().flat_map(|body| {
                    body.faces
                        .iter()
                        .filter(move |face| face.id == face_id && face.plane.is_some())
                        .map(move |_| PlanarFaceSourceDto {
                            body_id: body.id,
                            face_id,
                        })
                });
                form.stop_face = found.next();
                if found.next().is_some() {
                    return Err("The stop-face reference is ambiguous in the current model".into());
                }
            }
            ExtrudeExtent::ThroughAll => (),
        }
        form.taper = MeasurementInput::new(DimensionKind::Angle, definition.taper_angle_deg, units);
        Ok(form)
    }

    pub(crate) fn owner(&self) -> &DocumentContext {
        &self.stamp.owner
    }
    pub(crate) fn model_revision(&self) -> u64 {
        self.stamp.model_revision
    }
    pub(crate) fn is_open(&self) -> bool {
        self.phase != Phase::Closed
    }
    pub(crate) fn is_busy(&self) -> bool {
        self.phase == Phase::Applying
    }
    pub(crate) fn engine_error(&self) -> Option<&str> {
        self.engine_error.as_deref()
    }
    pub(crate) fn source(&self) -> &ExtrudeSource {
        &self.source
    }

    fn check_model(&self, model: &FormModel<'_>) -> Result<(), String> {
        if self.stamp.owner != *model.owner || self.stamp.model_revision != model.engine_revision {
            return Err("The document changed; reopen Extrude with its current references".into());
        }
        if self.phase == Phase::Closed {
            return Err("The Extrude form is closed".into());
        }
        Ok(())
    }

    fn editing(&self, model: &FormModel<'_>) -> Result<(), String> {
        self.check_model(model)?;
        if self.phase != Phase::Editing {
            return Err("Extrude is still applying".into());
        }
        self.stamp
            .edit
            .checked_add(1)
            .ok_or("Extrude form revision exhausted")?;
        Ok(())
    }

    fn changed(&mut self) {
        self.stamp.edit += 1; // preflighted by editing(), before modifying fields
        self.engine_error = None;
    }

    pub(crate) fn set_value(
        &mut self,
        field: ExtrudeField,
        value: &str,
        model: &FormModel<'_>,
    ) -> Result<(), String> {
        self.editing(model)?;
        match field {
            ExtrudeField::Distance => self.distance.set_text(value.into()),
            ExtrudeField::SecondDistance => self.second_distance.set_text(value.into()),
            ExtrudeField::Taper => self.taper.set_text(value.into()),
            ExtrudeField::Operation => {
                self.operation =
                    serde_json::from_value(json!(value)).map_err(|error| error.to_string())?;
                self.operation_manual = true;
            }
            ExtrudeField::Extent => {
                // Deserialize the existing tagged extent type rather than
                // maintaining a parallel variant/schema registry.
                self.extent = serde_json::from_value(
                    json!({"type":value,"distance":10.,"second_distance":10.,"face_id":0}),
                )
                .map_err(|error| error.to_string())?;
            }
            ExtrudeField::Flip => {
                self.flip = match value {
                    "true" => true,
                    "false" => false,
                    _ => return Err("Flip expects true or false".into()),
                }
            }
            _ => return Err("Use the geometry picker to change this reference".into()),
        }
        self.changed();
        Ok(())
    }

    pub(crate) fn set_source(
        &mut self,
        source: ExtrudeSource,
        model: &FormModel<'_>,
    ) -> Result<(), String> {
        self.editing(model)?;
        if source != ExtrudeSource::None {
            validate_source(&source, model)?;
        }
        if !self.operation_manual {
            if let ExtrudeSource::Face(face) = &source {
                self.operation = ExtrudeOperation::Join;
                self.targets = vec![face.body_id];
            } else {
                self.operation = ExtrudeOperation::NewBody;
                self.targets.clear();
            }
        }
        self.source = source;
        self.changed();
        Ok(())
    }

    pub(crate) fn set_targets(
        &mut self,
        targets: Vec<BodyId>,
        model: &FormModel<'_>,
    ) -> Result<(), String> {
        self.editing(model)?;
        validate_targets(&targets, model)?;
        self.targets = targets;
        self.operation_manual = true;
        self.changed();
        Ok(())
    }

    pub(crate) fn set_stop_face(
        &mut self,
        face: Option<PlanarFaceSourceDto>,
        model: &FormModel<'_>,
    ) -> Result<(), String> {
        self.editing(model)?;
        if let Some(face) = face {
            validate_face(face, model)?;
        }
        self.stop_face = face;
        self.changed();
        Ok(())
    }

    fn request(
        &self,
        model: &FormModel<'_>,
    ) -> Result<ExtrudeRequest, Vec<(ExtrudeField, String)>> {
        use ExtrudeField as F;
        let mut errors = Vec::new();
        if let Err(error) = self.check_model(model) {
            return Err(vec![(F::Source, error)]);
        }
        if let Some(feature) = self.feature {
            if !model
                .document
                .features
                .iter()
                .any(|entry| entry.id == feature && entry.kind == FeatureKind::Extrude)
            {
                errors.push((
                    F::Source,
                    "The edited Extrude feature no longer exists".into(),
                ));
            }
        }
        if let Err(error) = validate_source(&self.source, model) {
            errors.push((F::Source, error));
        }
        let units = model.document.settings.units;
        let mut measure =
            |field, input: &MeasurementInput| match input.evaluate(units, model.parameters) {
                Ok(value) => Some(value),
                Err(error) => {
                    errors.push((field, error));
                    None
                }
            };
        let distance = if matches!(
            self.extent,
            ExtrudeExtent::Distance { .. }
                | ExtrudeExtent::Symmetric { .. }
                | ExtrudeExtent::TwoSides { .. }
        ) {
            measure(F::Distance, &self.distance)
        } else {
            None
        };
        let second = if matches!(self.extent, ExtrudeExtent::TwoSides { .. }) {
            measure(F::SecondDistance, &self.second_distance)
        } else {
            None
        };
        let taper = measure(F::Taper, &self.taper);
        let extent = match self.extent {
            ExtrudeExtent::Distance { .. } => {
                if distance.is_some_and(|value| value.abs() <= 1e-6) {
                    errors.push((F::Distance, "Distance must be nonzero".into()));
                }
                ExtrudeExtent::Distance {
                    distance: distance.unwrap_or(0.),
                }
            }
            ExtrudeExtent::Symmetric { .. } => {
                if distance.is_some_and(|value| value <= 1e-6) {
                    errors.push((F::Distance, "Symmetric distance must be positive".into()));
                }
                ExtrudeExtent::Symmetric {
                    distance: distance.unwrap_or(0.),
                }
            }
            ExtrudeExtent::TwoSides { .. } => {
                if distance.is_some_and(|value| value <= 1e-6) {
                    errors.push((F::Distance, "First distance must be positive".into()));
                }
                if second.is_some_and(|value| value <= 1e-6) {
                    errors.push((F::SecondDistance, "Second distance must be positive".into()));
                }
                ExtrudeExtent::TwoSides {
                    distance: distance.unwrap_or(0.),
                    second_distance: second.unwrap_or(0.),
                }
            }
            ExtrudeExtent::ThroughAll => ExtrudeExtent::ThroughAll,
            ExtrudeExtent::ToFace { .. } => {
                match self.stop_face {
                    Some(face) => {
                        if let Err(error) = validate_stop_face(&self.source, face, model) {
                            errors.push((F::StopFace, error));
                        }
                    }
                    None => errors.push((F::StopFace, "Select a planar stop face".into())),
                }
                ExtrudeExtent::ToFace {
                    face_id: self
                        .stop_face
                        .map(|face| face.face_id)
                        .unwrap_or(nbcad_core::FaceId(0)),
                }
            }
        };
        if taper.is_some_and(|value| value.abs() >= 89.) {
            errors.push((F::Taper, "Taper must be between -89 and 89 degrees".into()));
        }
        if self.operation != ExtrudeOperation::NewBody {
            if let Err(error) = validate_targets(&self.targets, model) {
                errors.push((F::Targets, error));
            }
            let joined_profiles = self.operation == ExtrudeOperation::Join
                && matches!(&self.source,ExtrudeSource::Profiles{indices,..} if indices.len()>1);
            if self.targets.is_empty() && !joined_profiles {
                errors.push((F::Targets, "Select a target body for this operation".into()));
            }
        }
        if !errors.is_empty() {
            return Err(errors);
        }
        let (source_face, sketch_name, profile_indices) = match &self.source {
            ExtrudeSource::Face(face) => (Some(*face), String::new(), Vec::new()),
            ExtrudeSource::Profiles {
                sketch_name,
                indices,
            } => (None, sketch_name.clone(), indices.clone()),
            ExtrudeSource::None => unreachable!("validated above"),
        };
        Ok(ExtrudeRequest {
            source_face,
            sketch_name,
            profile_indices,
            operation: self.operation,
            extent,
            taper_angle_deg: taper.unwrap(),
            flip: self.flip,
            target_body_ids: if self.operation == ExtrudeOperation::NewBody {
                Vec::new()
            } else {
                self.targets.clone()
            },
        })
    }

    pub(crate) fn can_apply(&self, model: &FormModel<'_>) -> bool {
        self.phase == Phase::Editing && self.request(model).is_ok()
    }

    pub(crate) fn prepare_preview(&self, model: &FormModel<'_>) -> Result<PreviewTicket, String> {
        self.editing(model)?;
        let request = self.request(model).map_err(first_error)?;
        Ok(PreviewTicket {
            stamp: self.stamp.clone(),
            request,
        })
    }

    pub(crate) fn accepts_preview(&self, ticket: &PreviewTicket, model: &FormModel<'_>) -> bool {
        self.phase == Phase::Editing
            && self.check_model(model).is_ok()
            && self.matches(&ticket.stamp)
    }

    pub(crate) fn prepare_apply(&mut self, model: &FormModel<'_>) -> Result<ApplyTicket, String> {
        self.editing(model)?;
        let request = self.request(model).map_err(first_error)?;
        let (operation, arguments) = if let Some(feature_id) = self.feature {
            (
                "solid_edit_extrude",
                serde_json::to_value(EditExtrudeRequest {
                    feature_id,
                    extrude: request,
                }),
            )
        } else {
            ("solid_extrude", serde_json::to_value(request))
        };
        let arguments = arguments.map_err(|error| error.to_string())?;
        // Every Apply attempt has its own generation, including retrying the
        // same text after an unchanged failure. An older completion cannot
        // close or fail the replacement attempt.
        self.changed();
        self.phase = Phase::Applying;
        Ok(ApplyTicket {
            stamp: self.stamp.clone(),
            operation,
            arguments,
        })
    }

    pub(crate) fn apply_failed(
        &mut self,
        ticket: &ApplyTicket,
        model: &FormModel<'_>,
        error: String,
    ) -> Result<(), String> {
        if self.phase != Phase::Applying || !self.matches(&ticket.stamp) {
            return Err("This completion belongs to another Extrude operation".into());
        }
        if let Err(changed) = self.check_model(model) {
            self.phase = Phase::Closed;
            return Err(changed);
        }
        self.phase = Phase::Editing;
        self.engine_error = Some(error);
        Ok(())
    }

    pub(crate) fn apply_succeeded(
        &mut self,
        ticket: &ApplyTicket,
        owner: &DocumentContext,
        engine_revision: u64,
    ) -> Result<(), String> {
        if self.phase != Phase::Applying || !self.matches(&ticket.stamp) {
            return Err("This completion belongs to another Extrude operation".into());
        }
        self.phase = Phase::Closed;
        if self.stamp.owner != *owner || engine_revision <= self.stamp.model_revision {
            return Err("Extrude completion no longer owns the edited document".into());
        }
        Ok(())
    }

    /// Close even a stale form. Restore the host's previously captured preview
    /// only when true: an old owner must never paint over its replacement.
    pub(crate) fn cancel(&mut self, model: &FormModel<'_>) -> Result<bool, String> {
        if self.phase == Phase::Applying {
            return Err("Extrude is still applying".into());
        }
        let restore_previous_preview = self.check_model(model).is_ok();
        self.phase = Phase::Closed;
        Ok(restore_previous_preview)
    }

    fn matches(&self, other: &Stamp) -> bool {
        Arc::ptr_eq(&self.stamp.identity, &other.identity)
            && self.stamp.owner == other.owner
            && self.stamp.model_revision == other.model_revision
            && self.stamp.edit == other.edit
    }

    pub(crate) fn fields(&self, model: &FormModel<'_>) -> Vec<ExtrudeFieldView> {
        use ExtrudeField as F;
        let issues = self.request(model).err().unwrap_or_default();
        let enabled = self.phase == Phase::Editing && self.check_model(model).is_ok();
        let text = |value: &MeasurementInput| Field::Text {
            value: value.text().into(),
            read_only: false,
            selection: None,
        };
        let choice = |value: Value, options: Vec<(&str, &str)>| Field::Choice {
            value: value.as_str().unwrap().into(),
            options: options
                .into_iter()
                .map(|(value, label)| ChoiceOption {
                    value: value.into(),
                    label: label.into(),
                    disabled: false,
                })
                .collect(),
        };
        let source_label = match &self.source {
            ExtrudeSource::None => "Select profiles or a planar face".into(),
            ExtrudeSource::Face(face) => {
                format!("Source: body {} · face {}", face.body_id.0, face.face_id.0)
            }
            ExtrudeSource::Profiles {
                sketch_name,
                indices,
            } => format!("{sketch_name} · {} profile(s)", indices.len()),
        };
        let stop_label = self
            .stop_face
            .map(|face| format!("Stop: body {} · face {}", face.body_id.0, face.face_id.0))
            .unwrap_or_else(|| "Select stop face".into());
        let rows = vec![
            (F::Source, source_label, Field::None, true),
            (
                F::Operation,
                "Operation".into(),
                choice(
                    json!(self.operation),
                    vec![
                        ("new_body", "New body"),
                        ("join", "Join"),
                        ("cut", "Cut"),
                        ("intersect", "Intersect"),
                    ],
                ),
                true,
            ),
            (
                F::Extent,
                "Extent".into(),
                choice(
                    json!(self.extent)["type"].clone(),
                    vec![
                        ("distance", "Distance"),
                        ("two_sides", "Two sides"),
                        ("symmetric", "Symmetric"),
                        ("through_all", "Through all"),
                        ("to_face", "To face"),
                    ],
                ),
                true,
            ),
            (
                F::Distance,
                format!(
                    "Distance ({})",
                    json!(model.document.settings.units).as_str().unwrap()
                ),
                text(&self.distance),
                matches!(
                    self.extent,
                    ExtrudeExtent::Distance { .. }
                        | ExtrudeExtent::TwoSides { .. }
                        | ExtrudeExtent::Symmetric { .. }
                ),
            ),
            (
                F::SecondDistance,
                format!(
                    "Second distance ({})",
                    json!(model.document.settings.units).as_str().unwrap()
                ),
                text(&self.second_distance),
                matches!(self.extent, ExtrudeExtent::TwoSides { .. }),
            ),
            (F::Taper, "Taper (degrees)".into(), text(&self.taper), true),
            (
                F::Flip,
                "Flip direction".into(),
                Field::Toggle(self.flip),
                true,
            ),
            (
                F::Targets,
                format!("Target bodies ({})", self.targets.len()),
                Field::None,
                self.operation != ExtrudeOperation::NewBody,
            ),
            (
                F::StopFace,
                stop_label,
                Field::None,
                matches!(self.extent, ExtrudeExtent::ToFace { .. }),
            ),
        ];
        rows.into_iter()
            .map(|(field, label, value, visible)| ExtrudeFieldView {
                field,
                label,
                value,
                error: issues
                    .iter()
                    .find(|(item, _)| *item == field)
                    .map(|(_, error)| error.clone()),
                visible,
                enabled,
            })
            .collect()
    }
}

fn first_error(errors: Vec<(ExtrudeField, String)>) -> String {
    errors
        .into_iter()
        .next()
        .map(|(_, error)| error)
        .unwrap_or_else(|| "Extrude is not ready".into())
}

fn validate_targets(targets: &[BodyId], model: &FormModel<'_>) -> Result<(), String> {
    for (index, target) in targets.iter().enumerate() {
        if targets[..index].contains(target) {
            return Err("A target body was selected more than once".into());
        }
        if !model.scene.bodies.iter().any(|body| body.id == *target) {
            return Err(format!("Target body {} no longer exists", target.0));
        }
    }
    Ok(())
}

fn validate_face(source: PlanarFaceSourceDto, model: &FormModel<'_>) -> Result<(), String> {
    let face = model
        .scene
        .bodies
        .iter()
        .find(|body| body.id == source.body_id)
        .and_then(|body| body.faces.iter().find(|face| face.id == source.face_id));
    if !face.is_some_and(|face| face.plane.is_some()) {
        return Err("The selected planar face no longer belongs to this body".into());
    }
    if model
        .scene
        .bodies
        .iter()
        .flat_map(|body| &body.faces)
        .filter(|face| face.id == source.face_id)
        .count()
        != 1
    {
        return Err("The face identifier is ambiguous in the current model".into());
    }
    Ok(())
}

fn validate_stop_face(
    source: &ExtrudeSource,
    stop: PlanarFaceSourceDto,
    model: &FormModel<'_>,
) -> Result<(), String> {
    validate_face(stop, model)?;
    let face_basis = |reference: PlanarFaceSourceDto| {
        model
            .scene
            .bodies
            .iter()
            .find(|body| body.id == reference.body_id)
            .and_then(|body| body.faces.iter().find(|face| face.id == reference.face_id))
            .and_then(|face| face.plane)
    };
    let source_basis = match source {
        ExtrudeSource::Face(face) => face_basis(*face),
        ExtrudeSource::Profiles { sketch_name, .. } => model
            .profiles
            .iter()
            .find(|catalog| catalog.sketch_name == *sketch_name)
            .map(|catalog| catalog.basis),
        ExtrudeSource::None => None,
    };
    if let (Some(source), Some(stop)) = (source_basis, face_basis(stop)) {
        let alignment: f64 = source
            .normal
            .iter()
            .zip(stop.normal)
            .map(|(a, b)| a * b)
            .sum();
        // Match the existing kernel extent contract. A tilted stop must not
        // look applicable only to fail after the user presses Apply.
        if alignment.abs() < 1. - 1e-6 {
            return Err("To Face currently requires a parallel planar face".into());
        }
        let distance: f64 = stop
            .origin
            .iter()
            .zip(source.origin)
            .zip(source.normal)
            .map(|((stop, source), normal)| (stop - source) * normal)
            .sum();
        if distance.abs() <= 1e-7 {
            return Err("The stop face lies on the source plane".into());
        }
    }
    Ok(())
}

fn validate_source(source: &ExtrudeSource, model: &FormModel<'_>) -> Result<(), String> {
    match source {
        ExtrudeSource::None => Err("Select a sketch profile or planar source face".into()),
        ExtrudeSource::Face(face) => validate_face(*face, model),
        ExtrudeSource::Profiles {
            sketch_name,
            indices,
        } => {
            let catalog = model
                .profiles
                .iter()
                .find(|entry| entry.sketch_name == *sketch_name)
                .ok_or("The source sketch no longer exists")?;
            if indices.is_empty() {
                return Err("Select at least one material profile".into());
            }
            for (position, index) in indices.iter().enumerate() {
                if indices[..position].contains(index) {
                    return Err("A profile was selected more than once".into());
                }
                if !catalog
                    .profiles
                    .iter()
                    .any(|profile| profile.index == *index && profile.nesting_depth % 2 == 0)
                {
                    return Err(format!(
                        "Profile {index} is not an available material region"
                    ));
                }
            }
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests;
