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
  // engine DTO. A free endpoint near y=5 should show the unambiguous Y ALIGN
  // tracking label plus a second transient line for the temporary guide, then
  // persist the point-pair relation.
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
      && chips.textContent?.includes('Y ALIGN');
  });
  const transient = await page.evaluate(() => window.__nativeViewportTransient());
  assert.ok(
    transient.lines.length >= 2,
    'tracked line preview should include its temporary extension guide',
  );
  assert.ok(
    transient.lines.some((layer) => layer.pattern === 'dotted'),
    'point/line alignment tracking must be visually distinct dotted construction geometry',
  );
  assert.ok(
    transient.lines.some((layer) => layer.pattern === 'solid'),
    'the line being created must remain solid while only its alignment guide is dotted',
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

  // Exact curve acquisition outranks grid fallback. The vertical line starts
  // at x=21.5 and meets the diagonal at y=18.5, which is intentionally not a
  // grid coordinate. Commit must preserve both the axis and point-on-curve
  // relation instead of rounding the endpoint away from the diagonal.
  const intersectionSetup = await page.evaluate(async () => {
    const engine = window.__engine;
    await engine.setGridSnap(false);
    const diagonal = await engine.addLine({
      from: { x: 10, y: 30 },
      to_raw: { x: 40, y: 0 },
      ctrl_held: true,
    });
    await engine.addPoint({ position: { x: 21.5, y: 0 } });
    const sketch = await engine.setGridSnap(true);
    window.__appStore.getState().setActiveSketch(sketch);
    return {
      diagonal: diagonal.entity_id,
      beforeLines: sketch.entities.filter((entity) => entity.kind === 'line').length,
    };
  });
  await page.locator('button[title="Line"]').click();
  await clickSketch(21.5, 0);
  await page.waitForFunction(() => window.__appStore.getState().dynInput.active);
  const offGridIntersection = await sketchToScreen(21.48, 18.54);
  await page.mouse.move(offGridIntersection.x, offGridIntersection.y, { steps: 5 });
  await page.waitForTimeout(150);
  const intersectionPreview = await page.evaluate(
    () => window.__nativeViewportTransient().marker,
  );
  assert.equal(
    intersectionPreview?.kind,
    'curve',
    `curve intersection should outrank grid in preview; marker=${JSON.stringify(intersectionPreview)}`,
  );
  await page.mouse.click(offGridIntersection.x, offGridIntersection.y);
  await page.waitForFunction(
    (before) =>
      window.__appStore.getState().activeSketch.entities.filter(
        (entity) => entity.kind === 'line',
      ).length > before,
    intersectionSetup.beforeLines,
  );
  await page.keyboard.press('Escape');
  const curveIntersection = (await state()).activeSketch;
  const intersectionLine = curveIntersection.entities
    .filter((entity) => entity.kind === 'line')
    .find((entity) =>
      Math.abs(entity.start.x - 21.5) < 1e-7
      && Math.abs(entity.start.y) < 1e-7
      && Math.abs(entity.end.x - 21.5) < 1e-7
      && Math.abs(entity.end.y - 18.5) < 1e-7
    );
  assert.ok(
    intersectionLine,
    `vertical curve intersection should commit at the exact off-grid coordinate; lines=${JSON.stringify(
      curveIntersection.entities.filter((entity) => entity.kind === 'line'),
    )}`,
  );
  assert.ok(
    curveIntersection.constraints.some(
      (constraint) =>
        constraint.type === 'coincident'
        && constraint.a === intersectionLine.end_id
        && constraint.b === intersectionSetup.diagonal,
    ),
    'off-grid intersection endpoint should remain associated with the diagonal',
  );
  assert.ok(
    curveIntersection.constraints.some(
      (constraint) =>
        constraint.type === 'vertical' && constraint.entity === intersectionLine.id,
    ),
    'off-grid intersection should retain its vertical design intent',
  );

  // Reproduce the user flow exactly: acquire the visual crossing of two
  // unconnected carriers, travel 0.5 mm along one carrier, then turn straight
  // up. The picked screen coordinate is deliberately a little off center;
  // stable carrier ids must make the committed topology exact. A coarse grid
  // must neither move the crossing nor collapse the short vertical turn.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  const chainSetup = await page.evaluate(async () => {
    const engine = window.__engine;
    await engine.setGridSnap(false);
    const horizontal = await engine.addLine({
      from: { x: -35, y: -20 },
      to_raw: { x: -5, y: -20 },
      ctrl_held: true,
    });
    const diagonal = await engine.addLine({
      from: { x: -30, y: -30 },
      to_raw: { x: -10, y: -10 },
      ctrl_held: true,
    });
    await engine.setGridStep(10);
    const sketch = await engine.setGridSnap(true);
    window.__appStore.getState().setActiveSketch(sketch);
    return {
      horizontal: horizontal.entity_id,
      diagonal: diagonal.entity_id,
      beforeLines: sketch.entities.filter((entity) => entity.kind === 'line').length,
    };
  });
  await page.locator('button[title="Line"]').click();
  await clickSketch(-19.97, -20.04);
  await page.waitForFunction(() => window.__appStore.getState().dynInput.active);
  const crossingMarker = await page.evaluate(() => window.__nativeViewportTransient().marker);
  assert.equal(crossingMarker?.kind, 'point');
  assert.ok(
    Math.abs(crossingMarker.position[0] + 20) < 1e-9
      && Math.abs(crossingMarker.position[1] + 20) < 1e-9,
    `crossing marker must be dead-center on the analytic crossing; marker=${JSON.stringify(crossingMarker)}`,
  );

  const halfMillimeterDirection = await sketchToScreen(-23, -20.01);
  await page.mouse.move(halfMillimeterDirection.x, halfMillimeterDirection.y, { steps: 4 });
  await page.keyboard.type('0.5');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    (before) =>
      window.__appStore.getState().activeSketch.entities.filter(
        (entity) => entity.kind === 'line',
      ).length > before,
    chainSetup.beforeLines,
  );
  // The second Enter is intentional: a single visible length field commits
  // on the first Enter. Repeated confirmation must not immediately create a
  // reverse segment before the pointer begins the next leg of the chain.
  await page.waitForTimeout(250);
  const afterShort = (await state()).activeSketch;
  assert.equal(
    afterShort.entities.filter((entity) => entity.kind === 'line').length,
    chainSetup.beforeLines + 1,
    'repeated Enter must commit the 0.5 mm segment only once',
  );
  const short = afterShort.entities
    .filter((entity) => entity.kind === 'line')
    .find((entity) =>
      Math.abs(entity.start.x + 20) < 1e-9
      && Math.abs(entity.start.y + 20) < 1e-9
      && Math.abs(entity.end.x + 20.5) < 1e-9
      && Math.abs(entity.end.y + 20) < 1e-9
    );
  assert.ok(
    short,
    `typed 0.5 mm line must overlay its horizontal carrier exactly; lines=${JSON.stringify(
      afterShort.entities.filter((entity) => entity.kind === 'line'),
    )}`,
  );
  for (const carrier of [chainSetup.horizontal, chainSetup.diagonal]) {
    assert.ok(
      afterShort.constraints.some(
        (constraint) =>
          constraint.type === 'coincident'
          && constraint.a === short.start_id
          && constraint.b === carrier,
      ),
      `crossing point should retain an exact relation to carrier ${carrier}`,
    );
  }

  // Keep this target clear of the floating dimension entry widget while still
  // remaining inside the coarse 10 mm grid cell that used to collapse it.
  const verticalTarget = await sketchToScreen(-20.48, -15.3);
  await page.mouse.move(verticalTarget.x, verticalTarget.y, { steps: 4 });
  await page.waitForTimeout(500);
  const verticalPreview = await page.evaluate(() => ({
    marker: window.__nativeViewportTransient().marker,
    chips: document.querySelector('[data-testid="inference-chips"]')?.textContent ?? '',
    dynInput: window.__appStore.getState().dynInput,
  }));
  assert.ok(
    verticalPreview.chips.includes('V'),
    `vertical turn should expose a V inference; preview=${JSON.stringify(verticalPreview)}`,
  );
  assert.ok(
    Math.abs(verticalPreview.marker.position[0] + 20.5) < 1e-9,
    `vertical preview must stay on the 0.5 mm endpoint; preview=${JSON.stringify(verticalPreview)}`,
  );
  assert.ok(
    !verticalPreview.chips.includes('ALIGN'),
    `straight chained intent must not turn into an unrelated point-tracking triangle; chips=${verticalPreview.chips}`,
  );
  await page.mouse.click(verticalTarget.x, verticalTarget.y);
  await page.waitForFunction(
    (before) =>
      window.__appStore.getState().activeSketch.entities.filter(
        (entity) => entity.kind === 'line',
      ).length > before,
    chainSetup.beforeLines + 1,
  );
  const afterTurn = (await state()).activeSketch;
  const upright = afterTurn.entities
    .filter((entity) => entity.kind === 'line')
    .find((entity) =>
      Math.abs(entity.start.x + 20.5) < 1e-9
      && Math.abs(entity.start.y + 20) < 1e-9
      && Math.abs(entity.end.x + 20.5) < 1e-9
      && entity.end.y > -20 + 1e-6
    );
  assert.ok(
    upright,
    `the vertical turn must be exact and non-degenerate; lines=${JSON.stringify(
      afterTurn.entities.filter((entity) => entity.kind === 'line'),
    )}`,
  );
  assert.ok(
    afterTurn.constraints.some(
      (constraint) =>
        constraint.type === 'perpendicular'
        && ((constraint.a === short.id && constraint.b === upright.id)
          || (constraint.a === upright.id && constraint.b === short.id)),
    ),
    'the chained vertical turn should retain perpendicular design intent',
  );
  await page.keyboard.press('Escape');
  assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join('\n')}`);

  console.log(
    `  [ok] adaptive grid, exact crossings, 0.5 mm chain turns, point tracking, off-grid H inference, and curve-over-grid priority (${initialStep} → ${zoomedStep} mm)`,
  );
} finally {
  await browser.close();
}
