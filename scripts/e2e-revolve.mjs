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

  console.log('1. two closed profiles on one side of the Y axis');
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
  await clickSketch(35, -5);
  await clickSketch(40, 5);
  await page.waitForFunction(() => {
    const state = window.__appStore.getState();
    return (
      state.activeSketch?.entities.filter((entity) => entity.kind === 'line')
        .length === 8
    );
  });
  await page.getByRole('button', { name: 'FINISH SKETCH', exact: true }).click();
  await page.waitForFunction(() => window.__appStore.getState().mode === 'solid');

  console.log('2. Revolve accepts axis-first and profile-first viewport gestures');
  await page.locator('button[title="Revolve"]').click();
  const dialog = page.getByTestId('revolve-dialog');
  await dialog.waitFor({ state: 'visible' });
  await page.getByTestId('revolve-profile-selection').waitFor({ state: 'visible' });
  const profilePoint = await page.evaluate(() => window.__worldToScreen(20, 0, 0));
  let axisPoint = await page.evaluate(() => window.__worldToScreen(10, 0, 0));

  await page.mouse.click(axisPoint.x, axisPoint.y);
  await page.waitForFunction(
    () => window.__appStore.getState().revolveAxisSelection !== null,
  );
  check(
    'choosing a straight line first records the axis and advances to profiles',
    (await state()).modelingPickTarget === 'revolve_profile'
      && (await state()).profilePicker.selected.length === 0,
  );
  await page.mouse.click(profilePoint.x, profilePoint.y);
  await page.waitForFunction(
    () => window.__appStore.getState().profilePicker?.selected.length === 1,
  );
  check(
    'axis-first selection keeps the axis while the compatible profile is added',
    (await state()).revolveAxisSelection !== null,
  );
  await dialog.getByRole('button', { name: 'Cancel' }).last().click();
  await dialog.waitFor({ state: 'hidden' });

  await page.locator('button[title="Revolve"]').click();
  await dialog.waitFor({ state: 'visible' });
  await page.mouse.click(profilePoint.x, profilePoint.y);
  await page.waitForFunction(
    () => window.__appStore.getState().profilePicker?.selected.length === 1,
  );
  check(
    'choosing the first profile automatically advances to straight-line selection',
    (await state()).modelingPickTarget === 'revolve_axis',
  );
  const secondProfilePoint = await page.evaluate(() => {
    const picker = window.__appStore.getState().profilePicker;
    const selected = picker.selected[0];
    const entry = picker.catalog.find((candidate) =>
      candidate.sketch_name === selected.sketch_name);
    const profile = entry.profiles.find((candidate) =>
      candidate.nesting_depth % 2 === 0
      && candidate.index !== selected.profile_index);
    const center = profile.points.reduce(
      (sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }),
      { x: 0, y: 0 },
    );
    center.x /= profile.points.length;
    center.y /= profile.points.length;
    const basis = entry.basis;
    return window.__worldToScreen(
      basis.origin[0] + basis.u[0] * center.x + basis.v[0] * center.y,
      basis.origin[1] + basis.u[1] * center.x + basis.v[1] * center.y,
      basis.origin[2] + basis.u[2] * center.x + basis.v[2] * center.y,
    );
  });
  check(
    'both disjoint regions are available to the shared profile picker',
    (await state()).profilePicker.catalog.some((entry) =>
      entry.profiles.filter((profile) => profile.nesting_depth % 2 === 0).length >= 2),
  );
  await page.mouse.move(secondProfilePoint.x, secondProfilePoint.y);
  await page.waitForFunction(
    () => window.__appStore.getState().profilePicker?.hovered !== null,
  );
  await page.mouse.click(secondProfilePoint.x, secondProfilePoint.y);
  await page.waitForFunction(
    () => window.__appStore.getState().profilePicker?.selected.length === 2,
  );
  check(
    'another coplanar profile remains directly selectable while the axis role is active',
    (await state()).modelingPickTarget === 'revolve_axis',
  );
  // Return to one profile before creating the feature; this keeps the legacy
  // solid/topology assertions below focused on one revolved region. Explicitly
  // activate the profile role so this click tests profile-set editing rather
  // than the overlapping axis-line priority of the still-missing axis role.
  await page.evaluate(() => {
    window.__appStore.getState().setModelingPickTarget('revolve_profile');
  });
  await page.mouse.click(secondProfilePoint.x, secondProfilePoint.y);
  await page.waitForFunction(
    () => window.__appStore.getState().profilePicker?.selected.length === 1,
  );
  const twoSidedTarget = await page.evaluate(() => {
    const state = window.__appStore.getState();
    const selected = state.profilePicker.selected[0];
    const catalog = state.profilePicker.catalog.find((entry) =>
      entry.sketch_name === selected.sketch_name);
    const profile = catalog.profiles.find((entry) =>
      entry.index === selected.profile_index);
    const sketch = state.finishedSketches.find((entry) =>
      entry.name === selected.sketch_name);
    const center = profile.points.reduce(
      (sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }),
      { x: 0, y: 0 },
    );
    center.x /= profile.points.length;
    center.y /= profile.points.length;
    const samePoint = (left, right) =>
      Math.hypot(left.x - right.x, left.y - right.y) < 1e-6;
    const boundaryLines = sketch.entities.filter((entity) =>
      entity.kind === 'line'
      && profile.points.some((start, index) => {
        const end = profile.points[(index + 1) % profile.points.length];
        return (samePoint(entity.start, start) && samePoint(entity.end, end))
          || (samePoint(entity.start, end) && samePoint(entity.end, start));
      }));
    const line = boundaryLines.sort((left, right) =>
      Math.hypot(left.end.x - left.start.x, left.end.y - left.start.y)
      - Math.hypot(right.end.x - right.start.x, right.end.y - right.start.y))[0];
    const midpoint = {
      x: (line.start.x + line.end.x) / 2,
      y: (line.start.y + line.end.y) / 2,
    };
    const toScreen = (point) => window.__worldToScreen(
      sketch.basis.origin[0] + sketch.basis.u[0] * point.x + sketch.basis.v[0] * point.y,
      sketch.basis.origin[1] + sketch.basis.u[1] * point.x + sketch.basis.v[1] * point.y,
      sketch.basis.origin[2] + sketch.basis.u[2] * point.x + sketch.basis.v[2] * point.y,
    );
    return {
      entityId: line.id,
      start: toScreen(line.start),
      end: toScreen(line.end),
      edge: toScreen(midpoint),
      center: toScreen(center),
    };
  });
  const tangentX = twoSidedTarget.end.x - twoSidedTarget.start.x;
  const tangentY = twoSidedTarget.end.y - twoSidedTarget.start.y;
  const normalLength = Math.max(1, Math.hypot(tangentX, tangentY));
  let inwardX = -tangentY / normalLength;
  let inwardY = tangentX / normalLength;
  if (
    inwardX * (twoSidedTarget.center.x - twoSidedTarget.edge.x)
      + inwardY * (twoSidedTarget.center.y - twoSidedTarget.edge.y)
    < 0
  ) {
    inwardX *= -1;
    inwardY *= -1;
  }
  const unitInward = {
    x: inwardX,
    y: inwardY,
  };
  for (const [side, sign] of [['profile', 1], ['exterior', -1]]) {
    await page.mouse.move(
      twoSidedTarget.edge.x + unitInward.x * 30 * sign,
      twoSidedTarget.edge.y + unitInward.y * 30 * sign,
    );
    await page.waitForFunction(
      (entityId) => window.__appStore.getState().revolveAxisHover?.entityId !== entityId,
      twoSidedTarget.entityId,
    );
    await page.mouse.move(
      twoSidedTarget.edge.x + unitInward.x * 4 * sign,
      twoSidedTarget.edge.y + unitInward.y * 4 * sign,
    );
    try {
      await page.waitForFunction(
        (entityId) => window.__appStore.getState().revolveAxisHover?.entityId === entityId,
        twoSidedTarget.entityId,
        { timeout: 1_500 },
      );
      check(`line hover acquires from the ${side} side`, true);
    } catch {
      check(`line hover acquires from the ${side} side`, false);
    }
  }
  const straightLineTargets = await page.evaluate(() => {
    const sketch = window.__appStore.getState().finishedSketches.find(
      (candidate) => candidate.name === 'Sketch1',
    );
    return sketch.entities
      .filter((entity) => entity.kind === 'line')
      .map((entity) => {
        const x = (entity.start.x + entity.end.x) / 2;
        const y = (entity.start.y + entity.end.y) / 2;
        return {
          entityId: entity.id,
          screen: window.__worldToScreen(
            sketch.basis.origin[0] + sketch.basis.u[0] * x + sketch.basis.v[0] * y,
            sketch.basis.origin[1] + sketch.basis.u[1] * x + sketch.basis.v[1] * y,
            sketch.basis.origin[2] + sketch.basis.u[2] * x + sketch.basis.v[2] * y,
          ),
        };
      });
  });
  let hoverableLineCount = 0;
  for (const target of straightLineTargets) {
    await page.mouse.move(target.screen.x, target.screen.y);
    try {
      await page.waitForFunction(
        (entityId) => window.__appStore.getState().revolveAxisHover?.entityId === entityId,
        target.entityId,
        { timeout: 1_500 },
      );
      hoverableLineCount += 1;
    } catch {
      // The aggregate check below reports every missed orientation together.
    }
  }
  check(
    'every visible straight sketch line exposes the shared axis hover state',
    hoverableLineCount === straightLineTargets.length,
    `${hoverableLineCount}/${straightLineTargets.length}`,
  );
  await page.mouse.move(axisPoint.x, axisPoint.y);
  await page.waitForFunction(
    () => window.__appStore.getState().revolveAxisHover !== null,
  );
  check(
    'eligible sketch line highlights on picker hover',
    (await page.evaluate(() => {
      const visual = window.__finishedSketchVisualState();
      const surface = document.querySelector('canvas[data-cad-interaction-surface="true"]');
      const scale = Math.min(
        1.6,
        Math.max(0.9, Math.hypot(surface.clientWidth, surface.clientHeight) / 1200),
      );
      const emphasizedWidths = visual.lineWidths.filter(
        (_width, index) => visual.lineEmphasis[index],
      );
      return emphasizedWidths.length > 0
        && emphasizedWidths.every((width) => width <= 1 * scale + 1e-6)
        && visual.lineHoverOffsets.every((offset) => offset === 0)
        && visual.lineRenderOrders.some((order, index) =>
          visual.lineEmphasis[index] && order >= 22);
    })) === true,
  );
  const outsidePoint = await page.evaluate(() => window.__worldToScreen(0, 0, 0));
  const outsideDx = outsidePoint.x - axisPoint.x;
  const outsideDy = outsidePoint.y - axisPoint.y;
  const outsideLength = Math.max(1, Math.hypot(outsideDx, outsideDy));
  await page.mouse.move(
    axisPoint.x + (outsideDx / outsideLength) * 40,
    axisPoint.y + (outsideDy / outsideLength) * 40,
  );
  await page.waitForFunction(
    () => window.__appStore.getState().revolveAxisHover === null,
  );
  await page.mouse.move(axisPoint.x, axisPoint.y);
  await page.waitForFunction(
    () => window.__appStore.getState().revolveAxisHover !== null,
  );
  check(
    'leaving through invalid space does not block reacquiring the same line',
    (await state()).revolveAxisHover !== null,
  );

  await page.evaluate(() => window.__cameraApi.orbitBy(72, 38));
  await page.waitForTimeout(250);
  axisPoint = await page.evaluate(() => window.__worldToScreen(10, 0, 0));
  await page.mouse.move(axisPoint.x, axisPoint.y);
  await page.waitForFunction(
    () => window.__appStore.getState().revolveAxisHover !== null,
  );
  check(
    'the same visible line remains hoverable after an oblique orbit',
    (await state()).revolveAxisHover !== null,
  );
  await page.mouse.click(axisPoint.x, axisPoint.y);
  await page.waitForFunction(
    () => window.__appStore.getState().revolveAxisSelection !== null,
  );
  const selectedLineVisual = await page.evaluate(() => {
    const visual = window.__finishedSketchVisualState();
    const accent = getComputedStyle(document.documentElement)
      .getPropertyValue('--accent')
      .trim()
      .replace('#', '')
      .toLowerCase();
    return {
      accent,
      emphasizedColors: visual.lineColors.filter(
        (_color, index) => visual.lineEmphasis[index],
      ),
    };
  });
  check(
    'selected sketch line keeps its picker highlight',
    (await state()).revolveAxisSelection?.sketchName === 'Sketch1'
      && selectedLineVisual.emphasizedColors.includes(selectedLineVisual.accent),
    JSON.stringify(selectedLineVisual),
  );
  await page.getByTestId('revolve-axis-y-mode').click();
  check(
    'profile is selected from the viewport and Y axis is an explicit mode',
    (await state()).profilePicker.selected.length === 1
      && await page.getByTestId('revolve-axis-y-mode').getAttribute('aria-checked') === 'true',
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
    'Body1 is present without forcing a post-command selection',
    app.selectedBody === null &&
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
  check(
    'timeline edit restores the saved Y axis without a geometry dropdown',
    await page.getByTestId('revolve-axis-y-mode').getAttribute('aria-checked') === 'true',
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
