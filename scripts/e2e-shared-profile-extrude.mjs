/**
 * Shared-profile extrusion regression:
 * adjacent closed regions that share a real boundary auto-fuse into one
 * simplified body, while disconnected regions retain New Body semantics.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE = 'http://localhost:7199';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error)));

async function finishProfiles(kind) {
  return page.evaluate(async (profileKind) => {
    const engine = window.__engine;
    const store = window.__appStore.getState();
    store.applySolidUpdate(await engine.newProject());
    await engine.beginSketch({ type: 'origin_plane', plane: 'xy' });
    await engine.setGridSnap(false);
    if (profileKind === 'shared') {
      await engine.addRectangle({
        mode: 'two_point',
        p1: { x: -20, y: -10 },
        p2: { x: 20, y: 10 },
        ctrl_held: true,
      });
      await engine.addLine({
        from: { x: 0, y: -10 },
        to_raw: { x: 0, y: 10 },
        ctrl_held: true,
      });
    } else {
      await engine.addRectangle({
        mode: 'two_point',
        p1: { x: -25, y: -10 },
        p2: { x: -5, y: 10 },
        ctrl_held: true,
      });
      await engine.addRectangle({
        mode: 'two_point',
        p1: { x: 5, y: -10 },
        p2: { x: 25, y: 10 },
        ctrl_held: true,
      });
    }
    const ended = await engine.endSketch();
    store.setDocument(ended.document);
    store.setFinishedSketches(await engine.finishedSketches());
    store.setMode('solid');
    store.clearSolidSelection();
    window.__cameraApi.fit();
    const catalog = await engine.profileCatalog();
    return catalog[0].profiles.filter((profile) => profile.nesting_depth % 2 === 0).length;
  }, kind);
}

async function selectEveryProfile(dialog) {
  const checkboxes = dialog.locator('fieldset').filter({ hasText: 'Profiles' }).locator('input[type="checkbox"]');
  assert.equal(await checkboxes.count(), 2);
  for (let index = 0; index < 2; index += 1) {
    await checkboxes.nth(index).check();
  }
  await page.waitForFunction(
    () => window.__appStore.getState().profilePicker?.selected.length === 2,
  );
}

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(
    () => window.__appStore?.getState().document !== null && !!window.__engine,
  );
  const extrudeButton = page.locator('button[title="Extrude"]').first();
  const dialog = page.getByTestId('extrude-dialog');

  console.log('1. Shared-edge regions automatically use Join');
  assert.equal(await finishProfiles('shared'), 2);
  await extrudeButton.click();
  await dialog.waitFor({ state: 'visible' });
  await page.waitForFunction(
    () => window.__appStore.getState().profilePicker?.owner === 'extrude',
  );
  await selectEveryProfile(dialog);
  const joinChoice = dialog.locator('[data-extrude-operation="join"]');
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="extrude-dialog"] [data-extrude-operation="join"]')
        ?.getAttribute('aria-checked') === 'true',
  );
  assert.match(
    await page.getByTestId('extrude-auto-operation').innerText(),
    /shared-edge profiles will be fused into one body/i,
  );
  assert.equal(await joinChoice.getAttribute('aria-checked'), 'true');
  await page.getByTestId('extrude-submit').click();
  await page.waitForFunction(
    () => {
      const state = window.__appStore.getState();
      return state.extrudeDialogFeature === null
        && !state.solidBusy
        && state.solidScene.bodies.length === 1;
    },
    undefined,
    { timeout: 60_000 },
  );
  const fused = await page.evaluate(() => {
    const state = window.__appStore.getState();
    const body = state.solidScene.bodies[0];
    return {
      bodyCount: state.solidScene.bodies.length,
      faceCount: body.faces.length,
      edgeCount: body.edges.length,
      allEdgesRefinable: body.edges.every((edge) => edge.refinable),
      finishedSketchCount: state.finishedSketches.length,
      errors: state.solidScene.errors,
    };
  });
  assert.deepEqual(fused.errors, []);
  assert.equal(fused.bodyCount, 1);
  assert.equal(fused.faceCount, 6, 'coplanar cap/side partitions should be unified');
  assert.equal(fused.edgeCount, 12, 'the shared boundary must not survive as a seam');
  assert.equal(fused.allEdgesRefinable, true);
  assert.equal(fused.finishedSketchCount, 1, 'the source sketch remains in history');

  console.log('2. Disconnected regions keep New Body semantics');
  assert.equal(await finishProfiles('disconnected'), 2);
  await extrudeButton.click();
  await dialog.waitFor({ state: 'visible' });
  await page.waitForFunction(
    () => window.__appStore.getState().profilePicker?.owner === 'extrude',
  );
  await selectEveryProfile(dialog);
  const newBodyChoice = dialog.locator('[data-extrude-operation="new_body"]');
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="extrude-dialog"] [data-extrude-operation="new_body"]')
        ?.getAttribute('aria-checked') === 'true',
  );
  assert.equal(await newBodyChoice.getAttribute('aria-checked'), 'true');
  await page.getByTestId('extrude-submit').click();
  await page.waitForFunction(
    () => {
      const state = window.__appStore.getState();
      return state.extrudeDialogFeature === null
        && !state.solidBusy
        && state.solidScene.bodies.length === 2;
    },
    undefined,
    { timeout: 60_000 },
  );
  assert.deepEqual(
    await page.evaluate(() => window.__appStore.getState().solidScene.errors),
    [],
  );
  assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join('\n')}`);
  console.log('  [ok] shared regions fuse cleanly and disconnected regions stay separate');
} finally {
  await browser.close();
}
