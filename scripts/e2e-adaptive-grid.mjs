/**
 * Adaptive sketch-grid regression:
 * - visible/snap spacing becomes finer and coarser with camera zoom;
 * - the browser engine accepts a one-micrometer grid;
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
    await engine.setGridStep(10);
    const nearHorizontalY = 15 + 30 * Math.tan((9.5 * Math.PI) / 180);
    const horizontal = await engine.previewSegment({
      from: { x: 0, y: 15 },
      to_raw: { x: 30, y: nearHorizontalY },
      ctrl_held: false,
    });
    return { micro, horizontal };
  });
  assert.ok(Math.abs(engineChecks.micro.snapped_to.x - 12.345) < 1e-9);
  assert.ok(Math.abs(engineChecks.micro.snapped_to.y - 8.766) < 1e-9);
  assert.deepEqual(engineChecks.horizontal.inferences, ['horizontal']);
  assert.deepEqual(engineChecks.horizontal.snapped_to, { x: 30, y: 15 });

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
  assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join('\n')}`);

  console.log(
    `  [ok] adaptive grid, micrometer floor, and off-grid H inference (${initialStep} → ${zoomedStep} mm)`,
  );
} finally {
  await browser.close();
}
