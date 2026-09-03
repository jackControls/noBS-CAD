/**
 * Isolated engine-level solver convergence regressions (symmetry / tangent).
 * Keeps the symmetry and tangent convergence envelopes reproducible.
 * Run: start `npm run dev -- --port 7317 --strictPort`, then `node scripts/audit-sketch-solver-probes.mjs [out-dir]`.
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:7317';
const browser = await chromium.launch();

const freshSketch = async (page) => {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.click('button:has-text("Create Sketch")');
  await page.waitForTimeout(400);
  await page.click('button[aria-label="Origin"]');
  await page.waitForTimeout(250);
  await page.click('text=XY Plane');
  await page.waitForTimeout(1200);
};

const run = async (name, body) => {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await freshSketch(page);
  const result = await page.evaluate(async (src) => {
    const { getEngine } = await import('/src/engine/index.ts');
    const engine = await getEngine();
    const fn = new Function('engine', `return (async () => { ${src} })()`);
    try { return await fn(engine); } catch (err) { return { error: String(err?.message ?? err) }; }
  }, body);
  console.log(name, JSON.stringify(result));
  await page.close();
};

// symmetry about a free vertical axis at increasing asymmetry
for (const off of [1, 2, 5, 12]) {
  await run(`symmetry-freeaxis-off${off}`, `
    const ln = await engine.addLine({ from: { x: 40, y: -60 }, to_raw: { x: 40, y: -20 }, ctrl_held: false });
    const axis = ln.sketch.entities.filter(e => e.kind === 'line').at(-1).id;
    const p1r = await engine.addPoint({ position: { x: 30, y: -40 } });
    const pa = p1r.sketch.entities.filter(e => e.kind === 'point').at(-1).id;
    const p2r = await engine.addPoint({ position: { x: 50 + ${off}, y: -40 + ${off} } });
    const pb = p2r.sketch.entities.filter(e => e.kind === 'point').at(-1).id;
    try {
      const r = await engine.addConstraints([{ type: 'symmetry', a: pa, b: pb, axis }]);
      const A = r.sketch.entities.find(e => e.id === pa);
      const B = r.sketch.entities.find(e => e.id === pb);
      return { ok: true, ax: (A.position.x + B.position.x) / 2, dy: Math.abs(A.position.y - B.position.y) };
    } catch (err) { return { ok: false, message: String(err?.message ?? err) }; }
  `);
}

// symmetry where the axis is Fixed first (the axis cannot move)
await run('symmetry-fixedaxis-off5', `
  const ln = await engine.addLine({ from: { x: 40, y: -60 }, to_raw: { x: 40, y: -20 }, ctrl_held: false });
  const axis = ln.sketch.entities.filter(e => e.kind === 'line').at(-1).id;
  await engine.toggleFixEntities([axis]);
  const p1r = await engine.addPoint({ position: { x: 30, y: -40 } });
  const pa = p1r.sketch.entities.filter(e => e.kind === 'point').at(-1).id;
  const p2r = await engine.addPoint({ position: { x: 55, y: -35 } });
  const pb = p2r.sketch.entities.filter(e => e.kind === 'point').at(-1).id;
  try {
    const r = await engine.addConstraints([{ type: 'symmetry', a: pa, b: pb, axis }]);
    const A = r.sketch.entities.find(e => e.id === pa);
    const B = r.sketch.entities.find(e => e.id === pb);
    return { ok: true, ax: (A.position.x + B.position.x) / 2, dy: Math.abs(A.position.y - B.position.y) };
  } catch (err) { return { ok: false, message: String(err?.message ?? err) }; }
`);

// isolated tangent pocket case
await run('tangent-cc-d15-isolated', `
  const c1 = await engine.addCircle({ mode: 'center_diameter', p1: { x: -60, y: 45 }, p2: { x: -55, y: 45 }, ctrl_held: false });
  const id1 = c1.sketch.entities.filter(e => e.kind === 'circle').at(-1).id;
  const c2 = await engine.addCircle({ mode: 'center_diameter', p1: { x: -45, y: 45 }, p2: { x: -40, y: 45 }, ctrl_held: false });
  const id2 = c2.sketch.entities.filter(e => e.kind === 'circle').at(-1).id;
  try {
    const r = await engine.addConstraints([{ type: 'tangent', a: id1, b: id2 }]);
    const a = r.sketch.entities.find(e => e.id === id1);
    const b = r.sketch.entities.find(e => e.id === id2);
    return { ok: true, dist: Math.hypot(a.center.x - b.center.x, a.center.y - b.center.y), r1: a.radius, r2: b.radius };
  } catch (err) { return { ok: false, message: String(err?.message ?? err) }; }
`);

// the exact UI symmetry case from round 5
await run('symmetry-ui-case', `
  const ax = await engine.addLine({ from: { x: 0, y: -50 }, to_raw: { x: 0.9, y: -18 }, ctrl_held: true });
  const axis = ax.sketch.entities.filter(e => e.kind === 'line').at(-1).id;
  await engine.addConstraints([{ type: 'vertical', entity: axis }]);
  const ls = await engine.addLine({ from: { x: -18, y: -44 }, to_raw: { x: -9, y: -32 }, ctrl_held: false });
  const line = ls.sketch.entities.filter(e => e.kind === 'line').at(-1).id;
  const l = ls.sketch.entities.find(e => e.id === line);
  try {
    const r = await engine.addConstraints([{ type: 'symmetry', a: l.start_id, b: l.end_id, axis }]);
    const A = r.sketch.entities.find(e => e.id === l.start_id);
    const B = r.sketch.entities.find(e => e.id === l.end_id);
    return { ok: true, ax: (A.position.x + B.position.x) / 2, dy: Math.abs(A.position.y - B.position.y) };
  } catch (err) { return { ok: false, message: String(err?.message ?? err) }; }
`);

console.log('PROBE2 DONE');
await browser.close();
