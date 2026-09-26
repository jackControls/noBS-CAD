/**
 * Unit tests for concentric constraint payload selection.
 *
 * Run: `npm run test:constraint-glyphs`
 */
import { buildConcentricPayload } from './applyConstraint';

let failures = 0;

function check(label: string, condition: boolean, detail = ''): void {
  if (!condition) failures += 1;
  console.log(`  [${condition ? 'ok' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`);
}

console.log('buildConcentricPayload');

{
  const payloads = buildConcentricPayload([1, 2], ['point', 'circle']);
  check(
    'point + circle → center_coincident',
    payloads.length === 1 &&
      payloads[0].type === 'center_coincident' &&
      payloads[0].point === 1 &&
      payloads[0].curve === 2,
  );
}

{
  const payloads = buildConcentricPayload([2, 1], ['circle', 'point']);
  check(
    'circle + point → center_coincident (normalized)',
    payloads.length === 1 &&
      payloads[0].type === 'center_coincident' &&
      payloads[0].point === 1 &&
      payloads[0].curve === 2,
  );
}

{
  const payloads = buildConcentricPayload([1, 5], ['point', 'arc']);
  check(
    'point + arc → center_coincident',
    payloads.length === 1 &&
      payloads[0].type === 'center_coincident' &&
      payloads[0].point === 1 &&
      payloads[0].curve === 5,
  );
}

{
  const payloads = buildConcentricPayload([5, 1], ['arc', 'point']);
  check(
    'arc + point → center_coincident (normalized)',
    payloads.length === 1 &&
      payloads[0].type === 'center_coincident' &&
      payloads[0].point === 1 &&
      payloads[0].curve === 5,
  );
}

{
  const payloads = buildConcentricPayload([2, 3], ['circle', 'circle']);
  check(
    'circle + circle → concentric',
    payloads.length === 1 &&
      payloads[0].type === 'concentric' &&
      payloads[0].a === 2 &&
      payloads[0].b === 3,
  );
}

{
  const payloads = buildConcentricPayload([1, 4], ['point', 'line']);
  check('point + line → no payload', payloads.length === 0);
}

if (failures > 0) {
  throw new Error(`${failures} applyConstraint payload check(s) failed`);
}

console.log('\nAll applyConstraint payload tests passed.');
