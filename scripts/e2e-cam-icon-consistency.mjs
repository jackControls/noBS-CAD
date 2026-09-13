/** Command identity must survive ribbon, browser, menus and dialog navigation. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const browser = await chromium.launch(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
const screenshots = process.env.CAM_ICON_SCREENSHOT_DIR;
const pages = { Tool: 'camTool', Geometry: 'camGeometry', Heights: 'camHeights', Passes: 'camPasses', Linking: 'camLinking' };
const operations = ['camFace', 'camAdaptive', 'camContour', 'camPocket', 'camChamfer', 'camDrill', 'camThread'];
const headerIcon = async (dialog, id) => {
  await dialog.waitFor();
  assert.deepEqual(await dialog.locator(':scope > header [data-cam-icon]').evaluateAll(icons => icons.map(icon => icon.dataset.camIcon)), [id]);
};

try {
  if (screenshots) await mkdir(screenshots, { recursive: true });
  await page.goto('http://localhost:7199', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__engine && window.__appStore?.getState().document);
  await page.evaluate(async () => {
    // Real, tiny Rust/WASM fixture in an isolated browser; no user's project.
    const engine = window.__engine, store = window.__appStore.getState();
    store.applySolidUpdate(await engine.newProject());
    await engine.beginSketch({ type: 'origin_plane', plane: 'xy' });
    await engine.addRectangle({ mode: 'two_point', p1: { x: 0, y: 0 }, p2: { x: 4, y: 4 }, ctrl_held: true });
    const ended = await engine.endSketch();
    store.setDocument(ended.document);
    store.setFinishedSketches(await engine.finishedSketches());
    store.setMode('solid');
    const catalog = await engine.profileCatalog();
    store.applySolidUpdate(await engine.extrude({ source_face: null, sketch_name: catalog[0].sketch_name,
      profile_indices: [catalog[0].profiles[0].index], operation: 'new_body',
      extent: { type: 'distance', distance: 3 }, taper_angle_deg: 0, flip: true, target_body_ids: [] }));
    store.setActiveTab('cam');
  });
  const ribbon = page.getByTestId('ribbon-tools');
  const browserPanel = page.getByTestId('cam-setups-panel');
  const setupDialog = page.getByTestId('cam-setup-dialog');
  await ribbon.locator('[data-ribbon-button="newSetup"]').click();
  await headerIcon(setupDialog, 'camNewSetup');
  await setupDialog.locator('button[type="submit"]').click();
  await setupDialog.waitFor({ state: 'detached' });
  const setupRow = browserPanel.getByRole('button', { name: /^Setup 1/ });
  assert.equal(await setupRow.locator('[data-cam-icon="camSetup"]').count(), 1);
  const stockRow = browserPanel.getByRole('button', { name: 'Stock & WCS', exact: true });
  assert.equal(await stockRow.locator('[data-cam-icon="camSetup"]').count(), 1);
  await stockRow.dblclick();
  await headerIcon(setupDialog, 'camSetup');
  await setupDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  const newSetup = browserPanel.getByRole('button', { name: 'New setup', exact: true });
  assert.equal(await newSetup.locator('svg.lucide-plus').count(), 1);
  assert.equal(await browserPanel.getByRole('button', { name: 'Open the tool library', exact: true }).count(), 0);
  const newSetupSize = await newSetup.boundingBox();
  assert.ok(newSetupSize.width >= 28 && newSetupSize.height >= 28);
  await newSetup.click();
  await headerIcon(setupDialog, 'camNewSetup');
  await setupDialog.getByRole('button', { name: 'Cancel', exact: true }).click();

  for (const button of [ribbon.locator('[data-ribbon-button="toolLibrary"]'), browserPanel.getByRole('button', { name: /^Tool Library/ })]) {
    assert.equal(await button.locator('[data-cam-icon="camToolLibrary"]').count(), 1);
    await button.click();
    const tools = page.getByTestId('cam-tool-dialog');
    await headerIcon(tools, 'camToolLibrary');
    await tools.locator(':scope > header button').last().click();
    await tools.waitFor({ state: 'detached' });
  }
  await setupRow.click({ button: 'right' });
  assert.equal(await page.getByRole('button', { name: 'Simulate whole setup', exact: true }).locator('[data-cam-icon="camSimulate"]').count(), 1);
  await page.keyboard.press('Escape');

  const before = await page.evaluate(async () => JSON.stringify(await window.__engine.camDocument()));
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => window.__appStore.getState().setThemePreference(theme), theme);
    for (const id of operations) {
      await ribbon.locator(`[data-ribbon-button="${id}"]`).click();
      const dialog = page.getByTestId(id === 'camAdaptive' ? 'cam-adaptive-dialog' : 'cam-operation-dialog');
      await headerIcon(dialog, id);
      const nav = dialog.getByRole('navigation', { name: 'Operation pages' });
      assert.deepEqual(await nav.locator('[data-cam-icon]').evaluateAll(icons => icons.map(icon => icon.dataset.camIcon)), Object.values(pages));
      for (const [label, icon] of Object.entries(pages)) {
        const button = nav.getByRole('button', { name: label, exact: true });
        await button.click();
        assert.equal(await button.getAttribute('aria-pressed'), 'true');
        assert.equal(await button.locator('svg').getAttribute('data-cam-icon'), icon);
        assert.equal(await button.locator('svg').getAttribute('width'), '18');
        assert.equal(await button.locator('svg').evaluate(svg => getComputedStyle(svg).getPropertyValue('--cam-icon-cut').trim()), theme === 'light' ? '#26769c' : '#82bfdc', 'selected page must not recolor its machining icon purple');
      }
      if (screenshots && ['camFace', 'camAdaptive', 'camDrill'].includes(id)) {
        await nav.getByRole('button', { name: 'Heights', exact: true }).click();
        await dialog.screenshot({ path: path.join(screenshots, `${id}-pages-${theme}.png`) });
      }
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await dialog.waitFor({ state: 'detached' });
    }
  }
  assert.equal(await page.evaluate(async () => JSON.stringify(await window.__engine.camDocument())), before, 'icon/page navigation and Cancel must not edit CAM data');

  await page.getByRole('tab', { name: 'Simulate', exact: true }).click();
  await ribbon.locator('[data-ribbon-button="ncSim"]').click();
  const ncDialog = page.getByTestId('cam-gcode-simulation-dialog');
  await headerIcon(ncDialog, 'camNcSimulate');
  assert.equal(await ncDialog.getByRole('button', { name: 'Build simulation' }).locator('[data-cam-icon="camNcSimulate"]').count(), 1);
  await ncDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('tab', { name: 'Output', exact: true }).click();
  await ribbon.locator('[data-ribbon-button="postNc"]').click();
  const post = page.getByTestId('cam-post-dialog');
  await headerIcon(post, 'camPostNc');
  await post.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('tab', { name: 'Program', exact: true }).click();
  await ribbon.locator('[data-ribbon-button="returnModel"]').click();
  await page.waitForFunction(() => window.__appStore.getState().activeTab === 'solid');
  assert.equal(await page.getByTestId('workspace-switcher').locator('[data-cam-icon="camModel"]').count(), 1);
  await page.getByTestId('workspace-switcher').click();
  assert.equal(await page.getByTestId('workspace-menu').locator('[data-cam-icon="camModel"]').count(), 1);
  assert.equal(await page.getByTestId('workspace-menu').locator('[data-cam-icon="camManufacture"]').count(), 1);
  assert.deepEqual(errors, []);
  console.log('CAM icon consistency OK: seven operation headers/five pages in both themes; setup/model/library/menu/NC/post identities; Cancel preserves data.');
} finally { await browser.close(); }
