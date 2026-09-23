/**
 * Concentric circles share one center handle, so a click on that handle has to
 * resolve to a circle rather than to the shared point. Run with:
 * `npm run test:center-pick`.
 */
import type { EntityDto } from '../engine/types';
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

const TOLERANCE = 0.5;

check(
  'a lone circle keeps its center point pickable',
  coincidentCircleAt([point(1, 20, 10), circle(2, 20, 10)], { x: 20, y: 10 }, TOLERANCE) === null,
);

check(
  'concentric circles resolve to the last one drawn',
  coincidentCircleAt(
    [circle(4, 20, 10, 5), point(5, 20, 10), circle(9, 20, 10, 8)],
    { x: 20, y: 10 },
    TOLERANCE,
  ) === 9,
);

check(
  'resolution follows creation order, not radius',
  coincidentCircleAt([circle(9, 20, 10, 8), circle(4, 20, 10, 5)], { x: 20, y: 10 }, TOLERANCE) ===
    4,
);

check(
  'a merely nearby center is not concentric',
  coincidentCircleAt(
    [circle(1, 20, 10, 5), circle(2, 30, 10, 5)],
    { x: 20, y: 10 },
    TOLERANCE,
  ) === null,
  'a circle centred outside tolerance must not claim the click',
);

check(
  'a shared center is shared to within tolerance, not exactly',
  coincidentCircleAt(
    [circle(1, 20, 10, 5), circle(2, 20.2, 10.1, 8)],
    { x: 20, y: 10 },
    TOLERANCE,
  ) === 2,
);

check(
  'arcs sharing a center do not claim the click',
  coincidentCircleAt(
    [
      circle(1, 20, 10, 5),
      {
        kind: 'arc',
        id: 2,
        center: { x: 20, y: 10 },
        radius: 9,
        start_angle: 0,
        end_angle: Math.PI,
        fully_defined: false,
      },
    ],
    { x: 20, y: 10 },
    TOLERANCE,
  ) === null,
  'only circles participate, so a circle-arc pair keeps the center point',
);

if (failures > 0) {
  console.error(`\nsketch center pick: ${failures} check(s) failed`);
  throw new Error(`${failures} sketch center pick check(s) failed`);
}
console.log('\nall passed');
