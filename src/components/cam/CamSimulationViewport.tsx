import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  CamCommandDto,
  CamProgramDto,
  CamSetupDto,
  CamSimulationResultDto,
  Point3Dto,
  SolidSceneDto,
} from '../../engine/types';

interface Props {
  setup: CamSetupDto;
  program: CamProgramDto | null;
  simulation: CamSimulationResultDto | null;
  scene: SolidSceneDto;
  busy: boolean;
  error: string | null;
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface Triangle {
  points: [Vec3, Vec3, Vec3];
  color: [number, number, number];
  alpha: number;
}

interface ProjectedPoint {
  x: number;
  y: number;
  depth: number;
}

const MAX_TARGET_TRIANGLES = 30_000;
const MAX_STOCK_TRIANGLES = 65_536;

/**
 * Cross-platform presentation for the headless Rust voxel simulator. Native
 * Bevy can consume the same triangle soup directly; this canvas keeps browser
 * and automated builds useful while the dedicated Bevy CAM scene is added.
 */
export function CamSimulationViewport({
  setup,
  program,
  simulation,
  scene,
  busy,
  error,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const [yaw, setYaw] = useState(-0.72);
  const [pitch, setPitch] = useState(0.82);
  const [zoom, setZoom] = useState(1);
  const [canvasSize, setCanvasSize] = useState({ width: 1, height: 1 });

  const targetTriangles = useMemo(
    () => buildTargetTriangles(scene, setup),
    [scene, setup.body_ids, setup.wcs],
  );
  const stockTriangles = useMemo(
    () => buildStockTriangles(simulation),
    [simulation?.stock_mesh],
  );
  const toolpath = useMemo(
    () => buildToolpathSegments(program?.commands ?? []),
    [program],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => {
      const rect = canvas.getBoundingClientRect();
      setCanvasSize({ width: Math.max(1, rect.width), height: Math.max(1, rect.height) });
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawScene({
      canvas,
      setup,
      targetTriangles,
      stockTriangles,
      toolpath,
      collisions: simulation?.collisions.map((collision) => collision.position) ?? [],
      yaw,
      pitch,
      zoom,
      width: canvasSize.width,
      height: canvasSize.height,
    });
  }, [canvasSize, pitch, setup, simulation?.collisions, stockTriangles, targetTriangles, toolpath, yaw, zoom]);

  return (
    <div
      className="relative h-full min-h-[420px] overflow-hidden bg-[#10151a]"
      data-testid="cam-3d-simulation"
    >
      <canvas
        ref={canvasRef}
        className="h-full w-full cursor-grab touch-none active:cursor-grabbing"
        aria-label="Interactive 3D CAM stock simulation"
        onPointerDown={(event) => {
          dragRef.current = { x: event.clientX, y: event.clientY };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const previous = dragRef.current;
          if (!previous) return;
          const dx = event.clientX - previous.x;
          const dy = event.clientY - previous.y;
          dragRef.current = { x: event.clientX, y: event.clientY };
          setYaw((value) => value + dx * 0.008);
          setPitch((value) => Math.max(-1.45, Math.min(1.45, value + dy * 0.008)));
        }}
        onPointerUp={(event) => {
          dragRef.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          dragRef.current = null;
        }}
        onWheel={(event) => {
          event.preventDefault();
          setZoom((value) => Math.max(0.35, Math.min(4, value * Math.exp(-event.deltaY * 0.001))));
        }}
      />

      <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-1.5 text-[9px] font-semibold uppercase tracking-wide">
        <Badge label="3D voxel stock" tone="accent" />
        {simulation && (
          <>
            <Badge
              label={`${(simulation.removed_volume_mm3 / 1_000).toFixed(2)} cm³ removed`}
              tone="neutral"
            />
            <Badge
              label={`${simulation.stock_mesh?.triangle_count ?? 0} triangles`}
              tone="neutral"
            />
            <Badge
              label={`${simulation.dimensions.join('×')} voxels`}
              tone="neutral"
            />
            {simulation.collisions.length > 0 && (
              <Badge label={`${simulation.collisions.length} rapid collisions`} tone="danger" />
            )}
          </>
        )}
      </div>

      <div className="pointer-events-none absolute bottom-3 right-3 rounded border border-edge bg-header/85 px-2 py-1 text-[9px] text-mute backdrop-blur-sm">
        Drag to orbit · wheel to zoom · setup coordinates
      </div>

      {(busy || error || !simulation) && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded border border-edge bg-header/90 px-4 py-2 text-center text-[11px] text-mute shadow-xl backdrop-blur-sm">
            {busy ? 'Simulating volumetric stock…' : error ?? 'Run 3D simulation to generate remaining stock.'}
          </div>
        </div>
      )}
    </div>
  );
}

function Badge({ label, tone }: { label: string; tone: 'accent' | 'neutral' | 'danger' }) {
  const color = tone === 'accent'
    ? 'border-accent/40 bg-accent/15 text-accent'
    : tone === 'danger'
      ? 'border-warn/50 bg-warn/15 text-warn'
      : 'border-edge bg-header/80 text-mute';
  return <span className={`rounded border px-1.5 py-0.5 backdrop-blur-sm ${color}`}>{label}</span>;
}

function buildStockTriangles(simulation: CamSimulationResultDto | null): Triangle[] {
  const positions = simulation?.stock_mesh?.positions ?? [];
  const count = Math.min(Math.floor(positions.length / 9), MAX_STOCK_TRIANGLES);
  const triangles: Triangle[] = [];
  for (let index = 0; index < count; index += 1) {
    const offset = index * 9;
    triangles.push({
      points: [
        { x: positions[offset], y: positions[offset + 1], z: positions[offset + 2] },
        { x: positions[offset + 3], y: positions[offset + 4], z: positions[offset + 5] },
        { x: positions[offset + 6], y: positions[offset + 7], z: positions[offset + 8] },
      ],
      color: [112, 133, 144],
      alpha: 0.94,
    });
  }
  return triangles;
}

function buildTargetTriangles(scene: SolidSceneDto, setup: CamSetupDto): Triangle[] {
  const wanted = new Set(setup.body_ids);
  const candidates: Triangle[] = [];
  for (const body of scene.bodies) {
    if (!wanted.has(body.id)) continue;
    const { positions, indices } = body.mesh;
    for (let index = 0; index + 2 < indices.length; index += 3) {
      const points = [indices[index], indices[index + 1], indices[index + 2]].map((vertex) => {
        const offset = vertex * 3;
        return modelToSetup(
          { x: positions[offset], y: positions[offset + 1], z: positions[offset + 2] },
          setup,
        );
      }) as [Vec3, Vec3, Vec3];
      candidates.push({ points, color: [71, 157, 214], alpha: 0.22 });
    }
  }
  if (candidates.length <= MAX_TARGET_TRIANGLES) return candidates;
  const stride = Math.ceil(candidates.length / MAX_TARGET_TRIANGLES);
  return candidates.filter((_, index) => index % stride === 0);
}

interface ToolpathSegment {
  from: Point3Dto;
  to: Point3Dto;
  rapid: boolean;
}

function buildToolpathSegments(commands: CamCommandDto[]): ToolpathSegment[] {
  const segments: ToolpathSegment[] = [];
  let position: Point3Dto | null = null;
  for (const command of commands) {
    if (command.kind === 'rapid' || command.kind === 'linear') {
      if (position) segments.push({ from: position, to: command.to, rapid: command.kind === 'rapid' });
      position = command.to;
      continue;
    }
    if (command.kind === 'circular') {
      if (!position) {
        position = command.to;
        continue;
      }
      const startAngle = Math.atan2(position.y - command.center.y, position.x - command.center.x);
      const endAngle = Math.atan2(command.to.y - command.center.y, command.to.x - command.center.x);
      let sweep = endAngle - startAngle;
      if (command.clockwise) {
        while (sweep >= 0) sweep -= Math.PI * 2;
      } else {
        while (sweep <= 0) sweep += Math.PI * 2;
      }
      const radius = Math.hypot(position.x - command.center.x, position.y - command.center.y);
      const count = Math.max(8, Math.min(96, Math.ceil(Math.abs(sweep) * radius / 1.5)));
      let previous = position;
      for (let index = 1; index <= count; index += 1) {
        const t = index / count;
        const angle = startAngle + sweep * t;
        const next = {
          x: command.center.x + Math.cos(angle) * radius,
          y: command.center.y + Math.sin(angle) * radius,
          z: position.z + (command.to.z - position.z) * t,
        };
        segments.push({ from: previous, to: next, rapid: false });
        previous = next;
      }
      position = command.to;
    }
  }
  return segments;
}

function modelToSetup(point: Point3Dto, setup: CamSetupDto): Vec3 {
  const relative = [
    point.x - setup.wcs.origin.x,
    point.y - setup.wcs.origin.y,
    point.z - setup.wcs.origin.z,
  ];
  const project = (axis: [number, number, number]) =>
    relative[0] * axis[0] + relative[1] * axis[1] + relative[2] * axis[2];
  return {
    x: project(setup.wcs.x_axis),
    y: project(setup.wcs.y_axis),
    z: project(setup.wcs.z_axis),
  };
}

interface DrawInput {
  canvas: HTMLCanvasElement;
  setup: CamSetupDto;
  targetTriangles: Triangle[];
  stockTriangles: Triangle[];
  toolpath: ToolpathSegment[];
  collisions: Point3Dto[];
  yaw: number;
  pitch: number;
  zoom: number;
  width: number;
  height: number;
}

function drawScene(input: DrawInput) {
  const {
    canvas,
    setup,
    targetTriangles,
    stockTriangles,
    toolpath,
    collisions,
    yaw,
    pitch,
    zoom,
    width,
    height,
  } = input;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const context = canvas.getContext('2d');
  if (!context) return;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);

  const center = {
    x: (setup.stock.min.x + setup.stock.max.x) * 0.5,
    y: (setup.stock.min.y + setup.stock.max.y) * 0.5,
    z: (setup.stock.min.z + setup.stock.max.z) * 0.5,
  };
  const extent = Math.max(
    setup.stock.max.x - setup.stock.min.x,
    setup.stock.max.y - setup.stock.min.y,
    setup.stock.max.z - setup.stock.min.z,
    1,
  );
  const scale = Math.min(width, height) * 0.68 / extent * zoom;
  const project = (point: Vec3): ProjectedPoint => projectPoint(point, center, yaw, pitch, scale, width, height);

  const projected = [...targetTriangles, ...stockTriangles].map((triangle) => {
    const points = triangle.points.map(project) as [ProjectedPoint, ProjectedPoint, ProjectedPoint];
    return { triangle, points, depth: (points[0].depth + points[1].depth + points[2].depth) / 3 };
  });
  projected.sort((left, right) => left.depth - right.depth);

  for (const item of projected) {
    const normal = triangleNormal(item.triangle.points);
    const rotatedNormal = rotate(normal, yaw, pitch);
    const light = Math.max(0.18, Math.min(1, 0.42 + rotatedNormal.x * -0.16 + rotatedNormal.y * -0.25 + rotatedNormal.z * 0.55));
    const [r, g, b] = item.triangle.color.map((value) => Math.round(value * light));
    context.beginPath();
    context.moveTo(item.points[0].x, item.points[0].y);
    context.lineTo(item.points[1].x, item.points[1].y);
    context.lineTo(item.points[2].x, item.points[2].y);
    context.closePath();
    context.fillStyle = `rgba(${r}, ${g}, ${b}, ${item.triangle.alpha})`;
    context.fill();
  }

  context.lineCap = 'round';
  for (const segment of toolpath) {
    const from = project(segment.from);
    const to = project(segment.to);
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.strokeStyle = segment.rapid ? 'rgba(239, 170, 75, 0.72)' : 'rgba(87, 214, 163, 0.92)';
    context.lineWidth = segment.rapid ? 1 : 1.4;
    context.setLineDash(segment.rapid ? [4, 3] : []);
    context.stroke();
  }
  context.setLineDash([]);

  for (const collision of collisions) {
    const point = project(collision);
    context.beginPath();
    context.arc(point.x, point.y, 5, 0, Math.PI * 2);
    context.fillStyle = 'rgba(239, 96, 88, 0.95)';
    context.fill();
    context.strokeStyle = 'rgba(255, 235, 230, 0.95)';
    context.lineWidth = 1;
    context.stroke();
  }

  drawAxes(context, project, setup);
}

function projectPoint(
  point: Vec3,
  center: Vec3,
  yaw: number,
  pitch: number,
  scale: number,
  width: number,
  height: number,
): ProjectedPoint {
  const rotated = rotate(
    { x: point.x - center.x, y: point.y - center.y, z: point.z - center.z },
    yaw,
    pitch,
  );
  return {
    x: width * 0.5 + rotated.x * scale,
    y: height * 0.52 - rotated.y * scale,
    depth: rotated.z,
  };
}

function rotate(point: Vec3, yaw: number, pitch: number): Vec3 {
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const x = cosYaw * point.x - sinYaw * point.y;
  const y = sinYaw * point.x + cosYaw * point.y;
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);
  return {
    x,
    y: cosPitch * y - sinPitch * point.z,
    z: sinPitch * y + cosPitch * point.z,
  };
}

function triangleNormal(points: [Vec3, Vec3, Vec3]): Vec3 {
  const a = {
    x: points[1].x - points[0].x,
    y: points[1].y - points[0].y,
    z: points[1].z - points[0].z,
  };
  const b = {
    x: points[2].x - points[0].x,
    y: points[2].y - points[0].y,
    z: points[2].z - points[0].z,
  };
  const normal = {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
  const length = Math.hypot(normal.x, normal.y, normal.z) || 1;
  return { x: normal.x / length, y: normal.y / length, z: normal.z / length };
}

function drawAxes(
  context: CanvasRenderingContext2D,
  project: (point: Vec3) => ProjectedPoint,
  setup: CamSetupDto,
) {
  const origin = setup.stock.min;
  const length = Math.max(4, Math.min(
    setup.stock.max.x - setup.stock.min.x,
    setup.stock.max.y - setup.stock.min.y,
  ) * 0.12);
  for (const [axis, end, color] of [
    ['X', { x: origin.x + length, y: origin.y, z: origin.z }, '#ed6a5a'],
    ['Y', { x: origin.x, y: origin.y + length, z: origin.z }, '#57d6a3'],
    ['Z', { x: origin.x, y: origin.y, z: origin.z + length }, '#66b9ef'],
  ] as const) {
    const start = project(origin);
    const target = project(end);
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(target.x, target.y);
    context.strokeStyle = color;
    context.lineWidth = 2;
    context.stroke();
    context.fillStyle = color;
    context.font = '10px ui-monospace, monospace';
    context.fillText(axis, target.x + 3, target.y - 3);
  }
}
