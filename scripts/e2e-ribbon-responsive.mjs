/** Responsive ribbon regression: preserve every panel, collapse secondary
 * commands into group menus, and restore them as desktop width returns. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE = 'http://localhost:7199';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.stack ?? String(error)));

async function waitForRibbon(panelIds) {
  try {
    await page.waitForFunction((expectedPanelIds) => {
      const strip = document.querySelector('[data-testid="ribbon-command-scroll"]');
      if (!strip || strip.getAttribute('data-ribbon-layout-ready') !== 'true') return false;
      const measuredWidth = Number(strip.getAttribute('data-ribbon-layout-width'));
      if (Math.abs(measuredWidth - strip.clientWidth) > 1) return false;
      const panels = [...strip.querySelectorAll('[data-ribbon-panel]')]
        .map((panel) => panel.getAttribute('data-ribbon-panel'));
      return expectedPanelIds.every((id) => panels.includes(id));
    }, panelIds);
  } catch (error) {
    const diagnostics = await page.getByTestId('ribbon-command-scroll').evaluate((strip) => ({
      ready: strip.getAttribute('data-ribbon-layout-ready'),
      measuredWidth: strip.getAttribute('data-ribbon-layout-width'),
      clientWidth: strip.clientWidth,
      scrollWidth: strip.scrollWidth,
      panels: [...strip.querySelectorAll('[data-ribbon-panel]')]
        .map((panel) => panel.getAttribute('data-ribbon-panel')),
    }));
    throw new Error(`${error instanceof Error ? error.message : String(error)}: ${JSON.stringify(diagnostics)}`);
  }
}

async function ribbonMetrics() {
  return page.getByTestId('ribbon-command-scroll').evaluate((strip) => {
    const stripBounds = strip.getBoundingClientRect();
    const panels = [...strip.querySelectorAll('[data-ribbon-panel]')].map((panel) => {
      const bounds = panel.getBoundingClientRect();
      return {
        id: panel.getAttribute('data-ribbon-panel'),
        fullyVisible: bounds.left >= stripBounds.left - 1 && bounds.right <= stripBounds.right + 1,
      };
    });
    return {
      clientWidth: strip.clientWidth,
      scrollWidth: strip.scrollWidth,
      buttons: [...strip.querySelectorAll('[data-ribbon-button]')]
        .map((button) => button.getAttribute('data-ribbon-button')),
      panels,
    };
  });
}

async function assertCompactRibbon(panelIds, primaryButtonId) {
  const metrics = await ribbonMetrics();
  assert.ok(
    metrics.scrollWidth <= metrics.clientWidth + 1,
    `ribbon unexpectedly requires horizontal scrolling: ${JSON.stringify(metrics)}`,
  );
  assert.deepEqual(
    metrics.panels.map((panel) => panel.id),
    panelIds,
    `ribbon panel order changed: ${JSON.stringify(metrics)}`,
  );
  assert.ok(
    metrics.panels.every((panel) => panel.fullyVisible),
    `every panel must remain visible before scrolling is used: ${JSON.stringify(metrics)}`,
  );
  assert.ok(
    metrics.buttons.includes(primaryButtonId),
    `${primaryButtonId} must remain visible as the panel's primary command: ${JSON.stringify(metrics)}`,
  );
  return metrics;
}

async function workspaceModeLabelMetrics() {
  return page.getByTestId('workspace-switcher').evaluate((button) => {
    const label = button.querySelector('[data-testid="workspace-mode-label"]');
    if (!label) return null;
    const buttonBounds = button.getBoundingClientRect();
    const labelBounds = label.getBoundingClientRect();
    return {
      text: label.textContent?.replace(/\s+/g, ' ').trim(),
      buttonWidth: buttonBounds.width,
      labelWidth: labelBounds.width,
      labelHeight: labelBounds.height,
      fits: labelBounds.left >= buttonBounds.left - 1
        && labelBounds.right <= buttonBounds.right + 1,
    };
  });
}

async function sketchTrailingBoundaryMetrics() {
  return page.getByTestId('finish-sketch-container').evaluate((finishContainer) => {
    const selectionPanel = document.querySelector('[data-ribbon-panel="selection"]');
    return {
      finishBorderLeft: Number.parseFloat(getComputedStyle(finishContainer).borderLeftWidth),
      selectionBorderRight: selectionPanel
        ? Number.parseFloat(getComputedStyle(selectionPanel).borderRightWidth)
        : null,
    };
  });
}

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__appStore.getState().document !== null);

  // Modeling: Select remains visible while secondary solid commands collapse.
  const modelPanels = ['profile', 'build', 'refine', 'repeat', 'body', 'reference', 'check', 'assembly', 'selection'];
  await page.setViewportSize({ width: 900, height: 900 });
  await waitForRibbon(modelPanels);
  const modelCompact = await assertCompactRibbon(modelPanels, 'select');
  await page.setViewportSize({ width: 2200, height: 900 });
  await waitForRibbon(modelPanels);
  const modelWide = await ribbonMetrics();
  assert.equal(modelWide.buttons.length, 24, `wide Modeling ribbon should restore every direct command: ${JSON.stringify(modelWide)}`);
  assert.ok(modelWide.buttons.length > modelCompact.buttons.length, 'wider Modeling ribbon restores direct commands');

  // Sketch: the Dimension action is centered in its one-command panel, and
  // Select remains visible at compact widths beside Finish Sketch.
  await page.setViewportSize({ width: 900, height: 900 });
  await waitForRibbon(modelPanels);
  await page.locator('[data-ribbon-button="createSketch"]').click();
  const xyPlane = page.getByText('XY Plane', { exact: true });
  if (!(await xyPlane.isVisible())) {
    await page.locator('button[aria-label="Origin"]').click();
  }
  await xyPlane.click();
  await page.waitForFunction(() => window.__appStore.getState().mode === 'sketch');
  const sketchPanels = ['draw', 'edit', 'dimension', 'repeat', 'constrain', 'selection'];
  await waitForRibbon(sketchPanels);
  const sketchCompact = await assertCompactRibbon(sketchPanels, 'select');
  const dimensionAlignment = await page.locator('[data-ribbon-button="sketchDimension"]').evaluate((button) => {
    const panel = button.closest('[data-ribbon-panel]');
    if (!panel) return null;
    const buttonBounds = button.getBoundingClientRect();
    const panelBounds = panel.getBoundingClientRect();
    return Math.abs(
      buttonBounds.left + buttonBounds.width / 2 - (panelBounds.left + panelBounds.width / 2),
    );
  });
  assert.ok(dimensionAlignment !== null && dimensionAlignment <= 1, `Sketch Dimension must be centered: ${dimensionAlignment}`);
  await page.setViewportSize({ width: 2200, height: 900 });
  await waitForRibbon(sketchPanels);
  const sketchWide = await ribbonMetrics();
  assert.equal(sketchWide.buttons.length, 25, `wide Sketch ribbon should restore every direct command: ${JSON.stringify(sketchWide)}`);
  assert.ok(sketchWide.buttons.length > sketchCompact.buttons.length, 'wider Sketch ribbon restores direct commands');
  // At the desktop breakpoint the workspace switcher shows both its mode name
  // and Sketch badge. Stack the badge beneath the name so the compact group
  // stays inside its button instead of claiming a wide empty column.
  await page.setViewportSize({ width: 1440, height: 900 });
  await waitForRibbon(sketchPanels);
  const workspaceLabel = await workspaceModeLabelMetrics();
  assert.ok(workspaceLabel?.text?.includes('Solid Modeling'), `workspace mode label missing: ${JSON.stringify(workspaceLabel)}`);
  assert.ok(workspaceLabel?.text?.includes('SKETCH'), `workspace sketch badge missing: ${JSON.stringify(workspaceLabel)}`);
  assert.ok(workspaceLabel?.buttonWidth && workspaceLabel.buttonWidth <= 100, `workspace switcher should stay compact: ${JSON.stringify(workspaceLabel)}`);
  assert.ok(workspaceLabel?.labelHeight && workspaceLabel.labelHeight > 15, `workspace sketch badge should wrap beneath the name: ${JSON.stringify(workspaceLabel)}`);
  assert.ok(workspaceLabel?.fits, `workspace mode label must not be clipped: ${JSON.stringify(workspaceLabel)}`);
  const trailingBoundary = await sketchTrailingBoundaryMetrics();
  assert.equal(trailingBoundary.finishBorderLeft, 0, `Finish Sketch must not add a duplicate trailing divider: ${JSON.stringify(trailingBoundary)}`);
  assert.equal(trailingBoundary.selectionBorderRight, 1, `Select must retain its normal group boundary: ${JSON.stringify(trailingBoundary)}`);
  await page.getByRole('button', { name: 'FINISH SKETCH', exact: true }).click();
  await page.waitForFunction(() => window.__appStore.getState().mode === 'solid');

  // Drawing: keep the six workflow groups visible while its commands adapt.
  await page.getByTestId('workspace-switcher').click();
  await page.getByRole('menuitemradio', { name: 'Drawing', exact: true }).click();
  await page.waitForFunction(() => window.__appStore.getState().activeTab === 'drawing');
  const drawingPanels = ['sheet', 'views', 'dimensions', 'annotate', 'symbols', 'output'];
  await page.setViewportSize({ width: 700, height: 900 });
  await waitForRibbon(drawingPanels);
  const drawingCompact = await assertCompactRibbon(drawingPanels, 'newSheet');
  await page.setViewportSize({ width: 2200, height: 900 });
  await waitForRibbon(drawingPanels);
  const drawingWide = await ribbonMetrics();
  assert.equal(drawingWide.buttons.length, 13, `wide Drawing ribbon should restore every direct command: ${JSON.stringify(drawingWide)}`);
  assert.ok(drawingWide.buttons.length > drawingCompact.buttons.length, 'wider Drawing ribbon restores direct commands');

  // CAM uses the same policy even though its operation panels do not have a
  // hand-authored menu: hidden commands are still reachable through the panel.
  // A blank test document has no solid body, so entering CAM through its
  // guarded workspace action is intentionally unavailable. Set only the
  // workspace presentation state to exercise the future CAM ribbon chrome.
  await page.evaluate(() => window.__appStore.getState().setActiveTab('cam'));
  await page.waitForFunction(() => window.__appStore.getState().activeTab === 'cam');
  const camPanels = ['workspace', 'setup', 'toolpaths', 'manage', 'output'];
  await page.setViewportSize({ width: 520, height: 900 });
  await waitForRibbon(camPanels);
  const camCompact = await assertCompactRibbon(camPanels, 'returnModel');
  // The intentionally invalid no-body CAM state paints its explanatory empty
  // message over the viewport in browser preview. Invoke the real DOM button
  // handler so this chrome-only test can still exercise its flyout.
  await page.getByRole('button', { name: 'TOOLPATHS', exact: true }).evaluate((button) => button.click());
  const camMenu = page.locator('[data-ribbon-menu]').last();
  await camMenu.waitFor();
  assert.ok(
    await camMenu.locator('[data-ribbon-menu-id^="ribbon-overflow-"]').count() > 0,
    'compact CAM Toolpaths menu must expose its hidden operations',
  );
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 2200, height: 900 });
  await waitForRibbon(camPanels);
  const camWide = await ribbonMetrics();
  assert.equal(camWide.buttons.length, 11, `wide CAM ribbon should restore every direct command: ${JSON.stringify(camWide)}`);
  assert.ok(camWide.buttons.length > camCompact.buttons.length, 'wider CAM ribbon restores direct commands');

  assert.deepEqual(pageErrors, [], `browser errors: ${pageErrors.join('\n')}`);
  console.log('responsive ribbon regression passed');
} finally {
  await browser.close();
}
