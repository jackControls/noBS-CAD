/** Coplanar profile selection with an opposite-normal sketch on a Revolve cap.
 * Uses actual mouse hover/click and OCCT submission. Native Bevy visual
 * acceptance is checked separately in the packaged desktop app. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));

try {
  await page.goto('http://localhost:7199', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__engine && window.__appStore?.getState().document);
  const fixture = await page.evaluate(async () => {
    const engine = window.__engine;
    const store = window.__appStore.getState();
    store.applySolidUpdate(await engine.newProject());
    await engine.beginSketch({ type: 'origin_plane', plane: 'xz' });
    await engine.addRectangle({
      mode: 'two_point', p1: { x: -50, y: 0 }, p2: { x: -10, y: 40 }, ctrl_held: true,
    });
    store.setDocument((await engine.endSketch()).document);
    const source = (await engine.profileCatalog())[0];
    const axis = source.lines.find((line) => line.start.x === -10 && line.end.x === -10);
    if (!axis) throw new Error('missing rectangle boundary axis');
    const update = await engine.revolve({
      sketch_name: source.sketch_name, profile_indices: [source.profiles[0].index],
      axis_line_sketch_name: source.sketch_name, axis_line_entity_id: axis.entity_id,
      axis_origin: { x: -10, y: 0 }, axis_direction: { x: 0, y: 1 },
      angle_deg: 80, flip: false, operation: 'new_body', target_body_ids: [],
    });
    store.applySolidUpdate(update);
    const cap = update.scene.bodies[0].faces.find((face) =>
      face.plane && face.plane.normal[1] > 0.99 && Math.abs(face.plane.origin[1]) < 1e-7);
    if (!cap) throw new Error('missing opposite-normal coplanar start cap');
    await engine.beginSketch({ type: 'planar_face', face_id: cap.id });
    await engine.addRectangle({
      mode: 'two_point', p1: { x: -6, y: -9 }, p2: { x: 6, y: 9 }, ctrl_held: true,
    });
    store.setDocument((await engine.endSketch()).document);
    store.setFinishedSketches(await engine.finishedSketches());
    store.setMode('solid');
    store.clearSolidSelection();
    const catalog = await engine.profileCatalog();
    const faceSketch = catalog[1];
    const world = (basis, x, y) => basis.origin.map((value, index) =>
      value + basis.u[index] * x + basis.v[index] * y);
    return {
      source: { sketch_name: source.sketch_name, profile_index: source.profiles[0].index },
      rectangle: { sketch_name: faceSketch.sketch_name, profile_index: faceSketch.profiles[0].index },
      center: world(faceSketch.basis, 0, 0),
      outsideRectangle: world(source.basis, -45, 5),
      normalDot: source.basis.normal.reduce((sum, value, index) =>
        sum + value * faceSketch.basis.normal[index], 0),
    };
  });
  assert.ok(fixture.normalDot < -0.99, 'the fixture exercises opposite sketch normals');
  await page.evaluate(() => window.__cameraApi.fit());
  await page.waitForTimeout(350);

  const moveToWorld = async (point) => {
    const screen = await page.evaluate((point) => window.__cameraApi.worldToScreen(point), point);
    assert.ok(screen, 'the test point is visible');
    await page.mouse.move(screen.x, screen.y);
    return screen;
  };
  const assertHovered = async (expected) => {
    try {
      await page.waitForFunction((expected) => {
        const hovered = window.__appStore.getState().profilePicker?.hovered;
        return hovered?.sketch_name === expected.sketch_name && hovered.profile_index === expected.profile_index;
      }, expected, { timeout: 5000 });
    } catch (error) {
      const state = await page.evaluate(() => {
        const s = window.__appStore.getState();
        return {
          owner: s.profilePicker?.owner, target: s.modelingPickTarget,
          hovered: s.profilePicker?.hovered, selected: s.profilePicker?.selected,
          axisHover: s.revolveAxisHover, axis: s.revolveAxisSelection,
          curveHover: s.curvePicker?.hovered,
        };
      });
      throw new Error(`expected hover ${JSON.stringify(expected)}; got ${JSON.stringify(state)}`, { cause: error });
    }
  };
  const assertSelected = async (expected) => {
    await page.waitForFunction((expected) => {
      const selected = window.__appStore.getState().profilePicker?.selected;
      return selected?.length === 1
        && selected[0].sketch_name === expected.sketch_name
        && selected[0].profile_index === expected.profile_index;
    }, expected, { timeout: 5000 });
  };

  // Every profile-consuming command reaches the same hit resolver. Exercise
  // multiple owners without bypassing their viewport event handlers.
  for (const owner of ['extrude', 'revolve', 'loft', 'sweep']) {
    await page.evaluate((owner) => {
      const store = window.__appStore.getState();
      store.clearSolidSelection();
      store[`open${owner[0].toUpperCase()}${owner.slice(1)}Dialog`]();
    }, owner);
    await page.waitForFunction((owner) => window.__appStore.getState().profilePicker?.owner === owner, owner);
    for (const direction of [[0, 1, 0], [0.4, 1, 0.25], [-0.5, 1, -0.25]]) {
      console.log(`  checking ${owner} from ${direction.join(',')}`);
      await page.evaluate((direction) => window.__cameraApi.snapToDirection(direction), direction);
      await page.waitForTimeout(350);
      const center = await moveToWorld(fixture.center);
      await assertHovered(fixture.rectangle);
      await page.mouse.click(center.x, center.y);
      await assertSelected(fixture.rectangle);
      await page.evaluate((owner) => window.__appStore.getState().replaceProfilePicks(owner, [], ''), owner);
    }
    // Outside the inset, the old larger profile must still be reachable.
    const outside = await moveToWorld(fixture.outsideRectangle);
    await assertHovered(fixture.source);
    await page.mouse.click(outside.x, outside.y);
    await assertSelected(fixture.source);
    // The dimension input may take focus after selection. Use the dialog's
    // explicit Cancel rather than testing that input's Escape handling here.
    await page.getByRole('button', { name: 'Cancel', exact: true }).last().click();
    await page.waitForFunction(() => window.__appStore.getState().profilePicker === null);
    console.log(`  [ok] ${owner}: inner/outer regions selectable from three camera directions`);
  }

  await page.evaluate(() => window.__appStore.getState().openExtrudeDialog());
  await page.waitForFunction(() => window.__appStore.getState().profilePicker?.owner === 'extrude');
  const center = await moveToWorld(fixture.center);
  await assertHovered(fixture.rectangle);
  await page.mouse.click(center.x, center.y);
  await assertSelected(fixture.rectangle);
  assert.match(await page.getByTestId('extrude-profile-selection-state').innerText(), /Sketch2/);
  await page.locator('[data-extrude-operation="new_body"]').click();
  await page.getByTestId('extrude-distance').fill('5');
  await page.getByTestId('extrude-submit').click();
  await page.waitForFunction(() => {
    const state = window.__appStore.getState();
    return !state.solidBusy && (state.extrudeDialogFeature === null || state.constraintDialog !== null);
  }, undefined, { timeout: 60_000 });
  assert.equal(await page.evaluate(() => window.__appStore.getState().constraintDialog), null);
  const definition = await page.evaluate(async () => (await window.__engine.extrudeDefinitions()).at(-1));
  assert.equal(definition.sketch_name, fixture.rectangle.sketch_name);
  assert.deepEqual(definition.profile_indices, [fixture.rectangle.profile_index]);
  assert.equal(definition.source_face, null);
  assert.equal(await page.evaluate(() => window.__appStore.getState().solidScene.bodies.length), 2);
  assert.deepEqual(errors, []);
  console.log('  [ok] actual Extrude uses the face rectangle, not its underlying source sketch');
} finally {
  await browser.close();
}
