/** Real browser/OpenCascade acceptance for line-axis Revolve booleans,
 * Sweep, Loft, and Rib. Each scenario gets a fresh document. */
import { chromium } from 'playwright';

const BASE = 'http://localhost:7199';
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  [${ok ? 'ok' : 'FAIL'}] ${name}${ok ? '' : ` — ${detail}`}`);
  if (!ok) failures += 1;
};

const browser = await chromium.launch();
const errors = [];

async function freshPage() {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__appStore?.getState().document !== null);
  return page;
}

const state = (page) => page.evaluate(() => window.__appStore.getState());
async function clickSketch(page, x, y) {
  const point = await page.evaluate(([sx, sy]) => window.__sketchToScreen(sx, sy), [x, y]);
  await page.mouse.click(point.x, point.y);
}

async function beginSketch(page, plane) {
  await page.getByRole('button', { name: 'Create Sketch' }).first().click();
  await page.waitForTimeout(200);
  if (!(await page.getByText(`${plane} Plane`, { exact: true }).isVisible())) {
    await page.getByRole('button', { name: 'Origin' }).click();
  }
  await page.getByText(`${plane} Plane`, { exact: true }).click();
  await page.waitForFunction(() => window.__appStore.getState().mode === 'sketch');
  await page.waitForTimeout(900);
}

async function rectangle(page, x1, y1, x2, y2) {
  await page.locator('button[title="Rectangle"]').click();
  await clickSketch(page, x1, y1);
  await clickSketch(page, x2, y2);
}

async function line(page, x1, y1, x2, y2) {
  const initialLines = (await state(page)).activeSketch.entities.filter((entity) => entity.kind === 'line').length;
  await page.locator('button[title="Line"]').click();
  await clickSketch(page, x1, y1);
  await clickSketch(page, x2, y2);
  await page.waitForFunction(
    (count) => window.__appStore.getState().activeSketch.entities.filter((entity) => entity.kind === 'line').length > count,
    initialLines,
  );
  await page.keyboard.press('Escape');
}

async function arc3pt(page, x1, y1, xm, ym, x2, y2) {
  const initialArcs = (await state(page)).activeSketch.entities.filter((entity) => entity.kind === 'arc').length;
  await page.locator('button[title="Arc"]').click();
  await clickSketch(page, x1, y1);
  await clickSketch(page, xm, ym);
  await clickSketch(page, x2, y2);
  await page.waitForFunction(
    (count) => window.__appStore.getState().activeSketch.entities.filter((entity) => entity.kind === 'arc').length > count,
    initialArcs,
  );
}

async function finishSketch(page) {
  const modal = page.getByRole('dialog');
  if (await modal.isVisible().catch(() => false)) {
    throw new Error(`unexpected sketch dialog before finish: ${(await modal.innerText()).replace(/\s+/g, ' ')}`);
  }
  await page.getByRole('button', { name: 'FINISH SKETCH', exact: true }).click();
  await page.waitForFunction(() => window.__appStore.getState().mode === 'solid');
}

async function extrude(page, distance = 20) {
  await page.locator('button[title="Extrude"]').first().click();
  await page.getByTestId('extrude-dialog').waitFor({ state: 'visible' });
  await page.getByTestId('extrude-distance').fill(String(distance));
  await page.getByTestId('extrude-submit').click();
  await page.waitForFunction(() => !window.__appStore.getState().solidBusy && window.__appStore.getState().solidScene.bodies.length > 0, undefined, { timeout: 60_000 });
}

function faceInteriorPoints(body, face) {
  const samples = [];
  const weightSets = [
    [0.19, 0.34, 0.47],
    [0.47, 0.19, 0.34],
    [0.34, 0.47, 0.19],
  ];
  for (
    let offset = face.first_index;
    offset + 2 < face.first_index + face.index_count;
    offset += 3
  ) {
    const indices = [0, 1, 2].map(
      (index) => body.mesh.indices[offset + index],
    );
    if (indices.some((index) => index === undefined)) continue;
    const vertices = indices.map((index) => [
      body.mesh.positions[index * 3] ?? 0,
      body.mesh.positions[index * 3 + 1] ?? 0,
      body.mesh.positions[index * 3 + 2] ?? 0,
    ]);
    for (const weights of weightSets) {
      samples.push([0, 1, 2].map((axis) =>
        vertices.reduce(
          (sum, vertex, index) => sum + vertex[axis] * weights[index],
          0,
        )));
    }
  }
  return samples;
}

console.log('1. sketch-line axis Revolve Cut');
{
  const page = await freshPage();
  await beginSketch(page, 'XY');
  await rectangle(page, -30, -20, 30, 20);
  await finishSketch(page);
  await extrude(page, 20);
  const base = (await state(page)).solidScene.bodies[0];

  await beginSketch(page, 'XY');
  await rectangle(page, 10, -10, 20, 10);
  await line(page, 0, -20, 0, 20);
  await finishSketch(page);
  const latest = (await state(page)).finishedSketches.at(-1);
  const axis = latest.entities.find((entity) => entity.kind === 'line' && Math.abs(entity.start.x) < 1e-6 && Math.abs(entity.end.x) < 1e-6);
  await page.locator('button[title="Revolve"]').click();
  await page.getByTestId('revolve-dialog').waitFor({ state: 'visible' });
  await page.getByTestId('revolve-axis').selectOption('line');
  const axisOptions = await page.getByTestId('revolve-axis-line').locator('option').evaluateAll((options) => options.map((option) => option.value));
  check('Revolve exposes the selected sketch line as an axis', Boolean(axis) && axisOptions.includes(String(axis.id)));
  const axisMidpoint = await page.evaluate(() => window.__worldToScreen(0, 0, 0));
  await page.mouse.click(axisMidpoint.x, axisMidpoint.y);
  await page.waitForFunction(
    (entityId) => window.__appStore.getState().revolveAxisSelection?.entityId === entityId,
    axis.id,
  );
  await page.waitForFunction(
    (entityId) =>
      document.querySelector('[data-testid="revolve-axis-line"]')?.value === String(entityId),
    axis.id,
  );
  check('Viewport click selects the stable Revolve axis line', await page.getByTestId('revolve-axis-line').inputValue() === String(axis.id));
  const finishedVisual = await page.evaluate(() => window.__finishedSketchVisualState());
  const emphasizedWidths = finishedVisual.lineWidths.filter(
    (_, index) => finishedVisual.lineEmphasis[index],
  );
  check(
    'selected finished-sketch curves are only 50% wider than default',
    emphasizedWidths.length > 0 &&
      emphasizedWidths.every((width) => Math.abs(width - 1.725) < 1e-6),
    JSON.stringify(emphasizedWidths),
  );
  const nativeCurvePresentation = await page.evaluate(
    () => window.__nativeViewportTransient(),
  );
  check(
    'Bevy receives selected finished-sketch curves for Revolve/Sweep/Loft/Rib',
    nativeCurvePresentation.lines.some((layer) => layer.segments.length >= 6),
  );
  await page.getByTestId('solid-operation').selectOption('cut');
  await page.getByTestId('revolve-ok').click();
  await page.waitForFunction(() => !window.__appStore.getState().solidBusy, undefined, { timeout: 60_000 });
  const app = await state(page);
  check('Revolve Cut keeps the stable target Body ID', app.solidScene.bodies.length === 1 && app.solidScene.bodies[0].id === base.id);
  check('Revolve stores a real line-axis feature', app.document.features.at(-1).kind === 'revolve' && app.document.features.at(-1).status.state === 'ok');
  await page.close();
}

console.log('2. profile Sweep along a curved analytic path');
{
  const page = await freshPage();
  await beginSketch(page, 'XY');
  await rectangle(page, -10, -10, 10, 10);
  await finishSketch(page);
  await beginSketch(page, 'YZ');
  await arc3pt(page, 0, 0, 10, 0, 20, 20);
  await finishSketch(page);
  const pathSketch = (await state(page)).finishedSketches.at(-1);
  const pathArc = pathSketch.entities.find((entity) => entity.kind === 'arc');
  await page.locator('button[title="Sweep"]').click();
  await page.getByTestId('sweep-dialog').waitFor({ state: 'visible' });
  await page.waitForTimeout(700);
  check('Sweep lists the analytic arc as a path curve', Boolean(pathArc) && await page.getByTestId(`sweep-path-${pathArc.id}`).isChecked());
  await page.getByTestId('sweep-orientation').selectOption('frenet');
  await page.getByTestId('sweep-transition').selectOption('round_corner');
  await page.getByTestId('sweep-force-c1').check();
  await page.getByTestId('sweep-ok').click();
  await page.waitForFunction(() => !window.__appStore.getState().solidBusy && window.__appStore.getState().solidScene.bodies.length === 1, undefined, { timeout: 60_000 });
  const app = await state(page);
  check('Curved Sweep produces a tessellated OCCT body', app.solidScene.bodies[0].mesh.indices.length > 0);
  check('Sweep appears in feature history', app.document.features.at(-1).kind === 'sweep');
  await page.close();
}

console.log('3. Sweep with a separate guide rail');
{
  const page = await freshPage();
  await beginSketch(page, 'XY');
  await rectangle(page, -10, -10, 10, 10);
  await finishSketch(page);
  await beginSketch(page, 'YZ');
  await line(page, 0, 0, 0, 30);
  await line(page, 10, 0, 10, 30);
  await finishSketch(page);
  const guideSketch = (await state(page)).finishedSketches.at(-1);
  const guideLines = guideSketch.entities.filter((entity) => entity.kind === 'line');
  await page.locator('button[title="Sweep"]').click();
  await page.getByTestId('sweep-dialog').waitFor({ state: 'visible' });
  await page.getByTestId('sweep-guide-enabled').check();
  await page.getByTestId('sweep-guide-sketch').selectOption(guideSketch.name);
  await page.getByTestId(`sweep-guide-${guideLines[0].id}`).uncheck();
  await page.getByTestId(`sweep-guide-${guideLines[1].id}`).check();
  await page.getByTestId('sweep-force-c1').check();
  await page.getByTestId('sweep-ok').click();
  await page.waitForFunction(() => !window.__appStore.getState().solidBusy && window.__appStore.getState().solidScene.bodies.length === 1, undefined, { timeout: 60_000 });
  const app = await state(page);
  check('Guided Sweep produces a tessellated OCCT body', app.solidScene.bodies[0].mesh.indices.length > 0);
  check('Guided Sweep appears in feature history', app.document.features.at(-1).kind === 'sweep');
  await page.close();
}

console.log('4. Loft between origin and planar-face profiles');
{
  const page = await freshPage();
  await beginSketch(page, 'XY');
  await rectangle(page, -15, -15, 15, 15);
  await finishSketch(page);
  await extrude(page, 20);
  let app = await state(page);
  const body = app.solidScene.bodies[0];
  const top = body.faces
    .filter((face) => face.plane)
    .map((face) => ({ face, samples: faceInteriorPoints(body, face) }))
    .filter(({ samples }) => samples.length > 0)
    .sort((a, b) => b.samples[0][2] - a.samples[0][2])[0];
  for (const sample of top.samples) {
    const screen = await page.evaluate(
      ([x, y, z]) => window.__worldToScreen(x, y, z),
      sample,
    );
    await page.mouse.click(screen.x, screen.y);
    await page.waitForTimeout(80);
    if ((await state(page)).selectedFace === top.face.id) break;
  }
  check(
    'Loft support face is selected away from projected topology edges',
    (await state(page)).selectedFace === top.face.id,
  );
  await page.getByRole('button', { name: 'Create Sketch' }).first().click();
  await page.getByTestId('sketch-plane-origin-dialog').waitFor({ state: 'visible' });
  await page.getByTestId('sketch-plane-origin-ok').click();
  await page.waitForFunction(() => window.__appStore.getState().mode === 'sketch');
  // The face-hosted camera transition uses the same 350 ms interpolation as
  // origin-plane sketches. Wait for it before converting sketch coordinates
  // into screen clicks, otherwise both rectangle clicks can land together.
  await page.waitForTimeout(900);
  await rectangle(page, -7, -7, 7, 7);
  await finishSketch(page);
  await page.mouse.click(1200, 750);
  await page.waitForFunction(() => window.__appStore.getState().selectedFace === null);
  await beginSketch(page, 'XZ');
  await line(page, 0, 0, 0, 20);
  await line(page, 15, 0, 7, 20);
  await finishSketch(page);
  const loftPathSketch = (await state(page)).finishedSketches.at(-1);
  const loftPathLines = loftPathSketch.entities.filter((entity) => entity.kind === 'line');
  await page.locator('button[title="Loft"]').click();
  await page.getByTestId('loft-dialog').waitFor({ state: 'visible' });
  await page.getByTestId('loft-continuity').selectOption('g2');
  await page.getByTestId('loft-centerline-enabled').check();
  await page.getByTestId('loft-centerline-sketch').selectOption(loftPathSketch.name);
  await page.getByTestId('loft-guide-enabled').check();
  await page.getByTestId('loft-guide-sketch').selectOption(loftPathSketch.name);
  await page.getByTestId(`loft-guide-${loftPathLines[0].id}`).uncheck();
  await page.getByTestId(`loft-guide-${loftPathLines[1].id}`).check();
  await page.getByTestId('loft-ok').click();
  await page.waitForFunction(() => !window.__appStore.getState().solidBusy && window.__appStore.getState().solidScene.bodies.length === 2, undefined, { timeout: 60_000 });
  app = await state(page);
  check('Loft creates a second stable body', app.solidScene.bodies.length === 2 && app.solidScene.bodies[1].mesh.indices.length > 0);
  check('Loft appears in feature history', app.document.features.at(-1).kind === 'loft');
  await page.close();
}

console.log('5. Rib from a curved analytic centerline');
{
  const page = await freshPage();
  await beginSketch(page, 'XY');
  await arc3pt(page, -20, 0, -10, 20, 0, 20);
  await finishSketch(page);
  const ribSketch = (await state(page)).finishedSketches.at(-1);
  const ribArc = ribSketch.entities.find((entity) => entity.kind === 'arc');
  await page.locator('button[title="Rib"]').click();
  await page.getByTestId('rib-dialog').waitFor({ state: 'visible' });
  check('Rib lists the analytic arc as a centerline', Boolean(ribArc) && await page.getByTestId(`rib-centerline-${ribArc.id}`).isChecked());
  await page.getByTestId('rib-ok').click();
  await page.waitForFunction(() => !window.__appStore.getState().solidBusy && window.__appStore.getState().solidScene.bodies.length === 1, undefined, { timeout: 60_000 });
  const app = await state(page);
  check('Curved Rib produces a thin tessellated solid', app.solidScene.bodies[0].mesh.indices.length > 0);
  check('Rib appears in feature history', app.document.features.at(-1).kind === 'rib');
  await page.close();
}

console.log('6. Rib To Next against a target body');
{
  const page = await freshPage();
  await beginSketch(page, 'XY');
  await rectangle(page, -15, -15, 15, 15);
  await finishSketch(page);
  await extrude(page, 20);
  const bodyId = (await state(page)).solidScene.bodies[0].id;
  await beginSketch(page, 'XY');
  await line(page, -10, 0, 10, 0);
  await finishSketch(page);
  await page.locator('button[title="Rib"]').click();
  await page.getByTestId('rib-dialog').waitFor({ state: 'visible' });
  await page.getByTestId('solid-operation').selectOption('join');
  await page.getByTestId('rib-extent').selectOption('to_next');
  await page.getByTestId('rib-ok').click();
  await page.waitForFunction(() => !window.__appStore.getState().solidBusy, undefined, { timeout: 60_000 });
  const app = await state(page);
  check('Rib To Next keeps the stable target Body ID', app.solidScene.bodies.length === 1 && app.solidScene.bodies[0].id === bodyId);
  check('Rib To Next appears as a valid history feature', app.document.features.at(-1).kind === 'rib' && app.document.features.at(-1).status.state === 'ok');
  await page.close();
}

check('no page errors during advanced solid e2e', errors.length === 0, errors.join(' | '));
await browser.close();
if (failures) {
  console.error(`\ne2e:advanced-solids: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('\ne2e:advanced-solids: all checks passed');
