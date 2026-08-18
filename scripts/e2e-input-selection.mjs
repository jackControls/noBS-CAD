/**
 * Numeric input editing regression:
 * - command activation and Tab focus select all for fast replacement;
 * - first activation selects all, a later single click places a native caret,
 *   and a double-click selects all again;
 * - sketch dynamic-input fields visibly select and replace on Tab/click.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE = 'http://localhost:7199';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error)));

const state = () => page.evaluate(() => window.__appStore.getState());
const sketchToScreen = (x, y) =>
  page.evaluate(([sx, sy]) => window.__sketchToScreen(sx, sy), [x, y]);
const clickSketch = async (x, y) => {
  const point = await sketchToScreen(x, y);
  await page.mouse.click(point.x, point.y);
};

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__appStore.getState().document !== null);

  // A lightweight real feature dialog gives us an ordinary numeric input
  // without first creating a solid.
  await page.evaluate(() =>
    window.__appStore.getState().openConstructionPlaneDialog('offset'),
  );
  const planeDialog = page.getByTestId('construction-plane-dialog');
  await planeDialog.waitFor({ state: 'visible' });
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="construction-plane-dialog"]')?.textContent?.includes('Loading'),
  );
  assert.equal(
    (await state()).constructionPlanePickTarget,
    'first_reference',
    'a new construction plane clearly enters reference-selection mode',
  );
  const selectionStatus = page.getByTestId('construction-plane-selection-status');
  await selectionStatus.waitFor({ state: 'visible' });
  assert.match(
    (await selectionStatus.textContent()) ?? '',
    /Viewport selection active.*reference plane/i,
  );
  assert.match(
    (await page.locator('[data-native-hud="prompt"]').textContent()) ?? '',
    /Select the first planar face or reference plane/i,
    'the shared Bevy HUD prompt mirrors the active dialog role',
  );
  await page.keyboard.press('Escape');
  assert.equal(
    (await state()).constructionPlanePickTarget,
    null,
    'Escape stops reference picking without closing the command dialog',
  );
  await page.getByTestId('pick-construction-first-reference').click();
  assert.equal((await state()).constructionPlanePickTarget, 'first_reference');

  const reference = planeDialog.getByLabel('Reference plane');
  await reference.selectOption('origin:xz');
  assert.equal(
    (await state()).constructionPlanePickTarget,
    null,
    'choosing a reference from the field ends viewport selection',
  );
  const distance = planeDialog.getByLabel('Offset distance (mm)');
  await page.waitForFunction(
    () => document.activeElement instanceof HTMLInputElement
      && document.activeElement.type === 'number'
      && document.activeElement.closest('[data-testid="construction-plane-dialog"]') !== null,
  );
  await page.keyboard.type('25');
  assert.equal(
    await distance.inputValue(),
    '25',
    'choosing required geometry focuses and replaces the complete measurement',
  );

  await reference.click();
  await page.keyboard.press('Tab');
  assert.equal(
    await page
      .getByTestId('pick-construction-first-reference')
      .evaluate((element) => element === document.activeElement),
    true,
    'Tab reaches the accessible viewport Pick action after the reference field',
  );
  await page.keyboard.press('Tab');
  assert.equal(
    await distance.evaluate((element) => element === document.activeElement),
    true,
    'Tab moves focus into the dimension input',
  );
  await page.keyboard.type('12');
  assert.equal(
    await distance.inputValue(),
    '12',
    'Tab focus replaces the complete numeric value',
  );
  await planeDialog.getByRole('button', { name: 'Cancel' }).click();

  // The expression-capable inline sketch dimension editor uses the same
  // primitive in text mode.
  await page.evaluate(() =>
    window.__appStore.getState().setDimEditor({
      dimId: 999,
      initial: '=50/2',
      x: 500,
      y: 300,
    }),
  );
  const expressionInput = page.locator('[data-dimension-input][type="text"]');
  await expressionInput.waitFor({ state: 'visible' });
  await page.waitForFunction(() => {
    const input = document.querySelector('[data-dimension-input][type="text"]');
    return input === document.activeElement && input?.value === '=50/2';
  });
  await page.keyboard.type('30');
  assert.equal(
    await expressionInput.inputValue(),
    '30',
    'a newly opened expression dimension is ready for direct replacement',
  );
  await expressionInput.fill('12.34');
  await expressionInput.evaluate((element) => element.blur());
  await expressionInput.click({ position: { x: 30, y: 14 } });
  const activationSelection = await expressionInput.evaluate((element) => ({
    start: element.selectionStart,
    end: element.selectionEnd,
    length: element.value.length,
  }));
  assert.deepEqual(
    activationSelection,
    { start: 0, end: activationSelection.length, length: activationSelection.length },
    'the first click that activates a dimension selects the complete value',
  );
  await expressionInput.click({ position: { x: 30, y: 14 } });
  const caretBeforeArrow = await expressionInput.evaluate((element) => ({
    start: element.selectionStart,
    end: element.selectionEnd,
    length: element.value.length,
  }));
  assert.equal(
    caretBeforeArrow.start,
    caretBeforeArrow.end,
    'clicking an existing dimension places a caret instead of selecting all',
  );
  assert.ok(
    caretBeforeArrow.start > 0 && caretBeforeArrow.start < caretBeforeArrow.length,
    `pointer caret should land inside the numeric string: ${JSON.stringify(caretBeforeArrow)}`,
  );
  await page.keyboard.press('ArrowRight');
  const caretAfterArrow = await expressionInput.evaluate(
    (element) => element.selectionStart,
  );
  assert.equal(
    caretAfterArrow,
    caretBeforeArrow.start + 1,
    'Left/Right arrow keys move the inline dimension caret normally',
  );
  await expressionInput.dblclick({ position: { x: 30, y: 14 } });
  const doubleClickSelection = await expressionInput.evaluate((element) => ({
    start: element.selectionStart,
    end: element.selectionEnd,
    length: element.value.length,
  }));
  assert.deepEqual(
    doubleClickSelection,
    { start: 0, end: doubleClickSelection.length, length: doubleClickSelection.length },
    'double-clicking a dimension selects the complete value',
  );
  await expressionInput.press('Escape');

  // Exercise the custom sketch dynamic-input system.
  await page.getByRole('button', { name: 'Create Sketch' }).first().click();
  await page.waitForTimeout(250);
  const xyPlane = page.getByText('XY Plane', { exact: true });
  if (!(await xyPlane.isVisible())) {
    await page.getByRole('button', { name: 'Origin' }).click();
  }
  await xyPlane.click();
  await page.waitForFunction(() => window.__appStore.getState().mode === 'sketch');
  await page.locator('button[title="Rectangle"]').click();
  await clickSketch(-30, -20);
  const previewPoint = await sketchToScreen(20, 10);
  await page.mouse.move(previewPoint.x, previewPoint.y);
  await page.waitForFunction(() => window.__appStore.getState().dynInput.active);

  await page.keyboard.type('50');
  await page.keyboard.press('Tab');
  let app = await state();
  assert.equal(app.dynInput.focus, 1);
  assert.equal(app.dynInput.selectAll, true, 'Tab selects the whole next field');
  await page.keyboard.type('30');

  await page.keyboard.press('Shift+Tab');
  app = await state();
  assert.equal(app.dynInput.focus, 0);
  assert.equal(app.dynInput.selectAll, true, 'Shift+Tab selects the prior field');
  await page.keyboard.type('40');
  app = await state();
  assert.equal(
    app.dynInput.fields.find((field) => field.key === 'width')?.value,
    '40',
    'typing replaces the selected width instead of appending',
  );

  await page.locator('[data-dyn-field="height"]').click();
  app = await state();
  assert.equal(app.dynInput.selectAll, true, 'mouse click selects the dynamic value');
  await page.keyboard.type('20');
  app = await state();
  assert.equal(
    app.dynInput.fields.find((field) => field.key === 'height')?.value,
    '20',
    'typing replaces the mouse-selected height instead of appending',
  );
  assert.deepEqual(pageErrors, []);

  console.log('  [ok] dimension inputs support fast replacement and precise caret editing');
} finally {
  await browser.close();
}
