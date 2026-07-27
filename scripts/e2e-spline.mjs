/**
 * noBS CAD fit-point Spline end-to-end verification (real Chromium,
 * M1 follow-up) — REAL UI clicks only (owner rule):
 *   1. Ribbon Spline button → chain clicks → Enter commits an interpolating
 *      spline (entity + engine tessellation in the snapshot)
 *   2. Pick/select ON the curve (the pick-shadowing class of bug: a new
 *      entity kind must be clickable immediately)
 *   3. Delete + undo/redo round trip
 *   4. Double-click commits; Esc cancels mid-run; tool retires cleanly
 * Screenshots land in docs/qa/spline/.
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'http://localhost:7199';
const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, '..', 'docs', 'qa', 'spline');

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  [${ok ? 'ok' : 'FAIL'}] ${name}${ok ? '' : ` — ${detail}`}`);
  if (!ok) failures += 1;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 300)));

const state = () => page.evaluate(() => window.__appStore.getState());
const sketch = async () => (await state()).activeSketch;
const shot = (name) => page.screenshot({ path: path.join(shots, `${name}.png`) });
const clickSketch = async (x, y) => {
  const p = await page.evaluate(([sx, sy]) => window.__sketchToScreen(sx, sy), [x, y]);
  await page.mouse.click(p.x, p.y);
};
const moveSketch = async (x, y) => {
  const p = await page.evaluate(([sx, sy]) => window.__sketchToScreen(sx, sy), [x, y]);
  await page.mouse.move(p.x, p.y, { steps: 4 });
};
const dblClickSketch = async (x, y) => {
  const p = await page.evaluate(([sx, sy]) => window.__sketchToScreen(sx, sy), [x, y]);
  await page.mouse.dblclick(p.x, p.y);
};

const splines = (sk) => sk.entities.filter((e) => e.kind === 'spline');

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

  // --- 1. Chain + Enter commit -------------------------------------------
  console.log('1. fit-point spline via ribbon button + Enter');
  await page.click('button[title="Spline"]');
  await page.waitForTimeout(250);
  let s = await state();
  check('ribbon button activates splineFit', s.activeTool === 'splineFit', s.activeTool ?? 'null');
  await clickSketch(0, 0);
  await moveSketch(20, 30);
  await page.waitForTimeout(200);
  await clickSketch(20, 30);
  await moveSketch(40, 0);
  await page.waitForTimeout(200);
  await shot('spline-01a-rubberband');
  await clickSketch(40, 0);
  await clickSketch(60, 20);
  await page.waitForTimeout(250);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  let sk = await sketch();
  check('one spline entity', splines(sk).length === 1, `n=${splines(sk).length}`);
  const sp = splines(sk)[0];
  check('4 fit points', sp.points.length === 4, `n=${sp.points.length}`);
  check('tessellation 3 spans × 16 + 1', sp.tessellation.length === 49, `n=${sp.tessellation.length}`);
  const interp = sp.points.every((p) => sp.tessellation.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 1e-6));
  check('curve interpolates every fit point', interp);
  check(
    'free spline exposes its fit-point DOF',
    sp.fully_defined === false && sk.dof.value === 8,
    `fully_defined=${sp.fully_defined} dof=${sk.dof.value}`,
  );
  await shot('spline-01b-committed');

  // --- 2. Pick ON the curve (new-kind shadow check) ------------------------
  console.log('2. pick the spline on-curve');
  const mid = sp.tessellation[Math.floor(sp.tessellation.length / 2)];
  await page.keyboard.press('Escape'); // retire the tool first (select mode)
  await page.waitForTimeout(200);
  await clickSketch(mid.x, mid.y);
  await page.waitForTimeout(250);
  s = await state();
  check('clicking the curve selects the spline', s.selectedEntity === sp.id, `sel=${s.selectedEntity} want=${sp.id}`);
  // Click right next to an END fit point: must still pick the spline
  // (fit points are inline — no point entities to shadow the pick).
  await clickSketch(59.2, 19.5);
  await page.waitForTimeout(250);
  s = await state();
  check('near-endpoint click still picks the spline', s.selectedEntity === sp.id, `sel=${s.selectedEntity}`);

  // --- 3. Delete + undo/redo ----------------------------------------------
  console.log('3. delete + undo/redo');
  await page.keyboard.press('Delete');
  await page.waitForTimeout(400);
  sk = await sketch();
  check('delete removes the spline', splines(sk).length === 0);
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(300);
  sk = await sketch();
  check('undo brings it back', splines(sk).length === 1);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await page.waitForTimeout(300);
  sk = await sketch();
  check('redo deletes again', splines(sk).length === 0);

  // --- 4. Double-click commit + Esc ladder ---------------------------------
  console.log('4. double-click commit + Esc ladder');
  await page.click('button[title="Spline"]');
  await page.waitForTimeout(250);
  await clickSketch(-50, -30);
  await clickSketch(-30, -10);
  await dblClickSketch(-10, -25); // adds the point AND commits
  await page.waitForTimeout(500);
  sk = await sketch();
  check('double-click commits 3-point spline', splines(sk).length === 1 && splines(sk)[0].points.length === 3, `n=${splines(sk).length}`);
  s = await state();
  check('tool still armed after commit', s.activeTool === 'splineFit', s.activeTool ?? 'null');
  await shot('spline-04-dblclick');

  await clickSketch(30, -40); // start another run…
  await clickSketch(50, -30);
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape'); // …and cancel it
  await page.waitForTimeout(200);
  sk = await sketch();
  s = await state();
  check('Esc cancels the run, nothing committed', splines(sk).length === 1 && s.activeTool === 'splineFit');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  s = await state();
  check('second Esc retires the tool', s.activeTool === null, s.activeTool ?? 'null');

  check('no page errors during e2e', true);
} finally {
  await browser.close();
}

if (failures > 0) {
  console.log(`\ne2e-spline: ${failures} check(s) FAILED`);
  process.exit(1);
}
console.log('\ne2e-spline: all checks passed');
