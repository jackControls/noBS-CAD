/**
 * Threaded-hole regression:
 *   ISO M6 cut-tap preset → modeled 60° helical B-rep → persisted definition
 *   → AP242 export with versioned manufacturing metadata.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE = 'http://localhost:7199';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error)));

const M6_X_1_6H = {
  majorMin: 6.000,
  pitchMin: 5.350,
  pitchMax: 5.500,
  minorMin: 4.917,
  minorMax: 5.153,
};
const MESH_RADIUS_TOLERANCE = 0.04;

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(
    () => window.__appStore?.getState().document !== null && !!window.__engine,
  );

  let setup = await page.evaluate(async () => {
    const engine = window.__engine;
    const store = window.__appStore.getState();
    store.applySolidUpdate(await engine.newProject());
    await engine.beginSketch({ type: 'origin_plane', plane: 'xy' });
    await engine.addRectangle({
      mode: 'two_point',
      p1: { x: -10, y: -10 },
      p2: { x: 10, y: 10 },
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
    const body = update.scene.bodies[0];
    const face = body.faces
      .filter((candidate) => candidate.plane)
      .sort((a, b) => b.plane.origin[2] - a.plane.origin[2])[0];
    const world = { x: 0, y: 0, z: 10 };
    store.setMode('solid');
    store.setSelectedBody(body.id);
    store.setSelectedFace(face.id);
    store.setSelectedFacePoint(world);
    return { bodyId: body.id };
  });

  await page.locator('button[title="Hole"]').first().click();
  const dialog = page.getByTestId('hole-dialog');
  await dialog.waitFor({ state: 'visible' });
  await page.waitForFunction(() => !window.__appStore.getState().solidBusy);
  await page.getByTestId('hole-threaded').check();

  // Verify both standards drive the predrill before returning to modeled M6.
  await page.getByTestId('hole-thread-standard').selectOption('unified_inch');
  await page.getByTestId('hole-thread-size').selectOption('unc-1/4-20');
  assert.equal(await page.getByTestId('hole-diameter').inputValue(), '5.1054');
  await page.getByTestId('hole-thread-standard').selectOption('iso_metric');
  await page.getByTestId('hole-thread-size').selectOption('metric_coarse-6-1');
  assert.equal(await page.getByTestId('hole-diameter').inputValue(), '5');
  assert.equal(
    await page.getByTestId('hole-thread-representation').inputValue(),
    'modeled',
  );
  await page.getByTestId('hole-thread-representation').selectOption('simplified');

  await page.getByTestId('hole-ok').click();
  await page.waitForFunction(
    () =>
      window.__appStore
        .getState()
        .document.features.some((feature) => feature.name === 'Hole1')
      && !window.__appStore.getState().solidBusy,
    undefined,
    { timeout: 60_000 },
  );

  await page.waitForFunction(
    () => {
      const cosmeticLayers = window.__nativeViewportTransient().lines.filter(
        (layer) => layer.pattern === 'solid' && layer.segments.length >= 60,
      );
      return cosmeticLayers.length >= 2;
    },
    undefined,
    { timeout: 30_000 },
  );
  const simplifiedPresentation = await page.evaluate(async () => ({
    definition: (await window.__engine.holeDefinitions())[0],
    cosmeticLayers: window.__nativeViewportTransient().lines
      .filter((layer) => layer.pattern === 'solid' && layer.segments.length >= 60)
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
          color: layer.color,
          positionCount: layer.segments.length / 3,
          radialMin: Math.min(...radii),
          radialMax: Math.max(...radii),
          angularBinCount: angularBins.size,
        };
      }),
  }));
  assert.equal(simplifiedPresentation.definition.thread.representation, 'simplified');
  assert.ok(
    simplifiedPresentation.cosmeticLayers.every((layer) => layer.positionCount >= 3),
    'simplified thread publishes native cosmetic helix linework',
  );
  assert.ok(
    simplifiedPresentation.cosmeticLayers.every(
      (layer) => layer.radialMin > 2.49 && layer.radialMax <= 2.5,
    ),
    'cosmetic thread is seated against the 5 mm OCCT bore wall',
  );
  assert.ok(
    simplifiedPresentation.cosmeticLayers.every((layer) => layer.angularBinCount >= 18),
    'cosmetic thread covers the complete bore circumference',
  );

  // Move/Copy is intentionally after Hole in history. The hole definition's
  // cached support basis remains at creation time, while the final OCCT
  // cylinder is translated and rotated. Cosmetic thread linework must follow
  // that current analytic face instead of being stranded at the old basis.
  await page.evaluate(async ({ bodyId }) => {
    const halfSqrt = Math.SQRT1_2;
    const update = await window.__engine.bodyFeature({
      type: 'move_copy',
      request: {
        body_ids: [bodyId],
        translation: { x: 12, y: -7, z: 3 },
        rotation: [0, halfSqrt, 0, halfSqrt],
        pivot: { x: 0, y: 0, z: 0 },
        copy: false,
      },
    });
    window.__appStore.getState().applySolidUpdate(update);
  }, setup);
  await page.waitForFunction(
    () => {
      if (window.__appStore.getState().solidBusy) return false;
      return window.__nativeViewportTransient().lines.some((layer) => {
        if (layer.segments.length < 60) return false;
        const radii = [];
        const axial = [];
        for (let index = 0; index + 2 < layer.segments.length; index += 3) {
          const x = layer.segments[index];
          const y = layer.segments[index + 1];
          const z = layer.segments[index + 2];
          axial.push(x);
          radii.push(Math.hypot(y + 7, z - 3));
        }
        return Math.min(...radii) > 2.49
          && Math.max(...radii) <= 2.5
          && Math.min(...axial) > 12
          && Math.max(...axial) < 22;
      });
    },
    undefined,
    { timeout: 30_000 },
  );
  const movedPresentation = await page.evaluate(() =>
    window.__nativeViewportTransient().lines
      .filter((layer) => layer.segments.length >= 60)
      .map((layer) => {
        const points = [];
        for (let index = 0; index + 2 < layer.segments.length; index += 3) {
          points.push([
            layer.segments[index],
            layer.segments[index + 1],
            layer.segments[index + 2],
          ]);
        }
        return {
          axialMinimum: Math.min(...points.map((point) => point[0])),
          axialMaximum: Math.max(...points.map((point) => point[0])),
          radialMinimum: Math.min(
            ...points.map((point) => Math.hypot(point[1] + 7, point[2] - 3)),
          ),
          radialMaximum: Math.max(
            ...points.map((point) => Math.hypot(point[1] + 7, point[2] - 3)),
          ),
        };
      }),
  );
  assert.ok(
    movedPresentation.some(
      (layer) => layer.axialMinimum > 12
        && layer.axialMaximum < 22
        && layer.radialMinimum > 2.49
        && layer.radialMaximum <= 2.5,
    ),
    'cosmetic thread follows the moved and rotated analytic OCCT cylinder',
  );

  // Continue the existing modeled-thread topology/export regression on a
  // fresh fixture. This keeps the exact-topology assertion independent of
  // feature-edit replay while still proving that cosmetic presentation is
  // removed as soon as the document no longer owns a simplified thread.
  setup = await page.evaluate(async () => {
    const engine = window.__engine;
    const store = window.__appStore.getState();
    store.applySolidUpdate(await engine.newProject());
    await engine.beginSketch({ type: 'origin_plane', plane: 'xy' });
    await engine.addRectangle({
      mode: 'two_point',
      p1: { x: -10, y: -10 },
      p2: { x: 10, y: 10 },
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
    const body = update.scene.bodies[0];
    const face = body.faces
      .filter((candidate) => candidate.plane)
      .sort((a, b) => b.plane.origin[2] - a.plane.origin[2])[0];
    store.setMode('solid');
    store.setSelectedBody(body.id);
    store.setSelectedFace(face.id);
    store.setSelectedFacePoint({ x: 0, y: 0, z: 10 });
    return { bodyId: body.id };
  });
  await page.locator('button[title="Hole"]').first().click();
  await page.getByTestId('hole-dialog').waitFor({ state: 'visible' });
  await page.waitForFunction(() => !window.__appStore.getState().solidBusy);
  await page.getByTestId('hole-threaded').check();
  await page.getByTestId('hole-ok').click();
  await page.waitForFunction(
    () =>
      window.__appStore
        .getState()
        .document.features.some((feature) => feature.name === 'Hole1')
        && !window.__appStore.getState().solidBusy
        && window.__nativeViewportTransient().lines.every(
          (layer) => layer.segments.length < 60,
        ),
    undefined,
    { timeout: 60_000 },
  );

  const result = await page.evaluate(async ({ bodyId }) => {
    let stage = 'read persisted thread';
    try {
      const engine = window.__engine;
      const definitions = await engine.holeDefinitions();
      const metadata = [{
        body_id: bodyId,
        feature_id: definitions[0].feature_id,
        feature_name: definitions[0].name,
        position_count: 1,
        external: false,
        predrill_diameter: definitions[0].diameter,
        thread: definitions[0].thread,
      }];
      stage = 'export AP242';
      const stepBytes = await engine.exportStep({
        body_ids: [bodyId],
        thread_metadata: metadata,
      });
      const step = new TextDecoder().decode(stepBytes);
      const compactHeader = step
        .slice(0, step.indexOf('ENDSEC;'))
        .replace(/\s/g, '');
      const encoded = compactHeader.match(/NBCAD_THREAD_METADATA_V1_HEX=([0-9a-f]+)/)?.[1];
      const decoded = encoded
        ? new TextDecoder().decode(Uint8Array.from(
            encoded.match(/../g).map((value) => Number.parseInt(value, 16)),
          ))
        : '';
      const scene = window.__appStore.getState().solidScene;
      const body = scene.bodies[0];
      const wallRadii = [];
      let minimumHoleEdgeChordRadius = Number.POSITIVE_INFINITY;
      if (body) {
        for (let offset = 0; offset + 2 < body.mesh.positions.length; offset += 3) {
          const x = body.mesh.positions[offset];
          const y = body.mesh.positions[offset + 1];
          const z = body.mesh.positions[offset + 2];
          const radius = Math.hypot(x, y);
          if (z > 0.1 && z < 9.9 && radius > 1 && radius < 4) {
            wallRadii.push(radius);
          }
        }
        for (const edge of body.edges) {
          for (let index = 1; index < edge.points.length; index += 1) {
            const a = edge.points[index - 1];
            const b = edge.points[index];
            if (Math.hypot(a.x, a.y) >= 4 || Math.hypot(b.x, b.y) >= 4) continue;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const denominator = dx * dx + dy * dy;
            const parameter = denominator > 1e-12
              ? Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / denominator))
              : 0;
            minimumHoleEdgeChordRadius = Math.min(
              minimumHoleEdgeChordRadius,
              Math.hypot(a.x + dx * parameter, a.y + dy * parameter),
            );
          }
        }
      }
      const axisCoverCount = (() => {
        if (!body) return -1;
        const pointInsideTriangle = (
          px, py,
          ax, ay,
          bx, by,
          cx, cy,
        ) => {
          const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
          if (Math.abs(area) < 1e-10) return false;
          const first = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area;
          const second = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area;
          const third = 1 - first - second;
          return first >= -1e-8 && second >= -1e-8 && third >= -1e-8;
        };
        let count = 0;
        for (let offset = 0; offset + 2 < body.mesh.indices.length; offset += 3) {
          const triangle = body.mesh.indices
            .slice(offset, offset + 3)
            .map((vertex) => body.mesh.positions.slice(vertex * 3, vertex * 3 + 3));
          if (pointInsideTriangle(
            0,
            0,
            triangle[0][0],
            triangle[0][1],
            triangle[1][0],
            triangle[1][1],
            triangle[2][0],
            triangle[2][1],
          )) {
            count += 1;
          }
        }
        return count;
      })();
      const internalThreadCapFaces = (() => {
        if (!body) return [];
        return body.faces.flatMap((face) => {
          if (!face.plane) return [];
          let minimumRadius = Number.POSITIVE_INFINITY;
          let maximumRadius = Number.NEGATIVE_INFINITY;
          let minimumZ = Number.POSITIVE_INFINITY;
          let maximumZ = Number.NEGATIVE_INFINITY;
          const end = face.first_index + face.index_count;
          for (let offset = face.first_index; offset < end; offset += 1) {
            const vertex = body.mesh.indices[offset];
            const x = body.mesh.positions[vertex * 3];
            const y = body.mesh.positions[vertex * 3 + 1];
            const z = body.mesh.positions[vertex * 3 + 2];
            const radius = Math.hypot(x, y);
            minimumRadius = Math.min(minimumRadius, radius);
            maximumRadius = Math.max(maximumRadius, radius);
            minimumZ = Math.min(minimumZ, z);
            maximumZ = Math.max(maximumZ, z);
          }
          const internal = minimumRadius > 2.2
            && maximumRadius < 3.2
            && minimumZ > 0.2
            && maximumZ < 9.8;
          return internal
            ? [{
                key: face.key,
                normal: face.plane.normal,
                minimumRadius,
                maximumRadius,
                minimumZ,
                maximumZ,
              }]
            : [];
        });
      })();
      const threadSectionCounts = (() => {
        if (!body) return [];
        const triangles = [];
        for (let offset = 0; offset + 2 < body.mesh.indices.length; offset += 3) {
          triangles.push(body.mesh.indices
            .slice(offset, offset + 3)
            .map((vertex) => body.mesh.positions.slice(vertex * 3, vertex * 3 + 3)));
        }
        const isInsideSolid = ([px, py, pz]) => {
          let winding = 0;
          for (const triangle of triangles) {
            const vectors = triangle.map(([x, y, z]) => [x - px, y - py, z - pz]);
            const [a, b, c] = vectors;
            const aLength = Math.hypot(...a);
            const bLength = Math.hypot(...b);
            const cLength = Math.hypot(...c);
            const cross = [
              b[1] * c[2] - b[2] * c[1],
              b[2] * c[0] - b[0] * c[2],
              b[0] * c[1] - b[1] * c[0],
            ];
            const numerator = a[0] * cross[0] + a[1] * cross[1] + a[2] * cross[2];
            const denominator = aLength * bLength * cLength
              + (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) * cLength
              + (b[0] * c[0] + b[1] * c[1] + b[2] * c[2]) * aLength
              + (c[0] * a[0] + c[1] * a[1] + c[2] * a[2]) * bLength;
            winding += 2 * Math.atan2(numerator, denominator);
          }
          return Math.abs(winding) > Math.PI * 2;
        };
        return Array.from({ length: 12 }, (_, angleIndex) => {
          const angle = angleIndex * Math.PI * 2 / 12;
          let material = 0;
          let groove = 0;
          for (let phaseIndex = 0; phaseIndex < 24; phaseIndex += 1) {
            const z = 6.02 + (phaseIndex + 0.5) * 0.96 / 24;
            if (isInsideSolid([
              Math.cos(angle) * 2.75,
              Math.sin(angle) * 2.75,
              z,
            ])) {
              material += 1;
            } else {
              groove += 1;
            }
          }
          return { material, groove };
        });
      })();
      stage = 're-import exported AP242';
      let binary = '';
      for (let offset = 0; offset < stepBytes.length; offset += 32_768) {
        binary += String.fromCharCode(...stepBytes.subarray(offset, offset + 32_768));
      }
      await engine.newProject();
      const imported = await engine.bodyFeature({
        type: 'import_step',
        request: {
          file_name: 'threaded-hole.step',
          data_base64: btoa(binary),
        },
      });
      return {
        errors: scene.errors,
        faceCount: scene.bodies[0]?.faces.length ?? 0,
        edgeCount: scene.bodies[0]?.edges.length ?? 0,
        axisCoverCount,
        internalThreadCapFaces,
        threadSectionCounts,
        wallRadiusMin: Math.min(...wallRadii),
        wallRadiusMax: Math.max(...wallRadii),
        minimumHoleEdgeChordRadius,
        definition: definitions[0],
        stepHasHelix: step.includes('B_SPLINE_CURVE_WITH_KNOTS')
          || step.includes('SURFACE_CURVE'),
        stepSolidCount: step.match(/MANIFOLD_SOLID_BREP/g)?.length ?? 0,
        metadata: decoded ? JSON.parse(decoded) : null,
        importErrors: imported.scene.errors,
        importedBodyCount: imported.scene.bodies.length,
      };
    } catch (error) {
      return {
        stage,
        caughtError: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      };
    }
  }, setup);

  assert.equal(result.caughtError, undefined, `${result.stage}: ${result.caughtError}`);
  assert.deepEqual(result.errors, []);
  assert.ok(result.faceCount > 7, 'modeled thread adds helical faces');
  assert.ok(result.edgeCount > 16, 'modeled thread adds helical topology');
  assert.equal(result.axisCoverCount, 0, 'modeled through-hole removes its predrill core');
  assert.equal(
    result.internalThreadCapFaces.length,
    0,
    `modeled thread has no planar cutter caps inside the hole: ${
      JSON.stringify(result.internalThreadCapFaces)
    }`,
  );
  result.threadSectionCounts.forEach(({ material, groove }, angleIndex) => {
    assert.ok(
      material >= 4 && groove >= 4,
      `thread section ${angleIndex} must alternate between material and an open groove (${material} material, ${groove} groove)`,
    );
  });
  assert.ok(
    result.wallRadiusMin >= M6_X_1_6H.minorMin * 0.5 - MESH_RADIUS_TOLERANCE
      && result.wallRadiusMin <= M6_X_1_6H.minorMax * 0.5 + MESH_RADIUS_TOLERANCE,
    `internal 6H minor radius is outside its GO/no-go envelope: ${result.wallRadiusMin}`,
  );
  assert.ok(
    Math.abs(result.wallRadiusMin - M6_X_1_6H.minorMin * 0.5)
      <= MESH_RADIUS_TOLERANCE,
    `internal 6H minor radius does not reach the maximum-material GO boundary: ${result.wallRadiusMin}`,
  );
  assert.ok(
    Math.abs(result.wallRadiusMax - M6_X_1_6H.majorMin * 0.5)
      <= MESH_RADIUS_TOLERANCE,
    `internal 6H major radius does not reach the maximum-material GO boundary: ${result.wallRadiusMax}`,
  );
  assert.ok(
    M6_X_1_6H.pitchMin <= M6_X_1_6H.pitchMax,
    'internal 6H pitch-diameter GO/no-go envelope is ordered',
  );
  assert.ok(
    result.minimumHoleEdgeChordRadius > M6_X_1_6H.minorMin * 0.5 - 0.08,
    `displayed thread edges stay on the wall instead of crossing the cavity: ${result.minimumHoleEdgeChordRadius}`,
  );
  assert.equal(result.definition.thread.designation, 'M6 x 1 - 6H');
  assert.equal(result.definition.thread.representation, 'modeled');
  assert.ok(result.stepHasHelix, 'STEP contains non-cylindrical helical B-rep data');
  assert.equal(result.stepSolidCount, 1, 'STEP contains one connected threaded solid');
  assert.equal(result.metadata[0].thread.designation, 'M6 x 1 - 6H');
  assert.deepEqual(result.importErrors, []);
  assert.equal(result.importedBodyCount, 1);
  assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join('\n')}`);
  console.log('  [ok] simplified thread uses visual-only native wall treatment');
  console.log('  [ok] modeled ISO thread persists and exports with metadata');
} finally {
  await browser.close();
}
