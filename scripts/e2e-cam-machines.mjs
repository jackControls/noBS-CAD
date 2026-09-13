/** Real WASM persistence, machine snapshots and the production NC boundary. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {});
const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
try {
  await page.goto('http://localhost:7199', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__engine && window.__appStore?.getState().document);
  await page.evaluate(async () => {
    const engine = window.__engine;
    const store = window.__appStore.getState();
    store.applySolidUpdate(await engine.newProject());
    await engine.beginSketch({ type: 'origin_plane', plane: 'xy' });
    await engine.addRectangle({ mode: 'two_point', p1: { x: 0, y: 0 }, p2: { x: 4, y: 4 }, ctrl_held: true });
    const ended = await engine.endSketch();
    store.setDocument(ended.document);
    store.setFinishedSketches(await engine.finishedSketches());
    store.setMode('solid');
    const catalog = await engine.profileCatalog();
    store.applySolidUpdate(await engine.extrude({ source_face: null, sketch_name: catalog[0].sketch_name,
      profile_indices: [catalog[0].profiles[0].index], operation: 'new_body',
      extent: { type: 'distance', distance: 3 }, taper_angle_deg: 0, flip: true, target_body_ids: [] }));
    store.setActiveTab('cam');
    store.setCamDialog({ type: 'setup' });
  });
  let dialog = page.getByTestId('cam-setup-dialog');
  await dialog.waitFor();
  assert.equal(await dialog.getByTestId('cam-machine-select').inputValue(), 'generic');
  await dialog.getByTestId('cam-machine-select').selectOption('siemens828d');
  await dialog.getByTestId('cam-machine-name').fill('Shop 828D');
  await dialog.getByRole('checkbox', { name: 'Use this target for new setups on this device' }).check();
  await page.screenshot({ path: '/tmp/nbcad-cam-machine-setup.png' });
  await dialog.locator('button[type="submit"]').click();
  await dialog.waitFor({ state: 'detached' });
  const original = await page.evaluate(async () => (await window.__engine.camDocument()).setups[0].machine);
  assert.equal(original.profile.name, 'Shop 828D');
  assert.equal(original.profile.controller.language, 'siemens_native');
  assert.equal(original.mode, 'fixed3_axis');
  assert.equal(original.profile.post.siemens_828d.preload_next_tool, false);
  assert.equal(original.profile.post.siemens_828d.optional_stop_on_tool_change, false);

  await page.evaluate(() => window.__appStore.getState().setCamDialog({ type: 'setup' }));
  await dialog.waitFor();
  assert.equal(await dialog.getByTestId('cam-machine-name').inputValue(), 'Shop 828D');
  await dialog.getByTestId('cam-machine-select').selectOption('generic');
  await dialog.locator('button[type="submit"]').click();
  await dialog.waitFor({ state: 'detached' });
  await page.evaluate(() => window.__appStore.getState().setCamDialog({ type: 'setup', editId: 2 }));
  await dialog.waitFor();
  assert.equal(await dialog.getByTestId('cam-machine-select').inputValue(), 'generic', 'editing a generic setup must ignore the saved shop default');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.evaluate(() => window.__appStore.getState().setCamDialog({ type: 'post' }));
  const postDialog = page.getByTestId('cam-post-dialog');
  await postDialog.waitFor();
  assert.equal(await postDialog.getByRole('button', { name: 'Check & prepare NC' }).isDisabled(), true);
  assert.match(await postDialog.innerText(), /no machine selected/);
  await postDialog.getByRole('button', { name: 'Cancel', exact: true }).click();

  await page.evaluate(async () => {
    const engine = window.__engine, store = window.__appStore.getState();
    const cam = await engine.camDocument(), setup = cam.setups[0];
    const cutting = { spindle_rpm: 8000, feed_xy: 600, feed_z: 150, coolant: 'flood' };
    cam.tools = [{ id: 1, number: 1, name: 'EM6', kind: 'flat_end_mill', diameter: 6, flute_length: 15,
      overall_length: 50, center_cutting: true, flute_count: 3, point_angle_degrees: null,
      corner_radius: null, cutting, cutting_presets: [], default_step_down: null, default_step_over: null }];
    const top = setup.stock.max.z;
    setup.operations = [{ id: 1, name: 'Face test', kind: 'face', enabled: true, tool_id: 1,
      bounds: { min: { x: setup.stock.min.x, y: setup.stock.min.y }, max: { x: setup.stock.max.x, y: setup.stock.max.y } },
      top_z: top, target_z: top - 0.1, step_over: 3, step_down: 1, safe_distance: 1, direction: 'both_ways',
      clearance_z: top + 8, retract_z: top + 3, feed_height_z: top + 1, cutting }];
    cam.tools.push({ ...cam.tools[0], id: 2, number: 2, name: 'External NC tool' });
    cam.active_setup_id = 1; cam.next_tool_id = 3; cam.next_operation_id = 2;
    await store.setCamDocument(cam);
    await store.setCamDocument(await engine.camRegenerateSetup(1));
    store.setSelectedCamSetupId(1); store.setSelectedCamOperationId(1);
    window.__machineTestGenerations = (await engine.camDocument()).toolpath_generations;
    store.setCamDialog({ type: 'post' });
  });
  await postDialog.waitFor();
  assert.equal(await postDialog.getByLabel('Dialect', { exact: true }).count(), 0);
  assert.equal(await postDialog.getByRole('checkbox', { name: 'M1 between tools' }).isChecked(), false);
  assert.equal(await postDialog.getByTestId('cam-controller-tool-1').count(), 0, 'no separate mapping form');
  assert.match(await postDialog.innerText(), /T1 · EM6/);
  assert.equal(await postDialog.getByLabel('Tool calls', { exact: true }).inputValue(), 'automatic');
  await postDialog.getByTestId('cam-post-confirm').check();
  await postDialog.getByLabel('SUPA retract Z').fill('-1');
  assert.equal(await postDialog.getByTestId('cam-post-confirm').isChecked(), false, 'changing machine settings requires renewed review');
  await postDialog.getByTestId('cam-post-confirm').check();
  await postDialog.getByRole('button', { name: 'Check & prepare NC' }).click();
  await postDialog.getByTestId('cam-post-review').waitFor({ timeout: 60000 });
  assert.match(await postDialog.getByTestId('cam-post-review').innerText(), /Target: Shop 828D/);
  assert.match(await postDialog.getByTestId('cam-post-review').innerText(), /not verified/);
  assert.equal(await postDialog.getByRole('button', { name: 'Save NC…' }).isEnabled(), true);
  const layout = await postDialog.evaluate(form => ({
    bodyBottom: form.querySelector('fieldset').parentElement.getBoundingClientRect().bottom,
    reviewTop: form.querySelector('[data-testid="cam-post-review"]').getBoundingClientRect().top,
    reviewBottom: form.querySelector('[data-testid="cam-post-review"]').getBoundingClientRect().bottom,
    footerTop: form.querySelector('footer').getBoundingClientRect().top,
  }));
  assert.ok(layout.bodyBottom <= layout.reviewTop + 1 && layout.reviewBottom <= layout.footerTop + 1, 'scrolling settings, warnings and save controls must not overlap');
  await page.screenshot({ path: '/tmp/nbcad-cam-machine-post-review.png' });
  const checked = await page.evaluate(async () => {
    const doc = await window.__engine.camDocument();
    return { machine: doc.setups[0].machine, generations: doc.toolpath_generations,
      before: window.__machineTestGenerations, selected: window.__appStore.getState().selectedCamOperationId };
  });
  assert.equal(checked.machine.profile.post.siemens_828d.supa_retract_z, -1);
  assert.equal(checked.machine.profile.revision, original.profile.revision + 1);
  assert.deepEqual(checked.machine.tool_calls, [], 'posting requires no per-tool binding or confirmation');
  assert.equal(checked.selected, 1, 'post settings must not clear the selected path');
  assert.deepEqual(checked.generations, checked.before);
  assert.equal(await page.evaluate(async () => (await import('/src/cam/machines.ts')).readDefaultMachine().profile.post.siemens_828d.supa_retract_z), 0, 'editing a project snapshot must not overwrite the device default');
  assert.deepEqual(await page.evaluate(async () => (await import('/src/cam/machines.ts')).readDefaultMachine().tool_calls), [], 'project tool ids cannot leak into new setups');
  const roundtrip = await page.evaluate(async () => {
    const engine = window.__engine;
    const doc = await engine.camDocument(), setup = doc.setups[0];
    const post = await engine.camPost({ setup_id: 1, post: setup.machine.profile.post, program_name: setup.name });
    const request = { setup_id: 1, voxel_size: 0.5, max_voxels: 100000 };
    const cam = await engine.camSimulate(request);
    const nc = await engine.camSimulateGcode({ ...request, source: post.nc, dialect: 'siemens828d', file_name: 'test.mpf' });
    const saved = JSON.parse(await engine.exportProjectModel());
    return { source: post.nc, remaining: [cam.remaining_voxels, nc.remaining_voxels], saved: JSON.stringify(saved) };
  });
  assert.match(roundtrip.source, /\n(?:N\d+ )?T1\n/);
  assert.equal(roundtrip.remaining[0], roundtrip.remaining[1]);
  assert.ok(roundtrip.saved.includes('EM6'), 'the project library supplies tool identity');

  // A changed snapshot cannot save the previously prepared NC, even when no
  // toolpath itself became stale. This stops before opening any save picker.
  await page.evaluate(async () => {
    const { setCamMachine } = await import('/src/cam/document.ts');
    const { reviseMachine } = await import('/src/cam/machines.ts');
    const doc = await window.__engine.camDocument();
    await setCamMachine(1, reviseMachine(doc.setups[0].machine, 'Changed after review'));
  });
  await postDialog.getByRole('button', { name: 'Save NC…' }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="cam-post-dialog"]')?.textContent.includes('Review and verify NC output again'));
  assert.equal(await postDialog.getByRole('button', { name: 'Check & prepare NC' }).isDisabled(), true);
  await postDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.evaluate(() => window.__appStore.getState().setCamDialog({ type: 'post' }));
  await postDialog.waitFor();
  await postDialog.getByLabel('Tool calls', { exact: true }).selectOption('name');
  await postDialog.getByTestId('cam-post-confirm').check();
  await postDialog.getByRole('button', { name: 'Check & prepare NC' }).click();
  await postDialog.getByTestId('cam-post-review').waitFor({ timeout: 60000 });
  const external = await page.evaluate(async () => {
    const engine = window.__engine, doc = await engine.camDocument();
    const sim = await engine.camSimulateGcode({ setup_id: 1, voxel_size: 0.5, max_voxels: 100000,
      dialect: 'siemens828d', source: 'T2\nM6\nG54 G90 G710\nG0 X0 Y0 Z10\nG1 Z8 F100\nM30', file_name: 'external.mpf' });
    const post = await engine.camPost({ setup_id: 1, post: null, program_name: 'EXACT_NAMES' });
    return { calls: doc.setups[0].machine.tool_calls, tools: sim.steps.map(s => s.tool_id), generations: doc.toolpath_generations, nc: post.nc };
  });
  assert.deepEqual(external.calls, []);
  assert.match(external.nc, /T="EM6"/);
  assert.ok(external.tools.includes(2));
  assert.deepEqual(external.generations, checked.before);
  await postDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.evaluate(async () => {
    const { setCamMachine } = await import('/src/cam/document.ts');
    const { reviseMachine, saveDefaultMachine, readDefaultMachine } = await import('/src/cam/machines.ts');
    const doc = await window.__engine.camDocument(), machine = doc.setups[0].machine;
    const post = structuredClone(machine.profile.post);
    post.siemens_828d.spindle_stop_subprogram = 'SHOP_STOP';
    const updated = reviseMachine(machine, 'Private spindle test', post);
    await setCamMachine(1, updated);
    saveDefaultMachine(updated);
    if (readDefaultMachine()?.profile.post.siemens_828d.spindle_stop_subprogram !== 'SHOP_STOP') throw new Error('Private default lost its subprogram');
    window.__appStore.getState().setCamDialog({ type: 'post' });
  });
  await postDialog.waitFor();
  assert.match(await postDialog.getByTestId('cam-private-spindle-stop').innerText(), /SHOP_STOP/);
  await postDialog.getByTestId('cam-private-spindle-stop').scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/tmp/nbcad-private-post-dialog.png' });
  await postDialog.getByLabel('SUPA retract Z').fill('-2');
  await postDialog.getByTestId('cam-post-confirm').check();
  await postDialog.getByRole('button', { name: 'Check & prepare NC' }).click();
  await postDialog.getByTestId('cam-post-review').waitFor({ timeout: 60000 });
  assert.match(await postDialog.getByTestId('cam-post-review').innerText(), /NC replay is unavailable/);
  const custom = await page.evaluate(async () => {
    const engine = window.__engine, doc = await engine.camDocument();
    const output = await engine.camPost({ setup_id: 1 });
    let replayError = '';
    try { await engine.camSimulateGcode({ setup_id: 1, source: output.nc, dialect: 'siemens828d', voxel_size: 0.5 }); }
    catch (error) { replayError = String(error); }
    const saved = JSON.parse(await engine.exportProjectModel());
    return { nc: output.nc, replayError, machine: saved.cam.setups[0].machine, generations: doc.toolpath_generations };
  });
  assert.equal(custom.machine.profile.schema_version, 2);
  assert.equal(custom.machine.profile.post.siemens_828d.spindle_stop_subprogram, 'SHOP_STOP');
  assert.equal(custom.machine.profile.post.siemens_828d.supa_retract_z, -2);
  assert.match(custom.nc, /SHOP_STOP\n(?:N\d+ )?M5/);
  assert.match(custom.replayError, /cannot be executed by NC simulation/);
  assert.deepEqual(custom.generations, checked.before);
  assert.deepEqual(errors, []);
  console.log('PASS: machine snapshots, direct library tools, NC roundtrip/review, stale-save gate, private subprogram preservation/disclosure/replay refusal, no needless regeneration');
} finally { await browser.close(); }
