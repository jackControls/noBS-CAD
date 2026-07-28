//! noBS CAD native shell (Tauri 2).
//!
//! Thin IPC layer over the engine crates (`nbcad-core` /
//! `nbcad-sketch`): the shell owns the [`state::AppState`] and exposes
//! the engine API as JSON-string commands. Every `engine_*` command
//! dispatches through `nbcad_sketch::host::handle` — the exact code
//! path the WASM host uses, so native and browser behavior are identical.
//! All modeling logic lives in the engine crates, never here.

mod session_bridge;
mod native_viewport;
mod six_dof_mouse;
mod state;

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use native_viewport::{
    NativePick, NativeViewport, NativeViewportMetrics, ViewportCamera, ViewportLayout,
    ViewportModel, ViewportPreview,
};
use nbcad_core::DocumentDto;
use six_dof_mouse::SixDofMouseState;
use state::AppState;
use tauri::Manager;

/// Health-check command used by the frontend IPC wrapper.
#[tauri::command]
fn ping() -> String {
    "pong".to_string()
}

/// Snapshot of the current document (name, settings, browser tree).
#[tauri::command]
fn get_document(state: tauri::State<'_, AppState>) -> DocumentDto {
    state.document_snapshot()
}

#[tauri::command]
fn native_viewport_set_layout(
    app: tauri::AppHandle,
    viewport: tauri::State<'_, NativeViewport>,
    layout: ViewportLayout,
) -> Result<(), String> {
    viewport.set_layout(&app, layout)
}

#[tauri::command]
async fn native_viewport_sync_model(
    engine: tauri::State<'_, AppState>,
    viewport: tauri::State<'_, NativeViewport>,
) -> Result<(), String> {
    let (scene, active_sketch, finished_sketches) = engine.viewport_snapshot();
    viewport.sync_model(ViewportModel {
        scene,
        active_sketch,
        finished_sketches,
    })
}

#[tauri::command]
fn native_viewport_set_camera(
    viewport: tauri::State<'_, NativeViewport>,
    camera: ViewportCamera,
) -> Result<(), String> {
    viewport.set_camera(camera)
}

#[tauri::command]
fn native_viewport_set_preview(
    viewport: tauri::State<'_, NativeViewport>,
    preview: ViewportPreview,
) -> Result<(), String> {
    viewport.set_preview(preview)
}

#[tauri::command]
async fn native_viewport_pick(
    viewport: tauri::State<'_, NativeViewport>,
    x: f32,
    y: f32,
) -> Result<Option<NativePick>, String> {
    viewport.pick(x, y)
}

#[tauri::command]
fn native_viewport_metrics(viewport: tauri::State<'_, NativeViewport>) -> NativeViewportMetrics {
    viewport.metrics()
}

macro_rules! engine_command {
    ($name:ident, $method:literal) => {
        /// Engine command — see `nbcad_sketch::host::handle`.
        #[tauri::command]
        fn $name(state: tauri::State<'_, AppState>, payload: &str) -> String {
            state.engine_call($method, payload)
        }
    };
    ($name:ident, $method:literal, no_payload) => {
        /// Engine command — see `nbcad_sketch::host::handle`.
        #[tauri::command]
        fn $name(state: tauri::State<'_, AppState>) -> String {
            state.engine_call($method, "")
        }
    };
}

engine_command!(engine_begin_sketch, "begin_sketch");
engine_command!(engine_document_set_name, "document_set_name");
engine_command!(
    engine_project_export_model,
    "project_export_model",
    no_payload
);
engine_command!(engine_end_sketch, "end_sketch", no_payload);
engine_command!(engine_finished_sketches, "finished_sketches", no_payload);
engine_command!(engine_edit_sketch, "edit_sketch");
engine_command!(engine_active_sketch, "active_sketch", no_payload);
engine_command!(engine_profile_catalog, "profile_catalog", no_payload);
engine_command!(engine_solid_scene, "solid_scene", no_payload);
engine_command!(engine_body_appearances, "body_appearances", no_payload);
engine_command!(engine_set_body_appearance, "set_body_appearance");
engine_command!(
    engine_extrude_definitions,
    "extrude_definitions",
    no_payload
);
engine_command!(
    engine_revolve_definitions,
    "revolve_definitions",
    no_payload
);
engine_command!(engine_sweep_definitions, "sweep_definitions", no_payload);
engine_command!(engine_loft_definitions, "loft_definitions", no_payload);
engine_command!(engine_rib_definitions, "rib_definitions", no_payload);
engine_command!(engine_fillet_definitions, "fillet_definitions", no_payload);
engine_command!(
    engine_chamfer_definitions,
    "chamfer_definitions",
    no_payload
);
engine_command!(engine_hole_definitions, "hole_definitions", no_payload);
engine_command!(
    engine_datum_plane_definitions,
    "datum_plane_definitions",
    no_payload
);
engine_command!(
    engine_body_feature_definitions,
    "body_feature_definitions",
    no_payload
);
engine_command!(engine_datum_plane_create, "datum_plane_create");
engine_command!(engine_datum_plane_edit, "datum_plane_edit");
engine_command!(engine_preview_segment, "preview_segment");
engine_command!(engine_eval_expression, "eval_expression");
engine_command!(engine_add_line, "add_line");
engine_command!(engine_preview_segment_locked, "preview_segment_locked");
engine_command!(engine_add_line_locked, "add_line_locked");
engine_command!(engine_add_point, "add_point");
engine_command!(engine_add_line_midpoint, "add_line_midpoint");
engine_command!(engine_add_rectangle, "add_rectangle");
engine_command!(engine_add_rectangle_locked, "add_rectangle_locked");
engine_command!(engine_add_circle, "add_circle");
engine_command!(engine_add_circle_locked, "add_circle_locked");
engine_command!(engine_add_slot, "add_slot");
engine_command!(engine_add_spline, "add_spline");
engine_command!(engine_add_arc_3pt, "add_arc_3pt");
engine_command!(engine_add_arc_center, "add_arc_center");
engine_command!(engine_add_constraint, "add_constraint");
engine_command!(engine_add_constraints, "add_constraints");
engine_command!(engine_add_dimension, "add_dimension");
engine_command!(engine_edit_dimension, "edit_dimension");
engine_command!(engine_move_dimension, "move_dimension");
engine_command!(engine_delete_dimension, "delete_dimension");
engine_command!(engine_set_dimension_style, "set_dimension_style");
engine_command!(engine_fillet_preview, "fillet_preview");
engine_command!(engine_fillet_lines, "fillet_lines");
engine_command!(engine_chamfer_lines, "chamfer_lines");
engine_command!(engine_offset_preview, "offset_preview");
engine_command!(engine_offset_curve, "offset_curve");
engine_command!(engine_trim_preview, "trim_preview");
engine_command!(engine_trim_entity, "trim_entity");
engine_command!(engine_extend_entity, "extend_entity");
engine_command!(engine_break_curve, "break_curve");
engine_command!(engine_mirror_entities, "mirror_entities");
engine_command!(engine_rectangular_pattern, "rectangular_pattern");
engine_command!(engine_circular_pattern, "circular_pattern");
engine_command!(engine_move_copy_entities, "move_copy_entities");
engine_command!(engine_scale_entities, "scale_entities");
engine_command!(engine_polygon_create, "polygon_create");
engine_command!(engine_toggle_fix, "toggle_fix");
engine_command!(engine_toggle_fix_entities, "toggle_fix_entities");
engine_command!(engine_move_point, "move_point");
engine_command!(engine_delete_entity, "delete_entity");
engine_command!(engine_delete_entities, "delete_entities");
engine_command!(engine_undo, "undo", no_payload);
engine_command!(engine_redo, "redo", no_payload);
engine_command!(engine_set_grid_snap, "set_grid_snap");
engine_command!(engine_set_grid_step, "set_grid_step");

#[tauri::command]
fn engine_solid_extrude(state: tauri::State<'_, AppState>, payload: &str) -> String {
    state.solid_extrude(payload)
}

#[tauri::command]
fn engine_solid_edit_extrude(state: tauri::State<'_, AppState>, payload: &str) -> String {
    state.solid_edit_extrude(payload)
}

#[tauri::command]
fn engine_solid_revolve(state: tauri::State<'_, AppState>, payload: &str) -> String {
    state.solid_revolve(payload)
}

#[tauri::command]
fn engine_solid_edit_revolve(state: tauri::State<'_, AppState>, payload: &str) -> String {
    state.solid_edit_revolve(payload)
}

#[tauri::command]
fn engine_solid_sweep(state: tauri::State<'_, AppState>, payload: &str) -> String {
    state.solid_sweep(payload)
}

#[tauri::command]
fn engine_solid_edit_sweep(state: tauri::State<'_, AppState>, payload: &str) -> String {
    state.solid_edit_sweep(payload)
}

#[tauri::command]
fn engine_solid_loft(state: tauri::State<'_, AppState>, payload: &str) -> String {
    state.solid_loft(payload)
}

#[tauri::command]
fn engine_solid_edit_loft(state: tauri::State<'_, AppState>, payload: &str) -> String {
    state.solid_edit_loft(payload)
}

#[tauri::command]
fn engine_solid_rib(state: tauri::State<'_, AppState>, payload: &str) -> String {
    state.solid_rib(payload)
}

#[tauri::command]
fn engine_solid_edit_rib(state: tauri::State<'_, AppState>, payload: &str) -> String {
    state.solid_edit_rib(payload)
}

#[tauri::command]
fn engine_solid_fillet(state: tauri::State<'_, AppState>, payload: &str) -> String {
    state.solid_fillet(payload)
}

#[tauri::command]
fn engine_solid_edit_fillet(state: tauri::State<'_, AppState>, payload: &str) -> String {
    state.solid_edit_fillet(payload)
}

#[tauri::command]
fn engine_solid_chamfer(state: tauri::State<'_, AppState>, payload: &str) -> String {
    state.solid_chamfer(payload)
}

#[tauri::command]
fn engine_solid_edit_chamfer(state: tauri::State<'_, AppState>, payload: &str) -> String {
    state.solid_edit_chamfer(payload)
}

#[tauri::command]
fn engine_solid_hole(state: tauri::State<'_, AppState>, payload: &str) -> String {
    state.solid_hole(payload)
}

#[tauri::command]
fn engine_solid_edit_hole(state: tauri::State<'_, AppState>, payload: &str) -> String {
    state.solid_edit_hole(payload)
}

#[tauri::command]
fn engine_solid_body_feature(state: tauri::State<'_, AppState>, payload: &str) -> String {
    state.solid_body_feature(payload)
}

#[tauri::command]
fn engine_solid_edit_body_feature(state: tauri::State<'_, AppState>, payload: &str) -> String {
    state.solid_edit_body_feature(payload)
}

#[tauri::command]
fn engine_solid_recompute(state: tauri::State<'_, AppState>) -> String {
    state.solid_recompute()
}

#[tauri::command]
fn engine_solid_set_rollback(state: tauri::State<'_, AppState>, payload: &str) -> String {
    state.solid_set_rollback(payload)
}

#[tauri::command]
fn engine_solid_delete_feature(state: tauri::State<'_, AppState>, payload: &str) -> String {
    state.solid_delete_feature(payload)
}

#[tauri::command]
fn engine_solid_reorder_feature(state: tauri::State<'_, AppState>, payload: &str) -> String {
    state.solid_reorder_feature(payload)
}

#[tauri::command]
fn engine_project_load(state: tauri::State<'_, AppState>, payload: &str) -> String {
    state.project_load(payload)
}

#[tauri::command]
fn engine_project_new(state: tauri::State<'_, AppState>) -> String {
    state.project_new()
}

#[tauri::command]
fn engine_export_step(state: tauri::State<'_, AppState>, payload: &str) -> Result<Vec<u8>, String> {
    state.export_step(payload)
}

#[tauri::command]
fn engine_export_stl(state: tauri::State<'_, AppState>, payload: &str) -> Result<Vec<u8>, String> {
    state.export_stl(payload)
}

#[tauri::command]
fn engine_export_3mf(state: tauri::State<'_, AppState>, payload: &str) -> Result<Vec<u8>, String> {
    state.export_3mf(payload)
}

const MAX_FILE_BYTES: u64 = 256 * 1024 * 1024;

#[tauri::command]
fn read_binary_file(path: String) -> Result<Vec<u8>, String> {
    let metadata = fs::metadata(&path).map_err(|error| format!("could not read file: {error}"))?;
    if metadata.len() > MAX_FILE_BYTES {
        return Err("file is larger than the 256 MB safety limit".to_string());
    }
    fs::read(path).map_err(|error| format!("could not read file: {error}"))
}

/// Write bytes to a path atomically (temp file + rename).
#[tauri::command]
fn write_binary_file_atomic(path: String, bytes: Vec<u8>) -> Result<(), String> {
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err("file is larger than the 256 MB safety limit".to_string());
    }
    let target = PathBuf::from(path);
    let parent = target
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let file_name = target
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "save path has no valid file name".to_string())?;
    let temporary = parent.join(format!(".{file_name}.{}.tmp", std::process::id()));
    let result = (|| {
        let mut file = OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(&temporary)
            .map_err(|error| format!("could not create temporary save file: {error}"))?;
        file.write_all(&bytes)
            .map_err(|error| format!("could not write save file: {error}"))?;
        file.sync_all()
            .map_err(|error| format!("could not flush save file: {error}"))?;
        fs::rename(&temporary, &target)
            .map_err(|error| format!("could not replace save file: {error}"))
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::new())
        .manage(session_bridge::SessionBridgeState::default())
        .manage(SixDofMouseState::default())
        .setup(|app| {
            let viewport = NativeViewport::install(app).map_err(std::io::Error::other)?;
            let (scene, active_sketch, finished_sketches) =
                app.state::<AppState>().viewport_snapshot();
            let _ = viewport.sync_model(ViewportModel {
                scene,
                active_sketch,
                finished_sketches,
            });
            app.manage(viewport);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ping,
            get_document,
            native_viewport_set_layout,
            native_viewport_sync_model,
            native_viewport_set_camera,
            native_viewport_set_preview,
            native_viewport_pick,
            native_viewport_metrics,
            read_binary_file,
            write_binary_file_atomic,
            session_bridge::mcp_session_bridge_reserve,
            session_bridge::mcp_session_bridge_write,
            session_bridge::mcp_session_bridge_heartbeat,
            six_dof_mouse::six_dof_mouse_devices,
            six_dof_mouse::six_dof_mouse_connect,
            six_dof_mouse::six_dof_mouse_disconnect,
            engine_begin_sketch,
            engine_document_set_name,
            engine_project_export_model,
            engine_project_new,
            engine_project_load,
            engine_export_step,
            engine_export_stl,
            engine_export_3mf,
            engine_end_sketch,
            engine_finished_sketches,
            engine_edit_sketch,
            engine_active_sketch,
            engine_profile_catalog,
            engine_solid_scene,
            engine_body_appearances,
            engine_set_body_appearance,
            engine_extrude_definitions,
            engine_revolve_definitions,
            engine_sweep_definitions,
            engine_loft_definitions,
            engine_rib_definitions,
            engine_fillet_definitions,
            engine_chamfer_definitions,
            engine_hole_definitions,
            engine_datum_plane_definitions,
            engine_body_feature_definitions,
            engine_datum_plane_create,
            engine_datum_plane_edit,
            engine_preview_segment,
            engine_eval_expression,
            engine_add_line,
            engine_preview_segment_locked,
            engine_add_line_locked,
            engine_add_point,
            engine_add_line_midpoint,
            engine_add_rectangle,
            engine_add_rectangle_locked,
            engine_add_circle,
            engine_add_circle_locked,
            engine_add_slot,
            engine_add_spline,
            engine_add_arc_3pt,
            engine_add_arc_center,
            engine_add_constraint,
            engine_add_constraints,
            engine_add_dimension,
            engine_edit_dimension,
            engine_move_dimension,
            engine_delete_dimension,
            engine_set_dimension_style,
            engine_fillet_preview,
            engine_fillet_lines,
            engine_chamfer_lines,
            engine_offset_preview,
            engine_offset_curve,
            engine_trim_preview,
            engine_trim_entity,
            engine_extend_entity,
            engine_break_curve,
            engine_mirror_entities,
            engine_rectangular_pattern,
            engine_circular_pattern,
            engine_move_copy_entities,
            engine_scale_entities,
            engine_polygon_create,
            engine_toggle_fix,
            engine_toggle_fix_entities,
            engine_move_point,
            engine_delete_entity,
            engine_delete_entities,
            engine_undo,
            engine_redo,
            engine_set_grid_snap,
            engine_set_grid_step,
            engine_solid_extrude,
            engine_solid_edit_extrude,
            engine_solid_revolve,
            engine_solid_edit_revolve,
            engine_solid_sweep,
            engine_solid_edit_sweep,
            engine_solid_loft,
            engine_solid_edit_loft,
            engine_solid_rib,
            engine_solid_edit_rib,
            engine_solid_fillet,
            engine_solid_edit_fillet,
            engine_solid_chamfer,
            engine_solid_edit_chamfer,
            engine_solid_hole,
            engine_solid_edit_hole,
            engine_solid_body_feature,
            engine_solid_edit_body_feature,
            engine_solid_recompute,
            engine_solid_set_rollback,
            engine_solid_delete_feature,
            engine_solid_reorder_feature,
        ])
        .run(tauri::generate_context!())
        .expect("error while running noBS CAD");
}
