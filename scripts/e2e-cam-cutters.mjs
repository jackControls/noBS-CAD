/** Tool edit persistence, shared Rust meshes and native semantic geometry. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {});
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
try {
  await page.goto('http://localhost:7199', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__engine && window.__appStore?.getState().document);
  await page.evaluate(async () => {
    const engine = window.__engine, store = window.__appStore.getState();
    store.applySolidUpdate(await engine.newProject());
    const cam = await engine.camDocument();
    const cutting = { spindle_rpm: 6000, feed_xy: 600, feed_z: 100, coolant: 'flood' };
    const tool = { id: 1, number: 1, name: 'Point drill', kind: 'drill', diameter: 10, flute_length: 20,
      overall_length: 50, center_cutting: true, flute_count: 2, point_angle_degrees: 135,
      corner_radius: null, cutting, cutting_presets: [] };
    cam.tools = [tool, { ...tool, id: 2, number: 2, name: 'Corner mill', kind: 'flat_end_mill', point_angle_degrees: null }];
    cam.next_tool_id = 3;
    await store.setCamDocument(cam);
    store.setActiveTab('cam');
    store.setCamDialog({ type: 'tool', toolId: 1 });
  });
  const dialog = page.getByTestId('cam-tool-dialog');
  const open = async id => {
    await page.evaluate(() => window.__appStore.getState().setCamDialog(null));
    await dialog.waitFor({ state: 'detached' });
    await page.evaluate(id => window.__appStore.getState().setCamDialog({ type: 'tool', toolId: id }), id);
    await dialog.getByRole('button', { name: 'Cutter', exact: true }).click();
  };
  await dialog.getByRole('button', { name: 'Cutter', exact: true }).click();
  assert.equal(await dialog.getByLabel('Point angle (included)').inputValue(), '135');
  await dialog.getByRole('button', { name: 'Save tool', exact: true }).click();
  // Wait for the actual editor to unmount, not merely for a global busy flag.
  await dialog.getByRole('button', { name: 'Save tool', exact: true }).waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(async () => (await window.__engine.camDocument()).tools[0].point_angle_degrees), 135);
  await open(1);
  await dialog.getByLabel('Point angle (included)').fill('118');
  await dialog.getByRole('button', { name: 'Save tool', exact: true }).click();
  await dialog.getByRole('button', { name: 'Save tool', exact: true }).waitFor({ state: 'detached' });
  await open(1);
  assert.equal(await dialog.getByLabel('Point angle (included)').inputValue(), '118');
  await open(2);
  await dialog.getByLabel('Corner shape').selectOption('chamfer');
  await dialog.getByLabel('Corner chamfer width').fill('0.8');
  await dialog.getByLabel('Corner chamfer angle (from axis)').fill('45');
  await dialog.getByRole('button', { name: 'Save tool', exact: true }).click();
  await dialog.getByRole('button', { name: 'Save tool', exact: true }).waitFor({ state: 'detached' });
  const bevel = await page.evaluate(async () => (await window.__engine.camDocument()).tools[1]);
  assert.deepEqual(bevel.corner_chamfer, { width: 0.8, angle_degrees: 45 });
  assert.equal(bevel.corner_radius, null);
  await open(2);
  assert.equal(await dialog.getByLabel('Corner shape').inputValue(), 'chamfer');
  assert.equal(await dialog.getByLabel('Corner chamfer width').inputValue(), '0.8');
  await page.screenshot({ path: '/tmp/nbcad-cam-corner-tool.png' });
  await dialog.getByLabel('Corner shape').selectOption('radius');
  await dialog.getByLabel('Corner radius').fill('1');
  await dialog.getByRole('button', { name: 'Save tool', exact: true }).click();
  await dialog.getByRole('button', { name: 'Save tool', exact: true }).waitFor({ state: 'detached' });
  const round = await page.evaluate(async () => (await window.__engine.camDocument()).tools[1]);
  assert.equal(round.corner_radius, 1); assert.ok(round.corner_chamfer == null);

  const geometry = await page.evaluate(async () => {
    const engine = window.__engine;
    const { cutterGeometry } = await import('/src/cam/cutter.ts');
    const tools = (await engine.camDocument()).tools;
    const fixtures = [tools[0], tools[1], { ...tools[1], kind: 'bull_nose_end_mill' },
      { ...tools[0], kind: 'chamfer_mill', point_angle_degrees: 90 },
      { ...tools[1], kind: 'ball_end_mill', corner_radius: null }];
    const rows = [];
    for (const tool of fixtures) {
      const shape = await engine.camCutterMesh(cutterGeometry(tool));
      const points = shape.cutter.positions;
      let bottomRadius = 0, bottomZ = Infinity;
      for (let i=0;i<points.length;i+=3) {
        bottomZ = Math.min(bottomZ, points[i+2]);
        if (Math.abs(points[i+2])<1e-6) bottomRadius = Math.max(bottomRadius, Math.hypot(points[i],points[i+1]));
      }
      rows.push({ kind: tool.kind, bottomRadius, bottomZ, vertices: points.length/3, normals: shape.cutter.normals.length/3 });
    }
    return rows;
  });
  for (const g of geometry) {
    assert.equal(g.bottomZ, 0); assert.equal(g.normals, g.vertices);
    assert.ok(g.vertices < 12000);
    assert.ok(Math.abs(g.bottomRadius - (g.kind.includes('flat') || g.kind.includes('bull') ? 4 : 0)) < 1e-5);
  }
  assert.deepEqual(errors, []);
  console.log('PASS: drill angle saved/reopened; chamfered and radiused end-mill corners; Rust meshes share tip origin, smooth normals and bounded detail.');
} finally { await browser.close(); }
