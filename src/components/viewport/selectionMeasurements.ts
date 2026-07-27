import type {
  BodyDto,
  EdgeDto,
  EntityDto,
  FaceDto,
  Point3Dto,
  SketchDto,
  SolidSceneDto,
} from '../../engine/types';

export type MeasurementUnit = 'mm' | 'mm2' | 'mm3' | 'deg';

export type MeasurementLabel =
  | 'x'
  | 'y'
  | 'length'
  | 'totalLength'
  | 'distance'
  | 'minimumDistance'
  | 'centerDistance'
  | 'angle'
  | 'radius'
  | 'diameter'
  | 'circumference'
  | 'arcLength'
  | 'sweep'
  | 'area'
  | 'totalArea'
  | 'perimeter'
  | 'totalPerimeter'
  | 'size'
  | 'surfaceArea'
  | 'totalSurfaceArea'
  | 'volume'
  | 'totalVolume';

export type SelectionKind =
  | 'point'
  | 'line'
  | 'circle'
  | 'arc'
  | 'spline'
  | 'objects'
  | 'edge'
  | 'edges'
  | 'face'
  | 'faces'
  | 'body'
  | 'bodies'
  | 'features';

export interface MeasurementRow {
  label: MeasurementLabel;
  value: number | number[];
  unit: MeasurementUnit;
  /** Solid topology and spline values derived from display tessellation. */
  approximate?: boolean;
}

export interface SelectionMeasurement {
  kind: SelectionKind;
  count?: number;
  name?: string;
  rows: MeasurementRow[];
}

const TAU = Math.PI * 2;
const EPSILON = 1e-9;

function distance2(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function polylineLength2(points: Array<{ x: number; y: number }>): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += distance2(points[index - 1], points[index]);
  }
  return length;
}

function cross2(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function pointSegmentDistance2(
  point: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= EPSILON) return distance2(point, a);
  const parameter = Math.max(
    0,
    Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared),
  );
  return distance2(point, {
    x: a.x + dx * parameter,
    y: a.y + dy * parameter,
  });
}

function segmentSegmentDistance2(
  a0: { x: number; y: number },
  a1: { x: number; y: number },
  b0: { x: number; y: number },
  b1: { x: number; y: number },
): number {
  const o1 = cross2(a0, a1, b0);
  const o2 = cross2(a0, a1, b1);
  const o3 = cross2(b0, b1, a0);
  const o4 = cross2(b0, b1, a1);
  const crosses =
    ((o1 > EPSILON && o2 < -EPSILON) || (o1 < -EPSILON && o2 > EPSILON)) &&
    ((o3 > EPSILON && o4 < -EPSILON) || (o3 < -EPSILON && o4 > EPSILON));
  const touches =
    (Math.abs(o1) <= EPSILON && pointSegmentDistance2(b0, a0, a1) <= EPSILON) ||
    (Math.abs(o2) <= EPSILON && pointSegmentDistance2(b1, a0, a1) <= EPSILON) ||
    (Math.abs(o3) <= EPSILON && pointSegmentDistance2(a0, b0, b1) <= EPSILON) ||
    (Math.abs(o4) <= EPSILON && pointSegmentDistance2(a1, b0, b1) <= EPSILON);
  if (crosses || touches) return 0;
  return Math.min(
    pointSegmentDistance2(a0, b0, b1),
    pointSegmentDistance2(a1, b0, b1),
    pointSegmentDistance2(b0, a0, a1),
    pointSegmentDistance2(b1, a0, a1),
  );
}

function polylineDistance2(
  a: Array<{ x: number; y: number }>,
  b: Array<{ x: number; y: number }>,
): number {
  if (a.length === 0 || b.length === 0) return Infinity;
  if (a.length === 1 && b.length === 1) return distance2(a[0], b[0]);
  if (a.length === 1) {
    let minimum = Infinity;
    for (let index = 1; index < b.length; index += 1) {
      minimum = Math.min(minimum, pointSegmentDistance2(a[0], b[index - 1], b[index]));
    }
    return minimum;
  }
  if (b.length === 1) return polylineDistance2(b, a);
  let minimum = Infinity;
  for (let aIndex = 1; aIndex < a.length; aIndex += 1) {
    for (let bIndex = 1; bIndex < b.length; bIndex += 1) {
      minimum = Math.min(
        minimum,
        segmentSegmentDistance2(
          a[aIndex - 1],
          a[aIndex],
          b[bIndex - 1],
          b[bIndex],
        ),
      );
      if (minimum <= EPSILON) return 0;
    }
  }
  return minimum;
}

function entityPolyline(entity: EntityDto): Array<{ x: number; y: number }> {
  switch (entity.kind) {
    case 'point':
      return [entity.position];
    case 'line':
      return [entity.start, entity.end];
    case 'circle': {
      const points: Array<{ x: number; y: number }> = [];
      for (let index = 0; index <= 96; index += 1) {
        const angle = (index / 96) * TAU;
        points.push({
          x: entity.center.x + Math.cos(angle) * entity.radius,
          y: entity.center.y + Math.sin(angle) * entity.radius,
        });
      }
      return points;
    }
    case 'arc': {
      let sweep = entity.end_angle - entity.start_angle;
      while (sweep <= 0) sweep += TAU;
      while (sweep > TAU) sweep -= TAU;
      const steps = Math.max(12, Math.ceil(sweep / (Math.PI / 48)));
      return Array.from({ length: steps + 1 }, (_, index) => {
        const angle = entity.start_angle + (sweep * index) / steps;
        return {
          x: entity.center.x + Math.cos(angle) * entity.radius,
          y: entity.center.y + Math.sin(angle) * entity.radius,
        };
      });
    }
    case 'spline':
      return entity.tessellation;
  }
}

function acuteAngle2(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number | null {
  const aLength = Math.hypot(a.x, a.y);
  const bLength = Math.hypot(b.x, b.y);
  if (aLength <= EPSILON || bLength <= EPSILON) return null;
  const cosine = Math.max(
    -1,
    Math.min(1, Math.abs((a.x * b.x + a.y * b.y) / (aLength * bLength))),
  );
  return Math.acos(cosine) * (180 / Math.PI);
}

function sketchPairRows(a: EntityDto, b: EntityDto): MeasurementRow[] {
  if (a.kind === 'point' && b.kind === 'point') {
    return [{ label: 'distance', value: distance2(a.position, b.position), unit: 'mm' }];
  }
  if (a.kind === 'circle' && b.kind === 'circle') {
    const centerDistance = distance2(a.center, b.center);
    const minimumDistance =
      centerDistance > a.radius + b.radius
        ? centerDistance - a.radius - b.radius
        : centerDistance < Math.abs(a.radius - b.radius)
          ? Math.abs(a.radius - b.radius) - centerDistance
          : 0;
    return [
      { label: 'centerDistance', value: centerDistance, unit: 'mm' },
      { label: 'minimumDistance', value: minimumDistance, unit: 'mm' },
    ];
  }

  const minimumDistance = polylineDistance2(entityPolyline(a), entityPolyline(b));
  const rows: MeasurementRow[] = Number.isFinite(minimumDistance)
    ? [
        {
          label: 'minimumDistance',
          value: minimumDistance,
          unit: 'mm',
          approximate:
            a.kind === 'arc' ||
            a.kind === 'circle' ||
            a.kind === 'spline' ||
            b.kind === 'arc' ||
            b.kind === 'circle' ||
            b.kind === 'spline',
        },
      ]
    : [];
  if (a.kind === 'line' && b.kind === 'line') {
    const angle = acuteAngle2(
      { x: a.end.x - a.start.x, y: a.end.y - a.start.y },
      { x: b.end.x - b.start.x, y: b.end.y - b.start.y },
    );
    if (angle !== null) rows.push({ label: 'angle', value: angle, unit: 'deg' });
  }
  return rows;
}

function entityLength(entity: EntityDto): { value: number; approximate: boolean } | null {
  switch (entity.kind) {
    case 'line':
      return { value: distance2(entity.start, entity.end), approximate: false };
    case 'circle':
      return { value: TAU * entity.radius, approximate: false };
    case 'arc': {
      let sweep = entity.end_angle - entity.start_angle;
      while (sweep <= 0) sweep += TAU;
      while (sweep > TAU) sweep -= TAU;
      return { value: sweep * entity.radius, approximate: false };
    }
    case 'spline':
      return { value: polylineLength2(entity.tessellation), approximate: true };
    case 'point':
      return null;
  }
}

function sketchEntityMeasurement(entity: EntityDto): SelectionMeasurement {
  switch (entity.kind) {
    case 'point':
      return {
        kind: 'point',
        rows: [
          { label: 'x', value: entity.position.x, unit: 'mm' },
          { label: 'y', value: entity.position.y, unit: 'mm' },
        ],
      };
    case 'line': {
      const dx = entity.end.x - entity.start.x;
      const dy = entity.end.y - entity.start.y;
      return {
        kind: 'line',
        rows: [
          { label: 'length', value: Math.hypot(dx, dy), unit: 'mm' },
          { label: 'angle', value: Math.atan2(dy, dx) * (180 / Math.PI), unit: 'deg' },
        ],
      };
    }
    case 'circle':
      return {
        kind: 'circle',
        rows: [
          { label: 'radius', value: entity.radius, unit: 'mm' },
          { label: 'diameter', value: entity.radius * 2, unit: 'mm' },
          { label: 'circumference', value: TAU * entity.radius, unit: 'mm' },
          { label: 'area', value: Math.PI * entity.radius * entity.radius, unit: 'mm2' },
        ],
      };
    case 'arc': {
      let sweep = entity.end_angle - entity.start_angle;
      while (sweep <= 0) sweep += TAU;
      while (sweep > TAU) sweep -= TAU;
      return {
        kind: 'arc',
        rows: [
          { label: 'radius', value: entity.radius, unit: 'mm' },
          { label: 'arcLength', value: entity.radius * sweep, unit: 'mm' },
          { label: 'sweep', value: sweep * (180 / Math.PI), unit: 'deg' },
        ],
      };
    }
    case 'spline':
      return {
        kind: 'spline',
        rows: [
          {
            label: 'length',
            value: polylineLength2(entity.tessellation),
            unit: 'mm',
            approximate: true,
          },
        ],
      };
  }
}

export function measureSketchSelection(
  sketch: SketchDto | null,
  selectedEntity: number | null,
  selectedEntities: number[],
): SelectionMeasurement | null {
  if (!sketch) return null;
  const ids = new Set(selectedEntities);
  if (selectedEntity !== null) ids.add(selectedEntity);
  const entities = [...ids]
    .map((id) => sketch.entities.find((entity) => entity.id === id))
    .filter((entity): entity is EntityDto => entity !== undefined);
  if (entities.length === 0) return null;
  if (entities.length === 1) return sketchEntityMeasurement(entities[0]);

  const lengths = entities
    .map(entityLength)
    .filter((measurement): measurement is { value: number; approximate: boolean } => measurement !== null);
  const rows: MeasurementRow[] =
    lengths.length > 0
      ? [
          {
            label: 'totalLength',
            value: lengths.reduce((sum, measurement) => sum + measurement.value, 0),
            unit: 'mm',
            approximate: lengths.some((measurement) => measurement.approximate),
          },
        ]
      : [];
  if (entities.length === 2) rows.push(...sketchPairRows(entities[0], entities[1]));
  return {
    kind: 'objects',
    count: entities.length,
    rows,
  };
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

function sub3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function dot3(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross3(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function scale3(vector: Vec3, scale: number): Vec3 {
  return { x: vector.x * scale, y: vector.y * scale, z: vector.z * scale };
}

function add3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function length3(vector: Vec3): number {
  return Math.hypot(vector.x, vector.y, vector.z);
}

function distance3(a: Vec3, b: Vec3): number {
  return length3(sub3(a, b));
}

function pointSegmentDistance3(point: Vec3, a: Vec3, b: Vec3): number {
  const segment = sub3(b, a);
  const lengthSquared = dot3(segment, segment);
  if (lengthSquared <= EPSILON) return distance3(point, a);
  const parameter = Math.max(
    0,
    Math.min(1, dot3(sub3(point, a), segment) / lengthSquared),
  );
  return distance3(point, add3(a, scale3(segment, parameter)));
}

/** Shortest distance between two finite 3D segments. */
function segmentSegmentDistance3(p0: Vec3, p1: Vec3, q0: Vec3, q1: Vec3): number {
  const u = sub3(p1, p0);
  const v = sub3(q1, q0);
  const w = sub3(p0, q0);
  const a = dot3(u, u);
  const b = dot3(u, v);
  const c = dot3(v, v);
  const d = dot3(u, w);
  const e = dot3(v, w);
  const denominator = a * c - b * b;
  let sNumerator: number;
  let sDenominator = denominator;
  let tNumerator: number;
  let tDenominator = denominator;

  if (a <= EPSILON) return pointSegmentDistance3(p0, q0, q1);
  if (c <= EPSILON) return pointSegmentDistance3(q0, p0, p1);
  if (denominator <= EPSILON) {
    sNumerator = 0;
    sDenominator = 1;
    tNumerator = e;
    tDenominator = c;
  } else {
    sNumerator = b * e - c * d;
    tNumerator = a * e - b * d;
    if (sNumerator < 0) {
      sNumerator = 0;
      tNumerator = e;
      tDenominator = c;
    } else if (sNumerator > sDenominator) {
      sNumerator = sDenominator;
      tNumerator = e + b;
      tDenominator = c;
    }
  }

  if (tNumerator < 0) {
    tNumerator = 0;
    if (-d < 0) sNumerator = 0;
    else if (-d > a) sNumerator = sDenominator;
    else {
      sNumerator = -d;
      sDenominator = a;
    }
  } else if (tNumerator > tDenominator) {
    tNumerator = tDenominator;
    if (-d + b < 0) sNumerator = 0;
    else if (-d + b > a) sNumerator = sDenominator;
    else {
      sNumerator = -d + b;
      sDenominator = a;
    }
  }

  const s = Math.abs(sNumerator) <= EPSILON ? 0 : sNumerator / sDenominator;
  const t = Math.abs(tNumerator) <= EPSILON ? 0 : tNumerator / tDenominator;
  return length3(sub3(add3(w, scale3(u, s)), scale3(v, t)));
}

function polylineDistance3(a: Point3Dto[], b: Point3Dto[]): number {
  if (a.length === 0 || b.length === 0) return Infinity;
  if (a.length === 1 && b.length === 1) return distance3(a[0], b[0]);
  if (a.length === 1) {
    let minimum = Infinity;
    for (let index = 1; index < b.length; index += 1) {
      minimum = Math.min(minimum, pointSegmentDistance3(a[0], b[index - 1], b[index]));
    }
    return minimum;
  }
  if (b.length === 1) return polylineDistance3(b, a);
  let minimum = Infinity;
  for (let aIndex = 1; aIndex < a.length; aIndex += 1) {
    for (let bIndex = 1; bIndex < b.length; bIndex += 1) {
      minimum = Math.min(
        minimum,
        segmentSegmentDistance3(
          a[aIndex - 1],
          a[aIndex],
          b[bIndex - 1],
          b[bIndex],
        ),
      );
      if (minimum <= EPSILON) return 0;
    }
  }
  return minimum;
}

function straightPolylineDirection(points: Point3Dto[]): Vec3 | null {
  if (points.length < 2) return null;
  const start = points[0];
  const end = points[points.length - 1];
  const direction = sub3(end, start);
  const length = length3(direction);
  if (length <= EPSILON) return null;
  const tolerance = Math.max(1e-6, length * 1e-5);
  if (
    points.some(
      (point) => length3(cross3(sub3(point, start), direction)) / length > tolerance,
    )
  ) {
    return null;
  }
  return scale3(direction, 1 / length);
}

function acuteAngle3(a: Vec3, b: Vec3): number | null {
  const aLength = length3(a);
  const bLength = length3(b);
  if (aLength <= EPSILON || bLength <= EPSILON) return null;
  const cosine = Math.max(
    -1,
    Math.min(1, Math.abs(dot3(a, b) / (aLength * bLength))),
  );
  return Math.acos(cosine) * (180 / Math.PI);
}

function meshPoint(body: BodyDto, vertexIndex: number): Point3Dto | null {
  const offset = vertexIndex * 3;
  const { positions } = body.mesh;
  if (offset < 0 || offset + 2 >= positions.length) return null;
  return {
    x: positions[offset],
    y: positions[offset + 1],
    z: positions[offset + 2],
  };
}

function triangleArea(a: Vec3, b: Vec3, c: Vec3): number {
  return length3(cross3(sub3(b, a), sub3(c, a))) / 2;
}

function edgePolylineLength(edge: EdgeDto): number {
  let length = 0;
  for (let index = 1; index < edge.points.length; index += 1) {
    length += distance3(edge.points[index - 1], edge.points[index]);
  }
  return length;
}

interface CircularEdgeFit {
  radius: number;
  arcLength: number;
}

/**
 * Detect a tessellated circular edge without assuming a global plane.
 * Arbitrary splines are rejected by checking every sample against both the
 * fitted circle and its plane.
 */
function fitCircularEdge(points: Point3Dto[]): CircularEdgeFit | null {
  if (points.length < 3) return null;
  const first = points[0];
  let farthest = points[1];
  let farthestDistance = 0;
  for (const point of points.slice(1)) {
    const distance = distance3(first, point);
    if (distance > farthestDistance) {
      farthest = point;
      farthestDistance = distance;
    }
  }
  if (farthestDistance <= EPSILON) return null;

  const u = sub3(farthest, first);
  let third: Point3Dto | null = null;
  let bestCrossLength = 0;
  for (const point of points) {
    const crossLength = length3(cross3(u, sub3(point, first)));
    if (crossLength > bestCrossLength) {
      third = point;
      bestCrossLength = crossLength;
    }
  }
  if (!third || bestCrossLength <= farthestDistance * farthestDistance * 1e-7) return null;

  const v = sub3(third, first);
  const normalRaw = cross3(u, v);
  const normalLengthSq = dot3(normalRaw, normalRaw);
  if (normalLengthSq <= EPSILON) return null;
  const centerOffset = scale3(
    add3(
      scale3(cross3(v, normalRaw), dot3(u, u)),
      scale3(cross3(normalRaw, u), dot3(v, v)),
    ),
    1 / (2 * normalLengthSq),
  );
  const center = add3(first, centerOffset);
  const radius = distance3(center, first);
  if (!Number.isFinite(radius) || radius <= EPSILON) return null;

  const normal = scale3(normalRaw, 1 / Math.sqrt(normalLengthSq));
  const tolerance = Math.max(1e-5, radius * 1e-4);
  for (const point of points) {
    const radial = sub3(point, center);
    if (
      Math.abs(length3(radial) - radius) > tolerance
      || Math.abs(dot3(radial, normal)) > tolerance
    ) {
      return null;
    }
  }

  let sweep = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = sub3(points[index - 1], center);
    const b = sub3(points[index], center);
    const cosine = Math.max(-1, Math.min(1, dot3(a, b) / (radius * radius)));
    sweep += Math.acos(cosine);
  }
  return { radius, arcLength: radius * sweep };
}

function edgeMeasurement(edges: EdgeDto[]): SelectionMeasurement {
  if (edges.length > 1) {
    const fits = edges.map((edge) => fitCircularEdge(edge.points));
    const rows: MeasurementRow[] = [
      {
        label: 'totalLength',
        value: edges.reduce(
          (sum, edge, index) => sum + (fits[index]?.arcLength ?? edgePolylineLength(edge)),
          0,
        ),
        unit: 'mm',
        approximate: edges.some((edge, index) => fits[index] !== null || edge.points.length > 2),
      },
    ];
    if (edges.length === 2) {
      rows.push({
        label: 'minimumDistance',
        value: polylineDistance3(edges[0].points, edges[1].points),
        unit: 'mm',
        approximate: edges.some((edge) => edge.points.length > 2),
      });
      const firstDirection = straightPolylineDirection(edges[0].points);
      const secondDirection = straightPolylineDirection(edges[1].points);
      if (firstDirection && secondDirection) {
        const angle = acuteAngle3(firstDirection, secondDirection);
        if (angle !== null) rows.push({ label: 'angle', value: angle, unit: 'deg' });
      }
    }
    return {
      kind: 'edges',
      count: edges.length,
      rows,
    };
  }
  const edge = edges[0];
  const circular = fitCircularEdge(edge.points);
  return {
    kind: 'edge',
    rows: [
      {
        label: 'length',
        value: circular?.arcLength ?? edgePolylineLength(edge),
        unit: 'mm',
        approximate: circular !== null || edge.points.length > 2,
      },
      ...(circular
        ? [
            {
              label: 'radius' as const,
              value: circular.radius,
              unit: 'mm' as const,
              approximate: true,
            },
          ]
        : []),
    ],
  };
}

function faceVertices(body: BodyDto, face: FaceDto): Point3Dto[] {
  const vertices: Point3Dto[] = [];
  const start = Math.max(0, face.first_index);
  const end = Math.min(body.mesh.indices.length, start + face.index_count);
  for (let offset = start; offset < end; offset += 1) {
    const point = meshPoint(body, body.mesh.indices[offset]);
    if (point) vertices.push(point);
  }
  return vertices;
}

type Triangle3 = [Point3Dto, Point3Dto, Point3Dto];

function faceTriangles(
  body: BodyDto,
  face: FaceDto,
  maximum = Infinity,
): Triangle3[] {
  const triangles: Triangle3[] = [];
  const start = Math.max(0, face.first_index);
  const end = Math.min(body.mesh.indices.length, start + face.index_count);
  const triangleCount = Math.floor((end - start) / 3);
  const outputCount = Math.min(triangleCount, maximum);
  for (let index = 0; index < outputCount; index += 1) {
    const sourceIndex =
      outputCount < triangleCount
        ? Math.floor((index * triangleCount) / outputCount)
        : index;
    const offset = start + sourceIndex * 3;
    const a = meshPoint(body, body.mesh.indices[offset]);
    const b = meshPoint(body, body.mesh.indices[offset + 1]);
    const c = meshPoint(body, body.mesh.indices[offset + 2]);
    if (a && b && c) triangles.push([a, b, c]);
  }
  return triangles;
}

function bodyTriangles(body: BodyDto, maximum = Infinity): Triangle3[] {
  const triangles: Triangle3[] = [];
  const triangleCount = Math.floor(body.mesh.indices.length / 3);
  const outputCount = Math.min(triangleCount, maximum);
  for (let index = 0; index < outputCount; index += 1) {
    const sourceIndex =
      outputCount < triangleCount
        ? Math.floor((index * triangleCount) / outputCount)
        : index;
    const offset = sourceIndex * 3;
    const a = meshPoint(body, body.mesh.indices[offset]);
    const b = meshPoint(body, body.mesh.indices[offset + 1]);
    const c = meshPoint(body, body.mesh.indices[offset + 2]);
    if (a && b && c) triangles.push([a, b, c]);
  }
  return triangles;
}

function pointTriangleDistance3(point: Vec3, triangle: Triangle3): number {
  const [a, b, c] = triangle;
  const ab = sub3(b, a);
  const ac = sub3(c, a);
  if (length3(cross3(ab, ac)) <= EPSILON) {
    return Math.min(
      pointSegmentDistance3(point, a, b),
      pointSegmentDistance3(point, b, c),
      pointSegmentDistance3(point, c, a),
    );
  }

  const ap = sub3(point, a);
  const d1 = dot3(ab, ap);
  const d2 = dot3(ac, ap);
  if (d1 <= 0 && d2 <= 0) return distance3(point, a);

  const bp = sub3(point, b);
  const d3 = dot3(ab, bp);
  const d4 = dot3(ac, bp);
  if (d3 >= 0 && d4 <= d3) return distance3(point, b);

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const parameter = d1 / (d1 - d3);
    return distance3(point, add3(a, scale3(ab, parameter)));
  }

  const cp = sub3(point, c);
  const d5 = dot3(ab, cp);
  const d6 = dot3(ac, cp);
  if (d6 >= 0 && d5 <= d6) return distance3(point, c);

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const parameter = d2 / (d2 - d6);
    return distance3(point, add3(a, scale3(ac, parameter)));
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const parameter = (d4 - d3) / (d4 - d3 + d5 - d6);
    return distance3(point, add3(b, scale3(sub3(c, b), parameter)));
  }

  const denominator = 1 / (va + vb + vc);
  const v = vb * denominator;
  const w = vc * denominator;
  const closest = add3(a, add3(scale3(ab, v), scale3(ac, w)));
  return distance3(point, closest);
}

function segmentIntersectsTriangle3(start: Vec3, end: Vec3, triangle: Triangle3): boolean {
  const [a, b, c] = triangle;
  const direction = sub3(end, start);
  const edge1 = sub3(b, a);
  const edge2 = sub3(c, a);
  const p = cross3(direction, edge2);
  const determinant = dot3(edge1, p);
  if (Math.abs(determinant) <= EPSILON) return false;
  const inverse = 1 / determinant;
  const translated = sub3(start, a);
  const u = dot3(translated, p) * inverse;
  if (u < -EPSILON || u > 1 + EPSILON) return false;
  const q = cross3(translated, edge1);
  const v = dot3(direction, q) * inverse;
  if (v < -EPSILON || u + v > 1 + EPSILON) return false;
  const parameter = dot3(edge2, q) * inverse;
  return parameter >= -EPSILON && parameter <= 1 + EPSILON;
}

function segmentTriangleDistance3(start: Vec3, end: Vec3, triangle: Triangle3): number {
  if (segmentIntersectsTriangle3(start, end, triangle)) return 0;
  const [a, b, c] = triangle;
  return Math.min(
    pointTriangleDistance3(start, triangle),
    pointTriangleDistance3(end, triangle),
    segmentSegmentDistance3(start, end, a, b),
    segmentSegmentDistance3(start, end, b, c),
    segmentSegmentDistance3(start, end, c, a),
  );
}

function triangleTriangleDistance3(a: Triangle3, b: Triangle3): number {
  for (const [start, end] of [
    [a[0], a[1]],
    [a[1], a[2]],
    [a[2], a[0]],
  ] as const) {
    if (segmentIntersectsTriangle3(start, end, b)) return 0;
  }
  for (const [start, end] of [
    [b[0], b[1]],
    [b[1], b[2]],
    [b[2], b[0]],
  ] as const) {
    if (segmentIntersectsTriangle3(start, end, a)) return 0;
  }
  let minimum = Infinity;
  for (const point of a) minimum = Math.min(minimum, pointTriangleDistance3(point, b));
  for (const point of b) minimum = Math.min(minimum, pointTriangleDistance3(point, a));
  for (const [aStart, aEnd] of [
    [a[0], a[1]],
    [a[1], a[2]],
    [a[2], a[0]],
  ] as const) {
    for (const [bStart, bEnd] of [
      [b[0], b[1]],
      [b[1], b[2]],
      [b[2], b[0]],
    ] as const) {
      minimum = Math.min(
        minimum,
        segmentSegmentDistance3(aStart, aEnd, bStart, bEnd),
      );
    }
  }
  return minimum;
}

function sampleTriangles(
  triangles: Triangle3[],
  maximum: number,
): { triangles: Triangle3[]; sampled: boolean } {
  if (triangles.length <= maximum) return { triangles, sampled: false };
  return {
    triangles: Array.from(
      { length: maximum },
      (_, index) => triangles[Math.floor((index * triangles.length) / maximum)],
    ),
    sampled: true,
  };
}

function triangleSetDistance3(
  first: Triangle3[],
  second: Triangle3[],
  maximum = 400,
): { value: number; sampled: boolean } {
  if (first.length === 0 || second.length === 0) {
    return { value: Infinity, sampled: false };
  }
  const a = sampleTriangles(first, maximum);
  const b = sampleTriangles(second, maximum);
  let minimum = Infinity;
  for (const firstTriangle of a.triangles) {
    for (const secondTriangle of b.triangles) {
      minimum = Math.min(
        minimum,
        triangleTriangleDistance3(firstTriangle, secondTriangle),
      );
      if (minimum <= EPSILON) {
        return { value: 0, sampled: a.sampled || b.sampled };
      }
    }
  }
  return { value: minimum, sampled: a.sampled || b.sampled };
}

function polylineTriangleDistance3(
  points: Point3Dto[],
  triangles: Triangle3[],
): { value: number; sampled: boolean } {
  if (points.length === 0 || triangles.length === 0) {
    return { value: Infinity, sampled: false };
  }
  const sampledTriangles = sampleTriangles(triangles, 500);
  let minimum = Infinity;
  if (points.length === 1) {
    for (const triangle of sampledTriangles.triangles) {
      minimum = Math.min(minimum, pointTriangleDistance3(points[0], triangle));
    }
  } else {
    for (let index = 1; index < points.length; index += 1) {
      for (const triangle of sampledTriangles.triangles) {
        minimum = Math.min(
          minimum,
          segmentTriangleDistance3(points[index - 1], points[index], triangle),
        );
        if (minimum <= EPSILON) {
          return { value: 0, sampled: sampledTriangles.sampled };
        }
      }
    }
  }
  return { value: minimum, sampled: sampledTriangles.sampled };
}

function faceArea(body: BodyDto, face: FaceDto): number {
  let area = 0;
  const start = Math.max(0, face.first_index);
  const end = Math.min(body.mesh.indices.length, start + face.index_count);
  for (let offset = start; offset + 2 < end; offset += 3) {
    const a = meshPoint(body, body.mesh.indices[offset]);
    const b = meshPoint(body, body.mesh.indices[offset + 1]);
    const c = meshPoint(body, body.mesh.indices[offset + 2]);
    if (a && b && c) area += triangleArea(a, b, c);
  }
  return area;
}

function planarFaceSize(body: BodyDto, face: FaceDto): number[] | null {
  if (!face.plane) return null;
  const vertices = faceVertices(body, face);
  if (vertices.length === 0) return null;
  const origin = {
    x: face.plane.origin[0],
    y: face.plane.origin[1],
    z: face.plane.origin[2],
  };
  const u = { x: face.plane.u[0], y: face.plane.u[1], z: face.plane.u[2] };
  const v = { x: face.plane.v[0], y: face.plane.v[1], z: face.plane.v[2] };
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const point of vertices) {
    const local = sub3(point, origin);
    const x = dot3(local, u);
    const y = dot3(local, v);
    minU = Math.min(minU, x);
    maxU = Math.max(maxU, x);
    minV = Math.min(minV, y);
    maxV = Math.max(maxV, y);
  }
  return [maxU - minU, maxV - minV];
}

function meshCoordinateKey(point: Vec3, tolerance: number): string {
  return [
    Math.round(point.x / tolerance),
    Math.round(point.y / tolerance),
    Math.round(point.z / tolerance),
  ].join(',');
}

function meshEdgeKey(a: Vec3, b: Vec3, tolerance: number): string {
  const first = meshCoordinateKey(a, tolerance);
  const second = meshCoordinateKey(b, tolerance);
  return first < second ? `${first}|${second}` : `${second}|${first}`;
}

function meshTolerance(body: BodyDto): number {
  return Math.max(1e-7, Math.hypot(...bodyBounds(body).size) * 1e-8);
}

function facePerimeter(body: BodyDto, face: FaceDto): number | null {
  const start = Math.max(0, face.first_index);
  const end = Math.min(body.mesh.indices.length, start + face.index_count);
  const tolerance = meshTolerance(body);
  const edges = new Map<string, { count: number; length: number }>();
  for (let offset = start; offset + 2 < end; offset += 3) {
    const points = [
      meshPoint(body, body.mesh.indices[offset]),
      meshPoint(body, body.mesh.indices[offset + 1]),
      meshPoint(body, body.mesh.indices[offset + 2]),
    ];
    if (points.some((point) => point === null)) continue;
    const triangle = points as [Point3Dto, Point3Dto, Point3Dto];
    for (const [a, b] of [
      [triangle[0], triangle[1]],
      [triangle[1], triangle[2]],
      [triangle[2], triangle[0]],
    ] as const) {
      const key = meshEdgeKey(a, b, tolerance);
      const existing = edges.get(key);
      if (existing) existing.count += 1;
      else edges.set(key, { count: 1, length: distance3(a, b) });
    }
  }
  const boundary = [...edges.values()].filter((edge) => edge.count === 1);
  if (boundary.length === 0) return null;
  return boundary.reduce((sum, edge) => sum + edge.length, 0);
}

function faceMeasurement(body: BodyDto, face: FaceDto): SelectionMeasurement {
  const size = planarFaceSize(body, face);
  const perimeter = facePerimeter(body, face);
  return {
    kind: 'face',
    rows: [
      ...(size
        ? [{ label: 'size' as const, value: size, unit: 'mm' as const, approximate: true }]
        : []),
      { label: 'area', value: faceArea(body, face), unit: 'mm2', approximate: true },
      ...(perimeter !== null
        ? [
            {
              label: 'perimeter' as const,
              value: perimeter,
              unit: 'mm' as const,
              approximate: true,
            },
          ]
        : []),
    ],
  };
}

interface SelectedFace {
  body: BodyDto;
  face: FaceDto;
}

function facesMeasurement(faces: SelectedFace[]): SelectionMeasurement {
  const perimeters = faces.map(({ body, face }) => facePerimeter(body, face));
  const rows: MeasurementRow[] = [
    {
      label: 'totalArea',
      value: faces.reduce((sum, { body, face }) => sum + faceArea(body, face), 0),
      unit: 'mm2',
      approximate: true,
    },
  ];
  if (perimeters.every((value): value is number => value !== null)) {
    rows.push({
      label: 'totalPerimeter',
      value: perimeters.reduce((sum, value) => sum + value, 0),
      unit: 'mm',
      approximate: true,
    });
  }
  if (faces.length === 2) {
    const distance = triangleSetDistance3(
      faceTriangles(faces[0].body, faces[0].face, 400),
      faceTriangles(faces[1].body, faces[1].face, 400),
    );
    if (Number.isFinite(distance.value)) {
      rows.push({
        label: 'minimumDistance',
        value: distance.value,
        unit: 'mm',
        approximate: true,
      });
    }
    const firstNormal = faces[0].face.plane?.normal;
    const secondNormal = faces[1].face.plane?.normal;
    if (firstNormal && secondNormal) {
      const angle = acuteAngle3(
        { x: firstNormal[0], y: firstNormal[1], z: firstNormal[2] },
        { x: secondNormal[0], y: secondNormal[1], z: secondNormal[2] },
      );
      if (angle !== null) rows.push({ label: 'angle', value: angle, unit: 'deg' });
    }
  }
  return {
    kind: 'faces',
    count: faces.length,
    rows,
  };
}

function bodyBounds(body: BodyDto): { min: Vec3; max: Vec3; size: number[] } {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (let offset = 0; offset + 2 < body.mesh.positions.length; offset += 3) {
    const x = body.mesh.positions[offset];
    const y = body.mesh.positions[offset + 1];
    const z = body.mesh.positions[offset + 2];
    min.x = Math.min(min.x, x);
    min.y = Math.min(min.y, y);
    min.z = Math.min(min.z, z);
    max.x = Math.max(max.x, x);
    max.y = Math.max(max.y, y);
    max.z = Math.max(max.z, z);
  }
  if (!Number.isFinite(min.x)) {
    return {
      min: { x: 0, y: 0, z: 0 },
      max: { x: 0, y: 0, z: 0 },
      size: [0, 0, 0],
    };
  }
  return { min, max, size: [max.x - min.x, max.y - min.y, max.z - min.z] };
}

function bodySurfaceArea(body: BodyDto): number {
  let area = 0;
  for (let offset = 0; offset + 2 < body.mesh.indices.length; offset += 3) {
    const a = meshPoint(body, body.mesh.indices[offset]);
    const b = meshPoint(body, body.mesh.indices[offset + 1]);
    const c = meshPoint(body, body.mesh.indices[offset + 2]);
    if (a && b && c) area += triangleArea(a, b, c);
  }
  return area;
}

function bodyVolume(body: BodyDto): number {
  const bounds = bodyBounds(body);
  const origin = scale3(add3(bounds.min, bounds.max), 0.5);
  let signedVolume = 0;
  for (let offset = 0; offset + 2 < body.mesh.indices.length; offset += 3) {
    const a = meshPoint(body, body.mesh.indices[offset]);
    const b = meshPoint(body, body.mesh.indices[offset + 1]);
    const c = meshPoint(body, body.mesh.indices[offset + 2]);
    if (!a || !b || !c) continue;
    signedVolume += dot3(sub3(a, origin), cross3(sub3(b, origin), sub3(c, origin))) / 6;
  }
  return Math.abs(signedVolume);
}

function bodyMeshIsClosed(body: BodyDto): boolean {
  const tolerance = meshTolerance(body);
  const edgeCounts = new Map<string, number>();
  for (let offset = 0; offset + 2 < body.mesh.indices.length; offset += 3) {
    const points = [
      meshPoint(body, body.mesh.indices[offset]),
      meshPoint(body, body.mesh.indices[offset + 1]),
      meshPoint(body, body.mesh.indices[offset + 2]),
    ];
    if (points.some((point) => point === null)) continue;
    const triangle = points as [Point3Dto, Point3Dto, Point3Dto];
    for (const [a, b] of [
      [triangle[0], triangle[1]],
      [triangle[1], triangle[2]],
      [triangle[2], triangle[0]],
    ] as const) {
      const key = meshEdgeKey(a, b, tolerance);
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
    }
  }
  return edgeCounts.size > 0 && [...edgeCounts.values()].every((count) => count === 2);
}

function bodyMeasurement(body: BodyDto): SelectionMeasurement {
  return {
    kind: 'body',
    name: body.name,
    rows: [
      { label: 'size', value: bodyBounds(body).size, unit: 'mm' },
      {
        label: 'surfaceArea',
        value: bodySurfaceArea(body),
        unit: 'mm2',
        approximate: true,
      },
      ...(bodyMeshIsClosed(body)
        ? [
            {
              label: 'volume' as const,
              value: bodyVolume(body),
              unit: 'mm3' as const,
              approximate: true,
            },
          ]
        : []),
    ],
  };
}

function bodiesMeasurement(bodies: BodyDto[]): SelectionMeasurement {
  const closed = bodies.every(bodyMeshIsClosed);
  const rows: MeasurementRow[] = [
    {
      label: 'totalSurfaceArea',
      value: bodies.reduce((sum, body) => sum + bodySurfaceArea(body), 0),
      unit: 'mm2',
      approximate: true,
    },
    ...(closed
      ? [
          {
            label: 'totalVolume' as const,
            value: bodies.reduce((sum, body) => sum + bodyVolume(body), 0),
            unit: 'mm3' as const,
            approximate: true,
          },
        ]
      : []),
  ];
  if (bodies.length === 2) {
    const distance = triangleSetDistance3(
      bodyTriangles(bodies[0], 300),
      bodyTriangles(bodies[1], 300),
      300,
    );
    if (Number.isFinite(distance.value)) {
      rows.push({
        label: 'minimumDistance',
        value: distance.value,
        unit: 'mm',
        approximate: true,
      });
    }
  }
  return {
    kind: 'bodies',
    count: bodies.length,
    rows,
  };
}

interface SelectedEdge {
  body: BodyDto;
  edge: EdgeDto;
}

type SelectedSolidFeature =
  | { kind: 'body'; body: BodyDto }
  | { kind: 'face'; body: BodyDto; face: FaceDto }
  | { kind: 'edge'; body: BodyDto; edge: EdgeDto };

function featureTriangles(feature: SelectedSolidFeature): Triangle3[] {
  switch (feature.kind) {
    case 'body':
      return bodyTriangles(feature.body, 300);
    case 'face':
      return faceTriangles(feature.body, feature.face, 400);
    case 'edge':
      return [];
  }
}

function solidFeaturePairDistance(
  first: SelectedSolidFeature,
  second: SelectedSolidFeature,
): { value: number; approximate: boolean } | null {
  if (first.kind === 'edge' && second.kind === 'edge') {
    return {
      value: polylineDistance3(first.edge.points, second.edge.points),
      approximate: first.edge.points.length > 2 || second.edge.points.length > 2,
    };
  }
  if (first.kind === 'edge') {
    const distance = polylineTriangleDistance3(first.edge.points, featureTriangles(second));
    return Number.isFinite(distance.value)
      ? { value: distance.value, approximate: true }
      : null;
  }
  if (second.kind === 'edge') return solidFeaturePairDistance(second, first);
  const distance = triangleSetDistance3(
    featureTriangles(first),
    featureTriangles(second),
    first.kind === 'body' || second.kind === 'body' ? 300 : 400,
  );
  return Number.isFinite(distance.value)
    ? { value: distance.value, approximate: true }
    : null;
}

function mixedSolidMeasurement(
  bodies: BodyDto[],
  faces: SelectedFace[],
  edges: SelectedEdge[],
): SelectionMeasurement {
  const rows: MeasurementRow[] = [];
  if (edges.length > 0) {
    const fits = edges.map(({ edge }) => fitCircularEdge(edge.points));
    rows.push({
      label: 'totalLength',
      value: edges.reduce(
        (sum, { edge }, index) =>
          sum + (fits[index]?.arcLength ?? edgePolylineLength(edge)),
        0,
      ),
      unit: 'mm',
      approximate: edges.some(
        ({ edge }, index) => fits[index] !== null || edge.points.length > 2,
      ),
    });
  }
  if (faces.length > 0) {
    const perimeters = faces.map(({ body, face }) => facePerimeter(body, face));
    rows.push({
      label: 'totalArea',
      value: faces.reduce((sum, { body, face }) => sum + faceArea(body, face), 0),
      unit: 'mm2',
      approximate: true,
    });
    if (perimeters.every((value): value is number => value !== null)) {
      rows.push({
        label: 'totalPerimeter',
        value: perimeters.reduce((sum, value) => sum + value, 0),
        unit: 'mm',
        approximate: true,
      });
    }
  }
  if (bodies.length > 0) {
    rows.push({
      label: 'totalSurfaceArea',
      value: bodies.reduce((sum, body) => sum + bodySurfaceArea(body), 0),
      unit: 'mm2',
      approximate: true,
    });
    if (bodies.every(bodyMeshIsClosed)) {
      rows.push({
        label: 'totalVolume',
        value: bodies.reduce((sum, body) => sum + bodyVolume(body), 0),
        unit: 'mm3',
        approximate: true,
      });
    }
  }

  const features: SelectedSolidFeature[] = [
    ...bodies.map((body): SelectedSolidFeature => ({ kind: 'body', body })),
    ...faces.map(
      ({ body, face }): SelectedSolidFeature => ({ kind: 'face', body, face }),
    ),
    ...edges.map(
      ({ body, edge }): SelectedSolidFeature => ({ kind: 'edge', body, edge }),
    ),
  ];
  if (features.length === 2) {
    const distance = solidFeaturePairDistance(features[0], features[1]);
    if (distance) {
      rows.push({
        label: 'minimumDistance',
        value: distance.value,
        unit: 'mm',
        approximate: distance.approximate,
      });
    }
  }
  return {
    kind: 'features',
    count: features.length,
    rows,
  };
}

function bodyContainingFace(scene: SolidSceneDto, faceId: number): BodyDto | undefined {
  return scene.bodies.find((body) => body.faces.some((face) => face.id === faceId));
}

function bodyContainingEdge(scene: SolidSceneDto, edgeId: number): BodyDto | undefined {
  return scene.bodies.find((body) => body.edges.some((edge) => edge.id === edgeId));
}

export function measureSolidSelection(
  scene: SolidSceneDto,
  selectedBodyId: number | null,
  selectedFaceId: number | null,
  selectedEdgeIds: number[],
  selectedBodyIds: number[] = [],
  selectedFaceIds: number[] = [],
): SelectionMeasurement | null {
  let bodyIds = [...new Set(selectedBodyIds)];
  let faceIds = [...new Set(selectedFaceIds)];
  const edgeIds = [...new Set(selectedEdgeIds)];
  if (bodyIds.length === 0 && faceIds.length === 0 && edgeIds.length === 0) {
    if (selectedFaceId !== null) faceIds = [selectedFaceId];
    else if (selectedBodyId !== null) bodyIds = [selectedBodyId];
  }

  const bodies = bodyIds
    .map((id) => scene.bodies.find((body) => body.id === id))
    .filter((body): body is BodyDto => body !== undefined);
  const faces = faceIds
    .map((id): SelectedFace | null => {
      const preferredBody = scene.bodies.find(
        (body) =>
          body.id === selectedBodyId &&
          body.faces.some((face) => face.id === id),
      );
      const body = preferredBody ?? bodyContainingFace(scene, id);
      const face = body?.faces.find((candidate) => candidate.id === id);
      return body && face ? { body, face } : null;
    })
    .filter((selection): selection is SelectedFace => selection !== null);
  const edges = edgeIds
    .map((id): SelectedEdge | null => {
      const preferredBody = scene.bodies.find(
        (body) =>
          body.id === selectedBodyId &&
          body.edges.some((edge) => edge.id === id),
      );
      const body = preferredBody ?? bodyContainingEdge(scene, id);
      const edge = body?.edges.find((candidate) => candidate.id === id);
      return body && edge ? { body, edge } : null;
    })
    .filter((selection): selection is SelectedEdge => selection !== null);

  const categoryCount =
    Number(bodies.length > 0) + Number(faces.length > 0) + Number(edges.length > 0);
  if (categoryCount === 0) return null;
  if (categoryCount > 1) return mixedSolidMeasurement(bodies, faces, edges);
  if (edges.length > 0) return edgeMeasurement(edges.map(({ edge }) => edge));
  if (faces.length === 1) return faceMeasurement(faces[0].body, faces[0].face);
  if (faces.length > 1) return facesMeasurement(faces);
  if (bodies.length === 1) return bodyMeasurement(bodies[0]);
  return bodiesMeasurement(bodies);
}
