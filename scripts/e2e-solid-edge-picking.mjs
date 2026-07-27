/**
 * Solid Fillet/Chamfer direct edge-picking regression:
 * dialogs remain modeless over the canvas, hover pre-highlights topology,
 * and ordinary clicks toggle persistent multi-edge selection.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE = 'http://localhost:7199';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error)));

const state = () => page.evaluate(() => window.__appStore.getState());

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(
    () => window.__appStore?.getState().document !== null && !!window.__engine,
  );

  await page.evaluate(async () => {
    const engine = window.__engine;
    await engine.beginSketch({ type: 'origin_plane', plane: 'xy' });
    await engine.addRectangle({
      mode: 'two_point',
      p1: { x: -30, y: -20 },
      p2: { x: 30, y: 20 },
      ctrl_held: false,
    });
    await engine.endSketch();
    const update = await engine.extrude({
      sketch_name: 'Sketch1',
      profile_indices: [0],
      operation: 'new_body',
      extent: { type: 'distance', distance: 20 },
      taper_angle_deg: 0,
      flip: false,
      target_body_ids: [],
    });
    const store = window.__appStore.getState();
    store.applySolidUpdate(update);
    store.setFinishedSketches(await engine.finishedSketches());
    store.setSelectedBody(update.scene.bodies[0].id);
    store.setSelectedEdges([]);
    window.__cameraApi.fit();
  });
  await page.waitForFunction(
    () => window.__appStore.getState().solidScene.bodies.length === 1,
    undefined,
    { timeout: 60_000 },
  );
  await page.waitForTimeout(500);

  const candidates = await page.evaluate(() => {
    const body = window.__appStore.getState().solidScene.bodies[0];
    const maxZ = Math.max(...body.edges.flatMap((edge) => edge.points.map((point) => point.z)));
    return body.edges
      .filter(
        (edge) =>
          edge.refinable
          &&
          edge.points.length >= 2
          && edge.points.every((point) => Math.abs(point.z - maxZ) < 1e-6),
      )
      .map((edge) => {
        const a = edge.points[0];
        const b = edge.points[edge.points.length - 1];
        const world = [(a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2];
        return {
          edgeId: edge.id,
          screen: window.__worldToScreen(...world),
        };
      })
      .filter((edge) => edge.screen.x > 230 && edge.screen.x < 1030);
  });
  assert.ok(candidates.length >= 3, `expected at least three visible top edges, got ${candidates.length}`);

  console.log('1. Solid Fillet direct edge picking');
  await page.locator('button[title="Fillet"]').first().click();
  const filletDialog = page.getByTestId('solid-fillet-dialog');
  await filletDialog.waitFor({ state: 'visible' });
  const filletSelection = page.getByTestId('solid-fillet-edge-selection');
  await filletSelection.waitFor({ state: 'visible' });
  assert.match(await filletSelection.innerText(), /Click edges directly on the solid/);
  assert.equal(
    await filletDialog.locator('input[type="checkbox"]').count(),
    1,
    'only Tangent Chain remains a checkbox; edges are canvas-picked',
  );

  await page.mouse.move(candidates[0].screen.x, candidates[0].screen.y);
  await page.waitForFunction(
    (edgeId) => window.__appStore.getState().hoveredEdge === edgeId,
    candidates[0].edgeId,
  );
  let visual = await page.evaluate(
    (edgeId) => window.__solidEdgeVisualState(edgeId),
    candidates[0].edgeId,
  );
  assert.deepEqual(
    visual.overlayKinds,
    ['hover'],
    'hovered usable edge should get one restrained preselection stroke',
  );
  assert.ok(
    visual.overlayWidths.every((width) => Math.abs(width - 1.5) < 1e-6),
    'hover preselection should be exactly 50% wider than the topology line',
  );
  assert.equal(visual.renderOrder, 4);

  await page.mouse.click(candidates[0].screen.x, candidates[0].screen.y);
  await page.waitForFunction(
    (edgeId) => window.__appStore.getState().selectedEdges.includes(edgeId),
    candidates[0].edgeId,
  );
  visual = await page.evaluate(
    (edgeId) => window.__solidEdgeVisualState(edgeId),
    candidates[0].edgeId,
  );
  assert.deepEqual(
    visual.overlayKinds,
    ['selected'],
    'selected edge should retain one persistent stroke',
  );
  assert.ok(
    visual.overlayWidths.every((width) => Math.abs(width - 1.5) < 1e-6),
    'selected edge should remain exactly 50% wider than default',
  );
  assert.equal(visual.depthTest, false);
  assert.equal(visual.renderOrder, 5);
  assert.match(await filletSelection.innerText(), /1 edge selected/);

  await page.mouse.click(candidates[1].screen.x, candidates[1].screen.y);
  await page.waitForFunction(
    (ids) => ids.every((id) => window.__appStore.getState().selectedEdges.includes(id)),
    [candidates[0].edgeId, candidates[1].edgeId],
  );
  assert.match(await filletSelection.innerText(), /2 edges selected/);

  // Edge-tool clicks toggle without requiring Shift/Ctrl.
  await page.mouse.click(candidates[0].screen.x, candidates[0].screen.y);
  await page.waitForFunction(
    ([removed, kept]) => {
      const selected = window.__appStore.getState().selectedEdges;
      return !selected.includes(removed) && selected.includes(kept);
    },
    [candidates[0].edgeId, candidates[1].edgeId],
  );
  assert.match(await filletSelection.innerText(), /1 edge selected/);
  await page.getByTestId('solid-fillet-clear-edges').click();
  await page.waitForFunction(() => window.__appStore.getState().selectedEdges.length === 0);
  assert.match(await filletSelection.innerText(), /Click edges directly on the solid/);
  await page.getByTestId('solid-fillet-cancel').click();

  console.log('2. Solid Chamfer uses the same canvas picker');
  await page.locator('button[title="Chamfer"]').first().click();
  const chamferDialog = page.getByTestId('solid-chamfer-dialog');
  await chamferDialog.waitFor({ state: 'visible' });
  const chamferSelection = page.getByTestId('solid-chamfer-edge-selection');
  await chamferSelection.waitFor({ state: 'visible' });
  await page.mouse.move(candidates[2].screen.x, candidates[2].screen.y);
  await page.waitForFunction(
    (edgeId) => window.__appStore.getState().hoveredEdge === edgeId,
    candidates[2].edgeId,
  );
  await page.mouse.click(candidates[2].screen.x, candidates[2].screen.y);
  await page.waitForFunction(
    (edgeId) => window.__appStore.getState().selectedEdges.includes(edgeId),
    candidates[2].edgeId,
  );
  assert.match(await chamferSelection.innerText(), /1 edge selected/);
  visual = await page.evaluate(
    (edgeId) => window.__solidEdgeVisualState(edgeId),
    candidates[2].edgeId,
  );
  assert.deepEqual(visual.overlayKinds, ['selected']);
  assert.deepEqual(visual.overlayWidths, [1.5]);
  await page.getByTestId('solid-chamfer-ok').click();
  await page.waitForFunction(
    () => {
      const app = window.__appStore.getState();
      return !app.solidBusy && app.document.features.at(-1)?.kind === 'chamfer';
    },
    undefined,
    { timeout: 60_000 },
  );
  assert.equal((await state()).solidScene.bodies.length, 1);

  console.log('3. Smooth cylinder seams are filtered before hover/click selection');
  await page.evaluate(async () => {
    const engine = window.__engine;
    const store = window.__appStore.getState();
    store.applySolidUpdate(await engine.newProject());
    await engine.beginSketch({ type: 'origin_plane', plane: 'xy' });
    await engine.setGridSnap(false);
    await engine.addCircle({
      mode: 'center_diameter',
      p1: { x: 0, y: 0 },
      p2: { x: 20, y: 0 },
      ctrl_held: true,
    });
    const ended = await engine.endSketch();
    store.setDocument(ended.document);
    store.setFinishedSketches(await engine.finishedSketches());
    const update = await engine.extrude({
      sketch_name: 'Sketch1',
      profile_indices: [0],
      operation: 'new_body',
      extent: { type: 'distance', distance: 20 },
      taper_angle_deg: 0,
      flip: false,
      target_body_ids: [],
    });
    store.applySolidUpdate(update);
    store.setMode('solid');
    store.setSelectedBody(update.scene.bodies[0].id);
    store.setSelectedEdges([]);
    window.__cameraApi.fit();
  });
  await page.waitForTimeout(500);
  const invalidEdge = await page.evaluate(() => {
    const body = window.__appStore.getState().solidScene.bodies[0];
    const edge = body.edges
      .filter((candidate) => !candidate.refinable && candidate.points.length >= 2)
      .sort((left, right) => {
        const span = (candidate) => {
          const first = candidate.points[0];
          const last = candidate.points[candidate.points.length - 1];
          return Math.hypot(last.x - first.x, last.y - first.y, last.z - first.z);
        };
        return span(right) - span(left);
      })[0];
    if (!edge) return null;
    const first = edge.points[0];
    const last = edge.points[edge.points.length - 1];
    return {
      edgeId: edge.id,
      screen: window.__worldToScreen(
        (first.x + last.x) / 2,
        (first.y + last.y) / 2,
        (first.z + last.z) / 2,
      ),
    };
  });
  assert.ok(invalidEdge, 'a cylinder should expose a cached non-refinable smooth seam');
  await page.locator('button[title="Fillet"]').first().click();
  await page.getByTestId('solid-fillet-dialog').waitFor({ state: 'visible' });
  await page.mouse.move(invalidEdge.screen.x, invalidEdge.screen.y);
  await page.waitForTimeout(150);
  assert.equal((await state()).hoveredEdge, null);
  await page.mouse.click(invalidEdge.screen.x, invalidEdge.screen.y);
  assert.deepEqual((await state()).selectedEdges, []);
  await page.getByTestId('solid-fillet-cancel').click();

  assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join('\n')}`);

  console.log('  [ok] sharp-edge picking works and smooth seams are rejected live');
} finally {
  await browser.close();
}
