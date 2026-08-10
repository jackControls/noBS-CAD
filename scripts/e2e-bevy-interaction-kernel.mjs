/**
 * Focused proof that the native Bevy viewport's browser-side interaction
 * contract does not depend on Three.js. Vite loads the real TypeScript module;
 * assertions exercise its camera, projection, ray, and preview math directly.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE = 'http://localhost:7199';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error)));

try {
  await page.goto(BASE, {
    waitUntil: 'domcontentloaded',
    timeout: 90_000,
  });
  await page.waitForFunction(() => !!window.__cameraApi, undefined, {
    timeout: 90_000,
  });

  const result = await page.evaluate(async () => {
    const cad = await import('/src/components/viewport/cadInteraction.ts');
    const viewport = await import('/src/components/viewport/Viewport.tsx');
    const nativeBridge = await import(
      '/src/components/viewport/nativeViewportBridge.ts'
    );
    const epsilon = 1e-6;
    const approximately = (actual, expected, tolerance = epsilon) =>
      Math.abs(actual - expected) <= tolerance;

    const camera = new cad.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, 10);
    camera.up.set(0, 1, 0);
    camera.lookAt(new cad.Vector3(0, 0, 0));

    // Perspective projection: the look target maps to the viewport center.
    const projectedOrigin = new cad.Vector3(0, 0, 0).project(camera);
    const projection =
      approximately(projectedOrigin.x, 0) &&
      approximately(projectedOrigin.y, 0) &&
      projectedOrigin.z >= -1 &&
      projectedOrigin.z <= 1;

    const centerRay = new cad.Raycaster();
    centerRay.setFromCamera(new cad.Vector2(0, 0), camera);

    // OCCT face proxy: ordinary triangle intersection.
    const faceGeometry = new cad.BufferGeometry().setAttribute(
      'position',
      new cad.Float32BufferAttribute([-2, -2, 0, 2, -2, 0, 0, 2, 0], 3),
    );
    const face = new cad.Mesh(faceGeometry, new cad.MeshBasicMaterial());
    face.userData.faceId = 41;
    const faceHits = centerRay.intersectObject(face);
    const faceRay =
      faceHits.length === 1 &&
      faceHits[0].object.userData.faceId === 41 &&
      approximately(faceHits[0].point.z, 0);

    // OCCT topology edge proxy: ray-to-segment distance with a world threshold.
    const edge = new cad.Line(
      new cad.BufferGeometry().setFromPoints([
        new cad.Vector3(-3, 0, 0),
        new cad.Vector3(3, 0, 0),
      ]),
      new cad.LineBasicMaterial(),
    );
    edge.userData.edgeId = 17;
    centerRay.params.Line.threshold = 0.05;
    const edgeHits = centerRay.intersectObject(edge);
    const edgeRay =
      edgeHits.length === 1 && edgeHits[0].object.userData.edgeId === 17;

    // Datum and origin planes share the finite transformed-plane primitive.
    const datum = new cad.Mesh(
      new cad.PlaneGeometry(8, 8),
      new cad.MeshBasicMaterial({ side: cad.DoubleSide }),
    );
    datum.position.z = 2;
    datum.userData.datumPlaneId = 9;
    const datumHits = centerRay.intersectObject(datum);
    const datumRay =
      datumHits.length === 1 &&
      datumHits[0].object.userData.datumPlaneId === 9 &&
      approximately(datumHits[0].point.z, 2);

    const originPlane = new cad.Mesh(
      new cad.PlaneGeometry(
        viewport.REFERENCE_PLANE_SIZE,
        viewport.REFERENCE_PLANE_SIZE,
      ),
      new cad.MeshBasicMaterial({ side: cad.DoubleSide }),
    );
    originPlane.userData.plane = 'xy';
    const originHits = centerRay.intersectObject(originPlane);
    const originRay =
      originHits.length === 1 &&
      originHits[0].object.userData.plane === 'xy';

    // The visible 100 mm reference quad and its finite hit primitive share
    // one footprint: a ray through ~45 mm hits, while ~58 mm does not.
    const planeCamera = new cad.PerspectiveCamera(45, 1, 0.1, 500);
    planeCamera.position.set(0, 0, 200);
    planeCamera.up.set(0, 1, 0);
    planeCamera.lookAt(new cad.Vector3());
    const nearEdgeRay = new cad.Raycaster();
    nearEdgeRay.setFromCamera(new cad.Vector2(0.55, 0), planeCamera);
    const outsideRay = new cad.Raycaster();
    outsideRay.setFromCamera(new cad.Vector2(0.70, 0), planeCamera);
    const finiteReferencePlane =
      nearEdgeRay.intersectObject(originPlane).length === 1 &&
      outsideRay.intersectObject(originPlane).length === 0;

    // Runtime reference planes preserve a stable screen footprint instead of
    // remaining a fixed 100 mm square at every zoom level.
    const nearPlaneHalfSize = viewport.referencePlaneHalfSizeForView(
      100,
      45,
      1200,
      800,
    );
    const farPlaneHalfSize = viewport.referencePlaneHalfSizeForView(
      200,
      45,
      1200,
      800,
    );
    const viewportRelativeReferencePlane =
      approximately(farPlaneHalfSize / nearPlaneHalfSize, 2) &&
      nearPlaneHalfSize > 0;

    // Sketch pointer mapping: ray/world intersection transformed into local mm.
    const sketchBasis = new cad.Group();
    sketchBasis.position.set(4, -3, 2);
    sketchBasis.updateWorldMatrix(true, false);
    const targetWorld = new cad.Vector3(6, 1, 2);
    const sketchCamera = new cad.PerspectiveCamera(45, 1, 0.1, 100);
    sketchCamera.position.set(6, 1, 12);
    sketchCamera.up.set(0, 1, 0);
    sketchCamera.lookAt(targetWorld);
    const sketchRaycaster = new cad.Raycaster();
    sketchRaycaster.setFromCamera(new cad.Vector2(0, 0), sketchCamera);
    const sketchHit = sketchRaycaster.ray.intersectPlane(
      new cad.Plane().setFromNormalAndCoplanarPoint(
        new cad.Vector3(0, 0, 1),
        sketchBasis.position,
      ),
      new cad.Vector3(),
    );
    const sketchLocal = sketchHit
      ? sketchBasis.worldToLocal(sketchHit.clone())
      : null;
    const sketchPlane =
      sketchLocal !== null &&
      approximately(sketchLocal.x, 2) &&
      approximately(sketchLocal.y, 4) &&
      approximately(sketchLocal.z, 0);

    // Profile ray respects inner loops instead of selecting through a hole.
    const profile = new cad.Shape()
      .moveTo(-4, -4)
      .lineTo(4, -4)
      .lineTo(4, 4)
      .lineTo(-4, 4)
      .closePath();
    const hole = new cad.Path()
      .moveTo(-1, -1)
      .lineTo(1, -1)
      .lineTo(1, 1)
      .lineTo(-1, 1)
      .closePath();
    profile.holes.push(hole);
    const profileMesh = new cad.Mesh(
      new cad.ShapeGeometry(profile),
      new cad.MeshBasicMaterial(),
    );
    const missesHole = centerRay.intersectObject(profileMesh).length === 0;
    const outerRay = new cad.Raycaster();
    outerRay.setFromCamera(new cad.Vector2(0.72, 0), camera);
    const hitsOuterProfile = outerRay.intersectObject(profileMesh).length === 1;
    const profileRay = missesHole && hitsOuterProfile;

    // Orbit keeps the pivot radius while changing the view direction.
    const orbitCamera = new cad.PerspectiveCamera(45, 1, 0.1, 100);
    const orbitTarget = new cad.Vector3(0, 0, 0);
    orbitCamera.up.set(0, 0, 1);
    orbitCamera.position.set(10, -10, 8);
    orbitCamera.lookAt(orbitTarget);
    const radiusBefore = orbitCamera.position.distanceTo(orbitTarget);
    const positionBefore = orbitCamera.position.clone();
    cad.orbitCamera(orbitCamera, orbitTarget, 80, -30, 800);
    const orbit =
      approximately(
        orbitCamera.position.distanceTo(orbitTarget),
        radiusBefore,
        1e-5,
      ) && orbitCamera.position.distanceTo(positionBefore) > 0.1;
    const boundedFastDrag = cad.boundedPointerDelta(300, 0, 1280, 800);
    const pointerJumpGuard =
      boundedFastDrag !== null &&
      approximately(Math.hypot(...boundedFastDrag), 160) &&
      cad.boundedPointerDelta(2_000, -2_000, 1280, 800) === null;

    // Canonical camera-API axes use the documented object-mode convention:
    // +X right, +Y forward, +Z up. The camera moves oppositely so the part
    // follows the physical cap. Verify all three axes in the live camera path.
    const liveCamera = window.__cameraApi;
    const driverView = liveCamera.getSixDofDriverView();
    const baseMatrix = [...driverView.getViewMatrix()];
    const baseTarget = [...driverView.getViewTarget()];
    const baseSnapshot = liveCamera.getSnapshot();
    const basePosition = new cad.Vector3(...baseSnapshot.position);
    const baseForward = new cad.Vector3(...baseSnapshot.target)
      .sub(basePosition)
      .normalize();
    const baseRight = new cad.Vector3()
      .crossVectors(baseForward, new cad.Vector3(...baseSnapshot.up))
      .normalize();
    const baseUp = new cad.Vector3()
      .crossVectors(baseRight, baseForward)
      .normalize();
    const resetLiveCamera = () => {
      driverView.setViewMatrix(baseMatrix);
      driverView.setViewTarget(baseTarget);
    };
    const translatedCameraDelta = (translation) => {
      resetLiveCamera();
      liveCamera.navigateSixDof({
        translation,
        rotation: [0, 0, 0],
        deltaSeconds: 1 / 60,
      });
      return new cad.Vector3(...liveCamera.getSnapshot().position).sub(
        basePosition,
      );
    };
    const translationX = translatedCameraDelta([1, 0, 0]);
    const translationY = translatedCameraDelta([0, 1, 0]);
    const translationZ = translatedCameraDelta([0, 0, 1]);
    const sixDofDirections =
      translationX.dot(baseRight) < 0 &&
      Math.abs(translationX.dot(baseForward)) < 1e-5 &&
      Math.abs(translationX.dot(baseUp)) < 1e-5 &&
      translationY.dot(baseForward) < 0 &&
      Math.abs(translationY.dot(baseRight)) < 1e-5 &&
      Math.abs(translationY.dot(baseUp)) < 1e-5 &&
      translationZ.dot(baseUp) < 0 &&
      Math.abs(translationZ.dot(baseRight)) < 1e-5 &&
      Math.abs(translationZ.dot(baseForward)) < 1e-5;

    // Every desktop uses fixed-target depth dolly. It must remain on the safe
    // side of the target even under a long stream of maximum raw-HID packets.
    resetLiveCamera();
    for (let index = 0; index < 400; index += 1) {
      liveCamera.navigateSixDof({
        translation: [0, -1, 0],
        rotation: [0, 0, 0],
        deltaSeconds: 0.05,
      });
    }
    const nearDepthSnapshot = liveCamera.getSnapshot();
    const nearDepthDistance = new cad.Vector3(
      ...nearDepthSnapshot.position,
    ).distanceTo(new cad.Vector3(...nearDepthSnapshot.target));
    for (let index = 0; index < 400; index += 1) {
      liveCamera.navigateSixDof({
        translation: [0, 1, 0],
        rotation: [0, 0, 0],
        deltaSeconds: 0.05,
      });
    }
    const farDepthSnapshot = liveCamera.getSnapshot();
    const farDepthDistance = new cad.Vector3(
      ...farDepthSnapshot.position,
    ).distanceTo(new cad.Vector3(...farDepthSnapshot.target));
    const sixDofDepthGuard =
      nearDepthSnapshot.target.every((value, index) =>
        approximately(value, baseTarget[index]),
      ) &&
      farDepthSnapshot.target.every((value, index) =>
        approximately(value, baseTarget[index]),
      ) &&
      nearDepthDistance >= 2 - 1e-5 &&
      farDepthDistance <= 5_000 + 1e-5;
    resetLiveCamera();

    // Transient preview geometry is transformed into Bevy's world coordinates.
    const previewRoot = new cad.Group();
    previewRoot.position.set(5, 6, 7);
    const previewGeometry = new cad.PolylineGeometry().setPositions([
      0, 0, 0, 2, 0, 0,
    ]);
    const preview = new cad.ScreenPolyline(
      previewGeometry,
      new cad.ScreenLineMaterial(),
    );
    previewRoot.add(preview);
    previewRoot.updateMatrixWorld(true);
    const starts = previewGeometry.getAttribute('instanceStart');
    const ends = previewGeometry.getAttribute('instanceEnd');
    const start = new cad.Vector3(
      starts.getX(0),
      starts.getY(0),
      starts.getZ(0),
    ).applyMatrix4(preview.matrixWorld);
    const end = new cad.Vector3(
      ends.getX(0),
      ends.getY(0),
      ends.getZ(0),
    ).applyMatrix4(preview.matrixWorld);
    const transientPreview =
      approximately(start.x, 5) &&
      approximately(start.y, 6) &&
      approximately(start.z, 7) &&
      approximately(end.x, 7) &&
      approximately(end.y, 6) &&
      approximately(end.z, 7);

    const inputSurface =
      document.querySelector(
        'canvas[data-cad-interaction-surface="true"]',
      ) !== null;

    // Native mode keeps the real DOM chrome as a semantic/input proxy while
    // Bevy owns the pixels. Hidden proxies must not become compositor islands.
    const surface = document.querySelector(
      'canvas[data-cad-interaction-surface="true"]',
    );
    const viewportRoot = surface?.parentElement;
    if (viewportRoot) viewportRoot.dataset.nativeViewport = 'bevy';
    document.documentElement.dataset.nativeViewport = 'bevy';
    const hudRoots = [...document.querySelectorAll('[data-native-hud]')];
    const nativeHudProxies =
      hudRoots.length >= 2 &&
      hudRoots.every((element) => getComputedStyle(element).opacity === '0') &&
      [...document.querySelectorAll(
        '[data-native-hud] button, [data-native-hud-control]',
      )].every((element) => getComputedStyle(element).pointerEvents !== 'none');
    const shellOverlayIslands = [
      document.querySelector('[data-testid="project-tabs"]'),
      [...document.querySelectorAll('[data-native-viewport-overlay]')].find(
        (element) => element.textContent?.includes('COMMENTS'),
      ),
    ].every(
      (element) =>
        element?.hasAttribute('data-native-viewport-overlay') === true,
    );
    const animatedHud =
      [...document.querySelectorAll(
        '[data-native-hud="navigation"] button, [data-orientation-dial] button',
      )].every(
        (button) =>
          Number.parseFloat(getComputedStyle(button).transitionDuration) > 0,
      );

    const unionInputs = [
      { x: 240, y: 92, width: 1200, height: 28 },
      { x: 150, y: 92, width: 260, height: 210 },
    ];
    const disjoint = nativeBridge.disjointOverlayRects(unionInputs);
    const disjointArea = disjoint.reduce(
      (area, rect) => area + rect.width * rect.height,
      0,
    );
    const exactOverlayUnion =
      disjointArea === 1200 * 28 + 260 * 210 - 170 * 28 &&
      !disjoint.some(
        (rect) =>
          900 >= rect.x &&
          900 <= rect.x + rect.width &&
          200 >= rect.y &&
          200 <= rect.y + rect.height,
      ) &&
      disjoint.every(
        (rect, index) =>
          disjoint.slice(index + 1).every(
            (other) =>
              rect.x + rect.width <= other.x ||
              other.x + other.width <= rect.x ||
              rect.y + rect.height <= other.y ||
              other.y + other.height <= rect.y,
          ),
      );

    const nativeHudExcludedFromCompositor = hudRoots.every((element) => {
      const bounds = element.getBoundingClientRect();
      return !nativeBridge.collectNativeViewportOverlayRects().some(
        (rect) =>
          rect.x < bounds.right &&
          rect.x + rect.width > bounds.left &&
          rect.y < bounds.bottom &&
          rect.y + rect.height > bounds.top,
      );
    });
    delete document.documentElement.dataset.nativeViewport;
    if (viewportRoot) delete viewportRoot.dataset.nativeViewport;

    const store = window.__appStore.getState();
    store.setNavTool('orbit');
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    const escape = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    const escapeOwned =
      window.dispatchEvent(escape) === false &&
      window.__appStore.getState().navTool === 'select';

    store.setSettingsOpen(true);
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    const dialog = document.querySelector(
      '[data-testid="appearance-dialog"]',
    );
    const dialogBounds = dialog?.getBoundingClientRect();
    const modalOverlayRects = nativeBridge.collectNativeViewportOverlayRects();
    const roundedModalCompositing =
      dialogBounds !== undefined &&
      dialogBounds !== null &&
      approximately(nativeBridge.collectNativeViewportDimOpacity(), 0.3) &&
      modalOverlayRects
        .some(
          (rect) =>
            approximately(rect.x, dialogBounds.x) &&
            approximately(rect.y, dialogBounds.y) &&
            approximately(rect.width, dialogBounds.width) &&
            approximately(rect.height, dialogBounds.height) &&
            (rect.cornerRadius ?? 0) >= 13,
        );
    window.__appStore.getState().setSettingsOpen(false);

    return {
      projection,
      faceRay,
      edgeRay,
      datumRay,
      originRay,
      finiteReferencePlane,
      viewportRelativeReferencePlane,
      sketchPlane,
      profileRay,
      orbit,
      pointerJumpGuard,
      sixDofDirections,
      sixDofDepthGuard,
      transientPreview,
      inputSurface,
      nativeHudProxies,
      shellOverlayIslands,
      animatedHud,
      exactOverlayUnion,
      nativeHudExcludedFromCompositor,
      roundedModalCompositing,
      escapeOwned,
    };
  });

  const expectedKernelResult = {
      projection: true,
      faceRay: true,
      edgeRay: true,
      datumRay: true,
      originRay: true,
      finiteReferencePlane: true,
      viewportRelativeReferencePlane: true,
      sketchPlane: true,
      profileRay: true,
      orbit: true,
      pointerJumpGuard: true,
      sixDofDirections: true,
      sixDofDepthGuard: true,
      transientPreview: true,
      inputSurface: true,
      nativeHudProxies: true,
      shellOverlayIslands: true,
      animatedHud: true,
      exactOverlayUnion: true,
      nativeHudExcludedFromCompositor: true,
      roundedModalCompositing: true,
      escapeOwned: true,
  };

  await page.waitForFunction(
    () => window.__appStore?.getState().document !== null,
    undefined,
    { timeout: 90_000 },
  );

  await page.getByTestId('file-menu-button').click();
  await page.getByTestId('file-menu').waitFor({ state: 'visible' });
  const fileMenuGeometry = await page.evaluate(() => {
    const menu = document.querySelector('[data-testid="file-menu"]');
    const anchor = document.querySelector('[data-testid="app-menu-controls"]');
    const firstItem = menu?.querySelector('[role="menuitem"]');
    if (!menu || !anchor || !firstItem) return null;
    const menuRect = menu.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    const itemRect = firstItem.getBoundingClientRect();
    const point = {
      x: itemRect.left + itemRect.width / 2,
      y: itemRect.top + itemRect.height / 2,
    };
    const hit = document.elementFromPoint(point.x, point.y);
    return {
      portaled: menu.parentElement === document.body,
      beginsOutsideRibbonClip: menuRect.top >= anchorRect.bottom - 1,
      itemOutsideRibbonClip: point.y > anchorRect.bottom,
      itemHitTestable: hit !== null && menu.contains(hit),
    };
  });
  assert.deepEqual(
    fileMenuGeometry,
    {
      portaled: true,
      beginsOutsideRibbonClip: true,
      itemOutsideRibbonClip: true,
      itemHitTestable: true,
    },
    'the File menu must be portaled and hit-testable beyond the clipped ribbon',
  );

  await page.setViewportSize({ width: 900, height: 520 });
  await page.waitForFunction(() => {
    const menu = document.querySelector('[data-testid="file-menu"]');
    if (!menu) return false;
    const rect = menu.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + 8, rect.top + 8);
    return rect.bottom <= window.innerHeight - 5 && hit !== null && menu.contains(hit);
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForFunction(() => {
    const menu = document.querySelector('[data-testid="file-menu"]');
    return menu !== null && menu.getBoundingClientRect().bottom <= window.innerHeight - 5;
  });

  const fileMenuMask = await page.evaluate(async () => {
    const bridge = await import(
      '/src/components/viewport/nativeViewportBridge.ts'
    );
    const menu = document
      .querySelector('[data-testid="file-menu"]')
      .getBoundingClientRect();
    const overlays = bridge.collectNativeViewportOverlayRects();
    const covered = (x, y) =>
      overlays.some(
        (rect) =>
          x > rect.x &&
          x < rect.x + rect.width &&
          y > rect.y &&
          y < rect.y + rect.height,
      );
    const inset = 2;
    return {
      topLeft: covered(menu.left + inset, menu.top + inset),
      topRight: covered(menu.right - inset, menu.top + inset),
      center: covered(
        menu.left + menu.width / 2,
        menu.top + menu.height / 2,
      ),
      bottomRight: covered(
        menu.right - inset,
        menu.bottom - inset,
      ),
    };
  });
  assert.deepEqual(
    fileMenuMask,
    {
      topLeft: true,
      topRight: true,
      center: true,
      bottomRight: true,
    },
    'the complete windowed File menu must remain above the native viewport',
  );
  const settingsItem = page.getByRole('menuitem', { name: 'Settings' });
  await settingsItem.scrollIntoViewIfNeeded();
  const settingsBounds = await settingsItem.boundingBox();
  assert.ok(settingsBounds, 'the File menu Settings row has a painted hit target');
  await page.mouse.click(
    settingsBounds.x + settingsBounds.width / 2,
    settingsBounds.y + settingsBounds.height / 2,
  );
  await page.waitForFunction(
    () => window.__appStore.getState().settingsOpen === true,
  );
  assert.equal(
    await page.getByTestId('file-menu').count(),
    0,
    'activating a portaled File menu row closes the menu',
  );
  await page.evaluate(() => window.__appStore.getState().setSettingsOpen(false));

  await page.getByRole('button', { name: 'BUILD' }).click();
  await page.locator('[data-ribbon-menu]').waitFor({ state: 'visible' });
  const menuMask = await page.evaluate(async () => {
    const bridge = await import(
      '/src/components/viewport/nativeViewportBridge.ts'
    );
    const menu = document
      .querySelector('[data-ribbon-menu]')
      .getBoundingClientRect();
    const viewport = document
      .querySelector('canvas[data-cad-interaction-surface="true"]')
      .getBoundingClientRect();
    const overlays = bridge.collectNativeViewportOverlayRects();
    const covered = (x, y) =>
      overlays.some(
        (rect) =>
          x > rect.x &&
          x < rect.x + rect.width &&
          y > rect.y &&
          y < rect.y + rect.height,
      );
    const y = Math.min(menu.bottom - 2, viewport.bottom - 2);
    const insideX =
      (Math.max(menu.left, viewport.left) +
        Math.min(menu.right, viewport.right)) /
      2;
    const clearX = viewport.left + viewport.width * 0.6;
    return {
      menuCovered: covered(insideX, y),
      unrelatedViewportClear: !covered(clearX, y),
    };
  });
  assert.deepEqual(
    menuMask,
    { menuCovered: true, unrelatedViewportClear: true },
    'a ribbon flyout must expose only its own pixels, not a full viewport band',
  );
  await page.getByRole('button', { name: 'BUILD' }).click();

  const preSketchCamera = await page.evaluate(() =>
    window.__cameraApi.getSnapshot(),
  );
  await page.locator('button[title="Create Sketch"]').click();
  await page.waitForFunction(
    () => window.__appStore.getState().mode === 'pickPlane',
  );
  const planeTargets = await page.evaluate(async () => {
    const cad = await import('/src/components/viewport/cadInteraction.ts');
    const viewportModule = await import(
      '/src/components/viewport/Viewport.tsx'
    );
    const surface = document.querySelector(
      'canvas[data-cad-interaction-surface="true"]',
    );
    const rect = surface.getBoundingClientRect();
    const snapshot = window.__cameraApi.getSnapshot();
    const position = new cad.Vector3(...snapshot.position);
    const forward = new cad.Vector3(...snapshot.target)
      .sub(position)
      .normalize();
    const depth = new cad.Vector3()
      .sub(position)
      .dot(forward);
    const halfSize = viewportModule.referencePlaneHalfSizeForView(
      depth,
      45,
      rect.width,
      rect.height,
    );
    return {
      xz: window.__worldToScreen(halfSize * 0.70, 0, halfSize * 0.70),
      xzCorner: window.__worldToScreen(halfSize, 0, halfSize),
      outside: window.__worldToScreen(halfSize * 1.8, 0, halfSize * 1.8),
      viewport: {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
      },
    };
  });
  for (const point of [
    planeTargets.xz,
    planeTargets.xzCorner,
    planeTargets.outside,
  ]) {
    assert.ok(
      point.x > planeTargets.viewport.left &&
        point.x < planeTargets.viewport.right &&
        point.y > planeTargets.viewport.top &&
        point.y < planeTargets.viewport.bottom,
      `reference-plane test point is outside the viewport: ${JSON.stringify(point)}`,
    );
  }
  await page.mouse.move(planeTargets.xz.x, planeTargets.xz.y);
  await page.waitForFunction(
    () => window.__appStore.getState().hoveredPlane === 'xz',
  );
  const outward = {
    x: planeTargets.outside.x - planeTargets.xzCorner.x,
    y: planeTargets.outside.y - planeTargets.xzCorner.y,
  };
  const outwardLength = Math.hypot(outward.x, outward.y);
  const nearVisibleEdge = {
    x: planeTargets.xzCorner.x + (outward.x / outwardLength) * 4,
    y: planeTargets.xzCorner.y + (outward.y / outwardLength) * 4,
  };
  await page.mouse.move(nearVisibleEdge.x, nearVisibleEdge.y);
  await page.waitForFunction(
    () => window.__appStore.getState().hoveredPlane === 'xz',
  );
  await page.mouse.move(planeTargets.outside.x, planeTargets.outside.y);
  await page.waitForTimeout(100);
  assert.equal(
    await page.evaluate(() => window.__appStore.getState().hoveredPlane),
    null,
    'the XZ hit target must end at the same viewport-relative boundary Bevy draws',
  );

  await page.mouse.move(planeTargets.xz.x, planeTargets.xz.y);
  await page.mouse.click(planeTargets.xz.x, planeTargets.xz.y);
  await page.waitForFunction(
    () => window.__appStore.getState().mode === 'sketch',
  );
  const compactRibbon = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="ribbon-tools"]');
    const commands = document.querySelector(
      '[data-testid="ribbon-command-scroll"]',
    );
    const fix = document.querySelector('[data-ribbon-button="fixUnfix"]');
    const finish = [...document.querySelectorAll('button')].find(
      (button) => button.textContent?.trim().toLowerCase() === 'finish sketch',
    );
    if (!root || !commands || !fix || !finish) return null;
    const rootRect = root.getBoundingClientRect();
    const commandsRect = commands.getBoundingClientRect();
    const fixRect = fix.getBoundingClientRect();
    const finishRect = finish.getBoundingClientRect();
    return {
      overflow: commands.scrollWidth - commands.clientWidth,
      fixFullyVisible:
        fixRect.left >= commandsRect.left - 0.5 &&
        fixRect.right <= commandsRect.right + 0.5,
      finishFullyVisible:
        finishRect.left >= rootRect.left - 0.5 &&
        finishRect.right <= rootRect.right + 0.5,
    };
  });
  assert.deepEqual(
    compactRibbon,
    { overflow: 0, fixFullyVisible: true, finishFullyVisible: true },
    'the complete sketch ribbon must fit without clipping at 1280 px',
  );
  await page.locator('button[title="Line"]').click();
  const sketchPaletteMask = await page.evaluate(async () => {
    const bridge = await import(
      '/src/components/viewport/nativeViewportBridge.ts'
    );
    const palette = document
      .querySelector('[data-sketch-palette]')
      .getBoundingClientRect();
    const overlays = bridge.collectNativeViewportOverlayRects();
    const covered = (x, y) =>
      overlays.some(
        (rect) =>
          x > rect.x &&
          x < rect.x + rect.width &&
          y > rect.y &&
          y < rect.y + rect.height,
      );
    const inset = 2;
    return {
      activeTool: window.__appStore.getState().activeTool,
      topLeft: covered(palette.left + inset, palette.top + inset),
      topRight: covered(palette.right - inset, palette.top + inset),
      center: covered(
        palette.left + palette.width / 2,
        palette.top + palette.height / 2,
      ),
      bottomLeft: covered(
        palette.left + inset,
        palette.bottom - inset,
      ),
      bottomRight: covered(
        palette.right - inset,
        palette.bottom - inset,
      ),
    };
  });
  assert.deepEqual(
    sketchPaletteMask,
    {
      activeTool: 'line',
      topLeft: true,
      topRight: true,
      center: true,
      bottomLeft: true,
      bottomRight: true,
    },
    'the entire Sketch Palette must remain above the native viewport while Line is active',
  );
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Finish Sketch', exact: true }).click();
  await page.waitForFunction(
    () => window.__appStore.getState().mode === 'solid',
  );
  const windowsPlatform = await page.evaluate(() =>
    /Windows/i.test(navigator.userAgent),
  );
  if (windowsPlatform) {
    await page.evaluate(() => {
      const surface = document.querySelector(
        'canvas[data-cad-interaction-surface="true"]',
      );
      surface.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          deltaX: 120,
          deltaY: 0,
          deltaMode: WheelEvent.DOM_DELTA_PIXEL,
        }),
      );
      surface.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          deltaX: 3,
          deltaY: 0,
          deltaMode: WheelEvent.DOM_DELTA_LINE,
        }),
      );
    });
  }
  await page.waitForTimeout(500);
  const restoredCamera = await page.evaluate(() =>
    window.__cameraApi.getSnapshot(),
  );
  const restoreError = Math.max(
    ...['position', 'target', 'up'].flatMap((key) =>
      restoredCamera[key].map((value, index) =>
        Math.abs(value - preSketchCamera[key][index]),
      ),
    ),
  );
  assert.ok(
    restoreError < 1e-5,
    `wheel tilt interrupted the sketch-exit camera restore (${restoreError})`,
  );
  const finishedSketch = await page.evaluate(() => {
    const visit = (nodes) => {
      for (const node of nodes) {
        if (node.kind === 'sketch') return node;
        const child = visit(node.children);
        if (child) return child;
      }
      return null;
    };
    return visit(window.__appStore.getState().document.browser);
  });
  assert.ok(finishedSketch, 'finishing the sketch must add it to the browser');
  const sketchRow = page.locator(
    `[data-browser-node-id="${finishedSketch.id}"]`,
  );
  await sketchRow.hover();
  await sketchRow
    .locator('button[title="Toggle visibility"]')
    .click();
  await page.waitForFunction(
    (id) => window.__appStore.getState().hidden[id] === true,
    finishedSketch.id,
  );
  const hiddenSketchPresentation = await page.evaluate(async () => {
    const bridge = await import(
      '/src/components/viewport/nativeViewportBridge.ts'
    );
    return bridge.collectNativeViewportPresentation().hiddenSketchNames;
  });
  assert.deepEqual(
    hiddenSketchPresentation,
    [finishedSketch.name],
    'the browser eye toggle must hide the same finished sketch in Bevy',
  );

  assert.deepEqual(
    result,
    expectedKernelResult,
    `Three-free interaction proof failed: ${JSON.stringify(result)}`,
  );
  assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join('\n')}`);
  console.log(
    '  [ok] projection, viewport-relative planes, forgiving hover, rounded DOM islands, synchronized modal dimming, complete menus and palette, Bevy sketch visibility, Escape ownership, orbit, sketch mapping, and Bevy preview transport',
  );
} finally {
  await browser.close();
}
