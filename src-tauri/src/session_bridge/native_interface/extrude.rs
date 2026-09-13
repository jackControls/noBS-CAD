//! Native Extrude transaction: retained fields, real shared engine commands,
//! and transient renderer data all belong to one exact document revision.

use std::collections::HashMap;

use bevy::prelude::{Resource, World};
use nbcad_core::{BodyId, DocumentDto};
use nbcad_interface::{ControlInput, DocumentContext};
use nbcad_solid::{ExtrudeDefinitionDto, PlanarFaceSourceDto, ProfileRefDto};
use serde_json::{json, Value};

use super::{check_owner, finish_mutation, model_snapshot, workspace::DocumentReceipt};
use crate::{
    native_forms::{DimensionKind, ExtrudeForm, ExtrudeSource, FormModel, ParameterValue},
    native_viewport::{self, ViewportModel, ViewportPreview},
    session_bridge::{parse_engine_envelope, SessionBridgeState},
    state::AppState,
};

pub(crate) use crate::native_forms::{ExtrudeField, ExtrudeFieldView};

mod preview;

#[derive(Clone, Debug)]
pub(crate) enum ExtrudeCommand {
    Open {
        feature_id: Option<u64>,
    },
    Control {
        form_id: u64,
        action: ExtrudeControl,
    },
}

#[derive(Clone, Copy, Debug)]
pub(crate) enum ExtrudeControl {
    Field(ExtrudeField),
    Pick(ExtrudeField),
    Clear(ExtrudeField),
    Apply,
    Cancel,
}

/// References are accepted only from the currently rendered source model.
/// Occurrence picks must be resolved to the edited component by the caller;
/// a placed assembly face is not a source-local face with the same integer ID.
#[derive(Clone, Debug)]
pub(crate) enum ExtrudePick {
    Profiles(Vec<ProfileRefDto>),
    Bodies(Vec<BodyId>),
    Face(PlanarFaceSourceDto),
}

pub(crate) struct ExtrudePanel {
    pub form_id: u64,
    pub fields: Vec<ExtrudeFieldView>,
    pub can_apply: bool,
    pub busy: bool,
    pub error: Option<String>,
    pub preview_notice: Option<String>,
    pub pick_target: Option<ExtrudeField>,
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

    fn model(&self, source: &ExtrudeSource) -> FormModel<'_> {
        let parameters = match source {
            ExtrudeSource::Profiles { sketch_name, .. } => self
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
    form: ExtrudeForm,
    snapshot: Snapshot,
    previous_preview: ViewportPreview,
    preview_notice: Option<String>,
    pick_target: Option<ExtrudeField>,
}

#[derive(Resource, Default)]
struct NativeExtrude {
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
            "The design changed; cancel and reopen Extrude with its current references".into(),
        );
    }
    Ok(())
}

pub(crate) fn panel(world: &World) -> Option<ExtrudePanel> {
    let editor = world.get_resource::<NativeExtrude>()?.editor.as_ref()?;
    let model = editor.snapshot.model(editor.form.source());
    Some(ExtrudePanel {
        form_id: editor.id,
        fields: editor.form.fields(&model),
        can_apply: editor.form.can_apply(&model),
        busy: editor.form.is_busy(),
        error: editor.form.engine_error().map(str::to_owned),
        preview_notice: editor.preview_notice.clone(),
        pick_target: editor.pick_target,
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
    let mut state = world.remove_resource::<NativeExtrude>().unwrap_or_default();
    let result = with_receipt(bridge, engine, owner, |receipt| {
        if state
            .editor
            .as_ref()
            .is_some_and(|editor| editor.snapshot.receipt != receipt)
        {
            state.editor = None;
            native_viewport::apply_interface_preview(
                world,
                &owner.document_id,
                ViewportPreview::default(),
            )?;
        }
        Ok(())
    });
    world.insert_resource(state);
    result
}

fn update_preview(editor: &mut Editor, world: &mut World) -> Result<(), String> {
    let model = editor.snapshot.model(editor.form.source());
    // Invalid text remains the actual field draft, but must not leave a
    // stale last-valid extrusion appearing to describe the invalid input.
    let (next, notice) = match editor.form.prepare_preview(&model) {
        Ok(ticket) => match preview::build(ticket.request(), &editor.snapshot.viewport) {
            Ok(next) if editor.form.accepts_preview(&ticket, &model) => (next, None),
            Ok(_) => return Err("Extrude preview was superseded".into()),
            Err(error) => (ViewportPreview::default(), Some(error)),
        },
        Err(_) => (ViewportPreview::default(), None),
    };
    native_viewport::apply_interface_preview(world, &model.owner.document_id, next)?;
    editor.preview_notice = notice;
    Ok(())
}

fn selected_source(world: &World) -> Result<Option<ExtrudePick>, String> {
    let (_, _, presentation, _) = native_viewport::interface_view_snapshot(world);
    if presentation.selected_occurrence_id.is_some() {
        return Err(
            "Open the component for editing before extruding an assembly occurrence".into(),
        );
    }
    if !presentation.selected_profiles.is_empty() {
        return Ok(Some(ExtrudePick::Profiles(presentation.selected_profiles)));
    }
    match (
        presentation.selected_body_ids.as_slice(),
        presentation.selected_face_ids.as_slice(),
    ) {
        ([body], [face]) => Ok(Some(ExtrudePick::Face(PlanarFaceSourceDto {
            body_id: BodyId(*body),
            face_id: nbcad_core::FaceId(*face),
        }))),
        _ => Ok(None),
    }
}

fn apply_pick(editor: &mut Editor, pick: ExtrudePick) -> Result<(), String> {
    let model = editor.snapshot.model(editor.form.source());
    match (editor.pick_target, pick) {
        (Some(ExtrudeField::Source), ExtrudePick::Profiles(profiles)) => {
            let first = profiles
                .first()
                .ok_or("Select at least one closed profile")?;
            if profiles
                .iter()
                .any(|profile| profile.sketch_name != first.sketch_name)
            {
                return Err("Extrude source profiles must belong to one sketch".into());
            }
            editor.form.set_source(
                ExtrudeSource::Profiles {
                    sketch_name: first.sketch_name.clone(),
                    indices: profiles
                        .iter()
                        .map(|profile| profile.profile_index)
                        .collect(),
                },
                &model,
            )
        }
        (Some(ExtrudeField::Source), ExtrudePick::Face(face)) => {
            editor.form.set_source(ExtrudeSource::Face(face), &model)
        }
        (Some(ExtrudeField::Targets), ExtrudePick::Bodies(bodies)) => {
            editor.form.set_targets(bodies, &model)
        }
        (Some(ExtrudeField::StopFace), ExtrudePick::Face(face)) => {
            editor.form.set_stop_face(Some(face), &model)
        }
        _ => Err("This selection does not match the active Extrude reference field".into()),
    }
}

pub(crate) fn accept_pick(
    engine: &AppState,
    bridge: &SessionBridgeState,
    world: &mut World,
    owner: &DocumentContext,
    form_id: u64,
    pick: ExtrudePick,
    validate_control: impl FnOnce() -> Result<(), String>,
) -> Result<Value, String> {
    let mut state = world.remove_resource::<NativeExtrude>().unwrap_or_default();
    let result = with_receipt(bridge, engine, owner, |receipt| {
        validate_control()?;
        let editor = state
            .editor
            .as_mut()
            .filter(|editor| editor.id == form_id)
            .ok_or("The Extrude form changed")?;
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
    command: &ExtrudeCommand,
    input: &ControlInput,
    validate_control: impl FnOnce() -> Result<(), String>,
) -> Result<Value, String> {
    let field_edit = matches!(
        command,
        ExtrudeCommand::Control {
            action: ExtrudeControl::Field(_),
            ..
        }
    );
    if (field_edit
        && !matches!(
            input,
            ControlInput::SetValue(_) | ControlInput::Click | ControlInput::DoubleClick
        ))
        || (!field_edit && !super::is_activation(input))
    {
        return Err("This input does not match the Extrude control".into());
    }
    let mut state = world.remove_resource::<NativeExtrude>().unwrap_or_default();
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
    command: &ExtrudeCommand,
    input: &ControlInput,
    validate_control: impl FnOnce() -> Result<(), String>,
    state: &mut NativeExtrude,
) -> Result<Value, String> {
    if let ExtrudeCommand::Open { feature_id } = command {
        return with_receipt(bridge, engine, owner, |receipt| {
            validate_control()?;
            if state.editor.is_some() {
                return Err("Finish or cancel the open Extrude form first".into());
            }
            let id = state
                .last_id
                .checked_add(1)
                .ok_or("Extrude form identities exhausted")?;
            let snapshot = Snapshot::capture(engine, receipt);
            if snapshot.viewport.active_sketch.is_some() {
                return Err("Finish the active sketch before opening Extrude".into());
            }
            if snapshot.viewport.session_id != owner.document_id
                || native_viewport::interface_view_snapshot(world).0 != owner.document_id
            {
                return Err("The rendered design is not current".into());
            }
            let model = snapshot.model(&ExtrudeSource::None);
            let form = if let Some(id) = feature_id {
                let definitions: Vec<ExtrudeDefinitionDto> = serde_json::from_value(
                    parse_engine_envelope(engine.engine_call("extrude_definitions", ""))?,
                )
                .map_err(|error| error.to_string())?;
                let definition = definitions
                    .iter()
                    .find(|definition| definition.feature_id.0 == *id)
                    .ok_or("The selected Extrude feature no longer exists")?;
                ExtrudeForm::edit(definition, &model)?
            } else {
                ExtrudeForm::new(&model)
            };
            let mut editor = Editor {
                id,
                form,
                snapshot,
                previous_preview: native_viewport::interface_preview_snapshot(world),
                preview_notice: None,
                pick_target: Some(ExtrudeField::Source),
            };
            if feature_id.is_none() {
                if let Some(pick) = selected_source(world)? {
                    apply_pick(&mut editor, pick)?;
                }
            }
            update_preview(&mut editor, world)?;
            state.editor = Some(editor);
            state.last_id = id;
            Ok(json!({"form_id":id,"opened":true}))
        });
    }
    let ExtrudeCommand::Control { form_id, action } = command else {
        unreachable!()
    };
    let editor = state
        .editor
        .as_mut()
        .filter(|editor| editor.id == *form_id)
        .ok_or("The Extrude form changed")?;
    if matches!(action, ExtrudeControl::Apply) {
        let ticket = with_receipt(bridge, engine, owner, |receipt| {
            check_revision(editor, &receipt)?;
            editor
                .form
                .prepare_apply(&editor.snapshot.model(editor.form.source()))
        })?;
        let applied = bridge.apply_native_mutation_at(
            engine,
            ticket.owner(),
            ticket.model_revision(),
            ticket.operation(),
            ticket.arguments(),
            validate_control,
        );
        return match applied {
            Ok(result) => {
                // The mutation has committed. Never report preview/publication
                // failure as a retryable modeling failure or retain Apply.
                let completion =
                    editor
                        .form
                        .apply_succeeded(&ticket, &result.context, result.engine_revision);
                state.editor = None;
                let clear = bridge.with_native_document_owner(engine, &result.context, || {
                    native_viewport::apply_interface_preview(
                        world,
                        &result.context.document_id,
                        ViewportPreview::default(),
                    )
                });
                let mut value = finish_mutation(engine, bridge, world, ticket.operation(), result);
                value["preview_error"] = json!(clear.err());
                value["form_error"] = json!(completion.err());
                Ok(value)
            }
            Err(error) => {
                let current = bridge.native_document_receipt(engine, owner);
                if current
                    .as_ref()
                    .is_ok_and(|receipt| *receipt == editor.snapshot.receipt)
                {
                    editor.form.apply_failed(
                        &ticket,
                        &editor.snapshot.model(editor.form.source()),
                        error.clone(),
                    )?;
                } else {
                    // A replaced owner must never retain an applicable old form.
                    state.editor = None;
                }
                Err(error)
            }
        };
    }
    let mut close = false;
    let result = with_receipt(bridge, engine, owner, |receipt| {
        validate_control()?;
        if matches!(action, ExtrudeControl::Cancel) {
            let can_restore = receipt == editor.snapshot.receipt;
            let mut model = editor.snapshot.model(editor.form.source());
            model.owner = &receipt.owner;
            model.engine_revision = receipt.revision;
            editor.form.cancel(&model)?;
            let restoration = if can_restore {
                native_viewport::apply_interface_preview(
                    world,
                    &receipt.owner.document_id,
                    editor.previous_preview.clone(),
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
        let model = editor.snapshot.model(editor.form.source());
        match action {
            ExtrudeControl::Field(field) => {
                let ControlInput::SetValue(value) = input else {
                    // The native text adapter owns caret/focus. Clicking a
                    // text field acknowledges that focus without rewriting
                    // its draft, consuming a form generation or repainting.
                    let text_field = editor.form.fields(&model).into_iter().any(|row| {
                        row.field == *field
                            && row.visible
                            && row.enabled
                            && matches!(row.value, nbcad_interface::Field::Text { .. })
                    });
                    return if text_field {
                        Ok(json!({"form_id":form_id,"focused":true}))
                    } else {
                        Err("This field needs a value selection".into())
                    };
                };
                editor.form.set_value(*field, value, &model)?;
            }
            ExtrudeControl::Pick(field) => {
                if !matches!(
                    field,
                    ExtrudeField::Source | ExtrudeField::Targets | ExtrudeField::StopFace
                ) {
                    return Err("This field is not a geometry reference".into());
                }
                editor.pick_target = Some(*field);
            }
            ExtrudeControl::Clear(field) => match field {
                ExtrudeField::Source => editor.form.set_source(ExtrudeSource::None, &model)?,
                ExtrudeField::Targets => editor.form.set_targets(Vec::new(), &model)?,
                ExtrudeField::StopFace => editor.form.set_stop_face(None, &model)?,
                _ => return Err("This field is not a geometry reference".into()),
            },
            ExtrudeControl::Apply | ExtrudeControl::Cancel => unreachable!(),
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
