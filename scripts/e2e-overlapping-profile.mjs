/**
 * Regression for profile discovery when an attached open-chain segment
 * partially overlaps a longer closed-loop carrier.
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

  const catalog = await page.evaluate(async () => {
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
      lineRequest({ x: 0, y: 0 }, { x: -15, y: 0 }, '15'),
    );
    store.setActiveSketch(first.sketch);
    const second = await engine.addLineLocked(
      lineRequest({ x: -15, y: 0 }, { x: -15, y: -7.5 }, '7.5'),
    );
    store.setActiveSketch(second.sketch);
    const rectangle = await engine.addRectangleLocked({
      mode: 'two_point',
      anchor: { x: -15, y: -7.5 },
      width_mm: null,
      height_mm: null,
      width_text: '30',
      height_text: '15',
      corner_hint: { x: 15, y: 7.5 },
      ctrl_held: false,
    });
    store.setActiveSketch(rectangle.sketch);
    await engine.endSketch();
    return engine.profileCatalog();
  });

  assert.equal(catalog.length, 1);
  assert.equal(catalog[0].profiles.length, 1);
  assert.ok(Math.abs(catalog[0].profiles[0].area - 450) < 1e-7);
  assert.equal(
    catalog[0].profiles[0].curves.length,
    4,
    'the longer rectangle carrier should remain one analytic edge',
  );
  assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join('\n')}`);

  console.log('  [ok] coincident attached line preserves one 450 mm² rectangular profile');
} finally {
  await browser.close();
}
