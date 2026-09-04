import type { PlaneBasis, ProfileCatalogItemDto } from '../engine/types';
import {
  allRevolveAxisLineOptions,
  areSketchPlanesCoplanar,
  revolveProfileAcceptsAxis,
  revolveAxisLineOptions,
} from './revolveAxis';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  [${ok ? 'ok' : 'FAIL'}] ${name}${ok ? '' : ` — ${detail}`}`);
  if (!ok) failures += 1;
};

const xy: PlaneBasis = {
  origin: [0, 0, 0],
  u: [1, 0, 0],
  v: [0, 1, 0],
  normal: [0, 0, 1],
};
const rotatedXy: PlaneBasis = {
  origin: [12, -4, 0],
  u: [0, 1, 0],
  v: [-1, 0, 0],
  normal: [0, 0, 1],
};
const offsetXy: PlaneBasis = {
  ...xy,
  origin: [0, 0, 2],
};

const entry = (
  sketch_name: string,
  feature_id: number,
  basis: PlaneBasis,
  lineId: number,
  withProfile = false,
): ProfileCatalogItemDto => ({
  sketch_name,
  feature_id,
  basis,
  profiles: withProfile
    ? [{
        index: 0,
        points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 8 }, { x: 0, y: 8 }],
        area: 80,
        parent_index: null,
        nesting_depth: 0,
        curves: [{
          kind: 'line',
          entity_id: lineId,
          source_entity_ids: [lineId],
          start: { x: 0, y: 0 },
          end: { x: 0, y: 8 },
        }],
      }]
    : [],
  profile_error: null,
  lines: [{ entity_id: lineId, start: { x: 0, y: 0 }, end: { x: 0, y: 8 } }],
  path_curves: [],
  reference_points: [],
});

console.log('revolve axis eligibility');
check('rotated and translated bases on one plane are coplanar', areSketchPlanesCoplanar(xy, rotatedXy));
check('parallel offset planes are not coplanar', !areSketchPlanesCoplanar(xy, offsetXy));

const options = revolveAxisLineOptions([
  entry('Profile', 1, xy, 10, true),
  entry('AxisOnly', 2, rotatedXy, 20),
  entry('OffPlane', 3, offsetXy, 30),
], 'Profile');
const fullCatalog = [
  entry('Profile', 1, xy, 10, true),
  entry('AxisOnly', 2, rotatedXy, 20),
  entry('OffPlane', 3, offsetXy, 30),
];
check(
  'profile boundary lines remain valid axes',
  options.some((option) => option.sketchName === 'Profile' && option.line.entity_id === 10),
);
check(
  'line-only coplanar sketches contribute axes without replacing the profile',
  options.some((option) => option.sketchName === 'AxisOnly' && option.line.entity_id === 20),
);
check(
  'off-plane straight lines are excluded',
  !options.some((option) => option.sketchName === 'OffPlane'),
);
check(
  'axis-first selection exposes straight lines before a profile establishes the plane',
  allRevolveAxisLineOptions(fullCatalog).map((option) => option.line.entity_id).join(',')
    === '10,20,30',
);
check(
  'an axis-first selection accepts only coplanar profiles afterward',
  revolveProfileAcceptsAxis(fullCatalog, 'Profile', {
    sketchName: 'AxisOnly',
    entityId: 20,
  })
    && !revolveProfileAcceptsAxis(fullCatalog, 'OffPlane', {
      sketchName: 'AxisOnly',
      entityId: 20,
    }),
);

if (failures > 0) {
  console.error(`\nrevolve axis eligibility: ${failures} check(s) failed`);
  throw new Error(`${failures} revolve axis eligibility check(s) failed`);
}
console.log('\nall passed');
