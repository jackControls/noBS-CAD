/**
 * Pure preview math for the sketch tool framework (client-side ONLY for
 * rubber-band rendering — the authoritative entity creation always happens
 * in the Rust engine via the matching locked/unlocked ops).
 */
import type { CircleMode, RectangleMode, SlotMode, Vec2 } from '../../engine/types';

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

/** Locked-aware corner of a rectangle given an anchor + cursor hint. */
export function rectCorner(
  mode: RectangleMode,
  anchor: Vec2,
  cursor: Vec2,
  locks: ToolLocks,
): Vec2 {
  const sx = Math.sign(cursor.x - anchor.x) || 1;
  const sy = Math.sign(cursor.y - anchor.y) || 1;
  const hx = locks.width ?? Math.abs(cursor.x - anchor.x);
  const hy = locks.height ?? Math.abs(cursor.y - anchor.y);
  if (mode === 'center') {
    return { x: anchor.x + (sx * hx) / 2, y: anchor.y + (sy * hy) / 2 };
  }
  return { x: anchor.x + sx * hx, y: anchor.y + sy * hy };
}

/** The 4 corners (min/max-ordered) of a rectangle, null if degenerate. */
export function rectCorners(mode: RectangleMode, anchor: Vec2, corner: Vec2): Vec2[] | null {
  let min: Vec2;
  let max: Vec2;
  if (mode === 'center') {
    const hx = Math.abs(corner.x - anchor.x);
    const hy = Math.abs(corner.y - anchor.y);
    min = { x: anchor.x - hx, y: anchor.y - hy };
    max = { x: anchor.x + hx, y: anchor.y + hy };
  } else {
    min = { x: Math.min(anchor.x, corner.x), y: Math.min(anchor.y, corner.y) };
    max = { x: Math.max(anchor.x, corner.x), y: Math.max(anchor.y, corner.y) };
  }
  if (max.x - min.x < 1e-6 || max.y - min.y < 1e-6) return null;
  return [
    { x: min.x, y: min.y },
    { x: max.x, y: min.y },
    { x: max.x, y: max.y },
    { x: min.x, y: max.y },
  ];
}

/** Locked-aware circle spec (center + radius), null if degenerate. */
export function circleSpec(
  mode: CircleMode,
  anchor: Vec2,
  cursor: Vec2,
  locks: ToolLocks,
): { center: Vec2; radius: number } | null {
  if (mode === 'center_diameter') {
    const radius = locks.diameter !== undefined ? locks.diameter / 2 : Math.hypot(cursor.x - anchor.x, cursor.y - anchor.y);
    if (radius < 1e-6) return null;
    return { center: anchor, radius };
  }
  // two_point: anchor + cursor are diameter endpoints.
  let second = cursor;
  if (locks.diameter !== undefined) {
    const dx = cursor.x - anchor.x;
    const dy = cursor.y - anchor.y;
    const len = Math.hypot(dx, dy) || 1;
    second = { x: anchor.x + (dx / len) * locks.diameter, y: anchor.y + (dy / len) * locks.diameter };
  }
  const radius = Math.hypot(second.x - anchor.x, second.y - anchor.y) / 2;
  if (radius < 1e-6) return null;
  return {
    center: { x: (anchor.x + second.x) / 2, y: (anchor.y + second.y) / 2 },
    radius,
  };
}

/** Circumcircle through 3 points, null if collinear. */
export function circumcircle(p1: Vec2, p2: Vec2, p3: Vec2): { center: Vec2; radius: number } | null {
  const d = 2 * (p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = p1.x * p1.x + p1.y * p1.y;
  const b2 = p2.x * p2.x + p2.y * p2.y;
  const c2 = p3.x * p3.x + p3.y * p3.y;
  const ux = (a2 * (p2.y - p3.y) + b2 * (p3.y - p1.y) + c2 * (p1.y - p2.y)) / d;
  const uy = (a2 * (p3.x - p2.x) + b2 * (p1.x - p3.x) + c2 * (p2.x - p1.x)) / d;
  const center = { x: ux, y: uy };
  return { center, radius: Math.hypot(p1.x - ux, p1.y - uy) };
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

/** Tessellate a circle/arc into a flat xyz polyline (local sketch coords). */
export function tessellateArc(
  center: Vec2,
  radius: number,
  a0: number,
  a1: number,
  z = 0.05,
): number[] {
  const sweep = ccwSweep(a0, a1);
  const segments = Math.max(8, Math.min(96, Math.ceil((sweep / (Math.PI * 2)) * 96)));
  const positions: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = a0 + (sweep * i) / segments;
    positions.push(center.x + radius * Math.cos(a), center.y + radius * Math.sin(a), z);
  }
  return positions;
}

export function tessellateCircle(center: Vec2, radius: number, z = 0.05): number[] {
  return tessellateArc(center, radius, 0, Math.PI * 2 - 1e-9, z);
}

export interface SlotCapsulePreview {
  /** Closed capsule outline (xyz triples) for the rubber-band polyline. */
  positions: number[];
  /** Effective width (locked value, else cursor-derived). */
  width: number;
  c1: Vec2;
  c2: Vec2;
}

/** Locked-aware capsule preview for the Slot tool — same math as the
 * engine's geomops::slot (client-side for rubber-band rendering only).
 * Null when the run is degenerate (coincident centers, zero width, or an
 * overall slot shorter than its width). */
export function slotCapsulePreview(
  mode: SlotMode,
  p1: Vec2,
  p2: Vec2,
  cursor: Vec2,
  locks: ToolLocks,
  z = 0.12,
): SlotCapsulePreview | null {
  const d = { x: p2.x - p1.x, y: p2.y - p1.y };
  const axisLen = Math.hypot(d.x, d.y);
  if (axisLen < 1e-9) return null;
  const width =
    locks.width ?? (2 * Math.abs(d.x * (cursor.y - p1.y) - d.y * (cursor.x - p1.x))) / axisLen;
  if (!(width > 1e-6)) return null;
  const r = width / 2;

  let c1: Vec2;
  let c2: Vec2;
  if (mode === 'center_point') {
    c1 = p2;
    c2 = { x: 2 * p1.x - p2.x, y: 2 * p1.y - p2.y };
  } else if (mode === 'overall') {
    if (axisLen <= width) return null;
    const u = { x: d.x / axisLen, y: d.y / axisLen };
    c1 = { x: p1.x + u.x * r, y: p1.y + u.y * r };
    c2 = { x: p2.x - u.x * r, y: p2.y - u.y * r };
  } else {
    c1 = p1;
    c2 = p2;
  }

  const cd = { x: c2.x - c1.x, y: c2.y - c1.y };
  const clen = Math.hypot(cd.x, cd.y);
  if (clen < 1e-9) return null;
  const u = { x: cd.x / clen, y: cd.y / clen };
  const n = { x: -u.y, y: u.x };
  const l1a = { x: c1.x + n.x * r, y: c1.y + n.y * r };
  const l1b = { x: c2.x + n.x * r, y: c2.y + n.y * r };
  const l2a = { x: c1.x - n.x * r, y: c1.y - n.y * r };
  const l2b = { x: c2.x - n.x * r, y: c2.y - n.y * r };

  // End caps CCW per the engine convention; the outline loop consumes them
  // reversed so the polyline stays continuous.
  const aN = Math.atan2(n.y, n.x);
  const aNegN = Math.atan2(-n.y, -n.x);
  const rev = (pts: number[]): number[] => {
    const out: number[] = [];
    for (let i = pts.length - 3; i >= 0; i -= 3) out.push(pts[i], pts[i + 1], pts[i + 2]);
    return out;
  };
  const cap2 = rev(tessellateArc(c2, r, aNegN, aN, z)); // l1b → l2b through +u
  const cap1 = rev(tessellateArc(c1, r, aN, aNegN, z)); // l2a → l1a through −u

  const positions: number[] = [l1a.x, l1a.y, z, l1b.x, l1b.y, z];
  positions.push(...cap2.slice(3)); // skip the duplicate junction point
  positions.push(l2a.x, l2a.y, z);
  positions.push(...cap1.slice(3));
  positions.push(l1a.x, l1a.y, z); // close the loop
  return { positions, width, c1, c2 };
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
