import type { ReactNode } from 'react';
import type { GeometricConstraintType } from '../engine/types';

export type ConstraintIconKind =
  | 'horizontal_vertical'
  | 'horizontal'
  | 'vertical'
  | 'horizontal_points'
  | 'vertical_points'
  | 'coincident'
  | 'tangent'
  | 'equal'
  | 'parallel'
  | 'perpendicular'
  | 'fix'
  | 'midpoint'
  | 'concentric'
  | 'collinear'
  | 'symmetry';

export type RelationConstraintIconKind = Exclude<
  ConstraintIconKind,
  'horizontal_vertical'
>;

type Primitive =
  | { type: 'path'; d: string; dash?: number[] }
  | { type: 'circle'; cx: number; cy: number; r: number; fill?: boolean }
  | { type: 'rect'; x: number; y: number; width: number; height: number; rx?: number };

/**
 * One application-owned drawing inventory for toolbar icons and viewport
 * constraint marks. Keeping the geometry here prevents the command and its
 * visible relation from drifting into two different symbols.
 */
export const CONSTRAINT_ICON_PRIMITIVES: Readonly<Record<ConstraintIconKind, readonly Primitive[]>> =
  Object.freeze({
    horizontal_vertical: [
      { type: 'path', d: 'M4 7h16M17 4v16' },
      { type: 'path', d: 'M13 7h4v4', dash: [2, 2] },
    ],
    horizontal: [{ type: 'path', d: 'M4 12h16' }],
    vertical: [{ type: 'path', d: 'M12 4v16' }],
    horizontal_points: [
      { type: 'path', d: 'M5 12h14' },
      { type: 'circle', cx: 5, cy: 12, r: 1.8, fill: true },
      { type: 'circle', cx: 19, cy: 12, r: 1.8, fill: true },
    ],
    vertical_points: [
      { type: 'path', d: 'M12 5v14' },
      { type: 'circle', cx: 12, cy: 5, r: 1.8, fill: true },
      { type: 'circle', cx: 12, cy: 19, r: 1.8, fill: true },
    ],
    coincident: [
      { type: 'path', d: 'M4 18L12 10M20 18l-8-8M12 3v4M5 10h4M15 10h4' },
      { type: 'circle', cx: 12, cy: 10, r: 2.2 },
    ],
    tangent: [
      { type: 'circle', cx: 11, cy: 14, r: 6 },
      { type: 'path', d: 'M4 7l16 5' },
      { type: 'circle', cx: 11, cy: 9.2, r: 1.2, fill: true },
    ],
    equal: [
      { type: 'path', d: 'M5 9h14M5 15h14' },
    ],
    parallel: [
      // Keep the two strokes distinct at compact viewport sizes, but reduce
      // their centre-to-centre spacing by one third (9 -> 6 icon units).
      { type: 'path', d: 'M6.5 19L11.5 5M12.5 19l5-14' },
      { type: 'path', d: 'M8.5 10l3-1M12.5 15l3-1' },
    ],
    perpendicular: [
      { type: 'path', d: 'M5 4v15h15' },
      { type: 'path', d: 'M5 14h5v5' },
    ],
    fix: [
      { type: 'path', d: 'M7 11V8a5 5 0 0 1 10 0v3' },
      { type: 'rect', x: 5, y: 11, width: 14, height: 10, rx: 2 },
      { type: 'circle', cx: 12, cy: 16, r: 1.3, fill: true },
    ],
    midpoint: [
      { type: 'path', d: 'M3 18h18' },
      { type: 'path', d: 'M12 6l4 7H8l4-7z' },
      { type: 'path', d: 'M12 13v5', dash: [2, 2] },
    ],
    concentric: [
      { type: 'circle', cx: 12, cy: 12, r: 8 },
      { type: 'circle', cx: 12, cy: 12, r: 4 },
      { type: 'circle', cx: 12, cy: 12, r: 1, fill: true },
    ],
    collinear: [
      { type: 'path', d: 'M3 18L21 6', dash: [2, 2] },
      { type: 'path', d: 'M4 15l6-4M14 9l6-4' },
      { type: 'circle', cx: 12, cy: 10, r: 1.2, fill: true },
    ],
    symmetry: [
      { type: 'path', d: 'M12 3v18', dash: [2, 2] },
      { type: 'path', d: 'M4 7l5 5-5 5M20 7l-5 5 5 5M7 12h10' },
    ],
  });

export const CONSTRAINT_TYPE_ICON: Readonly<
  Record<GeometricConstraintType, RelationConstraintIconKind>
> =
  Object.freeze({
    horizontal: 'horizontal',
    vertical: 'vertical',
    horizontal_points: 'horizontal_points',
    vertical_points: 'vertical_points',
    coincident: 'coincident',
    origin_coincident: 'coincident',
    center_coincident: 'coincident',
    tangent: 'tangent',
    equal: 'equal',
    parallel: 'parallel',
    perpendicular: 'perpendicular',
    fix: 'fix',
    midpoint: 'midpoint',
    reference_midpoint: 'midpoint',
    span_midpoint: 'midpoint',
    concentric: 'concentric',
    collinear: 'collinear',
    symmetry: 'symmetry',
    arc_endpoint_coincident: 'coincident',
    equal_distance: 'equal',
  });

/** Human-facing relation names reuse the ribbon vocabulary in every locale. */
export const CONSTRAINT_TYPE_LABEL_KEY: Readonly<
  Record<GeometricConstraintType, string>
> = Object.freeze({
  horizontal: 'ribbon.sketch.horizontalVertical',
  vertical: 'ribbon.sketch.horizontalVertical',
  horizontal_points: 'ribbon.sketch.horizontalVertical',
  vertical_points: 'ribbon.sketch.horizontalVertical',
  coincident: 'ribbon.sketch.coincident',
  origin_coincident: 'ribbon.sketch.coincident',
  center_coincident: 'ribbon.sketch.coincident',
  tangent: 'ribbon.sketch.tangent',
  equal: 'ribbon.sketch.equal',
  parallel: 'ribbon.sketch.parallel',
  perpendicular: 'ribbon.sketch.perpendicular',
  fix: 'ribbon.sketch.fixUnfix',
  midpoint: 'ribbon.sketch.midpoint',
  reference_midpoint: 'ribbon.sketch.midpoint',
  span_midpoint: 'ribbon.sketch.midpoint',
  concentric: 'ribbon.sketch.concentric',
  collinear: 'ribbon.sketch.collinear',
  symmetry: 'ribbon.sketch.symmetry',
  arc_endpoint_coincident: 'ribbon.sketch.coincident',
  equal_distance: 'ribbon.sketch.equal',
});

export const TOOL_CONSTRAINT_ICON: Readonly<Record<string, ConstraintIconKind>> = Object.freeze({
  hv: 'horizontal_vertical',
  coincident: 'coincident',
  tangent: 'tangent',
  equal: 'equal',
  parallel: 'parallel',
  perpendicular: 'perpendicular',
  fix: 'fix',
  midpointC: 'midpoint',
  concentric: 'concentric',
  collinear: 'collinear',
  symmetry: 'symmetry',
});

export function ConstraintIconContent({ kind }: { kind: ConstraintIconKind }): ReactNode {
  return CONSTRAINT_ICON_PRIMITIVES[kind].map((primitive, index) => {
    if (primitive.type === 'path') {
      return (
        <path
          key={index}
          d={primitive.d}
          strokeDasharray={primitive.dash?.join(' ')}
        />
      );
    }
    if (primitive.type === 'circle') {
      return (
        <circle
          key={index}
          cx={primitive.cx}
          cy={primitive.cy}
          r={primitive.r}
          fill={primitive.fill ? 'currentColor' : 'none'}
          stroke={primitive.fill ? 'none' : 'currentColor'}
        />
      );
    }
    return (
      <rect
        key={index}
        x={primitive.x}
        y={primitive.y}
        width={primitive.width}
        height={primitive.height}
        rx={primitive.rx}
      />
    );
  });
}

/** Draw the same 24×24 primitive inventory into a viewport texture. */
export function drawConstraintIcon(
  ctx: CanvasRenderingContext2D,
  kind: ConstraintIconKind,
  color: string,
): void {
  ctx.save();
  ctx.scale(64 / 24, 64 / 24);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.8;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const primitive of CONSTRAINT_ICON_PRIMITIVES[kind]) {
    if (primitive.type === 'path') {
      ctx.setLineDash(primitive.dash ?? []);
      ctx.stroke(new Path2D(primitive.d));
      continue;
    }
    ctx.setLineDash([]);
    if (primitive.type === 'circle') {
      ctx.beginPath();
      ctx.arc(primitive.cx, primitive.cy, primitive.r, 0, Math.PI * 2);
      if (primitive.fill) ctx.fill();
      else ctx.stroke();
      continue;
    }
    ctx.beginPath();
    ctx.roundRect(
      primitive.x,
      primitive.y,
      primitive.width,
      primitive.height,
      primitive.rx ?? 0,
    );
    ctx.stroke();
  }
  ctx.restore();
}
