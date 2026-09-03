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

async function selectProfile(page, owner, sketchName) {
  return page.evaluate(({ ownerName, targetSketch }) => {
    const store = window.__appStore.getState();
    const picker = store.profilePicker;
    if (!picker || picker.owner !== ownerName) {
      throw new Error(`expected ${ownerName} profile picker`);
    }
    const entry = picker.catalog.find((candidate) => candidate.sketch_name === targetSketch);
    const profile = entry?.profiles.find((candidate) => candidate.nesting_depth % 2 === 0);
    if (!profile) throw new Error(`no closed profile in ${targetSketch}`);
    store.replaceProfilePicks(
      ownerName,
      [{ sketch_name: targetSketch, profile_index: profile.index }],
      targetSketch,
    );
    return profile.index;
  }, { ownerName: owner, targetSketch: sketchName });
}

async function selectProfiles(page, owner, sketchNames) {
  await page.evaluate(({ ownerName, targets }) => {
    const store = window.__appStore.getState();
    const picker = store.profilePicker;
    if (!picker || picker.owner !== ownerName) {
      throw new Error(`expected ${ownerName} profile picker`);
    }
    const selected = targets.map((targetSketch) => {
      const entry = picker.catalog.find((candidate) => candidate.sketch_name === targetSketch);
      const profile = entry?.profiles.find((candidate) => candidate.nesting_depth % 2 === 0);
      if (!profile) throw new Error(`no closed profile in ${targetSketch}`);
      return { sketch_name: targetSketch, profile_index: profile.index };
    });
    store.replaceProfilePicks(ownerName, selected, targets.at(-1) ?? '');
  }, { ownerName: owner, targets: sketchNames });
}

async function selectCurves(page, owner, sketchName, entityIds) {
  await page.evaluate(({ ownerName, targetSketch, ids }) => {
    const store = window.__appStore.getState();
    if (store.curvePicker?.owner !== ownerName) {
      throw new Error(`expected ${ownerName} curve picker`);
    }
    store.replaceCurvePicks(
      ownerName,
      ids.map((entityId) => ({ sketchName: targetSketch, entityId })),
      targetSketch,
    );
  }, { ownerName: owner, targetSketch: sketchName, ids: entityIds });
}

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
  await page.evaluate(() => {
    const store = window.__appStore.getState();
    const picker = store.profilePicker;
    if (!picker || picker.owner !== 'extrude') throw new Error('expected Extrude profile picker');
    const entry = [...picker.catalog]
      .reverse()
      .find((candidate) => candidate.profiles.some((profile) => profile.nesting_depth % 2 === 0));
    const profile = entry?.profiles.find((candidate) => candidate.nesting_depth % 2 === 0);
    if (!entry || !profile) throw new Error('no profile available for Extrude');
    store.replaceProfilePicks(
      'extrude',
      [{ sketch_name: entry.sketch_name, profile_index: profile.index }],
      entry.sketch_name,
    );
  });
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
  await finishSketch(page);
  const profileSketch = (await state(page)).finishedSketches.at(-1);
  const boundaryAxis = profileSketch.entities.find(
    (entity) =>
      entity.kind === 'line'
      && Math.abs(entity.start.x - 10) < 1e-6
      && Math.abs(entity.end.x - 10) < 1e-6,
  );

  // A line-only sketch on the same XY plane remains independently eligible;
  // selecting it must not replace the closed profile sketch.
  await beginSketch(page, 'XY');
  await line(page, 0, -20, 0, 20);
  await finishSketch(page);
  const axisSketch = (await state(page)).finishedSketches.at(-1);
  const independentAxis = axisSketch.entities.find(
    (entity) =>
      entity.kind === 'line'
      && Math.abs(entity.start.x) < 1e-6
      && Math.abs(entity.end.x) < 1e-6,
  );
  await page.locator('button[title="Revolve"]').click();
  await page.getByTestId('revolve-dialog').waitFor({ state: 'visible' });
  check(
    'Revolve uses viewport fields instead of an opaque geometry dropdown',
    await page.getByTestId('revolve-axis-line-mode').isVisible()
      && await page.getByTestId('revolve-dialog').locator('[data-testid="revolve-axis-line"]').count() === 0,
  );
  await selectProfile(page, 'revolve', profileSketch.name);
  await page.waitForFunction(
    ([sketchName]) => {
      const picker = window.__appStore.getState().profilePicker;
      return picker?.owner === 'revolve'
        && picker.selected.some((profile) => profile.sketch_name === sketchName);
    },
    [profileSketch.name],
  );
  await page.getByTestId('revolve-axis-selection').click();
  check(
    'Revolve starts its axis step in viewport-pick mode',
    (await state(page)).modelingPickTarget === 'revolve_axis',
  );

  const independentMidpoint = await page.evaluate(() => window.__worldToScreen(0, 0, 0));
  await page.mouse.click(independentMidpoint.x, independentMidpoint.y);
  await page.waitForFunction(
    ([sketchName, entityId]) => {
      const selection = window.__appStore.getState().revolveAxisSelection;
      return selection?.sketchName === sketchName && selection.entityId === entityId;
    },
    [axisSketch.name, independentAxis.id],
  );
  check(
    'a line-only coplanar sketch can be picked without replacing the profile',
    (await state(page)).profilePicker.sketchName === profileSketch.name,
  );

  const boundaryMidpoint = await page.evaluate(() => window.__worldToScreen(10, 0, 0));
  await page.mouse.click(boundaryMidpoint.x, boundaryMidpoint.y);
  await page.waitForFunction(
    ([sketchName, entityId]) => {
      const selection = window.__appStore.getState().revolveAxisSelection;
      return selection?.sketchName === sketchName && selection.entityId === entityId;
    },
    [profileSketch.name, boundaryAxis.id],
  );
  const selectedAxis = (await state(page)).revolveAxisSelection;
  check(
    'a straight profile boundary can be picked as the stable axis',
    selectedAxis?.sketchName === profileSketch.name
      && selectedAxis.entityId === boundaryAxis.id,
  );
  const finishedVisual = await page.evaluate(() => window.__finishedSketchVisualState());
  const emphasizedWidths = finishedVisual.lineWidths.filter(
    (_, index) => finishedVisual.lineEmphasis[index],
  );
  check(
    'selected finished-sketch curves use the high-contrast foreground stroke',
    emphasizedWidths.length > 0 &&
      emphasizedWidths.every((width) => width >= 3)
      && finishedVisual.lineRenderOrders.some((order, index) =>
        finishedVisual.lineEmphasis[index] && order >= 22),
    JSON.stringify(emphasizedWidths),
  );
  const nativeCurvePresentation = await page.evaluate(
    () => window.__nativeViewportPresentation(),
  );
  check(
    'Bevy receives selected finished-sketch curves for Revolve/Sweep/Loft/Rib',
    nativeCurvePresentation.selectedFinishedSketchEntities.some(
      (reference) =>
        reference.sketchName === profileSketch.name
        && reference.entityId === boundaryAxis.id,
    ),
  );
  await page.getByTestId('solid-operation').selectOption('cut');
  await page.evaluate((bodyId) => {
    window.__appStore.getState().replaceSelectedBodies([bodyId]);
  }, base.id);
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="revolve-ok"]')?.disabled,
  );
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
  const profileSketch = (await state(page)).finishedSketches.at(-1);
  await beginSketch(page, 'YZ');
  await arc3pt(page, 0, 0, 10, 0, 20, 20);
  await finishSketch(page);
  const pathSketch = (await state(page)).finishedSketches.at(-1);
  const pathArc = pathSketch.entities.find((entity) => entity.kind === 'arc');
  await page.locator('button[title="Sweep"]').click();
  await page.getByTestId('sweep-dialog').waitFor({ state: 'visible' });
  check(
    'Sweep opens with viewport profile selection active',
    (await state(page)).modelingPickTarget === 'sweep_profile',
  );
  await selectProfile(page, 'sweep', profileSketch.name);
  await page.getByTestId('sweep-path-selection').click();
  await selectCurves(page, 'sweep_path', pathSketch.name, [pathArc.id]);
  check(
    'Sweep accepts the analytic arc through its viewport-backed path field',
    (await state(page)).curvePicker.selected.some(
      (curve) => curve.sketchName === pathSketch.name && curve.entityId === pathArc.id,
    ),
  );
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
  const profileSketch = (await state(page)).finishedSketches.at(-1);
  await beginSketch(page, 'YZ');
  await line(page, 0, 0, 0, 30);
  await line(page, 10, 0, 10, 30);
  await finishSketch(page);
  const guideSketch = (await state(page)).finishedSketches.at(-1);
  const guideLines = guideSketch.entities.filter((entity) => entity.kind === 'line');
  await page.locator('button[title="Sweep"]').click();
  await page.getByTestId('sweep-dialog').waitFor({ state: 'visible' });
  await selectProfile(page, 'sweep', profileSketch.name);
  await page.getByTestId('sweep-path-selection').click();
  await selectCurves(page, 'sweep_path', guideSketch.name, [guideLines[0].id]);
  await page.getByTestId('sweep-guide-enabled').check();
  const retainedPathFeedback = await page.evaluate(
    () => window.__nativeViewportPresentation().selectedFinishedSketchEntities,
  );
  check(
    'selected path stays highlighted while the guide field owns the picker',
    retainedPathFeedback.some(
      (reference) =>
        reference.sketchName === guideSketch.name
        && reference.entityId === guideLines[0].id,
    ),
  );
  await selectCurves(page, 'sweep_guide', guideSketch.name, [guideLines[1].id]);
  const pathAndGuideFeedback = await page.evaluate(
    () => window.__nativeViewportPresentation().selectedFinishedSketchEntities,
  );
  check(
    'shared feedback keeps both completed curve fields visible',
    guideLines.every((line) =>
      pathAndGuideFeedback.some(
        (reference) =>
          reference.sketchName === guideSketch.name
          && reference.entityId === line.id,
      )),
  );
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
  const baseSketch = (await state(page)).finishedSketches.at(-1);
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
  const topSketch = (await state(page)).finishedSketches.at(-1);
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
  await selectProfiles(page, 'loft', [baseSketch.name, topSketch.name]);
  await page.getByTestId('loft-continuity').selectOption('g2');
  await page.getByTestId('loft-centerline-enabled').check();
  await selectCurves(
    page,
    'loft_centerline',
    loftPathSketch.name,
    [loftPathLines[0].id],
  );
  await page.getByTestId('loft-guide-enabled').check();
  await selectCurves(
    page,
    'loft_guide',
    loftPathSketch.name,
    [loftPathLines[1].id],
  );
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
  await selectCurves(page, 'rib_centerline', ribSketch.name, [ribArc.id]);
  check(
    'Rib accepts the analytic arc through its viewport-backed centerline field',
    (await state(page)).curvePicker.selected.some(
      (curve) => curve.sketchName === ribSketch.name && curve.entityId === ribArc.id,
    ),
  );
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
  const ribSketch = (await state(page)).finishedSketches.at(-1);
  const ribLine = ribSketch.entities.find((entity) => entity.kind === 'line');
  await page.locator('button[title="Rib"]').click();
  await page.getByTestId('rib-dialog').waitFor({ state: 'visible' });
  await selectCurves(page, 'rib_centerline', ribSketch.name, [ribLine.id]);
  await page.getByTestId('solid-operation').selectOption('join');
  await page.getByTestId('rib-targets-selection').click();
  await page.evaluate((targetBodyId) => {
    window.__appStore.getState().replaceSelectedBodies([targetBodyId]);
  }, bodyId);
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
