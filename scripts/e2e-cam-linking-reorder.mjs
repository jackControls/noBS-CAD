/** Real Rust/WASM generation + pointer/keyboard ordering + persisted linking UI. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {});
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
try {
  await page.goto('http://localhost:7199', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__engine && window.__appStore?.getState().document);
  await page.evaluate(async () => {
    const engine = window.__engine;
    const store = window.__appStore.getState();
    const simulate = engine.camSimulate.bind(engine);
    engine.camSimulate = (request) => simulate({ ...request, voxel_size: 0.5, max_voxels: 20000 });
    store.applySolidUpdate(await engine.newProject());
    await engine.beginSketch({ type: 'origin_plane', plane: 'xy' });
    await engine.addRectangle({
      mode: 'two_point',
      p1: { x: 6, y: 5 },
      p2: { x: 10, y: 9 },
      ctrl_held: true,
    });
    const ended = await engine.endSketch();
    store.setDocument(ended.document);
    store.setFinishedSketches(await engine.finishedSketches());
    store.setMode('solid');
    const catalog = await engine.profileCatalog();
    const update = await engine.extrude({
      source_face: null,
      sketch_name: catalog[0].sketch_name,
      profile_indices: [catalog[0].profiles[0].index],
      operation: 'new_body',
      extent: { type: 'distance', distance: 3 },
      taper_angle_deg: 0,
      flip: true,
      target_body_ids: [],
    });
    store.applySolidUpdate(update);
    const cam = await engine.camDocument();
    const cutting = { spindle_rpm: 8000, feed_xy: 600, feed_z: 100, coolant: 'flood' };
    cam.tools = [
      {
        id: 1,
        number: 1,
        name: 'EM4',
        kind: 'flat_end_mill',
        diameter: 4,
        flute_length: 10,
        overall_length: 30,
        center_cutting: true,
        flute_count: 3,
        point_angle_degrees: null,
        corner_radius: null,
        cutting,
        cutting_presets: [],
        default_step_down: null,
        default_step_over: null,
      },
    ];
    const base = { enabled: true, clearance_z: 5, retract_z: 3, feed_height_z: 1, cutting, tool_id: 1 };
    const operations = [
      {
        ...base,
        id: 1,
        name: 'Face test',
        kind: 'face',
        bounds: { min: { x: 0, y: 0 }, max: { x: 16, y: 14 } },
        top_z: 0,
        target_z: -0.2,
        step_over: 3,
        step_down: 1,
        safe_distance: 1,
        direction: 'both_ways',
      },
      {
        ...base,
        id: 2,
        name: 'Contour test',
        kind: 'contour2d',
        path: [
          { x: 6, y: 5 },
          { x: 10, y: 5 },
          { x: 10, y: 9 },
          { x: 6, y: 9 },
        ],
        closed: true,
        top_z: 0,
        bottom_z: -1,
        step_down: 1,
        compensation: 'outside',
        compensation_mode: 'in_control',
        lead_in: 0.4,
        lead_out: 0.4,
        lead_arc_radius: 0.4,
        direction: 'climb',
        roughing_passes: 1,
        roughing_step_over: null,
        finishing_pass: false,
        finish_allowance: 0,
        finish_feed: null,
        spring_pass: false,
        chain_ref: null,
      },
      {
        ...base,
        id: 3,
        name: 'Roughing test',
        kind: 'adaptive3d',
        top_z: 0,
        bottom_z: -1,
        parameters: {
          optimal_load: 0.8,
          maximum_stepdown: 1,
          minimum_cutting_radius: 0.8,
          radial_stock_to_leave: 0.1,
          axial_stock_to_leave: 0.1,
          tolerance: 0.2,
          ramp_angle_degrees: 3,
          maximum_ramp_stepdown: 0.5,
          ramp_feed: 100,
          linking_feed: 600,
          stay_down_distance: 20,
          machine_cavities: true,
        },
        geometry: { targets: update.scene.bodies.map((b) => b.mesh), stock: null },
      },
    ];
    const setup = {
      id: 1,
      name: 'Setup A',
      wcs: { origin: { x: 0, y: 0, z: 0 }, x_axis: [1, 0, 0], y_axis: [0, 1, 0], z_axis: [0, 0, 1] },
      wcs_origin: { mode: 'explicit' },
      work_offset: 'g54',
      work_offset_count: 1,
      stock_spec: { mode: 'legacy_box' },
      resolved_stock: { shape: 'box' },
      stock: { min: { x: 0, y: 0, z: -3 }, max: { x: 16, y: 14, z: 0 } },
      stock_model_box: null,
      body_ids: update.scene.bodies.map((b) => b.id),
      operations,
    };
    cam.setups = [setup, { ...structuredClone(setup), id: 2, name: 'Setup B', operations: [] }];
    cam.active_setup_id = 1;
    cam.next_setup_id = 3;
    cam.next_tool_id = 2;
    cam.next_operation_id = 4;
    await store.setCamDocument(cam);
    await store.setCamDocument(await engine.camRegenerateSetup(1));
    store.setSelectedCamSetupId(1);
    store.setSelectedCamOperationId(null);
    store.setActiveTab('cam');
  });
  const open = async (kind, id) => {
    await page.evaluate(
      ({ kind, id }) => window.__appStore.getState().setCamDialog({ type: 'operation', kind, editId: id }),
      { kind, id },
    );
    const dialog = page.getByTestId(kind === 'adaptive3d' ? 'cam-adaptive-dialog' : 'cam-operation-dialog');
    await dialog.waitFor();
    await dialog.getByRole('button', { name: 'Linking', exact: true }).click();
    return dialog;
  };
  const save = async (dialog) => {
    await dialog.locator('button[type="submit"]').click();
    try {
      await dialog.waitFor({ state: 'detached', timeout: 30000 });
    } catch (error) {
      throw new Error(`${error}\n${await dialog.innerText()}`);
    }
  };
  let dialog = await open('face', 1);
  await dialog.getByLabel('Vertical lead-in radius').fill('0.5');
  await dialog.getByLabel('Same as lead-in', { exact: true }).uncheck();
  await dialog.getByLabel('Vertical lead-out radius').fill('0.7');
  await dialog.getByLabel('Transition type').selectOption('smooth');
  await dialog.getByLabel('Allow rapid retract', { exact: true }).uncheck();
  await save(dialog);
  dialog = await open('face', 1);
  assert.equal(await dialog.getByLabel('Vertical lead-out radius').inputValue(), '0.7');
  assert.equal(await dialog.getByLabel('Allow rapid retract', { exact: true }).isChecked(), false);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  dialog = await open('contour2d', 2);
  await dialog.getByLabel('Horizontal lead-in radius').fill('0.3');
  await dialog.getByLabel('Lead-in sweep angle').fill('60');
  await dialog.getByLabel('Vertical lead-in radius').fill('0.2');
  await dialog.getByLabel('Same as lead-in', { exact: true }).uncheck();
  await dialog.getByLabel('Horizontal lead-out radius').fill('0.5');
  await dialog.getByLabel('Lead-out sweep angle').fill('120');
  await dialog.getByLabel('Vertical lead-out radius').fill('0.3');
  await page.screenshot({ path: '/tmp/nbcad-cam-contour-linking.png' });
  await save(dialog);
  dialog = await open('adaptive3d', 3);
  await dialog.getByLabel('Horizontal lead-in radius').fill('0.4');
  await dialog.getByLabel('Vertical lead-in radius').fill('0.3');
  await dialog.getByLabel('Keep tool down', { exact: true }).check();
  await dialog.getByLabel('Stay-down search level').selectOption('70');
  await dialog.getByLabel('Minimum stay-down clearance').fill('0.05');
  await dialog.getByLabel('Retraction policy').selectOption('shortest');
  await page.screenshot({ path: '/tmp/nbcad-cam-roughing-linking.png' });
  await save(dialog);
  const records = await page.evaluate(async () => (await window.__engine.camDocument()).linking);
  assert.equal(records.length, 3);
  assert.equal(records.find((r) => r.operation_id === 3).stay_down_level, 70);
  assert.equal(records.find((r) => r.operation_id === 2).lead_out.sweep_degrees, 120);

  const row = (id) => page.locator(`[data-cam-sort-scope="operations-1"][data-cam-sort-id="${id}"]`);
  // An independent drill can move after both milling paths without making
  // either one (or the moved drill) require regeneration.
  await page.evaluate(async () => {
    const engine = window.__engine, store = window.__appStore.getState();
    const cam = await engine.camDocument();
    cam.tools.push({ ...cam.tools[0], id: 2, number: 2, name: 'Drill 2', kind: 'drill', diameter: 2, point_angle_degrees: 118 });
    cam.setups[0].operations.splice(1, 0, {
      id: 4, name: 'Independent drill', kind: 'drill', enabled: true, tool_id: 2,
      points: [{ x: 2, y: 2 }], holes: [], top_z: 0, bottom_z: -1, cycle: 'drill',
      clearance_z: 5, retract_z: 3, feed_height_z: 1, cutting: cam.tools[0].cutting,
    });
    cam.next_operation_id = 5; cam.next_tool_id = 3;
    await store.setCamDocument(cam);
    await store.setCamDocument(await engine.camRegenerateSetup(1));
    window.__beforeReorderGenerations = (await engine.camDocument()).toolpath_generations;
  });
  await row(4).focus();
  await page.keyboard.press('Alt+ArrowDown');
  await page.waitForFunction(() => window.__appStore.getState().camDocument.setups[0].operations[2].id === 4);
  await page.keyboard.press('Alt+ArrowDown');
  await page.waitForFunction(() => window.__appStore.getState().camDocument.setups[0].operations[3].id === 4);
  const independent = await page.evaluate(async () => ({
    statuses: await window.__engine.camToolpathStatuses(),
    stamps: (await window.__engine.camDocument()).toolpath_generations,
    before: window.__beforeReorderGenerations,
  }));
  assert.ok(independent.statuses.every(s => s.state === 'current'), JSON.stringify(independent.statuses));
  assert.deepEqual(independent.stamps, independent.before, 'independent order edits must preserve generation stamps');

  // Real pointer drag: preview reorders while persistence waits for drop.
  await row(2).click();
  const source = await row(3).boundingBox(),
    target = await row(1).boundingBox();
  await page.mouse.move(source.x + 70, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + 70, target.y + 2, { steps: 12 });
  assert.deepEqual(
    await page.evaluate(() => window.__appStore.getState().camDocument.setups[0].operations.map((o) => o.id)),
    [1, 2, 3, 4],
  );
  await page.screenshot({ path: '/tmp/nbcad-cam-reordering.png' });
  await page.mouse.up();
  await page.waitForFunction(() => window.__appStore.getState().camDocument.setups[0].operations[0].id === 3);
  assert.equal(
    await page.evaluate(() => window.__appStore.getState().selectedCamOperationId),
    2,
    'drag must not steal selection',
  );
  const statuses = await page.evaluate(() => window.__engine.camToolpathStatuses());
  assert.equal(statuses.find(s => s.operation_id === 3).state, 'stale', 'roughing lost its earlier facing evidence');
  assert.ok(statuses.filter(s => s.operation_id !== 3).every(s => s.state === 'current'), 'unaffected paths retain generation');
  await row(3).focus();
  await page.keyboard.press('Alt+ArrowDown');
  await page.waitForFunction(() => window.__appStore.getState().camDocument.setups[0].operations[0].id === 1);
  const original = await page.evaluate(() =>
    window.__appStore.getState().camDocument.setups[0].operations.map((o) => o.id),
  );
  const b1 = await row(2).boundingBox(),
    b2 = await row(1).boundingBox();
  await page.mouse.move(b1.x + 70, b1.y + 10);
  await page.mouse.down();
  await page.mouse.move(b2.x + 70, b2.y + 1, { steps: 8 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  assert.deepEqual(
    await page.evaluate(() => window.__appStore.getState().camDocument.setups[0].operations.map((o) => o.id)),
    original,
  );
  const setup = (id) => page.locator(`[data-cam-sort-scope="setups"][data-cam-sort-id="${id}"]`);
  const sb = await setup(2).boundingBox(),
    sa = await setup(1).boundingBox();
  await page.mouse.move(sb.x + 60, sb.y + 10);
  await page.mouse.down();
  await page.mouse.move(sa.x + 60, sa.y + 1, { steps: 12 });
  await page.mouse.up();
  await page.waitForFunction(() => window.__appStore.getState().camDocument.setups[0].id === 2);
  assert.equal(await page.evaluate(() => window.__appStore.getState().camDocument.active_setup_id), 1);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: Face/Contour/HSR linking saves, independent drill moves last with no regeneration, dependent roughing stales, pointer/keyboard/cancel reorder, selection preserved',
  );
} finally {
  await browser.close();
}
