/**
 * Sketch-constraint hardening regression:
 * - H/V accepts two points and creates a point relation;
 * - bulk H/V is not capped at eight selected lines;
 * - successful constraint commands clear their consumed selection;
 * - two-feature commands accept button-first, one-first, and both-first flows;
 * - duplicate relations are rejected without polluting the graph;
 * - deliberate shallow diagonals survive while near-axis intent is inferred;
 * - all direction-only ribbon paths retain authored finite lengths;
 * - Equal changes only target size, preserving both authored bearings.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE = 'http://localhost:7199';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error)));

const state = () => page.evaluate(() => window.__appStore.getState());
const applyHorizontalVertical = async () => {
  await page.locator('[data-ribbon-button="horizontalVertical"]').click();
};

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(
    () => window.__appStore?.getState().document !== null && !!window.__engine,
  );

  const created = await page.evaluate(async () => {
    const engine = window.__engine;
    const store = window.__appStore.getState();
    store.applySolidUpdate(await engine.newProject());
    let sketch = await engine.beginSketch({ type: 'origin_plane', plane: 'xy' });
    sketch = await engine.setGridSnap(false);
    store.setActiveSketch(sketch);
    store.setMode('sketch');

    const p1 = await engine.addPoint({ position: { x: -12, y: 8 } });
    const firstPoint = p1.entities.at(-1);
    const p2 = await engine.addPoint({ position: { x: 15, y: 11 } });
    const secondPoint = p2.entities.at(-1);
    store.setActiveSketch(p2.sketch);

    const lineIds = [];
    let latest = p2.sketch;
    for (let index = 0; index < 9; index += 1) {
      const line = await engine.addLine({
        from: { x: -30, y: -30 - index * 3 },
        to_raw: { x: -10, y: -29.5 - index * 3 },
        ctrl_held: true,
      });
      lineIds.push(line.entity_id);
      latest = line.sketch;
    }
    store.setActiveSketch(latest);
    return {
      firstPoint,
      secondPoint,
      pointDistance: Math.hypot(15 - (-12), 11 - 8),
      lineIds,
      lineLengths: Object.fromEntries(lineIds.map((lineId) => {
        const line = latest.entities.find((entity) => entity.kind === 'line' && entity.id === lineId);
        return [lineId, Math.hypot(line.end.x - line.start.x, line.end.y - line.start.y)];
      })),
    };
  });

  assert.equal(typeof created.firstPoint, 'number');
  assert.equal(typeof created.secondPoint, 'number');

  console.log('0. Two-feature commands accept every selection order');
  const selectionOrderFixture = await page.evaluate(async () => {
    const engine = window.__engine;
    const store = window.__appStore.getState();
    const addLine = async (from, to) => {
      const result = await engine.addLine({ from, to_raw: to, ctrl_held: true });
      store.setActiveSketch(result.sketch);
      return result.entity_id;
    };
    const buttonFirst = [
      await addLine({ x: -105, y: 70 }, { x: -78, y: 76 }),
      await addLine({ x: -105, y: 88 }, { x: -82, y: 101 }),
    ];
    const oneFirst = [
      await addLine({ x: -65, y: 72 }, { x: -38, y: 79 }),
      await addLine({ x: -54, y: 92 }, { x: -47, y: 121 }),
    ];
    const bothFirst = [
      await addLine({ x: -18, y: 72 }, { x: 8, y: 80 }),
      await addLine({ x: -15, y: 96 }, { x: 1, y: 118 }),
    ];
    const firstHvPointResult = await engine.addPoint({ position: { x: 34, y: 92 } });
    const firstHvPoint = firstHvPointResult.entities.at(-1);
    const secondHvPointResult = await engine.addPoint({ position: { x: 64, y: 101 } });
    const secondHvPoint = secondHvPointResult.entities.at(-1);
    store.setActiveSketch(secondHvPointResult.sketch);
    store.setSelectedEntities([]);
    store.setSelectedEntity(null);
    return { buttonFirst, oneFirst, bothFirst, hvPoints: [firstHvPoint, secondHvPoint] };
  });
  await page.evaluate(() => window.__cameraApi.fit());
  await page.waitForTimeout(550);

  console.log('0a. Active sketch tools carry their toolbar glyph beside the cursor');
  const viewportBox = await page.locator('.native-viewport-surface').boundingBox();
  assert.ok(viewportBox, 'viewport is visible');
  const cursorPoint = {
    x: viewportBox.x + viewportBox.width * 0.62,
    y: viewportBox.y + viewportBox.height * 0.42,
  };
  await page.locator('[data-ribbon-button="line"]').click();
  await page.mouse.move(cursorPoint.x, cursorPoint.y);
  await page.waitForFunction(() => {
    const badge = document.querySelector('[data-testid="active-tool-cursor"]');
    return badge?.getAttribute('data-active-tool-icon') === 'line'
      && getComputedStyle(badge).display !== 'none';
  });
  let cursorAnnotation = await page.evaluate(() =>
    window.__nativeViewportTransient().annotations.find(
      (annotation) => annotation.kind === 'tool',
    ),
  );
  assert.equal(cursorAnnotation?.toolIcon, 'line');
  await page.keyboard.press('Escape');
  await page.locator('[data-ribbon-button="rectangle"]').click();
  await page.mouse.move(cursorPoint.x + 12, cursorPoint.y + 9);
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="active-tool-cursor"]')
      ?.getAttribute('data-active-tool-icon') === 'rect',
  );
  cursorAnnotation = await page.evaluate(() =>
    window.__nativeViewportTransient().annotations.find(
      (annotation) => annotation.kind === 'tool',
    ),
  );
  assert.equal(cursorAnnotation?.toolIcon, 'rectangle');
  await page.keyboard.press('Escape');

  const clickLine = async (lineId, additive = false) => {
    const current = await state();
    const line = current.activeSketch.entities.find(
      (entity) => entity.kind === 'line' && entity.id === lineId,
    );
    assert.ok(line, `line ${lineId} exists`);
    const point = await page.evaluate(
      ([x, y]) => window.__sketchToScreen(x, y),
      [(line.start.x + line.end.x) / 2, (line.start.y + line.end.y) / 2],
    );
    if (additive) await page.keyboard.down('Shift');
    await page.mouse.click(point.x, point.y);
    if (additive) await page.keyboard.up('Shift');
  };
  const relationExists = (type, ids) => page.evaluate(
    ({ type, ids }) => window.__appStore.getState().activeSketch?.constraints.some(
      (constraint) => constraint.type === type
        && ids.includes(constraint.a)
        && ids.includes(constraint.b),
    ),
    { type, ids },
  );
  const clickPoint = async (pointId) => {
    const current = await state();
    const entity = current.activeSketch.entities.find(
      (candidate) => candidate.kind === 'point' && candidate.id === pointId,
    );
    assert.ok(entity, `point ${pointId} exists`);
    const point = await page.evaluate(
      ([x, y]) => window.__sketchToScreen(x, y),
      [entity.position.x, entity.position.y],
    );
    await page.mouse.click(point.x, point.y);
  };

  // Command first, then two ordinary clicks (no Shift modifier).
  await page.locator('[data-ribbon-button="parallel"]').click();
  assert.equal((await state()).pendingConstraintTool, 'parallel');
  assert.equal(
    await page.locator('[data-ribbon-button="parallel"]').getAttribute('aria-pressed'),
    'true',
  );
  await page.getByText(/Select 2 features for Parallel \(0\/2/i).waitFor();
  await clickLine(selectionOrderFixture.buttonFirst[0]);
  assert.equal((await state()).pendingConstraintTool, 'parallel');
  assert.equal((await state()).selectedEntities.length, 1);
  assert.equal(
    await page.locator('[data-testid="active-tool-cursor"]').getAttribute('data-active-tool-icon'),
    'parallel',
  );
  cursorAnnotation = await page.evaluate(() =>
    window.__nativeViewportTransient().annotations.find(
      (annotation) => annotation.kind === 'tool',
    ),
  );
  assert.equal(cursorAnnotation?.icon, 'parallel');
  await page.getByText(/Select 2 features for Parallel \(1\/2/i).waitFor();
  await clickLine(selectionOrderFixture.buttonFirst[1]);
  await page.waitForFunction(
    ({ ids }) => window.__appStore.getState().activeSketch?.constraints.some(
      (constraint) => constraint.type === 'parallel'
        && ids.includes(constraint.a)
        && ids.includes(constraint.b),
    ),
    { ids: selectionOrderFixture.buttonFirst },
  );
  assert.equal((await state()).pendingConstraintTool, null);
  assert.deepEqual((await state()).selectedEntities, []);

  const parallelConstraintId = await page.evaluate(({ ids }) => {
    const state = window.__appStore.getState();
    const constraint = state.activeSketch.constraints.find(
      (candidate) => candidate.type === 'parallel'
        && ids.includes(candidate.a)
        && ids.includes(candidate.b),
    );
    state.setSelectedConstraint(constraint.id);
    return constraint.id;
  }, { ids: selectionOrderFixture.buttonFirst });
  assert.equal(typeof parallelConstraintId, 'number');
  await page.waitForFunction(() =>
    document.querySelector('[data-native-hud="selection"] [data-native-hud-title]')
      ?.textContent?.trim() === 'CONSTRAINT',
  );
  assert.match(
    await page.locator('[data-native-hud="selection"] [data-native-hud-subject]').innerText(),
    /Parallel/i,
  );
  assert.equal(await page.getByTestId('selection-constraint-icon').count(), 1);
  await page.evaluate(() => window.__appStore.getState().setSelectedConstraint(null));
  const quietParallelMarks = await page.evaluate(() =>
    window.__nativeViewportTransient().annotations.filter(
      (annotation) => annotation.kind === 'constraint'
        && annotation.icon === 'parallel'
        && !annotation.selected,
    ),
  );
  assert.equal(
    quietParallelMarks.length,
    2,
    'parallel relation repeats its visible icon on both participant lines',
  );
  assert.ok(
    quietParallelMarks.every(
      (mark) => mark.color[3] >= 0.55 && mark.color[3] <= 0.68,
    ),
    `unselected relation icons should remain translucent, got ${quietParallelMarks.map((mark) => mark.color[3]).join(', ')}`,
  );

  // One entity first, then the command, then one ordinary click.
  await clickLine(selectionOrderFixture.oneFirst[0]);
  assert.deepEqual((await state()).selectedEntities, [selectionOrderFixture.oneFirst[0]]);
  await page.locator('[data-ribbon-button="perpendicular"]').click();
  assert.equal((await state()).pendingConstraintTool, 'perpendicular');
  assert.deepEqual((await state()).selectedEntities, [selectionOrderFixture.oneFirst[0]]);
  await clickLine(selectionOrderFixture.oneFirst[1]);
  await page.waitForFunction(
    ({ ids }) => window.__appStore.getState().activeSketch?.constraints.some(
      (constraint) => constraint.type === 'perpendicular'
        && ids.includes(constraint.a)
        && ids.includes(constraint.b),
    ),
    { ids: selectionOrderFixture.oneFirst },
  );
  assert.equal((await state()).pendingConstraintTool, null);

  // Original both-selected flow remains immediate.
  await clickLine(selectionOrderFixture.bothFirst[0]);
  await clickLine(selectionOrderFixture.bothFirst[1], true);
  assert.deepEqual(
    new Set((await state()).selectedEntities),
    new Set(selectionOrderFixture.bothFirst),
  );
  await page.locator('[data-ribbon-button="equal"]').click();
  await page.waitForFunction(
    ({ ids }) => window.__appStore.getState().activeSketch?.constraints.some(
      (constraint) => constraint.type === 'equal'
        && ids.includes(constraint.a)
        && ids.includes(constraint.b),
    ),
    { ids: selectionOrderFixture.bothFirst },
  );
  assert.equal((await state()).pendingConstraintTool, null);
  assert.equal(await relationExists('equal', selectionOrderFixture.bothFirst), true);

  // Escape retires the pending command before it clears a preserved pick.
  await page.locator('[data-ribbon-button="parallel"]').click();
  assert.equal((await state()).pendingConstraintTool, 'parallel');
  await page.keyboard.press('Escape');
  assert.equal((await state()).pendingConstraintTool, null);

  // H/V is one-feature for a line but two-feature for point alignment. Its
  // button-first mode waits after a point and completes on the second point.
  await page.locator('[data-ribbon-button="horizontalVertical"]').click();
  assert.equal((await state()).pendingConstraintTool, 'hv');
  await clickPoint(selectionOrderFixture.hvPoints[0]);
  assert.equal((await state()).pendingConstraintTool, 'hv');
  await clickPoint(selectionOrderFixture.hvPoints[1]);
  await page.waitForFunction(
    ({ ids }) => window.__appStore.getState().activeSketch?.constraints.some(
      (constraint) => constraint.type === 'horizontal_points'
        && ids.includes(constraint.a)
        && ids.includes(constraint.b),
    ),
    { ids: selectionOrderFixture.hvPoints },
  );
  assert.equal((await state()).pendingConstraintTool, null);

  console.log('1. Two selected points create an exact H/V point relation');
  await page.evaluate(({ firstPoint, secondPoint }) => {
    const store = window.__appStore.getState();
    store.setSelectedEntities([firstPoint, secondPoint]);
    store.setSelectedEntity(secondPoint);
  }, created);
  await applyHorizontalVertical();
  await page.waitForFunction(
    ({ ids }) => window.__appStore.getState().activeSketch?.constraints.some(
      (constraint) => constraint.type === 'horizontal_points'
        && ids.includes(constraint.a)
        && ids.includes(constraint.b),
    ),
    { ids: [created.firstPoint, created.secondPoint] },
  );
  let app = await state();
  const horizontalPoints = app.activeSketch.constraints.find(
    (constraint) => constraint.type === 'horizontal_points'
      && [constraint.a, constraint.b].includes(created.firstPoint)
      && [constraint.a, constraint.b].includes(created.secondPoint),
  );
  assert.deepEqual(
    new Set([horizontalPoints.a, horizontalPoints.b]),
    new Set([created.firstPoint, created.secondPoint]),
  );
  const pointEntities = app.activeSketch.entities.filter(
    (entity) => entity.kind === 'point'
      && [created.firstPoint, created.secondPoint].includes(entity.id),
  );
  assert.equal(pointEntities.length, 2);
  assert.ok(
    Math.abs(pointEntities[0].position.y - pointEntities[1].position.y) < 1e-7,
    'the committed relation must be exact, not merely inside a screen-space tolerance',
  );
  assert.ok(
    Math.abs(
      Math.hypot(
        pointEntities[1].position.x - pointEntities[0].position.x,
        pointEntities[1].position.y - pointEntities[0].position.y,
      ) - created.pointDistance,
    ) < 1e-7,
    'point H/V alignment must rotate without shortening the authored spacing',
  );
  assert.deepEqual(app.selectedEntities, []);
  assert.equal(app.selectedEntity, null);

  console.log('2. Bulk H/V accepts more than eight lines and clears the selection');
  const constraintsBeforeBulk = app.activeSketch.constraints.length;
  await page.evaluate((lineIds) => {
    const store = window.__appStore.getState();
    store.setSelectedEntities(lineIds);
    store.setSelectedEntity(lineIds.at(-1));
  }, created.lineIds);
  await applyHorizontalVertical();
  await page.waitForFunction(
    ([before, expected]) =>
      window.__appStore.getState().activeSketch?.constraints.length === before + expected,
    [constraintsBeforeBulk, created.lineIds.length],
  );
  app = await state();
  assert.equal(app.selectedEntities.length, 0);
  assert.equal(app.selectedEntity, null);
  const lineRelations = app.activeSketch.constraints.filter(
    (constraint) => constraint.type === 'horizontal'
      && created.lineIds.includes(constraint.entity),
  );
  assert.equal(lineRelations.length, 9);
  for (const lineId of created.lineIds) {
    const line = app.activeSketch.entities.find(
      (entity) => entity.kind === 'line' && entity.id === lineId,
    );
    const solvedLength = Math.hypot(line.end.x - line.start.x, line.end.y - line.start.y);
    assert.ok(
      Math.abs(solvedLength - created.lineLengths[lineId]) < 1e-7,
      `H/V changed line ${lineId} length`,
    );
  }

  console.log('3. Reapplying the same relation is rejected without a duplicate row');
  const constraintsBeforeDuplicate = app.activeSketch.constraints.length;
  await page.evaluate((lineId) => {
    const store = window.__appStore.getState();
    store.setSelectedEntities([lineId]);
    store.setSelectedEntity(lineId);
  }, created.lineIds[0]);
  await applyHorizontalVertical();
  await page.getByText(/already exists/i).waitFor({ state: 'visible' });
  app = await state();
  assert.equal(app.activeSketch.constraints.length, constraintsBeforeDuplicate);
  await page.getByRole('button', { name: 'OK' }).click();

  console.log('4. Axis inference preserves intent outside the narrow cone');
  const inference = await page.evaluate(async () => {
    const engine = window.__engine;
    const store = window.__appStore.getState();
    const radians = (degrees) => degrees * Math.PI / 180;
    const deliberate = await engine.addLine({
      from: { x: 40, y: 0 },
      to_raw: { x: 40 + 20 * Math.cos(radians(8)), y: 20 * Math.sin(radians(8)) },
      ctrl_held: false,
    });
    const inferred = await engine.addLine({
      from: { x: 40, y: 20 },
      to_raw: { x: 40 + 20 * Math.cos(radians(2)), y: 20 + 20 * Math.sin(radians(2)) },
      ctrl_held: false,
    });
    store.setActiveSketch(inferred.sketch);
    const deliberateEntity = inferred.sketch.entities.find(
      (entity) => entity.kind === 'line' && entity.id === deliberate.entity_id,
    );
    const inferredEntity = inferred.sketch.entities.find(
      (entity) => entity.kind === 'line' && entity.id === inferred.entity_id,
    );
    return {
      deliberateDy: deliberateEntity.end.y - deliberateEntity.start.y,
      inferredDy: inferredEntity.end.y - inferredEntity.start.y,
      deliberateConstrained: inferred.sketch.constraints.some(
        (constraint) => constraint.type === 'horizontal'
          && constraint.entity === deliberate.entity_id,
      ),
      inferredConstrained: inferred.sketch.constraints.some(
        (constraint) => constraint.type === 'horizontal'
          && constraint.entity === inferred.entity_id,
      ),
    };
  });
  assert.ok(Math.abs(inference.deliberateDy) > 2, '8° line remains visibly diagonal');
  assert.equal(inference.deliberateConstrained, false);
  assert.ok(Math.abs(inference.inferredDy) < 1e-7, '2° intent resolves exactly horizontal');
  assert.equal(inference.inferredConstrained, true);

  console.log('5. Parallel preserves both selected lines\' authored lengths');
  const parallelFixture = await page.evaluate(async () => {
    const engine = window.__engine;
    const store = window.__appStore.getState();
    const vertical = await engine.addLine({
      from: { x: 100, y: 0 },
      to_raw: { x: 100, y: 40.094115730976 },
      ctrl_held: true,
    });
    const top = await engine.addLine({
      from: { x: 100, y: 40.094115730976 },
      to_raw: { x: 140.094115730976, y: 40.094115730976 },
      ctrl_held: true,
    });
    const bottom = await engine.addLine({
      from: { x: 100, y: 0 },
      to_raw: { x: 140, y: -1 },
      ctrl_held: true,
    });
    await engine.addConstraints([
      { type: 'vertical', entity: vertical.entity_id },
      { type: 'perpendicular', a: vertical.entity_id, b: top.entity_id },
      { type: 'equal', a: vertical.entity_id, b: top.entity_id },
    ]);
    const fixed = await engine.toggleFixEntities([vertical.start_point_id]);
    store.setActiveSketch(fixed.sketch);
    store.setSelectedEntities([top.entity_id, bottom.entity_id]);
    store.setSelectedEntity(bottom.entity_id);
    const lineLength = (lineId) => {
      const line = fixed.sketch.entities.find(
        (entity) => entity.kind === 'line' && entity.id === lineId,
      );
      return Math.hypot(line.end.x - line.start.x, line.end.y - line.start.y);
    };
    return {
      top: top.entity_id,
      bottom: bottom.entity_id,
      topLength: lineLength(top.entity_id),
      bottomLength: lineLength(bottom.entity_id),
    };
  });
  await page.locator('[data-ribbon-button="parallel"]').click();
  await page.waitForFunction(
    ({ top, bottom }) => window.__appStore.getState().activeSketch?.constraints.some(
      (constraint) => constraint.type === 'parallel'
        && new Set([constraint.a, constraint.b]).size === 2
        && [constraint.a, constraint.b].includes(top)
        && [constraint.a, constraint.b].includes(bottom),
    ),
    parallelFixture,
  );
  app = await state();
  const lineLength = (lineId) => {
    const line = app.activeSketch.entities.find(
      (entity) => entity.kind === 'line' && entity.id === lineId,
    );
    return Math.hypot(line.end.x - line.start.x, line.end.y - line.start.y);
  };
  const solvedTopLength = lineLength(parallelFixture.top);
  const solvedBottomLength = lineLength(parallelFixture.bottom);
  assert.ok(Math.abs(solvedTopLength - parallelFixture.topLength) < 1e-7);
  assert.ok(Math.abs(solvedBottomLength - parallelFixture.bottomLength) < 1e-7);
  assert.ok(solvedBottomLength < 100, 'Parallel must not create a runaway carrier');
  assert.deepEqual(app.selectedEntities, []);
  assert.equal(app.selectedEntity, null);

  console.log('6. Perpendicular preserves both lengths; Equal changes only target size');
  const invariantFixture = await page.evaluate(async () => {
    const engine = window.__engine;
    const store = window.__appStore.getState();
    const first = await engine.addLine({
      from: { x: 180, y: 0 },
      to_raw: { x: 217, y: 11 },
      ctrl_held: true,
    });
    const second = await engine.addLine({
      from: { x: 190, y: 30 },
      to_raw: { x: 211, y: 68 },
      ctrl_held: true,
    });
    store.setActiveSketch(second.sketch);
    store.setSelectedEntities([first.entity_id, second.entity_id]);
    store.setSelectedEntity(second.entity_id);
    const geometry = (lineId) => {
      const line = second.sketch.entities.find(
        (entity) => entity.kind === 'line' && entity.id === lineId,
      );
      return {
        length: Math.hypot(line.end.x - line.start.x, line.end.y - line.start.y),
        dx: line.end.x - line.start.x,
        dy: line.end.y - line.start.y,
      };
    };
    return { first: first.entity_id, second: second.entity_id, firstBefore: geometry(first.entity_id), secondBefore: geometry(second.entity_id) };
  });
  await page.locator('[data-ribbon-button="perpendicular"]').click();
  await page.waitForFunction(
    ({ first, second }) => window.__appStore.getState().activeSketch?.constraints.some(
      (constraint) => constraint.type === 'perpendicular'
        && [constraint.a, constraint.b].includes(first)
        && [constraint.a, constraint.b].includes(second),
    ),
    invariantFixture,
  );
  app = await state();
  const geometry = (lineId) => {
    const line = app.activeSketch.entities.find(
      (entity) => entity.kind === 'line' && entity.id === lineId,
    );
    return {
      length: Math.hypot(line.end.x - line.start.x, line.end.y - line.start.y),
      dx: line.end.x - line.start.x,
      dy: line.end.y - line.start.y,
    };
  };
  assert.ok(Math.abs(geometry(invariantFixture.first).length - invariantFixture.firstBefore.length) < 1e-7);
  assert.ok(Math.abs(geometry(invariantFixture.second).length - invariantFixture.secondBefore.length) < 1e-7);

  const equalFixture = await page.evaluate(async () => {
    const engine = window.__engine;
    const store = window.__appStore.getState();
    const reference = await engine.addLine({
      from: { x: 240, y: 0 },
      to_raw: { x: 288, y: 14 },
      ctrl_held: true,
    });
    const target = await engine.addLine({
      from: { x: 250, y: 35 },
      to_raw: { x: 266, y: 59 },
      ctrl_held: true,
    });
    store.setActiveSketch(target.sketch);
    store.setSelectedEntities([reference.entity_id, target.entity_id]);
    store.setSelectedEntity(target.entity_id);
    const line = (lineId) => target.sketch.entities.find(
      (entity) => entity.kind === 'line' && entity.id === lineId,
    );
    const ref = line(reference.entity_id);
    const goal = line(target.entity_id);
    return {
      reference: reference.entity_id,
      target: target.entity_id,
      referenceLength: Math.hypot(ref.end.x - ref.start.x, ref.end.y - ref.start.y),
      referenceDirection: [ref.end.x - ref.start.x, ref.end.y - ref.start.y],
      targetDirection: [goal.end.x - goal.start.x, goal.end.y - goal.start.y],
    };
  });
  await page.locator('[data-ribbon-button="equal"]').click();
  await page.waitForFunction(
    ({ reference, target }) => window.__appStore.getState().activeSketch?.constraints.some(
      (constraint) => constraint.type === 'equal'
        && constraint.a === reference
        && constraint.b === target,
    ),
    equalFixture,
  );
  app = await state();
  const equalReference = geometry(equalFixture.reference);
  const equalTarget = geometry(equalFixture.target);
  assert.ok(Math.abs(equalReference.length - equalFixture.referenceLength) < 1e-7);
  assert.ok(Math.abs(equalTarget.length - equalFixture.referenceLength) < 1e-7);
  const sameBearing = ([x, y], candidate) => {
    const cross = x * candidate.dy - y * candidate.dx;
    const dot = x * candidate.dx + y * candidate.dy;
    return Math.abs(cross) / (Math.hypot(x, y) * candidate.length) < 1e-7 && dot > 0;
  };
  assert.ok(sameBearing(equalFixture.referenceDirection, equalReference));
  assert.ok(sameBearing(equalFixture.targetDirection, equalTarget));

  assert.deepEqual(pageErrors, []);
  console.log('  [ok] sketch constraint audit hardening stays integrated through the UI');
} finally {
  await browser.close();
}
