/**
 * noBS CAD M1a end-to-end verification (real Chromium via Playwright).
 *
 * Prereq: `npm run dev` already running on port 7199 (the run script spawns
 * and kills its own server — see package.json "e2e").
 *
 * Covers: boot → Create Sketch → plane picker → XY pick → sketch mode →
 * SKETCH > DRAW dropdown → Line chain with H/V glyphs → endpoint drag →
 * undo → finish → Orientation Dial presets and drag-orbit assertions.
 * Screenshots land in docs/qa/m1a/ and are meant to be eyeballed.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = 'http://localhost:7199';
const SHOTS = new URL('../docs/qa/m1a/', import.meta.url).pathname;
await mkdir(SHOTS, { recursive: true });

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  [${ok ? 'ok' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(String(err.stack ?? err)));

const mode = () => page.evaluate(() => window.__appStore.getState().mode);
const shot = (name) => page.screenshot({ path: `${SHOTS}${name}.png` });
const state = () => page.evaluate(() => window.__appStore.getState());

const sketchToScreen = (x, y) => page.evaluate(([sx, sy]) => window.__sketchToScreen(sx, sy), [x, y]);

const cameraCheck = async (label, expectedDir, expectedUp) => {
  const snap = await page.evaluate(() => window.__cameraApi.getSnapshot());
  const sub = (a, b) => a.map((v, i) => v - b[i]);
  const norm = (a) => Math.hypot(...a);
  const delta = sub(snap.position, snap.target);
  const dir = delta.map((v) => v / norm(delta));
  const dirErr = Math.sqrt(dir.map((v, i) => (v - expectedDir[i]) ** 2).reduce((a, b) => a + b, 0));
  const upErr = Math.sqrt(snap.up.map((v, i) => (v - expectedUp[i]) ** 2).reduce((a, b) => a + b, 0));
  check(`${label}: view direction axis-aligned`, dirErr < 0.01, `dir=[${dir.map((v) => v.toFixed(3))}] err=${dirErr.toFixed(4)}`);
  check(`${label}: screen-up correct`, upErr < 0.01, `up=[${snap.up.map((v) => v.toFixed(2))}] err=${upErr.toFixed(4)}`);
};

try {
  // --- 1. Boot ---
  console.log('1. boot');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const s0 = await state();
  check('mode solid at boot', (await mode()) === 'solid');
  check('wasm engine active', s0.engineKind === 'wasm', `kind=${s0.engineKind}`);
  check('document loaded', !!s0.document, s0.document?.name);
  await shot('01-boot');

  // --- 2. Plane picker ---
  console.log('2. create sketch → plane picker');
  await page.click('button:has-text("Create Sketch")');
  await page.waitForTimeout(500);
  check('pickPlane mode', (await mode()) === 'pickPlane');
  await page.mouse.move(700, 420); // hover a quad for the screenshot
  await page.waitForTimeout(300);
  await shot('02-plane-picker');

  // --- 3. Pick XY via the browser tree row (tests hover-sync + browser pick) ---
  console.log('3. pick XY');
  await page.click('button[aria-label="Origin"]'); // expand Origin folder
  await page.waitForTimeout(250);
  await page.click('text=XY Plane');
  await page.waitForTimeout(1200); // camera animation ~400 ms + settle
  check('sketch mode', (await mode()) === 'sketch');
  const s1 = await state();
  check('Sketch1 active', s1.activeSketch?.name === 'Sketch1');
  check('XY basis Z-up', JSON.stringify(s1.activeSketch?.basis?.normal) === '[0,0,1]');
  check(
    'Sketch1 in browser tree',
    await page.getByRole('treeitem').filter({ hasText: /^Sketch1/ }).isVisible(),
  );
  check('sketch palette visible', await page.locator('text=SKETCH PALETTE').isVisible());
  await shot('03-sketch-mode');

  // --- 4. SKETCH > DRAW dropdown ---
  console.log('4. sketch DRAW menu');
  // Exact naming avoids the peer Drawing workspace tab.
  await page.getByRole('button', { name: 'DRAW', exact: true }).click();
  await page.waitForTimeout(350);
  const lineItem = page.locator('[data-ribbon-menu]').getByText('Line', { exact: true });
  check('Line item visible in open menu', await lineItem.isVisible());
  await shot('04-sketch-create-menu');

  // --- 5. Line tool: L-shaped chain (10,10) → (60,10) → (60,40) mm ---
  console.log('5. line chain');
  await lineItem.click();
  await page.waitForTimeout(200);
  check('line tool active', (await state()).activeTool === 'line');

  const p1 = await sketchToScreen(10, 10);
  const p2 = await sketchToScreen(60, 10);
  const p3 = await sketchToScreen(60, 40);
  check('sketch→screen projection available', !!(p1 && p2 && p3));
  await page.mouse.click(p1.x, p1.y);
  await page.waitForTimeout(300);
  await page.mouse.move(p2.x, p2.y); // rubber-band + H glyph preview
  await page.waitForTimeout(350);
  await shot('05a-line-preview-h');
  await page.mouse.click(p2.x, p2.y);
  await page.waitForTimeout(300);
  await page.mouse.move(p3.x, p3.y);
  await page.waitForTimeout(350);
  await page.mouse.click(p3.x, p3.y);
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape'); // end chain
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape'); // exit line tool (second Esc step)
  await page.waitForTimeout(200);
  check('tool deactivated after Esc ladder', (await state()).activeTool === null);

  let sketch = (await state()).activeSketch;
  const lines = sketch.entities.filter((e) => e.kind === 'line');
  check('two lines drawn', lines.length === 2, `entities=${sketch.entities.length}`);
  check('three points (shared corner)', sketch.entities.filter((e) => e.kind === 'point').length === 3);
  const ctypes = sketch.constraints.map((c) => c.type).sort();
  check('H and V constraints created', ctypes.includes('horizontal') && ctypes.includes('vertical'), ctypes.join(','));
  await shot('05b-line-chain-glyphs');

  // Switching tools must preserve semantic acquisition feedback. The native
  // viewport needs the snap kind as well as its position so Bevy can draw an
  // unmistakable endpoint square instead of a generic crosshair.
  await page.click('button[title="Rectangle"]');
  await page.mouse.move(p2.x, p2.y);
  await page.waitForFunction(
    () => window.__nativeViewportTransient()?.marker?.kind === 'point',
  );
  const endpointMarker = await page.evaluate(
    () => window.__nativeViewportTransient().marker,
  );
  check(
    'rectangle endpoint acquisition reaches Bevy as a point snap',
    endpointMarker?.kind === 'point',
    JSON.stringify(endpointMarker),
  );
  await shot('05c-rectangle-endpoint-snap');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);

  // --- 6. Drag the free endpoint (60,40): solver pins it; V translates ---
  console.log('6. drag endpoint + undo');
  const before = await sketchToScreen(60, 40);
  await page.mouse.move(before.x, before.y);
  await page.mouse.down();
  await page.waitForTimeout(100);
  // Stay clear of the exact 70/80 grid midpoint, whose equally valid tie
  // direction can vary with sub-pixel projection.
  const dragTo = await sketchToScreen(90, 78);
  await page.mouse.move(dragTo.x, dragTo.y, { steps: 12 });
  await page.waitForTimeout(250);
  await shot('06a-drag-mid');
  await page.mouse.up();
  await page.waitForTimeout(400);
  sketch = (await state()).activeSketch;
  const line2 = sketch.entities.find((e) => e.kind === 'line' && (e.end.y > 40 || e.start.y > 40));
  const draggedEnd = line2.end.y > line2.start.y ? line2.end : line2.start;
  // Solver drag (M1b): the endpoint is PINNED to the cursor (grid-snapped
  // to (90,80)) and the Vertical constraint keeps holding — the V line
  // translates horizontally rather than clamping the pin.
  check('drag pins endpoint to cursor (grid-snapped)', Math.abs(draggedEnd.x - 90) < 1e-6 && Math.abs(draggedEnd.y - 80) < 1e-6, `(${draggedEnd.x},${draggedEnd.y})`);
  check('V constraint holds after drag', Math.abs(line2.end.x - line2.start.x) < 1e-6, `x1=${line2.start.x} x2=${line2.end.x}`);
  await shot('06b-drag-result');

  await page.keyboard.press('Meta+z'); // undo the drag
  await page.waitForTimeout(400);
  sketch = (await state()).activeSketch;
  const line2After = sketch.entities.find((e) => e.kind === 'line' && e.id === line2.id);
  const endAfter = line2After.end.y > line2After.start.y ? line2After.end : line2After.start;
  check('undo restored endpoint', Math.abs(endAfter.y - 40) < 1e-6, `y=${endAfter.y}`);
  await shot('06c-after-undo');

  // --- 7. Finish sketch + Orientation Dial ---
  console.log('7. finish + Orientation Dial');
  await page.click('button:has-text("FINISH SKETCH")');
  await page.waitForTimeout(1200);
  check('back to solid mode', (await mode()) === 'solid');
  check(
    'sketch persisted in browser',
    await page.getByRole('treeitem').filter({ hasText: /^Sketch1/ }).isVisible(),
  );
  await shot('07a-finished');

  const dial = page.locator('[data-orientation-dial]');
  check('Orientation Dial visible', await dial.isVisible());

  await dial.locator('[data-orientation-preset="front"]').click();
  await page.waitForTimeout(700);
  await shot('07b-orientation-front');
  await cameraCheck('FRONT', [0, -1, 0], [0, 0, 1]);

  await dial.locator('[data-orientation-preset="top"]').click();
  await page.waitForTimeout(700);
  await shot('07c-orientation-top');
  await cameraCheck('TOP', [0, 0, 1], [0, 1, 0]);

  await dial.locator('[data-orientation-preset="right"]').click();
  await page.waitForTimeout(700);
  await shot('07d-orientation-right');
  await cameraCheck('RIGHT', [1, 0, 0], [0, 0, 1]);

  const indicator = dial.locator('svg');
  const indicatorBox = await indicator.boundingBox();
  const isoButton = dial.locator('[data-orientation-preset="axonometric"]');
  const isoButtonBox = await isoButton.boundingBox();
  check('axonometric preset is labeled ISO', (await isoButton.innerText()) === 'ISO');
  check(
    'ISO preset sits below the orbit dial',
    !!indicatorBox &&
      !!isoButtonBox &&
      isoButtonBox.y >= indicatorBox.y + indicatorBox.height,
    `dial bottom=${indicatorBox ? (indicatorBox.y + indicatorBox.height).toFixed(1) : 'missing'} ISO top=${isoButtonBox?.y.toFixed(1) ?? 'missing'}`,
  );
  const snapBeforeOrbit = await page.evaluate(() => window.__cameraApi.getSnapshot());
  // The center is now unobstructed, so it is available as the easiest orbit
  // drag target instead of being occupied by the former 3D preset.
  await page.mouse.move(indicatorBox.x + 38, indicatorBox.y + 38);
  await page.mouse.down();
  await page.mouse.move(indicatorBox.x + 62, indicatorBox.y + 52, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  await shot('07e-orientation-orbit');
  const snapAfterOrbit = await page.evaluate(() => window.__cameraApi.getSnapshot());
  const sub = (a, b) => a.map((v, i) => v - b[i]);
  const norm = (a) => Math.hypot(...a);
  const dirOf = (s) => {
    const d = sub(s.position, s.target);
    return d.map((v) => v / norm(d));
  };
  const dirBefore = dirOf(snapBeforeOrbit);
  const dirAfter = dirOf(snapAfterOrbit);
  const orbitDelta = Math.sqrt(dirBefore.map((v, i) => (v - dirAfter[i]) ** 2).reduce((a, b) => a + b, 0));
  check('dial drag changes view direction', orbitDelta > 0.05, `delta=${orbitDelta.toFixed(4)}`);

  await isoButton.click();
  await page.waitForTimeout(700);
  await shot('07f-orientation-axonometric');
  const home = await page.evaluate(() => window.__cameraApi.getSnapshot());
  const homeDir = dirOf(home);
  check(
    'ISO preset returns to axonometric direction',
    homeDir.every((value) => Math.abs(value) > 0.25),
    `dir=[${homeDir.map((value) => value.toFixed(3))}]`,
  );

  check('no page errors during e2e', pageErrors.length === 0, pageErrors[0]?.split('\n')[0] ?? '');
  if (pageErrors.length > 0) console.log(pageErrors.join('\n---\n').slice(0, 2000));
} finally {
  await browser.close();
}

if (failures > 0) {
  console.error(`\n${failures} e2e check(s) FAILED`);
  process.exit(1);
}
console.log('\ne2e: all checks passed');
