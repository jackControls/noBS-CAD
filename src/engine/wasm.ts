/**
 * WasmEngine — engine adapter for the browser preview/dev path.
 *
 * Loads the wasm-pack bundle (`npm run build:wasm` →
 * `src/engine-wasm/pkg/`, gitignored) and exposes the same `Engine`
 * interface as the Tauri host. The bundle is wasm-pack `--target web`; Vite
 * handles its `new URL(..., import.meta.url)` wasm asset natively, so no
 * Vite plugin is required.
 */
import init, { WasmEngine as WasmEngineInner } from '../engine-wasm/pkg/nbcad_wasm';
import { unwrapEnvelope, type Engine } from './index';
import { BrowserOcctKernel } from './occtBrowser';
import type {
  AddConstraintResult,
  AddLineResult,
  Arc3PointRequest,
  ArcCenterRequest,
  BreakRequest,
  BodyFeatureDefinitionDto,
  BodyFeatureRequestDto,
  ChamferRequest,
  SketchCircularPatternRequest,
  CircleRequest,
  ConstraintPayload,
  DeleteEntityResult,
  DimensionRequest,
  DimensionStyle,
  DatumPlaneDefinitionDto,
  DatumPlaneRequest,
  DatumPlaneUpdateDto,
  DocumentDto,
  FaceSketchOrigin,
  EditDimensionRequest,
  EndSketchResult,
  EvalExpressionResult,
  ExtrudeDefinitionDto,
  ExtrudeRequest,
  LoftDefinitionDto,
  LoftRequest,
  RevolveDefinitionDto,
  RevolveRequest,
  RibDefinitionDto,
  RibRequest,
  SolidFilletDefinitionDto,
  SolidFilletRequest,
  SolidChamferDefinitionDto,
  SolidChamferRequest,
  HoleDefinitionDto,
  HoleRequest,
  ExtendRequest,
  FilletPreviewDto,
  FilletRequest,
  LockedCircleRequest,
  SlotRequest,
  SplineRequest,
  LockedRectangleRequest,
  LockedSegmentRequest,
  MidpointLineRequest,
  MirrorRequest,
  MoveCopyRequest,
  MoveDimensionRequest,
  MovePointRequest,
  MovePointResult,
  OffsetPreviewDto,
  OffsetRequest,
  PlaneRef,
  PointRequest,
  PolygonRequest,
  PreviewDto,
  ProfileCatalogItemDto,
  RecomputePlanDto,
  RectangleRequest,
  SketchRectangularPatternRequest,
  ScaleRequest,
  SegmentRequest,
  SketchDto,
  SolidSceneDto,
  SolidUpdateDto,
  StepExportRequest,
  SweepDefinitionDto,
  SweepRequest,
  ToolResult,
  TrimPreviewDto,
  TrimRequest,
  UndoResult,
} from './types';

export class WasmEngine implements Engine {
  readonly kind = 'wasm' as const;
  private kernelPromise: Promise<BrowserOcctKernel> | null = null;

  private constructor(private readonly inner: WasmEngineInner) {}

  /** Instantiate the wasm module and construct the engine. */
  static async create(): Promise<WasmEngine> {
    await init();
    return new WasmEngine(new WasmEngineInner());
  }

  async getDocument(): Promise<DocumentDto> {
    return unwrapEnvelope(this.inner.document());
  }

  async beginSketch(
    plane: PlaneRef,
    faceOrigin: FaceSketchOrigin = 'face_center',
  ): Promise<SketchDto> {
    return unwrapEnvelope(
      this.inner.begin_sketch(JSON.stringify({ plane, face_origin: faceOrigin })),
    );
  }

  async endSketch(): Promise<EndSketchResult> {
    return unwrapEnvelope(this.inner.end_sketch());
  }

  async finishedSketches(): Promise<SketchDto[]> {
    return unwrapEnvelope(this.inner.finished_sketches());
  }

  async editSketch(name: string): Promise<SketchDto> {
    return unwrapEnvelope(this.inner.edit_sketch(JSON.stringify(name)));
  }

  async activeSketch(): Promise<SketchDto | null> {
    return unwrapEnvelope(this.inner.active_sketch());
  }

  async profileCatalog(): Promise<ProfileCatalogItemDto[]> {
    return unwrapEnvelope(this.inner.profile_catalog());
  }

  async solidScene(): Promise<SolidSceneDto> {
    return unwrapEnvelope(this.inner.solid_scene());
  }

  async extrudeDefinitions(): Promise<ExtrudeDefinitionDto[]> {
    return unwrapEnvelope(this.inner.extrude_definitions());
  }

  async revolveDefinitions(): Promise<RevolveDefinitionDto[]> {
    return unwrapEnvelope(this.inner.revolve_definitions());
  }

  async sweepDefinitions(): Promise<SweepDefinitionDto[]> {
    return unwrapEnvelope(this.inner.sweep_definitions());
  }

  async loftDefinitions(): Promise<LoftDefinitionDto[]> {
    return unwrapEnvelope(this.inner.loft_definitions());
  }

  async ribDefinitions(): Promise<RibDefinitionDto[]> {
    return unwrapEnvelope(this.inner.rib_definitions());
  }

  async filletDefinitions(): Promise<SolidFilletDefinitionDto[]> {
    return unwrapEnvelope(this.inner.fillet_definitions());
  }

  async chamferDefinitions(): Promise<SolidChamferDefinitionDto[]> {
    return unwrapEnvelope(this.inner.chamfer_definitions());
  }

  async holeDefinitions(): Promise<HoleDefinitionDto[]> {
    return unwrapEnvelope(this.inner.hole_definitions());
  }

  async datumPlaneDefinitions(): Promise<DatumPlaneDefinitionDto[]> {
    return unwrapEnvelope(this.inner.datum_plane_definitions());
  }

  async bodyFeatureDefinitions(): Promise<BodyFeatureDefinitionDto[]> {
    return unwrapEnvelope(this.inner.body_feature_definitions());
  }

  async createDatumPlane(request: DatumPlaneRequest): Promise<DatumPlaneUpdateDto> {
    return unwrapEnvelope(this.inner.datum_plane_create(JSON.stringify(request)));
  }

  async editDatumPlane(
    featureId: number,
    request: DatumPlaneRequest,
  ): Promise<DatumPlaneUpdateDto> {
    return unwrapEnvelope(
      this.inner.datum_plane_edit(
        JSON.stringify({ feature_id: featureId, plane: request }),
      ),
    );
  }

  async bodyFeature(request: BodyFeatureRequestDto): Promise<SolidUpdateDto> {
    const plan = unwrapEnvelope<RecomputePlanDto>(
      this.inner.solid_prepare_body_feature(JSON.stringify(request)),
    );
    return this.executeSolidPlan(plan);
  }

  async editBodyFeature(
    featureId: number,
    request: BodyFeatureRequestDto,
  ): Promise<SolidUpdateDto> {
    const plan = unwrapEnvelope<RecomputePlanDto>(
      this.inner.solid_prepare_edit_body_feature(
        JSON.stringify({ feature_id: featureId, feature: request }),
      ),
    );
    return this.executeSolidPlan(plan);
  }

  async extrude(request: ExtrudeRequest): Promise<SolidUpdateDto> {
    const plan = unwrapEnvelope<RecomputePlanDto>(
      this.inner.solid_prepare_extrude(JSON.stringify(request)),
    );
    return this.executeSolidPlan(plan);
  }

  async editExtrude(featureId: number, request: ExtrudeRequest): Promise<SolidUpdateDto> {
    const plan = unwrapEnvelope<RecomputePlanDto>(
      this.inner.solid_prepare_edit_extrude(
        JSON.stringify({ feature_id: featureId, extrude: request }),
      ),
    );
    return this.executeSolidPlan(plan);
  }

  async revolve(request: RevolveRequest): Promise<SolidUpdateDto> {
    const plan = unwrapEnvelope<RecomputePlanDto>(
      this.inner.solid_prepare_revolve(JSON.stringify(request)),
    );
    return this.executeSolidPlan(plan);
  }

  async editRevolve(featureId: number, request: RevolveRequest): Promise<SolidUpdateDto> {
    const plan = unwrapEnvelope<RecomputePlanDto>(
      this.inner.solid_prepare_edit_revolve(
        JSON.stringify({ feature_id: featureId, revolve: request }),
      ),
    );
    return this.executeSolidPlan(plan);
  }

  async sweep(request: SweepRequest): Promise<SolidUpdateDto> {
    const plan = unwrapEnvelope<RecomputePlanDto>(
      this.inner.solid_prepare_sweep(JSON.stringify(request)),
    );
    return this.executeSolidPlan(plan);
  }

  async editSweep(featureId: number, request: SweepRequest): Promise<SolidUpdateDto> {
    const plan = unwrapEnvelope<RecomputePlanDto>(
      this.inner.solid_prepare_edit_sweep(
        JSON.stringify({ feature_id: featureId, sweep: request }),
      ),
    );
    return this.executeSolidPlan(plan);
  }

  async loft(request: LoftRequest): Promise<SolidUpdateDto> {
    const plan = unwrapEnvelope<RecomputePlanDto>(
      this.inner.solid_prepare_loft(JSON.stringify(request)),
    );
    return this.executeSolidPlan(plan);
  }

  async editLoft(featureId: number, request: LoftRequest): Promise<SolidUpdateDto> {
    const plan = unwrapEnvelope<RecomputePlanDto>(
      this.inner.solid_prepare_edit_loft(
        JSON.stringify({ feature_id: featureId, loft: request }),
      ),
    );
    return this.executeSolidPlan(plan);
  }

  async rib(request: RibRequest): Promise<SolidUpdateDto> {
    const plan = unwrapEnvelope<RecomputePlanDto>(
      this.inner.solid_prepare_rib(JSON.stringify(request)),
    );
    return this.executeSolidPlan(plan);
  }

  async editRib(featureId: number, request: RibRequest): Promise<SolidUpdateDto> {
    const plan = unwrapEnvelope<RecomputePlanDto>(
      this.inner.solid_prepare_edit_rib(
        JSON.stringify({ feature_id: featureId, rib: request }),
      ),
    );
    return this.executeSolidPlan(plan);
  }

  async solidFillet(request: SolidFilletRequest): Promise<SolidUpdateDto> {
    const plan = unwrapEnvelope<RecomputePlanDto>(
      this.inner.solid_prepare_fillet(JSON.stringify(request)),
    );
    return this.executeSolidPlan(plan);
  }

  async editSolidFillet(featureId: number, request: SolidFilletRequest): Promise<SolidUpdateDto> {
    const plan = unwrapEnvelope<RecomputePlanDto>(
      this.inner.solid_prepare_edit_fillet(
        JSON.stringify({ feature_id: featureId, fillet: request }),
      ),
    );
    return this.executeSolidPlan(plan);
  }

  async solidChamfer(request: SolidChamferRequest): Promise<SolidUpdateDto> {
    const plan = unwrapEnvelope<RecomputePlanDto>(
      this.inner.solid_prepare_chamfer(JSON.stringify(request)),
    );
    return this.executeSolidPlan(plan);
  }

  async editSolidChamfer(featureId: number, request: SolidChamferRequest): Promise<SolidUpdateDto> {
    const plan = unwrapEnvelope<RecomputePlanDto>(
      this.inner.solid_prepare_edit_chamfer(
        JSON.stringify({ feature_id: featureId, chamfer: request }),
      ),
    );
    return this.executeSolidPlan(plan);
  }

  async hole(request: HoleRequest): Promise<SolidUpdateDto> {
    const plan = unwrapEnvelope<RecomputePlanDto>(
      this.inner.solid_prepare_hole(JSON.stringify(request)),
    );
    return this.executeSolidPlan(plan);
  }

  async editHole(featureId: number, request: HoleRequest): Promise<SolidUpdateDto> {
    const plan = unwrapEnvelope<RecomputePlanDto>(
      this.inner.solid_prepare_edit_hole(
        JSON.stringify({ feature_id: featureId, hole: request }),
      ),
    );
    return this.executeSolidPlan(plan);
  }

  async recomputeSolids(): Promise<SolidUpdateDto> {
    const plan = unwrapEnvelope<RecomputePlanDto>(this.inner.solid_prepare_recompute());
    return this.executeSolidPlan(plan);
  }

  async setRollback(rollbackIndex: number): Promise<SolidUpdateDto> {
    const plan = unwrapEnvelope<RecomputePlanDto>(
      this.inner.solid_prepare_set_rollback(JSON.stringify({ rollback_index: rollbackIndex })),
    );
    return this.executeSolidPlan(plan);
  }

  async deleteFeature(featureId: number): Promise<SolidUpdateDto> {
    const plan = unwrapEnvelope<RecomputePlanDto>(
      this.inner.solid_prepare_delete_feature(JSON.stringify({ feature_id: featureId })),
    );
    return this.executeSolidPlan(plan);
  }

  async reorderFeature(featureId: number, targetIndex: number): Promise<SolidUpdateDto> {
    const plan = unwrapEnvelope<RecomputePlanDto>(
      this.inner.solid_prepare_reorder_feature(
        JSON.stringify({ feature_id: featureId, target_index: targetIndex }),
      ),
    );
    return this.executeSolidPlan(plan);
  }

  async setDocumentName(name: string): Promise<DocumentDto> {
    return unwrapEnvelope(this.inner.document_set_name(JSON.stringify(name)));
  }

  async exportProjectModel(): Promise<string> {
    return unwrapEnvelope(this.inner.project_export_model());
  }

  async newProject(): Promise<SolidUpdateDto> {
    const plan = unwrapEnvelope<RecomputePlanDto>(this.inner.project_prepare_new());
    return this.executeSolidPlan(plan);
  }

  async loadProjectModel(modelJson: string): Promise<SolidUpdateDto> {
    const plan = unwrapEnvelope<RecomputePlanDto>(
      this.inner.project_prepare_load(JSON.stringify(modelJson)),
    );
    return this.executeSolidPlan(plan);
  }

  async exportStep(request: StepExportRequest): Promise<Uint8Array> {
    return (await this.browserKernel()).exportStep(request);
  }

  private async executeSolidPlan(plan: RecomputePlanDto): Promise<SolidUpdateDto> {
    const scene = plan.jobs.length === 0
      ? { bodies: [], errors: plan.errors ?? [] }
      : (await this.browserKernel()).recompute(plan);
    return unwrapEnvelope(
      this.inner.solid_commit(JSON.stringify({ transaction_id: plan.transaction_id, scene })),
    );
  }

  private browserKernel(): Promise<BrowserOcctKernel> {
    this.kernelPromise ??= BrowserOcctKernel.create();
    return this.kernelPromise;
  }

  async previewSegment(request: SegmentRequest): Promise<PreviewDto> {
    return unwrapEnvelope(this.inner.preview_segment(JSON.stringify(request)));
  }

  async addLine(request: SegmentRequest): Promise<AddLineResult> {
    return unwrapEnvelope(this.inner.add_line(JSON.stringify(request)));
  }

  async previewSegmentLocked(request: LockedSegmentRequest): Promise<PreviewDto> {
    return unwrapEnvelope(this.inner.preview_segment_locked(JSON.stringify(request)));
  }

  async addLineLocked(request: LockedSegmentRequest): Promise<AddLineResult> {
    return unwrapEnvelope(this.inner.add_line_locked(JSON.stringify(request)));
  }

  async addPoint(request: PointRequest): Promise<ToolResult> {
    return unwrapEnvelope(this.inner.add_point(JSON.stringify(request)));
  }

  async addLineMidpoint(request: MidpointLineRequest): Promise<ToolResult> {
    return unwrapEnvelope(this.inner.add_line_midpoint(JSON.stringify(request)));
  }

  async addRectangle(request: RectangleRequest): Promise<ToolResult> {
    return unwrapEnvelope(this.inner.add_rectangle(JSON.stringify(request)));
  }

  async addRectangleLocked(request: LockedRectangleRequest): Promise<ToolResult> {
    return unwrapEnvelope(this.inner.add_rectangle_locked(JSON.stringify(request)));
  }

  async addCircle(request: CircleRequest): Promise<ToolResult> {
    return unwrapEnvelope(this.inner.add_circle(JSON.stringify(request)));
  }

  async addCircleLocked(request: LockedCircleRequest): Promise<ToolResult> {
    return unwrapEnvelope(this.inner.add_circle_locked(JSON.stringify(request)));
  }

  async addSlot(request: SlotRequest): Promise<ToolResult> {
    return unwrapEnvelope(this.inner.add_slot(JSON.stringify(request)));
  }

  async addSpline(request: SplineRequest): Promise<ToolResult> {
    return unwrapEnvelope(this.inner.add_spline(JSON.stringify(request)));
  }

  async addArc3pt(request: Arc3PointRequest): Promise<ToolResult> {
    return unwrapEnvelope(this.inner.add_arc_3pt(JSON.stringify(request)));
  }

  async addArcCenter(request: ArcCenterRequest): Promise<ToolResult> {
    return unwrapEnvelope(this.inner.add_arc_center(JSON.stringify(request)));
  }

  async addConstraint(constraint: ConstraintPayload): Promise<AddConstraintResult> {
    return unwrapEnvelope(this.inner.add_constraint(JSON.stringify(constraint)));
  }

  async addConstraints(constraints: ConstraintPayload[]): Promise<ToolResult> {
    return unwrapEnvelope(this.inner.add_constraints(JSON.stringify({ constraints })));
  }

  async addDimension(request: DimensionRequest): Promise<ToolResult> {
    return unwrapEnvelope(this.inner.add_dimension(JSON.stringify(request)));
  }

  async editDimension(request: EditDimensionRequest): Promise<AddConstraintResult> {
    return unwrapEnvelope(this.inner.edit_dimension(JSON.stringify(request)));
  }

  async moveDimension(request: MoveDimensionRequest): Promise<AddConstraintResult> {
    return unwrapEnvelope(this.inner.move_dimension(JSON.stringify(request)));
  }

  async deleteDimension(constraintId: number): Promise<AddConstraintResult> {
    return unwrapEnvelope(this.inner.delete_dimension(JSON.stringify({ constraint_id: constraintId })));
  }

  async setDimensionStyle(style: DimensionStyle): Promise<SketchDto> {
    return unwrapEnvelope(this.inner.set_dimension_style(JSON.stringify({ style })));
  }

  async evalExpression(text: string): Promise<EvalExpressionResult> {
    return unwrapEnvelope(this.inner.eval_expression(JSON.stringify({ text })));
  }


  async filletPreview(request: FilletRequest): Promise<FilletPreviewDto> {
    return unwrapEnvelope(this.inner.fillet_preview(JSON.stringify(request)));
  }
  async filletLines(request: FilletRequest): Promise<ToolResult> {
    return unwrapEnvelope(this.inner.fillet_lines(JSON.stringify(request)));
  }
  async chamferLines(request: ChamferRequest): Promise<ToolResult> {
    return unwrapEnvelope(this.inner.chamfer_lines(JSON.stringify(request)));
  }
  async offsetPreview(request: OffsetRequest): Promise<OffsetPreviewDto> {
    return unwrapEnvelope(this.inner.offset_preview(JSON.stringify(request)));
  }
  async offsetCurve(request: OffsetRequest): Promise<ToolResult> {
    return unwrapEnvelope(this.inner.offset_curve(JSON.stringify(request)));
  }
  async trimPreview(request: TrimRequest): Promise<TrimPreviewDto> {
    return unwrapEnvelope(this.inner.trim_preview(JSON.stringify(request)));
  }
  async trimEntity(request: TrimRequest): Promise<ToolResult> {
    return unwrapEnvelope(this.inner.trim_entity(JSON.stringify(request)));
  }
  async extendEntity(request: ExtendRequest): Promise<ToolResult> {
    return unwrapEnvelope(this.inner.extend_entity(JSON.stringify(request)));
  }
  async breakCurve(request: BreakRequest): Promise<ToolResult> {
    return unwrapEnvelope(this.inner.break_curve(JSON.stringify(request)));
  }
  async mirrorEntities(request: MirrorRequest): Promise<ToolResult> {
    return unwrapEnvelope(this.inner.mirror_entities(JSON.stringify(request)));
  }
  async rectangularPattern(request: SketchRectangularPatternRequest): Promise<ToolResult> {
    return unwrapEnvelope(this.inner.rectangular_pattern(JSON.stringify(request)));
  }
  async circularPattern(request: SketchCircularPatternRequest): Promise<ToolResult> {
    return unwrapEnvelope(this.inner.circular_pattern(JSON.stringify(request)));
  }
  async moveCopyEntities(request: MoveCopyRequest): Promise<ToolResult> {
    return unwrapEnvelope(this.inner.move_copy_entities(JSON.stringify(request)));
  }
  async scaleEntities(request: ScaleRequest): Promise<ToolResult> {
    return unwrapEnvelope(this.inner.scale_entities(JSON.stringify(request)));
  }
  async polygonCreate(request: PolygonRequest): Promise<ToolResult> {
    return unwrapEnvelope(this.inner.polygon_create(JSON.stringify(request)));
  }

  async toggleFix(entityId: number): Promise<AddConstraintResult> {
    return unwrapEnvelope(this.inner.toggle_fix(JSON.stringify({ entity_id: entityId })));
  }

  async toggleFixEntities(entityIds: number[]): Promise<ToolResult> {
    return unwrapEnvelope(
      this.inner.toggle_fix_entities(JSON.stringify({ entity_ids: entityIds })),
    );
  }

  async deleteEntities(entityIds: number[]): Promise<DeleteEntityResult> {
    return unwrapEnvelope(this.inner.delete_entities(JSON.stringify({ entity_ids: entityIds })));
  }

  async movePoint(request: MovePointRequest): Promise<MovePointResult> {
    return unwrapEnvelope(this.inner.move_point(JSON.stringify(request)));
  }

  async deleteEntity(entityId: number): Promise<DeleteEntityResult> {
    return unwrapEnvelope(this.inner.delete_entity(JSON.stringify({ entity_id: entityId })));
  }

  async undo(): Promise<UndoResult> {
    return unwrapEnvelope(this.inner.undo());
  }

  async redo(): Promise<UndoResult> {
    return unwrapEnvelope(this.inner.redo());
  }

  async setGridSnap(enabled: boolean): Promise<SketchDto> {
    return unwrapEnvelope(this.inner.set_grid_snap(JSON.stringify({ enabled })));
  }

  async setGridStep(stepMm: number): Promise<void> {
    unwrapEnvelope(this.inner.set_grid_step(JSON.stringify({ step_mm: stepMm })));
  }
}
