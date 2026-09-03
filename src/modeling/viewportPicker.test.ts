import {
  CONSTRUCTION_PLANE_PICK_SPECS,
  MODELING_PICK_SPECS,
  MODELING_PICK_CROSS_ROUTES,
  MODELING_PICK_TARGETS,
  VIEWPORT_PICK_FEEDBACK_CHANNELS,
  VIEWPORT_PICK_GEOMETRIES,
  activeEdgePickMode,
  activeModelingPickSpec,
  activeViewportPick,
  modelingBodyPickMode,
  modelingPickTargetForGeometry,
  linePickWinsOverProfile,
  pickAccepts,
  profileTargetForOwner,
} from './viewportPicker';
import {
  collectViewportPickFeedback,
  finishedSketchEntityFeedback,
  type ViewportPickFeedbackSource,
} from './viewportPickFeedback';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  [${ok ? 'ok' : 'FAIL'}] ${name}${ok ? '' : ` — ${detail}`}`);
  if (!ok) failures += 1;
};

console.log('shared modeling viewport picker');

check(
  'every modeling role has one picker specification',
  MODELING_PICK_TARGETS.every((target) => Boolean(MODELING_PICK_SPECS[target])),
);
check(
  'every modeling role has a visible instruction',
  MODELING_PICK_TARGETS.every((target) => MODELING_PICK_SPECS[target].prompt.length > 0),
);
check(
  'every selectable geometry has shared hover and selection feedback',
  VIEWPORT_PICK_GEOMETRIES.every((geometry) =>
    Boolean(VIEWPORT_PICK_FEEDBACK_CHANNELS[geometry]),
  ),
);
check(
  'Revolve keeps profile and straight-line gestures available in either order',
  pickAccepts(activeViewportPick('revolve_profile', null), 'profile')
    && pickAccepts(activeViewportPick('revolve_profile', null), 'sketch-line')
    && pickAccepts(activeViewportPick('revolve_axis', null), 'sketch-line')
    && pickAccepts(activeViewportPick('revolve_axis', null), 'profile'),
);
check(
  'Revolve gives a selected profile boundary the full line envelope without hiding new profiles',
  linePickWinsOverProfile(0.1, true, false, true)
    && !linePickWinsOverProfile(16.6, true, false, true)
    && linePickWinsOverProfile(16.6, true, true, true)
    && !linePickWinsOverProfile(16.6, true, true, false)
    && linePickWinsOverProfile(16.6, false, false, true)
    && !linePickWinsOverProfile(null, true, true, true),
);
const crossRoutes = Object.entries(MODELING_PICK_CROSS_ROUTES).flatMap(
  ([source, routes]) => Object.entries(routes).map(([geometry, target]) => ({
    source: source as (typeof MODELING_PICK_TARGETS)[number],
    geometry: geometry as (typeof VIEWPORT_PICK_GEOMETRIES)[number],
    target: target as (typeof MODELING_PICK_TARGETS)[number],
  })),
);
check(
  'every bidirectional cross-field route resolves to a role that accepts the geometry',
  crossRoutes.every(({ source, geometry, target }) =>
    modelingPickTargetForGeometry(source, geometry) === target
    && MODELING_PICK_SPECS[target].geometry.includes(geometry as never)
    && activeModelingPickSpec(source).geometry.includes(geometry)),
);
check(
  'Sweep profile and path remain pickable in either order',
  modelingPickTargetForGeometry('sweep_profile', 'sketch-curve') === 'sweep_path'
    && modelingPickTargetForGeometry('sweep_path', 'profile') === 'sweep_profile',
);
check(
  'Loft sections and centerline remain pickable in either order',
  modelingPickTargetForGeometry('loft_sections', 'sketch-curve') === 'loft_centerline'
    && modelingPickTargetForGeometry('loft_centerline', 'profile') === 'loft_sections',
);
check(
  'Rib centerline and stop face remain pickable in either order',
  modelingPickTargetForGeometry('rib_centerline', 'planar-face') === 'rib_to_face'
    && modelingPickTargetForGeometry('rib_to_face', 'sketch-curve') === 'rib_centerline',
);
check(
  'pattern body and direction roles remain pickable in either order',
  modelingPickTargetForGeometry('rectangular_pattern_bodies', 'straight-edge')
      === 'rectangular_pattern_direction'
    && modelingPickTargetForGeometry('rectangular_pattern_direction', 'body')
      === 'rectangular_pattern_bodies'
    && modelingPickTargetForGeometry('circular_pattern_bodies', 'straight-edge')
      === 'circular_pattern_axis'
    && modelingPickTargetForGeometry('circular_pattern_axis', 'body')
      === 'circular_pattern_bodies',
);
check(
  'ambiguous same-geometry roles do not silently steal the active field',
  modelingPickTargetForGeometry('combine_target', 'body') === 'combine_target'
    && modelingPickTargetForGeometry('combine_tools', 'body') === 'combine_tools'
    && modelingPickTargetForGeometry('rectangular_pattern_second_direction', 'straight-edge')
      === 'rectangular_pattern_second_direction',
);
check(
  'Extrude source deliberately accepts profiles and planar faces',
  pickAccepts(activeViewportPick('extrude_source', null), 'profile')
    && pickAccepts(activeViewportPick('extrude_source', null), 'planar-face'),
);
check(
  'Hole support allows the shared point-plus-face gesture',
  pickAccepts(activeViewportPick('hole_support', null), 'hole-position')
    && pickAccepts(activeViewportPick('hole_support', null), 'planar-face'),
);
check(
  'body and face eligibility is derived from picker metadata',
  modelingBodyPickMode('combine_target') === 'body-single'
    && modelingBodyPickMode('combine_tools') === 'body-multi'
    && modelingBodyPickMode('external_thread_face') === 'face-cylinder-single'
    && modelingBodyPickMode('shell_faces') === 'face-multi',
);
check(
  'edge eligibility is shared by modeling and construction commands',
  activeEdgePickMode(activeViewportPick('fillet_edges', null)) === 'refinable'
    && activeEdgePickMode(activeViewportPick('move_axis', null)) === 'straight'
    && activeEdgePickMode(activeViewportPick(null, 'axis_edge')) === 'straight',
);
check(
  'construction reference roles use the same reference-plane capability',
  pickAccepts(activeViewportPick(null, 'first_reference'), 'reference-plane')
    && pickAccepts(activeViewportPick(null, 'second_reference'), 'reference-plane')
    && CONSTRUCTION_PLANE_PICK_SPECS.axis_edge.geometry[0] === 'straight-edge',
);
check(
  'Create Sketch uses the same reference-plane capability',
  activeViewportPick(null, null, true)?.owner === 'create-sketch'
    && pickAccepts(activeViewportPick(null, null, true), 'reference-plane'),
);
check(
  'profile-owner routing is centralized',
  profileTargetForOwner('extrude') === 'extrude_source'
    && profileTargetForOwner('revolve') === 'revolve_profile'
    && profileTargetForOwner('sweep') === 'sweep_profile'
    && profileTargetForOwner('loft') === 'loft_sections',
);

const feedbackSource = (
  target: Parameters<typeof activeViewportPick>[0],
): ViewportPickFeedbackSource => ({
  activePick: activeViewportPick(target, null),
  selectedBodyIds: [11],
  selectedFaceIds: [21],
  selectedEdgeIds: [31],
  selectedOccurrenceId: null,
  hoveredOccurrenceId: null,
  hoveredFaceId: 22,
  hoveredEdgeId: 32,
  bodyFaces: [{ bodyId: 11, faceIds: [21, 22] }],
  selectedProfiles: [{ sketch_name: 'Sketch1', profile_index: 0 }],
  hoveredProfile: { sketch_name: 'Sketch1', profile_index: 1 },
  selectedAxisLine: { sketchName: 'Sketch1', entityId: 41 },
  hoveredAxisLine: { sketchName: 'Sketch1', entityId: 42 },
  selectedCurves: [{ sketchName: 'Sketch1', entityId: 51 }],
  hoveredCurve: { sketchName: 'Sketch1', entityId: 52 },
  selectedSketchPoints: [{
    sketch_name: 'Sketch1',
    entity_id: 61,
    kind: 'end',
    world: { x: 1, y: 2, z: 3 },
  }],
  hoveredSketchPoint: {
    sketch_name: 'Sketch1',
    entity_id: 62,
    kind: 'start',
    world: { x: 4, y: 5, z: 6 },
  },
  modelingPlaneSelection: { type: 'origin_plane', plane: 'xz' },
  constructionPlaneSelection: null,
  hoveredOriginPlane: 'yz',
  hoveredDatumPlaneId: null,
  selectedSurfacePoint: { x: 1, y: 2, z: 3 },
  hoveredSurfacePoint: { x: 4, y: 5, z: 6 },
});

const lineFeedback = collectViewportPickFeedback(feedbackSource('revolve_axis'));
check(
  'finished sketch line hover and selection use stable sketch/entity identity',
  finishedSketchEntityFeedback(lineFeedback, 'Sketch1', 41) === 'selected'
    && finishedSketchEntityFeedback(lineFeedback, 'Sketch1', 42) === 'hovered'
    && finishedSketchEntityFeedback(lineFeedback, 'Sketch2', 41) === null,
);

const otherFieldFeedback = collectViewportPickFeedback(
  feedbackSource('revolve_profile'),
);
check(
  'accepted command selections stay highlighted while another field is active',
  finishedSketchEntityFeedback(otherFieldFeedback, 'Sketch1', 41) === 'selected'
    && finishedSketchEntityFeedback(otherFieldFeedback, 'Sketch1', 42) === 'hovered'
    && otherFieldFeedback.selectedSketchPoints[0]?.entity_id === 61
    && otherFieldFeedback.selectedReferencePlane?.type === 'origin_plane'
    && otherFieldFeedback.selectedSurfacePoint === null
    && otherFieldFeedback.hoveredSurfacePoint === null,
);

const curveFeedback = collectViewportPickFeedback(feedbackSource('sweep_path'));
check(
  'all path/rail tools share finished-curve feedback',
  finishedSketchEntityFeedback(curveFeedback, 'Sketch1', 51) === 'selected'
    && finishedSketchEntityFeedback(curveFeedback, 'Sketch1', 52) === 'hovered',
);

const bodyFeedback = collectViewportPickFeedback(feedbackSource('combine_target'));
check(
  'body hover is derived from shared capability metadata',
  bodyFeedback.hoveredBodyId === 11,
);

const referenceFeedback = collectViewportPickFeedback(feedbackSource('mirror_plane'));
check(
  'reference-plane feedback persists the selected plane after hover moves',
  referenceFeedback.selectedReferencePlane?.type === 'origin_plane'
    && referenceFeedback.selectedReferencePlane.plane === 'xz'
    && referenceFeedback.hoveredReferencePlane?.type === 'origin_plane'
    && referenceFeedback.hoveredReferencePlane.plane === 'yz',
);

const pointFeedback = collectViewportPickFeedback(feedbackSource('move_from'));
check(
  'surface-point pickers expose exact hover and selected markers',
  pointFeedback.selectedSurfacePoint?.x === 1
    && pointFeedback.hoveredSurfacePoint?.x === 4,
);

for (const target of [null, ...MODELING_PICK_TARGETS]) {
  const source = feedbackSource(target);
  const feedback = collectViewportPickFeedback(source);
  const isPointRole = target === 'move_from' || target === 'move_to' || target === 'move_pivot';
  check(
    `${target ?? 'ordinary selection'} only exposes surface-point markers for explicit point roles`,
    isPointRole
      ? feedback.selectedSurfacePoint === source.selectedSurfacePoint
        && feedback.hoveredSurfacePoint === source.hoveredSurfacePoint
      : feedback.selectedSurfacePoint === null && feedback.hoveredSurfacePoint === null,
  );
  check(
    `${target ?? 'ordinary selection'} preserves the face identity and its stored hit position`,
    feedback.selectedFaceIds[0] === 21 && source.selectedSurfacePoint?.x === 1,
  );
}

for (const activePick of [
  activeViewportPick(null, null, true),
  activeViewportPick(null, 'first_reference'),
  activeViewportPick(null, 'second_reference'),
  activeViewportPick(null, 'axis_edge'),
]) {
  const feedback = collectViewportPickFeedback({ ...feedbackSource(null), activePick });
  check(
    `${activePick?.owner}/${activePick?.target} does not display incidental face-hit points`,
    feedback.selectedSurfacePoint === null && feedback.hoveredSurfacePoint === null,
  );
}

const pointRoleTransition = feedbackSource('move_from');
pointRoleTransition.activePick = activeViewportPick('move_to', null);
check(
  'advancing from the start point to the destination retains point feedback',
  collectViewportPickFeedback(pointRoleTransition).selectedSurfacePoint?.x === 1,
);
pointRoleTransition.activePick = null;
check(
  'leaving point picking hides the dot without deleting the selected face or hit position',
  collectViewportPickFeedback(pointRoleTransition).selectedSurfacePoint === null
    && pointRoleTransition.selectedSurfacePoint?.x === 1
    && collectViewportPickFeedback(pointRoleTransition).selectedFaceIds[0] === 21,
);

const holeFeedback = collectViewportPickFeedback(feedbackSource('hole_positions'));
check(
  'hole-position pickers expose exact sketch-point feedback',
  holeFeedback.selectedSketchPoints[0]?.entity_id === 61
    && holeFeedback.hoveredSketchPoint?.entity_id === 62,
);

if (failures > 0) {
  console.error(`\nshared modeling viewport picker: ${failures} check(s) failed`);
  throw new Error(`${failures} shared picker check(s) failed`);
}
console.log('\nall passed');
