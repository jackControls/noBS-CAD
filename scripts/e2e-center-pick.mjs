// Issue #151: the nearest point wins its click; only a genuinely shared circle
// center redirects to its newest circle. Creation order must not steal hits.
// Real pointer events against the built browser engine (not native visual QA).
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(String(error)));

async function fixture(scenario) {
  return page.evaluate(async scenario => {
    const engine = window.__engine;
    const store = window.__appStore.getState();
    store.applySolidUpdate(await engine.newProject());
    const begun = await engine.beginSketch({ type: 'origin_plane', plane: 'xy' });
    store.setActiveSketch(begun);
    store.setMode('sketch');
    store.setActiveTool(null);
    store.setSelectedEntities([]);
    store.setSelectedEntity(null);
    await engine.setGridSnap(false);
    let unrelated = null;
    if (scenario === 'unrelated-point') {
      unrelated = (await engine.addPoint({ position: { x: 20.1, y: 10.1 }, ctrl_held: true })).entities[0];
    }
    const first = await engine.addCircle({
      mode: 'center_diameter',
      p1: { x: 20, y: 10 },
      p2: { x: 30, y: 10 },
      ctrl_held: true,
    });
    const firstCircle = first.entities[0];
    const firstCenter = first.sketch.constraints.find(
      c => c.type === 'center_coincident' && c.curve === firstCircle,
    ).point;
    let result = first;
    let secondCenter = null;
    if (scenario !== 'lone-circle') {
      // A distinct center sits 0.2 mm away: well inside the pointer hit
      // tolerance at ordinary zoom, but it is its own point.
      const x = scenario.startsWith('distinct-centers') ? 20.2 : 20;
      result = await engine.addCircle({
        mode: 'center_diameter',
        p1: { x, y: 10 },
        p2: { x: x + 15, y: 10 },
        ctrl_held: true,
      });
      const secondCircle = result.entities[0];
      secondCenter = result.sketch.constraints.find(
        c => c.type === 'center_coincident' && c.curve === secondCircle,
      ).point;
    }
    if (scenario === 'unrelated-point-after-circles') {
      result = await engine.addPoint({ position: { x: 20.1, y: 10.1 }, ctrl_held: true });
      unrelated = result.entities[0];
    }
    store.setActiveSketch(result.sketch);
    return {
      expected: unrelated ?? (scenario === 'distinct-centers-second' ? secondCenter : firstCenter),
      click: unrelated !== null ? { x: 20.1, y: 10.1 }
        : { x: scenario === 'distinct-centers-second' ? 20.2 : 20, y: 10 },
      firstCenter,
      secondCenter,
      unrelated,
    };
  }, scenario);
}

async function clickSketchPoint(position) {
  const location = await page.evaluate(p => window.__sketchToScreen(p.x, p.y), position);
  const bounds = await page.locator('.native-viewport-surface').boundingBox();
  assert.ok(
    location.x > bounds.x && location.x < bounds.x + bounds.width &&
      location.y > bounds.y && location.y < bounds.y + bounds.height,
    'pointer target must be inside the viewport',
  );
  await page.mouse.move(location.x, location.y);
  await page.mouse.click(location.x, location.y);
  await page.waitForTimeout(200);
  return page.evaluate(() => window.__appStore.getState().selectedEntity);
}

try {
  await page.goto(process.env.NBCAD_E2E_BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(
    () => window.__appStore?.getState().engineKind === 'wasm' && !!window.__engine,
  );

  // A point that is not shared must win its own click, even 0.2 mm from
  // another center and even though both sit inside the pointer tolerance.
  for (const scenario of ['lone-circle', 'distinct-centers', 'distinct-centers-second',
    'unrelated-point', 'unrelated-point-after-circles']) {
    const data = await fixture(scenario);
    await page.evaluate(() => window.__cameraApi.fit());
    await page.waitForTimeout(500);
    const selected = await clickSketchPoint(data.click);
    assert.equal(selected, data.expected, `${scenario}: expected entity ${data.expected}, got ${selected}`);
    console.log(`PASS ${scenario}: the click selects the point under the pointer`);
  }

  // The concentric case must still hand the shared handle to the newest circle
  // when the point itself is genuinely shared by two owners.
  const shared = await fixture('concentric-pair');
  await page.evaluate(() => window.__cameraApi.fit());
  await page.waitForTimeout(500);
  const onSharedCenter = await page.evaluate(() => {
    const store = window.__appStore.getState();
    return store.activeSketch.entities.filter(e => e.kind === 'circle').map(e => e.id);
  });
  const selectedShared = await clickSketchPoint({ x: 20, y: 10 });
  assert.equal(
    selectedShared, onSharedCenter.at(-1),
    'a genuinely shared center must select the newest circle',
  );
  assert.equal(shared.secondCenter, shared.firstCenter, 'the pair really shares one handle');
  console.log('PASS concentric-pair: a genuinely shared center resolves to its circle');

  assert.deepEqual(pageErrors, [], 'no unrelated application errors');
} finally {
  await browser.close();
}
console.log('\ncenter pick: all checks passed');
