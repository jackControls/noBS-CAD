/** Technical drawing workspace, persistence intent, and vector export regression. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE = 'http://localhost:7199';
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
await page.addInitScript(() => {
  window.__drawingExports = {};
  window.showSaveFilePicker = async (options) => ({
    kind: 'file',
    name: options.suggestedName,
    async createWritable() {
      return {
        async write(data) {
          const bytes =
            data instanceof Blob
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
page.on('pageerror', (error) => pageErrors.push(String(error)));

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__appStore.getState().document !== null);

  await page.evaluate(async () => {
    const engine = window.__engine;
    const store = window.__appStore.getState();
    store.applySolidUpdate(await engine.newProject());
    await engine.beginSketch({ type: 'origin_plane', plane: 'xy' });
    await engine.setGridSnap(false);
    await engine.addRectangle({
      mode: 'two_point',
      p1: { x: -10, y: -10 },
      p2: { x: 10, y: 10 },
      ctrl_held: true,
    });
    const ended = await engine.endSketch();
    store.setDocument(ended.document);
    store.setFinishedSketches(await engine.finishedSketches());
    store.applySolidUpdate(await engine.extrude({
      sketch_name: 'Sketch1',
      profile_indices: [0],
      operation: 'new_body',
      extent: { type: 'distance', distance: 10 },
      taper_angle_deg: 0,
      flip: false,
      target_body_ids: [],
    }));
    store.setMode('solid');
  });

  await page.getByRole('button', { name: 'Drawing', exact: true }).click();
  await page.getByTestId('drawing-workspace').waitFor();
  await page.getByTestId('drawing-browser').waitFor();
  await page.waitForFunction(() => {
    const state = window.__appStore.getState();
    return state.activeTab === 'drawing' && state.drawingDocument.sheets[0]?.views.length === 4;
  });

  let drawing = await page.evaluate(() => window.__appStore.getState().drawingDocument);
  assert.equal(drawing.sheets.length, 1);
  assert.deepEqual(
    drawing.sheets[0].views.map((view) => view.kind),
    ['front', 'top', 'right', 'isometric'],
    'the first sheet starts with the standard orthographic view set',
  );

  await page.getByRole('button', { name: 'Dimension', exact: true }).click();
  const isometricViewId = await page.evaluate(() =>
    window.__appStore.getState().drawingDocument.sheets[0].views
      .find((view) => view.kind === 'isometric').id,
  );
  const isometricAnchors = page.locator(
    `[data-drawing-view-id="${isometricViewId}"] [data-testid="drawing-dimension-anchor"]`,
  );
  await isometricAnchors.first().waitFor();
  assert.ok(await isometricAnchors.count() >= 4, 'the HLR view exposes model topology anchors');
  await isometricAnchors.nth(0).click({ force: true });
  await isometricAnchors.nth(1).click({ force: true });
  await page.waitForFunction(() =>
    window.__appStore.getState().drawingDocument.sheets[0].annotations
      .some((annotation) => annotation.kind === 'linear_dimension'),
  );
  await page.getByTestId('drawing-linear-dimension').waitFor();

  await page.getByRole('button', { name: 'Note', exact: true }).click();
  const drawingSheet = page.getByTestId('drawing-sheet');
  const drawingSheetBox = await drawingSheet.boundingBox();
  assert.ok(drawingSheetBox);
  await page.mouse.click(
    drawingSheetBox.x + drawingSheetBox.width * 0.15,
    drawingSheetBox.y + drawingSheetBox.height * 0.78,
  );
  await page.getByTestId('drawing-note').waitFor();
  await page.getByLabel('Text').fill('ASSEMBLY DATUM');
  await page.waitForFunction(() =>
    window.__appStore.getState().drawingDocument.sheets[0].annotations
      .some((annotation) => annotation.kind === 'note' && annotation.text === 'ASSEMBLY DATUM'),
  );

  await page.getByRole('button', { name: 'Export SVG', exact: true }).click();
  await page.waitForFunction(() => Object.keys(window.__drawingExports).length === 1);
  const annotatedExport = await page.evaluate(() => Object.values(window.__drawingExports)[0]);
  assert.match(annotatedExport, /\d+\.\d{2} mm/, 'dimensions are included in vector export');
  assert.match(annotatedExport, /ASSEMBLY DATUM/, 'notes are included in vector export');

  const browserPanel = page.getByTestId('drawing-browser');
  await browserPanel.getByRole('button', { name: /^Front/ }).click();
  await page.getByLabel('Scale').selectOption('0.5');
  await page.getByLabel('Hidden lines').check();
  await page.waitForFunction(() => {
    const state = window.__appStore.getState();
    const sheet = state.drawingDocument.sheets[0];
    const front = sheet.views.find((view) => view.kind === 'front');
    return front?.scale === 0.5 && front.show_hidden_lines && state.dirty;
  });
  assert.match(
    await browserPanel.getByRole('button', { name: /^Front/ }).innerText(),
    /1:2/,
    'view scale is reflected in the drawing browser',
  );

  await page.getByRole('button', { name: 'New Sheet', exact: true }).click();
  await page.waitForFunction(() => window.__appStore.getState().drawingDocument.sheets.length === 2);
  drawing = await page.evaluate(() => window.__appStore.getState().drawingDocument);
  assert.equal(drawing.active_sheet_id, drawing.sheets[1].id);
  assert.notEqual(drawing.sheets[0].views[0].id, drawing.sheets[1].views[0].id);

  await page.getByRole('button', { name: 'Export SVG', exact: true }).click();
  await page.waitForFunction(() => Object.keys(window.__drawingExports).length === 2);
  const exported = await page.evaluate(() =>
    Object.entries(window.__drawingExports)
      .find(([name]) => name.includes('Sheet-2'))?.[1],
  );
  assert.ok(exported);
  assert.match(exported, /^<\?xml version="1\.0"/);
  assert.match(exported, /width="297mm" height="210mm"/);
  assert.match(exported, /<text[^>]*>SHEET: Sheet 2<\/text>/);

  await page.getByRole('button', { name: '3D Model', exact: true }).click();
  await page.waitForFunction(() => window.__appStore.getState().activeTab === 'solid');
  assert.equal(await page.getByTestId('drawing-workspace').count(), 0);
  assert.deepEqual(pageErrors, []);
  console.log('2D drawing workspace e2e passed');
} finally {
  await browser.close();
}
