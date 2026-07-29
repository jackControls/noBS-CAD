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
  await profileCheckbox.uncheck();
  await page.waitForFunction(
    () => window.__appStore.getState().profilePicker?.selected.length === 0,
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
  assert.equal(await profileCheckbox.isChecked(), true);
  await page.waitForFunction(
    () =>
      window
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
