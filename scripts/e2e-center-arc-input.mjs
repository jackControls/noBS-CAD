/**
 * Center-point-arc input parity.
 *
 * 1. Every pick acquires the support-face edge midpoint, not just points and
 *    line endpoints (the same acquisition the line tool has).
 * 2. After the centre is placed a radius field follows the cursor; typing a
 *    value locks it, and the committed arc keeps that radius.
 * 3. The second and third picks acquire the projected face boundary and the
 *    remaining reference midpoints.
 *
 * Browser engine plus real pointer input, mirroring the reported workflow.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE = process.env.NBCAD_E2E_BASE_URL ?? 'http://localhost:7199';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error)));

const state = () => page.evaluate(() => window.__appStore.getState());
const sketch = async () => (await state()).activeSketch;
const close = (a, b, tolerance = 1e-6) => Math.hypot(a.x - b.x, a.y - b.y) <= tolerance;

const screenOf = async (x, y, offsetPx = 0) => {
  const screen = await page.evaluate(([sx, sy]) => window.__sketchToScreen(sx, sy), [x, y]);
  const bounds = await page.locator('.native-viewport-surface').boundingBox();
  const point = { x: screen.x + offsetPx, y: screen.y + offsetPx };
  assert.ok(
    point.x > bounds.x && point.x < bounds.x + bounds.width
      && point.y > bounds.y && point.y < bounds.y + bounds.height,
    `sketch point ${JSON.stringify({ x, y })} must be visible, got ${JSON.stringify(point)}`,
  );
  return point;
};
const moveSketch = async (x, y, offsetPx = 0) => {
  const screen = await screenOf(x, y, offsetPx);
  await page.mouse.move(screen.x, screen.y, { steps: 4 });
  await page.waitForTimeout(120);
};
const clickSketch = async (x, y, offsetPx = 0) => {
  const screen = await screenOf(x, y, offsetPx);
  // Move first: the floating value cluster follows the pointer, so an
  // instantaneous jump would land the pick on its still-stale position.
  await page.mouse.move(screen.x, screen.y, { steps: 3 });
  await page.waitForTimeout(120);
  await page.mouse.click(screen.x, screen.y);
  await page.waitForTimeout(200);
};
const arm = async (tool) => {
  await page.evaluate((next) => window.__appStore.getState().setActiveTool(next), tool);
  await page.waitForTimeout(120);
};
const cancel = async () => {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
};
const dynField = async (key) => {
  const current = await state();
  return current.dynInput.fields.find((field) => field.key === key) ?? null;
};
const arcOf = async () => {
  const current = await sketch();
  return current.entities.find((entity) => entity.kind === 'arc') ?? null;
};
/** Point count of every transient preview line the native viewport would draw. */
const previewPointCounts = () =>
  page.evaluate(() =>
    window.__nativeViewportTransient().lines.map((layer) => layer.segments.length / 6),
  );
/** How many points each transient point layer marks. The run's own picks ride
 * their own layer, so a pick that leaves exactly one (or two) marked points is
 * the run marking what it has picked so far. */
const markedPickCounts = () =>
  page.evaluate(() =>
    window.__nativeViewportTransient().points.map((layer) => layer.positions.length / 3),
  );

/** 20 x 15 x 10 body, sketch hosted on its top face. */
async function faceSketch() {
  return page.evaluate(async () => {
    const engine = window.__engine;
    const store = window.__appStore.getState();
    store.applySolidUpdate(await engine.newProject());
    await engine.beginSketch({ type: 'origin_plane', plane: 'xy' });
    await engine.setGridSnap(false);
    await engine.addRectangle({
      mode: 'two_point',
      p1: { x: 0, y: 0 },
      p2: { x: 20, y: 15 },
      ctrl_held: true,
    });
    const ended = await engine.endSketch();
    store.setDocument(ended.document);
    const catalog = await engine.profileCatalog();
    const update = await engine.extrude({
      source_face: null,
      sketch_name: catalog[0].sketch_name,
      profile_indices: [0],
      operation: 'new_body',
      extent: { type: 'distance', distance: 10 },
      taper_angle_deg: 0,
      flip: false,
      target_body_ids: [],
    });
    store.applySolidUpdate(update);
    const cap = update.scene.bodies[0].faces.find(
      (face) => face.plane && face.plane.normal[2] > 0.99,
    );
    const face = await engine.beginSketch({ type: 'planar_face', face_id: cap.id });
    store.setActiveSketch(face);
    store.setMode('sketch');
    const xs = face.projected_edges.flatMap((edge) => edge.points.map((point) => point.x));
    const ys = face.projected_edges.flatMap((edge) => edge.points.map((point) => point.y));
    return {
      midpoints: face.reference_midpoints.map((reference) => reference.position),
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
      center: { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 },
    };
  });
}

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(
    () => window.__appStore?.getState().document !== null && !!window.__engine,
  );

  await page.evaluate(() => window.__cameraApi.fit());
  await page.waitForTimeout(400);
  let frame = await faceSketch();
  await page.evaluate(() => window.__cameraApi.fit());
  await page.waitForTimeout(400);

  console.log('1. Hovering (no click) already shows the midpoint marker');
  const markerAt = async (x, y, offsetPx) => {
    const screen = await screenOf(x, y, offsetPx);
    await page.mouse.move(screen.x, screen.y, { steps: 4 });
    await page.waitForTimeout(220);
    return page.evaluate(() => window.__nativeViewportTransient().marker ?? null);
  };
  /** The snap marker is a sprite hovering 0.18 mm above the sketch plane. */
  const markerSitsOn = (tool, position, expected, normal) => {
    const offset = [
      position[0] - expected[0],
      position[1] - expected[1],
      position[2] - expected[2],
    ];
    const alongNormal =
      offset[0] * normal[0] + offset[1] * normal[1] + offset[2] * normal[2];
    const inPlane = Math.hypot(
      offset[0] - alongNormal * normal[0],
      offset[1] - alongNormal * normal[1],
      offset[2] - alongNormal * normal[2],
    );
    if (Math.abs(alongNormal - 0.18) > 1e-6 || inPlane > 1e-6) {
      console.log(`  [detail] ${tool} marker offset`, JSON.stringify(offset));
      return false;
    }
    return true;
  };
  /** World -> sketch coordinates (marker sprites are world-space children). */
  const sketchOf = (basis, position) => {
    const delta = [
      position[0] - basis.origin[0],
      position[1] - basis.origin[1],
      position[2] - basis.origin[2],
    ];
    const dot = (axis) => delta[0] * axis[0] + delta[1] * axis[1] + delta[2] * axis[2];
    return { x: dot(basis.u), y: dot(basis.v), n: dot(basis.normal) };
  };
  const worldOf = (basis, x, y) => [
    basis.origin[0] + basis.u[0] * x + basis.v[0] * y,
    basis.origin[1] + basis.u[1] * x + basis.v[1] * y,
    basis.origin[2] + basis.u[2] * x + basis.v[2] * y,
  ];
  const basis = await page.evaluate(() => window.__appStore.getState().activeSketch.basis);
  for (const tool of ['line', 'arcCenter']) {
    await arm(tool);
    const reference = await page.evaluate(
      () => window.__appStore.getState().activeSketch.reference_midpoints[0].position,
    );
    const marker = await markerAt(reference.x, reference.y, 4);
    assert.ok(marker, `${tool}: hovering a reference midpoint must show a marker`);
    assert.equal(
      marker.kind,
      'reference_midpoint',
      `${tool}: the marker must be the midpoint triangle, got ${marker.kind}`,
    );
    const expected = worldOf(basis, reference.x, reference.y);
    assert.ok(
      markerSitsOn(tool, marker.position, expected, basis.normal),
      `${tool}: the marker must sit on the midpoint, got ${JSON.stringify(marker.position)}`,
    );
    // The projected boundary is a snap locus too: aim along the edge, away
    // from its midpoint.
    const boundary = await page.evaluate(() => {
      const edges = window.__appStore.getState().activeSketch.projected_edges;
      const ys = edges.flatMap((edge) => edge.points.map((point) => point.y));
      const xs = edges.flatMap((edge) => edge.points.map((point) => point.x));
      const y = Math.max(...ys);
      const x = Math.min(...xs) + (Math.max(...xs) - Math.min(...xs)) * 0.3;
      return { x, y };
    });
    const edgeMarker = await markerAt(boundary.x, boundary.y, 5);
    assert.ok(edgeMarker, `${tool}: hovering the projected boundary must show a marker`);
    // A long edge is a locus, not a midpoint: it must not borrow the triangle.
    assert.equal(
      edgeMarker.kind,
      'curve',
      `${tool}: the projected boundary is a locus glyph, got ${edgeMarker.kind}`,
    );
    // The projected boundary is a locus: acquisition pins the perpendicular
    // coordinate and keeps where the cursor aimed along the edge.
    const edgeLocal = sketchOf(basis, edgeMarker.position);
    assert.ok(
      Math.abs(edgeLocal.n - 0.18) < 1e-6,
      `${tool}: the marker stays on the sketch plane, got n=${edgeLocal.n}`,
    );
    assert.ok(
      Math.abs(edgeLocal.y - boundary.y) < 1e-6,
      `${tool}: the marker must sit on the projected edge, got ${JSON.stringify(edgeLocal)}`,
    );
    assert.ok(
      Math.abs(edgeLocal.x - boundary.x) < 1,
      `${tool}: the along-edge position follows the cursor, got ${edgeLocal.x}`,
    );
  }
  await cancel();

  console.log('2. The centre pick acquires a support-face edge midpoint');

  assert.equal(frame.midpoints.length, 4, 'the face publishes four edge midpoints');
  const midpoint = frame.midpoints[0];
  await arm('arcCenter');
  // Aim a few pixels off the midpoint: acquisition must pull the pick onto it.
  await clickSketch(midpoint.x, midpoint.y, 4);
  let field = await dynField('radius');
  assert.ok(field, 'the radius field is armed once the centre is placed');
  await moveSketch(frame.center.x + 6, frame.center.y + 2);
  await clickSketch(frame.minX + 3, frame.maxY - 1);
  await moveSketch(frame.maxX - 2, frame.maxY - 3);
  await clickSketch(frame.maxX - 2, frame.maxY - 3);
  await page.waitForFunction(() =>
    window.__appStore.getState().activeSketch.entities.some((entity) => entity.kind === 'arc'),
  );
  await cancel();
  let arc = await arcOf();
  assert.ok(close(arc.center, midpoint), `centre ${JSON.stringify(arc.center)} must sit on ${JSON.stringify(midpoint)}`);

  console.log('3. The radius field follows the cursor and a typed value locks it');
  await arm('arcCenter');
  await clickSketch(frame.center.x, frame.center.y);
  await moveSketch(frame.center.x + 5, frame.center.y);
  field = await dynField('radius');
  assert.ok(field && field.locked === false, 'an untyped radius stays live');
  assert.ok(
    Math.abs(Number(field.value) - 5) < 0.1,
    `the live radius tracks the cursor, got ${field.value}`,
  );
  await page.keyboard.type('12', { delay: 40 });
  await page.waitForTimeout(250);
  field = await dynField('radius');
  assert.equal(field.locked, true, 'typing locks the field');
  assert.equal(field.value, '12');
  // Sweeping much farther must not redefine the locked radius.
  await moveSketch(frame.center.x + 11, frame.center.y + 1);
  field = await dynField('radius');
  assert.equal(field.value, '12', 'a locked radius ignores the cursor distance');
  await clickSketch(frame.center.x + 11, frame.center.y);
  await moveSketch(frame.center.x + 11, frame.center.y + 6);
  await clickSketch(frame.center.x + 11, frame.center.y + 6);
  await page.waitForFunction(() =>
    window.__appStore.getState().activeSketch.entities.filter((entity) => entity.kind === 'arc').length === 2,
  );
  await cancel();
  const arcs = (await sketch()).entities.filter((entity) => entity.kind === 'arc');
  const locked = arcs[arcs.length - 1];
  assert.ok(Math.abs(locked.radius - 12) < 1e-9, `locked radius ${locked.radius}`);
  assert.ok(close(locked.center, frame.center), 'the lock must not move the centre');
  const dimensions = (await sketch()).dimensions;
  assert.equal(dimensions.length, 1, `one radius dimension, got ${dimensions.length}`);
  assert.equal(dimensions[0].kind, 'radius');
  assert.equal(dimensions[0].text, 'R12.00');

  console.log('4. The remaining picks acquire the projected boundary and other midpoints');
  await arm('arcCenter');
  await clickSketch(frame.center.x, frame.center.y);
  // Second pick: a point on the projected top edge that is not its midpoint.
  const boundaryX = frame.minX + (frame.maxX - frame.minX) * 0.3;
  await clickSketch(boundaryX, frame.maxY, 5);
  // Third pick: the midpoint of another face edge.
  const otherMidpoint =
    frame.midpoints.find((point) => Math.abs(point.y - frame.maxY) > 1e-6) ?? frame.midpoints[1];
  await clickSketch(otherMidpoint.x, otherMidpoint.y, 4);
  await page.waitForFunction(() =>
    window.__appStore.getState().activeSketch.entities.filter((entity) => entity.kind === 'arc').length === 3,
  );
  await cancel();
  const last = (await sketch()).entities.filter((entity) => entity.kind === 'arc').pop();
  const start = {
    x: last.center.x + last.radius * Math.cos(last.start_angle),
    y: last.center.y + last.radius * Math.sin(last.start_angle),
  };
  assert.ok(
    Math.abs(start.y - frame.maxY) < 1e-9,
    `the start pick must land on the projected boundary, got ${JSON.stringify(start)}`,
  );
  assert.ok(
    Math.abs(start.x - boundaryX) < 1,
    `the along-edge coordinate stays where the cursor aimed, got ${start.x}`,
  );
  const sweptAngle = Math.atan2(otherMidpoint.y - last.center.y, otherMidpoint.x - last.center.x);
  const normalize = (angle) => ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const endAngle = normalize(last.end_angle) || 2 * Math.PI;
  assert.ok(
    Math.abs(normalize(endAngle - sweptAngle)) < 1e-6
      || Math.abs(normalize(endAngle - sweptAngle) - 2 * Math.PI) < 1e-6,
    `the third pick aims at the acquired midpoint: ${endAngle} vs ${normalize(sweptAngle)}`,
  );

  console.log('5. The pointer travel decides which half the arc covers');
  const drawDirectedArc = async ({ start: startPick, waypoints }) => {
    await arm('arcCenter');
    const before = (await sketch()).entities.filter((entity) => entity.kind === 'arc').length;
    await clickSketch(frame.center.x, frame.center.y);
    await clickSketch(frame.center.x + startPick.x, frame.center.y + startPick.y);
    for (const point of waypoints) {
      await moveSketch(frame.center.x + point.x, frame.center.y + point.y);
    }
    const last = waypoints[waypoints.length - 1];
    await clickSketch(frame.center.x + last.x, frame.center.y + last.y);
    await page.waitForFunction(
      (count) =>
        window.__appStore.getState().activeSketch.entities.filter(
          (entity) => entity.kind === 'arc',
        ).length === count + 1,
      before,
    );
    await cancel();
    const arcs = (await sketch()).entities.filter((entity) => entity.kind === 'arc');
    return arcs[arcs.length - 1];
  };
  // Reported case: from the right point, drag clockwise through the bottom to
  // the left point. Both halves share the same two rays, so only the path the
  // pointer took says which one to draw.
  const clockwise = await drawDirectedArc({
    start: { x: 5, y: 0 },
    waypoints: [{ x: 0, y: -5 }, { x: -5, y: 0 }],
  });
  const midRay = (arc) => (arc.start_angle + arc.end_angle) / 2;
  assert.ok(
    Math.abs(midRay(clockwise) + Math.PI / 2) < 1e-6,
    `a clockwise drag must cover the lower half, got mid ray ${midRay(clockwise)}`,
  );
  assert.ok(
    Math.abs(clockwise.end_angle - clockwise.start_angle - Math.PI) < 1e-6,
    'the stored arc must still be the half turn',
  );
  const counterClockwise = await drawDirectedArc({
    start: { x: 5, y: 0 },
    waypoints: [{ x: 0, y: 5 }, { x: -5, y: 0 }],
  });
  assert.ok(
    Math.abs(midRay(counterClockwise) - Math.PI / 2) < 1e-6,
    `a counter-clockwise drag must cover the upper half, got ${midRay(counterClockwise)}`,
  );
  // The live radius field must not outlive the run it belongs to.
  const afterRun = await state();
  assert.equal(afterRun.dynInput.active, false, 'the value cluster retires with the run');

  console.log('6. Placing the first endpoint must not leave a whole circle behind');
  await arm('arcCenter');
  await clickSketch(frame.center.x, frame.center.y);
  await moveSketch(frame.center.x + 6, frame.center.y);
  // The centre is not a sketch entity yet, so the run has to mark it itself.
  const afterCentre = await markedPickCounts();
  assert.ok(
    afterCentre.includes(1),
    `the centre pick must leave a marker of its own, got ${JSON.stringify(afterCentre)}`,
  );
  // While the radius is undefined the closed circle IS the radius affordance.
  const radiusGuide = Math.max(0, ...(await previewPointCounts()));
  assert.ok(
    radiusGuide > 20,
    `the radius guide is a closed circle, got ${radiusGuide} points`,
  );
  await clickSketch(frame.center.x + 6, frame.center.y);
  // ... and the first endpoint joins it, without waiting for a pointer move.
  const afterStartPick = await markedPickCounts();
  assert.ok(
    afterStartPick.includes(2),
    `the first endpoint pick must add its own marker, got ${JSON.stringify(afterStartPick)}`,
  );
  // The radius is fixed by this pick, so the circle must retire at once —
  // without waiting for the next pointer move. Leaving it on screen is what
  // read as "I had just placed the first endpoint and it drew the whole
  // circle".
  const afterStart = await previewPointCounts();
  assert.ok(
    afterStart.every((count) => count < 10),
    `the radius circle must retire at the start pick, got ${JSON.stringify(afterStart)}`,
  );
  // A third pick that never moved describes no sweep, so nothing may commit.
  const beforeNoTravel = (await sketch()).entities.filter((entity) => entity.kind === 'arc').length;
  await clickSketch(frame.center.x + 6, frame.center.y);
  assert.equal(
    (await sketch()).entities.filter((entity) => entity.kind === 'arc').length,
    beforeNoTravel,
    'a pick with no pointer travel must not commit a full circle',
  );
  assert.equal(
    (await state()).activeTool,
    'arcCenter',
    'the run stays armed so the sweep can still be drawn',
  );
  // Two pixels is a click too: the snap pulls the pick back onto the start ray.
  const startPixel = await screenOf(frame.center.x + 6, frame.center.y);
  await page.mouse.move(startPixel.x, startPixel.y, { steps: 2 });
  await page.mouse.click(startPixel.x + 2, startPixel.y + 2);
  await page.waitForTimeout(260);
  assert.equal(
    (await sketch()).entities.filter((entity) => entity.kind === 'arc').length,
    beforeNoTravel,
    'a two pixel nudge is still not a sweep',
  );
  // ... and the very next real move sweeps a normal arc.
  await moveSketch(frame.center.x + 4, frame.center.y + 4);
  await clickSketch(frame.center.x + 4, frame.center.y + 4);
  await page.waitForFunction(
    (count) =>
      window.__appStore.getState().activeSketch.entities.filter(
        (entity) => entity.kind === 'arc',
      ).length === count + 1,
    beforeNoTravel,
  );
  await cancel();
  const swept = (await sketch()).entities.filter((entity) => entity.kind === 'arc').pop();
  assert.ok(
    Math.abs(swept.end_angle - swept.start_angle - Math.PI / 4) < 1e-6,
    `the deferred pick still sweeps a quarter turn: ${swept.start_angle} .. ${swept.end_angle}`,
  );

  console.log('7. A finished run hands the cursor back to its armed tool');
  await arm('arcCenter');
  const cursorState = () =>
    page.evaluate(() => {
      const badge = document.querySelector('[data-testid="active-tool-cursor"]');
      const transient = window.__nativeViewportTransient();
      return {
        marker: transient.marker ? transient.marker.kind : null,
        badge: badge ? getComputedStyle(badge).display !== 'none' : false,
        badgeIcon: badge?.dataset.activeToolIcon ?? null,
      };
    });
  await clickSketch(frame.center.x, frame.center.y);
  await moveSketch(frame.center.x + 6, frame.center.y);
  const beforeFirstPick = await cursorState();
  assert.ok(
    beforeFirstPick.marker !== null,
    'an armed tool advertises its first pick before any point is placed',
  );
  const beforeCommit = (await sketch()).entities.filter((entity) => entity.kind === 'arc').length;
  await clickSketch(frame.center.x + 6, frame.center.y);
  await moveSketch(frame.center.x + 4, frame.center.y + 4);
  await clickSketch(frame.center.x + 4, frame.center.y + 4);
  await page.waitForFunction(
    (count) =>
      window.__appStore.getState().activeSketch.entities.filter(
        (entity) => entity.kind === 'arc',
      ).length === count + 1,
    beforeCommit,
  );
  // Read the cursor with NO pointer move between the commit and this point:
  // the finished run must already be back to the armed, first-pick state.
  const afterCommit = await cursorState();
  assert.equal(
    (await state()).activeTool,
    'arcCenter',
    'the tool stays armed until Esc, as the line tool does',
  );
  assert.ok(
    afterCommit.marker !== null,
    `the committed run must leave a live acquisition marker, got ${afterCommit.marker}`,
  );
  assert.equal(afterCommit.badge, true, 'the armed command badge stays on the cursor');
  assert.equal(
    afterCommit.badgeIcon,
    beforeFirstPick.badgeIcon,
    'the cursor keeps the same command identity it had before the first pick',
  );
  // Leaving the viewport drops the whole command cursor. The native viewport
  // renders on demand, so this only reaches the screen if the HUD asked for a
  // frame — a cursor left drawn at the last pick is exactly the stale HUD.
  await page.mouse.move(4, 4);
  await page.waitForTimeout(220);
  const away = await cursorState();
  assert.equal(away.badge, false, 'the command badge clears when the pointer leaves');
  assert.equal(away.marker, null, 'the acquisition marker clears with it');
  await cancel();

  console.log('8. The sweep angle follows the cursor, takes a typed value, and Tab reaches it');
  await arm('arcCenter');
  await clickSketch(frame.center.x, frame.center.y);
  await moveSketch(frame.center.x + 6, frame.center.y);
  // The included angle means nothing until the first endpoint fixes the start
  // ray, so only the radius is offered before it.
  let angleField = await dynField('angle');
  assert.ok(angleField, 'the angle field is armed with the tool');
  assert.equal(angleField.visible, false, 'the angle stays out of the way before the first endpoint');
  assert.ok(await dynField('radius'), 'the radius is live straight after the centre');
  await clickSketch(frame.center.x + 6, frame.center.y);
  const angleDegrees = async () => Number((await dynField('angle'))?.value);
  await moveSketch(frame.center.x, frame.center.y + 6);
  assert.ok(
    Math.abs((await angleDegrees()) - 90) < 0.5,
    `the angle follows the cursor, got ${await angleDegrees()}`,
  );
  // The first deliberate CCW move latches positive direction. Moving across
  // the start ray now describes the major CCW arc, not a sign reversal.
  await moveSketch(frame.center.x, frame.center.y - 6);
  assert.ok(
    Math.abs((await angleDegrees()) - 270) < 0.5,
    `the first direction stays CCW, got ${await angleDegrees()}`,
  );
  // Tab moves between the two fields exactly as it does for the line.
  const focusedField = () =>
    page.evaluate(() => {
      const d = window.__appStore.getState().dynInput;
      const visible = d.fields.filter((f) => f.visible);
      return d.focus === null ? null : visible[d.focus]?.key ?? null;
    });
  await page.keyboard.press('Tab');
  await page.waitForTimeout(120);
  assert.equal(await focusedField(), 'radius', 'Tab reaches the first field');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(120);
  assert.equal(await focusedField(), 'angle', 'Tab moves on to the angle');
  await page.keyboard.type('45', { delay: 40 });
  await page.waitForTimeout(250);
  angleField = await dynField('angle');
  assert.equal(angleField.locked, true, 'typing locks the angle');
  assert.equal(angleField.value, '45');
  assert.equal((await dynField('radius')).locked, false, 'the radius stays live');
  // Typed angle overrides the pointer, sign included.
  const commitCurrentAngle = async (waypoint) => {
    const before = (await sketch()).entities.filter((entity) => entity.kind === 'arc').length;
    await moveSketch(frame.center.x + waypoint.x, frame.center.y + waypoint.y);
    await clickSketch(frame.center.x + waypoint.x, frame.center.y + waypoint.y);
    await page.waitForFunction(
      (count) =>
        window.__appStore.getState().activeSketch.entities.filter(
          (entity) => entity.kind === 'arc',
        ).length === count + 1,
      before,
    );
    await cancel();
    return (await sketch()).entities.filter((entity) => entity.kind === 'arc').pop();
  };
  const lockedSweep = await commitCurrentAngle({ x: 0, y: -4 });
  assert.ok(
    Math.abs(lockedSweep.end_angle - lockedSweep.start_angle - Math.PI / 4) < 1e-6,
    `the typed angle sizes the sweep: ${lockedSweep.start_angle} .. ${lockedSweep.end_angle}`,
  );
  assert.ok(
    (lockedSweep.start_angle + lockedSweep.end_angle) / 2 > 0,
    'a typed +45 stays counter-clockwise whatever the pointer did',
  );
  // The reported case: the pointer dragged clockwise, -45 typed, and then the
  // pointer drifted back across the start ray before the click. The arc must
  // follow the number, not that drift.
  await arm('arcCenter');
  await clickSketch(frame.center.x, frame.center.y);
  await clickSketch(frame.center.x + 6, frame.center.y);
  await moveSketch(frame.center.x, frame.center.y - 5);
  const driftedAngle = await dynField('angle');
  assert.ok(
    Number(driftedAngle.value) < 0,
    `the drag reads clockwise before typing, got ${driftedAngle.value}`,
  );
  await page.keyboard.press('Tab');
  await page.waitForTimeout(120);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(120);
  assert.equal(await focusedField(), 'angle', 'Tab reaches the angle for the second arc');
  // Replacing an autofilled negative magnitude preserves its minus sign.
  await page.keyboard.type('45', { delay: 40 });
  await page.waitForTimeout(250);
  angleField = await dynField('angle');
  assert.equal(angleField.locked, true, 'the negative angle locks');
  assert.equal(angleField.value, '-45');
  const clockwiseSweep = await commitCurrentAngle({ x: 0, y: 6 });
  assert.ok(
    Math.abs(clockwiseSweep.end_angle - clockwiseSweep.start_angle - Math.PI / 4) < 1e-6,
    `the typed -45 keeps its size: ${clockwiseSweep.start_angle} .. ${clockwiseSweep.end_angle}`,
  );
  assert.ok(
    (clockwiseSweep.start_angle + clockwiseSweep.end_angle) / 2 < 0,
    'a typed -45 stays clockwise',
  );
  // An explicit opposite sign reverses the remembered initial direction.
  await arm('arcCenter');
  await clickSketch(frame.center.x, frame.center.y);
  await clickSketch(frame.center.x + 6, frame.center.y);
  await moveSketch(frame.center.x, frame.center.y - 5);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.type('+45', { delay: 40 });
  await page.waitForTimeout(250);
  assert.equal((await dynField('angle')).value, '+45');
  const reversed = await commitCurrentAngle({ x: 0, y: -6 });
  assert.ok((reversed.start_angle + reversed.end_angle) / 2 > 0, 'explicit + reverses CW to CCW');
  // A typed angle is dimensioned like a typed radius: the annotation must
  // survive the commit so the sweep stays readable and editable.
  // Earlier steps already own a radius dimension, so find this arc's angle one.
  const sweepDimensions = (await sketch()).dimensions.filter(
    (dimension) => dimension.kind === 'angle' && dimension.entities.includes(lockedSweep.id),
  );
  assert.equal(
    sweepDimensions.length,
    1,
    `one sweep dimension for this arc, got ${JSON.stringify(sweepDimensions)}`,
  );
  assert.equal(sweepDimensions[0].text, '45.00°');
  const dimensionReach = Math.hypot(
    sweepDimensions[0].text_pos.x - lockedSweep.center.x,
    sweepDimensions[0].text_pos.y - lockedSweep.center.y,
  );
  assert.ok(
    dimensionReach < lockedSweep.radius,
    `an angular dimension reads inside the arc, got ${dimensionReach}`,
  );

  assert.deepEqual(pageErrors, []);
  console.log('center-arc input: all checks passed');
} finally {
  await browser.close();
}
