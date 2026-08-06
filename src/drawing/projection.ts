import type {
  BodyDto,
  DrawingPolylineDto,
  DrawingProjectionDto,
  DrawingProjectionRequest,
  Point3Dto,
  SolidSceneDto,
} from '../engine/types';

type Vec3 = [number, number, number];
type ProjectedPoint = [number, number, number];

interface ProjectedTriangle {
  points: [ProjectedPoint, ProjectedPoint, ProjectedPoint];
  bounds: [number, number, number, number];
}

interface ProjectionBasis {
  right: Vec3;
  up: Vec3;
  towardViewer: Vec3;
}

/**
 * Browser development fallback for the native OCCT HLR path.
 *
 * It projects exact tessellated topology edges, derives smooth silhouettes
 * from triangle adjacency, and depth-tests short curve spans against the mesh.
 * Desktop production uses OCCT's B-rep HLR, but both paths share coordinates
 * and response shapes so the DOM/SVG drawing UI can be developed in a browser.
 */
export function projectSceneForDrawing(
  scene: SolidSceneDto,
  request: DrawingProjectionRequest,
): DrawingProjectionDto {
  const basis = projectionBasis(request.direction, request.up);
  const selected = request.body_ids.length === 0
    ? scene.bodies
    : scene.bodies.filter((body) => request.body_ids.includes(body.id));
  const triangles = selected.flatMap((body) => projectedTriangles(body, basis));
  const candidates: Point3Dto[][] = [];

  for (const body of selected) {
    for (const edge of body.edges) {
      if (edge.points.length >= 2 && (request.include_tangent_edges || edge.refinable)) {
        candidates.push(edge.points);
      }
    }
    candidates.push(...silhouetteSegments(body, basis));
  }

  const visible: DrawingPolylineDto[] = [];
  const hidden: DrawingPolylineDto[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const projected = candidate.map((point) => projectPoint(point, basis));
    for (const segment of classifyPolyline(projected, triangles)) {
      const points = segment.points.map(([x, y]) => [x, y] as [number, number]);
      const key = polylineKey(points);
      if (seen.has(key)) continue;
      seen.add(key);
      if (segment.hidden) {
        if (request.include_hidden) hidden.push({ points });
      } else {
        visible.push({ points });
      }
    }
  }

  return {
    visible,
    hidden,
    bounds: projectionBounds([...visible, ...hidden]),
  };
}

function projectionBasis(direction: Vec3, desiredUp: Vec3): ProjectionBasis {
  const towardViewer = normalize(direction);
  const right = normalize(cross(desiredUp, towardViewer));
  const up = normalize(cross(towardViewer, right));
  return { right, up, towardViewer };
}

function projectPoint(point: Point3Dto, basis: ProjectionBasis): ProjectedPoint {
  const vector: Vec3 = [point.x, point.y, point.z];
  return [dot(vector, basis.right), dot(vector, basis.up), dot(vector, basis.towardViewer)];
}

function projectedTriangles(body: BodyDto, basis: ProjectionBasis): ProjectedTriangle[] {
  const { positions, indices } = body.mesh;
  const result: ProjectedTriangle[] = [];
  for (let cursor = 0; cursor + 2 < indices.length; cursor += 3) {
    const points = [indices[cursor], indices[cursor + 1], indices[cursor + 2]].map((index) =>
      projectPoint(
        {
          x: positions[index * 3],
          y: positions[index * 3 + 1],
          z: positions[index * 3 + 2],
        },
        basis,
      ),
    ) as [ProjectedPoint, ProjectedPoint, ProjectedPoint];
    result.push({
      points,
      bounds: [
        Math.min(...points.map((point) => point[0])),
        Math.min(...points.map((point) => point[1])),
        Math.max(...points.map((point) => point[0])),
        Math.max(...points.map((point) => point[1])),
      ],
    });
  }
  return result;
}

function silhouetteSegments(body: BodyDto, basis: ProjectionBasis): Point3Dto[][] {
  const positions = body.mesh.positions;
  const indices = body.mesh.indices;
  const edges = new Map<string, { endpoints: [Point3Dto, Point3Dto]; signs: number[] }>();
  for (let cursor = 0; cursor + 2 < indices.length; cursor += 3) {
    const vertices = [indices[cursor], indices[cursor + 1], indices[cursor + 2]].map((index) => ({
      x: positions[index * 3],
      y: positions[index * 3 + 1],
      z: positions[index * 3 + 2],
    })) as [Point3Dto, Point3Dto, Point3Dto];
    const normal = cross(
      subtract(vertices[1], vertices[0]),
      subtract(vertices[2], vertices[0]),
    );
    const sign = Math.sign(dot(normal, basis.towardViewer));
    for (const [a, b] of [[0, 1], [1, 2], [2, 0]] as const) {
      const key = worldEdgeKey(vertices[a], vertices[b]);
      const entry = edges.get(key);
      if (entry) entry.signs.push(sign);
      else edges.set(key, { endpoints: [vertices[a], vertices[b]], signs: [sign] });
    }
  }
  return [...edges.values()]
    .filter(({ signs }) => {
      const front = signs.some((sign) => sign > 0);
      const back = signs.some((sign) => sign < 0);
      return (front && back) || (signs.length === 1 && front);
    })
    .map(({ endpoints }) => endpoints);
}

function classifyPolyline(
  points: ProjectedPoint[],
  triangles: ProjectedTriangle[],
): Array<{ hidden: boolean; points: ProjectedPoint[] }> {
  const output: Array<{ hidden: boolean; points: ProjectedPoint[] }> = [];
  for (let index = 0; index + 1 < points.length; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    // Splitting long edges lets a line transition between visible and hidden
    // portions instead of classifying the whole curve by one midpoint.
    const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
    const divisions = Math.max(1, Math.min(12, Math.ceil(length / 3)));
    for (let division = 0; division < divisions; division += 1) {
      const a = interpolate(start, end, division / divisions);
      const b = interpolate(start, end, (division + 1) / divisions);
      const midpoint = interpolate(a, b, 0.5);
      const hidden = triangles.some((triangle) => occludes(midpoint, triangle));
      const previous = output[output.length - 1];
      if (previous?.hidden === hidden && samePoint(previous.points[previous.points.length - 1], a)) {
        previous.points.push(b);
      } else {
        output.push({ hidden, points: [a, b] });
      }
    }
  }
  return output;
}

function occludes(point: ProjectedPoint, triangle: ProjectedTriangle): boolean {
  const [x, y, depth] = point;
  const [minX, minY, maxX, maxY] = triangle.bounds;
  if (x < minX - 1e-7 || x > maxX + 1e-7 || y < minY - 1e-7 || y > maxY + 1e-7) {
    return false;
  }
  const [a, b, c] = triangle.points;
  const denominator = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  if (Math.abs(denominator) < 1e-12) return false;
  const u = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / denominator;
  const v = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / denominator;
  const w = 1 - u - v;
  if (u < -1e-7 || v < -1e-7 || w < -1e-7) return false;
  const triangleDepth = u * a[2] + v * b[2] + w * c[2];
  return triangleDepth > depth + 1e-5;
}

function projectionBounds(polylines: DrawingPolylineDto[]): [number, number, number, number] {
  if (polylines.length === 0) return [0, 0, 0, 0];
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const { points } of polylines) {
    for (const [x, y] of points) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return [minX, minY, maxX, maxY];
}

function polylineKey(points: Array<[number, number]>): string {
  const quantized = points.map(([x, y]) => `${Math.round(x * 1e6)},${Math.round(y * 1e6)}`);
  const forward = quantized.join(';');
  const reverse = [...quantized].reverse().join(';');
  return forward < reverse ? forward : reverse;
}

function worldEdgeKey(a: Point3Dto, b: Point3Dto): string {
  const pointKey = (point: Point3Dto) =>
    `${Math.round(point.x * 1e6)},${Math.round(point.y * 1e6)},${Math.round(point.z * 1e6)}`;
  const left = pointKey(a);
  const right = pointKey(b);
  return left < right ? `${left};${right}` : `${right};${left}`;
}

function interpolate(a: ProjectedPoint, b: ProjectedPoint, t: number): ProjectedPoint {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function samePoint(a: ProjectedPoint, b: ProjectedPoint): boolean {
  return Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
}

function subtract(a: Point3Dto, b: Point3Dto): Vec3 {
  return [a.x - b.x, a.y - b.y, a.z - b.z];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalize(value: Vec3): Vec3 {
  const length = Math.hypot(...value);
  if (!Number.isFinite(length) || length < 1e-9) {
    throw new Error('Drawing view direction and up vectors must be non-zero and non-parallel.');
  }
  return [value[0] / length, value[1] / length, value[2] / length];
}
