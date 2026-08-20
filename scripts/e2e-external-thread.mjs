/**
 * External-thread regression:
 *   analytic shaft cylinder selection → ISO M6 cosmetic thread → modeled
 *   60° helical B-rep → persisted exact-face definition and STEP metadata.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE = 'http://localhost:7199';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error)));

const M6_X_1_6G = {
  majorMin: 5.794,
  majorMax: 5.974,
  minorMin: 4.596,
  minorMax: 4.747,
};
const M10_X_1_5_6G = {
  majorMin: 9.732,
  majorMax: 9.968,
  minorMin: 7.938,
  minorMax: 8.128,
};
const MESH_RADIUS_TOLERANCE = 0.04;

const assertExternalGoNoGoEnvelope = (result, limits, label) => {
  assert.ok(
    result.minimumWallRadius >= limits.minorMin * 0.5 - MESH_RADIUS_TOLERANCE
      && result.minimumWallRadius <= limits.minorMax * 0.5 + MESH_RADIUS_TOLERANCE,
    `${label} root radius is outside the ISO 6g GO/no-go envelope: ${JSON.stringify(result)}`,
  );
  assert.ok(
    Math.abs(result.minimumWallRadius - limits.minorMax * 0.5)
      <= MESH_RADIUS_TOLERANCE,
    `${label} root does not reach the maximum-material GO boundary: ${JSON.stringify(result)}`,
  );
  assert.ok(
    result.maximumWallRadius >= limits.majorMin * 0.5 - MESH_RADIUS_TOLERANCE
      && result.maximumWallRadius <= limits.majorMax * 0.5 + MESH_RADIUS_TOLERANCE,
    `${label} crest radius is outside the ISO 6g GO/no-go envelope: ${JSON.stringify(result)}`,
  );
  assert.ok(
    Math.abs(result.maximumWallRadius - limits.majorMax * 0.5)
      <= MESH_RADIUS_TOLERANCE,
    `${label} crest does not reach the maximum-material GO boundary: ${JSON.stringify(result)}`,
  );
};

const decodeThreadMetadata = (step) => {
  const compactHeader = step
    .slice(0, step.indexOf('ENDSEC;'))
    .replace(/\s/g, '');
  const encoded = compactHeader.match(/NBCAD_THREAD_METADATA_V1_HEX=([0-9a-f]+)/)?.[1];
  if (!encoded) return null;
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(
    encoded.match(/../g).map((value) => Number.parseInt(value, 16)),
  )));
};

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(
    () => window.__appStore?.getState().document !== null && !!window.__engine,
  );

  const setup = await page.evaluate(async () => {
    const engine = window.__engine;
    const store = window.__appStore.getState();
    store.applySolidUpdate(await engine.newProject());
    await engine.beginSketch({ type: 'origin_plane', plane: 'xy' });
    await engine.setGridSnap(false);
    await engine.addCircle({
      mode: 'center_diameter',
      p1: { x: 0, y: 0 },
      p2: { x: 3, y: 0 },
      ctrl_held: true,
    });
    const ended = await engine.endSketch();
    store.setDocument(ended.document);
    store.setFinishedSketches(await engine.finishedSketches());
    const update = await engine.extrude({
      sketch_name: 'Sketch1',
      profile_indices: [0],
      operation: 'new_body',
      extent: { type: 'distance', distance: 10 },
      taper_angle_deg: 0,
      flip: false,
      target_body_ids: [],
    });
    store.applySolidUpdate(update);
    store.setMode('solid');
    const body = update.scene.bodies[0];
    const face = body.faces.find(
      (candidate) => candidate.cylinder
        && Math.abs(candidate.cylinder.radius - 3) < 1e-6,
    );
    if (!face) throw new Error('extruded M6 shaft did not expose an analytic cylinder');
    store.setSelectedBody(body.id);
    store.setSelectedFace(face.id);
    return {
      bodyId: body.id,
      faceId: face.id,
      faceKey: face.key,
      originalFaceCount: body.faces.length,
      originalEdgeCount: body.edges.length,
    };
  });

  await page.locator('button[title="External Thread"]').first().click();
  const dialog = page.getByTestId('body-feature-dialog');
  await dialog.waitFor({ state: 'visible' });
  await page.waitForFunction(() => !window.__appStore.getState().solidBusy);
  assert.equal(
    await page.getByTestId('external-thread-preset').inputValue(),
    'metric_coarse-6-1',
    'a 6 mm shaft selects the ISO M6 coarse preset',
  );
  assert.equal(
    await page.getByTestId('external-thread-representation').inputValue(),
    'simplified',
  );
  assert.equal(
    await page.getByTestId('body-feature-ok').isEnabled(),
    true,
    `external thread should be valid:\n${await dialog.innerText()}`,
  );
  await page.getByTestId('body-feature-ok').click();
  await page.waitForFunction(
    () => {
      const state = window.__appStore.getState();
      return state.constraintDialog !== null
        || (!state.solidBusy
          && state.document.features.some((feature) => feature.kind === 'external_thread'));
    },
    undefined,
    { timeout: 60_000 },
  );
  const creationError = await page.evaluate(
    () => window.__appStore.getState().constraintDialog?.message ?? null,
  );
  assert.equal(creationError, null, `external thread creation failed: ${creationError}`);

  await page.waitForFunction(
    () => window.__nativeViewportTransient().lines.some((layer) =>
      layer.pattern === 'solid'
      && layer.segments.length >= 60
      && (
        (Math.abs(layer.width - 2) < 1e-6 && Math.abs(layer.color[3] - 0.92) < 1e-6)
        || (Math.abs(layer.width - 1.25) < 1e-6 && Math.abs(layer.color[3] - 0.96) < 1e-6)
      )),
    undefined,
    { timeout: 30_000 },
  );
  const simplified = await page.evaluate(async () => {
    const definition = (await window.__engine.bodyFeatureDefinitions())
      .find((candidate) => candidate.type === 'external_thread');
    const layers = window.__nativeViewportTransient().lines
      .filter((layer) => layer.pattern === 'solid'
        && layer.segments.length >= 60
        && (
          (Math.abs(layer.width - 2) < 1e-6 && Math.abs(layer.color[3] - 0.92) < 1e-6)
          || (Math.abs(layer.width - 1.25) < 1e-6 && Math.abs(layer.color[3] - 0.96) < 1e-6)
        ))
      .map((layer) => {
        const radii = [];
        const angularBins = new Set();
        for (let index = 0; index + 2 < layer.segments.length; index += 3) {
          const x = layer.segments[index];
          const y = layer.segments[index + 1];
          radii.push(Math.hypot(x, y));
          const angle = (Math.atan2(y, x) + Math.PI * 2) % (Math.PI * 2);
          angularBins.add(Math.floor(angle / (Math.PI * 2) * 24));
        }
        return {
          radiusMin: Math.min(...radii),
          radiusMax: Math.max(...radii),
          angularBinCount: angularBins.size,
        };
      });
    return { definition, layers };
  });
  assert(simplified.definition, 'external thread definition is persisted');
  assert.equal(simplified.definition.face_id, setup.faceId);
  assert.equal(simplified.definition.face_key, setup.faceKey);
  assert.equal(simplified.definition.cylinder.radius, 3);
  assert.equal(simplified.definition.thread.designation, 'M6 x 1 - 6g');
  assert.equal(simplified.definition.thread.class, '6g');
  assert.equal(simplified.definition.thread.representation, 'simplified');
  assert.ok(simplified.layers.length >= 1, 'cosmetic shaft helix is published');
  assert.ok(
    simplified.layers.some(
      (layer) => layer.radiusMin >= 3 && layer.radiusMax < 3.05,
    ),
    'cosmetic helix is seated just outside the selected shaft cylinder',
  );
  assert.ok(
    simplified.layers.some((layer) => layer.angularBinCount >= 18),
    'cosmetic helix covers the complete shaft circumference',
  );

  const modeled = await page.evaluate(async ({ originalFaceCount, originalEdgeCount }) => {
    const engine = window.__engine;
    const store = window.__appStore.getState();
    const definition = (await engine.bodyFeatureDefinitions())
      .find((candidate) => candidate.type === 'external_thread');
    if (!definition) throw new Error('external thread definition disappeared before edit');
    const thread = { ...definition.thread, representation: 'modeled' };
    const update = await engine.editBodyFeature(definition.feature_id, {
      type: 'external_thread',
      request: {
        body_id: definition.body_id,
        face_id: definition.face_id,
        thread,
        flip: definition.flip,
      },
    });
    store.applySolidUpdate(update);
    const edited = (await engine.bodyFeatureDefinitions())
      .find((candidate) => candidate.type === 'external_thread');
    const body = update.scene.bodies.find((candidate) => candidate.id === definition.body_id)
      ?? update.scene.bodies[0];
    if (!body) throw new Error('modeled external thread removed the shaft body');
    const metadata = [{
      body_id: definition.body_id,
      feature_id: definition.feature_id,
      feature_name: definition.name,
      position_count: 1,
      external: true,
      predrill_diameter: definition.cylinder.radius * 2,
      thread,
    }];
    const bytes = await engine.exportStep({
      body_ids: [body.id],
      thread_metadata: metadata,
    });
    const step = new TextDecoder().decode(bytes);
    const wallRadii = [];
    for (let index = 0; index + 2 < body.mesh.positions.length; index += 3) {
      const x = body.mesh.positions[index];
      const y = body.mesh.positions[index + 1];
      const z = body.mesh.positions[index + 2];
      if (z > 0.1 && z < 9.9) wallRadii.push(Math.hypot(x, y));
    }
    return {
      errors: update.scene.errors,
      definition: edited,
      bodyId: body.id,
      definitionBodyId: definition.body_id,
      faceCount: body?.faces.length ?? 0,
      edgeCount: body?.edges.length ?? 0,
      positionCount: (body?.mesh.positions.length ?? 0) / 3,
      sceneBodyIds: update.scene.bodies.map((candidate) => candidate.id),
      topologyExpanded: (body?.faces.length ?? 0) > originalFaceCount
        && (body?.edges.length ?? 0) > originalEdgeCount,
      minimumWallRadius: Math.min(...wallRadii),
      maximumWallRadius: Math.max(...wallRadii),
      stepHasHelix: step.includes('B_SPLINE_CURVE_WITH_KNOTS')
        || step.includes('SURFACE_CURVE'),
      stepSolidCount: step.match(/MANIFOLD_SOLID_BREP/g)?.length ?? 0,
      metadata: step,
    };
  }, setup);

  assert.deepEqual(modeled.errors, []);
  assert.equal(modeled.definition.thread.representation, 'modeled');
  assert.ok(
    modeled.topologyExpanded,
    `modeled thread adds faces and edges: ${JSON.stringify(modeled)}`,
  );
  await page.waitForFunction(
    () => !window.__nativeViewportTransient().lines.some((layer) =>
      layer.pattern === 'solid'
      && layer.segments.length >= 60
      && (
        (Math.abs(layer.width - 2) < 1e-6 && Math.abs(layer.color[3] - 0.92) < 1e-6)
        || (Math.abs(layer.width - 1.25) < 1e-6 && Math.abs(layer.color[3] - 0.96) < 1e-6)
      )),
    undefined,
    { timeout: 30_000 },
  );
  assert.ok(modeled.stepHasHelix, 'STEP contains helical B-rep data');
  assert.equal(modeled.stepSolidCount, 1, 'STEP contains one connected threaded shaft');
  assertExternalGoNoGoEnvelope(modeled, M6_X_1_6G, 'modeled M6 x 1');
  const metadata = decodeThreadMetadata(modeled.metadata);
  assert.equal(metadata[0].external, true);
  assert.equal(metadata[0].predrill_diameter, 6);
  assert.equal(metadata[0].thread.designation, 'M6 x 1 - 6g');
  assert.equal(metadata[0].thread.class, '6g');

  const reversedAxisM10 = await page.evaluate(async () => {
    const engine = window.__engine;
    const store = window.__appStore.getState();
    store.applySolidUpdate(await engine.newProject());
    await engine.beginSketch({ type: 'origin_plane', plane: 'xy' });
    await engine.setGridSnap(false);
    await engine.addCircle({
      mode: 'center_diameter',
      p1: { x: 0, y: 0 },
      p2: { x: 5, y: 0 },
      ctrl_held: true,
    });
    const ended = await engine.endSketch();
    store.setDocument(ended.document);
    store.setFinishedSketches(await engine.finishedSketches());
    const extruded = await engine.extrude({
      sketch_name: 'Sketch1',
      profile_indices: [0],
      operation: 'new_body',
      extent: { type: 'distance', distance: 20 },
      taper_angle_deg: 0,
      flip: false,
      target_body_ids: [],
    });
    store.applySolidUpdate(extruded);
    const shaft = extruded.scene.bodies[0];
    const face = shaft.faces.find(
      (candidate) => candidate.cylinder
        && Math.abs(candidate.cylinder.radius - 5) < 1e-6,
    );
    if (!face?.cylinder) {
      throw new Error('extruded M10 shaft did not expose an analytic cylinder');
    }
    const threaded = await engine.bodyFeature({
      type: 'external_thread',
      request: {
        body_id: shaft.id,
        face_id: face.id,
        thread: {
          standard: 'iso_metric',
          series: 'metric_coarse',
          designation: 'M10 x 1.5 - 6g',
          class: '6g',
          nominal_diameter: 10,
          pitch: 1.5,
          threads_per_inch: null,
          hand: 'right',
          depth: null,
          representation: 'modeled',
          tap_drill_designation: null,
        },
        flip: false,
      },
    });
    store.applySolidUpdate(threaded);
    const result = threaded.scene.bodies.find((body) => body.id === shaft.id)
      ?? threaded.scene.bodies[0];
    const endCapAreas = [0, 20].map((expectedZ) => result?.faces
      .filter((candidate) => candidate.signature
        && Math.abs(candidate.signature.normal.z) > 0.99
        && Math.abs(candidate.signature.centroid.z - expectedZ) < 1e-5)
      .reduce((sum, candidate) => sum + candidate.signature.area, 0) ?? 0);
    const wallRadii = [];
    for (let index = 0; index + 2 < result.mesh.positions.length; index += 3) {
      const x = result.mesh.positions[index];
      const y = result.mesh.positions[index + 1];
      const z = result.mesh.positions[index + 2];
      if (z > 0.1 && z < 19.9) wallRadii.push(Math.hypot(x, y));
    }
    return {
      axisZ: face.cylinder.axis.z,
      errors: threaded.scene.errors,
      bodyCount: threaded.scene.bodies.length,
      faceCount: result?.faces.length ?? 0,
      edgeCount: result?.edges.length ?? 0,
      endCapAreas,
      minimumWallRadius: Math.min(...wallRadii),
      maximumWallRadius: Math.max(...wallRadii),
    };
  });
  assert.ok(
    reversedAxisM10.axisZ < -0.99,
    `regression requires the reversed -Z cylinder axis: ${JSON.stringify(reversedAxisM10)}`,
  );
  assert.deepEqual(reversedAxisM10.errors, []);
  assert.equal(reversedAxisM10.bodyCount, 1);
  assert.ok(reversedAxisM10.faceCount > 3, 'modeled M10 thread adds helical faces');
  assert.ok(reversedAxisM10.edgeCount > 3, 'modeled M10 thread adds helical edges');
  assertExternalGoNoGoEnvelope(
    reversedAxisM10,
    M10_X_1_5_6G,
    'modeled reversed-axis M10 x 1.5',
  );
  assert.ok(
    reversedAxisM10.endCapAreas.every((area) => (
      area > Math.PI * (M10_X_1_5_6G.minorMax * 0.5) ** 2 * 0.98
      && area < Math.PI * (M10_X_1_5_6G.majorMax * 0.5) ** 2 * 1.02
    )),
    `modeled M10 thread ends must remain inside its ISO 6g radial envelope: ${JSON.stringify(reversedAxisM10)}`,
  );
  assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join('\n')}`);
  console.log('  [ok] cosmetic external thread follows an exact analytic shaft cylinder');
  console.log('  [ok] modeled M6-6g thread persists and exports with external metadata');
  console.log('  [ok] modeled M10-6g full-length thread handles a reversed shaft axis');
} finally {
  await browser.close();
}
