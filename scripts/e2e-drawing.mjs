/** Standards-aware drawing setup, projected views, annotations, and DXF export regression. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE = 'http://localhost:7199';
const UNDO_SHORTCUT = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const REDO_SHORTCUT = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  // Exercise the explicit macOS trackpad contract even when CI itself runs on
  // Windows or Linux.
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/136 Safari/537.36',
});
const page = await context.newPage();
await page.addInitScript(() => {
  window.__drawingExports = {};
  window.showSaveFilePicker = async (options) => ({
    kind: 'file',
    name: options.suggestedName,
    async createWritable() {
      return {
        async write(data) {
          const bytes = data instanceof Blob
            ? new Uint8Array(await data.arrayBuffer())
            : data instanceof ArrayBuffer
              ? new Uint8Array(data)
              : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
          window.__drawingExports[options.suggestedName] = new TextDecoder().decode(bytes);
        },
        async close() {},
        async abort() {},
      };
    },
  });
});
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.stack ?? String(error)));

async function clickRibbonMenuItem(panelName, groupId, itemId) {
  await page.getByRole('button', { name: panelName, exact: true }).click();
  const menu = page.locator('[data-ribbon-menu]').last();
  await menu.waitFor();
  if (groupId) await menu.locator(`[data-ribbon-menu-id="${groupId}"]`).hover();
  await menu.locator(`[data-ribbon-menu-id="${itemId}"]`).click();
}

async function dragDrawingAnnotation(testId, annotationId, fields, delta) {
  const before = await page.evaluate(({ annotationId, fields }) => {
    const annotation = window.__appStore.getState().drawingDocument.sheets
      .flatMap((sheet) => sheet.annotations)
      .find((candidate) => candidate.id === annotationId);
    if (!annotation) throw new Error(`Missing drawing annotation ${annotationId}`);
    return Object.fromEntries(fields.map((field) => [field, annotation[field]]));
  }, { annotationId, fields });
  const graphic = page.locator(
    `[data-testid="${testId}"][data-annotation-id="${annotationId}"]`,
  );
  await graphic.waitFor();
  const handle = graphic.locator('text').first();
  await handle.scrollIntoViewIfNeeded();
  const box = await handle.boundingBox() ?? await graphic.boundingBox();
  assert.ok(box, `${testId} exposes a draggable painted handle`);
  const startX = box.x + box.width * 0.5;
  const startY = box.y + box.height * 0.5;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  const pointerOwner = await page.evaluate(({ x, y }) => {
    const hit = document.elementFromPoint(x, y);
    const annotation = hit?.closest('[data-annotation-id]');
    return {
      tag: hit?.tagName ?? null,
      testId: annotation?.getAttribute('data-testid') ?? null,
      annotationId: annotation?.getAttribute('data-annotation-id') ?? null,
    };
  }, { x: startX, y: startY });
  assert.equal(
    await graphic.getAttribute('data-annotation-dragging'),
    'true',
    `${testId} text must acquire its own drag (hit ${JSON.stringify(pointerOwner)})`,
  );
  await page.mouse.move(startX + delta[0], startY + delta[1], { steps: 5 });
  await page.mouse.up();
  await page.waitForFunction(({ annotationId, fields, before }) => {
    const annotation = window.__appStore.getState().drawingDocument.sheets
      .flatMap((sheet) => sheet.annotations)
      .find((candidate) => candidate.id === annotationId);
    return annotation && fields.some(
      (field) => JSON.stringify(annotation[field]) !== JSON.stringify(before[field]),
    );
  }, { annotationId, fields, before });
}

async function dragDrawingExtensionGrip(
  graphicTestId,
  annotationId,
  gripTestId,
  referenceGripIndex = 0,
  draggedGripIndex = 1,
) {
  const before = await page.evaluate((id) => window.__appStore.getState().drawingDocument.sheets
    .flatMap((sheet) => sheet.annotations)
    .find((annotation) => annotation.id === id)?.extension, annotationId);
  assert.equal(typeof before, 'number', `${graphicTestId} stores an editable extension`);
  const graphic = page.locator(`[data-testid="${graphicTestId}"][data-annotation-id="${annotationId}"]`);
  await graphic.dispatchEvent('pointerdown', { button: 0, pointerId: 39, pointerType: 'mouse', bubbles: true });
  await page.waitForFunction((id) => window.__appStore.getState().selectedDrawingAnnotationId === id, annotationId);
  const grips = graphic.getByTestId(gripTestId);
  await grips.nth(draggedGripIndex).waitFor({ state: 'attached' });
  const points = await grips.evaluateAll((elements) => elements.map((element) => {
    const circle = element;
    const matrix = circle.getScreenCTM();
    if (!matrix) return null;
    const point = new DOMPoint(Number(circle.getAttribute('cx')), Number(circle.getAttribute('cy'))).matrixTransform(matrix);
    return { x: point.x, y: point.y };
  }));
  const reference = points[referenceGripIndex];
  const target = points[draggedGripIndex];
  assert.ok(reference && target, `${gripTestId} endpoints map to screen space`);
  const vector = [target.x - reference.x, target.y - reference.y];
  const length = Math.hypot(...vector);
  assert.ok(length > 1, `${gripTestId} exposes distinct extension endpoints`);
  await page.mouse.move(target.x, target.y);
  await page.mouse.down();
  await page.mouse.move(
    target.x + vector[0] / length * 30,
    target.y + vector[1] / length * 30,
    { steps: 5 },
  );
  await page.mouse.up();
  await page.waitForFunction(({ id, before }) => {
    const annotation = window.__appStore.getState().drawingDocument.sheets
      .flatMap((sheet) => sheet.annotations)
      .find((candidate) => candidate.id === id);
    return annotation && typeof annotation.extension === 'number' && annotation.extension > before + 1;
  }, { id: annotationId, before });
}

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__appStore.getState().document !== null);

  // A box supplies unambiguous angle anchors; two separate cylinders supply
  // real semantic circular centers for hole-center dimensions, center marks,
  // centerlines, and diameter/radius/hole callouts.
  await page.evaluate(async () => {
    const engine = window.__engine;
    const store = window.__appStore.getState();
    store.applySolidUpdate(await engine.newProject());
    await engine.beginSketch({ type: 'origin_plane', plane: 'xy' });
    await engine.setGridSnap(false);
    await engine.addRectangle({
      mode: 'two_point',
      p1: { x: -16, y: -12 },
      p2: { x: 16, y: 12 },
      ctrl_held: true,
    });
    let ended = await engine.endSketch();
    store.setDocument(ended.document);
    store.setFinishedSketches(await engine.finishedSketches());
    let update = await engine.extrude({
      sketch_name: 'Sketch1',
      profile_indices: [0],
      operation: 'new_body',
      extent: { type: 'distance', distance: 16 },
      taper_angle_deg: 0,
      flip: false,
      target_body_ids: [],
    });
    store.applySolidUpdate(update);
    const box = update.scene.bodies[0];
    const verticalEdge = box.edges.find((edge) => {
      const start = edge.points[0];
      const end = edge.points[edge.points.length - 1];
      return edge.refinable
        && Math.abs(start.x - end.x) < 1e-5
        && Math.abs(start.y - end.y) < 1e-5
        && Math.abs(start.z - end.z) > 15;
    });
    if (!verticalEdge) throw new Error('Drawing fixture did not expose a vertical box edge.');
    update = await engine.solidChamfer({
      body_id: box.id,
      edge_ids: [verticalEdge.id],
      distance: 3,
      tangent_chain: false,
    });
    store.applySolidUpdate(update);
    await engine.beginSketch({ type: 'origin_plane', plane: 'xy' });
    await engine.setGridSnap(false);
    await engine.addCircle({
      mode: 'center_diameter',
      p1: { x: 34, y: 0 },
      p2: { x: 42, y: 0 },
      ctrl_held: true,
    });
    ended = await engine.endSketch();
    store.setDocument(ended.document);
    store.setFinishedSketches(await engine.finishedSketches());
    store.applySolidUpdate(await engine.extrude({
      sketch_name: 'Sketch2',
      profile_indices: [0],
      operation: 'new_body',
      extent: { type: 'distance', distance: 20 },
      taper_angle_deg: 0,
      flip: false,
      target_body_ids: [],
    }));
    await engine.beginSketch({ type: 'origin_plane', plane: 'xy' });
    await engine.setGridSnap(false);
    await engine.addCircle({
      mode: 'center_diameter',
      p1: { x: 50, y: 0 },
      p2: { x: 58, y: 0 },
      ctrl_held: true,
    });
    ended = await engine.endSketch();
    store.setDocument(ended.document);
    store.setFinishedSketches(await engine.finishedSketches());
    store.applySolidUpdate(await engine.extrude({
      sketch_name: 'Sketch3',
      profile_indices: [0],
      operation: 'new_body',
      extent: { type: 'distance', distance: 20 },
      taper_angle_deg: 0,
      flip: false,
      target_body_ids: [],
    }));
    // Keep one nested, unconsumed sketch region as a deterministic fixture for
    // the dedicated 1:1 manufacturing-profile DXF workflow.
    await engine.beginSketch({ type: 'origin_plane', plane: 'xy' });
    await engine.setGridSnap(false);
    await engine.addRectangle({
      mode: 'two_point',
      p1: { x: -10, y: -8 },
      p2: { x: 10, y: 8 },
      ctrl_held: true,
    });
    await engine.addRectangle({
      mode: 'two_point',
      p1: { x: -3, y: -2 },
      p2: { x: 3, y: 2 },
      ctrl_held: true,
    });
    ended = await engine.endSketch();
    store.setDocument(ended.document);
    store.setFinishedSketches(await engine.finishedSketches());
    store.setMode('solid');
  });

  await page.getByRole('button', { name: 'Drawing', exact: true }).click();
  await page.getByTestId('drawing-sheet-setup').waitFor();
  assert.equal(
    await page.evaluate(() => window.__appStore.getState().drawingDocument.sheets.length),
    0,
    'entering Drawing does not create or populate a sheet',
  );

  await page.getByLabel('Paper size').selectOption('a3');
  await page.getByRole('button', { name: 'Create blank sheet' }).click();
  await page.waitForFunction(() => {
    const state = window.__appStore.getState();
    return state.drawingDocument.sheets.length === 1 || state.constraintDialog !== null;
  });
  const sheetCreationState = await page.evaluate(() => {
    const state = window.__appStore.getState();
    return {
      error: state.constraintDialog,
      setupOpen: state.drawingSheetSetupOpen,
      activeSheetId: state.drawingDocument.active_sheet_id,
      sheetIds: state.drawingDocument.sheets.map((sheet) => sheet.id),
      activeTab: state.activeTab,
    };
  });
  assert.equal(sheetCreationState.error, null, `blank drawing sheet creation failed: ${JSON.stringify(sheetCreationState)}`);
  assert.equal(sheetCreationState.setupOpen, false, `sheet setup did not close: ${JSON.stringify(sheetCreationState)}`);
  assert.equal(sheetCreationState.activeSheetId, sheetCreationState.sheetIds[0]);
  await page.waitForTimeout(100);
  assert.deepEqual(pageErrors, [], `drawing workspace render failed: ${pageErrors.join('\n')}`);
  await page.getByTestId('drawing-workspace').waitFor();
  await page.waitForFunction(() => window.__appStore.getState().drawingDocument.sheets.length === 1);
  let drawing = await page.evaluate(() => window.__appStore.getState().drawingDocument);
  assert.equal(drawing.sheets[0].format, 'a3');
  assert.equal(drawing.sheets[0].standard, 'iso');
  assert.equal(drawing.sheets[0].projection_method, 'first_angle');
  assert.equal(drawing.sheets[0].views.length, 0, 'new sheets begin empty');

  await page.setViewportSize({ width: 1117, height: 900 });
  const compactDrawingRibbon = await page.getByTestId('ribbon-command-scroll').evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  assert.ok(
    compactDrawingRibbon.scrollWidth <= compactDrawingRibbon.clientWidth + 1,
    `grouped Drawing ribbon must not require horizontal scrolling: ${JSON.stringify(compactDrawingRibbon)}`,
  );
  assert.deepEqual(
    await page.locator('[data-ribbon-button]').evaluateAll((buttons) => buttons.map((button) => button.getAttribute('data-ribbon-button'))),
    [
      'newSheet', 'autoLayout', 'frontView', 'isometricView', 'drawingSectionView',
      'drawingDimension', 'drawingCenterLine', 'drawingHoleNote', 'drawingNote',
      'drawingDatum', 'drawingGdt', 'exportDrawingDxf', 'printDrawing',
    ],
    'the Drawing ribbon exposes common tasks and moves specialized variants into flyouts',
  );
  const dimensionButtonAlignment = await page.locator('[data-ribbon-button="drawingDimension"]').evaluate((button) => {
    const panel = button.parentElement?.parentElement;
    if (!panel) return null;
    const buttonBounds = button.getBoundingClientRect();
    const panelBounds = panel.getBoundingClientRect();
    return {
      buttonCenter: buttonBounds.left + buttonBounds.width / 2,
      panelCenter: panelBounds.left + panelBounds.width / 2,
    };
  });
  assert.ok(dimensionButtonAlignment, 'Dimension ribbon button belongs to a visible panel');
  assert.ok(
    Math.abs(dimensionButtonAlignment.buttonCenter - dimensionButtonAlignment.panelCenter) <= 1,
    'the primary Dimension button is centered above its grouped menu label',
  );
  await page.getByRole('button', { name: 'DIMENSIONS', exact: true }).click();
  const dimensionsMenu = page.locator('[data-ribbon-menu]').last();
  await dimensionsMenu.locator('[data-ribbon-menu-id="drawingFeatureDimensions"]').hover();
  assert.equal(
    await dimensionsMenu.locator('[data-ribbon-menu-id="drawingDiameterMenu"]').isVisible(),
    true,
    'feature and angular dimension overrides remain discoverable in the grouped flyout',
  );
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1600, height: 1000 });

  const drawingScroll = page.locator('[data-drawing-zoom]');
  await drawingScroll.hover();
  await drawingScroll.dispatchEvent('wheel', {
    deltaY: -3,
    deltaMode: 1,
    clientX: 800,
    clientY: 500,
  });
  await page.waitForFunction(() => Number(document.querySelector('[data-drawing-zoom]')?.getAttribute('data-drawing-zoom')) > 1);
  const wheelZoom = Number(await drawingScroll.getAttribute('data-drawing-zoom'));
  await drawingScroll.dispatchEvent('wheel', {
    deltaY: -20,
    deltaMode: 0,
    ctrlKey: true,
    clientX: 800,
    clientY: 500,
  });
  await page.waitForFunction(
    (previous) => Number(document.querySelector('[data-drawing-zoom]')?.getAttribute('data-drawing-zoom')) > previous,
    wheelZoom,
  );
  assert.ok(
    Number(await drawingScroll.getAttribute('data-drawing-zoom')) > wheelZoom,
    'trackpad-style pinch and physical wheel input both zoom the drawing sheet',
  );
  const testedZoom = Number(await drawingScroll.getAttribute('data-drawing-zoom'));
  await drawingScroll.dispatchEvent('wheel', {
    deltaY: Math.log(testedZoom) / 0.007,
    deltaMode: 0,
    ctrlKey: true,
    clientX: 800,
    clientY: 500,
  });
  await page.waitForFunction(
    () => Math.abs(Number(document.querySelector('[data-drawing-zoom]')?.getAttribute('data-drawing-zoom')) - 1) < 0.01,
  );

  // Pixel-mode two-finger scrolling pans the paper without changing zoom.
  // A physical middle-button drag follows the same grab-the-sheet contract.
  await page.waitForTimeout(400);
  await drawingScroll.dispatchEvent('wheel', {
    deltaY: -60,
    deltaMode: 0,
    ctrlKey: true,
    clientX: 800,
    clientY: 500,
  });
  const navigationZoom = Number(await drawingScroll.getAttribute('data-drawing-zoom'));
  assert.ok(navigationZoom > 1.2, 'navigation fixture has enough overflow to pan');
  await drawingScroll.evaluate((element) => {
    element.scrollLeft = 80;
    element.scrollTop = 80;
  });
  await page.waitForTimeout(400);
  const beforeTrackpadPan = await drawingScroll.evaluate((element) => ({
    left: element.scrollLeft,
    top: element.scrollTop,
  }));
  await drawingScroll.dispatchEvent('wheel', {
    deltaX: 0,
    deltaY: 120,
    deltaMode: 0,
    clientX: 800,
    clientY: 500,
  });
  const afterVerticalTrackpadPan = await drawingScroll.evaluate((element) => ({
    left: element.scrollLeft,
    top: element.scrollTop,
  }));
  assert.ok(
    afterVerticalTrackpadPan.top > beforeTrackpadPan.top + 100,
    'vertical two-finger movement pans instead of zooming on macOS',
  );
  assert.equal(
    Number(await drawingScroll.getAttribute('data-drawing-zoom')),
    navigationZoom,
    'vertical two-finger movement never changes drawing zoom',
  );
  await drawingScroll.dispatchEvent('wheel', {
    deltaX: 32.5,
    deltaY: 18.5,
    deltaMode: 0,
    clientX: 800,
    clientY: 500,
  });
  const afterTrackpadPan = await drawingScroll.evaluate((element) => ({
    left: element.scrollLeft,
    top: element.scrollTop,
  }));
  assert.ok(
    afterTrackpadPan.left > beforeTrackpadPan.left + 20
      && afterTrackpadPan.top > afterVerticalTrackpadPan.top + 10,
    'two-finger trackpad scrolling pans the drawing sheet',
  );
  assert.equal(
    Number(await drawingScroll.getAttribute('data-drawing-zoom')),
    navigationZoom,
    'two-finger pan never changes drawing zoom',
  );

  const drawingScrollBox = await drawingScroll.boundingBox();
  assert.ok(drawingScrollBox);
  const beforeMiddlePan = afterTrackpadPan;
  await page.mouse.move(
    drawingScrollBox.x + drawingScrollBox.width * 0.5,
    drawingScrollBox.y + drawingScrollBox.height * 0.5,
  );
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(
    drawingScrollBox.x + drawingScrollBox.width * 0.5 - 45,
    drawingScrollBox.y + drawingScrollBox.height * 0.5 - 30,
    { steps: 4 },
  );
  await page.mouse.up({ button: 'middle' });
  const afterMiddlePan = await drawingScroll.evaluate((element) => ({
    left: element.scrollLeft,
    top: element.scrollTop,
  }));
  assert.ok(
    afterMiddlePan.left > beforeMiddlePan.left + 30
      && afterMiddlePan.top > beforeMiddlePan.top + 20,
    'middle-button drag pans the drawing sheet',
  );

  await drawingScroll.dispatchEvent('wheel', {
    deltaY: Math.log(navigationZoom) / 0.007,
    deltaMode: 0,
    ctrlKey: true,
    clientX: 800,
    clientY: 500,
  });
  await page.waitForFunction(
    () => Math.abs(Number(document.querySelector('[data-drawing-zoom]')?.getAttribute('data-drawing-zoom')) - 1) < 0.01,
  );
  await drawingScroll.evaluate((element) => {
    element.scrollLeft = 0;
    element.scrollTop = 0;
  });

  const solidHistoryBeforeAutoLayout = await page.evaluate(() => ({
    featureIds: window.__appStore.getState().document.features.map((feature) => feature.id),
    rollbackIndex: window.__appStore.getState().document.rollback_index,
  }));
  await page.getByRole('button', { name: 'Auto Layout', exact: true }).click();
  await page.waitForFunction(() => window.__appStore.getState().drawingDocument.sheets[0]?.views.length === 4);
  drawing = await page.evaluate(() => window.__appStore.getState().drawingDocument);
  assert.deepEqual(drawing.sheets[0].views.map((view) => view.kind), ['front', 'top', 'right', 'isometric']);
  const front = drawing.sheets[0].views.find((view) => view.kind === 'front');
  const top = drawing.sheets[0].views.find((view) => view.kind === 'top');
  const right = drawing.sheets[0].views.find((view) => view.kind === 'right');
  assert.equal(top.parent_view_id, front.id);
  assert.equal(top.alignment, 'vertical');
  assert.equal(top.position[0], front.position[0]);
  assert.ok(top.position[1] > front.position[1], 'first-angle top view is below front');
  assert.equal(right.parent_view_id, front.id);
  assert.equal(right.alignment, 'horizontal');
  assert.ok(right.position[0] < front.position[0], 'first-angle right view is left of front');

  const autoLayoutIdentity = drawing.sheets[0].views.map((view) => ({
    id: view.id,
    kind: view.kind,
  }));
  await page.evaluate((frontId) => {
    const store = window.__appStore.getState();
    store.setSelectedDrawingViewId(frontId);
    store.setDrawingTool('dimension');
  }, front.id);
  await page.keyboard.press(UNDO_SHORTCUT);
  await page.waitForFunction(
    () => window.__appStore.getState().drawingDocument.sheets[0]?.views.length === 0,
  );
  const afterAutoLayoutUndo = await page.evaluate(() => {
    const state = window.__appStore.getState();
    return {
      sheetCount: state.drawingDocument.sheets.length,
      nextViewId: state.drawingDocument.next_view_id,
      selectedViewId: state.selectedDrawingViewId,
      drawingTool: state.drawingTool,
      solidHistory: {
        featureIds: state.document.features.map((feature) => feature.id),
        rollbackIndex: state.document.rollback_index,
      },
    };
  });
  assert.equal(afterAutoLayoutUndo.sheetCount, 1, 'Undo keeps the sheet Auto Layout operated on');
  assert.equal(afterAutoLayoutUndo.nextViewId, 1, 'Undo restores the complete pre-layout drawing snapshot');
  assert.equal(afterAutoLayoutUndo.selectedViewId, null, 'Undo clears stale drawing selection');
  assert.equal(afterAutoLayoutUndo.drawingTool, null, 'Undo cancels transient drawing tools');
  assert.deepEqual(
    afterAutoLayoutUndo.solidHistory,
    solidHistoryBeforeAutoLayout,
    'Drawing Undo must never roll back solid-model history',
  );

  await page.keyboard.press(REDO_SHORTCUT);
  await page.waitForFunction(
    () => window.__appStore.getState().drawingDocument.sheets[0]?.views.length === 4,
  );
  drawing = await page.evaluate(() => window.__appStore.getState().drawingDocument);
  assert.deepEqual(
    drawing.sheets[0].views.map((view) => ({ id: view.id, kind: view.kind })),
    autoLayoutIdentity,
    'one Redo restores the entire aligned Auto Layout group with stable IDs',
  );
  assert.deepEqual(
    await page.evaluate(() => ({
      featureIds: window.__appStore.getState().document.features.map((feature) => feature.id),
      rollbackIndex: window.__appStore.getState().document.rollback_index,
    })),
    solidHistoryBeforeAutoLayout,
    'Drawing Redo also leaves solid-model history untouched',
  );

  const boxBodyId = await page.evaluate(() => window.__appStore.getState().solidScene.bodies[0].id);
  await page.getByRole('button', { name: 'Dimension', exact: true }).click();
  const frontAnchors = page.locator(
    `[data-drawing-view-id="${front.id}"] [data-testid="drawing-annotation-anchor"][data-body-id="${boxBodyId}"]`,
  );
  await frontAnchors.first().waitFor();
  const frontAnchorXs = await frontAnchors.evaluateAll((elements) =>
    elements.map((element, index) => ({ index, x: Number(element.getAttribute('cx')) })),
  );
  const leftFrontAnchor = frontAnchorXs.reduce((best, candidate) => candidate.x < best.x ? candidate : best);
  const rightFrontAnchor = frontAnchorXs.reduce((best, candidate) => candidate.x > best.x ? candidate : best);
  await frontAnchors.nth(leftFrontAnchor.index).click({ force: true });
  await frontAnchors.nth(rightFrontAnchor.index).click({ force: true });
  const frontDimension = page.getByTestId('drawing-linear-dimension').first();
  await frontDimension.waitFor();
  assert.match(
    await frontDimension.textContent(),
    /32\.00 mm/,
    'aligned front-view dimensions use projected drafting distance, not a 3D depth diagonal',
  );

  const isometricViewId = drawing.sheets[0].views.find((view) => view.kind === 'isometric').id;
  await page.getByRole('button', { name: 'Dimension', exact: true }).click();
  const anchors = page.locator(`[data-drawing-view-id="${isometricViewId}"] [data-testid="drawing-annotation-anchor"]`);
  await anchors.first().waitFor();
  assert.ok(await anchors.count() >= 3, 'projected topology exposes semantic annotation anchors');
  await anchors.nth(0).click({ force: true });
  await anchors.nth(1).click({ force: true });
  await page.getByTestId('drawing-linear-dimension').nth(1).waitFor();

  const topViewId = top.id;

  // One context-aware straight-edge command covers edge length, separation
  // between parallel edges, and the included angle between nonparallel edges.
  await page.getByRole('button', { name: 'Dimension', exact: true }).click();
  let smartLineTargets = page.locator(
    `[data-drawing-view-id="${topViewId}"] [data-drawing-line-dimension-target="true"]`,
  );
  await smartLineTargets.first().waitFor({ state: 'attached' });
  const smartLineFixture = await smartLineTargets.evaluateAll((targets) => {
    const edges = targets.map((target, index) => {
      const start = [Number(target.getAttribute('data-start-x')), Number(target.getAttribute('data-start-y'))];
      const end = [Number(target.getAttribute('data-end-x')), Number(target.getAttribute('data-end-y'))];
      const vector = [end[0] - start[0], end[1] - start[1]];
      const length = Math.hypot(...vector);
      return { index, start, end, length, direction: [vector[0] / length, vector[1] / length] };
    }).filter((edge) => edge.length > 4);
    const parallelPairs = [];
    for (let firstIndex = 0; firstIndex < edges.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < edges.length; secondIndex += 1) {
        const first = edges[firstIndex];
        const parallel = edges[secondIndex];
        if (Math.abs(first.direction[0] * parallel.direction[1] - first.direction[1] * parallel.direction[0]) >= 0.01) continue;
        const firstStations = [first.start, first.end].map((point) => point[0] * first.direction[0] + point[1] * first.direction[1]);
        const secondStations = [parallel.start, parallel.end].map((point) => point[0] * first.direction[0] + point[1] * first.direction[1]);
        const overlap = Math.min(Math.max(...firstStations), Math.max(...secondStations))
          - Math.max(Math.min(...firstStations), Math.min(...secondStations));
        const separation = Math.abs(
          (parallel.start[0] - first.start[0]) * -first.direction[1]
            + (parallel.start[1] - first.start[1]) * first.direction[0],
        );
        if (overlap > 2 && separation > 0.1) parallelPairs.push({ first, parallel, separation });
      }
    }
    parallelPairs.sort((left, right) => left.separation - right.separation);
    for (const { first, parallel } of parallelPairs) {
      const angled = edges.find((edge) => edge.index !== first.index
        && Math.abs(first.direction[0] * edge.direction[1] - first.direction[1] * edge.direction[0]) > 0.2);
      if (parallel && angled) return { first, parallel, angled };
    }
    return null;
  });
  assert.ok(smartLineFixture, 'the projected view exposes parallel and angled exact straight-edge targets');
  const smartSheet = page.getByTestId('drawing-sheet');
  const drawingPointToScreen = async (point) => smartSheet.evaluate((sheet, paper) => {
    const matrix = sheet.getScreenCTM();
    if (!matrix) return null;
    const screen = new DOMPoint(paper[0], paper[1]).matrixTransform(matrix);
    return { x: screen.x, y: screen.y };
  }, point);
  const firstLineMidpoint = [
    (smartLineFixture.first.start[0] + smartLineFixture.first.end[0]) / 2,
    (smartLineFixture.first.start[1] + smartLineFixture.first.end[1]) / 2,
  ];
  const firstLineMidpointScreen = await drawingPointToScreen(firstLineMidpoint);
  assert.ok(firstLineMidpointScreen, 'first exact line maps to screen space');
  await page.mouse.click(firstLineMidpointScreen.x, firstLineMidpointScreen.y);
  const linePreview = page.getByTestId('drawing-line-dimension-preview');
  await linePreview.waitFor();
  const linePreviewPath = await linePreview.locator('path').first().getAttribute('d');
  const previewSegments = [...(linePreviewPath ?? '').matchAll(/M(-?[\d.]+) (-?[\d.]+)L(-?[\d.]+) (-?[\d.]+)/g)];
  const dimensionSegment = previewSegments.at(-1)?.slice(1).map(Number);
  assert.ok(dimensionSegment, 'edge-length preview renders a dimension span');
  const sourceVector = [
    smartLineFixture.first.end[0] - smartLineFixture.first.start[0],
    smartLineFixture.first.end[1] - smartLineFixture.first.start[1],
  ];
  const dimensionVector = [dimensionSegment[2] - dimensionSegment[0], dimensionSegment[3] - dimensionSegment[1]];
  assert.ok(
    Math.abs(sourceVector[0] * dimensionVector[1] - sourceVector[1] * dimensionVector[0]) < 1e-4,
    'edge-length placement is constrained normal to the edge and cannot skew the dimension line',
  );
  const smartSheetBox = await smartSheet.boundingBox();
  assert.ok(smartSheetBox);
  await page.mouse.move(smartSheetBox.x + smartSheetBox.width * 0.76, smartSheetBox.y + smartSheetBox.height * 0.76);
  await page.mouse.click(smartSheetBox.x + smartSheetBox.width * 0.76, smartSheetBox.y + smartSheetBox.height * 0.76);
  await page.waitForFunction(() => window.__appStore.getState().drawingDocument.sheets[0].annotations
    .some((annotation) => annotation.kind === 'line_dimension' && annotation.mode === 'length'));
  const smartLength = await page.evaluate(() => window.__appStore.getState().drawingDocument.sheets[0].annotations
    .find((annotation) => annotation.kind === 'line_dimension' && annotation.mode === 'length'));
  assert.equal(smartLength.second, null, 'edge length stores one exact OCCT edge');
  assert.ok(smartLength.first.edge_key.length > 0, 'edge length persists the stable OCCT edge key');

  await page.getByRole('button', { name: 'Dimension', exact: true }).click();
  smartLineTargets = page.locator(`[data-drawing-view-id="${topViewId}"] [data-drawing-line-dimension-target="true"]`);
  await smartLineTargets.nth(smartLineFixture.first.index).click({ force: true });
  const parallelMidpoint = [
    (smartLineFixture.parallel.start[0] + smartLineFixture.parallel.end[0]) / 2,
    (smartLineFixture.parallel.start[1] + smartLineFixture.parallel.end[1]) / 2,
  ];
  const parallelMidpointScreen = await smartSheet.evaluate((sheet, paper) => {
    const matrix = sheet.getScreenCTM();
    if (!matrix) return null;
    const screen = new DOMPoint(paper[0], paper[1]).matrixTransform(matrix);
    return { x: screen.x, y: screen.y };
  }, parallelMidpoint);
  assert.ok(parallelMidpointScreen, 'parallel feature midpoint maps to screen space');
  await page.mouse.move(parallelMidpointScreen.x, parallelMidpointScreen.y);
  await page.waitForFunction(({ viewId, index }) => {
    const targets = document.querySelectorAll(`[data-drawing-view-id="${viewId}"] [data-drawing-line-dimension-target="true"]`);
    return targets[index]?.querySelector('line')?.getAttribute('stroke') === '#d97706';
  }, { viewId: topViewId, index: smartLineFixture.parallel.index });
  const previewTextBox = await linePreview.locator('text').last().boundingBox();
  assert.ok(previewTextBox, 'smart dimension preview exposes a readable value');
  assert.ok(
    parallelMidpointScreen.x < previewTextBox.x - 2
      || parallelMidpointScreen.x > previewTextBox.x + previewTextBox.width + 2
      || parallelMidpointScreen.y < previewTextBox.y - 2
      || parallelMidpointScreen.y > previewTextBox.y + previewTextBox.height + 2,
    'first-edge preview stays clear of the pointer while a second feature is being selected',
  );
  await page.mouse.click(parallelMidpointScreen.x, parallelMidpointScreen.y);
  await linePreview.waitFor();
  assert.doesNotMatch(await linePreview.textContent(), /°/, 'a second parallel edge infers perpendicular separation');
  const firstStations = [smartLineFixture.first.start, smartLineFixture.first.end]
    .map((point) => point[0] * smartLineFixture.first.direction[0] + point[1] * smartLineFixture.first.direction[1]);
  const parallelStations = [smartLineFixture.parallel.start, smartLineFixture.parallel.end]
    .map((point) => point[0] * smartLineFixture.first.direction[0] + point[1] * smartLineFixture.first.direction[1]);
  const placementStation = Math.max(...firstStations, ...parallelStations) + 20;
  const firstMidpoint = [
    (smartLineFixture.first.start[0] + smartLineFixture.first.end[0]) / 2,
    (smartLineFixture.first.start[1] + smartLineFixture.first.end[1]) / 2,
  ];
  const firstMidpointStation = firstMidpoint[0] * smartLineFixture.first.direction[0]
    + firstMidpoint[1] * smartLineFixture.first.direction[1];
  const distancePlacement = [
    firstMidpoint[0] + smartLineFixture.first.direction[0] * (placementStation - firstMidpointStation),
    firstMidpoint[1] + smartLineFixture.first.direction[1] * (placementStation - firstMidpointStation),
  ];
  const distancePlacementScreen = await smartSheet.evaluate((sheet, paper) => {
    const matrix = sheet.getScreenCTM();
    if (!matrix) return null;
    const screen = new DOMPoint(paper[0], paper[1]).matrixTransform(matrix);
    return { x: screen.x, y: screen.y };
  }, distancePlacement);
  assert.ok(distancePlacementScreen, 'parallel-edge dimension placement maps to screen space');
  await page.mouse.click(distancePlacementScreen.x, distancePlacementScreen.y);
  await page.waitForFunction(() => window.__appStore.getState().drawingDocument.sheets[0].annotations
    .some((annotation) => annotation.kind === 'line_dimension' && annotation.mode === 'distance'));
  const smartDistance = await page.evaluate(() => window.__appStore.getState().drawingDocument.sheets[0].annotations
    .find((annotation) => annotation.kind === 'line_dimension' && annotation.mode === 'distance'));
  const smartDistanceGraphic = page.locator(`[data-testid="drawing-line-dimension"][data-annotation-id="${smartDistance.id}"]`);
  const distancePath = await smartDistanceGraphic.locator('path').first().getAttribute('d');
  const distanceSegments = [...(distancePath ?? '').matchAll(/M(-?[\d.]+) (-?[\d.]+)L(-?[\d.]+) (-?[\d.]+)/g)]
    .map((match) => match.slice(1).map(Number));
  assert.equal(distanceSegments.length, 3, 'parallel-edge dimension renders two witness lines and one dimension line');
  assert.ok(
    distanceSegments.slice(0, 2).every((segment) => Math.hypot(segment[2] - segment[0], segment[3] - segment[1]) > 1),
    `both witness lines connect the dimension back to the selected finite features: ${JSON.stringify(distanceSegments)}`,
  );
  const isoDistanceLayout = smartDistanceGraphic.getByTestId('drawing-linear-dimension-layout');
  assert.equal(
    await isoDistanceLayout.getAttribute('data-dimension-line'),
    'continuous',
    'ISO values sit above a continuous dimension line',
  );
  assert.equal(
    await smartDistanceGraphic.getByTestId('drawing-dimension-text-mask').count(),
    0,
    'ISO linear dimensions do not erase the dimension line behind the value',
  );
  assert.equal(
    await smartDistanceGraphic.getByTestId('drawing-dimension-arrow').count(),
    2,
    'a narrow ISO dimension always retains both arrowheads',
  );
  if (process.env.NBCAD_DRAWING_VISUAL_CAPTURE) {
    await page.screenshot({ path: process.env.NBCAD_DRAWING_VISUAL_CAPTURE, fullPage: true });
  }

  await page.getByRole('button', { name: 'Dimension', exact: true }).click();
  smartLineTargets = page.locator(`[data-drawing-view-id="${topViewId}"] [data-drawing-line-dimension-target="true"]`);
  await smartLineTargets.nth(smartLineFixture.first.index).click({ force: true });
  await smartLineTargets.nth(smartLineFixture.angled.index).click({ force: true });
  await linePreview.waitFor();
  assert.match(await linePreview.textContent(), /°/, 'a second nonparallel edge infers an angular dimension');
  await page.mouse.click(smartSheetBox.x + smartSheetBox.width * 0.68, smartSheetBox.y + smartSheetBox.height * 0.68);
  await page.waitForFunction(() => window.__appStore.getState().drawingDocument.sheets[0].annotations
    .some((annotation) => annotation.kind === 'line_dimension' && annotation.mode === 'angle'));

  await page.getByRole('button', { name: 'Dimension', exact: true }).click();
  let holeCenters = page.locator(`[data-drawing-view-id="${topViewId}"] [data-testid="drawing-hole-center-target"]`);
  await holeCenters.first().waitFor();
  assert.equal(await holeCenters.count(), 2, 'concentric rims are deduplicated into one selectable center per circular feature');
  const recognizedCenterPaper = await holeCenters.evaluateAll((elements) => elements.map((element) => {
    const marker = element.querySelector('circle');
    return [Number(marker?.getAttribute('cx')), Number(marker?.getAttribute('cy'))];
  }));
  const expectedCenterDistance = Math.hypot(
    recognizedCenterPaper[1][0] - recognizedCenterPaper[0][0],
    recognizedCenterPaper[1][1] - recognizedCenterPaper[0][1],
  ) / top.scale;
  await holeCenters.nth(0).click({ force: true });
  await holeCenters.nth(1).click({ force: true });
  await page.waitForFunction(() => window.__appStore.getState().drawingDocument.sheets[0].annotations
    .filter((annotation) => annotation.kind === 'linear_dimension').length === 3);
  const centerDistance = await page.evaluate(() => window.__appStore.getState().drawingDocument.sheets[0].annotations
    .filter((annotation) => annotation.kind === 'linear_dimension')
    .at(-1));
  assert.equal(centerDistance.first.circle_center, true, 'first hole center is stored as an associative analytic center');
  assert.equal(centerDistance.second.circle_center, true, 'second hole center is stored as an associative analytic center');
  assert.match(
    await page.locator(`[data-testid="drawing-linear-dimension"][data-annotation-id="${centerDistance.id}"]`).textContent(),
    new RegExp(`${expectedCenterDistance.toFixed(2).replace('.', '\\.')} mm`),
    'dimensioning two recognized hole centers reports center-to-center distance',
  );

  // A recognized hole center and an exact straight edge form one associative
  // perpendicular dimension. This deliberately exercises the center-first
  // workflow that used to lose the first pick when the edge was selected.
  await page.getByRole('button', { name: 'Dimension', exact: true }).click();
  holeCenters = page.locator(`[data-drawing-view-id="${topViewId}"] [data-testid="drawing-hole-center-target"]`);
  smartLineTargets = page.locator(`[data-drawing-view-id="${topViewId}"] [data-drawing-line-dimension-target="true"]`);
  const centerForEdge = recognizedCenterPaper[0];
  const pointLineEdge = await smartLineTargets.evaluateAll((targets, center) => {
    const candidates = targets.map((target, index) => {
      const start = [Number(target.getAttribute('data-start-x')), Number(target.getAttribute('data-start-y'))];
      const end = [Number(target.getAttribute('data-end-x')), Number(target.getAttribute('data-end-y'))];
      const vector = [end[0] - start[0], end[1] - start[1]];
      const length = Math.hypot(...vector);
      if (length < 4) return null;
      const cross = Math.abs(vector[0] * (center[1] - start[1]) - vector[1] * (center[0] - start[0]));
      const distance = cross / length;
      const parameter = ((center[0] - start[0]) * vector[0] + (center[1] - start[1]) * vector[1]) / (length * length);
      return { index, start, end, distance, parameter };
    }).filter(Boolean).filter((candidate) => candidate.distance > 2 && candidate.parameter > 0.05 && candidate.parameter < 0.95);
    return candidates.sort((left, right) => right.distance - left.distance)[0] ?? null;
  }, centerForEdge);
  assert.ok(pointLineEdge, 'the top view exposes a finite part edge suitable for a hole-center dimension');
  await holeCenters.nth(0).click({ force: true });
  await smartLineTargets.nth(pointLineEdge.index).click({ force: true });
  const pointLinePreview = page.getByTestId('drawing-point-line-dimension-preview');
  await pointLinePreview.waitFor();
  assert.match(
    await pointLinePreview.textContent(),
    new RegExp(`${(pointLineEdge.distance / top.scale).toFixed(2).replace('.', '\\.')} mm`),
    'hole-center-to-edge preview reports the perpendicular model distance',
  );
  const pointLineVector = [
    pointLineEdge.end[0] - pointLineEdge.start[0],
    pointLineEdge.end[1] - pointLineEdge.start[1],
  ];
  const pointLineLength = Math.hypot(...pointLineVector);
  const pointLinePlacementPaper = [
    centerForEdge[0] + pointLineVector[0] / pointLineLength * 22,
    centerForEdge[1] + pointLineVector[1] / pointLineLength * 22,
  ];
  const pointLinePlacementScreen = await smartSheet.evaluate((sheet, paper) => {
    const matrix = sheet.getScreenCTM();
    if (!matrix) return null;
    const screen = new DOMPoint(paper[0], paper[1]).matrixTransform(matrix);
    return { x: screen.x, y: screen.y };
  }, pointLinePlacementPaper);
  assert.ok(pointLinePlacementScreen, 'point-to-edge placement maps to sheet space');
  await smartSheet.dispatchEvent('pointerdown', {
    button: 0,
    buttons: 1,
    pointerId: 41,
    pointerType: 'mouse',
    clientX: pointLinePlacementScreen.x,
    clientY: pointLinePlacementScreen.y,
    bubbles: true,
  });
  await page.waitForFunction(() => window.__appStore.getState().drawingDocument.sheets[0].annotations
    .some((annotation) => annotation.kind === 'point_line_dimension'));
  const pointLineDimension = await page.evaluate(() => window.__appStore.getState().drawingDocument.sheets[0].annotations
    .find((annotation) => annotation.kind === 'point_line_dimension'));
  assert.equal(pointLineDimension.point.circle_center, true, 'point-to-edge dimension persists the analytic hole center');
  assert.ok(pointLineDimension.line.edge_key.length > 0, 'point-to-edge dimension persists the stable OCCT edge key');
  const pointLineGraphic = page.locator(`[data-testid="drawing-point-line-dimension"][data-annotation-id="${pointLineDimension.id}"]`);
  const pointLinePath = await pointLineGraphic.locator('path').first().getAttribute('d');
  assert.equal(
    [...(pointLinePath ?? '').matchAll(/M(-?[\d.]+) (-?[\d.]+)L(-?[\d.]+) (-?[\d.]+)/g)].length,
    3,
    'point-to-edge dimension renders two witness lines and one dimension line',
  );

  await page.getByRole('button', { name: 'Dimension', exact: true }).click();
  holeCenters = page.locator(`[data-drawing-view-id="${topViewId}"] [data-testid="drawing-hole-center-target"]`);
  const smartCircularTarget = holeCenters.first().getByTestId('drawing-smart-dimension-feature-target');
  const smartCircularEdge = await smartCircularTarget.evaluate((target) => {
    const circle = target;
    const matrix = circle.getScreenCTM();
    if (!matrix) return null;
    const center = new DOMPoint(Number(circle.getAttribute('cx')), Number(circle.getAttribute('cy')));
    const radius = Number(circle.getAttribute('r'));
    const edge = new DOMPoint(center.x + radius, center.y).matrixTransform(matrix);
    return { x: edge.x, y: edge.y };
  });
  assert.ok(smartCircularEdge, 'smart Dimension exposes a screen-space circular edge');
  await page.mouse.click(smartCircularEdge.x, smartCircularEdge.y);
  await page.waitForFunction(() => window.__appStore.getState().drawingDocument.sheets[0].annotations
    .some((annotation) => annotation.kind === 'radial_dimension' && annotation.mode === 'diameter'));
  assert.equal(
    await page.evaluate(() => window.__appStore.getState().drawingDocument.sheets[0].annotations
      .filter((annotation) => annotation.kind === 'radial_dimension' && annotation.mode === 'diameter').length),
    1,
    'the primary Dimension tool infers diameter from a complete circular edge',
  );

  await clickRibbonMenuItem('ANNOTATE', 'drawingCenterGeometry', 'drawingCenterMarkMenu');
  holeCenters = page.locator(`[data-drawing-view-id="${topViewId}"] [data-testid="drawing-hole-center-target"]`);
  await holeCenters.first().click({ force: true });
  await page.getByTestId('drawing-center-mark').waitFor();

  await page.getByRole('button', { name: 'Centerline', exact: true }).click();
  holeCenters = page.locator(`[data-drawing-view-id="${topViewId}"] [data-testid="drawing-hole-center-target"]`);
  await holeCenters.nth(0).click({ force: true });
  await holeCenters.nth(1).click({ force: true });
  await page.getByTestId('drawing-center-line').waitFor();

  await page.getByRole('button', { name: 'Centerline', exact: true }).click();
  let centerlineEdges = page.locator(`[data-drawing-view-id="${topViewId}"] [data-testid="drawing-centerline-edge-target"]`);
  const longestCenterlineEdgeIndex = await centerlineEdges.evaluateAll((targets) => targets.reduce(
    (best, target, index) => {
      const startX = Number(target.getAttribute('data-start-x'));
      const startY = Number(target.getAttribute('data-start-y'));
      const endX = Number(target.getAttribute('data-end-x'));
      const endY = Number(target.getAttribute('data-end-y'));
      const length = Math.hypot(endX - startX, endY - startY);
      return length > best.length ? { index, length } : best;
    },
    { index: -1, length: -1 },
  ).index);
  assert.ok(longestCenterlineEdgeIndex >= 0, 'centerline tool exposes exact straight-edge targets');
  await centerlineEdges.nth(longestCenterlineEdgeIndex).click({ force: true });
  centerlineEdges = page.locator(`[data-drawing-view-id="${topViewId}"] [data-testid="drawing-centerline-edge-target"]`);
  await page.waitForFunction((selector) => document.querySelectorAll(selector).length >= 2,
    `[data-drawing-view-id="${topViewId}"] [data-testid="drawing-centerline-edge-target"]`);
  await centerlineEdges.nth(1).click({ force: true });
  await page.getByTestId('drawing-center-line-between-edges').waitFor({ state: 'attached' });
  const edgeCenterlinePath = await page.getByTestId('drawing-center-line-between-edges').locator('path').first().getAttribute('d');
  assert.match(edgeCenterlinePath ?? '', /^M[-\d.]+ [-\d.]+L[-\d.]+ [-\d.]+$/, 'parallel-edge centerline renders a finite paper-space path');
  const centerAnnotations = await page.evaluate(() => window.__appStore.getState().drawingDocument.sheets[0].annotations
    .filter((annotation) => annotation.kind === 'center_mark'
      || annotation.kind === 'center_line'
      || annotation.kind === 'center_line_between_edges'));
  assert.deepEqual(centerAnnotations.map((annotation) => annotation.kind), [
    'center_mark',
    'center_line',
    'center_line_between_edges',
  ]);
  await dragDrawingExtensionGrip(
    'drawing-center-mark',
    centerAnnotations[0].id,
    'drawing-center-mark-extension-grip',
  );
  await dragDrawingExtensionGrip(
    'drawing-center-line',
    centerAnnotations[1].id,
    'drawing-center-line-extension-grip',
  );
  await dragDrawingExtensionGrip(
    'drawing-center-line-between-edges',
    centerAnnotations[2].id,
    'drawing-edge-center-line-extension-grip',
  );
  assert.equal(centerAnnotations[2].first.edge_key.length > 0, true, 'line centerline keeps the first exact OCCT edge reference');
  assert.equal(centerAnnotations[2].second.edge_key.length > 0, true, 'line centerline keeps the second exact OCCT edge reference');

  await clickRibbonMenuItem('DIMENSIONS', 'drawingFeatureDimensions', 'drawingDiameterMenu');
  const circleTarget = page.locator(`[data-drawing-view-id="${topViewId}"] [data-testid="drawing-circle-target"]`).last();
  await circleTarget.waitFor();
  await circleTarget.click({ force: true });
  await page.getByTestId('drawing-radial-dimension').last().waitFor();

  await page.getByRole('button', { name: 'Hole Note', exact: true }).click();
  await circleTarget.click({ force: true });
  await page.getByTestId('drawing-hole-note').waitFor();
  await page.getByLabel('Thread designation').fill('M24 × 2 - 6H');
  await page.getByLabel('Additional note').fill('THRU');

  await clickRibbonMenuItem('DIMENSIONS', 'drawingFeatureDimensions', 'drawingAngleMenu');
  await anchors.nth(0).click({ force: true });
  await anchors.nth(1).click({ force: true });
  await anchors.nth(2).click({ force: true });
  await page.getByTestId('drawing-angular-dimension').waitFor();

  await clickRibbonMenuItem('ANNOTATE', 'drawingManufacturingNotes', 'drawingChamferNoteMenu');
  const chamferCandidates = page.locator(`[data-drawing-view-id="${topViewId}"] [data-testid="drawing-chamfer-candidate"]`);
  await chamferCandidates.first().waitFor();
  assert.ok(await chamferCandidates.count() >= 1, 'semantic OCCT chamfer edges are highlighted');
  await chamferCandidates.first().hover();
  await chamferCandidates.first().click({ force: true });
  await page.getByTestId('drawing-chamfer-placement-preview').waitFor();
  await page.getByTestId('drawing-chamfer-placement-controls').waitFor();
  assert.match(await page.getByTestId('drawing-chamfer-callout-preview').innerText(), /3(?:\.0+)? × 45(?:\.0+)?°/);
  const sheetForChamfer = page.getByTestId('drawing-sheet');
  const sheetForChamferBox = await sheetForChamfer.boundingBox();
  assert.ok(sheetForChamferBox);
  await page.mouse.move(
    sheetForChamferBox.x + sheetForChamferBox.width * 0.12,
    sheetForChamferBox.y + sheetForChamferBox.height * 0.12,
  );
  await page.mouse.click(
    sheetForChamferBox.x + sheetForChamferBox.width * 0.12,
    sheetForChamferBox.y + sheetForChamferBox.height * 0.12,
  );
  await page.waitForFunction(() => window.__appStore.getState().drawingDocument.sheets[0].annotations.some((annotation) => annotation.kind === 'chamfer_note'));
  await page.getByTestId('drawing-chamfer-note').waitFor();
  const chamferAnnotation = await page.evaluate(() => window.__appStore.getState().drawingDocument.sheets[0].annotations.find((annotation) => annotation.kind === 'chamfer_note'));
  assert.ok(chamferAnnotation);
  assert.ok(Math.abs(chamferAnnotation.length - 3) < 1e-4, 'chamfer setback is measured automatically');
  assert.ok(Math.abs(chamferAnnotation.angle_deg - 45) < 1e-4, 'chamfer angle is measured automatically');
  assert.match(await page.getByTestId('drawing-chamfer-note').textContent(), /3(?:\.0+)? × 45(?:\.0+)?°/);

  const chamferBeforeDrag = chamferAnnotation.position;
  const chamferGraphicBox = await page.getByTestId('drawing-chamfer-note').locator('text').boundingBox();
  assert.ok(chamferGraphicBox);
  await page.mouse.move(chamferGraphicBox.x + chamferGraphicBox.width * 0.5, chamferGraphicBox.y + chamferGraphicBox.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(chamferGraphicBox.x + chamferGraphicBox.width * 0.5 + 48, chamferGraphicBox.y + chamferGraphicBox.height * 0.5 + 30, { steps: 4 });
  await page.mouse.up();
  await page.waitForFunction(
    (before) => {
      const annotation = window.__appStore.getState().drawingDocument.sheets[0].annotations.find((candidate) => candidate.kind === 'chamfer_note');
      return annotation && (Math.abs(annotation.position[0] - before[0]) > 1 || Math.abs(annotation.position[1] - before[1]) > 1);
    },
    chamferBeforeDrag,
  );

  await page.getByRole('button', { name: 'Note', exact: true }).click();
  const sheet = page.getByTestId('drawing-sheet');
  const box = await sheet.boundingBox();
  assert.ok(box);
  await page.mouse.click(box.x + box.width * 0.15, box.y + box.height * 0.72);
  await page.getByTestId('drawing-note').waitFor();
  await page.getByLabel('Text').fill('ASSEMBLY DATUM');
  await page.waitForFunction(() => window.__appStore.getState().drawingDocument.sheets[0].annotations.some((annotation) => annotation.kind === 'note' && annotation.text === 'ASSEMBLY DATUM'));

  // Every placed annotation uses the same press-and-drag interaction. The
  // persisted value remains semantic for associative dimensions: offset for
  // linear, angle/leader length for radial, arc radius for angular, and paper
  // position for notes and callouts.
  await page.evaluate(() => window.__appStore.getState().setDrawingTool(null));
  const draggableAnnotations = await page.evaluate(() => Object.fromEntries(
    ['linear_dimension', 'line_dimension', 'point_line_dimension', 'radial_dimension', 'angular_dimension', 'hole_note', 'chamfer_note', 'note']
      .map((kind) => {
        const matches = window.__appStore.getState().drawingDocument.sheets[0].annotations
          .filter((annotation) => annotation.kind === kind);
        // Smart Dimension creates several line/radial annotations. Exercise
        // the latest one because it is top-most in the SVG hit stack, then
        // move it clear before testing older handles.
        return [kind, (kind === 'radial_dimension' || kind === 'line_dimension' ? matches.at(-1) : matches[0])?.id];
      }),
  ));
  for (const [kind, id] of Object.entries(draggableAnnotations)) {
    assert.ok(Number.isInteger(id), `${kind} fixture exists for drag coverage`);
  }
  // The point-to-edge fixture is intentionally drawn over the top-view
  // geometry. Move this newest (top-most) annotation first so it cannot mask
  // the older dimension handles exercised below.
  await dragDrawingAnnotation(
    'drawing-point-line-dimension',
    draggableAnnotations.point_line_dimension,
    ['position'],
    [52, 36],
  );
  await dragDrawingAnnotation(
    'drawing-line-dimension',
    draggableAnnotations.line_dimension,
    ['position'],
    [28, 24],
  );
  await dragDrawingAnnotation(
    'drawing-linear-dimension',
    draggableAnnotations.linear_dimension,
    ['offset'],
    [0, 36],
  );
  await dragDrawingAnnotation(
    'drawing-radial-dimension',
    draggableAnnotations.radial_dimension,
    ['leader_angle_deg', 'offset'],
    [44, -24],
  );
  await dragDrawingAnnotation(
    'drawing-angular-dimension',
    draggableAnnotations.angular_dimension,
    ['radius'],
    [52, 34],
  );
  await dragDrawingAnnotation(
    'drawing-hole-note',
    draggableAnnotations.hole_note,
    ['position'],
    [38, 22],
  );
  await dragDrawingAnnotation(
    'drawing-chamfer-note',
    draggableAnnotations.chamfer_note,
    ['position'],
    [-28, 20],
  );
  await dragDrawingAnnotation(
    'drawing-note',
    draggableAnnotations.note,
    ['position'],
    [32, -24],
  );

  await page.getByRole('button', { name: 'Export DXF', exact: true }).click();
  await page.waitForFunction(() => Object.keys(window.__drawingExports).length === 1);
  const annotatedExport = await page.evaluate(() => Object.values(window.__drawingExports)[0]);
  const exportedName = await page.evaluate(() => Object.keys(window.__drawingExports)[0]);
  assert.match(annotatedExport, /AC1027/);
  assert.match(annotatedExport, /\r?\nCIRCLE\r?\n/);
  assert.match(annotatedExport, /\r?\nDIMENSION\r?\n/);
  assert.match(annotatedExport, /\r?\nLEADER\r?\n/);
  assert.match(annotatedExport, /\r?\nMTEXT\r?\n/);
  assert.match(annotatedExport, /ASSEMBLY DATUM/);
  assert.match(annotatedExport, /%%c/);
  assert.match(annotatedExport, /M24 × 2 - 6H/);
  assert.match(annotatedExport, /3 × 45°/);
  assert.match(annotatedExport, /NBS_CENTER/);
  assert.match(annotatedExport, /NBS_HIDDEN/);
  assert.match(annotatedExport, /NBS_CUTTING/);
  assert.match(annotatedExport, /NBS_PHANTOM/);
  assert.match(annotatedExport, /\r?\n8\r?\nCENTER\r?\n/);
  assert.match(annotatedExport, /ISO A3/);
  assert.match(annotatedExport, /ISO 2768-m/);
  assert.match(exportedName, /\.dxf$/i);
  assertDxfStructure(annotatedExport);

  await clickRibbonMenuItem('OUTPUT', null, 'exportDrawingProfileDxfMenu');
  const profileDialog = page.getByTestId('drawing-profile-export-dialog');
  await profileDialog.waitFor();
  await profileDialog.getByRole('button', { name: /^Sketch4 · Profile 1/ }).click();
  await profileDialog.getByRole('button', { name: 'Export profile DXF', exact: true }).click();
  await page.waitForFunction(() => Object.keys(window.__drawingExports).length === 2);
  const profileExport = await page.evaluate(() => {
    const entry = Object.entries(window.__drawingExports)
      .find(([name]) => /Sketch4-profile-1\.dxf$/i.test(name));
    return entry ? { name: entry[0], contents: entry[1] } : null;
  });
  assert.ok(profileExport, 'manufacturing profile export has an explicit sketch/profile filename');
  assert.match(profileExport.contents, /\r?\n8\r?\nPROFILE_OUTER\r?\n/);
  assert.match(profileExport.contents, /\r?\n8\r?\nPROFILE_HOLES\r?\n/);
  const profileEntities = profileExport.contents.split(/\r?\n2\r?\nENTITIES\r?\n/).at(-1);
  assert.doesNotMatch(profileEntities, /ISO A3|TITLE BLOCK|\r?\n8\r?\nVIEW_LABELS\r?\n/);
  assert.match(profileExport.contents, /\r?\n\$INSUNITS\r?\n70\r?\n4\r?\n/);
  assert.match(profileExport.contents, /\r?\n10\r?\n-10\r?\n20\r?\n-8\r?\n/);
  assertDxfStructure(profileExport.contents, { requireDimensions: false });

  // A second sheet exercises ANSI paper and third-angle defaults separately.
  await page.getByRole('button', { name: 'New Sheet', exact: true }).click();
  await page.getByTestId('drawing-sheet-setup').waitFor();
  await page.getByRole('button', { name: /^ANSI \/ ASME/ }).click();
  await page.getByLabel('Paper size').selectOption('ansi_b');
  await page.getByRole('button', { name: 'Create blank sheet' }).click();
  await page.waitForFunction(() => window.__appStore.getState().drawingDocument.sheets.length === 2);
  drawing = await page.evaluate(() => window.__appStore.getState().drawingDocument);
  const ansiSheet = drawing.sheets[1];
  assert.equal(ansiSheet.standard, 'ansi');
  assert.equal(ansiSheet.format, 'ansi_b');
  assert.equal(ansiSheet.projection_method, 'third_angle');
  assert.equal(ansiSheet.tolerance_note.preset, 'ansi_decimal');
  assert.equal(ansiSheet.views.length, 0);

  // Manual placement is a modeless projected-view command. The first view
  // establishes group scale; every later orthographic view aligns to that
  // root even when the previously selected view is itself a child.
  const manualSheet = page.getByTestId('drawing-sheet');
  const manualSheetBox = await manualSheet.boundingBox();
  assert.ok(manualSheetBox);
  await page.getByRole('button', { name: 'Front View', exact: true }).click();
  const placementPreview = page.getByTestId('drawing-view-placement-preview');
  await placementPreview.waitFor();
  await page.getByTestId('drawing-view-placement-controls').waitFor();
  const initialPreviewX = Number(await placementPreview.getAttribute('data-preview-x'));
  await page.mouse.move(
    manualSheetBox.x + manualSheetBox.width * 0.34,
    manualSheetBox.y + manualSheetBox.height * 0.47,
  );
  await page.waitForFunction(
    (initialX) => Number(document.querySelector('[data-testid="drawing-view-placement-preview"]')?.getAttribute('data-preview-x')) !== initialX,
    initialPreviewX,
  );
  await page.getByTestId('drawing-placement-scale').selectOption('2');
  assert.equal(await placementPreview.getAttribute('data-preview-scale'), '2', 'placement controls update the live cursor preview');
  assert.equal(await placementPreview.count(), 1, 'preview remains active while using the placement controls');
  await page.mouse.click(
    manualSheetBox.x + manualSheetBox.width * 0.34,
    manualSheetBox.y + manualSheetBox.height * 0.47,
  );
  await page.waitForFunction(() => window.__appStore.getState().drawingDocument.sheets[1]?.views.length === 1);

  let manualViews = await page.evaluate(() => window.__appStore.getState().drawingDocument.sheets[1].views);
  const manualFront = manualViews[0];
  assert.equal(manualFront.kind, 'front');
  assert.equal(manualFront.scale, 2, 'the first view establishes the projection group scale');

  await clickRibbonMenuItem('VIEWS', 'drawingStandardViews', 'drawingTopViewMenu');
  await placementPreview.waitFor();
  assert.equal(await placementPreview.getAttribute('data-preview-scale'), '2', 'a related view inherits the root scale');
  await page.getByTestId('drawing-placement-scale').selectOption('1');
  assert.equal(await placementPreview.getAttribute('data-preview-scale'), '1');
  await page.waitForFunction(
    (frontId) => document.querySelector(`[data-drawing-view-id="${frontId}"]`)?.textContent?.includes('1:1'),
    manualFront.id,
  );
  await page.getByTestId('drawing-placement-scale').selectOption('2');
  await page.waitForFunction(
    (frontId) => document.querySelector(`[data-drawing-view-id="${frontId}"]`)?.textContent?.includes('2:1'),
    manualFront.id,
  );
  await page.mouse.move(
    manualSheetBox.x + manualSheetBox.width * 0.72,
    manualSheetBox.y + manualSheetBox.height * 0.25,
  );
  await page.waitForFunction(
    (frontX) => Math.abs(Number(document.querySelector('[data-testid="drawing-view-placement-preview"]')?.getAttribute('data-preview-x')) - frontX) < 1e-6,
    manualFront.position[0],
  );
  await page.mouse.click(
    manualSheetBox.x + manualSheetBox.width * 0.72,
    manualSheetBox.y + manualSheetBox.height * 0.25,
  );
  await page.waitForFunction(() => window.__appStore.getState().drawingDocument.sheets[1]?.views.length === 2);

  await clickRibbonMenuItem('VIEWS', 'drawingStandardViews', 'drawingRightViewMenu');
  await placementPreview.waitFor();
  assert.equal(await placementPreview.getAttribute('data-preview-scale'), '2');
  await page.mouse.move(
    manualSheetBox.x + manualSheetBox.width * 0.68,
    manualSheetBox.y + manualSheetBox.height * 0.76,
  );
  await page.waitForFunction(
    (frontY) => Math.abs(Number(document.querySelector('[data-testid="drawing-view-placement-preview"]')?.getAttribute('data-preview-y')) - frontY) < 1e-6,
    manualFront.position[1],
  );
  await page.mouse.click(
    manualSheetBox.x + manualSheetBox.width * 0.68,
    manualSheetBox.y + manualSheetBox.height * 0.76,
  );
  await page.waitForFunction(() => window.__appStore.getState().drawingDocument.sheets[1]?.views.length === 3);

  manualViews = await page.evaluate(() => window.__appStore.getState().drawingDocument.sheets[1].views);
  const manualTop = manualViews.find((view) => view.kind === 'top');
  const manualRight = manualViews.find((view) => view.kind === 'right');
  assert.equal(manualTop.parent_view_id, manualFront.id);
  assert.equal(manualTop.position[0], manualFront.position[0]);
  assert.equal(manualTop.scale, 2);
  assert.equal(manualRight.parent_view_id, manualFront.id, 'a selected child resolves back to the group root');
  assert.equal(manualRight.position[1], manualFront.position[1]);
  assert.equal(manualRight.scale, 2);

  await page.getByRole('button', { name: 'Dimension', exact: true }).click();
  const ansiFrontAnchors = page.locator(
    `[data-drawing-view-id="${manualFront.id}"] [data-testid="drawing-annotation-anchor"]`,
  );
  await ansiFrontAnchors.first().waitFor();
  const ansiAnchorXs = await ansiFrontAnchors.evaluateAll((elements) =>
    elements.map((element, index) => ({ index, x: Number(element.getAttribute('cx')) })),
  );
  const ansiLeftAnchor = ansiAnchorXs.reduce((best, candidate) => candidate.x < best.x ? candidate : best);
  const ansiRightAnchor = ansiAnchorXs.reduce((best, candidate) => candidate.x > best.x ? candidate : best);
  await ansiFrontAnchors.nth(ansiLeftAnchor.index).click({ force: true });
  await ansiFrontAnchors.nth(ansiRightAnchor.index).click({ force: true });
  await page.waitForFunction(() => window.__appStore.getState().drawingDocument.sheets[1].annotations
    .some((annotation) => annotation.kind === 'linear_dimension'));
  const ansiDimension = page.locator('[data-testid="drawing-linear-dimension"]').last();
  const ansiDimensionLayout = ansiDimension.getByTestId('drawing-linear-dimension-layout');
  assert.equal(
    await ansiDimensionLayout.getAttribute('data-dimension-line'),
    'interrupted',
    'ASME keeps the conventional centered-value interruption when the value fits',
  );
  assert.equal(
    await ansiDimension.getByTestId('drawing-dimension-text-mask').getAttribute('fill'),
    '#fff',
    'the ASME line interruption is limited to the value clearance',
  );
  assert.equal(
    await ansiDimension.getByTestId('drawing-dimension-arrow').count(),
    2,
    'ASME dimensions also retain both arrowheads',
  );

  await clickRibbonMenuItem('ANNOTATE', 'drawingManufacturingNotes', 'drawingChamferNoteMenu');
  const ansiChamferCandidate = page.locator(`[data-drawing-view-id="${manualTop.id}"] [data-testid="drawing-chamfer-candidate"]`).first();
  await ansiChamferCandidate.waitFor();
  await ansiChamferCandidate.click({ force: true });
  await page.getByTestId('drawing-chamfer-placement-preview').waitFor();
  assert.match(await page.getByTestId('drawing-chamfer-callout-preview').innerText(), /3(?:\.0+)? X 45(?:\.0+)?°/);
  const ansiPlacementBox = await page.getByTestId('drawing-sheet').boundingBox();
  assert.ok(ansiPlacementBox);
  await page.mouse.move(
    ansiPlacementBox.x + ansiPlacementBox.width * 0.06,
    ansiPlacementBox.y + ansiPlacementBox.height * 0.08,
  );
  await page.mouse.click(
    ansiPlacementBox.x + ansiPlacementBox.width * 0.06,
    ansiPlacementBox.y + ansiPlacementBox.height * 0.08,
  );
  await page.waitForFunction(() => window.__appStore.getState().drawingDocument.sheets[1].annotations.some((annotation) => annotation.kind === 'chamfer_note'));
  assert.match(await page.getByTestId('drawing-chamfer-note').textContent(), /3(?:\.0+)? X 45(?:\.0+)?°/);

  await page.getByRole('button', { name: 'Solid Modeling', exact: true }).click();
  await page.waitForFunction(() => window.__appStore.getState().activeTab === 'solid');
  assert.equal(await page.getByTestId('drawing-workspace').count(), 0);
  assert.deepEqual(pageErrors, []);
  console.log('2D drawing workspace e2e passed');
} finally {
  await browser.close();
}

function assertDxfStructure(dxf, { requireDimensions = true } = {}) {
  const rows = dxf.trimEnd().split(/\r?\n/);
  assert.equal(rows.length % 2, 0, 'DXF is a sequence of group-code/value pairs');
  assert.deepEqual(rows.slice(-2), ['0', 'EOF']);
  assert.doesNotMatch(dxf, /(?:^|\r?\n)(?:NaN|Infinity|-Infinity)(?:\r?\n|$)/);

  const dimensionBlocks = [...dxf.matchAll(/\r?\n2\r?\n(\*D\d+)\r?\n/g)].map((match) => match[1]);
  if (requireDimensions) {
    assert.ok(dimensionBlocks.length >= 3, 'semantic dimensions have anonymous graphics blocks');
  }
  for (const name of new Set(dimensionBlocks)) {
    assert.match(dxf, new RegExp(`\\r?\\nBLOCK\\r?\\n[\\s\\S]*?\\r?\\n2\\r?\\n${name.replace('*', '\\*')}\\r?\\n`));
  }
}
