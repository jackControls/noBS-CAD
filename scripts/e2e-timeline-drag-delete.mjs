/**
 * Build-history regression:
 *   reorder two independent sketches and reject a dependency inversion
 *   sketch → extrude → chamfer
 *   drag the build cursor backward/forward
 *   delete one refinement from its context menu
 *   delete a source sketch and retain a broken downstream feature
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE = 'http://localhost:7199';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error)));

async function buildHistory() {
  await page.evaluate(async () => {
    const engine = window.__engine;
    const store = window.__appStore.getState();
    store.applySolidUpdate(await engine.newProject());
    await engine.beginSketch({ type: 'origin_plane', plane: 'xy' });
    await engine.setGridSnap(false);
    await engine.addRectangle({
      mode: 'two_point',
      p1: { x: -20, y: -15 },
      p2: { x: 20, y: 15 },
      ctrl_held: true,
    });
    const ended = await engine.endSketch();
    store.setDocument(ended.document);
    store.setFinishedSketches(await engine.finishedSketches());
    store.setMode('solid');

    let update = await engine.extrude({
      sketch_name: 'Sketch1',
      profile_indices: [0],
      operation: 'new_body',
      extent: { type: 'distance', distance: 10 },
      taper_angle_deg: 0,
      flip: false,
      target_body_ids: [],
    });
    store.applySolidUpdate(update);
    const body = update.scene.bodies[0];
    update = await engine.solidChamfer({
      body_id: body.id,
      edge_ids: [body.edges[0].id],
      distance: 1,
      tangent_chain: false,
    });
    store.applySolidUpdate(update);
    store.setFinishedSketches(await engine.finishedSketches());
  });
  await page.waitForFunction(
    () =>
      window.__appStore.getState().document.features.length === 3
      && window.__appStore.getState().solidScene.bodies.length === 1
      && !window.__appStore.getState().solidBusy,
    undefined,
    { timeout: 60_000 },
  );
}

async function buildIndependentSketches() {
  await page.evaluate(async () => {
    const engine = window.__engine;
    const store = window.__appStore.getState();
    store.applySolidUpdate(await engine.newProject());
    for (const x of [0, 40]) {
      await engine.beginSketch({ type: 'origin_plane', plane: 'xy' });
      await engine.setGridSnap(false);
      await engine.addCircle({
        mode: 'center_diameter',
        p1: { x, y: 0 },
        p2: { x: x + 5, y: 0 },
        ctrl_held: true,
      });
      const ended = await engine.endSketch();
      store.setDocument(ended.document);
      store.setFinishedSketches(await engine.finishedSketches());
    }
    store.setMode('solid');
  });
  await page.waitForFunction(
    () =>
      window.__appStore.getState().document.features.length === 2
      && !window.__appStore.getState().solidBusy,
  );
}

async function dragFeatureBefore(sourceName, targetName) {
  const source = page.locator('[data-feature-id]').filter({ hasText: sourceName }).first();
  const target = page.locator('[data-feature-id]').filter({ hasText: targetName }).first();
  const [sourceBox, targetBox] = await Promise.all([source.boundingBox(), target.boundingBox()]);
  assert(sourceBox && targetBox, `${sourceName} and ${targetName} cards should be visible`);
  await page.mouse.move(
    sourceBox.x + sourceBox.width / 2,
    sourceBox.y + sourceBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(targetBox.x + 1, targetBox.y + targetBox.height / 2, { steps: 8 });
  assert.equal(
    await page.getByTestId('timeline-reorder-indicator').count(),
    1,
    'dragging a feature should show one insertion marker',
  );
  await page.mouse.up();
}

async function dragCursorToFeatureSlot(featureName) {
  const cursor = page.getByTestId('timeline-history-cursor');
  const target = page.locator('[data-feature-id]').filter({ hasText: featureName }).first();
  const [cursorBox, targetBox] = await Promise.all([
    cursor.boundingBox(),
    target.boundingBox(),
  ]);
  assert(cursorBox, 'history cursor should be visible');
  assert(targetBox, `${featureName} timeline card should be visible`);
  await page.mouse.move(
    cursorBox.x + cursorBox.width / 2,
    cursorBox.y + cursorBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(targetBox.x + 1, targetBox.y + targetBox.height / 2, { steps: 8 });
  await page.mouse.up();
}

async function dragCursorToEnd() {
  const cursor = page.getByTestId('timeline-history-cursor');
  const last = page.locator('[data-feature-id]').last();
  const [cursorBox, lastBox] = await Promise.all([cursor.boundingBox(), last.boundingBox()]);
  assert(cursorBox && lastBox, 'cursor and last timeline card should be visible');
  await page.mouse.move(
    cursorBox.x + cursorBox.width / 2,
    cursorBox.y + cursorBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(lastBox.x + lastBox.width + 24, lastBox.y + lastBox.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
}

async function deleteFeature(name) {
  const card = page.locator('[data-feature-id]').filter({ hasText: name }).first();
  await card.click({ button: 'right' });
  await page.locator('[data-context-menu-item="delete-feature"]').click();
  const dialog = page.getByRole('alertdialog');
  await dialog.waitFor({ state: 'visible' });
  assert.match(await dialog.innerText(), new RegExp(name));
  await page.getByTestId('delete-feature-confirm').click();
  await page.waitForFunction(
    (featureName) =>
      !window.__appStore
        .getState()
        .document.features.some((feature) => feature.name === featureName)
      && !window.__appStore.getState().solidBusy,
    name,
    { timeout: 60_000 },
  );
}

async function deleteFeatureFromBrowser(name) {
  await page.evaluate(() => {
    const state = window.__appStore.getState();
    const folder = state.document.browser.find((node) => node.kind === 'sketches_folder');
    if (folder && !state.expanded[folder.id]) state.toggleExpanded(folder.id);
  });
  const row = page.locator('[role="treeitem"]').filter({ hasText: name }).first();
  await row.click({ button: 'right' });
  const item = page.locator('[data-context-menu-item="delete-feature"]');
  await item.waitFor({ state: 'visible' });
  assert.match(await item.innerText(), new RegExp(name));
  await item.click();
  await page.getByTestId('delete-feature-confirm').click();
  await page.waitForFunction(
    (featureName) =>
      !window.__appStore
        .getState()
        .document.features.some((feature) => feature.name === featureName)
      && !window.__appStore.getState().solidBusy,
    name,
    { timeout: 60_000 },
  );
}

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(
    () => window.__appStore?.getState().document !== null && !!window.__engine,
  );

  console.log('0. Reorder an independent branch with stable IDs');
  await buildIndependentSketches();
  const originalIds = await page.evaluate(() =>
    Object.fromEntries(
      window.__appStore
        .getState()
        .document.features.map((feature) => [feature.name, feature.id]),
    ),
  );
  await dragFeatureBefore('Sketch2', 'Sketch1');
  await page.waitForFunction(
    () =>
      window.__appStore
        .getState()
        .document.features.map((feature) => feature.name)
        .join(',') === 'Sketch2,Sketch1'
      && !window.__appStore.getState().solidBusy,
    undefined,
    { timeout: 60_000 },
  );
  assert.deepEqual(
    await page.evaluate(() =>
      Object.fromEntries(
        window.__appStore
          .getState()
          .document.features.map((feature) => [feature.name, feature.id]),
      ),
    ),
    originalIds,
  );

  console.log('0b. Right-click a browser sketch to delete its history feature');
  await deleteFeatureFromBrowser('Sketch1');
  assert.deepEqual(
    await page.evaluate(() =>
      window.__appStore.getState().document.features.map((feature) => feature.name),
    ),
    ['Sketch2'],
  );

  await buildHistory();

  console.log('1. Cmd/Ctrl+Z removes the latest feature from history');
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForFunction(
    () =>
      window.__appStore
        .getState()
        .document.features.map((feature) => feature.name)
        .join(',') === 'Sketch1,Extrude1'
      && window.__appStore.getState().document.rollback_index === 2
      && !window.__appStore.getState().solidBusy,
    undefined,
    { timeout: 60_000 },
  );
  assert.equal(
    await page.evaluate(async () => (await window.__engine.chamferDefinitions()).length),
    0,
    'solid Undo must remove the feature definition, not only move the build cursor',
  );

  console.log('1b. Cmd/Ctrl+Shift+Z restores the destructively undone feature');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await page.waitForFunction(
    () =>
      window.__appStore
        .getState()
        .document.features.map((feature) => feature.name)
        .join(',') === 'Sketch1,Extrude1,Chamfer1'
      && window.__appStore.getState().document.rollback_index === 3
      && !window.__appStore.getState().solidBusy,
    undefined,
    { timeout: 60_000 },
  );
  assert.equal(
    await page.evaluate(async () => (await window.__engine.chamferDefinitions()).length),
    1,
    'solid Redo must restore the exact deleted feature definition',
  );

  console.log('1c. The restored feature can be undone again');
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForFunction(
    () =>
      window.__appStore
        .getState()
        .document.features.map((feature) => feature.name)
        .join(',') === 'Sketch1,Extrude1'
      && window.__appStore.getState().document.rollback_index === 2
      && !window.__appStore.getState().solidBusy,
    undefined,
    { timeout: 60_000 },
  );

  console.log('1d. Consecutive solid Undo/Redo commands retain their order');
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForFunction(
    () =>
      window.__appStore
        .getState()
        .document.features.map((feature) => feature.name)
        .join(',') === 'Sketch1'
      && !window.__appStore.getState().solidBusy,
    undefined,
    { timeout: 60_000 },
  );
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await page.waitForFunction(
    () =>
      window.__appStore
        .getState()
        .document.features.map((feature) => feature.name)
        .join(',') === 'Sketch1,Extrude1'
      && !window.__appStore.getState().solidBusy,
    undefined,
    { timeout: 60_000 },
  );
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await page.waitForFunction(
    () =>
      window.__appStore
        .getState()
        .document.features.map((feature) => feature.name)
        .join(',') === 'Sketch1,Extrude1,Chamfer1'
      && !window.__appStore.getState().solidBusy,
    undefined,
    { timeout: 60_000 },
  );

  // Rebuild the original dependency chain for the cursor/reorder coverage.
  await buildHistory();

  console.log('2. Reject moving Extrude1 before its source Sketch1');
  await dragFeatureBefore('Extrude1', 'Sketch1');
  const reorderDialog = page.getByRole('dialog');
  await reorderDialog.waitFor({ state: 'visible' });
  assert.match(await reorderDialog.innerText(), /before its dependency Sketch1/i);
  assert.deepEqual(
    await page.evaluate(() =>
      window.__appStore.getState().document.features.map((feature) => feature.name),
    ),
    ['Sketch1', 'Extrude1', 'Chamfer1'],
  );
  await reorderDialog.getByRole('button', { name: 'OK' }).click();

  console.log('3. Drag cursor backward and snap before Extrude1');
  await dragCursorToFeatureSlot('Extrude1');
  await page.waitForFunction(
    () =>
      window.__appStore.getState().document.rollback_index === 1
      && window.__appStore.getState().solidScene.bodies.length === 0
      && !window.__appStore.getState().solidBusy,
    undefined,
    { timeout: 60_000 },
  );
  assert.equal(await page.getByTestId('timeline-history-cursor').getAttribute('aria-valuenow'), '1');

  console.log('3b. Redo advances and Undo retreats the preserved history cursor');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await page.waitForFunction(
    () =>
      window.__appStore.getState().document.rollback_index === 2
      && window.__appStore.getState().solidScene.bodies.length === 1
      && !window.__appStore.getState().solidBusy,
    undefined,
    { timeout: 60_000 },
  );
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForFunction(
    () =>
      window.__appStore.getState().document.rollback_index === 1
      && window.__appStore.getState().solidScene.bodies.length === 0
      && !window.__appStore.getState().solidBusy,
    undefined,
    { timeout: 60_000 },
  );

  console.log('4. Drag cursor forward to latest and rebuild');
  await dragCursorToEnd();
  await page.waitForFunction(
    () =>
      window.__appStore.getState().document.rollback_index === 3
      && window.__appStore.getState().solidScene.bodies.length === 1
      && !window.__appStore.getState().solidBusy,
    undefined,
    { timeout: 60_000 },
  );

  console.log('5. Right-click deletes only the selected refinement');
  await deleteFeature('Chamfer1');
  let snapshot = await page.evaluate(() => window.__appStore.getState());
  assert.deepEqual(
    snapshot.document.features.map((feature) => feature.name),
    ['Sketch1', 'Extrude1'],
  );
  assert.equal(snapshot.document.rollback_index, 2);
  assert.equal(snapshot.solidScene.bodies.length, 1);

  console.log('6. Deleting a source keeps the dependent feature with a visible error');
  await deleteFeature('Sketch1');
  snapshot = await page.evaluate(() => window.__appStore.getState());
  assert.deepEqual(
    snapshot.document.features.map((feature) => feature.name),
    ['Extrude1'],
  );
  assert.equal(snapshot.document.rollback_index, 1);
  assert.equal(snapshot.solidScene.bodies.length, 0);
  assert.equal(snapshot.document.features[0].status.state, 'error');
  assert.match(snapshot.document.features[0].status.message, /sketch 'Sketch1' was not found/i);
  assert.equal(snapshot.finishedSketches.length, 0);

  console.log('7. Broken history remains saveable and reopens with the same error');
  await page.evaluate(async () => {
    const engine = window.__engine;
    const model = await engine.exportProjectModel();
    const update = await engine.loadProjectModel(model);
    const store = window.__appStore.getState();
    store.applySolidUpdate(update);
    store.setFinishedSketches(await engine.finishedSketches());
    store.applyDatumPlaneUpdate({
      document: update.document,
      planes: await engine.datumPlaneDefinitions(),
    });
  });
  snapshot = await page.evaluate(() => window.__appStore.getState());
  assert.deepEqual(
    snapshot.document.features.map((feature) => feature.name),
    ['Extrude1'],
  );
  assert.equal(snapshot.document.features[0].status.state, 'error');
  assert.equal(snapshot.solidScene.bodies.length, 0);
  assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join('\n')}`);

  console.log('  [ok] safe reorder, dependency rejection, cursor, deletion, and replay work');
} finally {
  await browser.close();
}
