/**
 * Tessellation/presentation of engine-resolved sketch primitives, plus
 * pointer travel and the incremental spline rubber-band.
 */
import type { PreviewCurve, Vec2 } from '../../engine/types';

/** Tessellate an engine-resolved, connected outline without recomputing it. */
export function creationPreviewPositions(curves: PreviewCurve[]): number[] {
  const remaining = curves.map((curve) => {
    switch (curve.kind) {
      case 'line': return [curve.a.x, curve.a.y, 0.12, curve.b.x, curve.b.y, 0.12];
      case 'circle': return tessellateCircle(curve.center, curve.radius, 0.12);
      case 'arc': return tessellateArc(curve.center, curve.radius, curve.start_angle, curve.end_angle, 0.12);
    }
  });
  const result = remaining.shift() ?? [];
  while (remaining.length) {
    const x = result[result.length - 3];
    const y = result[result.length - 2];
    const index = remaining.findIndex((points) =>
      Math.hypot(points[0] - x, points[1] - y) < 1e-6
      || Math.hypot(points[points.length - 3] - x, points[points.length - 2] - y) < 1e-6);
    // These previews are single outlines. Do not draw a fictitious connector
    // if a future tool supplies disjoint curves.
    if (index < 0) break;
    const points = remaining.splice(index, 1)[0];
    if (Math.hypot(points[0] - x, points[1] - y) >= 1e-6) {
      const reversed: number[] = [];
      for (let i = points.length - 3; i >= 0; i -= 3) reversed.push(...points.slice(i, i + 3));
      result.push(...reversed.slice(3));
    } else result.push(...points.slice(3));
  }
  return result;
}

export interface ToolLocks {
  length?: number;
  angle?: number; // degrees
  width?: number;
  height?: number;
  diameter?: number;
  radius?: number;
  distance?: number;
  factor?: number;
}


/** Angle of (p − center) in radians. */
export function angleOf(center: Vec2, p: Vec2): number {
  return Math.atan2(p.y - center.y, p.x - center.x);
}

/** CCW sweep from a0 to a1 (result in (0, 2π]). */
export function ccwSweep(a0: number, a1: number): number {
  let sweep = a1 - a0;
  while (sweep <= 0) sweep += Math.PI * 2;
  while (sweep > Math.PI * 2) sweep -= Math.PI * 2;
  return sweep;
}

/** Signed shortest angular delta from `a0` to `a1`, in (-PI, PI]. */
export function signedSweep(a0: number, a1: number): number {
  const tau = Math.PI * 2;
  return ((a1 - a0 + Math.PI) % tau + tau) % tau - Math.PI;
}

/** Tessellate a circle/arc into a flat xyz polyline (local sketch coords). */
export function tessellateArc(
  center: Vec2,
  radius: number,
  a0: number,
  a1: number,
  z = 0.05,
): number[] {
  return tessellateArcSweep(center, radius, a0, ccwSweep(a0, a1), z);
}

/** Tessellate an arc from `a0` along a SIGNED sweep, so a clockwise drag draws
 * the same points the engine will store for it. */
export function tessellateArcSweep(
  center: Vec2,
  radius: number,
  a0: number,
  sweep: number,
  z = 0.05,
): number[] {
  const clamped = Math.max(-Math.PI * 2, Math.min(Math.PI * 2, sweep));
  const segments = Math.max(
    8,
    Math.min(96, Math.ceil((Math.abs(clamped) / (Math.PI * 2)) * 96)),
  );
  const positions: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = a0 + (clamped * i) / segments;
    positions.push(center.x + radius * Math.cos(a), center.y + radius * Math.sin(a), z);
  }
  return positions;
}

export function tessellateCircle(center: Vec2, radius: number, z = 0.05): number[] {
  return tessellateArc(center, radius, 0, Math.PI * 2 - 1e-9, z);
}


/** Centripetal Catmull-Rom tessellation for the live spline rubber-band —
 * SAME math as the engine's geomops::spline (Barry-Goldman, reflection
 * phantom endpoints). The committed entity always renders from the engine's
 * own tessellation; this is preview-only. */
export function tessellateSpline(points: Vec2[], segmentsPerSpan = 16, z = 0.12): number[] {
  const n = points.length;
  if (n < 2) return [];
  if (n === 2) return [points[0].x, points[0].y, z, points[1].x, points[1].y, z];
  const segs = Math.max(4, Math.min(96, segmentsPerSpan));
  const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
  const combo = (a: Vec2, wa: number, b: Vec2, wb: number): Vec2 => ({
    x: a.x * wa + b.x * wb,
    y: a.y * wa + b.y * wb,
  });
  const pMinus = { x: 2 * points[0].x - points[1].x, y: 2 * points[0].y - points[1].y };
  const pPlus = { x: 2 * points[n - 1].x - points[n - 2].x, y: 2 * points[n - 1].y - points[n - 2].y };
  const out: number[] = [points[0].x, points[0].y, z];
  for (let i = 0; i < n - 1; i++) {
    const p0 = i === 0 ? pMinus : points[i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = i === n - 2 ? pPlus : points[i + 2];
    const alpha = 0.5;
    const t0 = 0;
    const t1 = t0 + Math.pow(dist(p0, p1), alpha);
    const t2 = t1 + Math.pow(dist(p1, p2), alpha);
    const t3 = t2 + Math.pow(dist(p2, p3), alpha);
    const guard = (d: number) => (Math.abs(d) < 1e-9 ? 1e-9 : d);
    const d1 = guard(t1 - t0);
    const d2 = guard(t2 - t1);
    const d3 = guard(t3 - t2);
    const d4 = guard(t2 - t0);
    const d5 = guard(t3 - t1);
    for (let j = 1; j <= segs; j++) {
      const t = t1 + (t2 - t1) * (j / segs);
      const a1 = combo(p0, (t1 - t) / d1, p1, (t - t0) / d1);
      const a2 = combo(p1, (t2 - t) / d2, p2, (t - t1) / d2);
      const a3 = combo(p2, (t3 - t) / d3, p3, (t - t2) / d3);
      const b1 = combo(a1, (t2 - t) / d4, a2, (t - t0) / d4);
      const b2 = combo(a2, (t3 - t) / d5, a3, (t - t1) / d5);
      const c = combo(b1, (t2 - t) / d2, b2, (t - t1) / d2);
      out.push(c.x, c.y, z);
    }
  }
  return out;
}
