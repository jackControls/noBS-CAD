/**
 * Engine IPC contract — mirrors the serde DTOs in `crates/sketch/src/dto.rs`
 * and `crates/sketch/src/plane.rs` 1:1. Both hosts (Tauri, WASM) exchange
 * these shapes as JSON.
 */

import type { DocumentDto } from '../types/document';

export type { DocumentDto };

export interface Vec2 {
  x: number;
  y: number;
}

/** `PlaneBasis`: origin + orthonormal basis (u, v, normal) in Z-up world mm. */
export interface PlaneBasis {
  origin: [number, number, number];
  u: [number, number, number];
  v: [number, number, number];
  normal: [number, number, number];
}

export type OriginPlane = 'xy' | 'xz' | 'yz';

/** Extensible plane reference shared by the browser and native hosts. */
export type PlaneRef =
  | { type: 'origin_plane'; plane: OriginPlane }
  | { type: 'planar_face'; face_id: number }
  | { type: 'datum_plane'; datum_id: number };

export type FaceSketchOrigin = 'face_center' | 'global_origin_projection';

export interface BeginSketchRequest {
  plane: PlaneRef;
  face_origin: FaceSketchOrigin;
}

export type EntityDto =
  | { kind: 'point'; id: number; position: Vec2; fully_defined: boolean }
  | { kind: 'line'; id: number; start_id: number; end_id: number; start: Vec2; end: Vec2; fully_defined: boolean }
  | { kind: 'arc'; id: number; center: Vec2; radius: number; start_angle: number; end_angle: number; fully_defined: boolean }
  | { kind: 'circle'; id: number; center: Vec2; radius: number; fully_defined: boolean }
  | { kind: 'spline'; id: number; points: Vec2[]; tessellation: Vec2[]; fully_defined: boolean };

/** Flattened `ConstraintDto` — `{ id, type, ...fields }`, see constraint.rs. */
export interface ConstraintDto {
  id: number;
  type: string;
  entity?: number;
  a?: number;
  b?: number;
  axis?: number;
  from?: number;
  to?: number | null;
  value?: number;
}

export interface DofDto {
  value: number;
  fully_defined: boolean;
}

export interface SketchDto {
  name: string;
  plane: PlaneRef;
  basis: PlaneBasis;
  entities: EntityDto[];
  constraints: ConstraintDto[];
  reference_midpoints: Array<{ edge_id: number; position: Vec2 }>;
  /** Driving dimensions with presentation data (D9). */
  dimensions: DimensionDto[];
  dimension_style: DimensionStyle;
  dof: DofDto;
  can_undo: boolean;
  can_redo: boolean;
}

export type DimensionStyle = 'aligned' | 'iso';

/** One driving dimension in a snapshot (D9). */
export interface DimensionDto {
  constraint_id: number;
  kind: 'distance' | 'radius' | 'diameter' | 'angle';
  entities: number[];
  param_id: number;
  param_name: string;
  param_expression: string | null;
  value: number;
  /** Formatted text (2 decimals, Ø/R/° affixes). */
  text: string;
  text_pos: Vec2;
}

// --- Dimension ops ---

export interface DimensionRequest {
  entities: number[];
  text_pos: Vec2;
  value_text?: string | null;
}

export interface EditDimensionRequest {
  constraint_id: number;
  text: string;
}

export interface MoveDimensionRequest {
  constraint_id: number;
  text_pos: Vec2;
}

export interface EvalExpressionRequest {
  text: string;
}

export interface EvalExpressionResult {
  value: number;
}

// --- Modify tools (M1c-ii) ---

export interface FilletRequest {
  l1: number;
  l2: number;
  radius_text: string;
}

export interface FilletPreviewDto {
  center: Vec2;
  radius: number;
  start_angle: number;
  end_angle: number;
  ccw: boolean;
  tangent_on_l1: Vec2;
  tangent_on_l2: Vec2;
}

export interface ChamferRequest {
  l1: number;
  l2: number;
  distance_text: string;
}

export interface OffsetRequest {
  entity: number;
  distance_text: string;
  cursor: Vec2;
}

export type PreviewCurve =
  | { kind: 'line'; a: Vec2; b: Vec2 }
  | { kind: 'arc'; center: Vec2; radius: number; start_angle: number; end_angle: number }
  | { kind: 'circle'; center: Vec2; radius: number };

export interface OffsetPreviewDto {
  curve: PreviewCurve;
}

export interface TrimRequest {
  entity: number;
  click: Vec2;
}

export interface TrimPreviewDto {
  kept: PreviewCurve[];
  removed: PreviewCurve;
}

export interface ExtendRequest {
  entity: number;
  click: Vec2;
}

export interface BreakRequest {
  entity: number;
  at: Vec2;
}

export interface MirrorRequest {
  entity_ids: number[];
  axis_line: number;
}

export interface SketchRectangularPatternRequest {
  entity_ids: number[];
  direction: Vec2;
  spacing: number;
  count: number;
  second_direction?: Vec2 | null;
  second_spacing?: number;
  second_count?: number;
}

export interface SketchCircularPatternRequest {
  entity_ids: number[];
  center: Vec2;
  count: number;
  total_angle_deg: number;
}

export interface MoveCopyRequest {
  entity_ids: number[];
  dx: number;
  dy: number;
  copy: boolean;
}

export interface ScaleRequest {
  entity_ids: number[];
  origin: Vec2;
  factor_text: string;
}

export interface PolygonRequest {
  center: Vec2;
  edge_count: number;
  radius_text: string;
  rotation_deg: number;
  mode: 'inscribed' | 'circumscribed';
}

export type SnapTarget =
  | { kind: 'none' }
  | { kind: 'grid' }
  | { kind: 'origin' }
  | { kind: 'point'; entity: number }
  | { kind: 'midpoint'; entity: number }
  | { kind: 'reference_midpoint'; edge: number };

export type Inference = 'horizontal' | 'vertical' | 'coincident';

export interface SegmentRequest {
  from: Vec2;
  to_raw: Vec2;
  ctrl_held: boolean;
}

export type DragPhase = 'begin' | 'update' | 'end' | 'single';

export interface MovePointRequest {
  point_id: number;
  to_raw: Vec2;
  ctrl_held: boolean;
  phase: DragPhase;
}

export interface PreviewDto {
  snapped_to: Vec2;
  snap: SnapTarget;
  inferences: Inference[];
}

export interface AddLineResult {
  entity_id: number;
  start_point_id: number;
  end_point_id: number;
  created_constraints: ConstraintDto[];
  sketch: SketchDto;
}

export interface MovePointResult {
  sketch: SketchDto;
}

export interface DeleteEntityResult {
  removed: number[];
  sketch: SketchDto;
}

export interface UndoResult {
  sketch: SketchDto;
}

export interface EndSketchResult {
  document: DocumentDto;
}

// --- Solid feature / OCCT contract (M2) ---

export interface Point3Dto {
  x: number;
  y: number;
  z: number;
}

export interface ProfileLoopDto {
  index: number;
  points: Vec2[];
  area: number;
  parent_index: number | null;
  nesting_depth: number;
  curves: ProfileCurveDto[];
}

export type ProfileCurveDto =
  | { kind: 'line'; entity_id: number; start: Vec2; end: Vec2 }
  | { kind: 'arc'; entity_id: number; start: Vec2; mid: Vec2; end: Vec2 }
  | { kind: 'circle'; entity_id: number; center: Vec2; radius: number }
  | { kind: 'polyline'; entity_id: number; points: Vec2[] };

export interface ProfileCatalogItemDto {
  sketch_name: string;
  feature_id: number;
  basis: PlaneBasis;
  profiles: ProfileLoopDto[];
  lines: SketchLineDto[];
  path_curves: SketchPathCurveDto[];
  reference_points: SketchReferencePointDto[];
}

export interface SketchLineDto {
  entity_id: number;
  start: Vec2;
  end: Vec2;
}

export type SketchPathCurveDto =
  | { kind: 'line'; entity_id: number; start: Vec2; end: Vec2 }
  | { kind: 'arc'; entity_id: number; start: Vec2; mid: Vec2; end: Vec2 }
  | { kind: 'circle'; entity_id: number; center: Vec2; radius: number }
  | { kind: 'spline'; entity_id: number; points: Vec2[] };

export type SketchPointKindDto =
  | { kind: 'point' }
  | { kind: 'start' }
  | { kind: 'end' }
  | { kind: 'center' }
  | { kind: 'fit_point'; index: number };

export type SketchReferencePointDto = {
  entity_id: number;
  position: Vec2;
} & SketchPointKindDto;

export type SketchPointRefDto = {
  sketch_name: string;
  entity_id: number;
} & SketchPointKindDto;

export type ExtrudeOperation = 'new_body' | 'join' | 'cut' | 'intersect';

export type ExtrudeExtent =
  | { type: 'distance'; distance: number }
  | { type: 'two_sides'; distance: number; second_distance: number }
  | { type: 'symmetric'; distance: number }
  | { type: 'through_all' }
  | { type: 'to_face'; face_id: number };

/** Stable reference to an exact planar OCCT face owned by a live body. */
export interface PlanarFaceSourceDto {
  body_id: number;
  face_id: number;
}

export interface ExtrudeRequest {
  /** When set, OCCT extrudes the original TopoDS_Face, including inner wires. */
  source_face?: PlanarFaceSourceDto | null;
  sketch_name: string;
  profile_indices: number[];
  operation: ExtrudeOperation;
  extent: ExtrudeExtent;
  taper_angle_deg: number;
  flip: boolean;
  target_body_ids: number[];
}

export interface ExtrudeDefinitionDto extends ExtrudeRequest {
  feature_id: number;
  name: string;
  source_face_key?: string | null;
  source_face_signature?: PlanarFaceSignatureDto | null;
  source_face_basis?: PlaneBasis | null;
  to_face_basis?: PlaneBasis | null;
  new_body_ids: number[];
}

export interface RevolveRequest {
  sketch_name: string;
  profile_indices: number[];
  axis_origin: Vec2;
  axis_direction: Vec2;
  axis_line_entity_id?: number | null;
  angle_deg: number;
  flip: boolean;
  operation: ExtrudeOperation;
  target_body_ids: number[];
}

export interface RevolveDefinitionDto extends RevolveRequest {
  feature_id: number;
  name: string;
  new_body_ids: number[];
}

export interface ProfileRefDto {
  sketch_name: string;
  profile_index: number;
}

export interface PathRefDto {
  sketch_name: string;
  entity_ids: number[];
}

export type SweepOrientation = 'corrected_frenet' | 'frenet' | 'fixed';
export type SweepTransition = 'transformed' | 'right_corner' | 'round_corner';

export interface SweepRequest {
  profile: ProfileRefDto;
  path_sketch_name: string;
  path_entity_ids: number[];
  operation: ExtrudeOperation;
  target_body_ids: number[];
  guide_rail?: PathRefDto | null;
  orientation?: SweepOrientation;
  transition?: SweepTransition;
  force_c1?: boolean;
}

export interface SweepDefinitionDto extends SweepRequest {
  feature_id: number;
  name: string;
  new_body_id: number;
}

export type LoftContinuity = 'g0' | 'g1' | 'g2';

export interface LoftRequest {
  sections: ProfileRefDto[];
  ruled: boolean;
  operation: ExtrudeOperation;
  target_body_ids: number[];
  continuity?: LoftContinuity;
  centerline?: PathRefDto | null;
  guide_rail?: PathRefDto | null;
}

export interface LoftDefinitionDto extends LoftRequest {
  feature_id: number;
  name: string;
  new_body_id: number;
}

export type RibExtent =
  | { type: 'distance'; depth: number }
  | { type: 'to_next' }
  | { type: 'to_face'; face_id: number }
  | { type: 'through_all' };

export interface RibRequest {
  sketch_name: string;
  line_entity_ids: number[];
  thickness: number;
  depth: number;
  symmetric: boolean;
  flip: boolean;
  operation: ExtrudeOperation;
  target_body_ids: number[];
  extent?: RibExtent | null;
}

export interface RibDefinitionDto extends RibRequest {
  feature_id: number;
  name: string;
  new_body_ids: number[];
  to_face_basis?: PlaneBasis | null;
}

export interface SolidFilletRequest {
  body_id: number;
  edge_ids: number[];
  radius: number;
  tangent_chain: boolean;
}

export interface SolidFilletDefinitionDto extends SolidFilletRequest {
  feature_id: number;
  name: string;
  edge_keys: string[];
}

export interface SolidChamferRequest {
  body_id: number;
  edge_ids: number[];
  distance: number;
  tangent_chain: boolean;
}

export interface SolidChamferDefinitionDto extends SolidChamferRequest {
  feature_id: number;
  name: string;
  edge_keys: string[];
}

export type HoleExtent = { type: 'distance'; depth: number } | { type: 'through_all' };
export type HoleStyle = 'simple' | 'counterbore' | 'countersink';
export type HoleBottomStyle = 'flat' | 'drill_point';
export type HoleThreadStandard = 'iso_metric' | 'unified_inch';
export type HoleThreadSeries = 'metric_coarse' | 'metric_fine' | 'unc' | 'unf';
export type HoleThreadHand = 'right' | 'left';
export type HoleThreadRepresentation = 'modeled' | 'simplified';

export interface HoleThreadDto {
  standard: HoleThreadStandard;
  series: HoleThreadSeries;
  designation: string;
  class: string;
  /** Basic major diameter in millimetres. */
  nominal_diameter: number;
  /** Axial pitch in millimetres, including for Unified inch threads. */
  pitch: number;
  threads_per_inch: number | null;
  hand: HoleThreadHand;
  /** Null means the full cylindrical hole depth. */
  depth: number | null;
  representation: HoleThreadRepresentation;
  tap_drill_designation: string | null;
}

export interface HolePositionDto {
  position: Vec2;
  position_reference: SketchPointRefDto | null;
}

export interface HoleRequest {
  body_id: number;
  face_id: number;
  position: Vec2;
  position_reference: SketchPointRefDto | null;
  positions: HolePositionDto[];
  diameter: number;
  extent: HoleExtent;
  style: HoleStyle;
  counterbore_diameter: number;
  counterbore_depth: number;
  countersink_diameter: number;
  countersink_angle_deg: number;
  bottom_style: HoleBottomStyle;
  drill_point_angle_deg: number;
  thread: HoleThreadDto | null;
  flip: boolean;
}

export interface HoleDefinitionDto extends HoleRequest {
  feature_id: number;
  name: string;
  face_basis: PlaneBasis | null;
}

export type DatumPlaneSourceDto =
  | { type: 'offset'; reference: PlaneRef; distance: number }
  | { type: 'midplane'; first: PlaneRef; second: PlaneRef }
  | {
      type: 'at_angle';
      reference: PlaneRef;
      body_id: number;
      edge_id: number;
      angle_deg: number;
      axis_points?: [Point3Dto, Point3Dto] | null;
    };

export interface DatumPlaneRequest {
  source: DatumPlaneSourceDto;
}

export interface DatumPlaneDefinitionDto extends DatumPlaneRequest {
  feature_id: number;
  name: string;
  datum_id: number;
  basis: PlaneBasis;
}

export interface DatumPlaneUpdateDto {
  document: DocumentDto;
  planes: DatumPlaneDefinitionDto[];
}

export interface ShellRequest {
  body_id: number;
  face_ids: number[];
  thickness: number;
  inward: boolean;
}

export interface SolidMirrorRequest {
  body_ids: number[];
  plane: PlaneRef;
  plane_basis?: PlaneBasis | null;
}

export interface RectangularPatternRequest {
  body_ids: number[];
  direction: Point3Dto;
  spacing: number;
  count: number;
  second_direction?: Point3Dto | null;
  second_spacing: number;
  second_count: number;
}

export interface CircularPatternRequest {
  body_ids: number[];
  axis_origin: Point3Dto;
  axis_direction: Point3Dto;
  count: number;
  total_angle_deg: number;
}

export type CombineOperation = 'join' | 'cut' | 'intersect';

export interface CombineRequest {
  target_body_id: number;
  tool_body_ids: number[];
  operation: CombineOperation;
  keep_tools: boolean;
}

export interface SplitBodyRequest {
  body_id: number;
  plane: PlaneRef;
  plane_basis?: PlaneBasis | null;
}

export interface ImportStepRequest {
  file_name: string;
  data_base64: string;
}

export type BodyFeatureRequestDto =
  | { type: 'shell'; request: ShellRequest }
  | { type: 'mirror'; request: SolidMirrorRequest }
  | { type: 'rectangular_pattern'; request: RectangularPatternRequest }
  | { type: 'circular_pattern'; request: CircularPatternRequest }
  | { type: 'combine'; request: CombineRequest }
  | { type: 'split_body'; request: SplitBodyRequest }
  | { type: 'import_step'; request: ImportStepRequest };

export type BodyFeatureDefinitionDto =
  | {
      type: 'shell';
      feature_id: number;
      name: string;
      body_id: number;
      face_ids: number[];
      face_keys: string[];
      thickness: number;
      inward: boolean;
    }
  | {
      type: 'mirror';
      feature_id: number;
      name: string;
      body_ids: number[];
      plane: PlaneRef;
      plane_basis: PlaneBasis;
      new_body_ids: number[];
    }
  | {
      type: 'rectangular_pattern';
      feature_id: number;
      name: string;
      body_ids: number[];
      direction: Point3Dto;
      spacing: number;
      count: number;
      second_direction: Point3Dto | null;
      second_spacing: number;
      second_count: number;
      new_body_ids: number[];
    }
  | {
      type: 'circular_pattern';
      feature_id: number;
      name: string;
      body_ids: number[];
      axis_origin: Point3Dto;
      axis_direction: Point3Dto;
      count: number;
      total_angle_deg: number;
      new_body_ids: number[];
    }
  | {
      type: 'combine';
      feature_id: number;
      name: string;
      target_body_id: number;
      tool_body_ids: number[];
      operation: CombineOperation;
      keep_tools: boolean;
    }
  | {
      type: 'split_body';
      feature_id: number;
      name: string;
      body_id: number;
      plane: PlaneRef;
      plane_basis: PlaneBasis;
      new_body_id: number;
    }
  | {
      type: 'import_step';
      feature_id: number;
      name: string;
      file_name: string;
      data_base64: string;
      body_id: number;
    };

export interface KernelProfileDto {
  profile_index: number;
  points: Point3Dto[];
  curves: KernelCurveDto[];
  holes: KernelProfileDto[];
}

export type KernelCurveDto =
  | { kind: 'line'; entity_id: number; start: Point3Dto; end: Point3Dto }
  | { kind: 'arc'; entity_id: number; start: Point3Dto; mid: Point3Dto; end: Point3Dto }
  | {
      kind: 'circle';
      entity_id: number;
      center: Point3Dto;
      axis_point: Point3Dto;
      normal: Point3Dto;
    }
  | { kind: 'polyline'; entity_id: number; points: Point3Dto[] };

export interface KernelExtrudeJobDto {
  feature_id: number;
  operation: ExtrudeOperation;
  source_face?: {
    body_id: number;
    face_id: number;
    face_key: string;
    signature: PlanarFaceSignatureDto;
  } | null;
  profiles: KernelProfileDto[];
  normal: Point3Dto;
  start_offset: number;
  end_offset: number;
  taper_angle_deg: number;
  target_body_ids: number[];
  result_body_ids: number[];
}

export interface KernelRevolveJobDto {
  feature_id: number;
  operation: ExtrudeOperation;
  profiles: KernelProfileDto[];
  axis_origin: Point3Dto;
  axis_direction: Point3Dto;
  angle_rad: number;
  target_body_ids: number[];
  result_body_ids: number[];
}

export interface KernelSweepJobDto {
  feature_id: number;
  operation: ExtrudeOperation;
  profile: KernelProfileDto;
  path: KernelCurveDto[];
  guide_rail: KernelCurveDto[];
  orientation: SweepOrientation;
  transition: SweepTransition;
  force_c1: boolean;
  target_body_ids: number[];
  result_body_ids: number[];
}

export interface KernelLoftJobDto {
  feature_id: number;
  operation: ExtrudeOperation;
  sections: KernelProfileDto[];
  ruled: boolean;
  continuity: LoftContinuity;
  centerline: KernelCurveDto[];
  guide_rail: KernelCurveDto[];
  target_body_ids: number[];
  result_body_ids: number[];
}

export interface KernelRibJobDto {
  feature_id: number;
  operation: ExtrudeOperation;
  profiles: KernelProfileDto[];
  normal: Point3Dto;
  start_offset: number;
  end_offset: number;
  target_body_ids: number[];
  result_body_ids: number[];
}

export interface KernelFilletJobDto {
  feature_id: number;
  target_body_id: number;
  edge_keys: string[];
  radius: number;
  tangent_chain: boolean;
}

export interface KernelChamferJobDto {
  feature_id: number;
  target_body_id: number;
  edge_keys: string[];
  distance: number;
  tangent_chain: boolean;
}

export interface KernelHoleJobDto {
  feature_id: number;
  target_body_id: number;
  center: Point3Dto;
  direction: Point3Dto;
  diameter: number;
  extent: HoleExtent;
  style: HoleStyle;
  counterbore_diameter: number;
  counterbore_depth: number;
  countersink_diameter: number;
  countersink_angle_deg: number;
  bottom_style: HoleBottomStyle;
  drill_point_angle_deg: number;
  thread: HoleThreadDto | null;
}

export type KernelTransformDto =
  | { kind: 'mirror'; origin: Point3Dto; normal: Point3Dto }
  | { kind: 'translate'; vector: Point3Dto }
  | { kind: 'rotate'; origin: Point3Dto; axis: Point3Dto; angle_rad: number };

export interface KernelTransformJobDto {
  feature_id: number;
  source_body_ids: number[];
  transforms: KernelTransformDto[];
  result_body_ids: number[];
}

export interface KernelShellJobDto {
  feature_id: number;
  target_body_id: number;
  face_keys: string[];
  thickness: number;
  inward: boolean;
}

export interface KernelCombineJobDto {
  feature_id: number;
  target_body_id: number;
  tool_body_ids: number[];
  operation: CombineOperation;
  keep_tools: boolean;
}

export interface KernelSplitBodyJobDto {
  feature_id: number;
  target_body_id: number;
  plane_origin: Point3Dto;
  plane_normal: Point3Dto;
  new_body_id: number;
}

export interface KernelImportStepJobDto {
  feature_id: number;
  result_body_id: number;
  data_base64: string;
}

export type KernelJobDto =
  | { kind: 'extrude'; job: KernelExtrudeJobDto }
  | { kind: 'revolve'; job: KernelRevolveJobDto }
  | { kind: 'sweep'; job: KernelSweepJobDto }
  | { kind: 'loft'; job: KernelLoftJobDto }
  | { kind: 'rib'; job: KernelRibJobDto }
  | { kind: 'fillet'; job: KernelFilletJobDto }
  | { kind: 'chamfer'; job: KernelChamferJobDto }
  | { kind: 'hole'; job: KernelHoleJobDto }
  | { kind: 'shell'; job: KernelShellJobDto }
  | { kind: 'transform'; job: KernelTransformJobDto }
  | { kind: 'combine'; job: KernelCombineJobDto }
  | { kind: 'split_body'; job: KernelSplitBodyJobDto }
  | { kind: 'import_step'; job: KernelImportStepJobDto };

export interface RecomputePlanDto {
  transaction_id: number;
  jobs: KernelJobDto[];
  errors: KernelFeatureErrorDto[];
}

export interface KernelFaceDto {
  key: string;
  first_index: number;
  index_count: number;
  plane: PlaneBasis | null;
  signature?: PlanarFaceSignatureDto | null;
}

export interface PlanarFaceSignatureDto {
  centroid: Point3Dto;
  normal: Point3Dto;
  area: number;
  perimeter: number;
  wire_count: number;
  edge_count: number;
}

export interface KernelEdgeDto {
  key: string;
  points: Point3Dto[];
  /** Cached kernel topology classification for fillet/chamfer selection. */
  refinable: boolean;
}

export interface KernelBodyDto {
  body_id: number;
  positions: number[];
  normals: number[];
  indices: number[];
  faces: KernelFaceDto[];
  edges: KernelEdgeDto[];
}

export interface KernelFeatureErrorDto {
  feature_id: number;
  message: string;
}

export interface KernelSceneDto {
  bodies: KernelBodyDto[];
  errors: KernelFeatureErrorDto[];
}

export interface FaceDto extends KernelFaceDto {
  id: number;
}

export interface EdgeDto extends KernelEdgeDto {
  id: number;
}

export interface BodyDto {
  id: number;
  name: string;
  feature_id: number;
  mesh: {
    positions: number[];
    normals: number[];
    indices: number[];
  };
  faces: FaceDto[];
  edges: EdgeDto[];
}

export interface SolidSceneDto {
  bodies: BodyDto[];
  errors: KernelFeatureErrorDto[];
}

export interface SolidUpdateDto {
  document: DocumentDto;
  scene: SolidSceneDto;
}

export type DrawingSheetFormat =
  | 'a0'
  | 'a1'
  | 'a2'
  | 'a3'
  | 'a4'
  | 'letter'
  | 'ansi_b'
  | 'ansi_c'
  | 'ansi_d'
  | 'ansi_e';
export type DrawingSheetOrientation = 'landscape' | 'portrait';
export type DrawingStandard = 'iso' | 'ansi';
export type DrawingProjectionMethod = 'first_angle' | 'third_angle';
export type DrawingTolerancePreset =
  | 'none'
  | 'iso2768_fine'
  | 'iso2768_medium'
  | 'iso2768_coarse'
  | 'iso2768_very_coarse'
  | 'ansi_decimal'
  | 'custom';
export interface DrawingToleranceNoteDto {
  preset: DrawingTolerancePreset;
  custom: string;
}
export type DrawingViewKind =
  | 'front'
  | 'rear'
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | 'isometric'
  | 'custom'
  | 'section'
  | 'detail'
  | 'auxiliary'
  | 'broken'
  | 'removed_section';

export interface DrawingTitleBlockDto {
  title: string;
  drawing_number: string;
  revision: string;
  author: string;
  checked_by: string;
  approved_by: string;
  company: string;
  material: string;
  finish: string;
}

export interface DrawingLineStyleDto {
  width_mm: number;
  dash_mm: number[];
}

export interface DrawingSheetStyleDto {
  name: string;
  font_family: string;
  text_height_mm: number;
  small_text_height_mm: number;
  arrow_size_mm: number;
  visible: DrawingLineStyleDto;
  hidden: DrawingLineStyleDto;
  center: DrawingLineStyleDto;
  cutting_plane: DrawingLineStyleDto;
  phantom: DrawingLineStyleDto;
  break_line: DrawingLineStyleDto;
  dimension: DrawingLineStyleDto;
  extension: DrawingLineStyleDto;
  leader: DrawingLineStyleDto;
  hatch: DrawingLineStyleDto;
  hatch_angle_deg: number;
  hatch_spacing_mm: number;
}

export type DrawingReleaseStatus = 'draft' | 'in_review' | 'released' | 'superseded' | 'obsolete';

export interface DrawingReleaseDto {
  status: DrawingReleaseStatus;
  released_revision: string;
  released_at: string;
}

export interface DrawingRevisionDto {
  id: number;
  revision: string;
  description: string;
  date: string;
  author: string;
  checked_by: string;
  approved_by: string;
  change_order: string;
  status: DrawingReleaseStatus;
}

export interface DrawingBomItemDto {
  id: number;
  item_number: string;
  body_id: number | null;
  part_number: string;
  description: string;
  quantity: number;
  material: string;
  finish: string;
}

export interface DrawingViewDto {
  id: number;
  name: string;
  kind: DrawingViewKind;
  /** Direction from the model toward the viewer. */
  direction: [number, number, number];
  up: [number, number, number];
  /** Paper-space millimetres from the upper-left sheet corner. */
  position: [number, number];
  /** Paper millimetres per model millimetre. */
  scale: number;
  body_ids: number[];
  show_hidden_lines: boolean;
  show_tangent_edges: boolean;
  parent_view_id: number | null;
  alignment: 'free' | 'horizontal' | 'vertical';
  derivation: DrawingViewDerivationDto | null;
}

export type DrawingBreakAxis = 'horizontal' | 'vertical';
export type DrawingViewDerivationDto =
  | {
      type: 'section';
      parent_view_id: number;
      first: DrawingTopologyAnchorRefDto;
      second: DrawingTopologyAnchorRefDto;
      label: string;
      depth: number | null;
      hatch_angle_deg: number;
      hatch_spacing_mm: number;
    }
  | {
      type: 'detail';
      parent_view_id: number;
      center: DrawingTopologyAnchorRefDto;
      radius: number;
      label: string;
    }
  | {
      type: 'auxiliary';
      parent_view_id: number;
      reference: DrawingLineRefDto;
      label: string;
      flipped: boolean;
    }
  | {
      type: 'broken';
      parent_view_id: number;
      axis: DrawingBreakAxis;
      first: number;
      second: number;
      gap_mm: number;
    }
  | {
      type: 'removed_section';
      parent_view_id: number;
      first: DrawingTopologyAnchorRefDto;
      second: DrawingTopologyAnchorRefDto;
      label: string;
      hatch_angle_deg: number;
      hatch_spacing_mm: number;
    };

export type DrawingEdgeEndpoint = 'start' | 'end';
export type DrawingLinearDimensionMode = 'aligned' | 'horizontal' | 'vertical';
export type DrawingLineDimensionMode = 'length' | 'distance' | 'angle';
export type DrawingRadialDimensionMode = 'diameter' | 'radius';
export type DrawingDimensionToleranceMode = 'none' | 'symmetric' | 'deviation' | 'limits';
export type DrawingSecondaryUnit = 'millimetre' | 'centimetre' | 'inch';
export type DrawingDualUnitPlacement = 'bracketed' | 'stacked';
export interface DrawingDimensionToleranceDto {
  mode: DrawingDimensionToleranceMode;
  upper: number;
  lower: number;
}
export interface DrawingDualUnitDto {
  unit: DrawingSecondaryUnit;
  precision: number;
  placement: DrawingDualUnitPlacement;
}
export interface DrawingDimensionPresentationDto {
  tolerance: DrawingDimensionToleranceDto;
  basic: boolean;
  reference: boolean;
  dual_units: DrawingDualUnitDto | null;
  fit_class: string;
}
export type DrawingChainDimensionLayout = 'chain' | 'baseline' | 'continued';
export type DrawingOrdinateAxis = 'x' | 'y' | 'both';

export interface DrawingTopologyAnchorRefDto {
  body_id: number;
  edge_id: number;
  edge_key: string;
  endpoint: DrawingEdgeEndpoint;
  fallback_point: [number, number, number];
  /** True when this associative point is the analytic center of a circle. */
  circle_center?: boolean;
}

export interface DrawingCircularRefDto {
  body_id: number;
  edge_id: number;
  edge_key: string;
  fallback_center: [number, number, number];
  fallback_normal: [number, number, number];
  fallback_radius: number;
  closed: boolean;
}

/** Stable exact-topology reference to a straight model edge. */
export interface DrawingLineRefDto {
  body_id: number;
  edge_id: number;
  edge_key: string;
  fallback_start: [number, number, number];
  fallback_end: [number, number, number];
}

export type DrawingAttachmentRefDto =
  | { type: 'anchor'; reference: DrawingTopologyAnchorRefDto }
  | { type: 'line'; reference: DrawingLineRefDto }
  | { type: 'circle'; reference: DrawingCircularRefDto };

export type DrawingGdtCharacteristic =
  | 'straightness' | 'flatness' | 'circularity' | 'cylindricity'
  | 'profile_line' | 'profile_surface' | 'angularity' | 'perpendicularity'
  | 'parallelism' | 'position' | 'concentricity' | 'symmetry'
  | 'circular_runout' | 'total_runout';
export type DrawingMaterialCondition = 'none' | 'maximum' | 'least' | 'regardless';
export interface DrawingDatumReferenceDto {
  label: string;
  material_condition: DrawingMaterialCondition;
}
export type DrawingSurfaceLay = 'none' | 'parallel' | 'perpendicular' | 'crossed' | 'multidirectional' | 'circular' | 'radial' | 'particulate';
export type DrawingWeldType = 'fillet' | 'square_groove' | 'v_groove' | 'bevel_groove' | 'u_groove' | 'j_groove' | 'plug_slot' | 'spot' | 'seam' | 'surfacing';
export type DrawingWeldSide = 'arrow' | 'other' | 'both';
export type DrawingWeldContour = 'none' | 'flush' | 'convex' | 'concave';

export type DrawingAnnotationDto =
  | {
      kind: 'linear_dimension';
      id: number;
      view_id: number;
      first: DrawingTopologyAnchorRefDto;
      second: DrawingTopologyAnchorRefDto;
      mode: DrawingLinearDimensionMode;
      /** Signed paper-space offset from the measured span, in millimetres. */
      offset: number;
      prefix: string;
      suffix: string;
      precision: number;
      presentation: DrawingDimensionPresentationDto;
    }
  | {
      /** Smart associative dimension driven by one or two exact straight edges. */
      kind: 'line_dimension';
      id: number;
      view_id: number;
      first: DrawingLineRefDto;
      second: DrawingLineRefDto | null;
      mode: DrawingLineDimensionMode;
      /** Paper-space cursor/drag position; geometry constrains it for the mode. */
      position: [number, number];
      prefix: string;
      suffix: string;
      precision: number;
      presentation: DrawingDimensionPresentationDto;
    }
  | {
      /** Perpendicular distance from an associative point to an exact straight edge. */
      kind: 'point_line_dimension';
      id: number;
      view_id: number;
      point: DrawingTopologyAnchorRefDto;
      line: DrawingLineRefDto;
      /** Paper-space cursor/drag position; constrained parallel to the edge. */
      position: [number, number];
      prefix: string;
      suffix: string;
      precision: number;
      presentation: DrawingDimensionPresentationDto;
    }
  | {
      kind: 'note';
      id: number;
      text: string;
      position: [number, number];
    }
  | {
      kind: 'radial_dimension';
      id: number;
      view_id: number;
      feature: DrawingCircularRefDto;
      mode: DrawingRadialDimensionMode;
      leader_angle_deg: number;
      offset: number;
      prefix: string;
      suffix: string;
      precision: number;
      presentation: DrawingDimensionPresentationDto;
    }
  | {
      kind: 'angular_dimension';
      id: number;
      view_id: number;
      vertex: DrawingTopologyAnchorRefDto;
      first: DrawingTopologyAnchorRefDto;
      second: DrawingTopologyAnchorRefDto;
      radius: number;
      prefix: string;
      suffix: string;
      precision: number;
      presentation: DrawingDimensionPresentationDto;
    }
  | {
      kind: 'hole_note';
      id: number;
      view_id: number;
      feature: DrawingCircularRefDto;
      position: [number, number];
      quantity: number;
      diameter: number;
      depth: number | null;
      thread: string;
      note: string;
      source_feature_id: number | null;
      feature_name: string;
      hole_style: HoleStyle;
      counterbore_diameter: number | null;
      counterbore_depth: number | null;
      countersink_diameter: number | null;
      countersink_angle_deg: number | null;
      thread_depth: number | null;
      pattern_note: string;
    }
  | {
      kind: 'chamfer_note';
      id: number;
      view_id: number;
      first: DrawingTopologyAnchorRefDto;
      second: DrawingTopologyAnchorRefDto;
      position: [number, number];
      length: number;
      angle_deg: number;
      prefix: string;
    }
  | {
      kind: 'center_mark';
      id: number;
      view_id: number;
      feature: DrawingCircularRefDto;
      /** Paper-space extension beyond the selected circular edge. */
      extension: number;
    }
  | {
      kind: 'center_line';
      id: number;
      view_id: number;
      first: DrawingCircularRefDto;
      second: DrawingCircularRefDto;
      /** Paper-space extension beyond both selected circular edges. */
      extension: number;
    }
  | {
      kind: 'center_line_between_edges';
      id: number;
      view_id: number;
      first: DrawingLineRefDto;
      second: DrawingLineRefDto;
      /** Paper-space extension beyond the selected parallel edges. */
      extension: number;
    }
  | {
      kind: 'automatic_symmetry_axis';
      id: number;
      view_id: number;
      axis: DrawingOrdinateAxis;
      extension: number;
    }
  | {
      kind: 'bolt_circle_center_line';
      id: number;
      view_id: number;
      features: DrawingCircularRefDto[];
      extension: number;
    }
  | {
      kind: 'chain_dimension';
      id: number;
      view_id: number;
      anchors: DrawingTopologyAnchorRefDto[];
      mode: DrawingLinearDimensionMode;
      layout: DrawingChainDimensionLayout;
      offset: number;
      spacing: number;
      prefix: string;
      suffix: string;
      precision: number;
      presentation: DrawingDimensionPresentationDto;
    }
  | {
      kind: 'ordinate_dimension';
      id: number;
      view_id: number;
      origin: DrawingTopologyAnchorRefDto;
      target: DrawingTopologyAnchorRefDto;
      axis: DrawingOrdinateAxis;
      offset: number;
      precision: number;
      presentation: DrawingDimensionPresentationDto;
    }
  | {
      kind: 'arc_length_dimension';
      id: number;
      view_id: number;
      feature: DrawingCircularRefDto;
      first: DrawingTopologyAnchorRefDto;
      second: DrawingTopologyAnchorRefDto;
      offset: number;
      precision: number;
      presentation: DrawingDimensionPresentationDto;
    }
  | {
      kind: 'jogged_radius_dimension';
      id: number;
      view_id: number;
      feature: DrawingCircularRefDto;
      jog: [number, number];
      position: [number, number];
      precision: number;
      presentation: DrawingDimensionPresentationDto;
    }
  | {
      kind: 'datum_feature';
      id: number;
      view_id: number;
      attachment: DrawingAttachmentRefDto;
      label: string;
      position: [number, number];
      target_index: number | null;
    }
  | {
      kind: 'gdt_frame';
      id: number;
      view_id: number;
      attachment: DrawingAttachmentRefDto;
      position: [number, number];
      characteristic: DrawingGdtCharacteristic;
      tolerance: number;
      diameter_zone: boolean;
      material_condition: DrawingMaterialCondition;
      datums: DrawingDatumReferenceDto[];
      projected_zone: number | null;
      free_state: boolean;
    }
  | {
      kind: 'surface_texture';
      id: number;
      view_id: number;
      attachment: DrawingAttachmentRefDto;
      position: [number, number];
      roughness_ra: number;
      process: string;
      lay: DrawingSurfaceLay;
      machining_allowance: number | null;
    }
  | {
      kind: 'edge_requirement';
      id: number;
      view_id: number;
      attachment: DrawingLineRefDto;
      position: [number, number];
      upper_deviation: number;
      lower_deviation: number;
      note: string;
    }
  | {
      kind: 'weld_symbol';
      id: number;
      view_id: number;
      attachment: DrawingLineRefDto;
      position: [number, number];
      weld_type: DrawingWeldType;
      side: DrawingWeldSide;
      size: number;
      length: number | null;
      pitch: number | null;
      contour: DrawingWeldContour;
      finish: string;
      all_around: boolean;
      field_weld: boolean;
      tail: string;
    }
  | {
      kind: 'item_balloon';
      id: number;
      view_id: number;
      attachment: DrawingAttachmentRefDto;
      position: [number, number];
      bom_item_id: number;
    }
  | {
      kind: 'revision_cloud';
      id: number;
      revision: string;
      points: Array<[number, number]>;
    };

export interface DrawingSheetDto {
  id: number;
  name: string;
  format: DrawingSheetFormat;
  orientation: DrawingSheetOrientation;
  standard: DrawingStandard;
  projection_method: DrawingProjectionMethod;
  tolerance_note: DrawingToleranceNoteDto;
  title_block: DrawingTitleBlockDto;
  views: DrawingViewDto[];
  annotations: DrawingAnnotationDto[];
  style: DrawingSheetStyleDto;
  template_name: string;
  revisions: DrawingRevisionDto[];
  bom: DrawingBomItemDto[];
  release: DrawingReleaseDto;
  revision_table_position: [number, number] | null;
  bom_table_position: [number, number] | null;
}

export interface DrawingTemplateDto {
  id: number;
  name: string;
  standard: DrawingStandard;
  projection_method: DrawingProjectionMethod;
  tolerance_note: DrawingToleranceNoteDto;
  title_defaults: DrawingTitleBlockDto;
  style: DrawingSheetStyleDto;
}

export interface DrawingDocumentDto {
  sheets: DrawingSheetDto[];
  active_sheet_id: number | null;
  next_sheet_id: number;
  next_view_id: number;
  next_annotation_id: number;
  next_revision_id: number;
  next_bom_item_id: number;
  templates: DrawingTemplateDto[];
  next_template_id: number;
}

export interface DrawingProjectionRequest {
  body_ids: number[];
  direction: [number, number, number];
  up: [number, number, number];
  include_hidden: boolean;
  include_tangent_edges: boolean;
  deflection: number;
  section_plane?: {
    point: [number, number, number];
    normal: [number, number, number];
    /** Positive model-mm depth behind the cutting plane; null is a full section. */
    depth?: number | null;
  } | null;
}

export interface DrawingPolylineDto {
  points: Array<[number, number]>;
}

export interface DrawingProjectionAnchorDto {
  body_id: number;
  edge_id: number;
  edge_key: string;
  endpoint: DrawingEdgeEndpoint;
  model_point: [number, number, number];
  /** Projected model-millimetre coordinate, before drawing-view scale. */
  point: [number, number];
  hidden: boolean;
}

export interface DrawingProjectedCircleDto {
  body_id: number;
  edge_id: number;
  edge_key: string;
  center_model: [number, number, number];
  normal_model: [number, number, number];
  /** Projected model-millimetre coordinate, before drawing-view scale. */
  center: [number, number];
  radius: number;
  closed: boolean;
  hidden: boolean;
}

export interface DrawingProjectionDto {
  visible: DrawingPolylineDto[];
  hidden: DrawingPolylineDto[];
  anchors: DrawingProjectionAnchorDto[];
  circles: DrawingProjectedCircleDto[];
  section: DrawingPolylineDto[];
  /** min x, min y, max x, max y in model millimetres. */
  bounds: [number, number, number, number];
}

export interface StepThreadMetadataDto {
  body_id: number;
  feature_id: number;
  feature_name: string;
  position_count: number;
  predrill_diameter: number;
  thread: HoleThreadDto;
}

/** Empty body_ids exports every active body. */
export interface StepExportRequest {
  body_ids: number[];
  thread_metadata: StepThreadMetadataDto[];
}

/** 8-bit RGBA. Alpha is kept for UI; 3MF export flattens to opaque RGB. */
export interface Rgba8 {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Per-body color and print material for viewport + 3MF / slicer metadata. */
export interface BodyAppearance {
  body_id: number;
  color: Rgba8;
  material_name: string;
  filament_type: string;
  brand: string;
  color_name: string;
  filament_id: string | null;
  preset_id: string | null;
  density_g_cm3: number | null;
  diameter_mm: number;
}

/** Persisted Browser eye-toggle choices, keyed by stable model identity. */
export interface ProjectVisibilityDto {
  hidden_body_ids: number[];
  hidden_datum_plane_ids: number[];
  hidden_sketch_names: string[];
}

/** Mesh export selection. Empty body_ids exports every active body. */
export interface MeshExportRequest {
  body_ids: number[];
  linear_deflection: number;
  angular_deflection: number;
  include_appearance: boolean;
  slicer_target?:
    | 'standard'
    | 'bambu_studio'
    | 'orca_slicer'
    | 'prusa_slicer'
    | 'cura';
}

export const DEFAULT_BODY_COLOR: Rgba8 = { r: 180, g: 180, b: 180, a: 255 };
export const DEFAULT_MATERIAL_NAME = 'Generic';
export const DEFAULT_MESH_LINEAR_DEFLECTION = 0.15;
export const DEFAULT_MESH_ANGULAR_DEFLECTION = 0.35;

/** Dynamic-input locked segment request (mm / degrees from +u, CCW).
 * `*_text` carries the raw typed text (number or formula, D9). */
export interface LockedSegmentRequest {
  from: Vec2;
  to_hint: Vec2;
  length_mm?: number | null;
  angle_deg?: number | null;
  length_text?: string | null;
  angle_text?: string | null;
  ctrl_held: boolean;
}

export type RectangleMode = 'two_point' | 'center';
export type CircleMode = 'center_diameter' | 'two_point';

export interface RectangleRequest {
  mode: RectangleMode;
  p1: Vec2;
  p2: Vec2;
  ctrl_held: boolean;
}

export interface LockedRectangleRequest {
  mode: RectangleMode;
  anchor: Vec2;
  width_mm?: number | null;
  height_mm?: number | null;
  width_text?: string | null;
  height_text?: string | null;
  corner_hint: Vec2;
  ctrl_held: boolean;
}

export interface CircleRequest {
  mode: CircleMode;
  p1: Vec2;
  p2: Vec2;
  ctrl_held: boolean;
}

export interface LockedCircleRequest {
  mode: CircleMode;
  anchor: Vec2;
  diameter_mm?: number | null;
  diameter_text?: string | null;
  edge_hint: Vec2;
  ctrl_held: boolean;
}

/** Slot family (M1 follow-up): two end-cap centers
 * (center_to_center), overall endpoints (overall), or slot center + one
 * end-cap center (center_point). */
export type SlotMode = 'center_to_center' | 'overall' | 'center_point';

export interface SlotRequest {
  mode: SlotMode;
  p1: Vec2;
  p2: Vec2;
  /** Third-click point: drives the width when no typed width exists. */
  cursor: Vec2;
  width_mm?: number | null;
  width_text?: string | null;
}

/** Fit-point spline creation: ordered fit points (≥ 2 after cleanup). */
export interface SplineRequest {
  points: Vec2[];
}

export interface Arc3PointRequest {
  p1: Vec2;
  p2: Vec2;
  p3: Vec2;
  ctrl_held: boolean;
}

export interface ArcCenterRequest {
  center: Vec2;
  start: Vec2;
  sweep: Vec2;
  ctrl_held: boolean;
}

export interface MidpointLineRequest {
  mid_raw: Vec2;
  end_raw: Vec2;
  ctrl_held: boolean;
}

export interface PointRequest {
  position: Vec2;
  /** Stable line/circle/arc id acquired under the pointer, if any. */
  coincident_with?: number | null;
}

/** A constraint as serialized by the Rust `Constraint` enum (tagged). */
export type ConstraintPayload =
  | { type: 'horizontal' | 'vertical' | 'fix'; entity: number }
  | { type: 'coincident' | 'tangent' | 'equal' | 'parallel' | 'perpendicular' | 'midpoint' | 'concentric' | 'collinear'; a: number; b: number }
  | { type: 'symmetry'; a: number; b: number; axis: number };

export interface ConstraintBatchRequest {
  constraints: ConstraintPayload[];
}

export interface ToggleFixBatchRequest {
  entity_ids: number[];
}

export interface ToolResult {
  entities: number[];
  sketch: SketchDto;
}

export interface AddConstraintResult {
  constraint_id: number;
  sketch: SketchDto;
}

export interface EntityDesc {
  id: number;
  label: string;
}

/** D4.2 conflict report (carried on the error envelope as `data`). */
export interface ConflictReport {
  rejected: { id: number; kind: string; entities: EntityDesc[] };
  conflicts_with: Array<{ id: number; kind: string; entities: EntityDesc[] }>;
}

/** Host envelope: `{"ok":true,"value":...}` / `{"ok":false,"error":"..."}`. */
export type Envelope<T> = { ok: true; value: T } | { ok: false; error: string };
