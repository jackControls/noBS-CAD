/** Public UI + browser engine contract for the High Speed Roughing editor. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));
try {
  await page.goto('http://localhost:7199', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__appStore?.getState().document && window.__engine);
  await page.evaluate(async () => {
    const engine = window.__engine;
    // This is an editor/generation contract test, not a high-density browser
    // simulation benchmark. Keep the real Rust simulation but bound its grid;
    // native desktop runs the same kernel on its separate worker.
    const simulate = engine.camSimulate.bind(engine);
    engine.camSimulate = (request) => simulate({ ...request, voxel_size: 0.5, max_voxels: 20000 });
    const store = window.__appStore.getState();
    store.applySolidUpdate(await engine.newProject());
    await engine.beginSketch({ type: 'origin_plane', plane: 'xy' });
    await engine.addRectangle({ mode: 'two_point', p1: { x: 6, y: 5 }, p2: { x: 10, y: 9 }, ctrl_held: true });
    const ended = await engine.endSketch();
    store.setDocument(ended.document);
    store.setFinishedSketches(await engine.finishedSketches());
    store.setMode('solid');
    const catalog = await engine.profileCatalog();
    const update = await engine.extrude({ source_face: null, sketch_name: catalog[0].sketch_name,
      profile_indices: [catalog[0].profiles[0].index], operation: 'new_body',
      extent: { type: 'distance', distance: 3 }, taper_angle_deg: 0, flip: true, target_body_ids: [] });
    store.applySolidUpdate(update);
    const cam = await engine.camDocument();
    const cutting = { spindle_rpm: 8000, feed_xy: 600, feed_z: 100, coolant: 'flood' };
    cam.tools = [{ id: 1, number: 1, name: 'EM4 test', kind: 'flat_end_mill', diameter: 4,
      flute_length: 10, overall_length: 30, center_cutting: true, flute_count: 3,
      point_angle_degrees: null, corner_radius: null, cutting, cutting_presets: [],
      default_step_down: null, default_step_over: null }];
    cam.setups = [{ id: 1, name: 'Roughing fixture', wcs: { origin: { x: 0, y: 0, z: 0 },
      x_axis: [1, 0, 0], y_axis: [0, 1, 0], z_axis: [0, 0, 1] }, wcs_origin: { mode: 'explicit' },
      work_offset: 'g54', work_offset_count: 1, stock_spec: { mode: 'legacy_box' }, resolved_stock: { shape: 'box' },
      stock: { min: { x: 0, y: 0, z: -3 }, max: { x: 16, y: 14, z: 0 } }, stock_model_box: null,
      body_ids: update.scene.bodies.map((b) => b.id), operations: [] }];
    cam.active_setup_id = 1; cam.next_setup_id = 2; cam.next_tool_id = 2; cam.next_operation_id = 1;
    await store.setCamDocument(cam);
    store.setSelectedCamSetupId(1); store.setSelectedCamOperationId(null); store.setActiveTab('cam');
  });
  await page.getByRole('button', { name: 'High Speed Roughing', exact: true }).click();
  const dialog = page.getByTestId('cam-adaptive-dialog');
  await dialog.waitFor();
  assert.match(await dialog.innerText(), /Experimental roughing/);
  for (const tab of ['Geometry', 'Heights', 'Passes', 'Linking', 'Tool']) {
    await dialog.getByRole('button', { name: tab, exact: true }).click();
    assert.equal(await dialog.isVisible(), true);
    assert.equal(await dialog.getByRole('button', { name: tab, exact: true }).getAttribute('aria-pressed'), 'true');
  }
  assert.equal(await dialog.getByRole('navigation', { name: 'Operation pages' }).locator('svg').count(), 5);
  await dialog.getByRole('button', { name: 'Heights', exact: true }).click();
  const height = (label) => dialog.locator('section').filter({ has: page.getByText(label, { exact: true }) });
  assert.equal(await height('TOP HEIGHT').getByLabel('From', { exact: true }).isDisabled(), false);
  assert.equal(await height('TOP HEIGHT').getByLabel('From', { exact: true }).inputValue(), 'stock_top');
  await height('TOP HEIGHT').getByLabel('From', { exact: true }).selectOption('model_top');
  await height('TOP HEIGHT').getByLabel('Offset', { exact: true }).fill('-0.4');
  await height('BOTTOM HEIGHT').getByLabel('From', { exact: true }).selectOption('model_bottom');
  await height('BOTTOM HEIGHT').getByLabel('Offset', { exact: true }).fill('0.2');
  await height('FEED HEIGHT').getByLabel('From', { exact: true }).selectOption('top');
  await height('FEED HEIGHT').getByLabel('Offset', { exact: true }).fill('1');
  await height('RETRACT HEIGHT').getByLabel('From', { exact: true }).selectOption('feed');
  await height('RETRACT HEIGHT').getByLabel('Offset', { exact: true }).fill('2');
  await height('CLEARANCE HEIGHT').getByLabel('From', { exact: true }).selectOption('retract');
  await height('CLEARANCE HEIGHT').getByLabel('Offset', { exact: true }).fill('5');
  await dialog.getByRole('button', { name: 'Save & generate', exact: true }).click({ timeout: 60000 });
  await dialog.waitFor({ state: 'detached', timeout: 60000 });
  const result = await page.evaluate(async () => {
    const engine = window.__engine;
    const cam = await engine.camDocument();
    const statuses = await engine.camToolpathStatuses();
    const program = await engine.camPlan(1);
    const op = cam.setups[0].operations[0];
    return { kind: op.kind, name: op.name, targets: op.geometry?.targets.length,
      heights: cam.height_expressions?.[0], top: op.top_z, bottom: op.bottom_z, feed: op.feed_height_z, retract: op.retract_z, clearance: op.clearance_z,
      topReference: cam.height_expressions?.[0]?.top?.reference,
      status: statuses[0].state, arcs: program.commands.filter((c) => c.kind === 'circular').length };
  });
  assert.equal(result.kind, 'adaptive3d');
  assert.equal(result.name, 'High Speed Roughing');
  assert.equal(result.topReference, 'model_top');
  assert.deepEqual(result.heights.top, { reference: 'model_top', offset: -0.4 });
  assert.ok(Math.abs(result.top + 0.4) < 1e-8);
  assert.deepEqual(result.heights.bottom, { reference: 'model_bottom', offset: 0.2 });
  assert.equal(result.heights.clearance.reference, 'retract');
  assert.ok(Math.abs(result.bottom + 2.8) < 1e-8);
  assert.ok(Math.abs(result.feed - 0.6) < 1e-8);
  assert.ok(Math.abs(result.retract - 2.6) < 1e-8);
  assert.ok(Math.abs(result.clearance - 7.6) < 1e-8);
  assert.equal(result.targets, 1);
  assert.equal(result.status, 'current');
  assert.ok(result.arcs > 0);
  await page.evaluate(() => window.__appStore.getState().setCamDialog({ type: 'operation', kind: 'adaptive3d', editId: 1 }));
  await page.getByTestId('cam-adaptive-dialog').waitFor();
  assert.equal(await page.getByTestId('cam-adaptive-dialog').getByLabel('Operation name', { exact: true }).inputValue(), result.name);
  await dialog.getByRole('button', { name: 'Heights', exact: true }).click();
  assert.equal(await height('TOP HEIGHT').getByLabel('From', { exact: true }).inputValue(), 'model_top');
  assert.equal(await height('TOP HEIGHT').getByLabel('Offset', { exact: true }).inputValue(), '-0.4');
  assert.equal(await height('BOTTOM HEIGHT').getByLabel('From', { exact: true }).inputValue(), 'model_bottom');
  assert.equal(await height('BOTTOM HEIGHT').getByLabel('Offset', { exact: true }).inputValue(), '0.2');
  assert.equal(await height('RETRACT HEIGHT').getByLabel('From', { exact: true }).inputValue(), 'feed');
  await page.screenshot({ path: '/tmp/nbcad-high-speed-roughing-heights.png' });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.evaluate(async () => {
    const cam = await window.__engine.camDocument(); cam.units = 'inches';
    await window.__appStore.getState().setCamDocument(cam);
    window.__appStore.getState().setCamDialog({ type: 'operation', kind: 'adaptive3d', editId: 1 });
  });
  await dialog.getByRole('button', { name: 'Heights', exact: true }).click();
  assert.ok(Math.abs(Number(await height('TOP HEIGHT').getByLabel('Offset', { exact: true }).inputValue()) * 25.4 + 0.4) < 1e-6);
  assert.ok(Math.abs(Number(await height('BOTTOM HEIGHT').getByLabel('Offset', { exact: true }).inputValue()) * 25.4 - 0.2) < 1e-6);
  await dialog.getByRole('button', { name: 'Save & generate', exact: true }).click({ timeout: 60000 });
  await dialog.waitFor({ state: 'detached', timeout: 60000 });
  const inchResult = await page.evaluate(async () => (await window.__engine.camDocument()).height_expressions[0]);
  assert.equal(inchResult.bottom.reference, 'model_bottom');
  assert.ok(Math.abs(inchResult.bottom.offset - 0.2) < 1e-6);
  assert.equal(inchResult.top.reference, 'model_top');
  assert.ok(Math.abs(inchResult.top.offset + 0.4) < 1e-6);
  assert.deepEqual(errors, []);
  console.log('PASS: High Speed Roughing shared tabs/heights, chained references, inch round-trip, current CAD capture, generation, and editing');
} finally { await browser.close(); }
