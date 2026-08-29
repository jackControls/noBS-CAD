/**
 * UI-level constraint audit (round 5 of the 2026-08-29 sketch audit).
 * Evidence for docs/SKETCH_CONSTRAINT_AUDIT.md.
 * Run: start `npm run dev -- --port 7317 --strictPort`, then `node scripts/audit-sketch-constraints.mjs [out-dir]`.
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const BASE = 'http://localhost:7317';
const OUT = process.argv[2] ?? './sketch-audit-out5';
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(String(err.stack ?? err)));
const log = [];
let shotIndex = 0;
const record = (tag, data) => log.push({ tag, ...data });
const shot = async (tag) => {
  await page.screenshot({ path: path.join(OUT, `${String(shotIndex++).padStart(2, '0')}-${tag}.png`) });
};
const state = () =>
  page.evaluate(() => {
    const s = window.__appStore.getState();
    return {
      activeTool: s.activeTool,
      selectedEntity: s.selectedEntity,
      selectedEntities: s.selectedEntities,
      showDof: s.showDof,
      dof: s.activeSketch?.dof ?? null,
      dialog: s.constraintDialog
        ? { message: s.constraintDialog.message, conflicts: s.constraintDialog.conflicts ?? null }
        : null,
      entities: s.activeSketch?.entities ?? [],
      constraints: s.activeSketch?.constraints ?? [],
      dimensions: s.activeSketch?.dimensions ?? [],
    };
  });
const clearDialog = () => page.evaluate(() => window.__appStore.getState().setConstraintDialog(null));
const sk = (x, y) => page.evaluate(([a, b]) => window.__sketchToScreen(a, b), [x, y]);
const hoverClick = async (x, y, mod) => {
  const p = await sk(x, y);
  await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(120);
  if (mod) await page.keyboard.down(mod);
  await page.mouse.click(p.x, p.y);
  if (mod) await page.keyboard.up(mod);
  await page.waitForTimeout(200);
  const s = await state();
  return { selected: s.selectedEntities, primary: s.selectedEntity };
};
const deselect = () =>
  page.evaluate(() => {
    const s = window.__appStore.getState();
    s.setSelectedEntities([]);
    s.setSelectedEntity(null);
    s.setConstraintDialog(null);
  });
const entityById = async (id) => (await state()).entities.find((e) => e.id === id);
const lineMid = async (id) => {
  const e = await entityById(id);
  return [(e.start.x + e.end.x) / 2, (e.start.y + e.end.y) / 2];
};
const ribbon = async (title) => {
  await page.evaluate((t) => {
    const b = document.querySelector(`button[title="${t}"]`);
    if (!b) throw new Error(`no ribbon button ${t}`);
    b.click();
  }, title);
  await page.waitForTimeout(250);
};
const ROW = new Set(['Coincident', 'Horizontal/Vertical', 'Tangent', 'Parallel', 'Perpendicular', 'Equal', 'Fix/UnFix']);
const applyC = async (name) => {
  if (ROW.has(name)) await ribbon(name);
  else {
    await page.getByRole('button', { name: 'CONSTRAIN', exact: true }).click();
    await page.waitForTimeout(250);
    await page.locator('[data-ribbon-menu]').getByText(name, { exact: true }).click();
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(300);
};
const applyAndDiff = async (tag, name, ids) => {
  const before = await state();
  await applyC(name);
  const after = await state();
  record(tag, {
    applied: name,
    added: after.constraints.slice(before.constraints.length),
    dialog: after.dialog,
    selectionAfter: after.selectedEntities,
  });
  await shot(tag);
  await clearDialog();
  return after;
};
const drawLine = async (x1, y1, x2, y2) => {
  const before = (await state()).entities.length;
  await ribbon('Line');
  await page.waitForTimeout(150);
  const p1 = await sk(x1, y1);
  const p2 = await sk(x2, y2);
  await page.mouse.move(p1.x, p1.y); await page.waitForTimeout(100);
  await page.mouse.click(p1.x, p1.y); await page.waitForTimeout(150);
  await page.mouse.move(p2.x, p2.y); await page.waitForTimeout(150);
  await page.mouse.click(p2.x, p2.y); await page.waitForTimeout(200);
  await page.keyboard.press('Escape'); await page.waitForTimeout(120);
  await page.keyboard.press('Escape'); await page.waitForTimeout(120);
  const s = await state();
  if (s.entities.length <= before) throw new Error(`line not created (${x1},${y1})`);
  return s.entities.filter((e) => e.kind === 'line').at(-1).id;
};
const drawCircle = async (cx, cy, r) => {
  const before = (await state()).entities.length;
  await ribbon('Circle');
  await page.waitForTimeout(150);
  const c = await sk(cx, cy);
  await page.mouse.move(c.x, c.y); await page.waitForTimeout(100);
  await page.mouse.click(c.x, c.y); await page.waitForTimeout(150);
  const rim = await sk(cx, cy + r);
  await page.mouse.move(rim.x, rim.y); await page.waitForTimeout(150);
  await page.mouse.click(rim.x, rim.y); await page.waitForTimeout(200);
  await page.keyboard.press('Escape'); await page.waitForTimeout(120);
  const s = await state();
  if (s.entities.length <= before) throw new Error('circle not created');
  return s.entities.filter((e) => e.kind === 'circle').at(-1).id;
};
const drawPoint = async (x, y) => {
  const before = (await state()).entities.length;
  await page.evaluate(() => window.__appStore.getState().setActiveTool('point'));
  await page.waitForTimeout(150);
  const p = await sk(x, y);
  await page.mouse.move(p.x, p.y); await page.waitForTimeout(100);
  await page.mouse.click(p.x, p.y); await page.waitForTimeout(250);
  await page.keyboard.press('Escape'); await page.waitForTimeout(120);
  const s = await state();
  if (s.entities.length <= before) throw new Error('point not created');
  return s.entities.filter((e) => e.kind === 'point').at(-1).id;
};
const scenario = async (tag, fn) => {
  try { await fn(); }
  catch (err) { record(tag, { error: String(err).slice(0, 250) }); await shot(`${tag}-ERR`); await clearDialog(); await deselect(); }
};

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.click('button:has-text("Create Sketch")');
await page.waitForTimeout(400);
await page.click('button[aria-label="Origin"]');
await page.waitForTimeout(250);
await page.click('text=XY Plane');
await page.waitForTimeout(1300);

// 1) coincident endpoint-endpoint via start_id/end_id
await scenario('coincident-pp', async () => {
  const J1 = await drawLine(-110, 20, -95, 45);
  const J2 = await drawLine(-80, 25, -66, 48);
  const j1 = await entityById(J1);
  const j2 = await entityById(J2);
  await deselect();
  const a = await entityById(j1.end_id);
  await hoverClick(a.position.x, a.position.y);
  const b = await entityById(j2.start_id);
  const sel = await hoverClick(b.position.x, b.position.y, 'Shift');
  record('coincident-selection', sel);
  const after = await applyAndDiff('coincident-pp', 'Coincident', [j1.end_id, j2.start_id]);
  const A = after.entities.find((e) => e.id === j1.end_id);
  const B = after.entities.find((e) => e.id === j2.start_id);
  record('coincident-pp-check', {
    merged: Math.hypot(A.position.x - B.position.x, A.position.y - B.position.y) < 1e-9,
  });
});

// 2) point drawn with the Point tool, coincident onto a circle
let C1;
await scenario('coincident-pc', async () => {
  C1 = await drawCircle(-40, 40, 10);
  const P = await drawPoint(-60, 55);
  await deselect();
  const pe = await entityById(P);
  await hoverClick(pe.position.x, pe.position.y);
  const c = await entityById(C1);
  const sel = await hoverClick(c.center.x, c.center.y + c.radius, 'Shift');
  record('pc-selection', sel);
  const after = await applyAndDiff('coincident-pc', 'Coincident', [P, C1]);
  const p2 = after.entities.find((e) => e.id === P);
  const cc = after.entities.find((e) => e.id === C1);
  record('coincident-pc-check', {
    onRim: Math.abs(Math.hypot(p2.position.x - cc.center.x, p2.position.y - cc.center.y) - cc.radius) < 1e-6,
  });
});

// 3) midpoint point+line
await scenario('midpoint', async () => {
  const P = await drawPoint(-15, 10);
  const L = await drawLine(-110, -5, -70, 8);
  await deselect();
  const pe = await entityById(P);
  await hoverClick(pe.position.x, pe.position.y);
  await hoverClick(...(await lineMid(L)), 'Shift');
  const after = await applyAndDiff('midpoint', 'MidPoint', [P, L]);
  const p = after.entities.find((e) => e.id === P);
  const l = after.entities.find((e) => e.id === L);
  record('midpoint-check', {
    atMid: Math.hypot(p.position.x - (l.start.x + l.end.x) / 2, p.position.y - (l.start.y + l.end.y) / 2) < 1e-6,
  });
});

// 4) symmetry: two points about a vertical axis, axis LAST; then axis FIRST
await scenario('symmetry', async () => {
  const AX = await drawLine(0, -50, 0.9, -18);
  await deselect();
  await hoverClick(...(await lineMid(AX)));
  await applyAndDiff('axis-v', 'Horizontal/Vertical', [AX]);
  const LS = await drawLine(-18, -44, -9, -32);
  const ls = await entityById(LS);
  await deselect();
  const pa = await entityById(ls.start_id);
  await hoverClick(pa.position.x, pa.position.y);
  const pb = await entityById(ls.end_id);
  await hoverClick(pb.position.x, pb.position.y, 'Shift');
  const sel = await hoverClick(...(await lineMid(AX)), 'Shift');
  record('symmetry-selection', sel);
  const after = await applyAndDiff('symmetry-last', 'Symmetry', [ls.start_id, ls.end_id, AX]);
  const A = after.entities.find((e) => e.id === ls.start_id);
  const B = after.entities.find((e) => e.id === ls.end_id);
  const ax = after.entities.find((e) => e.id === AX);
  record('symmetry-last-check', {
    axisX: ax.start.x,
    midX: (A.position.x + B.position.x) / 2,
    dy: Math.abs(A.position.y - B.position.y),
    payload: after.constraints.filter((c) => c.type === 'symmetry').at(-1),
  });

  // trap: three lines, intended axis picked FIRST
  const SA = await drawLine(-30, -14, -22, -6);
  const SB = await drawLine(22, -16, 30, -7);
  await deselect();
  await hoverClick(...(await lineMid(AX)));
  await hoverClick(...(await lineMid(SA)), 'Shift');
  const selTrap = await hoverClick(...(await lineMid(SB)), 'Shift');
  record('axis-first-selection', selTrap);
  const afterTrap = await applyAndDiff('symmetry-axis-first', 'Symmetry', [AX, SA, SB]);
  record('symmetry-axis-first-payload', {
    payload: afterTrap.constraints.filter((c) => c.type === 'symmetry').at(-1) ?? null,
    intendedAxis: AX,
    SA,
    SB,
  });
});

// 5) hv on two points → message
await scenario('hv-two-points', async () => {
  const P1 = await drawPoint(30, 40);
  const P2 = await drawPoint(42, 34);
  await deselect();
  const a = await entityById(P1);
  await hoverClick(a.position.x, a.position.y);
  const b = await entityById(P2);
  await hoverClick(b.position.x, b.position.y, 'Shift');
  await applyAndDiff('hv-two-points', 'Horizontal/Vertical', [P1, P2]);
});

// 6) equal line vs circle with true 2-selection → engine message
await scenario('equal-line-circle', async () => {
  const L = await drawLine(20, 15, 40, 22);
  await deselect();
  await hoverClick(...(await lineMid(L)));
  const c = await entityById(C1);
  await hoverClick(c.center.x, c.center.y + c.radius, 'Shift');
  await applyAndDiff('equal-line-circle', 'Equal', [L, C1]);
});

// 7) concentric (different radii) then tangent → real impossibility payload
await scenario('concentric-tangent', async () => {
  const CA = await drawCircle(35, -35, 9);
  const CB = await drawCircle(60, -35, 4);
  await deselect();
  let a = await entityById(CA);
  let b = await entityById(CB);
  await hoverClick(a.center.x, a.center.y + a.radius);
  await hoverClick(b.center.x, b.center.y + b.radius, 'Shift');
  await applyAndDiff('concentric2', 'Concentric', [CA, CB]);
  await deselect();
  a = await entityById(CA);
  b = await entityById(CB);
  // rims now share a center; click CA at top rim, CB at bottom rim
  const s1 = await hoverClick(a.center.x, a.center.y + a.radius);
  const s2 = await hoverClick(b.center.x, b.center.y - b.radius, 'Shift');
  record('ct-selection', { s1, s2 });
  await applyAndDiff('tangent-on-concentric', 'Tangent', [CA, CB]);
});

// 8) near-tangent solvable case (small move required)
await scenario('tangent-near', async () => {
  const CA = await drawCircle(-105, -35, 6);
  const CB = await drawCircle(-91, -35, 6);
  await deselect();
  const a = await entityById(CA);
  const b = await entityById(CB);
  await hoverClick(a.center.x, a.center.y + a.radius);
  await hoverClick(b.center.x, b.center.y + b.radius, 'Shift');
  const after = await applyAndDiff('tangent-near', 'Tangent', [CA, CB]);
  const a2 = after.entities.find((e) => e.id === CA);
  const b2 = after.entities.find((e) => e.id === CB);
  const d = Math.hypot(a2.center.x - b2.center.x, a2.center.y - b2.center.y);
  record('tangent-near-check', { d, sum: a2.radius + b2.radius });
});

// 9) auto-H tolerance probe: ~8° line with real hover
await scenario('autosnap-8deg', async () => {
  const L = await drawLine(-60, -55, -20, -49.4); // ~8°
  const s = await state();
  record('autosnap-8deg', {
    line: s.entities.find((e) => e.id === L),
    auto: s.constraints.filter((c) => c.entity === L),
  });
});

// 10) DOF chip text vs store value
await scenario('dof-chip', async () => {
  await page.evaluate(() => window.__appStore.getState().setShowDof(true));
  await page.waitForTimeout(300);
  const chip = await page.evaluate(() => document.querySelector('[data-native-hud="dof"]')?.textContent ?? null);
  const s = await state();
  record('dof-chip', { chip, storeDof: s.dof, showDof: s.showDof });
  await shot('dof-chip');
});

// 11) duplicate parallel (redundancy class, second sample)
await scenario('dup-parallel', async () => {
  const L1 = await drawLine(55, 35, 68, 55);
  const L2 = await drawLine(75, 33, 88, 52);
  await deselect();
  await hoverClick(...(await lineMid(L1)));
  await hoverClick(...(await lineMid(L2)), 'Shift');
  await applyAndDiff('parallel-1', 'Parallel', [L1, L2]);
  await deselect();
  await hoverClick(...(await lineMid(L1)));
  await hoverClick(...(await lineMid(L2)), 'Shift');
  await applyAndDiff('parallel-2', 'Parallel', [L1, L2]);
});

await writeFile(path.join(OUT, 'transcript.json'), JSON.stringify({ log, pageErrors }, null, 2));
console.log('AUDIT5 DONE');
await browser.close();
