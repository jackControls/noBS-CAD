import type { ConstraintDto, EntityDto, Vec2 } from '../engine/types';
import { constraintReferencedEntityIds } from './constraintRefs';

/**
 * Geometric constraints whose meaning lives at one sketch point (contact,
 * shared endpoint, intersection, shared center). Glyphs for these use a
 * dedicated placement path instead of averaging entity midpoints.
 */
export const SINGLE_POINT_RELATION_TYPES = new Set([
  'coincident',
  'tangent',
  'perpendicular',
  'concentric',
]);

export const SINGLE_POINT_RELATION_GLYPH: Record<string, string> = {
  coincident: 'o',
  tangent: 'Tg',
  perpendicular: 'T',
  concentric: 'O',
};

function mid(a: Vec2, b: Vec2): Vec2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function circular(entity: EntityDto): { center: Vec2; radius: number } | null {
  if (entity.kind === 'circle' || entity.kind === 'arc') {
    return { center: entity.center, radius: entity.radius };
  }
  return null;
}

/** Project `p` onto the infinite line through `a`–`b`. */
function projectToInfiniteLine(p: Vec2, a: Vec2, b: Vec2): Vec2 | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-18) return null;
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  return { x: a.x + t * dx, y: a.y + t * dy };
}

/** Intersection of infinite lines a0–a1 and b0–b1, or null if parallel. */
function lineLineIntersection(
  a0: Vec2,
  a1: Vec2,
  b0: Vec2,
  b1: Vec2,
): Vec2 | null {
  const ax = a1.x - a0.x;
  const ay = a1.y - a0.y;
  const bx = b1.x - b0.x;
  const by = b1.y - b0.y;
  const den = ax * by - ay * bx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((b0.x - a0.x) * by - (b0.y - a0.y) * bx) / den;
  return { x: a0.x + t * ax, y: a0.y + t * ay };
}

function coincidentRelationPoint(
  a: EntityDto,
  b: EntityDto,
): Vec2 | null {
  if (a.kind === 'point') return a.position;
  if (b.kind === 'point') return b.position;
  const ca = circular(a);
  const cb = circular(b);
  if (ca && cb) return mid(ca.center, cb.center);
  return null;
}

function tangentRelationPoint(a: EntityDto, b: EntityDto): Vec2 | null {
  const line = a.kind === 'line' ? a : b.kind === 'line' ? b : null;
  const curve = circular(a) ?? circular(b);
  if (line && curve) {
    return projectToInfiniteLine(curve.center, line.start, line.end);
  }
  const ca = circular(a);
  const cb = circular(b);
  if (!ca || !cb) return null;
  const dx = cb.center.x - ca.center.x;
  const dy = cb.center.y - ca.center.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-12) return ca.center;
  // Point on the first circle toward the second — coincides with the
  // solved contact for both external and typical internal tangencies.
  const scale = Math.abs(ca.radius) / dist;
  return {
    x: ca.center.x + dx * scale,
    y: ca.center.y + dy * scale,
  };
}

function perpendicularRelationPoint(
  a: EntityDto,
  b: EntityDto,
): Vec2 | null {
  if (a.kind !== 'line' || b.kind !== 'line') return null;
  return lineLineIntersection(a.start, a.end, b.start, b.end);
}

function concentricRelationPoint(
  a: EntityDto,
  b: EntityDto,
): Vec2 | null {
  const ca = circular(a);
  const cb = circular(b);
  if (!ca || !cb) return null;
  return mid(ca.center, cb.center);
}

/**
 * Sketch-plane position where a single-point relation badge should sit.
 * Returns null when the constraint is not in this class or geometry cannot
 * resolve a relation point (caller should fall back to averaged anchors).
 */
export function singlePointRelationAnchor(
  constraint: ConstraintDto,
  byId: Map<number, EntityDto>,
): Vec2 | null {
  if (!SINGLE_POINT_RELATION_TYPES.has(constraint.type)) return null;
  const ids = constraintReferencedEntityIds(constraint);
  if (ids.length < 2) return null;
  const a = byId.get(ids[0]);
  const b = byId.get(ids[1]);
  if (!a || !b) return null;
  switch (constraint.type) {
    case 'coincident':
      return coincidentRelationPoint(a, b);
    case 'tangent':
      return tangentRelationPoint(a, b);
    case 'perpendicular':
      return perpendicularRelationPoint(a, b);
    case 'concentric':
      return concentricRelationPoint(a, b);
    default:
      return null;
  }
}
