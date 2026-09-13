/** Selection, explicit CAM playback, camera independence and busy feedback. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));
try {
  await page.goto('http://localhost:7199', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__engine && window.__appStore?.getState().document);
  await page.evaluate(async () => {
    const engine = window.__engine;
    const original = engine.camSimulate.bind(engine);
    window.__camRequests = [];
    engine.camSimulate = async (request) => {
      window.__camRequests.push({ ...request, cacheKey: request.target?.cache_key, target: undefined, stock_mesh: undefined });
      // Slow only transfer so the loading state is observable. Geometry is
      // still produced by the real Rust kernel; keep browser WASM work small.
      await new Promise((resolve) => setTimeout(resolve, 180));
      return original({ ...request, voxel_size: 0.35, max_voxels: 100000 });
    };
    const store = window.__appStore.getState();
    store.applySolidUpdate(await engine.newProject());
    await engine.beginSketch({ type: 'origin_plane', plane: 'xy' });
    await engine.addRectangle({ mode: 'two_point', p1: { x: 0, y: 0 }, p2: { x: 20, y: 16 }, ctrl_held: true });
    const ended = await engine.endSketch();
    store.setDocument(ended.document);
    store.setFinishedSketches(await engine.finishedSketches());
    store.setMode('solid');
    const catalog = await engine.profileCatalog();
    const update = await engine.extrude({ source_face: null, sketch_name: catalog[0].sketch_name,
      profile_indices: [catalog[0].profiles[0].index], operation: 'new_body',
      extent: { type: 'distance', distance: 6 }, taper_angle_deg: 0, flip: true, target_body_ids: [] });
    store.applySolidUpdate(update);
    const cam = await engine.camDocument();
    const cutting = { spindle_rpm: 8000, feed_xy: 300, feed_z: 90, coolant: 'flood' };
    const tool = { id: 1, number: 1, name: 'EM6', kind: 'flat_end_mill', diameter: 6,
      flute_length: 10, overall_length: 30, center_cutting: true, flute_count: 3,
      point_angle_degrees: null, corner_radius: null, cutting, cutting_presets: [], default_step_down: null, default_step_over: null };
    cam.tools = [tool, { ...tool, id: 2, number: 2, name: 'Drill 118', kind: 'drill', diameter: 4, point_angle_degrees: 118 },
      { ...tool, id: 3, number: 3, name: 'Contour mill', diameter: 3 }];
    const base = { enabled: true, clearance_z: 5, retract_z: 2, feed_height_z: 1, cutting };
    cam.setups = [{ id: 1, name: 'Playback fixture', wcs: { origin: { x: 0, y: 0, z: 0 }, x_axis: [1, 0, 0], y_axis: [0, 1, 0], z_axis: [0, 0, 1] },
      wcs_origin: { mode: 'explicit' }, work_offset: 'g54', work_offset_count: 1,
      stock_spec: { mode: 'legacy_box' }, resolved_stock: { shape: 'box' },
      stock: { min: { x: 0, y: 0, z: -6 }, max: { x: 20, y: 16, z: 0 } }, stock_model_box: null,
      body_ids: update.scene.bodies.map((body) => body.id), operations: [
        { ...base, id: 1, tool_id: 1, name: 'Facing test', kind: 'face', bounds: { min: { x: 0, y: 0 }, max: { x: 20, y: 16 } }, top_z: 0, target_z: -0.5, step_over: 4, step_down: 1, safe_distance: 4, direction: 'both_ways' },
        { ...base, id: 2, tool_id: 2, name: 'Drilling test', kind: 'drill', points: [{ x: 6, y: 8 }, { x: 14, y: 8 }], holes: [], top_z: -0.5, bottom_z: -4, cycle: 'drill', peck_depth: null, peck_retract: null, thread_pitch: null, feed_out: null, dwell_seconds: 0 },
        { ...base, id: 3, tool_id: 3, name: 'Contour test', kind: 'contour2d', path: [{x:3,y:3},{x:17,y:3},{x:17,y:13},{x:3,y:13}], closed: true,
          top_z: -0.5, bottom_z: -4, step_down: 2, compensation: 'outside', compensation_mode: 'in_control', lead_in: 1, lead_out: 1, lead_arc_radius: 0.5,
          direction: 'climb', roughing_passes: 1, roughing_step_over: null, finishing_pass: false, finish_allowance: 0, finish_feed: null, spring_pass: false, chain_ref: null },
      ] }];
    cam.setups.push({ ...cam.setups[0], id: 2, name: 'Other setup', operations: [] });
    cam.active_setup_id = 1; cam.next_setup_id = 3; cam.next_tool_id = 4; cam.next_operation_id = 4;
    await store.setCamDocument(cam);
    store.setSelectedCamSetupId(1); store.setSelectedCamOperationId(null); store.setActiveTab('cam');
  });
  await page.waitForFunction(() => window.__appStore.getState().camSimulation?.completed_steps === 0);
  await page.evaluate(() => window.__cameraApi.fit());
  const firstKey = await page.evaluate(() => window.__camRequests[0].cacheKey);
  await page.getByRole('button', { name: /^Other setup/ }).first().click();
  await page.waitForFunction(() => window.__appStore.getState().camSimulation?.setup_id === 2);
  await page.getByRole('button', { name: /^Playback fixture/ }).first().click();
  await page.waitForFunction(() => window.__appStore.getState().camSimulation?.setup_id === 1);
  assert.equal(await page.evaluate(() => window.__camRequests.filter((request) => request.setup_id === 1).slice(-1)[0].cacheKey), firstKey,
    'active-setup selection must not invalidate cached geometry identity');
  assert.equal(await page.getByTestId('cam-simulation-playback').count(), 0);
  assert.equal(await page.evaluate(() => window.__appStore.getState().camSimulationPlayback), null);
  assert.ok((await page.evaluate(() => window.__camRequests)).every((request) => request.completed_steps === 0));
  const drillRow = page.getByRole('button', { name: /\[T2\] Drilling test/ });
  await drillRow.click();
  const setupRow = page.getByRole('button', { name: /^Playback fixture/ }).first();
  assert.equal(await setupRow.getAttribute('aria-pressed'), 'false');
  await setupRow.click();
  assert.equal(await setupRow.getAttribute('aria-pressed'), 'true', 'same active setup still becomes selected/highlighted');
  await page.waitForFunction(() => window.__appStore.getState().camSimulation?.completed_steps === 0);
  await drillRow.click();
  assert.equal(await setupRow.getAttribute('aria-pressed'), 'false');
  const pose = () => page.evaluate(async () => {
    const { selectedOperationToolPose } = await import('/src/cam/overlay.ts');
    const state = window.__appStore.getState();
    return selectedOperationToolPose(state.camProgram, state.camDocument.setups[0], state.selectedCamOperationId);
  });
  const immediatePose = await pose();
  await page.waitForFunction(() => window.__appStore.getState().camSimulation?.through_operation_id === 2);
  assert.deepEqual(await pose(), immediatePose, 'selection tool must not jump when stock arrives');
  const drilled = await page.evaluate(() => window.__appStore.getState().camSimulation.remaining_voxels);
  const fullRequests = () => page.evaluate(() => window.__camRequests.filter(request => request.playback_time_seconds == null).length);
  const beforeTabs = await fullRequests();
  await page.getByRole('tab', { name: 'Simulate', exact: true }).click();
  await page.getByLabel('3D simulation detail').waitFor();
  await page.getByRole('tab', { name: 'Output', exact: true }).click();
  await page.locator('[data-ribbon-button="postNc"]').click();
  assert.equal(await page.getByTestId('cam-post-dialog').evaluate(dialog =>
    dialog.getBoundingClientRect().top >= document.querySelector('[data-testid="ribbon"]').getBoundingClientRect().bottom + 8), true,
  'CAM dialogs must clear the new task-tab row');
  await page.getByTestId('cam-post-dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Advanced', exact: true }).click();
  await page.locator('[data-ribbon-menu-id="postEvents"]').waitFor();
  await page.getByRole('tab', { name: 'Program', exact: true }).click();
  assert.equal(await page.locator('[data-ribbon-menu]').count(), 0, 'task changes close the Advanced menu');
  assert.equal(await fullRequests(), beforeTabs, 'task navigation must not request new stock or toolpaths');
  // Arrow/Home/End navigation follows accessible tab semantics.
  await page.getByRole('tab', { name: 'Program', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.getByRole('tab', { name: 'Simulate', exact: true }).getAttribute('aria-selected'), 'true');
  await page.keyboard.press('End');
  assert.equal(await page.getByRole('tab', { name: 'Output', exact: true }).getAttribute('aria-selected'), 'true');
  await page.keyboard.press('Home');
  await page.screenshot({ path: '/tmp/nbcad-cam-drilled-stock.png' });
  assert.equal(await page.getByTestId('cam-simulation-playback').count(), 0);
  await page.getByRole('button', { name: /\[T1\] Facing test/ }).click();
  await page.waitForFunction(() => window.__appStore.getState().camSimulation?.through_operation_id === 1);
  await drillRow.click();
  await page.waitForFunction(() => window.__appStore.getState().camSimulation?.through_operation_id === 2);
  assert.equal(await page.evaluate(() => window.__appStore.getState().camSimulation.remaining_voxels), drilled);
  assert.ok((await page.evaluate(() => window.__camRequests)).every((request) => request.playback_time_seconds == null));

  await drillRow.click({ button: 'right' });
  await page.getByRole('button', { name: 'Simulate toolpath', exact: true }).click();
  const preparing = page.getByTestId('cam-simulation-preparing');
  await preparing.waitFor();
  await preparing.getByLabel('Close simulation', { exact: true }).click();
  await page.waitForFunction(() => window.__appStore.getState().camSimulation?.through_operation_id === 2
    && window.__appStore.getState().camSimulationPlayback === null);
  await drillRow.click({ button: 'right' });
  await page.getByRole('button', { name: 'Simulate toolpath', exact: true }).click();
  const controls = page.getByTestId('cam-simulation-playback');
  await controls.waitFor();
  assert.equal(await page.getByRole('tab', { name: 'Simulate', exact: true }).getAttribute('aria-selected'), 'true', 'context-menu simulation opens the Simulate ribbon');
  assert.equal(await controls.getAttribute('data-placement'), 'ribbon');
  await page.waitForFunction(() => window.__appStore.getState().camSimulation?.completed_steps != null);
  const start = await page.evaluate(() => window.__appStore.getState().camSimulationPlayback.time_seconds);
  assert.ok(start > 0, 'operation playback starts after preceding operations');
  assert.equal(await page.evaluate(async () => {
    const { simulationPlaybackPose } = await import('/src/cam/overlay.ts');
    const state = window.__appStore.getState();
    return simulationPlaybackPose(state.camSimulationTimeline, state.camSimulationPlayback.time_seconds).toolId;
  }), 2, 'operation start must show the drill, not the preceding facing tool');
  const trailStart = await page.evaluate(async () => {
    const { simulationPlaybackPathLayers } = await import('/src/cam/simulationPath.ts');
    const { collectNativeViewportPresentation } = await import('/src/components/viewport/nativeViewportBridge.ts');
    const state = window.__appStore.getState();
    const first = state.camProgram.commands.findIndex((command) => command.kind === 'section_start' && command.operation_id === 2);
    const layers = simulationPlaybackPathLayers(state.camSimulationTimeline, first);
    window.__camTimedPath = layers;
    window.__camTimedPathFirst = first;
    const presentation = collectNativeViewportPresentation();
    return { firstTime: Math.min(...layers.map((layer) => layer.playback.segmentTimes[0])),
      aligned: layers.every((layer) => layer.playback.segmentTimes.length * 3 === layer.segments.length),
      pathIds: layers.map((layer) => layer.playback.pathId),
      cursor: presentation.camPathProgress, tool: presentation.camTool };
  });
  assert.ok(trailStart.aligned);
  assert.ok(trailStart.firstTime >= start - 1e-9, 'trail must exclude earlier operations');
  assert.ok(trailStart.pathIds.every((id) => id === trailStart.cursor.pathId));
  assert.deepEqual(trailStart.cursor.position, trailStart.tool.tip);
  await controls.getByTitle('Play simulation', { exact: true }).click();
  await page.waitForFunction((start) => window.__appStore.getState().camSimulationPlayback.time_seconds > start + 0.3, start);
  assert.equal(await page.getByTestId('cam-busy-cursor').count(), 0,
    'routine background playback preparation must not keep spinning beside the pointer');
  const cameraBefore = await page.evaluate(() => window.__cameraApi.getSnapshot());
  await page.evaluate(() => window.__cameraApi.orbitBy(55, 25));
  assert.notDeepEqual(await page.evaluate(() => window.__cameraApi.getSnapshot()), cameraBefore);
  assert.equal(await page.evaluate(() => window.__appStore.getState().camSimulationPlayback.playing), true);
  await page.screenshot({ path: '/tmp/nbcad-cam-playback-controls.png' });
  await controls.getByTitle('Pause simulation', { exact: true }).click();
  const requestsBeforeNavigation = await fullRequests();
  await page.evaluate(() => {
    const state = window.__appStore.getState();
    window.__ribbonRetained = { document: state.camDocument, timeline: state.camSimulationTimeline,
      time: state.camSimulationPlayback.time_seconds, selection: state.selectedCamOperationId,
      camera: JSON.stringify(window.__cameraApi.getSnapshot()), canvas: document.querySelector('canvas') };
  });
  for (const name of ['Program', 'Output', 'Simulate']) {
    await page.getByRole('tab', { name, exact: true }).click();
    await page.waitForFunction((placement) => document.querySelector('[data-testid="cam-simulation-playback"]')?.getAttribute('data-placement') === placement, name === 'Simulate' ? 'ribbon' : 'viewport');
    assert.equal(await page.getByTestId('cam-simulation-playback').count(), 1, 'only one set of controls, including outside the simulation page');
    assert.equal(await page.evaluate(() => {
      const state = window.__appStore.getState(), prior = window.__ribbonRetained;
      return state.activeTab === 'cam' && state.camDocument === prior.document
        && state.camSimulationTimeline === prior.timeline && state.camSimulationPlayback.time_seconds === prior.time
        && state.selectedCamOperationId === prior.selection && JSON.stringify(window.__cameraApi.getSnapshot()) === prior.camera
        && document.querySelector('canvas') === prior.canvas;
    }), true, 'tab navigation must preserve the viewport, stock inputs, selection and playback');
  }
  assert.equal(await fullRequests(), requestsBeforeNavigation);
  const trailPaused = await page.evaluate(async () => {
    const { simulationPlaybackPathLayers } = await import('/src/cam/simulationPath.ts');
    const { collectNativeViewportPresentation } = await import('/src/components/viewport/nativeViewportBridge.ts');
    const state = window.__appStore.getState();
    const presentation = collectNativeViewportPresentation();
    return { retained: simulationPlaybackPathLayers(state.camSimulationTimeline, window.__camTimedPathFirst) === window.__camTimedPath,
      time: state.camSimulationPlayback.time_seconds, cursor: presentation.camPathProgress, tool: presentation.camTool };
  });
  assert.ok(trailPaused.retained, 'animation must not rebuild the timed path');
  assert.equal(trailPaused.cursor.timeSeconds, trailPaused.time, 'trail follows the animation clock, not stock snapshots');
  assert.deepEqual(trailPaused.cursor.position, trailPaused.tool.tip, 'partial color meets the tool center');
  await controls.getByLabel('Next move', { exact: true }).click();
  await controls.getByLabel('Previous move', { exact: true }).click();
  await controls.getByTitle('Return to the beginning', { exact: true }).click();
  const rewound = await page.evaluate(async () => {
    const { collectNativeViewportPresentation } = await import('/src/components/viewport/nativeViewportBridge.ts');
    return collectNativeViewportPresentation().camPathProgress;
  });
  assert.equal(rewound.timeSeconds, start);
  assert.equal(rewound.pathId, trailStart.cursor.pathId, 'rewind reuses the same path');
  await controls.getByLabel('Close simulation', { exact: true }).click();
  await controls.waitFor({ state: 'detached' });
  await page.waitForFunction(() => window.__appStore.getState().camSimulation?.completed_steps === null);
  assert.equal(await page.evaluate(async () => {
    const { collectNativeViewportPresentation } = await import('/src/components/viewport/nativeViewportBridge.ts');
    return collectNativeViewportPresentation().camPathProgress;
  }), null, 'closing playback removes the progressive trail');
  assert.equal(await page.evaluate(() => window.__appStore.getState().camSimulation.remaining_voxels), drilled);
  // Each operation must show its completed stock on click and finish after
  // ONE Play action, including every peck/compensated contour move.
  for (const [id, row] of [[2, drillRow], [3, page.getByRole('button', { name: /\[T3\] Contour test/ })]]) {
    await row.click();
    await page.waitForFunction((id) => window.__appStore.getState().camSimulation?.through_operation_id === id
      && window.__appStore.getState().camSimulation?.completed_steps == null, id);
    const expected = await page.evaluate(() => {
      const result = window.__appStore.getState().camSimulation;
      if (!result.stock_mesh?.positions?.length) throw new Error('Selected operation has no remaining-stock surface');
      return result.remaining_voxels;
    });
    await row.click({ button: 'right' });
    await page.getByRole('button', { name: 'Simulate toolpath', exact: true }).click();
    await controls.waitFor();
    await controls.getByLabel('Playback speed').selectOption('10');
    await controls.getByTitle('Play simulation', { exact: true }).click();
    await page.waitForFunction(() => {
      const state = window.__appStore.getState();
      return state.camSimulationPlayback && !state.camSimulationPlayback.playing
        && state.camSimulationPlayback.time_seconds >= state.camSimulationTimeline.estimated_seconds - 1e-6;
    }, null, { timeout: 60000 });
    await page.waitForFunction((expected) => window.__appStore.getState().camSimulation?.remaining_voxels === expected, expected);
    await controls.getByLabel('Close simulation', { exact: true }).click();
    await controls.waitFor({ state: 'detached' });
  }
  await page.getByRole('button', { name: /^Playback fixture/ }).first().click({ button: 'right' });
  await page.getByRole('button', { name: 'Simulate whole setup', exact: true }).click();
  await controls.waitFor();
  assert.equal(await page.evaluate(() => window.__appStore.getState().camSimulationPlayback.time_seconds), 0);
  await controls.getByLabel('Close simulation', { exact: true }).click();
  await page.waitForFunction(() => window.__appStore.getState().camSimulation?.completed_steps === 0);
  assert.equal(await page.getByRole('button', { name: 'CAM Sim', exact: true }).count(), 1);
  assert.equal(await page.getByRole('button', { name: 'NC Sim', exact: true }).count(), 1);
  await page.getByRole('button', { name: 'NC Sim', exact: true }).click();
  await page.getByTestId('cam-gcode-simulation-dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Simulation settings', exact: true }).click();
  await page.getByLabel('Part comparison tolerance').waitFor();
  await page.getByLabel('Close simulation settings', { exact: true }).click();
  await page.evaluate(() => {
    const engine = window.__engine;
    const original = engine.camRegenerateOperation.bind(engine);
    engine.camRegenerateOperation = async (...args) => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      return original(...args);
    };
  });
  await drillRow.click({ button: 'right' });
  await page.getByRole('button', { name: 'Regenerate toolpath', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Generating toolpaths' }).waitFor();
  await page.getByTestId('cam-busy-cursor').locator('svg.animate-spin').waitFor();
  await page.waitForFunction(async () => (await window.__engine.camToolpathStatuses()).find((status) => status.operation_id === 2)?.state === 'current');
  assert.deepEqual(errors, []);
  await page.screenshot({ path: '/tmp/nbcad-cam-playback-ui.png' });
  console.log('PASS: static stock, stable end pose, retained progressive path, operation/setup playback, move controls, live orbit and ribbon simulation actions');
} finally { await browser.close(); }
