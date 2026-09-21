// Hover, preview and committed geometry must use the same snap policy.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
const screen = p => page.evaluate(p => window.__sketchToScreen(p.x, p.y), p);
const sketch = () => page.evaluate(() => window.__appStore.getState().activeSketch);
const local = (basis, position) => {
  const delta = position.map((p, i) => p - basis.origin[i]);
  return { x: delta.reduce((sum, x, i) => sum + x * basis.u[i], 0), y: delta.reduce((sum, x, i) => sum + x * basis.v[i], 0) };
};
const close = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-6;

async function faceSketch() {
  const frame = await page.evaluate(async () => {
    const e = window.__engine;
    const s = window.__appStore.getState();
    s.setActiveTool(null);
    s.applySolidUpdate(await e.newProject());
    await e.beginSketch({ type: 'origin_plane', plane: 'xy' });
    await e.setGridSnap(false);
    await e.addRectangle({ mode: 'two_point', p1: { x: 0, y: 0 }, p2: { x: 20, y: 15 }, ctrl_held: true });
    s.setDocument((await e.endSketch()).document);
    const update = await e.extrude({ source_face: null, sketch_name: 'Sketch1', profile_indices: [0], operation: 'new_body', extent: { type: 'distance', distance: 10 }, taper_angle_deg: 0, flip: false, target_body_ids: [] });
    s.applySolidUpdate(update);
    const cap = update.scene.bodies[0].faces.find(f => f.plane && f.plane.normal[2] > 0.99);
    const sketch = await e.beginSketch({ type: 'planar_face', face_id: cap.id });
    s.setActiveSketch(sketch);
    s.setMode('sketch');
    const points = sketch.projected_edges.flatMap(e => e.points);
    return { minX: Math.min(...points.map(p => p.x)), maxX: Math.max(...points.map(p => p.x)), minY: Math.min(...points.map(p => p.y)), maxY: Math.max(...points.map(p => p.y)), basis: sketch.basis };
  });
  await page.evaluate(() => window.__cameraApi.fit());
  await page.waitForTimeout(450);
  return frame;
}

try {
  await page.goto(process.env.NBCAD_E2E_BASE_URL ?? 'http://localhost:7199', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__engine && window.__appStore?.getState().document);
  for (const tool of ['rect2pt', 'rectCenter', 'circleCenter', 'circle2pt']) {
    for (const kind of ['boundary', 'midpoint', 'ctrl']) {
      const frame = await faceSketch();
      const anchor = { x: frame.minX + 5, y: frame.minY + 5 };
      const target = { x: frame.minX + (kind === 'midpoint' ? 10 : 14), y: frame.maxY };
      await page.evaluate(tool => window.__appStore.getState().setActiveTool(tool), tool);
      await page.waitForTimeout(120);
      const first = await screen(anchor);
      await page.mouse.move(first.x, first.y, { steps: 4 });
      await page.waitForTimeout(150);
      await page.mouse.click(first.x, first.y);
      await page.waitForTimeout(150);
      const pick = await page.evaluate(() => window.__nativeViewportTransient().points.find(layer => layer.positions.length === 3)?.positions);
      assert.ok(pick, 'the tool exposes its actual first pick');
      const pickedAnchor = local(frame.basis, pick);
      if (kind === 'ctrl') await page.keyboard.down('Control');
      const second = await screen(target);
      await page.mouse.move(second.x + 5, second.y + 5, { steps: 5 });
      await page.waitForTimeout(250);
      const transient = await page.evaluate(() => window.__nativeViewportTransient());
      assert.ok(transient.marker, `${tool}/${kind}: marker`);
      const preview = local(frame.basis, transient.marker.position);
      if (kind === 'ctrl') {
        assert.notEqual(transient.marker.kind, 'reference_midpoint');
        assert.ok(Math.abs(preview.y - frame.maxY) > 1e-3, 'Ctrl suppresses boundary acquisition');
      } else {
        assert.equal(transient.marker.kind, kind === 'midpoint' ? 'reference_midpoint' : 'curve');
        assert.ok(Math.abs(preview.y - frame.maxY) < 1e-6, 'preview sits on the boundary');
        if (kind === 'midpoint') assert.ok(close(preview, target));
      }
      if (process.env.NBCAD_E2E_SCREENSHOT && tool === 'rect2pt' && kind === 'boundary') {
        await page.screenshot({ path: process.env.NBCAD_E2E_SCREENSHOT });
      }
      await page.mouse.click(second.x + 5, second.y + 5);
      if (kind === 'ctrl') await page.keyboard.up('Control');
      await page.waitForFunction(() => window.__appStore.getState().activeSketch.entities.some(e => e.kind === 'line' || e.kind === 'circle'));
      const result = await sketch();
      if (tool.startsWith('rect')) {
        assert.ok(result.entities.some(e => e.kind === 'point' && close(e.position, preview)), `${tool}/${kind}: corner equals preview`);
      } else {
        const circle = result.entities.find(e => e.kind === 'circle');
        const center = tool === 'circleCenter' ? pickedAnchor : { x: (pickedAnchor.x + preview.x) / 2, y: (pickedAnchor.y + preview.y) / 2 };
        const radius = Math.hypot(pickedAnchor.x - preview.x, pickedAnchor.y - preview.y) / (tool === 'circleCenter' ? 1 : 2);
        assert.ok(close(circle.center, center), `${tool}/${kind}: center equals preview (${JSON.stringify({ circle, center, pick })})`);
        assert.ok(Math.abs(circle.radius - radius) < 1e-6, `${tool}/${kind}: radius equals preview`);
      }
      await page.keyboard.press('Escape');
      console.log(`PASS ${tool}/${kind} preview/commit agreement`);
    }
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
