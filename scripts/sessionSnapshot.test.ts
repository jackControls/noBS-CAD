import assert from 'node:assert/strict';
import { captureSessionSnapshot, synchronizeSnapshotVisibility } from '../src/sessionSnapshot';

let writes = 0;
const visibility = { hidden_body_ids: [1, 2], hidden_datum_plane_ids: [], hidden_sketch_names: [] };
const read = async () => visibility;
const write = async () => { writes++; };
await synchronizeSnapshotVisibility(visibility, read, write);
await synchronizeSnapshotVisibility({ ...visibility, hidden_body_ids: [2, 1] }, read, write);
assert.equal(writes, 0, 'unchanged visibility must not create phantom revisions');
await synchronizeSnapshotVisibility({ ...visibility, hidden_body_ids: [1] }, read, write);
assert.equal(writes, 1, 'real visibility changes must still synchronize');

let revision = 0;
const operations = {
  synchronizeVisibility: async () => { revision++; },
  reserve: async () => revision,
  activeSketch: async (): Promise<unknown | null> => null,
  exportModel: async () => '{"model":true}',
};
const complete = await captureSessionSnapshot(operations);
assert.equal(complete.reservation, revision, 'export must not invalidate its reserved revision');
assert.equal(complete.modelJson, '{"model":true}');
const editing = await captureSessionSnapshot({ ...operations,
  activeSketch: async () => ({ entities: [] }),
  exportModel: async () => { throw new Error('unfinished sketch'); },
});
assert.equal(editing.modelJson, null);
assert.deepEqual(editing.activeSketch, { entities: [] });
await assert.rejects(captureSessionSnapshot({ ...operations,
  exportModel: async () => { throw new Error('export failed'); },
}), /export failed/);
const racing = await captureSessionSnapshot({ ...operations,
  exportModel: async () => { revision++; return '{}'; },
});
assert.notEqual(racing.reservation, revision, 'a real concurrent edit must remain detectable');
console.log('PASS snapshot revision, active sketch, failure propagation, and concurrent edit');

