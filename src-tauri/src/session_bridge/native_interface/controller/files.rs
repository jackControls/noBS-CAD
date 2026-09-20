//! Visible File/tab workflows over the existing, owner-checked workspace.
//! OS pickers choose paths only. The ordered kernel worker owns file/model work.
use super::super::workspace::{DocumentReceipt, DocumentWorkspace, TabSummary};
use super::*;
use nbcad_interface::ControlInput;
use nbcad_project_file::SaveMetadata;
use std::{path::PathBuf, sync::mpsc};

mod panel;
pub(super) use panel::synchronize;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum FileCommand {
    Menu,
    DismissMenu,
    New,
    Open,
    Save,
    SaveAs,
    Rename,
    Close,
    Activate(DocumentContext),
    Exit,
    SaveAllAndExit,
    Name(u64),
    ApplyName(u64),
    Cancel(u64),
    Discard(u64),
    SaveContinue(u64),
}
#[derive(Clone, Debug)]
enum Intent {
    Close,
    Open(PathBuf),
    Exit,
}
#[derive(Clone, Debug)]
enum DialogKind {
    Rename(String),
    Confirm(Intent),
}
#[derive(Clone, Debug)]
struct Dialog {
    token: u64,
    receipt: DocumentReceipt,
    kind: DialogKind,
    error: Option<String>,
}
struct Picker {
    receipt: DocumentReceipt,
    save: bool,
    continuation: Option<Intent>,
    result: Mutex<mpsc::Receiver<Option<PathBuf>>>,
}
#[derive(Resource, Default)]
pub(super) struct Files {
    pub workspace: Arc<Mutex<DocumentWorkspace>>,
    menu: bool,
    next_token: u64,
    dialog: Option<Dialog>,
    picker: Option<Picker>,
    views: HashMap<String, (u64, native_viewport::ViewportCamera)>,
}

fn remember_view(world: &mut World, owner: &DocumentContext) {
    let (document, camera, _, _) = native_viewport::interface_view_snapshot(world);
    if document == owner.document_id {
        world
            .resource_mut::<Files>()
            .views
            .insert(document, (owner.epoch, camera));
    }
}

fn finish_document_transition(
    world: &mut World,
    services: &NativeServices,
    operation: &str,
    result: NativeMutationResult,
) -> Value {
    let owner = result.context.clone();
    let mut output = finish_mutation(&services.engine, &services.bridge, world, operation, result);
    if output["render_error"].is_string() {
        return output;
    }
    let restored = (|| {
        let live = tabs(world, services, &owner)?;
        let mut files = world.resource_mut::<Files>();
        files.views.retain(|document, (epoch, _)| {
            live.iter()
                .any(|tab| tab.owner.document_id == *document && tab.owner.epoch == *epoch)
        });
        let remembered = files
            .views
            .get(&owner.document_id)
            .filter(|(epoch, _)| *epoch == owner.epoch)
            .map(|(_, camera)| *camera);
        drop(files);
        let (_, _, presentation, size) = native_viewport::interface_view_snapshot(world);
        let camera = if let Some(camera) = remembered {
            camera
        } else {
            view::fit_camera(
                world,
                &model_snapshot(&services.engine),
                &presentation,
                native_viewport::ViewportCamera::default(),
                size,
                Some(ViewDirection::Isometric),
            )?
        };
        services
            .bridge
            .with_native_document_owner(&services.engine, &owner, || {
                native_viewport::apply_interface_view(world, &owner.document_id, Some(camera), None)
            })
    })();
    if let Err(error) = restored {
        // The document transition already committed. Report presentation
        // repair separately rather than inviting a duplicate Open/New.
        output["presentation_pending"] = json!(true);
        output["presentation_error"] = json!(error);
    }
    output
}

pub(super) fn initialize(world: &mut World, workspace: Arc<Mutex<DocumentWorkspace>>) {
    if !world.contains_resource::<Files>() {
        world.insert_resource(Files {
            workspace,
            ..default()
        });
    }
}
pub(super) fn awaiting(world: &World) -> bool {
    world
        .get_resource::<Files>()
        .is_some_and(|f| f.dialog.is_some() || f.picker.is_some())
}
pub(super) fn modal(world: &World) -> Option<&'static str> {
    let f = world.get_resource::<Files>()?;
    if f.picker.is_some() {
        Some("file-picker")
    } else if f.dialog.is_some() {
        Some("file-dialog")
    } else if f.menu {
        Some("file-menu")
    } else {
        None
    }
}
pub(super) fn tabs(
    world: &World,
    services: &NativeServices,
    owner: &DocumentContext,
) -> Result<Vec<TabSummary>, String> {
    world
        .resource::<Files>()
        .workspace
        .lock()
        .map_err(|_| "Document workspace lock poisoned")?
        .summaries(&services.bridge, owner)
}
fn current(
    world: &World,
    services: &NativeServices,
    owner: &DocumentContext,
) -> Result<DocumentReceipt, String> {
    let receipt = services
        .bridge
        .native_document_receipt(&services.engine, owner)?;
    // Observe before taking an asynchronous snapshot, so an unseen replacement
    // cannot inherit the replaced document's destination or save state.
    world
        .resource::<Files>()
        .workspace
        .lock()
        .map_err(|_| "Document workspace lock poisoned")?
        .observe(&services.bridge, &services.engine, &owner.window_id)?;
    Ok(receipt)
}
fn require_idle_model(world: &World) -> Result<(), String> {
    if worker::busy(world) {
        return Err("Wait for the current operation to finish".into());
    }
    if feature::panel(world).is_some() {
        return Err("Apply or cancel the feature before changing files".into());
    }
    let (_, _, view, _) = native_viewport::interface_view_snapshot(world);
    if view.mode == native_viewport::ViewportMode::Sketch {
        return Err("Finish the active sketch before changing files".into());
    }
    Ok(())
}
fn show_dialog(
    world: &mut World,
    receipt: DocumentReceipt,
    kind: DialogKind,
) -> Result<Value, String> {
    let mut f = world.resource_mut::<Files>();
    f.next_token = f
        .next_token
        .checked_add(1)
        .ok_or("File dialog sequence exhausted")?;
    f.dialog = Some(Dialog {
        token: f.next_token,
        receipt,
        kind,
        error: None,
    });
    f.menu = false;
    Ok(json!({"awaiting_input":true}))
}
fn owned_dialog(
    world: &World,
    services: &NativeServices,
    owner: &DocumentContext,
    token: u64,
) -> Result<Dialog, String> {
    let dialog = world
        .resource::<Files>()
        .dialog
        .clone()
        .ok_or("File dialog was closed")?;
    if dialog.token != token
        || &dialog.receipt.owner != owner
        || services
            .bridge
            .native_document_receipt(&services.engine, owner)?
            != dialog.receipt
    {
        return Err("The document changed while the File dialog was open".into());
    }
    Ok(dialog)
}

pub(crate) fn reduce(
    world: &mut World,
    handle: &NativeInterfaceHandle,
    engine: &AppState,
    bridge: &SessionBridgeState,
    action: &NativeInterfaceAction,
    command: &FileCommand,
) -> Result<Value, String> {
    bridge
        .with_native_document_owner(engine, &action.context, || handle.validate_action(action))?;
    if matches!(command, FileCommand::Name(_)) {
        let FileCommand::Name(token) = command else {
            unreachable!()
        };
        let ControlInput::SetValue(value) = &action.control.input else {
            return Err("Document name requires text".into());
        };
        let name = value.clone();
        let f = world.resource::<Files>();
        let dialog = f.dialog.as_ref().ok_or("Rename dialog was closed")?;
        if dialog.token != *token || dialog.receipt.owner != action.context {
            return Err("Rename dialog was replaced".into());
        }
        world.resource_mut::<Files>().dialog.as_mut().unwrap().kind = DialogKind::Rename(name);
        return Ok(json!({"changed":true}));
    }
    if !super::super::is_activation(&action.control.input) {
        return Err("File command requires activation".into());
    }
    let services = world.resource::<NativeServices>().clone();
    execute(world, handle, &services, &action.context, command.clone())
}

fn execute(
    world: &mut World,
    handle: &NativeInterfaceHandle,
    services: &NativeServices,
    owner: &DocumentContext,
    command: FileCommand,
) -> Result<Value, String> {
    if matches!(command, FileCommand::Menu | FileCommand::DismissMenu) {
        let mut f = world.resource_mut::<Files>();
        if f.dialog.is_some() || f.picker.is_some() {
            return Err("Finish the current File dialog first".into());
        }
        f.menu = matches!(command, FileCommand::Menu) && !f.menu;
        return Ok(json!({"menu_open":f.menu}));
    }
    if let FileCommand::Cancel(token) = command {
        // Cancel must remain available even if the model changed underneath it.
        if world
            .resource::<Files>()
            .dialog
            .as_ref()
            .is_some_and(|d| d.token == token && &d.receipt.owner == owner)
        {
            world.resource_mut::<Files>().dialog = None;
            return Ok(json!({"cancelled":true}));
        }
        return Err("File dialog was replaced".into());
    }
    if command == FileCommand::Exit {
        world.resource_mut::<Files>().menu = false;
        return Ok(json!({"request_exit":true}));
    }
    require_idle_model(world)?;
    world.resource_mut::<Files>().menu = false;
    let receipt = current(world, services, owner)?;
    match command {
        FileCommand::SaveAllAndExit => {
            let mut value = save_all_and_exit(world, handle, services, &receipt)?;
            value["saving_before_exit"] = json!(true);
            Ok(value)
        }
        FileCommand::New => transition(world, receipt, None, None),
        FileCommand::Activate(target) if &target == owner => Ok(json!({"changed":false})),
        FileCommand::Activate(target) => transition(world, receipt, Some(target), None),
        FileCommand::Close => request_intent(world, services, receipt, Intent::Close),
        FileCommand::Open => choose_path(world, handle, services, receipt, false, None),
        FileCommand::Save | FileCommand::SaveAs => {
            let path = if matches!(command, FileCommand::Save) {
                tabs(world, services, owner)?
                    .into_iter()
                    .find(|t| t.active)
                    .and_then(|t| t.path)
            } else {
                None
            };
            if let Some(path) = path {
                save(world, receipt, path, true, None)
            } else {
                choose_path(world, handle, services, receipt, true, None)
            }
        }
        FileCommand::Rename => show_dialog(
            world,
            receipt,
            DialogKind::Rename(services.engine.document_snapshot().name),
        ),
        FileCommand::Exit => Ok(json!({"request_exit":true})),
        FileCommand::ApplyName(token) => {
            let dialog = owned_dialog(world, services, owner, token)?;
            let DialogKind::Rename(name) = dialog.kind else {
                return Err("Not a Rename dialog".into());
            };
            let name = name.trim().to_owned();
            if name.is_empty() {
                return Err("Enter a document name".into());
            }
            let result = worker::enqueue_operation(
                world,
                receipt.owner,
                receipt.revision,
                "cad_set_document_name".into(),
                json!({"name":name}),
                move |world, services, result| {
                    let result = result?;
                    world.resource_mut::<Files>().dialog = None;
                    Ok(finish_mutation(
                        &services.engine,
                        &services.bridge,
                        world,
                        "cad_set_document_name",
                        result,
                    ))
                },
            );
            result
        }
        FileCommand::Discard(token) | FileCommand::SaveContinue(token) => {
            let dialog = owned_dialog(world, services, owner, token)?;
            let DialogKind::Confirm(intent) = dialog.kind else {
                return Err("Not a save confirmation".into());
            };
            if matches!(command, FileCommand::SaveContinue(_)) {
                let path = tabs(world, services, owner)?
                    .into_iter()
                    .find(|t| t.active)
                    .and_then(|t| t.path);
                if let Some(path) = path {
                    save(world, dialog.receipt, path, true, Some(intent))
                } else {
                    choose_path(world, handle, services, dialog.receipt, true, Some(intent))
                }
            } else {
                perform_intent(world, dialog.receipt, intent, true)
            }
        }
        _ => Err("Unsupported File action".into()),
    }
}

fn request_intent(
    world: &mut World,
    services: &NativeServices,
    receipt: DocumentReceipt,
    intent: Intent,
) -> Result<Value, String> {
    if services
        .bridge
        .native_document_receipt(&services.engine, &receipt.owner)?
        != receipt
    {
        return Err("The document changed while the file chooser was open".into());
    }
    let dirty = tabs(world, services, &receipt.owner)?
        .iter()
        .any(|t| t.active && t.dirty);
    if dirty {
        show_dialog(world, receipt, DialogKind::Confirm(intent))
    } else {
        perform_intent(world, receipt, intent, false)
    }
}
fn perform_intent(
    world: &mut World,
    receipt: DocumentReceipt,
    intent: Intent,
    discard: bool,
) -> Result<Value, String> {
    match intent {
        Intent::Exit => {
            let services = world.resource::<NativeServices>().clone();
            let handle = world.resource::<NativeInterfaceHandle>().clone();
            save_all_and_exit(world, &handle, &services, &receipt)
        }
        Intent::Close => transition(world, receipt, None, Some(discard)),
        Intent::Open(path) => {
            remember_view(world, &receipt.owner);
            let workspace = world.resource::<Files>().workspace.clone();
            worker::enqueue_transaction(
                world,
                "open_project".into(),
                move |services, guard| {
                    workspace
                        .lock()
                        .map_err(|_| "Document workspace lock poisoned")?
                        .open_guarded(
                            &services.bridge,
                            &services.engine,
                            &receipt,
                            path,
                            discard,
                            || guard.validate(),
                        )
                },
                |world, services, result| {
                    let result = result?;
                    world.resource_mut::<Files>().dialog = None;
                    Ok(finish_document_transition(
                        world,
                        services,
                        "open_project",
                        result,
                    ))
                },
            )
        }
    }
}

fn save_all_and_exit(
    world: &mut World,
    handle: &NativeInterfaceHandle,
    services: &NativeServices,
    receipt: &DocumentReceipt,
) -> Result<Value, String> {
    let all_tabs = tabs(world, services, &receipt.owner)?;
    // Prefer the active dirty tab, retaining all documents until every save
    // succeeds. Cancelling any chooser aborts Exit without closing a tab.
    let next = all_tabs
        .iter()
        .find(|tab| tab.active && tab.dirty)
        .or_else(|| all_tabs.iter().find(|tab| tab.dirty));
    let Some(next) = next else {
        return Ok(json!({"request_exit":true}));
    };
    if next.active {
        if let Some(path) = &next.path {
            return save(
                world,
                receipt.clone(),
                path.clone(),
                true,
                Some(Intent::Exit),
            );
        }
        return choose_path(
            world,
            handle,
            services,
            receipt.clone(),
            true,
            Some(Intent::Exit),
        );
    }
    let target = next.owner.clone();
    let receipt = receipt.clone();
    remember_view(world, &receipt.owner);
    let workspace = world.resource::<Files>().workspace.clone();
    worker::enqueue_transaction(
        world,
        "save_all_activate".into(),
        move |services, guard| {
            let result = workspace
                .lock()
                .map_err(|_| "Document workspace lock poisoned")?
                .activate_guarded(
                    &services.bridge,
                    &services.engine,
                    &receipt,
                    &target,
                    || guard.validate(),
                )?;
            Ok(NativeMutationResult {
                context: result.owner,
                engine_revision: result.revision,
                value: json!({"changed":true}),
            })
        },
        |world, services, result| {
            let result = result?;
            let receipt = DocumentReceipt {
                owner: result.context.clone(),
                revision: result.engine_revision,
            };
            let presentation =
                finish_document_transition(world, services, "save_all_activate", result);
            if presentation["render_error"].is_string() {
                return Ok(presentation);
            }
            let handle = world.resource::<NativeInterfaceHandle>().clone();
            save_all_and_exit(world, &handle, services, &receipt)
        },
    )
}
fn transition(
    world: &mut World,
    receipt: DocumentReceipt,
    target: Option<DocumentContext>,
    close: Option<bool>,
) -> Result<Value, String> {
    remember_view(world, &receipt.owner);
    let workspace = world.resource::<Files>().workspace.clone();
    worker::enqueue_transaction(
        world,
        "document_tab".into(),
        move |services, guard| {
            let mut workspace = workspace
                .lock()
                .map_err(|_| "Document workspace lock poisoned")?;
            let result = if let Some(discard) = close {
                workspace.close_active_guarded(
                    &services.bridge,
                    &services.engine,
                    &receipt,
                    discard,
                    || guard.validate(),
                )?
            } else if let Some(target) = target {
                workspace.activate_guarded(
                    &services.bridge,
                    &services.engine,
                    &receipt,
                    &target,
                    || guard.validate(),
                )?
            } else {
                workspace.new_tab_guarded(&services.bridge, &services.engine, &receipt, || {
                    guard.validate()
                })?
            };
            Ok(NativeMutationResult {
                context: result.owner,
                engine_revision: result.revision,
                value: json!({"changed":true}),
            })
        },
        |world, services, result| {
            let result = result?;
            world.resource_mut::<Files>().dialog = None;
            Ok(finish_document_transition(
                world,
                services,
                "document_tab",
                result,
            ))
        },
    )
}
fn save(
    world: &mut World,
    receipt: DocumentReceipt,
    path: PathBuf,
    overwrite: bool,
    continuation: Option<Intent>,
) -> Result<Value, String> {
    let workspace = world.resource::<Files>().workspace.clone();
    worker::enqueue_document_io(
        world,
        "save_project".into(),
        move |services, guard| {
            let saved_at = time::OffsetDateTime::now_utc()
                .format(&time::format_description::well_known::Rfc3339)
                .map_err(|e| e.to_string())?;
            let prepared = workspace
                .lock()
                .map_err(|_| "Document workspace lock poisoned")?
                .prepare_save_guarded(
                    &services.bridge,
                    &services.engine,
                    &receipt,
                    path,
                    overwrite,
                    SaveMetadata {
                        application_version: env!("CARGO_PKG_VERSION"),
                        saved_at: &saved_at,
                    },
                    || guard.validate(),
                )?;
            let completed = prepared.write();
            let receipt = workspace
                .lock()
                .map_err(|_| "Document workspace lock poisoned")?
                .complete_save(&services.bridge, completed)?;
            Ok(NativeMutationResult {
                context: receipt.owner,
                engine_revision: receipt.revision,
                value: json!({"saved":true}),
            })
        },
        move |world, _services, result| {
            let result = result?;
            world.resource_mut::<Files>().dialog = None;
            if let Some(intent) = continuation {
                perform_intent(
                    world,
                    DocumentReceipt {
                        owner: result.context,
                        revision: result.engine_revision,
                    },
                    intent,
                    false,
                )
            } else {
                Ok(result.value)
            }
        },
    )
}

fn choose_path(
    world: &mut World,
    handle: &NativeInterfaceHandle,
    services: &NativeServices,
    receipt: DocumentReceipt,
    save: bool,
    continuation: Option<Intent>,
) -> Result<Value, String> {
    if world.resource::<Files>().picker.is_some() {
        return Err("A file chooser is already open".into());
    }
    let active = tabs(world, services, &receipt.owner)?
        .into_iter()
        .find(|tab| tab.active)
        .ok_or("Active tab disappeared")?;
    let (send, receive) = mpsc::channel();
    let handle = handle.clone();
    std::thread::Builder::new()
        .name("cad-file-picker".into())
        .spawn(move || {
            let mut dialog = rfd::FileDialog::new().add_filter("noBS CAD project", &["nbcad"]);
            if let Some(path) = &active.path {
                if let Some(parent) = path.parent() {
                    dialog = dialog.set_directory(parent);
                }
            }
            let name = active
                .path
                .as_ref()
                .and_then(|p| p.file_name())
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| {
                    format!(
                        "{}.nbcad",
                        active
                            .name
                            .replace(['<', '>', ':', '\"', '/', '\\', '|', '?', '*'], "_")
                    )
                });
            let chosen = if save {
                dialog.set_file_name(name).save_file()
            } else {
                dialog.pick_file()
            };
            let _ = send.send(chosen);
            handle.request_redraw();
        })
        .map_err(|e| format!("Cannot open file chooser: {e}"))?;
    world.resource_mut::<Files>().picker = Some(Picker {
        receipt,
        save,
        continuation,
        result: Mutex::new(receive),
    });
    Ok(json!({"awaiting_input":true}))
}
pub(super) fn poll(world: &mut World, services: &NativeServices) -> Result<(), String> {
    let result = world.resource::<Files>().picker.as_ref().map(|p| {
        p.result
            .lock()
            .map_err(|_| "File chooser channel poisoned".to_owned())
            .and_then(|channel| match channel.try_recv() {
                Ok(path) => Ok(Some(path)),
                Err(mpsc::TryRecvError::Empty) => Ok(None),
                Err(mpsc::TryRecvError::Disconnected) => {
                    Err("File chooser closed without returning a result".into())
                }
            })
    });
    let path = match result {
        None | Some(Ok(None)) => return Ok(()),
        Some(Ok(Some(path))) => path,
        Some(Err(error)) => {
            world.resource_mut::<Files>().picker = None;
            return Err(error);
        }
    };
    let picker = world.resource_mut::<Files>().picker.take().unwrap();
    let Some(path) = path else {
        return Ok(());
    };
    if picker.save {
        save(world, picker.receipt, path, true, picker.continuation)?;
    } else {
        request_intent(world, services, picker.receipt, Intent::Open(path))?;
    }
    Ok(())
}

pub(super) fn request(
    world: &mut World,
    handle: &NativeInterfaceHandle,
    services: &NativeServices,
    owner: &DocumentContext,
    ui: &Value,
) -> Result<Value, String> {
    require_idle_model(world)?;
    if awaiting(world) {
        return Err("Finish the current File dialog first".into());
    }
    let receipt = current(world, services, owner)?;
    match ui["command"].as_str().unwrap_or("") {
        "new" => execute(world, handle, services, owner, FileCommand::New),
        "close" => execute(world, handle, services, owner, FileCommand::Close),
        "rename" => {
            let name = ui["name"].as_str().unwrap_or("").trim();
            if name.is_empty() {
                return Err("Enter a document name".into());
            }
            worker::enqueue_operation(
                world,
                owner.clone(),
                receipt.revision,
                "cad_set_document_name".into(),
                json!({"name":name}),
                |world, services, result| {
                    Ok(finish_mutation(
                        &services.engine,
                        &services.bridge,
                        world,
                        "cad_set_document_name",
                        result?,
                    ))
                },
            )
        }
        "save" => {
            let path = PathBuf::from(
                ui["path"]
                    .as_str()
                    .ok_or("Save requires an absolute .nbcad path")?,
            );
            let overwrite = ui["overwrite"] == true;
            if path.exists() && !overwrite {
                return Err("The destination exists; overwrite must be explicit".into());
            }
            save(world, receipt, path, overwrite, None)
        }
        "open" => {
            let path = PathBuf::from(
                ui["path"]
                    .as_str()
                    .ok_or("Open requires an absolute .nbcad path")?,
            );
            if ui["discard_changes"] == true {
                perform_intent(world, receipt, Intent::Open(path), true)
            } else {
                request_intent(world, services, receipt, Intent::Open(path))
            }
        }
        _ => Err("Unknown File command".into()),
    }
}

pub(super) fn escape(world: &mut World) {
    let mut f = world.resource_mut::<Files>();
    f.menu = false;
    f.dialog = None;
}
pub(super) fn dialog_error(world: &mut World, error: &str) {
    if let Some(dialog) = world.resource_mut::<Files>().dialog.as_mut() {
        dialog.error = Some(error.to_owned());
    }
}

/// File shortcuts use the same commands as the visible menu. The caller checks
/// document ownership before offering the event; a modal always owns its keys.
pub(super) fn shortcut(
    world: &mut World,
    handle: &NativeInterfaceHandle,
    services: &NativeServices,
    event: &NativeHostInput,
) -> Result<Option<Value>, String> {
    use bevy::input::{
        keyboard::{Key, KeyCode},
        ButtonState,
    };
    if modal(world).is_some()
        || awaiting(world)
        || handle
            .frame()
            .is_some_and(|frame| !frame.modal_stack.is_empty())
    {
        return Ok(None);
    }
    let WindowEvent::KeyboardInput(key) = &event.event else {
        return Ok(None);
    };
    if key.state != ButtonState::Pressed
        || key.repeat
        || event.modifiers.alt
        || event.modifiers.alt_graph
        || !(event.modifiers.ctrl || event.modifiers.meta)
    {
        return Ok(None);
    }
    let Key::Character(character) = &key.logical_key else {
        return Ok(None);
    };
    // Winit's logical characters can be control codes on Windows. Fall back to
    // the documented physical accelerator only for those control characters.
    let character = if character.chars().all(char::is_control) {
        match key.key_code {
            KeyCode::KeyN => "n",
            KeyCode::KeyO => "o",
            KeyCode::KeyS => "s",
            KeyCode::KeyW => "w",
            _ => "",
        }
        .into()
    } else {
        character.to_lowercase()
    };
    let command = match (character.as_str(), event.modifiers.shift) {
        ("n", false) => FileCommand::New,
        ("o", false) => FileCommand::Open,
        ("s", false) => FileCommand::Save,
        ("s", true) => FileCommand::SaveAs,
        ("w", false) => FileCommand::Close,
        _ => return Ok(None),
    };
    let owner = event
        .context
        .as_ref()
        .ok_or("File shortcut has no document context")?;
    services
        .bridge
        .with_native_document_owner(&services.engine, owner, || Ok(()))?;
    execute(world, handle, services, owner, command).map(Some)
}

#[cfg(test)]
mod tests;
