import assert from 'node:assert/strict';
import { reorderByIds, reorderedCamDocument } from '../src/cam/reorder';
import { camSimulationInputKey } from '../src/cam/simulationUi';
import type { CamDocumentDto, SolidSceneDto } from '../src/engine/types';

const items = [{ id: 11 }, { id: 22 }, { id: 33 }];
assert.deepEqual(reorderByIds(items, [33, 11, 22]), [items[2], items[0], items[1]]);
for (const order of [
  [11, 22],
  [11, 22, 22],
  [11, 22, 44],
  [11, 22, 33, 44],
])
  assert.throws(() => reorderByIds(items, order), /list changed/);
const cam = {
  setups: [
    { id: 1, name: 'First', resolved_stock: { shape: 'box' }, operations: items },
    { id: 2, name: 'Second', resolved_stock: { shape: 'box' }, operations: [] },
  ],
  active_setup_id: 1,
  tools: [{ id: 1 }],
  linking: [{ operation_id: 22, lead_in: { vertical_radius: 0.4 } }],
} as unknown as CamDocumentDto;
const before = structuredClone(cam);
const moved = reorderedCamDocument(cam, 1, [22, 33, 11]);
assert.deepEqual(cam, before, 'pure transformation must not mutate the current document');
assert.deepEqual(
  moved.setups[0].operations.map((o) => o.id),
  [22, 33, 11],
);
assert.deepEqual(moved.linking, cam.linking);
assert.equal(moved.active_setup_id, 1);
assert.deepEqual(
  reorderedCamDocument(cam, null, [2, 1]).setups.map((s) => s.id),
  [2, 1],
);
assert.throws(() => reorderedCamDocument(cam, 3, []), /no longer exists/);
const rest = structuredClone(cam);
rest.setups[1].resolved_stock = { shape: 'rest', source_setup_id: 1 };
assert.throws(() => reorderedCamDocument(rest, null, [2, 1]), /must stay after/);
const scene = {} as SolidSceneDto;
assert.notEqual(
  camSimulationInputKey(cam, scene, 1, 'auto', 0.1),
  camSimulationInputKey(moved, scene, 1, 'auto', 0.1),
  'a reorder changes simulation input identity, including new linking intent',
);
console.log(
  'PASS: exact reorder, rest dependencies, immutable IDs/linking/selection, simulation cache identity',
);
