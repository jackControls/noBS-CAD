/**
 * noBS CAD M1d end-to-end verification (real Chromium via Playwright).
 * UX bugfix round — REAL UI clicks only (owner rule):
 *   1. Wheel mapping (D11): swipe=pan, notch/pinch=zoom, shift=orbit
 *   2. Rectangle dyn-input cluster stays live through the ENTIRE run
 *   3. Fillet activates from BOTH the ribbon button and the menu item
 *   4. Midpoint auto-snap: triangle marker + auto Midpoint constraint (D4.1)
 *   5. Finished sketches render in 3D and re-edit via browser double-click
 *   6. Brand: noBS CAD in the integrated ribbon header and window title
 * Screenshots land in docs/qa/m1d/.
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'http://localhost:7199';
const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, '..', 'docs', 'qa', 'm1d');

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  [${ok ? 'ok' : 'FAIL'}] ${name}${ok ? '' : ` — ${detail}`}`);
  if (!ok) failures += 1;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 300)));

const state = () => page.evaluate(() => window.__appStore.getState());
const sketch = async () => (await state()).activeSketch;
const shot = (name) => page.screenshot({ path: path.join(shots, `${name}.png`) });
const clickSketch = async (x, y) => {
  const p = await page.evaluate(([sx, sy]) => window.__sketchToScreen(sx, sy), [x, y]);
  await page.mouse.click(p.x, p.y);
};
const moveSketch = async (x, y) => {
  const p = await page.evaluate(([sx, sy]) => window.__sketchToScreen(sx, sy), [x, y]);
  await page.mouse.move(p.x, p.y, { steps: 4 });
};
const wheel = (opts) =>
  page.evaluate((o) => {
    const el = [...document.querySelectorAll('canvas')].sort((a, b) => b.width - a.width)[0];
    el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ...o }));
  }, opts);
const camSnap = () => page.evaluate(() => window.__cameraApi.getSnapshot());
const camDist = (s) =>
  Math.hypot(s.position[0] - s.target[0], s.position[1] - s.target[1], s.position[2] - s.target[2]);
const ribbonLabelIssues = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-ribbon-button-label]')].flatMap((label) => {
      const box = label.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(label);
      const content = range.getBoundingClientRect();
      const style = getComputedStyle(label);
      const tolerance = 0.75;
      const clipped =
        content.left < box.left - tolerance ||
        content.right > box.right + tolerance ||
        content.top < box.top - tolerance ||
        content.bottom > box.bottom + tolerance ||
        label.scrollWidth > label.clientWidth + 1 ||
        label.scrollHeight > label.clientHeight + 1 ||
        style.textOverflow === 'ellipsis';
      return clipped
        ? [{
            button: label.closest('[data-ribbon-button]')?.getAttribute('data-ribbon-button'),
            text: label.textContent?.trim(),
            box: [box.width, box.height],
            content: [content.width, content.height],
            scroll: [label.scrollWidth, label.scrollHeight],
            textOverflow: style.textOverflow,
          }]
        : [];
    }),
  );

const enterSketch = async () => {
  await page.click('button:has-text("Create Sketch")');
  await page.waitForTimeout(400);
  if (!(await page.locator('text=XY Plane').isVisible())) {
    await page.click('button[aria-label="Origin"]');
    await page.waitForTimeout(200);
  }
  await page.click('text=XY Plane');
  await page.waitForTimeout(1100);
};
const finishSketch = async () => {
  await page.click('button:has-text("FINISH SKETCH")');
  await page.waitForTimeout(700);
};

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // --- 6. Brand (check first, on the landing screen) -----------------------
  console.log('6. brand = noBS CAD / NB');
  const productMark = page.getByTestId('product-mark');
  check(
    'integrated ribbon header shows the NB product mark',
    (await productMark.innerText()) === 'NB' &&
      (await productMark.getAttribute('aria-label')) === 'noBS CAD',
  );
  check('window title is noBS CAD', (await page.title()) === 'noBS CAD', await page.title());
  await page.setViewportSize({ width: 1117, height: 900 });
  await page.waitForTimeout(100);
  const modelRibbonIssues = await ribbonLabelIssues();
  check(
    'MODEL ribbon shows complete function names',
    modelRibbonIssues.length === 0,
    JSON.stringify(modelRibbonIssues),
  );
  const modelRibbonWidth = await page.getByTestId('ribbon-command-scroll').evaluate((element) => ({
    client: element.clientWidth,
    scroll: element.scrollWidth,
  }));
  check(
    'MODEL ribbon fits the owner capture width without horizontal overflow',
    modelRibbonWidth.scroll <= modelRibbonWidth.client + 1,
    JSON.stringify(modelRibbonWidth),
  );
  await shot('m1d-06-brand');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(100);

  // --- 1. Wheel mapping (D11) ----------------------------------------------
  console.log('1. wheel mapping');
  const before1 = await camSnap();
  await wheel({ deltaX: 30, deltaY: 20 }); // two-finger swipe → pan
  await page.waitForTimeout(350);
  const after1 = await camSnap();
  const targetMoved1 = Math.hypot(
    before1.target[0] - after1.target[0],
    before1.target[1] - after1.target[1],
    before1.target[2] - after1.target[2],
  );
  check(
    'trackpad swipe pans (distance kept, target moved)',
    Math.abs(camDist(before1) - camDist(after1)) < 0.01 && targetMoved1 > 0.5,
    `dist ${camDist(before1).toFixed(1)}→${camDist(after1).toFixed(1)}, target ${targetMoved1.toFixed(2)}`,
  );
  // macOS natural scrolling (owner 2026-07-19): content TRACKS the fingers.
  // wheel(+x,+y) = fingers left+up → camera pans right+down in screen space.
  const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const vcross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const vnorm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const viewDir = vnorm(vsub(before1.target, before1.position));
  const screenRight = vnorm(vcross(viewDir, before1.up));
  const screenUp = vnorm(vcross(screenRight, viewDir));
  const tDelta = vsub(after1.target, before1.target);
  check(
    'pan direction = Mac natural (content follows fingers)',
    vdot(tDelta, screenRight) > 0 && vdot(tDelta, screenUp) < 0,
    `right=${vdot(tDelta, screenRight).toFixed(2)} up=${vdot(tDelta, screenUp).toFixed(2)}`,
  );
  await page.waitForTimeout(500); // gesture gap → classifier reset
  const before2 = await camSnap();
  await wheel({ deltaX: 0, deltaY: 120 }); // isolated mouse notch → zoom out
  await page.waitForTimeout(350);
  const after2 = await camSnap();
  check('mouse notch zooms', camDist(after2) > camDist(before2) * 1.05, `${camDist(before2).toFixed(1)}→${camDist(after2).toFixed(1)}`);
  await page.waitForTimeout(500);
  const before3 = await camSnap();
  await wheel({ deltaX: 0, deltaY: -50, ctrlKey: true }); // pinch → zoom in
  await page.waitForTimeout(350);
  const after3 = await camSnap();
  const pinchInRatio = camDist(after3) / camDist(before3);
  const expectedPinchInRatio = Math.exp(-50 * 0.002 * 2);
  check(
    'trackpad pinch zoom-in uses 2× sensitivity',
    Math.abs(pinchInRatio - expectedPinchInRatio) < 0.002,
    `ratio ${pinchInRatio.toFixed(4)}, expected ${expectedPinchInRatio.toFixed(4)}`,
  );
  await page.waitForTimeout(500);
  const beforePinchOut = await camSnap();
  await wheel({ deltaX: 0, deltaY: 50, ctrlKey: true }); // pinch → zoom out
  await page.waitForTimeout(350);
  const afterPinchOut = await camSnap();
  const pinchOutRatio = camDist(afterPinchOut) / camDist(beforePinchOut);
  const expectedPinchOutRatio = Math.exp(50 * 0.002);
  check(
    'trackpad pinch zoom-out keeps base sensitivity',
    Math.abs(pinchOutRatio - expectedPinchOutRatio) < 0.002,
    `ratio ${pinchOutRatio.toFixed(4)}, expected ${expectedPinchOutRatio.toFixed(4)}`,
  );
  await page.waitForTimeout(500);
  const before4 = await camSnap();
  await wheel({ deltaX: 40, deltaY: 0, shiftKey: true }); // shift+swipe → orbit
  await page.waitForTimeout(350);
  const after4 = await camSnap();
  const dirDelta =
    Math.abs((before4.position[0] - before4.target[0]) / camDist(before4) - (after4.position[0] - after4.target[0]) / camDist(after4)) +
    Math.abs((before4.position[2] - before4.target[2]) / camDist(before4) - (after4.position[2] - after4.target[2]) / camDist(after4));
  check('shift+swipe orbits (direction changes, distance kept)',
    dirDelta > 0.005 && Math.abs(camDist(before4) - camDist(after4)) < 0.01,
    `dirΔ ${dirDelta.toFixed(4)}`);
  // Orbit also follows macOS natural scrolling (owner 2026-07-19): the
  // camera delta must match the NEGATED wheel deltas, not the raw ones.
  // swipe left (+deltaX) → camera azimuth advances the same way as a
  // pointer-drag to the left (scene rotates with the fingers).
  const az = (s) => Math.atan2(s.position[1] - s.target[1], s.position[0] - s.target[0]);
  check('orbit direction = Mac natural (azimuth advances left)',
    az(after4) - az(before4) > 0,
    `az ${az(before4).toFixed(3)} → ${az(after4).toFixed(3)}`);

  // --- Sketch for items 2/3/4 ----------------------------------------------
  await enterSketch();
  const sketchRibbonIssues = await ribbonLabelIssues();
  check(
    'SKETCH ribbon shows complete function names',
    sketchRibbonIssues.length === 0,
    JSON.stringify(sketchRibbonIssues),
  );

  // --- 2. Rectangle dyn-input cluster lives through the whole run ----------
  console.log('2. rectangle dyn-input persistence');
  await page.click('button[title="Rectangle"]');
  await page.waitForTimeout(200);
  await clickSketch(-40, -25);
  await page.waitForTimeout(250);
  await moveSketch(10, -5);
  await page.keyboard.type('50', { delay: 40 });
  await page.waitForTimeout(300);
  let d = (await state()).dynInput;
  check('W typed+locked, cluster active', d.active && d.fields.find((f) => f.key === 'width')?.locked === true);
  await shot('m1d-02a-rect-W-locked');
  await page.keyboard.press('Enter'); // lock-commit: advance, NOT run commit
  await page.waitForTimeout(250);
  d = (await state()).dynInput;
  check('Enter after W advances focus, run stays alive', d.active && d.focus === 1 && (await sketch()).entities.length === 0);
  await shot('m1d-02b-rect-focus-advanced');
  await page.keyboard.type('30', { delay: 40 });
  await page.waitForTimeout(250);
  await page.keyboard.press('Enter'); // all locked → commit
  await page.waitForTimeout(400);
  d = (await state()).dynInput;
  const rectLines = (await sketch()).entities.filter((e) => e.kind === 'line').length;
  check('Enter with all fields locked commits the rectangle', rectLines === 4 && !d.active, `lines=${rectLines} active=${d.active}`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);

  // --- 3. Fillet from the ribbon button AND the menu item ------------------
  console.log('3. fillet activation paths');
  // L shape (0,0)-(60,0)-(60,60) via the Line tool
  await page.keyboard.press('l');
  await page.waitForTimeout(200);
  await clickSketch(0, 0);
  await clickSketch(60, 0);
  await clickSketch(60, 60);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // 3a: ribbon panel button
  await page.click('button[title="Fillet"]');
  await page.waitForTimeout(250);
  let s3 = await state();
  check('panel button activates fillet', s3.activeTool === 'fillet', s3.activeTool ?? 'null');
  check('radius field shows IMMEDIATELY on activation', s3.dynInput.active && s3.dynInput.fields.some((f) => f.key === 'radius'));
  await shot('m1d-03a-fillet-active-with-radius');
  await clickSketch(30, 0); // pick line 1
  await page.waitForTimeout(200);
  await shot('m1d-03b-fillet-first-pick-highlight');
  await clickSketch(60, 30); // pick line 2 → preview + commit on next click
  await page.waitForTimeout(300);
  await page.keyboard.type('12', { delay: 40 });
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter'); // radius locked → commit
  await page.waitForTimeout(400);
  let sk3 = await sketch();
  const arc = sk3.entities.find((e) => e.kind === 'arc');
  check('fillet arc created from the button path', !!arc && Math.abs(arc.radius - 12) < 0.01, arc ? `r=${arc.radius}` : 'none');
  await shot('m1d-03c-fillet-result');
  await page.keyboard.press('Escape'); // exit fillet tool
  await page.waitForTimeout(150);

  // 3b: menu item (EDIT panel dropdown → Fillet row)
  await page.locator('button:has-text("EDIT")').first().click();
  await page.waitForTimeout(250);
  const menu = page.locator('[data-ribbon-menu]');
  check('EDIT menu opens', await menu.isVisible());
  await menu.locator('span:text-is("Fillet")').click();
  await page.waitForTimeout(250);
  s3 = await state();
  check('menu item activates fillet with radius field', s3.activeTool === 'fillet' && s3.dynInput.active);
  await shot('m1d-03d-fillet-via-menu');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);

  // --- 4. Midpoint auto-snap (D4.1) -----------------------------------------
  console.log('4. midpoint auto-snap');
  // The fillet trimmed the L's bottom line — aim at its ACTUAL midpoint.
  const host = (await sketch()).entities.find((e) => e.kind === 'line' && Math.abs(e.start.y) < 1e-6 && Math.abs(e.end.y) < 1e-6);
  const mid = { x: (host.start.x + host.end.x) / 2, y: (host.start.y + host.end.y) / 2 };
  await page.keyboard.press('l');
  await page.waitForTimeout(200);
  await clickSketch(-50, 40); // free start
  await moveSketch(mid.x + 1, mid.y + 1); // hover near the midpoint
  await page.waitForTimeout(200);
  await shot('m1d-04a-midpoint-triangle-marker');
  await clickSketch(mid.x, mid.y); // commit ON the midpoint
  await page.waitForTimeout(400);
  const sk4 = await sketch();
  const midC = sk4.constraints.find((c) => c.type === 'midpoint');
  check('Midpoint constraint auto-created', !!midC, JSON.stringify(sk4.constraints.map((c) => c.type)));
  const newLine = sk4.entities.filter((e) => e.kind === 'line').at(-1);
  check('endpoint landed exactly on the midpoint',
    newLine && Math.abs(newLine.end.x - mid.x) < 1e-6 && Math.abs(newLine.end.y - mid.y) < 1e-6,
    newLine ? `${newLine.end.x},${newLine.end.y} vs ${mid.x},${mid.y}` : 'none');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  await shot('m1d-04b-midpoint-glyph');

  // --- 5. Finished sketch in 3D + browser re-edit ---------------------------
  console.log('5. finished sketch visible + re-edit');
  await finishSketch();
  const s5 = await state();
  check('finished sketch listed with its entities', s5.finishedSketches.length === 1 && s5.finishedSketches[0].entities.length > 0,
    JSON.stringify(s5.finishedSketches.map((f) => f.name)));
  const finishedVisuals = await page.evaluate(() => window.__finishedSketchVisualState());
  const finishedPointStyles = finishedVisuals.pointRoles.map((role, index) => ({
    role,
    size: finishedVisuals.pointSizes[index],
    opacity: finishedVisuals.pointOpacities[index],
  }));
  check(
    'finished sketch stays visible with restrained lines and compact high-contrast points',
    finishedVisuals.pointCount > 0 &&
      finishedVisuals.pointDepthTests.length > 0 &&
      finishedVisuals.pointDepthTests.every((depthTest) => !depthTest) &&
      finishedVisuals.lineDepthTests.length > 0 &&
      finishedVisuals.lineDepthTests.every((depthTest) => !depthTest) &&
      finishedVisuals.lineWidths.every((width) => width <= 1.15) &&
      finishedVisuals.lineOpacities.every((opacity) => opacity <= 0.42) &&
      finishedPointStyles.some(
        (point) => point.role === 'finished-point-outline' && point.size <= 7 && point.opacity >= 0.95,
      ) &&
      finishedPointStyles.some(
        (point) => point.role === 'finished-point-fill' && point.size <= 5 && point.opacity >= 0.95,
      ),
    JSON.stringify(finishedVisuals),
  );
  await shot('m1d-05a-finished-visible-3d');
  const row = page.locator('[role="treeitem"]', { hasText: 'Sketch1' }).first();
  await row.dblclick();
  await page.waitForTimeout(900);
  const s5b = await state();
  check('double-click re-enters edit (sketch mode, SKETCH ribbon)', s5b.mode === 'sketch' && s5b.activeSketch?.name === 'Sketch1');
  check('entities + constraints survived the round trip',
    (s5b.activeSketch?.entities.length ?? 0) > 0 && (s5b.activeSketch?.constraints.length ?? 0) > 0);
  check('undo stack survived (can_undo)', s5b.activeSketch?.can_undo === true);
  const reenteredDimension = s5b.activeSketch?.dimensions[0] ?? null;
  check('re-entered history sketch retains an editable dimension', reenteredDimension !== null);
  if (reenteredDimension) {
    const dimensionScreen = await page.evaluate((dimensionId) => {
      const canvas = document.querySelector('main canvas');
      const rect = canvas?.getBoundingClientRect();
      const sketch = window.__appStore.getState().activeSketch;
      const dimension = sketch?.dimensions.find(
        (candidate) => candidate.constraint_id === dimensionId,
      );
      const annotation = window.__nativeViewportTransient().annotations.find(
        (candidate) => candidate.kind === 'dimension'
          && candidate.text === dimension?.text,
      );
      return rect && annotation
        ? {
            x: rect.left + annotation.screen[0],
            y: rect.top + annotation.screen[1],
          }
        : null;
    }, reenteredDimension.constraint_id);
    check('re-entered dimension exposes its visible number center', dimensionScreen !== null);
    if (dimensionScreen) {
      // Native Bevy renders `annotation.screen` as the center of the visible
      // number. Click that number—not either arrow—to exercise the native
      // child-view fallback as well as the browser's ordinary dblclick event.
      await page.mouse.click(dimensionScreen.x, dimensionScreen.y);
      await page.waitForTimeout(90);
      await page.mouse.click(dimensionScreen.x, dimensionScreen.y);
      await page.waitForTimeout(250);
      const editor = page.locator('input[title*="Edit dimension"]');
      check(
        'double-clicking the history dimension number opens the inline editor',
        await editor.isVisible(),
      );
      const editorBox = await editor.boundingBox();
      const viewportBox = await page.locator('main canvas').first().boundingBox();
      check(
        'history dimension editor stays inside the inset viewport',
        !!editorBox
          && !!viewportBox
          && editorBox.x >= viewportBox.x
          && editorBox.y >= viewportBox.y
          && editorBox.x + editorBox.width <= viewportBox.x + viewportBox.width
          && editorBox.y + editorBox.height <= viewportBox.y + viewportBox.height,
        JSON.stringify({ editorBox, viewportBox }),
      );
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);
    }
  }
  check(
    'flat-view reset is explicit in both sketch controls',
    await page.getByTestId('look-at-sketch').isVisible() &&
      await page.getByTestId('look-at-sketch-nav').isVisible(),
  );
  await wheel({ deltaX: 45, deltaY: 15, shiftKey: true });
  await page.waitForTimeout(400);
  await page.getByTestId('look-at-sketch-nav').click();
  await page.waitForTimeout(500);
  const flatCamera = await camSnap();
  const flatDirection = vnorm(vsub(flatCamera.target, flatCamera.position));
  const sketchNormal = s5b.activeSketch.basis.normal;
  check(
    'Return to Flat View restores the sketch-normal camera',
    Math.abs(vdot(flatDirection, sketchNormal)) > 0.9999,
    `alignment=${Math.abs(vdot(flatDirection, sketchNormal)).toFixed(6)}`,
  );
  await shot('m1d-05b-reedit-sketch-mode');
  // Pencil affordance path
  await finishSketch();
  const row2 = page.locator('[role="treeitem"]', { hasText: 'Sketch1' }).first();
  await row2.hover();
  await page.waitForTimeout(200);
  await shot('m1d-05c-pencil-affordance');
  await row2.locator('button[aria-label="Edit sketch"]').click();
  await page.waitForTimeout(900);
  const s5c = await state();
  check('pencil re-enters edit', s5c.mode === 'sketch' && s5c.activeSketch?.name === 'Sketch1');
} finally {
  await browser.close();
}

if (failures > 0) {
  console.error(`\n${failures} M1d e2e check(s) FAILED`);
  process.exit(1);
}
console.log('\nM1d e2e: all checks passed');
