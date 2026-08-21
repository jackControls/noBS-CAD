import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  CamCommandDto,
  CamProgramDto,
  CamSetupDto,
  CamSimulationResultDto,
  Point3Dto,
  SolidSceneDto,
} from '../../engine/types';
import { modelBoundsOfBodies } from '../../cam/geometry';
import { cancelCamPointPick, completeCamPointPick } from '../../cam/pointPick';
import { useAppStore } from '../../store/appStore';

interface Props {
  /** Null before the first setup exists: the viewport then shows the modeled
   *  parts in model coordinates, without stock/toolpath/WCS overlays. */
  setup: CamSetupDto | null;
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

// Navigation gesture mapping mirrors the modeling viewport (see
// src/components/viewport/Viewport.tsx): right-drag or Shift+swipe orbits,
// middle-drag or a trackpad swipe pans, and a mouse notch / pinch zooms.
const ORBIT_SPEED = 0.008;
const MIN_PITCH = -1.45;
const MAX_PITCH = 1.45;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 4;

const clampPitch = (value: number) => Math.max(MIN_PITCH, Math.min(MAX_PITCH, value));
const clampZoom = (value: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));

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
  const dragRef = useRef<{ x: number; y: number; mode: 'orbit' | 'pan' } | null>(null);
  const [yaw, setYaw] = useState(-0.72);
  const [pitch, setPitch] = useState(0.82);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [canvasSize, setCanvasSize] = useState({ width: 1, height: 1 });
  const pick = useAppStore((state) => state.camPointPick);
  const [hoverPick, setHoverPick] = useState<number | null>(null);

  const targetTriangles = useMemo(
    () => buildTargetTriangles(scene, setup),
    [scene, setup],
  );
  const stockTriangles = useMemo(
    () => buildStockTriangles(simulation),
    [simulation?.stock_mesh],
  );
  const toolpath = useMemo(
    () => buildToolpathSegments(program?.commands ?? []),
    [program],
  );

  // Camera framing: the setup's stock envelope when one exists, otherwise the
  // modeled parts' bounds in model coordinates.
  const viewFrame = useMemo(() => {
    if (setup) {
      const { min, max } = setup.stock;
      return {
        center: {
          x: (min.x + max.x) * 0.5,
          y: (min.y + max.y) * 0.5,
          z: (min.z + max.z) * 0.5,
        },
        extent: Math.max(max.x - min.x, max.y - min.y, max.z - min.z, 1),
      };
    }
    const bounds = modelBoundsOfBodies(
      scene,
      scene.bodies.map((body) => body.id),
    );
    if (!bounds) return { center: { x: 0, y: 0, z: 0 }, extent: 100 };
    return {
      center: {
        x: (bounds.min.x + bounds.max.x) * 0.5,
        y: (bounds.min.y + bounds.max.y) * 0.5,
        z: (bounds.min.z + bounds.max.z) * 0.5,
      },
      extent: Math.max(
        bounds.max.x - bounds.min.x,
        bounds.max.y - bounds.min.y,
        bounds.max.z - bounds.min.z,
        1,
      ),
    };
  }, [setup, scene]);

  // Single projection shared by the draw pass and pointer hit-testing so a
  // marker's on-screen position and its click target never drift apart.
  const project = useMemo(() => {
    const scale =
      ((Math.min(canvasSize.width, canvasSize.height) * 0.68) / viewFrame.extent) * zoom;
    return (point: Vec3): ProjectedPoint =>
      projectPoint(
        point,
        viewFrame.center,
        yaw,
        pitch,
        scale,
        pan,
        canvasSize.width,
        canvasSize.height,
      );
  }, [canvasSize, viewFrame, yaw, pitch, zoom, pan]);

  // Pick candidates arrive in model coordinates; the view draws setup
  // coordinates when a setup exists.
  const toView = (point: Point3Dto): Vec3 =>
    setup ? modelToSetup(point, setup) : { x: point.x, y: point.y, z: point.z };

  const pickMarkers = useMemo(
    () =>
      (pick?.candidates ?? []).map((candidate, index) => ({
        position: toView(candidate.point),
        label: candidate.label,
        hovered: hoverPick === index,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pick, setup, hoverPick],
  );

  const pickCandidateAt = (clientX: number, clientY: number): number | null => {
    const canvas = canvasRef.current;
    if (!canvas || !pick) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    let best: number | null = null;
    let bestDistance = 16;
    pick.candidates.forEach((candidate, index) => {
      const projected = project(toView(candidate.point));
      const distance = Math.hypot(projected.x - x, projected.y - y);
      if (distance <= bestDistance) {
        best = index;
        bestDistance = distance;
      }
    });
    return best;
  };

  // Escape cancels an active pick session.
  useEffect(() => {
    if (!pick) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelCamPointPick();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pick]);

  // Clear any stale hover marker when a pick session ends.
  useEffect(() => {
    if (!pick) setHoverPick(null);
  }, [pick]);

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

  // Wheel navigation, same mapping as the modeling viewport:
  //   ctrl+wheel  = trackpad pinch → zoom (macOS sets ctrlKey on pinch)
  //   Shift+wheel = orbit (trackpad two-finger swipe)
  //   plain wheel = pan on a trackpad swipe, zoom on a mouse notch
  // Plain events are classified by heuristic: line/page deltaMode, horizontal
  // deltas, non-integer or small deltas, and bursts all mean "trackpad".
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const isWindowsPlatform = /Windows/i.test(navigator.userAgent);
    const TRACKPAD_PINCH_SENSITIVITY = 0.002;
    const TRACKPAD_PINCH_ZOOM_IN_MULTIPLIER = 2;
    const MAX_WHEEL_STEP_PX = 240;
    const gesture = { kind: null as 'mouse' | 'trackpad' | null, lastT: 0, count: 0 };

    // Logitech wheel-tilt is a discrete horizontal notch, not navigation.
    const isDiscreteHorizontalWheel = (event: WheelEvent) =>
      event.deltaY === 0 &&
      event.deltaX !== 0 &&
      !event.ctrlKey &&
      (event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL ||
        (Number.isInteger(event.deltaX) && Math.abs(event.deltaX) >= 50));

    const classify = (event: WheelEvent): 'pan' | 'zoom' => {
      const now = performance.now();
      const gap = now - gesture.lastT;
      gesture.lastT = now;
      if (gap > 350) {
        gesture.kind = null;
        gesture.count = 0;
      }
      gesture.count += 1;
      if (event.deltaMode !== 0) {
        gesture.kind = 'mouse';
        return 'zoom';
      }
      if (gesture.kind === 'trackpad') return 'pan';
      if (gesture.kind === 'mouse') {
        if (gesture.count >= 3 && gap < 120) {
          gesture.kind = 'trackpad';
          return 'pan';
        }
        return 'zoom';
      }
      if (
        event.deltaX !== 0 ||
        !Number.isInteger(event.deltaY) ||
        Math.abs(event.deltaY) < 50 ||
        (gesture.count >= 3 && gap < 120)
      ) {
        gesture.kind = 'trackpad';
        return 'pan';
      }
      if (Math.abs(event.deltaY) >= 100 && gap > 250) {
        gesture.kind = 'mouse';
        return 'zoom';
      }
      return 'pan';
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (isWindowsPlatform && isDiscreteHorizontalWheel(event)) return;
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1;
      const bounded = (value: number) =>
        Number.isFinite(value)
          ? Math.max(-MAX_WHEEL_STEP_PX, Math.min(MAX_WHEEL_STEP_PX, value * unit))
          : 0;
      const deltaX = bounded(event.deltaX);
      const deltaY = bounded(event.deltaY);
      if (deltaX === 0 && deltaY === 0) return;
      if (event.shiftKey) {
        // Shift+swipe orbits; deltas are negated (macOS natural scrolling) so
        // the scene rotates with the fingers, matching the modeling viewport.
        setYaw((value) => value - deltaX * ORBIT_SPEED);
        setPitch((value) => clampPitch(value - deltaY * ORBIT_SPEED));
        return;
      }
      if (event.ctrlKey) {
        // Pinch zoom; zoom-in is twice as responsive as zoom-out.
        const sensitivity =
          TRACKPAD_PINCH_SENSITIVITY *
          (deltaY < 0 ? TRACKPAD_PINCH_ZOOM_IN_MULTIPLIER : 1);
        setZoom((value) => clampZoom(value * Math.exp(-deltaY * sensitivity)));
        return;
      }
      if (classify(event) === 'zoom') {
        setZoom((value) => clampZoom(value * Math.exp(-deltaY * 0.002))); // notch down = zoom out
      } else {
        // Natural scrolling: content tracks the fingers.
        setPan((value) => ({ x: value.x - deltaX, y: value.y - deltaY }));
      }
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
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
      markers: pickMarkers,
      project,
      yaw,
      pitch,
      width: canvasSize.width,
      height: canvasSize.height,
    });
  }, [canvasSize, pickMarkers, pitch, project, setup, simulation?.collisions, stockTriangles, targetTriangles, toolpath, yaw]);

  return (
    <div
      className="relative h-full min-h-[420px] overflow-hidden bg-[#10151a]"
      data-testid="cam-3d-simulation"
    >
      <canvas
        ref={canvasRef}
        className={`h-full w-full touch-none ${
          pick ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'
        }`}
        aria-label="Interactive 3D CAM stock simulation"
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          // Point-picking session: left click chooses the nearest candidate.
          if (pick && event.button === 0) {
            const index = pickCandidateAt(event.clientX, event.clientY);
            if (index !== null) completeCamPointPick(pick.candidates[index]);
            return;
          }
          // Same button mapping as the modeling viewport: right = orbit,
          // middle = pan, Shift+middle = orbit, left = no camera action.
          if (event.button === 2) {
            dragRef.current = { x: event.clientX, y: event.clientY, mode: 'orbit' };
          } else if (event.button === 1) {
            dragRef.current = { x: event.clientX, y: event.clientY, mode: event.shiftKey ? 'orbit' : 'pan' };
          } else {
            return;
          }
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (pick && !dragRef.current) {
            setHoverPick(pickCandidateAt(event.clientX, event.clientY));
            return;
          }
          const previous = dragRef.current;
          if (!previous) return;
          const dx = event.clientX - previous.x;
          const dy = event.clientY - previous.y;
          dragRef.current = { ...previous, x: event.clientX, y: event.clientY };
          if (previous.mode === 'orbit') {
            setYaw((value) => value + dx * ORBIT_SPEED);
            setPitch((value) => clampPitch(value + dy * ORBIT_SPEED));
          } else {
            // Grab feel: content follows the pointer.
            setPan((value) => ({ x: value.x + dx, y: value.y + dy }));
          }
        }}
        onPointerUp={(event) => {
          dragRef.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          dragRef.current = null;
        }}
      />

      <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-1.5 text-[9px] font-semibold uppercase tracking-wide">
        {setup && <Badge label="3D voxel stock" tone="accent" />}
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

      {pick && (
        <div className="pointer-events-none absolute left-1/2 top-3 max-w-[80%] -translate-x-1/2 rounded border border-accent/50 bg-header/90 px-3 py-1.5 text-center text-[11px] text-accent shadow-xl backdrop-blur-sm">
          {pick.prompt} · click a highlighted point · Esc to cancel
        </div>
      )}

      <div className="pointer-events-none absolute bottom-3 right-3 rounded border border-edge bg-header/85 px-2 py-1 text-[9px] text-mute backdrop-blur-sm">
        Right-drag / Shift+swipe orbit · middle-drag / swipe pan · wheel / pinch zoom ·{' '}
        {setup ? 'setup coordinates' : 'model coordinates · no setup yet'}
      </div>

      {(busy || error || (!simulation && setup)) && (
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

function buildTargetTriangles(scene: SolidSceneDto, setup: CamSetupDto | null): Triangle[] {
  // Without a setup every modeled body is shown as-is in model coordinates;
  // with a setup only its bodies are shown, transformed into setup space.
  const wanted = setup ? new Set(setup.body_ids) : null;
  const candidates: Triangle[] = [];
  for (const body of scene.bodies) {
    if (wanted && !wanted.has(body.id)) continue;
    const { positions, indices } = body.mesh;
    for (let index = 0; index + 2 < indices.length; index += 3) {
      const points = [indices[index], indices[index + 1], indices[index + 2]].map((vertex) => {
        const offset = vertex * 3;
        const point = { x: positions[offset], y: positions[offset + 1], z: positions[offset + 2] };
        return setup ? modelToSetup(point, setup) : point;
      }) as [Vec3, Vec3, Vec3];
      candidates.push({ points, color: [71, 157, 214], alpha: setup ? 0.22 : 0.55 });
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

interface PickMarker {
  position: Vec3;
  label: string;
  hovered: boolean;
}

interface DrawInput {
  canvas: HTMLCanvasElement;
  setup: CamSetupDto | null;
  targetTriangles: Triangle[];
  stockTriangles: Triangle[];
  toolpath: ToolpathSegment[];
  collisions: Point3Dto[];
  markers: PickMarker[];
  project: (point: Vec3) => ProjectedPoint;
  /** Camera angles, used only to rotate shading normals. */
  yaw: number;
  pitch: number;
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
    markers,
    project,
    yaw,
    pitch,
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

  // Pick candidates render last so they stay on top of part/stock geometry.
  for (const marker of markers) {
    const point = project(marker.position);
    context.beginPath();
    context.arc(point.x, point.y, marker.hovered ? 6 : 4, 0, Math.PI * 2);
    context.fillStyle = marker.hovered
      ? 'rgba(87, 214, 163, 0.95)'
      : 'rgba(102, 185, 239, 0.9)';
    context.fill();
    context.strokeStyle = 'rgba(16, 21, 26, 0.9)';
    context.lineWidth = 1.5;
    context.stroke();
    if (marker.hovered) {
      context.font = '10px ui-monospace, monospace';
      context.fillStyle = 'rgba(226, 232, 240, 0.95)';
      context.fillText(marker.label, point.x + 9, point.y - 7);
    }
  }

  if (setup) drawAxes(context, project, setup);
}

function projectPoint(
  point: Vec3,
  center: Vec3,
  yaw: number,
  pitch: number,
  scale: number,
  pan: { x: number; y: number },
  width: number,
  height: number,
): ProjectedPoint {
  const rotated = rotate(
    { x: point.x - center.x, y: point.y - center.y, z: point.z - center.z },
    yaw,
    pitch,
  );
  return {
    x: width * 0.5 + pan.x + rotated.x * scale,
    y: height * 0.52 + pan.y - rotated.y * scale,
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
