/**
 * Regression for an origin-started two-line chain with a rectangle created
 * from its endpoint. Editing the vertical line length must keep the origin
 * fixed and move the structurally attached rectangle with the endpoint.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE = 'http://localhost:7199';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error)));

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__appStore.getState().document !== null);
  await page.getByRole('button', { name: 'Create Sketch' }).first().click();
  await page.waitForTimeout(250);
  const xyPlane = page.getByText('XY Plane', { exact: true });
  if (!(await xyPlane.isVisible())) {
    await page.getByRole('button', { name: 'Origin' }).click();
  }
  await xyPlane.click();
  await page.waitForFunction(
    () => window.__appStore.getState().mode === 'sketch' && !!window.__engine,
  );

  const result = await page.evaluate(async () => {
    const engine = window.__engine;
    const store = window.__appStore.getState();
    const lineRequest = (from, to_hint, length) => ({
      from,
      to_hint,
      length_mm: null,
      angle_deg: null,
      length_text: length,
      angle_text: null,
      ctrl_held: false,
    });

    const first = await engine.addLineLocked(
      lineRequest({ x: 0, y: 0 }, { x: 15, y: 0 }, '15'),
    );
    store.setActiveSketch(first.sketch);
    const second = await engine.addLineLocked(
      lineRequest({ x: 15, y: 0 }, { x: 15, y: 15 }, '15'),
    );
    store.setActiveSketch(second.sketch);

    const verticalDimension = second.sketch.dimensions.find(
      (dimension) => dimension.entities.length === 1 &&
        dimension.entities[0] === second.entity_id,
    );
    const rectangle = await engine.addRectangleLocked({
      mode: 'two_point',
      anchor: { x: 15, y: 15 },
      width_mm: null,
      height_mm: null,
      width_text: '30',
      height_text: '20',
      corner_hint: { x: 45, y: 35 },
      ctrl_held: false,
    });
    store.setActiveSketch(rectangle.sketch);
    const edited = await engine.editDimension({
      constraint_id: verticalDimension.constraint_id,
      text: '7.5',
    });
    store.setActiveSketch(edited.sketch);

    return {
      first,
      second,
      rectangle,
      edited: edited.sketch,
    };
  });

  const point = (id) => {
    const entity = result.edited.entities.find((candidate) => candidate.id === id);
    assert.equal(entity?.kind, 'point', `entity ${id} should be a point`);
    return entity.position;
  };
  const close = (actual, expected) =>
    Math.hypot(actual.x - expected.x, actual.y - expected.y) < 1e-7;

  assert.equal(
    result.rectangle.entities[0],
    result.second.end_point_id,
    'rectangle must share the line endpoint',
  );
  assert.ok(close(point(result.first.start_point_id), { x: 0, y: 0 }));
  assert.ok(close(point(result.first.end_point_id), { x: 15, y: 0 }));
  assert.ok(close(point(result.second.end_point_id), { x: 15, y: 7.5 }));
  assert.ok(close(point(result.rectangle.entities[1]), { x: 45, y: 7.5 }));
  assert.ok(close(point(result.rectangle.entities[3]), { x: 15, y: 27.5 }));
  assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join('\n')}`);

  console.log('  [ok] origin remains grounded and attached rectangle follows edited chain');
} finally {
  await browser.close();
}
