/** Homogeneous clip-space point before perspective division. */
export interface ClipPoint {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface ScreenViewport {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ClipPolylineCandidate<Value> {
  key: string;
  value: Value;
  /** Separate polylines allow one entity to contain disconnected runs. */
  polylines: ClipPoint[][];
}

export interface ScreenPickerOptions {
  /** Forgiving screen-space radius used for every independent pointer sample. */
  enterRadiusPx?: number;
}

export interface ScreenPick<Value> {
  key: string;
  value: Value;
  distancePx: number;
  /** Closest visible source segment and its linear ratio in source space. */
  segment: {
    polylineIndex: number;
    segmentIndex: number;
    ratio: number;
  };
}

export const FINISHED_ENTITY_ENTER_RADIUS_PX = 17;

const CLIP_EPSILON = 1e-7;

const interpolate = (start: ClipPoint, end: ClipPoint, ratio: number): ClipPoint => ({
  x: start.x + (end.x - start.x) * ratio,
  y: start.y + (end.y - start.y) * ratio,
  z: start.z + (end.z - start.z) * ratio,
  w: start.w + (end.w - start.w) * ratio,
});

/**
 * Clip a segment against the full perspective frustum in homogeneous space.
 *
 * Doing this before dividing by W is important: rejecting an entity because
 * one endpoint is behind the near plane makes a visibly clipped line become
 * impossible to select at particular orbit angles.
 */
function clipSegmentToFrustumWithRange(
  start: ClipPoint,
  end: ClipPoint,
): {
  start: ClipPoint;
  end: ClipPoint;
  startRatio: number;
  endRatio: number;
} | null {
  const planeValues = (point: ClipPoint) => [
    point.x + point.w,
    point.w - point.x,
    point.y + point.w,
    point.w - point.y,
    point.z + point.w,
    point.w - point.z,
    point.w - CLIP_EPSILON,
  ];
  const startValues = planeValues(start);
  const endValues = planeValues(end);
  let first = 0;
  let last = 1;

  for (let index = 0; index < startValues.length; index += 1) {
    const atStart = startValues[index];
    const atEnd = endValues[index];
    if (atStart < 0 && atEnd < 0) return null;
    if (atStart >= 0 && atEnd >= 0) continue;
    const crossing = atStart / (atStart - atEnd);
    if (atStart < 0) first = Math.max(first, crossing);
    else last = Math.min(last, crossing);
    if (first > last) return null;
  }

  return {
    start: interpolate(start, end, first),
    end: interpolate(start, end, last),
    startRatio: first,
    endRatio: last,
  };
}

export function clipSegmentToFrustum(
  start: ClipPoint,
  end: ClipPoint,
): [ClipPoint, ClipPoint] | null {
  const clipped = clipSegmentToFrustumWithRange(start, end);
  return clipped ? [clipped.start, clipped.end] : null;
}

function toScreen(point: ClipPoint, viewport: ScreenViewport): ScreenPoint | null {
  if (!Number.isFinite(point.w) || Math.abs(point.w) < CLIP_EPSILON) return null;
  const x = point.x / point.w;
  const y = point.y / point.w;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    x: viewport.left + ((x + 1) * viewport.width) / 2,
    y: viewport.top + ((1 - y) * viewport.height) / 2,
  };
}

export function distanceToScreenSegment(
  point: ScreenPoint,
  start: ScreenPoint,
  end: ScreenPoint,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const ratio = lengthSquared <= Number.EPSILON
    ? 0
    : Math.max(
        0,
        Math.min(
          1,
          ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared,
        ),
      );
  return Math.hypot(
    point.x - (start.x + ratio * dx),
    point.y - (start.y + ratio * dy),
  );
}

function closestRatioOnScreenSegment(
  point: ScreenPoint,
  start: ScreenPoint,
  end: ScreenPoint,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  return lengthSquared <= Number.EPSILON
    ? 0
    : Math.max(
        0,
        Math.min(
          1,
          ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared,
        ),
      );
}

function distanceToCandidate<Value>(
  candidate: ClipPolylineCandidate<Value>,
  pointer: ScreenPoint,
  viewport: ScreenViewport,
): { distancePx: number; segment: ScreenPick<Value>['segment'] } | null {
  let nearest: { distancePx: number; segment: ScreenPick<Value>['segment'] } | null = null;
  for (let polylineIndex = 0; polylineIndex < candidate.polylines.length; polylineIndex += 1) {
    const polyline = candidate.polylines[polylineIndex];
    for (let index = 1; index < polyline.length; index += 1) {
      const clipped = clipSegmentToFrustumWithRange(polyline[index - 1], polyline[index]);
      if (!clipped) continue;
      const start = toScreen(clipped.start, viewport);
      const end = toScreen(clipped.end, viewport);
      if (!start || !end) continue;
      const screenRatio = closestRatioOnScreenSegment(pointer, start, end);
      const distancePx = distanceToScreenSegment(pointer, start, end);
      if (nearest && distancePx >= nearest.distancePx) continue;
      // Perspective projection preserves the screen line but not its affine
      // parameter. Convert the 2D ratio back through endpoint W values before
      // mapping from the clipped run to the source segment.
      const denominator = screenRatio * clipped.start.w
        + (1 - screenRatio) * clipped.end.w;
      const clippedRatio = Math.abs(denominator) <= CLIP_EPSILON
        ? screenRatio
        : (screenRatio * clipped.start.w) / denominator;
      nearest = {
        distancePx,
        segment: {
          polylineIndex,
          segmentIndex: index - 1,
          ratio: clipped.startRatio
            + (clipped.endRatio - clipped.startRatio) * clippedRatio,
        },
      };
    }
  }
  return nearest;
}

/**
 * Pick the nearest visible polyline with a forgiving hover envelope.
 *
 * Each pointer sample is intentionally stateless. Retaining the prior entity
 * here made hover depend on the route used to approach an edge: after moving
 * through an invalid region, a nearby stale entity could win over the line
 * actually under the cursor until some third line displaced it. The broad
 * acquire radius already absorbs normal hand jitter without that retained
 * identity.
 */
export function pickClipPolylineCandidate<Value>(
  candidates: readonly ClipPolylineCandidate<Value>[],
  pointer: ScreenPoint,
  viewport: ScreenViewport,
  options: ScreenPickerOptions = {},
): ScreenPick<Value> | null {
  const enterRadius = options.enterRadiusPx ?? FINISHED_ENTITY_ENTER_RADIUS_PX;
  const measured = candidates
    .map((candidate) => {
      const measurement = distanceToCandidate(candidate, pointer, viewport);
      return measurement
        ? { key: candidate.key, value: candidate.value, ...measurement }
        : null;
    })
    .filter((candidate): candidate is ScreenPick<Value> => candidate !== null)
    .sort((left, right) => left.distancePx - right.distancePx);
  const nearest = measured[0] ?? null;
  const picked = nearest && nearest.distancePx <= enterRadius ? nearest : null;
  return picked;
}
