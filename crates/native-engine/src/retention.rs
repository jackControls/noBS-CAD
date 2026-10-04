//! Cold tabs retain the complete parametric model, never an incomplete kernel.
use super::*;

pub(super) enum NativeProject {
    Warm(Box<NativeEngine>),
    Cold {
        model: String,
        geometry_revision: u64,
        body_ids: Vec<nbcad_core::BodyId>,
        errors: Vec<nbcad_solid::KernelFeatureErrorDto>,
        sketches: nbcad_sketch::RetainedSketchSessions,
    },
}
impl NativeProject {
    pub(super) fn warm(&self) -> &NativeEngine {
        match self {
            Self::Warm(engine) => engine,
            Self::Cold { .. } => panic!("active project is cold"),
        }
    }
    pub(super) fn warm_mut(&mut self) -> &mut NativeEngine {
        match self {
            Self::Warm(engine) => engine,
            Self::Cold { .. } => panic!("active project is cold"),
        }
    }
    pub(super) fn thaw(&mut self) -> Result<(), String> {
        let Self::Cold {
            model,
            geometry_revision,
            body_ids,
            errors,
            sketches,
        } = self
        else {
            return Ok(());
        };
        let next_revision = geometry_revision
            .checked_add(1)
            .ok_or("Geometry revision exhausted")?;
        let mut next = NativeEngine::new()?;
        let plan = next
            .manager
            .prepare_load_project(model.clone())
            .map_err(|e| e.to_string())?;
        let transaction_id = plan.transaction_id;
        let scene = next.kernel.recompute(&plan).map_err(|e| e.to_string())?;
        next.manager
            .commit_solid(nbcad_solid::CommitKernelRequest {
                transaction_id,
                scene,
            })
            .map_err(|e| e.to_string())?;
        let rebuilt = next.manager.solid_scene_ref();
        let mut rebuilt_ids: Vec<_> = rebuilt.bodies.iter().map(|body| body.id).collect();
        rebuilt_ids.sort_unstable();
        if rebuilt_ids != *body_ids || rebuilt.errors != *errors {
            return Err("Cold document reconstruction changed its bodies or feature errors; its snapshot is retained".into());
        }
        next.manager
            .restore_sketch_session_retention(sketches)
            .map_err(|error| error.to_string())?;
        next.geometry_revision = next_revision;
        // Install only after successful replay/commit; errors keep the snapshot.
        *self = Self::Warm(Box::new(next));
        Ok(())
    }
}
impl NativeEngineHost {
    /// Caller holds the native document receipt fence. Active sketches and the
    /// active tab are protected; snapshot failures retain the entire warm engine.
    pub fn evict_inactive_project_session(&self, id: &str) -> Result<bool, String> {
        let mut workspace = self.inner.lock().map_err(|_| "Engine lock poisoned")?;
        if workspace.active_session_id == id {
            return Ok(false);
        }
        let Some(project) = workspace.sessions.get_mut(id) else {
            return Ok(false);
        };
        let NativeProject::Warm(engine) = project else {
            return Ok(false);
        };
        if engine.manager.has_active_sketch() {
            return Ok(false);
        }
        let model = engine
            .manager
            .export_project_model()
            .map_err(|e| e.to_string())?;
        let geometry_revision = engine.geometry_revision;
        let scene = engine.manager.solid_scene_ref();
        let mut body_ids: Vec<_> = scene.bodies.iter().map(|body| body.id).collect();
        body_ids.sort_unstable();
        let errors = scene.errors.clone();
        let sketches = engine
            .manager
            .take_sketch_session_retention()
            .map_err(|error| error.to_string())?;
        *project = NativeProject::Cold {
            model,
            geometry_revision,
            body_ids,
            errors,
            sketches,
        };
        Ok(true)
    }
    pub fn can_evict_project_session(&self, id: &str) -> bool {
        let workspace = self.inner.lock().expect("engine lock poisoned");
        workspace.active_session_id != id
            && matches!(workspace.sessions.get(id),
            Some(NativeProject::Warm(engine)) if !engine.manager.has_active_sketch())
    }
    pub fn cold_project_sessions(&self) -> Vec<String> {
        self.inner
            .lock()
            .expect("engine lock poisoned")
            .sessions
            .iter()
            .filter(|(_, project)| matches!(project, NativeProject::Cold { .. }))
            .map(|(id, _)| id.clone())
            .collect()
    }
}

#[cfg(all(test, feature = "native-occt"))]
#[path = "retention/tests.rs"]
mod tests;
