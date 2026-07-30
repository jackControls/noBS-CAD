use std::io::{self, BufRead, Write};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::thread;
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use nbcad_core::BodyId;
use nbcad_export::MeshExportRequest;
use nbcad_occt::OcctKernel;
use nbcad_sketch::{host, SketchManager};
use nbcad_solid::{CommitKernelRequest, RecomputePlanDto, StepExportRequest};
use serde_json::{json, Map, Value};

mod disclosure;
mod session;

use disclosure::{
    auto_focus_for_tool, tags_for_tool, AdvertisementState, DisclosureMode, DisclosureState,
    FocusPack,
};

const LATEST_PROTOCOL: &str = "2025-06-18";
const MODELING_TOOL_COUNT: usize = 105;

#[derive(Clone, Copy)]
enum Payload {
    Empty,
    Object,
    Field(&'static str),
    DatumSource(&'static str),
    EditDatumSource(&'static str),
    BodyFeature(&'static str),
    EditBodyFeature(&'static str),
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Execution {
    Direct,
    SolidReplay,
    Control,
}

struct ToolSpec {
    name: &'static str,
    title: &'static str,
    description: &'static str,
    engine_method: &'static str,
    payload: Payload,
    execution: Execution,
    input_schema: Value,
    pack: FocusPack,
    spine: bool,
}

impl ToolSpec {
    fn direct(
        name: &'static str,
        title: &'static str,
        description: &'static str,
        engine_method: &'static str,
        payload: Payload,
        input_schema: Value,
    ) -> Self {
        let (pack, spine) = tags_for_tool(name);
        Self {
            name,
            title,
            description,
            engine_method,
            payload,
            execution: Execution::Direct,
            input_schema,
            pack,
            spine,
        }
    }

    fn solid(
        name: &'static str,
        title: &'static str,
        description: &'static str,
        engine_method: &'static str,
        payload: Payload,
        input_schema: Value,
    ) -> Self {
        let (pack, spine) = tags_for_tool(name);
        Self {
            name,
            title,
            description,
            engine_method,
            payload,
            execution: Execution::SolidReplay,
            input_schema,
            pack,
            spine,
        }
    }

    fn control(
        name: &'static str,
        title: &'static str,
        description: &'static str,
        input_schema: Value,
    ) -> Self {
        let (pack, spine) = tags_for_tool(name);
        Self {
            name,
            title,
            description,
            engine_method: "",
            payload: Payload::Empty,
            execution: Execution::Control,
            input_schema,
            pack,
            spine,
        }
    }
}

struct CadServer {
    manager: SketchManager,
    kernel: OcctKernel,
    disclosure: DisclosureState,
    /// Session id last successfully loaded via read-only `cad_attach` / `cad_refresh`.
    /// MCP never writes this session's files back (no last-writer-wins vs a UI).
    attached_document_id: Option<String>,
    pending_recompute_transaction: Option<u64>,
}

impl CadServer {
    fn new() -> Result<Self, String> {
        Ok(Self {
            manager: SketchManager::new(),
            kernel: OcctKernel::new().map_err(|error| error.to_string())?,
            disclosure: DisclosureState::new(),
            attached_document_id: None,
            pending_recompute_transaction: None,
        })
    }

    fn call_tool(&mut self, name: &str, arguments: Value) -> Result<Value, String> {
        let tools = tool_specs();
        let spec = tools
            .iter()
            .find(|spec| spec.name == name)
            .ok_or_else(|| format!("unknown tool: {name}"))?;
        let execution = spec.execution;
        let engine_method = spec.engine_method;
        let payload_kind = spec.payload;
        let pack = spec.pack;
        let spine = spec.spine;

        if execution == Execution::Control {
            return self.call_control(name, arguments);
        }

        if self.disclosure.advertisement_state(pack, spine) == AdvertisementState::HiddenButCallable
        {
            self.disclosure.re_promote(pack);
        }

        let payload = match payload_kind {
            Payload::Empty => String::new(),
            Payload::Object => serde_json::to_string(&arguments)
                .map_err(|error| format!("could not encode arguments: {error}"))?,
            Payload::Field(field) => {
                let value = arguments
                    .get(field)
                    .ok_or_else(|| format!("missing required argument '{field}'"))?;
                serde_json::to_string(value)
                    .map_err(|error| format!("could not encode '{field}': {error}"))?
            }
            Payload::DatumSource(kind) => {
                let mut source = arguments
                    .as_object()
                    .cloned()
                    .ok_or_else(|| "tool arguments must be an object".to_string())?;
                source.insert("type".to_string(), Value::String(kind.to_string()));
                serde_json::to_string(&json!({ "source": source }))
                    .map_err(|error| format!("could not encode construction plane: {error}"))?
            }
            Payload::EditDatumSource(kind) => {
                let mut fields = arguments
                    .as_object()
                    .cloned()
                    .ok_or_else(|| "tool arguments must be an object".to_string())?;
                let feature_id = fields
                    .remove("feature_id")
                    .ok_or_else(|| "missing required argument 'feature_id'".to_string())?;
                fields.insert("type".to_string(), Value::String(kind.to_string()));
                serde_json::to_string(&json!({
                    "feature_id": feature_id,
                    "plane": { "source": fields }
                }))
                .map_err(|error| format!("could not encode construction plane edit: {error}"))?
            }
            Payload::BodyFeature(kind) => serde_json::to_string(&json!({
                "type": kind,
                "request": arguments
            }))
            .map_err(|error| format!("could not encode body feature: {error}"))?,
            Payload::EditBodyFeature(kind) => {
                let feature_id = arguments
                    .get("feature_id")
                    .ok_or_else(|| "missing required argument 'feature_id'".to_string())?;
                let request = arguments
                    .get("request")
                    .ok_or_else(|| "missing required argument 'request'".to_string())?;
                serde_json::to_string(&json!({
                    "feature_id": feature_id,
                    "feature": { "type": kind, "request": request }
                }))
                .map_err(|error| format!("could not encode body feature edit: {error}"))?
            }
        };

        let mut value = if execution == Execution::Direct {
            if name == "solid_export_step" {
                let request: StepExportRequest = if arguments.is_null() {
                    StepExportRequest::default()
                } else {
                    serde_json::from_value(arguments)
                        .map_err(|error| format!("invalid STEP export request: {error}"))?
                };
                let bytes = self
                    .kernel
                    .export_step(&request)
                    .map_err(|error| error.to_string())?;
                json!({
                    "format": "step",
                    "encoding": "base64",
                    "bytes_base64": BASE64.encode(bytes),
                })
            } else if name == "solid_export_stl" || name == "solid_export_3mf" {
                self.export_mesh(name, arguments)?
            } else if name == "solid_tessellate" {
                self.tessellate_tool(arguments)?
            } else if name == "solid_export_preflight" {
                self.export_preflight_tool()?
            } else if name == "demo_export_pip_3mf" {
                self.demo_pip_3mf_tool(arguments)?
            } else if name == "material_catalog" {
                serde_json::from_str(&nbcad_export::catalog_json())
                    .map_err(|error| format!("catalog json: {error}"))?
            } else if name == "body_appearances" {
                serde_json::to_value(self.manager.body_appearances())
                    .map_err(|error| format!("encode appearances: {error}"))?
            } else if name == "set_body_appearance" {
                self.set_body_appearance_tool(arguments)?
            } else {
                parse_engine_envelope(host::handle(&mut self.manager, engine_method, &payload))?
            }
        } else {
            let plan_value =
                parse_engine_envelope(host::handle(&mut self.manager, engine_method, &payload))?;
            let plan: RecomputePlanDto = serde_json::from_value(plan_value)
                .map_err(|error| format!("engine returned an invalid recompute plan: {error}"))?;
            let transaction_id = plan.transaction_id;
            self.pending_recompute_transaction = Some(transaction_id);
            let scene = match self.kernel.recompute(&plan) {
                Ok(scene) => scene,
                Err(error) => {
                    self.manager.cancel_solid_recompute(transaction_id);
                    self.pending_recompute_transaction = None;
                    return Err(error.to_string());
                }
            };
            let commit = CommitKernelRequest {
                transaction_id,
                scene,
            };
            let committed = parse_engine_envelope(host::handle(
                &mut self.manager,
                "solid_commit",
                &serde_json::to_string(&commit)
                    .map_err(|error| format!("could not encode kernel result: {error}"))?,
            ))?;
            self.pending_recompute_transaction = None;
            committed
        };

        if let Some(focus) = auto_focus_for_tool(name) {
            self.disclosure.auto_hint(focus);
        }
        value = annotate_disclosure(value, &self.disclosure, pack, spine);
        Ok(value)
    }

    fn call_control(&mut self, name: &str, arguments: Value) -> Result<Value, String> {
        let value = match name {
            "cad_get_focus" => self.disclosure.status_json(),
            "cad_set_focus" => {
                let focus_name = arguments
                    .get("focus")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "missing required argument 'focus'".to_string())?;
                let focus = FocusPack::parse(focus_name)
                    .ok_or_else(|| format!("unknown focus '{focus_name}'"))?;
                let explicit = arguments
                    .get("explicit")
                    .and_then(Value::as_bool)
                    .unwrap_or(true);
                self.disclosure.set_focus(focus, explicit);
                self.disclosure.status_json()
            }
            "cad_list_focus_areas" => DisclosureState::focus_areas_json(),
            "cad_get_tool_disclosure_mode" => {
                json!({ "mode": self.disclosure.status_json()["mode"] })
            }
            "cad_set_tool_disclosure_mode" => {
                let mode_name = arguments
                    .get("mode")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "missing required argument 'mode'".to_string())?;
                let mode = DisclosureMode::parse(mode_name)
                    .ok_or_else(|| format!("unknown disclosure mode '{mode_name}'"))?;
                self.disclosure.set_mode(mode);
                json!({ "mode": mode.as_str() })
            }
            "cad_list_all_tools" => full_tool_catalog(),
            "cad_cancel_recompute" => {
                if let Some(transaction_id) = self.pending_recompute_transaction.take() {
                    self.manager.cancel_solid_recompute(transaction_id);
                    json!({ "cancelled": true, "transaction_id": transaction_id })
                } else {
                    json!({ "cancelled": false, "reason": "no in-flight solid recompute" })
                }
            }
            "cad_list_sessions" => session::sessions_list_json(),
            "cad_attach" => self.attach_read_only_snapshot(&arguments)?,
            "cad_refresh" => self.refresh_read_only_snapshot()?,
            "cad_detach" => {
                let previous = self.attached_document_id.take();
                json!({
                    "detached": true,
                    "session_id": previous,
                    "session_mode": "read_only_snapshot",
                })
            }
            other => return Err(format!("unknown control tool: {other}")),
        };
        Ok(value)
    }

    /// Load `model.json` (+ optional `focus.json`) into this process.
    /// Marks attached only after a successful model load (Jack §3).
    fn attach_read_only_snapshot(&mut self, arguments: &Value) -> Result<Value, String> {
        let session_id = arguments
            .get("session_id")
            .or_else(|| arguments.get("document_id"))
            .and_then(Value::as_str)
            .ok_or_else(|| "missing required argument 'session_id' (or document_id)".to_string())?;
        session::require_valid_session_id(session_id)?;
        if !session::list_sessions()?.iter().any(|id| id == session_id) {
            return Err(format!(
                "session '{session_id}' was not found under {}",
                session::session_dir().display()
            ));
        }
        self.load_snapshot_model(session_id)?;
        self.apply_snapshot_focus(session_id);
        self.attached_document_id = Some(session_id.to_string());
        Ok(json!({
            "attached": true,
            "session_id": session_id,
            "document_id": session_id,
            "focus": self.disclosure.active().as_str(),
            "session_mode": "read_only_snapshot",
            "writeback": false,
            "heartbeat": session::heartbeat_meta(session_id),
        }))
    }

    /// Re-read the currently attached session from disk into this process.
    fn refresh_read_only_snapshot(&mut self) -> Result<Value, String> {
        let Some(session_id) = self.attached_document_id.clone() else {
            return Err("no session attached; call cad_attach first".to_string());
        };
        self.load_snapshot_model(&session_id)?;
        self.apply_snapshot_focus(&session_id);
        Ok(json!({
            "refreshed": true,
            "session_id": session_id,
            "focus": self.disclosure.active().as_str(),
            "session_mode": "read_only_snapshot",
            "writeback": false,
        }))
    }

    fn load_snapshot_model(&mut self, session_id: &str) -> Result<(), String> {
        let model_json = session::require_model_json(session_id)?;
        let plan_value = parse_engine_envelope(host::handle(
            &mut self.manager,
            "project_prepare_load",
            &serde_json::to_string(&Value::String(model_json)).map_err(|e| e.to_string())?,
        ))?;
        let plan: RecomputePlanDto = serde_json::from_value(plan_value)
            .map_err(|error| format!("invalid model.json / recompute plan: {error}"))?;
        let transaction_id = plan.transaction_id;
        let scene = match self.kernel.recompute(&plan) {
            Ok(scene) => scene,
            Err(error) => {
                self.manager.cancel_solid_recompute(transaction_id);
                return Err(format!(
                    "session '{session_id}' model failed to recompute: {error}"
                ));
            }
        };
        let _ = parse_engine_envelope(host::handle(
            &mut self.manager,
            "solid_commit",
            &serde_json::to_string(&CommitKernelRequest {
                transaction_id,
                scene,
            })
            .map_err(|e| e.to_string())?,
        ))?;
        Ok(())
    }

    fn apply_snapshot_focus(&mut self, session_id: &str) {
        let Ok(focus_json) = session::read_session_file(session_id, "focus.json") else {
            return;
        };
        let Ok(focus_value) = serde_json::from_str::<Value>(&focus_json) else {
            return;
        };
        if let Some(focus_name) = focus_value.get("focus").and_then(Value::as_str) {
            if let Some(focus) = FocusPack::parse(focus_name) {
                self.disclosure.set_focus(focus, false);
                self.disclosure.clear_explicit_lock();
            }
        }
    }

    fn export_mesh(&mut self, name: &str, arguments: Value) -> Result<Value, String> {
        if !self.manager.solid_scene().errors.is_empty() {
            return Err("Resolve timeline errors before exporting mesh files.".to_string());
        }
        let request: MeshExportRequest = if arguments.is_null() {
            MeshExportRequest::default()
        } else {
            serde_json::from_value(arguments)
                .map_err(|error| format!("bad mesh export arguments: {error}"))?
        };
        let scene = self.manager.solid_scene();
        let appearances = self.manager.body_appearances();
        let mut meshes = self
            .kernel
            .tessellate_bodies(&request)
            .map_err(|error| error.to_string())?;
        for mesh in &mut meshes {
            if let Some(body) = scene.bodies.iter().find(|body| body.id == mesh.body_id) {
                mesh.name = body.name.clone();
            }
        }
        let bytes = if name == "solid_export_stl" {
            nbcad_export::write_stl(&meshes).map_err(|error| error.to_string())?
        } else {
            nbcad_export::ExportFacade::export_3mf(&meshes, &appearances, &request)
                .map_err(|error| error.to_string())?
        };
        Ok(json!({
            "format": if name == "solid_export_stl" { "stl" } else { "3mf" },
            "encoding": "base64",
            "slicer_target": request.slicer_target,
            "byte_length": bytes.len(),
            "bytes_base64": BASE64.encode(bytes),
        }))
    }

    fn set_body_appearance_tool(&mut self, arguments: Value) -> Result<Value, String> {
        let appearance = if let Some(preset_id) = arguments
            .get("preset_id")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty())
        {
            let body_id = arguments
                .get("body_id")
                .and_then(Value::as_u64)
                .ok_or_else(|| "set_body_appearance with preset_id requires body_id".to_string())?;
            let preset = nbcad_export::find_preset(preset_id).ok_or_else(|| {
                format!("unknown material preset_id '{preset_id}' (call material_catalog)")
            })?;
            preset.to_appearance(BodyId(body_id))
        } else {
            serde_json::from_value(arguments).map_err(|error| {
                format!("invalid body appearance (or pass body_id + preset_id): {error}")
            })?
        };
        let appearances = self
            .manager
            .set_body_appearance(appearance)
            .map_err(|error| error.to_string())?;
        Ok(json!({ "body_appearances": appearances }))
    }

    fn tessellate_tool(&mut self, arguments: Value) -> Result<Value, String> {
        if !self.manager.solid_scene().errors.is_empty() {
            return Err("Resolve timeline errors before tessellating.".to_string());
        }
        let request: MeshExportRequest = if arguments.is_null() {
            MeshExportRequest::default()
        } else {
            serde_json::from_value(arguments)
                .map_err(|error| format!("bad tessellate arguments: {error}"))?
        };
        let scene = self.manager.solid_scene();
        let mut meshes = self
            .kernel
            .tessellate_bodies(&request)
            .map_err(|error| error.to_string())?;
        for mesh in &mut meshes {
            if let Some(body) = scene.bodies.iter().find(|body| body.id == mesh.body_id) {
                mesh.name = body.name.clone();
            }
        }
        let bodies: Vec<Value> = meshes
            .iter()
            .map(|mesh| {
                let mut min = [f32::MAX; 3];
                let mut max = [f32::MIN; 3];
                for p in mesh.positions.chunks_exact(3) {
                    for i in 0..3 {
                        min[i] = min[i].min(p[i]);
                        max[i] = max[i].max(p[i]);
                    }
                }
                json!({
                    "body_id": mesh.body_id.0,
                    "name": mesh.name,
                    "triangle_count": mesh.triangle_count(),
                    "vertex_count": mesh.positions.len() / 3,
                    "bbox_min": min,
                    "bbox_max": max,
                })
            })
            .collect();
        Ok(json!({
            "linear_deflection": request.linear_deflection,
            "angular_deflection": request.angular_deflection,
            "body_count": bodies.len(),
            "bodies": bodies,
        }))
    }

    fn export_preflight_tool(&mut self) -> Result<Value, String> {
        let scene = self.manager.solid_scene();
        let errors: Vec<String> = scene
            .errors
            .iter()
            .map(|error| format!("feature {}: {}", error.feature_id.0, error.message))
            .collect();
        let body_ids: Vec<u64> = scene.bodies.iter().map(|body| body.id.0).collect();
        let appearances = self.manager.body_appearances();
        let appearing: Vec<u64> = appearances.iter().map(|a| a.body_id.0).collect();
        let missing_appearance: Vec<u64> = body_ids
            .iter()
            .copied()
            .filter(|id| !appearing.contains(id))
            .collect();
        let ok = errors.is_empty() && !body_ids.is_empty();
        Ok(json!({
            "ok": ok,
            "body_count": body_ids.len(),
            "body_ids": body_ids,
            "timeline_errors": errors,
            "appearances_assigned": appearing.len(),
            "bodies_missing_appearance": missing_appearance,
            "hints": if !ok {
                json!([
                    "Fix timeline_errors before export.",
                    "Empty documents cannot export meshes.",
                    "Optional: set_body_appearance / material_catalog for colored 3MF."
                ])
            } else {
                json!([
                    "Ready for solid_export_3mf (preferred) or solid_export_stl / solid_export_step."
                ])
            },
        }))
    }

    fn demo_pip_3mf_tool(&mut self, arguments: Value) -> Result<Value, String> {
        let request: MeshExportRequest = if arguments.is_null() {
            MeshExportRequest::default()
        } else {
            serde_json::from_value(arguments.clone())
                .map_err(|error| format!("bad demo export arguments: {error}"))?
        };
        let kind = arguments
            .get("kind")
            .and_then(Value::as_str)
            .unwrap_or("cam_bolt");
        let (meshes, appearances, demo) = match kind {
            "clip" | "latch" => {
                let (m, a) = nbcad_export::print_in_place_clip();
                (m, a, "print_in_place_clip")
            }
            "cam_bolt" | "cam" => {
                let (m, a) = nbcad_export::print_in_place_cam_bolt();
                (m, a, "print_in_place_cam_bolt")
            }
            other => {
                return Err(format!(
                    "unknown demo kind '{other}' (expected cam_bolt or clip)"
                ))
            }
        };
        let bytes = nbcad_export::ExportFacade::export_3mf(&meshes, &appearances, &request)
            .map_err(|error| error.to_string())?;
        Ok(json!({
            "format": "3mf",
            "encoding": "base64",
            "demo": demo,
            "body_count": meshes.len(),
            "clearance_mm": nbcad_export::CLEAR_MM,
            "slicer_target": request.slicer_target,
            "byte_length": bytes.len(),
            "bytes_base64": BASE64.encode(bytes),
        }))
    }
}

fn parse_engine_envelope(raw: String) -> Result<Value, String> {
    let envelope: Value =
        serde_json::from_str(&raw).map_err(|error| format!("invalid engine response: {error}"))?;
    if envelope.get("ok").and_then(Value::as_bool) == Some(true) {
        Ok(envelope.get("value").cloned().unwrap_or(Value::Null))
    } else {
        Err(envelope
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("unknown noBS CAD engine error")
            .to_string())
    }
}

fn annotate_disclosure(
    mut value: Value,
    disclosure: &DisclosureState,
    pack: FocusPack,
    spine: bool,
) -> Value {
    let note = disclosure.disclosure_note(pack, spine);
    // Only annotate JSON objects so string/array engine payloads (e.g.
    // cad_project_model) keep their historical shapes for goldens/clients.
    if let Value::Object(object) = &mut value {
        object.insert("_disclosure".to_string(), note);
    }
    value
}

fn tool_entry(tool: &ToolSpec) -> Value {
    json!({
        "name": tool.name,
        "title": tool.title,
        "description": tool.description,
        "inputSchema": tool.input_schema
    })
}

fn full_tool_catalog() -> Value {
    Value::Array(
        tool_specs()
            .iter()
            .map(|tool| {
                json!({
                    "name": tool.name,
                    "title": tool.title,
                    "description": tool.description,
                    "inputSchema": tool.input_schema,
                    "execution": match tool.execution {
                        Execution::Direct => "direct",
                        Execution::SolidReplay => "solid_replay",
                        Execution::Control => "control",
                    },
                    "pack": tool.pack.as_str(),
                    "spine": tool.spine,
                })
            })
            .collect(),
    )
}

fn empty_schema() -> Value {
    json!({
        "type": "object",
        "properties": {},
        "additionalProperties": false
    })
}

fn object_schema(properties: Value, required: &[&str]) -> Value {
    json!({
        "type": "object",
        "properties": properties,
        "required": required,
        "additionalProperties": false
    })
}

fn dto_schema(description: &str) -> Value {
    json!({
        "type": "object",
        "description": description,
        "additionalProperties": true
    })
}

fn point_schema() -> Value {
    object_schema(
        json!({
            "x": { "type": "number", "description": "Sketch-local X coordinate in millimeters." },
            "y": { "type": "number", "description": "Sketch-local Y coordinate in millimeters." }
        }),
        &["x", "y"],
    )
}

fn entity_ids_schema() -> Value {
    json!({
        "type": "array",
        "items": { "type": "integer", "minimum": 1 },
        "minItems": 1
    })
}

fn tool_specs() -> Vec<ToolSpec> {
    let point = point_schema();
    let entity_ids = entity_ids_schema();
    let plane = json!({
        "oneOf": [
            {
                "type": "object",
                "properties": {
                    "type": { "const": "origin_plane" },
                    "plane": { "type": "string", "enum": ["xy", "xz", "yz"] }
                },
                "required": ["type", "plane"],
                "additionalProperties": false
            },
            {
                "type": "object",
                "properties": {
                    "type": { "const": "planar_face" },
                    "face_id": { "type": "integer", "minimum": 1 }
                },
                "required": ["type", "face_id"],
                "additionalProperties": false
            },
            {
                "type": "object",
                "properties": {
                    "type": { "const": "datum_plane" },
                    "datum_id": { "type": "integer", "minimum": 1 }
                },
                "required": ["type", "datum_id"],
                "additionalProperties": false
            }
        ]
    });
    let point3 = object_schema(
        json!({
            "x": { "type": "number" },
            "y": { "type": "number" },
            "z": { "type": "number" }
        }),
        &["x", "y", "z"],
    );
    let profile_indices = json!({
        "type": "array",
        "items": { "type": "integer", "minimum": 0 },
        "minItems": 1,
        "uniqueItems": true
    });
    let body_ids = json!({
        "type": "array",
        "items": { "type": "integer", "minimum": 1 },
        "uniqueItems": true
    });
    let edge_ids = json!({
        "type": "array",
        "items": { "type": "integer", "minimum": 1 },
        "minItems": 1,
        "uniqueItems": true
    });
    let extrude = object_schema(
        json!({
            "sketch_name": { "type": "string", "minLength": 1 },
            "profile_indices": profile_indices.clone(),
            "operation": { "type": "string", "enum": ["new_body", "join", "cut", "intersect"] },
            "extent": {
                "type": "object",
                "description": "Tagged extent: distance, two_sides, symmetric, through_all, or to_face.",
                "additionalProperties": true
            },
            "taper_angle_deg": { "type": "number", "exclusiveMinimum": -89, "exclusiveMaximum": 89 },
            "flip": { "type": "boolean" },
            "target_body_ids": body_ids.clone()
        }),
        &[
            "sketch_name",
            "profile_indices",
            "operation",
            "extent",
            "taper_angle_deg",
            "flip",
            "target_body_ids",
        ],
    );
    let revolve = object_schema(
        json!({
            "sketch_name": { "type": "string", "minLength": 1 },
            "profile_indices": profile_indices,
            "axis_origin": point.clone(),
            "axis_direction": point.clone(),
            "axis_line_entity_id": { "type": ["integer", "null"], "minimum": 1, "description": "Optional stable line entity id; overrides the manual axis." },
            "angle_deg": { "type": "number", "exclusiveMinimum": 0, "maximum": 360 },
            "flip": { "type": "boolean" },
            "operation": { "type": "string", "enum": ["new_body", "join", "cut", "intersect"] },
            "target_body_ids": body_ids.clone()
        }),
        &[
            "sketch_name",
            "profile_indices",
            "axis_origin",
            "axis_direction",
            "angle_deg",
            "flip",
            "operation",
            "target_body_ids",
        ],
    );
    let profile_ref = object_schema(
        json!({
            "sketch_name": { "type": "string", "minLength": 1 },
            "profile_index": { "type": "integer", "minimum": 0 }
        }),
        &["sketch_name", "profile_index"],
    );
    let solid_operation =
        json!({ "type": "string", "enum": ["new_body", "join", "cut", "intersect"] });
    let path_ref = object_schema(
        json!({
            "sketch_name": { "type": "string", "minLength": 1 },
            "entity_ids": entity_ids.clone()
        }),
        &["sketch_name", "entity_ids"],
    );
    let sweep = object_schema(
        json!({
            "profile": profile_ref.clone(),
            "path_sketch_name": { "type": "string", "minLength": 1 },
            "path_entity_ids": entity_ids.clone(),
            "operation": solid_operation.clone(),
            "target_body_ids": body_ids.clone(),
            "guide_rail": { "oneOf": [path_ref.clone(), {"type": "null"}] },
            "orientation": { "type": "string", "enum": ["corrected_frenet", "frenet", "fixed"] },
            "transition": { "type": "string", "enum": ["transformed", "right_corner", "round_corner"] },
            "force_c1": { "type": "boolean" }
        }),
        &[
            "profile",
            "path_sketch_name",
            "path_entity_ids",
            "operation",
            "target_body_ids",
        ],
    );
    let loft = object_schema(
        json!({
            "sections": { "type": "array", "items": profile_ref, "minItems": 2 },
            "ruled": { "type": "boolean" },
            "operation": solid_operation.clone(),
            "target_body_ids": body_ids.clone(),
            "continuity": { "type": "string", "enum": ["g0", "g1", "g2"] },
            "centerline": { "oneOf": [path_ref.clone(), {"type": "null"}] },
            "guide_rail": { "oneOf": [path_ref, {"type": "null"}] }
        }),
        &["sections", "ruled", "operation", "target_body_ids"],
    );
    let solid_fillet = object_schema(
        json!({
            "body_id": { "type": "integer", "minimum": 1 },
            "edge_ids": edge_ids.clone(),
            "radius": { "type": "number", "exclusiveMinimum": 0 },
            "tangent_chain": { "type": "boolean" }
        }),
        &["body_id", "edge_ids", "radius", "tangent_chain"],
    );
    let solid_chamfer = object_schema(
        json!({
            "body_id": { "type": "integer", "minimum": 1 },
            "edge_ids": edge_ids,
            "distance": { "type": "number", "exclusiveMinimum": 0 },
            "tangent_chain": { "type": "boolean" }
        }),
        &["body_id", "edge_ids", "distance", "tangent_chain"],
    );
    let sketch_point_reference = {
        let variants = ["point", "start", "end", "center"]
            .into_iter()
            .map(|kind| {
                object_schema(
                    json!({
                        "sketch_name": { "type": "string", "minLength": 1 },
                        "entity_id": { "type": "integer", "minimum": 1 },
                        "kind": { "const": kind }
                    }),
                    &["sketch_name", "entity_id", "kind"],
                )
            })
            .chain(std::iter::once(object_schema(
                json!({
                    "sketch_name": { "type": "string", "minLength": 1 },
                    "entity_id": { "type": "integer", "minimum": 1 },
                    "kind": { "const": "fit_point" },
                    "index": { "type": "integer", "minimum": 0 }
                }),
                &["sketch_name", "entity_id", "kind", "index"],
            )))
            .collect::<Vec<_>>();
        json!({ "oneOf": variants })
    };
    let hole_position = object_schema(
        json!({
            "position": point.clone(),
            "position_reference": {
                "oneOf": [sketch_point_reference.clone(), {"type": "null"}]
            }
        }),
        &["position"],
    );
    let hole_thread = object_schema(
        json!({
            "standard": { "type": "string", "enum": ["iso_metric", "unified_inch"] },
            "series": {
                "type": "string",
                "enum": ["metric_coarse", "metric_fine", "unc", "unf"]
            },
            "designation": { "type": "string", "minLength": 1 },
            "class": { "type": "string", "minLength": 1 },
            "nominal_diameter": {
                "type": "number",
                "exclusiveMinimum": 0,
                "description": "Basic thread major diameter in millimetres."
            },
            "pitch": {
                "type": "number",
                "exclusiveMinimum": 0,
                "description": "Axial pitch in millimetres, including for Unified threads."
            },
            "threads_per_inch": {
                "type": ["number", "null"],
                "exclusiveMinimum": 0
            },
            "hand": { "type": "string", "enum": ["right", "left"] },
            "depth": {
                "type": ["number", "null"],
                "exclusiveMinimum": 0,
                "description": "Null threads the full cylindrical hole depth."
            },
            "representation": {
                "type": "string",
                "enum": ["modeled", "simplified"]
            },
            "tap_drill_designation": { "type": ["string", "null"] }
        }),
        &[
            "standard",
            "series",
            "designation",
            "class",
            "nominal_diameter",
            "pitch",
            "threads_per_inch",
            "hand",
            "depth",
            "representation",
        ],
    );
    let hole = object_schema(
        json!({
            "body_id": { "type": "integer", "minimum": 1 },
            "face_id": { "type": "integer", "minimum": 1 },
            "position": point.clone(),
            "position_reference": {
                "oneOf": [sketch_point_reference, {"type": "null"}]
            },
            "positions": {
                "type": "array",
                "items": hole_position,
                "minItems": 1
            },
            "diameter": { "type": "number", "exclusiveMinimum": 0 },
            "extent": {
                "oneOf": [
                    {
                        "type": "object",
                        "properties": {
                            "type": { "const": "distance" },
                            "depth": { "type": "number", "exclusiveMinimum": 0 }
                        },
                        "required": ["type", "depth"],
                        "additionalProperties": false
                    },
                    {
                        "type": "object",
                        "properties": { "type": { "const": "through_all" } },
                        "required": ["type"],
                        "additionalProperties": false
                    }
                ]
            },
            "style": { "type": "string", "enum": ["simple", "counterbore", "countersink"] },
            "counterbore_diameter": { "type": "number", "minimum": 0 },
            "counterbore_depth": { "type": "number", "minimum": 0 },
            "countersink_diameter": { "type": "number", "minimum": 0 },
            "countersink_angle_deg": { "type": "number", "exclusiveMinimum": 0, "exclusiveMaximum": 180 },
            "bottom_style": { "type": "string", "enum": ["flat", "drill_point"] },
            "drill_point_angle_deg": { "type": "number", "exclusiveMinimum": 0, "exclusiveMaximum": 180 },
            "thread": {
                "oneOf": [hole_thread, {"type": "null"}],
                "description": "Optional ISO metric or ASME B1.1 Unified internal thread. Hole diameter is the predrill diameter."
            },
            "flip": { "type": "boolean" }
        }),
        &[
            "body_id",
            "face_id",
            "position",
            "diameter",
            "extent",
            "style",
            "counterbore_diameter",
            "counterbore_depth",
            "countersink_diameter",
            "countersink_angle_deg",
            "flip",
        ],
    );
    let rib = object_schema(
        json!({
            "sketch_name": { "type": "string", "minLength": 1 },
            "line_entity_ids": entity_ids,
            "thickness": { "type": "number", "exclusiveMinimum": 0 },
            "depth": { "type": "number", "exclusiveMinimum": 0 },
            "extent": {
                "type": "object",
                "description": "Tagged Rib extent: distance, to_next, to_face, or through_all.",
                "additionalProperties": true
            },
            "symmetric": { "type": "boolean" },
            "flip": { "type": "boolean" },
            "operation": solid_operation,
            "target_body_ids": body_ids.clone()
        }),
        &[
            "sketch_name",
            "line_entity_ids",
            "thickness",
            "depth",
            "symmetric",
            "flip",
            "operation",
            "target_body_ids",
        ],
    );
    let face_ids = json!({
        "type": "array",
        "items": { "type": "integer", "minimum": 1 },
        "minItems": 1,
        "uniqueItems": true
    });
    let shell = object_schema(
        json!({
            "body_id": { "type": "integer", "minimum": 1 },
            "face_ids": face_ids,
            "thickness": { "type": "number", "exclusiveMinimum": 0 },
            "inward": { "type": "boolean" }
        }),
        &["body_id", "face_ids", "thickness", "inward"],
    );
    let solid_mirror = object_schema(
        json!({
            "body_ids": body_ids.clone(),
            "plane": plane.clone()
        }),
        &["body_ids", "plane"],
    );
    let rectangular_pattern = object_schema(
        json!({
            "body_ids": body_ids.clone(),
            "direction": point3.clone(),
            "spacing": { "type": "number" },
            "count": { "type": "integer", "minimum": 2 },
            "second_direction": { "oneOf": [point3.clone(), {"type": "null"}] },
            "second_spacing": { "type": "number" },
            "second_count": { "type": "integer", "minimum": 1 }
        }),
        &["body_ids", "direction", "spacing", "count"],
    );
    let circular_pattern = object_schema(
        json!({
            "body_ids": body_ids.clone(),
            "axis_origin": point3.clone(),
            "axis_direction": point3,
            "count": { "type": "integer", "minimum": 2 },
            "total_angle_deg": { "type": "number", "exclusiveMinimum": -360, "maximum": 360 }
        }),
        &[
            "body_ids",
            "axis_origin",
            "axis_direction",
            "count",
            "total_angle_deg",
        ],
    );
    let combine = object_schema(
        json!({
            "target_body_id": { "type": "integer", "minimum": 1 },
            "tool_body_ids": body_ids.clone(),
            "operation": { "type": "string", "enum": ["join", "cut", "intersect"] },
            "keep_tools": { "type": "boolean" }
        }),
        &["target_body_id", "tool_body_ids", "operation", "keep_tools"],
    );
    let split_body = object_schema(
        json!({
            "body_id": { "type": "integer", "minimum": 1 },
            "plane": plane.clone()
        }),
        &["body_id", "plane"],
    );
    let offset_plane = object_schema(
        json!({
            "reference": plane.clone(),
            "distance": { "type": "number" }
        }),
        &["reference", "distance"],
    );
    let midplane = object_schema(
        json!({
            "first": plane.clone(),
            "second": plane.clone()
        }),
        &["first", "second"],
    );
    let plane_at_angle = object_schema(
        json!({
            "reference": plane,
            "body_id": { "type": "integer", "minimum": 1 },
            "edge_id": { "type": "integer", "minimum": 1 },
            "angle_deg": { "type": "number", "minimum": -360, "maximum": 360 }
        }),
        &["reference", "body_id", "edge_id", "angle_deg"],
    );

    let mut tools = vec![
        ToolSpec::direct(
            "cad_document",
            "Inspect CAD document",
            "Return document settings, browser tree, and ordered feature history.",
            "document",
            Payload::Empty,
            empty_schema(),
        ),
        ToolSpec::direct(
            "cad_set_document_name",
            "Set document name",
            "Rename the active headless noBS CAD document.",
            "document_set_name",
            Payload::Field("name"),
            object_schema(json!({"name": {"type": "string", "minLength": 1}}), &["name"]),
        ),
        ToolSpec::direct(
            "cad_project_model",
            "Export project model",
            "Return the versioned model.json payload used inside a .nbcad project.",
            "project_export_model",
            Payload::Empty,
            empty_schema(),
        ),
        ToolSpec::solid(
            "cad_load_project_model",
            "Load project model",
            "Transactionally load and recompute a noBS CAD model.json payload.",
            "project_prepare_load",
            Payload::Field("model_json"),
            object_schema(
                json!({"model_json": {"type": "string", "minLength": 2}}),
                &["model_json"],
            ),
        ),
        ToolSpec::solid(
            "cad_new_project",
            "New project",
            "Clear the headless document to a fresh empty project and recompute (resets botched sessions).",
            "project_prepare_new",
            Payload::Empty,
            empty_schema(),
        ),
        ToolSpec::direct(
            "sketch_begin",
            "Begin sketch",
            "Begin a sketch on an origin plane or stable planar FaceId, with an optional face-origin placement policy.",
            "begin_sketch",
            Payload::Object,
            object_schema(
                json!({
                    "plane": plane,
                    "face_origin": {
                        "type": "string",
                        "enum": ["face_center", "global_origin_projection"],
                        "description": "For planar faces, place sketch zero at the face center or at the projected global XYZ origin."
                    }
                }),
                &["plane"],
            ),
        ),
        ToolSpec::direct(
            "sketch_finish",
            "Finish sketch",
            "Finish the active sketch and add it to feature history.",
            "end_sketch",
            Payload::Empty,
            empty_schema(),
        ),
        ToolSpec::direct(
            "sketch_edit",
            "Edit sketch",
            "Re-enter a finished sketch by name.",
            "edit_sketch",
            Payload::Field("name"),
            object_schema(json!({"name": {"type": "string", "minLength": 1}}), &["name"]),
        ),
        ToolSpec::direct(
            "sketch_active",
            "Inspect active sketch",
            "Return the active sketch snapshot or null.",
            "active_sketch",
            Payload::Empty,
            empty_schema(),
        ),
        ToolSpec::direct(
            "sketch_finished",
            "List finished sketches",
            "Return retained snapshots of every finished sketch.",
            "finished_sketches",
            Payload::Empty,
            empty_schema(),
        ),
        ToolSpec::direct(
            "sketch_profiles",
            "List closed profiles",
            "Extract closed profile loops available to solid tools.",
            "profile_catalog",
            Payload::Empty,
            empty_schema(),
        ),
        ToolSpec::direct(
            "sketch_preview_line",
            "Preview line",
            "Resolve snapping and inferred constraints without mutating the sketch.",
            "preview_segment",
            Payload::Object,
            object_schema(
                json!({"from": point.clone(), "to_raw": point.clone(), "ctrl_held": {"type": "boolean"}}),
                &["from", "to_raw"],
            ),
        ),
        ToolSpec::direct(
            "sketch_preview_line_locked",
            "Preview locked line",
            "Preview a length/angle-locked segment without mutating the sketch (dynamic-input parity).",
            "preview_segment_locked",
            Payload::Object,
            object_schema(
                json!({
                    "from": point.clone(),
                    "to_hint": point.clone(),
                    "length_mm": {"type": "number", "exclusiveMinimum": 0},
                    "angle_deg": {"type": "number"},
                    "length_text": {"type": "string"},
                    "angle_text": {"type": "string"},
                    "ctrl_held": {"type": "boolean"}
                }),
                &["from", "to_hint"],
            ),
        ),
        ToolSpec::direct(
            "sketch_add_line",
            "Add line",
            "Add a snapped line segment to the active sketch.",
            "add_line",
            Payload::Object,
            object_schema(
                json!({"from": point.clone(), "to_raw": point.clone(), "ctrl_held": {"type": "boolean"}}),
                &["from", "to_raw"],
            ),
        ),
        ToolSpec::direct(
            "sketch_add_line_locked",
            "Add dimensioned line",
            "Add a line with optional locked length/angle values or formula text.",
            "add_line_locked",
            Payload::Object,
            dto_schema("LockedSegmentRequest: from, to_hint, optional length_mm/angle_deg or length_text/angle_text, ctrl_held."),
        ),
        ToolSpec::direct(
            "sketch_add_midpoint_line",
            "Add midpoint line",
            "Create a line symmetrically from a midpoint and endpoint.",
            "add_line_midpoint",
            Payload::Object,
            object_schema(
                json!({"mid_raw": point.clone(), "end_raw": point.clone(), "ctrl_held": {"type": "boolean"}}),
                &["mid_raw", "end_raw"],
            ),
        ),
        ToolSpec::direct(
            "sketch_add_point",
            "Add point",
            "Add a sketch point.",
            "add_point",
            Payload::Object,
            object_schema(json!({"position": point.clone()}), &["position"]),
        ),
        ToolSpec::direct(
            "sketch_add_rectangle",
            "Add rectangle",
            "Add a two-point or center rectangle.",
            "add_rectangle",
            Payload::Object,
            object_schema(
                json!({
                    "mode": {"type": "string", "enum": ["two_point", "center"]},
                    "p1": point.clone(),
                    "p2": point.clone(),
                    "ctrl_held": {"type": "boolean"}
                }),
                &["mode", "p1", "p2"],
            ),
        ),
        ToolSpec::direct(
            "sketch_add_rectangle_locked",
            "Add dimensioned rectangle",
            "Add a rectangle with optional driving width/height values or formulas.",
            "add_rectangle_locked",
            Payload::Object,
            dto_schema("LockedRectangleRequest: mode, anchor, corner_hint, optional width/height values or text, ctrl_held."),
        ),
        ToolSpec::direct(
            "sketch_add_circle",
            "Add circle",
            "Add a center-diameter or two-point circle.",
            "add_circle",
            Payload::Object,
            object_schema(
                json!({
                    "mode": {"type": "string", "enum": ["center_diameter", "two_point"]},
                    "p1": point.clone(),
                    "p2": point.clone(),
                    "ctrl_held": {"type": "boolean"}
                }),
                &["mode", "p1", "p2"],
            ),
        ),
        ToolSpec::direct(
            "sketch_add_circle_locked",
            "Add dimensioned circle",
            "Add a circle with an optional driving diameter value or formula.",
            "add_circle_locked",
            Payload::Object,
            dto_schema("LockedCircleRequest: mode, anchor, edge_hint, optional diameter_mm/diameter_text, ctrl_held."),
        ),
        ToolSpec::direct(
            "sketch_add_arc_3pt",
            "Add three-point arc",
            "Add an arc through three sketch points.",
            "add_arc_3pt",
            Payload::Object,
            object_schema(
                json!({"p1": point.clone(), "p2": point.clone(), "p3": point.clone(), "ctrl_held": {"type": "boolean"}}),
                &["p1", "p2", "p3"],
            ),
        ),
        ToolSpec::direct(
            "sketch_add_arc_center",
            "Add center arc",
            "Add an arc from center, start, and sweep points.",
            "add_arc_center",
            Payload::Object,
            object_schema(
                json!({"center": point.clone(), "start": point.clone(), "sweep": point.clone(), "ctrl_held": {"type": "boolean"}}),
                &["center", "start", "sweep"],
            ),
        ),
        ToolSpec::direct(
            "sketch_add_slot",
            "Add slot",
            "Add a center-to-center, overall, or center-point slot.",
            "add_slot",
            Payload::Object,
            dto_schema("SlotRequest: mode, p1, p2, cursor, optional width_mm/width_text."),
        ),
        ToolSpec::direct(
            "sketch_add_spline",
            "Add fit-point spline",
            "Add a spline through two or more fit points.",
            "add_spline",
            Payload::Object,
            object_schema(
                json!({"points": {"type": "array", "items": point.clone(), "minItems": 2}}),
                &["points"],
            ),
        ),
        ToolSpec::direct(
            "sketch_add_constraint",
            "Add geometric constraint",
            "Add one tagged constraint such as horizontal, coincident, tangent, equal, parallel, perpendicular, fix, midpoint, concentric, collinear, or symmetry.",
            "add_constraint",
            Payload::Object,
            dto_schema("Constraint object with a snake_case `type` tag and its entity ids."),
        ),
        ToolSpec::direct(
            "sketch_add_constraints",
            "Add constraint batch",
            "Apply several tagged constraints as one transaction.",
            "add_constraints",
            Payload::Object,
            object_schema(
                json!({"constraints": {"type": "array", "items": {"type": "object"}, "minItems": 1}}),
                &["constraints"],
            ),
        ),
        ToolSpec::direct(
            "sketch_add_dimension",
            "Add driving dimension",
            "Add a driving dimension to selected entities, optionally using a formula.",
            "add_dimension",
            Payload::Object,
            object_schema(
                json!({
                    "entities": entity_ids.clone(),
                    "text_pos": point.clone(),
                    "value_text": {"type": ["string", "null"]}
                }),
                &["entities", "text_pos"],
            ),
        ),
        ToolSpec::direct(
            "sketch_edit_dimension",
            "Edit driving dimension",
            "Change a dimension value or formula.",
            "edit_dimension",
            Payload::Object,
            object_schema(
                json!({"constraint_id": {"type": "integer", "minimum": 1}, "text": {"type": "string"}}),
                &["constraint_id", "text"],
            ),
        ),
        ToolSpec::direct(
            "sketch_move_dimension",
            "Move dimension annotation",
            "Move a dimension's annotation position.",
            "move_dimension",
            Payload::Object,
            object_schema(
                json!({"constraint_id": {"type": "integer", "minimum": 1}, "text_pos": point.clone()}),
                &["constraint_id", "text_pos"],
            ),
        ),
        ToolSpec::direct(
            "sketch_delete_dimension",
            "Delete dimension",
            "Delete a driving dimension by constraint id.",
            "delete_dimension",
            Payload::Object,
            object_schema(
                json!({"constraint_id": {"type": "integer", "minimum": 1}}),
                &["constraint_id"],
            ),
        ),
        ToolSpec::direct(
            "sketch_fillet",
            "Fillet sketch lines",
            "Trim two intersecting lines and add a tangent arc with a driving radius.",
            "fillet_lines",
            Payload::Object,
            object_schema(
                json!({
                    "l1": {"type": "integer", "minimum": 1},
                    "l2": {"type": "integer", "minimum": 1},
                    "radius_text": {"type": "string", "minLength": 1}
                }),
                &["l1", "l2", "radius_text"],
            ),
        ),
        ToolSpec::direct(
            "sketch_chamfer",
            "Chamfer sketch lines",
            "Trim two intersecting lines and connect them with an equal-distance chamfer.",
            "chamfer_lines",
            Payload::Object,
            object_schema(
                json!({
                    "l1": {"type": "integer", "minimum": 1},
                    "l2": {"type": "integer", "minimum": 1},
                    "distance_text": {"type": "string", "minLength": 1}
                }),
                &["l1", "l2", "distance_text"],
            ),
        ),
        ToolSpec::direct(
            "sketch_offset",
            "Offset sketch curve",
            "Create an offset curve on the side selected by a cursor point.",
            "offset_curve",
            Payload::Object,
            object_schema(
                json!({
                    "entity": {"type": "integer", "minimum": 1},
                    "distance_text": {"type": "string", "minLength": 1},
                    "cursor": point.clone()
                }),
                &["entity", "distance_text", "cursor"],
            ),
        ),
        ToolSpec::direct(
            "sketch_trim",
            "Trim sketch curve",
            "Trim the clicked piece of a curve at its intersections.",
            "trim_entity",
            Payload::Object,
            object_schema(
                json!({"entity": {"type": "integer", "minimum": 1}, "click": point.clone()}),
                &["entity", "click"],
            ),
        ),
        ToolSpec::direct(
            "sketch_extend",
            "Extend sketch curve",
            "Extend the clicked end of a curve to the nearest intersection.",
            "extend_entity",
            Payload::Object,
            object_schema(
                json!({"entity": {"type": "integer", "minimum": 1}, "click": point.clone()}),
                &["entity", "click"],
            ),
        ),
        ToolSpec::direct(
            "sketch_break",
            "Break sketch curve",
            "Split a curve at a sketch-local point.",
            "break_curve",
            Payload::Object,
            object_schema(
                json!({"entity": {"type": "integer", "minimum": 1}, "at": point.clone()}),
                &["entity", "at"],
            ),
        ),
        ToolSpec::direct(
            "sketch_mirror",
            "Mirror sketch entities",
            "Mirror selected entities around an existing sketch line.",
            "mirror_entities",
            Payload::Object,
            object_schema(
                json!({"entity_ids": entity_ids.clone(), "axis_line": {"type": "integer", "minimum": 1}}),
                &["entity_ids", "axis_line"],
            ),
        ),
        ToolSpec::direct(
            "sketch_rectangular_pattern",
            "Rectangular sketch pattern",
            "Pattern selected sketch entities in one or two linear directions. Counts include the source occurrence.",
            "rectangular_pattern",
            Payload::Object,
            object_schema(
                json!({
                    "entity_ids": entity_ids.clone(),
                    "direction": point.clone(),
                    "spacing": {"type": "number"},
                    "count": {"type": "integer", "minimum": 2, "maximum": 1000},
                    "second_direction": point.clone(),
                    "second_spacing": {"type": "number"},
                    "second_count": {"type": "integer", "minimum": 1, "maximum": 1000}
                }),
                &["entity_ids", "direction", "spacing", "count"],
            ),
        ),
        ToolSpec::direct(
            "sketch_circular_pattern",
            "Circular sketch pattern",
            "Pattern selected sketch entities around a sketch-local center. Count includes the source occurrence.",
            "circular_pattern",
            Payload::Object,
            object_schema(
                json!({
                    "entity_ids": entity_ids.clone(),
                    "center": point.clone(),
                    "count": {"type": "integer", "minimum": 2, "maximum": 1000},
                    "total_angle_deg": {"type": "number"}
                }),
                &["entity_ids", "center", "count", "total_angle_deg"],
            ),
        ),
        ToolSpec::direct(
            "sketch_move_copy",
            "Move or copy sketch entities",
            "Translate selected entities, either in place or as copies.",
            "move_copy_entities",
            Payload::Object,
            object_schema(
                json!({
                    "entity_ids": entity_ids.clone(),
                    "dx": {"type": "number"},
                    "dy": {"type": "number"},
                    "copy": {"type": "boolean"}
                }),
                &["entity_ids", "dx", "dy", "copy"],
            ),
        ),
        ToolSpec::direct(
            "sketch_scale",
            "Scale sketch entities",
            "Scale selected entities around a sketch-local origin.",
            "scale_entities",
            Payload::Object,
            object_schema(
                json!({
                    "entity_ids": entity_ids.clone(),
                    "origin": point.clone(),
                    "factor_text": {"type": "string", "minLength": 1}
                }),
                &["entity_ids", "origin", "factor_text"],
            ),
        ),
        ToolSpec::direct(
            "sketch_polygon",
            "Create sketch polygon",
            "Create an inscribed or circumscribed regular polygon.",
            "polygon_create",
            Payload::Object,
            object_schema(
                json!({
                    "center": point.clone(),
                    "edge_count": {"type": "integer", "minimum": 3},
                    "radius_text": {"type": "string", "minLength": 1},
                    "rotation_deg": {"type": "number"},
                    "mode": {"type": "string", "enum": ["inscribed", "circumscribed"]}
                }),
                &["center", "edge_count", "radius_text", "rotation_deg", "mode"],
            ),
        ),
        ToolSpec::direct(
            "sketch_move_point",
            "Move sketch point",
            "Move a point through the solver; use phase=single for one scripted operation.",
            "move_point",
            Payload::Object,
            object_schema(
                json!({
                    "point_id": {"type": "integer", "minimum": 1},
                    "to_raw": point.clone(),
                    "ctrl_held": {"type": "boolean"},
                    "phase": {"type": "string", "enum": ["begin", "update", "end", "single"]}
                }),
                &["point_id", "to_raw"],
            ),
        ),
        ToolSpec::direct(
            "sketch_toggle_fix",
            "Fix or unfix entities",
            "Toggle Fix on a batch of sketch entities.",
            "toggle_fix_entities",
            Payload::Object,
            object_schema(json!({"entity_ids": entity_ids.clone()}), &["entity_ids"]),
        ),
        ToolSpec::direct(
            "sketch_delete_entities",
            "Delete sketch entities",
            "Delete one or more sketch entities as one undoable operation.",
            "delete_entities",
            Payload::Object,
            object_schema(json!({"entity_ids": entity_ids}), &["entity_ids"]),
        ),
        ToolSpec::direct(
            "sketch_undo",
            "Undo sketch command",
            "Undo the active sketch's last command.",
            "undo",
            Payload::Empty,
            empty_schema(),
        ),
        ToolSpec::direct(
            "sketch_redo",
            "Redo sketch command",
            "Redo the active sketch's next command.",
            "redo",
            Payload::Empty,
            empty_schema(),
        ),
        ToolSpec::direct(
            "sketch_set_grid_snap",
            "Set sketch grid snapping",
            "Enable or disable grid snapping for the active and future sketches.",
            "set_grid_snap",
            Payload::Object,
            object_schema(json!({"enabled": {"type": "boolean"}}), &["enabled"]),
        ),
        ToolSpec::direct(
            "sketch_set_grid_step",
            "Set sketch grid step",
            "Set the sketch grid step size in millimetres (matches UI grid precision).",
            "set_grid_step",
            Payload::Object,
            object_schema(
                json!({"step_mm": {"type": "number", "exclusiveMinimum": 0}}),
                &["step_mm"],
            ),
        ),
        ToolSpec::direct(
            "sketch_eval_expression",
            "Evaluate sketch expression",
            "Evaluate a number or parameter formula in the active sketch.",
            "eval_expression",
            Payload::Object,
            object_schema(json!({"text": {"type": "string", "minLength": 1}}), &["text"]),
        ),
        ToolSpec::direct(
            "sketch_set_dimension_style",
            "Set dimension style",
            "Use aligned or ISO 129 sketch dimension annotations.",
            "set_dimension_style",
            Payload::Object,
            object_schema(
                json!({"style": {"type": "string", "enum": ["aligned", "iso"]}}),
                &["style"],
            ),
        ),
        ToolSpec::direct(
            "sketch_preview_fillet",
            "Preview sketch fillet",
            "Return the tangent arc and trim points for two lines without mutating the sketch.",
            "fillet_preview",
            Payload::Object,
            object_schema(
                json!({
                    "l1": {"type": "integer", "minimum": 1},
                    "l2": {"type": "integer", "minimum": 1},
                    "radius_text": {"type": "string", "minLength": 1}
                }),
                &["l1", "l2", "radius_text"],
            ),
        ),
        ToolSpec::direct(
            "sketch_preview_offset",
            "Preview sketch offset",
            "Return an offset curve without mutating the sketch.",
            "offset_preview",
            Payload::Object,
            object_schema(
                json!({
                    "entity": {"type": "integer", "minimum": 1},
                    "distance_text": {"type": "string", "minLength": 1},
                    "cursor": point.clone()
                }),
                &["entity", "distance_text", "cursor"],
            ),
        ),
        ToolSpec::direct(
            "sketch_preview_trim",
            "Preview sketch trim",
            "Return kept and removed curve pieces without mutating the sketch.",
            "trim_preview",
            Payload::Object,
            object_schema(
                json!({"entity": {"type": "integer", "minimum": 1}, "click": point}),
                &["entity", "click"],
            ),
        ),
        ToolSpec::direct(
            "construction_plane_definitions",
            "List construction planes",
            "Return persisted offset, midplane, and plane-at-angle definitions with stable datum IDs and resolved bases.",
            "datum_plane_definitions",
            Payload::Empty,
            empty_schema(),
        ),
        ToolSpec::direct(
            "construction_plane_offset",
            "Create offset construction plane",
            "Create a construction plane at a signed distance from an origin plane, planar face, or existing datum plane.",
            "datum_plane_create",
            Payload::DatumSource("offset"),
            offset_plane.clone(),
        ),
        ToolSpec::direct(
            "construction_plane_edit_offset",
            "Edit offset construction plane",
            "Edit an offset-plane feature while preserving its feature and datum IDs.",
            "datum_plane_edit",
            Payload::EditDatumSource("offset"),
            object_schema(
                json!({
                    "feature_id": {"type": "integer", "minimum": 1},
                    "reference": offset_plane["properties"]["reference"].clone(),
                    "distance": {"type": "number"}
                }),
                &["feature_id", "reference", "distance"],
            ),
        ),
        ToolSpec::direct(
            "construction_plane_midplane",
            "Create midplane",
            "Create a construction plane halfway between two parallel plane references.",
            "datum_plane_create",
            Payload::DatumSource("midplane"),
            midplane.clone(),
        ),
        ToolSpec::direct(
            "construction_plane_edit_midplane",
            "Edit midplane",
            "Edit a midplane feature while preserving its feature and datum IDs.",
            "datum_plane_edit",
            Payload::EditDatumSource("midplane"),
            object_schema(
                json!({
                    "feature_id": {"type": "integer", "minimum": 1},
                    "first": midplane["properties"]["first"].clone(),
                    "second": midplane["properties"]["second"].clone()
                }),
                &["feature_id", "first", "second"],
            ),
        ),
        ToolSpec::direct(
            "construction_plane_at_angle",
            "Create plane at angle",
            "Rotate a reference plane around a stable straight body edge lying on that plane.",
            "datum_plane_create",
            Payload::DatumSource("at_angle"),
            plane_at_angle.clone(),
        ),
        ToolSpec::direct(
            "construction_plane_edit_at_angle",
            "Edit plane at angle",
            "Edit a plane-at-angle feature while preserving its feature and datum IDs.",
            "datum_plane_edit",
            Payload::EditDatumSource("at_angle"),
            object_schema(
                json!({
                    "feature_id": {"type": "integer", "minimum": 1},
                    "reference": plane_at_angle["properties"]["reference"].clone(),
                    "body_id": {"type": "integer", "minimum": 1},
                    "edge_id": {"type": "integer", "minimum": 1},
                    "angle_deg": {"type": "number", "minimum": -360, "maximum": 360}
                }),
                &["feature_id", "reference", "body_id", "edge_id", "angle_deg"],
            ),
        ),
        ToolSpec::direct(
            "solid_scene",
            "Inspect solid scene",
            "Return active bodies, stable Body/Face/Edge ids, meshes, and feature errors.",
            "solid_scene",
            Payload::Empty,
            empty_schema(),
        ),
        ToolSpec::direct(
            "solid_tessellate",
            "Tessellate bodies",
            "Tessellate active bodies with configurable deflection and return mesh stats (no file bytes). Use before export to judge triangle density.",
            "solid_tessellate",
            Payload::Object,
            object_schema(
                json!({
                    "body_ids": {
                        "type": "array",
                        "items": {"type": "integer", "minimum": 1}
                    },
                    "linear_deflection": {"type": "number", "exclusiveMinimum": 0, "default": 0.15},
                    "angular_deflection": {"type": "number", "exclusiveMinimum": 0, "default": 0.35}
                }),
                &[],
            ),
        ),
        ToolSpec::direct(
            "solid_extrude_definitions",
            "List Extrude definitions",
            "Return persisted Extrude feature parameters.",
            "extrude_definitions",
            Payload::Empty,
            empty_schema(),
        ),
        ToolSpec::direct(
            "solid_revolve_definitions",
            "List Revolve definitions",
            "Return persisted Revolve feature parameters.",
            "revolve_definitions",
            Payload::Empty,
            empty_schema(),
        ),
        ToolSpec::direct(
            "solid_sweep_definitions",
            "List Sweep definitions",
            "Return persisted Sweep profile and path references.",
            "sweep_definitions",
            Payload::Empty,
            empty_schema(),
        ),
        ToolSpec::direct(
            "solid_loft_definitions",
            "List Loft definitions",
            "Return persisted ordered Loft profile sections.",
            "loft_definitions",
            Payload::Empty,
            empty_schema(),
        ),
        ToolSpec::direct(
            "solid_rib_definitions",
            "List Rib definitions",
            "Return persisted Rib centerline, thickness, and depth parameters.",
            "rib_definitions",
            Payload::Empty,
            empty_schema(),
        ),
        ToolSpec::direct(
            "solid_fillet_definitions",
            "List solid Fillet definitions",
            "Return persisted solid-edge Fillet parameters and stable edge references.",
            "fillet_definitions",
            Payload::Empty,
            empty_schema(),
        ),
        ToolSpec::direct(
            "solid_chamfer_definitions",
            "List solid Chamfer definitions",
            "Return persisted solid-edge Chamfer parameters and stable edge references.",
            "chamfer_definitions",
            Payload::Empty,
            empty_schema(),
        ),
        ToolSpec::direct(
            "solid_hole_definitions",
            "List Hole definitions",
            "Return persisted planar-face Hole parameters and stable face references.",
            "hole_definitions",
            Payload::Empty,
            empty_schema(),
        ),
        ToolSpec::direct(
            "solid_body_feature_definitions",
            "List body-operation definitions",
            "Return persisted Shell, Mirror, Pattern, Combine, and Split Body definitions.",
            "body_feature_definitions",
            Payload::Empty,
            empty_schema(),
        ),
        ToolSpec::solid(
            "solid_extrude",
            "Extrude sketch profiles",
            "Create or boolean Extrude selected closed profiles and fully replay feature history.",
            "solid_prepare_extrude",
            Payload::Object,
            extrude.clone(),
        ),
        ToolSpec::solid(
            "solid_edit_extrude",
            "Edit Extrude feature",
            "Edit one persisted Extrude feature and fully replay downstream history.",
            "solid_prepare_edit_extrude",
            Payload::Object,
            object_schema(
                json!({
                    "feature_id": {"type": "integer", "minimum": 1},
                    "extrude": extrude
                }),
                &["feature_id", "extrude"],
            ),
        ),
        ToolSpec::solid(
            "solid_revolve",
            "Revolve sketch profiles",
            "Create or boolean solids by revolving selected profiles around a manual or stable sketch-line axis.",
            "solid_prepare_revolve",
            Payload::Object,
            revolve.clone(),
        ),
        ToolSpec::solid(
            "solid_edit_revolve",
            "Edit Revolve feature",
            "Edit one persisted Revolve feature and fully replay downstream history.",
            "solid_prepare_edit_revolve",
            Payload::Object,
            object_schema(
                json!({
                    "feature_id": {"type": "integer", "minimum": 1},
                    "revolve": revolve
                }),
                &["feature_id", "revolve"],
            ),
        ),
        ToolSpec::solid(
            "solid_sweep",
            "Sweep a sketch profile",
            "Sweep one closed profile along an ordered connected line, arc, circle, or spline path, with orientation, corner-transition, C1, and guide-rail controls.",
            "solid_prepare_sweep",
            Payload::Object,
            sweep.clone(),
        ),
        ToolSpec::solid(
            "solid_edit_sweep",
            "Edit Sweep feature",
            "Edit a persisted Sweep and fully replay downstream history.",
            "solid_prepare_edit_sweep",
            Payload::Object,
            object_schema(json!({"feature_id": {"type": "integer", "minimum": 1}, "sweep": sweep}), &["feature_id", "sweep"]),
        ),
        ToolSpec::solid(
            "solid_loft",
            "Loft sketch profiles",
            "Create a solid through two or more ordered closed profile sections with G0/G1/G2 continuity and optional centerline or guide rail.",
            "solid_prepare_loft",
            Payload::Object,
            loft.clone(),
        ),
        ToolSpec::solid(
            "solid_edit_loft",
            "Edit Loft feature",
            "Edit a persisted Loft and fully replay downstream history.",
            "solid_prepare_edit_loft",
            Payload::Object,
            object_schema(json!({"feature_id": {"type": "integer", "minimum": 1}, "loft": loft}), &["feature_id", "loft"]),
        ),
        ToolSpec::solid(
            "solid_rib",
            "Create Rib from sketch curves",
            "Create thin solids from stable line, arc, circle, or spline centerlines using Distance, To Next, Up to Face, or Through All extents.",
            "solid_prepare_rib",
            Payload::Object,
            rib.clone(),
        ),
        ToolSpec::solid(
            "solid_edit_rib",
            "Edit Rib feature",
            "Edit a persisted Rib and fully replay downstream history.",
            "solid_prepare_edit_rib",
            Payload::Object,
            object_schema(json!({"feature_id": {"type": "integer", "minimum": 1}, "rib": rib}), &["feature_id", "rib"]),
        ),
        ToolSpec::solid(
            "solid_fillet",
            "Fillet solid edges",
            "Round one or more stable solid edges and replay downstream feature history.",
            "solid_prepare_fillet",
            Payload::Object,
            solid_fillet.clone(),
        ),
        ToolSpec::solid(
            "solid_edit_fillet",
            "Edit solid Fillet feature",
            "Edit a persisted solid Fillet and fully replay downstream history.",
            "solid_prepare_edit_fillet",
            Payload::Object,
            object_schema(
                json!({
                    "feature_id": {"type": "integer", "minimum": 1},
                    "fillet": solid_fillet
                }),
                &["feature_id", "fillet"],
            ),
        ),
        ToolSpec::solid(
            "solid_chamfer",
            "Chamfer solid edges",
            "Bevel one or more stable solid edges and replay downstream feature history.",
            "solid_prepare_chamfer",
            Payload::Object,
            solid_chamfer.clone(),
        ),
        ToolSpec::solid(
            "solid_edit_chamfer",
            "Edit solid Chamfer feature",
            "Edit a persisted solid Chamfer and fully replay downstream history.",
            "solid_prepare_edit_chamfer",
            Payload::Object,
            object_schema(
                json!({
                    "feature_id": {"type": "integer", "minimum": 1},
                    "chamfer": solid_chamfer
                }),
                &["feature_id", "chamfer"],
            ),
        ),
        ToolSpec::solid(
            "solid_hole",
            "Create Hole on planar face",
            "Cut one or more simple, counterbored, countersunk, or ISO/Unified threaded holes with flat or angled drill-point bottoms from a stable planar face.",
            "solid_prepare_hole",
            Payload::Object,
            hole.clone(),
        ),
        ToolSpec::solid(
            "solid_edit_hole",
            "Edit Hole feature",
            "Edit a persisted Hole and fully replay downstream history.",
            "solid_prepare_edit_hole",
            Payload::Object,
            object_schema(
                json!({
                    "feature_id": {"type": "integer", "minimum": 1},
                    "hole": hole
                }),
                &["feature_id", "hole"],
            ),
        ),
        ToolSpec::solid(
            "solid_shell",
            "Shell body",
            "Remove selected stable faces and offset the remaining body walls to create a hollow solid.",
            "solid_prepare_body_feature",
            Payload::BodyFeature("shell"),
            shell.clone(),
        ),
        ToolSpec::solid(
            "solid_edit_shell",
            "Edit Shell feature",
            "Edit a persisted Shell and fully replay downstream history.",
            "solid_prepare_edit_body_feature",
            Payload::EditBodyFeature("shell"),
            object_schema(
                json!({
                    "feature_id": {"type": "integer", "minimum": 1},
                    "request": shell
                }),
                &["feature_id", "request"],
            ),
        ),
        ToolSpec::solid(
            "solid_mirror",
            "Mirror bodies",
            "Create mirrored copies of one or more bodies around an origin, face, or construction plane.",
            "solid_prepare_body_feature",
            Payload::BodyFeature("mirror"),
            solid_mirror.clone(),
        ),
        ToolSpec::solid(
            "solid_edit_mirror",
            "Edit Mirror feature",
            "Edit a persisted body Mirror and fully replay downstream history.",
            "solid_prepare_edit_body_feature",
            Payload::EditBodyFeature("mirror"),
            object_schema(
                json!({
                    "feature_id": {"type": "integer", "minimum": 1},
                    "request": solid_mirror
                }),
                &["feature_id", "request"],
            ),
        ),
        ToolSpec::solid(
            "solid_rectangular_pattern",
            "Rectangular body pattern",
            "Copy bodies along one or two linear directions with stable pattern history.",
            "solid_prepare_body_feature",
            Payload::BodyFeature("rectangular_pattern"),
            rectangular_pattern.clone(),
        ),
        ToolSpec::solid(
            "solid_edit_rectangular_pattern",
            "Edit rectangular body pattern",
            "Edit a persisted Rectangular Pattern and fully replay downstream history.",
            "solid_prepare_edit_body_feature",
            Payload::EditBodyFeature("rectangular_pattern"),
            object_schema(
                json!({
                    "feature_id": {"type": "integer", "minimum": 1},
                    "request": rectangular_pattern
                }),
                &["feature_id", "request"],
            ),
        ),
        ToolSpec::solid(
            "solid_circular_pattern",
            "Circular body pattern",
            "Copy bodies around a world-space axis through a partial or full angle.",
            "solid_prepare_body_feature",
            Payload::BodyFeature("circular_pattern"),
            circular_pattern.clone(),
        ),
        ToolSpec::solid(
            "solid_edit_circular_pattern",
            "Edit circular body pattern",
            "Edit a persisted Circular Pattern and fully replay downstream history.",
            "solid_prepare_edit_body_feature",
            Payload::EditBodyFeature("circular_pattern"),
            object_schema(
                json!({
                    "feature_id": {"type": "integer", "minimum": 1},
                    "request": circular_pattern
                }),
                &["feature_id", "request"],
            ),
        ),
        ToolSpec::solid(
            "solid_combine",
            "Combine bodies",
            "Join, cut, or intersect a target body with one or more tool bodies.",
            "solid_prepare_body_feature",
            Payload::BodyFeature("combine"),
            combine.clone(),
        ),
        ToolSpec::solid(
            "solid_edit_combine",
            "Edit Combine feature",
            "Edit a persisted Combine and fully replay downstream history.",
            "solid_prepare_edit_body_feature",
            Payload::EditBodyFeature("combine"),
            object_schema(
                json!({
                    "feature_id": {"type": "integer", "minimum": 1},
                    "request": combine
                }),
                &["feature_id", "request"],
            ),
        ),
        ToolSpec::solid(
            "solid_split_body",
            "Split body",
            "Split a body into two stable bodies using an origin, planar-face, or construction plane.",
            "solid_prepare_body_feature",
            Payload::BodyFeature("split_body"),
            split_body.clone(),
        ),
        ToolSpec::solid(
            "solid_edit_split_body",
            "Edit Split Body feature",
            "Edit a persisted Split Body and fully replay downstream history.",
            "solid_prepare_edit_body_feature",
            Payload::EditBodyFeature("split_body"),
            object_schema(
                json!({
                    "feature_id": {"type": "integer", "minimum": 1},
                    "request": split_body
                }),
                &["feature_id", "request"],
            ),
        ),
        ToolSpec::solid(
            "solid_recompute",
            "Recompute solids",
            "Fully replay active solid feature history through native OCCT.",
            "solid_prepare_recompute",
            Payload::Empty,
            empty_schema(),
        ),
        ToolSpec::solid(
            "solid_set_rollback",
            "Move rollback marker",
            "Set the active feature count and recompute the resulting bodies.",
            "solid_prepare_set_rollback",
            Payload::Object,
            object_schema(
                json!({"rollback_index": {"type": "integer", "minimum": 0}}),
                &["rollback_index"],
            ),
        ),
        ToolSpec::solid(
            "solid_delete_feature",
            "Delete history feature",
            "Delete one history feature and recompute later features, preserving explicit broken-reference errors.",
            "solid_prepare_delete_feature",
            Payload::Object,
            object_schema(
                json!({"feature_id": {"type": "integer", "minimum": 1}}),
                &["feature_id"],
            ),
        ),
        ToolSpec::solid(
            "solid_reorder_feature",
            "Reorder history feature",
            "Move a feature to a timeline insertion slot and recompute. Dependency-breaking moves are rejected.",
            "solid_prepare_reorder_feature",
            Payload::Object,
            object_schema(
                json!({
                    "feature_id": {"type": "integer", "minimum": 1},
                    "target_index": {"type": "integer", "minimum": 0}
                }),
                &["feature_id", "target_index"],
            ),
        ),
        ToolSpec::direct(
            "solid_export_step",
            "Export STEP",
            "Export selected or all active bodies as AP242 STEP bytes encoded in base64. Prefer solid_export_3mf for slicers.",
            "solid_export_step",
            Payload::Object,
            object_schema(
                json!({
                    "body_ids": {
                        "type": "array",
                        "items": {"type": "integer", "minimum": 1},
                        "uniqueItems": true
                    },
                    "thread_metadata": {
                        "type": "array",
                        "items": {"type": "object", "additionalProperties": true}
                    }
                }),
                &[],
            ),
        ),
        ToolSpec::direct(
            "solid_export_stl",
            "Export STL",
            "Tessellate active bodies and return binary STL (millimetres) as base64. Appearance is not included.",
            "solid_export_stl",
            Payload::Object,
            object_schema(
                json!({
                    "body_ids": {
                        "type": "array",
                        "items": {"type": "integer", "minimum": 1},
                        "description": "Empty exports every active body."
                    },
                    "linear_deflection": {"type": "number", "exclusiveMinimum": 0, "default": 0.15},
                    "angular_deflection": {"type": "number", "exclusiveMinimum": 0, "default": 0.35}
                }),
                &[],
            ),
        ),
        ToolSpec::direct(
            "solid_export_3mf",
            "Export 3MF",
            "Tessellate active bodies into a standard 3MF (mm, basematerials) with optional slicer Metadata (Bambu/Orca/Prusa/Cura). Preferred print handoff vs STEP.",
            "solid_export_3mf",
            Payload::Object,
            object_schema(
                json!({
                    "body_ids": {
                        "type": "array",
                        "items": {"type": "integer", "minimum": 1},
                        "description": "Empty exports every active body."
                    },
                    "linear_deflection": {"type": "number", "exclusiveMinimum": 0, "default": 0.15},
                    "angular_deflection": {"type": "number", "exclusiveMinimum": 0, "default": 0.35},
                    "include_appearance": {"type": "boolean", "default": true},
                    "slicer_target": {
                        "type": "string",
                        "enum": ["standard", "bambu_studio", "orca_slicer", "prusa_slicer", "cura"],
                        "default": "bambu_studio",
                        "description": "Embed slicer-compatible Metadata plus consortium basematerials."
                    }
                }),
                &[],
            ),
        ),
        ToolSpec::direct(
            "material_catalog",
            "Material catalog",
            "Return built-in filament presets (Generic, Bambu Lab, Prusa, Polymaker, Hatchbox, Overture, Elegoo, Creality, Sunlu, eSun, Anycubic).",
            "material_catalog",
            Payload::Empty,
            empty_schema(),
        ),
        ToolSpec::direct(
            "body_appearances",
            "List body appearances",
            "Return per-body color/filament assignments used by 3MF export and the viewport.",
            "body_appearances",
            Payload::Empty,
            empty_schema(),
        ),
        ToolSpec::direct(
            "set_body_appearance",
            "Set body appearance",
            "Assign filament/color to a body. Prefer body_id + preset_id from material_catalog; or pass a full BodyAppearance object.",
            "set_body_appearance",
            Payload::Object,
            object_schema(
                json!({
                    "body_id": {
                        "type": "integer",
                        "minimum": 1,
                        "description": "Target body id from solid_scene."
                    },
                    "preset_id": {
                        "type": "string",
                        "description": "Catalog preset id (e.g. bambu.pla.basic.red). When set, other fields are filled from the catalog."
                    },
                    "color": {
                        "type": "object",
                        "properties": {
                            "r": {"type": "integer", "minimum": 0, "maximum": 255},
                            "g": {"type": "integer", "minimum": 0, "maximum": 255},
                            "b": {"type": "integer", "minimum": 0, "maximum": 255},
                            "a": {"type": "integer", "minimum": 0, "maximum": 255}
                        }
                    },
                    "material_name": {"type": "string"},
                    "filament_type": {"type": "string"},
                    "brand": {"type": "string"},
                    "color_name": {"type": "string"},
                    "filament_id": {"type": ["string", "null"]},
                    "density_g_cm3": {"type": ["number", "null"]},
                    "diameter_mm": {"type": "number", "exclusiveMinimum": 0}
                }),
                &["body_id"],
            ),
        ),
        ToolSpec::direct(
            "solid_export_preflight",
            "Export preflight",
            "Check timeline errors, active bodies, and appearance coverage before mesh/STEP export.",
            "solid_export_preflight",
            Payload::Empty,
            empty_schema(),
        ),
        ToolSpec::direct(
            "demo_export_pip_3mf",
            "Export PIP demo 3MF",
            "Return a built-in print-in-place demo as base64 3MF (AABB clearance smoke ≥ 0.4 mm). Does not mutate the document. kind=cam_bolt (default, 4-body wedge+dial) or clip (3-body drawer).",
            "demo_export_pip_3mf",
            Payload::Object,
            object_schema(
                json!({
                    "kind": {
                        "type": "string",
                        "enum": ["cam_bolt", "clip"],
                        "default": "cam_bolt"
                    },
                    "slicer_target": {
                        "type": "string",
                        "enum": ["standard", "bambu_studio", "orca_slicer", "prusa_slicer", "cura"],
                        "default": "bambu_studio"
                    }
                }),
                &[],
            ),
        ),
        ToolSpec::control(
            "cad_get_focus",
            "Get focus state",
            "Return the active focus pack, soft packs, TTLs, and disclosure mode.",
            empty_schema(),
        ),
        ToolSpec::control(
            "cad_set_focus",
            "Set focus",
            "Set the active modeling focus pack and schedule a throttled tools/list_changed notification.",
            object_schema(
                json!({
                    "focus": {
                        "type": "string",
                        "enum": ["document", "sketch", "solid", "modify", "body_ops", "datums", "history", "inspect", "print"]
                    },
                    "explicit": {
                        "type": "boolean",
                        "description": "When true, auto-focus hints are ignored until cleared."
                    }
                }),
                &["focus"],
            ),
        ),
        ToolSpec::control(
            "cad_list_focus_areas",
            "List focus areas",
            "Return the supported focus packs and human-readable descriptions.",
            empty_schema(),
        ),
        ToolSpec::control(
            "cad_get_tool_disclosure_mode",
            "Get disclosure mode",
            "Return the current tool disclosure mode: dynamic or full_static.",
            empty_schema(),
        ),
        ToolSpec::control(
            "cad_set_tool_disclosure_mode",
            "Set disclosure mode",
            "Switch between dynamic focus-scoped advertisement and the full_static escape hatch.",
            object_schema(
                json!({
                    "mode": {
                        "type": "string",
                        "enum": ["dynamic", "full_static"]
                    }
                }),
                &["mode"],
            ),
        ),
        ToolSpec::control(
            "cad_list_all_tools",
            "List full tool catalog",
            "Return every registered tool with schemas and focus tags without changing advertisement.",
            empty_schema(),
        ),
        ToolSpec::control(
            "cad_cancel_recompute",
            "Cancel solid recompute",
            "Abort an in-flight solid replay if one is pending in this MCP process.",
            empty_schema(),
        ),
        ToolSpec::control(
            "cad_list_sessions",
            "List read-only session snapshots",
            "List UUID v4 session directories under NBCAD_SESSION_DIR (skips _* control dirs and non-UUID names). Includes heartbeat age/stale metadata. Use with cad_attach. Snapshot bridge — not a live UI co-link.",
            empty_schema(),
        ),
        ToolSpec::control(
            "cad_attach",
            "Attach read-only session snapshot",
            "Require UUID v4 session_id and valid model.json; load into this MCP process; optional focus.json. Fails if the id/model is missing or invalid. Never writes back to the session dir.",
            object_schema(
                json!({
                    "session_id": {
                        "type": "string",
                        "minLength": 36,
                        "maxLength": 36,
                        "description": "UUID v4 session directory name"
                    }
                }),
                &["session_id"],
            ),
        ),
        ToolSpec::control(
            "cad_refresh",
            "Refresh attached session snapshot",
            "Re-read model.json (and optional focus.json) for the currently attached session. Explicit refresh — MCP does not watch the filesystem.",
            empty_schema(),
        ),
        ToolSpec::control(
            "cad_detach",
            "Detach session snapshot",
            "Clear the attached session id. Leaves the in-memory document as last loaded; does not delete session files.",
            empty_schema(),
        ),
    ];
    for tool in &mut tools {
        let (pack, spine) = tags_for_tool(tool.name);
        tool.pack = pack;
        tool.spine = spine;
    }
    tools
}

fn tool_list_result(disclosure: &mut DisclosureState) -> Value {
    disclosure.tick_soft_expiry();
    Value::Object(Map::from_iter([(
        "tools".to_string(),
        Value::Array(
            tool_specs()
                .iter()
                .filter(|tool| disclosure.is_advertised(tool.name, tool.pack, tool.spine))
                .map(tool_entry)
                .collect(),
        ),
    )]))
}

fn success_result(value: Value) -> Value {
    let structured = if value.is_object() {
        value.clone()
    } else {
        json!({ "value": value.clone() })
    };
    json!({
        "content": [{
            "type": "text",
            "text": serde_json::to_string_pretty(&value).unwrap_or_else(|_| value.to_string())
        }],
        "structuredContent": structured,
        "isError": false
    })
}

fn tool_error(message: String) -> Value {
    json!({
        "content": [{ "type": "text", "text": message }],
        "isError": true
    })
}

fn response(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn error_response(id: Value, code: i64, message: impl Into<String>) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": { "code": code, "message": message.into() }
    })
}

fn handle_message(server: &mut CadServer, message: Value) -> Vec<Value> {
    let Some(method) = message.get("method").and_then(Value::as_str) else {
        return Vec::new();
    };
    let id = message.get("id").cloned();
    let mut responses = match method {
        "initialize" => {
            let requested = message
                .pointer("/params/protocolVersion")
                .and_then(Value::as_str)
                .unwrap_or(LATEST_PROTOCOL);
            let protocol = match requested {
                "2024-11-05" | "2025-03-26" | "2025-06-18" => requested,
                _ => LATEST_PROTOCOL,
            };
            vec![response(
                id.unwrap_or(Value::Null),
                json!({
                    "protocolVersion": protocol,
                    "capabilities": { "tools": { "listChanged": true } },
                    "serverInfo": {
                        "name": "nbcad",
                        "title": "noBS CAD",
                        "version": env!("CARGO_PKG_VERSION")
                    },
                    "instructions": "This is one persistent headless CAD document. Begin and finish sketches before creating solid features. Use returned stable entity/body/face/edge ids in later calls. Dynamic tool disclosure is enabled; out-of-focus tools remain callable."
                }),
            )]
        }
        "notifications/initialized" | "notifications/cancelled" => Vec::new(),
        "ping" => id.map(|id| response(id, json!({}))).into_iter().collect(),
        "tools/list" => vec![response(
            id.unwrap_or(Value::Null),
            tool_list_result(&mut server.disclosure),
        )],
        "tools/call" => {
            let id = id.unwrap_or(Value::Null);
            let Some(name) = message.pointer("/params/name").and_then(Value::as_str) else {
                return vec![error_response(
                    id,
                    -32602,
                    "tools/call is missing params.name",
                )];
            };
            let arguments = message
                .pointer("/params/arguments")
                .cloned()
                .unwrap_or_else(|| json!({}));
            if !tool_specs().iter().any(|tool| tool.name == name) {
                return vec![error_response(id, -32602, format!("unknown tool: {name}"))];
            }
            let result = match server.call_tool(name, arguments) {
                Ok(value) => success_result(value),
                Err(error) => tool_error(error),
            };
            vec![response(id, result)]
        }
        _ if id.is_none() => Vec::new(),
        _ => vec![error_response(
            id.unwrap_or(Value::Null),
            -32601,
            format!("method not found: {method}"),
        )],
    };
    if let Some(notification) = server.disclosure.take_notify_if_due() {
        responses.push(notification);
    }
    responses
}

/// Emit due soft-TTL / list_changed notifications without waiting for another
/// client RPC. Used by the stdin+timeout worker (Jack §2) and by unit tests.
fn idle_due_messages(server: &mut CadServer) -> Vec<Value> {
    server.disclosure.tick_soft_expiry();
    let mut outgoing = Vec::new();
    if let Some(notification) = server.disclosure.take_notify_if_due() {
        outgoing.push(notification);
    }
    outgoing
}

fn write_jsonrpc_messages(stdout: &mut impl Write, messages: &[Value]) -> bool {
    for message in messages {
        if serde_json::to_writer(&mut *stdout, message).is_err()
            || writeln!(stdout).is_err()
            || stdout.flush().is_err()
        {
            return false;
        }
    }
    true
}

enum StdinEvent {
    Line(String),
    Eof,
}

fn main() {
    let mut server = match CadServer::new() {
        Ok(server) => server,
        Err(error) => {
            eprintln!("noBS CAD MCP startup failed: {error}");
            std::process::exit(1);
        }
    };

    // Jack §2: do not block forever on stdin. A reader thread feeds lines;
    // the main loop wakes on the next disclosure deadline so list_changed /
    // soft-TTL can flush with no later client ping.
    let (tx, rx) = mpsc::channel::<StdinEvent>();
    thread::spawn(move || {
        let stdin = io::stdin();
        for line in stdin.lock().lines() {
            match line {
                Ok(line) => {
                    if tx.send(StdinEvent::Line(line)).is_err() {
                        return;
                    }
                }
                Err(_) => break,
            }
        }
        let _ = tx.send(StdinEvent::Eof);
    });

    let mut stdout = io::stdout().lock();
    loop {
        let due = idle_due_messages(&mut server);
        if !due.is_empty() {
            if !write_jsonrpc_messages(&mut stdout, &due) {
                break;
            }
            continue;
        }

        let event = match server.disclosure.ms_until_wake() {
            Some(ms) => match rx.recv_timeout(Duration::from_millis(ms.max(1))) {
                Ok(event) => event,
                Err(RecvTimeoutError::Timeout) => {
                    let due = idle_due_messages(&mut server);
                    if !write_jsonrpc_messages(&mut stdout, &due) {
                        break;
                    }
                    continue;
                }
                Err(RecvTimeoutError::Disconnected) => break,
            },
            None => match rx.recv() {
                Ok(event) => event,
                Err(_) => break,
            },
        };

        match event {
            StdinEvent::Eof => break,
            StdinEvent::Line(line) => {
                if line.trim().is_empty() {
                    continue;
                }
                let outgoing = match serde_json::from_str::<Value>(&line) {
                    Ok(message) => handle_message(&mut server, message),
                    Err(error) => vec![error_response(
                        Value::Null,
                        -32700,
                        format!("parse error: {error}"),
                    )],
                };
                if !write_jsonrpc_messages(&mut stdout, &outgoing) {
                    break;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mcp_box() -> (CadServer, Value) {
        let mut server = CadServer::new().unwrap();
        server
            .call_tool(
                "sketch_begin",
                json!({"plane": {"type": "origin_plane", "plane": "xy"}}),
            )
            .unwrap();
        server
            .call_tool(
                "sketch_add_rectangle",
                json!({
                    "mode": "two_point",
                    "p1": {"x": -10.0, "y": -10.0},
                    "p2": {"x": 10.0, "y": 10.0},
                    "ctrl_held": false
                }),
            )
            .unwrap();
        server.call_tool("sketch_finish", json!({})).unwrap();
        let update = server
            .call_tool(
                "solid_extrude",
                json!({
                    "sketch_name": "Sketch1",
                    "profile_indices": [0],
                    "operation": "new_body",
                    "extent": {"type": "distance", "distance": 10.0},
                    "taper_angle_deg": 0.0,
                    "flip": false,
                    "target_body_ids": []
                }),
            )
            .unwrap();
        (server, update)
    }

    #[test]
    fn tool_registry_is_granular_and_protocol_lists_revolve() {
        let catalog = full_tool_catalog();
        let all_tools = catalog.as_array().unwrap();
        assert_eq!(
            all_tools.len(),
            MODELING_TOOL_COUNT + 19,
            "105 modeling tools plus 8 print helpers and 11 control tools"
        );
        let modeling_count = all_tools
            .iter()
            .filter(|tool| {
                !matches!(
                    tool["name"].as_str(),
                    Some(
                        "solid_export_step"
                            | "solid_export_stl"
                            | "solid_export_3mf"
                            | "solid_export_preflight"
                            | "material_catalog"
                            | "body_appearances"
                            | "set_body_appearance"
                            | "demo_export_pip_3mf"
                            | "cad_get_focus"
                            | "cad_set_focus"
                            | "cad_list_focus_areas"
                            | "cad_get_tool_disclosure_mode"
                            | "cad_set_tool_disclosure_mode"
                            | "cad_list_all_tools"
                            | "cad_cancel_recompute"
                            | "cad_list_sessions"
                            | "cad_attach"
                            | "cad_refresh"
                            | "cad_detach"
                    )
                )
            })
            .count();
        assert_eq!(modeling_count, MODELING_TOOL_COUNT);

        let mut server = CadServer::new().unwrap();
        let listed = tool_list_result(&mut server.disclosure);
        let tools = listed["tools"].as_array().unwrap();
        assert!(tools.len() < all_tools.len());
        assert!(tools.iter().any(|tool| tool["name"] == "cad_document"));
        assert!(tools.iter().any(|tool| tool["name"] == "cad_get_focus"));

        let initialized = handle_message(
            &mut server,
            json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": { "protocolVersion": "2025-06-18" }
            }),
        )
        .pop()
        .unwrap();
        assert_eq!(initialized["result"]["protocolVersion"], LATEST_PROTOCOL);
        assert_eq!(
            initialized["result"]["capabilities"]["tools"]["listChanged"],
            true
        );
    }

    #[test]
    fn focus_pack_matrix_covers_modeling_registry() {
        let mut packs = std::collections::BTreeMap::<&str, usize>::new();
        for tool in tool_specs() {
            if matches!(
                tool.name,
                "solid_export_step"
                    | "solid_export_stl"
                    | "solid_export_3mf"
                    | "solid_export_preflight"
                    | "material_catalog"
                    | "body_appearances"
                    | "set_body_appearance"
                    | "demo_export_pip_3mf"
                    | "cad_get_focus"
                    | "cad_set_focus"
                    | "cad_list_focus_areas"
                    | "cad_get_tool_disclosure_mode"
                    | "cad_set_tool_disclosure_mode"
                    | "cad_list_all_tools"
                    | "cad_cancel_recompute"
                    | "cad_list_sessions"
                    | "cad_attach"
                    | "cad_refresh"
                    | "cad_detach"
            ) {
                continue;
            }
            *packs.entry(tool.pack.as_str()).or_default() += 1;
        }
        assert_eq!(packs.values().sum::<usize>(), MODELING_TOOL_COUNT);
        // Modeling registry covers 8 packs; print helpers are outside MODELING_TOOL_COUNT.
        assert_eq!(packs.len(), FocusPack::ALL.len() - 1);
        assert_eq!(packs["document"], 5);
        assert_eq!(packs["sketch"], 50);
        assert_eq!(packs["solid"], 10);
        assert!(packs["modify"] >= 6);
        assert!(packs["body_ops"] >= 10);
        assert!(packs["datums"] >= 6);
        assert!(packs["history"] >= 3);
        assert_eq!(packs["inspect"], 12);
        assert!(!packs.contains_key("print"));
    }

    #[test]
    fn dynamic_disclosure_lists_active_and_soft_tools() {
        DisclosureState::set_clock_for_test(0);
        let mut server = CadServer::new().unwrap();
        server
            .call_tool(
                "cad_set_focus",
                json!({"focus": "sketch", "explicit": true}),
            )
            .unwrap();
        let mut listed = tool_list_result(&mut server.disclosure);
        let names: Vec<_> = listed["tools"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|tool| tool["name"].as_str())
            .collect();
        assert!(names.iter().any(|name| name.starts_with("sketch_")));
        assert!(!names.iter().any(|name| *name == "solid_extrude"));

        server
            .call_tool("cad_set_focus", json!({"focus": "solid", "explicit": true}))
            .unwrap();
        listed = tool_list_result(&mut server.disclosure);
        let names: Vec<_> = listed["tools"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|tool| tool["name"].as_str())
            .collect();
        assert!(names.iter().any(|name| *name == "solid_extrude"));
    }

    #[test]
    fn soft_hidden_tools_remain_callable() {
        DisclosureState::set_clock_for_test(0);
        let mut server = CadServer::new().unwrap();
        server
            .call_tool(
                "cad_set_focus",
                json!({"focus": "document", "explicit": true}),
            )
            .unwrap();
        DisclosureState::advance_for_test(
            disclosure::SOFT_TTL_MS + disclosure::FOCUS_THROTTLE_MS + 1,
        );
        server.disclosure.tick_soft_expiry();
        let listed = tool_list_result(&mut server.disclosure);
        let names: Vec<_> = listed["tools"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|tool| tool["name"].as_str())
            .collect();
        assert!(!names.iter().any(|name| *name == "sketch_begin"));
        let result = server
            .call_tool(
                "sketch_begin",
                json!({"plane": {"type": "origin_plane", "plane": "xy"}}),
            )
            .unwrap();
        // Hidden side-call re-promotes the pack (steerability); still no hard jail.
        assert_eq!(result["_disclosure"]["state"], "soft");
        let listed_after = tool_list_result(&mut server.disclosure);
        assert!(listed_after["tools"]
            .as_array()
            .unwrap()
            .iter()
            .any(|tool| tool["name"] == "sketch_begin"));
    }

    #[test]
    fn full_static_lists_entire_registry() {
        let mut server = CadServer::new().unwrap();
        server
            .call_tool(
                "cad_set_tool_disclosure_mode",
                json!({"mode": "full_static"}),
            )
            .unwrap();
        let listed = tool_list_result(&mut server.disclosure);
        let catalog = full_tool_catalog();
        assert_eq!(
            listed["tools"].as_array().unwrap().len(),
            catalog.as_array().unwrap().len()
        );
    }

    #[test]
    fn every_focus_pack_lists_representative_tools() {
        let expectations: &[(&str, &str)] = &[
            ("document", "cad_project_model"),
            ("sketch", "sketch_begin"),
            ("solid", "solid_extrude"),
            ("modify", "solid_fillet"),
            ("body_ops", "solid_shell"),
            ("datums", "construction_plane_offset"),
            ("history", "solid_delete_feature"),
            ("inspect", "solid_scene"),
            ("print", "solid_export_3mf"),
        ];
        for (focus, tool_name) in expectations {
            let mut server = CadServer::new().unwrap();
            server
                .call_tool("cad_set_focus", json!({ "focus": focus, "explicit": true }))
                .unwrap();
            let listed = tool_list_result(&mut server.disclosure);
            let names: Vec<_> = listed["tools"]
                .as_array()
                .unwrap()
                .iter()
                .filter_map(|tool| tool["name"].as_str())
                .collect();
            assert!(
                names.iter().any(|name| name == tool_name),
                "focus '{focus}' should advertise '{tool_name}'"
            );
            assert!(
                names.iter().any(|name| *name == "cad_get_focus"),
                "spine control tools must remain advertised under '{focus}'"
            );
        }
    }

    #[test]
    fn focus_change_emits_list_changed_without_later_rpc() {
        DisclosureState::set_clock_for_test(0);
        let mut server = CadServer::new().unwrap();
        let responses = handle_message(
            &mut server,
            json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {
                    "name": "cad_set_focus",
                    "arguments": {"focus": "sketch", "explicit": true}
                }
            }),
        );
        assert!(
            responses.iter().all(|message| {
                message.get("method").and_then(Value::as_str)
                    != Some("notifications/tools/list_changed")
            }),
            "throttled notify must not flush on the focus-changing response itself"
        );
        assert!(
            server.disclosure.ms_until_wake().is_some(),
            "focus change must schedule a wake for the notify worker"
        );
        DisclosureState::advance_for_test(disclosure::FOCUS_THROTTLE_MS);
        let idle = idle_due_messages(&mut server);
        assert!(
            idle.iter().any(|message| {
                message.get("method").and_then(Value::as_str)
                    == Some("notifications/tools/list_changed")
            }),
            "notify worker must emit list_changed after throttle without a later ping/RPC"
        );
    }

    #[test]
    fn soft_ttl_expiry_emits_list_changed_without_later_rpc() {
        DisclosureState::set_clock_for_test(0);
        let mut server = CadServer::new().unwrap();
        let _ = handle_message(
            &mut server,
            json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {
                    "name": "cad_set_focus",
                    "arguments": {"focus": "sketch", "explicit": true}
                }
            }),
        );
        let _ = handle_message(
            &mut server,
            json!({
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {
                    "name": "cad_set_focus",
                    "arguments": {"focus": "solid", "explicit": true}
                }
            }),
        );
        // Clear the focus-change notify so only soft-TTL expiry remains under test.
        DisclosureState::advance_for_test(disclosure::FOCUS_THROTTLE_MS);
        let _ = idle_due_messages(&mut server);

        DisclosureState::advance_for_test(disclosure::SOFT_TTL_MS + 1);
        let after_expiry = idle_due_messages(&mut server);
        // Expiry schedules a throttled notify; may or may not be due in the same tick.
        if after_expiry.iter().any(|message| {
            message.get("method").and_then(Value::as_str)
                == Some("notifications/tools/list_changed")
        }) {
            return;
        }
        DisclosureState::advance_for_test(disclosure::FOCUS_THROTTLE_MS);
        let idle = idle_due_messages(&mut server);
        assert!(
            idle.iter().any(|message| {
                message.get("method").and_then(Value::as_str)
                    == Some("notifications/tools/list_changed")
            }),
            "soft-TTL expiry must emit list_changed via the notify worker without a later RPC"
        );
    }

    #[test]
    fn read_only_snapshot_attach_refresh_detach() {
        let _guard = session::ENV_LOCK.lock().unwrap();
        let unique = session::test_session_uuid();
        let dir = std::env::temp_dir().join(format!("nbcad-sessions-attach-{unique}"));
        std::env::set_var("NBCAD_SESSION_DIR", &dir);
        let (mut donor, _) = mcp_box();
        let model = donor.call_tool("cad_project_model", json!({})).unwrap();
        let model_json = model
            .as_str()
            .map(|s| s.to_string())
            .unwrap_or_else(|| serde_json::to_string(&model).unwrap());
        session::write_session(&unique, "model.json", &model_json).unwrap();
        session::write_session(&unique, "focus.json", "{\"focus\":\"solid\"}").unwrap();
        session::write_session(
            &unique,
            "heartbeat.json",
            &format!(
                r#"{{"updated_ms":{},"generation":1,"session_id":"{unique}"}}"#,
                session::now_ms()
            ),
        )
        .unwrap();

        let mut server = CadServer::new().unwrap();
        // Document-name ids are rejected (UUID v4 required).
        assert!(server
            .call_tool("cad_attach", json!({"session_id": "My Document"}))
            .is_err());
        // Missing model must refuse attach (and leave nothing attached).
        let missing = format!("00000000-0000-4000-8000-{:012x}", session::now_ms().wrapping_add(1) & 0xffffffffffff);
        std::fs::create_dir_all(dir.join(&missing)).unwrap();
        assert!(server
            .call_tool("cad_attach", json!({"session_id": missing}))
            .is_err());
        assert!(server.attached_document_id.is_none());

        let listed = server.call_tool("cad_list_sessions", json!({})).unwrap();
        assert_eq!(listed["sessions"][0], unique);
        assert_eq!(listed["session_details"][0]["heartbeat"]["stale"], false);

        let attached = server
            .call_tool("cad_attach", json!({"session_id": unique}))
            .unwrap();
        assert_eq!(attached["attached"], true);
        assert_eq!(attached["session_mode"], "read_only_snapshot");
        assert_eq!(attached["writeback"], false);
        assert_eq!(
            server.attached_document_id.as_deref(),
            Some(unique.as_str())
        );
        let scene = server.call_tool("solid_scene", json!({})).unwrap();
        assert!(!scene["bodies"].as_array().unwrap().is_empty());

        let refreshed = server.call_tool("cad_refresh", json!({})).unwrap();
        assert_eq!(refreshed["refreshed"], true);
        assert_eq!(refreshed["session_id"], unique);

        let detached = server.call_tool("cad_detach", json!({})).unwrap();
        assert_eq!(detached["detached"], true);
        assert!(server.attached_document_id.is_none());
        assert!(server.call_tool("cad_refresh", json!({})).is_err());

        std::env::remove_var("NBCAD_SESSION_DIR");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn solid_export_3mf_returns_base64_payload() {
        let (mut server, _) = mcp_box();
        let exported = server
            .call_tool("solid_export_3mf", json!({"slicer_target": "bambu_studio"}))
            .expect("3MF export should succeed for a simple box");
        assert_eq!(exported["format"], "3mf");
        assert_eq!(exported["encoding"], "base64");
        let b64 = exported["bytes_base64"].as_str().expect("base64 payload");
        assert!(b64.len() > 32);
        let bytes = BASE64.decode(b64).expect("valid base64");
        assert!(bytes.len() > 32);
        // ZIP local file header
        assert_eq!(&bytes[0..2], b"PK");
    }

    fn parse_3mf_model_mesh(xml: &str) -> nbcad_export::TriangleMesh {
        use nbcad_core::BodyId;
        let mut positions = Vec::new();
        for line in xml.lines() {
            let trimmed = line.trim();
            if let Some(rest) = trimmed.strip_prefix("<vertex x=\"") {
                let parts: Vec<&str> = rest.split('"').collect();
                if parts.len() >= 6 {
                    let x: f32 = parts[0].parse().unwrap();
                    let y: f32 = parts[2].parse().unwrap();
                    let z: f32 = parts[4].parse().unwrap();
                    positions.extend_from_slice(&[x, y, z]);
                }
            }
        }
        let mut indices = Vec::new();
        for line in xml.lines() {
            let trimmed = line.trim();
            if let Some(rest) = trimmed.strip_prefix("<triangle v1=\"") {
                let parts: Vec<&str> = rest.split('"').collect();
                if parts.len() >= 6 {
                    indices.push(parts[0].parse().unwrap());
                    indices.push(parts[2].parse().unwrap());
                    indices.push(parts[4].parse().unwrap());
                }
            }
        }
        nbcad_export::TriangleMesh {
            body_id: BodyId(1),
            name: "exported".into(),
            positions,
            indices,
        }
    }

    #[test]
    fn occt_box_export_3mf_is_index_welded() {
        let (mut server, _) = mcp_box();
        let request = MeshExportRequest::default();
        let raw_meshes = server
            .kernel
            .tessellate_bodies(&request)
            .expect("OCCT tessellation should succeed for a simple box");
        assert_eq!(raw_meshes.len(), 1);
        let raw = &raw_meshes[0];
        let raw_vertex_count = raw.positions.len() / 3;
        let tri_count = raw.triangle_count();
        assert!(tri_count > 0);
        assert!(
            raw_vertex_count >= tri_count * 3 - 2,
            "OCCT soup should emit ~3 positions per triangle (got {raw_vertex_count} verts, {tri_count} tris)"
        );
        assert!(
            nbcad_export::boundary_edge_count(raw) > 0,
            "raw OCCT mesh should have boundary edges before export weld"
        );

        let exported = server
            .call_tool("solid_export_3mf", json!({"slicer_target": "standard"}))
            .expect("3MF export should succeed");
        let bytes = BASE64
            .decode(exported["bytes_base64"].as_str().unwrap())
            .unwrap();
        let mut archive =
            zip::ZipArchive::new(std::io::Cursor::new(bytes)).expect("3MF should be a zip");
        let mut model = archive.by_name("3D/3dmodel.model").unwrap();
        let mut xml = String::new();
        std::io::Read::read_to_string(&mut model, &mut xml).unwrap();

        let vertex_count = xml.matches("<vertex ").count();
        let triangle_count = xml.matches("<triangle ").count();
        assert_eq!(triangle_count, tri_count);
        assert!(
            vertex_count < tri_count * 3,
            "exported 3MF should be welded ({vertex_count} verts vs {triangle_count} tris)"
        );
        assert!(
            vertex_count <= raw_vertex_count / 2,
            "welded vertex count should be far below raw soup"
        );
        // Planar OCCT box should weld to the 8 corners (not a hand-built fixture).
        assert_eq!(
            vertex_count, 8,
            "OCCT unit-box 3MF should weld to 8 corners (got {vertex_count})"
        );

        let parsed = parse_3mf_model_mesh(&xml);
        assert_eq!(parsed.positions.len() / 3, vertex_count);
        assert_eq!(parsed.triangle_count(), triangle_count);
        assert_eq!(
            nbcad_export::boundary_edge_count(&parsed),
            0,
            "exported 3MF mesh should be manifold (no boundary edges)"
        );
        assert_eq!(
            nbcad_export::invalid_model_edge_count(&parsed),
            0,
            "every exported edge should have two oppositely oriented triangle uses"
        );
    }

    #[test]
    fn set_body_appearance_from_preset_then_exports_3mf() {
        let (mut server, update) = mcp_box();
        let body_id = update["scene"]["bodies"][0]["id"]
            .as_u64()
            .expect("extrude returns a body id");
        let assigned = server
            .call_tool(
                "set_body_appearance",
                json!({
                    "body_id": body_id,
                    "preset_id": "bambu.pla.basic.red"
                }),
            )
            .expect("preset appearance assign");
        let appearances = assigned["body_appearances"].as_array().unwrap();
        assert_eq!(appearances.len(), 1);
        assert_eq!(appearances[0]["preset_id"], "bambu.pla.basic.red");
        assert_eq!(appearances[0]["brand"], "Bambu Lab");
        let listed = server.call_tool("body_appearances", json!({})).unwrap();
        assert_eq!(listed.as_array().unwrap().len(), 1);
        let exported = server
            .call_tool("solid_export_3mf", json!({"slicer_target": "bambu_studio"}))
            .unwrap();
        assert_eq!(
            &BASE64
                .decode(exported["bytes_base64"].as_str().unwrap())
                .unwrap()[0..2],
            b"PK"
        );
    }

    #[test]
    fn solid_export_step_returns_base64_payload() {
        let (mut server, _) = mcp_box();
        let exported = server
            .call_tool("solid_export_step", json!({}))
            .expect("STEP export should succeed for a simple box");
        assert_eq!(exported["format"], "step");
        assert_eq!(exported["encoding"], "base64");
        assert!(exported["bytes_base64"].as_str().unwrap().len() > 16);
    }

    #[test]
    fn mcp_sketch_patterns_are_one_step_engine_operations() {
        let mut server = CadServer::new().unwrap();
        server
            .call_tool(
                "sketch_begin",
                json!({"plane": {"type": "origin_plane", "plane": "xy"}}),
            )
            .unwrap();
        let source = server
            .call_tool(
                "sketch_add_line",
                json!({
                    "from": {"x": 10.0, "y": 0.0},
                    "to_raw": {"x": 20.0, "y": 0.0},
                    "ctrl_held": false
                }),
            )
            .unwrap();
        let source_id = source["entity_id"].clone();

        let rectangular = server
            .call_tool(
                "sketch_rectangular_pattern",
                json!({
                    "entity_ids": [source_id],
                    "direction": {"x": 0.0, "y": 1.0},
                    "spacing": 10.0,
                    "count": 3
                }),
            )
            .unwrap();
        assert_eq!(
            rectangular["sketch"]["entities"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|entity| entity["kind"] == "line")
                .count(),
            3
        );

        let circular = server
            .call_tool(
                "sketch_circular_pattern",
                json!({
                    "entity_ids": [source["entity_id"].clone()],
                    "center": {"x": 0.0, "y": 0.0},
                    "count": 4,
                    "total_angle_deg": 360.0
                }),
            )
            .unwrap();
        assert_eq!(
            circular["sketch"]["entities"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|entity| entity["kind"] == "line")
                .count(),
            6
        );
    }

    #[test]
    fn mcp_tools_build_and_revolve_a_real_occt_body() {
        let mut server = CadServer::new().unwrap();
        server
            .call_tool(
                "sketch_begin",
                json!({"plane": {"type": "origin_plane", "plane": "xy"}}),
            )
            .unwrap();
        server
            .call_tool(
                "sketch_add_rectangle",
                json!({
                    "mode": "two_point",
                    "p1": {"x": 10.0, "y": 0.0},
                    "p2": {"x": 20.0, "y": 15.0},
                    "ctrl_held": false
                }),
            )
            .unwrap();
        server.call_tool("sketch_finish", json!({})).unwrap();

        let update = server
            .call_tool(
                "solid_revolve",
                json!({
                    "sketch_name": "Sketch1",
                    "profile_indices": [0],
                    "axis_origin": {"x": 0.0, "y": 0.0},
                    "axis_direction": {"x": 0.0, "y": 1.0},
                    "axis_line_entity_id": null,
                    "angle_deg": 360.0,
                    "flip": false,
                    "operation": "new_body",
                    "target_body_ids": []
                }),
            )
            .unwrap();
        assert_eq!(update["scene"]["bodies"].as_array().unwrap().len(), 1);
        assert_eq!(update["document"]["features"][1]["kind"], "revolve");
        assert!(update["scene"]["bodies"][0]["mesh"]["indices"]
            .as_array()
            .is_some_and(|indices| !indices.is_empty()));

        let project = server.call_tool("cad_project_model", json!({})).unwrap();
        let model: Value = serde_json::from_str(project.as_str().unwrap()).unwrap();
        assert_eq!(model["revolves"].as_array().unwrap().len(), 1);

        let mut restored = CadServer::new().unwrap();
        let restored_update = restored
            .call_tool(
                "cad_load_project_model",
                json!({"model_json": project.as_str().unwrap()}),
            )
            .unwrap();
        assert_eq!(
            restored_update["scene"]["bodies"].as_array().unwrap().len(),
            1
        );
        assert_eq!(
            restored_update["document"]["features"][1]["kind"],
            "revolve"
        );
    }

    #[test]
    fn mcp_tools_create_solid_fillets_chamfers_and_holes() {
        for (tool, value_name) in [("solid_fillet", "radius"), ("solid_chamfer", "distance")] {
            let (mut server, base) = mcp_box();
            let body = &base["scene"]["bodies"][0];
            let edge_ids = vec![
                body["edges"][0]["id"].clone(),
                body["edges"][1]["id"].clone(),
            ];
            let mut request = Map::new();
            request.insert("body_id".to_string(), body["id"].clone());
            request.insert("edge_ids".to_string(), Value::Array(edge_ids));
            request.insert(value_name.to_string(), json!(1.0));
            request.insert("tangent_chain".to_string(), json!(false));
            let update = server.call_tool(tool, Value::Object(request)).unwrap();
            assert!(update["scene"]["errors"].as_array().unwrap().is_empty());
            assert_eq!(update["scene"]["bodies"].as_array().unwrap().len(), 1);
            let definitions = server
                .call_tool(
                    if tool == "solid_fillet" {
                        "solid_fillet_definitions"
                    } else {
                        "solid_chamfer_definitions"
                    },
                    json!({}),
                )
                .unwrap();
            assert_eq!(definitions.as_array().unwrap().len(), 1);
        }

        let (mut server, base) = mcp_box();
        let body = &base["scene"]["bodies"][0];
        let top = body["faces"]
            .as_array()
            .unwrap()
            .iter()
            .find(|face| {
                face["plane"]["normal"][2]
                    .as_f64()
                    .is_some_and(|normal_z| normal_z > 0.9)
            })
            .unwrap();
        let origin = top["plane"]["origin"].as_array().unwrap();
        let u = top["plane"]["u"].as_array().unwrap();
        let v = top["plane"]["v"].as_array().unwrap();
        let delta = [
            -origin[0].as_f64().unwrap(),
            -origin[1].as_f64().unwrap(),
            10.0 - origin[2].as_f64().unwrap(),
        ];
        let project = |axis: &Vec<Value>| {
            delta
                .iter()
                .zip(axis)
                .map(|(component, basis)| component * basis.as_f64().unwrap())
                .sum::<f64>()
        };
        let update = server
            .call_tool(
                "solid_hole",
                json!({
                    "body_id": body["id"].clone(),
                    "face_id": top["id"].clone(),
                    "position": {"x": project(u), "y": project(v)},
                    "diameter": 5.0,
                    "extent": {"type": "through_all"},
                    "style": "countersink",
                    "counterbore_diameter": 0.0,
                    "counterbore_depth": 0.0,
                    "countersink_diameter": 8.0,
                    "countersink_angle_deg": 90.0,
                    "thread": {
                        "standard": "iso_metric",
                        "series": "metric_coarse",
                        "designation": "M6 x 1 - 6H",
                        "class": "6H",
                        "nominal_diameter": 6.0,
                        "pitch": 1.0,
                        "threads_per_inch": null,
                        "hand": "right",
                        "depth": null,
                        "representation": "modeled",
                        "tap_drill_designation": "5 mm"
                    },
                    "flip": false
                }),
            )
            .unwrap();
        assert!(
            update["scene"]["errors"].as_array().unwrap().is_empty(),
            "{}",
            update["scene"]["errors"]
        );
        assert_eq!(update["document"]["features"][2]["kind"], "hole");
        let definitions = server
            .call_tool("solid_hole_definitions", json!({}))
            .unwrap();
        assert_eq!(definitions.as_array().unwrap().len(), 1);
        assert_eq!(definitions[0]["thread"]["designation"], "M6 x 1 - 6H");
        assert_eq!(definitions[0]["thread"]["representation"], "modeled");
        let replay = server.call_tool("solid_recompute", json!({})).unwrap();
        assert!(replay["scene"]["errors"].as_array().unwrap().is_empty());
    }

    #[test]
    fn mcp_construction_planes_and_body_operations_run_through_native_occt() {
        let (mut split_server, split_base) = mcp_box();
        let plane = split_server
            .call_tool(
                "construction_plane_offset",
                json!({
                    "reference": {"type": "origin_plane", "plane": "xy"},
                    "distance": 5.0
                }),
            )
            .unwrap();
        let datum_id = plane["planes"][0]["datum_id"].clone();
        assert_eq!(plane["planes"][0]["basis"]["origin"][2], json!(5.0));
        let split = split_server
            .call_tool(
                "solid_split_body",
                json!({
                    "body_id": split_base["scene"]["bodies"][0]["id"].clone(),
                    "plane": {"type": "datum_plane", "datum_id": datum_id}
                }),
            )
            .unwrap();
        assert!(split["scene"]["errors"].as_array().unwrap().is_empty());
        assert_eq!(split["scene"]["bodies"].as_array().unwrap().len(), 2);

        let (mut shell_server, shell_base) = mcp_box();
        let shell_body = &shell_base["scene"]["bodies"][0];
        let shell_face = shell_body["faces"]
            .as_array()
            .unwrap()
            .iter()
            .find(|face| {
                face["plane"]["normal"][2]
                    .as_f64()
                    .is_some_and(|normal| normal > 0.9)
            })
            .unwrap()["id"]
            .clone();
        let shell = shell_server
            .call_tool(
                "solid_shell",
                json!({
                    "body_id": shell_body["id"].clone(),
                    "face_ids": [shell_face],
                    "thickness": 1.0,
                    "inward": true
                }),
            )
            .unwrap();
        assert!(shell["scene"]["errors"].as_array().unwrap().is_empty());
        assert_eq!(shell["scene"]["bodies"].as_array().unwrap().len(), 1);

        let (mut mirror_server, mirror_base) = mcp_box();
        let mirror = mirror_server
            .call_tool(
                "solid_mirror",
                json!({
                    "body_ids": [mirror_base["scene"]["bodies"][0]["id"].clone()],
                    "plane": {"type": "origin_plane", "plane": "yz"}
                }),
            )
            .unwrap();
        assert_eq!(mirror["scene"]["bodies"].as_array().unwrap().len(), 2);

        let (mut rectangular_server, rectangular_base) = mcp_box();
        let rectangular = rectangular_server
            .call_tool(
                "solid_rectangular_pattern",
                json!({
                    "body_ids": [rectangular_base["scene"]["bodies"][0]["id"].clone()],
                    "direction": {"x": 1.0, "y": 0.0, "z": 0.0},
                    "spacing": 30.0,
                    "count": 3,
                    "second_direction": null,
                    "second_spacing": 0.0,
                    "second_count": 1
                }),
            )
            .unwrap();
        assert_eq!(rectangular["scene"]["bodies"].as_array().unwrap().len(), 3);

        let (mut circular_server, circular_base) = mcp_box();
        let circular = circular_server
            .call_tool(
                "solid_circular_pattern",
                json!({
                    "body_ids": [circular_base["scene"]["bodies"][0]["id"].clone()],
                    "axis_origin": {"x": 0.0, "y": 0.0, "z": 0.0},
                    "axis_direction": {"x": 0.0, "y": 0.0, "z": 1.0},
                    "count": 4,
                    "total_angle_deg": 360.0
                }),
            )
            .unwrap();
        assert_eq!(circular["scene"]["bodies"].as_array().unwrap().len(), 4);

        let mirror_bodies = mirror["scene"]["bodies"].as_array().unwrap();
        let combined = mirror_server
            .call_tool(
                "solid_combine",
                json!({
                    "target_body_id": mirror_bodies[0]["id"].clone(),
                    "tool_body_ids": [mirror_bodies[1]["id"].clone()],
                    "operation": "join",
                    "keep_tools": false
                }),
            )
            .unwrap();
        assert!(combined["scene"]["errors"].as_array().unwrap().is_empty());
        assert_eq!(combined["scene"]["bodies"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn mcp_curved_and_guided_sweeps_run_through_native_occt() {
        let mut server = CadServer::new().unwrap();
        server
            .call_tool(
                "sketch_begin",
                json!({"plane": {"type": "origin_plane", "plane": "xy"}}),
            )
            .unwrap();
        server
            .call_tool(
                "sketch_add_rectangle",
                json!({
                    "mode": "two_point",
                    "p1": {"x": -10.0, "y": -10.0},
                    "p2": {"x": 10.0, "y": 10.0},
                    "ctrl_held": false
                }),
            )
            .unwrap();
        server.call_tool("sketch_finish", json!({})).unwrap();

        server
            .call_tool(
                "sketch_begin",
                json!({"plane": {"type": "origin_plane", "plane": "yz"}}),
            )
            .unwrap();
        server
            .call_tool(
                "sketch_add_arc_center",
                json!({
                    "center": {"x": 0.0, "y": 20.0},
                    "start": {"x": 0.0, "y": 0.0},
                    "sweep": {"x": 20.0, "y": 20.0},
                    "ctrl_held": false
                }),
            )
            .unwrap();
        server
            .call_tool(
                "sketch_add_arc_center",
                json!({
                    "center": {"x": 10.0, "y": 20.0},
                    "start": {"x": 10.0, "y": 0.0},
                    "sweep": {"x": 30.0, "y": 20.0},
                    "ctrl_held": false
                }),
            )
            .unwrap();
        server.call_tool("sketch_finish", json!({})).unwrap();

        let catalog = server.call_tool("sketch_profiles", json!({})).unwrap();
        let arcs = catalog
            .as_array()
            .unwrap()
            .iter()
            .find(|entry| entry["sketch_name"] == "Sketch2")
            .unwrap()["path_curves"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|curve| curve["kind"] == "arc")
            .map(|curve| curve["entity_id"].clone())
            .collect::<Vec<_>>();
        assert_eq!(arcs.len(), 2);

        let update = server
            .call_tool(
                "solid_sweep",
                json!({
                    "profile": {"sketch_name": "Sketch1", "profile_index": 0},
                    "path_sketch_name": "Sketch2",
                    "path_entity_ids": [arcs[0].clone()],
                    "operation": "new_body",
                    "target_body_ids": [],
                    "guide_rail": null,
                    "orientation": "corrected_frenet",
                    "transition": "round_corner",
                    "force_c1": true
                }),
            )
            .unwrap();
        assert!(
            update["scene"]["errors"].as_array().unwrap().is_empty(),
            "{}",
            update["scene"]["errors"]
        );
        assert_eq!(update["scene"]["bodies"].as_array().unwrap().len(), 1);
        assert!(update["scene"]["bodies"][0]["mesh"]["indices"]
            .as_array()
            .is_some_and(|indices| !indices.is_empty()));
        let definitions = server
            .call_tool("solid_sweep_definitions", json!({}))
            .unwrap();
        assert_eq!(definitions[0]["orientation"], "corrected_frenet");
        assert_eq!(definitions[0]["transition"], "round_corner");
        assert_eq!(definitions[0]["force_c1"], true);
        assert!(definitions[0]["guide_rail"].is_null());

        server
            .call_tool(
                "sketch_begin",
                json!({"plane": {"type": "origin_plane", "plane": "yz"}}),
            )
            .unwrap();
        server
            .call_tool(
                "sketch_add_line",
                json!({
                    "from": {"x": 0.0, "y": 0.0},
                    "to_raw": {"x": 0.0, "y": 30.0},
                    "ctrl_held": false
                }),
            )
            .unwrap();
        server
            .call_tool(
                "sketch_add_line",
                json!({
                    "from": {"x": 10.0, "y": 0.0},
                    "to_raw": {"x": 10.0, "y": 30.0},
                    "ctrl_held": false
                }),
            )
            .unwrap();
        server.call_tool("sketch_finish", json!({})).unwrap();
        let catalog = server.call_tool("sketch_profiles", json!({})).unwrap();
        let lines = catalog
            .as_array()
            .unwrap()
            .iter()
            .find(|entry| entry["sketch_name"] == "Sketch3")
            .unwrap()["path_curves"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|curve| curve["kind"] == "line")
            .map(|curve| curve["entity_id"].clone())
            .collect::<Vec<_>>();
        assert_eq!(lines.len(), 2);

        let guided = server
            .call_tool(
                "solid_sweep",
                json!({
                    "profile": {"sketch_name": "Sketch1", "profile_index": 0},
                    "path_sketch_name": "Sketch3",
                    "path_entity_ids": [lines[0].clone()],
                    "operation": "new_body",
                    "target_body_ids": [],
                    "guide_rail": {
                        "sketch_name": "Sketch3",
                        "entity_ids": [lines[1].clone()]
                    },
                    "orientation": "corrected_frenet",
                    "transition": "transformed",
                    "force_c1": true
                }),
            )
            .unwrap();
        assert!(
            guided["scene"]["errors"].as_array().unwrap().is_empty(),
            "{}",
            guided["scene"]["errors"]
        );
        assert_eq!(guided["scene"]["bodies"].as_array().unwrap().len(), 2);
        let definitions = server
            .call_tool("solid_sweep_definitions", json!({}))
            .unwrap();
        assert_eq!(definitions.as_array().unwrap().len(), 2);
        assert!(definitions[1]["guide_rail"].is_object());
    }

    #[test]
    fn mcp_guided_g2_loft_runs_through_native_occt() {
        let mut server = CadServer::new().unwrap();
        server
            .call_tool(
                "sketch_begin",
                json!({"plane": {"type": "origin_plane", "plane": "xy"}}),
            )
            .unwrap();
        server
            .call_tool(
                "sketch_add_rectangle",
                json!({
                    "mode": "two_point",
                    "p1": {"x": -10.0, "y": -10.0},
                    "p2": {"x": 10.0, "y": 10.0},
                    "ctrl_held": false
                }),
            )
            .unwrap();
        server.call_tool("sketch_finish", json!({})).unwrap();
        let plane = server
            .call_tool(
                "construction_plane_offset",
                json!({
                    "reference": {"type": "origin_plane", "plane": "xy"},
                    "distance": 30.0
                }),
            )
            .unwrap();
        let datum_id = plane["planes"][0]["datum_id"].clone();
        server
            .call_tool(
                "sketch_begin",
                json!({"plane": {"type": "datum_plane", "datum_id": datum_id}}),
            )
            .unwrap();
        server
            .call_tool(
                "sketch_add_rectangle",
                json!({
                    "mode": "two_point",
                    "p1": {"x": -10.0, "y": -10.0},
                    "p2": {"x": 10.0, "y": 10.0},
                    "ctrl_held": false
                }),
            )
            .unwrap();
        server.call_tool("sketch_finish", json!({})).unwrap();

        server
            .call_tool(
                "sketch_begin",
                json!({"plane": {"type": "origin_plane", "plane": "xz"}}),
            )
            .unwrap();
        for x in [0.0, 10.0] {
            server
                .call_tool(
                    "sketch_add_line",
                    json!({
                        "from": {"x": x, "y": 0.0},
                        "to_raw": {"x": x, "y": 30.0},
                        "ctrl_held": false
                    }),
                )
                .unwrap();
        }
        server.call_tool("sketch_finish", json!({})).unwrap();
        let catalog = server.call_tool("sketch_profiles", json!({})).unwrap();
        let lines = catalog
            .as_array()
            .unwrap()
            .iter()
            .find(|entry| entry["sketch_name"] == "Sketch3")
            .unwrap()["path_curves"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|curve| curve["kind"] == "line")
            .map(|curve| curve["entity_id"].clone())
            .collect::<Vec<_>>();
        assert_eq!(lines.len(), 2);

        let update = server
            .call_tool(
                "solid_loft",
                json!({
                    "sections": [
                        {"sketch_name": "Sketch1", "profile_index": 0},
                        {"sketch_name": "Sketch2", "profile_index": 0}
                    ],
                    "ruled": false,
                    "operation": "new_body",
                    "target_body_ids": [],
                    "continuity": "g2",
                    "centerline": {
                        "sketch_name": "Sketch3",
                        "entity_ids": [lines[0].clone()]
                    },
                    "guide_rail": {
                        "sketch_name": "Sketch3",
                        "entity_ids": [lines[1].clone()]
                    }
                }),
            )
            .unwrap();
        assert!(
            update["scene"]["errors"].as_array().unwrap().is_empty(),
            "{}",
            update["scene"]["errors"]
        );
        assert_eq!(update["scene"]["bodies"].as_array().unwrap().len(), 1);
        let definitions = server
            .call_tool("solid_loft_definitions", json!({}))
            .unwrap();
        assert_eq!(definitions[0]["continuity"], "g2");
        assert!(definitions[0]["centerline"].is_object());
        assert!(definitions[0]["guide_rail"].is_object());
    }

    #[test]
    fn mcp_curved_rib_and_reference_extents_run_through_native_occt() {
        let mut curved_server = CadServer::new().unwrap();
        curved_server
            .call_tool(
                "sketch_begin",
                json!({"plane": {"type": "origin_plane", "plane": "xy"}}),
            )
            .unwrap();
        curved_server
            .call_tool(
                "sketch_add_arc_center",
                json!({
                    "center": {"x": 0.0, "y": 0.0},
                    "start": {"x": -20.0, "y": 0.0},
                    "sweep": {"x": 0.0, "y": 20.0},
                    "ctrl_held": false
                }),
            )
            .unwrap();
        curved_server.call_tool("sketch_finish", json!({})).unwrap();
        let catalog = curved_server
            .call_tool("sketch_profiles", json!({}))
            .unwrap();
        let arc_id = catalog[0]["path_curves"]
            .as_array()
            .unwrap()
            .iter()
            .find(|curve| curve["kind"] == "arc")
            .unwrap()["entity_id"]
            .clone();
        let curved = curved_server
            .call_tool(
                "solid_rib",
                json!({
                    "sketch_name": "Sketch1",
                    "line_entity_ids": [arc_id],
                    "thickness": 2.0,
                    "depth": 5.0,
                    "extent": {"type": "distance", "depth": 5.0},
                    "symmetric": false,
                    "flip": false,
                    "operation": "new_body",
                    "target_body_ids": []
                }),
            )
            .unwrap();
        assert!(
            curved["scene"]["errors"].as_array().unwrap().is_empty(),
            "{}",
            curved["scene"]["errors"]
        );
        assert_eq!(curved["scene"]["bodies"].as_array().unwrap().len(), 1);

        let add_target_rib_sketch = |server: &mut CadServer| {
            server
                .call_tool(
                    "sketch_begin",
                    json!({"plane": {"type": "origin_plane", "plane": "xy"}}),
                )
                .unwrap();
            server
                .call_tool(
                    "sketch_add_line",
                    json!({
                        "from": {"x": -10.0, "y": 0.0},
                        "to_raw": {"x": 10.0, "y": 0.0},
                        "ctrl_held": false
                    }),
                )
                .unwrap();
            server.call_tool("sketch_finish", json!({})).unwrap();
            let catalog = server.call_tool("sketch_profiles", json!({})).unwrap();
            catalog
                .as_array()
                .unwrap()
                .iter()
                .find(|entry| entry["sketch_name"] == "Sketch2")
                .unwrap()["path_curves"][0]["entity_id"]
                .clone()
        };

        let (mut next_server, next_base) = mcp_box();
        let next_body_id = next_base["scene"]["bodies"][0]["id"].clone();
        let next_line_id = add_target_rib_sketch(&mut next_server);
        let to_next = next_server
            .call_tool(
                "solid_rib",
                json!({
                    "sketch_name": "Sketch2",
                    "line_entity_ids": [next_line_id],
                    "thickness": 2.0,
                    "depth": 5.0,
                    "extent": {"type": "to_next"},
                    "symmetric": false,
                    "flip": false,
                    "operation": "join",
                    "target_body_ids": [next_body_id]
                }),
            )
            .unwrap();
        assert!(
            to_next["scene"]["errors"].as_array().unwrap().is_empty(),
            "{}",
            to_next["scene"]["errors"]
        );
        assert_eq!(to_next["scene"]["bodies"].as_array().unwrap().len(), 1);

        let (mut face_server, face_base) = mcp_box();
        let face_body = &face_base["scene"]["bodies"][0];
        let face_body_id = face_body["id"].clone();
        let top_face_id = face_body["faces"]
            .as_array()
            .unwrap()
            .iter()
            .find(|face| {
                face["plane"]["normal"][2]
                    .as_f64()
                    .is_some_and(|normal| normal > 0.9)
            })
            .unwrap()["id"]
            .clone();
        let face_line_id = add_target_rib_sketch(&mut face_server);
        let to_face = face_server
            .call_tool(
                "solid_rib",
                json!({
                    "sketch_name": "Sketch2",
                    "line_entity_ids": [face_line_id],
                    "thickness": 2.0,
                    "depth": 5.0,
                    "extent": {"type": "to_face", "face_id": top_face_id},
                    "symmetric": false,
                    "flip": false,
                    "operation": "join",
                    "target_body_ids": [face_body_id]
                }),
            )
            .unwrap();
        assert!(
            to_face["scene"]["errors"].as_array().unwrap().is_empty(),
            "{}",
            to_face["scene"]["errors"]
        );
        assert_eq!(to_face["scene"]["bodies"].as_array().unwrap().len(), 1);
    }
}
