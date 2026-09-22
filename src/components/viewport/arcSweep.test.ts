import { advanceArcTravel, beginArcAngleText, beginArcTravel, resolvedArcSweep } from './arcSweep';
import { creationPreviewPositions } from './toolPreview';

const assert = {
  ok(condition: boolean, message = 'assertion failed') { if (!condition) throw new Error(message); },
  equal(actual: unknown, expected: unknown, message = `${actual} != ${expected}`) { this.ok(actual === expected, message); },
};

const rad = (deg: number) => deg * Math.PI / 180;
const near = (actual: number, degrees: number) => assert.ok(Math.abs(actual - rad(degrees)) < 1e-9, `${actual} != ${degrees}°`);
for (const sign of [-1, 1] as const) {
  const state = beginArcTravel(rad(175));
  near(advanceArcTravel(state, rad(175 - sign * 0.5)), 0);
  assert.equal(state.direction, 0, 'jitter must not choose direction');
  near(advanceArcTravel(state, rad(175 + sign * 32)), sign * 32);
  assert.equal(state.direction, sign);
  const crossed = advanceArcTravel(state, rad(175 - sign * 5));
  near(crossed, sign * 355);
  near(resolvedArcSweep(crossed, sign * 90), sign * 90);
  near(resolvedArcSweep(crossed, -sign * 90), -sign * 90);
  near(resolvedArcSweep(crossed, 0), 0);
  const circle = beginArcTravel(0);
  for (let deg = 10; deg <= 360; deg += 10) {
    near(advanceArcTravel(circle, rad(sign * deg)), sign * deg);
  }
}
assert.equal(beginArcAngleText('-32.0', '9'), '-9');
assert.equal(beginArcAngleText('-32.0', '+'), '+');
assert.equal(beginArcAngleText('32.0', '-'), '-');
assert.equal(beginArcAngleText('-32.0', '='), '=');
console.log('Arc direction, jitter, sign entry and full-turn tests passed.');
assert.equal(JSON.stringify(creationPreviewPositions([
  { kind: 'line', a: { x: 0, y: 0 }, b: { x: 2, y: 0 } },
  { kind: 'line', a: { x: 2, y: 3 }, b: { x: 2, y: 0 } },
])), JSON.stringify([0, 0, 0.12, 2, 0, 0.12, 2, 3, 0.12]));
