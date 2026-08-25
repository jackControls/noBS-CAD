import type {
  CamBoxAnchor,
  CamPoint2Dto,
  CamResolvedStockDto,
  CamSetupDto,
  CamStockBoxDto,
  CamStockFace,
  CamStockSpecDto,
  CamWcsOriginSpec,
  CamWorkCoordinateSystemDto,
  CylindricalSurfaceDto,
  PlaneBasis,
  Point3Dto,
  SketchDto,
  Vec2,
} from '../engine/types';
import type { CamHolePickHole } from '../store/appStore';

const CHAIN_TOLERANCE = 1.0e-6;
const ARC_TESSELLATION_DEGREES = 5;

/** A point entity drawn in a finished sketch, selectable as WCS/drill input. */
export interface SketchPointRef {
  sketch: string;
  entityId: number;
  uv: Vec2;
  label: string;
}

/** A closed loop chained from a finished sketch's curve entities. */
export interface SketchLoop {
  sketch: string;
  entityIds: number[];
  /** Closed outline in sketch UV, without a duplicated closing point. */
  points: Vec2[];
  area: number;
  label: string;
}

export function listSketchPointRefs(sketches: SketchDto[]): SketchPointRef[] {
  const refs: SketchPointRef[] = [];
  for (const sketch of sketches) {
    for (const entity of sketch.entities) {
      if (entity.kind !== 'point') continue;
      refs.push({
        sketch: sketch.name,
        entityId: entity.id,
        uv: entity.position,
        label: `${sketch.name} · point ${entity.id} (${entity.position.x.toFixed(2)}, ${entity.position.y.toFixed(2)})`,
      });
    }
  }
  return refs;
}

interface Segment {
  entityId: number;
  points: Vec2[];
}

/** Chain a sketch's curve entities into closed loops. Points are excluded;
 *  circles become loops on their own; open chains are not returned. */
export function listSketchLoops(sketches: SketchDto[]): SketchLoop[] {
  const loops: SketchLoop[] = [];
  for (const sketch of sketches) {
    const segments: Segment[] = [];
    for (const entity of sketch.entities) {
      switch (entity.kind) {
        case 'line':
          segments.push({ entityId: entity.id, points: [entity.start, entity.end] });
          break;
        case 'arc':
          segments.push({ entityId: entity.id, points: tessellateArc(entity) });
          break;
        case 'circle': {
          const ring = tessellateCircle(entity.center, entity.radius);
          loops.push({
            sketch: sketch.name,
            entityIds: [entity.id],
            points: ring,
            area: Math.abs(signedArea(ring)),
            label: `${sketch.name} · circle ${entity.id} (Ø${(entity.radius * 2).toFixed(2)})`,
          });
          break;
        }
        case 'spline':
          if (entity.tessellation.length >= 2) {
            segments.push({ entityId: entity.id, points: entity.tessellation });
          }
          break;
        default:
          break;
      }
    }
    loops.push(...chainLoops(sketch.name, segments, loops.length));
  }
  return loops.filter((loop) => loop.points.length >= 3 && loop.area > CHAIN_TOLERANCE);
}

function chainLoops(sketchName: string, segments: Segment[], existing: number): SketchLoop[] {
  const unused = new Set(segments.map((_, index) => index));
  const loops: SketchLoop[] = [];
  while (unused.size > 0) {
    const firstIndex = unused.values().next().value as number;
    unused.delete(firstIndex);
    const chain: Segment[] = [segments[firstIndex]];
    let path = [...segments[firstIndex].points];
    let closed = false;
    for (let guard = 0; guard <= segments.length + 1; guard += 1) {
      const end = path[path.length - 1];
      if (distance(path[0], end) <= CHAIN_TOLERANCE && path.length > 2) {
        closed = true;
        break;
      }
      let advanced = false;
      for (const index of [...unused]) {
        const candidate = segments[index];
        const candidateStart = candidate.points[0];
        const candidateEnd = candidate.points[candidate.points.length - 1];
        if (distance(end, candidateStart) <= CHAIN_TOLERANCE) {
          path = [...path, ...candidate.points.slice(1)];
        } else if (distance(end, candidateEnd) <= CHAIN_TOLERANCE) {
          path = [...path, ...[...candidate.points].reverse().slice(1)];
        } else {
          continue;
        }
        chain.push(candidate);
        unused.delete(index);
        advanced = true;
        break;
      }
      if (!advanced) break;
    }
    if (!closed) continue;
    const points = path.slice(0, -1);
    const area = Math.abs(signedArea(points));
    const number = loops.length + existing + 1;
    loops.push({
      sketch: sketchName,
      entityIds: chain.map((segment) => segment.entityId),
      points,
      area,
      label: `${sketchName} · loop ${number} (${points.length} pts)`,
    });
  }
  return loops;
}

function tessellateArc(entity: {
  center: Vec2;
  radius: number;
  start_angle: number;
  end_angle: number;
}): Vec2[] {
  let sweep = entity.end_angle - entity.start_angle;
  while (sweep <= 0) sweep += Math.PI * 2;
  const count = Math.max(
    4,
    Math.ceil((sweep * 180) / Math.PI / ARC_TESSELLATION_DEGREES),
  );
  const points: Vec2[] = [];
  for (let index = 0; index <= count; index += 1) {
    const angle = entity.start_angle + (sweep * index) / count;
    points.push({
      x: entity.center.x + Math.cos(angle) * entity.radius,
      y: entity.center.y + Math.sin(angle) * entity.radius,
    });
  }
  return points;
}

function tessellateCircle(center: Vec2, radius: number): Vec2[] {
  const count = Math.max(24, Math.ceil(360 / ARC_TESSELLATION_DEGREES));
  const points: Vec2[] = [];
  for (let index = 0; index < count; index += 1) {
    const angle = (Math.PI * 2 * index) / count;
    points.push({
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    });
  }
  return points;
}

function signedArea(points: Vec2[]): number {
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum * 0.5;
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function sketchUvToModel(basis: PlaneBasis, uv: Vec2): Point3Dto {
  return {
    x: basis.origin[0] + basis.u[0] * uv.x + basis.v[0] * uv.y,
    y: basis.origin[1] + basis.u[1] * uv.x + basis.v[1] * uv.y,
    z: basis.origin[2] + basis.u[2] * uv.x + basis.v[2] * uv.y,
  };
}

export function modelPointToSetup(
  point: Point3Dto,
  wcs: CamWorkCoordinateSystemDto,
): Point3Dto {
  const relative = [point.x - wcs.origin.x, point.y - wcs.origin.y, point.z - wcs.origin.z];
  const project = (axis: [number, number, number]) =>
    relative[0] * axis[0] + relative[1] * axis[1] + relative[2] * axis[2];
  return { x: project(wcs.x_axis), y: project(wcs.y_axis), z: project(wcs.z_axis) };
}

export function sketchPointToSetup(
  sketch: SketchDto,
  uv: Vec2,
  wcs: CamWorkCoordinateSystemDto,
): CamPoint2Dto {
  const setup = modelPointToSetup(sketchUvToModel(sketch.basis, uv), wcs);
  return { x: setup.x, y: setup.y };
}

export function loopToSetupPath(
  loop: SketchLoop,
  sketches: SketchDto[],
  wcs: CamWorkCoordinateSystemDto,
): CamPoint2Dto[] {
  const sketch = sketches.find((candidate) => candidate.name === loop.sketch);
  if (!sketch) throw new Error(`Sketch '${loop.sketch}' no longer exists.`);
  return loop.points.map((uv) => sketchPointToSetup(sketch, uv, wcs));
}

export interface Bounds3 {
  min: Point3Dto;
  max: Point3Dto;
}

/** Bounding box of the given bodies' meshes in model coordinates. */
export function modelBoundsOfBodies(
  scene: { bodies: Array<{ id: number; mesh: { positions: number[] } }> },
  bodyIds: number[],
): Bounds3 | null {
  const wanted = new Set(bodyIds);
  let found = false;
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const body of scene.bodies) {
    if (!wanted.has(body.id)) continue;
    const positions = body.mesh.positions;
    for (let index = 0; index + 2 < positions.length; index += 3) {
      found = true;
      min.x = Math.min(min.x, positions[index]);
      min.y = Math.min(min.y, positions[index + 1]);
      min.z = Math.min(min.z, positions[index + 2]);
      max.x = Math.max(max.x, positions[index]);
      max.y = Math.max(max.y, positions[index + 1]);
      max.z = Math.max(max.z, positions[index + 2]);
    }
  }
  return found ? { min, max } : null;
}

/** Setup-space Z of the model's top surface (max model Z across the setup's
 *  bodies), or null when the setup references no bodies. Fixed-axis WCS
 *  frames keep their Z axis parallel to model Z, so one probe point on the
 *  top plane pins the setup Z of that whole plane. */
export function modelTopZInSetup(
  scene: { bodies: Array<{ id: number; mesh: { positions: number[] } }> },
  setup: CamSetupDto,
): number | null {
  const bounds = modelBoundsOfBodies(scene, setup.body_ids);
  if (!bounds) return null;
  return modelPointToSetup({ x: bounds.min.x, y: bounds.min.y, z: bounds.max.z }, setup.wcs).z;
}

/** Setup-space Z of the model's bottom surface; same fixed-axis reasoning
 *  as `modelTopZInSetup`. */
export function modelBottomZInSetup(
  scene: { bodies: Array<{ id: number; mesh: { positions: number[] } }> },
  setup: CamSetupDto,
): number | null {
  const bounds = modelBoundsOfBodies(scene, setup.body_ids);
  if (!bounds) return null;
  return modelPointToSetup({ x: bounds.min.x, y: bounds.min.y, z: bounds.min.z }, setup.wcs).z;
}

/** Convert a cylindrical solid face into a pickable hole, or null when the
 *  face cannot be drilled in the current fixed-axis frame: only faces whose
 *  axis is parallel to setup Z are pickable today. The axis is still computed
 *  (same projection as modelPointToSetup) and recorded on the returned pick,
 *  so indexed (4-axis) / 5-axis machining can relax this one check and
 *  consume per-hole tool orientation without touching the picking pipeline.
 *  The marker point sits on the axis at the stock top plane; the operation
 *  input is the axis position in setup-space X/Y. */
export function camHoleFromCylinderFace(
  bodyId: number,
  faceId: number,
  cylinder: CylindricalSurfaceDto,
  setup: CamSetupDto,
): CamHolePickHole | null {
  const center = modelPointToSetup(cylinder.origin, setup.wcs);
  // Direction vectors rotate into setup space without the origin shift, using
  // the same projection as modelPointToSetup: setup[i] = dot(model, axis[i]).
  const wcs = setup.wcs;
  const axis: [number, number, number] = [
    cylinder.axis.x * wcs.x_axis[0] + cylinder.axis.y * wcs.x_axis[1] + cylinder.axis.z * wcs.x_axis[2],
    cylinder.axis.x * wcs.y_axis[0] + cylinder.axis.y * wcs.y_axis[1] + cylinder.axis.z * wcs.y_axis[2],
    cylinder.axis.x * wcs.z_axis[0] + cylinder.axis.y * wcs.z_axis[1] + cylinder.axis.z * wcs.z_axis[2],
  ];
  const parallel = Math.abs(axis[2]) > 1 - 1e-6;
  // Fixed-axis planning drills along setup Z only: tilted faces are NOT
  // pickable today. The axis is still computed above (same projection as
  // modelPointToSetup) and stays on the returned pick, so the indexed/5-axis
  // roadmap can relax this single check and immediately consume per-hole
  // tool orientation without touching the picking pipeline.
  if (!parallel) return null;
  // Setup-Z holes mark at the stock top plane (always visible above the
  // part); the face's axis origin is the right anchor once tilted holes
  // become machinable.
  const marker = setupPointToModel(
    { x: center.x, y: center.y, z: setup.stock.max.z },
    setup.wcs,
  );
  return {
    key: `${bodyId}:${faceId}`,
    bodyId,
    faceId,
    radius: cylinder.radius,
    modelPoint: marker,
    point: { x: center.x, y: center.y },
    axis,
  };
}

function anchorValue(min: number, max: number, anchor: 'min' | 'center' | 'max'): number {
  if (anchor === 'center') return (min + max) * 0.5;
  return anchor === 'max' ? max : min;
}

/** Resolve the operator's WCS origin choice into model coordinates. */
export function resolveWcsOrigin(
  spec: CamWcsOriginSpec,
  stockModelBox: CamStockBoxDto,
  modelBounds: Bounds3 | null,
  sketches: SketchDto[],
): Point3Dto {
  switch (spec.mode) {
    case 'stock_box_point':
      return {
        x: anchorValue(stockModelBox.min.x, stockModelBox.max.x, spec.x),
        y: anchorValue(stockModelBox.min.y, stockModelBox.max.y, spec.y),
        z: anchorValue(stockModelBox.min.z, stockModelBox.max.z, spec.z),
      };
    case 'model_box_point': {
      if (!modelBounds) {
        throw new Error('The setup bodies have no model geometry to anchor the WCS to.');
      }
      return {
        x: anchorValue(modelBounds.min.x, modelBounds.max.x, spec.x),
        y: anchorValue(modelBounds.min.y, modelBounds.max.y, spec.y),
        z: anchorValue(modelBounds.min.z, modelBounds.max.z, spec.z),
      };
    }
    case 'sketch_point': {
      const sketch = sketches.find((candidate) => candidate.name === spec.sketch);
      const point = sketch?.entities.find(
        (entity) => entity.kind === 'point' && entity.id === spec.entity_id,
      );
      if (!sketch || !point || point.kind !== 'point') {
        throw new Error('The selected WCS sketch point no longer exists; pick it again.');
      }
      return sketchUvToModel(sketch.basis, point.position);
    }
    default:
      throw new Error('Explicit WCS origins carry their coordinates directly.');
  }
}

/** Build an axis-aligned fixed milling frame: model Z up or down, with the
 *  XY plane rotated about model Z in 90 degree steps. */
export function wcsFromOrientation(
  origin: Point3Dto,
  zDown: boolean,
  zRotationDeg: 0 | 90 | 180 | 270,
): CamWorkCoordinateSystemDto {
  const radians = (zRotationDeg * Math.PI) / 180;
  const cos = Math.round(Math.cos(radians));
  const sin = Math.round(Math.sin(radians));
  if (zDown) {
    return {
      origin,
      x_axis: [cos, sin, 0],
      y_axis: [sin, -cos, 0],
      z_axis: [0, 0, -1],
    };
  }
  return {
    origin,
    x_axis: [cos, sin, 0],
    y_axis: [-sin, cos, 0],
    z_axis: [0, 0, 1],
  };
}

/** Express a model-space stock box in setup coordinates. */
export function stockToSetup(
  modelBox: CamStockBoxDto,
  wcs: CamWorkCoordinateSystemDto,
): CamStockBoxDto {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const x of [modelBox.min.x, modelBox.max.x]) {
    for (const y of [modelBox.min.y, modelBox.max.y]) {
      for (const z of [modelBox.min.z, modelBox.max.z]) {
        const point = modelPointToSetup({ x, y, z }, wcs);
        min.x = Math.min(min.x, point.x);
        min.y = Math.min(min.y, point.y);
        min.z = Math.min(min.z, point.z);
        max.x = Math.max(max.x, point.x);
        max.y = Math.max(max.y, point.y);
        max.z = Math.max(max.z, point.z);
      }
    }
  }
  return { min, max };
}

// --- Stock resolution ------------------------------------------------------
//
// The operator defines stock in one of three ways (fixed size with the model
// placed inside, grown from the model box by allowances, or inherited from an
// earlier setup's remaining material), in one of four shapes (box, cylinder,
// hex bar, or a modeled body). Resolution happens here in the host because it
// needs the live scene; the resolved envelope and shape persist on the setup
// so the engine never re-derives anything behind the operator's back.

export interface StockLatticePoint {
  point: Point3Dto;
  x: CamBoxAnchor;
  y: CamBoxAnchor;
  z: CamBoxAnchor;
  label: string;
}

/** The 27 lattice points of a bounding box: 8 corners, 12 edge midpoints,
 *  6 face centers, and the volume center. */
export function boxLatticePoints(box: CamStockBoxDto): StockLatticePoint[] {
  const anchors: Array<{ anchor: CamBoxAnchor; value: (min: number, max: number) => number; label: string }> = [
    { anchor: 'min', value: (min) => min, label: 'min' },
    { anchor: 'center', value: (min, max) => (min + max) * 0.5, label: 'mid' },
    { anchor: 'max', value: (_min, max) => max, label: 'max' },
  ];
  const points: StockLatticePoint[] = [];
  for (const x of anchors) {
    for (const y of anchors) {
      for (const z of anchors) {
        points.push({
          point: {
            x: x.value(box.min.x, box.max.x),
            y: y.value(box.min.y, box.max.y),
            z: z.value(box.min.z, box.max.z),
          },
          x: x.anchor,
          y: y.anchor,
          z: z.anchor,
          label: `X ${x.label} · Y ${y.label} · Z ${z.label}`,
        });
      }
    }
  }
  return points;
}

export interface ResolvedStock {
  /** Stock envelope in model coordinates. */
  modelBox: CamStockBoxDto;
  /** Resolved setup-space shape once the WCS frame is known. */
  resolve: (wcs: CamWorkCoordinateSystemDto) => CamResolvedStockDto;
}

const SQRT3 = Math.sqrt(3);

function boxFromCenterSize(center: { x: number; y: number }, zMin: number, sx: number, sy: number, sz: number): CamStockBoxDto {
  return {
    min: { x: center.x - sx / 2, y: center.y - sy / 2, z: zMin },
    max: { x: center.x + sx / 2, y: center.y + sy / 2, z: zMin + sz },
  };
}

/** Express a setup-space point in model coordinates (inverse of
 *  `modelPointToSetup`). Toolpaths, stock envelopes, and simulation meshes are
 *  produced in setup coordinates; the shared viewport renders model space. */
export function setupPointToModel(
  point: Point3Dto,
  wcs: CamWorkCoordinateSystemDto,
): Point3Dto {
  return {
    x: wcs.origin.x + point.x * wcs.x_axis[0] + point.y * wcs.y_axis[0] + point.z * wcs.z_axis[0],
    y: wcs.origin.y + point.x * wcs.x_axis[1] + point.y * wcs.y_axis[1] + point.z * wcs.z_axis[1],
    z: wcs.origin.z + point.x * wcs.x_axis[2] + point.y * wcs.y_axis[2] + point.z * wcs.z_axis[2],
  };
}

/** Express a setup-space stock envelope back in model coordinates. */
export function setupBoxToModel(
  setupBox: CamStockBoxDto,
  wcs: CamWorkCoordinateSystemDto,
): CamStockBoxDto {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  const toModel = (point: Point3Dto): Point3Dto => setupPointToModel(point, wcs);
  for (const x of [setupBox.min.x, setupBox.max.x]) {
    for (const y of [setupBox.min.y, setupBox.max.y]) {
      for (const z of [setupBox.min.z, setupBox.max.z]) {
        const point = toModel({ x, y, z });
        min.x = Math.min(min.x, point.x);
        min.y = Math.min(min.y, point.y);
        min.z = Math.min(min.z, point.z);
        max.x = Math.max(max.x, point.x);
        max.y = Math.max(max.y, point.y);
        max.z = Math.max(max.z, point.z);
      }
    }
  }
  return { min, max };
}

/** True when the WCS XY rotation swaps the hex footprint's model-space
 *  extents: hex flats are perpendicular to the setup X axis, so a 90/270
 *  degree rotation turns the across-flats extent onto model Y. */
function hexSwapped(zRotationDeg: 0 | 90 | 180 | 270): boolean {
  return zRotationDeg === 90 || zRotationDeg === 270;
}

/** Resolve the operator's stock definition to a model-space envelope plus a
 *  resolver for the persisted setup-space shape. Throws on incomplete input;
 *  callers surface the message in the dialog. `zRotationDeg` is the setup's
 *  XY rotation about model Z; it matters for hex stock because the hexagon
 *  orientation is defined in setup coordinates (flats perpendicular to the
 *  setup X axis). */
export function resolveStock(
  spec: CamStockSpecDto,
  modelBounds: Bounds3 | null,
  sourceSetup: CamSetupDto | null,
  zRotationDeg: 0 | 90 | 180 | 270,
): ResolvedStock {
  switch (spec.mode) {
    case 'fixed': {
      if (!modelBounds) {
        throw new Error('Fixed-size stock is placed around the model; select setup bodies first.');
      }
      const { shape, size, placement } = spec;
      if (size.x <= 0 || size.z <= 0 || (shape === 'box' && size.y <= 0)) {
        throw new Error('Fixed stock needs positive dimensions.');
      }
      const modelCenter = {
        x: (modelBounds.min.x + modelBounds.max.x) * 0.5,
        y: (modelBounds.min.y + modelBounds.max.y) * 0.5,
      };
      // Full XY footprint for cylinder/hex envelopes. Hex: flats
      // perpendicular to setup X give across-flats along setup X and vertex
      // reach AF/sqrt(3) along setup Y; a 90/270 degree XY rotation swaps
      // those extents in model space.
      const hexSx = hexSwapped(zRotationDeg) ? (2 * size.x) / SQRT3 : size.x;
      const hexSy = hexSwapped(zRotationDeg) ? size.x : (2 * size.x) / SQRT3;
      const footprint = {
        box: { sx: size.x, sy: size.y },
        cylinder: { sx: size.x, sy: size.x },
        hex: { sx: hexSx, sy: hexSy },
        model_body: { sx: size.x, sy: size.y },
      }[shape];
      const box = { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
      const face = placement.center ? null : placement.face;
      const gap = placement.offset;
      const placeAxis = (
        axis: 'x' | 'y' | 'z',
        extent: number,
        centerValue: number,
        modelMin: number,
        modelMax: number,
      ) => {
        const faceMin = `${axis}_min` as CamStockFace;
        const faceMax = `${axis}_max` as CamStockFace;
        if (face === faceMin) {
          box.min[axis] = modelMin - gap;
          box.max[axis] = box.min[axis] + extent;
        } else if (face === faceMax) {
          box.max[axis] = modelMax + gap;
          box.min[axis] = box.max[axis] - extent;
        } else if (axis === 'z') {
          // Uncentered Z defaults to the model floor: extra material on top.
          box.min.z = modelMin;
          box.max.z = modelMin + extent;
        } else {
          box.min[axis] = centerValue - extent / 2;
          box.max[axis] = centerValue + extent / 2;
        }
      };
      placeAxis('x', footprint.sx, modelCenter.x, modelBounds.min.x, modelBounds.max.x);
      placeAxis('y', footprint.sy, modelCenter.y, modelBounds.min.y, modelBounds.max.y);
      placeAxis('z', size.z, 0, modelBounds.min.z, modelBounds.max.z);
      if (shape === 'box') return { modelBox: box, resolve: () => ({ shape: 'box' }) };
      const radius = shape === 'cylinder' ? size.x / 2 : 0;
      const center2 = {
        x: (box.min.x + box.max.x) * 0.5,
        y: (box.min.y + box.max.y) * 0.5,
      };
      return {
        modelBox: box,
        resolve: (wcs) => {
          const center = modelPointToSetup({ x: center2.x, y: center2.y, z: box.min.z }, wcs);
          return shape === 'cylinder'
            ? { shape: 'cylinder', center: { x: center.x, y: center.y }, radius }
            : { shape: 'hex', center: { x: center.x, y: center.y }, across_flats: size.x };
        },
      };
    }
    case 'from_model': {
      if (!modelBounds) {
        throw new Error('Model-grown stock needs the setup bodies selected first.');
      }
      const { shape, offsets } = spec;
      const radial = Math.max(offsets.x_min, offsets.x_max, offsets.y_min, offsets.y_max);
      const zMin = modelBounds.min.z - offsets.z_min;
      const zMax = modelBounds.max.z + offsets.z_max;
      if (shape === 'box') {
        return {
          modelBox: {
            min: {
              x: modelBounds.min.x - offsets.x_min,
              y: modelBounds.min.y - offsets.y_min,
              z: zMin,
            },
            max: {
              x: modelBounds.max.x + offsets.x_max,
              y: modelBounds.max.y + offsets.y_max,
              z: zMax,
            },
          },
          resolve: () => ({ shape: 'box' }),
        };
      }
      const center = {
        x: (modelBounds.min.x + modelBounds.max.x) * 0.5,
        y: (modelBounds.min.y + modelBounds.max.y) * 0.5,
      };
      const halfX = (modelBounds.max.x - modelBounds.min.x) * 0.5;
      const halfY = (modelBounds.max.y - modelBounds.min.y) * 0.5;
      if (shape === 'cylinder') {
        const radius = Math.hypot(halfX, halfY) + radial;
        return {
          modelBox: boxFromCenterSize(center, zMin, radius * 2, radius * 2, zMax - zMin),
          resolve: (wcs) => {
            const point = modelPointToSetup({ x: center.x, y: center.y, z: zMin }, wcs);
            return { shape: 'cylinder', center: { x: point.x, y: point.y }, radius };
          },
        };
      }
      // Hex: cover the XY box corners under the slab tests evaluated in the
      // setup frame (flats perpendicular to setup X), then add the radial
      // allowance on the flats. The model-space envelope is the hexagon's
      // axis-aligned reach, which swaps under a 90/270 degree XY rotation.
      const radians = (zRotationDeg * Math.PI) / 180;
      const cosR = Math.round(Math.cos(radians));
      const sinR = Math.round(Math.sin(radians));
      let need = 0;
      for (const dx of [halfX, -halfX]) {
        for (const dy of [halfY, -halfY]) {
          const dsx = Math.abs(dx * cosR + dy * sinR);
          const dsy = Math.abs(-dx * sinR + dy * cosR);
          need = Math.max(need, dsx, dsx * 0.5 + dsy * (SQRT3 * 0.5));
        }
      }
      const acrossFlats = need * 2 + radial * 2;
      const hexHx = hexSwapped(zRotationDeg) ? acrossFlats / SQRT3 : acrossFlats / 2;
      const hexHy = hexSwapped(zRotationDeg) ? acrossFlats / 2 : acrossFlats / SQRT3;
      return {
        modelBox: boxFromCenterSize(center, zMin, hexHx * 2, hexHy * 2, zMax - zMin),
        resolve: (wcs) => {
          const point = modelPointToSetup({ x: center.x, y: center.y, z: zMin }, wcs);
          return { shape: 'hex', center: { x: point.x, y: point.y }, across_flats: acrossFlats };
        },
      };
    }
    case 'rest_from_setup': {
      if (!sourceSetup) {
        throw new Error('Pick the earlier setup whose remaining stock this setup continues from.');
      }
      const modelBox = sourceSetup.stock_model_box ?? setupBoxToModel(sourceSetup.stock, sourceSetup.wcs);
      return {
        modelBox,
        resolve: () => ({ shape: 'rest', source_setup_id: sourceSetup.id }),
      };
    }
    case 'model_body': {
      if (!modelBounds) {
        throw new Error('The modeled stock body has no mesh to measure.');
      }
      const bodyId = spec.body_id;
      return {
        modelBox: {
          min: { ...modelBounds.min },
          max: { ...modelBounds.max },
        },
        resolve: () => ({ shape: 'model_body', body_id: bodyId }),
      };
    }
    default:
      throw new Error('Legacy stock boxes are edited through the resolved envelope.');
  }
}
