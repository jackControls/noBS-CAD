/**
 * noBS CAD M2 solid-model end-to-end verification.
 *
 * Uses real UI clicks throughout:
 *   rectangle sketch → canvas profile selection → two-sided New Body Extrude →
 *   render/tree/select body → select planar face → choose sketch origin →
 *   sketch a circle on the face → timeline rollback/recompute → double-click
 *   Extrude to edit → signed inward Cut with the viewport manipulator →
 *   detached offset-plane Cut inference → explicit operation override →
 *   analytic slot arcs → rounded Extrude.
 */
import { chromium } from 'playwright';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'http://localhost:7199';
const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, '..', 'docs', 'qa', 'm2');

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  [${ok ? 'ok' : 'FAIL'}] ${name}${ok ? '' : ` — ${detail}`}`);
  if (!ok) failures += 1;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(() => {
  window.__testFiles = {};
  window.__savePickerCalls = [];
  const handle = (name) => ({
    kind: 'file',
    name,
    async createWritable() {
      return {
        async write(data) {
          const bytes =
            data instanceof Blob
              ? new Uint8Array(await data.arrayBuffer())
              : data instanceof ArrayBuffer
                ? new Uint8Array(data)
                : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
          window.__testFiles[name] = Array.from(bytes);
        },
        async close() {},
      };
    },
    async getFile() {
      const bytes = Uint8Array.from(window.__testFiles[name] ?? []);
      return {
        name,
        size: bytes.byteLength,
        async arrayBuffer() {
          return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        },
      };
    },
  });
  window.showSaveFilePicker = async (options) => {
    window.__savePickerCalls.push(options.suggestedName);
    return handle(options.suggestedName);
  };
  window.showOpenFilePicker = async (options = {}) => {
    const accepted = Object.values(options.types?.[0]?.accept ?? {}).flat();
    const acceptsStep = accepted.some(
      (extension) => extension === '.step' || extension === '.stp',
    );
    const requested = window.__nextOpenFile;
    const requestedAccepted =
      typeof requested === 'string' &&
      accepted.some((extension) => requested.toLowerCase().endsWith(extension));
    const name = requestedAccepted
      ? requested
      : Object.keys(window.__testFiles).find((entry) =>
          acceptsStep
            ? entry.endsWith('.step') || entry.endsWith('.stp')
            : entry.endsWith('.nbcad') || entry.endsWith('.tfcad'),
        );
    window.__nextOpenFile = null;
    return name ? [handle(name)] : [];
  };
});
const pageErrors = [];
page.on('pageerror', (error) => {
  pageErrors.push(String(error));
  console.log('PAGEERROR:', String(error).slice(0, 300));
});

const state = () => page.evaluate(() => window.__appStore.getState());
const shot = (name) => page.screenshot({ path: path.join(shots, `${name}.png`) });
const discardUnsavedChanges = async () => {
  const dialog = page.getByTestId('unsaved-changes-dialog');
  await dialog.waitFor({ state: 'visible' });
  await dialog.getByRole('button', { name: "Don't Save", exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
};
const clickSketch = async (x, y) => {
  const point = await page.evaluate(
    ([sx, sy]) => window.__sketchToScreen(sx, sy),
    [x, y],
  );
  await page.mouse.click(point.x, point.y);
};
const worldToScreen = ([x, y, z]) =>
  page.evaluate(
    ([wx, wy, wz]) => window.__worldToScreen(wx, wy, wz),
    [x, y, z],
  );

function faceCentroid(body, face) {
  const point = [0, 0, 0];
  let count = 0;
  const end = face.first_index + face.index_count;
  for (let offset = face.first_index; offset < end; offset += 1) {
    const vertex = body.mesh.indices[offset];
    if (vertex === undefined) continue;
    point[0] += body.mesh.positions[vertex * 3] ?? 0;
    point[1] += body.mesh.positions[vertex * 3 + 1] ?? 0;
    point[2] += body.mesh.positions[vertex * 3 + 2] ?? 0;
    count += 1;
  }
  return point.map((coordinate) => coordinate / Math.max(count, 1));
}

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1300);

  console.log('1. rectangular sketch');
  await page.getByRole('button', { name: 'Create Sketch' }).first().click();
  await page.waitForTimeout(350);
  if (!(await page.getByText('XY Plane', { exact: true }).isVisible())) {
    await page.getByRole('button', { name: 'Origin' }).click();
    await page.waitForTimeout(150);
  }
  await page.getByText('XY Plane', { exact: true }).click();
  await page.waitForTimeout(900);
  await page.locator('button[title="Rectangle"]').click();
  await clickSketch(-30, -20);
  await clickSketch(20, 20);
  await page.waitForTimeout(350);
  const rectangle = (await state()).activeSketch;
  check(
    'rectangle has four profile edges',
    rectangle.entities.filter((entity) => entity.kind === 'line').length === 4,
  );
  await page.getByRole('button', { name: 'FINISH SKETCH', exact: true }).click();
  await page.waitForTimeout(600);

  console.log('2. New Body Extrude through browser OpenCascade');
  await page.locator('button[title="Extrude"]').first().click();
  const dialog = page.getByTestId('extrude-dialog');
  await dialog.waitFor({ state: 'visible' });
  await page.waitForFunction(
    () => !window.__appStore.getState().solidBusy &&
      document.querySelectorAll('[data-testid="extrude-dialog"] input[type="checkbox"]').length > 0,
  );
  check(
    'closed profile is selected by default',
    await dialog.locator('input[type="checkbox"]').first().isChecked(),
  );
  await dialog.locator('input[type="checkbox"]').first().uncheck();
  const profilePoint = await worldToScreen([0, 0, 0]);
  const profileRef = await page.evaluate(() => {
    const picker = window.__appStore.getState().profilePicker;
    const profile = picker?.catalog[0]?.profiles.find(
      (candidate) => candidate.nesting_depth % 2 === 0,
    );
    return {
      sketchName: picker?.catalog[0]?.sketch_name,
      profileIndex: profile?.index,
    };
  });
  await page.mouse.move(profilePoint.x, profilePoint.y);
  await page.waitForFunction(
    () => window.__appStore.getState().profilePicker?.hovered !== null,
  );
  const hoverProfileVisual = await page.evaluate(
    ({ sketchName, profileIndex }) =>
      window.__profileVisualState(sketchName, profileIndex),
    profileRef,
  );
  check(
    'eligible profile hover gets a screen-space boundary',
    hoverProfileVisual.overlayKinds.includes('hover') &&
      hoverProfileVisual.overlayWidths.every(
        (width) => Math.abs(width - 1.5) < 1e-6,
      ),
    JSON.stringify(hoverProfileVisual),
  );
  await page.mouse.click(profilePoint.x, profilePoint.y);
  await page.waitForFunction(
    () => window.__appStore.getState().profilePicker?.selected.length === 1,
  );
  const selectedProfileVisual = await page.evaluate(
    ({ sketchName, profileIndex }) =>
      window.__profileVisualState(sketchName, profileIndex),
    profileRef,
  );
  check(
    'an enclosed profile can be selected directly in the viewport',
    await dialog.locator('input[type="checkbox"]').first().isChecked() &&
      selectedProfileVisual.overlayKinds.includes('selected') &&
      selectedProfileVisual.overlayWidths.every(
        (width) => Math.abs(width - 1.5) < 1e-6,
      ),
    JSON.stringify(selectedProfileVisual),
  );
  check(
    'New Body and Distance defaults are loaded',
    (await page.getByTestId('extrude-operation').inputValue()) === 'new_body' &&
      (await page.getByTestId('extrude-extent').inputValue()) === 'distance',
  );
  await page.getByTestId('extrude-extent').selectOption('two_sides');
  await page.getByTestId('extrude-second-distance').waitFor({ state: 'visible' });
  await page.getByTestId('extrude-distance').fill('14');
  await page.waitForFunction(
    () => document.querySelector('[data-testid="extrude-distance"]')?.value === '14',
  );
  await page.getByTestId('extrude-second-distance').fill('10');
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="extrude-second-distance"]')?.value ===
      '10',
  );
  check(
    'Two Sides exposes independent positive and negative distances',
    (await page.getByTestId('extrude-distance').inputValue()) === '14' &&
      (await page.getByTestId('extrude-second-distance').inputValue()) === '10',
  );
  await page.getByTestId('extrude-submit').click();
  await page.waitForFunction(
    () => window.__appStore.getState().solidScene.bodies.length === 1 &&
      !window.__appStore.getState().solidBusy,
    undefined,
    { timeout: 60_000 },
  );

  let app = await state();
  let body = app.solidScene.bodies[0];
  const originalBodyId = body.id;
  check(
    'OCCT returned a selectable mesh and topology',
    body.mesh.indices.length > 0 && body.faces.length >= 6 && body.edges.length >= 12,
    `triangles=${body.mesh.indices.length / 3} faces=${body.faces.length} edges=${body.edges.length}`,
  );
  check(
    'new body creation leaves viewport selection neutral',
    app.selectedBody === null &&
      app.selectedBodies.length === 0 &&
      app.selectedFace === null &&
      app.selectedFaces.length === 0 &&
      Number.isSafeInteger(body.id),
    `selectedBody=${app.selectedBody} selectedBodies=${app.selectedBodies.join(',')} body=${body.id}`,
  );
  await page.waitForTimeout(100);
  const stableOrbitCenter = await page.evaluate(async () => {
    const api = window.__cameraApi;
    const positions =
      window.__appStore.getState().solidScene.bodies[0].mesh.positions;
    const minimum = [Infinity, Infinity, Infinity];
    const maximum = [-Infinity, -Infinity, -Infinity];
    for (let index = 0; index < positions.length; index += 3) {
      for (let axis = 0; axis < 3; axis += 1) {
        minimum[axis] = Math.min(minimum[axis], positions[index + axis]);
        maximum[axis] = Math.max(maximum[axis], positions[index + axis]);
      }
    }
    const center = minimum.map(
      (value, axis) => (value + maximum[axis]) / 2,
    );
    const measure = () => {
      const snapshot = api.getSnapshot();
      const screen = api.worldToScreen(center);
      return {
        radius: Math.hypot(
          ...snapshot.position.map((value, axis) => value - center[axis]),
        ),
        screen,
      };
    };
    const initial = measure();
    window.__cameraApi.orbitBy(12, -8);
    const firstTouchpad = measure();
    await new Promise((resolve) => setTimeout(resolve, 260));
    window.__cameraApi.orbitBy(8, -5);
    const secondTouchpad = measure();
    window.__cameraApi.navigateSixDof({
      translation: [0, 0, 0],
      rotation: [0.35, 0, 0],
      deltaSeconds: 1 / 60,
    });
    const sixDof = measure();
    window.__cameraApi.fit();
    const radiusDrift = (sample) => Math.abs(sample.radius - initial.radius);
    const screenDrift = (sample) =>
      initial.screen && sample.screen
        ? Math.hypot(
            sample.screen.x - initial.screen.x,
            sample.screen.y - initial.screen.y,
          )
        : Infinity;
    return {
      center,
      firstOrbitRadiusDrift: radiusDrift(firstTouchpad),
      pausedOrbitRadiusDrift: radiusDrift(secondTouchpad),
      sixDofRadiusDrift: radiusDrift(sixDof),
      firstOrbitScreenDrift: screenDrift(firstTouchpad),
      pausedOrbitScreenDrift: screenDrift(secondTouchpad),
      sixDofScreenDrift: screenDrift(sixDof),
    };
  });
  check(
    'touchpad and 3D-mouse rotate around the visible body center',
    stableOrbitCenter.firstOrbitRadiusDrift < 1e-5 &&
      stableOrbitCenter.pausedOrbitRadiusDrift < 1e-5 &&
      stableOrbitCenter.sixDofRadiusDrift < 1e-5 &&
      stableOrbitCenter.firstOrbitScreenDrift < 0.05 &&
      stableOrbitCenter.pausedOrbitScreenDrift < 0.05 &&
      stableOrbitCenter.sixDofScreenDrift < 0.05,
    JSON.stringify(stableOrbitCenter),
  );
  await page.waitForTimeout(350);
  const neutralBodyVisual = await page.evaluate(
    (bodyId) => window.__solidBodyVisualState(bodyId),
    body.id,
  );
  check(
    'new body has no stale selection-role outline',
    !neutralBodyVisual.overlayKinds.includes('target') &&
      !neutralBodyVisual.overlayKinds.includes('selected'),
    JSON.stringify(neutralBodyVisual),
  );
  check(
    'Body1 appears in the browser tree',
    await page.getByRole('treeitem').filter({ hasText: /^Body1/ }).isVisible(),
  );
  check(
    'Sketch1 and Extrude1 are real timeline features',
    app.document.features.map((feature) => feature.name).join(',') === 'Sketch1,Extrude1',
    app.document.features.map((feature) => feature.name).join(','),
  );
  await shot('m2-01-new-body');

  console.log('3. planar-face selection and face sketch');
  const topFace = body.faces
    .filter((face) => face.plane)
    .map((face) => ({ face, centroid: faceCentroid(body, face) }))
    .sort((a, b) => b.centroid[2] - a.centroid[2])[0];
  const facePoint = await worldToScreen(topFace.centroid);
  await page.mouse.click(facePoint.x, facePoint.y);
  await page.waitForTimeout(300);
  app = await state();
  check(
    'viewport click selects the stable planar face',
    app.selectedFace === topFace.face.id,
    `selected=${app.selectedFace} face=${topFace.face.id}`,
  );
  const selectedFaceVisual = await page.evaluate(
    (faceId) => window.__solidFaceVisualState(faceId),
    topFace.face.id,
  );
  check(
    'selected face keeps a restrained perimeter',
    selectedFaceVisual.overlayKinds.includes('selected') &&
      selectedFaceVisual.overlayWidths.every(
        (width) => Math.abs(width - 1.5) < 1e-6,
      ),
    JSON.stringify(selectedFaceVisual),
  );
  await page.getByRole('button', { name: 'Create Sketch' }).first().click();
  const originDialog = page.getByTestId('sketch-plane-origin-dialog');
  await originDialog.waitFor({ state: 'visible' });
  check(
    'face sketch asks how to place its coordinate origin',
    await page.getByRole('radio', { name: /Center of selected face/ }).isChecked(),
  );
  await page.getByRole('radio', { name: /Project the global origin/ }).check();
  await page.getByTestId('sketch-plane-origin-ok').click();
  await page.waitForFunction(() => window.__appStore.getState().mode === 'sketch');
  app = await state();
  check(
    'Create Sketch starts on the selected face with the requested projected origin',
    app.activeSketch?.plane?.type === 'planar_face' &&
      app.activeSketch.plane.face_id === topFace.face.id &&
      Math.abs(app.activeSketch.basis.origin[0]) < 1e-6 &&
      Math.abs(app.activeSketch.basis.origin[1]) < 1e-6,
    JSON.stringify({
      plane: app.activeSketch?.plane,
      origin: app.activeSketch?.basis?.origin,
    }),
  );
  // Let the sketch-plane camera transition finish before testing screen-space
  // snap acquisition; clicking during the zoom can put -10 mm inside the
  // transient origin-suction radius.
  await page.waitForTimeout(500);
  await page.locator('button[title="Circle"]').click();
  await clickSketch(-10, 0);
  await clickSketch(0, 0);
  await page.waitForFunction(
    () =>
      window.__appStore
        .getState()
        .activeSketch?.entities.some((entity) => entity.kind === 'circle'),
  );
  check(
    'a circular cut profile can be sketched directly on the selected face',
    (await state()).activeSketch.entities.some((entity) => entity.kind === 'circle'),
  );
  await page.getByRole('button', { name: 'FINISH SKETCH', exact: true }).click();
  await page.waitForTimeout(500);
  app = await state();
  check(
    'face sketch is part of feature history',
    app.document.features.map((feature) => feature.name).join(',') ===
      'Sketch1,Extrude1,Sketch2',
  );
  await shot('m2-02-face-sketch');

  console.log('4. timeline rollback, replay, and edit');
  await page.locator('button[title="Previous feature"]').click();
  await page.waitForFunction(() => window.__appStore.getState().document.rollback_index === 2);
  await page.locator('button[title="Previous feature"]').click();
  await page.waitForFunction(
    () => window.__appStore.getState().document.rollback_index === 1 &&
      window.__appStore.getState().solidScene.bodies.length === 0,
  );
  check('rolling before Extrude removes the body', (await state()).solidScene.bodies.length === 0);
  await page.locator('button[title="Next feature"]').click();
  await page.waitForFunction(
    () => window.__appStore.getState().document.rollback_index === 2 &&
      window.__appStore.getState().solidScene.bodies.length === 1,
    undefined,
    { timeout: 60_000 },
  );
  app = await state();
  body = app.solidScene.bodies[0];
  check(
    'recompute restores the same stable Body ID',
    body.id === originalBodyId,
    `before=${originalBodyId} after=${body.id}`,
  );
  await page.locator('button[title="Latest feature"]').click();
  await page.waitForFunction(() => window.__appStore.getState().document.rollback_index === 3);
  app = await state();
  const extrude = app.document.features.find((feature) => feature.name === 'Extrude1');
  await page.locator(`[data-feature-id="${extrude.id}"]`).dblclick();
  await page.getByTestId('extrude-dialog').waitFor({ state: 'visible' });
  check(
    'double-click restores the saved two-sided Extrude definition',
    (await page.getByTestId('extrude-extent').inputValue()) === 'two_sides' &&
      (await page.getByTestId('extrude-distance').inputValue()) === '14' &&
      (await page.getByTestId('extrude-second-distance').inputValue()) === '10',
  );
  await page.getByRole('button', { name: 'Cancel' }).last().click();
  await shot('m2-03-history-restored');

  console.log('5. .nbcad ZIP Save/Open and real STEP export');
  await page.getByTestId('file-menu-button').click();
  const openProjectRow = page.getByRole('menuitem', { name: /Open Project/ });
  const fileRowBeforeHover = await openProjectRow.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  await openProjectRow.hover();
  const fileRowAfterHover = await openProjectRow.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  const fileRowCursor = await openProjectRow.evaluate(
    (element) => getComputedStyle(element).cursor,
  );
  check(
    'File menu rows use a pointer and visibly highlight under the cursor',
    fileRowCursor === 'pointer' && fileRowAfterHover !== fileRowBeforeHover,
    `${fileRowCursor}; ${fileRowBeforeHover} → ${fileRowAfterHover}`,
  );
  await page.getByRole('menuitem', { name: /Save As/ }).click();
  await page.waitForFunction(
    () => Object.keys(window.__testFiles).some((name) => name.endsWith('.nbcad')),
  );
  const nbcadName = await page.evaluate(
    () => Object.keys(window.__testFiles).find((name) => name.endsWith('.nbcad')),
  );
  const nbcadBytes = Uint8Array.from(
    await page.evaluate((name) => window.__testFiles[name], nbcadName),
  );
  const archive = unzipSync(nbcadBytes);
  const manifest = JSON.parse(strFromU8(archive['manifest.json']));
  const model = JSON.parse(strFromU8(archive['model.json']));
  check(
    '.nbcad is a normal ZIP with the versioned manifest/model pair',
    nbcadBytes[0] === 0x50 &&
      nbcadBytes[1] === 0x4b &&
      manifest.format === 'nbcad-project' &&
      manifest.container_version === 1 &&
      model.schema_version === 2,
  );
  check(
    'project model saves sketches/history/Extrude IDs but no mesh scene',
    model.sketches.length === 2 &&
      model.extrudes.length === 1 &&
      model.extrudes[0].new_body_ids[0] === originalBodyId &&
      model.scene === undefined,
  );
  check('Save clears dirty state', (await state()).dirty === false);

  // Change the live history, then prove Open transactionally restores and
  // recomputes the archive rather than reusing the old display mesh.
  await page.locator('button[title="Previous feature"]').click();
  await page.waitForFunction(() => window.__appStore.getState().document.rollback_index === 2);
  await page.getByTestId('file-menu-button').click();
  await page.getByRole('menuitem', { name: /Open Project/ }).click();
  await discardUnsavedChanges();
  await page.waitForFunction(
    () =>
      window.__appStore.getState().document.rollback_index === 3 &&
      window.__appStore.getState().solidScene.bodies.length === 1 &&
      !window.__appStore.getState().dirty,
    undefined,
    { timeout: 60_000 },
  );
  app = await state();
  check(
    'Open validates and recomputes the saved feature history',
    app.solidScene.bodies[0].id === originalBodyId &&
      app.document.features.map((feature) => feature.name).join(',') ===
        'Sketch1,Extrude1,Sketch2',
  );

  const legacyBytes = zipSync({
    'manifest.json': strToU8(
      JSON.stringify({ ...manifest, format: 'tfcad-project', application: 'legacy build' }),
    ),
    'model.json': strToU8(JSON.stringify({ ...model, format: 'tfcad-project' })),
  });
  await page.evaluate(
    ({ name, bytes }) => {
      window.__testFiles[name] = bytes;
      window.__nextOpenFile = name;
    },
    { name: 'Legacy.tfcad', bytes: Array.from(legacyBytes) },
  );
  await page.getByTestId('file-menu-button').click();
  await page.getByRole('menuitem', { name: /Open Project/ }).click();
  await page.waitForFunction(
    () =>
      window.__appStore.getState().projectFileName === 'Legacy.tfcad' &&
      !window.__appStore.getState().dirty,
    undefined,
    { timeout: 60_000 },
  );
  const savePickerCallsBeforeLegacySave = await page.evaluate(
    () => window.__savePickerCalls.length,
  );
  await page.getByTestId('file-menu-button').click();
  await page.getByRole('menuitem', { name: /^Save(?! As)/ }).click();
  await page.waitForFunction(
    (previousCalls) =>
      window.__savePickerCalls.length > previousCalls &&
      window.__appStore.getState().projectFileName.endsWith('.nbcad'),
    savePickerCallsBeforeLegacySave,
  );
  check(
    'legacy .tfcad opens, then Save migrates through a new .nbcad target',
    await page.evaluate(
      (previousCalls) =>
        window.__savePickerCalls.length === previousCalls + 1 &&
        window.__savePickerCalls.at(-1).endsWith('.nbcad'),
      savePickerCallsBeforeLegacySave,
    ),
  );

  await page.getByTestId('file-menu-button').click();
  await page.getByRole('menuitem', { name: /Export All Bodies as STEP/ }).click();
  await page.waitForFunction(
    () => Object.keys(window.__testFiles).some((name) => name.endsWith('.step')),
    undefined,
    { timeout: 60_000 },
  );
  const stepName = await page.evaluate(
    () => Object.keys(window.__testFiles).find((name) => name.endsWith('.step')),
  );
  const stepText = Buffer.from(
    await page.evaluate((name) => window.__testFiles[name], stepName),
  ).toString('utf8');
  check(
    'browser STEP export is an ISO-10303 AP242 B-rep file',
    stepText.startsWith('ISO-10303-21;') &&
      stepText.toUpperCase().includes('AP242') &&
      stepText.includes('MANIFOLD_SOLID_BREP') &&
      stepText.includes('END-ISO-10303-21;'),
    stepText.slice(0, 600).replace(/\s+/g, ' '),
  );

  const reopenedBodyItem = page.getByRole('treeitem').filter({ hasText: /^Body1/ });
  if (!(await reopenedBodyItem.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Bodies', exact: true }).click();
  }
  await reopenedBodyItem.click();
  await page.waitForFunction(() => window.__appStore.getState().selectedBody !== null);
  await page.getByTestId('file-menu-button').click();
  await page.getByRole('menuitem', { name: /Export Selected Body as STEP/ }).click();
  await page.waitForFunction(
    () => Object.keys(window.__testFiles).some((name) => name.includes('-Body1.step')),
    undefined,
    { timeout: 60_000 },
  );
  check(
    'selected-body STEP path is available separately',
    await page.evaluate(
      () => Object.keys(window.__testFiles).some((name) => name.includes('-Body1.step')),
    ),
  );
  await shot('m2-04-files-interchange');

  console.log('6. signed inward face Extrude becomes a Cut');
  app = await state();
  const beforeCutFaceCount = app.solidScene.bodies[0].faces.length;
  await page.locator('button[title="Extrude"]').first().click();
  await page.getByTestId('extrude-dialog').waitFor({ state: 'visible' });
  const signedDialog = page.getByTestId('extrude-dialog');
  check(
    'all Extrude Boolean operations are visible',
    await signedDialog.locator('[data-extrude-operation="new_body"]').isVisible() &&
      await signedDialog.locator('[data-extrude-operation="join"]').isVisible() &&
      await signedDialog.locator('[data-extrude-operation="cut"]').isVisible() &&
      await signedDialog.locator('[data-extrude-operation="intersect"]').isVisible(),
  );
  check(
    'one-sided Extrude exposes a viewport distance field and draggable arrow',
    await page.getByTestId('extrude-canvas-distance').isVisible() &&
      await page.getByTestId('extrude-direction-handle').isVisible(),
  );
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-extrude-operation="join"]')
        ?.getAttribute('aria-checked') === 'true' &&
      document.querySelectorAll(
        '[data-testid="extrude-dialog"] input[type="checkbox"]',
      )[1]?.checked === true,
  );
  check(
    'an outward face Extrude initially proposes Join with its support body',
    await signedDialog
      .locator('[data-extrude-operation="join"]')
      .getAttribute('aria-checked') === 'true' &&
      await signedDialog.locator('input[type="checkbox"]').nth(1).isChecked(),
  );
  await page.getByTestId('extrude-canvas-distance').fill('-10');
  await page.waitForFunction(
    () =>
      document.querySelector('[data-extrude-operation="cut"]')?.getAttribute('aria-checked') ===
        'true' &&
      document.querySelector('[data-testid="extrude-distance"]')?.value === '-10',
  );
  check(
    'negative viewport distance stays synchronized and proposes Cut',
    (await page.getByTestId('extrude-distance').inputValue()) === '-10' &&
      await signedDialog
        .locator('[data-extrude-operation="cut"]')
        .getAttribute('aria-checked') === 'true' &&
      await signedDialog.locator('input[type="checkbox"]').nth(1).isChecked(),
  );
  await page.getByTestId('extrude-submit').click();
  await page.waitForFunction(
    () =>
      !window.__appStore.getState().solidBusy &&
      window.__appStore.getState().document.features.at(-1)?.name === 'Extrude2',
    undefined,
    { timeout: 60_000 },
  );
  app = await state();
  const signedCut = app.document.features.at(-1);
  check(
    'signed face Extrude creates a valid circular Cut without a new body',
    app.solidScene.bodies.length === 1 &&
      app.solidScene.bodies[0].faces.length > beforeCutFaceCount &&
      signedCut?.status.state === 'ok',
    signedCut?.status.state === 'error'
      ? signedCut.status.message
      : `bodies=${app.solidScene.bodies.length} faces=${app.solidScene.bodies[0].faces.length}`,
  );
  await shot('m2-05-signed-face-cut');

  console.log('7. an offset-plane Extrude back into a body becomes a Cut');
  await page.mouse.click(1200, 750);
  await page.locator('button[title="Offset Plane"]').click();
  const offsetDialog = page.getByTestId('construction-plane-dialog');
  await offsetDialog.waitFor({ state: 'visible' });
  await offsetDialog.getByLabel('Reference plane').selectOption('origin:xy');
  await offsetDialog.getByLabel('Offset distance (mm)').fill('30');
  await page.getByTestId('construction-plane-ok').click();
  await page.waitForFunction(
    () =>
      window.__appStore.getState().datumPlanes.length === 1 &&
      window.__appStore.getState().document.features.at(-1)?.kind ===
        'construction_plane',
  );
  app = await state();
  const offsetPlane = app.datumPlanes[0];
  check(
    'Offset Plane creates a detached sketch support 30 mm above XY',
    Math.abs(offsetPlane.basis.origin[2] - 30) < 1e-6,
    `z=${offsetPlane.basis.origin[2]}`,
  );

  await page.getByRole('button', { name: 'Create Sketch' }).first().click();
  await page.waitForFunction(() => window.__appStore.getState().mode === 'pickPlane');
  const constructionFolder = page
    .getByRole('treeitem')
    .filter({ hasText: /^Construction/ })
    .first();
  if ((await constructionFolder.getAttribute('aria-expanded')) !== 'true') {
    await constructionFolder.getByRole('button', { name: 'Construction' }).click();
  }
  await page
    .getByRole('treeitem')
    .filter({ hasText: new RegExp(`^${offsetPlane.name}`) })
    .first()
    .click();
  await page.waitForFunction(() => window.__appStore.getState().mode === 'sketch');
  await page.locator('li').filter({ hasText: /^Snap/ }).click();
  await page.locator('button[title="Circle"]').click();
  await clickSketch(8, 0);
  await clickSketch(13, 0);
  await page.waitForFunction(
    () =>
      window.__appStore
        .getState()
        .activeSketch?.entities.some((entity) => entity.kind === 'circle'),
  );
  await page.getByRole('button', { name: 'FINISH SKETCH', exact: true }).click();
  await page.waitForFunction(() => window.__appStore.getState().mode === 'solid');

  app = await state();
  const beforeOffsetCutFaceCount = app.solidScene.bodies[0].faces.length;
  await page.locator('button[title="Extrude"]').first().click();
  await page.getByTestId('extrude-dialog').waitFor({ state: 'visible' });
  check(
    'a detached extrusion pointing away from all bodies proposes New Body',
    await page
      .getByTestId('extrude-dialog')
      .locator('[data-extrude-operation="new_body"]')
      .getAttribute('aria-checked') === 'true',
  );
  await page.getByTestId('extrude-canvas-distance').fill('-20');
  await page.waitForFunction(
    () =>
      document.querySelector('[data-extrude-operation="cut"]')?.getAttribute(
        'aria-checked',
      ) === 'true' &&
      document
        .querySelector('[data-testid="extrude-auto-operation"]')
        ?.textContent?.includes('Body1'),
  );
  check(
    'crossing the gap and entering Body1 automatically selects Cut and its target',
    await page
      .getByTestId('extrude-dialog')
      .locator('[data-extrude-operation="cut"]')
      .getAttribute('aria-checked') === 'true' &&
      await page
        .getByTestId('extrude-dialog')
        .locator('input[type="checkbox"]')
        .nth(1)
        .isChecked(),
  );
  await page.getByTestId('extrude-submit').click();
  await page.waitForFunction(
    () =>
      !window.__appStore.getState().solidBusy &&
      window.__appStore.getState().document.features.at(-1)?.kind === 'extrude',
    undefined,
    { timeout: 60_000 },
  );
  app = await state();
  const offsetCut = app.document.features.at(-1);
  check(
    'offset-plane Cut removes material while preserving the target Body ID',
    app.solidScene.bodies.length === 1 &&
      app.solidScene.bodies[0].id === originalBodyId &&
      app.solidScene.bodies[0].faces.length > beforeOffsetCutFaceCount &&
      offsetCut.status.state === 'ok',
    offsetCut.status.state === 'error'
      ? offsetCut.status.message
      : `bodies=${app.solidScene.bodies.length} faces=${app.solidScene.bodies[0].faces.length}`,
  );
  await shot('m2-06-offset-plane-cut');

  console.log('8. analytic sketch arcs survive browser Extrude');
  await page.getByRole('button', { name: 'Create Sketch' }).first().click();
  await page.waitForTimeout(250);
  if (!(await page.getByText('XY Plane', { exact: true }).isVisible())) {
    await page.getByRole('button', { name: 'Origin' }).click();
  }
  await page.getByText('XY Plane', { exact: true }).click();
  await page.waitForFunction(() => window.__appStore.getState().mode === 'sketch');
  await page.locator('button[title="Slot"]').click();
  await clickSketch(-25, -35);
  await clickSketch(25, -35);
  await clickSketch(25, -25);
  await page.waitForFunction(
    () => window.__appStore.getState().activeSketch.entities.filter((entity) => entity.kind === 'arc').length === 2,
  );
  await page.getByRole('button', { name: 'FINISH SKETCH', exact: true }).click();
  await page.waitForFunction(() => window.__appStore.getState().mode === 'solid');
  await page.locator('button[title="Extrude"]').first().click();
  await page.getByTestId('extrude-dialog').waitFor({ state: 'visible' });
  await page
    .getByTestId('extrude-dialog')
    .locator('[data-extrude-operation="new_body"]')
    .click();
  check(
    'an explicit New Body choice overrides automatic intersection inference',
    await page
      .getByTestId('extrude-dialog')
      .locator('[data-extrude-operation="new_body"]')
      .getAttribute('aria-checked') === 'true' &&
      !(await page.getByTestId('extrude-auto-operation').isVisible().catch(() => false)),
  );
  await page.getByTestId('extrude-submit').click();
  await page.waitForFunction(
    () => !window.__appStore.getState().solidBusy,
    undefined,
    { timeout: 60_000 },
  );
  app = await state();
  const roundedBody = app.solidScene.bodies.at(-1);
  const roundedExtrude = app.document.features.at(-1);
  check(
    'OpenCascade.js accepts the analytic arc handle and creates a body',
    app.solidScene.bodies.length === 2 && roundedExtrude?.status.state === 'ok',
    roundedExtrude?.status.state === 'error' ? roundedExtrude.status.message : `bodies=${app.solidScene.bodies.length}`,
  );
  const curvedFaceCount = (roundedBody?.faces ?? []).filter((face) => face.plane === null).length;
  check(
    'each slot arc becomes one continuous curved side face',
    curvedFaceCount === 2,
    `curved faces=${curvedFaceCount}`,
  );
  await shot('m2-07-analytic-arc-extrude');

  console.log('9. browser STEP import is persistent feature history');
  const bodiesBeforeImport = app.solidScene.bodies.length;
  await page.getByTestId('file-menu-button').click();
  await page.getByRole('menuitem', { name: /Import STEP/ }).click();
  await page.waitForFunction(
    (before) => {
      const current = window.__appStore.getState();
      return (
        !current.solidBusy &&
        current.solidScene.bodies.length === before + 1 &&
        current.document.features.at(-1)?.kind === 'import_step'
      );
    },
    bodiesBeforeImport,
    { timeout: 60_000 },
  );
  app = await state();
  const importedFeature = app.document.features.at(-1);
  const importedBody = app.solidScene.bodies.at(-1);
  check(
    'browser OpenCascade imports STEP as a selectable body and history event',
    importedFeature?.status.state === 'ok' &&
      app.solidScene.bodies.length === bodiesBeforeImport + 1 &&
      app.selectedBody === importedBody?.id,
    importedFeature?.status.state === 'error'
      ? importedFeature.status.message
      : `bodies=${app.solidScene.bodies.length}`,
  );

  await page.getByTestId('file-menu-button').click();
  await page.getByRole('menuitem', { name: /Save As/ }).click();
  await page.waitForFunction(() => !window.__appStore.getState().dirty);
  const importedProjectName = await page.evaluate(
    () => window.__appStore.getState().projectFileName,
  );
  const importedArchiveBytes = Uint8Array.from(
    await page.evaluate((name) => window.__testFiles[name], importedProjectName),
  );
  const importedArchive = unzipSync(importedArchiveBytes);
  const importedModel = JSON.parse(strFromU8(importedArchive['model.json']));
  const importedDefinition = importedModel.body_features.find(
    (feature) => feature.type === 'import_step',
  );
  check(
    '.nbcad embeds the imported STEP source for host-neutral recompute',
    importedDefinition?.file_name === stepName &&
      typeof importedDefinition.data_base64 === 'string' &&
      importedDefinition.data_base64.length > 1_000 &&
      importedModel.scene === undefined,
  );
  await shot('m2-08-step-import');

  check('no page errors during M2 e2e', pageErrors.length === 0, pageErrors.join(' | '));
} finally {
  await browser.close();
}

if (failures > 0) {
  console.error(`\ne2e-m2: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('\ne2e-m2: all checks passed');
