/**
 * True/reference-dimension regression:
 * - a repeated measurement becomes a read-only reference annotation;
 * - references do not change DOF or allocate parameters;
 * - reference values follow solved geometry;
 * - the inline editor converts one dimension between driving/reference modes.
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

  const created = await page.evaluate(async () => {
    const engine = window.__engine;
    const store = window.__appStore.getState();
    store.applySolidUpdate(await engine.newProject());
    let sketch = await engine.beginSketch({ type: 'origin_plane', plane: 'xy' });
    sketch = await engine.setGridSnap(false);
    store.setMode('sketch');
    store.setActiveSketch(sketch);

    const first = await engine.addLine({
      from: { x: 0, y: 0 },
      to_raw: { x: 40, y: 0 },
      ctrl_held: true,
    });
    const driving = await engine.addDimension({
      entities: [first.entity_id],
      text_pos: { x: 20, y: 8 },
    });
    const dofWithDriver = driving.sketch.dof.value;
    const duplicate = await engine.addDimension({
      entities: [first.entity_id],
      text_pos: { x: 20, y: 16 },
    });
    const drivingDim = duplicate.sketch.dimensions.find((dim) => dim.mode === 'driving');
    const referenceDim = duplicate.sketch.dimensions.find((dim) => dim.mode === 'reference');
    if (!drivingDim || !referenceDim) throw new Error('missing driving/reference pair');
    if (duplicate.sketch.dof.value !== dofWithDriver) {
      throw new Error('reference dimension changed solver DOF');
    }
    if (referenceDim.param_id !== null || referenceDim.param_name !== null) {
      throw new Error('reference dimension allocated a parameter');
    }
    if (referenceDim.text !== '(40.00)') throw new Error('reference format is incorrect');

    const edited = await engine.editDimension({
      constraint_id: drivingDim.constraint_id,
      text: '55',
    });
    const liveReference = edited.sketch.dimensions.find(
      (dim) => dim.constraint_id === referenceDim.constraint_id,
    );
    if (liveReference?.text !== '(55.00)') throw new Error('reference value did not update');

    const second = await engine.addLine({
      from: { x: 0, y: 30 },
      to_raw: { x: 25, y: 30 },
      ctrl_held: true,
    });
    const secondDriving = await engine.addDimension({
      entities: [second.entity_id],
      text_pos: { x: 12.5, y: 38 },
    });
    const convertible = secondDriving.sketch.dimensions.find(
      (dim) => dim.mode === 'driving' && dim.entities.includes(second.entity_id),
    );
    if (!convertible) throw new Error('missing convertible driving dimension');
    store.setActiveSketch(secondDriving.sketch);
    store.setDimEditor({ dimId: convertible.constraint_id, initial: '25', x: 320, y: 300 });
    return {
      convertibleId: convertible.constraint_id,
      drivingDof: secondDriving.sketch.dof.value,
    };
  });

  console.log('1. Inline dimension editor converts a driver to a reference');
  await page.locator('[data-dimension-mode-toggle]').click();
  await page.waitForFunction(
    (id) => window.__appStore.getState().activeSketch?.dimensions
      .find((dimension) => dimension.constraint_id === id)?.mode === 'reference',
    created.convertibleId,
  );
  let converted = await page.evaluate((id) => {
    const state = window.__appStore.getState();
    const dimension = state.activeSketch.dimensions.find((candidate) => candidate.constraint_id === id);
    return { dimension, dof: state.activeSketch.dof.value };
  }, created.convertibleId);
  assert.equal(converted.dimension.param_id, null);
  assert.ok(converted.dimension.text.startsWith('('));
  assert.equal(converted.dof, created.drivingDof + 1);

  console.log('2. Reference editor is read-only and can restore driving mode');
  await page.evaluate((id) => {
    const dimension = window.__appStore.getState().activeSketch.dimensions
      .find((candidate) => candidate.constraint_id === id);
    window.__appStore.getState().setDimEditor({
      dimId: id,
      initial: String(dimension.value),
      x: 320,
      y: 300,
    });
  }, created.convertibleId);
  await page.locator('[data-reference-dimension-value]').waitFor({ state: 'visible' });
  assert.equal(await page.locator('[data-dimension-input]').count(), 0);
  await page.locator('[data-dimension-mode-toggle]').click();
  await page.waitForFunction(
    (id) => window.__appStore.getState().activeSketch?.dimensions
      .find((dimension) => dimension.constraint_id === id)?.mode === 'driving',
    created.convertibleId,
  );
  converted = await page.evaluate((id) => {
    const state = window.__appStore.getState();
    const dimension = state.activeSketch.dimensions.find((candidate) => candidate.constraint_id === id);
    return { dimension, dof: state.activeSketch.dof.value };
  }, created.convertibleId);
  assert.equal(typeof converted.dimension.param_id, 'number');
  assert.equal(converted.dof, created.drivingDof);

  assert.deepEqual(pageErrors, []);
  console.log('  [ok] reference dimensions remain measurements, not hidden solver inputs');
} finally {
  await browser.close();
}
