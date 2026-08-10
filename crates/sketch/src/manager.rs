//! Sketch manager: owns the document plus the sketch-session lifecycle
//! (`begin_sketch` / `end_sketch`) and routes drawing ops to the active
//! session. This is the object both engine hosts (Tauri, WASM) hold.

use std::collections::{BTreeMap, BTreeSet};
use std::f64::consts::TAU;

use nbcad_core::{
    BodyAppearance, BodyId, BrowserNodeKind, Document, DocumentDto, EdgeId, FaceId, Feature,
    FeatureId, FeatureKind, FeatureStatus, PlaneBasis, PlaneRef, DEFAULT_MATERIAL_NAME,
};
use nbcad_solid::{
    extract_closed_loops_allow_open, BodyFeatureDefinitionDto, BodyFeatureRequestDto,
    CommitKernelRequest, DatumPlaneDefinitionDto, DatumPlaneRequest, DatumPlaneSourceDto,
    DatumPlaneUpdateDto, DeleteFeatureRequest, EditBodyFeatureRequest, EditDatumPlaneRequest,
    EditExtrudeRequest, EditHoleRequest, EditLoftRequest, EditRevolveRequest, EditRibRequest,
    EditSolidChamferRequest, EditSolidFilletRequest, EditSweepRequest, ExtrudeDefinitionDto,
    ExtrudeExtent, ExtrudeOperation, ExtrudeRequest, HoleDefinitionDto, HoleRequest,
    LoftDefinitionDto, LoftRequest, Point2Dto, Point3Dto, ProfileCatalogItemDto, ProfileCurveDto,
    ProfileLoopDto, RecomputePlanDto, ReorderFeatureRequest, RevolveDefinitionDto, RevolveRequest,
    RibDefinitionDto, RibExtent, RibRequest, Segment2, SetRollbackRequest, SketchLineDto,
    SketchPathCurveDto, SketchPointKindDto, SketchReferencePointDto, SolidChamferDefinitionDto,
    SolidChamferRequest, SolidDocument, SolidFilletDefinitionDto, SolidFilletRequest,
    SolidSceneDto, SolidUpdateDto, SweepDefinitionDto, SweepRequest,
};

use crate::constraint::{Constraint, ConstraintId};
use crate::drawing::DrawingDocumentDto;
use crate::dto::{
    AddConstraintResult, AddLineResult, Arc3PointRequest, ArcCenterRequest, BeginSketchRequest,
    BreakRequest, ChamferRequest, CircleRequest, CircularPatternRequest, ConstraintBatchRequest,
    DeleteEntityResult, DimensionRequest, EditDimensionRequest, EndSketchResult,
    EvalExpressionRequest, EvalExpressionResult, ExtendRequest, FaceSketchOrigin, FilletPreviewDto,
    FilletRequest, LockedCircleRequest, LockedRectangleRequest, LockedSegmentRequest,
    MidpointLineRequest, MirrorRequest, MoveCopyRequest, MoveDimensionRequest, MovePointRequest,
    MovePointResult, OffsetPreviewDto, OffsetRequest, PointRequest, PolygonRequest, PreviewDto,
    ProjectVisibilityDto, RectangleRequest, RectangularPatternRequest, ScaleRequest,
    SegmentRequest, SetDimensionStyleRequest, SetGridSnapRequest, SetGridStepRequest, SketchDto,
    SlotRequest, SplineRequest, ToggleFixBatchRequest, ToolResult, TrimPreviewDto, TrimRequest,
    UndoResult,
};
use crate::entity::EntityId;
use crate::project::{
    decode_project, ProjectCountersV2, ProjectDocumentV2, ProjectModelV2, ProjectPreferencesV2,
    PROJECT_FORMAT, PROJECT_SCHEMA_VERSION,
};
use crate::session::{
    SessionError, SketchSession, GRID_STEP_MM, MAX_GRID_STEP_MM, MIN_GRID_STEP_MM,
};

/// A sketch that has been finished and is kept in the document. The full
/// session is retained (M1d): it renders muted in 3D and re-enters editing
/// via `edit_sketch` with entities, constraints, dimensions, and undo
/// intact.
#[derive(Debug)]
pub struct FinishedSketch {
    session: SketchSession,
    feature_id: FeatureId,
}

/// Document + sketch-session state shared by both hosts (D8).
#[derive(Debug)]
pub struct SketchManager {
    document: Document,
    active: Option<SketchSession>,
    active_feature_id: Option<FeatureId>,
    finished: Vec<FinishedSketch>,
    solids: SolidDocument,
    datum_planes: Vec<DatumPlaneDefinitionDto>,
    next_datum_id: u64,
    sketch_count: u32,
    extrude_count: u32,
    revolve_count: u32,
    sweep_count: u32,
    loft_count: u32,
    rib_count: u32,
    fillet_count: u32,
    chamfer_count: u32,
    hole_count: u32,
    /// Grid-snap preference applied to new sessions (Sketch Palette "Snap").
    grid_snap: bool,
    /// View-dependent grid spacing supplied by the viewport. This is runtime
    /// state rather than project state: reopening at a different zoom must
    /// choose the spacing appropriate for that view.
    grid_step: f64,
    /// Per-body color/material for viewport and manufacturing export.
    body_appearances: Vec<BodyAppearance>,
    /// Persistent technical-drawing sheets and view definitions.
    drawings: DrawingDocumentDto,
    /// Persistent Browser visibility expressed with stable model identities.
    project_visibility: ProjectVisibilityDto,
    /// Candidate manager held until its OCCT replay commits successfully.
    /// Keeping the current manager alive makes Open transactional.
    pending_project: Option<PendingProject>,
}

#[derive(Debug)]
struct PendingProject {
    transaction_id: u64,
    manager: Box<SketchManager>,
}

impl SketchManager {
    pub fn new() -> Self {
        Self {
            document: Document::new("Untitled"),
            active: None,
            active_feature_id: None,
            finished: Vec::new(),
            solids: SolidDocument::new(),
            datum_planes: Vec::new(),
            next_datum_id: 1,
            sketch_count: 0,
            extrude_count: 0,
            revolve_count: 0,
            sweep_count: 0,
            loft_count: 0,
            rib_count: 0,
            fillet_count: 0,
            chamfer_count: 0,
            hole_count: 0,
            grid_snap: true,
            grid_step: GRID_STEP_MM,
            body_appearances: Vec::new(),
            drawings: DrawingDocumentDto::default(),
            project_visibility: ProjectVisibilityDto::default(),
            pending_project: None,
        }
    }

    pub fn document(&self) -> &Document {
        &self.document
    }

    pub fn document_dto(&self) -> DocumentDto {
        DocumentDto::from(&self.document)
    }

    pub fn set_document_name(&mut self, name: String) -> Result<DocumentDto, SessionError> {
        let name = name.trim();
        if name.is_empty() {
            return Err(SessionError::Solid(
                "document name cannot be empty".to_string(),
            ));
        }
        self.document.set_name(name);
        Ok(self.document_dto())
    }

    /// Serialize the authoritative parametric model. Tessellation and B-reps
    /// are intentionally excluded and are regenerated on Open.
    pub fn export_project_model(&self) -> Result<String, SessionError> {
        if self.active.is_some() {
            return Err(SessionError::Solid(
                "finish the active sketch before saving the project".to_string(),
            ));
        }
        let model = ProjectModelV2 {
            format: PROJECT_FORMAT.to_string(),
            schema_version: PROJECT_SCHEMA_VERSION,
            document: ProjectDocumentV2 {
                name: self.document.name().to_string(),
                settings: self.document.settings().clone(),
                history: self.document.features().clone(),
            },
            sketches: self
                .finished
                .iter()
                .map(|finished| finished.session.project_state(finished.feature_id))
                .collect(),
            extrudes: self.solids.definitions().to_vec(),
            revolves: self.solids.revolve_definitions().to_vec(),
            sweeps: self.solids.sweep_definitions().to_vec(),
            lofts: self.solids.loft_definitions().to_vec(),
            ribs: self.solids.rib_definitions().to_vec(),
            fillets: self.solids.fillet_definitions().to_vec(),
            chamfers: self.solids.chamfer_definitions().to_vec(),
            holes: self.solids.hole_definitions().to_vec(),
            datum_planes: self.datum_planes.clone(),
            body_features: self.solids.body_feature_definitions().to_vec(),
            body_appearances: self.scrubbed_body_appearances(),
            drawings: self.drawings.clone(),
            visibility: self.scrubbed_project_visibility(),
            counters: ProjectCountersV2 {
                sketch: self.sketch_count,
                extrude: self.extrude_count,
                revolve: self.revolve_count,
                sweep: self.sweep_count,
                loft: self.loft_count,
                rib: self.rib_count,
                fillet: self.fillet_count,
                chamfer: self.chamfer_count,
                hole: self.hole_count,
            },
            preferences: ProjectPreferencesV2 {
                grid_snap: self.grid_snap,
            },
        };
        serde_json::to_string_pretty(&model)
            .map_err(|error| SessionError::Solid(format!("could not serialize project: {error}")))
    }

    /// Prepare a fresh untitled project through the same transactional replay
    /// path as Open. The current project remains intact until the host kernel
    /// accepts and commits the empty scene.
    pub fn prepare_new_project(&mut self) -> Result<RecomputePlanDto, SessionError> {
        let model_json = SketchManager::new().export_project_model()?;
        self.prepare_load_project(model_json)
    }

    /// Parse and validate `model.json`, construct a candidate document, and
    /// return its full-replay plan. The current document is only replaced
    /// after the kernel scene commits.
    pub fn prepare_load_project(
        &mut self,
        model_json: String,
    ) -> Result<RecomputePlanDto, SessionError> {
        if self.pending_project.is_some() {
            return Err(SessionError::Solid(
                "a project open is already pending".to_string(),
            ));
        }
        let model = decode_project(&model_json).map_err(SessionError::Solid)?;
        let mut document = Document::new(model.document.name);
        document.restore_history(model.document.settings, model.document.history);

        let feature_order = document
            .features()
            .features
            .iter()
            .enumerate()
            .map(|(index, feature)| (feature.id, index))
            .collect::<std::collections::HashMap<_, _>>();
        let mut datum_planes = model.datum_planes;
        datum_planes.sort_by_key(|plane| feature_order[&plane.feature_id]);
        for plane in &datum_planes {
            document.add_construction_plane_node(plane.datum_id.0, &plane.name);
        }
        let mut saved_sketches = model.sketches;
        saved_sketches.sort_by_key(|sketch| feature_order[&sketch.feature_id]);
        let mut finished = Vec::with_capacity(saved_sketches.len());
        for saved in saved_sketches {
            let feature_id = saved.feature_id;
            let session = SketchSession::from_project_state(saved)?;
            document.add_browser_child(
                BrowserNodeKind::SketchesFolder,
                BrowserNodeKind::Sketch,
                session.name(),
            );
            finished.push(FinishedSketch {
                session,
                feature_id,
            });
        }

        let solids = SolidDocument::restore_feature_definitions(
            model.extrudes,
            model.revolves,
            model.sweeps,
            model.lofts,
            model.ribs,
            model.fillets,
            model.chamfers,
            model.holes,
            model.body_features,
        )
        .map_err(|error| SessionError::Solid(error.to_string()))?;
        let mut candidate = SketchManager {
            document,
            active: None,
            active_feature_id: None,
            finished,
            solids,
            next_datum_id: datum_planes
                .iter()
                .map(|plane| plane.datum_id.0)
                .max()
                .unwrap_or(0)
                .saturating_add(1)
                .max(1),
            datum_planes,
            sketch_count: model.counters.sketch,
            extrude_count: model.counters.extrude,
            revolve_count: model.counters.revolve,
            sweep_count: model.counters.sweep,
            loft_count: model.counters.loft,
            rib_count: model.counters.rib,
            fillet_count: model.counters.fillet,
            chamfer_count: model.counters.chamfer,
            hole_count: model.counters.hole,
            grid_snap: model.preferences.grid_snap,
            grid_step: GRID_STEP_MM,
            body_appearances: model.body_appearances,
            drawings: model.drawings,
            project_visibility: model.visibility,
            pending_project: None,
        };
        candidate.sketch_count = candidate
            .sketch_count
            .max(max_numbered_name(&candidate.finished, "Sketch"));
        candidate.extrude_count = candidate
            .extrude_count
            .max(max_feature_number(&candidate.document, "Extrude"));
        candidate.revolve_count = candidate
            .revolve_count
            .max(max_feature_number(&candidate.document, "Revolve"));
        candidate.sweep_count = candidate
            .sweep_count
            .max(max_feature_number(&candidate.document, "Sweep"));
        candidate.loft_count = candidate
            .loft_count
            .max(max_feature_number(&candidate.document, "Loft"));
        candidate.rib_count = candidate
            .rib_count
            .max(max_feature_number(&candidate.document, "Rib"));
        candidate.fillet_count = candidate
            .fillet_count
            .max(max_feature_number(&candidate.document, "Fillet"));
        candidate.chamfer_count = candidate
            .chamfer_count
            .max(max_feature_number(&candidate.document, "Chamfer"));
        candidate.hole_count = candidate
            .hole_count
            .max(max_feature_number(&candidate.document, "Hole"));
        let feature_order = candidate
            .document
            .features()
            .features
            .iter()
            .map(|feature| feature.id)
            .collect::<Vec<_>>();
        candidate
            .solids
            .set_feature_order(&feature_order)
            .map_err(|error| SessionError::Solid(error.to_string()))?;
        let active = candidate.active_feature_ids();
        let catalog = candidate.profile_catalog();
        let plan = candidate
            .solids
            .prepare_recompute_resilient(&catalog, &active)
            .map_err(|error| SessionError::Solid(error.to_string()))?;
        self.pending_project = Some(PendingProject {
            transaction_id: plan.transaction_id,
            manager: Box::new(candidate),
        });
        Ok(plan)
    }

    /// Start a sketch on `plane`: names it "Sketch1", "Sketch2", … and
    /// registers it in the browser tree under Sketches.
    pub fn begin_sketch(&mut self, plane: PlaneRef) -> Result<SketchDto, SessionError> {
        self.begin_sketch_with_options(BeginSketchRequest {
            plane,
            face_origin: FaceSketchOrigin::SupportOrigin,
        })
    }

    /// Start a sketch with an explicit coordinate-zero policy for planar
    /// faces. Origin datum planes ignore `face_origin`.
    pub fn begin_sketch_with_options(
        &mut self,
        request: BeginSketchRequest,
    ) -> Result<SketchDto, SessionError> {
        if self.active.is_some() {
            return Err(SessionError::SketchAlreadyActive);
        }
        let plane = request.plane;
        let basis = match plane {
            PlaneRef::OriginPlane { .. } => plane
                .origin_basis()
                .map_err(|_| SessionError::UnsupportedPlane)?,
            PlaneRef::PlanarFace { face_id } => {
                let mut basis = self.solids.face_basis(face_id).ok_or_else(|| {
                    SessionError::BrokenReference(format!(
                        "face {} no longer exists or is not planar",
                        face_id.0
                    ))
                })?;
                basis.origin = match request.face_origin {
                    FaceSketchOrigin::SupportOrigin => basis.origin,
                    FaceSketchOrigin::FaceCenter => {
                        self.solids.face_center(face_id).unwrap_or(basis.origin)
                    }
                    FaceSketchOrigin::GlobalOriginProjection => {
                        let normal_offset = basis.origin[0] * basis.normal[0]
                            + basis.origin[1] * basis.normal[1]
                            + basis.origin[2] * basis.normal[2];
                        [
                            basis.normal[0] * normal_offset,
                            basis.normal[1] * normal_offset,
                            basis.normal[2] * normal_offset,
                        ]
                    }
                };
                basis
            }
            PlaneRef::DatumPlane { datum_id } => self
                .resolve_datum_basis(datum_id, &self.active_feature_ids())
                .ok_or_else(|| {
                    SessionError::BrokenReference(format!(
                        "construction plane {} is missing or rolled back",
                        datum_id.0
                    ))
                })?,
        };
        self.sketch_count += 1;
        let name = format!("Sketch{}", self.sketch_count);
        self.document.add_browser_child(
            BrowserNodeKind::SketchesFolder,
            BrowserNodeKind::Sketch,
            &name,
        );
        let mut session = SketchSession::new(name, plane, basis, self.grid_snap);
        if let PlaneRef::PlanarFace { face_id } = plane {
            session.set_reference_midpoints(support_edge_midpoints(&self.solids, face_id, basis));
        }
        // Palette "Snap" master state applies to new sessions too.
        session.set_grid_snap(self.grid_snap);
        session.set_grid_step(self.grid_step)?;
        let dto = session.dto();
        let feature_id = self
            .document
            .add_feature(dto.name.clone(), FeatureKind::Sketch);
        self.active_feature_id = Some(feature_id);
        self.active = Some(session);
        Ok(dto)
    }

    /// Finish the active sketch. The sketch stays in the browser tree with
    /// its full session (entities, constraints, dimensions, undo stack) so
    /// it can render in 3D and be re-entered via `edit_sketch` (M1d).
    pub fn end_sketch(&mut self) -> Result<EndSketchResult, SessionError> {
        let session = self.active.take().ok_or(SessionError::NoActiveSketch)?;
        let feature_id = self.active_feature_id.take().ok_or_else(|| {
            SessionError::Solid("active sketch has no history feature".to_string())
        })?;
        self.finished.push(FinishedSketch {
            session,
            feature_id,
        });
        Ok(EndSketchResult {
            document: self.document_dto(),
        })
    }

    /// DTOs of every finished sketch (M1d): rendered muted in 3D on their
    /// planes and listed for re-edit.
    pub fn finished_sketches(&self) -> Vec<SketchDto> {
        self.finished.iter().map(|f| f.session.dto()).collect()
    }

    /// Re-enter a finished sketch for editing (M1d): moves the session back
    /// to active, preserving entities, constraints, dimensions, and undo.
    pub fn edit_sketch(&mut self, name: &str) -> Result<SketchDto, SessionError> {
        if self.active.is_some() {
            return Err(SessionError::SketchAlreadyActive);
        }
        let index = self
            .finished
            .iter()
            .position(|f| f.session.name() == name)
            .ok_or_else(|| SessionError::SketchNotFound(name.to_string()))?;
        let mut f = self.finished.remove(index);
        f.session.set_grid_snap(self.grid_snap);
        f.session.set_grid_step(self.grid_step)?;
        if let PlaneRef::PlanarFace { face_id } = f.session.plane() {
            f.session.set_reference_midpoints(support_edge_midpoints(
                &self.solids,
                face_id,
                f.session.basis(),
            ));
        } else {
            f.session.set_reference_midpoints(Vec::new());
        }
        let dto = f.session.dto();
        self.active_feature_id = Some(f.feature_id);
        self.active = Some(f.session);
        Ok(dto)
    }

    pub fn active_snapshot(&self) -> Option<SketchDto> {
        self.active.as_ref().map(SketchSession::dto)
    }

    pub fn has_active_sketch(&self) -> bool {
        self.active.is_some()
    }

    // --- Solid feature history / recompute contract (M2) ---

    pub fn profile_catalog(&self) -> Vec<ProfileCatalogItemDto> {
        self.finished
            .iter()
            .map(|finished| profile_catalog_item(&finished.session.dto(), finished.feature_id))
            .collect()
    }

    pub fn solid_scene(&self) -> SolidSceneDto {
        self.solids.scene().clone()
    }

    pub fn body_appearances(&self) -> Vec<BodyAppearance> {
        self.body_appearances.clone()
    }

    pub fn drawing_document(&self) -> DrawingDocumentDto {
        self.drawings.clone()
    }

    pub fn project_visibility(&self) -> ProjectVisibilityDto {
        self.scrubbed_project_visibility()
    }

    pub fn set_project_visibility(
        &mut self,
        visibility: ProjectVisibilityDto,
    ) -> Result<ProjectVisibilityDto, SessionError> {
        self.project_visibility = visibility;
        self.scrub_project_visibility();
        Ok(self.project_visibility.clone())
    }

    pub fn set_drawing_document(
        &mut self,
        drawing: DrawingDocumentDto,
    ) -> Result<DrawingDocumentDto, SessionError> {
        drawing.validate().map_err(SessionError::Solid)?;
        self.drawings = drawing;
        Ok(self.drawings.clone())
    }

    pub fn set_body_appearance(
        &mut self,
        appearance: BodyAppearance,
    ) -> Result<Vec<BodyAppearance>, SessionError> {
        if appearance.body_id.0 == 0 {
            return Err(SessionError::Solid(
                "body appearance requires a non-zero body id".to_string(),
            ));
        }
        let material_name = appearance.material_name.trim();
        let material_name = if material_name.is_empty() {
            DEFAULT_MATERIAL_NAME.to_string()
        } else {
            material_name.to_string()
        };
        let next = BodyAppearance {
            body_id: appearance.body_id,
            color: appearance.color,
            material_name,
            filament_type: {
                let value = appearance.filament_type.trim();
                if value.is_empty() {
                    nbcad_core::DEFAULT_FILAMENT_TYPE.to_string()
                } else {
                    value.to_string()
                }
            },
            brand: {
                let value = appearance.brand.trim();
                if value.is_empty() {
                    nbcad_core::DEFAULT_BRAND.to_string()
                } else {
                    value.to_string()
                }
            },
            color_name: appearance.color_name.trim().to_string(),
            filament_id: appearance
                .filament_id
                .map(|id| id.trim().to_string())
                .filter(|id| !id.is_empty()),
            preset_id: appearance
                .preset_id
                .map(|id| id.trim().to_string())
                .filter(|id| !id.is_empty()),
            density_g_cm3: appearance
                .density_g_cm3
                .filter(|d| d.is_finite() && *d > 0.0),
            diameter_mm: if appearance.diameter_mm.is_finite() && appearance.diameter_mm > 0.0 {
                appearance.diameter_mm
            } else {
                nbcad_core::DEFAULT_FILAMENT_DIAMETER_MM
            },
        };
        if let Some(existing) = self
            .body_appearances
            .iter_mut()
            .find(|entry| entry.body_id == next.body_id)
        {
            *existing = next;
        } else {
            self.body_appearances.push(next);
        }
        self.body_appearances.sort_by_key(|entry| entry.body_id.0);
        Ok(self.body_appearances.clone())
    }

    fn scrubbed_body_appearances(&self) -> Vec<BodyAppearance> {
        let live: BTreeSet<_> = self
            .solids
            .scene()
            .bodies
            .iter()
            .map(|body| body.id)
            .collect();
        let mut kept: Vec<_> = self
            .body_appearances
            .iter()
            .filter(|entry| live.contains(&entry.body_id))
            .cloned()
            .collect();
        kept.sort_by_key(|entry| entry.body_id.0);
        kept
    }

    fn scrub_body_appearances(&mut self) {
        self.body_appearances = self.scrubbed_body_appearances();
    }

    fn scrubbed_project_visibility(&self) -> ProjectVisibilityDto {
        let live_bodies = self
            .solids
            .scene()
            .bodies
            .iter()
            .map(|body| body.id.0)
            .collect::<BTreeSet<_>>();
        let live_datums = self
            .datum_planes
            .iter()
            .map(|plane| plane.datum_id.0)
            .collect::<BTreeSet<_>>();
        let live_sketches = self
            .finished
            .iter()
            .map(|sketch| sketch.session.name().to_string())
            .collect::<BTreeSet<_>>();

        let mut hidden_body_ids = self
            .project_visibility
            .hidden_body_ids
            .iter()
            .copied()
            .filter(|id| live_bodies.contains(id))
            .collect::<Vec<_>>();
        hidden_body_ids.sort_unstable();
        hidden_body_ids.dedup();

        let mut hidden_datum_plane_ids = self
            .project_visibility
            .hidden_datum_plane_ids
            .iter()
            .copied()
            .filter(|id| live_datums.contains(id))
            .collect::<Vec<_>>();
        hidden_datum_plane_ids.sort_unstable();
        hidden_datum_plane_ids.dedup();

        let mut hidden_sketch_names = self
            .project_visibility
            .hidden_sketch_names
            .iter()
            .map(|name| name.trim())
            .filter(|name| !name.is_empty() && live_sketches.contains(*name))
            .map(str::to_string)
            .collect::<Vec<_>>();
        hidden_sketch_names.sort();
        hidden_sketch_names.dedup();

        ProjectVisibilityDto {
            hidden_body_ids,
            hidden_datum_plane_ids,
            hidden_sketch_names,
        }
    }

    fn scrub_project_visibility(&mut self) {
        self.project_visibility = self.scrubbed_project_visibility();
    }

    pub fn extrude_definitions(&self) -> Vec<ExtrudeDefinitionDto> {
        self.solids.definitions().to_vec()
    }

    pub fn revolve_definitions(&self) -> Vec<RevolveDefinitionDto> {
        self.solids.revolve_definitions().to_vec()
    }

    pub fn sweep_definitions(&self) -> Vec<SweepDefinitionDto> {
        self.solids.sweep_definitions().to_vec()
    }

    pub fn loft_definitions(&self) -> Vec<LoftDefinitionDto> {
        self.solids.loft_definitions().to_vec()
    }

    pub fn rib_definitions(&self) -> Vec<RibDefinitionDto> {
        self.solids.rib_definitions().to_vec()
    }

    pub fn fillet_definitions(&self) -> Vec<SolidFilletDefinitionDto> {
        self.solids.fillet_definitions().to_vec()
    }

    pub fn chamfer_definitions(&self) -> Vec<SolidChamferDefinitionDto> {
        self.solids.chamfer_definitions().to_vec()
    }

    pub fn hole_definitions(&self) -> Vec<HoleDefinitionDto> {
        self.solids.hole_definitions().to_vec()
    }

    pub fn datum_plane_definitions(&self) -> Vec<DatumPlaneDefinitionDto> {
        self.datum_planes.clone()
    }

    pub fn body_feature_definitions(&self) -> Vec<BodyFeatureDefinitionDto> {
        self.solids.body_feature_definitions().to_vec()
    }

    pub fn create_datum_plane(
        &mut self,
        mut request: DatumPlaneRequest,
    ) -> Result<DatumPlaneUpdateDto, SessionError> {
        self.ensure_no_active_sketch("creating a construction plane")?;
        let active = self.active_feature_ids();
        let basis = resolve_datum_source(
            &self.solids,
            &self.datum_planes,
            &active,
            &mut request.source,
        )?;
        let feature_id = self.document.alloc_feature_id();
        let next_number = max_feature_number(&self.document, "Plane") + 1;
        let name = format!("Plane{next_number}");
        let datum_id = FaceId(self.next_datum_id);
        self.next_datum_id += 1;
        self.datum_planes.push(DatumPlaneDefinitionDto {
            feature_id,
            name: name.clone(),
            datum_id,
            source: request.source,
            basis,
        });
        self.document.add_construction_plane_node(datum_id.0, &name);
        self.document.push_feature(Feature::new(
            feature_id,
            name,
            FeatureKind::ConstructionPlane,
        ));
        Ok(DatumPlaneUpdateDto {
            document: self.document_dto(),
            planes: self.datum_planes.clone(),
        })
    }

    pub fn edit_datum_plane(
        &mut self,
        mut request: EditDatumPlaneRequest,
    ) -> Result<DatumPlaneUpdateDto, SessionError> {
        self.ensure_no_active_sketch("editing a construction plane")?;
        let active = self.active_feature_ids();
        let definition_index = self
            .datum_planes
            .iter()
            .position(|definition| definition.feature_id == request.feature_id)
            .ok_or_else(|| {
                SessionError::Solid(format!(
                    "construction plane feature {} was not found",
                    request.feature_id.0
                ))
            })?;
        // A parametric feature may only depend on construction planes that
        // precede it in history. Besides preventing cycles, this ensures a
        // rollback never leaves a plane silently reading a future basis.
        let feature_order = self
            .document
            .features()
            .features
            .iter()
            .enumerate()
            .map(|(index, feature)| (feature.id, index))
            .collect::<BTreeMap<_, _>>();
        let current_position = feature_order
            .get(&request.feature_id)
            .copied()
            .unwrap_or(usize::MAX);
        let prior_planes = self
            .datum_planes
            .iter()
            .filter(|plane| {
                feature_order
                    .get(&plane.feature_id)
                    .is_some_and(|position| *position < current_position)
            })
            .cloned()
            .collect::<Vec<_>>();
        let basis = resolve_datum_source(
            &self.solids,
            &prior_planes,
            &active,
            &mut request.plane.source,
        )?;
        let definition = &mut self.datum_planes[definition_index];
        definition.source = request.plane.source;
        definition.basis = basis;
        let errors = self.refresh_datum_planes(&active);
        for feature in &mut self.document.features_mut().features {
            if feature.kind == FeatureKind::ConstructionPlane {
                feature.status = FeatureStatus::Ok;
            }
        }
        for (feature_id, message) in errors {
            self.document
                .set_feature_status(feature_id, FeatureStatus::Error { message });
        }
        Ok(DatumPlaneUpdateDto {
            document: self.document_dto(),
            planes: self.datum_planes.clone(),
        })
    }

    pub fn prepare_body_feature(
        &mut self,
        request: BodyFeatureRequestDto,
    ) -> Result<RecomputePlanDto, SessionError> {
        self.ensure_no_active_sketch("creating a body operation")?;
        let request = self.hydrate_body_feature_plane(request)?;
        let (kind, prefix) = body_feature_kind(&request);
        let feature_id = self.document.alloc_feature_id();
        let next_number = max_feature_number(&self.document, prefix) + 1;
        let name = format!("{prefix}{next_number}");
        let mut active = self.active_feature_ids_at(self.document.features().len());
        active.insert(feature_id);
        let plan = self
            .solids
            .prepare_add_body_feature(feature_id, &name, request, &self.profile_catalog(), &active)
            .map_err(|error| SessionError::Solid(error.to_string()))?;
        self.document
            .push_feature(Feature::new(feature_id, name, kind));
        Ok(plan)
    }

    pub fn prepare_edit_body_feature(
        &mut self,
        request: EditBodyFeatureRequest,
    ) -> Result<RecomputePlanDto, SessionError> {
        self.ensure_no_active_sketch("editing a body operation")?;
        self.validate_active_sketch_references()?;
        let feature = self
            .document
            .features()
            .features
            .iter()
            .find(|feature| feature.id == request.feature_id)
            .ok_or_else(|| {
                SessionError::Solid(format!("feature {} was not found", request.feature_id.0))
            })?;
        let hydrated = self.hydrate_body_feature_plane(request.feature)?;
        let (kind, _) = body_feature_kind(&hydrated);
        if feature.kind != kind {
            return Err(SessionError::Solid(
                "a body feature cannot be edited into a different operation type".to_string(),
            ));
        }
        let active = self.active_feature_ids();
        self.solids
            .prepare_edit_body_feature(
                request.feature_id,
                hydrated,
                &self.profile_catalog(),
                &active,
            )
            .map_err(|error| SessionError::Solid(error.to_string()))
    }

    fn hydrate_body_feature_plane(
        &self,
        request: BodyFeatureRequestDto,
    ) -> Result<BodyFeatureRequestDto, SessionError> {
        Ok(match request {
            BodyFeatureRequestDto::Mirror(mut mirror) => {
                mirror.plane_basis = Some(self.resolve_plane_basis(mirror.plane)?);
                BodyFeatureRequestDto::Mirror(mirror)
            }
            BodyFeatureRequestDto::SplitBody(mut split) => {
                split.plane_basis = Some(self.resolve_plane_basis(split.plane)?);
                BodyFeatureRequestDto::SplitBody(split)
            }
            other => other,
        })
    }

    fn resolve_plane_basis(&self, reference: PlaneRef) -> Result<PlaneBasis, SessionError> {
        match reference {
            PlaneRef::OriginPlane { .. } => reference
                .origin_basis()
                .map_err(|_| SessionError::UnsupportedPlane),
            PlaneRef::PlanarFace { face_id } => self.solids.face_basis(face_id).ok_or_else(|| {
                SessionError::BrokenReference(format!(
                    "face {} no longer exists or is not planar",
                    face_id.0
                ))
            }),
            PlaneRef::DatumPlane { datum_id } => self
                .resolve_datum_basis(datum_id, &self.active_feature_ids())
                .ok_or_else(|| {
                    SessionError::BrokenReference(format!(
                        "construction plane {} is missing or rolled back",
                        datum_id.0
                    ))
                }),
        }
    }

    fn resolve_datum_basis(
        &self,
        datum_id: FaceId,
        active: &BTreeSet<FeatureId>,
    ) -> Option<PlaneBasis> {
        self.datum_planes
            .iter()
            .find(|plane| plane.datum_id == datum_id && active.contains(&plane.feature_id))
            .map(|plane| plane.basis)
    }

    pub fn prepare_extrude(
        &mut self,
        request: ExtrudeRequest,
    ) -> Result<RecomputePlanDto, SessionError> {
        if self.active.is_some() {
            return Err(SessionError::Solid(
                "finish the active sketch before extruding".to_string(),
            ));
        }
        let feature_id = self.document.alloc_feature_id();
        let next_number = self.extrude_count + 1;
        let name = format!("Extrude{next_number}");
        let mut active = self.active_feature_ids_at(self.document.features().len());
        active.insert(feature_id);
        let plan = self
            .solids
            .prepare_add(feature_id, &name, request, &self.profile_catalog(), &active)
            .map_err(|error| SessionError::Solid(error.to_string()))?;
        self.extrude_count = next_number;
        self.document
            .push_feature(Feature::new(feature_id, name, FeatureKind::Extrude));
        Ok(plan)
    }

    pub fn prepare_edit_extrude(
        &mut self,
        request: EditExtrudeRequest,
    ) -> Result<RecomputePlanDto, SessionError> {
        if self.active.is_some() {
            return Err(SessionError::Solid(
                "finish the active sketch before editing an Extrude".to_string(),
            ));
        }
        self.validate_active_sketch_references()?;
        let active = self.active_feature_ids();
        self.solids
            .prepare_edit(
                request.feature_id,
                request.extrude,
                &self.profile_catalog(),
                &active,
            )
            .map_err(|error| SessionError::Solid(error.to_string()))
    }

    pub fn prepare_revolve(
        &mut self,
        request: RevolveRequest,
    ) -> Result<RecomputePlanDto, SessionError> {
        if self.active.is_some() {
            return Err(SessionError::Solid(
                "finish the active sketch before revolving".to_string(),
            ));
        }
        let feature_id = self.document.alloc_feature_id();
        let next_number = self.revolve_count + 1;
        let name = format!("Revolve{next_number}");
        let mut active = self.active_feature_ids_at(self.document.features().len());
        active.insert(feature_id);
        let plan = self
            .solids
            .prepare_add_revolve(feature_id, &name, request, &self.profile_catalog(), &active)
            .map_err(|error| SessionError::Solid(error.to_string()))?;
        self.revolve_count = next_number;
        self.document
            .push_feature(Feature::new(feature_id, name, FeatureKind::Revolve));
        Ok(plan)
    }

    pub fn prepare_edit_revolve(
        &mut self,
        request: EditRevolveRequest,
    ) -> Result<RecomputePlanDto, SessionError> {
        if self.active.is_some() {
            return Err(SessionError::Solid(
                "finish the active sketch before editing a Revolve".to_string(),
            ));
        }
        self.validate_active_sketch_references()?;
        let active = self.active_feature_ids();
        self.solids
            .prepare_edit_revolve(
                request.feature_id,
                request.revolve,
                &self.profile_catalog(),
                &active,
            )
            .map_err(|error| SessionError::Solid(error.to_string()))
    }

    pub fn prepare_sweep(
        &mut self,
        request: SweepRequest,
    ) -> Result<RecomputePlanDto, SessionError> {
        if self.active.is_some() {
            return Err(SessionError::Solid(
                "finish the active sketch before sweeping".to_string(),
            ));
        }
        let feature_id = self.document.alloc_feature_id();
        let next_number = self.sweep_count + 1;
        let name = format!("Sweep{next_number}");
        let mut active = self.active_feature_ids_at(self.document.features().len());
        active.insert(feature_id);
        let plan = self
            .solids
            .prepare_add_sweep(feature_id, &name, request, &self.profile_catalog(), &active)
            .map_err(|error| SessionError::Solid(error.to_string()))?;
        self.sweep_count = next_number;
        self.document
            .push_feature(Feature::new(feature_id, name, FeatureKind::Sweep));
        Ok(plan)
    }

    pub fn prepare_edit_sweep(
        &mut self,
        request: EditSweepRequest,
    ) -> Result<RecomputePlanDto, SessionError> {
        if self.active.is_some() {
            return Err(SessionError::Solid(
                "finish the active sketch before editing a Sweep".to_string(),
            ));
        }
        self.validate_active_sketch_references()?;
        let active = self.active_feature_ids();
        self.solids
            .prepare_edit_sweep(
                request.feature_id,
                request.sweep,
                &self.profile_catalog(),
                &active,
            )
            .map_err(|error| SessionError::Solid(error.to_string()))
    }

    pub fn prepare_loft(&mut self, request: LoftRequest) -> Result<RecomputePlanDto, SessionError> {
        if self.active.is_some() {
            return Err(SessionError::Solid(
                "finish the active sketch before lofting".to_string(),
            ));
        }
        let feature_id = self.document.alloc_feature_id();
        let next_number = self.loft_count + 1;
        let name = format!("Loft{next_number}");
        let mut active = self.active_feature_ids_at(self.document.features().len());
        active.insert(feature_id);
        let plan = self
            .solids
            .prepare_add_loft(feature_id, &name, request, &self.profile_catalog(), &active)
            .map_err(|error| SessionError::Solid(error.to_string()))?;
        self.loft_count = next_number;
        self.document
            .push_feature(Feature::new(feature_id, name, FeatureKind::Loft));
        Ok(plan)
    }

    pub fn prepare_edit_loft(
        &mut self,
        request: EditLoftRequest,
    ) -> Result<RecomputePlanDto, SessionError> {
        if self.active.is_some() {
            return Err(SessionError::Solid(
                "finish the active sketch before editing a Loft".to_string(),
            ));
        }
        self.validate_active_sketch_references()?;
        let active = self.active_feature_ids();
        self.solids
            .prepare_edit_loft(
                request.feature_id,
                request.loft,
                &self.profile_catalog(),
                &active,
            )
            .map_err(|error| SessionError::Solid(error.to_string()))
    }

    pub fn prepare_rib(&mut self, request: RibRequest) -> Result<RecomputePlanDto, SessionError> {
        if self.active.is_some() {
            return Err(SessionError::Solid(
                "finish the active sketch before creating a Rib".to_string(),
            ));
        }
        let feature_id = self.document.alloc_feature_id();
        let next_number = self.rib_count + 1;
        let name = format!("Rib{next_number}");
        let mut active = self.active_feature_ids_at(self.document.features().len());
        active.insert(feature_id);
        let plan = self
            .solids
            .prepare_add_rib(feature_id, &name, request, &self.profile_catalog(), &active)
            .map_err(|error| SessionError::Solid(error.to_string()))?;
        self.rib_count = next_number;
        self.document
            .push_feature(Feature::new(feature_id, name, FeatureKind::Rib));
        Ok(plan)
    }

    pub fn prepare_edit_rib(
        &mut self,
        request: EditRibRequest,
    ) -> Result<RecomputePlanDto, SessionError> {
        if self.active.is_some() {
            return Err(SessionError::Solid(
                "finish the active sketch before editing a Rib".to_string(),
            ));
        }
        self.validate_active_sketch_references()?;
        let active = self.active_feature_ids();
        self.solids
            .prepare_edit_rib(
                request.feature_id,
                request.rib,
                &self.profile_catalog(),
                &active,
            )
            .map_err(|error| SessionError::Solid(error.to_string()))
    }

    pub fn prepare_solid_fillet(
        &mut self,
        request: SolidFilletRequest,
    ) -> Result<RecomputePlanDto, SessionError> {
        self.ensure_no_active_sketch("creating a solid Fillet")?;
        let feature_id = self.document.alloc_feature_id();
        let next_number = self.fillet_count + 1;
        let name = format!("Fillet{next_number}");
        let mut active = self.active_feature_ids_at(self.document.features().len());
        active.insert(feature_id);
        let plan = self
            .solids
            .prepare_add_fillet(feature_id, &name, request, &self.profile_catalog(), &active)
            .map_err(|error| SessionError::Solid(error.to_string()))?;
        self.fillet_count = next_number;
        self.document
            .push_feature(Feature::new(feature_id, name, FeatureKind::Fillet));
        Ok(plan)
    }

    pub fn prepare_edit_solid_fillet(
        &mut self,
        request: EditSolidFilletRequest,
    ) -> Result<RecomputePlanDto, SessionError> {
        self.ensure_no_active_sketch("editing a solid Fillet")?;
        self.validate_active_sketch_references()?;
        let active = self.active_feature_ids();
        self.solids
            .prepare_edit_fillet(
                request.feature_id,
                request.fillet,
                &self.profile_catalog(),
                &active,
            )
            .map_err(|error| SessionError::Solid(error.to_string()))
    }

    pub fn prepare_solid_chamfer(
        &mut self,
        request: SolidChamferRequest,
    ) -> Result<RecomputePlanDto, SessionError> {
        self.ensure_no_active_sketch("creating a solid Chamfer")?;
        let feature_id = self.document.alloc_feature_id();
        let next_number = self.chamfer_count + 1;
        let name = format!("Chamfer{next_number}");
        let mut active = self.active_feature_ids_at(self.document.features().len());
        active.insert(feature_id);
        let plan = self
            .solids
            .prepare_add_chamfer(feature_id, &name, request, &self.profile_catalog(), &active)
            .map_err(|error| SessionError::Solid(error.to_string()))?;
        self.chamfer_count = next_number;
        self.document
            .push_feature(Feature::new(feature_id, name, FeatureKind::Chamfer));
        Ok(plan)
    }

    pub fn prepare_edit_solid_chamfer(
        &mut self,
        request: EditSolidChamferRequest,
    ) -> Result<RecomputePlanDto, SessionError> {
        self.ensure_no_active_sketch("editing a solid Chamfer")?;
        self.validate_active_sketch_references()?;
        let active = self.active_feature_ids();
        self.solids
            .prepare_edit_chamfer(
                request.feature_id,
                request.chamfer,
                &self.profile_catalog(),
                &active,
            )
            .map_err(|error| SessionError::Solid(error.to_string()))
    }

    pub fn prepare_hole(&mut self, request: HoleRequest) -> Result<RecomputePlanDto, SessionError> {
        self.ensure_no_active_sketch("creating a Hole")?;
        let feature_id = self.document.alloc_feature_id();
        let next_number = self.hole_count + 1;
        let name = format!("Hole{next_number}");
        let mut active = self.active_feature_ids_at(self.document.features().len());
        active.insert(feature_id);
        let plan = self
            .solids
            .prepare_add_hole(feature_id, &name, request, &self.profile_catalog(), &active)
            .map_err(|error| SessionError::Solid(error.to_string()))?;
        self.hole_count = next_number;
        self.document
            .push_feature(Feature::new(feature_id, name, FeatureKind::Hole));
        Ok(plan)
    }

    pub fn prepare_edit_hole(
        &mut self,
        request: EditHoleRequest,
    ) -> Result<RecomputePlanDto, SessionError> {
        self.ensure_no_active_sketch("editing a Hole")?;
        self.validate_active_sketch_references()?;
        let active = self.active_feature_ids();
        self.solids
            .prepare_edit_hole(
                request.feature_id,
                request.hole,
                &self.profile_catalog(),
                &active,
            )
            .map_err(|error| SessionError::Solid(error.to_string()))
    }

    pub fn prepare_recompute(&mut self) -> Result<RecomputePlanDto, SessionError> {
        if self.active.is_some() {
            return Err(SessionError::Solid(
                "finish the active sketch before recomputing solids".to_string(),
            ));
        }
        let active = self.active_feature_ids();
        self.solids
            .prepare_recompute_resilient(&self.profile_catalog(), &active)
            .map_err(|error| SessionError::Solid(error.to_string()))
    }

    pub fn prepare_set_rollback(
        &mut self,
        request: SetRollbackRequest,
    ) -> Result<RecomputePlanDto, SessionError> {
        if self.active.is_some() {
            return Err(SessionError::Solid(
                "finish the active sketch before moving the rollback marker".to_string(),
            ));
        }
        let index = request
            .rollback_index
            .min(self.document.features().features.len());
        let active = self.active_feature_ids_at(index);
        let plan = self
            .solids
            .prepare_recompute_resilient(&self.profile_catalog(), &active)
            .map_err(|error| SessionError::Solid(error.to_string()))?;
        self.document.features_mut().set_rollback_index(index);
        Ok(plan)
    }

    pub fn prepare_delete_feature(
        &mut self,
        request: DeleteFeatureRequest,
    ) -> Result<RecomputePlanDto, SessionError> {
        self.ensure_no_active_sketch("deleting a history feature")?;
        let (index, feature) = self
            .document
            .features()
            .features
            .iter()
            .enumerate()
            .find(|(_, feature)| feature.id == request.feature_id)
            .map(|(index, feature)| (index, feature.clone()))
            .ok_or_else(|| {
                SessionError::Solid(format!("feature {} was not found", request.feature_id.0))
            })?;
        let rollback = self.document.features().rollback_index;
        let next_rollback = if index < rollback {
            rollback.saturating_sub(1)
        } else {
            rollback.min(self.document.features().features.len().saturating_sub(1))
        };
        let active = self
            .document
            .features()
            .features
            .iter()
            .enumerate()
            .filter(|(feature_index, _)| *feature_index != index)
            .take(next_rollback)
            .filter(|(_, feature)| !feature.suppressed)
            .map(|(_, feature)| feature.id)
            .collect::<BTreeSet<_>>();
        let catalog = self
            .profile_catalog()
            .into_iter()
            .filter(|item| item.feature_id != request.feature_id)
            .collect::<Vec<_>>();
        let plan = self
            .solids
            .prepare_delete_feature(request.feature_id, &catalog, &active)
            .map_err(|error| SessionError::Solid(error.to_string()))?;

        self.document.features_mut().remove(request.feature_id);
        match feature.kind {
            FeatureKind::Sketch => {
                self.finished
                    .retain(|finished| finished.feature_id != request.feature_id);
                self.document.remove_sketch_node(&feature.name);
            }
            FeatureKind::ConstructionPlane => {
                let datum_ids = self
                    .datum_planes
                    .iter()
                    .filter(|plane| plane.feature_id == request.feature_id)
                    .map(|plane| plane.datum_id.0)
                    .collect::<Vec<_>>();
                self.datum_planes
                    .retain(|plane| plane.feature_id != request.feature_id);
                for datum_id in datum_ids {
                    self.document.remove_construction_plane_node(datum_id);
                }
            }
            _ => {}
        }
        Ok(plan)
    }

    pub fn prepare_reorder_feature(
        &mut self,
        request: ReorderFeatureRequest,
    ) -> Result<RecomputePlanDto, SessionError> {
        self.ensure_no_active_sketch("reordering history")?;
        if self.document.features().rollback_index != self.document.features().features.len() {
            return Err(SessionError::Solid(
                "move the build cursor to the end before reordering history".to_string(),
            ));
        }
        let original_tree = self.document.features().clone();
        let dependencies = self.timeline_dependencies(&original_tree.features);
        if !self
            .document
            .features_mut()
            .reorder(request.feature_id, request.target_index)
        {
            return Err(SessionError::Solid(
                "the feature is already in that history position".to_string(),
            ));
        }

        let order = self
            .document
            .features()
            .features
            .iter()
            .map(|feature| feature.id)
            .collect::<Vec<_>>();
        let positions = order
            .iter()
            .enumerate()
            .map(|(index, feature_id)| (*feature_id, index))
            .collect::<BTreeMap<_, _>>();
        if let Some((consumer, producer)) = dependencies.iter().find_map(|(consumer, producers)| {
            producers.iter().find_map(|producer| {
                match (positions.get(producer), positions.get(consumer)) {
                    (Some(producer_index), Some(consumer_index))
                        if producer_index >= consumer_index =>
                    {
                        Some((*consumer, *producer))
                    }
                    _ => None,
                }
            })
        }) {
            let consumer_name = original_tree
                .features
                .iter()
                .find(|feature| feature.id == consumer)
                .map(|feature| feature.name.clone())
                .unwrap_or_else(|| "feature".to_string());
            let producer_name = original_tree
                .features
                .iter()
                .find(|feature| feature.id == producer)
                .map(|feature| feature.name.clone())
                .unwrap_or_else(|| "dependency".to_string());
            *self.document.features_mut() = original_tree;
            return Err(SessionError::Solid(format!(
                "cannot move {consumer_name} before its dependency {producer_name}",
            )));
        }

        let previous_order = original_tree
            .features
            .iter()
            .map(|feature| feature.id)
            .collect::<Vec<_>>();
        if let Err(error) = self.solids.set_feature_order(&order) {
            *self.document.features_mut() = original_tree;
            return Err(SessionError::Solid(error.to_string()));
        }
        let active = self.active_feature_ids();
        match self
            .solids
            .prepare_recompute(&self.profile_catalog(), &active)
        {
            Ok(plan) => Ok(plan),
            Err(error) => {
                *self.document.features_mut() = original_tree;
                let _ = self.solids.set_feature_order(&previous_order);
                Err(SessionError::Solid(format!(
                    "history reorder is not valid: {error}",
                )))
            }
        }
    }

    pub fn cancel_solid_recompute(&mut self, transaction_id: u64) {
        if self
            .pending_project
            .as_ref()
            .is_some_and(|pending| pending.transaction_id == transaction_id)
        {
            self.pending_project = None;
            return;
        }
        self.solids.cancel_pending(transaction_id);
    }

    pub fn commit_solid(
        &mut self,
        request: CommitKernelRequest,
    ) -> Result<SolidUpdateDto, SessionError> {
        if let Some(mut pending) = self.pending_project.take() {
            if pending.transaction_id != request.transaction_id {
                self.pending_project = Some(pending);
                return Err(SessionError::Solid(
                    "stale project recompute result".to_string(),
                ));
            }
            let update = pending.manager.commit_solid(request)?;
            *self = *pending.manager;
            return Ok(update);
        }

        let scene = self
            .solids
            .commit(request.transaction_id, request.scene)
            .map_err(|error| SessionError::Solid(error.to_string()))?
            .clone();

        let body_ids = scene
            .bodies
            .iter()
            .map(|body| body.id.0)
            .collect::<BTreeSet<_>>();
        self.document
            .retain_body_nodes(|body_id| body_ids.contains(&body_id));
        for body in &scene.bodies {
            if self.document.body_node_id(body.id.0).is_none() {
                self.document.add_body_node(body.id.0, &body.name);
            }
        }
        self.scrub_body_appearances();
        self.scrub_project_visibility();

        // Every recompute starts clean, then kernel failures and persistent
        // reference failures are overlaid onto their timeline entries.
        for feature in &mut self.document.features_mut().features {
            feature.status = FeatureStatus::Ok;
        }
        let active = self.active_feature_ids();
        let datum_errors = self.refresh_datum_planes(&active);
        for error in &scene.errors {
            self.document.set_feature_status(
                error.feature_id,
                FeatureStatus::Error {
                    message: error.message.clone(),
                },
            );
        }
        for (feature_id, message) in datum_errors {
            self.document
                .set_feature_status(feature_id, FeatureStatus::Error { message });
        }

        let broken = self
            .finished
            .iter()
            .filter_map(|finished| match finished.session.plane() {
                PlaneRef::PlanarFace { face_id }
                    if active.contains(&finished.feature_id) && !self.solids.has_face(face_id) =>
                {
                    Some((
                        finished.feature_id,
                        finished.session.name().to_string(),
                        format!("face {}", face_id.0),
                    ))
                }
                PlaneRef::DatumPlane { datum_id }
                    if active.contains(&finished.feature_id)
                        && self.resolve_datum_basis(datum_id, &active).is_none() =>
                {
                    Some((
                        finished.feature_id,
                        finished.session.name().to_string(),
                        format!("construction plane {}", datum_id.0),
                    ))
                }
                _ => None,
            })
            .collect::<Vec<_>>();
        for (feature_id, sketch_name, reference) in broken {
            let message =
                format!("Broken reference: {reference} used by {sketch_name} no longer exists");
            self.document.set_feature_status(
                feature_id,
                FeatureStatus::Error {
                    message: message.clone(),
                },
            );
            let downstream = self
                .solids
                .definitions()
                .iter()
                .filter(|definition| definition.sketch_name == sketch_name)
                .map(|definition| definition.feature_id)
                .chain(
                    self.solids
                        .revolve_definitions()
                        .iter()
                        .filter(|definition| definition.sketch_name == sketch_name)
                        .map(|definition| definition.feature_id),
                )
                .chain(
                    self.solids
                        .sweep_definitions()
                        .iter()
                        .filter(|definition| {
                            definition.profile.sketch_name == sketch_name
                                || definition.path_sketch_name == sketch_name
                        })
                        .map(|definition| definition.feature_id),
                )
                .chain(
                    self.solids
                        .loft_definitions()
                        .iter()
                        .filter(|definition| {
                            definition
                                .sections
                                .iter()
                                .any(|section| section.sketch_name == sketch_name)
                        })
                        .map(|definition| definition.feature_id),
                )
                .chain(
                    self.solids
                        .rib_definitions()
                        .iter()
                        .filter(|definition| definition.sketch_name == sketch_name)
                        .map(|definition| definition.feature_id),
                )
                .collect::<Vec<_>>();
            for feature in downstream {
                self.document.set_feature_status(
                    feature,
                    FeatureStatus::Error {
                        message: format!(
                            "Broken reference: source sketch {} has no support face",
                            sketch_name
                        ),
                    },
                );
            }
        }

        Ok(SolidUpdateDto {
            document: self.document_dto(),
            scene,
        })
    }

    fn active_feature_ids(&self) -> BTreeSet<FeatureId> {
        self.active_feature_ids_at(self.document.features().rollback_index)
    }

    /// Capture the dependency edges represented by the current valid
    /// timeline. Reordering may move independent branches, or move a
    /// producer earlier / consumer later, but it may not invert one of these
    /// edges. Stable ids remain unchanged.
    fn timeline_dependencies(
        &self,
        features: &[Feature],
    ) -> BTreeMap<FeatureId, BTreeSet<FeatureId>> {
        #[derive(Default)]
        struct BodyAccess {
            inputs: BTreeSet<BodyId>,
            writes: BTreeSet<BodyId>,
            outputs: BTreeSet<BodyId>,
        }

        let mut dependencies = BTreeMap::<FeatureId, BTreeSet<FeatureId>>::new();
        let mut sketch_inputs = BTreeMap::<FeatureId, BTreeSet<String>>::new();
        let mut plane_inputs = BTreeMap::<FeatureId, Vec<PlaneRef>>::new();
        let mut body_access = BTreeMap::<FeatureId, BodyAccess>::new();

        let mut record_solid = |feature_id: FeatureId,
                                operation: ExtrudeOperation,
                                targets: &[BodyId],
                                outputs: &[BodyId],
                                additional_inputs: &[BodyId]| {
            let access = body_access.entry(feature_id).or_default();
            access.inputs.extend(additional_inputs.iter().copied());
            match operation {
                ExtrudeOperation::NewBody => {
                    access.outputs.extend(outputs.iter().copied());
                }
                ExtrudeOperation::Join | ExtrudeOperation::Cut | ExtrudeOperation::Intersect => {
                    access.inputs.extend(targets.iter().copied());
                    access.writes.extend(targets.iter().copied());
                }
            }
        };

        for definition in self.solids.definitions() {
            if definition.source_face.is_none() {
                sketch_inputs
                    .entry(definition.feature_id)
                    .or_default()
                    .insert(definition.sketch_name.clone());
            }
            let source_body = definition.source_face.map(|source| source.body_id);
            record_solid(
                definition.feature_id,
                definition.operation,
                &definition.target_body_ids,
                &definition.new_body_ids,
                source_body.as_slice(),
            );
            if let ExtrudeExtent::ToFace { face_id } = definition.extent {
                plane_inputs
                    .entry(definition.feature_id)
                    .or_default()
                    .push(PlaneRef::PlanarFace { face_id });
            }
        }
        for definition in self.solids.revolve_definitions() {
            sketch_inputs
                .entry(definition.feature_id)
                .or_default()
                .insert(definition.sketch_name.clone());
            record_solid(
                definition.feature_id,
                definition.operation,
                &definition.target_body_ids,
                &definition.new_body_ids,
                &[],
            );
        }
        for definition in self.solids.sweep_definitions() {
            let inputs = sketch_inputs.entry(definition.feature_id).or_default();
            inputs.insert(definition.profile.sketch_name.clone());
            inputs.insert(definition.path_sketch_name.clone());
            if let Some(guide) = &definition.guide_rail {
                inputs.insert(guide.sketch_name.clone());
            }
            record_solid(
                definition.feature_id,
                definition.operation,
                &definition.target_body_ids,
                &[definition.new_body_id],
                &[],
            );
        }
        for definition in self.solids.loft_definitions() {
            let inputs = sketch_inputs.entry(definition.feature_id).or_default();
            inputs.extend(
                definition
                    .sections
                    .iter()
                    .map(|section| section.sketch_name.clone()),
            );
            if let Some(centerline) = &definition.centerline {
                inputs.insert(centerline.sketch_name.clone());
            }
            if let Some(guide) = &definition.guide_rail {
                inputs.insert(guide.sketch_name.clone());
            }
            record_solid(
                definition.feature_id,
                definition.operation,
                &definition.target_body_ids,
                &[definition.new_body_id],
                &[],
            );
        }
        for definition in self.solids.rib_definitions() {
            sketch_inputs
                .entry(definition.feature_id)
                .or_default()
                .insert(definition.sketch_name.clone());
            record_solid(
                definition.feature_id,
                definition.operation,
                &definition.target_body_ids,
                &definition.new_body_ids,
                &[],
            );
            if let Some(RibExtent::ToFace { face_id }) = definition.extent {
                plane_inputs
                    .entry(definition.feature_id)
                    .or_default()
                    .push(PlaneRef::PlanarFace { face_id });
            }
        }
        for definition in self.solids.fillet_definitions() {
            let access = body_access.entry(definition.feature_id).or_default();
            access.inputs.insert(definition.body_id);
            access.writes.insert(definition.body_id);
        }
        for definition in self.solids.chamfer_definitions() {
            let access = body_access.entry(definition.feature_id).or_default();
            access.inputs.insert(definition.body_id);
            access.writes.insert(definition.body_id);
        }
        for definition in self.solids.hole_definitions() {
            let access = body_access.entry(definition.feature_id).or_default();
            access.inputs.insert(definition.body_id);
            access.writes.insert(definition.body_id);
            let refs = if definition.positions.is_empty() {
                definition.position_reference.iter().collect::<Vec<_>>()
            } else {
                definition
                    .positions
                    .iter()
                    .filter_map(|position| position.position_reference.as_ref())
                    .collect::<Vec<_>>()
            };
            sketch_inputs
                .entry(definition.feature_id)
                .or_default()
                .extend(
                    refs.into_iter()
                        .map(|reference| reference.sketch_name.clone()),
                );
        }
        for definition in self.solids.body_feature_definitions() {
            match definition {
                BodyFeatureDefinitionDto::Shell {
                    feature_id,
                    body_id,
                    ..
                } => {
                    let access = body_access.entry(*feature_id).or_default();
                    access.inputs.insert(*body_id);
                    access.writes.insert(*body_id);
                }
                BodyFeatureDefinitionDto::Mirror {
                    feature_id,
                    body_ids,
                    plane,
                    new_body_ids,
                    ..
                } => {
                    let access = body_access.entry(*feature_id).or_default();
                    access.inputs.extend(body_ids.iter().copied());
                    access.outputs.extend(new_body_ids.iter().copied());
                    plane_inputs.entry(*feature_id).or_default().push(*plane);
                }
                BodyFeatureDefinitionDto::RectangularPattern {
                    feature_id,
                    body_ids,
                    new_body_ids,
                    ..
                }
                | BodyFeatureDefinitionDto::CircularPattern {
                    feature_id,
                    body_ids,
                    new_body_ids,
                    ..
                } => {
                    let access = body_access.entry(*feature_id).or_default();
                    access.inputs.extend(body_ids.iter().copied());
                    access.outputs.extend(new_body_ids.iter().copied());
                }
                BodyFeatureDefinitionDto::Combine {
                    feature_id,
                    target_body_id,
                    tool_body_ids,
                    ..
                } => {
                    let access = body_access.entry(*feature_id).or_default();
                    access.inputs.insert(*target_body_id);
                    access.inputs.extend(tool_body_ids.iter().copied());
                    access.writes.insert(*target_body_id);
                    access.writes.extend(tool_body_ids.iter().copied());
                }
                BodyFeatureDefinitionDto::SplitBody {
                    feature_id,
                    body_id,
                    plane,
                    new_body_id,
                    ..
                } => {
                    let access = body_access.entry(*feature_id).or_default();
                    access.inputs.insert(*body_id);
                    access.writes.insert(*body_id);
                    access.outputs.insert(*new_body_id);
                    plane_inputs.entry(*feature_id).or_default().push(*plane);
                }
                BodyFeatureDefinitionDto::ImportStep {
                    feature_id,
                    body_id,
                    ..
                } => {
                    body_access
                        .entry(*feature_id)
                        .or_default()
                        .outputs
                        .insert(*body_id);
                }
            }
        }

        for finished in &self.finished {
            plane_inputs
                .entry(finished.feature_id)
                .or_default()
                .push(finished.session.plane());
        }
        for definition in &self.datum_planes {
            let planes = plane_inputs.entry(definition.feature_id).or_default();
            match definition.source {
                DatumPlaneSourceDto::Offset { reference, .. } => planes.push(reference),
                DatumPlaneSourceDto::Midplane { first, second } => {
                    planes.extend([first, second]);
                }
                DatumPlaneSourceDto::AtAngle {
                    reference, body_id, ..
                } => {
                    planes.push(reference);
                    body_access
                        .entry(definition.feature_id)
                        .or_default()
                        .inputs
                        .insert(body_id);
                }
            }
        }

        let sketch_features = self
            .finished
            .iter()
            .map(|finished| (finished.session.name().to_string(), finished.feature_id))
            .collect::<BTreeMap<_, _>>();
        let datum_features = self
            .datum_planes
            .iter()
            .map(|plane| (plane.datum_id, plane.feature_id))
            .collect::<BTreeMap<_, _>>();
        let face_bodies = self
            .solids
            .scene()
            .bodies
            .iter()
            .flat_map(|body| body.faces.iter().map(|face| (face.id, body.id)))
            .collect::<BTreeMap<_, _>>();
        let mut last_writer = BTreeMap::<BodyId, FeatureId>::new();

        for feature in features {
            if let Some(inputs) = sketch_inputs.get(&feature.id) {
                for sketch_name in inputs {
                    if let Some(producer) = sketch_features.get(sketch_name) {
                        if *producer != feature.id {
                            dependencies
                                .entry(feature.id)
                                .or_default()
                                .insert(*producer);
                        }
                    }
                }
            }
            if let Some(inputs) = plane_inputs.get(&feature.id) {
                for reference in inputs {
                    match *reference {
                        PlaneRef::OriginPlane { .. } => {}
                        PlaneRef::DatumPlane { datum_id } => {
                            if let Some(producer) = datum_features.get(&datum_id) {
                                if *producer != feature.id {
                                    dependencies
                                        .entry(feature.id)
                                        .or_default()
                                        .insert(*producer);
                                }
                            }
                        }
                        PlaneRef::PlanarFace { face_id } => {
                            if let Some(producer) = face_bodies
                                .get(&face_id)
                                .and_then(|body_id| last_writer.get(body_id))
                            {
                                if *producer != feature.id {
                                    dependencies
                                        .entry(feature.id)
                                        .or_default()
                                        .insert(*producer);
                                }
                            }
                        }
                    }
                }
            }
            if let Some(access) = body_access.get(&feature.id) {
                for body_id in access.inputs.iter().chain(access.writes.iter()) {
                    if let Some(producer) = last_writer.get(body_id) {
                        if *producer != feature.id {
                            dependencies
                                .entry(feature.id)
                                .or_default()
                                .insert(*producer);
                        }
                    }
                }
                for body_id in access.outputs.iter().chain(access.writes.iter()) {
                    last_writer.insert(*body_id, feature.id);
                }
            }
        }
        dependencies
    }

    fn refresh_datum_planes(&mut self, active: &BTreeSet<FeatureId>) -> Vec<(FeatureId, String)> {
        let mut errors = Vec::new();
        let mut working = self.datum_planes.clone();
        let feature_order = self
            .document
            .features()
            .features
            .iter()
            .enumerate()
            .map(|(index, feature)| (feature.id, index))
            .collect::<BTreeMap<_, _>>();
        let mut order = (0..working.len()).collect::<Vec<_>>();
        order.sort_by_key(|index| {
            feature_order
                .get(&working[*index].feature_id)
                .copied()
                .unwrap_or(usize::MAX)
        });
        for index in order {
            if !active.contains(&working[index].feature_id) {
                continue;
            }
            // The current OCCT scene is the result at the rollback marker,
            // not the scene that existed when an earlier datum was created.
            // A downstream boolean may reuse the same body-local `face:n`
            // slot for a perpendicular face. Re-resolving an upstream datum
            // against that later topology silently rotates the datum and all
            // dependent sketches. Its persisted basis is authoritative until
            // the history marker is at a stage where no later topology writer
            // is active.
            if datum_source_reads_solid_topology(&working[index].source)
                && !self.scene_matches_history_stage(working[index].feature_id)
            {
                continue;
            }
            let mut source = working[index].source.clone();
            match resolve_datum_source(&self.solids, &working, active, &mut source) {
                Ok(basis) => {
                    working[index].source = source;
                    working[index].basis = basis;
                }
                Err(error) => errors.push((
                    working[index].feature_id,
                    format!("Broken construction-plane reference: {error}"),
                )),
            }
        }
        self.datum_planes = working;
        for plane in &self.datum_planes {
            if active.contains(&plane.feature_id) {
                self.solids
                    .refresh_datum_plane_basis(plane.datum_id, plane.basis);
            }
        }
        self.refresh_datum_sketch_bases();
        errors
    }

    fn refresh_datum_sketch_bases(&mut self) {
        let bases = self
            .datum_planes
            .iter()
            .map(|plane| (plane.datum_id, plane.basis))
            .collect::<std::collections::HashMap<_, _>>();
        for finished in &mut self.finished {
            if let PlaneRef::DatumPlane { datum_id } = finished.session.plane() {
                if let Some(basis) = bases.get(&datum_id) {
                    finished.session.set_basis(*basis);
                }
            }
        }
        if let Some(session) = &mut self.active {
            if let PlaneRef::DatumPlane { datum_id } = session.plane() {
                if let Some(basis) = bases.get(&datum_id) {
                    session.set_basis(*basis);
                }
            }
        }
    }

    fn ensure_no_active_sketch(&self, action: &str) -> Result<(), SessionError> {
        if self.active.is_some() {
            Err(SessionError::Solid(format!(
                "finish the active sketch before {action}"
            )))
        } else {
            Ok(())
        }
    }

    /// Whether the current OCCT scene represents the topology visible at one
    /// feature's position in history. Sketch and datum entries do not alter a
    /// body; every other active feature can. Earlier face/edge references may
    /// only be dereferenced when no such writer follows them in the active
    /// prefix. This is the temporal half of persistent topology naming.
    fn scene_matches_history_stage(&self, feature_id: FeatureId) -> bool {
        let tree = self.document.features();
        let Some(position) = tree
            .features
            .iter()
            .position(|feature| feature.id == feature_id)
        else {
            return false;
        };
        if position >= tree.rollback_index {
            return false;
        }
        !tree
            .features
            .iter()
            .take(tree.rollback_index)
            .skip(position + 1)
            .any(|feature| !feature.suppressed && feature_changes_solid_topology(feature.kind))
    }

    fn active_feature_ids_at(&self, rollback_index: usize) -> BTreeSet<FeatureId> {
        self.document
            .features()
            .features
            .iter()
            .take(rollback_index)
            .filter(|feature| !feature.suppressed)
            .map(|feature| feature.id)
            .collect()
    }

    fn validate_active_sketch_references(&self) -> Result<(), SessionError> {
        let active = self.active_feature_ids();
        for finished in &self.finished {
            if !active.contains(&finished.feature_id) {
                continue;
            }
            if let PlaneRef::PlanarFace { face_id } = finished.session.plane() {
                if !self.solids.has_face(face_id) {
                    return Err(SessionError::BrokenReference(format!(
                        "face {} used by {} no longer exists",
                        face_id.0,
                        finished.session.name()
                    )));
                }
            }
            if let PlaneRef::DatumPlane { datum_id } = finished.session.plane() {
                if self.resolve_datum_basis(datum_id, &active).is_none() {
                    return Err(SessionError::BrokenReference(format!(
                        "construction plane {} used by {} no longer exists",
                        datum_id.0,
                        finished.session.name()
                    )));
                }
            }
        }
        Ok(())
    }

    /// Sketch Palette "Snap" toggle: applies to the active session and is
    /// remembered for future ones.
    pub fn set_grid_snap(
        &mut self,
        request: SetGridSnapRequest,
    ) -> Result<SketchDto, SessionError> {
        self.grid_snap = request.enabled;
        let session = self.active.as_mut().ok_or(SessionError::NoActiveSketch)?;
        session.set_grid_snap(request.enabled);
        Ok(session.dto())
    }

    /// Set the current adaptive sketch-grid spacing. Unlike the Snap toggle,
    /// this is valid without an active sketch so the next session inherits
    /// the viewport's current zoom level.
    pub fn set_grid_step(&mut self, request: SetGridStepRequest) -> Result<(), SessionError> {
        if !request.step_mm.is_finite()
            || !(MIN_GRID_STEP_MM..=MAX_GRID_STEP_MM).contains(&request.step_mm)
        {
            return Err(SessionError::InvalidGridStep(request.step_mm));
        }
        if let Some(session) = self.active.as_mut() {
            session.set_grid_step(request.step_mm)?;
        }
        self.grid_step = request.step_mm;
        Ok(())
    }

    // --- Active-session drawing ops ---

    fn active_mut(&mut self) -> Result<&mut SketchSession, SessionError> {
        self.active.as_mut().ok_or(SessionError::NoActiveSketch)
    }

    pub fn preview_segment(&self, request: SegmentRequest) -> Result<PreviewDto, SessionError> {
        let session = self.active.as_ref().ok_or(SessionError::NoActiveSketch)?;
        Ok(session.preview_segment(request.from, request.to_raw, request.ctrl_held))
    }

    /// Evaluate an expression against the active sketch's parameters (D9
    /// formula previews in dynamic input).
    pub fn eval_expression(
        &self,
        request: EvalExpressionRequest,
    ) -> Result<EvalExpressionResult, SessionError> {
        let session = self.active.as_ref().ok_or(SessionError::NoActiveSketch)?;
        let value = session.eval_text(&request.text)?;
        Ok(EvalExpressionResult { value })
    }

    pub fn add_line(&mut self, request: SegmentRequest) -> Result<AddLineResult, SessionError> {
        self.active_mut()?
            .add_line(request.from, request.to_raw, request.ctrl_held)
    }

    pub fn preview_segment_locked(
        &self,
        request: LockedSegmentRequest,
    ) -> Result<PreviewDto, SessionError> {
        let session = self.active.as_ref().ok_or(SessionError::NoActiveSketch)?;
        // Formula text evaluates against current params (D9 live preview).
        let length_mm = match &request.length_text {
            Some(t) => Some(session.eval_text(t)?),
            None => request.length_mm,
        };
        let angle_deg = match &request.angle_text {
            Some(t) => Some(session.eval_text(t)?),
            None => request.angle_deg,
        };
        Ok(session.preview_segment_locked(
            request.from,
            length_mm,
            angle_deg,
            request.to_hint,
            request.ctrl_held,
        ))
    }

    pub fn add_line_locked(
        &mut self,
        request: LockedSegmentRequest,
    ) -> Result<AddLineResult, SessionError> {
        self.active_mut()?.add_line_locked(&request)
    }

    pub fn add_point(&mut self, request: PointRequest) -> Result<ToolResult, SessionError> {
        self.active_mut()?
            .add_point_on(request.position, request.coincident_with)
    }

    pub fn add_line_midpoint(
        &mut self,
        request: MidpointLineRequest,
    ) -> Result<ToolResult, SessionError> {
        self.active_mut()?
            .add_line_midpoint(request.mid_raw, request.end_raw, request.ctrl_held)
    }

    pub fn add_rectangle(&mut self, request: RectangleRequest) -> Result<ToolResult, SessionError> {
        self.active_mut()?
            .add_rectangle(request.mode, request.p1, request.p2)
    }

    pub fn add_rectangle_locked(
        &mut self,
        request: LockedRectangleRequest,
    ) -> Result<ToolResult, SessionError> {
        self.active_mut()?.add_rectangle_locked(&request)
    }

    pub fn add_circle(&mut self, request: CircleRequest) -> Result<ToolResult, SessionError> {
        self.active_mut()?
            .add_circle(request.mode, request.p1, request.p2)
    }

    pub fn add_circle_locked(
        &mut self,
        request: LockedCircleRequest,
    ) -> Result<ToolResult, SessionError> {
        self.active_mut()?.add_circle_locked(&request)
    }

    pub fn add_slot(&mut self, request: SlotRequest) -> Result<ToolResult, SessionError> {
        self.active_mut()?.add_slot(&request)
    }

    pub fn add_spline(&mut self, request: SplineRequest) -> Result<ToolResult, SessionError> {
        self.active_mut()?.add_spline(&request)
    }

    pub fn add_arc_3pt(&mut self, request: Arc3PointRequest) -> Result<ToolResult, SessionError> {
        self.active_mut()?
            .add_arc_3pt(request.p1, request.p2, request.p3)
    }

    pub fn add_arc_center(
        &mut self,
        request: ArcCenterRequest,
    ) -> Result<ToolResult, SessionError> {
        self.active_mut()?
            .add_arc_center(request.center, request.start, request.sweep)
    }

    pub fn add_constraint(
        &mut self,
        constraint: Constraint,
    ) -> Result<AddConstraintResult, SessionError> {
        self.active_mut()?.add_constraint(constraint)
    }

    pub fn add_constraints(
        &mut self,
        request: ConstraintBatchRequest,
    ) -> Result<ToolResult, SessionError> {
        self.active_mut()?.add_constraints(request.constraints)
    }

    pub fn add_dimension(&mut self, request: DimensionRequest) -> Result<ToolResult, SessionError> {
        self.active_mut()?.add_dimension(request)
    }

    pub fn edit_dimension(
        &mut self,
        request: EditDimensionRequest,
    ) -> Result<AddConstraintResult, SessionError> {
        self.active_mut()?.edit_dimension(request)
    }

    pub fn move_dimension(
        &mut self,
        request: MoveDimensionRequest,
    ) -> Result<AddConstraintResult, SessionError> {
        self.active_mut()?.move_dimension(request)
    }

    pub fn delete_dimension(
        &mut self,
        constraint_id: ConstraintId,
    ) -> Result<AddConstraintResult, SessionError> {
        self.active_mut()?.delete_dimension(constraint_id)
    }

    /// ISO/aligned dimension style toggle (document setting, D4.5).
    pub fn set_dimension_style(
        &mut self,
        request: SetDimensionStyleRequest,
    ) -> Result<SketchDto, SessionError> {
        self.document.settings_mut().dimension_style = request.style;
        let session = self.active.as_mut().ok_or(SessionError::NoActiveSketch)?;
        session.set_dimension_style(request.style);
        Ok(session.dto())
    }

    // --- Modify tools (M1c-ii) ---

    pub fn fillet_preview(
        &self,
        request: &FilletRequest,
    ) -> Result<FilletPreviewDto, SessionError> {
        self.active
            .as_ref()
            .ok_or(SessionError::NoActiveSketch)?
            .fillet_preview(request)
    }

    pub fn fillet_lines(&mut self, request: FilletRequest) -> Result<ToolResult, SessionError> {
        self.active_mut()?.fillet_lines(&request)
    }

    pub fn chamfer_lines(&mut self, request: ChamferRequest) -> Result<ToolResult, SessionError> {
        self.active_mut()?.chamfer_lines(&request)
    }

    pub fn offset_preview(
        &self,
        request: &OffsetRequest,
    ) -> Result<OffsetPreviewDto, SessionError> {
        self.active
            .as_ref()
            .ok_or(SessionError::NoActiveSketch)?
            .offset_preview(request)
    }

    pub fn offset_curve(&mut self, request: OffsetRequest) -> Result<ToolResult, SessionError> {
        self.active_mut()?.offset_curve_op(&request)
    }

    pub fn trim_preview(&self, request: &TrimRequest) -> Result<TrimPreviewDto, SessionError> {
        self.active
            .as_ref()
            .ok_or(SessionError::NoActiveSketch)?
            .trim_preview(request)
    }

    pub fn trim_entity(&mut self, request: TrimRequest) -> Result<ToolResult, SessionError> {
        self.active_mut()?.trim_entity(&request)
    }

    pub fn extend_entity(&mut self, request: ExtendRequest) -> Result<ToolResult, SessionError> {
        self.active_mut()?.extend_entity(&request)
    }

    pub fn break_curve(&mut self, request: BreakRequest) -> Result<ToolResult, SessionError> {
        self.active_mut()?.break_curve(&request)
    }

    pub fn mirror_entities(&mut self, request: MirrorRequest) -> Result<ToolResult, SessionError> {
        self.active_mut()?.mirror_entities(&request)
    }

    pub fn rectangular_pattern(
        &mut self,
        request: RectangularPatternRequest,
    ) -> Result<ToolResult, SessionError> {
        self.active_mut()?.rectangular_pattern(&request)
    }

    pub fn circular_pattern(
        &mut self,
        request: CircularPatternRequest,
    ) -> Result<ToolResult, SessionError> {
        self.active_mut()?.circular_pattern(&request)
    }

    pub fn move_copy_entities(
        &mut self,
        request: MoveCopyRequest,
    ) -> Result<ToolResult, SessionError> {
        self.active_mut()?.move_copy_entities(&request)
    }

    pub fn scale_entities(&mut self, request: ScaleRequest) -> Result<ToolResult, SessionError> {
        self.active_mut()?.scale_entities(&request)
    }

    pub fn polygon_create(&mut self, request: PolygonRequest) -> Result<ToolResult, SessionError> {
        self.active_mut()?.polygon_create(&request)
    }

    pub fn toggle_fix(&mut self, entity: EntityId) -> Result<AddConstraintResult, SessionError> {
        self.active_mut()?.toggle_fix(entity)
    }

    pub fn toggle_fix_entities(
        &mut self,
        request: ToggleFixBatchRequest,
    ) -> Result<ToolResult, SessionError> {
        self.active_mut()?.toggle_fix_entities(request.entity_ids)
    }

    pub fn move_point(
        &mut self,
        request: MovePointRequest,
    ) -> Result<MovePointResult, SessionError> {
        self.active_mut()?.move_point(request)
    }

    pub fn delete_entity(&mut self, id: EntityId) -> Result<DeleteEntityResult, SessionError> {
        self.active_mut()?.delete_entity(id)
    }

    pub fn delete_entities(
        &mut self,
        ids: &[EntityId],
    ) -> Result<DeleteEntityResult, SessionError> {
        self.active_mut()?.delete_entities(ids)
    }

    pub fn undo(&mut self) -> Result<UndoResult, SessionError> {
        self.active_mut()?.undo()
    }

    pub fn redo(&mut self) -> Result<UndoResult, SessionError> {
        self.active_mut()?.redo()
    }
}

/// Find midpoint snap candidates on the support face. Edge-to-face
/// adjacency is not part of the render DTO yet, so membership is resolved
/// geometrically: every tessellated point on the edge must lie on the
/// selected planar face. The midpoint follows polyline arc length rather
/// than simply averaging endpoints, which also behaves correctly for
/// tessellated arcs.
fn support_edge_midpoints(
    solids: &SolidDocument,
    face_id: FaceId,
    basis: PlaneBasis,
) -> Vec<(EdgeId, crate::geometry::Vec2)> {
    let Some(body) = solids
        .scene()
        .bodies
        .iter()
        .find(|body| body.faces.iter().any(|face| face.id == face_id))
    else {
        return Vec::new();
    };

    body.edges
        .iter()
        .filter_map(|edge| {
            if edge.points.len() < 2
                || edge.points.iter().any(|point| {
                    dot3(sub3(point3_array(*point), basis.origin), basis.normal).abs() > 1e-4
                })
            {
                return None;
            }
            let lengths = edge
                .points
                .windows(2)
                .map(|pair| length3(sub3(point3_array(pair[1]), point3_array(pair[0]))))
                .collect::<Vec<_>>();
            let total = lengths.iter().sum::<f64>();
            if total <= 1e-9 {
                return None;
            }
            let target = total * 0.5;
            let mut traversed = 0.0;
            for (index, segment_length) in lengths.iter().copied().enumerate() {
                if traversed + segment_length + 1e-12 >= target {
                    let a = point3_array(edge.points[index]);
                    let b = point3_array(edge.points[index + 1]);
                    let t = ((target - traversed) / segment_length).clamp(0.0, 1.0);
                    let point = add3(a, scale3(sub3(b, a), t));
                    let local = basis.to_2d(point);
                    return Some((edge.id, crate::geometry::Vec2::new(local[0], local[1])));
                }
                traversed += segment_length;
            }
            None
        })
        .collect()
}

fn body_feature_kind(request: &BodyFeatureRequestDto) -> (FeatureKind, &'static str) {
    match request {
        BodyFeatureRequestDto::Shell(_) => (FeatureKind::Shell, "Shell"),
        BodyFeatureRequestDto::Mirror(_) => (FeatureKind::Mirror, "Mirror"),
        BodyFeatureRequestDto::RectangularPattern(_) => {
            (FeatureKind::RectangularPattern, "RectangularPattern")
        }
        BodyFeatureRequestDto::CircularPattern(_) => {
            (FeatureKind::CircularPattern, "CircularPattern")
        }
        BodyFeatureRequestDto::Combine(_) => (FeatureKind::Combine, "Combine"),
        BodyFeatureRequestDto::SplitBody(_) => (FeatureKind::SplitBody, "SplitBody"),
        BodyFeatureRequestDto::ImportStep(_) => (FeatureKind::ImportStep, "Import"),
    }
}

fn feature_changes_solid_topology(kind: FeatureKind) -> bool {
    !matches!(kind, FeatureKind::Sketch | FeatureKind::ConstructionPlane)
}

fn datum_source_reads_solid_topology(source: &DatumPlaneSourceDto) -> bool {
    match source {
        DatumPlaneSourceDto::Offset { reference, .. } => {
            matches!(reference, PlaneRef::PlanarFace { .. })
        }
        DatumPlaneSourceDto::Midplane { first, second } => matches!(
            (first, second),
            (PlaneRef::PlanarFace { .. }, _) | (_, PlaneRef::PlanarFace { .. })
        ),
        // Even when the reference plane is an origin/datum plane, At Angle
        // reads a body edge and therefore has the same history-stage rule.
        DatumPlaneSourceDto::AtAngle { .. } => true,
    }
}

fn resolve_datum_source(
    solids: &SolidDocument,
    planes: &[DatumPlaneDefinitionDto],
    active: &BTreeSet<FeatureId>,
    source: &mut DatumPlaneSourceDto,
) -> Result<PlaneBasis, SessionError> {
    let resolve = |reference: PlaneRef| -> Result<PlaneBasis, SessionError> {
        match reference {
            PlaneRef::OriginPlane { .. } => reference
                .origin_basis()
                .map_err(|_| SessionError::UnsupportedPlane),
            PlaneRef::PlanarFace { face_id } => solids.face_basis(face_id).ok_or_else(|| {
                SessionError::BrokenReference(format!(
                    "face {} no longer exists or is not planar",
                    face_id.0
                ))
            }),
            PlaneRef::DatumPlane { datum_id } => planes
                .iter()
                .find(|plane| plane.datum_id == datum_id && active.contains(&plane.feature_id))
                .map(|plane| plane.basis)
                .ok_or_else(|| {
                    SessionError::BrokenReference(format!(
                        "construction plane {} is missing or rolled back",
                        datum_id.0
                    ))
                }),
        }
    };

    match source {
        DatumPlaneSourceDto::Offset {
            reference,
            distance,
        } => {
            if !distance.is_finite() {
                return Err(SessionError::Solid(
                    "offset distance must be finite".to_string(),
                ));
            }
            let mut basis = resolve(*reference)?;
            for axis in 0..3 {
                basis.origin[axis] += basis.normal[axis] * *distance;
            }
            Ok(basis)
        }
        DatumPlaneSourceDto::Midplane { first, second } => {
            let first_basis = resolve(*first)?;
            let second_basis = resolve(*second)?;
            if dot3(first_basis.normal, second_basis.normal).abs() < 1.0 - 1e-6 {
                return Err(SessionError::Solid(
                    "midplane references must be parallel".to_string(),
                ));
            }
            let delta = sub3(second_basis.origin, first_basis.origin);
            let distance = dot3(delta, first_basis.normal);
            if distance.abs() <= 1e-7 {
                return Err(SessionError::Solid(
                    "midplane references are coincident".to_string(),
                ));
            }
            let mut basis = first_basis;
            basis.origin = add3(
                first_basis.origin,
                scale3(first_basis.normal, distance * 0.5),
            );
            Ok(basis)
        }
        DatumPlaneSourceDto::AtAngle {
            reference,
            body_id,
            edge_id,
            angle_deg,
            axis_points,
        } => {
            if !angle_deg.is_finite() || angle_deg.abs() > 360.0 {
                return Err(SessionError::Solid(
                    "plane angle must be finite and between -360° and 360°".to_string(),
                ));
            }
            let basis = resolve(*reference)?;
            let points = solids
                .edge_points(*body_id, *edge_id)
                .filter(|points| points.len() >= 2)
                .or_else(|| axis_points.map(|points| points.to_vec()))
                .ok_or_else(|| {
                    SessionError::BrokenReference(format!(
                        "axis edge {} on body {} is missing",
                        edge_id.0, body_id.0
                    ))
                })?;
            let start = point3_array(points[0]);
            let end = point3_array(*points.last().unwrap());
            let axis = normalize3(sub3(end, start)).ok_or_else(|| {
                SessionError::Solid("plane-at-angle axis edge has zero length".to_string())
            })?;
            if points.iter().any(|point| {
                let offset = sub3(point3_array(*point), start);
                length3(cross3(offset, axis)) > 1e-4
            }) {
                return Err(SessionError::Solid(
                    "plane-at-angle requires a straight edge".to_string(),
                ));
            }
            if [start, end]
                .iter()
                .any(|point| dot3(sub3(*point, basis.origin), basis.normal).abs() > 1e-4)
            {
                return Err(SessionError::Solid(
                    "the selected axis edge must lie on the reference plane".to_string(),
                ));
            }
            *axis_points = Some([points[0], *points.last().unwrap()]);
            let angle = angle_deg.to_radians();
            Ok(PlaneBasis {
                origin: add3(start, rotate_vector(sub3(basis.origin, start), axis, angle)),
                u: rotate_vector(basis.u, axis, angle),
                v: rotate_vector(basis.v, axis, angle),
                normal: rotate_vector(basis.normal, axis, angle),
            })
        }
    }
}

fn point3_array(point: Point3Dto) -> [f64; 3] {
    [point.x, point.y, point.z]
}

fn add3(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

fn sub3(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn scale3(value: [f64; 3], scale: f64) -> [f64; 3] {
    [value[0] * scale, value[1] * scale, value[2] * scale]
}

fn dot3(a: [f64; 3], b: [f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn cross3(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn length3(value: [f64; 3]) -> f64 {
    dot3(value, value).sqrt()
}

fn normalize3(value: [f64; 3]) -> Option<[f64; 3]> {
    let length = length3(value);
    (length > 1e-9 && length.is_finite()).then(|| scale3(value, 1.0 / length))
}

fn rotate_vector(value: [f64; 3], axis: [f64; 3], angle: f64) -> [f64; 3] {
    let cosine = angle.cos();
    let sine = angle.sin();
    add3(
        add3(scale3(value, cosine), scale3(cross3(axis, value), sine)),
        scale3(axis, dot3(axis, value) * (1.0 - cosine)),
    )
}

fn max_numbered_name(sketches: &[FinishedSketch], prefix: &str) -> u32 {
    sketches
        .iter()
        .filter_map(|sketch| sketch.session.name().strip_prefix(prefix))
        .filter_map(|suffix| suffix.parse::<u32>().ok())
        .max()
        .unwrap_or(0)
}

fn max_feature_number(document: &Document, prefix: &str) -> u32 {
    document
        .features()
        .features
        .iter()
        .filter_map(|feature| feature.name.strip_prefix(prefix))
        .filter_map(|suffix| suffix.parse::<u32>().ok())
        .max()
        .unwrap_or(0)
}

impl Default for SketchManager {
    fn default() -> Self {
        Self::new()
    }
}

fn profile_catalog_item(sketch: &SketchDto, feature_id: FeatureId) -> ProfileCatalogItemDto {
    const PROFILE_TOLERANCE: f64 = 1e-5;
    // The constraint solver deliberately collapses a fully consumed fillet
    // carrier to a sub-micron remnant instead of deleting its stable entity.
    // Do not turn that numerical remnant into a microscopic solid face.
    const CONSUMED_LINE_TOLERANCE: f64 = 1e-3;
    let mut segments = Vec::new();
    let mut lines = Vec::new();
    let mut path_curves = Vec::new();
    let mut reference_points = Vec::new();
    for entity in &sketch.entities {
        match entity {
            crate::dto::EntityDto::Line { id, start, end, .. } => {
                let line = SketchLineDto {
                    entity_id: id.0,
                    start: Point2Dto::new(start.x, start.y),
                    end: Point2Dto::new(end.x, end.y),
                };
                lines.push(line.clone());
                reference_points.push(SketchReferencePointDto {
                    entity_id: id.0,
                    point: SketchPointKindDto::Start,
                    position: line.start,
                });
                reference_points.push(SketchReferencePointDto {
                    entity_id: id.0,
                    point: SketchPointKindDto::End,
                    position: line.end,
                });
                path_curves.push(SketchPathCurveDto::Line {
                    entity_id: line.entity_id,
                    start: line.start,
                    end: line.end,
                });
                let a = Point2Dto::new(start.x, start.y);
                let b = Point2Dto::new(end.x, end.y);
                // An exact fillet boundary intentionally leaves a zero-span
                // carrier line. It remains addressable in the sketch but is
                // not part of the closed profile boundary.
                if point2_distance(a, b) > CONSUMED_LINE_TOLERANCE {
                    segments.push(Segment2 {
                        id: id.0 * 1_000,
                        a,
                        b,
                    });
                }
            }
            crate::dto::EntityDto::Circle {
                id, center, radius, ..
            } => {
                reference_points.push(SketchReferencePointDto {
                    entity_id: id.0,
                    point: SketchPointKindDto::Center,
                    position: Point2Dto::new(center.x, center.y),
                });
                path_curves.push(SketchPathCurveDto::Circle {
                    entity_id: id.0,
                    center: Point2Dto::new(center.x, center.y),
                    radius: *radius,
                });
                let points = (0..64)
                    .map(|index| {
                        let angle = TAU * index as f64 / 64.0;
                        Point2Dto::new(
                            center.x + radius * angle.cos(),
                            center.y + radius * angle.sin(),
                        )
                    })
                    .collect::<Vec<_>>();
                push_polyline_segments(&mut segments, id.0, &points, true);
            }
            crate::dto::EntityDto::Arc {
                id,
                center,
                radius,
                start_angle,
                end_angle,
                ..
            } => {
                let raw = end_angle - start_angle;
                let sweep = if raw.abs() >= TAU - 1e-8 {
                    TAU
                } else {
                    raw.rem_euclid(TAU)
                };
                let steps = ((sweep / TAU) * 64.0).ceil().max(8.0) as usize;
                let points = (0..=steps)
                    .map(|index| {
                        let angle = start_angle + sweep * index as f64 / steps as f64;
                        Point2Dto::new(
                            center.x + radius * angle.cos(),
                            center.y + radius * angle.sin(),
                        )
                    })
                    .collect::<Vec<_>>();
                reference_points.push(SketchReferencePointDto {
                    entity_id: id.0,
                    point: SketchPointKindDto::Center,
                    position: Point2Dto::new(center.x, center.y),
                });
                if let Some(start) = points.first().copied() {
                    reference_points.push(SketchReferencePointDto {
                        entity_id: id.0,
                        point: SketchPointKindDto::Start,
                        position: start,
                    });
                }
                if let Some(end) = points.last().copied() {
                    reference_points.push(SketchReferencePointDto {
                        entity_id: id.0,
                        point: SketchPointKindDto::End,
                        position: end,
                    });
                }
                if let (Some(start), Some(mid), Some(end)) = (
                    points.first().copied(),
                    points.get(points.len() / 2).copied(),
                    points.last().copied(),
                ) {
                    path_curves.push(SketchPathCurveDto::Arc {
                        entity_id: id.0,
                        start,
                        mid,
                        end,
                    });
                }
                push_polyline_segments(&mut segments, id.0, &points, false);
            }
            crate::dto::EntityDto::Spline {
                id,
                points: fit_points,
                tessellation,
                ..
            } => {
                reference_points.extend(fit_points.iter().enumerate().map(|(index, point)| {
                    SketchReferencePointDto {
                        entity_id: id.0,
                        point: SketchPointKindDto::FitPoint {
                            index: index as u32,
                        },
                        position: Point2Dto::new(point.x, point.y),
                    }
                }));
                let points = tessellation
                    .iter()
                    .map(|point| Point2Dto::new(point.x, point.y))
                    .collect::<Vec<_>>();
                path_curves.push(SketchPathCurveDto::Spline {
                    entity_id: id.0,
                    points: points.clone(),
                });
                push_polyline_segments(&mut segments, id.0, &points, false);
            }
            crate::dto::EntityDto::Point { id, position, .. } => {
                reference_points.push(SketchReferencePointDto {
                    entity_id: id.0,
                    point: SketchPointKindDto::Point,
                    position: Point2Dto::new(position.x, position.y),
                });
            }
        }
    }

    let loops = if segments.is_empty() {
        Vec::new()
    } else {
        extract_closed_loops_allow_open(&segments, PROFILE_TOLERANCE).unwrap_or_default()
    };
    let mut profiles = loops
        .into_iter()
        .enumerate()
        .map(|(index, points)| ProfileLoopDto {
            index: index as u32,
            area: polygon_area(&points).abs(),
            parent_index: None,
            nesting_depth: 0,
            curves: ordered_profile_curves(sketch, &segments, &points, PROFILE_TOLERANCE),
            points,
        })
        .collect::<Vec<_>>();
    classify_profile_nesting(&mut profiles, PROFILE_TOLERANCE);
    ProfileCatalogItemDto {
        sketch_name: sketch.name.clone(),
        feature_id,
        basis: sketch.basis,
        profiles,
        lines,
        path_curves,
        reference_points,
    }
}

fn classify_profile_nesting(profiles: &mut [ProfileLoopDto], tolerance: f64) {
    let parents = profiles
        .iter()
        .map(|profile| {
            let sample = profile.points.first().copied()?;
            profiles
                .iter()
                .filter(|candidate| candidate.area > profile.area + 1e-8)
                .filter(|candidate| point_in_polygon_strict(sample, &candidate.points, tolerance))
                .min_by(|a, b| a.area.total_cmp(&b.area))
                .map(|candidate| candidate.index)
        })
        .collect::<Vec<_>>();
    for (profile, parent) in profiles.iter_mut().zip(parents) {
        profile.parent_index = parent;
    }
    let parent_map = profiles
        .iter()
        .map(|profile| (profile.index, profile.parent_index))
        .collect::<std::collections::HashMap<_, _>>();
    for profile in profiles {
        let mut depth = 0;
        let mut current = profile.parent_index;
        let mut visited = BTreeSet::new();
        while let Some(parent) = current {
            if !visited.insert(parent) {
                break;
            }
            depth += 1;
            current = parent_map.get(&parent).copied().flatten();
        }
        profile.nesting_depth = depth;
    }
}

fn point_in_polygon_strict(point: Point2Dto, polygon: &[Point2Dto], tolerance: f64) -> bool {
    for (a, b) in polygon
        .iter()
        .zip(polygon.iter().cycle().skip(1))
        .take(polygon.len())
    {
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let length2 = dx * dx + dy * dy;
        if length2 <= tolerance * tolerance {
            continue;
        }
        let t = (((point.x - a.x) * dx + (point.y - a.y) * dy) / length2).clamp(0.0, 1.0);
        let closest = Point2Dto::new(a.x + t * dx, a.y + t * dy);
        if point2_distance(point, closest) <= tolerance {
            return false;
        }
    }

    let mut inside = false;
    for (a, b) in polygon
        .iter()
        .zip(polygon.iter().cycle().skip(1))
        .take(polygon.len())
    {
        let crosses = (a.y > point.y) != (b.y > point.y)
            && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x;
        if crosses {
            inside = !inside;
        }
    }
    inside
}

fn push_polyline_segments(
    segments: &mut Vec<Segment2>,
    entity_id: u64,
    points: &[Point2Dto],
    close: bool,
) {
    for (index, pair) in points.windows(2).enumerate() {
        segments.push(Segment2 {
            id: entity_id * 1_000 + index as u64,
            a: pair[0],
            b: pair[1],
        });
    }
    if close && points.len() > 2 {
        segments.push(Segment2 {
            id: entity_id * 1_000 + points.len() as u64,
            a: *points.last().unwrap(),
            b: points[0],
        });
    }
}

fn polygon_area(points: &[Point2Dto]) -> f64 {
    points
        .iter()
        .zip(points.iter().cycle().skip(1))
        .map(|(a, b)| a.x * b.y - b.x * a.y)
        .sum::<f64>()
        * 0.5
}

fn point2_distance(a: Point2Dto, b: Point2Dto) -> f64 {
    ((a.x - b.x).powi(2) + (a.y - b.y).powi(2)).sqrt()
}

fn segment_length_squared(segment: &Segment2) -> f64 {
    (segment.b.x - segment.a.x).powi(2) + (segment.b.y - segment.a.y).powi(2)
}

fn segment_contains_profile_edge(
    segment: &Segment2,
    a: Point2Dto,
    b: Point2Dto,
    tolerance: f64,
) -> bool {
    let dx = segment.b.x - segment.a.x;
    let dy = segment.b.y - segment.a.y;
    let length2 = dx * dx + dy * dy;
    if length2 <= tolerance * tolerance {
        return false;
    }
    let length = length2.sqrt();
    [a, b].into_iter().all(|point| {
        let parameter = ((point.x - segment.a.x) * dx + (point.y - segment.a.y) * dy) / length2;
        let parameter_tolerance = tolerance / length;
        if parameter < -parameter_tolerance || parameter > 1.0 + parameter_tolerance {
            return false;
        }
        let projected = Point2Dto::new(
            segment.a.x + parameter.clamp(0.0, 1.0) * dx,
            segment.a.y + parameter.clamp(0.0, 1.0) * dy,
        );
        point2_distance(point, projected) <= tolerance
    })
}

/// Recover the source sketch entity for each tessellated loop edge, then
/// collapse consecutive samples back into one ordered analytic curve. The
/// polygon remains available as a compatibility fallback, but OCCT receives
/// one arc rather than the 8–64 chords used to discover the profile.
fn ordered_profile_curves(
    sketch: &SketchDto,
    segments: &[Segment2],
    points: &[Point2Dto],
    tolerance: f64,
) -> Vec<ProfileCurveDto> {
    if points.len() < 3 {
        return Vec::new();
    }
    let source_ids = points
        .iter()
        .copied()
        .zip(points.iter().copied().cycle().skip(1))
        .take(points.len())
        .map(|(a, b)| {
            segments
                .iter()
                .filter(|segment| segment_contains_profile_edge(segment, a, b, tolerance))
                // Prefer the longest analytic carrier when redundant sketch
                // geometry overlaps a profile edge. Adjacent noded pieces
                // then collapse back to the original rectangle/arc entity
                // instead of producing avoidable split kernel faces.
                .max_by(|left, right| {
                    segment_length_squared(left)
                        .total_cmp(&segment_length_squared(right))
                        .then_with(|| right.id.cmp(&left.id))
                })
                .map(|segment| segment.id / 1_000)
        })
        .collect::<Option<Vec<_>>>();
    let Some(source_ids) = source_ids else {
        return Vec::new();
    };

    // Start at an entity boundary so a circle/arc cannot be split between
    // the beginning and end of the returned vector.
    let start_edge = (0..source_ids.len())
        .find(|index| {
            source_ids[*index] != source_ids[(*index + source_ids.len() - 1) % source_ids.len()]
        })
        .unwrap_or(0);
    let mut groups: Vec<(u64, Vec<Point2Dto>)> = Vec::new();
    for step in 0..source_ids.len() {
        let edge = (start_edge + step) % source_ids.len();
        let source = source_ids[edge];
        let a = points[edge];
        let b = points[(edge + 1) % points.len()];
        if groups.last().is_none_or(|(id, _)| *id != source) {
            groups.push((source, vec![a, b]));
        } else {
            groups.last_mut().unwrap().1.push(b);
        }
    }

    groups
        .into_iter()
        .filter_map(|(entity_id, path)| {
            let entity = sketch.entities.iter().find(|entity| match entity {
                crate::dto::EntityDto::Point { id, .. }
                | crate::dto::EntityDto::Line { id, .. }
                | crate::dto::EntityDto::Circle { id, .. }
                | crate::dto::EntityDto::Arc { id, .. }
                | crate::dto::EntityDto::Spline { id, .. } => id.0 == entity_id,
            })?;
            let start = path[0];
            let end = *path.last()?;
            Some(match entity {
                crate::dto::EntityDto::Line { .. } => ProfileCurveDto::Line {
                    entity_id,
                    start,
                    end,
                },
                crate::dto::EntityDto::Arc { center, radius, .. }
                    if point2_distance(start, end) <= tolerance =>
                {
                    ProfileCurveDto::Circle {
                        entity_id,
                        center: Point2Dto::new(center.x, center.y),
                        radius: *radius,
                    }
                }
                crate::dto::EntityDto::Arc { .. } => ProfileCurveDto::Arc {
                    entity_id,
                    start,
                    mid: path[path.len() / 2],
                    end,
                },
                crate::dto::EntityDto::Circle { center, radius, .. } => ProfileCurveDto::Circle {
                    entity_id,
                    center: Point2Dto::new(center.x, center.y),
                    radius: *radius,
                },
                crate::dto::EntityDto::Spline { .. } => ProfileCurveDto::Polyline {
                    entity_id,
                    points: path,
                },
                crate::dto::EntityDto::Point { .. } => return None,
            })
        })
        .collect()
}

#[cfg(test)]
mod project_tests {
    use super::*;
    use crate::{
        DrawingAnnotationDto, DrawingDocumentDto, DrawingEdgeEndpoint, DrawingLineRefDto,
        DrawingLinearDimensionMode, DrawingProjectionMethod, DrawingSheetDto, DrawingSheetFormat,
        DrawingSheetOrientation, DrawingStandard, DrawingTitleBlockDto, DrawingToleranceNoteDto,
        DrawingTolerancePreset, DrawingTopologyAnchorRefDto, DrawingViewAlignment, DrawingViewDto,
        DrawingViewKind,
    };
    use nbcad_core::{BodyId, DimensionStyle, OriginPlane};
    use nbcad_solid::{
        ExtrudeExtent, ExtrudeOperation, HoleExtent, HoleStyle, ImportStepRequest, KernelBodyDto,
        KernelCurveDto, KernelEdgeDto, KernelFaceDto, KernelJobDto, KernelSceneDto, LoftRequest,
        PlanarFaceSignatureDto, Point3Dto, ProfileRefDto, ReorderFeatureRequest, RibRequest,
        SweepRequest,
    };

    fn raw_body(body_id: BodyId, basis: nbcad_core::PlaneBasis) -> KernelBodyDto {
        KernelBodyDto {
            body_id,
            positions: vec![0.0, 0.0, 0.0, 20.0, 0.0, 0.0, 0.0, 10.0, 0.0],
            normals: vec![0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0],
            indices: vec![0, 1, 2],
            faces: vec![KernelFaceDto {
                key: "face:0".to_string(),
                first_index: 0,
                index_count: 3,
                plane: Some(basis),
                signature: Some(PlanarFaceSignatureDto {
                    centroid: Point3Dto {
                        x: 20.0 / 3.0,
                        y: 10.0 / 3.0,
                        z: 0.0,
                    },
                    normal: Point3Dto::from(basis.normal),
                    area: 100.0,
                    perimeter: 30.0 + 500.0_f64.sqrt(),
                    wire_count: 1,
                    edge_count: 3,
                }),
            }],
            edges: vec![
                KernelEdgeDto {
                    key: "edge:0".to_string(),
                    points: vec![
                        Point3Dto::from([0.0, 0.0, 0.0]),
                        Point3Dto::from([20.0, 0.0, 0.0]),
                    ],
                    refinable: true,
                },
                KernelEdgeDto {
                    key: "edge:1".to_string(),
                    points: vec![
                        Point3Dto::from([20.0, 0.0, 0.0]),
                        Point3Dto::from([0.0, 10.0, 0.0]),
                    ],
                    refinable: true,
                },
            ],
        }
    }

    fn result_body_ids(job: &KernelJobDto) -> &[BodyId] {
        match job {
            KernelJobDto::Extrude(job) => &job.result_body_ids,
            KernelJobDto::Revolve(job) => &job.result_body_ids,
            KernelJobDto::Sweep(job) => &job.result_body_ids,
            KernelJobDto::Loft(job) => &job.result_body_ids,
            KernelJobDto::Rib(job) => &job.result_body_ids,
            KernelJobDto::Fillet(job) => std::slice::from_ref(&job.target_body_id),
            KernelJobDto::Chamfer(job) => std::slice::from_ref(&job.target_body_id),
            KernelJobDto::Hole(job) => std::slice::from_ref(&job.target_body_id),
            KernelJobDto::Shell(job) => std::slice::from_ref(&job.target_body_id),
            KernelJobDto::Transform(job) => &job.result_body_ids,
            KernelJobDto::Combine(job) => std::slice::from_ref(&job.target_body_id),
            KernelJobDto::SplitBody(job) => std::slice::from_ref(&job.new_body_id),
            KernelJobDto::ImportStep(job) => std::slice::from_ref(&job.result_body_id),
        }
    }

    fn commit_plan(
        manager: &mut SketchManager,
        plan: RecomputePlanDto,
        basis: nbcad_core::PlaneBasis,
    ) {
        let ids = plan
            .jobs
            .iter()
            .flat_map(result_body_ids)
            .copied()
            .collect::<BTreeSet<_>>();
        manager
            .commit_solid(CommitKernelRequest {
                transaction_id: plan.transaction_id,
                scene: KernelSceneDto {
                    bodies: ids.into_iter().map(|id| raw_body(id, basis)).collect(),
                    errors: Vec::new(),
                },
            })
            .unwrap();
    }

    #[test]
    fn project_roundtrip_replays_feature_history_and_stable_body_ids() {
        let mut manager = SketchManager::new();
        let plane = PlaneRef::OriginPlane {
            plane: OriginPlane::Xy,
        };
        let basis = plane.origin_basis().unwrap();
        manager.begin_sketch(plane).unwrap();
        manager
            .add_rectangle_locked(LockedRectangleRequest {
                mode: crate::dto::RectangleMode::TwoPoint,
                anchor: crate::Vec2::new(0.0, 0.0),
                width_mm: Some(20.0),
                height_mm: Some(10.0),
                width_text: Some("20".to_string()),
                height_text: Some("10".to_string()),
                corner_hint: crate::Vec2::new(20.0, 10.0),
                ctrl_held: false,
            })
            .unwrap();
        manager.end_sketch().unwrap();
        let plan = manager
            .prepare_extrude(ExtrudeRequest {
                source_face: None,
                sketch_name: "Sketch1".to_string(),
                profile_indices: vec![0],
                operation: ExtrudeOperation::NewBody,
                extent: ExtrudeExtent::Distance { distance: 15.0 },
                taper_angle_deg: 0.0,
                flip: false,
                target_body_ids: Vec::new(),
            })
            .unwrap();
        let body_id = result_body_ids(&plan.jobs[0])[0];
        manager
            .commit_solid(CommitKernelRequest {
                transaction_id: plan.transaction_id,
                scene: KernelSceneDto {
                    bodies: vec![raw_body(body_id, basis)],
                    errors: Vec::new(),
                },
            })
            .unwrap();

        let json = manager.export_project_model().unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["format"], PROJECT_FORMAT);
        assert_eq!(parsed["schema_version"], PROJECT_SCHEMA_VERSION);
        assert!(parsed.get("scene").is_none());

        let mut loaded = SketchManager::new();
        let replay = loaded.prepare_load_project(json).unwrap();
        assert_eq!(replay.jobs.len(), 1);
        assert_eq!(result_body_ids(&replay.jobs[0]), &[body_id]);
        let update = loaded
            .commit_solid(CommitKernelRequest {
                transaction_id: replay.transaction_id,
                scene: KernelSceneDto {
                    bodies: vec![raw_body(body_id, basis)],
                    errors: Vec::new(),
                },
            })
            .unwrap();
        assert_eq!(update.document.features.len(), 2);
        assert_eq!(loaded.finished_sketches().len(), 1);
        assert_eq!(update.scene.bodies[0].id, body_id);
        assert!(loaded
            .export_project_model()
            .unwrap()
            .contains("\"Sketch1\""));
    }

    #[test]
    fn project_roundtrip_persists_appearance_and_visibility_and_scrubs_orphans() {
        use nbcad_core::{BodyAppearance, Rgba8};

        let mut manager = SketchManager::new();
        let basis = PlaneRef::OriginPlane {
            plane: OriginPlane::Xy,
        }
        .origin_basis()
        .unwrap();
        manager
            .begin_sketch(PlaneRef::OriginPlane {
                plane: OriginPlane::Xy,
            })
            .unwrap();
        manager
            .add_rectangle_locked(crate::dto::LockedRectangleRequest {
                mode: crate::dto::RectangleMode::TwoPoint,
                anchor: crate::Vec2::new(0.0, 0.0),
                width_mm: Some(20.0),
                height_mm: Some(10.0),
                width_text: Some("20".to_string()),
                height_text: Some("10".to_string()),
                corner_hint: crate::Vec2::new(20.0, 10.0),
                ctrl_held: false,
            })
            .unwrap();
        manager.end_sketch().unwrap();
        let plan = manager
            .prepare_extrude(ExtrudeRequest {
                source_face: None,
                sketch_name: "Sketch1".to_string(),
                profile_indices: vec![0],
                operation: ExtrudeOperation::NewBody,
                extent: ExtrudeExtent::Distance { distance: 15.0 },
                taper_angle_deg: 0.0,
                flip: false,
                target_body_ids: Vec::new(),
            })
            .unwrap();
        let body_id = result_body_ids(&plan.jobs[0])[0];
        manager
            .commit_solid(CommitKernelRequest {
                transaction_id: plan.transaction_id,
                scene: KernelSceneDto {
                    bodies: vec![raw_body(body_id, basis)],
                    errors: Vec::new(),
                },
            })
            .unwrap();

        manager
            .set_body_appearance(BodyAppearance {
                body_id,
                color: Rgba8::opaque(200, 40, 40),
                material_name: "PLA Red".to_string(),
                filament_type: "PLA".to_string(),
                brand: "Bambu Lab".to_string(),
                color_name: "Red".to_string(),
                filament_id: Some("GFA00".into()),
                preset_id: Some("bambu.pla.basic.red".into()),
                density_g_cm3: Some(1.24),
                diameter_mm: 1.75,
            })
            .unwrap();
        // Orphan appearance for a deleted body must not survive save.
        manager.body_appearances.push(BodyAppearance {
            body_id: BodyId(999),
            color: Rgba8::opaque(0, 0, 0),
            material_name: "Gone".to_string(),
            filament_type: "PLA".to_string(),
            brand: "Generic".to_string(),
            color_name: String::new(),
            filament_id: None,
            preset_id: None,
            density_g_cm3: None,
            diameter_mm: 1.75,
        });
        let visibility = manager
            .set_project_visibility(ProjectVisibilityDto {
                hidden_body_ids: vec![body_id.0, 999],
                hidden_datum_plane_ids: vec![999],
                hidden_sketch_names: vec!["Sketch1".into(), "DeletedSketch".into()],
            })
            .unwrap();
        assert_eq!(visibility.hidden_body_ids, vec![body_id.0]);
        assert!(visibility.hidden_datum_plane_ids.is_empty());
        assert_eq!(visibility.hidden_sketch_names, vec!["Sketch1"]);

        let json = manager.export_project_model().unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        let appearances = parsed["body_appearances"].as_array().unwrap();
        assert_eq!(appearances.len(), 1);
        assert_eq!(appearances[0]["body_id"], body_id.0);
        assert_eq!(appearances[0]["material_name"], "PLA Red");
        assert_eq!(appearances[0]["color"]["r"], 200);
        assert_eq!(parsed["visibility"]["hidden_body_ids"][0], body_id.0);
        assert_eq!(parsed["visibility"]["hidden_sketch_names"][0], "Sketch1");
        assert_eq!(
            parsed["visibility"]["hidden_datum_plane_ids"]
                .as_array()
                .unwrap()
                .len(),
            0
        );

        let mut loaded = SketchManager::new();
        let replay = loaded.prepare_load_project(json).unwrap();
        loaded
            .commit_solid(CommitKernelRequest {
                transaction_id: replay.transaction_id,
                scene: KernelSceneDto {
                    bodies: vec![raw_body(body_id, basis)],
                    errors: Vec::new(),
                },
            })
            .unwrap();
        let restored = loaded.body_appearances();
        assert_eq!(restored.len(), 1);
        assert_eq!(restored[0].body_id, body_id);
        assert_eq!(restored[0].material_name, "PLA Red");
        assert_eq!(restored[0].color.r, 200);
        assert_eq!(loaded.project_visibility(), visibility);
    }

    #[test]
    fn project_roundtrip_embeds_and_replays_step_import_source() {
        let mut manager = SketchManager::new();
        let basis = PlaneRef::OriginPlane {
            plane: OriginPlane::Xy,
        }
        .origin_basis()
        .unwrap();
        let plan = manager
            .prepare_body_feature(BodyFeatureRequestDto::ImportStep(ImportStepRequest {
                file_name: "fixture.stp".to_string(),
                data_base64: "U1RFUA==".to_string(),
            }))
            .unwrap();
        let KernelJobDto::ImportStep(import) = &plan.jobs[0] else {
            panic!("STEP source should plan an import job");
        };
        let body_id = import.result_body_id;
        manager
            .commit_solid(CommitKernelRequest {
                transaction_id: plan.transaction_id,
                scene: KernelSceneDto {
                    bodies: vec![raw_body(body_id, basis)],
                    errors: Vec::new(),
                },
            })
            .unwrap();

        let json = manager.export_project_model().unwrap();
        assert!(json.contains("\"fixture.stp\""));
        assert!(json.contains("\"U1RFUA==\""));

        let mut loaded = SketchManager::new();
        let replay = loaded.prepare_load_project(json).unwrap();
        let KernelJobDto::ImportStep(import) = &replay.jobs[0] else {
            panic!("saved STEP source should replay as an import job");
        };
        assert_eq!(import.result_body_id, body_id);
        assert_eq!(import.data_base64, "U1RFUA==");
        loaded
            .commit_solid(CommitKernelRequest {
                transaction_id: replay.transaction_id,
                scene: KernelSceneDto {
                    bodies: vec![raw_body(body_id, basis)],
                    errors: Vec::new(),
                },
            })
            .unwrap();
        assert_eq!(loaded.solid_scene().bodies[0].id, body_id);
    }

    #[test]
    fn timeline_reorder_allows_independent_branches_and_rejects_broken_dependencies() {
        let mut manager = SketchManager::new();
        let plane = PlaneRef::OriginPlane {
            plane: OriginPlane::Xy,
        };
        let basis = plane.origin_basis().unwrap();
        manager.begin_sketch(plane).unwrap();
        manager
            .add_rectangle(RectangleRequest {
                mode: crate::dto::RectangleMode::TwoPoint,
                p1: crate::Vec2::new(0.0, 0.0),
                p2: crate::Vec2::new(20.0, 10.0),
                ctrl_held: false,
            })
            .unwrap();
        manager.end_sketch().unwrap();
        let plan = manager
            .prepare_extrude(ExtrudeRequest {
                source_face: None,
                sketch_name: "Sketch1".to_string(),
                profile_indices: vec![0],
                operation: ExtrudeOperation::NewBody,
                extent: ExtrudeExtent::Distance { distance: 10.0 },
                taper_angle_deg: 0.0,
                flip: false,
                target_body_ids: Vec::new(),
            })
            .unwrap();
        commit_plan(&mut manager, plan, basis);

        manager
            .begin_sketch(PlaneRef::OriginPlane {
                plane: OriginPlane::Xy,
            })
            .unwrap();
        manager
            .add_circle(CircleRequest {
                mode: crate::dto::CircleMode::CenterDiameter,
                p1: crate::Vec2::new(30.0, 0.0),
                p2: crate::Vec2::new(35.0, 0.0),
                ctrl_held: false,
            })
            .unwrap();
        manager.end_sketch().unwrap();

        let initial = manager.document_dto();
        let sketch1 = initial.features[0].id;
        let extrude = initial.features[1].id;
        let sketch2 = initial.features[2].id;
        let plan = manager
            .prepare_reorder_feature(ReorderFeatureRequest {
                feature_id: sketch2,
                target_index: 0,
            })
            .unwrap();
        commit_plan(&mut manager, plan, basis);
        assert_eq!(
            manager
                .document_dto()
                .features
                .iter()
                .map(|feature| feature.id)
                .collect::<Vec<_>>(),
            vec![sketch2, sketch1, extrude]
        );

        let error = manager
            .prepare_reorder_feature(ReorderFeatureRequest {
                feature_id: extrude,
                target_index: 1,
            })
            .unwrap_err();
        assert!(error.to_string().contains("before its dependency Sketch1"));
        assert_eq!(
            manager
                .document_dto()
                .features
                .iter()
                .map(|feature| feature.id)
                .collect::<Vec<_>>(),
            vec![sketch2, sketch1, extrude]
        );
    }

    #[test]
    fn new_project_replaces_the_current_model_only_after_commit() {
        let mut manager = SketchManager::new();
        manager
            .set_document_name("Existing design".to_string())
            .unwrap();

        let plan = manager.prepare_new_project().unwrap();
        assert_eq!(manager.document().name(), "Existing design");
        assert!(plan.jobs.is_empty());

        let update = manager
            .commit_solid(CommitKernelRequest {
                transaction_id: plan.transaction_id,
                scene: KernelSceneDto {
                    bodies: Vec::new(),
                    errors: Vec::new(),
                },
            })
            .unwrap();

        assert_eq!(manager.document().name(), "Untitled");
        assert_eq!(update.document.name, "Untitled");
        assert!(update.document.features.is_empty());
        assert!(update.scene.bodies.is_empty());
        assert!(manager.finished_sketches().is_empty());
    }

    #[test]
    fn project_roundtrip_preserves_technical_drawing_intent() {
        let drawing = DrawingDocumentDto {
            sheets: vec![DrawingSheetDto {
                id: 4,
                name: "Assembly overview".to_string(),
                format: DrawingSheetFormat::A3,
                orientation: DrawingSheetOrientation::Landscape,
                standard: DrawingStandard::Iso,
                projection_method: DrawingProjectionMethod::FirstAngle,
                tolerance_note: DrawingToleranceNoteDto {
                    preset: DrawingTolerancePreset::Iso2768Medium,
                    custom: String::new(),
                },
                title_block: DrawingTitleBlockDto {
                    title: "Clamp".to_string(),
                    drawing_number: "NBC-042".to_string(),
                    revision: "B".to_string(),
                    author: "QA".to_string(),
                    ..DrawingTitleBlockDto::default()
                },
                views: vec![DrawingViewDto {
                    id: 9,
                    name: "Front".to_string(),
                    kind: DrawingViewKind::Front,
                    direction: [0.0, -1.0, 0.0],
                    up: [0.0, 0.0, 1.0],
                    position: [120.0, 80.0],
                    scale: 0.5,
                    body_ids: vec![],
                    show_hidden_lines: true,
                    show_tangent_edges: false,
                    parent_view_id: None,
                    alignment: DrawingViewAlignment::Free,
                    derivation: None,
                }],
                annotations: vec![
                    DrawingAnnotationDto::LinearDimension {
                        id: 12,
                        view_id: 9,
                        first: DrawingTopologyAnchorRefDto {
                            body_id: BodyId(1),
                            edge_id: nbcad_core::EdgeId(101),
                            edge_key: "edge:0".to_string(),
                            endpoint: DrawingEdgeEndpoint::Start,
                            fallback_point: [0.0, 0.0, 0.0],
                            circle_center: false,
                        },
                        second: DrawingTopologyAnchorRefDto {
                            body_id: BodyId(1),
                            edge_id: nbcad_core::EdgeId(102),
                            edge_key: "edge:1".to_string(),
                            endpoint: DrawingEdgeEndpoint::End,
                            fallback_point: [20.0, 0.0, 0.0],
                            circle_center: false,
                        },
                        mode: DrawingLinearDimensionMode::Horizontal,
                        offset: -12.0,
                        prefix: String::new(),
                        suffix: " TYP".to_string(),
                        precision: 2,
                        presentation: crate::drawing::DrawingDimensionPresentationDto::default(),
                    },
                    DrawingAnnotationDto::CenterLineBetweenEdges {
                        id: 13,
                        view_id: 9,
                        first: DrawingLineRefDto {
                            body_id: BodyId(1),
                            edge_id: nbcad_core::EdgeId(201),
                            edge_key: "edge:center-left".to_string(),
                            fallback_start: [0.0, 0.0, 0.0],
                            fallback_end: [20.0, 0.0, 0.0],
                        },
                        second: DrawingLineRefDto {
                            body_id: BodyId(1),
                            edge_id: nbcad_core::EdgeId(202),
                            edge_key: "edge:center-right".to_string(),
                            fallback_start: [0.0, 10.0, 0.0],
                            fallback_end: [20.0, 10.0, 0.0],
                        },
                        extension: 2.5,
                    },
                ],
                style: crate::drawing::DrawingSheetStyleDto::default(),
                template_name: String::new(),
                revisions: vec![],
                bom: vec![],
                release: crate::drawing::DrawingReleaseDto::default(),
                revision_table_position: None,
                bom_table_position: None,
            }],
            active_sheet_id: Some(4),
            next_sheet_id: 5,
            next_view_id: 10,
            next_annotation_id: 14,
            next_revision_id: 1,
            next_bom_item_id: 1,
            templates: vec![],
            next_template_id: 1,
        };
        let mut manager = SketchManager::new();
        manager.set_drawing_document(drawing.clone()).unwrap();

        let json = manager.export_project_model().unwrap();
        let mut loaded = SketchManager::new();
        let replay = loaded.prepare_load_project(json).unwrap();
        assert!(replay.jobs.is_empty());
        loaded
            .commit_solid(CommitKernelRequest {
                transaction_id: replay.transaction_id,
                scene: KernelSceneDto {
                    bodies: Vec::new(),
                    errors: Vec::new(),
                },
            })
            .unwrap();

        assert_eq!(loaded.drawing_document(), drawing);
    }

    #[test]
    fn nested_sketch_loops_plan_one_material_region_with_an_inner_wire() {
        let mut manager = SketchManager::new();
        manager
            .begin_sketch(PlaneRef::OriginPlane {
                plane: OriginPlane::Xy,
            })
            .unwrap();
        for (p1, p2) in [
            (crate::Vec2::new(0.0, 0.0), crate::Vec2::new(40.0, 40.0)),
            (crate::Vec2::new(10.0, 10.0), crate::Vec2::new(30.0, 30.0)),
        ] {
            manager
                .add_rectangle(RectangleRequest {
                    mode: crate::dto::RectangleMode::TwoPoint,
                    p1,
                    p2,
                    ctrl_held: false,
                })
                .unwrap();
        }
        manager.end_sketch().unwrap();

        let catalog = manager.profile_catalog();
        let profiles = &catalog[0].profiles;
        assert_eq!(profiles.len(), 2);
        let outer = profiles
            .iter()
            .max_by(|a, b| a.area.total_cmp(&b.area))
            .unwrap();
        let inner = profiles
            .iter()
            .min_by(|a, b| a.area.total_cmp(&b.area))
            .unwrap();
        assert_eq!(outer.parent_index, None);
        assert_eq!(outer.nesting_depth, 0);
        assert_eq!(inner.parent_index, Some(outer.index));
        assert_eq!(inner.nesting_depth, 1);

        // Picking either the visible material region or its enclosed void
        // resolves to the same outer region and carries the hole to the kernel.
        let plan = manager
            .prepare_extrude(ExtrudeRequest {
                source_face: None,
                sketch_name: "Sketch1".to_string(),
                profile_indices: vec![inner.index],
                operation: ExtrudeOperation::NewBody,
                extent: ExtrudeExtent::Distance { distance: 10.0 },
                taper_angle_deg: 0.0,
                flip: false,
                target_body_ids: Vec::new(),
            })
            .unwrap();
        let KernelJobDto::Extrude(job) = &plan.jobs[0] else {
            panic!("nested profile should plan an Extrude job");
        };
        assert_eq!(job.profiles.len(), 1);
        assert_eq!(job.profiles[0].profile_index, outer.index);
        assert_eq!(job.profiles[0].holes.len(), 1);
        assert_eq!(job.profiles[0].holes[0].profile_index, inner.index);
        assert_eq!(job.result_body_ids.len(), 1);
    }

    #[test]
    fn dimensioned_chain_with_an_attached_rectangle_keeps_its_closed_profile() {
        let mut manager = SketchManager::new();
        manager
            .begin_sketch(PlaneRef::OriginPlane {
                plane: OriginPlane::Xy,
            })
            .unwrap();

        manager
            .add_line_locked(LockedSegmentRequest {
                from: crate::Vec2::new(0.0, 0.0),
                to_hint: crate::Vec2::new(-15.0, 0.0),
                length_mm: None,
                angle_deg: None,
                length_text: Some("15".to_string()),
                angle_text: None,
                ctrl_held: false,
            })
            .unwrap();
        let vertical = manager
            .add_line_locked(LockedSegmentRequest {
                from: crate::Vec2::new(-15.0, 0.0),
                to_hint: crate::Vec2::new(-15.0, -7.5),
                length_mm: None,
                angle_deg: None,
                length_text: Some("7.5".to_string()),
                angle_text: None,
                ctrl_held: false,
            })
            .unwrap();
        assert_eq!(vertical.sketch.dimensions.len(), 2);
        manager
            .add_rectangle_locked(LockedRectangleRequest {
                mode: crate::dto::RectangleMode::TwoPoint,
                anchor: crate::Vec2::new(-15.0, -7.5),
                width_mm: None,
                height_mm: None,
                width_text: Some("30".to_string()),
                height_text: Some("15".to_string()),
                corner_hint: crate::Vec2::new(15.0, 7.5),
                ctrl_held: false,
            })
            .unwrap();
        manager.end_sketch().unwrap();

        let catalog = manager.profile_catalog();
        assert_eq!(catalog.len(), 1);
        assert_eq!(
            catalog[0].profiles.len(),
            1,
            "the open origin chain must not hide the attached rectangle"
        );
        assert!((catalog[0].profiles[0].area - 450.0).abs() < 1e-6);
        assert_eq!(
            catalog[0].profiles[0].curves.len(),
            4,
            "the longer rectangle carrier should remain one analytic edge"
        );
    }

    #[test]
    fn shared_edge_regions_are_two_extrudable_profiles() {
        let mut manager = SketchManager::new();
        manager
            .begin_sketch(PlaneRef::OriginPlane {
                plane: OriginPlane::Xy,
            })
            .unwrap();

        let a = crate::Vec2::new(0.0, 10.0);
        let b = crate::Vec2::new(10.0, 20.0);
        let c = crate::Vec2::new(20.0, 10.0);
        let d = crate::Vec2::new(0.0, 0.0);
        let e = crate::Vec2::new(20.0, 0.0);
        for (from, to) in [(a, b), (b, c), (c, a), (a, d), (d, e), (e, c)] {
            manager
                .add_line(SegmentRequest {
                    from,
                    to_raw: to,
                    ctrl_held: true,
                })
                .unwrap();
        }
        manager.end_sketch().unwrap();

        let catalog = manager.profile_catalog();
        let profiles = &catalog[0].profiles;
        assert_eq!(profiles.len(), 2);
        assert!(profiles
            .iter()
            .all(|profile| profile.parent_index.is_none() && profile.nesting_depth == 0));

        let plan = manager
            .prepare_extrude(ExtrudeRequest {
                source_face: None,
                sketch_name: "Sketch1".to_string(),
                profile_indices: profiles.iter().map(|profile| profile.index).collect(),
                operation: ExtrudeOperation::NewBody,
                extent: ExtrudeExtent::Distance { distance: 10.0 },
                taper_angle_deg: 0.0,
                flip: false,
                target_body_ids: Vec::new(),
            })
            .unwrap();
        let KernelJobDto::Extrude(job) = &plan.jobs[0] else {
            panic!("shared-edge regions should plan an Extrude job");
        };
        assert_eq!(job.profiles.len(), 2);
        assert_eq!(job.result_body_ids.len(), 2);
    }

    #[test]
    fn endpoint_on_edge_junctions_create_two_analytic_extrude_profiles() {
        let mut manager = SketchManager::new();
        manager
            .begin_sketch(PlaneRef::OriginPlane {
                plane: OriginPlane::Xy,
            })
            .unwrap();
        manager
            .add_rectangle(RectangleRequest {
                mode: crate::dto::RectangleMode::TwoPoint,
                p1: crate::Vec2::new(0.0, 0.0),
                p2: crate::Vec2::new(40.0, 40.0),
                ctrl_held: false,
            })
            .unwrap();
        for (from, to) in [
            (crate::Vec2::new(20.0, 40.0), crate::Vec2::new(20.0, 20.0)),
            (crate::Vec2::new(20.0, 20.0), crate::Vec2::new(40.0, 20.0)),
        ] {
            manager
                .add_line(SegmentRequest {
                    from,
                    to_raw: to,
                    ctrl_held: true,
                })
                .unwrap();
        }
        manager.end_sketch().unwrap();

        let catalog = manager.profile_catalog();
        let profiles = &catalog[0].profiles;
        assert_eq!(profiles.len(), 2);
        assert!(profiles
            .iter()
            .all(|profile| profile.parent_index.is_none() && profile.nesting_depth == 0));
        assert!(
            profiles.iter().all(|profile| !profile.curves.is_empty()),
            "noded carrier pieces must retain their analytic line sources"
        );

        let plan = manager
            .prepare_extrude(ExtrudeRequest {
                source_face: None,
                sketch_name: "Sketch1".to_string(),
                profile_indices: profiles.iter().map(|profile| profile.index).collect(),
                operation: ExtrudeOperation::NewBody,
                extent: ExtrudeExtent::Distance { distance: 10.0 },
                taper_angle_deg: 0.0,
                flip: false,
                target_body_ids: Vec::new(),
            })
            .unwrap();
        let KernelJobDto::Extrude(job) = &plan.jobs[0] else {
            panic!("endpoint-on-edge regions should plan an Extrude job");
        };
        assert_eq!(job.profiles.len(), 2);
        assert!(job
            .profiles
            .iter()
            .all(|profile| !profile.curves.is_empty()));
    }

    #[test]
    fn future_project_schema_is_rejected_without_replacing_document() {
        let mut manager = SketchManager::new();
        let error = manager
            .prepare_load_project(
                serde_json::json!({
                    "format": PROJECT_FORMAT,
                    "schema_version": PROJECT_SCHEMA_VERSION + 1
                })
                .to_string(),
            )
            .unwrap_err();
        assert!(error.to_string().contains("not supported"));
        assert_eq!(manager.document().name(), "Untitled");
    }

    #[test]
    fn schema_v1_dimension_style_migrates_to_aligned() {
        let mut manager = SketchManager::new();
        manager
            .begin_sketch(PlaneRef::OriginPlane {
                plane: OriginPlane::Xy,
            })
            .unwrap();
        manager.end_sketch().unwrap();

        let mut legacy: serde_json::Value =
            serde_json::from_str(&manager.export_project_model().unwrap()).unwrap();
        legacy["schema_version"] = serde_json::Value::from(1);
        legacy["document"]["settings"]["dimension_style"] =
            serde_json::Value::String("legacy_default".to_string());
        legacy["sketches"][0]["dimension_style"] =
            serde_json::Value::String("legacy_default".to_string());

        let migrated = decode_project(&legacy.to_string()).unwrap();
        assert_eq!(migrated.schema_version, PROJECT_SCHEMA_VERSION);
        assert_eq!(
            migrated.document.settings.dimension_style,
            DimensionStyle::Aligned
        );
        assert_eq!(
            migrated.sketches[0].dimension_style,
            DimensionStyle::Aligned
        );
    }

    #[test]
    fn pre_rename_project_label_is_normalized() {
        let manager = SketchManager::new();
        let mut legacy: serde_json::Value =
            serde_json::from_str(&manager.export_project_model().unwrap()).unwrap();
        legacy["format"] =
            serde_json::Value::String(crate::project::LEGACY_PROJECT_FORMAT.to_string());

        let migrated = decode_project(&legacy.to_string()).unwrap();
        assert_eq!(migrated.format, PROJECT_FORMAT);
        assert_eq!(migrated.schema_version, PROJECT_SCHEMA_VERSION);
    }

    #[test]
    fn unknown_project_label_is_rejected() {
        let manager = SketchManager::new();
        let mut unknown: serde_json::Value =
            serde_json::from_str(&manager.export_project_model().unwrap()).unwrap();
        unknown["format"] = serde_json::Value::String("unrelated-project".to_string());

        let error = decode_project(&unknown.to_string()).unwrap_err();
        assert!(error.contains("unsupported project format"));
    }

    #[test]
    fn project_roundtrip_preserves_sweep_loft_and_rib_definitions() {
        let mut manager = SketchManager::new();
        let xy = PlaneRef::OriginPlane {
            plane: OriginPlane::Xy,
        };
        let xz = PlaneRef::OriginPlane {
            plane: OriginPlane::Xz,
        };
        let basis = xy.origin_basis().unwrap();

        manager.begin_sketch(xy).unwrap();
        manager
            .add_rectangle_locked(LockedRectangleRequest {
                mode: crate::dto::RectangleMode::TwoPoint,
                anchor: crate::Vec2::new(0.0, 0.0),
                width_mm: Some(20.0),
                height_mm: Some(10.0),
                width_text: Some("20".to_string()),
                height_text: Some("10".to_string()),
                corner_hint: crate::Vec2::new(20.0, 10.0),
                ctrl_held: false,
            })
            .unwrap();
        manager.end_sketch().unwrap();

        manager.begin_sketch(xz).unwrap();
        manager
            .add_rectangle_locked(LockedRectangleRequest {
                mode: crate::dto::RectangleMode::TwoPoint,
                anchor: crate::Vec2::new(0.0, 0.0),
                width_mm: Some(10.0),
                height_mm: Some(10.0),
                width_text: Some("10".to_string()),
                height_text: Some("10".to_string()),
                corner_hint: crate::Vec2::new(10.0, 10.0),
                ctrl_held: false,
            })
            .unwrap();
        let path_line = manager
            .add_line(SegmentRequest {
                from: crate::Vec2::new(30.0, 0.0),
                to_raw: crate::Vec2::new(30.0, 30.0),
                ctrl_held: true,
            })
            .unwrap()
            .entity_id
            .0;
        manager.end_sketch().unwrap();

        let sweep = manager
            .prepare_sweep(SweepRequest {
                profile: ProfileRefDto {
                    sketch_name: "Sketch1".to_string(),
                    profile_index: 0,
                },
                path_sketch_name: "Sketch2".to_string(),
                path_entity_ids: vec![path_line],
                operation: ExtrudeOperation::NewBody,
                target_body_ids: Vec::new(),
                guide_rail: None,
                orientation: Default::default(),
                transition: Default::default(),
                force_c1: false,
            })
            .unwrap();
        commit_plan(&mut manager, sweep, basis);

        let loft = manager
            .prepare_loft(LoftRequest {
                sections: vec![
                    ProfileRefDto {
                        sketch_name: "Sketch1".to_string(),
                        profile_index: 0,
                    },
                    ProfileRefDto {
                        sketch_name: "Sketch2".to_string(),
                        profile_index: 0,
                    },
                ],
                ruled: false,
                operation: ExtrudeOperation::NewBody,
                target_body_ids: Vec::new(),
                continuity: Default::default(),
                centerline: None,
                guide_rail: None,
            })
            .unwrap();
        commit_plan(&mut manager, loft, basis);

        let rib = manager
            .prepare_rib(RibRequest {
                sketch_name: "Sketch2".to_string(),
                line_entity_ids: vec![path_line],
                thickness: 2.0,
                depth: 8.0,
                symmetric: true,
                flip: false,
                operation: ExtrudeOperation::NewBody,
                target_body_ids: Vec::new(),
                extent: None,
            })
            .unwrap();
        commit_plan(&mut manager, rib, basis);

        let json = manager.export_project_model().unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["sweeps"].as_array().unwrap().len(), 1);
        assert_eq!(parsed["lofts"].as_array().unwrap().len(), 1);
        assert_eq!(parsed["ribs"].as_array().unwrap().len(), 1);

        let mut loaded = SketchManager::new();
        let replay = loaded.prepare_load_project(json).unwrap();
        assert_eq!(replay.jobs.len(), 3);
        let replay_ids = replay
            .jobs
            .iter()
            .flat_map(result_body_ids)
            .copied()
            .collect::<BTreeSet<_>>();
        loaded
            .commit_solid(CommitKernelRequest {
                transaction_id: replay.transaction_id,
                scene: KernelSceneDto {
                    bodies: replay_ids
                        .into_iter()
                        .map(|id| raw_body(id, basis))
                        .collect(),
                    errors: Vec::new(),
                },
            })
            .unwrap();
        assert_eq!(loaded.sweep_definitions().len(), 1);
        assert_eq!(loaded.loft_definitions().len(), 1);
        assert_eq!(loaded.rib_definitions().len(), 1);
    }

    #[test]
    fn project_roundtrip_preserves_edge_refinements_and_hole_definitions() {
        let mut manager = SketchManager::new();
        let plane = PlaneRef::OriginPlane {
            plane: OriginPlane::Xy,
        };
        let basis = plane.origin_basis().unwrap();
        manager.begin_sketch(plane).unwrap();
        manager
            .add_rectangle(RectangleRequest {
                mode: crate::dto::RectangleMode::TwoPoint,
                p1: crate::Vec2::new(0.0, 0.0),
                p2: crate::Vec2::new(20.0, 10.0),
                ctrl_held: false,
            })
            .unwrap();
        manager.end_sketch().unwrap();

        let extrude = manager
            .prepare_extrude(ExtrudeRequest {
                source_face: None,
                sketch_name: "Sketch1".to_string(),
                profile_indices: vec![0],
                operation: ExtrudeOperation::NewBody,
                extent: ExtrudeExtent::Distance { distance: 10.0 },
                taper_angle_deg: 0.0,
                flip: false,
                target_body_ids: Vec::new(),
            })
            .unwrap();
        commit_plan(&mut manager, extrude, basis);
        let body = &manager.solid_scene().bodies[0];
        let body_id = body.id;
        let first_edge = body.edges[0].id;
        let second_edge = body.edges[1].id;
        let face_id = body.faces[0].id;

        let fillet = manager
            .prepare_solid_fillet(SolidFilletRequest {
                body_id,
                edge_ids: vec![first_edge],
                radius: 1.0,
                tangent_chain: false,
            })
            .unwrap();
        commit_plan(&mut manager, fillet, basis);
        let chamfer = manager
            .prepare_solid_chamfer(SolidChamferRequest {
                body_id,
                edge_ids: vec![second_edge],
                distance: 0.5,
                tangent_chain: false,
            })
            .unwrap();
        commit_plan(&mut manager, chamfer, basis);
        let hole = manager
            .prepare_hole(HoleRequest {
                body_id,
                face_id,
                position: Point2Dto::new(5.0, 5.0),
                position_reference: None,
                positions: Vec::new(),
                diameter: 2.5,
                extent: HoleExtent::ThroughAll,
                style: HoleStyle::Countersink,
                counterbore_diameter: 0.0,
                counterbore_depth: 0.0,
                countersink_diameter: 4.0,
                countersink_angle_deg: 90.0,
                bottom_style: nbcad_solid::HoleBottomStyle::Flat,
                drill_point_angle_deg: 118.0,
                thread: Some(nbcad_solid::HoleThreadDto {
                    standard: nbcad_solid::HoleThreadStandard::IsoMetric,
                    series: nbcad_solid::HoleThreadSeries::MetricCoarse,
                    designation: "M3 x 0.5 - 6H".to_string(),
                    class: "6H".to_string(),
                    nominal_diameter: 3.0,
                    pitch: 0.5,
                    threads_per_inch: None,
                    hand: nbcad_solid::HoleThreadHand::Right,
                    depth: None,
                    representation: nbcad_solid::HoleThreadRepresentation::Modeled,
                    tap_drill_designation: Some("2.5 mm".to_string()),
                }),
                flip: false,
            })
            .unwrap();
        commit_plan(&mut manager, hole, basis);

        let json = manager.export_project_model().unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["fillets"].as_array().unwrap().len(), 1);
        assert_eq!(parsed["chamfers"].as_array().unwrap().len(), 1);
        assert_eq!(parsed["holes"].as_array().unwrap().len(), 1);
        assert_eq!(parsed["holes"][0]["thread"]["designation"], "M3 x 0.5 - 6H");

        let mut loaded = SketchManager::new();
        let replay = loaded.prepare_load_project(json).unwrap();
        assert!(matches!(replay.jobs[1], KernelJobDto::Fillet(_)));
        assert!(matches!(replay.jobs[2], KernelJobDto::Chamfer(_)));
        assert!(matches!(replay.jobs[3], KernelJobDto::Hole(_)));
        commit_plan(&mut loaded, replay, basis);
        assert_eq!(loaded.fillet_definitions().len(), 1);
        assert_eq!(loaded.chamfer_definitions().len(), 1);
        assert_eq!(loaded.hole_definitions().len(), 1);
        assert_eq!(
            loaded.hole_definitions()[0]
                .thread
                .as_ref()
                .map(|thread| thread.class.as_str()),
            Some("6H")
        );
    }

    #[test]
    fn fillet_profile_preserves_one_analytic_arc_for_the_kernel() {
        let mut manager = SketchManager::new();
        manager
            .begin_sketch(PlaneRef::OriginPlane {
                plane: OriginPlane::Xy,
            })
            .unwrap();
        manager
            .add_rectangle(RectangleRequest {
                mode: crate::dto::RectangleMode::TwoPoint,
                p1: crate::Vec2::new(0.0, 0.0),
                p2: crate::Vec2::new(30.0, 20.0),
                ctrl_held: false,
            })
            .unwrap();
        let dto = manager.active_snapshot().unwrap();
        let bottom = dto
            .entities
            .iter()
            .find_map(|entity| match entity {
                crate::dto::EntityDto::Line { id, start, end, .. }
                    if start.y.abs() < 1e-8 && end.y.abs() < 1e-8 =>
                {
                    Some(*id)
                }
                _ => None,
            })
            .unwrap();
        let left = dto
            .entities
            .iter()
            .find_map(|entity| match entity {
                crate::dto::EntityDto::Line { id, start, end, .. }
                    if start.x.abs() < 1e-8 && end.x.abs() < 1e-8 =>
                {
                    Some(*id)
                }
                _ => None,
            })
            .unwrap();
        manager
            .fillet_lines(FilletRequest {
                l1: bottom,
                l2: left,
                radius_text: "5".to_string(),
            })
            .unwrap();
        manager.end_sketch().unwrap();

        let catalog = manager.profile_catalog();
        let profile = &catalog[0].profiles[0];
        assert!(profile.points.len() > profile.curves.len());
        assert_eq!(
            profile
                .curves
                .iter()
                .filter(|curve| matches!(curve, ProfileCurveDto::Arc { .. }))
                .count(),
            1
        );

        let plan = manager
            .prepare_extrude(ExtrudeRequest {
                source_face: None,
                sketch_name: "Sketch1".to_string(),
                profile_indices: vec![0],
                operation: ExtrudeOperation::NewBody,
                extent: ExtrudeExtent::Distance { distance: 10.0 },
                taper_angle_deg: 0.0,
                flip: false,
                target_body_ids: Vec::new(),
            })
            .unwrap();
        let KernelJobDto::Extrude(job) = &plan.jobs[0] else {
            panic!("expected extrude job");
        };
        assert_eq!(
            job.profiles[0]
                .curves
                .iter()
                .filter(|curve| matches!(curve, KernelCurveDto::Arc { .. }))
                .count(),
            1
        );
    }

    #[test]
    fn exact_adjacent_fillets_omit_the_consumed_carrier_from_solid_topology() {
        let mut manager = SketchManager::new();
        manager
            .begin_sketch(PlaneRef::OriginPlane {
                plane: OriginPlane::Xy,
            })
            .unwrap();
        manager
            .add_rectangle(RectangleRequest {
                mode: crate::dto::RectangleMode::TwoPoint,
                p1: crate::Vec2::new(0.0, 0.0),
                p2: crate::Vec2::new(30.0, 30.0),
                ctrl_held: false,
            })
            .unwrap();
        let dto = manager.active_snapshot().unwrap();
        let horizontal = |y: f64| {
            dto.entities.iter().find_map(|entity| match entity {
                crate::dto::EntityDto::Line { id, start, end, .. }
                    if (start.y - y).abs() < 1e-8 && (end.y - y).abs() < 1e-8 =>
                {
                    Some(*id)
                }
                _ => None,
            })
        };
        let vertical = |x: f64| {
            dto.entities.iter().find_map(|entity| match entity {
                crate::dto::EntityDto::Line { id, start, end, .. }
                    if (start.x - x).abs() < 1e-8 && (end.x - x).abs() < 1e-8 =>
                {
                    Some(*id)
                }
                _ => None,
            })
        };
        let bottom = horizontal(0.0).unwrap();
        let left = vertical(0.0).unwrap();
        let right = vertical(30.0).unwrap();
        manager
            .fillet_lines(FilletRequest {
                l1: bottom,
                l2: left,
                radius_text: "15".to_string(),
            })
            .unwrap();
        manager
            .fillet_lines(FilletRequest {
                l1: bottom,
                l2: right,
                radius_text: "15".to_string(),
            })
            .unwrap();
        manager.end_sketch().unwrap();

        let catalog = manager.profile_catalog();
        let profile = &catalog[0].profiles[0];
        assert_eq!(profile.curves.len(), 5, "top + two sides + two arcs");
        assert_eq!(
            profile
                .curves
                .iter()
                .filter(|curve| matches!(curve, ProfileCurveDto::Arc { .. }))
                .count(),
            2
        );
        assert!(profile.curves.iter().all(|curve| match curve {
            ProfileCurveDto::Line { start, end, .. } => point2_distance(*start, *end) > 1e-3,
            _ => true,
        }));

        let plan = manager
            .prepare_extrude(ExtrudeRequest {
                source_face: None,
                sketch_name: "Sketch1".to_string(),
                profile_indices: vec![0],
                operation: ExtrudeOperation::NewBody,
                extent: ExtrudeExtent::Distance { distance: 10.0 },
                taper_angle_deg: 0.0,
                flip: false,
                target_body_ids: Vec::new(),
            })
            .unwrap();
        let KernelJobDto::Extrude(job) = &plan.jobs[0] else {
            panic!("expected extrude job");
        };
        assert_eq!(
            job.profiles[0]
                .curves
                .iter()
                .filter(|curve| matches!(curve, KernelCurveDto::Arc { .. }))
                .count(),
            2
        );
    }

    #[test]
    fn construction_planes_propagate_edits_and_reject_self_references() {
        let mut manager = SketchManager::new();
        let offset = manager
            .create_datum_plane(DatumPlaneRequest {
                source: DatumPlaneSourceDto::Offset {
                    reference: PlaneRef::OriginPlane {
                        plane: OriginPlane::Xy,
                    },
                    distance: 20.0,
                },
            })
            .unwrap();
        let offset_definition = offset.planes[0].clone();
        assert!((offset_definition.basis.origin[2] - 20.0).abs() < 1e-9);

        let midplane = manager
            .create_datum_plane(DatumPlaneRequest {
                source: DatumPlaneSourceDto::Midplane {
                    first: PlaneRef::OriginPlane {
                        plane: OriginPlane::Xy,
                    },
                    second: PlaneRef::DatumPlane {
                        datum_id: offset_definition.datum_id,
                    },
                },
            })
            .unwrap();
        assert!((midplane.planes[1].basis.origin[2] - 10.0).abs() < 1e-9);

        let edited = manager
            .edit_datum_plane(EditDatumPlaneRequest {
                feature_id: offset_definition.feature_id,
                plane: DatumPlaneRequest {
                    source: DatumPlaneSourceDto::Offset {
                        reference: PlaneRef::OriginPlane {
                            plane: OriginPlane::Xy,
                        },
                        distance: 40.0,
                    },
                },
            })
            .unwrap();
        assert!((edited.planes[0].basis.origin[2] - 40.0).abs() < 1e-9);
        assert!((edited.planes[1].basis.origin[2] - 20.0).abs() < 1e-9);

        let self_reference = manager.edit_datum_plane(EditDatumPlaneRequest {
            feature_id: offset_definition.feature_id,
            plane: DatumPlaneRequest {
                source: DatumPlaneSourceDto::Offset {
                    reference: PlaneRef::DatumPlane {
                        datum_id: offset_definition.datum_id,
                    },
                    distance: 5.0,
                },
            },
        });
        assert!(matches!(
            self_reference,
            Err(SessionError::BrokenReference(message))
                if message.contains("missing or rolled back")
        ));
    }

    #[test]
    fn plane_at_angle_can_replay_from_cached_straight_edge_endpoints() {
        let mut manager = SketchManager::new();
        let result = manager
            .create_datum_plane(DatumPlaneRequest {
                source: DatumPlaneSourceDto::AtAngle {
                    reference: PlaneRef::OriginPlane {
                        plane: OriginPlane::Xy,
                    },
                    body_id: BodyId(99),
                    edge_id: nbcad_core::EdgeId(101),
                    angle_deg: 90.0,
                    axis_points: Some([
                        Point3Dto::from([0.0, 0.0, 0.0]),
                        Point3Dto::from([10.0, 0.0, 0.0]),
                    ]),
                },
            })
            .unwrap();
        let normal = result.planes[0].basis.normal;
        assert!(normal[0].abs() < 1e-9);
        assert!((normal[1] + 1.0).abs() < 1e-9);
        assert!(normal[2].abs() < 1e-9);
    }
}
