import type { ProfileRefDto } from '../engine/types';

export interface ProfileRegionHit {
  reference: ProfileRefDto;
  /** Distance to the actual sketch plane, never to a display-offset overlay. */
  distance: number;
  /** Area bounded by the outer loop, before subtracting its holes. */
  outerArea: number;
  featureId: number;
}

/** Resolve the same region for hover and click, without retained hover state.
 * Nearest planes win. At coincident depth the smaller bounded region wins, so
 * a face sketch remains selectable over its original, larger source sketch.
 * Identical regions prefer the later feature and then a stable profile ID. */
export function pickProfileRegion(hits: readonly ProfileRegionHit[]): ProfileRefDto | null {
  const valid = hits.filter((hit) =>
    Number.isFinite(hit.distance) && hit.distance >= 0
    && Number.isFinite(hit.outerArea) && Math.abs(hit.outerArea) > 0);
  if (valid.length === 0) return null;
  const nearest = Math.min(...valid.map((hit) => hit.distance));
  // Only absorb ray/plane floating-point noise. This is not a screen-space
  // picking margin and must not let a small region win through a nearer plane.
  const depthTolerance = Math.max(1e-7, nearest * Number.EPSILON * 64);
  const coincident = valid.filter((hit) => hit.distance <= nearest + depthTolerance);
  coincident.sort((a, b) =>
    Math.abs(a.outerArea) - Math.abs(b.outerArea)
    || b.featureId - a.featureId
    || a.reference.profile_index - b.reference.profile_index
    || a.reference.sketch_name.localeCompare(b.reference.sketch_name));
  return coincident[0].reference;
}
