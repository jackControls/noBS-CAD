const assert = {
  ok(value: boolean) { if (!value) throw new Error('Assertion failed'); },
  equal(actual: unknown, expected: unknown) { if (actual !== expected) throw new Error(`${actual} != ${expected}`); },
  deepEqual(actual: unknown, expected: unknown) { if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Values differ'); },
  throws(run: () => unknown) { try { run(); } catch { return; } throw new Error('Expected rejection'); },
};
import { applyLayoutProposal, rotationDegrees, rotationFromDegrees } from './viewLayout';
import { DEFAULT_PRINT_BED, type NamedViewConfigurationDto, type PrintLayoutReport } from './engine/types';

for (const degrees of [[0,0,0], [15,30,40], [-45,20,90], [180,0,0]]) {
  const actual = rotationDegrees(rotationFromDegrees(degrees));
  actual.forEach((v,i) => assert.ok(Math.abs(v - degrees[i]) < 1e-8));
}
const view: NamedViewConfigurationDto = { name:'Print', camera:{ position:[10,10,10],target:[0,0,0],up:[0,0,1] },
  visible_body_ids:[1], occurrence_offsets:[{occurrence_id:1,translation:[5,6,7],rotation:rotationFromDegrees([0,0,90])},
    {occurrence_id:2,translation:[1,2,3],rotation:[0,0,0,1]}] };
const report: PrintLayoutReport = { bed:DEFAULT_PRINT_BED,printable_instances:3,printable_groups:2,excluded_instances:0,
  issues:[],proposed_translations:[{occurrence_id:1,translation:[10,-3,-7]},{occurrence_id:3,translation:[20,20,0]}],
  proposal_fits:true,clearance_mm:2,overlap_check:'bounds' };
const moved = applyLayoutProposal(view, report);
assert.deepEqual(moved.occurrence_offsets?.[0].translation,[15,3,0]);
assert.deepEqual(moved.occurrence_offsets?.[0].rotation,view.occurrence_offsets?.[0].rotation);
assert.deepEqual(moved.occurrence_offsets?.[1],view.occurrence_offsets?.[1]);
assert.equal(moved.occurrence_offsets?.length,3);
assert.deepEqual(view.occurrence_offsets?.[0].translation,[5,6,7]);
assert.throws(() => applyLayoutProposal(view,{...report,proposal_fits:false}));
console.log('Named-view rotations and reviewed whole-group corrections passed');
