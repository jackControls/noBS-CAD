/** Assembly joints: exact references, persistence, solving, and live poses. */
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

  console.log('1. Create two independent bodies and select planar connectors');
  const selected = await page.evaluate(async () => {
    const engine = window.__engine;
    const store = window.__appStore.getState();
    store.applySolidUpdate(await engine.newProject());
    await engine.beginSketch({ type: 'origin_plane', plane: 'xy' });
    await engine.setGridSnap(false);
    await engine.addRectangle({
      mode: 'two_point',
      p1: { x: -30, y: -10 },
      p2: { x: -10, y: 10 },
      ctrl_held: true,
    });
    await engine.addRectangle({
      mode: 'two_point',
      p1: { x: 10, y: -10 },
      p2: { x: 30, y: 10 },
      ctrl_held: true,
    });
    const ended = await engine.endSketch();
    store.setDocument(ended.document);
    store.setFinishedSketches(await engine.finishedSketches());
    store.setMode('solid');
    const catalog = await engine.profileCatalog();
    const profiles = catalog[0].profiles
      .filter((profile) => profile.nesting_depth === 0)
      .sort((a, b) => a.index - b.index);
    if (profiles.length !== 2) throw new Error(`expected two profiles, got ${profiles.length}`);

    let update;
    for (const profile of profiles) {
      update = await engine.extrude({
        source_face: null,
        sketch_name: catalog[0].sketch_name,
        profile_indices: [profile.index],
        operation: 'new_body',
        extent: { type: 'distance', distance: 10 },
        taper_angle_deg: 0,
        flip: false,
        target_body_ids: [],
      });
      store.applySolidUpdate(update);
    }
    if (update.scene.bodies.length !== 2) {
      throw new Error(`expected two bodies, got ${update.scene.bodies.length}`);
    }
    const connectors = update.scene.bodies.map((body) => {
      const face = body.faces.find((candidate) =>
        candidate.plane
        && candidate.plane.normal[2] > 0.9
        && candidate.plane.origin[2] > 9,
      );
      if (!face) throw new Error(`${body.name} has no top planar face`);
      return { bodyId: body.id, faceId: face.id, faceKey: face.key };
    });
    store.selectSolidFeature('face', connectors[0].bodyId, connectors[0].faceId, null, false);
    store.selectSolidFeature('face', connectors[1].bodyId, connectors[1].faceId, null, true);
    return connectors;
  });
  assert.equal(selected.length, 2);
  assert.notEqual(selected[0].bodyId, selected[1].bodyId);

  console.log('2. Assembly workspace creates a revolute joint from both faces');
  await page.getByRole('button', { name: 'Assembly', exact: true }).click();
  await page.getByTestId('assembly-browser').waitFor({ state: 'visible' });
  await page.locator('[data-ribbon-button="createJoint"]').click();
  const dialog = page.getByTestId('joint-dialog');
  await dialog.waitFor({ state: 'visible' });
  assert.match(await dialog.innerText(), /2\/2/);
  await dialog.locator('input').first().fill('Main hinge');
  await dialog.locator('select').selectOption('revolute');
  await dialog.locator('input[type="number"]').fill('12.5');
  await dialog.locator('button[type="submit"]').click();
  await page.waitForFunction(
    () => window.__appStore.getState().assemblyDocument.joints.length === 1,
  );

  const result = await page.evaluate(async () => {
    const engineDocument = await window.__engine.assemblyDocument();
    const model = JSON.parse(await window.__engine.exportProjectModel());
    const joint = engineDocument.joints[0];
    return {
      engineDocument,
      savedAssembly: model.assembly,
      selectedFaces: window.__appStore.getState().selectedFaces,
      joint,
      solution: await window.__engine.assemblySolution(),
    };
  });
  assert.equal(result.joint.name, 'Main hinge');
  assert.equal(result.joint.kind, 'revolute');
  assert.equal(result.joint.angle_offset_deg, 12.5);
  assert.equal(result.joint.connector_a.face_key, selected[0].faceKey);
  assert.equal(result.joint.connector_b.face_key, selected[1].faceKey);
  assert.deepEqual(result.savedAssembly, result.engineDocument);
  assert.equal(result.engineDocument.grounded_body_id, selected[0].bodyId);
  assert.equal(result.solution.solved, true);
  assert.equal(result.solution.body_poses.length, 2);
  assert.deepEqual(result.selectedFaces, [], 'successful creation clears transient face selection');

  console.log('3. Selecting the browser row highlights both referenced faces');
  await page.getByRole('button', { name: /Main hinge/i }).click();
  const highlighted = await page.evaluate(() => window.__appStore.getState().selectedFaces);
  assert.deepEqual(highlighted, selected.map((entry) => entry.faceId));

  console.log('4. Live revolute motion updates the solved GPU display pose');
  await page.getByTestId('joint-motion-value').fill('45');
  await page.waitForFunction(
    () => window.__appStore.getState().assemblyDocument.joints[0]?.angle_offset_deg === 45,
  );
  const motion = await page.evaluate(() => {
    const state = window.__appStore.getState();
    const bodyId = state.assemblyDocument.joints[0].connector_b.body_id;
    const solved = state.assemblySolution.body_poses.find((pose) => pose.body_id === bodyId);
    return {
      solved,
      displayed: window.__solidBodyDisplayPose?.(bodyId) ?? null,
    };
  });
  assert.ok(motion.solved);
  assert.ok(motion.displayed);
  assert.deepEqual(motion.displayed.translation, motion.solved.translation);
  for (let index = 0; index < 4; index += 1) {
    assert.ok(Math.abs(motion.displayed.rotation[index] - motion.solved.rotation[index]) < 1e-9);
  }
  assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join('\n')}`);
  console.log('  [ok] exact topology, persistence, forward kinematics, and live display poses work');
} finally {
  await browser.close();
}
