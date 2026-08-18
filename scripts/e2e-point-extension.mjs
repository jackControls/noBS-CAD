/**
 * Point-tool virtual-extension acquisition regression.
 *
 * A unique nearby line continuation creates a persistent Coincident relation;
 * equal candidates are deliberately left unconstrained.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE = 'http://localhost:7199';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error)));

const state = () => page.evaluate(() => window.__appStore.getState());
const sketchPoint = (x, y) =>
  page.evaluate(([sx, sy]) => window.__sketchToScreen(sx, sy), [x, y]);
const clickSketch = async (x, y) => {
  const point = await sketchPoint(x, y);
  await page.mouse.click(point.x, point.y);
};
const moveSketch = async (x, y) => {
  const point = await sketchPoint(x, y);
  await page.mouse.move(point.x, point.y, { steps: 5 });
};
const activatePoint = async () => {
  await page.getByRole('button', { name: 'DRAW', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Point', exact: true }).click();
};
const stopCreateTool = async () => {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
};

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Create Sketch' }).first().click();
  await page.waitForTimeout(350);
  if (!(await page.getByText('XY Plane', { exact: true }).isVisible())) {
    await page.getByRole('button', { name: 'Origin' }).click();
    await page.waitForTimeout(150);
  }
  await page.getByText('XY Plane', { exact: true }).click();
  await page.waitForTimeout(900);

  await page.locator('button[title="Line"]').click();
  await clickSketch(0, 0);
  await clickSketch(40, 0);
  await stopCreateTool();
  let active = (await state()).activeSketch;
  const carrier = active.entities.find(
    (entity) =>
      entity.kind === 'line' &&
      Math.abs(entity.start.y) < 1e-7 &&
      Math.abs(entity.end.y) < 1e-7,
  );
  assert.ok(carrier, 'horizontal carrier line was created');

  await activatePoint();
  await moveSketch(60, 1);
  await page.waitForTimeout(100);
  assert.notEqual(
    await page.getByTestId('inference-chips').evaluate((element) => element.style.display),
    'none',
    'unique virtual extension shows coincidence acquisition feedback',
  );
  const extensionTransient = await page.evaluate(
    () => window.__nativeViewportTransient(),
  );
  assert.ok(
    extensionTransient.lines.some((layer) => layer.pattern === 'dotted'),
    'virtual point-to-line extension must use the shared dotted alignment-guide style',
  );
  const pointIdsBefore = new Set(
    active.entities
      .filter((entity) => entity.kind === 'point')
      .map((entity) => entity.id),
  );
  const pointCountBefore = pointIdsBefore.size;
  await clickSketch(60, 1);
  await page.waitForFunction(
    (before) =>
      window.__appStore
        .getState()
        .activeSketch.entities.filter((entity) => entity.kind === 'point').length ===
      before + 1,
    pointCountBefore,
  );
  active = (await state()).activeSketch;
  const extensionPoint = active.entities
    .filter((entity) => entity.kind === 'point')
    .find((entity) => !pointIdsBefore.has(entity.id));
  assert.ok(extensionPoint, 'point projects onto the virtual line extension');
  const lineDx = carrier.end.x - carrier.start.x;
  const lineDy = carrier.end.y - carrier.start.y;
  const fromStartX = extensionPoint.position.x - carrier.start.x;
  const fromStartY = extensionPoint.position.y - carrier.start.y;
  const lineLengthSquared = lineDx * lineDx + lineDy * lineDy;
  const pointParameter =
    (fromStartX * lineDx + fromStartY * lineDy) / lineLengthSquared;
  assert.ok(
    Math.abs(fromStartX * lineDy - fromStartY * lineDx) < 1e-5 &&
      pointParameter > 1,
    'new point is collinear with and beyond the finite carrier',
  );
  assert.ok(
    active.constraints.some(
      (constraint) =>
        constraint.type === 'coincident' &&
        constraint.a === extensionPoint.id &&
        constraint.b === carrier.id,
    ),
    'extension placement stores a persistent Point-to-Line Coincident relation',
  );

  // Remove the point, then add a second line whose continuation reaches the
  // same cursor location. Neither line may win this exact tie.
  await page.keyboard.press('Control+z');
  await page.waitForFunction(
    (id) =>
      !window.__appStore
        .getState()
        .activeSketch.entities.some((entity) => entity.id === id),
    extensionPoint.id,
  );
  await stopCreateTool();
  await page.locator('button[title="Line"]').click();
  await clickSketch(60, -40);
  await clickSketch(60, -20);
  await stopCreateTool();

  active = (await state()).activeSketch;
  const coincidentBefore = active.constraints.filter(
    (constraint) => constraint.type === 'coincident',
  ).length;
  const pointsBeforeAmbiguous = active.entities.filter(
    (entity) => entity.kind === 'point',
  ).length;
  await activatePoint();
  await moveSketch(60, 0);
  await page.waitForTimeout(100);
  assert.equal(
    await page.getByTestId('inference-chips').evaluate((element) => element.style.display),
    'none',
    'equal virtual-extension candidates do not advertise an arbitrary relation',
  );
  await clickSketch(60, 0);
  await page.waitForFunction(
    (before) =>
      window.__appStore
        .getState()
        .activeSketch.entities.filter((entity) => entity.kind === 'point').length ===
      before + 1,
    pointsBeforeAmbiguous,
  );
  active = (await state()).activeSketch;
  assert.equal(
    active.constraints.filter((constraint) => constraint.type === 'coincident').length,
    coincidentBefore,
    'ambiguous placement remains free of an arbitrary line constraint',
  );
  assert.deepEqual(pageErrors, []);

  console.log('  [ok] point extension acquisition and ambiguity filtering');
} finally {
  await browser.close();
}
