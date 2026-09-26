/**
 * Numeric input editing regression:
 * - command activation and Tab focus select all for fast replacement;
 * - first activation selects all, a later single click places a native caret,
 *   and a double-click selects all again;
 * - sketch dynamic-input fields visibly select and replace on Tab/click.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE = process.env.NBCAD_E2E_BASE_URL ?? 'http://localhost:7199';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error)));

const state = () => page.evaluate(() => window.__appStore.getState());
const sketchToScreen = (x, y) =>
  page.evaluate(([sx, sy]) => window.__sketchToScreen(sx, sy), [x, y]);
const clickSketch = async (x, y) => {
  const point = await sketchToScreen(x, y);
  await page.mouse.click(point.x, point.y);
};
const pickOriginPlaneFromViewport = async (plane) => {
  for (let y = 140; y <= 720; y += 35) {
    for (let x = 220; x <= 1060; x += 35) {
      await page.mouse.move(x, y);
      await page.waitForTimeout(10);
      if ((await state()).hoveredPlane === plane) {
        await page.mouse.click(x, y);
        return;
      }
    }
  }
  throw new Error(`could not select the ${plane.toUpperCase()} origin plane in the viewport`);
};

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__appStore?.getState().document != null);

  // A lightweight real feature dialog gives us an ordinary numeric input
  // without first creating a solid.
  await page.evaluate(() =>
    window.__appStore.getState().openConstructionPlaneDialog('offset'),
  );
  const planeDialog = page.getByTestId('construction-plane-dialog');
  await planeDialog.waitFor({ state: 'visible' });
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="construction-plane-dialog"]')?.textContent?.includes('Loading'),
  );
  assert.equal(
    (await state()).constructionPlanePickTarget,
    'first_reference',
    'a new construction plane clearly enters reference-selection mode',
  );
  const selectionStatus = page.getByTestId('construction-plane-selection-status');
  await selectionStatus.waitFor({ state: 'visible' });
  assert.match(
    (await selectionStatus.textContent()) ?? '',
    /Viewport selection active.*reference plane/i,
  );
  assert.match(
    (await page.locator('[data-native-hud="prompt"]').textContent()) ?? '',
    /Select the first planar face or reference plane/i,
    'the shared Bevy HUD prompt mirrors the active dialog role',
  );
  await page.keyboard.press('Escape');
  assert.equal(
    (await state()).constructionPlanePickTarget,
    null,
    'Escape stops reference picking without closing the command dialog',
  );
  await page.getByTestId('pick-construction-first-reference').click();
  assert.equal((await state()).constructionPlanePickTarget, 'first_reference');

  const referencePicker = page.getByTestId('pick-construction-first-reference');
  await pickOriginPlaneFromViewport('xz');
  await page.waitForFunction(
    () => document.querySelector('[data-testid="pick-construction-first-reference"]')
      ?.textContent?.includes('XZ origin plane'),
  );
  assert.equal(
    (await state()).constructionPlanePickTarget,
    null,
    'choosing a visible reference in the viewport ends selection',
  );
  assert.match(
    (await referencePicker.textContent()) ?? '',
    /XZ origin plane/i,
    'the field names the visually selected reference',
  );
  const distance = planeDialog.getByLabel('Offset distance (mm)');
  await page.waitForFunction(
    () => document.activeElement instanceof HTMLInputElement
      && document.activeElement.type === 'number'
      && document.activeElement.closest('[data-testid="construction-plane-dialog"]') !== null,
  );
  // Let the command's requestAnimationFrame-based focus/select handoff settle
  // before simulating a much faster-than-human key sequence.
  await page.evaluate(() => new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  ));
  await page.keyboard.type('25');
  assert.equal(
    await distance.inputValue(),
    '25',
    'choosing required geometry focuses and replaces the complete measurement',
  );

  await referencePicker.click();
  assert.equal(
    await referencePicker.evaluate((element) => element === document.activeElement),
    true,
    'the viewport selection field is keyboard focusable',
  );
  await page.keyboard.press('Tab');
  assert.equal(
    await planeDialog.getByRole('button', { name: 'Clear' })
      .evaluate((element) => element === document.activeElement),
    true,
    'Tab reaches the clear action for the selected reference',
  );
  await page.keyboard.press('Tab');
  assert.equal(
    await distance.evaluate((element) => element === document.activeElement),
    true,
    'Tab moves focus into the dimension input',
  );
  await page.keyboard.type('12');
  assert.equal(
    await distance.inputValue(),
    '12',
    'Tab focus replaces the complete numeric value',
  );
  await planeDialog.getByRole('button', { name: 'Cancel' }).click();

  // The expression-capable inline sketch dimension editor uses the same
  // primitive in text mode. Use a real driving dimension: the production
  // editor intentionally rejects stale/nonexistent constraint ids.
  const expressionDimensionId = await page.evaluate(async () => {
    const engine = window.__engine;
    const store = window.__appStore.getState();
    let sketch = await engine.beginSketch({ type: 'origin_plane', plane: 'xy' });
    sketch = await engine.setGridSnap(false);
    store.setActiveSketch(sketch);
    store.setMode('sketch');
    const line = await engine.addLine({
      from: { x: -45, y: 35 },
      to_raw: { x: -20, y: 35 },
      ctrl_held: true,
    });
    const dimensioned = await engine.addDimension({
      entities: [line.entity_id],
      text_pos: { x: -32.5, y: 43 },
    });
    store.setActiveSketch(dimensioned.sketch);
    const dimension = dimensioned.sketch.dimensions.find(
      (candidate) => candidate.mode === 'driving' && candidate.entities.includes(line.entity_id),
    );
    if (!dimension) throw new Error('missing expression test dimension');
    return dimension.constraint_id;
  });
  await page.evaluate(
    (dimId) => window.__appStore.getState().setDimEditor({
        dimId,
        initial: '=50/2',
        x: 500,
        y: 300,
      }),
    expressionDimensionId,
  );
  const expressionInput = page.locator('[data-dimension-input][type="text"]');
  await expressionInput.waitFor({ state: 'visible' });
  await page.waitForFunction(() => {
    const input = document.querySelector('[data-dimension-input][type="text"]');
    return input === document.activeElement && input?.value === '=50/2';
  });
  await page.keyboard.type('30');
  assert.equal(
    await expressionInput.inputValue(),
    '30',
    'a newly opened expression dimension is ready for direct replacement',
  );
  await expressionInput.fill('12.34');
  await expressionInput.evaluate((element) => element.blur());
  await expressionInput.click({ position: { x: 30, y: 14 } });
  const activationSelection = await expressionInput.evaluate((element) => ({
    start: element.selectionStart,
    end: element.selectionEnd,
    length: element.value.length,
  }));
  assert.deepEqual(
    activationSelection,
    { start: 0, end: activationSelection.length, length: activationSelection.length },
    'the first click that activates a dimension selects the complete value',
  );
  await expressionInput.click({ position: { x: 30, y: 14 } });
  const caretBeforeArrow = await expressionInput.evaluate((element) => ({
    start: element.selectionStart,
    end: element.selectionEnd,
    length: element.value.length,
  }));
  assert.equal(
    caretBeforeArrow.start,
    caretBeforeArrow.end,
    'clicking an existing dimension places a caret instead of selecting all',
  );
  assert.ok(
    caretBeforeArrow.start > 0 && caretBeforeArrow.start < caretBeforeArrow.length,
    `pointer caret should land inside the numeric string: ${JSON.stringify(caretBeforeArrow)}`,
  );
  await page.keyboard.press('ArrowRight');
  const caretAfterArrow = await expressionInput.evaluate(
    (element) => element.selectionStart,
  );
  assert.equal(
    caretAfterArrow,
    caretBeforeArrow.start + 1,
    'Left/Right arrow keys move the inline dimension caret normally',
  );
  await expressionInput.dblclick({ position: { x: 30, y: 14 } });
  const doubleClickSelection = await expressionInput.evaluate((element) => ({
    start: element.selectionStart,
    end: element.selectionEnd,
    length: element.value.length,
  }));
  assert.deepEqual(
    doubleClickSelection,
    { start: 0, end: doubleClickSelection.length, length: doubleClickSelection.length },
    'double-clicking a dimension selects the complete value',
  );
  await expressionInput.press('Escape');

  // Real annotation double-clicks must start a fresh edit, including when a
  // same-ID editor is still mounted while application Undo changes its value.
  const openExpressionDimension = async () => {
    const point = await page.evaluate((id) => {
      const dim = window.__appStore.getState().activeSketch.dimensions
        .find((candidate) => candidate.constraint_id === id);
      return window.__sketchToScreen(dim.text_pos.x, dim.text_pos.y);
    }, expressionDimensionId);
    assert(point, 'active dimension must have a viewport position');
    await page.mouse.dblclick(point.x, point.y);
    await expressionInput.waitFor({ state: 'visible' });
  };
  const waitForDimensionValue = async (value) => page.waitForFunction(
    ([id, expected]) => window.__appStore.getState().activeSketch?.dimensions
      .find((dimension) => dimension.constraint_id === id)?.value === expected,
    [expressionDimensionId, value],
  );
  await openExpressionDimension();
  await page.keyboard.type('50');
  await page.keyboard.press('Enter');
  await expressionInput.waitFor({ state: 'detached' });
  await waitForDimensionValue(50);
  await openExpressionDimension();
  await clickSketch(60, -40);
  await page.keyboard.press('ControlOrMeta+z');
  await waitForDimensionValue(25);
  await openExpressionDimension();
  assert.equal(await expressionInput.inputValue(), '25', 'Reopening after Undo must not retain the old 50 draft');
  assert.deepEqual(await expressionInput.evaluate(input => ({
    focused: input === document.activeElement,
    start: input.selectionStart,
    end: input.selectionEnd,
  })), { focused: true, start: 0, end: 2 });
  await page.keyboard.type('30');
  await page.keyboard.press('Enter');
  await expressionInput.waitFor({ state: 'detached' });
  await waitForDimensionValue(30);
  await openExpressionDimension();
  await page.keyboard.type('99');
  await page.keyboard.press('Escape');
  await expressionInput.waitFor({ state: 'detached' });
  await waitForDimensionValue(30);

  await openExpressionDimension();
  await page.keyboard.type('=60/2');
  await page.keyboard.press('Enter');
  await expressionInput.waitFor({ state: 'detached' });
  await waitForDimensionValue(30);
  await openExpressionDimension();
  assert.equal(await expressionInput.inputValue(), '=60/2', 'Committed formulas must survive reopening');
  await page.keyboard.press('Escape');

  // Exercise the custom sketch dynamic-input system in that same sketch.
  await page.locator('button[title="Rectangle"]').click();
  await clickSketch(-30, -20);
  const previewPoint = await sketchToScreen(20, 10);
  await page.mouse.move(previewPoint.x, previewPoint.y);
  await page.waitForFunction(() => window.__appStore.getState().dynInput.active);

  await page.keyboard.type('50');
  await page.keyboard.press('Tab');
  let app = await state();
  assert.equal(app.dynInput.focus, 1);
  assert.equal(app.dynInput.selectAll, true, 'Tab selects the whole next field');
  await page.keyboard.type('30');

  await page.keyboard.press('Shift+Tab');
  app = await state();
  assert.equal(app.dynInput.focus, 0);
  assert.equal(app.dynInput.selectAll, true, 'Shift+Tab selects the prior field');
  await page.keyboard.type('40');
  app = await state();
  assert.equal(
    app.dynInput.fields.find((field) => field.key === 'width')?.value,
    '40',
    'typing replaces the selected width instead of appending',
  );

  await page.locator('[data-dyn-field="height"]').click();
  app = await state();
  assert.equal(app.dynInput.selectAll, true, 'mouse click selects the dynamic value');
  await page.keyboard.type('20');
  app = await state();
  assert.equal(
    app.dynInput.fields.find((field) => field.key === 'height')?.value,
    '20',
    'typing replaces the mouse-selected height instead of appending',
  );

  // The shared field's key can change before a geometry-derived value is
  // populated by its caller's effect. Exercise the actual External Thread
  // dialog with two real custom-diameter shafts, not just a synthetic input.
  const threadPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  threadPage.on('pageerror', error => pageErrors.push(String(error)));
  try {
    await threadPage.goto(BASE, { waitUntil: 'networkidle' });
    await threadPage.waitForFunction(() => window.__appStore?.getState().document && window.__engine);
    const shafts = await threadPage.evaluate(async () => {
      const engine = window.__engine;
      const store = window.__appStore.getState();
      const results = [];
      for (const [x, radius] of [[0, 6.15], [40, 8.65]]) {
        const sketch = await engine.beginSketch({ type: 'origin_plane', plane: 'xy' });
        await engine.setGridSnap(false);
        await engine.addCircle({
          mode: 'center_diameter', p1: { x, y: 0 }, p2: { x: x + radius, y: 0 }, ctrl_held: true,
        });
        const ended = await engine.endSketch();
        store.setDocument(ended.document);
        store.setFinishedSketches(await engine.finishedSketches());
        const update = await engine.extrude({
          sketch_name: sketch.name, profile_indices: [0], operation: 'new_body',
          extent: { type: 'distance', distance: 10 }, taper_angle_deg: 0, flip: false, target_body_ids: [],
        });
        store.applySolidUpdate(update);
        const body = update.scene.bodies.find(body => body.faces.some(face =>
          face.cylinder && Math.abs(face.cylinder.radius - radius) < 1e-6));
        const face = body.faces.find(face => face.cylinder && Math.abs(face.cylinder.radius - radius) < 1e-6);
        results.push({ body: body.id, face: face.id });
      }
      store.setMode('solid');
      store.setSelectedBody(results[0].body);
      store.setSelectedFace(results[0].face);
      store.openBodyFeatureDialog('external_thread');
      return results;
    });
    const nominal = threadPage.getByTestId('external-thread-nominal');
    await nominal.waitFor({ state: 'visible' });
    await threadPage.waitForFunction(() => document.querySelector('[data-testid="external-thread-nominal"]')?.value === '12.3');
    // These are the same accepted body/face selections produced by viewport picking.
    await threadPage.evaluate(shaft => {
      const store = window.__appStore.getState();
      store.setModelingPickTarget('external_thread_face');
      store.setSelectedBody(shaft.body);
      store.setSelectedFace(shaft.face);
    }, shafts[1]);
    await threadPage.waitForFunction(() => document.querySelector('[data-testid="external-thread-nominal"]')?.value === '17.3');
    await threadPage.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert(await nominal.evaluate(input => input === document.activeElement));
    await threadPage.keyboard.type('22');
    assert.equal(await nominal.inputValue(), '22', 'Retargeting must select the updated value, not append to produce 17.322');
  } finally {
    await threadPage.close();
  }
  assert.deepEqual(pageErrors, []);

  console.log('  [ok] dimension inputs support fast replacement and precise caret editing');
} finally {
  await browser.close();
}
