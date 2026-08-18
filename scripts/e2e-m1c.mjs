/**
 * noBS CAD M1c-i end-to-end verification (real Chromium via Playwright).
 *
 * Covers: shift+wheel trackpad orbit, formula input (=25*2 → 50mm + d1
 * annotation), chained formula (=d1/2 → 25mm + d2), double-click edit
 * (d1=60 → 60/30), Sketch Dimension tool (linear + angular placement),
 * ISO mode, cycle error dialog, lock/snap composition, 2-decimal angles.
 * Screenshots land in docs/qa/m1c/.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = 'http://localhost:7199';
const SHOTS = new URL('../docs/qa/m1c/', import.meta.url).pathname;
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

const clickSketch = async (x, y) => {
  const p = await sketchToScreen(x, y);
  await page.mouse.click(p.x, p.y);
};
const moveSketch = async (x, y) => {
  const p = await sketchToScreen(x, y);
  await page.mouse.move(p.x, p.y);
};

const enterSketchXy = async () => {
  await page.click('button:has-text("Create Sketch")');
  await page.waitForTimeout(400);
  if (!(await page.locator('text=XY Plane').isVisible())) {
    await page.click('button[aria-label="Origin"]');
    await page.waitForTimeout(200);
  }
  await page.click('text=XY Plane');
  await page.waitForTimeout(1100);
};

const lineLen = (l) => Math.hypot(l.end.x - l.start.x, l.end.y - l.start.y);

try {
  // --- 1. Shift+wheel trackpad orbit (D9) ---
  console.log('1. shift+wheel orbit');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1400);
  const cam0 = await camera();
  const canvasBox = await page.locator('main canvas').first().boundingBox();
  const cx = canvasBox.x + canvasBox.width / 2;
  const cy = canvasBox.y + canvasBox.height / 2;
  await page.mouse.move(cx, cy);
  await page.keyboard.down('Shift');
  await page.mouse.wheel(0, -240);
  await page.keyboard.up('Shift');
  await page.waitForTimeout(400);
  const cam1 = await camera();
  check(
    'shift+wheel orbits the camera',
    vecDist(cam1.position, cam0.position) > 3 && vecDist(cam1.target, cam0.target) < 0.01,
    `moved ${vecDist(cam1.position, cam0.position).toFixed(1)}mm`,
  );
  // Plain wheel still zooms.
  await page.mouse.wheel(0, -240);
  await page.waitForTimeout(300);
  const cam2 = await camera();
  check(
    'plain wheel still zooms',
    vecDist(cam2.position, cam1.position) > 3 || Math.abs(vecDist(cam2.position, cam2.target) - vecDist(cam1.position, cam1.target)) > 3,
    `dist ${vecDist(cam1.position, cam1.target).toFixed(0)} → ${vecDist(cam2.position, cam2.target).toFixed(0)}`,
  );

  // --- 2. Formula input: =25*2 → 50mm line + d1 annotation ---
  console.log('2. formula input (=25*2)');
  await enterSketchXy();
  await page.keyboard.press('l');
  await page.waitForTimeout(200);
  await clickSketch(10, 10);
  await page.waitForTimeout(400);
  await moveSketch(60, 45);
  await page.waitForTimeout(300);
  await page.keyboard.type('=25*2');
  await page.waitForTimeout(350);
  let dyn = (await state()).dynInput;
  check('length field locked with formula', dyn.fields.find((f) => f.key === 'length')?.locked === true);
  await shot('01-formula-length-field');
  // M1d Enter ladder: Enter1 advances focus length→angle (unlocked field),
  // Enter2 commits (focused field empty → accept typed/locked values).
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  let s = await sketch();
  const l1 = s.entities.find((e) => e.kind === 'line');
  check('formula line is 50mm', !!l1 && Math.abs(lineLen(l1) - 50) < 0.01, l1 ? `len=${lineLen(l1).toFixed(2)}` : 'no line');
  check('d1 dimension created with annotation', s.dimensions.length === 1 && s.dimensions[0].text === '50.00', s.dimensions.map((d) => d.text).join(','));
  check('d1 stores the expression', s.dimensions[0].param_expression === '25*2', s.dimensions[0].param_expression ?? 'none');
  check('d1 param name', s.dimensions[0].param_name === 'd1');
  const nativeDimensionPresentation = await page.evaluate(
    () => window.__nativeViewportTransient(),
  );
  check(
    'Bevy presentation receives the live dimension annotation',
    nativeDimensionPresentation.annotations.some(
      (annotation) =>
        annotation.kind === 'dimension' && annotation.text === '50.00',
    ),
  );
  await shot('02-d1-annotation');

  // Chain: second line with =d1/2.
  await moveSketch(80, 60);
  await page.waitForTimeout(300);
  await page.keyboard.type('=d1/2');
  await page.waitForTimeout(350);
  await page.keyboard.press('Enter'); // focus advance (M1d ladder)
  await page.waitForTimeout(200);
  await page.keyboard.press('Enter'); // commit
  await page.waitForTimeout(500);
  s = await sketch();
  const lines = s.entities.filter((e) => e.kind === 'line');
  check('second line is 25mm', lines.length === 2 && Math.abs(lineLen(lines[1]) - 25) < 0.01, lines[1] ? `len=${lineLen(lines[1]).toFixed(2)}` : `lines=${lines.length}`);
  check('d2 = 25.00 with d1/2', s.dimensions.length === 2 && s.dimensions[1].text === '25.00' && s.dimensions[1].param_expression === 'd1/2');
  await shot('03-d2-formula-chain');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  // --- 3. Double-click d1 → 60 → both update ---
  console.log('3. double-click edit d1 → 60');
  const d1pos = s.dimensions[0].text_pos;
  const d1screen = await sketchToScreen(d1pos.x, d1pos.y);
  const d1labelEdge = {
    x: d1screen.x + 12,
    y: d1screen.y,
  };
  await page.keyboard.press('l');
  await page.waitForFunction(() => window.__appStore.getState().activeTool === 'line');
  await page.mouse.dblclick(d1labelEdge.x, d1labelEdge.y);
  await page.waitForTimeout(400);
  check(
    'full dimension label opens on double-click while a tool is armed',
    await page.locator('input[title*="Edit dimension"]').isVisible(),
  );
  check(
    'dimension interaction retires the armed geometry tool',
    (await state()).activeTool === null,
  );
  await shot('04a-dim-editor-open');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  check(
    'Escape dismisses the inline dimension editor',
    !(await page.locator('input[title*="Edit dimension"]').isVisible()),
  );
  await page.mouse.dblclick(d1screen.x, d1screen.y);
  await page.waitForTimeout(150);
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('60');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  s = await sketch();
  const lines2 = s.entities.filter((e) => e.kind === 'line');
  check(
    'd1=60 updates first line',
    Math.abs(lineLen(lines2[0]) - 60) < 0.01,
    `len=${lineLen(lines2[0]).toFixed(2)}`,
  );
  check(
    'dependent d2 line follows (60/2)',
    Math.abs(lineLen(lines2[1]) - 30) < 0.01,
    `len=${lineLen(lines2[1]).toFixed(2)}`,
  );
  check('d2 text updated to 30.00', s.dimensions[1].text === '30.00', s.dimensions[1].text);
  await shot('04b-edited-60-30');

  // --- 4. Sketch Dimension tool: linear + angular ---
  console.log('4. dimension tool (linear + angular)');
  // Rectangle for a linear dim.
  await page.click('button[title="Rectangle"]');
  await page.waitForTimeout(150);
  await clickSketch(-60, -40);
  await page.waitForTimeout(250);
  await clickSketch(-20, -15);
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await page.keyboard.press('d');
  await page.waitForTimeout(200);
  await clickSketch(-40, -40); // pick bottom edge
  await page.waitForTimeout(350);
  await moveSketch(-40, -55); // placement preview
  await page.waitForTimeout(300);
  await shot('05a-dim-placement-preview');
  await clickSketch(-40, -55); // drop
  await page.waitForTimeout(500);
  s = await sketch();
  const rectDim = s.dimensions.find((d) => d.kind === 'distance' && d.text === '40.00');
  check('linear dim placed on rectangle edge', !!rectDim, s.dimensions.map((d) => `${d.kind}:${d.text}`).join(', '));
  const nativeConstraintPresentation = await page.evaluate(
    () => window.__nativeViewportTransient(),
  );
  check(
    'Bevy presentation receives sketch constraint glyphs',
    nativeConstraintPresentation.annotations.some(
      (annotation) => annotation.kind === 'constraint',
    ),
  );
  await shot('05b-linear-dim-placed');

  // Cancelling after the entity pick must discard that pick. Reactivating
  // Dimension starts a fresh operation instead of reusing the old line.
  const linesNow = s.entities.filter((e) => e.kind === 'line');
  const formulaLine = linesNow.find((l) => Math.abs(lineLen(l) - 60) < 0.01);
  const rectBottom = linesNow.find((l) => Math.abs(lineLen(l) - 40) < 0.01 && l.start.y === l.end.y);
  const rectRight = linesNow
    .filter((l) => Math.abs(l.start.x - l.end.x) < 0.01)
    .sort((a, b) => b.start.x - a.start.x)[0];
  const midOf = (l) => ({ x: (l.start.x + l.end.x) / 2, y: (l.start.y + l.end.y) / 2 });
  const beforeCancelledPick = s.dimensions.length;
  const cancelledMid = midOf(formulaLine);
  await clickSketch(cancelledMid.x, cancelledMid.y);
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  check('Escape retires a partially picked dimension tool', (await state()).activeTool === null);
  await page.keyboard.press('d');
  await page.waitForTimeout(150);
  const freshMid = midOf(rectRight);
  await clickSketch(freshMid.x, freshMid.y);
  await page.waitForTimeout(200);
  await clickSketch(freshMid.x + 20, freshMid.y);
  await page.waitForTimeout(500);
  s = await sketch();
  const freshDim = s.dimensions.at(-1);
  check(
    'reactivated dimension tool starts with an empty pick buffer',
    s.dimensions.length === beforeCancelledPick + 1 &&
      freshDim?.entities.length === 1 &&
      freshDim.entities[0] === rectRight.id,
    freshDim ? `entities=${freshDim.entities.join(',')} expected=${rectRight.id}` : 'no dimension',
  );

  // Angular dim between the formula line (35°) and the rectangle's bottom
  // edge (horizontal) — non-parallel by construction.
  const m1 = midOf(formulaLine);
  const m2 = midOf(rectBottom);
  await clickSketch(m1.x, m1.y); // pick angled line
  await page.waitForTimeout(250);
  await clickSketch(m2.x, m2.y); // pick horizontal line (upgrade to angle)
  await page.waitForTimeout(250);
  await clickSketch(-40, 45); // neutral placement, no entities nearby
  await page.waitForTimeout(500);
  s = await sketch();
  const angleDim = s.dimensions.find((d) => d.kind === 'angle');
  check('angular dim placed', !!angleDim && angleDim.text.endsWith('°'), angleDim?.text ?? 'none');
  check('angular dim 2-decimal text', !!angleDim && /\d+\.\d{2}°/.test(angleDim.text), angleDim?.text ?? 'none');
  await shot('05c-angular-dim');

  // --- 5. ISO mode ---
  console.log('5. ISO mode');
  await page.click('text=ISO Dimension Style');
  await page.waitForTimeout(500);
  s = await sketch();
  check('ISO style applied', s.dimension_style === 'iso', s.dimension_style);
  await shot('06-iso-mode');
  await page.click('text=ISO Dimension Style'); // back to aligned text

  // --- 6. Cycle error dialog ---
  console.log('6. cycle error');
  const d1pos2 = (await sketch()).dimensions.find((d) => d.param_name === 'd1').text_pos;
  const d1screen2 = await sketchToScreen(d1pos2.x, d1pos2.y);
  await page.mouse.dblclick(d1screen2.x, d1screen2.y);
  await page.waitForTimeout(350);
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('=d2');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  const dialogVisible = await page.locator('div[role="dialog"]').isVisible();
  check('cycle error dialog appears', dialogVisible);
  const dialogText = dialogVisible ? await page.locator('div[role="dialog"]').textContent() : '';
  check('dialog names the cycle', dialogText.includes('circular reference') && dialogText.includes('d1') && dialogText.includes('d2'), dialogText.slice(0, 100).replace(/\s+/g, ' '));
  await shot('07-cycle-error');
  await page.click('div[role="dialog"] button:has-text("OK")');
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape'); // discard the rejected inline edit

  // --- 7. Lock/snap composition: length locked 50, endpoint still snaps ---
  console.log('7. lock/snap composition');
  // Reference point exactly 50 mm from the chain base (10,10).
  await page.getByRole('button', { name: 'DRAW', exact: true }).click();
  await page
    .locator('[data-ribbon-menu]')
    .getByText('Point', { exact: true })
    .click();
  await page.waitForTimeout(150);
  await clickSketch(60, 10);
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape'); // exit point tool
  await page.waitForTimeout(200);
  s = await sketch();
  const targetPoint = s.entities.find(
    (e) => e.kind === 'point' && Math.abs(e.position.x - 60) < 0.01 && Math.abs(e.position.y - 10) < 0.01,
  );
  check('reference point exists', !!targetPoint);
  await page.keyboard.press('l');
  await page.waitForTimeout(150);
  await clickSketch(10, 10); // start at the shared base point
  await page.waitForTimeout(300);
  await moveSketch(62, 14); // near the reference point, slightly off
  await page.waitForTimeout(300);
  await page.keyboard.type('50');
  await page.waitForTimeout(350);
  await shot('08a-locked-length-snap-preview');
  await page.keyboard.press('Enter'); // focus advance length→angle (M1d ladder)
  await page.waitForTimeout(200);
  await page.keyboard.press('Enter'); // commit
  await page.waitForTimeout(500);
  s = await sketch();
  const newLine = s.entities.filter((e) => e.kind === 'line').at(-1);
  const merged = !!newLine && (newLine.end_id === targetPoint.id || newLine.start_id === targetPoint.id);
  check('locked-length endpoint snapped+merged onto the point', merged, newLine ? `end_id=${newLine.end_id} target=${targetPoint.id}` : 'no line');
  await shot('08b-locked-snap-merged');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  check('no page errors during e2e', pageErrors.length === 0, pageErrors[0]?.split('\n')[0] ?? '');
  if (pageErrors.length > 0) console.log(pageErrors.join('\n---\n').slice(0, 1500));
} finally {
  await browser.close();
}

if (failures > 0) {
  console.error(`\n${failures} e2e check(s) FAILED`);
  process.exit(1);
}
console.log('\ne2e-m1c: all checks passed');
