/**
 * Ribbon flyout regression for issue 127 ([bug] Submenu not displayed - OSX).
 *
 * The packaged desktop shell draws the Bevy viewport in an opaque native child
 * above the webview and cuts holes in it for DOM overlay islands. A hover-only
 * flyout that overflows the portaled menu's own box is never part of any island
 * rectangle, so on macOS the submenu painted behind the native surface: the menu
 * was visible, the submenu was not. This suite drives the real DRAW flyout and
 * asserts both halves of the contract:
 *
 *   1. the flyout paints and stays hit-testable beyond the parent menu's box,
 *   2. an interior point of the flyout is covered by the rectangles the desktop
 *      host receives as `overlays` (`collectNativeViewportOverlayRects`).
 *
 * Coverage is measured against the geometry the native mask is built from, not
 * against a screenshot: browser output cannot prove a Bevy-surface fix.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE = 'http://localhost:7199';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.stack ?? String(error)));

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  [${ok ? 'ok' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const activeTool = () => page.evaluate(() => window.__appStore.getState().activeTool);

/** Rectangles the desktop host cuts out of the opaque native viewport. */
const overlayRects = () => page.evaluate(async () => {
  const { collectNativeViewportOverlayRects } = await import(
    '/src/components/viewport/nativeViewportBridge.ts'
  );
  return collectNativeViewportOverlayRects();
});

const rectCoverage = (target, rects) => {
  const intersect = (a, b) => Math.max(
    0,
    Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
  ) * Math.max(
    0,
    Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
  );
  const area = target.width * target.height;
  if (area <= 0) return 0;
  return rects.reduce((sum, rect) => sum + intersect(target, rect), 0) / area;
};

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1400);
  await page.click('button:has-text("Create Sketch")');
  await page.waitForTimeout(400);
  if (!(await page.locator('text=XY Plane').isVisible())) {
    await page.click('button[aria-label="Origin"]');
    await page.waitForTimeout(200);
  }
  await page.click('text=XY Plane');
  await page.waitForTimeout(1100);

  // --- 1. Hover opens the flyout and it is its own native cut-out island ---
  console.log('1. hover flyout paints, hit-tests and is cut out of the native viewport');
  await page.getByRole('button', { name: 'DRAW', exact: true }).click();
  await page.waitForTimeout(200);
  const parentMenu = page.locator('[data-ribbon-menu]');
  const rectangleRow = parentMenu.locator('[data-ribbon-menu-id="rectangle"]');
  const menuBox = await parentMenu.locator('[role="menu"]').first().boundingBox();

  await rectangleRow.hover();
  await page.waitForTimeout(250);
  const flyout = page.locator('[data-ribbon-flyout]');
  const opened = await flyout.isVisible();
  check('hover opens the Rectangle flyout', opened);
  check('row reports its expanded state', await rectangleRow.getAttribute('aria-expanded') === 'true');
  if (!opened) throw new Error('the hover flyout never mounted; the rest of the contract cannot be checked');

  const flyoutBox = await flyout.boundingBox();
  check(
    'flyout overflows the parent menu box',
    Boolean(flyoutBox && menuBox && flyoutBox.x >= menuBox.x + menuBox.width - 2),
    JSON.stringify({ menuBox, flyoutBox }),
  );

  // The UI-overlay invariant: an interior point beyond the trigger container's
  // own box must resolve to the surface, not to whatever sits underneath.
  const hit = await page.evaluate(({ x, y }) => {
    const element = document.elementFromPoint(x, y);
    return element?.closest('[data-ribbon-flyout]') ? element.textContent : null;
  }, { x: flyoutBox.x + flyoutBox.width - 24, y: flyoutBox.y + 16 });
  check('flyout interior point hit-tests to the flyout', Boolean(hit), hit ?? 'no hit');

  const islands = await overlayRects();
  const coverage = rectCoverage(flyoutBox, islands);
  check(
    'native viewport cut-out covers the whole flyout',
    coverage > 0.99,
    `coverage ${(coverage * 100).toFixed(1)}% of ${JSON.stringify(flyoutBox)}`,
  );

  // --- 2. A child command still dispatches from the flyout -----------------
  console.log('2. flyout child dispatch');
  await flyout.getByText('Center Rectangle', { exact: true }).click();
  await page.waitForTimeout(250);
  const tool = await activeTool();
  check('Center Rectangle armed from the flyout', tool === 'rectCenter', tool ?? 'null');
  check('choosing a child closes the menu', await page.locator('[data-ribbon-menu]').count() === 0);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);

  // --- 3. Keyboard enters, owns and releases the flyout --------------------
  console.log('3. keyboard access and focus ownership');
  await page.getByRole('button', { name: 'DRAW', exact: true }).click();
  await page.waitForTimeout(200);
  const menuRow = (id) => page.locator(`[data-ribbon-menu-id="${id}"]`);
  const activeRow = () => page.evaluate(() => document.activeElement?.getAttribute('data-ribbon-menu-id'));
  const flyoutRows = () => page.evaluate(() => [...document.querySelectorAll('[data-ribbon-flyout] [data-ribbon-menu-id]')]
    .map((element) => element.getAttribute('data-ribbon-menu-id')));
  const tabUntil = async (id) => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (await activeRow() === id) return true;
      await page.keyboard.press('Tab');
      await page.waitForTimeout(60);
    }
    return await activeRow() === id;
  };

  await menuRow('arc').focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(150);
  check('ArrowRight opens the focused flyout', await page.locator('[data-ribbon-flyout]').isVisible());
  check('Tab enters the open submenu', await tabUntil('arcCenter'));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  check('Escape closes only the flyout', (await page.locator('[data-ribbon-flyout]').count()) === 0);
  check('the parent menu stays open', (await page.locator('[data-ribbon-menu]').count()) === 1);
  check('Escape from a child restores parent focus', await activeRow() === 'arc');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(150);
  check('the parent row reopens its flyout from the keyboard', await page.locator('[data-ribbon-flyout]').isVisible());
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);

  // Focus departure dismisses the panel it left; one row owns one panel.
  await menuRow('rectangle').focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(150);
  check('Tab leaves the submenu for the next parent row', await tabUntil('circle'));
  check('the departed panel is dismissed', (await page.locator('[data-ribbon-flyout]').count()) === 0);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(150);
  check(
    'the focused row owns the only open panel',
    JSON.stringify(await flyoutRows()) === JSON.stringify(['circleCenter', 'circle2pt', 'circle3pt']),
    JSON.stringify(await flyoutRows()),
  );
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);

  // A panel holding keyboard focus survives the pointer crossing away.
  await menuRow('arc').hover();
  await page.waitForTimeout(150);
  await page.locator('[data-ribbon-flyout] [data-ribbon-menu-id="arc3pt"]').focus();
  await page.mouse.move(20, 600);
  await page.waitForTimeout(500);
  check('focused panel survives pointer leave', (await page.locator('[data-ribbon-flyout]').count()) === 1);
  check('pointer leave keeps focused commands', await activeRow() === 'arc3pt');

  // --- 4. Leaving an unfocused row closes the flyout -----------------------
  console.log('4. pointer leave closes an unfocused flyout');
  const lineRow = page.locator('[data-ribbon-menu] [data-ribbon-menu-id="line"]');
  await lineRow.focus();
  await page.waitForTimeout(100);
  await menuRow('arc').hover();
  await page.waitForTimeout(150);
  check('flyout reopens on hover', await page.locator('[data-ribbon-flyout]').isVisible());
  await lineRow.hover();
  await page.waitForTimeout(500);
  check('flyout closes after the pointer leaves', (await page.locator('[data-ribbon-flyout]').count()) === 0);

  check('no page errors', pageErrors.length === 0, pageErrors.join('; '));
} catch (error) {
  failures += 1;
  console.error(error);
} finally {
  await browser.close();
}

assert.equal(failures, 0, `${failures} ribbon flyout check(s) failed`);
console.log('\nPASS ribbon submenu contract');
