import type {
  BodyDto,
  ExtrudeOperation,
  PlaneBasis,
  ProfileLoopDto,
  Vec2,
} from '../engine/types';

type Point3 = [number, number, number];

const EPS = 1e-7;

export interface ExtrudeOperationInference {
  operation: Extract<ExtrudeOperation, 'new_body' | 'join' | 'cut'>;
  targetBodyIds: number[];
  reason:
    | 'no_intersection'
    | 'outward_contact'
    | 'volume_intersection'
    | 'connected_profiles';
}

interface MaterialRegion {
  outer: ProfileLoopDto;
  holes: ProfileLoopDto[];
}

interface BodyRelation {
  overlapsForwardVolume: boolean;
  touchesOppositeSide: boolean;
}

function dot(a: Point3, b: Point3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function subtract(a: Point3, b: Point3): Point3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: Point3, b: Point3): Point3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function pointOnSegment(point: Vec2, a: Vec2, b: Vec2): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const px = point.x - a.x;
  const py = point.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length <= EPS) return Math.hypot(px, py) <= EPS;
  if (Math.abs(dx * py - dy * px) > EPS * Math.max(1, length)) return false;
  const projection = px * dx + py * dy;
  return projection >= -EPS && projection <= length * length + EPS;
}

function segmentsShareLength(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const ab = { x: b.x - a.x, y: b.y - a.y };
  const cd = { x: d.x - c.x, y: d.y - c.y };
  const abLength = Math.hypot(ab.x, ab.y);
  const cdLength = Math.hypot(cd.x, cd.y);
  if (abLength <= EPS || cdLength <= EPS) return false;

  // A point contact is not enough to make a valid fused solid. Require a
  // collinear boundary overlap with non-zero length.
  const angularError = Math.abs(ab.x * cd.y - ab.y * cd.x) / (abLength * cdLength);
  const lineDistance =
    Math.abs(ab.x * (c.y - a.y) - ab.y * (c.x - a.x)) / abLength;
  const tolerance = 1e-6;
  if (angularError > tolerance || lineDistance > tolerance) return false;

  const unit = { x: ab.x / abLength, y: ab.y / abLength };
  const project = (point: Vec2) =>
    (point.x - a.x) * unit.x + (point.y - a.y) * unit.y;
  const cProjection = project(c);
  const dProjection = project(d);
  const overlap =
    Math.min(abLength, Math.max(cProjection, dProjection)) -
    Math.max(0, Math.min(cProjection, dProjection));
  return overlap > tolerance;
}

function profilesShareBoundary(left: ProfileLoopDto, right: ProfileLoopDto): boolean {
  for (let leftIndex = 0; leftIndex < left.points.length; leftIndex += 1) {
    const leftStart = left.points[leftIndex];
    const leftEnd = left.points[(leftIndex + 1) % left.points.length];
    for (let rightIndex = 0; rightIndex < right.points.length; rightIndex += 1) {
      const rightStart = right.points[rightIndex];
      const rightEnd = right.points[(rightIndex + 1) % right.points.length];
      if (segmentsShareLength(leftStart, leftEnd, rightStart, rightEnd)) return true;
    }
  }
  return false;
}

/**
 * True when every selected material profile belongs to one shared-edge
 * connected component. Vertex-only contact deliberately does not qualify.
 */
export function selectedProfilesFormConnectedRegion(
  profiles: ProfileLoopDto[],
  selectedProfileIndices: number[],
): boolean {
  const selected = new Set(selectedProfileIndices);
  const regions = profiles.filter(
    (profile) => selected.has(profile.index) && profile.nesting_depth % 2 === 0,
  );
  if (regions.length < 2) return false;

  const visited = new Set<number>([0]);
  const queue = [0];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (let candidate = 0; candidate < regions.length; candidate += 1) {
      if (
        visited.has(candidate) ||
        !profilesShareBoundary(regions[current], regions[candidate])
      ) {
        continue;
      }
      visited.add(candidate);
      queue.push(candidate);
    }
  }
  return visited.size === regions.length;
}

function pointInPolygon(point: Vec2, polygon: Vec2[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[previous];
    const b = polygon[index];
    if (pointOnSegment(point, a, b)) return true;
    if (
      (a.y > point.y) !== (b.y > point.y) &&
      point.x <
        ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function polygonCentroid(points: Vec2[]): Vec2 {
  let twiceArea = 0;
  let xMoment = 0;
  let yMoment = 0;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const next = points[(index + 1) % points.length];
    const factor = point.x * next.y - next.x * point.y;
    twiceArea += factor;
    xMoment += (point.x + next.x) * factor;
    yMoment += (point.y + next.y) * factor;
  }
  if (Math.abs(twiceArea) > EPS) {
    return {
      x: xMoment / (3 * twiceArea),
      y: yMoment / (3 * twiceArea),
    };
  }
  const count = Math.max(1, points.length);
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / count,
    y: points.reduce((sum, point) => sum + point.y, 0) / count,
  };
}

function materialRegions(
  profiles: ProfileLoopDto[],
  selectedProfileIndices: number[],
): MaterialRegion[] {
  const selected = new Set(selectedProfileIndices);
  return profiles
    .filter(
      (profile) =>
        selected.has(profile.index) && profile.nesting_depth % 2 === 0,
    )
    .map((outer) => ({
      outer,
      holes: profiles.filter(
        (profile) =>
          profile.nesting_depth % 2 === 1 &&
          profile.parent_index === outer.index,
      ),
    }));
}

function containsMaterial(point: Vec2, regions: MaterialRegion[]): boolean {
  return regions.some(
    ({ outer, holes }) =>
      pointInPolygon(point, outer.points) &&
      !holes.some((hole) => pointInPolygon(point, hole.points)),
  );
}

function profileSamples(regions: MaterialRegion[]): Vec2[] {
  const samples: Vec2[] = [];
  const keys = new Set<string>();
  const add = (point: Vec2) => {
    if (!containsMaterial(point, regions)) return;
    const key = `${Math.round(point.x * 1e6)}:${Math.round(point.y * 1e6)}`;
    if (keys.has(key)) return;
    keys.add(key);
    samples.push(point);
  };

  for (const { outer } of regions) {
    if (outer.points.length < 3) continue;
    add(polygonCentroid(outer.points));
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < outer.points.length; index += 1) {
      const point = outer.points[index];
      const next = outer.points[(index + 1) % outer.points.length];
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
      add(point);
      add({ x: (point.x + next.x) * 0.5, y: (point.y + next.y) * 0.5 });
    }
    add({ x: (minX + maxX) * 0.5, y: (minY + maxY) * 0.5 });
    const divisions = 9;
    for (let xIndex = 0; xIndex < divisions; xIndex += 1) {
      for (let yIndex = 0; yIndex < divisions; yIndex += 1) {
        add({
          x: minX + ((xIndex + 0.5) / divisions) * (maxX - minX),
          y: minY + ((yIndex + 0.5) / divisions) * (maxY - minY),
        });
      }
    }
  }
  return samples;
}

function localPositions(body: BodyDto, basis: PlaneBasis): number[] {
  const result = new Array<number>(body.mesh.positions.length);
  const origin = basis.origin as Point3;
  const u = basis.u as Point3;
  const v = basis.v as Point3;
  const normal = basis.normal as Point3;
  for (let offset = 0; offset < body.mesh.positions.length; offset += 3) {
    const delta = subtract(
      [
        body.mesh.positions[offset],
        body.mesh.positions[offset + 1],
        body.mesh.positions[offset + 2],
      ],
      origin,
    );
    result[offset] = dot(delta, u);
    result[offset + 1] = dot(delta, v);
    result[offset + 2] = dot(delta, normal);
  }
  return result;
}

function rayTriangleDistance(
  origin: Point3,
  direction: Point3,
  positions: number[],
  ia: number,
  ib: number,
  ic: number,
): number | null {
  const a: Point3 = [
    positions[ia * 3],
    positions[ia * 3 + 1],
    positions[ia * 3 + 2],
  ];
  const b: Point3 = [
    positions[ib * 3],
    positions[ib * 3 + 1],
    positions[ib * 3 + 2],
  ];
  const c: Point3 = [
    positions[ic * 3],
    positions[ic * 3 + 1],
    positions[ic * 3 + 2],
  ];
  const edge1 = subtract(b, a);
  const edge2 = subtract(c, a);
  const p = cross(direction, edge2);
  const determinant = dot(edge1, p);
  if (Math.abs(determinant) <= EPS) return null;
  const inverse = 1 / determinant;
  const translated = subtract(origin, a);
  const u = dot(translated, p) * inverse;
  if (u < -EPS || u > 1 + EPS) return null;
  const q = cross(translated, edge1);
  const v = dot(direction, q) * inverse;
  if (v < -EPS || u + v > 1 + EPS) return null;
  const distance = dot(edge2, q) * inverse;
  return distance > EPS ? distance : null;
}

function rayDistances(
  origin: Point3,
  direction: Point3,
  positions: number[],
  indices: number[],
  maxDistance = Number.POSITIVE_INFINITY,
): number[] {
  const distances: number[] = [];
  for (let offset = 0; offset + 2 < indices.length; offset += 3) {
    const distance = rayTriangleDistance(
      origin,
      direction,
      positions,
      indices[offset],
      indices[offset + 1],
      indices[offset + 2],
    );
    if (distance !== null && distance < maxDistance + EPS) distances.push(distance);
  }
  distances.sort((left, right) => left - right);
  return distances.filter(
    (distance, index) =>
      index === 0 ||
      Math.abs(distance - distances[index - 1]) >
        1e-6 * Math.max(1, Math.abs(distance)),
  );
}

function insideAtZ(z: number, crossings: number[]): boolean {
  let count = 0;
  for (const crossing of crossings) {
    if (crossing > z + EPS) break;
    count += 1;
  }
  return count % 2 === 1;
}

function intervalsOverlap(
  crossings: number[],
  lower: number,
  upper: number,
): boolean {
  for (let index = 0; index + 1 < crossings.length; index += 2) {
    const entry = crossings[index];
    const exit = crossings[index + 1];
    if (Math.max(entry, lower) < Math.min(exit, upper) - EPS) return true;
  }
  return false;
}

function bodyRelation(
  body: BodyDto,
  basis: PlaneBasis,
  regions: MaterialRegion[],
  samples: Vec2[],
  signedDistance: number,
): BodyRelation {
  const positions = localPositions(body, basis);
  const indices = body.mesh.indices;
  if (positions.length === 0 || indices.length < 3) {
    return { overlapsForwardVolume: false, touchesOppositeSide: false };
  }
  const direction = Math.sign(signedDistance);
  const length = Math.abs(signedDistance);
  const probe = Math.min(0.01, Math.max(0.0001, length * 0.001));
  const lower = Math.min(0, signedDistance);
  const upper = Math.max(0, signedDistance);
  let minimumBodyZ = Number.POSITIVE_INFINITY;
  for (let offset = 2; offset < positions.length; offset += 3) {
    minimumBodyZ = Math.min(minimumBodyZ, positions[offset]);
  }
  const rayOriginZ = minimumBodyZ - Math.max(1, length * 0.01);
  let overlapsForwardVolume = false;
  let touchesOppositeSide = false;

  for (let offset = 0; offset < positions.length; offset += 3) {
    const signedDepth = positions[offset + 2] * direction;
    if (
      signedDepth > EPS &&
      signedDepth < length - EPS &&
      containsMaterial({ x: positions[offset], y: positions[offset + 1] }, regions)
    ) {
      overlapsForwardVolume = true;
      break;
    }
  }

  for (const sample of samples) {
    const crossings = rayDistances(
      [sample.x, sample.y, rayOriginZ],
      [0, 0, 1],
      positions,
      indices,
    ).map((distance) => rayOriginZ + distance);
    const forwardInside = insideAtZ(direction * probe, crossings);
    const oppositeInside = insideAtZ(-direction * probe, crossings);
    overlapsForwardVolume ||= intervalsOverlap(crossings, lower, upper);
    touchesOppositeSide ||= oppositeInside && !forwardInside;
    if (overlapsForwardVolume && touchesOppositeSide) break;
  }

  return {
    overlapsForwardVolume,
    touchesOppositeSide,
  };
}

/**
 * Suggests an Extrude Boolean from the actual signed prism and current body
 * meshes. A surface-growing prism joins the material immediately behind its
 * start plane; a detached or inward prism that enters material cuts it.
 *
 * This is only an editor suggestion. The history definition still stores the
 * explicit operation and target IDs chosen by the user.
 */
export function inferExtrudeOperation({
  basis,
  profiles,
  selectedProfileIndices,
  bodies,
  signedDistance,
}: {
  basis: PlaneBasis;
  profiles: ProfileLoopDto[];
  selectedProfileIndices: number[];
  bodies: BodyDto[];
  signedDistance: number;
}): ExtrudeOperationInference {
  if (!Number.isFinite(signedDistance) || Math.abs(signedDistance) <= EPS) {
    return {
      operation: 'new_body',
      targetBodyIds: [],
      reason: 'no_intersection',
    };
  }
  const regions = materialRegions(profiles, selectedProfileIndices);
  if (regions.length === 0) {
    return {
      operation: 'new_body',
      targetBodyIds: [],
      reason: 'no_intersection',
    };
  }
  const samples = profileSamples(regions);
  const overlapping: number[] = [];
  const outwardContacts: number[] = [];
  for (const body of bodies) {
    const relation = bodyRelation(
      body,
      basis,
      regions,
      samples,
      signedDistance,
    );
    if (relation.overlapsForwardVolume) overlapping.push(body.id);
    if (relation.touchesOppositeSide) outwardContacts.push(body.id);
  }

  if (outwardContacts.length > 0) {
    return {
      operation: 'join',
      targetBodyIds: [...new Set([...outwardContacts, ...overlapping])],
      reason: 'outward_contact',
    };
  }
  if (overlapping.length > 0) {
    return {
      operation: 'cut',
      targetBodyIds: overlapping,
      reason: 'volume_intersection',
    };
  }
  if (selectedProfilesFormConnectedRegion(profiles, selectedProfileIndices)) {
    return {
      operation: 'join',
      targetBodyIds: [],
      reason: 'connected_profiles',
    };
  }
  return {
    operation: 'new_body',
    targetBodyIds: [],
    reason: 'no_intersection',
  };
}
