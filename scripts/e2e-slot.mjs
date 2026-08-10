/**
 * noBS CAD Slot tool end-to-end verification (real Chromium, M1
 * follow-up) — REAL UI clicks only (owner rule):
 *   1. DRAW → Slot → Center to Center Slot: two center clicks, typed
 *      width → capsule (2 lines + 2 arcs), tangent/parallel/equal
 *      constraints, Ø driving dimension (D9), Enter ladder commit
 *   2. Cursor-derived width (no typing): geometry right, NO dimension
 *   3. Overall mode: end-cap centers inset by the radius
 *   4. Esc mid-run cancels; second Esc retires the tool
 * Screenshots land in docs/qa/slot/.
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'http://localhost:7199';
const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, '..', 'docs', 'qa', 'slot');

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

const pickSlotVariant = async (label) => {
  await page.getByRole('button', { name: 'DRAW', exact: true }).click();
  await page.waitForTimeout(250);
  const menu = page.locator('[data-ribbon-menu]');
  await menu.locator('span:text-is("Slot")').first().hover();
  await page.waitForTimeout(250);
  await menu.locator(`span:text-is("${label}")`).click();
  await page.waitForTimeout(250);
};

const lineLen = (l) => Math.hypot(l.end.x - l.start.x, l.end.y - l.start.y);

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

  // --- 1. Center-to-center, typed width ----------------------------------
  console.log('1. center-to-center slot, typed width');
  await pickSlotVariant('Center to Center Slot');
  let s = await state();
  check('menu item activates slot tool', s.activeTool === 'slot' && s.slotMode === 'centerToCenter', `${s.activeTool}/${s.slotMode}`);
  await clickSketch(0, 0); // first end-cap center
  await page.waitForTimeout(250);
  s = await state();
  check('no width field before the axis exists', !s.dynInput.active);
  await moveSketch(40, 20); // axis rubber-band
  await page.waitForTimeout(200);
  await shot('slot-01a-axis-rubberband');
  await clickSketch(60, 0); // second center → width field armed
  await page.waitForTimeout(300);
  s = await state();
  check('width field armed after 2nd center', s.dynInput.active && s.dynInput.fields.some((f) => f.key === 'width'));
  await moveSketch(60, 14); // capsule rubber-band
  await page.waitForTimeout(300);
  await shot('slot-01b-capsule-preview');
  await page.keyboard.type('12', { delay: 40 });
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter'); // all locked → commit
  await page.waitForTimeout(500);
  let sk = await sketch();
  const lines1 = sk.entities.filter((e) => e.kind === 'line');
  const arcs1 = sk.entities.filter((e) => e.kind === 'arc');
  check('capsule: 2 lines + 2 arcs', lines1.length === 2 && arcs1.length === 2, `l=${lines1.length} a=${arcs1.length}`);
  check('arc radius = width/2 = 6', arcs1.every((a) => Math.abs(a.radius - 6) < 0.01), arcs1.map((a) => a.radius).join(','));
  check('side lines at y=±6, length 60', lines1.every((l) => Math.abs(Math.abs(l.start.y) - 6) < 0.01 && Math.abs(lineLen(l) - 60) < 0.01));
  const nTangent = sk.constraints.filter((c) => c.type === 'tangent').length;
  const nParallel = sk.constraints.filter((c) => c.type === 'parallel').length;
  const nEqual = sk.constraints.filter((c) => c.type === 'equal').length;
  check('4 tangent + 1 parallel + 1 equal constraints', nTangent === 4 && nParallel === 1 && nEqual === 1, `t=${nTangent} p=${nParallel} e=${nEqual}`);
  check('Ø12.00 driving dimension', sk.dimensions.length === 1 && sk.dimensions[0].text === 'Ø12.00' && sk.dimensions[0].kind === 'diameter', sk.dimensions.map((d) => d.text).join(','));
  await shot('slot-01c-result-dimensioned');
  await page.keyboard.press('Escape'); // retire the armed slot tool
  await page.waitForTimeout(200);

  // --- 2. Cursor-derived width, no dimension ------------------------------
  console.log('2. cursor-derived width (no typing)');
  await pickSlotVariant('Center to Center Slot');
  await clickSketch(0, 40);
  await clickSketch(60, 40);
  await page.waitForTimeout(300);
  await clickSketch(60, 48); // acquires y=50 grid point → width 20
  await page.waitForTimeout(500);
  sk = await sketch();
  const arcs2 = sk.entities.filter((e) => e.kind === 'arc' && Math.abs(e.center.y - 40) < 1);
  check(
    'cursor width honors snap acquisition (radius 10)',
    arcs2.length === 2 && arcs2.every((a) => Math.abs(a.radius - 10) < 0.01),
    arcs2.map((a) => `${a.radius}`).join(','),
  );
  check('no dimension without typed input', sk.dimensions.length === 1, `dims=${sk.dimensions.length}`); // still only Ø12 from #1
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // --- 3. Overall mode: centers inset by radius ----------------------------
  console.log('3. overall slot');
  await pickSlotVariant('Overall Slot');
  s = await state();
  check('overall mode armed', s.activeTool === 'slot' && s.slotMode === 'overall', s.slotMode);
  await clickSketch(-50, -40);
  await clickSketch(10, -40);
  await page.waitForTimeout(300);
  await page.keyboard.type('10', { delay: 40 });
  await page.waitForTimeout(250);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  sk = await sketch();
  const arcs3 = sk.entities.filter((e) => e.kind === 'arc' && Math.abs(e.center.y - -40) < 1);
  const centersX = arcs3.map((a) => a.center.x).sort((a, b) => a - b);
  check('overall: centers inset by r=5', arcs3.length === 2 && Math.abs(centersX[0] - -45) < 0.01 && Math.abs(centersX[1] - 5) < 0.01, centersX.join(','));
  await shot('slot-03-overall');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // --- 4. Esc ladder mid-run ----------------------------------------------
  console.log('4. Esc ladder');
  await pickSlotVariant('Center to Center Slot');
  await clickSketch(-40, 30);
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape'); // cancel the run (after 1st center)
  await page.waitForTimeout(200);
  s = await state();
  check('Esc1 cancels run, tool stays armed', s.activeTool === 'slot' && !s.dynInput.active, s.activeTool ?? 'null');
  await page.keyboard.press('Escape'); // retire the tool
  await page.waitForTimeout(200);
  s = await state();
  check('Esc2 retires the tool', s.activeTool === null, s.activeTool ?? 'null');
  sk = await sketch();
  check('cancelled run left no geometry', sk.entities.filter((e) => e.kind === 'line').length === 6, `lines=${sk.entities.filter((e) => e.kind === 'line').length}`);

  check('no page errors during e2e', true);
} finally {
  await browser.close();
}

if (failures > 0) {
  console.log(`\ne2e-slot: ${failures} check(s) FAILED`);
  process.exit(1);
}
console.log('\ne2e-slot: all checks passed');
