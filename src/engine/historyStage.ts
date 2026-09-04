/**
 * Presentation helpers for the evaluated history stage.
 *
 * The engine retains sketch and datum definitions so an inactive feature can
 * be edited or replayed later. The viewport, however, must only render inputs
 * whose history features occur before the current rollback marker.
 */
import type { DatumPlaneDefinitionDto, SketchDto } from './types';
import type { DocumentDto } from '../types/document';

function activeFeatureIds(document: DocumentDto): Set<number> {
  return new Set(
    document.features
      .slice(0, document.rollback_index)
      .filter((feature) => !feature.suppressed)
      .map((feature) => feature.id),
  );
}

/** Keep only finished sketches which belong to the active history prefix. */
export function stageFinishedSketches(
  document: DocumentDto,
  sketches: SketchDto[],
): SketchDto[] {
  const active = activeFeatureIds(document);
  const featureIdByName = new Map(
    document.features
      .filter((feature) => feature.kind === 'sketch')
      .map((feature) => [feature.name, feature.id]),
  );
  return sketches.filter((sketch) => {
    const featureId = featureIdByName.get(sketch.name);
    return featureId !== undefined && active.has(featureId);
  });
}

/** Keep only datum planes whose construction feature is active. */
export function stageDatumPlanes(
  document: DocumentDto,
  planes: DatumPlaneDefinitionDto[],
): DatumPlaneDefinitionDto[] {
  const active = activeFeatureIds(document);
  return planes.filter((plane) => active.has(plane.feature_id));
}
