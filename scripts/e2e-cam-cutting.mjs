/** Isolated CAM drafts and real WASM save/regeneration; no operator files. */
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const captureDir = await mkdtemp(path.join(tmpdir(), 'nbcad-cutting-'));
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {});
const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
const close = (a, b) => assert.ok(Math.abs(Number(a) - b) < 1e-7 * Math.max(1, Math.abs(b)), `${a} != ${b}`);
const form = () => page.locator('[data-testid="cam-operation-dialog"], [data-testid="cam-adaptive-dialog"]');
const input = key => form().getByTestId(`cam-cutting-${key}`).locator('input');
const read = async key => Number(await input(key).inputValue());
const open = async (kind, editId) => {
  await page.evaluate(({ kind, editId }) => window.__appStore.getState().setCamDialog({ type: 'operation', kind, editId }), { kind, editId });
  await form().waitFor();
};
const cancel = async () => {
  await form().getByRole('button', { name: 'Cancel', exact: true }).click();
  await form().waitFor({ state: 'detached' });
};
try {
  await page.goto('http://localhost:7199', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__engine && window.__appStore?.getState().document);
  await page.evaluate(() => {
    const engine = window.__engine;
    const simulate = engine.camSimulate.bind(engine);
    engine.camSimulate = request => simulate({ ...request, voxel_size: 0.5, max_voxels: 100000 });
  });
  for (const units of ['millimeters', 'inches']) {
    await page.evaluate(async units => {
      const engine = window.__engine, store = window.__appStore.getState();
      store.applySolidUpdate(await engine.newProject());
      const cam = await engine.camDocument();
      cam.units = units;
      const cutting = { spindle_rpm: 6000, feed_xy: 600, feed_z: 120, coolant: 'flood' };
      const mill = { id: 1, number: 1, name: 'Face mill', kind: 'face_mill', diameter: 10,
        flute_length: 10, overall_length: 40, center_cutting: true, flute_count: 4,
        corner_radius: null, corner_chamfer: null, point_angle_degrees: null, cutting,
        cutting_presets: [{ name: 'Second preset', cutting: { ...cutting, spindle_rpm: 3000, feed_xy: 480, feed_z: 90 } }] };
      cam.tools = [mill, { ...mill, id: 2, number: 2, kind: 'flat_end_mill', name: 'End mill' },
        { ...mill, id: 3, number: 3, kind: 'drill', name: 'Drill', point_angle_degrees: 118, flute_count: 2 },
        { ...mill, id: 4, number: 4, kind: 'chamfer_mill', name: 'Chamfer mill', point_angle_degrees: 90 },
        { ...mill, id: 5, number: 5, kind: 'thread_mill', name: 'Thread mill' }];
      cam.setups = [{ id: 1, name: 'Feed test', wcs: { origin: { x: 0, y: 0, z: 0 },
        x_axis: [1, 0, 0], y_axis: [0, 1, 0], z_axis: [0, 0, 1] }, wcs_origin: { mode: 'explicit' },
        work_offset: 'g54', work_offset_count: 1, stock_spec: { mode: 'legacy_box' }, resolved_stock: { shape: 'box' },
        stock: { min: { x: 0, y: 0, z: -6 }, max: { x: 20, y: 16, z: 0 } }, stock_model_box: null,
        body_ids: [], operations: [{ id: 1, name: 'Face feed test', kind: 'face', enabled: true, tool_id: 1,
          cutting, clearance_z: 6, retract_z: 2, feed_height_z: 1, top_z: 0, target_z: -0.5,
          bounds: { min: { x: 0, y: 0 }, max: { x: 20, y: 16 } }, step_over: 5, step_down: 1,
          safe_distance: 4, direction: 'both_ways' }] }];
      cam.active_setup_id = 1; cam.next_setup_id = 2; cam.next_operation_id = 2; cam.next_tool_id = 6;
      await store.setCamDocument(cam);
      store.setActiveTab('cam');
      window.__toolsBefore = JSON.stringify(window.__appStore.getState().camDocument.tools);
    }, units);
    const scale = units === 'inches' ? 25.4 : 1;
    const speedScale = units === 'inches' ? 0.3048 : 1;
    await open('face', 1);
    assert.equal(await input('surfaceSpeed').isEnabled(), true);
    assert.equal(await input('feedPerTooth').isEnabled(), true);
    await input('feedPerTooth').fill(String(0.05 / scale));
    close(await read('feedXy'), 1200 / scale);
    await input('surfaceSpeed').fill(String((Math.PI * 10 * 3000 / 1000) / speedScale));
    assert.equal(await read('rpm'), 3000);
    close(await read('feedXy'), 600 / scale);
    await input('feedPerRev').fill(String(0.02 / scale));
    close(await read('feedZ'), 60 / scale);
    await input('rpm').fill('6000');
    close(await read('feedXy'), 1200 / scale);
    close(await read('feedZ'), 120 / scale);
    await input('feedXy').fill(String(900 / scale));
    await input('rpm').fill('3000');
    close(await read('feedXy'), 900 / scale);
    close(await read('feedPerTooth'), 0.075 / scale);

    // Selecting a preset replaces the driver pairs without touching the library.
    await form().getByRole('combobox', { name: 'Cutting preset', exact: true }).selectOption('1');
    assert.equal(await read('rpm'), 3000);
    close(await read('feedXy'), 480 / scale);
    await input('rpm').fill('6000');
    close(await read('feedXy'), 480 / scale);
    await input('feedPerTooth').fill(String(0.05 / scale));
    await input('surfaceSpeed').fill('');
    assert.equal(await input('rpm').inputValue(), '');
    assert.equal(await input('feedXy').inputValue(), '');
    await form().locator('button[type="submit"]').click();
    await form().getByText('Surface speed needs a positive finite number.', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__appStore.getState().camDocument.setups[0].operations[0].cutting.feed_xy), 600);
    await input('surfaceSpeed').fill(String((Math.PI * 10 * 4000 / 1000) / speedScale));
    await input('feedZ').fill(String(80 / scale));
    await form().locator('button[type="submit"]').click();
    await form().waitFor({ state: 'detached', timeout: 60000 });
    const saved = await page.evaluate(async () => (await window.__engine.camDocument()).setups[0].operations[0].cutting);
    assert.equal(saved.spindle_rpm, 4000);
    close(saved.feed_xy, 800);
    close(saved.feed_z, 80);
    await open('face', 1);
    assert.equal(await read('rpm'), 4000);
    close(await read('feedPerTooth'), 0.05 / scale);
    close(await read('surfaceSpeed'), (Math.PI * 40) / speedScale);
    if (units === 'millimeters') await page.screenshot({ path: path.join(captureDir, 'face-linked-feeds.png') });
    await cancel();

    // The other milling dialogs use the same editable pairs; no geometry or
    // unrelated operation is changed by testing and cancelling a draft.
    for (const kind of ['contour2d', 'pocket2d', 'chamfer2d', 'thread', 'adaptive3d']) {
      await open(kind);
      await input('rpm').fill('6000');
      // Change the value before returning to the desired chip load. Filling
      // an unchanged readout is not an edit event in a controlled React input.
      await input('feedPerTooth').fill(String(0.05 / scale));
      await input('feedPerTooth').fill(String(0.025 / scale));
      close(await read('feedXy'), 600 / scale);
      await input('surfaceSpeed').fill(String((Math.PI * 20) / speedScale));
      assert.equal(await read('rpm'), 2000);
      close(await read('feedXy'), 200 / scale);
      if (kind === 'adaptive3d') {
        await form().getByLabel('Plunge feed', { exact: false }).first().waitFor();
        assert.equal((await form().innerText()).includes('Clear entry feed'), false);
        if (units === 'millimeters') {
          await input('rpm').fill('2400'); // Short deliberate input for the layout capture.
          await input('feedXy').click();
          await page.screenshot({ path: path.join(captureDir, 'roughing-linked-feeds.png') });
        }
      }
      await cancel();
    }
    await open('drill');
    assert.equal(await form().getByTestId('cam-cutting-feedPerTooth').count(), 0);
    await input('rpm').fill('2000');
    await input('feedPerRev').fill(String(0.05 / scale));
    close(await read('feedZ'), 100 / scale);
    await input('surfaceSpeed').fill(String((Math.PI * 10) / speedScale));
    assert.equal(await read('rpm'), 1000);
    close(await read('feedZ'), 50 / scale);
    await cancel();
    assert.equal(await page.evaluate(() => JSON.stringify(window.__appStore.getState().camDocument.tools) === window.__toolsBefore), true);
  }
  assert.deepEqual(errors, []);
  console.log('PASS: editable feed/speed pairs across all operation dialogs, metric/inch, presets, invalid-driver save gate, real Face save/regeneration/reopen, Plunge feed label, library untouched');
} catch (error) {
  console.error('UI:', await page.locator('body').innerText(), errors);
  await page.screenshot({ path: path.join(captureDir, 'linked-feeds-failure.png') });
  console.error(`Failure capture: ${captureDir}`);
  throw error;
} finally { await browser.close(); }
