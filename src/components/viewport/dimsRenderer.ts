/**
 * Dimension annotation geometry (D9): computes world-space anchors for
 * rendering and tool previews from a dimension's kind + entities. All math
 * here is pure presentation — constraint semantics live in the engine.
 */
import type { DimensionDto, EntityDto, Vec2 } from '../../engine/types';

export type DimGeometry =
  | {
      shape: 'linear';
      /** Measured segment endpoints (or point / projected point). */
      a: Vec2;
      b: Vec2;
      textPos: Vec2;
    }
  | { shape: 'diameter'; center: Vec2; radius: number; textPos: Vec2 }
  | { shape: 'radius'; center: Vec2; radius: number; midAngle: number; textPos: Vec2 }
  | {
      shape: 'angular';
      vertex: Vec2;
      a1: number;
      a2: number;
      textPos: Vec2;
    };

export interface DimLike {
  kind: DimensionDto['kind'];
  entities: number[];
  text_pos: Vec2;
}

const perp = (d: Vec2): Vec2 => ({ x: -d.y, y: d.x });
const len = (d: Vec2) => Math.hypot(d.x, d.y);
const unit = (d: Vec2): Vec2 => {
  const l = len(d) || 1;
  return { x: d.x / l, y: d.y / l };
};
const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const angleOf = (d: Vec2) => Math.atan2(d.y, d.x);

function lineEnds(e: EntityDto): { a: Vec2; b: Vec2 } | null {
  return e.kind === 'line' ? { a: e.start, b: e.end } : null;
}

function pointOf(e: EntityDto): Vec2 | null {
  return e.kind === 'point' ? e.position : null;
}

function radialOf(e: EntityDto): { center: Vec2; radius: number } | null {
  return e.kind === 'circle' || e.kind === 'arc'
    ? { center: e.center, radius: e.radius }
    : null;
}

/** Project point p onto the infinite line through a→b. */
function projectOntoLine(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const d = sub(b, a);
  const l2 = d.x * d.x + d.y * d.y;
  const t = l2 === 0 ? 0 : ((p.x - a.x) * d.x + (p.y - a.y) * d.y) / l2;
  return { x: a.x + t * d.x, y: a.y + t * d.y };
}

/** Intersection of two infinite lines (null if parallel). */
function lineIntersection(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): Vec2 | null {
  const d1 = sub(a2, a1);
  const d2 = sub(b2, b1);
  const denom = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(denom) < 1e-12) return null;
  const t = ((b1.x - a1.x) * d2.y - (b1.y - a1.y) * d2.x) / denom;
  return { x: a1.x + t * d1.x, y: a1.y + t * d1.y };
}

/**
 * Presentation geometry of a dimension (or prospective dimension during
 * tool preview, with the same rules the engine uses to choose kinds).
 */
export function computeDimGeometry(
  dim: DimLike,
  byId: Map<number, EntityDto>,
): DimGeometry | null {
  const ents = dim.entities.map((id) => byId.get(id)).filter((e): e is EntityDto => !!e);

  if (dim.kind === 'angle') {
    if (ents.length !== 2) return null;
    const l1 = lineEnds(ents[0]);
    const l2 = lineEnds(ents[1]);
    if (!l1 || !l2) return null;
    const d1 = unit(sub(l1.b, l1.a));
    const d2 = unit(sub(l2.b, l2.a));
    // Vertex: shared endpoint > line intersection (when near) > midpoint
    // of the closest endpoint pair for non-touching lines.
    let vertex: Vec2 | null =
      (len(sub(l1.a, l2.a)) < 1e-9 && l1.a) ||
      (len(sub(l1.b, l2.a)) < 1e-9 && l1.b) ||
      (len(sub(l1.a, l2.b)) < 1e-9 && l1.a) ||
      (len(sub(l1.b, l2.b)) < 1e-9 && l1.b) ||
      null;
    if (!vertex) {
      const hit = lineIntersection(l1.a, l1.b, l2.a, l2.b);
      if (hit && len(sub(hit, l1.a)) < 200 && len(sub(hit, l2.a)) < 200) {
        vertex = hit;
      }
    }
    if (!vertex) {
      // Closest endpoint pair midpoint.
      const pairs: Array<[Vec2, Vec2]> = [
        [l1.a, l2.a],
        [l1.a, l2.b],
        [l1.b, l2.a],
        [l1.b, l2.b],
      ];
      let best = pairs[0];
      for (const p of pairs) {
        if (len(sub(p[0], p[1])) < len(sub(best[0], best[1]))) best = p;
      }
      vertex = { x: (best[0].x + best[1].x) / 2, y: (best[0].y + best[1].y) / 2 };
    }
    return {
      shape: 'angular',
      vertex,
      a1: angleOf(d1),
      a2: angleOf(d2),
      textPos: dim.text_pos,
    };
  }

  if (dim.kind === 'diameter') {
    const c = ents.find((e) => e.kind === 'circle' || e.kind === 'arc');
    if (!c) return null;
    return { shape: 'diameter', center: c.center, radius: c.radius, textPos: dim.text_pos };
  }

  if (dim.kind === 'radius') {
    const c = ents.find((e) => e.kind === 'circle' || e.kind === 'arc');
    if (!c) return null;
    const midAngle =
      c.kind === 'arc'
        ? c.start_angle + ccw(c.start_angle, c.end_angle) / 2
        : angleOf(sub(dim.text_pos, c.center));
    return { shape: 'radius', center: c.center, radius: c.radius, midAngle, textPos: dim.text_pos };
  }

  // distance: line length / point-point / point-line / line-line.
  if (dim.kind === 'distance') {
    if (ents.length === 1 && ents[0].kind === 'line') {
      const l = lineEnds(ents[0]);
      return l ? { shape: 'linear', a: l.a, b: l.b, textPos: dim.text_pos } : null;
    }
    if (ents.length === 2) {
      const [e1, e2] = ents;
      const p1 = pointOf(e1);
      const p2 = pointOf(e2);
      if (p1 && p2) return { shape: 'linear', a: p1, b: p2, textPos: dim.text_pos };
      const r1 = radialOf(e1);
      const r2 = radialOf(e2);
      if (r1 && r2) {
        const towardText = unit(sub(dim.text_pos, r1.center));
        return {
          shape: 'linear',
          a: {
            x: r1.center.x + towardText.x * r1.radius,
            y: r1.center.y + towardText.y * r1.radius,
          },
          b: {
            x: r2.center.x + towardText.x * r2.radius,
            y: r2.center.y + towardText.y * r2.radius,
          },
          textPos: dim.text_pos,
        };
      }
      const l1 = lineEnds(e1);
      const l2 = lineEnds(e2);
      if (p1 && l2) {
        return { shape: 'linear', a: p1, b: projectOntoLine(p1, l2.a, l2.b), textPos: dim.text_pos };
      }
      if (l1 && p2) {
        return { shape: 'linear', a: p2, b: projectOntoLine(p2, l1.a, l1.b), textPos: dim.text_pos };
      }
      if (l1 && l2) {
        // Parallel lines: perpendicular connector at l1's start.
        const b = projectOntoLine(l1.a, l2.a, l2.b);
        return { shape: 'linear', a: l1.a, b, textPos: dim.text_pos };
      }
    }
  }
  return null;
}

/** Format the measured value shown by the live dimension-placement preview. */
export function formatDimMeasurement(
  dim: DimLike,
  byId: Map<number, EntityDto>,
): string | null {
  const ents = dim.entities.map((id) => byId.get(id)).filter((e): e is EntityDto => !!e);
  if (dim.kind === 'diameter') {
    const radial = ents.length > 0 ? radialOf(ents[0]) : null;
    return radial ? `Ø${(radial.radius * 2).toFixed(2)}` : null;
  }
  if (dim.kind === 'radius') {
    const radial = ents.length > 0 ? radialOf(ents[0]) : null;
    return radial ? `R${radial.radius.toFixed(2)}` : null;
  }
  if (dim.kind === 'angle' && ents.length === 2) {
    const a = lineEnds(ents[0]);
    const b = lineEnds(ents[1]);
    if (!a || !b) return null;
    const da = sub(a.b, a.a);
    const db = sub(b.b, b.a);
    const degrees = Math.abs(
      (Math.atan2(da.x * db.y - da.y * db.x, da.x * db.x + da.y * db.y) * 180) /
        Math.PI,
    );
    return `${degrees.toFixed(2)}°`;
  }
  if (dim.kind === 'distance') {
    if (ents.length === 2) {
      const r1 = radialOf(ents[0]);
      const r2 = radialOf(ents[1]);
      if (r1 && r2) return Math.abs(r2.radius - r1.radius).toFixed(2);
    }
    const geom = computeDimGeometry(dim, byId);
    if (geom?.shape === 'linear') return len(sub(geom.b, geom.a)).toFixed(2);
  }
  return null;
}

/** CCW sweep from a0 to a1 (matches toolPreview.ccwSweep). */
function ccw(a0: number, a1: number): number {
  let sweep = a1 - a0;
  while (sweep <= 0) sweep += Math.PI * 2;
  while (sweep > Math.PI * 2) sweep -= Math.PI * 2;
  return sweep;
}

/** Angle (deg) between two line directions, for the preview kind choice. */
export function linesAreParallel(l1: { a: Vec2; b: Vec2 }, l2: { a: Vec2; b: Vec2 }): boolean {
  const d1 = sub(l1.b, l1.a);
  const d2 = sub(l2.b, l2.a);
  return Math.abs(d1.x * d2.y - d1.y * d2.x) < 1e-9 * len(d1) * len(d2);
}

export { perp, unit, sub, len, angleOf };
