/**
 * Internal construction-plane profile regression:
 * a closed sketch on a midplane inside a solid remains visible and gets
 * viewport-picking priority while Extrude is asking for profiles.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE = 'http://localhost:7199';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error)));

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(
    () => window.__appStore?.getState().document !== null && !!window.__engine,
  );

  const fixture = await page.evaluate(async () => {
    const engine = window.__engine;
    const store = window.__appStore.getState();
    const blank = await engine.newProject();
    store.applySolidUpdate(blank);
    store.setFinishedSketches([]);
    store.applyDatumPlaneUpdate({ document: blank.document, planes: [] });

    await engine.beginSketch({ type: 'origin_plane', plane: 'xy' });
    await engine.setGridSnap(false);
    await engine.addRectangle({
      mode: 'two_point',
      p1: { x: -20, y: -20 },
      p2: { x: 20, y: 20 },
      ctrl_held: true,
    });
    let ended = await engine.endSketch();
    store.setDocument(ended.document);
    store.setFinishedSketches(await engine.finishedSketches());
    store.applySolidUpdate(
      await engine.extrude({
        sketch_name: 'Sketch1',
        profile_indices: [0],
        operation: 'new_body',
        extent: { type: 'distance', distance: 20 },
        taper_angle_deg: 0,
        flip: false,
        target_body_ids: [],
      }),
    );

    const offset = await engine.createDatumPlane({
      source: {
        type: 'offset',
        reference: { type: 'origin_plane', plane: 'xy' },
        distance: 20,
      },
    });
    store.applyDatumPlaneUpdate(offset);
    const offsetPlane = offset.planes.at(-1);
    const midplane = await engine.createDatumPlane({
      source: {
        type: 'midplane',
        first: { type: 'origin_plane', plane: 'xy' },
        second: { type: 'datum_plane', datum_id: offsetPlane.datum_id },
      },
    });
    store.applyDatumPlaneUpdate(midplane);
    const internalPlane = midplane.planes.at(-1);

    await engine.beginSketch({
      type: 'datum_plane',
      datum_id: internalPlane.datum_id,
    });
    await engine.addRectangle({
      mode: 'two_point',
      p1: { x: -5, y: -5 },
      p2: { x: 5, y: 5 },
      ctrl_held: true,
    });
    ended = await engine.endSketch();
    store.setDocument(ended.document);
    store.setFinishedSketches(await engine.finishedSketches());
    store.setMode('solid');
    store.clearSolidSelection();
    window.__cameraApi.fit();
    return {
      z: internalPlane.basis.origin[2],
      profileCount: (await engine.profileCatalog()).find(
        (entry) => entry.sketch_name === 'Sketch2',
      )?.profiles.length,
    };
  });

  assert.equal(fixture.z, 10);
  assert.equal(fixture.profileCount, 1);
  await page.waitForTimeout(300);
  await page.locator('button[title="Extrude"]').first().click();
  await page.getByTestId('extrude-dialog').waitFor({ state: 'visible' });
  await page.waitForFunction(
    () => window.__appStore.getState().profilePicker?.owner === 'extrude',
  );
  await page.evaluate(() =>
    window.__appStore.getState().replaceProfilePicks('extrude', []),
  );
  await page.waitForFunction(
    () => window.__appStore.getState().profilePicker?.selected.length === 0,
  );

  const center = await page.evaluate(() => window.__worldToScreen(0, 0, 10));
  await page.mouse.move(center.x, center.y);
  await page.waitForFunction(
    () => window.__appStore.getState().profilePicker?.hovered?.sketch_name === 'Sketch2',
  );
  await page.mouse.click(center.x, center.y);
  await page.waitForFunction(
    () => window.__appStore.getState().profilePicker?.selected.length === 1,
  );
  assert.deepEqual(
    await page.evaluate(() => window.__appStore.getState().profilePicker.selected[0]),
    { sketch_name: 'Sketch2', profile_index: 0 },
    'the midplane profile behind the body surface must win the explicit Extrude pick',
  );
  assert.deepEqual(pageErrors, []);
  console.log('  [ok] an internal midplane sketch is selectable as an Extrude profile');
} finally {
  await browser.close();
}
