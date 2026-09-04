import {
  clipSegmentToFrustum,
  pickClipPolylineCandidate,
  type ClipPoint,
} from './screenSpaceEntityPicker';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  [${ok ? 'ok' : 'FAIL'}] ${name}${ok ? '' : ` — ${detail}`}`);
  if (!ok) failures += 1;
};

const point = (x: number, y: number, z = 0, w = 1): ClipPoint => ({ x, y, z, w });
const viewport = { left: 100, top: 50, width: 800, height: 600 };

console.log('shared finished-sketch screen picker');

const clippedNear = clipSegmentToFrustum(
  point(-0.5, 0, -2),
  point(0.5, 0, 0),
);
check(
  'a line remains pickable when one endpoint is clipped by the near plane',
  clippedNear !== null && clippedNear[0].z >= -clippedNear[0].w - 1e-8,
);

check(
  'a segment entirely behind the camera is rejected',
  clipSegmentToFrustum(point(-0.5, 0, 0, -1), point(0.5, 0, 0, -1)) === null,
);

const visibleAcrossViewport = [{
  key: 'wide',
  value: 1,
  polylines: [[point(-2, 0), point(2, 0)]],
}];
check(
  'off-screen endpoints do not make a visible crossing segment unpickable',
  pickClipPolylineCandidate(
    visibleAcrossViewport,
    { x: 500, y: 350 },
    viewport,
  )?.key === 'wide',
);

check(
  'a line acquires hover throughout the shared forgiving envelope',
  pickClipPolylineCandidate(
    visibleAcrossViewport,
    { x: 500, y: 362 },
    viewport,
  )?.key === 'wide',
);
check(
  'a line outside the shared acquire envelope is not hovered',
  pickClipPolylineCandidate(
    visibleAcrossViewport,
    { x: 500, y: 368 },
    viewport,
  ) === null,
);

const perspectivePick = pickClipPolylineCandidate(
  [{
    key: 'perspective',
    value: 1,
    polylines: [[point(-0.5, 0, 0, 1), point(1, 0, 0, 2)]],
  }],
  { x: 500, y: 350 },
  viewport,
);
check(
  'closest-point ratio is mapped back through perspective for exact 3D picks',
  perspectivePick !== null && Math.abs(perspectivePick.segment.ratio - 1 / 3) < 1e-6,
  String(perspectivePick?.segment.ratio),
);

const neighboringCandidates = [
  { key: 'first', value: 1, polylines: [[point(-0.8, 0), point(0.8, 0)]] },
  { key: 'second', value: 2, polylines: [[point(-0.8, 0.03), point(0.8, 0.03)]] },
];
check(
  'the nearest neighboring line wins without retained hover identity',
  pickClipPolylineCandidate(
    neighboringCandidates,
    { x: 500, y: 344 },
    viewport,
  )?.key === 'second',
);

const routeSamples = [
  pickClipPolylineCandidate(visibleAcrossViewport, { x: 500, y: 350 }, viewport)?.key ?? null,
  pickClipPolylineCandidate(visibleAcrossViewport, { x: 500, y: 400 }, viewport)?.key ?? null,
  pickClipPolylineCandidate(visibleAcrossViewport, { x: 500, y: 350 }, viewport)?.key ?? null,
];
check(
  'leaving through an invalid region never blocks reacquiring the same line',
  routeSamples.join(',') === 'wide,,wide',
  routeSamples.join(','),
);

if (failures > 0) {
  throw new Error(`${failures} screen-space picker check(s) failed`);
}
console.log('\nall passed');
