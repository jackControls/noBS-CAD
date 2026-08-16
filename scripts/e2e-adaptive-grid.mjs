/**
 * Adaptive sketch-grid regression:
 * - visible/snap spacing becomes finer and coarser with camera zoom;
 * - the browser engine accepts a one-micrometer grid;
 * - a typed angle keeps its exact direction while its free distance snaps;
 * - point-axis tracking crosses the WASM boundary and becomes associative;
 * - an off-grid anchor still infers Horizontal from the raw cursor ray.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE = 'http://localhost:7199';
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

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__appStore.getState().document !== null);
  await page.getByRole('button', { name: 'Create Sketch' }).first().click();
  await page.waitForTimeout(250);
  const xyPlane = page.getByText('XY Plane', { exact: true });
  if (!(await xyPlane.isVisible())) {
    await page.getByRole('button', { name: 'Origin' }).click();
  }
  await xyPlane.click();
  await page.waitForFunction(
    () => window.__appStore.getState().mode === 'sketch' && !!window.__sketchGridStep,
  );
  await page.waitForTimeout(700);

  const gridStep = () => page.evaluate(() => window.__sketchGridStep());
  const initialStep = await gridStep();
  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  assert.ok(box, 'viewport canvas should be visible');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -500);
  await page.keyboard.up('Control');
  await page.waitForTimeout(500);
  const zoomedStep = await gridStep();
  assert.ok(
    zoomedStep < initialStep,
    `zooming in should refine the grid (${initialStep} → ${zoomedStep})`,
  );

  await page.keyboard.down('Control');
  await page.mouse.wheel(0, 500);
  await page.keyboard.up('Control');
  await page.waitForTimeout(500);
  const restoredStep = await gridStep();
  assert.ok(
    restoredStep > zoomedStep,
    `zooming out should coarsen the grid (${zoomedStep} → ${restoredStep})`,
  );

  const engineChecks = await page.evaluate(async () => {
    const engine = window.__engine;
    await engine.setGridStep(0.001);
    const micro = await engine.previewSegment({
      from: { x: 20, y: 20 },
      to_raw: { x: 12.3454, y: 8.7656 },
      ctrl_held: true,
    });
    await engine.setGridStep(5);
    const lockedAngleGrid = await engine.previewSegmentLocked({
      from: { x: 5, y: 10 },
      to_hint: { x: 15.16, y: -0.16 },
      length_mm: null,
      angle_deg: -45,
      length_text: null,
      angle_text: null,
      ctrl_held: false,
      tracking: null,
    });
    const reference = await engine.addPoint({ position: { x: 0, y: 5 } });
    const referenceId = reference.entities[0];
    const trackedPreview = await engine.previewSegmentLocked({
      from: { x: 5, y: 15 },
      to_hint: { x: 15.1, y: 4.9 },
      length_mm: null,
      angle_deg: -45,
      length_text: null,
      angle_text: null,
      ctrl_held: false,
      tracking: { point: referenceId, axis: 'horizontal' },
    });
    const trackedLine = await engine.addLineLocked({
      from: { x: 5, y: 15 },
      to_hint: { x: 15.1, y: 4.9 },
      length_mm: null,
      angle_deg: -45,
      length_text: null,
      angle_text: null,
      ctrl_held: false,
      tracking: { point: referenceId, axis: 'horizontal' },
    });
    await engine.setGridStep(10);
    const nearHorizontalY = 15 + 30 * Math.tan((9.5 * Math.PI) / 180);
    const horizontal = await engine.previewSegment({
      from: { x: 0, y: 15 },
      to_raw: { x: 30, y: nearHorizontalY },
      ctrl_held: false,
    });
    return { micro, horizontal, lockedAngleGrid, referenceId, trackedPreview, trackedLine };
  });
  assert.ok(Math.abs(engineChecks.micro.snapped_to.x - 12.345) < 1e-9);
  assert.ok(Math.abs(engineChecks.micro.snapped_to.y - 8.766) < 1e-9);
  assert.deepEqual(engineChecks.horizontal.inferences, ['horizontal']);
  assert.deepEqual(engineChecks.horizontal.snapped_to, { x: 30, y: 15 });
  assert.equal(engineChecks.lockedAngleGrid.snap.kind, 'grid');
  assert.ok(Math.abs(engineChecks.lockedAngleGrid.snapped_to.x - 15) < 1e-9);
  assert.ok(Math.abs(engineChecks.lockedAngleGrid.snapped_to.y) < 1e-9);
  assert.ok(Math.abs(engineChecks.trackedPreview.snapped_to.x - 15) < 1e-9);
  assert.ok(Math.abs(engineChecks.trackedPreview.snapped_to.y - 5) < 1e-9);
  assert.equal(engineChecks.trackedPreview.tracking.axis, 'horizontal');
  assert.equal(engineChecks.trackedPreview.tracking.point, engineChecks.referenceId);
  assert.ok(
    engineChecks.trackedLine.sketch.constraints.some(
      (constraint) =>
        constraint.type === 'horizontal_points'
        && constraint.a === engineChecks.referenceId
        && constraint.b === engineChecks.trackedLine.end_point_id,
    ),
    'tracked endpoint should keep an associative horizontal point relation',
  );

  // Make a real off-grid start point, then draw from it with grid snap on.
  await page.evaluate(async () => {
    const engine = window.__engine;
    let sketch = await engine.setGridSnap(false);
    window.__appStore.getState().setActiveSketch(sketch);
    const result = await engine.addPoint({ position: { x: 0, y: 15 } });
    window.__appStore.getState().setActiveSketch(result.sketch);
    sketch = await engine.setGridSnap(true);
    window.__appStore.getState().setActiveSketch(sketch);
    await engine.setGridStep(10);
  });
  await page.waitForTimeout(250);
  await page.click('button[title="Line"]');
  await page.waitForFunction(
    () => window.__appStore.getState().activeTool === 'line',
  );
  await clickSketch(0, 15);
  await page.waitForFunction(
    () => window.__appStore.getState().dynInput.active,
  );
  const uiEndX = -30;
  const nearHorizontalY = 15 + 30 * Math.tan((9.5 * Math.PI) / 180);
  const nearHorizontalPoint = await sketchToScreen(uiEndX, nearHorizontalY);
  const targetStack = await page.evaluate(
    ({ x, y }) =>
      document.elementsFromPoint(x, y).map((element) => ({
        tag: element.tagName,
        title: element.getAttribute('title'),
        className: typeof element.className === 'string' ? element.className : '',
      })),
    nearHorizontalPoint,
  );
  assert.equal(
    targetStack[0]?.tag,
    'CANVAS',
    `line endpoint should land on the viewport canvas; target stack=${JSON.stringify(targetStack)}`,
  );
  await page.mouse.move(nearHorizontalPoint.x, nearHorizontalPoint.y);
  await page.waitForTimeout(250);
  await clickSketch(uiEndX, nearHorizontalY);
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');

  const activeSketch = (await state()).activeSketch;
  const line = activeSketch.entities.find(
    (entity) =>
      entity.kind === 'line' &&
      Math.abs(entity.start.y - 15) < 1e-9 &&
      Math.abs(entity.end.y - 15) < 1e-9,
  );
  assert.ok(
    line,
    `near-horizontal cursor should commit an exactly horizontal line; entities=${JSON.stringify(activeSketch.entities)}`,
  );
  assert.ok(
    activeSketch.constraints.some(
      (constraint) => constraint.type === 'horizontal' && constraint.entity === line.id,
    ),
    'the committed line should receive a Horizontal constraint',
  );

  // Exercise the viewport acquisition and presentation path, not only the
  // engine DTO. A free endpoint near y=5 should show H plus a second transient
  // line for the temporary guide, then persist the point-pair relation.
  if ((await state()).activeTool !== 'line') {
    await page.click('button[title="Line"]');
  }
  const trackedBefore = activeSketch.constraints.filter(
    (constraint) => constraint.type === 'horizontal_points',
  ).length;
  await clickSketch(5, 25);
  await page.waitForFunction(() => window.__appStore.getState().dynInput.active);
  const trackedTarget = await sketchToScreen(20, 5.3);
  await page.mouse.move(trackedTarget.x, trackedTarget.y);
  await page.waitForFunction(() => {
    const chips = document.querySelector('[data-testid="inference-chips"]');
    return chips instanceof HTMLElement
      && chips.style.display === 'flex'
      && chips.textContent?.includes('H');
  });
  const transient = await page.evaluate(() => window.__nativeViewportTransient());
  assert.ok(
    transient.lines.length >= 2,
    'tracked line preview should include its temporary extension guide',
  );
  await page.mouse.click(trackedTarget.x, trackedTarget.y);
  await page.waitForFunction(
    (before) =>
      window.__appStore.getState().activeSketch.constraints.filter(
        (constraint) => constraint.type === 'horizontal_points',
      ).length > before,
    trackedBefore,
  );
  await page.keyboard.press('Escape');
  assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join('\n')}`);

  console.log(
    `  [ok] adaptive grid, locked-angle numeric snap, point tracking, and off-grid H inference (${initialStep} → ${zoomedStep} mm)`,
  );
} finally {
  await browser.close();
}
