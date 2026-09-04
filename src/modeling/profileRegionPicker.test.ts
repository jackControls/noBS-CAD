import { pickProfileRegion, type ProfileRegionHit } from './profileRegionPicker';

const hit = (name: string, distance: number, area: number, featureId = 1): ProfileRegionHit => ({
  reference: { sketch_name: name, profile_index: 0 }, distance, outerArea: area, featureId,
});
const large = hit('Sketch1', 100, 4000, 1);
const rectangle = hit('Sketch2', 100, 216, 3);
const expectPick = (name: string, hits: ProfileRegionHit[], expected: string | null) => {
  const actual = pickProfileRegion(hits)?.sketch_name ?? null;
  if (actual !== expected) throw new Error(`${name}: expected ${expected}, got ${actual}`);
  console.log(`  [ok] ${name}`);
};

expectPick('coplanar face rectangle beats its larger source profile', [large, rectangle], 'Sketch2');
expectPick('catalog order does not change the chosen region', [rectangle, large], 'Sketch2');
expectPick('opposite-normal rounding does not swallow the rectangle',
  [large, { ...rectangle, distance: 100 + 1e-12 }], 'Sketch2');
expectPick('the larger region is still selectable outside the rectangle', [large], 'Sketch1');
expectPick('a smaller but more distant profile does not steal a front hit',
  [large, { ...rectangle, distance: 100.001 }], 'Sketch1');
expectPick('small physical gaps are not treated as coplanar',
  [large, { ...rectangle, distance: 100.00001 }], 'Sketch1');
expectPick('the nearest candidate wins regardless of area or catalog order',
  [large, { ...rectangle, distance: 99 }], 'Sketch2');
expectPick('winding direction does not change bounded-area priority',
  [large, { ...rectangle, outerArea: -216 }], 'Sketch2');
expectPick('identical overlapping regions prefer the newer sketch',
  [large, { ...rectangle, outerArea: 4000 }], 'Sketch2');
expectPick('exact ties remain deterministic after candidate reordering',
  [{ ...rectangle, outerArea: 4000 }, large], 'Sketch2');
expectPick('hidden or excluded regions are absent, not retained as hover state', [large], 'Sketch1');
expectPick('invalid and behind-camera hits cannot mask valid regions',
  [hit('behind', -1, 1), hit('invalid', NaN, 1), hit('empty', 1, 0), large], 'Sketch1');
expectPick('empty space has no selected region', [], null);
