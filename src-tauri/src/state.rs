use std::sync::Mutex;

use nbcad_core::DocumentDto;
use nbcad_occt::OcctKernel;
use nbcad_sketch::{err_json, host, ok_json, SketchDto, SketchManager};
use nbcad_solid::{
    BodyFeatureRequestDto, DatumPlaneDefinitionDto, DeleteFeatureRequest, EditBodyFeatureRequest,
    EditExtrudeRequest, EditHoleRequest, EditLoftRequest, EditRevolveRequest, EditRibRequest,
    EditSolidChamferRequest, EditSolidFilletRequest, EditSweepRequest, ExtrudeRequest, HoleRequest,
    LoftRequest, RecomputePlanDto, ReorderFeatureRequest, RevolveRequest, RibRequest,
    SetRollbackRequest, SolidChamferRequest, SolidFilletRequest, SolidSceneDto, StepExportRequest,
    SweepRequest,
};
use serde::de::DeserializeOwned;

struct NativeEngine {
    manager: SketchManager,
    kernel: OcctKernel,
}

/// Native application state: the shared Rust document/history manager plus
/// the stateful OCCT B-rep bridge. The whole pair is locked together so a
/// prepare → kernel replay → commit transaction cannot interleave.
pub struct AppState {
    inner: Mutex<NativeEngine>,
}

impl AppState {
    pub fn new() -> Self {
        let kernel = OcctKernel::new().expect("native OCCT kernel failed to initialize");
        Self {
            inner: Mutex::new(NativeEngine {
                manager: SketchManager::new(),
                kernel,
            }),
        }
    }

    pub fn document_snapshot(&self) -> DocumentDto {
        self.inner
            .lock()
            .expect("engine lock poisoned")
            .manager
            .document_dto()
    }

    /// One lock acquisition gives the native viewport a coherent model
    /// snapshot. The OCCT triangle buffers stay in Rust and never make a
    /// JSON/IPC round-trip through the webview.
    pub fn viewport_snapshot(
        &self,
    ) -> (
        SolidSceneDto,
        Option<SketchDto>,
        Vec<SketchDto>,
        Vec<DatumPlaneDefinitionDto>,
    ) {
        let inner = self.inner.lock().expect("engine lock poisoned");
        (
            inner.manager.solid_scene(),
            inner.manager.active_snapshot(),
            inner.manager.finished_sketches(),
            inner.manager.datum_plane_definitions(),
        )
    }

    pub fn engine_call(&self, method: &str, payload: &str) -> String {
        let mut inner = self.inner.lock().expect("engine lock poisoned");
        host::handle(&mut inner.manager, method, payload)
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
        let inner = self
            .inner
            .lock()
            .map_err(|_| "engine lock poisoned".to_string())?;
        if !inner.manager.solid_scene().errors.is_empty() {
            return Err("Resolve timeline errors before exporting STEP.".to_string());
        }
        inner
            .kernel
            .export_step(&request)
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
        let mut inner = self.inner.lock().expect("engine lock poisoned");
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
            Ok(update) => ok_json(update),
            Err(error) => err_json(error.to_string()),
        }
    }
}
