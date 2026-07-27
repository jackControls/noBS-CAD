/**
 * Bottom-right selection measurement regression:
 * exact sketch line/circle dimensions plus solid body/face/edge readouts.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE = 'http://localhost:7199';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error)));

const rowText = (label) => page.getByTestId(`selection-measure-${label}`).innerText();

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(
    () => window.__appStore?.getState().document !== null && !!window.__engine,
  );

  console.log('1. Sketch entities show exact analytic dimensions');
  const sketchIds = await page.evaluate(async () => {
    const engine = window.__engine;
    const update = await engine.newProject();
    const store = window.__appStore.getState();
    store.applySolidUpdate(update);
    let sketch = await engine.beginSketch({ type: 'origin_plane', plane: 'xy' });
    sketch = await engine.setGridSnap(false);
    store.setMode('sketch');
    store.setActiveSketch(sketch);

    const line = await engine.addLine({
      from: { x: 0, y: 0 },
      to_raw: { x: 3, y: 4 },
      ctrl_held: true,
    });
    const circle = await engine.addCircle({
      mode: 'center_diameter',
      p1: { x: 20, y: 0 },
      p2: { x: 30, y: 0 },
      ctrl_held: true,
    });
    const firstParallel = await engine.addLine({
      from: { x: 40, y: 0 },
      to_raw: { x: 50, y: 0 },
      ctrl_held: true,
    });
    const secondParallel = await engine.addLine({
      from: { x: 40, y: 6 },
      to_raw: { x: 50, y: 6 },
      ctrl_held: true,
    });
    store.setActiveSketch(secondParallel.sketch);
    store.setSelectedEntity(line.entity_id);
    store.setSelectedEntities([line.entity_id]);
    return {
      line: line.entity_id,
      circle: circle.entities.at(-1),
      parallel: [firstParallel.entity_id, secondParallel.entity_id],
    };
  });

  const readout = page.getByTestId('selection-readout');
  await readout.waitFor({ state: 'visible' });
  assert.match(await readout.innerText(), /SELECTION\s+Line/);
  assert.match(await rowText('length'), /Length\s+5 mm/);
  assert.match(await rowText('angle'), /Angle\s+53\.13°/);

  await page.evaluate((circleId) => {
    const store = window.__appStore.getState();
    store.setSelectedEntity(circleId);
    store.setSelectedEntities([circleId]);
  }, sketchIds.circle);
  await page.waitForFunction(
    () => document.querySelector('[data-testid="selection-readout"]')?.textContent?.includes('Circle'),
  );
  assert.match(await rowText('radius'), /Radius\s+10 mm/);
  assert.match(await rowText('diameter'), /Diameter\s+20 mm/);
  assert.match(await rowText('area'), /Area\s+314\.159 mm²/);

  console.log('2. Multi-selected sketch lines show separation and relative angle');
  await page.evaluate((lineIds) => {
    const store = window.__appStore.getState();
    store.setSelectedEntity(lineIds[1]);
    store.setSelectedEntities(lineIds);
  }, sketchIds.parallel);
  await page.waitForFunction(
    () => document.querySelector('[data-testid="selection-measure-minimumDistance"]'),
  );
  assert.match(await readout.innerText(), /SELECTION\s+2 objects/);
  assert.match(await rowText('totalLength'), /Total length\s+20 mm/);
  assert.match(await rowText('minimumDistance'), /Minimum distance\s+6 mm/);
  assert.match(await rowText('angle'), /Angle\s+0°/);

  console.log('3. Curved solid edges expose fitted radius and arc length');
  await page.evaluate(async () => {
    const engine = window.__engine;
    const update = await engine.newProject();
    const store = window.__appStore.getState();
    store.applySolidUpdate(update);
    await engine.beginSketch({ type: 'origin_plane', plane: 'xy' });
    await engine.setGridSnap(false);
    await engine.addCircle({
      mode: 'center_diameter',
      p1: { x: 0, y: 0 },
      p2: { x: 10, y: 0 },
      ctrl_held: true,
    });
    await engine.endSketch();
    const solidUpdate = await engine.extrude({
      sketch_name: 'Sketch1',
      profile_indices: [0],
      operation: 'new_body',
      extent: { type: 'distance', distance: 15 },
      taper_angle_deg: 0,
      flip: false,
      target_body_ids: [],
    });
    store.applySolidUpdate(solidUpdate);
    store.setMode('solid');
    const body = solidUpdate.scene.bodies[0];
    const circularEdge = body.edges.find((edge) => edge.points.length > 4);
    if (!circularEdge) throw new Error('cylinder did not expose a tessellated circular edge');
    store.setSelectedBody(body.id);
    store.setSelectedFace(null);
    store.setSelectedEdges([circularEdge.id]);
  });
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="selection-measure-radius"]')?.textContent?.includes('10'),
  );
  assert.match(await rowText('radius'), /Radius\s+≈ 10 mm/);
  assert.match(await rowText('length'), /Length\s+≈ 62\.832 mm/);

  console.log('4. Solid body, face, and straight-edge measurements follow topology selection');
  const topology = await page.evaluate(async () => {
    const engine = window.__engine;
    const update = await engine.newProject();
    const store = window.__appStore.getState();
    store.applySolidUpdate(update);
    await engine.beginSketch({ type: 'origin_plane', plane: 'xy' });
    await engine.setGridSnap(false);
    await engine.addRectangle({
      mode: 'two_point',
      p1: { x: -30, y: -20 },
      p2: { x: 30, y: 20 },
      ctrl_held: true,
    });
    await engine.endSketch();
    const solidUpdate = await engine.extrude({
      sketch_name: 'Sketch1',
      profile_indices: [0],
      operation: 'new_body',
      extent: { type: 'distance', distance: 20 },
      taper_angle_deg: 0,
      flip: false,
      target_body_ids: [],
    });
    store.applySolidUpdate(solidUpdate);
    store.setMode('solid');
    store.setSelectedBody(solidUpdate.scene.bodies[0].id);
    store.setSelectedFace(null);
    store.setSelectedEdges([]);

    const body = solidUpdate.scene.bodies[0];
    const centroidZ = (face) => {
      let total = 0;
      let count = 0;
      for (
        let offset = face.first_index;
        offset < face.first_index + face.index_count;
        offset += 1
      ) {
        const vertex = body.mesh.indices[offset];
        total += body.mesh.positions[vertex * 3 + 2];
        count += 1;
      }
      return total / Math.max(1, count);
    };
    const centroid = (face) => {
      const total = [0, 0, 0];
      let count = 0;
      for (
        let offset = face.first_index;
        offset < face.first_index + face.index_count;
        offset += 1
      ) {
        const vertex = body.mesh.indices[offset];
        total[0] += body.mesh.positions[vertex * 3];
        total[1] += body.mesh.positions[vertex * 3 + 1];
        total[2] += body.mesh.positions[vertex * 3 + 2];
        count += 1;
      }
      return total.map((value) => value / Math.max(1, count));
    };
    const facesByZ = [...body.faces].sort((a, b) => centroidZ(b) - centroidZ(a));
    const face = facesByZ[0];
    const oppositeFace = facesByZ.at(-1);
    const frontFace = [...body.faces].sort(
      (a, b) => centroid(a)[1] - centroid(b)[1],
    )[0];
    const edgeLength = (candidate) => {
      let sum = 0;
      for (let index = 1; index < candidate.points.length; index += 1) {
        const p = candidate.points[index - 1];
        const q = candidate.points[index];
        sum += Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z);
      }
      return sum;
    };
    const edge = [...body.edges].sort((a, b) => {
      const length = (candidate) => {
        let sum = 0;
        for (let index = 1; index < candidate.points.length; index += 1) {
          const p = candidate.points[index - 1];
          const q = candidate.points[index];
          sum += Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z);
        }
        return sum;
      };
      return length(b) - length(a);
    })[0];
    const topZ = Math.max(...body.edges.flatMap((candidate) => candidate.points.map((point) => point.z)));
    const parallelEdges = body.edges
      .filter((candidate) => {
        const first = candidate.points[0];
        const last = candidate.points.at(-1);
        return (
          first &&
          last &&
          candidate.points.every((point) => Math.abs(point.z - topZ) < 1e-6) &&
          Math.abs(Math.abs(last.x - first.x) - 60) < 1e-6 &&
          Math.abs(last.y - first.y) < 1e-6 &&
          edgeLength(candidate) > 59.999
        );
      })
      .map((candidate) => {
        const first = candidate.points[0];
        const last = candidate.points.at(-1);
        return {
          edgeId: candidate.id,
          midpoint: [
            (first.x + last.x) / 2,
            (first.y + last.y) / 2,
            (first.z + last.z) / 2,
          ],
        };
      });
    if (!oppositeFace || parallelEdges.length !== 2) {
      throw new Error('box topology did not expose the expected opposite faces and top edges');
    }
    return {
      bodyId: body.id,
      faceId: face.id,
      oppositeFaceId: oppositeFace.id,
      visibleFaces: [
        { faceId: face.id, centroid: centroid(face) },
        { faceId: frontFace.id, centroid: centroid(frontFace) },
      ],
      edgeId: edge.id,
      parallelEdges,
    };
  });

  await page.waitForFunction(
    () => document.querySelector('[data-testid="selection-readout"]')?.textContent?.includes('Body1'),
  );
  assert.match(await rowText('size'), /Size\s+60 × 40 × 20 mm/);
  assert.match(await rowText('surfaceArea'), /Surface area\s+≈ 8,800 mm²/);
  assert.match(await rowText('volume'), /Volume\s+≈ 48,000 mm³/);

  await page.evaluate(({ bodyId, faceId }) => {
    const store = window.__appStore.getState();
    store.setSelectedBody(bodyId);
    store.setSelectedFace(faceId);
    store.setSelectedEdges([]);
  }, topology);
  await page.waitForFunction(
    () => document.querySelector('[data-testid="selection-readout"]')?.textContent?.includes('Face'),
  );
  assert.match(await rowText('area'), /Area\s+≈ 2,400 mm²/);
  assert.match(await rowText('perimeter'), /Perimeter\s+≈ 200 mm/);

  await page.evaluate(({ bodyId, edgeId }) => {
    const store = window.__appStore.getState();
    store.setSelectedBody(bodyId);
    store.setSelectedFace(null);
    store.setSelectedEdges([edgeId]);
  }, topology);
  await page.waitForFunction(
    () => document.querySelector('[data-testid="selection-readout"]')?.textContent?.includes('Edge'),
  );
  assert.match(await rowText('length'), /Length\s+60 mm/);

  console.log('5. Shift-click toggles a second solid edge and reports pair measurements');
  await page.evaluate(() => {
    window.__appStore.getState().clearSolidSelection();
    window.__cameraApi.fit();
  });
  await page.waitForTimeout(500);
  const edgeScreens = await page.evaluate((edges) => (
    edges.map(({ edgeId, midpoint }) => ({
      edgeId,
      screen: window.__worldToScreen(...midpoint),
    }))
  ), topology.parallelEdges);
  await page.mouse.click(edgeScreens[0].screen.x, edgeScreens[0].screen.y);
  await page.waitForFunction(
    (edgeId) => window.__appStore.getState().selectedEdges.includes(edgeId),
    edgeScreens[0].edgeId,
  );
  await page.keyboard.down('Shift');
  await page.mouse.click(edgeScreens[1].screen.x, edgeScreens[1].screen.y);
  await page.keyboard.up('Shift');
  await page.waitForFunction(
    (edgeIds) => edgeIds.every(
      (edgeId) => window.__appStore.getState().selectedEdges.includes(edgeId),
    ),
    edgeScreens.map(({ edgeId }) => edgeId),
  );
  assert.match(await readout.innerText(), /SELECTION\s+2 edges/);
  assert.match(await rowText('totalLength'), /Total length\s+120 mm/);
  assert.match(await rowText('minimumDistance'), /Minimum distance\s+40 mm/);
  assert.match(await rowText('angle'), /Angle\s+0°/);

  console.log('6. Shift-click toggles a second solid face in the viewport');
  await page.evaluate(() => window.__appStore.getState().clearSolidSelection());
  const faceScreens = await page.evaluate((faces) => (
    faces.map(({ faceId, centroid }) => ({
      faceId,
      screen: window.__worldToScreen(...centroid),
    }))
  ), topology.visibleFaces);
  await page.mouse.click(faceScreens[0].screen.x, faceScreens[0].screen.y);
  await page.waitForFunction(
    (faceId) => window.__appStore.getState().selectedFaces.includes(faceId),
    faceScreens[0].faceId,
  );
  await page.keyboard.down('Shift');
  await page.mouse.click(faceScreens[1].screen.x, faceScreens[1].screen.y);
  await page.keyboard.up('Shift');
  await page.waitForFunction(
    (faceIds) => faceIds.every(
      (faceId) => window.__appStore.getState().selectedFaces.includes(faceId),
    ),
    faceScreens.map(({ faceId }) => faceId),
  );
  assert.match(await readout.innerText(), /SELECTION\s+2 faces/);
  assert.match(await rowText('angle'), /Angle\s+90°/);

  console.log('7. Two opposite faces report area, perimeter, separation, and angle');
  await page.evaluate(({ bodyId, faceId, oppositeFaceId }) => {
    const store = window.__appStore.getState();
    store.selectSolidFeature('face', bodyId, faceId, null, false);
    store.selectSolidFeature('face', bodyId, oppositeFaceId, null, true);
  }, topology);
  await page.waitForFunction(
    () => document.querySelector('[data-testid="selection-readout"]')?.textContent?.includes('2 faces'),
  );
  assert.match(await rowText('totalArea'), /Total area\s+≈ 4,800 mm²/);
  assert.match(await rowText('totalPerimeter'), /Total perimeter\s+≈ 400 mm/);
  assert.match(await rowText('minimumDistance'), /Minimum distance\s+≈ 20 mm/);
  assert.match(await rowText('angle'), /Angle\s+0°/);

  console.log('8. Mixed face/edge selections retain every applicable measurement');
  await page.evaluate(({ bodyId, faceId, parallelEdges }) => {
    const store = window.__appStore.getState();
    store.selectSolidFeature('face', bodyId, faceId, null, false);
    store.selectSolidFeature('edge', bodyId, parallelEdges[0].edgeId, null, true);
  }, topology);
  await page.waitForFunction(
    () => document.querySelector('[data-testid="selection-readout"]')?.textContent?.includes('2 features'),
  );
  assert.match(await rowText('totalLength'), /Total length\s+60 mm/);
  assert.match(await rowText('totalArea'), /Total area\s+≈ 2,400 mm²/);
  assert.match(await rowText('totalPerimeter'), /Total perimeter\s+≈ 200 mm/);
  assert.match(await rowText('minimumDistance'), /Minimum distance\s+≈ 0 mm/);

  console.log('9. Cmd/Ctrl-click multi-selects browser-tree bodies');
  const browserBodies = await page.evaluate(async () => {
    const engine = window.__engine;
    await engine.beginSketch({ type: 'origin_plane', plane: 'xy' });
    await engine.setGridSnap(false);
    await engine.addRectangle({
      mode: 'two_point',
      p1: { x: 90, y: -10 },
      p2: { x: 110, y: 10 },
      ctrl_held: true,
    });
    await engine.endSketch();
    const update = await engine.extrude({
      sketch_name: 'Sketch2',
      profile_indices: [0],
      operation: 'new_body',
      extent: { type: 'distance', distance: 10 },
      taper_angle_deg: 0,
      flip: false,
      target_body_ids: [],
    });
    const store = window.__appStore.getState();
    store.applySolidUpdate(update);
    store.setFinishedSketches(await engine.finishedSketches());
    store.setMode('solid');
    store.clearSolidSelection();
    const folder = update.document.browser.find((node) => node.kind === 'bodies_folder');
    if (!folder || folder.children.length !== 2) {
      throw new Error(`expected two browser bodies, got ${folder?.children.length ?? 0}`);
    }
    if (!store.expanded[folder.id]) store.toggleExpanded(folder.id);
    return folder.children.map((node) => ({
      nodeId: String(node.id),
      bodyId: node.reference_id,
    }));
  });
  const modifier = await page.evaluate(
    () => /Mac|iPhone|iPad|iPod/.test(navigator.platform) ? 'Meta' : 'Control',
  );
  const firstBodyRow = page.locator(
    `[data-browser-node-id="${browserBodies[0].nodeId}"]`,
  );
  const secondBodyRow = page.locator(
    `[data-browser-node-id="${browserBodies[1].nodeId}"]`,
  );
  await firstBodyRow.waitFor({ state: 'visible' });
  await firstBodyRow.click();
  await secondBodyRow.click({ modifiers: [modifier] });
  await page.waitForFunction(
    (bodyIds) => bodyIds.every(
      (bodyId) => window.__appStore.getState().selectedBodies.includes(bodyId),
    ),
    browserBodies.map(({ bodyId }) => bodyId),
  );
  assert.match(await readout.innerText(), /SELECTION\s+2 bodies/);
  assert.match(await rowText('totalSurfaceArea'), /Total surface area\s+≈ 10,400 mm²/);
  assert.match(await rowText('totalVolume'), /Total volume\s+≈ 52,000 mm³/);
  assert.match(await rowText('minimumDistance'), /Minimum distance\s+≈ 60 mm/);
  const bodyVisualRoles = await page.evaluate(
    (bodyIds) => bodyIds.map((bodyId) => window.__solidBodyVisualState(bodyId)),
    browserBodies.map(({ bodyId }) => bodyId),
  );
  assert.ok(bodyVisualRoles[0].overlayKinds.includes('target'));
  assert.ok(bodyVisualRoles[1].overlayKinds.includes('tool'));
  assert.notDeepEqual(
    [...new Set(bodyVisualRoles[0].faceColors)],
    [...new Set(bodyVisualRoles[1].faceColors)],
    'primary and secondary bodies should have distinct role colors',
  );

  console.log('10. Body-operation dialogs pick and toggle whole bodies in canvas');
  await page.evaluate(() => window.__cameraApi.fit());
  await page.waitForTimeout(500);
  const toolBodyScreen = await page.evaluate((bodyId) => {
    const body = window.__appStore
      .getState()
      .solidScene.bodies.find((candidate) => candidate.id === bodyId);
    if (!body) return null;
    const screens = body.faces.map((face) => {
      let x = 0;
      let y = 0;
      let z = 0;
      let count = 0;
      for (
        let offset = face.first_index;
        offset < face.first_index + face.index_count;
        offset += 1
      ) {
        const vertex = body.mesh.indices[offset];
        const base = vertex * 3;
        x += body.mesh.positions[base];
        y += body.mesh.positions[base + 1];
        z += body.mesh.positions[base + 2];
        count += 1;
      }
      return window.__worldToScreen(x / count, y / count, z / count);
    });
    return screens.find(
      (screen) =>
        screen.x > 250
        && screen.x < 1050
        && screen.y > 130
        && screen.y < 820,
    ) ?? null;
  }, browserBodies[1].bodyId);
  assert.ok(toolBodyScreen, 'tool body should have a visible canvas face');
  await page.evaluate(() =>
    window.__appStore.getState().openBodyFeatureDialog('combine'),
  );
  const combineDialog = page.getByTestId('body-feature-dialog');
  await combineDialog.waitFor({ state: 'visible' });
  await page.waitForFunction(
    () =>
      !document
        .querySelector('[data-testid="body-feature-dialog"]')
        ?.textContent?.includes('Loading'),
  );
  await page.mouse.click(toolBodyScreen.x, toolBodyScreen.y);
  await page.waitForFunction(
    (bodyId) => !window.__appStore.getState().selectedBodies.includes(bodyId),
    browserBodies[1].bodyId,
  );
  await page.mouse.click(toolBodyScreen.x, toolBodyScreen.y);
  await page.waitForFunction(
    (bodyId) => window.__appStore.getState().selectedBodies.includes(bodyId),
    browserBodies[1].bodyId,
  );
  const restoredToolVisual = await page.evaluate(
    (bodyId) => window.__solidBodyVisualState(bodyId),
    browserBodies[1].bodyId,
  );
  assert.ok(restoredToolVisual.overlayKinds.includes('tool'));
  await combineDialog.getByRole('button', { name: 'Cancel' }).click();

  console.log('11. Shell mode toggles faces on its active body in canvas');
  await page.evaluate(() =>
    window.__appStore.getState().openBodyFeatureDialog('shell'),
  );
  const shellDialog = page.getByTestId('body-feature-dialog');
  await shellDialog.waitFor({ state: 'visible' });
  await page.waitForFunction(
    () =>
      !document
        .querySelector('[data-testid="body-feature-dialog"]')
        ?.textContent?.includes('Loading'),
  );
  await page.mouse.click(toolBodyScreen.x, toolBodyScreen.y);
  await page.waitForFunction(
    () => window.__appStore.getState().selectedFaces.length === 1,
  );
  const shellFaceId = await page.evaluate(
    () => window.__appStore.getState().selectedFaces[0],
  );
  const shellFaceVisual = await page.evaluate(
    (faceId) => window.__solidFaceVisualState(faceId),
    shellFaceId,
  );
  assert.ok(shellFaceVisual.overlayKinds.includes('selected'));
  await page.mouse.click(toolBodyScreen.x, toolBodyScreen.y);
  await page.waitForFunction(
    () => window.__appStore.getState().selectedFaces.length === 0,
  );
  await shellDialog.getByRole('button', { name: 'Cancel' }).click();

  assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join('\n')}`);

  console.log('  [ok] selection readout covers single and modifier-selected geometry');
} finally {
  await browser.close();
}
