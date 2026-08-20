/**
 * Node smoke test for the WASM engine bundle (gate 5 helper).
 *
 * Exercises the full M1a browser flow headlessly through the same
 * `WasmEngine` the frontend uses: document → begin_sketch(XY) → chained
 * lines with H/V inference → drag endpoint (single undo step) → undo →
 * finish. Run after `npm run build:wasm`.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.join(here, '..', 'src', 'engine-wasm', 'pkg');

const wasm = await import(path.join(pkgDir, 'nbcad_wasm.js'));
// The web target normally fetches the .wasm; in Node we hand it the bytes.
await wasm.default({ module_or_path: await readFile(path.join(pkgDir, 'nbcad_wasm_bg.wasm')) });

let failures = 0;
function check(label, condition, detail = '') {
  const status = condition ? 'ok' : 'FAIL';
  if (!condition) failures += 1;
  console.log(`  [${status}] ${label}${detail ? ` — ${detail}` : ''}`);
}
function unwrap(json) {
  const env = JSON.parse(json);
  if (env.ok !== true) throw new Error(`engine error: ${env.error}`);
  return env.value;
}

const engine = new wasm.WasmEngine();

// Document mirrors the native host.
const doc = unwrap(engine.document());
check('document has mm units', doc.settings.units === 'mm');

// begin_sketch(XY) → Sketch1 registered, Z-up basis.
const sketch = unwrap(engine.begin_sketch(JSON.stringify({ type: 'origin_plane', plane: 'xy' })));
check('sketch named Sketch1', sketch.name === 'Sketch1');
check('XY basis is Z-up', JSON.stringify(sketch.basis.normal) === '[0,0,1]');
const doc2 = unwrap(engine.document());
const folder = doc2.browser.find((n) => n.kind === 'sketches_folder');
check('Sketch1 registered under Sketches', folder.children.some((c) => c.name === 'Sketch1'));

// Preview: H inference + projection.
const preview = unwrap(
  engine.preview_segment(JSON.stringify({ from: { x: 0, y: 0 }, to_raw: { x: 50, y: 1 }, ctrl_held: false })),
);
check('H inferred inside the default axis-bias cone', preview.inferences.includes('horizontal'));
check('endpoint projected horizontal', preview.snapped_to.y === 0);

// Line chain: l1 (H), l2 (V) sharing a point, l3 coincident back onto l1 start.
const l1 = unwrap(
  engine.add_line(JSON.stringify({ from: { x: 0, y: 0 }, to_raw: { x: 50, y: 1 }, ctrl_held: false })),
);
check('l1 created Horizontal constraint', l1.created_constraints[0]?.type === 'horizontal');
const l2 = unwrap(
  engine.add_line(JSON.stringify({ from: { x: 50, y: 0 }, to_raw: { x: 51, y: 50 }, ctrl_held: false })),
);
check('chain shares the connecting point', l2.start_point_id === l1.end_point_id);
check(
  'l2 created a right-angle constraint',
  l2.created_constraints[0]?.type === 'perpendicular'
    || l2.created_constraints[0]?.type === 'vertical',
);
const l3 = unwrap(
  engine.add_line(JSON.stringify({ from: { x: 50, y: 50 }, to_raw: { x: 0.5, y: 0.4 }, ctrl_held: false })),
);
check('l3 closed the loop onto l1 start (coincident merge)', l3.end_point_id === l1.start_point_id);
check('coincident is structural (no constraint record)', l3.created_constraints.length === 0);

// Drag the l1/l2 shared endpoint: the origin is grounded, so the solver
// follows the cursor only along the remaining horizontal degree of freedom.
// The H/V constraints and the origin reference must all HOLD.
const dragged = unwrap(
  engine.move_point(
    JSON.stringify({ point_id: l2.start_point_id, to_raw: { x: 80, y: 0 }, ctrl_held: false, phase: 'single' }),
  ),
);
const l1After = dragged.sketch.entities.find((e) => e.id === l1.entity_id);
const l2After = dragged.sketch.entities.find((e) => e.id === l2.entity_id);
check('drag keeps l1 horizontal (H holds)', Math.abs(l1After.start.y - l1After.end.y) < 1e-9);
check('drag keeps l2 vertical (V holds)', Math.abs(l2After.start.x - l2After.end.x) < 1e-6);
check(
  'origin remains grounded during drag',
  Math.abs(l1After.start.x) < 1e-6 && Math.abs(l1After.start.y) < 1e-6,
);
check(
  'drag follows the remaining free axis',
  Math.abs(l1After.end.x - 80) < 1e-6 && Math.abs(l1After.end.y) < 1e-6,
  `end=(${l1After.end.x}, ${l1After.end.y})`,
);

// Undo the drag, then undo l3/l2/l1, redo once.
unwrap(engine.undo());
const l1Restored = unwrap(engine.active_sketch()).entities.find((e) => e.id === l1.entity_id);
check('undo restores pre-drag position', l1Restored.end.x === 50 && l1Restored.end.y === 0);
unwrap(engine.undo());
unwrap(engine.undo());
const empty = unwrap(engine.undo());
check('three more undos empty the sketch', empty.sketch.entities.length === 0);
const redone = unwrap(engine.redo());
check('redo brings the first line back', redone.sketch.entities.length === 3);

// Finish.
const ended = unwrap(engine.end_sketch());
check('end_sketch returns the document', ended.document.name === 'Untitled');
check('no active sketch afterwards', unwrap(engine.active_sketch()) === null);

engine.free();
if (failures > 0) {
  console.error(`\n${failures} smoke check(s) FAILED`);
  process.exit(1);
}
console.log('\nwasm engine smoke test: all checks passed');
