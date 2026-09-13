import assert from 'node:assert/strict';
import { camOperationPlacement, duplicatedCamOperation, duplicatedCamSetup, insertCamOperation } from '../src/cam/editing';
import type { CamDocumentDto, CamOperationDto } from '../src/engine/types';

// Full intent is opaque to these list-edit helpers. Rust remains responsible
// for geometry/strategy validation; every nested field must survive the copy.
const operation = (id: number, name: string) => ({
  id, name, kind: 'contour2d', enabled: true, tool_id: 1,
  path: [{ x: 1, y: 2 }], chain_ref: { source: 'model', keys: ['edge-a'], reversed: true },
  cutting: { feed_xy: 321 },
});
const cam = {
  active_setup_id: 1, next_setup_id: 3, next_operation_id: 4, next_tool_id: 2,
  tools: [{ id: 1, diameter: 12 }],
  setups: [
    { id: 1, name: 'Setup 1', body_ids: [17], operations: [operation(1, 'Profile'), operation(2, 'Finish')],
      wcs: { origin: { x: 2, y: 3, z: 4 } }, stock: { min: { x: 0, y: 0, z: 0 } },
      stock_spec: { mode: 'box' }, resolved_stock: { shape: 'box' },
      machine: { profile: { name: 'Machine A' }, post: { dialect: 'siemens828d' } }, work_offset: 'G54' },
    { id: 2, name: 'Setup 2', body_ids: [17], operations: [operation(3, 'Rest')],
      stock_spec: { mode: 'rest_from_setup', setup_id: 1 }, resolved_stock: { shape: 'rest', source_setup_id: 1 } },
  ],
  height_expressions: [{ operation_id: 1, top: { reference: 'stock_top', offset: 2 } }],
  linking: [{ operation_id: 1, predrill_positions: [{ x: 1, y: 2 }], lead_in: { horizontal_radius: 1.2 } }],
  toolpath_generations: [{ operation_id: 1, operation_fingerprint: 'original' }],
} as unknown as CamDocumentDto;
const before = structuredClone(cam);
const opCopy = duplicatedCamOperation(cam, 1);
assert.deepEqual(opCopy.document.setups[0].operations.map(o => o.id), [1, 4, 2]);
assert.equal(opCopy.document.setups[0].operations[1].name, 'Profile (copy)');
assert.deepEqual(opCopy.document.linking?.[1], { ...cam.linking![0], operation_id: 4 });
assert.deepEqual(opCopy.document.height_expressions?.[1], { ...cam.height_expressions![0], operation_id: 4 });
assert.deepEqual(opCopy.document.toolpath_generations, cam.toolpath_generations);
assert.deepEqual(opCopy.document.tools, cam.tools);
const another = duplicatedCamOperation(opCopy.document, 1);
assert.equal(another.document.setups[0].operations[1].name, 'Profile (copy 2)');
assert.equal(another.operationId, 5);
assert.equal(another.document.next_operation_id, 6);

const setupCopy = duplicatedCamSetup(cam, 1);
assert.deepEqual(setupCopy.document.setups.map(s => s.id), [1, 3, 2]);
const cloned = setupCopy.document.setups[1];
assert.equal(cloned.name, 'Setup 1 (copy)');
assert.deepEqual(cloned.operations.map(o => o.id), [4, 5]);
for (const field of ['wcs', 'stock', 'stock_spec', 'resolved_stock', 'machine', 'body_ids', 'work_offset'] as const) {
  assert.deepEqual(cloned[field], cam.setups[0][field]);
}
assert.deepEqual(setupCopy.document.toolpath_generations, cam.toolpath_generations);
assert.deepEqual(setupCopy.document.setups[2].resolved_stock, { shape: 'rest', source_setup_id: 1 });
const restCopy = duplicatedCamSetup(cam, 2);
assert.deepEqual(restCopy.document.setups[2].resolved_stock, cam.setups[1].resolved_stock);
assert.deepEqual(restCopy.document.setups[2].stock_spec, cam.setups[1].stock_spec);
cloned.wcs.origin.x = 123;
setupCopy.document.linking![1].predrill_positions[0].x = 456;
assert.deepEqual(cam, before, 'copies must not mutate original snapshots or intent');
assert.equal(setupCopy.document.setups[0].wcs.origin.x, 2);
assert.equal(setupCopy.document.linking![0].predrill_positions[0].x, 1);

const placement = camOperationPlacement(cam, 2)!;
assert.deepEqual(placement, { setupId: 1, beforeOperationId: 2 });
const inserted = structuredClone(cam);
inserted.active_setup_id = 2; // Destination is fixed at dialog open, not Save.
insertCamOperation(inserted, operation(4, 'Inserted') as CamOperationDto, placement);
assert.deepEqual(inserted.setups[0].operations.map(o => o.id), [1, 4, 2]);
insertCamOperation(inserted, operation(5, 'Append') as CamOperationDto, camOperationPlacement(cam, null));
assert.deepEqual(inserted.setups[0].operations.map(o => o.id), [1, 4, 2, 5]);
assert.deepEqual(camOperationPlacement(cam, 3), { setupId: 2, beforeOperationId: 3 });
const removed = structuredClone(cam);
removed.setups[0].operations.pop();
assert.throws(() => insertCamOperation(removed, operation(4, 'No') as CamOperationDto, placement), /insertion toolpath no longer exists/);
assert.deepEqual(removed.setups[0].operations.map(o => o.id), [1]);
assert.throws(() => duplicatedCamOperation(cam, 99), /no longer exists/);
assert.throws(() => duplicatedCamSetup(cam, 99), /no longer exists/);
console.log('PASS: fresh duplicate IDs, deep-copied intent, no copied generation, rest-source identity, stable insertion anchor, append and deleted-anchor guard.');
