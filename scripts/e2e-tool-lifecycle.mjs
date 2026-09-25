// Real pointer workflows with deliberately late preview/mutation replies.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
async function fresh() {
  await page.evaluate(async () => {
    const e = window.__engine;
    const s = window.__appStore.getState();
    s.setActiveTool(null);
    s.setMode('solid');
    s.applySolidUpdate(await e.newProject());
    const sketch = await e.beginSketch({ type: 'origin_plane', plane: 'xy' });
    await e.setGridSnap(false);
    s.setActiveSketch(sketch);
    s.setMode('sketch');
  });
  await page.evaluate(() => window.__cameraApi.fit());
  await page.waitForTimeout(450);
}
async function pick(x, y, click = true) {
  const p = await page.evaluate(([x, y]) => window.__sketchToScreen(x, y), [x, y]);
  await page.mouse.move(p.x, p.y, { steps: 4 });
  await page.waitForTimeout(130);
  if (click) await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(100);
}
async function arm(tool) {
  await page.evaluate(tool => window.__appStore.getState().setActiveTool(tool), tool);
  await page.waitForTimeout(80);
}
async function hold(method) {
  await page.evaluate(method => {
    const e = window.__engine;
    const original = e[method].bind(e);
    window.__heldCalls = 0;
    window.__heldReplies = [];
    e[method] = async request => {
      window.__heldCalls++;
      const result = await original(request);
      await new Promise(resolve => window.__heldReplies.push(resolve));
      return result;
    };
    window.__restoreHeld = () => { e[method] = original; };
  }, method);
}
async function release() {
  await page.evaluate(() => {
    window.__restoreHeld();
    window.__heldReplies.splice(0).forEach(resolve => resolve());
  });
  await page.waitForTimeout(200);
}
try {
  await page.goto(process.env.NBCAD_E2E_BASE_URL ?? 'http://localhost:7199', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__engine && window.__appStore?.getState().document);
  for (const [tool, method, picks] of [
    ['rect2pt', 'addRectangleLocked', [[-15, -10], [15, 10]]],
    ['rectCenter', 'addRectangleLocked', [[0, 0], [15, 10]]],
    ['circleCenter', 'addCircleLocked', [[0, 0], [15, 10]]],
    ['circle2pt', 'addCircleLocked', [[-15, -10], [15, 10]]],
    ['arc3pt', 'addArc3pt', [[-15, 0], [0, 15], [15, 0]]],
    ['slot', 'addSlot', [[-15, 0], [15, 0], [0, 5]]],
  ]) {
    await fresh();
    await arm(tool);
    await hold(method);
    for (const [x, y] of picks) await pick(x, y);
    await page.waitForFunction(() => window.__heldReplies.length === 1);
    // Extra Enter and click while a reply is pending cannot duplicate it.
    await page.keyboard.press('Enter');
    await pick(...picks[picks.length - 1]);
    assert.equal(await page.evaluate(() => window.__heldCalls), 1, `${tool}: duplicate submission`);
    await page.keyboard.press('Escape');
    await arm('line');
    await pick(-25, -20);
    await release();
    const result = await page.evaluate(() => ({
      tool: window.__appStore.getState().activeTool,
      points: window.__nativeViewportTransient().points.map(p => p.positions.length / 3),
      entities: window.__appStore.getState().activeSketch.entities.length,
    }));
    assert.equal(result.tool, 'line');
    assert.ok(result.points.includes(1), `${tool}: old completion cleared the next tool's first pick`);
    assert.ok(result.entities > 0, 'completed engine mutation is reflected in the same sketch');
    console.log(`PASS ${tool}: duplicate submit and late-completion isolation`);
  }

  await fresh();
  await arm('circleCenter');
  await pick(0, 0);
  await page.evaluate(() => {
    const e = window.__engine;
    const original = e.addCircleLocked.bind(e);
    e.addCircleLocked = async request => {
      e.addCircleLocked = original;
      throw new Error('Test: commit rejected before mutation');
    };
  });
  await pick(15, 10);
  await page.waitForFunction(() => window.__appStore.getState().constraintDialog !== null);
  const rejected = await page.evaluate(() => ({
    entities: window.__appStore.getState().activeSketch.entities.length,
    pending: window.__appStore.getState().dynInput.pending,
    tool: window.__appStore.getState().activeTool,
  }));
  assert.deepEqual(rejected, { entities: 0, pending: false, tool: 'circleCenter' });
  await page.evaluate(() => window.__appStore.getState().setConstraintDialog(null));
  await pick(15, 10);
  await page.waitForFunction(() => window.__appStore.getState().activeSketch.entities.some(e => e.kind === 'circle'));
  assert.equal(await page.evaluate(() => window.__appStore.getState().activeSketch.entities.filter(e => e.kind === 'circle').length), 1);
  console.log('PASS failed commit leaves no geometry and permits one clean retry');

  for (const distance of [-2, 2]) {
    await fresh();
    const source = await page.evaluate(async () => {
      const result = await window.__engine.addLine({ from: { x: 20, y: 20 }, to_raw: { x: 50, y: 20 }, ctrl_held: true });
      window.__appStore.getState().setActiveSketch(result.sketch);
      return result.entity_id;
    });
    await page.evaluate(() => window.__cameraApi.fit());
    await page.waitForTimeout(450);
    await arm('offset');
    await pick(35, 20);
    await pick(35, 30, false);
    await page.keyboard.type(`=${distance}`);
    await page.waitForTimeout(400);
    await pick(35, 10, false); // pointer crosses the source after numeric intent
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__appStore.getState().activeSketch.entities.filter(e => e.kind === 'line').length === 2);
    const result = await page.evaluate(source => window.__appStore.getState().activeSketch.entities.find(e => e.kind === 'line' && e.id !== source), source);
    assert.ok(Math.abs(result.start.y - (20 + distance)) < 1e-6, 'pointer drift must not reverse the typed signed offset');
  }
  console.log('PASS signed offset formulas keep the chosen side through pointer drift');

  await fresh();
  await arm('circleCenter');
  await pick(0, 0);
  await hold('previewCreation');
  await pick(15, 10, false);
  await page.waitForFunction(() => window.__heldReplies.length > 0);
  await page.keyboard.press('Escape');
  await arm('line');
  await pick(-20, -10);
  const before = await page.evaluate(() => window.__nativeViewportTransient().lines);
  await release();
  const after = await page.evaluate(() => window.__nativeViewportTransient().lines);
  assert.deepEqual(after, before, 'cancelled preview must not resurrect a circle over the new tool');

  await fresh();
  await arm('circleCenter');
  await pick(0, 0);
  await hold('addCircleLocked');
  await pick(15, 10);
  await page.waitForFunction(() => window.__heldReplies.length === 1);
  const newName = await page.evaluate(async () => {
    const e = window.__engine;
    const s = window.__appStore.getState();
    s.setActiveTool(null);
    s.setDocument((await e.endSketch()).document);
    s.setMode('solid');
    const next = await e.beginSketch({ type: 'origin_plane', plane: 'yz' });
    s.setActiveSketch(next);
    s.setMode('sketch');
    return next.name;
  });
  await release();
  assert.equal(await page.evaluate(() => window.__appStore.getState().activeSketch.name), newName, 'late result must not replace another sketch');
  assert.deepEqual(errors, []);
  console.log('PASS late preview and cross-sketch reply isolation');
} finally { await browser.close(); }
