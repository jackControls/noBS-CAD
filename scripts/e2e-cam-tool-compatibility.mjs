/** Library edits remain editable, invalid consumers are visible and cannot run. */
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
    const simulate = engine.camSimulate.bind(engine);
    engine.camSimulate = request => simulate({ ...request, voxel_size: 0.5, max_voxels: 100000 });
    store.applySolidUpdate(await engine.newProject());
    const cam = await engine.camDocument();
    const cutting = { spindle_rpm: 6000, feed_xy: 600, feed_z: 100, coolant: 'flood' };
    const tool = { id: 1, number: 1, name: 'Face mill', kind: 'face_mill', diameter: 30,
      flute_length: 10, overall_length: 40, center_cutting: true, flute_count: 4,
      corner_radius: null, corner_chamfer: null, point_angle_degrees: null, cutting, cutting_presets: [] };
    cam.tools = [tool, { ...tool, id: 2, number: 2, name: 'Contour mill', kind: 'flat_end_mill', diameter: 6 }];
    const base = { enabled: true, cutting, clearance_z: 6, retract_z: 2, feed_height_z: 1 };
    cam.setups = [{ id: 1, name: 'Tool compatibility', wcs: { origin: { x: 0, y: 0, z: 0 },
      x_axis: [1, 0, 0], y_axis: [0, 1, 0], z_axis: [0, 0, 1] }, wcs_origin: { mode: 'explicit' },
      work_offset: 'g54', work_offset_count: 1, stock_spec: { mode: 'legacy_box' }, resolved_stock: { shape: 'box' },
      stock: { min: { x: 0, y: 0, z: -6 }, max: { x: 20, y: 16, z: 0 } }, stock_model_box: null,
      body_ids: [], operations: [
        { ...base, id: 1, tool_id: 1, name: 'Independent face', kind: 'face', top_z: 0, target_z: -0.5,
          bounds: { min: { x: 0, y: 0 }, max: { x: 20, y: 16 } }, step_over: 20, step_down: 1,
          safe_distance: 4, direction: 'both_ways' },
        { ...base, id: 2, tool_id: 2, name: 'Dependent contour', kind: 'contour2d', top_z: -0.5, bottom_z: -2,
          path: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 16 }, { x: 0, y: 16 }],
          closed: true, compensation: 'outside', compensation_mode: 'in_software', lead_in: 1, lead_out: 1,
          lead_arc_radius: 0.5, direction: 'climb', step_down: 1 },
      ] }];
    cam.active_setup_id = 1; cam.next_setup_id = 2; cam.next_operation_id = 3; cam.next_tool_id = 3;
    await store.setCamDocument(cam);
    const { regenerateCamSetup } = await import('/src/cam/document.ts');
    await regenerateCamSetup(1);
    store.setSelectedCamSetupId(1); store.setSelectedCamOperationId(2); store.setActiveTab('cam');
  });
  const row = id => page.locator(`[data-cam-sort-scope="operations-1"][data-cam-sort-id="${id}"]`);
  await page.waitForFunction(() => window.__appStore.getState().camSimulation?.through_operation_id === 2);
  assert.equal(await row(2).getAttribute('data-cam-toolpath-state'), 'current');

  // Exercise the actual library editor, not just the document API.
  await page.evaluate(() => window.__appStore.getState().setCamDialog({ type: 'tool', toolId: 2 }));
  const library = page.getByTestId('cam-tool-dialog');
  await library.getByLabel('Kind').selectOption('drill');
  await library.getByRole('button', { name: 'Cutter', exact: true }).click();
  await library.getByLabel('Point angle (included)').fill('118');
  await library.getByRole('button', { name: 'Save tool', exact: true }).click();
  await library.getByRole('button', { name: 'Save tool', exact: true }).waitFor({ state: 'detached' });
  await page.evaluate(() => window.__appStore.getState().setCamDialog(null));
  await page.waitForFunction(() => document.querySelector('[data-cam-sort-id="2"][data-cam-toolpath-state="invalid"]'));
  assert.match(await row(2).innerText(), /Invalid/);
  assert.match(await row(2).getAttribute('title'), /Correct the tool or operation/);
  assert.equal(await row(1).getAttribute('data-cam-toolpath-state'), 'current');
  await page.getByTestId('cam-planning-error').waitFor();
  await row(1).click();
  await page.waitForFunction(() => window.__appStore.getState().camSimulation?.through_operation_id === 1);
  await row(2).dblclick();
  const operation = page.getByTestId('cam-operation-dialog');
  await operation.waitFor();
  assert.match(await operation.innerText(), /assigned tool is incompatible/);
  assert.match(await operation.innerText(), /Contour mill/);
  await operation.getByRole('button', { name: 'Cancel', exact: true }).click();
  const repaired = await page.evaluate(async () => {
    const { updateCamTool, regenerateCamOperation, camToolCompatible } = await import('/src/cam/document.ts');
    await updateCamTool(2, tool => { tool.kind = 'bull_nose_end_mill'; tool.corner_radius = 0.5; tool.point_angle_degrees = null; });
    const before = await window.__engine.camToolpathStatuses();
    await regenerateCamOperation(2);
    const after = await window.__engine.camToolpathStatuses();
    const tool = (await window.__engine.camDocument()).tools[1];
    const kinds = ['adaptive3d', 'contour2d', 'pocket2d'];
    return { before: before[1].state, after: after[1].state,
      supports: kinds.map(kind => [camToolCompatible(kind, tool),
        camToolCompatible(kind, { ...tool, kind: 'flat_end_mill', corner_radius: null, corner_chamfer: { width: 0.5, angle_degrees: 45 } }),
        camToolCompatible(kind, { ...tool, kind: 'chamfer_mill', corner_radius: null, point_angle_degrees: 90 }),
        camToolCompatible(kind, { ...tool, kind: 'drill', corner_radius: null, point_angle_degrees: 118 })]) };
  });
  assert.equal(repaired.before, 'stale'); assert.equal(repaired.after, 'current');
  assert.deepEqual(repaired.supports, Array.from({ length: 3 }, () => [true, true, false, false]));

  if (process.env.CAM_REFERENCE) {
    const model = strFromU8(unzipSync(readFileSync(process.env.CAM_REFERENCE))['model.json']);
    const result = await page.evaluate(async model => {
      const engine = window.__engine, store = window.__appStore.getState();
      store.applySolidUpdate(await engine.loadProjectModel(model));
      const cam = await engine.camDocument(), setup = cam.setups[0];
      const rough = setup.operations.find(op => op.kind === 'adaptive3d');
      const tool = cam.tools.find(t => t.id === rough.tool_id);
      const rows = [];
      for (const bevel of [false, true]) {
        tool.kind = bevel ? 'flat_end_mill' : 'bull_nose_end_mill';
        tool.corner_radius = bevel ? null : 1;
        tool.corner_chamfer = bevel ? { width: 1, angle_degrees: 45 } : null;
        await store.setCamDocument(cam);
        const start = performance.now();
        await engine.camRegenerateOperation(rough.id);
        const elapsed = performance.now() - start;
        const plan = await engine.camPlan(setup.id, rough.id);
        const sim = await engine.camSimulate({ setup_id: setup.id, through_operation_id: rough.id });
        rows.push({ bevel, milliseconds: elapsed, commands: plan.commands.length,
          remaining: sim.remaining_voxels, triangles: sim.stock_mesh.positions.length / 9,
          collisions: sim.collisions.length });
      }
      return rows;
    }, model);
    assert.ok(result.every(r => r.milliseconds < 5000 && r.commands > 0 && r.triangles > 0 && r.collisions === 0));
    console.log('Read-only supplied project corner-tool regeneration:', JSON.stringify(result));
  }
  assert.deepEqual(errors, []);
  console.log('PASS: actual library edit, Invalid badge/repair guidance, earlier stock visibility, explicit repair/regeneration, and matching milling pickers.');
} finally { await browser.close(); }
