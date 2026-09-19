// Issue #137: draw arcs, acquire their endpoint points, and apply both tangencies.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';

const output = join(tmpdir(), 'nbcad-arc-endpoints');
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
const sketch = () => page.evaluate(() => window.__appStore.getState().activeSketch);
const clickSketch = async ({ x, y }) => {
  const screen = await page.evaluate(p => window.__sketchToScreen(p.x, p.y), { x, y });
  const bounds = await page.locator('.native-viewport-surface').boundingBox();
  assert.ok(screen.x > bounds.x && screen.x < bounds.x + bounds.width && screen.y > bounds.y && screen.y < bounds.y + bounds.height,
    `drawing point ${JSON.stringify({ x, y, screen, bounds })} must be visible`);
  await page.mouse.click(screen.x, screen.y);
  await page.waitForTimeout(180);
};
const arm = async tool => {
  await page.evaluate(tool => window.__appStore.getState().setActiveTool(tool), tool);
  await page.waitForTimeout(100);
};
const reset = async () => {
  await page.evaluate(async () => {
    const engine = window.__engine;
    const store = window.__appStore.getState();
    store.applySolidUpdate(await engine.newProject());
    await engine.beginSketch({ type: 'origin_plane', plane: 'xy' });
    store.setActiveSketch(await engine.setGridSnap(false));
    store.setMode('sketch');
  });
  await page.waitForTimeout(300);
};

try {
  await page.goto(process.env.NBCAD_E2E_BASE_URL ?? 'http://localhost:7199', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__appStore?.getState().document && window.__engine);

  for (const tool of ['arc3pt', 'arcCenter']) {
    await reset();
    await arm(tool);
    const picks = tool === 'arc3pt'
      ? [{ x: 30, y: 30 }, { x: 38, y: 32 }, { x: 40, y: 40 }]
      : [{ x: 30, y: 40 }, { x: 30, y: 30 }, { x: 40, y: 40 }];
    for (const pick of picks) {
      await clickSketch(pick);
      await page.waitForTimeout(100);
    }
    await page.waitForFunction(() => window.__appStore.getState().activeSketch.entities.some(e => e.kind === 'arc'));
    await page.keyboard.press('Escape');
    const drawn = await sketch();
    const arc = drawn.entities.find(e => e.kind === 'arc');
    const anchors = drawn.constraints.filter(c => c.type === 'arc_endpoint_coincident' && c.arc === arc.id);
    assert.equal(anchors.length, 2, `${tool} exposes both endpoint handles: ${JSON.stringify(drawn)}`);
    assert.equal(drawn.dof.value, 5, 'handles add no degrees of freedom');
    await page.evaluate(() => window.__cameraApi.fit());
    await page.waitForTimeout(400);

    // Save the standalone fixture through the production archive writer for
    // packaged desktop visual QA, and reopen it through the real engine.
    const saved = await page.evaluate(async () => {
      const engine = window.__engine;
      const store = window.__appStore.getState();
      const name = store.activeSketch.name;
      await engine.endSketch();
      const model = await engine.exportProjectModel();
      const { createNbcadArchive } = await import('/src/files/nbcad.ts');
      await engine.loadProjectModel(model);
      store.setActiveSketch(await engine.editSketch(name));
      return Array.from(createNbcadArchive(model));
    });
    await writeFile(join(output, `${tool}.nbcad`), Uint8Array.from(saved));
    assert.deepEqual((await sketch()).entities, drawn.entities, 'save/reopen preserves endpoint ids and positions');

    await page.evaluate(async () => {
      const engine = window.__engine;
      window.__appStore.getState().setActiveSketch(await engine.setGridSnap(true));
      await engine.setGridStep(1);
    });
    const start = drawn.entities.find(e => e.id === anchors.find(a => a.end === 'start').point);
    const end = drawn.entities.find(e => e.id === anchors.find(a => a.end === 'end').point);
    await arm('line');
    await clickSketch(start.position);
    await clickSketch({ x: start.position.x - 3, y: start.position.y });
    await page.waitForFunction(() => window.__appStore.getState().activeSketch.entities.some(e => e.kind === 'line'));
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await arm('line');
    await clickSketch({ x: end.position.x, y: end.position.y + 3 });
    await clickSketch(end.position);
    await page.waitForFunction(() => window.__appStore.getState().activeSketch.entities.filter(e => e.kind === 'line').length === 2);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    const lines = (await sketch()).entities.filter(e => e.kind === 'line');
    assert.equal(lines[0].start_id, start.id, 'line starts on the arc endpoint');
    assert.equal(lines[1].end_id, end.id, 'line ends on the arc endpoint');
    await page.screenshot({ path: join(output, `${tool}.png`) });
    console.log(`PASS ${tool}: draw, save/reopen, start and end lines on endpoint handles`);
  }

  for (const [reverse, arcFirst] of [[false, false], [true, false], [false, true], [true, true]]) {
    await reset();
    const ids = await page.evaluate(async arcFirst => {
      const engine = window.__engine;
      const store = window.__appStore.getState();
      await engine.setGridSnap(true);
      await engine.setGridStep(1);
      const drawArc = () => engine.addArc3pt({ p1: { x: 30, y: 30 }, p2: { x: 38, y: 32 }, p3: { x: 40, y: 40 } });
      let arc = arcFirst ? await drawArc() : null;
      const horizontal = await engine.addLine({
        from: { x: arcFirst ? 30 : 10, y: 30 }, to_raw: { x: arcFirst ? 24.45 : 30, y: 30 },
      });
      const vertical = await engine.addLine({ from: { x: 40, y: 40 }, to_raw: { x: 40, y: arcFirst ? 42.13 : 60 } });
      arc ??= await drawArc();
      // Lines created after the arc have the most recent sketch snapshot.
      if (arcFirst) arc.sketch = vertical.sketch;
      store.setActiveSketch(arc.sketch);
      return { horizontal: horizontal.entity_id, vertical: vertical.entity_id, arc: arc.entities[0] };
    }, arcFirst);
    const carriers = reverse ? [ids.vertical, ids.horizontal] : [ids.horizontal, ids.vertical];
    for (const [index, line] of carriers.entries()) {
      await page.evaluate(selected => window.__appStore.getState().setSelectedEntities(selected),
        reverse ? [ids.arc, line] : [line, ids.arc]);
      await page.locator('[data-ribbon-button="tangent"]').click();
      await page.waitForFunction(count => window.__appStore.getState().activeSketch.constraints.filter(c => c.type === 'tangent').length === count, index + 1);
      assert.equal(await page.getByRole('dialog').count(), 0, 'valid tangent does not show a conflict');
    }
    const solved = await sketch();
    const arc = solved.entities.find(e => e.id === ids.arc);
    const horizontal = solved.entities.find(e => e.id === ids.horizontal);
    const vertical = solved.entities.find(e => e.id === ids.vertical);
    assert.ok(Math.abs((arcFirst ? horizontal.start : horizontal.end).x - arc.center.x) < 1e-6);
    assert.ok(Math.abs(vertical.start.y - arc.center.y) < 1e-6);
    for (const line of [horizontal, vertical]) {
      assert.ok(Math.hypot(line.end.x - line.start.x, line.end.y - line.start.y) > 1, 'tangency preserves finite carriers');
    }
    console.log(`PASS ribbon tangency at both arc ends (${reverse ? 'vertical first' : 'horizontal first'}, ${arcFirst ? 'arc then short lines' : 'lines then arc'})`);
  }
  assert.deepEqual(errors, []);
} catch (error) {
  console.log(await page.evaluate(() => {
    const s = window.__appStore.getState();
    return { activeSketch: s.activeSketch, activeTool: s.activeTool, dynInput: s.dynInput };
  }));
  await page.screenshot({ path: join(output, 'failure.png') });
  throw error;
} finally {
  await browser.close();
}
