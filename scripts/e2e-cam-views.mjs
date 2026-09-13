/** Workpiece presentation is independent of the planner and stock caches. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
try {
  await page.goto('http://localhost:7199', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__engine && window.__appStore?.getState().document);
  await page.evaluate(async () => {
    const engine = window.__engine, store = window.__appStore.getState();
    const plan = engine.camPlan.bind(engine), simulate = engine.camSimulate.bind(engine);
    window.__viewCalls = { plan: 0, simulate: 0 };
    engine.camPlan = (...args) => { window.__viewCalls.plan++; return plan(...args); };
    engine.camSimulate = request => {
      window.__viewCalls.simulate++;
      return simulate({ ...request, voxel_size: 0.5, max_voxels: 100000 });
    };
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
    cam.tools = [{ id: 1, number: 1, name: 'Drill', kind: 'drill', diameter: 4,
      flute_length: 10, overall_length: 50, center_cutting: true, flute_count: 2,
      point_angle_degrees: 118, corner_radius: null, cutting, cutting_presets: [] }];
    cam.setups = [{ id: 1, name: 'View test', wcs: { origin: { x: 0, y: 0, z: 0 },
      x_axis: [1, 0, 0], y_axis: [0, 1, 0], z_axis: [0, 0, 1] }, wcs_origin: { mode: 'explicit' },
      work_offset: 'g54', work_offset_count: 1, stock_spec: { mode: 'legacy_box' }, resolved_stock: { shape: 'box' },
      stock: { min: { x: 0, y: 0, z: -6 }, max: { x: 20, y: 16, z: 0 } }, stock_model_box: null,
      body_ids: solid.scene.bodies.map(body => body.id), operations: [{
        id: 1, name: 'Drill view', tool_id: 1, kind: 'drill', enabled: true, cutting,
        clearance_z: 6, retract_z: 2, feed_height_z: 1,
        points: [{ x: 6, y: 8 }, { x: 14, y: 8 }], holes: [], top_z: 0, bottom_z: -4,
        cycle: 'drill', peck_depth: null, peck_retract: null, thread_pitch: null, feed_out: null, dwell_seconds: 0,
      }] }];
    cam.active_setup_id = 1; cam.next_setup_id = 2; cam.next_operation_id = 2; cam.next_tool_id = 2;
    await store.setCamDocument(cam);
    store.setSelectedCamSetupId(1); store.setSelectedCamOperationId(1); store.setActiveTab('cam');
  });
  await page.waitForFunction(() => window.__appStore.getState().camSimulation?.through_operation_id === 1);
  await page.evaluate(() => {
    const s = window.__appStore.getState();
    window.__viewBefore = { cam: s.camDocument, program: s.camProgram, simulation: s.camSimulation,
      calls: { ...window.__viewCalls } };
    window.__cameraApi.fit();
  });
  const inspect = () => page.evaluate(async () => {
    const s = window.__appStore.getState();
    const { collectCamOverlay } = await import('/src/cam/overlay.ts');
    const { collectNativeViewportPresentation } = await import('/src/components/viewport/nativeViewportBridge.ts');
    const native = collectNativeViewportPresentation();
    const layers = collectCamOverlay({ ...s, camDialogOpen: s.camDialog !== null, renderPlaybackTool: false });
    return { mode: s.camWorkpieceView, paths: s.camToolpathsVisible, hidden: native.hiddenBodyIds,
      ghosted: native.ghostedBodyIds, tool: native.camTool, progress: native.camPathProgress,
      stock: layers.triangles.some(l => l.material === 'machined_stock'),
      path: layers.lines.some(l => l.pattern === 'dotted'),
      cacheIntact: s.camDocument === window.__viewBefore.cam && s.camProgram === window.__viewBefore.program
        && s.camSimulation === window.__viewBefore.simulation,
      noCompute: JSON.stringify(window.__viewCalls) === JSON.stringify(window.__viewBefore.calls),
      targetIds: s.camDocument.setups[0].body_ids };
  });
  const stock = await inspect();
  assert.equal(stock.stock, true); assert.deepEqual(stock.hidden, stock.targetIds);
  assert.equal(stock.path, true);
  await page.getByTestId('cam-view-model').click();
  await page.getByTestId('cam-toolpaths-toggle').click();
  let result = await inspect();
  assert.deepEqual(result.hidden, []); assert.deepEqual(result.ghosted, []);
  assert.equal(result.stock, false); assert.equal(result.path, false); assert.equal(result.tool, null);
  assert.equal(result.cacheIntact, true); assert.equal(result.noCompute, true);
  await page.screenshot({ path: '/tmp/nbcad-cam-model-view.png' });
  for (const tab of ['Simulate', 'Output', 'Program']) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    assert.equal(await page.getByTestId('cam-view-model').getAttribute('aria-pressed'), 'true');
  }
  await page.getByTestId('cam-view-compare').click();
  result = await inspect();
  assert.equal(result.stock, true); assert.deepEqual(result.hidden, []); assert.deepEqual(result.ghosted, result.targetIds);
  assert.equal(result.path, false); assert.equal(result.cacheIntact, true); assert.equal(result.noCompute, true);
  await page.getByTestId('cam-toolpaths-toggle').click();
  for (const mode of ['stock', 'model', 'compare', 'stock']) await page.getByTestId(`cam-view-${mode}`).click();
  result = await inspect();
  assert.equal(result.stock, true); assert.equal(result.path, true); assert.ok(result.tool);
  assert.deepEqual(result.hidden, result.targetIds); assert.deepEqual(result.ghosted, []);
  assert.equal(result.cacheIntact, true); assert.equal(result.noCompute, true);
  await page.screenshot({ path: '/tmp/nbcad-cam-stock-view.png' });

  // Test retained native buffers, empty stock, stale/source mismatch and raw
  // modeled-body stock independently from browser mesh output.
  await page.evaluate(async () => {
    const { camWorkpiecePresentation } = await import('/src/cam/view.ts');
    const s = window.__appStore.getState();
    const state = { ...s, camDialogOpen: false };
    const check = (condition, message) => { if (!condition) throw Error(message); };
    const frame = { ...s.camSimulation, stock_mesh: null, native_stock_present: true };
    check(camWorkpiecePresentation({ ...state, camSimulation: frame }).stockVisible, 'retained native frame');
    check(!camWorkpiecePresentation({ ...state, camSimulation: frame, camWorkpieceView: 'model' }).stockVisible, 'model hides retained buffer');
    check(camWorkpiecePresentation({ ...state, camSimulation: { ...frame, remaining_voxels: 0 } }).stockVisible, 'empty stock must not resurrect CAD');
    check(!camWorkpiecePresentation({ ...state, selectedCamOperationId: 100 }).stockVisible, 'selection freshness');
    check(!camWorkpiecePresentation({ ...state, camSimulationTimeline: { ...frame, source: 'g_code' } }).stockVisible, 'source freshness');
    check(!camWorkpiecePresentation({ ...state, activeTab: 'solid' }).hiddenBodyIds.length, 'outside CAM');
    check(!camWorkpiecePresentation({ ...state, camDialogOpen: true }).hiddenBodyIds.length, 'editing unhides target');
    const cam = structuredClone(s.camDocument);
    cam.setups[0].stock_spec = { mode: 'model_body', body_id: 999 };
    cam.setups[0].resolved_stock = { shape: 'model_body', body_id: 999 };
    const modeled = camWorkpiecePresentation({ ...state, camDocument: cam, camSimulation: null, camWorkpieceView: 'model' });
    check(modeled.hiddenBodyIds.includes(999), 'hide raw stock even without a frame');
    // View changes during playback retain clock, timeline and stock identity.
    s.setCamSimulationTimeline(frame);
    s.setCamSimulationPlayback({ time_seconds: 1, playing: false, speed: 1 });
    const before = window.__appStore.getState();
    before.setCamWorkpieceView('model');
    const after = window.__appStore.getState();
    check(before.camSimulation === after.camSimulation && before.camSimulationTimeline === after.camSimulationTimeline
      && before.camSimulationPlayback === after.camSimulationPlayback, 'playback data must survive view switch');
  });
  await page.locator('[data-cam-sort-scope="setups"][data-cam-sort-id="1"] button[aria-pressed]').click();
  assert.equal(await page.getByTestId('cam-view-model').getAttribute('aria-pressed'), 'true', 'selection preserves view preference');
  assert.deepEqual(errors, []);
  console.log('PASS: Model/Stock/Compare, independent paths, all ribbon tabs, unchanged caches/call counts, native frames, empty stock, freshness, modeled stock, dialogs and playback.');
} finally { await browser.close(); }
