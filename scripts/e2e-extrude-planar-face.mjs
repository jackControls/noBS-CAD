/**
 * Exact planar-face Extrude regression.
 *
 * A hollow body is created first, then its annular top face is used directly
 * as a second Extrude source. This guards the complete contract:
 * viewport/UI selection -> stable FaceId + OCCT key -> original TopoDS_Face,
 * including its inner boundary wire.
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

  console.log('1. Create a hollow OCCT body and select its annular top face');
  const source = await page.evaluate(async () => {
    const engine = window.__engine;
    const store = window.__appStore.getState();
    store.applySolidUpdate(await engine.newProject());
    await engine.beginSketch({ type: 'origin_plane', plane: 'xy' });
    await engine.setGridSnap(false);
    await engine.addRectangle({
      mode: 'two_point',
      p1: { x: -20, y: -20 },
      p2: { x: 20, y: 20 },
      ctrl_held: true,
    });
    await engine.addRectangle({
      mode: 'two_point',
      p1: { x: -6, y: -6 },
      p2: { x: 6, y: 6 },
      ctrl_held: true,
    });
    const ended = await engine.endSketch();
    store.setDocument(ended.document);
    store.setFinishedSketches(await engine.finishedSketches());
    store.setMode('solid');
    const catalog = await engine.profileCatalog();
    const outer = catalog[0].profiles.find((profile) => profile.nesting_depth === 0);
    const update = await engine.extrude({
      source_face: null,
      sketch_name: catalog[0].sketch_name,
      profile_indices: [outer.index],
      operation: 'new_body',
      extent: { type: 'distance', distance: 10 },
      taper_angle_deg: 0,
      flip: false,
      target_body_ids: [],
    });
    store.applySolidUpdate(update);
    const body = update.scene.bodies[0];
    const top = body.faces.find((face) =>
      face.plane
      && face.plane.normal[2] > 0.9
      && face.plane.origin[2] > 9,
    );
    if (!top) throw new Error('hollow body has no top planar face');
    store.selectSolidFeature('face', body.id, top.id, null, false);
    window.__cameraApi.fit();
    return { bodyId: body.id, faceId: top.id };
  });

  console.log('2. Extrude recognizes the selected face as an exact source');
  await page.locator('button[title="Extrude"]').first().click();
  const dialog = page.getByTestId('extrude-dialog');
  await dialog.waitFor({ state: 'visible' });
  await page.waitForFunction(
    ({ bodyId, faceId }) => {
      const state = window.__appStore.getState();
      return state.profilePicker?.owner === 'extrude'
        && state.selectedBody === bodyId
        && state.selectedFace === faceId;
    },
    source,
  );
  assert.match(await dialog.innerText(), /Exact OCCT face/i);
  assert.match(await page.getByTestId('extrude-profile-selection-state').innerText(), /1 source/i);
  assert.equal(
    await dialog.locator('[data-extrude-operation="join"]').getAttribute('aria-checked'),
    'true',
    'an existing face defaults to adding material back to its owning body',
  );

  // Create a separate body so its topology can be inspected independently.
  await dialog.locator('[data-extrude-operation="new_body"]').click();
  await page.getByTestId('extrude-distance').fill('5');
  await page.waitForFunction(() => {
    const transient = window.__nativeViewportTransient();
    return transient.arrows.length === 1
      && transient.triangles.some((layer) => layer.positions.length > 0);
  });
  const facePreview = await page.evaluate(() => window.__nativeViewportTransient());
  const facePreviewLines = facePreview.lines.flatMap((layer) => layer.segments);
  for (let index = 0; index + 5 < facePreviewLines.length; index += 6) {
    assert.ok(
      Math.abs(facePreviewLines[index + 2]) < 0.5
        && Math.abs(facePreviewLines[index + 5]) < 0.5,
      'the exact-face tool volume must remain a fill, not a wireframe cage',
    );
  }
  await page.getByTestId('extrude-submit').click();
  try {
    await page.waitForFunction(
      () => {
        const state = window.__appStore.getState();
        return !state.solidBusy
          && (state.constraintDialog !== null
            || (state.extrudeDialogFeature === null
              && state.solidScene.bodies.length === 2));
      },
      undefined,
      { timeout: 60_000 },
    );
    const submitError = await page.evaluate(
      () => window.__appStore.getState().constraintDialog,
    );
    if (submitError) {
      throw new Error(`planar-face submit failed: ${submitError.message}`);
    }
  } catch (error) {
    const diagnostics = await page.evaluate(() => ({
      bodyCount: window.__appStore.getState().solidScene.bodies.length,
      busy: window.__appStore.getState().solidBusy,
      dialog: window.__appStore.getState().extrudeDialogFeature,
      sceneErrors: window.__appStore.getState().solidScene.errors,
      error: window.__appStore.getState().constraintDialog,
    }));
    throw new Error(`planar-face submit stalled: ${JSON.stringify(diagnostics)}`, {
      cause: error,
    });
  }

  console.log('3. History retains stable identity and OCCT preserves the hole wire');
  const result = await page.evaluate(async ({ bodyId, faceId }) => {
    const definitions = await window.__engine.extrudeDefinitions();
    const definition = definitions.at(-1);
    const body = window.__appStore.getState().solidScene.bodies.find(
      (candidate) => candidate.id === definition.new_body_ids[0],
    );
    const caps = body.faces.filter((face) =>
      face.plane && Math.abs(face.plane.normal[2]) > 0.9,
    );
    const capCentroids = caps.flatMap((face) => {
      const indices = body.mesh.indices.slice(
        face.first_index,
        face.first_index + face.index_count,
      );
      const centroids = [];
      for (let index = 0; index + 2 < indices.length; index += 3) {
        const centroid = [0, 0];
        for (const vertex of indices.slice(index, index + 3)) {
          centroid[0] += body.mesh.positions[vertex * 3] / 3;
          centroid[1] += body.mesh.positions[vertex * 3 + 1] / 3;
        }
        centroids.push(centroid);
      }
      return centroids;
    });
    return {
      sourceFace: definition.source_face,
      sourceKey: definition.source_face_key,
      profileIndices: definition.profile_indices,
      errors: window.__appStore.getState().solidScene.errors,
      faceCount: body.faces.length,
      holeStayedOpen: capCentroids.every(
        ([x, y]) => Math.abs(x) >= 5.5 || Math.abs(y) >= 5.5,
      ),
      expected: { body_id: bodyId, face_id: faceId },
    };
  }, source);
  assert.deepEqual(result.sourceFace, result.expected);
  assert.match(result.sourceKey, /^face:\d+$/);
  assert.deepEqual(result.profileIndices, []);
  assert.deepEqual(result.errors, []);
  assert.equal(result.faceCount, 10, 'the exact face keeps two annular caps and eight walls');
  assert.equal(result.holeStayedOpen, true, 'no cap triangle may fill the source face inner wire');
  assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join('\n')}`);

  console.log('  [ok] planar face identity, exact OCCT topology, holes, preview, and UI work');
} finally {
  await browser.close();
}
