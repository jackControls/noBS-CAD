import assert from 'node:assert/strict';
import { simulationPlaybackPathId, simulationPlaybackPathLayers, simulationPlaybackPose } from '../src/cam/simulationPath';
import type { CamSimulationResultDto, CamSimulationStepDto } from '../src/engine/types';

const step = (overrides: Partial<CamSimulationStepDto>): CamSimulationStepDto => ({
  command_index: 1, source_line: null, kind: 'linear', tool_id: 1,
  from: { x: 0, y: 0, z: 0 }, to: { x: 10, y: 0, z: 0 },
  center: null, clockwise: null, plane: null, duration_seconds: 10,
  cumulative_seconds: 10, removed_voxels: 0, gouged_voxels: 0, ...overrides,
});
const timeline = {
  setup_id: 1, estimated_seconds: 25,
  // A rotated/transposed WCS catches accidental setup-space cursor mixing.
  wcs: { origin: { x: 100, y: 200, z: 300 }, x_axis: [0, 1, 0], y_axis: [-1, 0, 0], z_axis: [0, 0, 1] },
  steps: [
    step({ kind: 'rapid' }),
    step({ command_index: 2, kind: 'dwell', from: { x: 10, y: 0, z: 0 }, to: { x: 10, y: 0, z: 0 }, duration_seconds: 5, cumulative_seconds: 15 }),
    step({ command_index: 3, from: { x: 10, y: 0, z: 0 }, to: { x: 10, y: 0, z: -10 }, cumulative_seconds: 25 }),
  ],
} as CamSimulationResultDto;
const paths = simulationPlaybackPathLayers(timeline);
assert.equal(paths.length, 2);
assert.equal(paths[0].pattern, 'dotted');
assert.equal(paths[1].pattern, 'solid');
assert.deepEqual(paths[0].segments, [100, 200, 300, 100, 210, 300]);
assert.deepEqual(paths[0].playback!.segmentTimes, [0, 10]);
assert.deepEqual(paths[1].playback!.segmentTimes, [15, 25], 'dwell must not draw a false motion');
assert.equal(paths[0].playback!.pathId, simulationPlaybackPathId(timeline));
assert.notDeepEqual(paths[0].color, paths[0].playback!.completedColor);
for (const time of [0, 4.25, 20, 25, 1]) {
  simulationPlaybackPose(timeline, time);
  assert.equal(simulationPlaybackPathLayers(timeline), paths, 'clock ticks and rewind must reuse the retained path');
}
const scoped = simulationPlaybackPathLayers(timeline, 3);
assert.equal(scoped.length, 1);
assert.deepEqual(scoped[0].playback!.segmentTimes, [15, 25], 'scope excludes earlier operations');
assert.notEqual(simulationPlaybackPathId({ ...timeline }), simulationPlaybackPathId(timeline), 'replacement timeline has a distinct identity');

for (const plane of ['xy', 'xz', 'yz'] as const) {
  const from = plane === 'xy' ? { x: 10, y: 0, z: 0 } : plane === 'xz' ? { x: 0, y: 0, z: 10 } : { x: 0, y: 10, z: 0 };
  const to = plane === 'xy' ? { x: 0, y: 10, z: -4 } : plane === 'xz' ? { x: 10, y: -4, z: 0 } : { x: -4, y: 0, z: 10 };
  const arc = { ...timeline, estimated_seconds: 10, steps: [step({ kind: 'circular', plane,
    center: { x: 0, y: 0, z: 0 }, clockwise: false, from, to })] };
  const layers = simulationPlaybackPathLayers(arc);
  assert.equal(layers.length, 1);
  assert.equal(layers[0].segments.length / 6, 32);
  assert.equal(layers[0].playback!.segmentTimes.length, 64);
  const time = 4.375; // Exactly on a tessellation boundary.
  const pose = simulationPlaybackPose(arc, time)!;
  const point = pose.position;
  const modelPoint = [100 - point.y, 200 + point.x, 300 + point.z];
  assert.deepEqual(layers[0].segments.slice(14 * 6, 14 * 6 + 3), modelPoint,
    `${plane} helix display and cutter must use the same interpolation/WCS`);
}
console.log('PASS: retained timed path, operation scope, WCS, dwell, all arc planes and clock-only reuse');
