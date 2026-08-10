/**
 * noBS CAD M1b end-to-end verification (real Chromium via Playwright).
 *
 * Covers: NavBar modal tools (Orbit/Pan/Zoom/Zoom Window drags), dynamic
 * input (type 50, Tab, 30, Enter → 50 mm @ 30° line), Rectangle, Circle,
 * Arc, CONSTRAIN panel application, D4.2 conflict dialog, DOF chip,
 * fully-defined coloring + browser lock, modal orbit inside a sketch (D7).
 * Screenshots land in docs/qa/m1b/.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = 'http://localhost:7199';
const SHOTS = new URL('../docs/qa/m1b/', import.meta.url).pathname;
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
const state = () => page.evaluate(() => window.__appStore.getState());
const sketch = async () => (await state()).activeSketch;
const shot = (name) => page.screenshot({ path: `${SHOTS}${name}.png` });
const sketchToScreen = (x, y) => page.evaluate(([sx, sy]) => window.__sketchToScreen(sx, sy), [x, y]);
const camera = () => page.evaluate(() => window.__cameraApi.getSnapshot());
const vecDist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const clickPanelLabel = async (text) => {
  await page.getByRole('button', { name: text, exact: true }).click();
};

const clickSketch = async (x, y) => {
  const p = await sketchToScreen(x, y);
  await page.mouse.click(p.x, p.y);
};

const enterSketchXy = async () => {
  await page.click('button:has-text("Create Sketch")');
  await page.waitForTimeout(400);
  if (!(await page.locator('text=XY Plane').isVisible())) {
    await page.click('button[aria-label="Origin"]'); // expand only if needed
    await page.waitForTimeout(200);
  }
  await page.click('text=XY Plane');
  await page.waitForTimeout(1100);
};

try {
  // --- 1. Boot + NavBar modal tools (solid mode) ---
  console.log('1. modal nav tools');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  check('mode solid at boot', (await mode()) === 'solid');
  await shot('01-boot');

  const canvasBox = await page.locator('main canvas').first().boundingBox();
  const cx = canvasBox.x + canvasBox.width / 2;
  const cy = canvasBox.y + canvasBox.height / 2;
  const cam0 = await camera();

  // Orbit modal: drag rotates the camera.
  await page.click('button[title="Orbit"]');
  await page.waitForTimeout(200);
  check('orbit button highlighted', await page.locator('button[title="Orbit"].bg-accent\\/30').count() === 1);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 160, cy - 60, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const cam1 = await camera();
  check('orbit drag changed view direction', vecDist(cam1.position, cam0.position) > 5, `moved ${vecDist(cam1.position, cam0.position).toFixed(1)}mm`);
  await shot('02-orbit-modal');
  await page.keyboard.press('Escape'); // exit modal tool
  await page.waitForTimeout(200);
  check('esc exits modal tool', (await state()).navTool === 'select');

  // Pan modal: drag translates the target.
  await page.click('button[title="Pan"]');
  await page.waitForTimeout(150);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 120, cy + 40, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const cam2 = await camera();
  check('pan drag moved the target', vecDist(cam2.target, cam1.target) > 2, `target moved ${vecDist(cam2.target, cam1.target).toFixed(1)}mm`);
  await shot('03-pan-modal');
  await page.keyboard.press('Escape');

  // Zoom modal: drag down dollies out.
  await page.click('button[title="Zoom"]');
  await page.waitForTimeout(150);
  const distBefore = vecDist(cam2.position, cam2.target);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy + 120, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const cam3 = await camera();
  const distAfter = vecDist(cam3.position, cam3.target);
  check('zoom drag dollied out', distAfter > distBefore * 1.1, `${distBefore.toFixed(0)} → ${distAfter.toFixed(0)}`);
  await page.keyboard.press('Escape');

  // Zoom Window: drag a rect → frames it (distance shrinks).
  await page.click('button[title="Zoom Window"]');
  await page.waitForTimeout(150);
  await page.mouse.move(cx - 100, cy - 60);
  await page.mouse.down();
  await page.mouse.move(cx + 100, cy + 60, { steps: 8 });
  await shot('04-zoomwindow-rect');
  await page.mouse.up();
  await page.waitForTimeout(600);
  const cam4 = await camera();
  const distZW = vecDist(cam4.position, cam4.target);
  check('zoom window framed the rect', distZW < distAfter * 0.8, `${distAfter.toFixed(0)} → ${distZW.toFixed(0)}`);
  await page.keyboard.press('Escape');
  await page.click('button[title="Fit"]');
  await page.waitForTimeout(800);

  // --- 2. Enter sketch + dynamic input ---
  console.log('2. dynamic input (50 @ 30°)');
  await enterSketchXy();
  check('sketch mode', (await mode()) === 'sketch');
  await page.keyboard.press('l');
  await page.waitForTimeout(200);
  await clickSketch(10, 10);
  await page.waitForTimeout(400);
  await page.mouse.move((await sketchToScreen(60, 45)).x, (await sketchToScreen(60, 45)).y);
  await page.waitForTimeout(400);
  check('dyn cluster visible', await page.locator('[data-dyn-input]').isVisible());
  await page.keyboard.type('50');
  await page.waitForTimeout(150);
  let dyn = (await state()).dynInput;
  check('length field locked after typing', dyn.fields.find((f) => f.key === 'length')?.locked === true);
  await shot('05a-dyn-length-locked');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(150);
  await page.keyboard.type('30');
  await page.waitForTimeout(150);
  dyn = (await state()).dynInput;
  check(
    'angle field focused + locked',
    dyn.fields.find((f) => f.key === 'angle')?.locked === true,
    JSON.stringify({
      focus: dyn.focus,
      selectAll: dyn.selectAll,
      fields: dyn.fields,
      active: await page.evaluate(() => ({
        tag: document.activeElement?.tagName,
        value: document.activeElement?.value,
      })),
    }),
  );
  await shot('05b-dyn-both-locked');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  let s = await sketch();
  const dynLine = s.entities.find((e) => e.kind === 'line');
  const wantX = 10 + 50 * Math.cos((30 * Math.PI) / 180);
  const wantY = 10 + 50 * Math.sin((30 * Math.PI) / 180);
  if (!dynLine) throw new Error(`dynamic line was not committed: ${JSON.stringify(dyn)}`);
  const gotEnd = dynLine.end;
  check(
    'Enter committed 50mm @ 30°',
    Math.abs(gotEnd.x - wantX) < 0.01 && Math.abs(gotEnd.y - wantY) < 0.01,
    `end=(${gotEnd.x.toFixed(2)},${gotEnd.y.toFixed(2)}) want=(${wantX.toFixed(2)},${wantY.toFixed(2)})`,
  );
  await shot('05c-dyn-committed-line');
  await page.keyboard.press('Escape'); // end chain
  await page.keyboard.press('Escape'); // exit tool

  // --- 3. Rectangle + Circle + Arc ---
  console.log('3. rectangle / circle / arc');
  await page.click('button[title="Rectangle"]');
  await page.waitForTimeout(150);
  await clickSketch(-50, -40);
  await page.waitForTimeout(300);
  await page.mouse.move((await sketchToScreen(-10, -10)).x, (await sketchToScreen(-10, -10)).y);
  await page.waitForTimeout(250);
  await shot('06a-rect-preview');
  await clickSketch(-10, -10);
  await page.waitForTimeout(500);
  s = await sketch();
  const rectLines = s.entities.filter((e) => e.kind === 'line' && e.id !== dynLine.id);
  const hv = s.constraints.filter((c) => c.type === 'horizontal' || c.type === 'vertical').length;
  check('rectangle: 4 lines', rectLines.length === 4, `lines=${rectLines.length}`);
  check('rectangle: 4 H/V constraints', hv >= 4, `hv=${hv}`);
  await shot('06b-rectangle');

  await page.click('button[title="Circle"]');
  await page.waitForTimeout(150);
  await clickSketch(40, -30);
  await page.waitForTimeout(300);
  await clickSketch(58, -30);
  await page.waitForTimeout(500);
  s = await sketch();
  const circle = s.entities.find((e) => e.kind === 'circle');
  // The edge click at x=58 is unambiguously closest to the x=60 grid line,
  // so the corrected second-point snap produces a 20 mm radius.
  check(
    'circle: edge click honors snap acquisition',
    !!circle && Math.abs(circle.radius - 20) < 0.01,
    circle ? `r=${circle.radius}` : 'none',
  );
  await shot('06c-circle');

  // Arc via DRAW menu flyout.
  await clickPanelLabel('DRAW');
  await page.waitForTimeout(300);
  await page.hover('[data-ribbon-menu] span:text-is("Arc")');
  await page.waitForTimeout(400);
  await page.click('[data-ribbon-menu] span:text-is("3-Point Arc")');
  await page.waitForTimeout(200);
  check('arc tool active', (await state()).activeTool === 'arc3pt');
  await clickSketch(-50, 30);
  await page.waitForTimeout(250);
  await clickSketch(-35, 45);
  await page.waitForTimeout(250);
  await clickSketch(-20, 30);
  await page.waitForTimeout(500);
  s = await sketch();
  const arc = s.entities.find((e) => e.kind === 'arc');
  check('3-point arc created', !!arc && arc.radius > 0, arc ? `r=${arc.radius.toFixed(1)}` : 'none');
  await shot('06d-arc');

  // --- 4. CONSTRAIN panel: Parallel + conflict dialog ---
  console.log('4. constraints panel + conflict');
  // Two more horizontal lines for the parallel/perpendicular scenario.
  await page.keyboard.press('l');
  await page.waitForTimeout(150);
  await clickSketch(20, 50);
  await page.waitForTimeout(250);
  await clickSketch(70, 50);
  await page.waitForTimeout(250);
  await clickSketch(20, 70);
  await page.waitForTimeout(250);
  await clickSketch(70, 70);
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  s = await sketch();
  const hLines = s.entities
    .filter((e) => e.kind === 'line')
    .filter((e) => Math.abs(e.start.y - e.end.y) < 0.01 && e.start.y > 40)
    .sort((a, b) => a.start.y - b.start.y);
  check('two horizontal scenario lines drawn', hLines.length === 2, `found ${hLines.length}`);
  // Select both (click midpoint of first, shift-click midpoint of second).
  const mid = (l) => ({ x: (l.start.x + l.end.x) / 2, y: (l.start.y + l.end.y) / 2 });
  let m = mid(hLines[0]);
  await clickSketch(m.x, m.y);
  await page.waitForTimeout(250);
  m = mid(hLines[1]);
  const mp = await sketchToScreen(m.x, m.y);
  await page.keyboard.down('Shift');
  await page.mouse.click(mp.x, mp.y);
  await page.keyboard.up('Shift');
  await page.waitForTimeout(250);
  check('two lines multi-selected', (await state()).selectedEntities.length === 2, `sel=${(await state()).selectedEntities}`);
  await shot('07a-two-lines-selected');
  await page.click('button[title="Parallel"]');
  await page.waitForTimeout(400);
  s = await sketch();
  check('parallel applied via panel', s.constraints.some((c) => c.type === 'parallel'));
  await shot('07b-parallel-applied');

  // Perpendicular now conflicts (D4.2) → dialog.
  await page.click('button[title="Perpendicular"]');
  await page.waitForTimeout(500);
  const dialogVisible = await page.locator('div[role="dialog"]').isVisible();
  check('conflict dialog appears', dialogVisible);
  const dialogText = dialogVisible ? await page.locator('div[role="dialog"]').textContent() : '';
  check('dialog names the conflict', dialogText.includes('conflicts with') && dialogText.includes('parallel'), dialogText.slice(0, 120).replace(/\s+/g, ' '));
  await shot('07c-conflict-dialog');
  await page.click('div[role="dialog"] button:has-text("OK")');
  await page.waitForTimeout(300);
  s = await sketch();
  check('perpendicular was rejected (not in sketch)', !s.constraints.some((c) => c.type === 'perpendicular'));

  // --- 5. DOF chip + fully-defined coloring ---
  console.log('5. DOF chip + fully-defined');
  await page.click('button[title="Toggle DOF display"]');
  await page.waitForTimeout(300);
  const chipText = await page.locator('button[title="Toggle DOF display"]').textContent();
  check('DOF chip shows count', chipText.includes('DOF:'), chipText.trim());
  await shot('08a-dof-chip');

  // Fix two opposite rectangle corners: per-entity flags + DOF drop.
  const dofBefore = (await sketch()).dof.value;
  const fixPoint = async (x, y) => {
    const p = await sketchToScreen(x, y);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(250);
    await page.click('button[title="Fix/UnFix"]');
    await page.waitForTimeout(350);
  };
  await fixPoint(-50, -40);
  await fixPoint(-10, -10);
  s = await sketch();
  check('fixing two corners dropped DOF by 4', s.dof.value === dofBefore - 4, `${dofBefore} → ${s.dof.value}`);
  const rectEntities = s.entities.filter((e) => {
    const pts = e.kind === 'line' ? [e.start, e.end] : e.kind === 'point' ? [e.position] : [];
    return pts.some((p) => p.x >= -50 && p.x <= -10 && p.y >= -40 && p.y <= -10);
  });
  check('rectangle entities flagged fully_defined', rectEntities.length > 0 && rectEntities.every((e) => e.fully_defined));

  // Whole-sketch fully-defined in a fresh rectangle-only sketch.
  await page.click('button:has-text("FINISH SKETCH")');
  await page.waitForTimeout(900);
  await enterSketchXy();
  await page.click('button[title="Rectangle"]');
  await page.waitForTimeout(150);
  await clickSketch(0, 0);
  await page.waitForTimeout(250);
  await clickSketch(40, 20);
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape'); // exit the rectangle tool before selecting
  await page.waitForTimeout(200);
  // The origin corner is grounded automatically; fix only the opposite
  // corner. Clicking Fix on the origin would intentionally unfix it.
  await fixPoint(40, 20);
  s = await sketch();
  check('rectangle-only sketch fully defined (dof 0)', s.dof.value === 0 && s.dof.fully_defined, `dof=${s.dof.value}`);
  check('browser shows lock for fully-defined sketch', (await page.locator('aside svg.lucide-lock').count()) >= 1);
  await shot('08b-fully-defined');

  // --- 6. Modal orbit INSIDE the sketch (D7) ---
  console.log('6. modal orbit in sketch (D7)');
  const camS0 = await camera();
  await page.click('button[title="Orbit"]');
  await page.waitForTimeout(150);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 100, cy - 80, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const camS1 = await camera();
  check('orbit works inside an active sketch', vecDist(camS1.position, camS0.position) > 5);
  check('still in sketch mode', (await mode()) === 'sketch');
  await shot('09-orbit-in-sketch');
  await page.keyboard.press('Escape');

  // Finish.
  await page.click('button:has-text("FINISH SKETCH")');
  await page.waitForTimeout(900);
  check('finished sketch', (await mode()) === 'solid');

  check('no page errors during e2e', pageErrors.length === 0, pageErrors[0]?.split('\n')[0] ?? '');
  if (pageErrors.length > 0) console.log(pageErrors.join('\n---\n').slice(0, 2000));
} finally {
  await browser.close();
}

if (failures > 0) {
  console.error(`\n${failures} e2e check(s) FAILED`);
  process.exit(1);
}
console.log('\ne2e-m1b: all checks passed');
