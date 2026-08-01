/**
 * Extrude dialog regression for the ordinary default workflow:
 * rectangle → Finish Sketch → Extrude → press Enter with untouched 10 mm.
 * Also guards modeless viewport profile selection and invalid-submit feedback.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE = 'http://localhost:7199';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error)));

async function createFinishedRectangle() {
  await page.evaluate(async () => {
    const engine = window.__engine;
    const initial = await engine.newProject();
    const store = window.__appStore.getState();
    store.applySolidUpdate(initial);
    await engine.beginSketch({ type: 'origin_plane', plane: 'xy' });
    await engine.setGridSnap(false);
    await engine.addRectangle({
      mode: 'two_point',
      p1: { x: -30, y: -20 },
      p2: { x: 30, y: 20 },
      ctrl_held: true,
    });
    const ended = await engine.endSketch();
    store.setDocument(ended.document);
    store.setFinishedSketches(await engine.finishedSketches());
    store.setMode('solid');
    store.setSelectedBody(null);
    store.setSelectedFace(null);
    store.setSelectedEdges([]);
    window.__cameraApi.fit();
  });
  await page.waitForFunction(
    () => window.__appStore.getState().finishedSketches.length === 1,
  );
}

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(
    () => window.__appStore?.getState().document !== null && !!window.__engine,
  );

  console.log('1. Untouched default 10 mm submits with Enter');
  await createFinishedRectangle();
  const extrudeButton = page.locator('button[title="Extrude"]').first();
  await extrudeButton.click();
  const dialog = page.getByTestId('extrude-dialog');
  await dialog.waitFor({ state: 'visible' });
  await page.waitForFunction(
    () =>
      window.__appStore.getState().profilePicker?.owner === 'extrude'
      && !window.__appStore.getState().solidBusy,
  );
  const distance = page.getByTestId('extrude-distance');
  assert.equal(await distance.inputValue(), '10');
  assert.equal(
    await distance.evaluate((element) => document.activeElement === element),
    true,
    'default distance should receive focus so Enter submits the dialog',
  );
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () =>
      window.__appStore.getState().solidScene.bodies.length === 1
      && window.__appStore.getState().extrudeDialogFeature === null
      && !window.__appStore.getState().solidBusy,
    undefined,
    { timeout: 60_000 },
  );
  assert.equal((await page.evaluate(() => window.__appStore.getState().solidScene.bodies.length)), 1);

  console.log('2. Reopening an already-open Extrude is idempotent and canvas picking remains active');
  await createFinishedRectangle();
  await extrudeButton.click();
  await dialog.waitFor({ state: 'visible' });
  await page.waitForFunction(
    () => window.__appStore.getState().profilePicker?.owner === 'extrude',
  );
  const profileCheckbox = dialog.locator('input[type="checkbox"]').first();
  assert.equal(await profileCheckbox.isChecked(), true);
  await page.evaluate(() => {
    window.__appStore.getState().selectSolidFeature('face', 999, 888, null, false);
  });
  await page.getByTestId('extrude-clear-profiles').click();
  await page.waitForFunction(
    () =>
      window.__appStore.getState().profilePicker?.selected.length === 0
      && window.__appStore.getState().profilePicker?.sketchName === ''
      && window.__appStore.getState().selectedFace === null,
  );
  assert.equal(
    await page.getByTestId('extrude-sketch').inputValue(),
    '',
    'Clear & reselect removes the old sketch scope instead of trapping the picker',
  );
  assert.equal(
    await page.evaluate(() => window.__nativeViewportTransient().triangles.length),
    0,
    'unselected candidates remain lightweight outlines instead of stacked x-ray fills',
  );

  // A repeated command invocation must not erase the initialized picker.
  await extrudeButton.click();
  assert.equal(
    await page.evaluate(() => window.__appStore.getState().profilePicker?.owner),
    'extrude',
  );

  const center = await page.evaluate(() => window.__worldToScreen(0, 0, 0));
  await page.mouse.click(center.x, center.y);
  await page.waitForFunction(
    () => window.__appStore.getState().profilePicker?.selected.length === 1,
  );
  assert.notEqual(
    await page.evaluate(() => window.__appStore.getState().profilePicker?.sketchName),
    '',
    'clicking any candidate region adopts its owning sketch',
  );
  assert.equal(
    await dialog.locator('input[type="checkbox"]:checked').count(),
    1,
  );
  await page.waitForFunction(
    () =>
      window.__nativeViewportTransient().triangles.length >= 2
      && window.__nativeViewportTransient().arrows.length === 1
      && window
        .__nativeViewportTransient()
        .lines.some((layer) => layer.segments.length >= 6),
  );
  const nativeProfilePresentation = await page.evaluate(
    () => window.__nativeViewportTransient(),
  );
  assert.ok(
    nativeProfilePresentation.lines.some((layer) => layer.segments.length >= 6),
    'Bevy receives the selected profile outline used by Extrude and other profile commands',
  );
  assert.ok(
    nativeProfilePresentation.triangles.some(
      (layer) => layer.xray && layer.positions.length >= 18 && layer.color[3] > 0.25,
    ),
    'the selected closed region is a translucent filled surface, not only a wire',
  );
  assert.equal(
    await page.getByTestId('extrude-profile-selection-state').isVisible(),
    true,
    'the dialog explicitly tells the user that viewport profile selection is active',
  );

  await distance.fill('25');
  await page.waitForFunction(() => {
    const arrow = window.__nativeViewportTransient().arrows[0];
    if (!arrow) return false;
    return Math.abs(Math.hypot(
      arrow.end[0] - arrow.start[0],
      arrow.end[1] - arrow.start[1],
      arrow.end[2] - arrow.start[2],
    ) - 25) < 0.001;
  });
  assert.equal(
    await page.evaluate(() => window.__nativeViewportTransient().arrows[0].width),
    2,
    'Bevy owns a semantic 3D direction arrow that tracks debounced distance edits',
  );

  console.log('3. Invalid Enter submission explains why it cannot run');
  await distance.fill('0');
  await page.keyboard.press('Enter');
  const feedback = page.getByTestId('extrude-validation-error');
  await feedback.waitFor({ state: 'visible' });
  assert.match(await feedback.innerText(), /non-zero extrusion distance/i);
  assert.equal(
    await page.evaluate(() => window.__appStore.getState().solidScene.bodies.length),
    0,
  );
  assert.equal(
    await page.evaluate(() => window.__appStore.getState().extrudeDialogFeature),
    0,
  );
  assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join('\n')}`);

  console.log('  [ok] Enter, default distance, canvas profile selection, and validation feedback work');
} finally {
  await browser.close();
}
