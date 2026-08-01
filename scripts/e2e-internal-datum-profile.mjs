/**
 * Internal construction-plane profile regression:
 * a non-square closed sketch on a vertical midplane inside a solid remains
 * visible, pickable, and aligned with the exact plane used by Extrude.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE = 'http://localhost:7199';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error)));

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(
    () => window.__appStore?.getState().document !== null && !!window.__engine,
  );

  const fixture = await page.evaluate(async () => {
    const engine = window.__engine;
    const store = window.__appStore.getState();
    const blank = await engine.newProject();
    store.applySolidUpdate(blank);
    store.setFinishedSketches([]);
    store.applyDatumPlaneUpdate({ document: blank.document, planes: [] });

    await engine.beginSketch({ type: 'origin_plane', plane: 'xy' });
    await engine.setGridSnap(false);
    await engine.addRectangle({
      mode: 'two_point',
      p1: { x: -20, y: -20 },
      p2: { x: 20, y: 20 },
      ctrl_held: true,
    });
    let ended = await engine.endSketch();
    store.setDocument(ended.document);
    store.setFinishedSketches(await engine.finishedSketches());
    store.applySolidUpdate(
      await engine.extrude({
        sketch_name: 'Sketch1',
        profile_indices: [0],
        operation: 'new_body',
        extent: { type: 'distance', distance: 20 },
        taper_angle_deg: 0,
        flip: false,
        target_body_ids: [],
      }),
    );

    const sideFaces = window.__appStore.getState().solidScene.bodies[0].faces
      .filter((face) => face.plane && Math.abs(face.plane.normal[0]) > 0.99)
      .sort((a, b) => a.plane.origin[0] - b.plane.origin[0]);
    if (sideFaces.length !== 2) throw new Error('expected opposite X-normal faces');
    const midplane = await engine.createDatumPlane({
      source: {
        type: 'midplane',
        first: { type: 'planar_face', face_id: sideFaces[0].id },
        second: { type: 'planar_face', face_id: sideFaces[1].id },
      },
    });
    store.applyDatumPlaneUpdate(midplane);
    const internalPlane = midplane.planes.at(-1);

    await engine.beginSketch({
      type: 'datum_plane',
      datum_id: internalPlane.datum_id,
    });
    await engine.addRectangle({
      mode: 'two_point',
      p1: { x: -12, y: -4 },
      p2: { x: 18, y: 6 },
      ctrl_held: true,
    });
    ended = await engine.endSketch();
    store.setDocument(ended.document);
    store.setFinishedSketches(await engine.finishedSketches());
    store.setMode('solid');
    store.clearSolidSelection();
    window.__cameraApi.fit();
    const center2d = { x: 3, y: 1 };
    return {
      basis: internalPlane.basis,
      center: internalPlane.basis.origin.map(
        (coordinate, index) =>
          coordinate
          + internalPlane.basis.u[index] * center2d.x
          + internalPlane.basis.v[index] * center2d.y,
      ),
      profileCount: (await engine.profileCatalog()).find(
        (entry) => entry.sketch_name === 'Sketch2',
      )?.profiles.length,
    };
  });

  assert.ok(Math.abs(fixture.basis.normal[0]) > 0.99, 'fixture must use a vertical X-normal plane');
  assert.equal(fixture.profileCount, 1);
  await page.waitForTimeout(300);
  await page.locator('button[title="Extrude"]').first().click();
  await page.getByTestId('extrude-dialog').waitFor({ state: 'visible' });
  await page.waitForFunction(
    () => window.__appStore.getState().profilePicker?.owner === 'extrude',
  );
  await page.evaluate(() =>
    window.__appStore.getState().replaceProfilePicks('extrude', []),
  );
  await page.waitForFunction(
    () => window.__appStore.getState().profilePicker?.selected.length === 0,
  );

  const center = await page.evaluate(
    ([x, y, z]) => window.__worldToScreen(x, y, z),
    fixture.center,
  );
  await page.mouse.move(center.x, center.y);
  await page.waitForFunction(
    () => window.__appStore.getState().profilePicker?.hovered?.sketch_name === 'Sketch2',
  );
  await page.mouse.click(center.x, center.y);
  await page.waitForFunction(
    () => window.__appStore.getState().profilePicker?.selected.length === 1,
  );
  assert.deepEqual(
    await page.evaluate(() => window.__appStore.getState().profilePicker.selected[0]),
    { sketch_name: 'Sketch2', profile_index: 0 },
    'the midplane profile behind the body surface must win the explicit Extrude pick',
  );
  await page.waitForFunction(
    () =>
      window.__nativeViewportTransient().triangles.length >= 2
      && window.__nativeViewportTransient().arrows.length === 1,
  );
  const presentation = await page.evaluate(() => window.__nativeViewportTransient());
  const distanceFromPlane = (position) =>
    (position[0] - fixture.basis.origin[0]) * fixture.basis.normal[0]
    + (position[1] - fixture.basis.origin[1]) * fixture.basis.normal[1]
    + (position[2] - fixture.basis.origin[2]) * fixture.basis.normal[2];
  const selectedFill = presentation.triangles.find(
    (layer) =>
      layer.xray
      && layer.color[3] > 0.25
      && Array.from({ length: layer.positions.length / 3 }, (_, index) =>
        distanceFromPlane(layer.positions.slice(index * 3, index * 3 + 3)),
      ).every((distance) => Math.abs(distance) < 1e-4),
  );
  assert.ok(
    selectedFill,
    'selected profile fill must remain on the vertical datum basis instead of rotating 90°',
  );
  const arrow = presentation.arrows[0];
  const arrowDelta = arrow.end.map((coordinate, index) => coordinate - arrow.start[index]);
  const arrowLength = Math.hypot(...arrowDelta);
  const parallel = Math.abs(
    arrowDelta.reduce(
      (sum, coordinate, index) => sum + coordinate * fixture.basis.normal[index],
      0,
    ) / arrowLength,
  );
  assert.ok(
    parallel > 0.9999,
    'Extrude direction arrow must follow the same normal used by the kernel operation',
  );
  assert.deepEqual(pageErrors, []);
  console.log('  [ok] an internal vertical midplane profile stays visible, selectable, and aligned');
} finally {
  await browser.close();
}
