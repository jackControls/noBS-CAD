/**
 * A sketch hosted on a planar body face receives that face's boundary edges as
 * projected reference geometry. The projected boundary seals a region drawn
 * against it, while a shape drawn inside the face stays the only profile.
 *
 * Browser engine (OpenCascade.js WASM) coverage for
 * docs/SKETCH_FACE_BOUNDARY_PROFILES.md. The native Bevy viewport renders the
 * projected color and the Projected Geometries toggle; that is a desktop
 * appearance check, not this suite.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE = process.env.NBCAD_E2E_BASE_URL ?? 'http://localhost:7199';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error)));

const ARC_RADIUS = 2.5;
const HALF_DISC = (Math.PI * ARC_RADIUS ** 2) / 2;

async function apply(update) {
  await page.evaluate((value) => {
    window.__appStore.getState().applySolidUpdate(value);
  }, update);
}

/** Rectangle sketch -> extrude 10 mm -> a 20 x 15 x 10 body. */
async function createSupportBody() {
  return page.evaluate(async () => {
    const engine = window.__engine;
    const store = window.__appStore.getState();
    store.applySolidUpdate(await engine.newProject());
    await engine.beginSketch({ type: 'origin_plane', plane: 'xy' });
    await engine.setGridSnap(false);
    await engine.addRectangle({
      mode: 'two_point',
      p1: { x: 0, y: 0 },
      p2: { x: 20, y: 15 },
      ctrl_held: true,
    });
    const ended = await engine.endSketch();
    store.setDocument(ended.document);
    const catalog = await engine.profileCatalog();
    const update = await engine.extrude({
      source_face: null,
      sketch_name: catalog[0].sketch_name,
      profile_indices: [0],
      operation: 'new_body',
      extent: { type: 'distance', distance: 10 },
      taper_angle_deg: 0,
      flip: false,
      target_body_ids: [],
    });
    store.applySolidUpdate(update);
    // The support face for the sketch is the extrusion cap (normal +Z).
    const cap = update.scene.bodies[0].faces.find(
      (face) => face.plane && face.plane.normal[2] > 0.99,
    );
    if (!cap) throw new Error('missing the extrude cap');
    return cap.id;
  });
}

async function beginSketchOnFace(faceId) {
  return page.evaluate(async (id) => {
    const engine = window.__engine;
    const store = window.__appStore.getState();
    const sketch = await engine.beginSketch({ type: 'planar_face', face_id: id });
    store.setActiveSketch(sketch);
    return sketch;
  }, faceId);
}

async function finishSketch() {
  return page.evaluate(async () => {
    const engine = window.__engine;
    const store = window.__appStore.getState();
    const ended = await engine.endSketch();
    store.setDocument(ended.document);
    store.setActiveSketch(null);
    store.setFinishedSketches(await engine.finishedSketches());
    return engine.profileCatalog();
  });
}

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(
    () => window.__appStore?.getState().document !== null && !!window.__engine,
  );

  console.log('1. A face sketch receives the support face boundary as projections');
  const faceId = await createSupportBody();
  const faceSketch = await beginSketchOnFace(faceId);
  assert.equal(faceSketch.projected_edges.length, 4, 'four boundary edges');
  for (const edge of faceSketch.projected_edges) {
    assert.ok(
      edge.id >= 2 ** 40,
      `projected ids use the reserved range, got ${edge.id}`,
    );
    assert.equal(edge.points.length, 2, 'a straight boundary edge stays exact');
  }
  // The projected boundary is the closed outline of the face: every projected
  // endpoint is shared by exactly two projected pieces.
  const endpoints = new Map();
  for (const edge of faceSketch.projected_edges) {
    for (const point of [edge.points[0], edge.points[edge.points.length - 1]]) {
      const key = `${point.x.toFixed(6)}:${point.y.toFixed(6)}`;
      endpoints.set(key, (endpoints.get(key) ?? 0) + 1);
    }
  }
  assert.equal(endpoints.size, 4, 'the projected outline has four corners');
  assert.ok(
    [...endpoints.values()].every((count) => count === 2),
    'the projected boundary closes on itself',
  );

  console.log('2. A shape drawn inside the face stays the only profile');
  const outline = await page.evaluate(() => {
    const sketch = window.__appStore.getState().activeSketch;
    const xs = sketch.projected_edges.flatMap((edge) => edge.points.map((point) => point.x));
    const ys = sketch.projected_edges.flatMap((edge) => edge.points.map((point) => point.y));
    return {
      minX: Math.min(...xs), maxX: Math.max(...xs),
      minY: Math.min(...ys), maxY: Math.max(...ys),
    };
  });
  // 6 x 5 = 30 mm2, centred inside the face outline whatever its basis is.
  await page.evaluate(async (box) => {
    const centerX = (box.minX + box.maxX) / 2;
    const centerY = (box.minY + box.maxY) / 2;
    await window.__engine.addRectangle({
      mode: 'two_point',
      p1: { x: centerX - 3, y: centerY - 2.5 },
      p2: { x: centerX + 3, y: centerY + 2.5 },
      ctrl_held: true,
    });
  }, outline);
  let catalog = await finishSketch();
  let entry = catalog.find((item) => item.sketch_name === 'Sketch2');
  assert.ok(entry, 'the face sketch is in the catalog');
  assert.equal(entry.profile_error, null);
  assert.equal(entry.profiles.length, 1, 'the projected outline is not a profile');
  assert.ok(Math.abs(entry.profiles[0].area - 30) < 1e-6, 'the rectangle is the profile');
  assert.equal(entry.profiles[0].nesting_depth, 0, 'the rectangle is not a hole');

  console.log('3. A semicircle drawn against the boundary seals a profile');
  const probe = await page.evaluate(async () => {
    const engine = window.__engine;
    const store = window.__appStore.getState();
    await engine.editSketch('Sketch2');
    // Replace the rectangle with the reported construction: a line ending at
    // the arc centre plus a semicircle whose far endpoint rests on the top
    // projected boundary edge.
    const active = await engine.activeSketch();
    await engine.deleteEntities(active.entities.map((entity) => entity.id));
    const xs = active.projected_edges.flatMap((edge) => edge.points.map((point) => point.x));
    const ys = active.projected_edges.flatMap((edge) => edge.points.map((point) => point.y));
    const chordY = Math.max(...ys);
    const center = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: chordY };
    const radius = 2.5;
    await engine.addLine({
      from: { x: Math.min(...xs), y: chordY },
      to_raw: { x: center.x, y: chordY },
      ctrl_held: true,
    });
    await engine.addArcCenter({
      center,
      start: { x: center.x - radius, y: chordY },
      sweep: { x: center.x + radius, y: chordY },
      ctrl_held: true,
    });
    store.setActiveSketch(await engine.activeSketch());
    return { center, chordY, radius };
  });
  catalog = await finishSketch();
  entry = catalog.find((item) => item.sketch_name === 'Sketch2');
  const halfDisc = entry.profiles.find(
    (profile) => Math.abs(profile.area - HALF_DISC) < 0.3,
  );
  assert.ok(
    halfDisc,
    `the semicircle must be selectable: ${JSON.stringify(
      entry.profiles.map((profile) => [profile.area, profile.nesting_depth]),
    )}`,
  );
  assert.equal(halfDisc.nesting_depth, 0, 'the sealed region is not a hole');
  assert.ok(
    entry.profiles.every((profile) => profile.area < 20 * 15 - 1),
    'the support face outline never becomes a profile',
  );

  console.log('4. The sealed region is pickable in the Extrude dialog');
  await page.evaluate(() => {
    const store = window.__appStore.getState();
    store.setMode('solid');
    store.clearSolidSelection();
    window.__cameraApi.fit();
  });
  await page.locator('button[title="Extrude"]').first().click();
  await page.getByTestId('extrude-dialog').waitFor({ state: 'visible' });
  await page.waitForFunction(
    () => window.__appStore.getState().profilePicker?.owner === 'extrude',
  );
  // A sketch point inside the semicircle, half a radius below the chord.
  const inside = await page.evaluate((fixture) => {
    const basis = window.__appStore.getState().profilePicker.catalog
      .find((item) => item.sketch_name === 'Sketch2').basis;
    const world = (x, y) =>
      basis.origin.map((value, index) => value + basis.u[index] * x + basis.v[index] * y);
    const point = world(fixture.center.x, fixture.chordY - fixture.radius / 2);
    return window.__worldToScreen(point[0], point[1], point[2]);
  }, probe);
  await page.mouse.move(inside.x, inside.y);
  await page.waitForFunction(() => {
    const state = window.__appStore.getState();
    const hovered = state.profilePicker?.hovered ?? null;
    return hovered !== null;
  });
  const hovered = await page.evaluate(
    () => window.__appStore.getState().profilePicker?.hovered ?? null,
  );
  await page.mouse.click(inside.x, inside.y);
  await page.waitForFunction(
    () => window.__appStore.getState().profilePicker?.selected.length === 1,
  );
  const selected = await page.evaluate(() => {
    const picker = window.__appStore.getState().profilePicker;
    const catalog = picker?.catalog ?? [];
    const entry = catalog.find((item) => item.sketch_name === picker.selected[0].sketch_name);
    const profile = entry.profiles.find(
      (candidate) => candidate.index === picker.selected[0].profile_index,
    );
    return { reference: picker.selected[0], area: profile?.area ?? null };
  });
  assert.equal(selected.reference.sketch_name, hovered.sketch_name);
  assert.ok(
    selected.area !== null && Math.abs(selected.area - HALF_DISC) < 0.3,
    `picking inside the semicircle must select the sealed region, got ${selected.area}`,
  );

  assert.deepEqual(pageErrors, []);
  console.log('face-boundary profiles: all checks passed');
} finally {
  await browser.close();
}
