import assert from 'node:assert/strict';
import { captureSessionSnapshot } from '../src/sessionSnapshot';

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

