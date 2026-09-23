/**
 * Concentric circles share one center handle, so a click on that handle has to
 * resolve to a circle rather than to the shared point — and only when the point
 * is genuinely shared. Run with: `npm run test:center-pick`.
 */
import type { ConstraintDto, EntityDto } from '../engine/types';
import { coincidentCircleAt } from './sketchCenterPick';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  [${ok ? 'ok' : 'FAIL'}] ${name}${ok ? '' : ` — ${detail}`}`);
  if (!ok) failures += 1;
};

const circle = (id: number, x: number, y: number, radius = 5): EntityDto => ({
  kind: 'circle',
  id,
  center: { x, y },
  radius,
  fully_defined: false,
});

const point = (id: number, x: number, y: number): EntityDto => ({
  kind: 'point',
  id,
  position: { x, y },
  fully_defined: false,
});

const center = (id: number, pointId: number, curve: number): ConstraintDto => ({
  id,
  type: 'center_coincident',
  point: pointId,
  curve,
});

check(
  'a lone circle keeps its center point pickable',
  coincidentCircleAt([point(1, 20, 10), circle(2, 20, 10)], [center(1, 1, 2)], 1) === null,
);

check(
  'concentric circles resolve to the last one drawn',
  coincidentCircleAt(
    [circle(4, 20, 10, 5), point(5, 20, 10), circle(9, 20, 10, 8)],
    [center(1, 5, 4), center(2, 5, 9)],
    5,
  ) === 9,
);

check(
  'resolution follows creation order, not radius',
  coincidentCircleAt(
    [circle(9, 20, 10, 8), circle(4, 20, 10, 5), point(5, 20, 10)],
    [center(1, 5, 9), center(2, 5, 4)],
    5,
  ) === 4,
);

check(
  'a point bound to one circle is never redirected',
  coincidentCircleAt(
    [point(1, 20, 10), point(2, 20.1, 10.1), circle(3, 20, 10)],
    [center(1, 1, 3)],
    2,
  ) === null,
  'an unrelated nearby point has no center binding at all',
);

check(
  'circles centred a fraction apart keep independent handles',
  coincidentCircleAt(
    [point(1, 20, 10), circle(2, 20, 10), point(3, 20.2, 10), circle(4, 20.2, 10)],
    [center(1, 1, 2), center(2, 3, 4)],
    1,
  ) === null,
  'proximity is not identity: each center is bound to exactly one circle',
);

check(
  'a circle-arc pair does not claim the click',
  coincidentCircleAt(
    [
      point(1, 20, 10),
      circle(2, 20, 10),
      {
        kind: 'arc',
        id: 3,
        center: { x: 20, y: 10 },
        radius: 9,
        start_angle: 0,
        end_angle: Math.PI,
        fully_defined: false,
      },
    ],
    [center(1, 1, 2), center(2, 1, 3)],
    1,
  ) === null,
  'only circles participate, so a circle-arc pair keeps the center point',
);

if (failures > 0) {
  console.error(`\nsketch center pick: ${failures} check(s) failed`);
  throw new Error(`${failures} sketch center pick check(s) failed`);
}
console.log('\nall passed');
