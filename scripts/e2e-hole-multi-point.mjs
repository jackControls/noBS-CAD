/**
 * Hole interaction regression:
 *   base sketch point/line endpoint → extruded body → one-click support-face
 *   and snap selection → one associative Hole feature with two positions.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'http://localhost:7199';
const here = path.dirname(fileURLToPath(import.meta.url));
const qa = path.join(here, '..', 'docs', 'qa');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error)));

const screenPoint = (world) =>
  page.evaluate(
    ({ x, y, z }) => window.__worldToScreen(x, y, z),
    world,
  );

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(
    () => window.__appStore?.getState().document !== null && !!window.__engine,
  );

  const setup = await page.evaluate(async () => {
    const engine = window.__engine;
    const store = window.__appStore.getState();
    store.applySolidUpdate(await engine.newProject());
    await engine.beginSketch({ type: 'origin_plane', plane: 'xy' });
    await engine.setGridSnap(false);
    await engine.addRectangle({
      mode: 'two_point',
      p1: { x: -20, y: -15 },
      p2: { x: 20, y: 15 },
      ctrl_held: true,
    });
    await engine.addPoint({ position: { x: -8, y: 0 } });
    await engine.addLine({
      from: { x: 8, y: 0 },
      to_raw: { x: 12, y: 0 },
      ctrl_held: true,
    });
    let ended = await engine.endSketch();
    store.setDocument(ended.document);
    store.setFinishedSketches(await engine.finishedSketches());
    let update = await engine.extrude({
      sketch_name: 'Sketch1',
      profile_indices: [0],
      operation: 'new_body',
      extent: { type: 'distance', distance: 10 },
      taper_angle_deg: 0,
      flip: false,
      target_body_ids: [],
    });
    store.applySolidUpdate(update);
    const body = update.scene.bodies[0];
    const face = body.faces
      .filter((candidate) => candidate.plane)
      .sort((a, b) => b.plane.origin[2] - a.plane.origin[2])[0];
    const finished = await engine.finishedSketches();
    store.setFinishedSketches(finished);
    store.setMode('solid');
    store.clearSolidSelection();
    const pointSketch = finished.find((candidate) => candidate.name === 'Sketch1');
    const standalonePoint = pointSketch.entities.find(
      (entity) =>
        entity.kind === 'point'
        && Math.abs(entity.position.x + 8) < 1e-6
        && Math.abs(entity.position.y) < 1e-6,
    );
    const referenceLine = pointSketch.entities.find(
      (entity) =>
        entity.kind === 'line'
        && Math.abs(entity.start.x - 8) < 1e-6
        && Math.abs(entity.start.y) < 1e-6,
    );
    const sourceWorld = (x, y) => ({
      x: pointSketch.basis.origin[0] + pointSketch.basis.u[0] * x + pointSketch.basis.v[0] * y,
      y: pointSketch.basis.origin[1] + pointSketch.basis.u[1] * x + pointSketch.basis.v[1] * y,
      z: pointSketch.basis.origin[2] + pointSketch.basis.u[2] * x + pointSketch.basis.v[2] * y,
    });
    const projectedWorld = (x, y) => {
      const world = sourceWorld(x, y);
      const normal = face.plane.normal;
      const delta = [
        world.x - face.plane.origin[0],
        world.y - face.plane.origin[1],
        world.z - face.plane.origin[2],
      ];
      const offset = delta[0] * normal[0] + delta[1] * normal[1] + delta[2] * normal[2];
      return {
        x: world.x - normal[0] * offset,
        y: world.y - normal[1] * offset,
        z: world.z - normal[2] * offset,
      };
    };
    return {
      points: [projectedWorld(-8, 0), projectedWorld(8, 0)],
      faceId: face.id,
      referencePointIds: [standalonePoint.id, referenceLine.start_id],
    };
  });

  console.log('1. Open Hole with no preselected support face');
  await page.locator('button[title="Hole"]').first().click();
  const dialog = page.getByTestId('hole-dialog');
  await dialog.waitFor({ state: 'visible' });
  await page.waitForFunction(
    () => !window.__appStore.getState().solidBusy,
  );
  assert.equal(
    await page.evaluate(() => window.__appStore.getState().selectedFace),
    null,
    'opening Hole must not require a separate support-face click',
  );
  const holeControlOrder = await dialog.evaluate((root) => {
    const positionInputs = Array.from(
      root.querySelectorAll('[data-dimension-input]'),
    ).slice(0, 2);
    const style = root.querySelector('[data-testid="hole-style"]');
    const threaded = root.querySelector('[data-testid="hole-threaded"]');
    if (positionInputs.length !== 2 || !style || !threaded) return null;
    return {
      positionBottom: Math.max(
        ...positionInputs.map((input) => input.getBoundingClientRect().bottom),
      ),
      styleTop: style.getBoundingClientRect().top,
      styleBottom: style.getBoundingClientRect().bottom,
      threadedTop: threaded.getBoundingClientRect().top,
    };
  });
  assert.ok(holeControlOrder, 'Hole positions, style, and threaded controls render');
  assert.ok(
    holeControlOrder.styleTop > holeControlOrder.positionBottom,
    'Hole Style appears immediately after Positions',
  );
  assert.ok(
    holeControlOrder.styleBottom < holeControlOrder.threadedTop,
    'Hole Style precedes the remaining Hole feature options',
  );

  console.log('2. Pick the support face and a base-sketch point in one click');
  for (let index = 0; index < setup.points.length; index += 1) {
    const point = await screenPoint(setup.points[index]);
    await page.mouse.move(point.x, point.y);
    await page.waitForFunction(
      ({ entityId }) => {
        const hover = window.__appStore.getState().holePositionHover;
        return window.__finishedSketchVisualState().pointCount >= 4
          && hover?.entity_id === entityId;
      },
      { entityId: setup.referencePointIds[index] },
    );
    const hoverPresentation = await page.evaluate(() => {
      const visuals = window.__finishedSketchVisualState();
      const hoverColor = getComputedStyle(document.documentElement)
        .getPropertyValue('--cad-hover')
        .trim()
        .replace('#', '');
      return { visuals, hoverColor };
    });
    const { visuals } = hoverPresentation;
    assert.ok(visuals.lineDepthTests.length > 0);
    assert.ok(
      visuals.lineDepthTests.every((depthTest) => !depthTest),
      'visible finished sketches must remain readable through the solid',
    );
    assert.ok(
      visuals.pointDepthTests.every((depthTest) => !depthTest),
      'hole snap markers must remain readable through the solid',
    );
    const hoverOutlineIndex = visuals.pointRoles.indexOf('hole-hover-outline');
    const hoverFillIndex = visuals.pointRoles.indexOf('hole-hover-fill');
    assert.ok(
      hoverOutlineIndex >= 0,
      `Hole point ${index + 1} has a visible hover outline`,
    );
    assert.ok(
      hoverFillIndex >= 0,
      `Hole point ${index + 1} has a visible hover fill`,
    );
    assert.equal(visuals.pointSizes[hoverOutlineIndex], 14);
    assert.equal(visuals.pointSizes[hoverFillIndex], 10);
    assert.equal(
      visuals.pointColors[hoverFillIndex],
      hoverPresentation.hoverColor,
    );
    assert.equal(
      visuals.pointPositionCounts[hoverFillIndex],
      1,
      'only the acquired Hole point receives the hover treatment',
    );
    await page.mouse.click(point.x, point.y);
    await page.waitForFunction(
      ({ count, faceId }) => {
        const state = window.__appStore.getState();
        return state.selectedFace === faceId && state.holePositionSelections.length === count;
      },
      { count: index + 1, faceId: setup.faceId },
    );
  }
  assert.match(await dialog.innerText(), /2 associative hole positions selected/i);
  const selectedPointVisual = await page.evaluate(() => {
    const visuals = window.__finishedSketchVisualState();
    const selectedColor = getComputedStyle(document.documentElement)
      .getPropertyValue('--cad-hole-point-selected')
      .trim()
      .replace('#', '');
    return { visuals, selectedColor };
  });
  const outlineIndex = selectedPointVisual.visuals.pointRoles.indexOf(
    'hole-selected-outline',
  );
  const fillIndex = selectedPointVisual.visuals.pointRoles.indexOf(
    'hole-selected-fill',
  );
  assert.ok(outlineIndex >= 0, 'selected Hole points have a contrast outline');
  assert.ok(fillIndex >= 0, 'selected Hole points have a committed-color fill');
  assert.equal(selectedPointVisual.visuals.pointSizes[outlineIndex], 12);
  assert.equal(selectedPointVisual.visuals.pointSizes[fillIndex], 8);
  assert.equal(
    selectedPointVisual.visuals.pointColors[fillIndex],
    selectedPointVisual.selectedColor,
  );
  assert.equal(
    selectedPointVisual.visuals.pointPositionCounts[fillIndex],
    2,
    'both selected Hole positions use the committed marker',
  );
  const nativeHolePresentation = await page.evaluate(
    () => window.__nativeViewportTransient(),
  );
  assert.ok(
    nativeHolePresentation.points.reduce(
      (count, layer) => count + layer.positions.length / 3,
      0,
    ) >= 4,
    'Bevy receives both outlined and filled associative Hole position markers',
  );
  assert.ok(
    nativeHolePresentation.triangles.some((layer) => layer.positions.length >= 18),
    'the selected positions publish translucent cutter geometry to Bevy',
  );
  assert.equal(
    nativeHolePresentation.arrows.length,
    2,
    'each selected hole receives a cutting-direction arrow',
  );
  const initialDirection = nativeHolePresentation.arrows[0].end.map(
    (value, index) => value - nativeHolePresentation.arrows[0].start[index],
  );
  await page.getByTestId('hole-flip').check();
  await page.waitForFunction(
    () => window.__appStore.getState().solidCommandPreview?.kind === 'hole'
      && window.__appStore.getState().solidCommandPreview.flip,
  );
  const flippedDirection = await page.evaluate(() => {
    const arrow = window.__nativeViewportTransient().arrows[0];
    return arrow.end.map((value, index) => value - arrow.start[index]);
  });
  assert.ok(
    initialDirection.reduce(
      (sum, value, index) => sum + value * flippedDirection[index],
      0,
    ) < 0,
    'Flip cutting direction reverses the live preview arrow',
  );
  await page.getByTestId('hole-flip').uncheck();
  await page.screenshot({
    path: path.join(qa, 'hole-selection-contrast-light.png'),
  });

  console.log('3. Create both holes with one 118° pointed-bottom feature');
  await page.getByTestId('hole-extent').selectOption('distance');
  assert.equal(await page.getByTestId('hole-bottom-style').inputValue(), 'drill_point');
  assert.equal(await page.getByTestId('hole-drill-point-angle').inputValue(), '118');
  await page.getByTestId('hole-ok').click();
  await page.waitForFunction(
    () =>
      window.__appStore
        .getState()
        .document.features.some((feature) => feature.name === 'Hole1')
      && !window.__appStore.getState().solidBusy,
    undefined,
    { timeout: 60_000 },
  );
  const result = await page.evaluate(async () => ({
    definitions: await window.__engine.holeDefinitions(),
    state: window.__appStore.getState(),
  }));
  assert.equal(result.definitions.length, 1);
  assert.equal(result.definitions[0].positions.length, 2);
  assert.deepEqual(
    result.definitions[0].positions.map((position) => position.position_reference?.kind),
    ['point', 'point'],
  );
  assert.deepEqual(
    result.definitions[0].positions.map((position) => position.position_reference?.entity_id),
    setup.referencePointIds,
    'the second snap should retain the line endpoint’s stable point reference',
  );
  assert.equal(result.definitions[0].bottom_style, 'drill_point');
  assert.equal(result.definitions[0].drill_point_angle_deg, 118);
  assert.equal(result.state.solidScene.errors.length, 0);
  assert.equal(result.state.solidScene.bodies.length, 1);
  assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join('\n')}`);
  console.log('  [ok] direct multi-position Hole and pointed bottom work');
} finally {
  await browser.close();
}
