/**
 * History-stage datum regression.
 *
 * A face-index slot may refer to a different face after a downstream boolean.
 * Construction planes and dependent sketches must retain the frame resolved at
 * their own timeline position regardless of whether a particular OCCT build
 * retains or reorders that slot. Legacy saves with a poisoned cached frame
 * must be repaired by staged load replay.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE = 'http://localhost:7199';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error)));

const near = (left, right, tolerance = 1e-7) =>
  left.length === right.length
  && left.every((value, index) => Math.abs(value - right[index]) <= tolerance);
const sameBasis = (left, right) =>
  near(left.origin, right.origin)
  && near(left.u, right.u)
  && near(left.v, right.v)
  && near(left.normal, right.normal);

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__engine && window.__appStore);

  console.log('1. Build a holed cube, its midplane, and a dependent sketch');
  const result = await page.evaluate(async () => {
    const engine = window.__engine;
    await engine.newProject();
    await engine.beginSketch({ type: 'origin_plane', plane: 'xy' });
    await engine.setGridSnap(false);
    await engine.addRectangle({
      mode: 'two_point',
      p1: { x: -10, y: -10 },
      p2: { x: 10, y: 10 },
      ctrl_held: true,
    });
    await engine.endSketch();
    let update = await engine.extrude({
      source_face: null,
      sketch_name: 'Sketch1',
      profile_indices: [0],
      operation: 'new_body',
      extent: { type: 'distance', distance: 20 },
      taper_angle_deg: 0,
      flip: false,
      target_body_ids: [],
    });
    const body = update.scene.bodies[0];
    const top = body.faces.find(
      (face) => face.plane?.normal[2] > 0.9 && face.plane.origin[2] > 19,
    );
    if (!top) throw new Error('base cube has no top face');
    update = await engine.hole({
      body_id: body.id,
      face_id: top.id,
      position: { x: 0, y: 0 },
      position_reference: null,
      positions: [],
      diameter: 5,
      extent: { type: 'through_all' },
      style: 'simple',
      counterbore_diameter: 0,
      counterbore_depth: 0,
      countersink_diameter: 0,
      countersink_angle_deg: 90,
      bottom_style: 'drill_point',
      drill_point_angle_deg: 118,
      thread: null,
      flip: false,
    });

    const holed = update.scene.bodies[0];
    const yFaces = holed.faces
      .filter((face) => face.plane && Math.abs(face.plane.normal[1]) > 0.9)
      .sort((left, right) => left.plane.origin[1] - right.plane.origin[1]);
    if (yFaces.length < 2) throw new Error('holed cube has no opposing Y faces');
    const first = yFaces[0];
    const second = yFaces.at(-1);
    const planeUpdate = await engine.createDatumPlane({
      source: {
        type: 'midplane',
        first: { type: 'planar_face', face_id: first.id },
        second: { type: 'planar_face', face_id: second.id },
      },
    });
    const datum = planeUpdate.planes.at(-1);
    await engine.beginSketch({ type: 'datum_plane', datum_id: datum.datum_id });
    await engine.addRectangle({
      mode: 'two_point',
      p1: { x: -5, y: -5 },
      p2: { x: 5, y: 5 },
      ctrl_held: true,
    });
    await engine.endSketch();
    const dependentSketch = (await engine.finishedSketches()).at(-1);

    console.log('2. Apply a downstream exact-face cut that reorders face slots');
    update = await engine.extrude({
      source_face: { body_id: holed.id, face_id: first.id },
      sketch_name: '',
      profile_indices: [],
      operation: 'cut',
      extent: { type: 'distance', distance: 10 },
      taper_angle_deg: 0,
      flip: true,
      target_body_ids: [holed.id],
    });
    const cutErrors = structuredClone(update.scene.errors);
    const planeAfterCut = (await engine.datumPlaneDefinitions()).at(-1);
    const sketchAfterCut = (await engine.finishedSketches()).find(
      (sketch) => sketch.name === dependentSketch.name,
    );
    const reboundFace = update.scene.bodies[0].faces.find(
      (face) => face.id === first.id,
    );

    console.log('3. Replay both sides of the marker, then repair a legacy save');
    const fullRollback = update.document.rollback_index;
    const planePosition = update.document.features.findIndex(
      (feature) => feature.id === datum.feature_id,
    );
    await engine.setRollback(planePosition + 1);
    const planeAtLandmark = (await engine.datumPlaneDefinitions()).at(-1);
    await engine.setRollback(fullRollback);
    const planeAfterForward = (await engine.datumPlaneDefinitions()).at(-1);

    const model = JSON.parse(await engine.exportProjectModel());
    const poisoned = {
      origin: [0, 10, 0],
      u: [0, -1, 0],
      v: [0, 0, 1],
      normal: [-1, 0, 0],
    };
    model.datum_planes.find((candidate) => candidate.feature_id === datum.feature_id).basis =
      poisoned;
    model.sketches.find((candidate) => candidate.name === dependentSketch.name).basis = poisoned;
    const loaded = await engine.loadProjectModel(JSON.stringify(model));
    const repairedPlane = (await engine.datumPlaneDefinitions()).find(
      (candidate) => candidate.feature_id === datum.feature_id,
    );
    const repairedSketch = (await engine.finishedSketches()).find(
      (sketch) => sketch.name === dependentSketch.name,
    );

    return {
      cutErrors,
      initialBasis: datum.basis,
      initialSketchBasis: dependentSketch.basis,
      planeAfterCut: planeAfterCut.basis,
      sketchAfterCut: sketchAfterCut.basis,
      planeAtLandmark: planeAtLandmark.basis,
      planeAfterForward: planeAfterForward.basis,
      reboundNormal: reboundFace?.plane?.normal ?? null,
      sourceNormal: first.plane.normal,
      repairedPlane: repairedPlane.basis,
      repairedSketch: repairedSketch.basis,
      loadedRollback: loaded.document.rollback_index,
      fullRollback,
    };
  });

  assert.deepEqual(result.cutErrors, [], 'the exact-face cut must recompute successfully');
  const slotWasReoriented = result.reboundNormal
    && Math.abs(
      result.reboundNormal[0] * result.sourceNormal[0]
      + result.reboundNormal[1] * result.sourceNormal[1]
      + result.reboundNormal[2] * result.sourceNormal[2],
    ) < 0.5;
  console.log(
    slotWasReoriented
      ? '  [info] this OCCT result reordered the original face-id slot'
      : '  [info] this OCCT result retained the original face-id slot',
  );
  assert.ok(sameBasis(result.planeAfterCut, result.initialBasis));
  assert.ok(sameBasis(result.sketchAfterCut, result.initialSketchBasis));
  assert.ok(sameBasis(result.planeAtLandmark, result.initialBasis));
  assert.ok(sameBasis(result.planeAfterForward, result.initialBasis));
  assert.ok(sameBasis(result.repairedPlane, result.initialBasis));
  assert.ok(sameBasis(result.repairedSketch, result.initialSketchBasis));
  assert.equal(result.loadedRollback, result.fullRollback);
  assert.deepEqual(pageErrors, []);
  console.log('  [ok] upstream datum/sketch frames survive booleans, rollback, and legacy load');
} finally {
  await browser.close();
}
