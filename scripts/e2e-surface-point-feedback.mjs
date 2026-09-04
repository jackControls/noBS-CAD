/** Real mouse/state regression for incidental face-hit markers. This checks
 * the shared renderer contract; native Bevy pixels are verified separately. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));

const feedback = () => page.evaluate(async () => {
  const { collectAppViewportPickFeedback } = await import('/src/modeling/viewportPickFeedback.ts');
  return collectAppViewportPickFeedback(window.__appStore.getState());
});

try {
  await page.goto('http://localhost:7199', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__engine && window.__appStore?.getState().document);
  await page.evaluate(async () => {
    const engine = window.__engine;
    const state = window.__appStore.getState();
    state.applySolidUpdate(await engine.newProject());
    await engine.beginSketch({ type: 'origin_plane', plane: 'xy' });
    await engine.addRectangle({
      mode: 'two_point', p1: { x: -10, y: -10 }, p2: { x: 10, y: 10 }, ctrl_held: true,
    });
    state.setDocument((await engine.endSketch()).document);
    state.applySolidUpdate(await engine.extrude({
      sketch_name: 'Sketch1', profile_indices: [0], operation: 'new_body',
      extent: { type: 'distance', distance: 10 }, target_body_ids: [],
      taper_angle_deg: 0, flip: false,
    }));
    state.setMode('solid');
    state.clearSolidSelection();
    window.__cameraApi.snapToDirection([0, 0, 1]);
    window.__cameraApi.fit();
  });
  await page.waitForTimeout(400);
  const screen = await page.evaluate(() => window.__cameraApi.worldToScreen([0, 0, 10]));
  assert.ok(screen, 'top face is in the viewport');
  await page.mouse.click(screen.x, screen.y);
  await page.waitForFunction(() => window.__appStore.getState().selectedFacePoint !== null);
  const ordinary = await feedback();
  assert.equal(ordinary.selectedFaceIds.length, 1);
  assert.equal(ordinary.selectedSurfacePoint, null);
  assert.equal(ordinary.hoveredSurfacePoint, null);
  console.log('  [ok] ordinary face clicks retain the face but do not draw a point');

  await page.locator('button[title="Move/Copy"]').first().click();
  const dialog = page.getByTestId('body-feature-dialog');
  await dialog.waitFor({ state: 'visible' });
  const moveType = dialog.getByRole('combobox', { name: /^Move type/ });
  await moveType.selectOption('rotate');
  await page.getByTestId('move-pivot-selection').click();
  await page.waitForFunction(() => window.__appStore.getState().modelingPickTarget === 'move_pivot');
  // Use a different point from the ordinary click so stale selectedFacePoint
  // state cannot make the explicit point-selection check pass accidentally.
  const pivotScreen = await page.evaluate(() => window.__cameraApi.worldToScreen([3, 2, 10]));
  assert.ok(pivotScreen, 'pivot target is in the viewport');
  await page.mouse.move(pivotScreen.x, pivotScreen.y);
  await page.waitForFunction(() => window.__appStore.getState().modelingPointHover !== null);
  assert.ok((await feedback()).hoveredSurfacePoint, 'explicit point hover stays visible');
  await page.mouse.click(pivotScreen.x, pivotScreen.y);
  await page.waitForFunction(() => {
    const point = window.__appStore.getState().selectedFacePoint;
    return point && Math.abs(point.x - 3) < 0.1 && Math.abs(point.y - 2) < 0.1;
  });
  const pivot = await feedback();
  assert.ok(pivot.selectedSurfacePoint, 'explicit pivot selection keeps its marker');
  assert.ok(Math.abs(pivot.selectedSurfacePoint.z - 10) < 1e-5);
  console.log('  [ok] point-picking hover and selected markers remain available');

  await moveType.selectOption('free');
  await page.waitForFunction(() => window.__appStore.getState().modelingPickTarget === 'move_bodies');
  assert.equal((await feedback()).selectedSurfacePoint, null);
  assert.equal((await feedback()).hoveredSurfacePoint, null);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.waitForFunction(() => window.__appStore.getState().bodyFeatureDialog === null);
  assert.equal((await feedback()).selectedSurfacePoint, null);
  assert.equal((await feedback()).hoveredSurfacePoint, null);
  assert.deepEqual(errors, []);
  console.log('  [ok] changing role and canceling hide incidental point markers');
} finally {
  await browser.close();
}
