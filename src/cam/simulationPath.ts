import type { CamSimulationResultDto, CamSimulationStepDto, Point3Dto } from '../engine/types';
import type { NativeViewportLineLayer } from '../components/viewport/nativeViewportBridge';
import { setupPointToModel } from './geometry';

type Rgba = [number, number, number, number];
export const RAPID_LINE: Rgba = [0.94, 0.67, 0.29, 0.8];
export const CUT_LINE: Rgba = [0.34, 0.84, 0.64, 0.95];
export const PLAYED_LINE: Rgba = [0.18, 0.48, 1, 1];
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

interface SimulationPlaybackPose {
  position: Point3Dto;
  toolId: number | null;
  stepIndex: number;
  sourceLine: number | null;
}

/** Continuous pose over the prepared physical timeline. CAM stock frames use
 * the same line/arc interpolation in Rust, independent of the orbit camera. */
export function simulationPlaybackPose(
  timeline: CamSimulationResultDto,
  timeSeconds: number,
): SimulationPlaybackPose | null {
  if (timeline.steps.length === 0) return null;
  const time = clamp(timeSeconds, 0, Math.max(0, timeline.estimated_seconds));
  let low = 0;
  let high = timeline.steps.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    // At a tool-change/operation boundary, show the NEXT move's tool, not
    // the cutter that just finished. This matches Rust's completed partition.
    if (timeline.steps[middle].cumulative_seconds <= time + 1e-9) low = middle + 1;
    else high = middle;
  }
  const stepIndex = Math.min(low, timeline.steps.length - 1);
  const step = timeline.steps[stepIndex];
  const startTime = step.cumulative_seconds - step.duration_seconds;
  const fraction = step.duration_seconds > 1e-9
    ? clamp((time - startTime) / step.duration_seconds, 0, 1)
    : 1;
  const position = simulationStepPoint(step, fraction);
  if (!position) return null;
  return {
    position,
    toolId: step.tool_id,
    stepIndex,
    sourceLine: step.source_line,
  };
}

function simulationStepPoint(step: CamSimulationStepDto, fraction: number): Point3Dto | null {
  const from = step.from ?? step.to;
  const to = step.to ?? step.from;
  if (!from || !to) return null;
  if (step.kind !== 'circular' || !step.center || step.clockwise === null || !step.plane) {
    return {
      x: from.x + (to.x - from.x) * fraction,
      y: from.y + (to.y - from.y) * fraction,
      z: from.z + (to.z - from.z) * fraction,
    };
  }
  const [su, sv, sw] = arcComponents(from, step.plane);
  const [eu, ev, ew] = arcComponents(to, step.plane);
  const [cu, cv] = arcComponents(step.center, step.plane);
  const startAngle = Math.atan2(sv - cv, su - cu);
  const endAngle = Math.atan2(ev - cv, eu - cu);
  let sweep = endAngle - startAngle;
  if (step.clockwise) {
    while (sweep >= 0) sweep -= Math.PI * 2;
  } else {
    while (sweep <= 0) sweep += Math.PI * 2;
  }
  const radius = Math.hypot(su - cu, sv - cv);
  const angle = startAngle + sweep * fraction;
  return pointFromArcComponents(
    cu + radius * Math.cos(angle),
    cv + radius * Math.sin(angle),
    sw + (ew - sw) * fraction,
    step.plane,
  );
}

function arcComponents(point: Point3Dto, plane: 'xy' | 'xz' | 'yz'): [number, number, number] {
  if (plane === 'xz') return [point.z, point.x, point.y];
  if (plane === 'yz') return [point.y, point.z, point.x];
  return [point.x, point.y, point.z];
}

function pointFromArcComponents(
  u: number,
  v: number,
  w: number,
  plane: 'xy' | 'xz' | 'yz',
): Point3Dto {
  if (plane === 'xz') return { x: v, y: w, z: u };
  if (plane === 'yz') return { x: w, y: u, z: v };
  return { x: u, y: v, z: w };
}

let nextPlaybackPathId = 1;
const playbackPathIds = new WeakMap<CamSimulationResultDto, number>();
const playbackPathCache = new WeakMap<CamSimulationResultDto, {
  firstCommand: number;
  layers: NativeViewportLineLayer[];
}>();

/** Opaque identity prevents a late clock from coloring a different timeline. */
export function simulationPlaybackPathId(timeline: CamSimulationResultDto): number {
  let id = playbackPathIds.get(timeline);
  if (id === undefined) {
    id = nextPlaybackPathId++;
    playbackPathIds.set(timeline, id);
  }
  return id;
}

/** Retained physical centerline with chord timing. Bevy splits the one active
 * chord at the actual tool tip, so arcs/helices meet the cutter exactly too.
 * No cutting, stock extraction, or full-path serialization on clock ticks. */
export function simulationPlaybackPathLayers(
  timeline: CamSimulationResultDto,
  firstCommand = 0,
): NativeViewportLineLayer[] {
  const cached = playbackPathCache.get(timeline);
  if (cached?.firstCommand === firstCommand) return cached.layers;
  const pathId = simulationPlaybackPathId(timeline);
  const makeLayer = (color: Rgba, pattern: 'dotted' | 'solid'): NativeViewportLineLayer => ({
    color, width: 2, pattern, segments: [],
    playback: { pathId, completedColor: PLAYED_LINE, segmentTimes: [] },
  });
  const rapid = makeLayer(RAPID_LINE, 'dotted');
  const cutting = makeLayer(CUT_LINE, 'solid');
  for (const step of timeline.steps) {
    if (step.command_index < firstCommand) continue;
    if (!step.from || !step.to || step.kind === 'dwell') continue;
    const target = step.kind === 'rapid' ? rapid : cutting;
    const segmentCount = step.kind === 'circular' ? 32 : 1;
    const startTime = step.cumulative_seconds - step.duration_seconds;
    let previous = simulationStepPoint(step, 0);
    for (let segment = 1; previous && segment <= segmentCount; segment += 1) {
      const next = simulationStepPoint(step, segment / segmentCount);
      if (!next) break;
      const fromModel = setupPointToModel(previous, timeline.wcs);
      const toModel = setupPointToModel(next, timeline.wcs);
      target.segments.push(
        fromModel.x,
        fromModel.y,
        fromModel.z,
        toModel.x,
        toModel.y,
        toModel.z,
      );
      target.playback!.segmentTimes.push(
        startTime + step.duration_seconds * (segment - 1) / segmentCount,
        startTime + step.duration_seconds * segment / segmentCount,
      );
      previous = next;
    }
  }
  const layers = [rapid, cutting].filter((layer) => layer.segments.length > 0);
  playbackPathCache.set(timeline, { firstCommand, layers });
  return layers;
}
