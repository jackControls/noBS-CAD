/** A bad later operation must not blank earlier paths or remaining stock. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';

const browser = await chromium.launch(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
try {
  await page.goto('http://localhost:7199', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__engine && window.__appStore?.getState().document);
  await page.evaluate(async () => {
    const engine = window.__engine, store = window.__appStore.getState();
    const simulate = engine.camSimulate.bind(engine), plan = engine.camPlan.bind(engine);
    window.__previewPlans = [];
    engine.camSimulate = request => simulate({ ...request, voxel_size: 0.5, max_voxels: 100000 });
    engine.camPlan = (id, through) => { window.__previewPlans.push({ id, through }); return plan(id, through); };
    store.applySolidUpdate(await engine.newProject());
    await engine.beginSketch({ type: 'origin_plane', plane: 'xy' });
    await engine.addRectangle({ mode: 'two_point', p1: { x: 0, y: 0 }, p2: { x: 20, y: 16 }, ctrl_held: true });
    const ended = await engine.endSketch();
    store.setDocument(ended.document); store.setFinishedSketches(await engine.finishedSketches()); store.setMode('solid');
    const catalog = await engine.profileCatalog();
    const solid = await engine.extrude({ source_face: null, sketch_name: catalog[0].sketch_name,
      profile_indices: [catalog[0].profiles[0].index], operation: 'new_body',
      extent: { type: 'distance', distance: 6 }, taper_angle_deg: 0, flip: true, target_body_ids: [] });
    store.applySolidUpdate(solid);
    const cam = await engine.camDocument();
    const cutting = { spindle_rpm: 1000, feed_xy: 500, feed_z: 150, coolant: 'flood' };
    const tool = { id: 1, number: 1, name: 'Rounded face mill', kind: 'face_mill', diameter: 63,
      flute_length: 5, overall_length: 60, center_cutting: false, flute_count: 4,
      corner_radius: 0.5, point_angle_degrees: null, cutting, cutting_presets: [] };
    cam.tools = [tool, { ...tool, id: 2, number: 2, name: 'Drill', kind: 'drill', diameter: 4,
      flute_length: 10, corner_radius: null, point_angle_degrees: 118, center_cutting: true }];
    const base = { enabled: true, cutting, clearance_z: 6, retract_z: 2, feed_height_z: 1 };
    const drill = { ...base, id: 2, tool_id: 2, name: 'Good drill', kind: 'drill',
      points: [{ x: 6, y: 8 }, { x: 14, y: 8 }], holes: [], top_z: -0.5, bottom_z: -4,
      cycle: 'drill', peck_depth: null, peck_retract: null, thread_pitch: null, feed_out: null, dwell_seconds: 0 };
    cam.setups = [{ id: 1, name: 'Preview regression', wcs: { origin: { x: 0, y: 0, z: 0 },
      x_axis: [1, 0, 0], y_axis: [0, 1, 0], z_axis: [0, 0, 1] }, wcs_origin: { mode: 'explicit' },
      work_offset: 'g54', work_offset_count: 1, stock_spec: { mode: 'legacy_box' }, resolved_stock: { shape: 'box' },
      stock: { min: { x: 0, y: 0, z: -6 }, max: { x: 20, y: 16, z: 0 } }, stock_model_box: null,
      body_ids: solid.scene.bodies.map(body => body.id), operations: [
        { ...base, id: 1, tool_id: 1, name: 'Good face', kind: 'face', top_z: 0, target_z: -0.5,
          bounds: { min: { x: 0, y: 0 }, max: { x: 20, y: 16 } }, step_over: 20, step_down: 1,
          safe_distance: 4, direction: 'both_ways' }, drill,
        { ...drill, id: 3, name: 'Invalid later drill', top_z: -1, feed_height_z: -0.75 },
      ] }];
    cam.active_setup_id = 1; cam.next_setup_id = 2; cam.next_operation_id = 4; cam.next_tool_id = 3;
    await store.setCamDocument(cam);
    store.setSelectedCamSetupId(1); store.setSelectedCamOperationId(null); store.setActiveTab('cam');
  });
  await page.getByTestId('cam-planning-error').waitFor();
  await page.waitForFunction(() => window.__appStore.getState().camSimulation?.completed_steps === 0);
  const row = id => page.locator(`[data-cam-sort-scope="operations-1"][data-cam-sort-id="${id}"]`);
  const stage = async id => {
    await row(id).click();
    await page.waitForFunction(id => {
      const s = window.__appStore.getState();
      return s.camSimulation?.through_operation_id === id
        && s.camProgram?.per_operation.some(op => op.operation_id === id);
    }, id);
    assert.equal(await page.getByTestId('cam-planning-error').count(), 0);
    assert.equal(await page.getByTestId('cam-simulation-error').count(), 0);
    const visible = await page.evaluate(async () => {
      const { collectCamOverlay } = await import('/src/cam/overlay.ts');
      const layers = collectCamOverlay({ ...window.__appStore.getState(), camDialogOpen: false, renderPlaybackTool: false });
      return { stock: layers.triangles.some(l => l.material === 'machined_stock' && l.positions.length > 0),
        path: layers.lines.some(l => l.pattern === 'dotted' && l.segments.length > 0) };
    });
    assert.deepEqual(visible, { stock: true, path: true });
  };
  await stage(1); await stage(2);
  await page.evaluate(() => window.__cameraApi.fit());
  await page.screenshot({ path: '/tmp/nbcad-cam-valid-prefix.png' });
  const drilled = await page.evaluate(() => window.__appStore.getState().camSimulation.remaining_voxels);
  await row(3).click();
  await page.getByTestId('cam-planning-error').waitFor();
  await page.waitForFunction(() => window.__appStore.getState().camSimulation === null);
  assert.match(await page.getByTestId('cam-planning-error').innerText(), /Invalid later drill.*incoming stock/);
  assert.equal(await page.getByTestId('cam-simulation-error').count(), 0, 'show the shared error only once');
  await stage(2);
  assert.equal(await page.evaluate(() => window.__appStore.getState().camSimulation.remaining_voxels), drilled);
  assert.equal(await page.evaluate(() => window.__previewPlans.filter(p => p.through == null).length), 1,
    'row clicks reuse the full-plan result, even when it failed');

  // Fix only the isolated test job, then confirm healthy selections never
  // cause another full plan and setup selection still displays incoming stock.
  await page.evaluate(async () => {
    const store = window.__appStore.getState(), cam = structuredClone(store.camDocument);
    cam.setups[0].operations[2].feed_height_z = 1;
    await store.setCamDocument(cam);
  });
  await page.waitForFunction(() => window.__appStore.getState().camProgram?.stats.operation_count === 3);
  const calls = await page.evaluate(() => window.__previewPlans.length);
  await stage(1); await stage(2); await stage(3);
  assert.equal(await page.evaluate(() => window.__previewPlans.length), calls);
  await page.getByRole('button', { name: /^Preview regression/ }).first().click();
  await page.waitForFunction(() => window.__appStore.getState().camSimulation?.completed_steps === 0);

  if (process.env.CAM_REFERENCE) {
    const model = strFromU8(unzipSync(readFileSync(process.env.CAM_REFERENCE))['model.json']);
    const reference = await page.evaluate(async model => {
      const engine = window.__engine, store = window.__appStore.getState();
      store.applySolidUpdate(await engine.loadProjectModel(model));
      const cam = await engine.camDocument(), setup = cam.setups[0];
      const rough = setup.operations.find(op => op.kind === 'adaptive3d');
      // Reproduce the open window's 14 - 1.7 = 12.3 mm false engagement error.
      // This modifies only the isolated in-memory copy, never the saved file.
      rough.top_z = 13.7;
      await store.setCamDocument(cam);
      store.setSelectedCamSetupId(setup.id); store.setSelectedCamOperationId(null); store.setActiveTab('cam');
      const plan = await engine.camPlan(setup.id);
      const states = [];
      for (const op of setup.operations) {
        const result = await engine.camSimulate({ setup_id: setup.id, through_operation_id: op.id });
        states.push({ id: op.id, remaining: result.remaining_voxels, triangles: result.stock_mesh.positions.length / 9 });
      }
      return { commands: plan.commands.length, states };
    }, model);
    assert.ok(reference.commands > 0);
    assert.ok(reference.states.every(s => s.triangles > 0));
    assert.ok(reference.states.every((s, i, a) => i === 0 || s.remaining < a[i-1].remaining));
    console.log('Read-only supplied project:', JSON.stringify(reference));
  }
  assert.deepEqual(errors, []);
  console.log('PASS: rounded facing coverage, earlier paths/stock survive a later error, error deduplication, selection planning reuse and incoming-stock view.');
} finally { await browser.close(); }
