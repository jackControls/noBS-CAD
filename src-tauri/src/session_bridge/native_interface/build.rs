//! Native profile-feature transaction: retained fields, real shared engine commands,
//! and transient renderer data all belong to one exact document revision.

use std::collections::HashMap;

use bevy::prelude::{Resource, World};
use nbcad_core::{BodyId, DocumentDto};
use nbcad_interface::{ControlInput, DocumentContext};
use nbcad_solid::{
    ExtrudeDefinitionDto, LoftDefinitionDto, PathRefDto, PlanarFaceSourceDto, ProfileRefDto,
    RevolveDefinitionDto, SweepDefinitionDto,
};
use serde_json::{json, Value};

use super::{check_owner, finish_mutation, model_snapshot, workspace::DocumentReceipt};
use crate::{
    native_forms::{BuildForm, DimensionKind, FormModel, ParameterValue, ProfileSource},
    native_viewport::{self, ViewportModel, ViewportPreview},
    session_bridge::{parse_engine_envelope, SessionBridgeState},
    state::AppState,
};

pub(crate) use crate::native_forms::{BuildField, BuildFieldView, BuildKind};

mod apply;
#[cfg(feature = "dev-bevy-host")]
pub(crate) mod panel;
#[cfg(feature = "dev-bevy-host")]
mod picking;
mod preview;
#[cfg(feature = "dev-bevy-host")]
pub(crate) use picking::handle_canvas_pick;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum BuildCommand {
    Open {
        kind: BuildKind,
        feature_id: Option<u64>,
    },
    Control {
        form_id: u64,
        action: BuildControl,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum BuildControl {
    Field(BuildField),
    Pick(BuildField),
    Clear(BuildField),
    Choose { field: BuildField, option: usize },
    Apply,
    Cancel,
}

/// References are accepted only from the currently rendered source model.
/// Occurrence picks must be resolved to the edited component by the caller;
/// a placed assembly face is not a source-local face with the same integer ID.
#[derive(Clone, Debug)]
pub(crate) enum BuildPick {
    Profiles(Vec<ProfileRefDto>),
    Bodies(Vec<BodyId>),
    Face(PlanarFaceSourceDto),
    AxisLine { sketch_name: String, entity_id: u64 },
    Path(PathRefDto),
}

pub(crate) struct BuildPanel {
    pub kind: BuildKind,
    pub form_id: u64,
    pub fields: Vec<BuildFieldView>,
    pub can_apply: bool,
    pub busy: bool,
    pub error: Option<String>,
    pub preview_notice: Option<String>,
    pub pick_target: Option<BuildField>,
    pub choice_field: Option<BuildField>,
}

struct Snapshot {
    receipt: DocumentReceipt,
    document: DocumentDto,
    viewport: ViewportModel,
    parameters: HashMap<String, Vec<ParameterValue>>,
}

impl Snapshot {
    fn capture(engine: &AppState, receipt: DocumentReceipt) -> Self {
        let viewport = model_snapshot(engine);
        let parameters = viewport
            .finished_sketches
            .iter()
            .map(|sketch| {
                let values = sketch
                    .dimensions
                    .iter()
                    .filter_map(|dimension| {
                        Some(ParameterValue {
                            name: dimension.param_name.clone()?,
                            kind: if dimension.kind == "angle" {
                                DimensionKind::Angle
                            } else {
                                DimensionKind::Length
                            },
                            value: dimension.value,
                        })
                    })
                    .collect();
                (sketch.name.clone(), values)
            })
            .collect();
        Self {
            receipt,
            document: engine.document_snapshot(),
            viewport,
            parameters,
        }
    }

    fn model(&self, source: Option<&str>) -> FormModel<'_> {
        let parameters = match source {
            Some(sketch_name) => self
                .parameters
                .get(sketch_name)
                .map(Vec::as_slice)
                .unwrap_or(&[]),
            _ => &[],
        };
        FormModel {
            owner: &self.receipt.owner,
            engine_revision: self.receipt.revision,
            document: &self.document,
            profiles: &self.viewport.profile_catalog,
            scene: &self.viewport.scene,
            parameters,
        }
    }
}

struct Editor {
    id: u64,
    form: BuildForm,
    snapshot: Snapshot,
    previous_preview: ViewportPreview,
    preview_revision: u64,
    preview_notice: Option<String>,
    pick_target: Option<BuildField>,
    choice_field: Option<BuildField>,
}

#[derive(Resource, Default)]
struct NativeBuild {
    last_id: u64,
    editor: Option<Editor>,
}

/// The small receipt and effects are fenced together. Do not nest another
/// publisher-locking bridge operation inside `apply`.
fn with_receipt<T>(
    bridge: &SessionBridgeState,
    engine: &AppState,
    owner: &DocumentContext,
    apply: impl FnOnce(DocumentReceipt) -> Result<T, String>,
) -> Result<T, String> {
    let publishers = bridge
        .publishers
        .lock()
        .map_err(|_| "Session publisher lock poisoned")?;
    let publisher = publishers
        .get(&owner.window_id)
        .ok_or("Native window no longer exists")?;
    check_owner(publisher, engine, owner)?;
    apply(DocumentReceipt {
        owner: owner.clone(),
        revision: publisher.by_project[&owner.document_id].engine_revision,
    })
}

fn check_revision(editor: &Editor, receipt: &DocumentReceipt) -> Result<(), String> {
    if editor.snapshot.receipt != *receipt {
        return Err(
            "The design changed; cancel and reopen the feature with its current references".into(),
        );
    }
    Ok(())
}

pub(crate) fn panel(world: &World) -> Option<BuildPanel> {
    let editor = world.get_resource::<NativeBuild>()?.editor.as_ref()?;
    let model = editor.snapshot.model(editor.form.parameter_sketch());
    Some(BuildPanel {
        kind: editor.form.kind(),
        form_id: editor.id,
        fields: editor.form.fields(&model),
        can_apply: editor.form.can_apply(&model),
        busy: editor.form.is_busy(),
        error: editor.form.engine_error().map(str::to_owned),
        preview_notice: editor.preview_notice.clone(),
        pick_target: editor.pick_target,
        choice_field: editor.choice_field,
    })
}

/// A form cannot follow a model change, tab switch or project replacement.
/// Call after the native scene refresh and before publishing its controls.
pub(crate) fn synchronize(
    engine: &AppState,
    bridge: &SessionBridgeState,
    world: &mut World,
    owner: &DocumentContext,
) -> Result<(), String> {
    let mut state = world.remove_resource::<NativeBuild>().unwrap_or_default();
    let result = with_receipt(bridge, engine, owner, |receipt| {
        if state
            .editor
            .as_ref()
            .is_some_and(|editor| editor.snapshot.receipt != receipt)
        {
            let editor = state.editor.take().unwrap();
            if native_viewport::interface_preview_revision(world) == editor.preview_revision {
                native_viewport::apply_interface_preview(
                    world,
                    &owner.document_id,
                    ViewportPreview::default(),
                )?;
            }
        }
        Ok(())
    });
    world.insert_resource(state);
    result
}

fn update_preview(editor: &mut Editor, world: &mut World) -> Result<(), String> {
    let model = editor.snapshot.model(editor.form.parameter_sketch());
    // Invalid text remains the actual field draft, but must not leave a
    // stale last-valid extrusion appearing to describe the invalid input.
    let (next, notice) = if editor.form.kind() != BuildKind::Extrude {
        match preview::references(&editor.form, &model, &editor.snapshot.viewport) {
            Ok(value) => (value, None),
            Err(e) => (ViewportPreview::default(), Some(e)),
        }
    } else {
        match editor.form.prepare_preview(&model) {
            Ok(ticket) => match preview::build(ticket.request(), &editor.snapshot.viewport) {
                Ok(next) if editor.form.accepts_preview(&ticket, &model) => (next, None),
                Ok(_) => return Err("Extrude preview was superseded".into()),
                Err(error) => (ViewportPreview::default(), Some(error)),
            },
            Err(_) => (ViewportPreview::default(), None),
        }
    };
    native_viewport::apply_interface_preview(world, &model.owner.document_id, next)?;
    editor.preview_revision = native_viewport::interface_preview_revision(world);
    editor.preview_notice = notice;
    Ok(())
}

fn selected_source(world: &World) -> Result<Option<BuildPick>, String> {
    let (_, _, presentation, _) = native_viewport::interface_view_snapshot(world);
    if presentation.selected_occurrence_id.is_some() {
        return Err(
            "Open the component for editing before extruding an assembly occurrence".into(),
        );
    }
    if !presentation.selected_profiles.is_empty() {
        return Ok(Some(BuildPick::Profiles(presentation.selected_profiles)));
    }
    match (
        presentation.selected_body_ids.as_slice(),
        presentation.selected_face_ids.as_slice(),
    ) {
        ([body], [face]) => Ok(Some(BuildPick::Face(PlanarFaceSourceDto {
            body_id: BodyId(*body),
            face_id: nbcad_core::FaceId(*face),
        }))),
        _ => Ok(None),
    }
}

fn apply_pick(editor: &mut Editor, pick: BuildPick) -> Result<(), String> {
    let model = editor.snapshot.model(editor.form.parameter_sketch());
    match (editor.pick_target, pick) {
        (Some(BuildField::Source), BuildPick::Profiles(profiles)) => {
            editor.form.set_profiles(profiles, &model)
        }
        (Some(field @ (BuildField::Path | BuildField::Guide)), BuildPick::Path(path)) => editor
            .form
            .set_path(field, (!path.entity_ids.is_empty()).then_some(path), &model),
        (Some(BuildField::Source), BuildPick::Face(face)) => {
            editor.form.set_source(ProfileSource::Face(face), &model)
        }
        (Some(BuildField::Targets), BuildPick::Bodies(bodies)) => {
            editor.form.set_targets(bodies, &model)
        }
        (Some(BuildField::StopFace), BuildPick::Face(face)) => {
            editor.form.set_stop_face(Some(face), &model)
        }
        (
            Some(BuildField::AxisLine),
            BuildPick::AxisLine {
                sketch_name,
                entity_id,
            },
        ) => editor.form.set_axis(Some((sketch_name, entity_id)), &model),
        _ => Err("This selection does not match the active feature reference field".into()),
    }
}

pub(crate) fn accept_pick(
    engine: &AppState,
    bridge: &SessionBridgeState,
    world: &mut World,
    owner: &DocumentContext,
    form_id: u64,
    pick: BuildPick,
    validate_control: impl FnOnce() -> Result<(), String>,
) -> Result<Value, String> {
    let mut state = world.remove_resource::<NativeBuild>().unwrap_or_default();
    let result = with_receipt(bridge, engine, owner, |receipt| {
        validate_control()?;
        let editor = state
            .editor
            .as_mut()
            .filter(|editor| editor.id == form_id)
            .ok_or("The feature form changed")?;
        check_revision(editor, &receipt)?;
        apply_pick(editor, pick)?;
        update_preview(editor, world)?;
        Ok(json!({"form_id":form_id,"reference_accepted":true}))
    });
    world.insert_resource(state);
    result
}

pub(crate) fn reduce(
    engine: &AppState,
    bridge: &SessionBridgeState,
    world: &mut World,
    owner: &DocumentContext,
    command: &BuildCommand,
    input: &ControlInput,
    validate_control: impl FnOnce() -> Result<(), String>,
) -> Result<Value, String> {
    if matches!(input, ControlInput::Key(key) if key.key == "Escape" && !key.ctrl && !key.meta && !key.alt && !key.shift)
    {
        if let BuildCommand::Control { form_id, .. } = command {
            // The focused field's original binding/owner still authorize
            // this input; Escape closes that same form, not a later editor.
            return reduce(
                engine,
                bridge,
                world,
                owner,
                &BuildCommand::Control {
                    form_id: *form_id,
                    action: BuildControl::Cancel,
                },
                &ControlInput::Click,
                validate_control,
            );
        }
    }
    let field_edit = matches!(
        command,
        BuildCommand::Control {
            action: BuildControl::Field(_),
            ..
        }
    );
    if (field_edit
        && !matches!(
            input,
            ControlInput::SetValue(_)
                | ControlInput::Click
                | ControlInput::DoubleClick
                | ControlInput::Key(_)
        ))
        || (!field_edit && !super::is_activation(input))
    {
        return Err("This input does not match the feature control".into());
    }
    let mut state = world.remove_resource::<NativeBuild>().unwrap_or_default();
    let result = reduce_owned(
        engine,
        bridge,
        world,
        owner,
        command,
        input,
        validate_control,
        &mut state,
    );
    world.insert_resource(state);
    result
}

fn reduce_owned(
    engine: &AppState,
    bridge: &SessionBridgeState,
    world: &mut World,
    owner: &DocumentContext,
    command: &BuildCommand,
    input: &ControlInput,
    validate_control: impl FnOnce() -> Result<(), String>,
    state: &mut NativeBuild,
) -> Result<Value, String> {
    if let BuildCommand::Open { kind, feature_id } = command {
        return with_receipt(bridge, engine, owner, |receipt| {
            validate_control()?;
            if state.editor.is_some() {
                return Err("Finish or cancel the open feature form first".into());
            }
            let id = state
                .last_id
                .checked_add(1)
                .ok_or("Feature form identities exhausted")?;
            let snapshot = Snapshot::capture(engine, receipt);
            if snapshot.viewport.active_sketch.is_some() {
                return Err("Finish the active sketch before opening a solid feature".into());
            }
            if snapshot.viewport.session_id != owner.document_id
                || native_viewport::interface_view_snapshot(world).0 != owner.document_id
            {
                return Err("The rendered design is not current".into());
            }
            let model = snapshot.model(None);
            #[cfg(feature = "dev-bevy-host")]
            crate::native_editor::support::cancel(world, owner)?;
            let form = if let (BuildKind::Rib, Some(id)) = (kind, feature_id) {
                let definitions: Vec<nbcad_solid::RibDefinitionDto> = serde_json::from_value(
                    parse_engine_envelope(engine.engine_call("rib_definitions", ""))?,
                )
                .map_err(|e| e.to_string())?;
                BuildForm::edit_rib(
                    definitions
                        .iter()
                        .find(|d| d.feature_id.0 == *id)
                        .ok_or("The selected Rib no longer exists")?,
                    &model,
                )?
            } else if let (BuildKind::Sweep, Some(id)) = (kind, feature_id) {
                let definitions: Vec<SweepDefinitionDto> = serde_json::from_value(
                    parse_engine_envelope(engine.engine_call("sweep_definitions", ""))?,
                )
                .map_err(|e| e.to_string())?;
                BuildForm::edit_sweep(
                    definitions
                        .iter()
                        .find(|d| d.feature_id.0 == *id)
                        .ok_or("The selected Sweep no longer exists")?,
                    &model,
                )?
            } else if let (BuildKind::Loft, Some(id)) = (kind, feature_id) {
                let definitions: Vec<LoftDefinitionDto> = serde_json::from_value(
                    parse_engine_envelope(engine.engine_call("loft_definitions", ""))?,
                )
                .map_err(|e| e.to_string())?;
                BuildForm::edit_loft(
                    definitions
                        .iter()
                        .find(|d| d.feature_id.0 == *id)
                        .ok_or("The selected Loft no longer exists")?,
                    &model,
                )?
            } else if let (BuildKind::Revolve, Some(id)) = (kind, feature_id) {
                let definitions: Vec<RevolveDefinitionDto> = serde_json::from_value(
                    parse_engine_envelope(engine.engine_call("revolve_definitions", ""))?,
                )
                .map_err(|e| e.to_string())?;
                let definition = definitions
                    .iter()
                    .find(|d| d.feature_id.0 == *id)
                    .ok_or("The selected Revolve no longer exists")?;
                BuildForm::edit_revolve(definition, &model)?
            } else if let Some(id) = feature_id {
                let definitions: Vec<ExtrudeDefinitionDto> = serde_json::from_value(
                    parse_engine_envelope(engine.engine_call("extrude_definitions", ""))?,
                )
                .map_err(|error| error.to_string())?;
                let definition = definitions
                    .iter()
                    .find(|definition| definition.feature_id.0 == *id)
                    .ok_or("The selected Extrude feature no longer exists")?;
                BuildForm::edit(definition, &model)?
            } else {
                BuildForm::new_kind(*kind, &model)
            };
            let mut editor = Editor {
                id,
                form,
                snapshot,
                previous_preview: native_viewport::interface_preview_snapshot(world),
                preview_revision: native_viewport::interface_preview_revision(world),
                preview_notice: None,
                pick_target: Some(if *kind == BuildKind::Rib {
                    BuildField::Path
                } else {
                    BuildField::Source
                }),
                choice_field: None,
            };
            if feature_id.is_none() && *kind != BuildKind::Rib {
                if let Some(pick) = selected_source(world)? {
                    if !matches!(pick, BuildPick::Face(_)) || *kind == BuildKind::Extrude {
                        apply_pick(&mut editor, pick)?;
                    }
                }
            }
            update_preview(&mut editor, world)?;
            state.editor = Some(editor);
            state.last_id = id;
            Ok(json!({"form_id":id,"opened":true}))
        });
    }
    let BuildCommand::Control { form_id, action } = command else {
        unreachable!()
    };
    if matches!(action, BuildControl::Apply) {
        return apply::begin(
            engine,
            bridge,
            world,
            owner,
            *form_id,
            validate_control,
            state,
        );
    }
    let editor = state
        .editor
        .as_mut()
        .filter(|editor| editor.id == *form_id)
        .ok_or("The feature form changed")?;
    if editor.form.is_busy() {
        return Err("The feature is still applying".into());
    }
    let mut close = false;
    let result = with_receipt(bridge, engine, owner, |receipt| {
        validate_control()?;
        if matches!(action, BuildControl::Cancel) {
            let owns_preview =
                native_viewport::interface_preview_revision(world) == editor.preview_revision;
            let can_restore = receipt == editor.snapshot.receipt && owns_preview;
            let mut model = editor.snapshot.model(editor.form.parameter_sketch());
            model.owner = &receipt.owner;
            model.engine_revision = receipt.revision;
            editor.form.cancel(&model)?;
            let restoration = if can_restore {
                native_viewport::apply_interface_preview(
                    world,
                    &receipt.owner.document_id,
                    editor.previous_preview.clone(),
                )
            } else if owns_preview {
                native_viewport::apply_interface_preview(
                    world,
                    &receipt.owner.document_id,
                    ViewportPreview::default(),
                )
            } else {
                Ok(())
            };
            close = true;
            return Ok(
                json!({"form_id":form_id,"cancelled":true,"preview_restored":can_restore && restoration.is_ok(),"preview_error":restoration.err()}),
            );
        }
        check_revision(editor, &receipt)?;
        let model = editor.snapshot.model(editor.form.parameter_sketch());
        match action {
            BuildControl::Field(field) => {
                let row = editor
                    .form
                    .fields(&model)
                    .into_iter()
                    .find(|row| row.field == *field && row.visible && row.enabled)
                    .ok_or("This feature field is not available")?;
                match (input, row.value) {
                    (ControlInput::SetValue(value), _) => {
                        editor.form.set_value(*field, value, &model)?;
                        editor.choice_field = None;
                    }
                    (input, nbcad_interface::Field::Text { .. }) if super::is_activation(input) => {
                        return Ok(json!({"form_id":form_id,"focused":true}));
                    }
                    (input, nbcad_interface::Field::Toggle(value))
                        if super::is_activation(input) =>
                    {
                        editor.form.set_value(
                            *field,
                            if value { "false" } else { "true" },
                            &model,
                        )?;
                    }
                    (input, nbcad_interface::Field::Choice { value, options }) => {
                        if super::is_activation(input) {
                            editor.choice_field =
                                (editor.choice_field != Some(*field)).then_some(*field);
                            return Ok(
                                json!({"form_id":form_id,"choices_open":editor.choice_field.is_some()}),
                            );
                        }
                        let ControlInput::Key(key) = input else {
                            return Err("Choose an available field value".into());
                        };
                        if key.ctrl || key.meta || key.alt || key.shift {
                            return Err("This field key is not supported".into());
                        }
                        let options: Vec<_> =
                            options.iter().filter(|option| !option.disabled).collect();
                        let index = options
                            .iter()
                            .position(|option| option.value == value)
                            .unwrap_or(0);
                        let next = match key.key.as_str() {
                            "ArrowDown" => {
                                index.saturating_add(1).min(options.len().saturating_sub(1))
                            }
                            "ArrowUp" => index.saturating_sub(1),
                            "Home" => 0,
                            "End" => options.len().saturating_sub(1),
                            _ => return Err("This field key is not supported".into()),
                        };
                        let option = options
                            .get(next)
                            .ok_or("This field has no available choices")?;
                        editor.form.set_value(*field, &option.value, &model)?;
                    }
                    _ => return Err("This input does not match the feature field".into()),
                }
            }
            BuildControl::Choose { field, option } => {
                if editor.choice_field != Some(*field) && *field != BuildField::Axis {
                    return Err("This choice list is closed".into());
                }
                let row = editor
                    .form
                    .fields(&model)
                    .into_iter()
                    .find(|row| row.field == *field && row.visible && row.enabled)
                    .ok_or("This feature field is not available")?;
                let nbcad_interface::Field::Choice { options, .. } = row.value else {
                    return Err("This field has no choices".into());
                };
                let option = options
                    .get(*option)
                    .filter(|option| !option.disabled)
                    .ok_or("This field choice is not available")?;
                editor.form.set_value(*field, &option.value, &model)?;
                editor.choice_field = None;
            }
            BuildControl::Pick(field) => {
                if !matches!(
                    field,
                    BuildField::Source
                        | BuildField::Targets
                        | BuildField::StopFace
                        | BuildField::AxisLine
                        | BuildField::Path
                        | BuildField::Guide
                ) {
                    return Err("This field is not a geometry reference".into());
                }
                editor.pick_target = Some(*field);
                editor.choice_field = None;
            }
            BuildControl::Clear(field) => match field {
                BuildField::Source => editor.form.set_profiles(Vec::new(), &model)?,
                BuildField::Targets => editor.form.set_targets(Vec::new(), &model)?,
                BuildField::StopFace => editor.form.set_stop_face(None, &model)?,
                BuildField::AxisLine => editor.form.set_axis(None, &model)?,
                BuildField::Path | BuildField::Guide => {
                    editor.form.set_path(*field, None, &model)?
                }
                _ => return Err("This field is not a geometry reference".into()),
            },
            BuildControl::Apply | BuildControl::Cancel => unreachable!(),
        }
        if matches!(
            action,
            BuildControl::Field(BuildField::Axis)
                | BuildControl::Choose {
                    field: BuildField::Axis,
                    ..
                }
        ) {
            editor.pick_target = editor
                .form
                .fields(&model)
                .iter()
                .any(|r| r.field == BuildField::AxisLine && r.visible)
                .then_some(BuildField::AxisLine);
        }
        if matches!(
            action,
            BuildControl::Field(BuildField::Extent)
                | BuildControl::Choose {
                    field: BuildField::Extent,
                    ..
                }
        ) {
            let to_face = editor
                .form
                .fields(&model)
                .iter()
                .any(|row| row.field == BuildField::StopFace && row.visible);
            editor.pick_target = if to_face {
                Some(BuildField::StopFace)
            } else if editor.form.kind() == BuildKind::Rib {
                Some(BuildField::Path)
            } else {
                Some(BuildField::Source)
            };
        }
        if matches!(
            action,
            BuildControl::Field(BuildField::GuideEnabled | BuildField::CenterlineEnabled)
        ) {
            editor.pick_target = editor
                .form
                .fields(&model)
                .iter()
                .find(|r| {
                    r.visible
                        && r.field
                            == if matches!(action, BuildControl::Field(BuildField::GuideEnabled)) {
                                BuildField::Guide
                            } else {
                                BuildField::Path
                            }
                })
                .map(|r| r.field)
                .or(Some(BuildField::Source));
        }
        update_preview(editor, world)?;
        Ok(json!({"form_id":form_id,"edited":true}))
    });
    if close {
        state.editor = None;
    }
    result
}

#[cfg(all(test, feature = "dev-bevy-host"))]
mod tests;
