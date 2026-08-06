import type {
  DrawingLinearDimensionMode,
  DrawingProjectionAnchorDto,
  DrawingProjectionDto,
  DrawingTopologyAnchorRefDto,
  DrawingViewDto,
} from '../engine/types';
import type { UnitSystem } from '../types/document';

export interface ResolvedDrawingAnchor {
  anchor: DrawingProjectionAnchorDto;
  paper: [number, number];
  resolution: 'exact' | 'edge_key';
}

export interface DrawingDimensionGeometry {
  first: [number, number];
  second: [number, number];
  dimensionStart: [number, number];
  dimensionEnd: [number, number];
  firstExtension: [[number, number], [number, number]];
  secondExtension: [[number, number], [number, number]];
  textPosition: [number, number];
  textAngle: number;
  arrowSize: number;
  value: number;
}

export function drawingAnchorRef(
  anchor: DrawingProjectionAnchorDto,
): DrawingTopologyAnchorRefDto {
  return {
    body_id: anchor.body_id,
    edge_id: anchor.edge_id,
    edge_key: anchor.edge_key,
    endpoint: anchor.endpoint,
    fallback_point: anchor.model_point,
  };
}

export function drawingProjectedPointToPaper(
  view: DrawingViewDto,
  projection: DrawingProjectionDto,
  point: [number, number],
): [number, number] {
  const centerX = (projection.bounds[0] + projection.bounds[2]) / 2;
  const centerY = (projection.bounds[1] + projection.bounds[3]) / 2;
  return [
    view.position[0] + (point[0] - centerX) * view.scale,
    view.position[1] - (point[1] - centerY) * view.scale,
  ];
}

export function resolveDrawingAnchor(
  reference: DrawingTopologyAnchorRefDto,
  view: DrawingViewDto,
  projection: DrawingProjectionDto,
): ResolvedDrawingAnchor | null {
  const exact = projection.anchors.find((candidate) =>
    candidate.body_id === reference.body_id
      && candidate.edge_id === reference.edge_id
      && candidate.endpoint === reference.endpoint,
  );
  const anchor = exact ?? projection.anchors.find((candidate) =>
    candidate.body_id === reference.body_id
      && candidate.edge_key === reference.edge_key
      && candidate.endpoint === reference.endpoint,
  );
  if (!anchor) return null;
  return {
    anchor,
    paper: drawingProjectedPointToPaper(view, projection, anchor.point),
    resolution: exact ? 'exact' : 'edge_key',
  };
}

export function linearDimensionGeometry(
  first: ResolvedDrawingAnchor,
  second: ResolvedDrawingAnchor,
  mode: DrawingLinearDimensionMode,
  offset: number,
  viewScale: number,
): DrawingDimensionGeometry | null {
  const a = first.paper;
  const b = second.paper;
  let dimensionStart: [number, number];
  let dimensionEnd: [number, number];
  let value: number;

  if (mode === 'horizontal') {
    if (Math.abs(b[0] - a[0]) < 1e-7) return null;
    dimensionStart = [a[0], a[1] + offset];
    dimensionEnd = [b[0], a[1] + offset];
    value = Math.abs(b[0] - a[0]) / viewScale;
  } else if (mode === 'vertical') {
    if (Math.abs(b[1] - a[1]) < 1e-7) return null;
    dimensionStart = [a[0] + offset, a[1]];
    dimensionEnd = [a[0] + offset, b[1]];
    value = Math.abs(b[1] - a[1]) / viewScale;
  } else {
    const delta = subtract(b, a);
    const length = magnitude(delta);
    if (length < 1e-7) return null;
    const normal: [number, number] = [-delta[1] / length, delta[0] / length];
    dimensionStart = add(a, scale(normal, offset));
    dimensionEnd = add(b, scale(normal, offset));
    value = distance3(first.anchor.model_point, second.anchor.model_point);
  }

  const dimensionVector = subtract(dimensionEnd, dimensionStart);
  const dimensionLength = magnitude(dimensionVector);
  if (dimensionLength < 1e-7 || !Number.isFinite(value)) return null;
  const direction = scale(dimensionVector, 1 / dimensionLength);
  let textAngle = Math.atan2(direction[1], direction[0]) * 180 / Math.PI;
  if (textAngle > 90 || textAngle < -90) textAngle += 180;

  return {
    first: a,
    second: b,
    dimensionStart,
    dimensionEnd,
    firstExtension: extensionLine(a, dimensionStart),
    secondExtension: extensionLine(b, dimensionEnd),
    textPosition: midpoint(dimensionStart, dimensionEnd),
    textAngle,
    arrowSize: Math.min(2.5, Math.max(1.4, dimensionLength * 0.12)),
    value,
  };
}

export function drawingDimensionText(
  value: number,
  precision: number,
  prefix: string,
  suffix: string,
  units: UnitSystem = 'mm',
): string {
  const converted = units === 'cm' ? value / 10 : units === 'in' ? value / 25.4 : value;
  const rounded = Math.abs(converted) < 0.5 * 10 ** -precision ? 0 : converted;
  return `${prefix}${rounded.toFixed(precision)} ${units}${suffix}`;
}

export function arrowPolygon(
  tip: [number, number],
  toward: [number, number],
  size: number,
): string {
  const vector = subtract(toward, tip);
  const length = magnitude(vector);
  if (length < 1e-7) return '';
  const direction = scale(vector, 1 / length);
  const normal: [number, number] = [-direction[1], direction[0]];
  const base = add(tip, scale(direction, size));
  const halfWidth = size * 0.38;
  const left = add(base, scale(normal, halfWidth));
  const right = add(base, scale(normal, -halfWidth));
  return `${pointText(tip)} ${pointText(left)} ${pointText(right)}`;
}

function extensionLine(
  anchor: [number, number],
  dimensionPoint: [number, number],
): [[number, number], [number, number]] {
  const vector = subtract(dimensionPoint, anchor);
  const length = magnitude(vector);
  if (length < 1e-7) return [anchor, dimensionPoint];
  const direction = scale(vector, 1 / length);
  return [
    add(anchor, scale(direction, Math.min(1, length * 0.2))),
    add(dimensionPoint, scale(direction, 1.2)),
  ];
}

function pointText(point: [number, number]): string {
  return `${round(point[0])},${round(point[1])}`;
}

function round(value: number): number {
  return Number(value.toFixed(5));
}

function add(left: [number, number], right: [number, number]): [number, number] {
  return [left[0] + right[0], left[1] + right[1]];
}

function subtract(left: [number, number], right: [number, number]): [number, number] {
  return [left[0] - right[0], left[1] - right[1]];
}

function scale(vector: [number, number], factor: number): [number, number] {
  return [vector[0] * factor, vector[1] * factor];
}

function magnitude(vector: [number, number]): number {
  return Math.hypot(vector[0], vector[1]);
}

function midpoint(left: [number, number], right: [number, number]): [number, number] {
  return [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2];
}

function distance3(left: [number, number, number], right: [number, number, number]): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}
