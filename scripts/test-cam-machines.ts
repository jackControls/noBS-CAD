import assert from 'node:assert/strict';
import { createMachineAssignment, readDefaultMachine, reviseMachine, saveDefaultMachine, MACHINE_PRESETS } from '../src/cam/machines';

const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { value: {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
} });
assert.equal(readDefaultMachine(), null);
for (const preset of MACHINE_PRESETS) {
  const machine = createMachineAssignment(preset.dialect);
  assert.equal(machine.profile.post.dialect, preset.dialect);
  assert.equal(machine.mode, 'fixed3_axis');
  assert.equal(machine.profile.axes.length, 3);
  assert.equal(machine.profile.channels[0].axis_ids.length, 3);
  assert.notEqual(machine.profile.id, createMachineAssignment(preset.dialect).profile.id);
  saveDefaultMachine(machine);
  assert.deepEqual(readDefaultMachine(), machine);
  const savedProject = structuredClone(machine);
  const changed = reviseMachine(machine, 'Shop mill');
  assert.equal(changed.profile.revision, machine.profile.revision + 1);
  assert.deepEqual(machine, savedProject);
  saveDefaultMachine(changed);
  assert.deepEqual(machine, savedProject, 'default update must never mutate project snapshots');
  assert.deepEqual(reviseMachine(changed, 'Shop mill'), changed, 'no-op edit keeps revision');
  const post = structuredClone(changed.profile.post);
  post.sequence_numbers = !post.sequence_numbers;
  assert.equal(reviseMachine(changed, 'Shop mill', post).profile.revision, changed.profile.revision + 1);
  if (preset.dialect === 'siemens828d') assert.equal(machine.profile.post.siemens_828d?.preload_next_tool, false);
}
for (const bad of ['{', '{}', 'x'.repeat(20_000)]) {
  storage.set('nbcad.cam.default-machine.v1', bad);
  assert.equal(readDefaultMachine(), null);
}
const rotary = createMachineAssignment('siemens828d');
const mapped = reviseMachine(rotary, rotary.profile.name, rotary.profile.post,
  [{ tool_id: 3, call: { kind: 'name', name: 'EM6a' } }]);
assert.equal(mapped.profile.revision, rotary.profile.revision + 1);
assert.deepEqual(reviseMachine(mapped, mapped.profile.name), mapped);
saveDefaultMachine(mapped);
assert.deepEqual(readDefaultMachine()?.tool_calls, [], 'device presets cannot carry project-specific executable identities');
assert.equal(mapped.tool_calls?.length, 1, 'saving a preset must not mutate the project assignment');
rotary.profile.axes[0].kind = 'rotary';
saveDefaultMachine(rotary);
assert.equal(readDefaultMachine(), null, 'unsupported defaults must not silently become three-axis');
saveDefaultMachine(null);
assert.equal(readDefaultMachine(), null);
const brokenPost = createMachineAssignment('siemens828d');
brokenPost.profile.post.siemens_828d = null;
saveDefaultMachine(brokenPost);
assert.equal(readDefaultMachine(), null, 'broken local post settings must not crash a new Setup dialog');
console.log('PASS: machine starters, independent snapshots, revisions, bounded/default storage and generic fallback');
