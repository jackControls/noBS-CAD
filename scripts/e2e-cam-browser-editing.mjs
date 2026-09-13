/** Isolated real-engine CAM editing: duplicates, anchored insertion and stale isolation. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {});
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
const document = () => page.evaluate(() => window.__engine.camDocument());
const row = id => page.locator(`[data-cam-sort-scope="operations-1"][data-cam-sort-id="${id}"]`);
const setupRow = id => page.locator(`[data-cam-sort-scope="setups"][data-cam-sort-id="${id}"]`).locator('button').first();
const save = async dialog => {
  await dialog.locator('button[type="submit"]').click();
  try { await dialog.waitFor({ state: 'detached', timeout: 30000 }); }
  catch (error) { throw new Error(String(error) + '\n' + await page.locator('body').innerText()); }
};
const heights = async (dialog, top, bottom) => {
  await dialog.getByRole('button', { name: 'Heights', exact: true }).click();
  for (const [name, value] of [['TOP HEIGHT', top], ['BOTTOM HEIGHT', bottom]]) {
    const section = dialog.locator('section').filter({ has: page.getByText(name, { exact: true }) });
    await section.getByLabel('From', { exact: true }).selectOption('origin');
    await section.getByLabel('Offset', { exact: true }).fill(String(value));
  }
};

try {
  await page.goto('http://localhost:7199', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__engine && window.__appStore?.getState().document);
  await page.evaluate(async () => {
    const engine = window.__engine, store = window.__appStore.getState();
    const simulate = engine.camSimulate.bind(engine);
    engine.camSimulate = request => simulate({ ...request, voxel_size: 0.5, max_voxels: 20000 });
    store.applySolidUpdate(await engine.newProject());
    await engine.beginSketch({ type: 'origin_plane', plane: 'xy' });
    await engine.addRectangle({ mode: 'two_point', p1: { x: 6.013, y: 5.007 }, p2: { x: 10.123, y: 9.004 }, ctrl_held: true });
    const ended = await engine.endSketch();
    store.setDocument(ended.document);
    store.setFinishedSketches(await engine.finishedSketches());
    store.setMode('solid');
    const catalog = await engine.profileCatalog();
    const update = await engine.extrude({ source_face: null, sketch_name: catalog[0].sketch_name,
      profile_indices: [catalog[0].profiles[0].index], operation: 'new_body',
      extent: { type: 'distance', distance: 3.013 }, taper_angle_deg: 0, flip: true, target_body_ids: [] });
    const syncRevision = window.__appStore.getState().assemblySolidSyncRevision;
    store.applySolidUpdate(update);
    // Fixture construction bypasses the modeling UI. Finish its asynchronous
    // assembly hydration before submitting a document-owned CAM edit.
    await new Promise(resolve => {
      const unsubscribe = window.__appStore.subscribe(state => {
        if (state.assemblySolidSyncRevision <= syncRevision) return;
        unsubscribe(); resolve();
      });
    });
    const cam = await engine.camDocument();
    const cutting = { spindle_rpm: 8000, feed_xy: 600, feed_z: 100, coolant: 'flood' };
    cam.tools = [{ id: 1, number: 1, name: 'EM4', kind: 'flat_end_mill', diameter: 4, flute_length: 10,
      overall_length: 30, center_cutting: true, flute_count: 3, point_angle_degrees: null,
      corner_radius: null, cutting, cutting_presets: [], default_step_down: 1, default_step_over: 3 }];
    const base = { enabled: true, clearance_z: 5, retract_z: 3, feed_height_z: 1, cutting, tool_id: 1 };
    cam.setups = [{ id: 1, name: 'Setup A',
      wcs: { origin: { x: 0, y: 0, z: 0 }, x_axis: [1,0,0], y_axis: [0,1,0], z_axis: [0,0,1] },
      wcs_origin: { mode: 'explicit' }, work_offset: 'g54', work_offset_count: 1,
      stock_spec: { mode: 'legacy_box' }, resolved_stock: { shape: 'box' },
      stock: { min: { x: 0, y: 0, z: -4 }, max: { x: 16, y: 14, z: 0.5 } }, stock_model_box: null,
      body_ids: update.scene.bodies.map(b => b.id), operations: [
        { ...base, id: 1, name: 'Face', kind: 'face', bounds: { min: { x: 0, y: 0 }, max: { x: 16, y: 14 } },
          top_z: 0, target_z: -0.2, step_over: 3, step_down: 1, safe_distance: 1, direction: 'both_ways' },
        { ...base, id: 2, name: 'Roughing', kind: 'adaptive3d', top_z: 0, bottom_z: -1,
          parameters: { optimal_load: 0.8, maximum_stepdown: 1, minimum_cutting_radius: 0.8,
            radial_stock_to_leave: 0.1, axial_stock_to_leave: 0.1, tolerance: 0.2,
            ramp_angle_degrees: 3, maximum_ramp_stepdown: 0.5, ramp_feed: 100,
            linking_feed: 600, stay_down_distance: 20, machine_cavities: true }, geometry: null },
        { ...base, id: 3, name: 'Profile', kind: 'contour2d',
          path: [{x:6.013,y:5.007},{x:10.123,y:5.007},{x:10.123,y:9.004},{x:6.013,y:9.004}],
          closed: true, top_z: 0, bottom_z: -1, step_down: 1, compensation: 'outside', compensation_mode: 'in_software',
          lead_in: 0.4, lead_out: 0.4, lead_arc_radius: 0.4, direction: 'climb', chain_ref: null },
      ] }];
    cam.active_setup_id = 1; cam.next_setup_id = 2; cam.next_operation_id = 4; cam.next_tool_id = 2;
    await store.setCamDocument(cam);
    const generated = await engine.camRegenerateSetup(1);
    // A native-style JSON echo must not change captured earlier geometry.
    await store.setCamDocument(JSON.parse(JSON.stringify(generated)));
    store.setSelectedCamSetupId(1); store.setSelectedCamOperationId(null); store.setActiveTab('cam');
  });
  const initial = await document();
  assert.ok((await page.evaluate(() => window.__engine.camToolpathStatuses())).every(s => s.state === 'current'));
  const panel = page.getByTestId('cam-setups-panel');
  assert.equal(await panel.getByRole('button', { name: 'Open the tool library', exact: true }).count(), 0);
  const plus = panel.getByRole('button', { name: 'New setup', exact: true });
  assert.equal(await plus.locator('svg.lucide-plus').count(), 1);
  const size = await plus.boundingBox();
  assert.ok(size.width >= 28 && size.height >= 28);
  assert.equal(await panel.getByRole('button', { name: /^Tool Library/ }).count(), 1);

  // Editing a later contour creates height/link records and regenerates it,
  // but must not dirty the earlier roughing mesh captured by Rust.
  await row(3).dblclick();
  let dialog = page.getByTestId('cam-operation-dialog');
  await dialog.getByLabel('Operation name', { exact: true }).fill('Profile revised');
  await save(dialog);
  const revised = await document();
  for (const id of [1,2]) {
    assert.deepEqual(revised.toolpath_generations.find(s => s.operation_id === id), initial.toolpath_generations.find(s => s.operation_id === id));
    assert.deepEqual(revised.setups[0].operations.find(o => o.id === id), initial.setups[0].operations.find(o => o.id === id));
  }
  assert.ok((await page.evaluate(() => window.__engine.camToolpathStatuses())).every(s => s.state === 'current'));

  await row(3).click({ button: 'right' });
  await page.getByRole('menu').getByRole('button', { name: 'Duplicate toolpath', exact: true }).click();
  await page.waitForFunction(() => window.__appStore.getState().selectedCamOperationId === 4);
  let cam = await document();
  assert.deepEqual(cam.setups[0].operations.map(o => o.id), [1,2,3,4]);
  assert.equal(cam.setups[0].operations[3].name, 'Profile revised (copy)');
  for (const field of ['height_expressions', 'linking']) {
    assert.deepEqual(cam[field].find(r => r.operation_id === 4), { ...cam[field].find(r => r.operation_id === 3), operation_id: 4 });
  }
  assert.equal(cam.toolpath_generations.some(s => s.operation_id === 4), false);
  assert.deepEqual(cam.toolpath_generations, revised.toolpath_generations);

  await setupRow(1).click({ button: 'right' });
  await page.getByRole('menu').getByRole('button', { name: 'New setup', exact: true }).click();
  await page.getByTestId('cam-setup-dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal((await document()).setups.length, 1);
  await setupRow(1).click({ button: 'right' });
  await page.getByRole('menu').getByRole('button', { name: 'Duplicate setup', exact: true }).click();
  await page.waitForFunction(() => window.__appStore.getState().camDocument.active_setup_id === 2);
  cam = await document();
  assert.deepEqual(cam.setups.map(s => s.id), [1,2]);
  assert.equal(cam.setups[1].name, 'Setup A (copy)');
  assert.deepEqual(cam.setups[1].operations.map(o => o.id), [5,6,7,8]);
  for (const field of ['wcs','wcs_origin','stock','stock_spec','resolved_stock','body_ids','machine','work_offset']) {
    assert.deepEqual(cam.setups[1][field], cam.setups[0][field]);
  }
  assert.deepEqual(cam.toolpath_generations, revised.toolpath_generations);
  const copies = await page.evaluate(() => window.__engine.camToolpathStatuses());
  assert.ok(copies.filter(s => s.setup_id === 2).every(s => s.state === 'never_generated'));

  // General and roughing editors both honor the selected path as the anchor.
  await setupRow(1).click();
  await row(3).click();
  await page.locator('[data-ribbon-button="camFace"]').click();
  dialog = page.getByTestId('cam-operation-dialog');
  assert.deepEqual(await page.evaluate(() => window.__appStore.getState().camDialog.insertion), { setupId: 1, beforeOperationId: 3 });
  await dialog.getByLabel('Operation name', { exact: true }).fill('Inserted face');
  await heights(dialog, 0, -0.3);
  // Model picking/library navigation may change selection after dialog open.
  await page.evaluate(() => window.__appStore.getState().setSelectedCamOperationId(1));
  await save(dialog);
  cam = await document();
  assert.deepEqual(cam.setups[0].operations.map(o => o.id), [1,2,9,3,4]);
  assert.equal(await page.evaluate(() => window.__appStore.getState().selectedCamOperationId), 9);
  await row(3).click();
  await page.locator('[data-ribbon-button="camAdaptive"]').click();
  dialog = page.getByTestId('cam-adaptive-dialog');
  await heights(dialog, 0, -1);
  await save(dialog);
  assert.deepEqual((await document()).setups[0].operations.map(o => o.id), [1,2,9,10,3,4]);

  // Setup selection appends, and a failed generation retry keeps one draft.
  await setupRow(1).click();
  await page.locator('[data-ribbon-button="camFace"]').click();
  dialog = page.getByTestId('cam-operation-dialog');
  await dialog.getByLabel('Operation name', { exact: true }).fill('Appended face');
  await heights(dialog, 0, -0.4);
  await page.evaluate(() => {
    const engine = window.__engine, regenerate = engine.camRegenerateOperation.bind(engine);
    let first = true;
    engine.camRegenerateOperation = id => {
      if (first) { first = false; return Promise.reject(new Error('One-shot test worker failure')); }
      return regenerate(id);
    };
  });
  await dialog.locator('button[type="submit"]').click();
  await page.waitForFunction(() => window.__appStore.getState().constraintDialog?.message.includes('One-shot test worker failure'));
  await page.evaluate(() => window.__appStore.getState().setConstraintDialog(null));
  await save(dialog);
  cam = await document();
  assert.deepEqual(cam.setups[0].operations.map(o => o.id), [1,2,9,10,3,4,11]);
  assert.equal(cam.next_operation_id, 12);
  const exported = JSON.parse(await page.evaluate(() => window.__engine.exportProjectModel()));
  assert.deepEqual(exported.cam, cam);
  for (const id of [1,2]) assert.equal((await page.evaluate(() => window.__engine.camToolpathStatuses())).find(s => s.operation_id === id).state, 'current');
  assert.deepEqual(errors, []);
  await panel.screenshot({ path: '/tmp/nbcad-cam-browser-editing.png' });
  console.log('PASS: later edits preserve earlier geometry/stamps; header +, setup context creation, deep duplicates, fresh IDs, no copied generation, anchored Face/HSR insertion, append, retry and export.');
} finally { await browser.close(); }
