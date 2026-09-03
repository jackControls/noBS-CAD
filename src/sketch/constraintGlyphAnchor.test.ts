/**
 * Focused regression tests for single-point constraint glyph anchors.
 *
 * Covers the follow-ups from PR #67: circle–circle tangency in both entity
 * orders (external and internal), and perpendicular lines whose finite
 * segments are disjoint but whose infinite supports still intersect.
 *
 * Run: `npm run test:constraint-glyphs`
 */
import type {
  ConstraintDto,
  EntityDto,
  GeometricConstraintType,
  Vec2,
} from '../engine/types';
import {
  CONSTRAINT_EXISTENCE_GLYPH,
  distributedRelationGlyphTargets,
  layoutConstraintGlyphs,
  offsetGlyphFromAnchor,
  rightAngleGlyphFrame,
  singlePointRelationAnchor,
} from './constraintGlyphAnchor';
import { constraintReferencedEntityIds } from './constraintRefs';
import {
  CONSTRAINT_ICON_PRIMITIVES,
  CONSTRAINT_TYPE_ICON,
  TOOL_CONSTRAINT_ICON,
} from './constraintIcons';

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
  const geometricTypes = [
    'horizontal',
    'vertical',
    'horizontal_points',
    'vertical_points',
    'coincident',
    'origin_coincident',
    'center_coincident',
    'tangent',
    'equal',
    'parallel',
    'perpendicular',
    'fix',
    'midpoint',
    'reference_midpoint',
    'span_midpoint',
    'concentric',
    'collinear',
    'symmetry',
    'arc_endpoint_coincident',
    'equal_distance',
  ] satisfies GeometricConstraintType[];
  check(
    'every geometric constraint has a non-empty existence glyph',
    geometricTypes.every((type) => CONSTRAINT_EXISTENCE_GLYPH[type].trim().length > 0),
  );
  check(
    'every geometric constraint resolves to shared toolbar/viewport artwork',
    geometricTypes.every(
      (type) => CONSTRAINT_ICON_PRIMITIVES[CONSTRAINT_TYPE_ICON[type]].length > 0,
    ),
  );
  check(
    'perpendicular retains an explicit semantic fallback label',
    CONSTRAINT_EXISTENCE_GLYPH.perpendicular === '⊥',
    CONSTRAINT_EXISTENCE_GLYPH.perpendicular,
  );
  check(
    'perpendicular artwork includes a dedicated right-angle square',
    CONSTRAINT_ICON_PRIMITIVES.perpendicular.some(
      (primitive) => primitive.type === 'path' && primitive.d === 'M5 14h5v5',
    ),
  );
  check(
    'combined Horizontal/Vertical command remains visually distinct from Perpendicular',
    TOOL_CONSTRAINT_ICON.hv !== TOOL_CONSTRAINT_ICON.perpendicular
      && CONSTRAINT_ICON_PRIMITIVES[TOOL_CONSTRAINT_ICON.hv].length > 0,
  );
}

{
  const point: EntityDto = {
    kind: 'point',
    id: 7,
    position: { x: 0, y: 0 },
    fully_defined: true,
  };
  const centered = circle(8, { x: 12, y: -4 }, 5);
  const originAnchor = singlePointRelationAnchor(
    { id: 1, type: 'origin_coincident', entity: 7 },
    byId(point, centered),
  );
  check(
    'origin coincidence has a visible anchor on its acquired entity',
    !!originAnchor && near(originAnchor, point.position),
    JSON.stringify(originAnchor),
  );
  const centerAnchor = singlePointRelationAnchor(
    { id: 2, type: 'center_coincident', point: 7, curve: 8 },
    byId(point, centered),
  );
  check(
    'center coincidence has a visible anchor on its acquired point',
    !!centerAnchor && near(centerAnchor, point.position),
    JSON.stringify(centerAnchor),
  );
  check(
    'center coincidence highlights both the point and curve',
    constraintReferencedEntityIds({
      id: 2,
      type: 'center_coincident',
      point: 7,
      curve: 8,
    }).join(',') === '7,8',
  );
}

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
  const midpointPoint: EntityDto = {
    kind: 'point',
    id: 7,
    position: { x: 12, y: -4 },
    fully_defined: false,
  };
  const map = byId(midpointPoint);
  const spanAnchor = singlePointRelationAnchor(
    { id: 1, type: 'span_midpoint', point: 7, start: 8, end: 9 },
    map,
  );
  check(
    'internal span-midpoint relation retains a visible point anchor',
    !!spanAnchor && near(spanAnchor, midpointPoint.position),
    JSON.stringify(spanAnchor),
  );
  const spanRefs = constraintReferencedEntityIds({
    id: 1,
    type: 'span_midpoint',
    point: 7,
    start: 8,
    end: 9,
  });
  check(
    'span-midpoint relation highlights its point and both carriers',
    spanRefs.join(',') === '7,8,9',
    spanRefs.join(','),
  );
}

{
  const endpoint: EntityDto = {
    kind: 'point',
    id: 7,
    position: { x: 5, y: 6 },
    fully_defined: false,
  };
  const arc: EntityDto = {
    kind: 'arc',
    id: 8,
    center: { x: 0, y: 0 },
    radius: 10,
    start_angle: 0,
    end_angle: Math.PI / 2,
    fully_defined: false,
  };
  const constraint: ConstraintDto = {
    id: 1,
    type: 'arc_endpoint_coincident',
    point: 7,
    arc: 8,
    end: 'end',
  };
  const anchor = singlePointRelationAnchor(constraint, byId(endpoint, arc));
  check(
    'internal arc-endpoint coincidence retains a visible point anchor',
    !!anchor && near(anchor, endpoint.position),
    JSON.stringify(anchor),
  );
  check(
    'internal arc relation references both visible entities',
    constraintReferencedEntityIds(constraint).join(',') === '7,8',
    constraintReferencedEntityIds(constraint).join(','),
  );
}

{
  const equalDistance: ConstraintDto = {
    id: 1,
    type: 'equal_distance',
    origin: 1,
    a: 2,
    b: 3,
  };
  check(
    'equal-distance relation includes its origin in glyph placement',
    constraintReferencedEntityIds(equalDistance).join(',') === '2,3,1',
    constraintReferencedEntityIds(equalDistance).join(','),
  );
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
  const distributed = distributedRelationGlyphTargets(
    { id: 1, type: 'perpendicular', a: 1, b: 2 },
    map,
  );
  check(
    'disjoint perpendicular features receive one marker each',
    distributed.length === 2
      && distributed.map((target) => target.entityId).join(',') === '1,2',
    JSON.stringify(distributed),
  );
}

{
  const horizontal = line(1, { x: -10, y: 0 }, { x: 10, y: 0 });
  const vertical = line(2, { x: 0, y: -10 }, { x: 0, y: 10 });
  const distributed = distributedRelationGlyphTargets(
    { id: 1, type: 'perpendicular', a: 1, b: 2 },
    byId(horizontal, vertical),
  );
  check(
    'intersecting perpendicular features retain one shared square marker',
    distributed.length === 0,
    JSON.stringify(distributed),
  );
}

{
  const upper = line(1, { x: 0, y: 10 }, { x: 20, y: 10 });
  const lower = line(2, { x: 0, y: 0 }, { x: 20, y: 0 });
  const targets = distributedRelationGlyphTargets(
    { id: 1, type: 'parallel', a: 1, b: 2 },
    byId(upper, lower),
  );
  check(
    'parallel marks repeat on both lines',
    targets.length === 2
      && near(targets[0].anchor, { x: 10, y: 10 })
      && near(targets[1].anchor, { x: 10, y: 0 }),
    JSON.stringify(targets),
  );
  check(
    'parallel marks offset into the space between the lines',
    targets[0].preferredDir?.y === -1 && targets[1].preferredDir?.y === 1,
    JSON.stringify(targets.map((target) => target.preferredDir)),
  );
}

{
  const horizontal = line(1, { x: -10, y: 0 }, { x: 10, y: 0 });
  const vertical = line(2, { x: 0, y: -10 }, { x: 0, y: 10 });
  const frame = rightAngleGlyphFrame(
    { id: 1, type: 'perpendicular', a: 1, b: 2 },
    byId(horizontal, vertical),
  );
  check(
    'intersecting perpendicular lines expose an aligned square frame',
    !!frame
      && near(frame.vertex, { x: 0, y: 0 })
      && Math.abs(
        frame.directionA.x * frame.directionB.x
          + frame.directionA.y * frame.directionB.y,
      ) < 1e-9
      && Math.abs(frame.maxSize - 10) < 1e-9,
    JSON.stringify(frame),
  );
  const disjoint = rightAngleGlyphFrame(
    { id: 2, type: 'perpendicular', a: 1, b: 3 },
    byId(horizontal, line(3, { x: 20, y: 10 }, { x: 20, y: 20 })),
  );
  check(
    'disjoint perpendicular lines do not draw a detached square',
    disjoint === null,
    JSON.stringify(disjoint),
  );
}

{
  const left = circle(1, { x: -10, y: 0 }, 4);
  const right = circle(2, { x: 10, y: 0 }, 6);
  const targets = distributedRelationGlyphTargets(
    { id: 1, type: 'equal', a: 1, b: 2 },
    byId(left, right),
  );
  check(
    'equal-circle marks repeat on the visible circumferences',
    targets.length === 2
      && near(targets[0].anchor, { x: -14, y: 0 })
      && near(targets[1].anchor, { x: 16, y: 0 }),
    JSON.stringify(targets),
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

{
  const glyphPx = 15;
  const gripHalfPx = 4;
  const gapPx = 10;
  const expectedScreenOffset = gripHalfPx + glyphPx * 0.5 + gapPx;
  const item = {
    anchor: { x: 0, y: 0 },
    glyphPx,
    preferredDir: { x: 1, y: 0 },
  };
  const zoomedOutWorldPerPixel = 2;
  const zoomedInWorldPerPixel = 0.25;
  const [zoomedOut] = layoutConstraintGlyphs([item], {
    worldPerPixel: zoomedOutWorldPerPixel,
    gripHalfPx,
    gapPx,
    obstacles: [item.anchor],
  });
  const [zoomedIn] = layoutConstraintGlyphs([item], {
    worldPerPixel: zoomedInWorldPerPixel,
    gripHalfPx,
    gapPx,
    obstacles: [item.anchor],
  });
  check(
    'zoom refresh preserves badge-to-anchor screen gap',
    Math.abs(zoomedOut.x / zoomedOutWorldPerPixel - expectedScreenOffset) < 1e-9
      && Math.abs(zoomedIn.x / zoomedInWorldPerPixel - expectedScreenOffset) < 1e-9,
    JSON.stringify({ zoomedOut, zoomedIn, expectedScreenOffset }),
  );
  check(
    'zoom refresh changes only the camera-dependent world offset',
    near(zoomedOut, {
      x: zoomedIn.x * (zoomedOutWorldPerPixel / zoomedInWorldPerPixel),
      y: zoomedIn.y * (zoomedOutWorldPerPixel / zoomedInWorldPerPixel),
    }),
    JSON.stringify({ zoomedOut, zoomedIn }),
  );
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  throw new Error(`${failures} constraint glyph test failure(s)`);
}
console.log('\nall passed');
