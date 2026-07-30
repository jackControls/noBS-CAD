/**
 * noBS CAD M3 Revolve end-to-end verification.
 *
 * Real UI path:
 *   offset rectangle sketch → New Body Revolve → body/tree/history →
 *   rollback/replay → timeline edit from 360° to 180°.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const BASE = 'http://localhost:7199';
const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, '..', 'docs', 'qa', 'm3');
fs.mkdirSync(shots, { recursive: true });

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  [${ok ? 'ok' : 'FAIL'}] ${name}${ok ? '' : ` — ${detail}`}`);
  if (!ok) failures += 1;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on('pageerror', (error) => {
  pageErrors.push(String(error));
  console.log('PAGEERROR:', String(error).slice(0, 300));
});

const state = () => page.evaluate(() => window.__appStore.getState());
const clickSketch = async (x, y) => {
  const point = await page.evaluate(
    ([sketchX, sketchY]) => window.__sketchToScreen(sketchX, sketchY),
    [x, y],
  );
  // Move first, as a real pointer does. The dynamic-input cluster follows
  // pointermove; wait until its previous frame no longer covers the intended
  // geometry point before pressing.
  await page.mouse.move(point.x, point.y);
  await page.waitForFunction(
    ({ clientX, clientY }) =>
      !document.elementFromPoint(clientX, clientY)?.closest('[data-dyn-input]'),
    { clientX: point.x, clientY: point.y },
  );
  await page.mouse.down();
  await page.mouse.up();
};
const shot = (name) => page.screenshot({ path: path.join(shots, `${name}.png`) });

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  console.log('1. closed profile on one side of the Y axis');
  await page.getByRole('button', { name: 'Create Sketch' }).first().click();
  await page.waitForTimeout(250);
  if (!(await page.getByText('XY Plane', { exact: true }).isVisible())) {
    await page.getByRole('button', { name: 'Origin' }).click();
  }
  await page.getByText('XY Plane', { exact: true }).click();
  await page.waitForFunction(() => window.__appStore.getState().mode === 'sketch');
  await page.locator('button[title="Rectangle"]').click();
  await page.waitForFunction(
    () => window.__appStore.getState().activeTool === 'rect2pt',
  );
  await clickSketch(10, -15);
  await page.waitForFunction(() => {
    const dyn = window.__appStore.getState().dynInput;
    return (
      dyn.active
      && dyn.fields.some((field) => field.key === 'width')
      && dyn.fields.some((field) => field.key === 'height')
    );
  });
  await clickSketch(30, 15);
  await page.waitForFunction(() => {
    const state = window.__appStore.getState();
    return (
      state.activeSketch?.entities.filter((entity) => entity.kind === 'line')
        .length === 4
    );
  });
  await page.getByRole('button', { name: 'FINISH SKETCH', exact: true }).click();
  await page.waitForFunction(() => window.__appStore.getState().mode === 'solid');

  console.log('2. full New Body Revolve through OpenCascade.js');
  await page.locator('button[title="Revolve"]').click();
  const dialog = page.getByTestId('revolve-dialog');
  await dialog.waitFor({ state: 'visible' });
  await page.waitForFunction(
    () =>
      document.querySelectorAll(
        '[data-testid="revolve-dialog"] input[type="checkbox"]',
      ).length > 0,
  );
  check(
    'profile and sketch Y axis are selected by default',
    (await dialog.locator('input[type="checkbox"]').first().isChecked()) &&
      (await page.getByTestId('revolve-axis').inputValue()) === 'y',
  );
  check(
    'full revolution defaults to 360 degrees',
    (await page.getByTestId('revolve-angle').inputValue()) === '360',
  );
  await page.getByTestId('revolve-ok').click();
  await page.waitForFunction(
    () =>
      window.__appStore.getState().solidScene.bodies.length === 1 &&
      !window.__appStore.getState().solidBusy,
    undefined,
    { timeout: 60_000 },
  );

  let app = await state();
  const bodyId = app.solidScene.bodies[0].id;
  const fullIndexCount = app.solidScene.bodies[0].mesh.indices.length;
  check(
    'OCCT returned curved topology and a selectable mesh',
    fullIndexCount > 0 &&
      app.solidScene.bodies[0].faces.some((face) => face.plane === null),
  );
  check(
    'Body1 is selected and present in the browser tree',
    app.selectedBody === bodyId &&
      (await page.getByRole('treeitem').filter({ hasText: /^Body1/ }).isVisible()),
  );
  check(
    'Revolve is persisted as a real timeline feature',
    app.document.features.map((feature) => `${feature.name}:${feature.kind}`).join(',') ===
      'Sketch1:sketch,Revolve1:revolve',
  );
  await shot('m3-01-full-revolve');

  console.log('3. rollback/replay preserves the stable Body ID');
  await page.locator('button[title="Previous feature"]').click();
  await page.waitForFunction(
    () =>
      window.__appStore.getState().document.rollback_index === 1 &&
      window.__appStore.getState().solidScene.bodies.length === 0,
  );
  await page.locator('button[title="Next feature"]').click();
  await page.waitForFunction(
    () =>
      window.__appStore.getState().document.rollback_index === 2 &&
      window.__appStore.getState().solidScene.bodies.length === 1,
    undefined,
    { timeout: 60_000 },
  );
  check(
    'replay restores the same stable Body ID',
    (await state()).solidScene.bodies[0].id === bodyId,
  );

  console.log('4. timeline edit recomputes a partial revolution');
  app = await state();
  const revolve = app.document.features.find((feature) => feature.kind === 'revolve');
  await page.locator(`[data-feature-id="${revolve.id}"]`).dblclick();
  await dialog.waitFor({ state: 'visible' });
  check(
    'timeline edit restores the saved 360 degree definition',
    (await page.getByTestId('revolve-angle').inputValue()) === '360',
  );
  await page.getByTestId('revolve-angle').fill('180');
  await page.getByTestId('revolve-ok').click();
  await page.waitForFunction(
    () =>
      window.__appStore.getState().solidScene.bodies.length === 1 &&
      !window.__appStore.getState().solidBusy,
    undefined,
    { timeout: 60_000 },
  );
  app = await state();
  check('editing preserves the stable Body ID', app.solidScene.bodies[0].id === bodyId);
  check(
    'partial revolution recomputed different tessellation',
    app.solidScene.bodies[0].mesh.indices.length !== fullIndexCount,
    `${fullIndexCount} → ${app.solidScene.bodies[0].mesh.indices.length}`,
  );
  await shot('m3-02-partial-revolve');

  check('no page errors during Revolve e2e', pageErrors.length === 0, pageErrors.join(' | '));
} finally {
  await browser.close();
}

if (failures > 0) {
  console.error(`\ne2e:revolve: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('\ne2e:revolve: all checks passed');
