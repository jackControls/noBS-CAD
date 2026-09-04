/**
 * Dialog/engine regressions for role-owned geometry references. These tests
 * validate state and submitted OCCT operations, not native desktop pixels.
 * Bevy visual acceptance is recorded separately in the branch review.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));

const pickFace = (face) => page.evaluate(({ bodyId, faceId }) => {
  window.__appStore.getState().selectSolidFeature('face', bodyId, faceId, null, false);
}, face);

async function finishCommand(kind) {
  await page.waitForFunction((kind) => {
    const state = window.__appStore.getState();
    return !state.solidBusy
      && (state[`${kind}DialogFeature`] === null || state.constraintDialog !== null);
  }, kind, { timeout: 60_000 });
  assert.equal(await page.evaluate(() => window.__appStore.getState().constraintDialog), null);
}

try {
  await page.goto('http://localhost:7199', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__engine && window.__appStore?.getState().document);

  const fixture = await page.evaluate(async () => {
    const engine = window.__engine;
    const store = window.__appStore.getState();
    store.applySolidUpdate(await engine.newProject());
    await engine.beginSketch({ type: 'origin_plane', plane: 'xy' });
    await engine.addRectangle({
      mode: 'two_point', p1: { x: 5, y: 5 }, p2: { x: 25, y: 25 }, ctrl_held: true,
    });
    store.setDocument((await engine.endSketch()).document);
    store.setFinishedSketches(await engine.finishedSketches());
    store.setMode('solid');
    const catalog = await engine.profileCatalog();
    const profile = catalog[0].profiles.find((entry) => entry.nesting_depth === 0);
    for (const distance of [10, 20]) {
      store.applySolidUpdate(await engine.extrude({
        source_face: null, sketch_name: catalog[0].sketch_name, profile_indices: [profile.index],
        operation: 'new_body', extent: { type: 'distance', distance },
        taper_angle_deg: 0, flip: false, target_body_ids: [],
      }));
    }
    const tops = window.__appStore.getState().solidScene.bodies.map((body) => {
      const planar = body.faces.filter((face) => face.plane);
      const index = planar.findIndex((face) => face.plane.normal[2] > 0.9);
      if (index < 0) throw new Error('fixture is missing a top face');
      return {
        bodyId: body.id, faceId: planar[index].id, basis: planar[index].plane,
        label: `${body.name} · Face ${index + 1} selected`,
      };
    });
    return { source: tops[0], target: tops[1] };
  });

  const sourceField = page.getByTestId('extrude-profile-selection-state');
  const targetField = page.getByTestId('extrude-to-face-selection');
  const assertFaceFields = async () => {
    await page.waitForFunction((expected) => {
      const source = document.querySelector('[data-testid="extrude-profile-selection-state"]');
      const target = document.querySelector('[data-testid="extrude-to-face-selection"]');
      return source?.textContent.includes(expected.source.label)
        && target?.textContent.includes(expected.target.label);
    }, fixture, { timeout: 5_000 });
    assert.ok((await sourceField.innerText()).includes(fixture.source.label));
    assert.ok((await targetField.innerText()).includes(fixture.target.label));
    await page.waitForFunction((expected) => {
      const preview = window.__appStore.getState().solidCommandPreview;
      return preview?.kind === 'extrude'
        && preview.sourceFace?.face_id === expected.source.faceId
        && preview.basis.origin.every((value, index) => value === expected.source.basis.origin[index])
        && Math.abs(preview.endOffset - 10) < 1e-7;
    }, fixture);
  };
  const assertExtrudeDefinition = (definition) => {
    assert.deepEqual(definition.source_face, {
      body_id: fixture.source.bodyId, face_id: fixture.source.faceId,
    });
    assert.deepEqual(definition.extent, { type: 'to_face', face_id: fixture.target.faceId });
    assert.deepEqual(definition.source_face_basis, fixture.source.basis);
  };
  let lastExtrude;
  for (const order of ['source-first', 'target-first']) {
    console.log(`Extrude ${order}: independent source, stop face, and basis`);
    await page.evaluate(() => window.__appStore.getState().clearSolidSelection());
    if (order === 'source-first') await pickFace(fixture.source);
    await page.evaluate(() => window.__appStore.getState().openExtrudeDialog());
    await page.waitForFunction(() => window.__appStore.getState().modelingPickTarget === 'extrude_source');
    await page.getByTestId('extrude-extent').selectOption('to_face');
    await pickFace(fixture.target);
    await page.waitForFunction((label) => document.querySelector('[data-testid="extrude-to-face-selection"]')
      ?.textContent.includes(label), fixture.target.label);
    if (order === 'target-first') {
      assert.ok((await sourceField.innerText()).includes('Click closed profiles'));
      await sourceField.click();
      await pickFace(fixture.source);
    }
    await assertFaceFields();
    // Revisit both fields without losing either accepted value.
    await sourceField.click();
    await assertFaceFields();
    await targetField.click();
    await assertFaceFields();
    await pickFace(fixture.target);
    await assertFaceFields();
    // Operation and extent changes also activate the source role. They must
    // restore its selection, not adopt the last global stop-face selection.
    await page.locator('[data-extrude-operation="new_body"]').click();
    await assertFaceFields();
    await targetField.click();
    await pickFace(fixture.target);
    await page.getByTestId('extrude-extent').selectOption('distance');
    assert.ok((await sourceField.innerText()).includes(fixture.source.label));
    await page.getByTestId('extrude-extent').selectOption('to_face');
    await assertFaceFields();
    await page.getByTestId('extrude-submit').click();
    await finishCommand('extrude');
    lastExtrude = await page.evaluate(async () => (await window.__engine.extrudeDefinitions()).at(-1));
    assertExtrudeDefinition(lastExtrude);
  }

  console.log('Extrude history edit: restores and submits the two distinct face references');
  await page.evaluate((id) => window.__appStore.getState().openExtrudeDialog(id), lastExtrude.feature_id);
  await page.waitForFunction(() => window.__appStore.getState().modelingPickTarget === 'extrude_source');
  await assertFaceFields();
  await targetField.click();
  await pickFace(fixture.target);
  await sourceField.click();
  await assertFaceFields();
  await page.getByTestId('extrude-submit').click();
  await finishCommand('extrude');
  assertExtrudeDefinition(await page.evaluate(async () => (await window.__engine.extrudeDefinitions()).at(-1)));

  const revolve = await page.evaluate(async () => {
    const engine = window.__engine;
    const store = window.__appStore.getState();
    store.applySolidUpdate(await engine.newProject());
    store.clearSolidSelection();
    await engine.beginSketch({ type: 'origin_plane', plane: 'xy' });
    await engine.addRectangle({
      mode: 'two_point', p1: { x: 10, y: -10 }, p2: { x: 30, y: 10 }, ctrl_held: true,
    });
    store.setDocument((await engine.endSketch()).document);
    store.setFinishedSketches(await engine.finishedSketches());
    store.setMode('solid');
    const catalog = await engine.profileCatalog();
    const line = catalog[0].lines.find((line) => line.start.x === 10 && line.end.x === 10);
    if (!line) throw new Error('fixture is missing its boundary axis');
    return {
      axis: { sketchName: catalog[0].sketch_name, entityId: line.entity_id },
      profile: { sketch_name: catalog[0].sketch_name, profile_index: catalog[0].profiles[0].index },
    };
  });
  await page.evaluate(() => window.__appStore.getState().openRevolveDialog());
  await page.waitForFunction(() => window.__appStore.getState().profilePicker?.owner === 'revolve');
  await page.evaluate(({ axis, profile }) => {
    const store = window.__appStore.getState();
    store.replaceProfilePicks('revolve', [profile], profile.sketch_name);
    store.setRevolveAxisSelection(axis);
  }, revolve);

  const checkAxisRestoration = async () => {
    for (const preset of ['x', 'y', 'custom']) {
      await page.getByTestId(`revolve-axis-${preset}-mode`).click();
      assert.equal(await page.evaluate(() => window.__appStore.getState().revolveAxisSelection), null);
      await page.getByTestId('revolve-axis-line-mode').click();
      await page.waitForFunction((axis) => {
        const selected = window.__appStore.getState().revolveAxisSelection;
        return selected?.sketchName === axis.sketchName && selected.entityId === axis.entityId;
      }, revolve.axis);
      assert.ok((await page.getByTestId('revolve-axis-selection').innerText()).includes('Straight line selected'));
      assert.equal(await page.getByTestId('revolve-ok').isEnabled(), true);
      const visualSelection = await page.evaluate(async () => {
        const { collectAppViewportPickFeedback } = await import('/src/modeling/viewportPickFeedback.ts');
        return collectAppViewportPickFeedback(window.__appStore.getState()).selectedFinishedSketchEntities;
      });
      assert.deepEqual(visualSelection, [revolve.axis]);
    }
  };
  const assertRevolveDefinition = (definition) => {
    assert.equal(definition.axis_line_sketch_name, revolve.axis.sketchName);
    assert.equal(definition.axis_line_entity_id, revolve.axis.entityId);
  };
  console.log('Revolve line → X/Y/custom → line: shared highlight identity matches submitted axis');
  await checkAxisRestoration();
  await page.getByTestId('revolve-ok').click();
  await finishCommand('revolve');
  const definition = await page.evaluate(async () => (await window.__engine.revolveDefinitions()).at(-1));
  assertRevolveDefinition(definition);
  await page.evaluate(async () => {
    const engine = window.__engine;
    window.__appStore.getState().applySolidUpdate(await engine.loadProjectModel(await engine.exportProjectModel()));
    window.__appStore.getState().setFinishedSketches(await engine.finishedSketches());
  });
  await page.evaluate((id) => window.__appStore.getState().openRevolveDialog(id), definition.feature_id);
  await page.waitForFunction(() => window.__appStore.getState().revolveAxisSelection !== null);
  console.log('Revolve persisted history edit: repeats all axis-mode transitions');
  await checkAxisRestoration();
  await page.getByTestId('revolve-ok').click();
  await finishCommand('revolve');
  assertRevolveDefinition(await page.evaluate(async () => (await window.__engine.revolveDefinitions()).at(-1)));

  assert.deepEqual(errors, []);
  console.log('[ok] role-owned picker state and submitted feature definitions');
} finally {
  await browser.close();
}
