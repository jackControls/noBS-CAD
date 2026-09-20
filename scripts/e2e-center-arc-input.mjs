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
  await page.mouse.click(screen.x, screen.y);
  await page.waitForTimeout(180);
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

  console.log('1. The centre pick acquires a support-face edge midpoint');
  await page.evaluate(() => window.__cameraApi.fit());
  await page.waitForTimeout(400);
  let frame = await faceSketch();
  await page.evaluate(() => window.__cameraApi.fit());
  await page.waitForTimeout(400);
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

  console.log('2. The radius field follows the cursor and a typed value locks it');
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

  console.log('3. The remaining picks acquire the projected boundary and other midpoints');
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

  assert.deepEqual(pageErrors, []);
  console.log('center-arc input: all checks passed');
} finally {
  await browser.close();
}
