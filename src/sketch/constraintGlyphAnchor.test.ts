/**
 * Focused regression tests for single-point constraint glyph anchors.
 *
 * Covers the follow-ups from PR #67: circle–circle tangency in both entity
 * orders (external and internal), and perpendicular lines whose finite
 * segments are disjoint but whose infinite supports still intersect.
 *
 * Run: `npm run test:constraint-glyphs`
 */
import type { ConstraintDto, EntityDto, Vec2 } from '../engine/types';
import {
  offsetGlyphFromAnchor,
  singlePointRelationAnchor,
} from './constraintGlyphAnchor';

let failures = 0;

function near(a: Vec2, b: Vec2, eps = 1e-9): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= eps;
}

function check(label: string, condition: boolean, detail = ''): void {
  if (!condition) failures += 1;
  console.log(`  [${condition ? 'ok' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`);
}

function circle(id: number, center: Vec2, radius: number): EntityDto {
  return { kind: 'circle', id, center, radius, fully_defined: false };
}

function line(id: number, start: Vec2, end: Vec2): EntityDto {
  return {
    kind: 'line',
    id,
    start_id: id * 10,
    end_id: id * 10 + 1,
    start,
    end,
    fully_defined: false,
    consumed: false,
  };
}

function byId(...entities: EntityDto[]): Map<number, EntityDto> {
  return new Map(entities.map((entity) => [entity.id, entity]));
}

function tangent(
  a: number,
  b: number,
): ConstraintDto {
  return { id: 1, type: 'tangent', a, b };
}

console.log('constraint glyph anchors');

{
  // External: centers 30 apart, radii 10+20. Contact at (10, 0) from origin.
  const left = circle(1, { x: 0, y: 0 }, 10);
  const right = circle(2, { x: 30, y: 0 }, 20);
  const expected = { x: 10, y: 0 };
  const map = byId(left, right);
  const ab = singlePointRelationAnchor(tangent(1, 2), map);
  const ba = singlePointRelationAnchor(tangent(2, 1), map);
  check('external circle-circle contact (a,b)', !!ab && near(ab, expected), JSON.stringify(ab));
  check('external circle-circle contact (b,a)', !!ba && near(ba, expected), JSON.stringify(ba));
  check('external order-independent', !!ab && !!ba && near(ab, ba));
}

{
  // Internal: large r=20 at origin, small r=10 at x=10. Contact at (20, 0).
  const large = circle(1, { x: 0, y: 0 }, 20);
  const small = circle(2, { x: 10, y: 0 }, 10);
  const expected = { x: 20, y: 0 };
  const map = byId(large, small);
  const largeThenSmall = singlePointRelationAnchor(tangent(1, 2), map);
  const smallThenLarge = singlePointRelationAnchor(tangent(2, 1), map);
  check(
    'internal circle-circle contact (large,small)',
    !!largeThenSmall && near(largeThenSmall, expected),
    JSON.stringify(largeThenSmall),
  );
  check(
    'internal circle-circle contact (small,large)',
    !!smallThenLarge && near(smallThenLarge, expected),
    JSON.stringify(smallThenLarge),
  );
  check(
    'internal order-independent',
    !!largeThenSmall && !!smallThenLarge && near(largeThenSmall, smallThenLarge),
  );
}

{
  // Finite segments do not meet: horizontal [0,10]×{0}, vertical {20}×[10,20].
  // Infinite lines intersect at (20, 0).
  const horizontal = line(1, { x: 0, y: 0 }, { x: 10, y: 0 });
  const vertical = line(2, { x: 20, y: 10 }, { x: 20, y: 20 });
  const expected = { x: 20, y: 0 };
  const map = byId(horizontal, vertical);
  const ab = singlePointRelationAnchor(
    { id: 1, type: 'perpendicular', a: 1, b: 2 },
    map,
  );
  const ba = singlePointRelationAnchor(
    { id: 1, type: 'perpendicular', a: 2, b: 1 },
    map,
  );
  check(
    'perpendicular disjoint segments use infinite intersection',
    !!ab && near(ab, expected),
    JSON.stringify(ab),
  );
  check(
    'perpendicular order-independent',
    !!ab && !!ba && near(ab, ba),
    JSON.stringify(ba),
  );
}

console.log('constraint glyph offsets');

{
  const anchor = { x: 0, y: 0 };
  const placed = offsetGlyphFromAnchor(anchor, {
    nudge: 10,
    preferredDir: { x: 1, y: 1 },
    obstacles: [anchor],
    clearRadius: 5,
  });
  check(
    'offset leaves the relation anchor',
    Math.hypot(placed.x - anchor.x, placed.y - anchor.y) > 1,
    JSON.stringify(placed),
  );
  check(
    'preferred NE used when clear',
    near(placed, { x: 10 / Math.SQRT2, y: 10 / Math.SQRT2 }, 1e-6),
    JSON.stringify(placed),
  );
}

{
  const anchor = { x: 0, y: 0 };
  // Block NE; expect the next candidate (N) to win.
  const ne = {
    x: 10 / Math.SQRT2,
    y: 10 / Math.SQRT2,
  };
  const placed = offsetGlyphFromAnchor(anchor, {
    nudge: 10,
    preferredDir: { x: 1, y: 1 },
    obstacles: [ne],
    clearRadius: 3,
  });
  check(
    'blocked preferred direction falls back to another candidate',
    near(placed, { x: 0, y: 10 }, 1e-6),
    JSON.stringify(placed),
  );
}

{
  const anchor = { x: 0, y: 0 };
  // Size-based rule used by the viewport: gripHalf + glyphHalf + gap.
  const gripHalf = 4;
  const glyphPx = 15;
  const gap = 8;
  const nudge = gripHalf + glyphPx * 0.5 + gap;
  const placed = offsetGlyphFromAnchor(anchor, {
    nudge,
    preferredDir: { x: 1, y: 0 },
    obstacles: [anchor],
    clearRadius: nudge,
  });
  check(
    'size-based nudge clears grip + half badge + gap',
    Math.abs(placed.x - nudge) < 1e-9 && Math.abs(placed.y) < 1e-9,
    JSON.stringify({ placed, nudge }),
  );
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  throw new Error(`${failures} constraint glyph test failure(s)`);
}
console.log('\nall passed');
