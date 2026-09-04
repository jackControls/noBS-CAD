import type {
  OriginPlane,
  PlaneRef,
  Point3Dto,
  ProfileRefDto,
  SketchPointRefDto,
} from '../engine/types';
import type { AppState } from '../store/appStore';
import type { ActiveViewportPick } from './viewportPicker';
import { activeViewportPick, pickAccepts } from './viewportPicker';

/** Stable identity for a curve in a finished sketch. Entity ids are only
 * unique inside their owning sketch, so both fields are required. */
export interface FinishedSketchEntityPickRef {
  sketchName: string;
  entityId: number;
}

export type FinishedSketchPointFeedback = SketchPointRefDto & {
  world: Point3Dto;
};

/** Minimal application state consumed by the shared feedback projector.
 * Dialogs continue to own their values; the viewport receives one normalized
 * visual contract instead of knowing which dialog stored each kind of pick. */
export interface ViewportPickFeedbackSource {
  activePick: ActiveViewportPick | null;
  selectedBodyIds: readonly number[];
  selectedFaceIds: readonly number[];
  selectedEdgeIds: readonly number[];
  selectedOccurrenceId: number | null;
  hoveredOccurrenceId: number | null;
  hoveredFaceId: number | null;
  hoveredEdgeId: number | null;
  bodyFaces: readonly { bodyId: number; faceIds: readonly number[] }[];
  selectedProfiles: readonly ProfileRefDto[];
  hoveredProfile: ProfileRefDto | null;
  selectedAxisLine: FinishedSketchEntityPickRef | null;
  hoveredAxisLine: FinishedSketchEntityPickRef | null;
  selectedCurves: readonly FinishedSketchEntityPickRef[];
  hoveredCurve: FinishedSketchEntityPickRef | null;
  selectedSketchPoints: readonly FinishedSketchPointFeedback[];
  hoveredSketchPoint: FinishedSketchPointFeedback | null;
  modelingPlaneSelection: PlaneRef | null;
  constructionPlaneSelection: PlaneRef | null;
  hoveredOriginPlane: OriginPlane | null;
  hoveredDatumPlaneId: number | null;
  selectedSurfacePoint: Point3Dto | null;
  hoveredSurfacePoint: Point3Dto | null;
}

/** Complete visual state for the active shared picker. Every renderer (Three,
 * native desktop, and tests) consumes this same projection. */
export interface ViewportPickFeedback {
  activePick: ActiveViewportPick | null;
  selectedBodyIds: number[];
  hoveredBodyId: number | null;
  selectedFaceIds: number[];
  hoveredFaceId: number | null;
  selectedEdgeIds: number[];
  hoveredEdgeId: number | null;
  selectedOccurrenceId: number | null;
  hoveredOccurrenceId: number | null;
  selectedProfiles: ProfileRefDto[];
  hoveredProfile: ProfileRefDto | null;
  selectedFinishedSketchEntities: FinishedSketchEntityPickRef[];
  hoveredFinishedSketchEntity: FinishedSketchEntityPickRef | null;
  selectedSketchPoints: FinishedSketchPointFeedback[];
  hoveredSketchPoint: FinishedSketchPointFeedback | null;
  selectedReferencePlane: PlaneRef | null;
  hoveredReferencePlane: PlaneRef | null;
  selectedSurfacePoint: Point3Dto | null;
  hoveredSurfacePoint: Point3Dto | null;
}

const sameFinishedEntity = (
  left: FinishedSketchEntityPickRef,
  right: FinishedSketchEntityPickRef,
) => left.sketchName === right.sketchName && left.entityId === right.entityId;

function uniqueFinishedEntities(
  refs: readonly FinishedSketchEntityPickRef[],
): FinishedSketchEntityPickRef[] {
  const result: FinishedSketchEntityPickRef[] = [];
  for (const ref of refs) {
    if (!result.some((candidate) => sameFinishedEntity(candidate, ref))) {
      result.push(ref);
    }
  }
  return result;
}

export function collectViewportPickFeedback(
  source: ViewportPickFeedbackSource,
): ViewportPickFeedback {
  const { activePick } = source;
  const acceptsBodies =
    pickAccepts(activePick, 'body') || pickAccepts(activePick, 'component');
  const acceptsFinishedLine = pickAccepts(activePick, 'sketch-line');
  const acceptsFinishedCurve = pickAccepts(activePick, 'sketch-curve');
  const acceptsSketchPoint = pickAccepts(activePick, 'hole-position');
  const acceptsReference = pickAccepts(activePick, 'reference-plane');
  const acceptsSurfacePoint = pickAccepts(activePick, 'surface-point');

  // Selection feedback belongs to the command, not only to its currently
  // active field. A dialog may advance from profile -> axis, or the user may
  // revisit an earlier field; every accepted value must remain visible while
  // the command is open. Hover remains gated by the active picker below.
  const selectedFinishedSketchEntities = uniqueFinishedEntities([
    ...(source.selectedAxisLine ? [source.selectedAxisLine] : []),
    ...source.selectedCurves,
  ]);
  const hoveredFinishedSketchEntity = acceptsFinishedLine
    ? source.hoveredAxisLine
    : acceptsFinishedCurve
      ? source.hoveredCurve
      : null;
  const selectedReferencePlane = source.constructionPlaneSelection
    ?? source.modelingPlaneSelection;
  const hoveredReferencePlane: PlaneRef | null = acceptsReference
    ? source.hoveredOriginPlane
      ? { type: 'origin_plane', plane: source.hoveredOriginPlane }
      : source.hoveredDatumPlaneId !== null
        ? { type: 'datum_plane', datum_id: source.hoveredDatumPlaneId }
        : null
    : null;
  const hoveredBodyId = acceptsBodies && source.hoveredFaceId !== null
    ? source.bodyFaces.find((body) => body.faceIds.includes(source.hoveredFaceId!))
      ?.bodyId ?? null
    : null;

  return {
    activePick,
    // Ordinary selection still uses the same render channels when no command
    // is active, so the normalized contract always carries these identities.
    selectedBodyIds: [...source.selectedBodyIds],
    hoveredBodyId,
    selectedFaceIds: [...source.selectedFaceIds],
    hoveredFaceId: source.hoveredFaceId,
    selectedEdgeIds: [...source.selectedEdgeIds],
    hoveredEdgeId: source.hoveredEdgeId,
    selectedOccurrenceId: source.selectedOccurrenceId,
    hoveredOccurrenceId: source.hoveredOccurrenceId,
    selectedProfiles: [...source.selectedProfiles],
    hoveredProfile: source.hoveredProfile,
    selectedFinishedSketchEntities,
    hoveredFinishedSketchEntity,
    selectedSketchPoints: [...source.selectedSketchPoints],
    hoveredSketchPoint: acceptsSketchPoint ? source.hoveredSketchPoint : null,
    selectedReferencePlane,
    hoveredReferencePlane,
    // This is the raw face-hit position, also recorded by ordinary face
    // selection. It is not an independently accepted command point. Only
    // explicit point roles should turn it into a visible marker; otherwise
    // every selected face grows an unrelated dot (including after Cancel).
    selectedSurfacePoint: acceptsSurfacePoint ? source.selectedSurfacePoint : null,
    hoveredSurfacePoint: acceptsSurfacePoint ? source.hoveredSurfacePoint : null,
  };
}

/** Canonical application-state adapter. Keeping this here prevents the WebGL
 * and native renderers from independently deciding which dialog state means
 * "selected" or "hovered" for a given picker capability. */
export function collectAppViewportPickFeedback(
  state: AppState,
): ViewportPickFeedback {
  return collectViewportPickFeedback({
    activePick: activeViewportPick(
      state.modelingPickTarget,
      state.constructionPlanePickTarget,
      state.mode === 'pickPlane',
    ),
    selectedBodyIds: state.selectedBodies,
    selectedFaceIds: state.selectedFaces,
    selectedEdgeIds: state.selectedEdges,
    selectedOccurrenceId: state.selectedOccurrenceId,
    hoveredOccurrenceId: state.hoveredOccurrenceId,
    hoveredFaceId: state.hoveredFace,
    hoveredEdgeId: state.hoveredEdge,
    bodyFaces: state.solidScene.bodies.map((body) => ({
      bodyId: body.id,
      faceIds: body.faces.map((face) => face.id),
    })),
    selectedProfiles: state.profilePicker?.selected ?? [],
    hoveredProfile: state.profilePicker?.hovered ?? null,
    selectedAxisLine: state.revolveAxisSelection,
    hoveredAxisLine: state.revolveAxisHover,
    selectedCurves: state.curvePicker
      ? Object.values(state.curvePicker.selectionsByOwner).flatMap(
          (selected) => selected ?? [],
        )
      : [],
    hoveredCurve: state.curvePicker?.hovered ?? null,
    selectedSketchPoints: state.holePositionSelections,
    hoveredSketchPoint: state.holePositionHover,
    modelingPlaneSelection: state.modelingPlaneSelection,
    constructionPlaneSelection: state.constructionPlanePickedReference,
    hoveredOriginPlane: state.hoveredPlane,
    hoveredDatumPlaneId: state.hoveredDatumPlane,
    selectedSurfacePoint: state.selectedFacePoint,
    hoveredSurfacePoint: state.modelingPointHover,
  });
}

export function finishedSketchEntityFeedback(
  feedback: ViewportPickFeedback,
  sketchName: string,
  entityId: number,
): 'selected' | 'hovered' | null {
  const ref = { sketchName, entityId };
  if (
    feedback.selectedFinishedSketchEntities.some((candidate) =>
      sameFinishedEntity(candidate, ref),
    )
  ) return 'selected';
  if (
    feedback.hoveredFinishedSketchEntity
    && sameFinishedEntity(feedback.hoveredFinishedSketchEntity, ref)
  ) return 'hovered';
  return null;
}
