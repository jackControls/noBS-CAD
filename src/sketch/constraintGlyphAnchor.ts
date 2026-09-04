/**
 * Constraint glyph anchors and post-solve UI placement.
 *
 * Geometric constraint badges (H/V, coincident, tangent, …) are **not**
 * solver variables. After the sketch solves, the viewport:
 *
 * 1. Resolves one shared relation **anchor** (contact / shared point /
 *    midpoint / …), or one anchor on each spatially separate participant.
 * 2. Offsets the badge with {@link offsetGlyphFromAnchor} by a screen-pixel
 *    nudge (`gripHalf + glyphHalf + gap`) so the chip does not cover grips.
 * 3. Hit-tests badges only in sketch **Select** (`activeTool === null`).
 *
 * Pick priority (implemented in `Viewport.tsx` as `pickConstraintOrEntity`):
 * geometry under the pointer wins over a nearby badge. Clicking a point
 * selects the point; clicking empty space on the chip selects the constraint.
 * Badge hit size tracks the visible sprite (`px`), not a large label box.
 */

import type {
  ConstraintDto,
  EntityDto,
  GeometricConstraintType,
  Vec2,
} from '../engine/types';
import { constraintReferencedEntityIds } from './constraintRefs';

/**
 * Visible existence marker for every geometric relation emitted by Rust.
 * Keeping this exhaustive `Record` makes a missing glyph a TypeScript error
 * when the IPC constraint union changes, instead of a silent viewport fallthrough.
 */
export const CONSTRAINT_EXISTENCE_GLYPH: Readonly<
  Record<GeometricConstraintType, string>
> = Object.freeze({
  horizontal: 'H',
  vertical: 'V',
  horizontal_points: 'H',
  vertical_points: 'V',
  coincident: '●',
  origin_coincident: '●',
  center_coincident: '●',
  tangent: 'Tg',
  equal: '=',
  parallel: '∥',
  perpendicular: '⊥',
  fix: 'Fix',
  midpoint: '△',
  reference_midpoint: '△',
  span_midpoint: '△',
  concentric: '◎',
  collinear: 'Col',
  symmetry: 'Sym',
  arc_endpoint_coincident: '●',
  equal_distance: '=',
});

/**
 * Geometric constraints whose meaning lives at one sketch point (contact,
 * shared endpoint, intersection, shared center). Glyphs for these use a
 * dedicated placement path instead of averaging entity midpoints.
 */
export const SINGLE_POINT_RELATION_TYPES = new Set([
  'coincident',
  'origin_coincident',
  'center_coincident',
  'tangent',
  'perpendicular',
  'concentric',
  'reference_midpoint',
  'span_midpoint',
  'arc_endpoint_coincident',
]);

export const SINGLE_POINT_RELATION_GLYPH: Record<string, string> = {
  coincident: CONSTRAINT_EXISTENCE_GLYPH.coincident,
  origin_coincident: CONSTRAINT_EXISTENCE_GLYPH.origin_coincident,
  center_coincident: CONSTRAINT_EXISTENCE_GLYPH.center_coincident,
  tangent: CONSTRAINT_EXISTENCE_GLYPH.tangent,
  perpendicular: CONSTRAINT_EXISTENCE_GLYPH.perpendicular,
  concentric: CONSTRAINT_EXISTENCE_GLYPH.concentric,
  reference_midpoint: CONSTRAINT_EXISTENCE_GLYPH.reference_midpoint,
  span_midpoint: CONSTRAINT_EXISTENCE_GLYPH.span_midpoint,
  arc_endpoint_coincident: CONSTRAINT_EXISTENCE_GLYPH.arc_endpoint_coincident,
};

export const MULTI_ENTITY_RELATION_GLYPH: Readonly<Partial<
  Record<GeometricConstraintType, string>
>> = Object.freeze({
  parallel: CONSTRAINT_EXISTENCE_GLYPH.parallel,
  equal: CONSTRAINT_EXISTENCE_GLYPH.equal,
  collinear: CONSTRAINT_EXISTENCE_GLYPH.collinear,
  symmetry: CONSTRAINT_EXISTENCE_GLYPH.symmetry,
  equal_distance: CONSTRAINT_EXISTENCE_GLYPH.equal_distance,
});

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
  const r1 = Math.abs(ca.radius);
  const r2 = Math.abs(cb.radius);
  const sum = r1 + r2;
  const diff = Math.abs(r1 - r2);
  // Classify by which ideal distance the current pose is closer to so
  // internal and external contacts stay order-independent.
  const internal = Math.abs(dist - diff) <= Math.abs(dist - sum);
  const denom = internal ? r1 - r2 : sum;
  if (Math.abs(denom) < 1e-12) {
    return {
      x: ca.center.x + (dx / dist) * r1,
      y: ca.center.y + (dy / dist) * r1,
    };
  }
  const t = r1 / denom;
  return {
    x: ca.center.x + dx * t,
    y: ca.center.y + dy * t,
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
  if (constraint.type === 'origin_coincident') {
    const entity = constraint.entity == null ? null : byId.get(constraint.entity);
    if (entity?.kind === 'point') return entity.position;
    if (entity?.kind === 'circle' || entity?.kind === 'arc') return entity.center;
    return { x: 0, y: 0 };
  }
  if (constraint.type === 'center_coincident') {
    const point = constraint.point == null ? null : byId.get(constraint.point);
    if (point?.kind === 'point') return point.position;
    const curve = constraint.curve == null ? null : byId.get(constraint.curve);
    if (curve?.kind === 'circle' || curve?.kind === 'arc') return curve.center;
    return null;
  }
  if (
    constraint.type === 'reference_midpoint'
    || constraint.type === 'span_midpoint'
    || constraint.type === 'arc_endpoint_coincident'
  ) {
    const point = constraint.point == null ? null : byId.get(constraint.point);
    if (point?.kind === 'point') return point.position;
    if (constraint.type === 'reference_midpoint') return constraint.position ?? null;
    if (constraint.type === 'arc_endpoint_coincident' && constraint.arc != null) {
      const arc = byId.get(constraint.arc);
      if (arc?.kind === 'arc') {
        const angle = constraint.end === 'end' ? arc.end_angle : arc.start_angle;
        return {
          x: arc.center.x + Math.cos(angle) * arc.radius,
          y: arc.center.y + Math.sin(angle) * arc.radius,
        };
      }
    }
    return null;
  }
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

export interface DistributedRelationGlyphTarget {
  /** Feature receiving this copy of the relation mark. */
  entityId: number;
  /** Point on the visible feature from which the mark is offset. */
  anchor: Vec2;
  /** Direction away from the feature / relation group. */
  preferredDir: Vec2 | null;
}

export interface RightAngleGlyphFrame {
  /** Visible intersection of the two finite line segments. */
  vertex: Vec2;
  /** Unit directions from the vertex into the chosen visible quadrant. */
  directionA: Vec2;
  directionB: Vec2;
  /** Maximum available length on either constrained segment. */
  maxSize: number;
}

function entityVisualCenter(entity: EntityDto): Vec2 {
  switch (entity.kind) {
    case 'point':
      return entity.position;
    case 'line':
      return mid(entity.start, entity.end);
    case 'circle':
    case 'arc':
      return entity.center;
    case 'spline': {
      const points = entity.tessellation.length > 0
        ? entity.tessellation
        : entity.points;
      return points[Math.floor(points.length / 2)] ?? { x: 0, y: 0 };
    }
  }
}

function positiveSweep(start: number, end: number): number {
  let sweep = end - start;
  while (sweep <= 0) sweep += Math.PI * 2;
  while (sweep > Math.PI * 2) sweep -= Math.PI * 2;
  return sweep;
}

function pointOnSegment(point: Vec2, start: Vec2, end: Vec2): boolean {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq < 1e-18) return nearPoint(point, start);
  const t = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq;
  if (t < -1e-6 || t > 1 + 1e-6) return false;
  const projection = { x: start.x + t * dx, y: start.y + t * dy };
  return nearPoint(point, projection, Math.sqrt(lengthSq));
}

function nearPoint(a: Vec2, b: Vec2, scale = 1): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= 1e-6 * Math.max(1, scale);
}

/** Whether a solved relation point is actually on the visible, finite feature. */
function entityContainsVisiblePoint(entity: EntityDto, point: Vec2): boolean {
  switch (entity.kind) {
    case 'point':
      return nearPoint(entity.position, point);
    case 'line':
      return pointOnSegment(point, entity.start, entity.end);
    case 'circle':
      return Math.abs(
        Math.hypot(point.x - entity.center.x, point.y - entity.center.y)
          - Math.abs(entity.radius),
      ) <= 1e-6 * Math.max(1, Math.abs(entity.radius));
    case 'arc': {
      const radius = Math.abs(entity.radius);
      const radialError = Math.abs(
        Math.hypot(point.x - entity.center.x, point.y - entity.center.y) - radius,
      );
      if (radialError > 1e-6 * Math.max(1, radius)) return false;
      const angle = Math.atan2(point.y - entity.center.y, point.x - entity.center.x);
      const sweep = positiveSweep(entity.start_angle, entity.end_angle);
      const relative = positiveSweep(entity.start_angle, angle);
      return relative <= sweep + 1e-6 || nearPoint(point, {
        x: entity.center.x + Math.cos(entity.start_angle) * entity.radius,
        y: entity.center.y + Math.sin(entity.start_angle) * entity.radius,
      }, radius);
    }
    case 'spline': {
      const points = entity.tessellation.length > 1
        ? entity.tessellation
        : entity.points;
      return points.some((candidate, index) =>
        index > 0 && pointOnSegment(point, points[index - 1], candidate));
    }
  }
}

function visibleLineDirection(
  line: Extract<EntityDto, { kind: 'line' }>,
  vertex: Vec2,
): { direction: Vec2; available: number } | null {
  const toStart = { x: line.start.x - vertex.x, y: line.start.y - vertex.y };
  const toEnd = { x: line.end.x - vertex.x, y: line.end.y - vertex.y };
  const startDistance = Math.hypot(toStart.x, toStart.y);
  const endDistance = Math.hypot(toEnd.x, toEnd.y);
  const vector = endDistance >= startDistance ? toEnd : toStart;
  const available = Math.max(startDistance, endDistance);
  if (available < 1e-9) return null;
  return {
    direction: { x: vector.x / available, y: vector.y / available },
    available,
  };
}

/**
 * Geometry-aligned frame for the standard mathematical right-angle square.
 * Disjoint finite segments return null and use repeated perpendicular icons
 * on their individual features instead.
 */
export function rightAngleGlyphFrame(
  constraint: ConstraintDto,
  byId: Map<number, EntityDto>,
): RightAngleGlyphFrame | null {
  if (
    constraint.type !== 'perpendicular'
    || constraint.a == null
    || constraint.b == null
  ) {
    return null;
  }
  const a = byId.get(constraint.a);
  const b = byId.get(constraint.b);
  if (a?.kind !== 'line' || b?.kind !== 'line') return null;
  const vertex = perpendicularRelationPoint(a, b);
  if (
    !vertex
    || !entityContainsVisiblePoint(a, vertex)
    || !entityContainsVisiblePoint(b, vertex)
  ) {
    return null;
  }
  const alongA = visibleLineDirection(a, vertex);
  const alongB = visibleLineDirection(b, vertex);
  if (!alongA || !alongB) return null;
  return {
    vertex,
    directionA: alongA.direction,
    directionB: alongB.direction,
    maxSize: Math.min(alongA.available, alongB.available),
  };
}

function relationParticipantIds(constraint: ConstraintDto): number[] {
  switch (constraint.type) {
    case 'parallel':
    case 'equal':
    case 'collinear':
    case 'perpendicular':
    case 'tangent':
      return constraint.a == null || constraint.b == null
        ? []
        : [constraint.a, constraint.b];
    case 'symmetry':
    case 'equal_distance':
      // The axis/origin is a datum for the relation. The repeated marks belong
      // to the two peer features whose relationship it describes.
      return constraint.a == null || constraint.b == null
        ? []
        : [constraint.a, constraint.b];
    default:
      return [];
  }
}

function featureGlyphTarget(
  entity: EntityDto,
  groupCenter: Vec2,
  index: number,
  count: number,
): DistributedRelationGlyphTarget {
  const center = entityVisualCenter(entity);
  const fallbackAngle = -Math.PI / 2 + (Math.PI * 2 * index) / Math.max(count, 1);
  const fallback = { x: Math.cos(fallbackAngle), y: Math.sin(fallbackAngle) };
  const away = normalize({
    x: center.x - groupCenter.x,
    y: center.y - groupCenter.y,
  }) ?? fallback;

  switch (entity.kind) {
    case 'line': {
      const dx = entity.end.x - entity.start.x;
      const dy = entity.end.y - entity.start.y;
      let normal = normalize({ x: -dy, y: dx }) ?? fallback;
      if (normal.x * away.x + normal.y * away.y < 0) {
        normal = { x: -normal.x, y: -normal.y };
      } else if (Math.abs(normal.x * away.x + normal.y * away.y) < 1e-9 && index % 2 === 1) {
        normal = { x: -normal.x, y: -normal.y };
      }
      return { entityId: entity.id, anchor: center, preferredDir: normal };
    }
    case 'circle': {
      const radius = Math.abs(entity.radius);
      return {
        entityId: entity.id,
        anchor: {
          x: entity.center.x + away.x * radius,
          y: entity.center.y + away.y * radius,
        },
        preferredDir: away,
      };
    }
    case 'arc': {
      const angle = entity.start_angle
        + positiveSweep(entity.start_angle, entity.end_angle) * 0.5;
      const radial = { x: Math.cos(angle), y: Math.sin(angle) };
      return {
        entityId: entity.id,
        anchor: {
          x: entity.center.x + radial.x * entity.radius,
          y: entity.center.y + radial.y * entity.radius,
        },
        preferredDir: radial,
      };
    }
    case 'spline': {
      const points = entity.tessellation.length > 1
        ? entity.tessellation
        : entity.points;
      const middle = Math.floor(points.length / 2);
      const before = points[Math.max(0, middle - 1)] ?? center;
      const after = points[Math.min(points.length - 1, middle + 1)] ?? center;
      let normal = normalize({ x: -(after.y - before.y), y: after.x - before.x }) ?? away;
      if (normal.x * away.x + normal.y * away.y < 0) {
        normal = { x: -normal.x, y: -normal.y };
      }
      return { entityId: entity.id, anchor: center, preferredDir: normal };
    }
    case 'point':
      return { entityId: entity.id, anchor: center, preferredDir: away };
  }
}

/**
 * Return one glyph target per spatially separate peer feature.
 *
 * Parallel, Equal, Collinear, Symmetry and Equal Distance always repeat their
 * semantic mark on the peer features. Perpendicular and Tangent keep one mark
 * at a visible shared intersection/contact, but repeat it when their finite
 * features are disjoint even though their mathematical carriers still meet.
 */
export function distributedRelationGlyphTargets(
  constraint: ConstraintDto,
  byId: Map<number, EntityDto>,
): DistributedRelationGlyphTarget[] {
  const ids = [...new Set(relationParticipantIds(constraint))];
  const entities = ids
    .map((id) => byId.get(id))
    .filter((entity): entity is EntityDto => entity != null);
  if (entities.length < 2) return [];

  if (constraint.type === 'perpendicular' || constraint.type === 'tangent') {
    const shared = singlePointRelationAnchor(constraint, byId);
    if (shared && entities.every((entity) => entityContainsVisiblePoint(entity, shared))) {
      return [];
    }
  }

  const centers = entities.map(entityVisualCenter);
  const groupCenter = {
    x: centers.reduce((sum, point) => sum + point.x, 0) / centers.length,
    y: centers.reduce((sum, point) => sum + point.y, 0) / centers.length,
  };
  const targets = entities.map((entity, index) =>
    featureGlyphTarget(entity, groupCenter, index, entities.length));
  if (constraint.type === 'parallel') {
    // Parallel marks belong just inside the gap between their carriers. This
    // keeps the repeated pair visually associated without drifting away from
    // the lines or turning the relation into one detached center label.
    for (const target of targets) {
      if (target.preferredDir) {
        target.preferredDir = {
          x: -target.preferredDir.x,
          y: -target.preferredDir.y,
        };
      }
    }
  }
  return targets;
}

/** Default preferred nudge: north-east in sketch UV. */
export const DEFAULT_GLYPH_DIR: Vec2 = { x: 1, y: 1 };

const CANDIDATE_DIRS: readonly Vec2[] = [
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: 1, y: 0 },
  { x: -1, y: 1 },
  { x: 1, y: -1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
  { x: -1, y: -1 },
];

function normalize(dir: Vec2): Vec2 | null {
  const len = Math.hypot(dir.x, dir.y);
  if (len < 1e-12) return null;
  return { x: dir.x / len, y: dir.y / len };
}

function clearOfObstacles(
  point: Vec2,
  obstacles: readonly Vec2[],
  clearRadius: number,
): boolean {
  const clearSq = clearRadius * clearRadius;
  for (const obstacle of obstacles) {
    const dx = point.x - obstacle.x;
    const dy = point.y - obstacle.y;
    if (dx * dx + dy * dy < clearSq) return false;
  }
  return true;
}

export interface GlyphOffsetOptions {
  /** Sketch-plane distance from the relation anchor to the badge center. */
  nudge: number;
  /** Preferred unit-ish direction; falls back to NE. */
  preferredDir?: Vec2 | null;
  /** Points/glyphs the badge should not sit on (sketch-plane). */
  obstacles?: readonly Vec2[];
  /** Minimum distance to any obstacle (defaults to nudge). */
  clearRadius?: number;
}

export interface ConstraintGlyphLayoutItem {
  /** Solved sketch-plane point the badge describes. */
  anchor: Vec2;
  /** Visible badge size in CSS pixels. */
  glyphPx: number;
  /** Preferred sketch-plane direction away from the anchor. */
  preferredDir?: Vec2 | null;
}

export interface ConstraintGlyphLayoutOptions {
  /** Sketch-plane world units covered by one CSS pixel for the current camera. */
  worldPerPixel: number;
  /** Half-size of a visible point grip in CSS pixels. */
  gripHalfPx: number;
  /** Desired empty screen-space gap around grips and badges. */
  gapPx: number;
  /** Solved sketch points that badges must avoid. */
  obstacles?: readonly Vec2[];
}

/**
 * Place a constraint glyph near a relation anchor without covering geometry.
 *
 * Sketch geometry is already solved; this is a separate UI pass: prefer a
 * fixed-length offset, then try a few compass directions if that lands on a
 * grip or another glyph. Pair with geometry-first Select picking in the
 * viewport so residual overlap still selects points, not badges.
 */
export function offsetGlyphFromAnchor(
  anchor: Vec2,
  options: GlyphOffsetOptions,
): Vec2 {
  const nudge = Math.max(options.nudge, 1e-6);
  const clearRadius = options.clearRadius ?? nudge;
  const obstacles = options.obstacles ?? [];
  const preferred = normalize(options.preferredDir ?? DEFAULT_GLYPH_DIR)
    ?? normalize(DEFAULT_GLYPH_DIR)!;

  const dirs: Vec2[] = [preferred];
  for (const candidate of CANDIDATE_DIRS) {
    const unit = normalize(candidate);
    if (!unit) continue;
    if (Math.abs(unit.x - preferred.x) < 1e-9 && Math.abs(unit.y - preferred.y) < 1e-9) {
      continue;
    }
    dirs.push(unit);
  }

  for (const dir of dirs) {
    const point = {
      x: anchor.x + dir.x * nudge,
      y: anchor.y + dir.y * nudge,
    };
    if (clearOfObstacles(point, obstacles, clearRadius)) return point;
  }

  return {
    x: anchor.x + preferred.x * nudge,
    y: anchor.y + preferred.y * nudge,
  };
}

/**
 * Lay out all constraint badges for the current camera scale.
 *
 * Keeping the scale as an input is important: the solved relation anchors do
 * not change while zooming, but the world-space offset that represents (for
 * example) 20 screen pixels does. Callers can therefore refresh only badge
 * positions on camera changes without rebuilding sketch geometry.
 */
export function layoutConstraintGlyphs(
  items: readonly ConstraintGlyphLayoutItem[],
  options: ConstraintGlyphLayoutOptions,
): Vec2[] {
  const worldPerPixel = Math.max(Math.abs(options.worldPerPixel), Number.EPSILON);
  const obstacles = (options.obstacles ?? []).map((point) => ({ ...point }));
  const positions: Vec2[] = [];

  for (const item of items) {
    const glyphHalfPx = item.glyphPx * 0.5;
    const nudgePx = options.gripHalfPx + glyphHalfPx + options.gapPx;
    const clearPx = Math.max(
      nudgePx,
      glyphHalfPx * 2 + options.gapPx,
    );
    const placed = offsetGlyphFromAnchor(item.anchor, {
      nudge: worldPerPixel * nudgePx,
      preferredDir: item.preferredDir,
      obstacles,
      clearRadius: worldPerPixel * clearPx,
    });
    positions.push(placed);
    obstacles.push(placed);
  }

  return positions;
}
