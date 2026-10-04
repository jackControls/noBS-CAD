//! Native File controls use the existing exchange DTOs, kernel and file writer.
use super::*;
use crate::session_bridge::parse_engine_envelope;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use nbcad_core::BodyId;
use nbcad_export::MeshExportScope;
use nbcad_solid::{
    BodyFeatureDefinitionDto, HoleDefinitionDto, StepExportRequest, StepOccurrencePlacementDto,
    StepThreadMetadataDto,
};

const MAX_STEP_IMPORT_BYTES: u64 = 96 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Format {
    Step,
    ThreeMf,
    Stl,
}
impl Format {
    fn extension(self) -> &'static str {
        match self {
            Self::Step => "step",
            Self::ThreeMf => "3mf",
            Self::Stl => "stl",
        }
    }
    fn description(self) -> &'static str {
        match self {
            Self::Step => "STEP AP242",
            Self::ThreeMf => "3MF (millimetres)",
            Self::Stl => "STL mesh (millimetres)",
        }
    }
}

#[derive(Clone, Debug)]
pub(super) struct ExportIntent {
    pub format: Format,
    pub scope: MeshExportScope,
    pub slicer_target: nbcad_export::SlicerTarget,
    body_ids: Vec<BodyId>,
    occurrence_id: Option<u64>,
    selected: bool,
}

pub(super) fn capture(
    world: &World,
    services: &NativeServices,
    receipt: &DocumentReceipt,
    format: Format,
    selected: bool,
) -> Result<ExportIntent, String> {
    services
        .bridge
        .with_native_document_receipt(&services.engine, &receipt.owner, |revision| {
            check_revision(receipt, revision)?;
            let (document, _, presentation, _) = native_viewport::interface_view_snapshot(world);
            if document != receipt.owner.document_id {
                return Err("The viewport is still changing documents".into());
            }
            let scene = services.engine.viewport_snapshot().2;
            if !scene.errors.is_empty() {
                return Err("Resolve timeline errors before exporting".into());
            }
            let body_ids: Vec<_> = scene
                .bodies
                .iter()
                .filter(|body| !selected || presentation.selected_body_ids.contains(&body.id.0))
                .map(|body| body.id)
                .collect();
            if body_ids.is_empty() {
                return Err(if selected {
                    "Select a body to export"
                } else {
                    "There are no bodies to export"
                }
                .into());
            }
            Ok(ExportIntent {
                format,
                scope: MeshExportScope::Assembly,
                slicer_target: if format == Format::ThreeMf {
                    body_appearance::preferences::read()?
                } else {
                    Default::default()
                },
                body_ids,
                occurrence_id: (selected && presentation.selected_body_ids.len() == 1)
                    .then_some(presentation.selected_occurrence_id)
                    .flatten(),
                selected,
            })
        })
}

fn check_revision(receipt: &DocumentReceipt, revision: u64) -> Result<(), String> {
    if revision != receipt.revision {
        return Err("The document changed while choosing the exchange file".into());
    }
    Ok(())
}

fn picker(
    world: &mut World,
    handle: &NativeInterfaceHandle,
    services: &NativeServices,
    receipt: DocumentReceipt,
    kind: PickerKind,
) -> Result<Value, String> {
    if world.resource::<Files>().picker.is_some() {
        return Err("A file chooser is already open".into());
    }
    let active = tabs(world, services, &receipt.owner)?
        .into_iter()
        .find(|tab| tab.active)
        .ok_or("Active tab disappeared")?;
    let exporting = match &kind {
        PickerKind::Export(intent) => Some(intent.clone()),
        _ => None,
    };
    let (send, receive) = mpsc::channel();
    let wake = handle.clone();
    std::thread::Builder::new()
        .name("cad-exchange-picker".into())
        .spawn(move || {
            let mut dialog = rfd::FileDialog::new();
            if let Some(parent) = active.path.as_ref().and_then(|p| p.parent()) {
                dialog = dialog.set_directory(parent);
            }
            let path = if let Some(intent) = exporting {
                let suffix = if intent.selected && intent.body_ids.len() == 1 {
                    format!("-Body{}", intent.body_ids[0].0)
                } else {
                    String::new()
                };
                let name = format!(
                    "{}{suffix}.{}",
                    active
                        .name
                        .replace(['<', '>', ':', '"', '/', '\\', '|', '?', '*'], "_"),
                    intent.format.extension()
                );
                dialog
                    .add_filter(intent.format.description(), &[intent.format.extension()])
                    .set_file_name(name)
                    .save_file()
            } else {
                dialog.add_filter("STEP/STP", &["step", "stp"]).pick_file()
            };
            let _ = send.send(path);
            wake.request_redraw();
        })
        .map_err(|e| format!("Cannot open file chooser: {e}"))?;
    world.resource_mut::<Files>().picker = Some(Picker {
        receipt,
        kind,
        result: Mutex::new(receive),
    });
    // The options choice has completed; cancelling the OS picker ends export.
    world.resource_mut::<Files>().dialog = None;
    Ok(json!({"awaiting_input":true}))
}

pub(super) fn choose_import(
    world: &mut World,
    handle: &NativeInterfaceHandle,
    services: &NativeServices,
    receipt: DocumentReceipt,
) -> Result<Value, String> {
    picker(world, handle, services, receipt, PickerKind::ImportStep)
}
pub(super) fn choose_export(
    world: &mut World,
    handle: &NativeInterfaceHandle,
    services: &NativeServices,
    receipt: DocumentReceipt,
    intent: ExportIntent,
) -> Result<Value, String> {
    picker(world, handle, services, receipt, PickerKind::Export(intent))
}

fn check_path(path: &std::path::Path, format: Format) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("Choose an absolute file path".into());
    }
    let extension = path.extension().and_then(|s| s.to_str()).unwrap_or("");
    if !extension.eq_ignore_ascii_case(format.extension())
        && !(format == Format::Step && extension.eq_ignore_ascii_case("stp"))
    {
        return Err(format!("Choose a .{} file", format.extension()));
    }
    Ok(())
}

pub(super) fn import(
    world: &mut World,
    receipt: DocumentReceipt,
    path: PathBuf,
) -> Result<Value, String> {
    check_path(&path, Format::Step)?;
    let previous: Vec<_> = native_viewport::interface_geometry(world)
        .scene
        .bodies
        .iter()
        .map(|b| b.id.0)
        .collect();
    worker::enqueue_transaction(
        world,
        "solid_import_step".into(),
        move |services, guard| {
            services.bridge.with_native_document_receipt(
                &services.engine,
                &receipt.owner,
                |revision| check_revision(&receipt, revision),
            )?;
            let metadata =
                std::fs::metadata(&path).map_err(|e| format!("Could not read STEP file: {e}"))?;
            if metadata.len() > MAX_STEP_IMPORT_BYTES {
                return Err("STEP import is limited to 96 MiB".into());
            }
            let bytes = nbcad_project_file::read_binary_file(&path).map_err(|e| e.to_string())?;
            if bytes.len() as u64 > MAX_STEP_IMPORT_BYTES {
                return Err("STEP import is limited to 96 MiB".into());
            }
            let file_name = path
                .file_name()
                .ok_or("STEP file has no name")?
                .to_string_lossy();
            services.bridge.apply_native_mutation_at(
                &services.engine,
                &receipt.owner,
                receipt.revision,
                "solid_import_step",
                &json!({"file_name":file_name,"data_base64":STANDARD.encode(bytes)}),
                || guard.validate(),
            )
        },
        move |world, services, result| {
            let result = result?;
            let owner = result.context.clone();
            let mut output = finish_mutation(
                &services.engine,
                &services.bridge,
                world,
                "solid_import_step",
                result,
            );
            if output["render_error"].is_null() {
                let selection =
                    services
                        .bridge
                        .with_native_document_owner(&services.engine, &owner, || {
                            let imported = native_viewport::interface_geometry(world)
                                .scene
                                .bodies
                                .iter()
                                .find(|b| !previous.contains(&b.id.0))
                                .map(|b| b.id.0);
                            let (_, _, mut view, _) =
                                native_viewport::interface_view_snapshot(world);
                            view.selected_body_ids = imported.into_iter().collect();
                            view.selected_occurrence_id = None;
                            view.selected_face_ids.clear();
                            view.selected_edge_ids.clear();
                            native_viewport::apply_interface_view(
                                world,
                                &owner.document_id,
                                None,
                                Some(view),
                            )
                        });
                if let Err(error) = selection {
                    output["presentation_error"] = json!(error);
                }
            }
            Ok(output)
        },
    )
}

fn step_request(
    engine: &AppState,
    intent: &ExportIntent,
    expected_model_json: String,
) -> Result<StepExportRequest, String> {
    let document = engine.document_snapshot();
    let active: std::collections::HashSet<_> = document
        .features
        .iter()
        .take(document.rollback_index)
        .filter(|f| !f.suppressed)
        .map(|f| f.id)
        .collect();
    let holes: Vec<HoleDefinitionDto> = serde_json::from_value(parse_engine_envelope(
        engine.engine_call("hole_definitions", ""),
    )?)
    .map_err(|e| e.to_string())?;
    let features: Vec<BodyFeatureDefinitionDto> = serde_json::from_value(parse_engine_envelope(
        engine.engine_call("body_feature_definitions", ""),
    )?)
    .map_err(|e| e.to_string())?;
    let mut thread_metadata = Vec::new();
    for hole in holes
        .into_iter()
        .filter(|h| active.contains(&h.feature_id) && intent.body_ids.contains(&h.body_id))
    {
        if let Some(thread) = hole.thread {
            thread_metadata.push(StepThreadMetadataDto {
                body_id: hole.body_id,
                feature_id: hole.feature_id,
                feature_name: hole.name,
                position_count: hole.positions.len().max(1) as u32,
                external: false,
                predrill_diameter: hole.diameter,
                thread,
            });
        }
    }
    for feature in features {
        if let BodyFeatureDefinitionDto::ExternalThread {
            feature_id,
            name,
            body_id,
            cylinder,
            thread,
            ..
        } = feature
        {
            if active.contains(&feature_id) && intent.body_ids.contains(&body_id) {
                thread_metadata.push(StepThreadMetadataDto {
                    body_id,
                    feature_id,
                    feature_name: name,
                    position_count: 1,
                    external: true,
                    predrill_diameter: cylinder.radius * 2.,
                    thread,
                });
            }
        }
    }
    let assembly: nbcad_sketch::AssemblyDocumentDto = serde_json::from_value(
        parse_engine_envelope(engine.engine_call("assembly_document", ""))?,
    )
    .map_err(|e| e.to_string())?;
    let solution: nbcad_sketch::AssemblySolutionDto = serde_json::from_value(
        parse_engine_envelope(engine.engine_call("assembly_solution", ""))?,
    )
    .map_err(|e| e.to_string())?;
    if !solution.solved {
        return Err("Resolve assembly errors before exporting STEP".into());
    }
    let occurrences = solution
        .instance_body_poses
        .iter()
        .filter(|p| {
            p.visible
                && intent.body_ids.contains(&p.body_id)
                && intent
                    .occurrence_id
                    .is_none_or(|id| p.occurrence_id.0 == id)
        })
        .map(|p| StepOccurrencePlacementDto {
            occurrence_id: p.occurrence_id.0,
            component_id: p.component_id.0,
            body_id: p.body_id,
            name: assembly
                .component_structure
                .occurrences
                .iter()
                .find(|o| o.id == p.occurrence_id)
                .map(|o| o.name.clone())
                .unwrap_or_else(|| format!("Occurrence {}", p.occurrence_id.0)),
            translation: p.translation,
            rotation: p.rotation,
        })
        .collect();
    Ok(StepExportRequest {
        body_ids: intent.body_ids.clone(),
        expected_model_json: Some(expected_model_json),
        thread_metadata,
        occurrences,
    })
}

pub(super) fn export(
    world: &mut World,
    receipt: DocumentReceipt,
    intent: ExportIntent,
    path: PathBuf,
    overwrite: bool,
) -> Result<Value, String> {
    check_path(&path, intent.format)?;
    worker::enqueue_document_io(
        world,
        format!("export_{}", intent.format.extension()),
        move |services, guard| {
            services.bridge.with_native_document_receipt(
                &services.engine,
                &receipt.owner,
                |revision| {
                    check_revision(&receipt, revision)?;
                    guard.validate()?;
                    let model = parse_engine_envelope(
                        services.engine.engine_call("project_export_model", ""),
                    )?
                    .as_str()
                    .ok_or("Project export was not text")?
                    .to_owned();
                    let bytes = if intent.format == Format::Step {
                        services.engine.export_step(
                            &serde_json::to_string(&step_request(
                                &services.engine,
                                &intent,
                                model,
                            )?)
                            .map_err(|e| e.to_string())?,
                        )?
                    } else {
                        let request = nbcad_export::MeshExportRequest {
                            expected_model_json: Some(model),
                            body_ids: intent.body_ids.clone(),
                            scope: intent.scope,
                            slicer_target: intent.slicer_target,
                            include_appearance: intent.format == Format::ThreeMf,
                            ..default()
                        };
                        let payload = serde_json::to_string(&request).map_err(|e| e.to_string())?;
                        if intent.format == Format::ThreeMf {
                            services.engine.export_3mf(&payload)?
                        } else {
                            services.engine.export_stl(&payload)?
                        }
                    };
                    if overwrite {
                        nbcad_project_file::write_binary_file_atomic(&path, &bytes)
                    } else {
                        nbcad_project_file::write_binary_file_new(&path, &bytes)
                    }
                    .map_err(|e| e.to_string())?;
                    Ok(NativeMutationResult {
                        context: receipt.owner.clone(),
                        engine_revision: revision,
                        value: json!({"exported":true,"path":path,"bytes":bytes.len()}),
                    })
                },
            )
        },
        |_, _, result| Ok(result?.value),
    )
}

#[cfg(test)]
mod tests;
