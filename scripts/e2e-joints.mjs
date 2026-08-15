/** Assembly joints: exact references, persistence, solving, and live poses. */
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

  console.log('1. Create two independent bodies and select planar connectors');
  const selected = await page.evaluate(async () => {
    const engine = window.__engine;
    const store = window.__appStore.getState();
    store.applySolidUpdate(await engine.newProject());
    await engine.beginSketch({ type: 'origin_plane', plane: 'xy' });
    await engine.setGridSnap(false);
    await engine.addRectangle({
      mode: 'two_point',
      p1: { x: -30, y: -10 },
      p2: { x: -10, y: 10 },
      ctrl_held: true,
    });
    await engine.addRectangle({
      mode: 'two_point',
      p1: { x: 10, y: -10 },
      p2: { x: 30, y: 10 },
      ctrl_held: true,
    });
    const ended = await engine.endSketch();
    store.setDocument(ended.document);
    store.setFinishedSketches(await engine.finishedSketches());
    store.setMode('solid');
    const catalog = await engine.profileCatalog();
    const profiles = catalog[0].profiles
      .filter((profile) => profile.nesting_depth === 0)
      .sort((a, b) => a.index - b.index);
    if (profiles.length !== 2) throw new Error(`expected two profiles, got ${profiles.length}`);

    let update;
    for (const profile of profiles) {
      update = await engine.extrude({
        source_face: null,
        sketch_name: catalog[0].sketch_name,
        profile_indices: [profile.index],
        operation: 'new_body',
        extent: { type: 'distance', distance: 10 },
        taper_angle_deg: 0,
        flip: false,
        target_body_ids: [],
      });
      store.applySolidUpdate(update);
    }
    if (update.scene.bodies.length !== 2) {
      throw new Error(`expected two bodies, got ${update.scene.bodies.length}`);
    }
    const connectors = update.scene.bodies.map((body) => {
      const face = body.faces.find((candidate) =>
        candidate.plane
        && candidate.plane.normal[2] > 0.9
        && candidate.plane.origin[2] > 9,
      );
      if (!face) throw new Error(`${body.name} has no top planar face`);
      return { bodyId: body.id, faceId: face.id, faceKey: face.key };
    });
    return connectors;
  });
  assert.equal(selected.length, 2);
  assert.notEqual(selected[0].bodyId, selected[1].bodyId);

  console.log('1b. Native command previews expose signed offset and six-axis Move/Copy intent');
  await page.evaluate((bodyId) => {
    const store = window.__appStore.getState();
    store.replaceSelectedBodies([bodyId]);
    store.openBodyFeatureDialog('move_copy');
  }, selected[0].bodyId);
  const moveCopyDialog = page.getByTestId('body-feature-dialog');
  await moveCopyDialog.waitFor({ state: 'visible' });
  await page.waitForFunction(
    () => window.__appStore.getState().solidCommandPreview?.kind === 'move_copy',
  );
  assert.match(await moveCopyDialog.innerText(), /°/);
  assert.equal(await page.getByTestId('move-copy-translate-x-handle').count(), 1);
  assert.equal(await page.getByTestId('move-copy-rotate-z-handle').count(), 1);
  const translationX = moveCopyDialog.getByLabel('Translation X');
  await page.waitForFunction(
    () => document.activeElement?.getAttribute('aria-label') === 'Translation X',
  );
  await page.keyboard.type('5');
  await page.waitForFunction(
    () => window.__appStore.getState().solidCommandPreview?.kind === 'move_copy'
      && window.__appStore.getState().solidCommandPreview.translation.x === 5,
  );
  const gizmoHitTargets = await page.evaluate(() => {
    const translate = document.querySelector('[data-testid="move-copy-translate-x-handle"]');
    const rotate = document.querySelector('[data-testid="move-copy-rotate-x-handle"]');
    if (!(translate instanceof HTMLElement) || !(rotate instanceof HTMLElement)) return null;
    const translationStyle = getComputedStyle(translate);
    const translationRect = translate.getBoundingClientRect();
    const rotationRect = rotate.getBoundingClientRect();
    return {
      shaftWidth: Number.parseFloat(translationStyle.width),
      centerSeparation: Math.hypot(
        translationRect.x + translationRect.width / 2 - rotationRect.x - rotationRect.width / 2,
        translationRect.y + translationRect.height / 2 - rotationRect.y - rotationRect.height / 2,
      ),
    };
  });
  assert.ok(gizmoHitTargets?.shaftWidth >= 90, 'the complete translation arrow is pointer-active');
  assert.ok(gizmoHitTargets?.centerSeparation >= 10, 'rotation bead is separated from translation arrow');
  const movePreview = await page.evaluate(
    () => window.__appStore.getState().solidCommandPreview,
  );
  assert.equal(movePreview.targets.length, 1);
  assert.equal(movePreview.showSixAxisGizmo, true);

  const translateHandle = page.getByTestId('move-copy-translate-x-handle');
  await translateHandle.hover();
  await page.waitForFunction(() => {
    const interaction = window.__appStore.getState().solidCommandPreview?.gizmoInteraction;
    return interaction?.kind === 'translate' && interaction.axis === 0 && !interaction.active;
  });

  // A ring must rotate about the exact oriented axis represented by its bead,
  // even after another Euler component is already non-zero. Directly editing
  // the X Euler field here would instead rotate about a Y-tilted world axis.
  await moveCopyDialog.getByLabel('Rotation Y').fill('30');
  await page.waitForFunction(() => {
    const preview = window.__appStore.getState().solidCommandPreview;
    return preview?.kind === 'move_copy' && Math.abs(preview.rotation[1]) > 0.1;
  });
  const rotationBefore = await page.evaluate(
    () => window.__appStore.getState().solidCommandPreview.rotation,
  );
  const rotateHandle = page.getByTestId('move-copy-rotate-x-handle');
  await rotateHandle.hover();
  await page.waitForFunction(() => {
    const interaction = window.__appStore.getState().solidCommandPreview?.gizmoInteraction;
    return interaction?.kind === 'rotate' && interaction.axis === 0 && !interaction.active;
  });
  const rotateBox = await rotateHandle.boundingBox();
  assert.ok(rotateBox);
  const rotateX = rotateBox.x + rotateBox.width / 2;
  const rotateY = rotateBox.y + rotateBox.height / 2;
  await page.mouse.move(rotateX, rotateY);
  await page.mouse.down();
  await page.waitForFunction(
    () => window.__appStore.getState().solidCommandPreview?.gizmoInteraction?.active === true,
  );
  await page.mouse.move(rotateX + 80, rotateY + 37, { steps: 6 });
  await page.mouse.up();
  await page.waitForFunction(() => {
    const preview = window.__appStore.getState().solidCommandPreview;
    return preview?.kind === 'move_copy' && preview.gizmoInteraction === null;
  });
  const rotationAfter = await page.evaluate(
    () => window.__appStore.getState().solidCommandPreview.rotation,
  );
  const multiplyQuaternion = (a, b) => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
  const relativeRotation = multiplyQuaternion(rotationAfter, [
    -rotationBefore[0],
    -rotationBefore[1],
    -rotationBefore[2],
    rotationBefore[3],
  ]);
  assert.ok(Math.abs(relativeRotation[0]) > 1e-3, 'rotation bead changed its selected X axis');
  assert.ok(
    Math.abs(relativeRotation[1]) < Math.abs(relativeRotation[0]) * 0.03,
    `rotation bead did not leak into Y: ${relativeRotation.join(', ')}`,
  );
  assert.ok(
    Math.abs(relativeRotation[2]) < Math.abs(relativeRotation[0]) * 0.03,
    `rotation bead did not leak into Z: ${relativeRotation.join(', ')}`,
  );
  await page.evaluate(() => window.__appStore.getState().closeBodyFeatureDialog());
  await moveCopyDialog.waitFor({ state: 'hidden' });

  await page.evaluate(({ bodyId, faceId }) => {
    const store = window.__appStore.getState();
    store.replaceSelectedFaces(bodyId, [faceId]);
    store.openConstructionPlaneDialog('offset');
  }, selected[0]);
  const offsetDialog = page.getByTestId('construction-plane-dialog');
  await offsetDialog.waitFor({ state: 'visible' });
  await page.waitForFunction(
    () => window.__appStore.getState().solidCommandPreview?.kind === 'offset_plane',
  );
  const initialOffsetPreview = await page.evaluate(
    () => window.__appStore.getState().solidCommandPreview,
  );
  assert.equal(initialOffsetPreview.distance, 10);
  assert.ok(initialOffsetPreview.halfSize.every((value) => value >= 8));
  assert.equal(await page.getByTestId('offset-plane-direction-handle').count(), 1);
  await offsetDialog.locator('input[type="number"]').fill('-12.5');
  await page.waitForFunction(
    () => window.__appStore.getState().solidCommandPreview?.kind === 'offset_plane'
      && window.__appStore.getState().solidCommandPreview.distance === -12.5,
  );
  await page.evaluate(() => {
    const store = window.__appStore.getState();
    store.closeConstructionPlaneDialog();
    store.clearSolidSelection();
  });
  await offsetDialog.waitFor({ state: 'hidden' });

  console.log('2. Solid Modeling assembly sub-function creates a cylindrical joint');
  await page.locator('[data-ribbon-button="assemblyBrowser"]').click();
  await page.getByTestId('assembly-browser').waitFor({ state: 'visible' });
  await page.locator('[data-ribbon-button="createJoint"]').click();
  const dialog = page.getByTestId('joint-dialog');
  await dialog.waitFor({ state: 'visible' });
  assert.match(await dialog.innerText(), /Flip direction/i);
  await page.evaluate((connectors) => {
    const store = window.__appStore.getState();
    const bodies = store.solidScene.bodies;
    for (const entry of connectors) {
      const face = bodies
        .find((body) => body.id === entry.bodyId)
        ?.faces.find((candidate) => candidate.id === entry.faceId);
      if (!face?.plane) throw new Error('test connector is not planar');
      store.toggleJointConnectorPick({
        body_id: entry.bodyId,
        face_id: entry.faceId,
        face_key: entry.faceKey,
        kind: 'planar_face',
        frame: {
          origin: face.signature
            ? [face.signature.centroid.x, face.signature.centroid.y, face.signature.centroid.z]
            : face.plane.origin,
          primary_axis: face.plane.normal,
          secondary_axis: face.plane.u,
        },
      });
    }
  }, selected);
  assert.match(await dialog.innerText(), /2\/2/);
  await dialog.getByTestId('joint-name').fill('Main hinge');
  await dialog.locator('select').selectOption('cylindrical');
  await dialog.getByTestId('joint-create-angle-value').fill('12.5');
  await dialog.getByTestId('joint-create-linear-value').fill('3');
  await page.waitForFunction(
    () => window.__appStore.getState().jointPreviewSolution?.body_poses.length === 2,
  );
  const preview = await page.evaluate((fixedBodyId) => {
    const solution = window.__appStore.getState().jointPreviewSolution;
    return {
      fixed: solution?.body_poses.find((pose) => pose.body_id === fixedBodyId),
      moving: solution?.body_poses.find((pose) => pose.body_id !== fixedBodyId),
    };
  }, selected[0].bodyId);
  assert.deepEqual(preview.fixed?.translation, [0, 0, 0]);
  assert.ok(preview.moving?.translation.some((value) => Math.abs(value) > 1e-6));
  await dialog.locator('button[type="submit"]').click();
  await page.waitForFunction(
    () => window.__appStore.getState().assemblyDocument.joints.length === 1,
  );

  const result = await page.evaluate(async () => {
    const engineDocument = await window.__engine.assemblyDocument();
    const model = JSON.parse(await window.__engine.exportProjectModel());
    const joint = engineDocument.joints[0];
    return {
      engineDocument,
      savedAssembly: model.assembly,
      selectedFaces: window.__appStore.getState().selectedFaces,
      joint,
      solution: await window.__engine.assemblySolution(),
    };
  });
  assert.equal(result.joint.name, 'Main hinge');
  assert.equal(result.joint.kind, 'cylindrical');
  assert.equal(result.joint.angle_offset_deg, 12.5);
  assert.equal(result.joint.linear_offset_mm, 3);
  assert.equal(result.joint.connector_a.face_key, selected[0].faceKey);
  assert.equal(result.joint.connector_b.face_key, selected[1].faceKey);
  assert.deepEqual(result.savedAssembly, result.engineDocument);
  assert.equal(result.engineDocument.grounded_body_id, selected[0].bodyId);
  assert.equal(result.solution.solved, true);
  assert.equal(result.solution.body_poses.length, 2);
  assert.deepEqual(result.selectedFaces, [], 'successful creation clears transient face selection');

  console.log('2a. Application Undo/Redo treats the joint as one assembly command');
  const solidHistoryBeforeAssemblyUndo = await page.evaluate(() => ({
    features: structuredClone(window.__appStore.getState().document.features),
    bodyIds: window.__appStore.getState().solidScene.bodies.map((body) => body.id),
  }));
  await page.keyboard.press('Control+z');
  await page.waitForFunction(() => window.__appStore.getState().assemblyDocument.joints.length === 0);
  const afterAssemblyUndo = await page.evaluate(async () => ({
    features: window.__appStore.getState().document.features,
    bodyIds: window.__appStore.getState().solidScene.bodies.map((body) => body.id),
    engineJointCount: (await window.__engine.assemblyDocument()).joints.length,
  }));
  assert.deepEqual(afterAssemblyUndo.features, solidHistoryBeforeAssemblyUndo.features);
  assert.deepEqual(afterAssemblyUndo.bodyIds, solidHistoryBeforeAssemblyUndo.bodyIds);
  assert.equal(afterAssemblyUndo.engineJointCount, 0);

  await page.keyboard.press('Control+Shift+z');
  await page.waitForFunction(
    (jointId) => window.__appStore.getState().assemblyDocument.joints[0]?.id === jointId,
    result.joint.id,
  );
  const afterAssemblyRedo = await page.evaluate(async () => ({
    features: window.__appStore.getState().document.features,
    bodyIds: window.__appStore.getState().solidScene.bodies.map((body) => body.id),
    assembly: await window.__engine.assemblyDocument(),
  }));
  assert.deepEqual(afterAssemblyRedo.features, solidHistoryBeforeAssemblyUndo.features);
  assert.deepEqual(afterAssemblyRedo.bodyIds, solidHistoryBeforeAssemblyUndo.bodyIds);
  assert.equal(afterAssemblyRedo.assembly.joints[0]?.id, result.joint.id);

  console.log('2b. Moving the fixed body routes to component placement and rebases the connected mechanism');
  const anchoredMoveBefore = await page.evaluate((fixedBodyId) => {
    const state = window.__appStore.getState();
    const definition = state.assemblyDocument.component_structure.definitions.find(
      (candidate) => candidate.body_ids.includes(fixedBodyId),
    );
    const occurrence = state.assemblyDocument.component_structure.occurrences.find(
      (candidate) => candidate.component_id === definition?.id,
    );
    if (!occurrence) throw new Error('fixed body has no component occurrence');
    state.setSelectedOccurrenceId(null);
    state.replaceSelectedBodies([fixedBodyId]);
    state.openBodyFeatureDialog('move_copy');
    return {
      occurrenceId: occurrence.id,
      localPose: occurrence.local_pose,
      occurrencePoses: state.assemblySolution.occurrence_poses,
    };
  }, selected[0].bodyId);
  await moveCopyDialog.waitFor({ state: 'visible' });
  await page.waitForFunction(() => {
    const preview = window.__appStore.getState().solidCommandPreview;
    return preview?.kind === 'move_copy'
      && preview.transformInBodySpace === false
      && preview.targets.length === 2;
  });
  assert.match(await moveCopyDialog.innerText(), /mechanism anchor/i);
  await moveCopyDialog.getByLabel('Translation X').fill('13');
  await moveCopyDialog.getByLabel('Rotation Z').fill('37');
  await page.waitForTimeout(100);
  const anchoredPreview = await page.evaluate(
    () => window.__appStore.getState().solidCommandPreview,
  );
  assert.equal(anchoredPreview?.kind, 'move_copy');
  assert.ok(Math.abs(anchoredPreview.translation.x - 13) < 1e-9);
  assert.ok(
    Math.abs(anchoredPreview.rotation[2]) > 0.1,
    `expected a Z rotation preview, got ${anchoredPreview.rotation.join(', ')}`,
  );
  await moveCopyDialog.locator('button[type="submit"]').click();
  await moveCopyDialog.waitFor({ state: 'hidden' });
  await page.waitForFunction(
    (occurrenceId) => window.__appStore.getState().assemblyDocument.component_structure.occurrences
      .find((candidate) => candidate.id === occurrenceId)?.local_pose.translation[0] !== 0,
    anchoredMoveBefore.occurrenceId,
  );
  const anchoredMoveResult = await page.evaluate((before) => {
    const state = window.__appStore.getState();
    const after = state.assemblySolution.occurrence_poses;
    const beforeRoot = before.occurrencePoses.find(
      (pose) => pose.occurrence_id === before.occurrenceId,
    );
    const afterRoot = after.find((pose) => pose.occurrence_id === before.occurrenceId);
    if (!beforeRoot || !afterRoot) throw new Error('root occurrence pose is missing');
    const multiply = (a, b) => [
      a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
      a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
      a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
      a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
    ];
    const rotate = (point, quaternion) => {
      const [qx, qy, qz, qw] = quaternion;
      const [x, y, z] = point;
      const uv = [qy * z - qz * y, qz * x - qx * z, qx * y - qy * x];
      const uuv = [
        qy * uv[2] - qz * uv[1],
        qz * uv[0] - qx * uv[2],
        qx * uv[1] - qy * uv[0],
      ];
      return point.map((value, index) => value + 2 * (qw * uv[index] + uuv[index]));
    };
    const inverseRoot = [
      -beforeRoot.rotation[0],
      -beforeRoot.rotation[1],
      -beforeRoot.rotation[2],
      beforeRoot.rotation[3],
    ];
    const deltaRotation = multiply(afterRoot.rotation, inverseRoot);
    const rotatedBeforeRoot = rotate(beforeRoot.translation, deltaRotation);
    const deltaTranslation = afterRoot.translation.map(
      (value, index) => value - rotatedBeforeRoot[index],
    );
    let maximumPositionError = 0;
    let minimumRotationDot = 1;
    for (const original of before.occurrencePoses) {
      const moved = after.find((pose) => pose.occurrence_id === original.occurrence_id);
      if (!moved) continue;
      const expectedTranslation = rotate(original.translation, deltaRotation).map(
        (value, index) => value + deltaTranslation[index],
      );
      maximumPositionError = Math.max(
        maximumPositionError,
        Math.hypot(...moved.translation.map(
          (value, index) => value - expectedTranslation[index],
        )),
      );
      const expectedRotation = multiply(deltaRotation, original.rotation);
      minimumRotationDot = Math.min(
        minimumRotationDot,
        Math.abs(expectedRotation.reduce(
          (sum, value, index) => sum + value * moved.rotation[index],
          0,
        )),
      );
    }
    return {
      solved: state.assemblySolution.solved,
      maximumPositionError,
      minimumRotationDot,
    };
  }, anchoredMoveBefore);
  assert.equal(anchoredMoveResult.solved, true);
  assert.ok(anchoredMoveResult.maximumPositionError < 1e-6);
  assert.ok(anchoredMoveResult.minimumRotationDot > 1 - 1e-8);
  await page.evaluate(async (before) => {
    await window.__appStore.getState().setOccurrencePose(before.occurrenceId, before.localPose);
    window.__appStore.getState().clearSolidSelection();
  }, anchoredMoveBefore);

  console.log('3. Joint is a first-class model-browser object and highlights both references');
  await page
    .getByTestId('assembly-browser')
    .getByRole('button', { name: 'MODEL', exact: true })
    .click();
  const modelBrowserJoint = page.locator(`[data-browser-joint-id="${result.joint.id}"]`);
  await modelBrowserJoint.waitFor({ state: 'visible' });
  assert.match(await modelBrowserJoint.innerText(), /Main hinge/i);
  await modelBrowserJoint.click();
  const highlighted = await page.evaluate(() => window.__appStore.getState().selectedFaces);
  assert.deepEqual(highlighted, selected.map((entry) => entry.faceId));
  const viewportCanvas = page.locator('main canvas').first();
  const viewportBox = await viewportCanvas.boundingBox();
  assert.ok(viewportBox, 'viewport canvas is visible');
  await page.mouse.click(
    viewportBox.x + viewportBox.width * 0.12,
    viewportBox.y + viewportBox.height * 0.18,
  );
  await page.waitForFunction(() => {
    const state = window.__appStore.getState();
    return state.selectedJointId === null
      && state.selectedBodies.length === 0
      && state.selectedFaces.length === 0
      && state.selectedEdges.length === 0
      && state.selectedOccurrenceId === null;
  });
  await modelBrowserJoint.click();
  await modelBrowserJoint.click({ button: 'right' });
  assert.equal(
    await page.getByRole('menuitem', { name: 'Edit joint' }).count(),
    1,
    'model-browser joints expose assembly actions',
  );
  await page.keyboard.press('Escape');
  await page.locator('[data-ribbon-button="assemblyBrowser"]').click();
  await page.getByTestId('assembly-browser').waitFor({ state: 'visible' });

  console.log('4. Live cylindrical motion previews both DOFs and saves a named position without overwriting the joint');
  await page.getByTestId('joint-motion-angle-value').fill('45');
  await page.getByTestId('joint-motion-linear-value').fill('7');
  await page.waitForFunction(
    () => window.__appStore.getState().jointMotionPreview?.angleOffsetDeg === 45
      && window.__appStore.getState().jointMotionPreview?.linearOffsetMm === 7,
  );
  const motion = await page.evaluate(() => {
    const state = window.__appStore.getState();
    const bodyId = state.assemblyDocument.joints[0].connector_b.body_id;
    const solved = state.jointMotionPreview.solution.body_poses.find((pose) => pose.body_id === bodyId);
    return {
      solved,
      displayed: window.__solidBodyDisplayPose?.(bodyId) ?? null,
      savedAngle: state.assemblyDocument.joints[0].angle_offset_deg,
      savedLinear: state.assemblyDocument.joints[0].linear_offset_mm,
    };
  });
  assert.equal(motion.savedAngle, 12.5, 'preview must not mutate the saved joint angle');
  assert.equal(motion.savedLinear, 3, 'preview must not mutate the saved joint slide');
  assert.ok(motion.solved);
  assert.ok(motion.displayed);
  assert.deepEqual(motion.displayed.translation, motion.solved.translation);
  for (let index = 0; index < 4; index += 1) {
    assert.ok(Math.abs(motion.displayed.rotation[index] - motion.solved.rotation[index]) < 1e-9);
  }
  await page.getByTestId('joint-position-capture').getByRole('button', { name: /Save position/i }).click();
  await page.waitForFunction(
    () => window.__appStore.getState().assemblyDocument.positions.length === 1
      && window.__appStore.getState().jointMotionPreview === null,
  );
  const assemblyPanelOverflow = await page.evaluate(() => {
    const structure = document.querySelector('[data-testid="assembly-structure-scroll"]');
    const motion = document.querySelector('[data-testid="joint-motion-panel"]');
    return {
      structure: structure ? getComputedStyle(structure).overflowY : null,
      motion: motion ? getComputedStyle(motion).overflowY : null,
    };
  });
  assert.equal(assemblyPanelOverflow.structure, 'auto');
  assert.notEqual(
    assemblyPanelOverflow.motion,
    'auto',
    'Joints, Motion, and diagnostics share one scrollbar instead of overlapping',
  );
  const savedPositionResult = await page.evaluate(async () => {
    const document = await window.__engine.assemblyDocument();
    return {
      joint: document.joints[0],
      position: document.positions[0],
    };
  });
  const captured = savedPositionResult.position.motions
    .find((motion) => motion.joint_id === savedPositionResult.joint.id);
  assert.ok(captured);
  assert.equal(captured.angle_offset_deg, 45);
  assert.equal(captured.linear_offset_mm, 7);
  assert.equal(savedPositionResult.joint.angle_offset_deg, 12.5);
  assert.equal(savedPositionResult.joint.linear_offset_mm, 3);

  console.log('5. Direct cylindrical dragging follows the cursor along the fixed connector axis');
  const dragSetup = await page.evaluate(() => {
    const state = window.__appStore.getState();
    const joint = state.assemblyDocument.joints[0];
    const fixedBodyId = state.assemblyDocument.grounded_body_id ?? joint.connector_a.body_id;
    const movingBodyId = fixedBodyId === joint.connector_a.body_id
      ? joint.connector_b.body_id
      : joint.connector_a.body_id;
    const fixedConnector = fixedBodyId === joint.connector_a.body_id
      ? joint.connector_a
      : joint.connector_b;
    const body = state.solidScene.bodies.find((candidate) => candidate.id === movingBodyId);
    if (!body) throw new Error('moving joint body is missing');
    const poseFor = (bodyId) => window.__solidBodyDisplayPose?.(bodyId) ?? {
      translation: [0, 0, 0],
      rotation: [0, 0, 0, 1],
    };
    const rotate = (point, quaternion) => {
      const [qx, qy, qz, qw] = quaternion;
      const [x, y, z] = point;
      const uv = [
        qy * z - qz * y,
        qz * x - qx * z,
        qx * y - qy * x,
      ];
      const uuv = [
        qy * uv[2] - qz * uv[1],
        qz * uv[0] - qx * uv[2],
        qx * uv[1] - qy * uv[0],
      ];
      return point.map((value, index) => value + 2 * (qw * uv[index] + uuv[index]));
    };
    const transform = (point, pose) =>
      rotate(point, pose.rotation).map((value, index) => value + pose.translation[index]);
    const positions = body.mesh.positions;
    const minimum = [Infinity, Infinity, Infinity];
    const maximum = [-Infinity, -Infinity, -Infinity];
    for (let index = 0; index < positions.length; index += 3) {
      for (let axis = 0; axis < 3; axis += 1) {
        minimum[axis] = Math.min(minimum[axis], positions[index + axis]);
        maximum[axis] = Math.max(maximum[axis], positions[index + axis]);
      }
    }
    const localCenter = minimum.map((value, index) => (value + maximum[index]) / 2);
    const movingPose = poseFor(movingBodyId);
    const worldCenter = transform(localCenter, movingPose);
    const fixedPose = poseFor(fixedBodyId);
    const axis = rotate(fixedConnector.frame.primary_axis, fixedPose.rotation);
    const origin = transform(fixedConnector.frame.origin, fixedPose);
    const centerScreen = window.__worldToScreen(...worldCenter);
    const originScreen = window.__worldToScreen(...origin);
    const axisScreen = window.__worldToScreen(
      origin[0] + axis[0] * 10,
      origin[1] + axis[1] * 10,
      origin[2] + axis[2] * 10,
    );
    const dx = axisScreen.x - originScreen.x;
    const dy = axisScreen.y - originScreen.y;
    const length = Math.hypot(dx, dy);
    if (length < 1) throw new Error('joint axis is too close to the view direction for a drag test');
    return {
      movingBodyId,
      localCenter,
      startScreen: centerScreen,
      screenAxis: { x: dx / length, y: dy / length },
    };
  });
  await page.mouse.move(dragSetup.startScreen.x, dragSetup.startScreen.y);
  await page.mouse.down();
  await page.mouse.move(
    dragSetup.startScreen.x + dragSetup.screenAxis.x * 80,
    dragSetup.startScreen.y + dragSetup.screenAxis.y * 80,
    { steps: 8 },
  );
  await page.mouse.up();
  await page.waitForFunction(
    (savedLinear) => window.__appStore.getState().jointMotionPreview?.linearOffsetMm > savedLinear,
    captured.linear_offset_mm,
  );
  const dragResult = await page.evaluate(({ movingBodyId, localCenter, startScreen, screenAxis }) => {
    const pose = window.__solidBodyDisplayPose(movingBodyId);
    const [qx, qy, qz, qw] = pose.rotation;
    const [x, y, z] = localCenter;
    const uv = [qy * z - qz * y, qz * x - qx * z, qx * y - qy * x];
    const uuv = [
      qy * uv[2] - qz * uv[1],
      qz * uv[0] - qx * uv[2],
      qx * uv[1] - qy * uv[0],
    ];
    const world = localCenter.map(
      (value, index) => value + 2 * (qw * uv[index] + uuv[index]) + pose.translation[index],
    );
    const endScreen = window.__worldToScreen(...world);
    return {
      alongCursor: (endScreen.x - startScreen.x) * screenAxis.x
        + (endScreen.y - startScreen.y) * screenAxis.y,
      preview: window.__appStore.getState().jointMotionPreview,
    };
  }, dragSetup);
  assert.ok(dragResult.alongCursor > 1, `moving component reversed by ${dragResult.alongCursor}px`);
  assert.ok(dragResult.preview.linearOffsetMm > captured.linear_offset_mm);
  await page.getByTestId('joint-position-capture').getByRole('button', { name: /Revert/i }).click();
  await page.waitForFunction(() => window.__appStore.getState().jointMotionPreview === null);

  console.log('6. Rotational dragging follows the cursor from either side and with either body grounded');
  const verifyRotationalDrag = async ({
    groundedBodyId,
    cameraDirection,
    linearOffsetMm,
    label,
  }) => {
    await page.evaluate(async ({ groundedBodyId, cameraDirection, linearOffsetMm }) => {
      const state = window.__appStore.getState();
      const jointId = state.assemblyDocument.joints[0].id;
      await state.setGroundedBody(groundedBodyId);
      await window.__appStore.getState().setJointMotion(jointId, 0, linearOffsetMm);
      window.__cameraApi.fit();
      await new Promise((resolve) => setTimeout(resolve, 380));
      window.__cameraApi.snapToDirection(cameraDirection);
    }, { groundedBodyId, cameraDirection, linearOffsetMm });
    await page.waitForTimeout(320);

    const setup = await page.evaluate((cameraDirection) => {
      const state = window.__appStore.getState();
      const joint = state.assemblyDocument.joints[0];
      const fixedBodyId = state.assemblyDocument.grounded_body_id;
      const movingBodyId = fixedBodyId === joint.connector_a.body_id
        ? joint.connector_b.body_id
        : joint.connector_a.body_id;
      const movingConnector = movingBodyId === joint.connector_a.body_id
        ? joint.connector_a
        : joint.connector_b;
      const fixedConnector = movingConnector === joint.connector_a
        ? joint.connector_b
        : joint.connector_a;
      const body = state.solidScene.bodies.find((candidate) => candidate.id === movingBodyId);
      if (!body) throw new Error('moving joint body is missing');
      const pose = window.__solidBodyDisplayPose(movingBodyId);
      const fixedPose = window.__solidBodyDisplayPose(fixedBodyId);
      const rotate = (point, quaternion) => {
        const [qx, qy, qz, qw] = quaternion;
        const [x, y, z] = point;
        const uv = [
          qy * z - qz * y,
          qz * x - qx * z,
          qx * y - qy * x,
        ];
        const uuv = [
          qy * uv[2] - qz * uv[1],
          qz * uv[0] - qx * uv[2],
          qx * uv[1] - qy * uv[0],
        ];
        return point.map((value, index) => value + 2 * (qw * uv[index] + uuv[index]));
      };
      const transformWithPose = (point, bodyPose) =>
        rotate(point, bodyPose.rotation).map(
          (value, index) => value + bodyPose.translation[index],
        );
      const transform = (point) => transformWithPose(point, pose);
      const positions = body.mesh.positions;
      const minimum = [Infinity, Infinity, Infinity];
      const maximum = [-Infinity, -Infinity, -Infinity];
      for (let index = 0; index < positions.length; index += 3) {
        for (let axis = 0; axis < 3; axis += 1) {
          minimum[axis] = Math.min(minimum[axis], positions[index + axis]);
          maximum[axis] = Math.max(maximum[axis], positions[index + axis]);
        }
      }
      const localCenter = minimum.map((value, index) => (value + maximum[index]) / 2);
      const worldOrigin = transform(movingConnector.frame.origin);
      const centerScreen = window.__worldToScreen(...worldOrigin);
      const fixedAxis = rotate(fixedConnector.frame.primary_axis, fixedPose.rotation);
      const axisScreen = window.__worldToScreen(
        worldOrigin[0] + fixedAxis[0],
        worldOrigin[1] + fixedAxis[1],
        worldOrigin[2] + fixedAxis[2],
      );
      const axisX = axisScreen.x - centerScreen.x;
      const axisY = axisScreen.y - centerScreen.y;
      const axisLength = Math.hypot(axisX, axisY);
      const screenAxis = axisLength > 1e-6
        ? { x: axisX / axisLength, y: axisY / axisLength }
        : { x: 1, y: 0 };
      const faceZ = [minimum[2], maximum[2]]
        .map((z) => ({ local: [localCenter[0], localCenter[1], z], world: transform([
          localCenter[0],
          localCenter[1],
          z,
        ]) }))
        .sort((a, b) => {
          const depthA = a.world.reduce(
            (total, value, index) => total + value * cameraDirection[index],
            0,
          );
          const depthB = b.world.reduce(
            (total, value, index) => total + value * cameraDirection[index],
            0,
          );
          return depthB - depthA;
        })[0].local[2];
      const candidates = Array.from({ length: 16 }, (_, index) => {
        const angle = index * Math.PI * 2 / 16;
        const local = [
          localCenter[0] + Math.cos(angle) * (maximum[0] - minimum[0]) * 0.24,
          localCenter[1] + Math.sin(angle) * (maximum[1] - minimum[1]) * 0.24,
          faceZ,
        ];
        const screen = window.__worldToScreen(...transform(local));
        const radialX = screen.x - centerScreen.x;
        const radialY = screen.y - centerScreen.y;
        const radialLength = Math.hypot(radialX, radialY);
        const tangent = radialLength > 1e-6
          ? { x: -radialY / radialLength, y: radialX / radialLength }
          : { x: -screenAxis.y, y: screenAxis.x };
        return {
          local,
          screen,
          tangent,
          radius: radialLength,
          axisOverlap: Math.abs(tangent.x * screenAxis.x + tangent.y * screenAxis.y),
        };
      }).filter((candidate) => candidate.radius >= 12)
        .sort((a, b) => a.axisOverlap - b.axisOverlap);
      const picked = candidates[0];
      if (!picked || picked.axisOverlap >= 0.95) {
        throw new Error('could not find an unambiguous rotational drag point');
      }
      return {
        movingBodyId,
        localPoint: picked.local,
        pointerStartScreen: picked.screen,
        observedStartScreen: picked.screen,
        screenTangent: picked.tangent,
      };
    }, cameraDirection);

    await page.mouse.move(setup.pointerStartScreen.x, setup.pointerStartScreen.y);
    await page.mouse.down();
    await page.mouse.move(
      setup.pointerStartScreen.x + setup.screenTangent.x * 48,
      setup.pointerStartScreen.y + setup.screenTangent.y * 48,
      { steps: 10 },
    );
    await page.mouse.up();
    await page.waitForFunction(() => window.__appStore.getState().jointMotionPreview !== null);
    const result = await page.evaluate(({
      movingBodyId,
      localPoint,
      observedStartScreen,
      screenTangent,
    }) => {
      const pose = window.__solidBodyDisplayPose(movingBodyId);
      const [qx, qy, qz, qw] = pose.rotation;
      const [x, y, z] = localPoint;
      const uv = [qy * z - qz * y, qz * x - qx * z, qx * y - qy * x];
      const uuv = [
        qy * uv[2] - qz * uv[1],
        qz * uv[0] - qx * uv[2],
        qx * uv[1] - qy * uv[0],
      ];
      const world = localPoint.map(
        (value, index) => value + 2 * (qw * uv[index] + uuv[index]) + pose.translation[index],
      );
      const endScreen = window.__worldToScreen(...world);
      const preview = window.__appStore.getState().jointMotionPreview;
      return {
        alongCursor: (endScreen.x - observedStartScreen.x) * screenTangent.x
          + (endScreen.y - observedStartScreen.y) * screenTangent.y,
        preview,
      };
    }, setup);
    assert.ok(
      result.alongCursor > 1,
      `${label}: rotating component moved opposite the cursor by ${result.alongCursor}px`,
    );
    assert.ok(
      Math.abs(result.preview.angleOffsetDeg) > 1,
      `${label}: cylindrical drag selected slide instead of rotation`,
    );
    assert.equal(result.preview.linearOffsetMm, linearOffsetMm);
    await page.getByTestId('joint-position-capture').getByRole('button', { name: /Revert/i }).click();
    await page.waitForFunction(() => window.__appStore.getState().jointMotionPreview === null);
  };

  await verifyRotationalDrag({
    groundedBodyId: selected[0].bodyId,
    cameraDirection: [0, 0, 1],
    linearOffsetMm: 20,
    label: 'connector A grounded / camera above',
  });
  await verifyRotationalDrag({
    groundedBodyId: selected[1].bodyId,
    cameraDirection: [1, 0, -0.3],
    linearOffsetMm: 20,
    label: 'connector B grounded / camera from the opposite hemisphere',
  });
  await page.evaluate(async ({ groundedBodyId, angleOffsetDeg, linearOffsetMm }) => {
    const state = window.__appStore.getState();
    const jointId = state.assemblyDocument.joints[0].id;
    await state.setGroundedBody(groundedBodyId);
    await window.__appStore.getState().setJointMotion(
      jointId,
      angleOffsetDeg,
      linearOffsetMm,
    );
  }, {
    groundedBodyId: selected[0].bodyId,
    angleOffsetDeg: captured.angle_offset_deg,
    linearOffsetMm: captured.linear_offset_mm,
  });

  console.log('7. Joint definitions can be edited, suppressed, and restored');
  const jointRow = page.getByTestId(`assembly-joint-${result.joint.id}`);
  await jointRow.hover();
  await page.getByTitle('Edit Main hinge').click();
  await dialog.waitFor({ state: 'visible' });
  await dialog.getByTestId('joint-kind').selectOption('planar');
  await dialog.getByTestId('joint-secondaryLinear-value').fill('4.5');
  await dialog.getByRole('button', { name: /Save Joint/i }).click();
  await page.waitForFunction(() => {
    const joint = window.__appStore.getState().assemblyDocument.joints[0];
    return joint?.kind === 'planar'
      && joint.advanced.secondary_linear_offset_mm === 4.5;
  });
  await jointRow.hover();
  await page.getByTitle('Suppress Main hinge').click();
  await page.waitForFunction(() =>
    window.__appStore.getState().assemblyDocument.joints[0]?.enabled === false,
  );
  assert.equal(
    await page.evaluate(() => window.__appStore.getState().assemblySolution.diagnostics
      .some((diagnostic) => diagnostic.kind === 'free_component')),
    true,
  );
  await jointRow.hover();
  await page.getByTitle('Unsuppress Main hinge').click();
  await page.waitForFunction(() =>
    window.__appStore.getState().assemblyDocument.joints[0]?.enabled === true,
  );

  console.log('7b. Named positions, motion studies, path export, contact sets, and swept checks share one persisted assembly model');
  await page.getByRole('button', { name: 'Motion', exact: true }).click();
  await page.getByTestId('motion-studio').waitFor({ state: 'visible' });
  const motionStudy = await page.evaluate(async () => {
    const engine = window.__engine;
    const document = await engine.assemblyDocument();
    const joint = document.joints[0];
    let study = await engine.createMotionStudy({ name: 'Door cycle', duration_seconds: 2 });
    study = await engine.updateMotionStudy({
      ...study,
      drivers: [{
        id: study.next_driver_id,
        name: 'Primary rotation',
        joint_id: joint.id,
        coordinate: 'primary_angle',
        enabled: true,
        law: {
          kind: 'keyframes',
          keyframes: [
            { time_seconds: 0, value: 0, interpolation: 'smooth' },
            { time_seconds: 2, value: 20, interpolation: 'smooth' },
          ],
        },
      }],
      next_driver_id: study.next_driver_id + 1,
    });
    const midpoint = await engine.sampleMotionStudy({ study_id: study.id, time_seconds: 1 });
    const csv = await engine.exportMotionPathCsv({
      study_id: study.id,
      sample_rate_hz: 10,
      occurrence_ids: [],
    });
    const staticReport = await engine.interferenceCheck({
      occurrence_ids: [],
      clearance_threshold_mm: 0,
    });
    const contact = await engine.createContactSet({
      name: 'Door stop',
      occurrence_a: joint.advanced.connector_a_occurrence_id,
      body_a: joint.connector_a.body_id,
      occurrence_b: joint.advanced.connector_b_occurrence_id,
      body_b: joint.connector_b.body_id,
      clearance_mm: 0,
      stop_motion: true,
    });
    const evaluation = await engine.evaluateMotionStudy({
      study_id: study.id,
      time_seconds: 1,
      previous_time_seconds: 0,
      enforce_contacts: true,
    });
    const swept = await engine.sweptCollisionCheck({
      study_id: study.id,
      sample_rate_hz: 10,
      clearance_threshold_mm: 0,
      stop_at_first: false,
    });
    const assembly = await engine.assemblyDocument();
    window.__appStore.setState({
      assemblyDocument: assembly,
      assemblySolution: await engine.assemblySolution(),
    });
    return {
      study,
      midpoint,
      csv,
      staticReport,
      contact,
      evaluation,
      swept,
      persisted: JSON.parse(await engine.exportProjectModel()).assembly,
      assembly,
    };
  });
  assert.ok(Math.abs(motionStudy.midpoint.driver_samples[0].value - 10) < 1e-9);
  assert.match(motionStudy.csv, /^time_seconds,occurrence_id/m);
  assert.equal(motionStudy.staticReport.exact, false, 'browser development uses a marked bounds fallback');
  assert.equal(motionStudy.swept.exact, false, 'browser swept checks must not claim exact OCCT geometry');
  assert.ok(motionStudy.swept.sample_count >= 21);
  assert.equal(motionStudy.evaluation.sample.study_id, motionStudy.study.id);
  assert.equal(motionStudy.assembly.positions.length, 1);
  assert.equal(motionStudy.assembly.contact_sets[0].id, motionStudy.contact.id);
  assert.deepEqual(motionStudy.persisted, motionStudy.assembly);
  await page.waitForFunction(() => window.__appStore.getState().assemblyDocument.motion_studies.length === 1);

  console.log('8. Body context actions copy a B-rep across project sessions without viewport clipping');
  await page.getByTitle('Back to model browser').click();
  const browserIds = await page.evaluate((bodyId) => {
    const visit = (nodes) => {
      for (const node of nodes) {
        if (node.kind === 'body' && node.reference_id === bodyId) return node.id;
        const child = visit(node.children);
        if (child) return child;
      }
      return null;
    };
    const browser = window.__appStore.getState().document.browser;
    return {
      bodiesFolderId: browser.find((node) => node.kind === 'bodies_folder')?.id ?? null,
      sourceNodeId: visit(browser),
    };
  }, selected[1].bodyId);
  assert.ok(browserIds.bodiesFolderId);
  assert.ok(browserIds.sourceNodeId);
  const bodiesFolderRow = page.locator(`[data-browser-node-id="${browserIds.bodiesFolderId}"]`);
  await bodiesFolderRow.locator('button').first().click();
  await page.locator(`[data-browser-node-id="${browserIds.sourceNodeId}"]`).click({ button: 'right' });
  const contextMenu = page.locator('[data-context-menu]');
  await contextMenu.waitFor({ state: 'visible' });
  assert.notEqual(await contextMenu.getAttribute('data-native-viewport-overlay'), null);
  assert.equal(await contextMenu.locator('[data-context-menu-item="export-body-step"]').isVisible(), true);
  assert.equal(await contextMenu.locator('[data-context-menu-item="fix-component"]').isVisible(), true);
  await contextMenu.locator('[data-context-menu-item="copy-body"]').click();
  await page.waitForFunction(() => !window.__appStore.getState().solidBusy);

  await page.evaluate(async () => {
    const engine = window.__engine;
    const update = await engine.newProject();
    window.__appStore.getState().loadProjectState(
      update,
      await engine.finishedSketches(),
      await engine.datumPlaneDefinitions(),
      null,
      await engine.bodyAppearances(),
      await engine.drawingDocument(),
      await engine.assemblyDocument(),
      await engine.projectVisibility(),
      await engine.assemblySolution(),
    );
  });
  const bodiesFolderId = await page.evaluate(() =>
    window.__appStore.getState().document.browser.find((node) => node.kind === 'bodies_folder')?.id,
  );
  assert.ok(bodiesFolderId);
  await page.locator(`[data-browser-node-id="${bodiesFolderId}"]`).click({ button: 'right' });
  const pasteItem = page.locator('[data-context-menu-item="paste-body"]');
  await pasteItem.waitFor({ state: 'visible' });
  assert.equal(await pasteItem.isEnabled(), true);
  await pasteItem.click();
  await page.waitForFunction(() => window.__appStore.getState().solidScene.bodies.length === 1);
  assert.equal((await page.evaluate(() => window.__appStore.getState().solidScene.bodies[0].mesh.indices.length)) > 0, true);

  console.log('9. Host-neutral inverse kinematics solves and atomically captures a two-joint chain');
  const kinematics = await page.evaluate(async () => {
    const engine = window.__engine;
    await engine.newProject();
    await engine.beginSketch({ type: 'origin_plane', plane: 'xy' });
    await engine.setGridSnap(false);
    for (const centerX of [-30, 0, 30]) {
      await engine.addRectangle({
        mode: 'two_point',
        p1: { x: centerX - 6, y: -6 },
        p2: { x: centerX + 6, y: 6 },
        ctrl_held: true,
      });
    }
    await engine.endSketch();
    const catalog = await engine.profileCatalog();
    const profiles = catalog[0].profiles
      .filter((profile) => profile.nesting_depth === 0)
      .sort((a, b) => a.index - b.index);
    for (const profile of profiles) {
      await engine.extrude({
        source_face: null,
        sketch_name: catalog[0].sketch_name,
        profile_indices: [profile.index],
        operation: 'new_body',
        extent: { type: 'distance', distance: 8 },
        taper_angle_deg: 0,
        flip: false,
        target_body_ids: [],
      });
    }
    const scene = await engine.solidScene();
    if (scene.bodies.length !== 3) throw new Error(`expected 3 chain bodies, got ${scene.bodies.length}`);
    const connectors = scene.bodies.map((body) => {
      const face = body.faces.find((candidate) =>
        candidate.plane
        && candidate.plane.normal[2] > 0.9
        && candidate.plane.origin[2] > 7,
      );
      if (!face?.plane) throw new Error(`${body.name} has no top connector face`);
      return {
        body_id: body.id,
        face_id: face.id,
        face_key: face.key,
        edge_id: null,
        edge_key: null,
        kind: 'planar_face',
        radius: null,
        frame: {
          origin: face.signature
            ? [face.signature.centroid.x, face.signature.centroid.y, face.signature.centroid.z]
            : face.plane.origin,
          primary_axis: face.plane.normal,
          secondary_axis: face.plane.u,
        },
      };
    });
    const advanced = {
      secondary_angle_offset_deg: 0,
      tertiary_angle_offset_deg: 0,
      secondary_linear_offset_mm: 0,
      screw_pitch_mm_per_revolution: 1,
      connector_a_twist_deg: 0,
      connector_b_twist_deg: 0,
      secondary_angle_limits: null,
      tertiary_angle_limits: null,
      secondary_linear_limits: null,
    };
    const created = [];
    for (let index = 0; index < 2; index += 1) {
      created.push(await engine.createJoint({
        name: index === 0 ? 'Shoulder' : 'Elbow',
        kind: 'revolute',
        connector_a: connectors[index],
        connector_b: connectors[index + 1],
        flipped: false,
        angle_offset_deg: 0,
        linear_offset_mm: 0,
        limits: null,
        angle_limits: { min: -170, max: 170 },
        linear_limits: null,
        advanced,
        grounded_body_id: index === 0 ? scene.bodies[0].id : null,
      }));
    }
    const motion = (jointId, angle) => ({
      joint_id: jointId,
      angle_offset_deg: angle,
      linear_offset_mm: 0,
      secondary_angle_offset_deg: 0,
      tertiary_angle_offset_deg: 0,
      secondary_linear_offset_mm: 0,
    });
    await engine.setJointCoordinates({ motion: motion(created[0].id, 38) });
    await engine.setJointCoordinates({ motion: motion(created[1].id, -24) });
    const target = (await engine.assemblySolution()).body_poses
      .find((pose) => pose.body_id === scene.bodies[2].id);
    if (!target) throw new Error('chain target has no solved pose');
    await engine.setJointCoordinates({ motion: motion(created[0].id, 0) });
    await engine.setJointCoordinates({ motion: motion(created[1].id, 0) });
    const preview = await engine.previewMechanismDrag({
      body_id: scene.bodies[2].id,
      target_pose: target,
      solve_orientation: true,
      maximum_iterations: 96,
    });
    await engine.applyJointMotions({ motions: preview.joint_motions });
    const capturedPose = (await engine.assemblySolution()).body_poses
      .find((pose) => pose.body_id === scene.bodies[2].id);
    return { preview, target, capturedPose };
  });
  assert.equal(kinematics.preview.converged, true);
  assert.equal(kinematics.preview.joint_motions.length, 2);
  assert.ok(kinematics.preview.position_error_mm < 0.05);
  assert.ok(kinematics.preview.orientation_error_deg < 0.35);
  assert.ok(kinematics.capturedPose);
  for (let axis = 0; axis < 3; axis += 1) {
    assert.ok(Math.abs(kinematics.capturedPose.translation[axis] - kinematics.target.translation[axis]) < 0.05);
  }

  console.log('10. Multi-body definitions instance through nested subassemblies without changing part history');
  const components = await page.evaluate(async () => {
    const engine = window.__engine;
    await engine.newProject();
    await engine.beginSketch({ type: 'origin_plane', plane: 'xy' });
    await engine.setGridSnap(false);
    for (const centerX of [-12, 12]) {
      await engine.addRectangle({
        mode: 'two_point',
        p1: { x: centerX - 4, y: -4 },
        p2: { x: centerX + 4, y: 4 },
        ctrl_held: true,
      });
    }
    await engine.endSketch();
    const catalog = await engine.profileCatalog();
    const profiles = catalog[0].profiles
      .filter((profile) => profile.nesting_depth === 0)
      .sort((a, b) => a.index - b.index);
    for (const profile of profiles) {
      await engine.extrude({
        source_face: null,
        sketch_name: catalog[0].sketch_name,
        profile_indices: [profile.index],
        operation: 'new_body',
        extent: { type: 'distance', distance: 6 },
        taper_angle_deg: 0,
        flip: false,
        target_body_ids: [],
      });
    }
    const sceneBefore = await engine.solidScene();
    const historyBefore = (await engine.getDocument()).features;
    const identity = { translation: [0, 0, 0], rotation: [0, 0, 0, 1] };
    const module = await engine.createComponent({
      name: 'Reusable module',
      body_ids: sceneBefore.bodies.map((body) => body.id),
      local_coordinate_system: { ...identity, translation: [2, 0, 0] },
      absorb_promoted_bodies: true,
    });
    let assembly = await engine.assemblyDocument();
    const moduleOccurrence = assembly.component_structure.occurrences
      .find((occurrence) => occurrence.component_id === module.id);
    if (!moduleOccurrence) throw new Error('multi-body component has no root occurrence');
    const carriage = await engine.createComponent({
      name: 'Carriage assembly',
      body_ids: [],
      local_coordinate_system: identity,
      absorb_promoted_bodies: false,
    });
    assembly = await engine.assemblyDocument();
    const carriageOccurrence = assembly.component_structure.occurrences
      .find((occurrence) => occurrence.component_id === carriage.id);
    if (!carriageOccurrence) throw new Error('subassembly has no root occurrence');
    await engine.updateOccurrence({
      occurrence: {
        ...moduleOccurrence,
        parent_occurrence_id: carriageOccurrence.id,
        local_pose: { ...identity, translation: [5, 0, 0] },
      },
    });
    await engine.setOccurrencePose({
      occurrence_id: carriageOccurrence.id,
      local_pose: { ...identity, translation: [10, 0, 0] },
    });
    const duplicate = await engine.duplicateOccurrence({
      occurrence_id: carriageOccurrence.id,
      parent_occurrence_id: null,
    });
    await engine.setOccurrencePose({
      occurrence_id: duplicate.id,
      local_pose: { ...identity, translation: [30, 0, 0] },
    });

    const solution = await engine.assemblySolution();
    const sceneAfter = await engine.solidScene();
    const historyAfter = (await engine.getDocument()).features;
    const persisted = JSON.parse(await engine.exportProjectModel()).assembly;
    return {
      module,
      assembly: await engine.assemblyDocument(),
      solution,
      sourceBodyIds: sceneAfter.bodies.map((body) => body.id),
      sourceBodyCountBefore: sceneBefore.bodies.length,
      sourceBodyCountAfter: sceneAfter.bodies.length,
      historyBefore,
      historyAfter,
      persisted,
    };
  });
  assert.equal(components.module.body_ids.length, 2);
  assert.equal(components.sourceBodyCountBefore, 2);
  assert.equal(components.sourceBodyCountAfter, 2, 'occurrences must not copy OCCT bodies');
  assert.deepEqual(components.historyAfter, components.historyBefore, 'assembly placement must not edit feature history');
  assert.deepEqual(components.persisted, components.assembly, 'component hierarchy must persist in the project model');
  assert.equal(components.assembly.component_structure.definitions.length, 2);
  assert.equal(components.assembly.component_structure.occurrences.length, 4);
  assert.equal(components.solution.instance_body_poses.length, 4);
  for (const bodyId of components.sourceBodyIds) {
    const instances = components.solution.instance_body_poses
      .filter((pose) => pose.body_id === bodyId)
      .sort((a, b) => a.translation[0] - b.translation[0]);
    assert.equal(instances.length, 2, `source body ${bodyId} should have two display instances`);
    assert.deepEqual(instances.map((pose) => pose.translation[0]), [13, 33]);
    assert.notEqual(instances[0].occurrence_id, instances[1].occurrence_id);
  }

  assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join('\n')}`);
  console.log('  [ok] exact topology, occurrence-aware kinematics, nested reusable components, cross-project body transfer, and retained display instances work');
} finally {
  await browser.close();
}
