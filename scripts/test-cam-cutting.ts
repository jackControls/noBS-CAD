import assert from 'node:assert/strict';
import {
  cuttingDraftFrom, cuttingDraftValues, editCuttingDraft, resolveCuttingDraft, convertCuttingDraftUnits,
  type CuttingContext, type CuttingField,
} from '../src/cam/cuttingDraft';

const context: CuttingContext = { units: 'millimeters', tool: { diameter: 10, flute_count: 4 } };
const initial = { spindle_rpm: 6000, feed_xy: 600, feed_z: 120, coolant: 'flood' as const };
const close = (actual: number | string, expected: number) =>
  assert.ok(Math.abs(Number(actual) - expected) < 1e-8 * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
let draft = cuttingDraftFrom(initial, context.units);
const values = () => cuttingDraftValues(draft, context);
const read = () => resolveCuttingDraft(draft, context, 'flood');
const edit = (field: CuttingField, value: string) => { draft = editCuttingDraft(draft, field, value); };
close(values().surfaceSpeed, Math.PI * 60);
close(values().feedPerTooth, 0.025);
close(values().feedPerRev, 0.02);
assert.deepEqual(read(), initial);
edit('feedPerTooth', '0.05');
close(read().feed_xy, 1200);
edit('rpm', '12000');
close(read().feed_xy, 2400);
close(values().feedPerTooth, 0.05);
edit('feedXy', '900');
edit('rpm', '6000');
close(read().feed_xy, 900);
close(values().feedPerTooth, 0.0375);
edit('surfaceSpeed', String(Math.PI * 30));
assert.equal(read().spindle_rpm, 3000);
edit('feedPerRev', '0.1');
close(read().feed_z, 300);
edit('feedPerTooth', '0.05');
const larger: CuttingContext = { ...context, tool: { diameter: 20, flute_count: 2 } };
const changed = resolveCuttingDraft(draft, larger, 'flood');
assert.equal(changed.spindle_rpm, 1500);
close(changed.feed_xy, 150);
close(changed.feed_z, 150);
assert.equal(draft.speed.mode, 'surface');
assert.equal(draft.speed.value, String(Math.PI * 30));
edit('rpm', '6000');
edit('feedZ', '75');
edit('rpm', '3000');
assert.equal(read().feed_z, 75, 'explicit feedrate stays fixed when RPM changes');
edit('surfaceSpeed', '188.5');
assert.equal(read().spindle_rpm, 6000);
assert.equal(read().feed_xy, 1200, 'feed derives from the whole-number RPM actually saved');

// Incomplete/invalid drivers must not fall back to an earlier valid value.
for (const field of ['rpm', 'surfaceSpeed', 'feedXy', 'feedPerTooth', 'feedZ', 'feedPerRev'] as const) {
  for (const bad of ['', ' ', '0', '-1', 'NaN', 'Infinity', '1e999']) {
    const invalid = editCuttingDraft(cuttingDraftFrom(initial, context.units), field, bad);
    assert.throws(() => resolveCuttingDraft(invalid, context, 'flood'));
  }
}
edit('surfaceSpeed', '');
assert.equal(values().rpm, '');
assert.equal(values().feedXy, '');
assert.equal(draft.speed.value, '');
assert.throws(read, /Surface speed/);
draft = cuttingDraftFrom(initial, context.units);
edit('feedPerTooth', '0.01');
for (const flute_count of [0, -1, 1.5, NaN, Infinity]) {
  assert.throws(() => resolveCuttingDraft(draft, { ...context, tool: { diameter: 10, flute_count } }, 'off'));
}
edit('surfaceSpeed', '100');
for (const diameter of [0, -1, NaN, Infinity]) {
  assert.throws(() => resolveCuttingDraft(draft, { ...context, tool: { diameter, flute_count: 4 } }, 'off'));
}
assert.throws(() => resolveCuttingDraft(draft, { ...context, tool: null }, 'off'));
edit('surfaceSpeed', '0.000001');
assert.throws(read, /Resolved spindle speed/);

// Inch feeds/chip loads and SFM have distinct conversions. Unit toggles hold
// the same physical input, including the chosen drivers.
draft = cuttingDraftFrom(initial, context.units);
edit('surfaceSpeed', '188.5');
edit('feedPerTooth', '0.05');
edit('feedPerRev', '0.02');
const inch = { ...context, units: 'inches' as const };
const converted = convertCuttingDraftUnits(draft, 'millimeters', 'inches');
close(Number(converted.speed.value), 188.5 / 0.3048);
close(Number(converted.feed.value), 0.05 / 25.4);
const inchCutting = resolveCuttingDraft(converted, inch, 'flood');
close(inchCutting.feed_xy, read().feed_xy);
close(inchCutting.feed_z, read().feed_z);
assert.equal(inchCutting.spindle_rpm, read().spindle_rpm);
const back = convertCuttingDraftUnits(converted, 'inches', 'millimeters');
close(resolveCuttingDraft(back, context, 'flood').feed_xy, read().feed_xy);
assert.equal(back.feed.mode, 'per_tooth');
assert.equal(back.speed.mode, 'surface');
const empty = cuttingDraftFrom(undefined, 'millimeters');
assert.equal(convertCuttingDraftUnits(empty, 'millimeters', 'inches').feed.value, '');

// Presets and reopened operations resolve to exactly the stored cutting data.
const precise = { ...initial, feed_xy: 123.456789123456, feed_z: 76.543219876543 };
assert.deepEqual(resolveCuttingDraft(cuttingDraftFrom(precise, 'inches'), inch, 'flood'), precise);
const drill = editCuttingDraft(cuttingDraftFrom(initial, context.units), 'feedPerRev', '0.05');
assert.deepEqual(resolveCuttingDraft(drill, context, 'off', true), {
  spindle_rpm: 6000, feed_xy: 300, feed_z: 300, coolant: 'off',
});
console.log('PASS: bidirectional speed/chip-load pairs, driver precedence, tool changes, integer RPM, metric/inch, invalid inputs, presets and drilling feed/revolution');
