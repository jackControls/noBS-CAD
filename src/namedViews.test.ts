import { armNamedViewCameraRestore, cancelNamedViewCameraRestore } from './namedViewCamera';
import { displayPointFromModel, modelPointFromDisplay, translateByPartOffset } from './namedViewOffsets';
import type { ViewCameraDto, ViewPartOffsetDto } from './engine/types';

function same(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: ${JSON.stringify(actual)}`);
  }
}

const offsets: ViewPartOffsetDto[] = [
  { body_id: 2, translation: [0, 14, 0] },
  { body_id: 3, translation: [0, -14, 0] },
];

same(
  translateByPartOffset([10, 20, 30], 2, offsets),
  [10, 34, 30],
  'A recalled explode offset is added in world millimeters',
);
same(
  translateByPartOffset([10, 20, 30], 3, offsets),
  [10, 6, 30],
  'The opposite clip moves the other way',
);
same(
  translateByPartOffset([1, 2, 3], 9, offsets),
  [1, 2, 3],
  'A body without an offset keeps the assembled pose',
);
const original: [number, number, number] = [1, 2, 3];
translateByPartOffset(original, 2, offsets);
same(original, [1, 2, 3], 'Display offsets do not mutate the source translation');
const modelPoint = { x: 10, y: 20, z: 30 };
const displayPoint = displayPointFromModel(modelPoint, 2, offsets);
same(displayPoint, { x: 10, y: 34, z: 30 }, 'Selection markers follow the displayed body');
same(modelPointFromDisplay(displayPoint, 2, offsets), modelPoint,
  'Hole and move picks exclude the explode offset from committed coordinates');
same(modelPointFromDisplay(modelPoint, 9, offsets), modelPoint, 'Unexploded picks keep their coordinates');

const first: ViewCameraDto = { position: [1, 0, 0], target: [0, 0, 0], up: [0, 0, 1] };
const second: ViewCameraDto = { position: [0, 8, 2], target: [0, 0, 0], up: [0, 0, 1] };
let mounted: { restore(camera: ViewCameraDto): void } | null = null;
const restored: ViewCameraDto[] = [];
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of [...listeners]) listener();
};
armNamedViewCameraRestore(first, () => mounted, (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
});
armNamedViewCameraRestore(second, () => mounted, (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
});
same(listeners.size, 1, 'A newer recall drops the camera listener still waiting');
let depth = 0;
mounted = {
  restore: (camera) => {
    restored.push(camera);
    depth += 1;
    if (depth > 4) throw new Error('camera restore re-entered its own listener');
    notify();
    depth -= 1;
  },
};
notify();
same(restored, [second], 'Only the latest named view reaches the camera');
same(listeners.size, 0, 'The camera listener is released after it applies');

mounted = null;
let current = true;
armNamedViewCameraRestore(first, () => mounted, (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
}, () => current);
current = false;
mounted = { restore: (camera) => { restored.push(camera); } };
notify();
same(restored, [second], 'A replaced document never receives a pending named-view camera');
same(listeners.size, 0, 'Invalidated restores release their listener');
mounted = null;
armNamedViewCameraRestore(first, () => mounted, (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
});
cancelNamedViewCameraRestore();
same(listeners.size, 0, 'Reset/replacement cancels a pending camera even while the viewport is absent');

console.log('Named view display offsets passed.');
