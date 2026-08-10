use std::collections::HashMap;
use std::sync::Mutex;

use nbcad_core::{BodyAppearance, DocumentDto};
use nbcad_occt::{
    drawing_projection_anchors, drawing_projection_circles, DrawingProjectionRequest, OcctKernel,
};
use nbcad_sketch::{err_json, host, ok_json, SketchDto, SketchManager};
use nbcad_solid::{
    BodyFeatureRequestDto, DatumPlaneDefinitionDto, DeleteFeatureRequest, EditBodyFeatureRequest,
    EditExtrudeRequest, EditHoleRequest, EditLoftRequest, EditRevolveRequest, EditRibRequest,
    EditSolidChamferRequest, EditSolidFilletRequest, EditSweepRequest, ExtrudeRequest, HoleRequest,
    LoftRequest, ProfileCatalogItemDto, RecomputePlanDto, ReorderFeatureRequest, RevolveRequest,
    RibRequest, SetRollbackRequest, SolidChamferRequest, SolidFilletRequest, SolidSceneDto,
    SolidUpdateDto, StepExportRequest, SweepRequest,
};
use serde::de::DeserializeOwned;

pub(crate) const BOOTSTRAP_SESSION_ID: &str = "__bootstrap__";
const MAX_PROJECT_SESSIONS: usize = 128;

struct NativeEngine {
    manager: SketchManager,
    kernel: OcctKernel,
    geometry_revision: u64,
}

impl NativeEngine {
    fn new() -> Result<Self, String> {
        Ok(Self {
            manager: SketchManager::new(),
            kernel: OcctKernel::new()
                .map_err(|error| format!("native OCCT kernel failed to initialize: {error}"))?,
            geometry_revision: 1,
        })
    }

    fn update(&self) -> SolidUpdateDto {
        SolidUpdateDto {
            document: self.manager.document_dto(),
            scene: self.manager.solid_scene(),
        }
    }
}

struct NativeWorkspace {
    active_session_id: String,
    sessions: HashMap<String, NativeEngine>,
}

impl NativeWorkspace {
    fn new() -> Self {
        let mut sessions = HashMap::new();
        sessions.insert(
            BOOTSTRAP_SESSION_ID.to_string(),
            NativeEngine::new().expect("native OCCT kernel failed to initialize"),
        );
        Self {
            active_session_id: BOOTSTRAP_SESSION_ID.to_string(),
            sessions,
        }
    }

    fn active(&self) -> &NativeEngine {
        self.sessions
            .get(&self.active_session_id)
            .expect("active project session missing")
    }

    fn active_mut(&mut self) -> &mut NativeEngine {
        self.sessions
            .get_mut(&self.active_session_id)
            .expect("active project session missing")
    }
}

/// Native application state: the shared Rust document/history manager plus
/// the stateful OCCT B-rep bridge. The whole pair is locked together so a
/// prepare → kernel replay → commit transaction cannot interleave.
pub struct AppState {
    inner: Mutex<NativeWorkspace>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(NativeWorkspace::new()),
        }
    }

    /// Associate the engine created during application bootstrap with the
    /// frontend's first tab. Repeated binding of the active tab is harmless.
    pub fn bind_project_session(&self, session_id: &str) -> String {
        if let Err(error) = validate_session_id(session_id) {
            return err_json(error);
        }
        let mut workspace = self.inner.lock().expect("engine lock poisoned");
        if workspace.active_session_id == session_id {
            return ok_json(());
        }
        if workspace.sessions.contains_key(session_id) {
            workspace.active_session_id = session_id.to_string();
            return ok_json(());
        }
        if workspace.active_session_id != BOOTSTRAP_SESSION_ID || workspace.sessions.len() != 1 {
            return err_json("the bootstrap project session is already bound");
        }
        let engine = workspace
            .sessions
            .remove(BOOTSTRAP_SESSION_ID)
            .expect("bootstrap project session missing");
        workspace.sessions.insert(session_id.to_string(), engine);
        workspace.active_session_id = session_id.to_string();
        ok_json(())
    }

    /// Create and activate a blank, fully retained OCCT project context.
    pub fn create_project_session(&self, session_id: &str) -> String {
        if let Err(error) = validate_session_id(session_id) {
            return err_json(error);
        }
        let mut workspace = self.inner.lock().expect("engine lock poisoned");
        if workspace.sessions.contains_key(session_id) {
            return err_json("project session already exists");
        }
        if workspace.sessions.len() >= MAX_PROJECT_SESSIONS {
            return err_json("too many resident project sessions");
        }
        let engine = match NativeEngine::new() {
            Ok(engine) => engine,
            Err(error) => return err_json(error),
        };
        let update = engine.update();
        workspace.sessions.insert(session_id.to_string(), engine);
        workspace.active_session_id = session_id.to_string();
        ok_json(update)
    }

    /// Activate a retained project. A missing value means the tab was evicted
    /// and should be recreated from its frontend-owned model snapshot.
    pub fn activate_project_session(&self, session_id: &str) -> String {
        if let Err(error) = validate_session_id(session_id) {
            return err_json(error);
        }
        let mut workspace = self.inner.lock().expect("engine lock poisoned");
        if !workspace.sessions.contains_key(session_id) {
            return ok_json(false);
        }
        workspace.active_session_id = session_id.to_string();
        ok_json(true)
    }

    /// Release an inactive tab's OCCT B-reps and tessellation. The frontend
    /// retains the parametric snapshot required to recreate it later.
    pub fn drop_project_session(&self, session_id: &str) -> String {
        if let Err(error) = validate_session_id(session_id) {
            return err_json(error);
        }
        let mut workspace = self.inner.lock().expect("engine lock poisoned");
        if workspace.active_session_id == session_id {
            return err_json("cannot drop the active project session");
        }
        workspace.sessions.remove(session_id);
        ok_json(())
    }

    pub fn document_snapshot(&self) -> DocumentDto {
        self.inner
            .lock()
            .expect("engine lock poisoned")
            .active()
            .manager
            .document_dto()
    }

    /// One lock acquisition gives the native viewport a coherent model
    /// snapshot. The OCCT triangle buffers stay in Rust and never make a
    /// JSON/IPC round-trip through the webview.
    pub fn viewport_snapshot(
        &self,
    ) -> (
        String,
        u64,
        SolidSceneDto,
        Option<SketchDto>,
        Vec<SketchDto>,
        Vec<DatumPlaneDefinitionDto>,
        Vec<ProfileCatalogItemDto>,
        Vec<BodyAppearance>,
    ) {
        let workspace = self.inner.lock().expect("engine lock poisoned");
        let inner = workspace.active();
        (
            workspace.active_session_id.clone(),
            inner.geometry_revision,
            inner.manager.solid_scene(),
            inner.manager.active_snapshot(),
            inner.manager.finished_sketches(),
            inner.manager.datum_plane_definitions(),
            inner.manager.profile_catalog(),
            inner.manager.body_appearances(),
        )
    }

    pub fn engine_call(&self, method: &str, payload: &str) -> String {
        let mut workspace = self.inner.lock().expect("engine lock poisoned");
        let inner = workspace.active_mut();
        let result = host::handle(&mut inner.manager, method, payload);
        if matches!(method, "datum_plane_create" | "datum_plane_edit") {
            inner.geometry_revision = inner.geometry_revision.wrapping_add(1);
        }
        result
    }

    pub fn solid_extrude(&self, payload: &str) -> String {
        self.with_request(payload, |manager, request: ExtrudeRequest| {
            manager.prepare_extrude(request)
        })
    }

    pub fn solid_edit_extrude(&self, payload: &str) -> String {
        self.with_request(payload, |manager, request: EditExtrudeRequest| {
            manager.prepare_edit_extrude(request)
        })
    }

    pub fn solid_revolve(&self, payload: &str) -> String {
        self.with_request(payload, |manager, request: RevolveRequest| {
            manager.prepare_revolve(request)
        })
    }

    pub fn solid_edit_revolve(&self, payload: &str) -> String {
        self.with_request(payload, |manager, request: EditRevolveRequest| {
            manager.prepare_edit_revolve(request)
        })
    }

    pub fn solid_sweep(&self, payload: &str) -> String {
        self.with_request(payload, |manager, request: SweepRequest| {
            manager.prepare_sweep(request)
        })
    }

    pub fn solid_edit_sweep(&self, payload: &str) -> String {
        self.with_request(payload, |manager, request: EditSweepRequest| {
            manager.prepare_edit_sweep(request)
        })
    }

    pub fn solid_loft(&self, payload: &str) -> String {
        self.with_request(payload, |manager, request: LoftRequest| {
            manager.prepare_loft(request)
        })
    }

    pub fn solid_edit_loft(&self, payload: &str) -> String {
        self.with_request(payload, |manager, request: EditLoftRequest| {
            manager.prepare_edit_loft(request)
        })
    }

    pub fn solid_rib(&self, payload: &str) -> String {
        self.with_request(payload, |manager, request: RibRequest| {
            manager.prepare_rib(request)
        })
    }

    pub fn solid_edit_rib(&self, payload: &str) -> String {
        self.with_request(payload, |manager, request: EditRibRequest| {
            manager.prepare_edit_rib(request)
        })
    }

    pub fn solid_fillet(&self, payload: &str) -> String {
        self.with_request(payload, |manager, request: SolidFilletRequest| {
            manager.prepare_solid_fillet(request)
        })
    }

    pub fn solid_edit_fillet(&self, payload: &str) -> String {
        self.with_request(payload, |manager, request: EditSolidFilletRequest| {
            manager.prepare_edit_solid_fillet(request)
        })
    }

    pub fn solid_chamfer(&self, payload: &str) -> String {
        self.with_request(payload, |manager, request: SolidChamferRequest| {
            manager.prepare_solid_chamfer(request)
        })
    }

    pub fn solid_edit_chamfer(&self, payload: &str) -> String {
        self.with_request(payload, |manager, request: EditSolidChamferRequest| {
            manager.prepare_edit_solid_chamfer(request)
        })
    }

    pub fn solid_hole(&self, payload: &str) -> String {
        self.with_request(payload, |manager, request: HoleRequest| {
            manager.prepare_hole(request)
        })
    }

    pub fn solid_edit_hole(&self, payload: &str) -> String {
        self.with_request(payload, |manager, request: EditHoleRequest| {
            manager.prepare_edit_hole(request)
        })
    }

    pub fn solid_body_feature(&self, payload: &str) -> String {
        self.with_request(payload, |manager, request: BodyFeatureRequestDto| {
            manager.prepare_body_feature(request)
        })
    }

    pub fn solid_edit_body_feature(&self, payload: &str) -> String {
        self.with_request(payload, |manager, request: EditBodyFeatureRequest| {
            manager.prepare_edit_body_feature(request)
        })
    }

    pub fn solid_recompute(&self) -> String {
        self.execute(|manager| manager.prepare_recompute())
    }

    pub fn solid_set_rollback(&self, payload: &str) -> String {
        self.with_request(payload, |manager, request: SetRollbackRequest| {
            manager.prepare_set_rollback(request)
        })
    }

    pub fn solid_delete_feature(&self, payload: &str) -> String {
        self.with_request(payload, |manager, request: DeleteFeatureRequest| {
            manager.prepare_delete_feature(request)
        })
    }

    pub fn solid_reorder_feature(&self, payload: &str) -> String {
        self.with_request(payload, |manager, request: ReorderFeatureRequest| {
            manager.prepare_reorder_feature(request)
        })
    }

    pub fn project_load(&self, payload: &str) -> String {
        self.with_request(payload, |manager, model_json: String| {
            manager.prepare_load_project(model_json)
        })
    }

    pub fn project_new(&self) -> String {
        self.execute(SketchManager::prepare_new_project)
    }

    pub fn export_step(&self, payload: &str) -> Result<Vec<u8>, String> {
        let request: StepExportRequest = serde_json::from_str(payload)
            .map_err(|error| format!("bad request payload: {error}"))?;
        let workspace = self
            .inner
            .lock()
            .map_err(|_| "engine lock poisoned".to_string())?;
        let inner = workspace.active();
        if !inner.manager.solid_scene().errors.is_empty() {
            return Err("Resolve timeline errors before exporting STEP.".to_string());
        }
        inner
            .kernel
            .export_step(&request)
            .map_err(|error| error.to_string())
    }

    pub fn drawing_projection(&self, payload: &str) -> String {
        let request: DrawingProjectionRequest = match serde_json::from_str(payload) {
            Ok(request) => request,
            Err(error) => return err_json(format!("bad request payload: {error}")),
        };
        let workspace = match self.inner.lock() {
            Ok(workspace) => workspace,
            Err(_) => return err_json("engine lock poisoned"),
        };
        let inner = workspace.active();
        let scene = inner.manager.solid_scene();
        if !scene.errors.is_empty() {
            return err_json("Resolve timeline errors before generating a drawing view.");
        }
        match inner.kernel.drawing_projection(&request) {
            Ok(mut projection) => {
                match drawing_projection_anchors(&scene, &request, &projection) {
                    Ok(anchors) => {
                        projection.anchors = anchors;
                        match drawing_projection_circles(&scene, &request, &projection) {
                            Ok(circles) => {
                                projection.circles = circles;
                                ok_json(projection)
                            }
                            Err(error) => err_json(error.to_string()),
                        }
                    }
                    Err(error) => err_json(error.to_string()),
                }
            }
            Err(error) => err_json(error.to_string()),
        }
    }

    pub fn export_stl(&self, payload: &str) -> Result<Vec<u8>, String> {
        let request: nbcad_export::MeshExportRequest = serde_json::from_str(payload)
            .map_err(|error| format!("bad request payload: {error}"))?;
        let workspace = self
            .inner
            .lock()
            .map_err(|_| "engine lock poisoned".to_string())?;
        let inner = workspace.active();
        if !inner.manager.solid_scene().errors.is_empty() {
            return Err("Resolve timeline errors before exporting STL.".to_string());
        }
        let scene = inner.manager.solid_scene();
        let mut meshes = inner
            .kernel
            .tessellate_bodies(&request)
            .map_err(|error| error.to_string())?;
        for mesh in &mut meshes {
            if let Some(body) = scene.bodies.iter().find(|body| body.id == mesh.body_id) {
                mesh.name = body.name.clone();
            }
        }
        nbcad_export::write_stl(&meshes).map_err(|error| error.to_string())
    }

    pub fn export_3mf(&self, payload: &str) -> Result<Vec<u8>, String> {
        let request: nbcad_export::MeshExportRequest = serde_json::from_str(payload)
            .map_err(|error| format!("bad request payload: {error}"))?;
        let workspace = self
            .inner
            .lock()
            .map_err(|_| "engine lock poisoned".to_string())?;
        let inner = workspace.active();
        if !inner.manager.solid_scene().errors.is_empty() {
            return Err("Resolve timeline errors before exporting 3MF.".to_string());
        }
        let scene = inner.manager.solid_scene();
        let appearances = inner.manager.body_appearances();
        let mut meshes = inner
            .kernel
            .tessellate_bodies(&request)
            .map_err(|error| error.to_string())?;
        for mesh in &mut meshes {
            if let Some(body) = scene.bodies.iter().find(|body| body.id == mesh.body_id) {
                mesh.name = body.name.clone();
            }
        }
        nbcad_export::ExportFacade::export_3mf(&meshes, &appearances, &request)
            .map_err(|error| error.to_string())
    }

    fn with_request<T: DeserializeOwned>(
        &self,
        payload: &str,
        prepare: impl FnOnce(
            &mut SketchManager,
            T,
        ) -> Result<RecomputePlanDto, nbcad_sketch::SessionError>,
    ) -> String {
        let request = match serde_json::from_str(payload) {
            Ok(request) => request,
            Err(error) => return err_json(format!("bad request payload: {error}")),
        };
        self.execute(|manager| prepare(manager, request))
    }

    fn execute(
        &self,
        prepare: impl FnOnce(&mut SketchManager) -> Result<RecomputePlanDto, nbcad_sketch::SessionError>,
    ) -> String {
        let mut workspace = self.inner.lock().expect("engine lock poisoned");
        let inner = workspace.active_mut();
        let plan = match prepare(&mut inner.manager) {
            Ok(plan) => plan,
            Err(error) => return err_json(error.to_string()),
        };
        let transaction_id = plan.transaction_id;
        let kernel_scene = match inner.kernel.recompute(&plan) {
            Ok(scene) => scene,
            Err(error) => {
                inner.manager.cancel_solid_recompute(transaction_id);
                return err_json(error.to_string());
            }
        };
        match inner
            .manager
            .commit_solid(nbcad_solid::CommitKernelRequest {
                transaction_id,
                scene: kernel_scene,
            }) {
            Ok(update) => {
                inner.geometry_revision = inner.geometry_revision.wrapping_add(1);
                ok_json(update)
            }
            Err(error) => err_json(error.to_string()),
        }
    }
}

fn validate_session_id(session_id: &str) -> Result<(), String> {
    if session_id.is_empty() || session_id.len() > 128 {
        return Err("invalid project session id".to_string());
    }
    if session_id == BOOTSTRAP_SESSION_ID {
        return Err("reserved project session id".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn value(json: String) -> serde_json::Value {
        let envelope: serde_json::Value = serde_json::from_str(&json).expect("valid envelope");
        assert_eq!(envelope["ok"], true, "engine error: {envelope}");
        envelope["value"].clone()
    }

    #[test]
    fn project_sessions_retain_and_release_independent_documents() {
        let state = AppState::new();
        value(state.bind_project_session("tab-a"));
        value(state.engine_call("document_set_name", r#""Alpha""#));

        value(state.create_project_session("tab-b"));
        value(state.engine_call("document_set_name", r#""Beta""#));

        assert_eq!(value(state.activate_project_session("tab-a")), true);
        assert_eq!(state.document_snapshot().name, "Alpha");
        assert_eq!(value(state.activate_project_session("tab-b")), true);
        assert_eq!(state.document_snapshot().name, "Beta");

        value(state.activate_project_session("tab-a"));
        value(state.drop_project_session("tab-b"));
        assert_eq!(value(state.activate_project_session("tab-b")), false);
    }

    #[test]
    fn binding_recovered_bootstrap_session_preserves_the_solid_model() {
        let state = AppState::new();
        value(state.engine_call("begin_sketch", r#"{"type":"origin_plane","plane":"xy"}"#));
        value(state.engine_call(
            "add_rectangle",
            r#"{
                "mode":"two_point",
                "p1":{"x":-10.0,"y":-10.0},
                "p2":{"x":10.0,"y":10.0},
                "ctrl_held":false
            }"#,
        ));
        value(state.engine_call("end_sketch", ""));
        value(state.solid_extrude(
            r#"{
                "sketch_name":"Sketch1",
                "profile_indices":[0],
                "operation":"new_body",
                "extent":{"type":"distance","distance":10.0},
                "taper_angle_deg":0.0,
                "flip":false,
                "target_body_ids":[]
            }"#,
        ));

        let (before_id, before_revision, before_scene, _, _, _, _, _) = state.viewport_snapshot();
        assert_eq!(before_id, BOOTSTRAP_SESSION_ID);
        assert_eq!(before_scene.bodies.len(), 1);
        assert!(!before_scene.bodies[0].faces.is_empty());

        value(state.bind_project_session("recovered-tab"));
        let (after_id, after_revision, after_scene, _, _, _, _, _) = state.viewport_snapshot();
        assert_eq!(after_id, "recovered-tab");
        assert_eq!(after_revision, before_revision);
        assert_eq!(after_scene.bodies.len(), before_scene.bodies.len());
        assert_eq!(
            after_scene.bodies[0].mesh.indices,
            before_scene.bodies[0].mesh.indices
        );
        assert_eq!(
            after_scene.bodies[0].mesh.positions,
            before_scene.bodies[0].mesh.positions
        );
    }
}
