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
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__cameraApi);

  const result = await page.evaluate(async () => {
    const cad = await import('/src/components/viewport/cadInteraction.ts');
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
      new cad.PlaneGeometry(100, 100),
      new cad.MeshBasicMaterial({ side: cad.DoubleSide }),
    );
    originPlane.userData.plane = 'xy';
    const originHits = centerRay.intersectObject(originPlane);
    const originRay =
      originHits.length === 1 &&
      originHits[0].object.userData.plane === 'xy';

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

    return {
      projection,
      faceRay,
      edgeRay,
      datumRay,
      originRay,
      sketchPlane,
      profileRay,
      orbit,
      transientPreview,
      inputSurface,
    };
  });

  assert.deepEqual(
    result,
    {
      projection: true,
      faceRay: true,
      edgeRay: true,
      datumRay: true,
      originRay: true,
      sketchPlane: true,
      profileRay: true,
      orbit: true,
      transientPreview: true,
      inputSurface: true,
    },
    `Three-free interaction proof failed: ${JSON.stringify(result)}`,
  );
  assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join('\n')}`);
  console.log(
    '  [ok] projection, orbit, face/edge/datum/origin/profile rays, sketch mapping, and Bevy preview transport',
  );
} finally {
  await browser.close();
}
