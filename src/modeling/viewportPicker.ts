/**
 * Shared contract between modeling dialogs and the viewport picker.
 *
 * Commands identify the geometric role they need; the viewport owns hit
 * testing, eligibility, hover feedback, and selection cardinality. Keeping
 * those rules here prevents each feature dialog from inventing its own picker
 * semantics or leaking anonymous topology identifiers into the UI.
 */

export const MODELING_PICK_TARGETS = [
  'extrude_source',
  'extrude_targets',
  'extrude_to_face',
  'revolve_profile',
  'revolve_axis',
  'revolve_targets',
  'sweep_profile',
  'sweep_path',
  'sweep_guide',
  'sweep_targets',
  'loft_sections',
  'loft_centerline',
  'loft_guide',
  'loft_targets',
  'rib_centerline',
  'rib_to_face',
  'rib_targets',
  'hole_support',
  'hole_positions',
  'fillet_edges',
  'chamfer_edges',
  'move_bodies',
  'move_component',
  'move_direction',
  'move_axis',
  'move_from',
  'move_to',
  'move_pivot',
  'external_thread_face',
  'shell_faces',
  'mirror_bodies',
  'mirror_plane',
  'rectangular_pattern_bodies',
  'rectangular_pattern_direction',
  'rectangular_pattern_second_direction',
  'circular_pattern_bodies',
  'circular_pattern_axis',
  'combine_target',
  'combine_tools',
  'split_body',
  'split_plane',
] as const;

export type ModelingPickTarget = (typeof MODELING_PICK_TARGETS)[number];

export type ConstructionPlanePickTarget =
  | 'first_reference'
  | 'second_reference'
  | 'axis_edge'
  | null;

export const VIEWPORT_PICK_GEOMETRIES = [
  'profile',
  'sketch-line',
  'sketch-curve',
  'body',
  'component',
  'face',
  'planar-face',
  'cylindrical-face',
  'refinable-edge',
  'straight-edge',
  'reference-plane',
  'surface-point',
  'hole-position',
] as const;

export type ViewportPickGeometry = (typeof VIEWPORT_PICK_GEOMETRIES)[number];

export type ViewportPickCardinality = 'single' | 'multiple' | 'ordered-multiple';

export type ViewportPickFeedbackChannel =
  | 'profile-region'
  | 'finished-sketch-entity'
  | 'body-outline'
  | 'face-outline'
  | 'edge-overlay'
  | 'reference-plane'
  | 'surface-point'
  | 'sketch-point';

/** One visual channel for every selectable capability. Renderers may draw the
 * channel differently, but no picker geometry is allowed to be silent. */
export const VIEWPORT_PICK_FEEDBACK_CHANNELS = {
  profile: 'profile-region',
  'sketch-line': 'finished-sketch-entity',
  'sketch-curve': 'finished-sketch-entity',
  body: 'body-outline',
  component: 'body-outline',
  face: 'face-outline',
  'planar-face': 'face-outline',
  'cylindrical-face': 'face-outline',
  'refinable-edge': 'edge-overlay',
  'straight-edge': 'edge-overlay',
  'reference-plane': 'reference-plane',
  'surface-point': 'surface-point',
  'hole-position': 'sketch-point',
} as const satisfies Record<ViewportPickGeometry, ViewportPickFeedbackChannel>;

export interface ViewportPickSpec {
  geometry: readonly ViewportPickGeometry[];
  cardinality: ViewportPickCardinality;
  prompt: string;
  /** Multiple faces or edges must stay on the first selected body. */
  sameBody?: boolean;
}

export const MODELING_PICK_SPECS = {
  extrude_source: {
    geometry: ['profile', 'planar-face'],
    cardinality: 'multiple',
    prompt: 'Select closed profiles or a planar model face for Extrude',
  },
  extrude_targets: {
    geometry: ['body'], cardinality: 'multiple', prompt: 'Select target bodies for Extrude',
  },
  extrude_to_face: {
    geometry: ['planar-face'], cardinality: 'single', prompt: 'Select the planar face where the Extrude should stop',
  },
  revolve_profile: {
    geometry: ['profile', 'sketch-line'],
    cardinality: 'multiple',
    prompt: 'Select closed profiles, or choose a coplanar straight line as the Revolve axis',
  },
  revolve_axis: {
    geometry: ['sketch-line', 'profile'],
    cardinality: 'single',
    prompt: 'Select a coplanar straight sketch line, or click another profile to add it',
  },
  revolve_targets: {
    geometry: ['body'], cardinality: 'multiple', prompt: 'Select target bodies for Revolve',
  },
  sweep_profile: {
    geometry: ['profile'], cardinality: 'single', prompt: 'Select a closed profile for Sweep',
  },
  sweep_path: {
    geometry: ['sketch-curve'], cardinality: 'multiple', prompt: 'Select the Sweep path in the viewport',
  },
  sweep_guide: {
    geometry: ['sketch-curve'], cardinality: 'multiple', prompt: 'Select the Sweep guide rail in the viewport',
  },
  sweep_targets: {
    geometry: ['body'], cardinality: 'multiple', prompt: 'Select target bodies for Sweep',
  },
  loft_sections: {
    geometry: ['profile'], cardinality: 'ordered-multiple', prompt: 'Select Loft sections in their intended order',
  },
  loft_centerline: {
    geometry: ['sketch-curve'], cardinality: 'multiple', prompt: 'Select the Loft centerline in the viewport',
  },
  loft_guide: {
    geometry: ['sketch-curve'], cardinality: 'multiple', prompt: 'Select the Loft guide rail in the viewport',
  },
  loft_targets: {
    geometry: ['body'], cardinality: 'multiple', prompt: 'Select target bodies for Loft',
  },
  rib_centerline: {
    geometry: ['sketch-curve'], cardinality: 'multiple', prompt: 'Select Rib centerline curves in the viewport',
  },
  rib_to_face: {
    geometry: ['planar-face'], cardinality: 'single', prompt: 'Select the planar face where the Rib should stop',
  },
  rib_targets: {
    geometry: ['body'], cardinality: 'multiple', prompt: 'Select target bodies for Rib',
  },
  hole_support: {
    geometry: ['hole-position', 'planar-face'],
    cardinality: 'single',
    prompt: 'Select a planar support face or a visible sketch point for Hole',
  },
  hole_positions: {
    geometry: ['hole-position'], cardinality: 'multiple', prompt: 'Select visible sketch points for Hole positions',
  },
  fillet_edges: {
    geometry: ['refinable-edge'], cardinality: 'multiple', sameBody: true, prompt: 'Select model edges to fillet',
  },
  chamfer_edges: {
    geometry: ['refinable-edge'], cardinality: 'multiple', sameBody: true, prompt: 'Select model edges to chamfer',
  },
  move_bodies: {
    geometry: ['body'], cardinality: 'multiple', prompt: 'Select bodies to move or copy',
  },
  move_component: {
    geometry: ['component'], cardinality: 'single', prompt: 'Select a component occurrence to move or copy',
  },
  move_direction: {
    geometry: ['straight-edge'], cardinality: 'single', prompt: 'Select a straight edge for the move direction',
  },
  move_axis: {
    geometry: ['straight-edge'], cardinality: 'single', prompt: 'Select a straight edge for the rotation axis',
  },
  move_from: {
    geometry: ['surface-point'], cardinality: 'single', prompt: 'Select the starting point in the viewport',
  },
  move_to: {
    geometry: ['surface-point'], cardinality: 'single', prompt: 'Select the destination point in the viewport',
  },
  move_pivot: {
    geometry: ['surface-point'], cardinality: 'single', prompt: 'Select the rotation pivot in the viewport',
  },
  external_thread_face: {
    geometry: ['cylindrical-face'], cardinality: 'single', prompt: 'Select an exterior cylindrical face for External Thread',
  },
  shell_faces: {
    geometry: ['face'], cardinality: 'multiple', sameBody: true, prompt: 'Select faces to remove for Shell',
  },
  mirror_bodies: {
    geometry: ['body'], cardinality: 'multiple', prompt: 'Select bodies to mirror',
  },
  mirror_plane: {
    geometry: ['reference-plane'], cardinality: 'single', prompt: 'Select a planar face or visible reference plane for Mirror',
  },
  rectangular_pattern_bodies: {
    geometry: ['body'], cardinality: 'multiple', prompt: 'Select bodies for the rectangular pattern',
  },
  rectangular_pattern_direction: {
    geometry: ['straight-edge'], cardinality: 'single', prompt: 'Select a straight edge for the first pattern direction',
  },
  rectangular_pattern_second_direction: {
    geometry: ['straight-edge'], cardinality: 'single', prompt: 'Select a straight edge for the second pattern direction',
  },
  circular_pattern_bodies: {
    geometry: ['body'], cardinality: 'multiple', prompt: 'Select bodies for the circular pattern',
  },
  circular_pattern_axis: {
    geometry: ['straight-edge'], cardinality: 'single', prompt: 'Select a straight edge for the circular-pattern axis',
  },
  combine_target: {
    geometry: ['body'], cardinality: 'single', prompt: 'Select the Combine target body',
  },
  combine_tools: {
    geometry: ['body'], cardinality: 'multiple', prompt: 'Select one or more Combine tool bodies',
  },
  split_body: {
    geometry: ['body'], cardinality: 'single', prompt: 'Select the body to split',
  },
  split_plane: {
    geometry: ['reference-plane'], cardinality: 'single', prompt: 'Select a planar face or visible reference plane for Split Body',
  },
} as const satisfies Record<ModelingPickTarget, ViewportPickSpec>;

/**
 * Cross-field gestures that are unambiguous from geometry alone. The active
 * field always keeps its own geometry; these routes merely keep a different
 * feature type available so users can satisfy multi-input commands in either
 * order. Same-type roles (target/tool bodies, first/second directions, guide
 * versus centerline) intentionally stay with the explicitly activated field.
 */
export const MODELING_PICK_CROSS_ROUTES = {
  sweep_profile: { 'sketch-curve': 'sweep_path' },
  sweep_path: { profile: 'sweep_profile' },
  sweep_guide: { profile: 'sweep_profile' },
  loft_sections: { 'sketch-curve': 'loft_centerline' },
  loft_centerline: { profile: 'loft_sections' },
  loft_guide: { profile: 'loft_sections' },
  rib_centerline: { 'planar-face': 'rib_to_face' },
  rib_to_face: { 'sketch-curve': 'rib_centerline' },
  hole_positions: { 'planar-face': 'hole_support' },
  mirror_bodies: { 'reference-plane': 'mirror_plane' },
  mirror_plane: { body: 'mirror_bodies' },
  rectangular_pattern_bodies: {
    'straight-edge': 'rectangular_pattern_direction',
  },
  rectangular_pattern_direction: { body: 'rectangular_pattern_bodies' },
  rectangular_pattern_second_direction: { body: 'rectangular_pattern_bodies' },
  circular_pattern_bodies: { 'straight-edge': 'circular_pattern_axis' },
  circular_pattern_axis: { body: 'circular_pattern_bodies' },
  split_body: { 'reference-plane': 'split_plane' },
  split_plane: { body: 'split_body' },
} as const satisfies Partial<Record<
  ModelingPickTarget,
  Partial<Record<ViewportPickGeometry, ModelingPickTarget>>
>>;

export function modelingPickTargetForGeometry(
  current: ModelingPickTarget | null,
  geometry: ViewportPickGeometry,
): ModelingPickTarget | null {
  if (current === null) return null;
  if (MODELING_PICK_SPECS[current].geometry.some((candidate) => candidate === geometry)) {
    return current;
  }
  const routes = (
    MODELING_PICK_CROSS_ROUTES[current as keyof typeof MODELING_PICK_CROSS_ROUTES]
  ) as Partial<Record<ViewportPickGeometry, ModelingPickTarget>> | undefined;
  const target = routes?.[geometry] ?? null;
  if (!target) return null;
  return MODELING_PICK_SPECS[target].geometry.some((candidate) => candidate === geometry)
    ? target
    : null;
}

export function activeModelingPickSpec(
  target: ModelingPickTarget,
): ViewportPickSpec {
  const base = MODELING_PICK_SPECS[target];
  const routes = (
    MODELING_PICK_CROSS_ROUTES[target as keyof typeof MODELING_PICK_CROSS_ROUTES]
  ) as Partial<Record<ViewportPickGeometry, ModelingPickTarget>> | undefined;
  const geometry: ViewportPickGeometry[] = [...base.geometry];
  for (const candidate of Object.keys(routes ?? {}) as ViewportPickGeometry[]) {
    if (!geometry.includes(candidate)) geometry.push(candidate);
  }
  return { ...base, geometry };
}

export const CONSTRUCTION_PLANE_PICK_SPECS = {
  first_reference: {
    geometry: ['reference-plane'],
    cardinality: 'single',
    prompt: 'Select the first planar face or reference plane (Esc to stop selecting)',
  },
  second_reference: {
    geometry: ['reference-plane'],
    cardinality: 'single',
    prompt: 'Select the second parallel face or plane (Esc to stop selecting)',
  },
  axis_edge: {
    geometry: ['straight-edge'],
    cardinality: 'single',
    prompt: 'Select a straight model edge for the plane axis (Esc to stop selecting)',
  },
} as const satisfies Record<Exclude<ConstructionPlanePickTarget, null>, ViewportPickSpec>;

export const CREATE_SKETCH_PICK_SPEC: ViewportPickSpec = {
  geometry: ['reference-plane'],
  cardinality: 'single',
  prompt: 'Select a planar face or visible reference plane for the sketch',
};

export type ActiveViewportPick =
  | {
      owner: 'create-sketch';
      target: 'support';
      spec: ViewportPickSpec;
    }
  | {
      owner: 'modeling';
      target: ModelingPickTarget;
      spec: ViewportPickSpec;
    }
  | {
      owner: 'construction-plane';
      target: Exclude<ConstructionPlanePickTarget, null>;
      spec: ViewportPickSpec;
    };

export function activeViewportPick(
  modelingTarget: ModelingPickTarget | null,
  constructionTarget: ConstructionPlanePickTarget,
  createSketch = false,
): ActiveViewportPick | null {
  if (createSketch) {
    return {
      owner: 'create-sketch',
      target: 'support',
      spec: CREATE_SKETCH_PICK_SPEC,
    };
  }
  if (constructionTarget !== null) {
    return {
      owner: 'construction-plane',
      target: constructionTarget,
      spec: CONSTRUCTION_PLANE_PICK_SPECS[constructionTarget],
    };
  }
  if (modelingTarget !== null) {
    return {
      owner: 'modeling',
      target: modelingTarget,
      spec: activeModelingPickSpec(modelingTarget),
    };
  }
  return null;
}

export function pickAccepts(
  pick: ActiveViewportPick | null,
  geometry: ViewportPickGeometry,
): boolean {
  return pick?.spec.geometry.some((candidate) => candidate === geometry) ?? false;
}

export type ModelingBodyPickMode =
  | 'body-multi'
  | 'body-single'
  | 'face-multi'
  | 'face-cylinder-single'
  | 'face-planar-single';

export function modelingBodyPickMode(
  target: ModelingPickTarget | null,
): ModelingBodyPickMode | null {
  if (target === null) return null;
  const componentTarget = modelingPickTargetForGeometry(target, 'component');
  if (componentTarget) return 'body-single';
  const bodyTarget = modelingPickTargetForGeometry(target, 'body');
  if (bodyTarget) {
    return MODELING_PICK_SPECS[bodyTarget].cardinality === 'single'
      ? 'body-single'
      : 'body-multi';
  }
  if (modelingPickTargetForGeometry(target, 'cylindrical-face')) {
    return 'face-cylinder-single';
  }
  if (modelingPickTargetForGeometry(target, 'planar-face')) {
    return target === 'extrude_source' ? null : 'face-planar-single';
  }
  if (modelingPickTargetForGeometry(target, 'face')) return 'face-multi';
  return null;
}

export type SharedEdgePickMode = 'refinable' | 'straight';

export function activeEdgePickMode(
  pick: ActiveViewportPick | null,
): SharedEdgePickMode | null {
  if (pickAccepts(pick, 'refinable-edge')) return 'refinable';
  if (pickAccepts(pick, 'straight-edge')) return 'straight';
  return null;
}

export type ProfilePickerOwner = 'extrude' | 'revolve' | 'sweep' | 'loft';

/** Unselected profiles retain an interior target even near their boundary so
 * small, disjoint regions can still be added while Revolve is asking for an
 * axis. When the axis role is active over an already-selected profile, its
 * boundary line gets the full shared line-picking envelope: clicking that fill
 * is redundant, and shrinking the line to a second 6 px band made hover depend
 * on approach side. Explicitly activating the profile role still gives the
 * profile interior priority for editing the selected profile set.
 */
export const UNSELECTED_PROFILE_LINE_PRIORITY_RADIUS_PX = 6;

export function linePickWinsOverProfile(
  lineDistancePx: number | null,
  profileUnderPointer: boolean,
  profileAlreadySelected: boolean,
  lineRoleActive: boolean,
): boolean {
  return lineDistancePx !== null && (
    !profileUnderPointer
    || (profileAlreadySelected && lineRoleActive)
    || lineDistancePx <= UNSELECTED_PROFILE_LINE_PRIORITY_RADIUS_PX
  );
}

export function profileTargetForOwner(owner: ProfilePickerOwner): ModelingPickTarget {
  switch (owner) {
    case 'extrude': return 'extrude_source';
    case 'revolve': return 'revolve_profile';
    case 'sweep': return 'sweep_profile';
    case 'loft': return 'loft_sections';
  }
}
