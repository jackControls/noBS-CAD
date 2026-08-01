import earcut from 'earcut';
import type { Vec2 } from '../../engine/types';

const POINT_EPSILON = 1e-9;

function samePoint(a: Vec2, b: Vec2): boolean {
  return Math.abs(a.x - b.x) <= POINT_EPSILON && Math.abs(a.y - b.y) <= POINT_EPSILON;
}

/**
 * Remove duplicate closing/consecutive vertices before passing a profile to
 * Earcut. Sketch tessellation can legitimately repeat curve junctions, while
 * the triangulator expects each loop vertex exactly once.
 */
function cleanLoop(points: readonly Vec2[]): Vec2[] {
  const cleaned: Vec2[] = [];
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    if (cleaned.length === 0 || !samePoint(cleaned[cleaned.length - 1], point)) {
      cleaned.push({ x: point.x, y: point.y });
    }
  }
  if (cleaned.length > 1 && samePoint(cleaned[0], cleaned[cleaned.length - 1])) {
    cleaned.pop();
  }
  return cleaned;
}

export interface TriangulatedProfileRegion {
  vertices: Vec2[];
  indices: number[];
  loops: Vec2[][];
}

/** Robust concave-profile triangulation with inner holes. */
export function triangulateProfileRegion(
  outer: readonly Vec2[],
  holes: ReadonlyArray<readonly Vec2[]> = [],
): TriangulatedProfileRegion | null {
  const loops = [cleanLoop(outer), ...holes.map(cleanLoop)].filter(
    (loop) => loop.length >= 3,
  );
  if (loops.length === 0 || loops[0].length < 3) return null;

  const vertices: Vec2[] = [];
  const holeIndices: number[] = [];
  const flat: number[] = [];
  for (let loopIndex = 0; loopIndex < loops.length; loopIndex += 1) {
    if (loopIndex > 0) holeIndices.push(vertices.length);
    for (const point of loops[loopIndex]) {
      vertices.push(point);
      flat.push(point.x, point.y);
    }
  }
  const indices = earcut(flat, holeIndices, 2);
  return indices.length >= 3 ? { vertices, indices, loops } : null;
}
