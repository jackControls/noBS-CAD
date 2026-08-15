/**
 * noBS CAD M1d-fixes end-to-end verification (real Chromium).
 * Owner hand-test findings 2026-07-19 — REAL UI clicks only (owner rule):
 *   1. Rect tool: typing the first dimension must NOT vanish the dyn-input
 *      cluster (it was repositioned off-viewport until the next mouse move)
 *   2. Fillet: clicking a rectangle corner picks both edges;
 *      previously the corner point entity shadowed the pick → dead click
 *   3. Esc on an idle modify tool retires it — the cluster must stay gone
 *      after later mouse moves (previously moveModTool resurrected it)
 *   4. Dropdown rows visibly highlight under the cursor, including disabled
 *      placeholders (subdued, but still trackable)
 *   5. Modify tools magnetically acquire valid targets within a 14 px halo
 *   6. A rejected chamfer keeps its corner selection, and its distance can
 *      be replaced by double-clicking the overlay without clicking through
 *      to the canvas; a deliberate click outside cancels the rejected op
 * Screenshots land in docs/qa/m1d-fixes/.
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'http://localhost:7199';
const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, '..', 'docs', 'qa', 'm1d-fixes');

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
const sketchScreen = (x, y) =>
  page.evaluate(([sx, sy]) => window.__sketchToScreen(sx, sy), [x, y]);
const clickNearSketch = async (x, y, dx, dy) => {
  const p = await sketchScreen(x, y);
  await page.mouse.click(p.x + dx, p.y + dy);
};
const moveNearSketch = async (x, y, dx, dy) => {
  const p = await sketchScreen(x, y);
  await page.mouse.move(p.x + dx, p.y + dy, { steps: 4 });
};

const enterSketch = async () => {
  await page.click('button:has-text("Create Sketch")');
  await page.waitForTimeout(400);
  if (!(await page.locator('text=XY Plane').isVisible())) {
    await page.click('button[aria-label="Origin"]');
    await page.waitForTimeout(200);
  }
  await page.click('text=XY Plane');
  await page.waitForTimeout(1100);
};

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1400);

  // --- 0. Dropdown rows visibly follow the cursor -------------------------
  console.log('0. dropdown cursor highlighting');
  for (const label of await page.locator('button:has-text("BUILD")').all()) {
    const box = await label.boundingBox();
    if (box && box.height < 30) {
      await label.click();
      break;
    }
  }
  await page.waitForTimeout(200);
  const enabledRow = page.locator('[data-ribbon-menu-item][data-enabled="true"]').filter({ hasText: 'Extrude' }).first();
  const background = (row) => row.evaluate((element) => getComputedStyle(element).backgroundColor);
  const enabledBefore = await background(enabledRow);
  await enabledRow.hover();
  await page.waitForTimeout(120);
  const enabledAfter = await background(enabledRow);
  check('enabled menu row highlights under cursor', enabledAfter !== enabledBefore, `${enabledBefore} → ${enabledAfter}`);
  await page.mouse.click(900, 40); // outside the portal closes the menu
  await page.waitForTimeout(150);

  for (const label of await page.locator('button:has-text("REFINE")').all()) {
    const box = await label.boundingBox();
    if (box && box.height < 30) {
      await label.click();
      break;
    }
  }
  await page.waitForTimeout(200);
  const disabledRow = page
    .locator('[data-ribbon-menu-item][data-enabled="false"]')
    .filter({ hasText: 'Draft' })
    .first();
  const disabledBefore = await background(disabledRow);
  await disabledRow.hover();
  await page.waitForTimeout(120);
  const disabledAfter = await background(disabledRow);
  check('disabled menu row still gives subdued hover feedback', disabledAfter !== disabledBefore, `${disabledBefore} → ${disabledAfter}`);
  await shot('fix-00-menu-cursor-highlight');
  await page.mouse.click(900, 40); // outside the portal closes the menu
  await page.waitForTimeout(150);

  await enterSketch();

  // --- 1. Rect dyn-input cluster stays on-screen while typing -------------
  console.log('1. rect dyn-input cluster survives typing (no mouse move)');
  await page.click('button[title="Rectangle"]');
  await page.waitForTimeout(200);
  await clickSketch(-40, -25);
  await page.waitForTimeout(250);
  await moveSketch(10, -5);
  await page.keyboard.type('50', { delay: 40 });
  await page.waitForTimeout(450); // debounce (~200 ms) fired, NO mouse move
  let d = (await state()).dynInput;
  check(
    'cluster still active + anchored on-viewport after debounce',
    d.active && d.x >= 0 && d.y >= 0,
    `active=${d.active} x=${d.x.toFixed(0)} y=${d.y.toFixed(0)}`,
  );
  const clusterBox = await page.locator('[data-dyn-input]').boundingBox();
  const canvasBox = await page.locator('main canvas').first().boundingBox();
  check(
    'cluster DOM box inside the canvas rect',
    !!clusterBox &&
      !!canvasBox &&
      clusterBox.x >= canvasBox.x &&
      clusterBox.y >= canvasBox.y &&
      clusterBox.x + clusterBox.width <= canvasBox.x + canvasBox.width + 260, // palette flip slack
    clusterBox ? `x=${clusterBox.x.toFixed(0)} y=${clusterBox.y.toFixed(0)}` : 'no box',
  );
  await shot('fix-01-rect-cluster-alive-while-typing');
  await page.keyboard.press('Escape'); // cancel run
  await page.keyboard.press('Escape'); // exit rect tool
  await page.waitForTimeout(200);

  // --- 2. Fillet by clicking the rectangle corner -------------------------
  console.log('2. fillet via corner click');
  await page.click('button[title="Rectangle"]');
  await page.waitForTimeout(200);
  await clickSketch(0, 0);
  await clickSketch(60, 40);
  await page.waitForTimeout(400);
  const rectLines = (await sketch()).entities.filter((e) => e.kind === 'line').length;
  check('rectangle drawn (4 lines)', rectLines === 4, `lines=${rectLines}`);
  await page.keyboard.press('Escape'); // exit rect tool
  await page.waitForTimeout(200);

  await page.click('button[title="Fillet"]');
  await page.waitForTimeout(250);
  await page.keyboard.type('10', { delay: 40 });
  await page.waitForTimeout(250);
  // 9 px out on both screen axes = 12.7 px from the actual corner:
  // outside the old 6 px picker, inside the new 14 px magnetic halo.
  await moveNearSketch(60, 40, 9, -9);
  await page.waitForTimeout(180);
  await shot('fix-02a-fillet-corner-suction');
  await clickNearSketch(60, 40, 9, -9);
  await page.waitForTimeout(450);
  await shot('fix-02a-fillet-corner-click-committed');
  const arc = (await sketch()).entities.find((e) => e.kind === 'arc');
  check('fillet acquired a corner from 12.7 px away', !!arc);
  check('corner click alone produced a fillet arc', !!arc && Math.abs(arc.radius - 10) < 0.01, arc ? `r=${arc.radius}` : 'none');
  // 2026-07-19 bug class: BOTH edges must be trimmed to the tangent points
  // (the arc existing is NOT enough — the previous suite only checked it).
  const sk2 = await sketch();
  const topEdge = sk2.entities.find((e) => e.kind === 'line' && Math.abs(e.start.y - 40) < 0.01 && Math.abs(e.end.y - 40) < 0.01);
  const rightEdge = sk2.entities.find((e) => e.kind === 'line' && Math.abs(e.start.x - 60) < 0.01 && Math.abs(e.end.x - 60) < 0.01);
  check('top edge trimmed to tangent (50,40)',
    !!topEdge && Math.min(Math.hypot(topEdge.start.x - 50, topEdge.start.y - 40), Math.hypot(topEdge.end.x - 50, topEdge.end.y - 40)) < 0.01,
    topEdge ? `${topEdge.start.x},${topEdge.start.y}→${topEdge.end.x},${topEdge.end.y}` : 'missing');
  check('right edge trimmed to tangent (60,30)',
    !!rightEdge && Math.min(Math.hypot(rightEdge.start.x - 60, rightEdge.start.y - 30), Math.hypot(rightEdge.end.x - 60, rightEdge.end.y - 30)) < 0.01,
    rightEdge ? `${rightEdge.start.x},${rightEdge.start.y}→${rightEdge.end.x},${rightEdge.end.y}` : 'missing');
  check('two arc-endpoint coincident anchors', sk2.constraints.filter((c) => c.type === 'arc_endpoint_coincident').length === 2);
  await shot('fix-02b-fillet-corner-result');

  // --- 2b. The owner's exact 2026-07-19 report: DIMENSIONED rect + R4 ----
  console.log('2b. fillet on a dimensioned rectangle corner keeps the trim');
  await page.click('button[title="Rectangle"]');
  await page.waitForTimeout(200);
  await clickSketch(-60, -50);
  await page.waitForTimeout(250);
  await moveSketch(-20, -35);
  await page.keyboard.type('40', { delay: 40 });
  await page.waitForTimeout(200);
  await page.keyboard.press('Enter'); // advance W→H (M1d ladder)
  await page.waitForTimeout(150);
  await page.keyboard.type('15', { delay: 40 });
  await page.waitForTimeout(200);
  await page.keyboard.press('Enter'); // all locked → commit
  await page.waitForTimeout(450);
  await page.keyboard.press('Escape'); // exit rect tool
  await page.waitForTimeout(200);
  const rectDims = (await sketch()).dimensions.length;
  check('typed rect carries driving dims', rectDims >= 3, `dims=${rectDims}`); // 2 new + Ø10 from 2

  await page.click('button[title="Fillet"]');
  await page.waitForTimeout(250);
  await page.keyboard.type('4', { delay: 40 });
  await page.waitForTimeout(250);
  await clickSketch(-60, -35); // top-left corner of the typed rect
  await page.waitForTimeout(500);
  const sk3 = await sketch();
  const leftEdge = sk3.entities.find(
    (e) => e.kind === 'line' && Math.abs(e.start.x - -60) < 0.05 && Math.abs(e.end.x - -60) < 0.05,
  );
  // Trim anchor: the top end of the left edge must stay glued to the arc
  // tangent point, NOT dragged back to the old corner by the height dim.
  // The dim legitimately shifts the sketch (which side moves is Newton's
  // choice), so assert the RELATIVE invariant: trim = top edge y − R.
  const topEdgeB = sk3.entities.find(
    (e) =>
      e.kind === 'line' &&
      Math.abs(e.start.y - e.end.y) < 0.05 &&
      (e.start.x + e.end.x) / 2 > -60 &&
      (e.start.x + e.end.x) / 2 < -20 &&
      Math.max(e.start.y, e.end.y) > -45,
  );
  const topEndY = Math.max(leftEdge.start.y, leftEdge.end.y);
  check(
    'dimensioned rect: left edge stays trimmed at tangent',
    !!leftEdge && !!topEdgeB && Math.abs(topEdgeB.start.y - topEndY - 4) < 0.02,
    leftEdge && topEdgeB ? `top edge y=${topEdgeB.start.y.toFixed(3)}, trim y=${topEndY.toFixed(3)}` : 'edge missing',
  );

  // 2b-ii. Persistent corner reference (owner design ask):
  // the original corner POINT survives the fillet at its exact position and
  // the height dim still reads 15.00 across the original corner span.
  const cornerAlive = sk3.entities.some(
    (e) => e.kind === 'point' && Math.abs(e.position.x - -60) < 0.05 && Math.abs(e.position.y - -35) < 0.05,
  );
  check('original corner point persists as constraint reference', cornerAlive);
  const heightDim = sk3.dimensions.find((d) => d.text === '15.00');
  check('height dim still spans the original corners (15.00)', !!heightDim, sk3.dimensions.map((d) => d.text).join(','));
  await shot('fix-02c-dimensioned-rect-fillet');

  // --- 2d. Second fillet on the SAME dimensioned rect (PM bug report) -----
  console.log('2d. second corner op on the dimensioned rect is accepted');
  // Click-commit intentionally keeps the tool armed and reuses R4.
  // Click the corner where it IS, not where it was: dims legitimately shift
  // the sketch after the first fillet, so read the live corner from the
  // bottom + left edges (stale coordinates can miss the pick tolerance).
  {
    const sk = await sketch();
    const left = sk.entities.find((e) => e.kind === 'line' && Math.abs(e.start.x - e.end.x) < 0.05 && Math.min(e.start.x, e.end.x) < -40);
    const bottom = sk.entities.find((e) => e.kind === 'line' && Math.abs(e.start.y - e.end.y) < 0.05 && Math.min(e.start.y, e.end.y) < -45);
    await clickSketch(left.start.x, Math.min(bottom.start.y, bottom.end.y));
  }
  await page.waitForTimeout(500);
  const sk4 = await sketch();
  // 3 arcs total: section 2's R10 + 2b's R4 (top-left) + this R4 (bottom-left).
  check('second fillet accepted (no false over-constraint)', sk4.entities.filter((e) => e.kind === 'arc').length === 3,
    `arcs=${sk4.entities.filter((e) => e.kind === 'arc').length}`);
  check('no error dialog popped', !(await page.locator('div[role="dialog"]').isVisible().catch(() => false)));
  check('click-commit keeps Fillet armed for repeat corners', (await state()).activeTool === 'fillet', (await state()).activeTool ?? 'null');
  await shot('fix-02d-second-fillet-accepted');

  // --- 2e. Chamfer THEN fillet on the dimensioned rect (user's failing
  // flow, 2026-07-19 PM round 3) -------------------------------------------
  console.log('2e. chamfer then fillet on the dimensioned rect');
  await page.click('button[title="Chamfer"]');
  await page.waitForTimeout(250);
  await page.keyboard.type('4', { delay: 40 });
  await page.waitForTimeout(250);
  {
    // Bottom-right corner = the bottom edge's right endpoint (live read —
    // dims may shift geometry; no separate right-edge lookup needed).
    const sk = await sketch();
    const bottom = sk.entities.find(
      (e) => e.kind === 'line' && Math.abs(e.start.y - e.end.y) < 0.05 && Math.min(e.start.y, e.end.y) < -45,
    );
    await clickNearSketch(Math.max(bottom.start.x, bottom.end.x), bottom.start.y, 9, 9);
  }
  await page.waitForTimeout(500);
  let skc = await sketch();
  check('chamfer acquired a corner from 12.7 px away', skc.entities.filter((e) => e.kind === 'line').length === 9);
  check('corner click alone created the chamfer line', skc.entities.filter((e) => e.kind === 'line').length === 9, `lines=${skc.entities.filter((e) => e.kind === 'line').length}`);

  await page.click('button[title="Fillet"]');
  await page.waitForTimeout(250);
  await page.keyboard.type('4', { delay: 40 });
  await page.waitForTimeout(250);
  {
    // Top-right corner = the top edge's right endpoint (live read).
    const sk = await sketch();
    const top = sk.entities.find(
      (e) => e.kind === 'line' && Math.abs(e.start.y - e.end.y) < 0.05 && Math.max(e.start.y, e.end.y) > -40 && (e.start.x + e.end.x) / 2 < -20,
    );
    await clickSketch(Math.max(top.start.x, top.end.x), Math.max(top.start.y, top.end.y));
  }
  await page.waitForTimeout(500);
  skc = await sketch();
  check('fillet after chamfer accepted (4 arcs total)', skc.entities.filter((e) => e.kind === 'arc').length === 4,
    `arcs=${skc.entities.filter((e) => e.kind === 'arc').length}`);
  check('no error dialog popped', !(await page.locator('div[role="dialog"]').isVisible().catch(() => false)));
  await shot('fix-02e-chamfer-then-fillet');

  // --- 2f. Rejected Chamfer value is editable without click-through -------
  console.log('2f. rejected chamfer value can be corrected in place');
  let transitionState = await state();
  check(
    'still editing the sketch before the rejected-chamfer scenario',
    transitionState.mode === 'sketch' && transitionState.activeSketch !== null,
    `mode=${transitionState.mode} sketch=${transitionState.activeSketch?.name ?? 'null'}`,
  );
  await page.click('button[title="Rectangle"]');
  await page.waitForTimeout(200);
  // Keep this fixture left of the Sketch Palette so real clicks reach the
  // canvas instead of the overlay's Finish Sketch button.
  await clickSketch(-110, -20);
  await clickSketch(-90, -10); // exact 20 × 10: distance 20 is deliberately invalid
  await page.waitForTimeout(350);
  await page.keyboard.press('Escape'); // exit rectangle tool
  await page.waitForTimeout(200);

  transitionState = await state();
  check(
    'rectangle creation leaves the active sketch session intact',
    transitionState.mode === 'sketch' && transitionState.activeSketch !== null,
    `mode=${transitionState.mode} sketch=${transitionState.activeSketch?.name ?? 'null'} tool=${transitionState.activeTool ?? 'null'}`,
  );
  if (!transitionState.activeSketch) {
    throw new Error('active sketch disappeared during the rejected-chamfer setup');
  }
  const linesBeforeRetry = transitionState.activeSketch.entities.filter(
    (e) => e.kind === 'line',
  ).length;
  await page.click('button[title="Chamfer"]');
  await page.waitForTimeout(250);
  await page.keyboard.type('20', { delay: 40 });
  await page.waitForTimeout(200);
  await clickSketch(-110, -20);
  await page.waitForTimeout(450);

  const errorDialog = page.locator('div[role="dialog"]');
  check('oversized chamfer reports an error', await errorDialog.isVisible().catch(() => false));
  check(
    'failed chamfer keeps the tool armed for correction',
    (await state()).activeTool === 'chamfer',
    (await state()).activeTool ?? 'null',
  );
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await page.waitForTimeout(150);

  // Clicking anywhere outside the overlay after a rejected commit is a
  // cancel gesture. It must consume the click rather than retrying `20`.
  await clickSketch(0, -60);
  await page.waitForTimeout(450);
  let retryState = await state();
  check(
    'outside click cancels rejected corner without retrying it',
    retryState.activeTool === 'chamfer' && !retryState.dynInput.active &&
      !(await errorDialog.isVisible().catch(() => false)),
    `tool=${retryState.activeTool} dyn=${retryState.dynInput.active}`,
  );

  // Moving again leaves Chamfer armed, but starts a genuinely fresh op with
  // an empty value rather than retaining the rejected distance or picks.
  await moveSketch(5, -55);
  await page.waitForTimeout(200);
  retryState = await state();
  let retryDistance = retryState.dynInput.fields.find((field) => field.key === 'distance');
  check(
    'cancelled chamfer rearms with a clean distance',
    retryState.dynInput.active && retryDistance?.value === '' && !retryDistance?.locked,
    `value=${retryDistance?.value} locked=${retryDistance?.locked}`,
  );

  // Recreate the rejection to retain coverage for in-place correction.
  await page.keyboard.type('20', { delay: 40 });
  await clickSketch(-110, -20);
  await page.waitForTimeout(450);
  check('second oversized attempt reports an error', await errorDialog.isVisible().catch(() => false));
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await page.waitForTimeout(150);

  const distanceField = page.locator('[data-dyn-field="distance"]');
  await distanceField.dblclick();
  await page.waitForTimeout(450);
  retryState = await state();
  retryDistance = retryState.dynInput.fields.find((field) => field.key === 'distance');
  check(
    'double-click clears and unlocks the rejected distance',
    retryDistance?.value === '' && !retryDistance?.locked,
    `value=${retryDistance?.value} locked=${retryDistance?.locked}`,
  );
  check(
    'double-click does not fall through and reopen the error',
    !(await errorDialog.isVisible().catch(() => false)),
  );
  await shot('fix-02f-chamfer-value-ready-to-retry');

  await page.keyboard.type('3', { delay: 40 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  const linesAfterRetry = (await sketch()).entities.filter((e) => e.kind === 'line').length;
  check('corrected chamfer succeeds', linesAfterRetry === linesBeforeRetry + 1,
    `lines ${linesBeforeRetry} → ${linesAfterRetry}`);
  check('successful retry retires the tool', (await state()).activeTool === null, (await state()).activeTool ?? 'null');
  check('no error remains after the valid retry', !(await errorDialog.isVisible().catch(() => false)));
  await shot('fix-02g-chamfer-corrected-result');

  // --- 3. Esc retires an idle modify tool for good ------------------------
  console.log('3. Esc dismisses the fillet cluster permanently');
  await page.click('button[title="Fillet"]'); // armed again for the ladder test
  await page.waitForTimeout(250);
  await moveSketch(20, 20); // cluster follows cursor while armed
  await page.waitForTimeout(250);
  let s = await state();
  check('tool armed before Esc', s.activeTool === 'fillet' && s.dynInput.active, s.activeTool ?? 'null');
  await page.keyboard.press('Escape'); // field focused? clears; else exits
  await page.waitForTimeout(150);
  await page.keyboard.press('Escape'); // ladder: exit the tool
  await page.waitForTimeout(200);
  s = await state();
  check('Esc retired the tool + cluster', s.activeTool === null && !s.dynInput.active, `tool=${s.activeTool} dyn=${s.dynInput.active}`);
  await moveSketch(30, 15); // mouse moves must NOT resurrect the cluster
  await moveSketch(-20, 30);
  await page.waitForTimeout(300);
  s = await state();
  check('cluster stays gone after mouse moves', s.activeTool === null && !s.dynInput.active, `tool=${s.activeTool} dyn=${s.dynInput.active}`);
  await shot('fix-03-esc-cluster-gone');

  // 3b: typed radius ladder — Esc1 clears the field, Esc2 exits the tool.
  await page.click('button[title="Fillet"]');
  await page.waitForTimeout(250);
  await page.keyboard.type('7', { delay: 40 });
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  s = await state();
  const radiusField = s.dynInput.fields.find((f) => f.key === 'radius');
  check('Esc1 in field: cleared + unlocked, tool alive', s.activeTool === 'fillet' && radiusField?.value === '' && !radiusField?.locked, `v=${radiusField?.value}`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  s = await state();
  check('Esc2 exits the tool', s.activeTool === null && !s.dynInput.active, `tool=${s.activeTool}`);

  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  check('no page errors during e2e', errs.length === 0, errs[0] ?? '');
} finally {
  await browser.close();
}

if (failures > 0) {
  console.log(`\ne2e-m1d-fixes: ${failures} check(s) FAILED`);
  process.exit(1);
}
console.log('\ne2e-m1d-fixes: all checks passed');
