/**
 * Engine-level proof that edit_dimension leaves Constraint.value stale.
 * Evidence for docs/SKETCH_CONSTRAINT_AUDIT.md.
 * Run: start `npm run dev -- --port 7317 --strictPort`, then `node scripts/audit-dimension-staleness.mjs [out-dir]`.
 */
import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
await page.goto('http://localhost:7317', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.click('button:has-text("Create Sketch")');
await page.waitForTimeout(400);
await page.click('button[aria-label="Origin"]');
await page.waitForTimeout(250);
await page.click('text=XY Plane');
await page.waitForTimeout(1200);
const result = await page.evaluate(async () => {
  const { getEngine } = await import('/src/engine/index.ts');
  const engine = await getEngine();
  const ln = await engine.addLine({ from: { x: -30, y: 0 }, to_raw: { x: 5, y: 5 }, ctrl_held: false });
  const line = ln.sketch.entities.filter((e) => e.kind === 'line').at(-1).id;
  const dim = await engine.addDimension({ entities: [line], text_pos: { x: -12, y: 12 } });
  const cid = dim.sketch.constraints.filter((c) => c.type === 'distance').at(-1).id;
  const created = {
    constraintValue: dim.sketch.constraints.find((c) => c.id === cid).value,
    dimensionDto: dim.sketch.dimensions.find((d) => d.constraint_id === cid),
  };
  const edited = await engine.editDimension({ constraint_id: cid, text: '42' });
  const l2 = edited.sketch.entities.find((e) => e.id === line);
  return {
    created,
    afterEdit: {
      length: Math.hypot(l2.end.x - l2.start.x, l2.end.y - l2.start.y),
      constraintValue: edited.sketch.constraints.find((c) => c.id === cid).value,
      dimensionValue: edited.sketch.dimensions.find((d) => d.constraint_id === cid)?.value,
      dimensionText: edited.sketch.dimensions.find((d) => d.constraint_id === cid)?.text,
    },
  };
});
console.log(JSON.stringify(result, null, 2));
await browser.close();
