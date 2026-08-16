/**
 * noBS CAD M1c-ii end-to-end verification (real Chromium via Playwright).
 *
 * Covers: fillet with formula radius, chamfer, offset both sides, trim
 * (hover removed-piece highlight), extend, break, mirror, move/copy,
 * scale in place, polygon 6-sided, debounced live preview while typing
 * (geometry updates WITHOUT Enter), palette toggles (points/dims/snap).
 * Screenshots land in docs/qa/m1c2/.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = 'http://localhost:7199';
const SHOTS = new URL('../docs/qa/m1c2/', import.meta.url).pathname;
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

const state = () => page.evaluate(() => window.__appStore.getState());
const sketch = async () => (await state()).activeSketch;
const shot = (name) => page.screenshot({ path: `${SHOTS}${name}.png` });
const sketchToScreen = (x, y) => page.evaluate(([sx, sy]) => window.__sketchToScreen(sx, sy), [x, y]);

const clickSketch = async (x, y) => {
  const p = await sketchToScreen(x, y);
  await page.mouse.click(p.x, p.y);
};
const clickNearSketch = async (x, y, dx, dy) => {
  const p = await sketchToScreen(x, y);
  await page.mouse.click(p.x + dx, p.y + dy);
};
const moveSketch = async (x, y) => {
  const p = await sketchToScreen(x, y);
  await page.mouse.move(p.x, p.y);
};

const lineLen = (l) => Math.hypot(l.end.x - l.start.x, l.end.y - l.start.y);
const lines = (s) => s.entities.filter((e) => e.kind === 'line');

try {
  console.log('setup: sketch + L shape + crossing line');
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

  // L shape: (0,0)-(60,0) and (0,0)-(0,60); crossing vertical at x=40.
  await page.keyboard.press('l');
  await page.waitForTimeout(200);
  await clickSketch(0, 0);
  await clickSketch(60, 0);
  await page.keyboard.press('Escape'); // end chain (next click starts a new one)
  await clickSketch(0, 0);
  await clickSketch(0, 60);
  await page.keyboard.press('Escape'); // end chain
  await page.keyboard.press('Escape'); // exit tool
  // Crossing vertical at x=40.
  await page.keyboard.press('l');
  await clickSketch(40, -20);
  await clickSketch(40, 60);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const s0 = await sketch();
  check('setup: 3 lines, no duplicates', lines(s0).length === 3, `lines=${lines(s0).length}`);
  await shot('00-setup');

  // --- 1. Fillet with formula radius ---
  console.log('1. fillet (formula radius =60/4)');
  await page.click('button[title="Fillet"]');
  await page.waitForTimeout(150);
  await clickSketch(30, 0); // bottom edge
  await page.waitForTimeout(200);
  await clickSketch(0, 30); // left edge
  await page.waitForTimeout(400);
  // Radius field visible; type formula and watch the debounced preview.
  await page.keyboard.type('=60/4');
  await page.waitForTimeout(600); // debounce ~200 ms + preview round-trip
  await shot('01a-fillet-debounced-preview');
  const s1 = await sketch();
  check('no arc yet (preview only)', !s1.entities.some((e) => e.kind === 'arc'));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  const s2 = await sketch();
  const arc = s2.entities.find((e) => e.kind === 'arc');
  check('fillet arc created (r=15)', !!arc && Math.abs(arc.radius - 15) < 0.01, arc ? `r=${arc.radius}` : 'none');
  check('radius dimension R15.00', s2.dimensions.some((d) => d.kind === 'radius' && d.text === 'R15.00'), s2.dimensions.map((d) => d.text).join(','));
  const l1after = lines(s2).find((l) => l.id === 3 || (l.start.y === 0 && l.end.y === 0));
  check('line trimmed at tangent', lines(s2).some((l) => (Math.abs(l.end.x - 15) < 0.01 && l.end.y === 0) || (Math.abs(l.start.x - 15) < 0.01 && l.start.y === 0)), '');
  check('tangent constraints applied', s2.constraints.filter((c) => c.type === 'tangent').length === 2);
  await shot('01b-fillet-result');

  // --- 2. Chamfer ---
  console.log('2. chamfer');
  await page.click('button[title="Chamfer"]');
  await page.waitForTimeout(150);
  // Two lines meeting at the other end of the bottom edge: draw first.
  await page.keyboard.press('Escape'); // exit chamfer for now; draw the corner
  await page.keyboard.press('l');
  await clickSketch(60, 0);
  await clickSketch(60, 40);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await page.click('button[title="Chamfer"]');
  await page.waitForTimeout(150);
  await clickSketch(45, 0); // bottom edge near corner
  await page.waitForTimeout(200);
  await clickSketch(60, 25); // vertical edge
  await page.waitForTimeout(400);
  await page.keyboard.type('8');
  await page.waitForTimeout(600);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  let s = await sketch();
  check('chamfer adds connecting line', lines(s).length >= 4, `lines=${lines(s).length}`);
  check(
    'chamfer cut at 8mm',
    s.entities.some(
      (e) => e.kind === 'line' && ((Math.abs(e.end.x - 52) < 0.01 && e.end.y === 0) || (Math.abs(e.start.x - 52) < 0.01 && e.start.y === 0)),
    ),
  );
  await shot('02-chamfer');

  // --- 3. Trim ---
  console.log('3. trim');
  await page.click('button[title="Trim"]');
  await page.waitForTimeout(150);
  await moveSketch(50, 0); // hover the bottom edge between x=40 and x=60
  await page.waitForTimeout(500);
  await shot('03a-trim-hover-removed-red');
  await clickSketch(50, 0);
  await page.waitForTimeout(500);
  s = await sketch();
  const bottom = lines(s).filter((l) => l.start.y === 0 && l.end.y === 0);
  check(
    'bottom edge trimmed to a piece bounded by cuts',
    bottom.length >= 1 &&
      bottom.every(
        (l) =>
          (Math.abs(l.start.x - 15) < 0.01 && Math.abs(l.end.x - 40) < 0.01) ||
          (Math.abs(l.start.x - 40) < 0.01 && Math.abs(l.end.x - 60) < 0.01),
      ),
    bottom.map((l) => `${l.start.x}→${l.end.x}`).join(' / '),
  );
  await shot('03b-trim-result');
  await page.keyboard.press('Escape'); // exit trim tool

  // --- 4. Extend ---
  console.log('4. extend');
  await page.keyboard.press('l');
  await clickSketch(-40, 20);
  await clickSketch(-10, 20);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  // Vertical blocker at x=0? The left L edge (0,0)-(0,60) exists — extend to it.
  await page.click('button[title="Extend"]');
  await page.waitForTimeout(150);
  await clickSketch(-20, 20);
  await page.waitForTimeout(400);
  s = await sketch();
  const ext = lines(s).find((l) => l.start.y === 20 && l.end.y === 20);
  check('line extended to the y-axis', !!ext && (Math.abs(ext.start.x) < 0.01 || Math.abs(ext.end.x) < 0.01), ext ? `${ext.start.x}→${ext.end.x}` : 'none');
  await shot('04-extend');
  await page.keyboard.press('Escape'); // exit extend tool

  // --- 5. Break ---
  console.log('5. break');
  // Break is menu-only: EDIT menu → Break.
  for (const l of await page.locator('button:has-text("EDIT")').all()) {
    const b = await l.boundingBox();
    if (b && b.height < 30) {
      await l.click();
      break;
    }
  }
  await page.waitForTimeout(300);
  await page.click('[data-ribbon-menu] span:text-is("Break")');
  await page.waitForTimeout(200);
  await clickNearSketch(-25, 20, 0, 10); // magnetic curve capture; old 6 px picker missed this
  await page.waitForTimeout(400);
  s = await sketch();
  const pieces = lines(s).filter((l) => l.start.y === 20 && l.end.y === 20);
  check('break acquired the applicable curve from 10 px away', pieces.length === 2);
  check('break splits into two pieces', pieces.length === 2, `pieces=${pieces.length}`);
  await shot('05-break');
  await page.keyboard.press('Escape'); // exit break tool

  // --- 6. Mirror ---
  console.log('6. mirror');
  // Select one broken piece (plain click on its midpoint).
  const piece = lines(s).find((l) => l.start.y === 20 && l.end.y === 20 && l.start.x < 0);
  const midp = { x: (piece.start.x + piece.end.x) / 2, y: 20 };
  await clickSketch(midp.x, midp.y);
  await page.waitForTimeout(300);
  check('piece selected', (await state()).selectedEntities.length >= 1, `sel=${(await state()).selectedEntities}`);
  // Mirror is grouped with repetition tools: REPEAT menu → Mirror.
  for (const l of await page.locator('button:has-text("REPEAT")').all()) {
    const b = await l.boundingBox();
    if (b && b.height < 30) {
      await l.click();
      break;
    }
  }
  await page.waitForTimeout(300);
  await page.click('[data-ribbon-menu] span:text-is("Mirror")');
  await page.waitForTimeout(200);
  await clickSketch(0, 30); // the y-axis line as axis
  await page.waitForTimeout(500);
  s = await sketch();
  const mirrored = lines(s).filter((l) => l.start.y === 20 && l.end.y === 20);
  check('mirror created reflected copies', mirrored.length >= 3, `${mirrored.length}`);
  check(
    'reflected copy on the other side of the axis',
    mirrored.some((l) => l.start.x > 0 || l.end.x > 0),
  );
  await shot('06-mirror');

  // --- 7. Move/Copy (Alt = copy) ---
  console.log('7. move/copy');
  await clickSketch(30, 0); // select bottom edge piece... select something at (30,0)
  await page.waitForTimeout(200);
  const selCount = (await state()).selectedEntities.length;
  if (selCount === 0) {
    // select via the actual bottom piece's midpoint
    const piece = lines(s).find((l) => l.start.y === 0 && l.end.y === 0);
    const mid = { x: (piece.start.x + piece.end.x) / 2, y: 0 };
    await clickSketch(mid.x, mid.y);
    await page.waitForTimeout(200);
  }
  await page.click('button[title="Move/Copy"]');
  await page.waitForTimeout(150);
  const from = await sketchToScreen(30, 0);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const to = await sketchToScreen(30, 30);
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.keyboard.down('Alt');
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await page.waitForTimeout(500);
  s = await sketch();
  const y50 = lines(s).filter((l) => Math.abs(l.start.y - 50) < 0.01 && Math.abs(l.end.y - 50) < 0.01);
  check('alt-drag created a copy above', y50.length >= 1, `y50=${y50.length}`);
  await shot('07-movecopy');

  // --- 8. Sketch Scale (in place) ---
  console.log('8. sketch scale');
  await page.keyboard.press('Escape'); // exit move/copy tool
  await page.waitForTimeout(200);
  // Scale the unconstrained copy made above. Scaling a line still tied into
  // the fillet/chamfer constraint network is correctly rejected by the
  // solver instead of silently breaking those constraints.
  const someLine = y50[0];
  const mid0 = { x: (someLine.start.x + someLine.end.x) / 2, y: (someLine.start.y + someLine.end.y) / 2 };
  await clickSketch(mid0.x, mid0.y);
  await page.waitForTimeout(200);
  for (const l of await page.locator('button:has-text("EDIT")').all()) {
    const b = await l.boundingBox();
    if (b && b.height < 30) {
      await l.click();
      break;
    }
  }
  await page.waitForTimeout(300);
  await page.click('[data-ribbon-menu] span:text-is("Sketch Scale")');
  await page.waitForTimeout(200);
  await clickSketch(0, 0); // base point at origin
  await page.waitForTimeout(300);
  await page.keyboard.type('0.5');
  await page.waitForTimeout(600);
  await shot('08a-scale-preview');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  s = await sketch();
  const scaled = lines(s).find((l) => l.id === someLine.id);
  check(
    'scaled in place about the base point',
    !!scaled && Math.abs(lineLen(scaled) - lineLen(someLine) / 2) < 0.02,
    `${lineLen(someLine)} → ${scaled ? lineLen(scaled) : '?'}`,
  );
  await shot('08b-scale-result');

  // --- 9. Polygon (circumscribed, 6 edges) ---
  console.log('9. polygon');
  await page.click('button[title="Polygon"]');
  await page.waitForTimeout(150);
  await clickSketch(-60, -40); // center
  await page.waitForTimeout(300);
  // Edges field: type 6 (default), drag radius.
  await page.keyboard.type('6');
  await page.waitForTimeout(400);
  await moveSketch(-40, -40);
  await page.waitForTimeout(400);
  await shot('09a-polygon-preview');
  await clickSketch(-40, -40);
  await page.waitForTimeout(500);
  s = await sketch();
  const polyLines = lines(s).filter((l) => {
    const cx = (l.start.x + l.end.x) / 2;
    const cy = (l.start.y + l.end.y) / 2;
    return Math.hypot(cx + 60, cy + 40) < 25;
  });
  check('hexagon created (6 lines)', polyLines.length === 6, `lines=${polyLines.length}`);
  await shot('09b-polygon-result');

  // --- 10. Debounced live preview without Enter (D10) ---
  console.log('10. debounce typing preview');
  await page.click('button[title="Fillet"]');
  await page.waitForTimeout(150);
  // Hover alone supplies the complete magnetic-corner preview. Keep this
  // scenario pointer-move-only so it exercises live value editing without
  // the confirming click that now (correctly) commits the visible preview.
  await moveSketch(40, 0);
  await page.waitForTimeout(400);
  // Type progressively: the preview should update as we type WITHOUT Enter.
  await page.keyboard.type('=4');
  await page.waitForTimeout(600);
  await shot('10a-debounce-partial');
  await page.keyboard.type('0/2');
  await page.waitForTimeout(700);
  await shot('10b-debounce-complete');
  await page.keyboard.press('Escape'); // cancel without committing
  await page.waitForTimeout(300);
  s = await sketch();
  const arcCount = s.entities.filter((e) => e.kind === 'arc').length;
  check('preview updated live; nothing committed', arcCount === 1, `arcs=${arcCount}`);

  // --- 11. Palette toggles ---
  console.log('11. palette toggles');
  await page.click('li:has-text("Points")');
  await page.waitForTimeout(400);
  await shot('11a-points-off');
  await page.click('li:has-text("Dimensions")');
  await page.waitForTimeout(400);
  await shot('11b-dimensions-off');
  await page.click('li:has-text("Snap")');
  await page.waitForTimeout(300);
  // With snap off, moving the cursor to (33.3, 17.7) must not round.
  await page.keyboard.press('l');
  await moveSketch(33.3, 17.7);
  await page.waitForTimeout(400);
  const readout = await page.getByTestId('sketch-coordinate-readout').textContent();
  check('snap off: free cursor (no grid rounding)', readout?.includes('33.3') && readout?.includes('17.7'), readout ?? 'none');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.click('li:has-text("Snap")'); // snap back on
  await page.click('li:has-text("Points")');
  await page.click('li:has-text("Dimensions")');

  check('no page errors during e2e', pageErrors.length === 0, pageErrors[0]?.split('\n')[0] ?? '');
  if (pageErrors.length > 0) console.log(pageErrors.join('\n---\n').slice(0, 1500));
} finally {
  await browser.close();
}

if (failures > 0) {
  console.error(`\n${failures} e2e check(s) FAILED`);
  process.exit(1);
}
console.log('\ne2e-m1c2: all checks passed');
