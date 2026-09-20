/**
 * Unit tests for concentric constraint payload selection.
 *
 * Run: `npm run test:constraint-glyphs`
 */
import type { EntityDto } from '../engine/types';
import { buildConcentricPayload } from './applyConstraint';

let failures = 0;

function check(label: string, condition: boolean, detail = ''): void {
  if (!condition) failures += 1;
  console.log(`  [${condition ? 'ok' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`);
}

function kind(id: number): EntityDto['kind'] {
  if (id === 1) return 'point';
  if (id === 2 || id === 3) return 'circle';
  return 'arc';
}

console.log('buildConcentricPayload');

{
  const payloads = buildConcentricPayload([1, 2], [kind(1), kind(2)]);
  check(
    'point + circle → center_coincident',
    payloads.length === 1 &&
      payloads[0].type === 'center_coincident' &&
      payloads[0].point === 1 &&
      payloads[0].curve === 2,
  );
}

{
  const payloads = buildConcentricPayload([2, 1], [kind(2), kind(1)]);
  check(
    'circle + point → center_coincident (normalized)',
    payloads.length === 1 &&
      payloads[0].type === 'center_coincident' &&
      payloads[0].point === 1 &&
      payloads[0].curve === 2,
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
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}

console.log('\nAll applyConstraint tests passed.');
