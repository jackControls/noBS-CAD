/** Approved CAM pictograms: ribbon wiring, paint isolation, themes and states. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE = 'http://localhost:7199';
const channel = process.env.PLAYWRIGHT_CHANNEL;
const browser = await chromium.launch(channel ? { channel } : {});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));
const expected = ['camModel', 'camNewSetup', 'camToolLibrary', 'camFace', 'camAdaptive', 'camContour', 'camPocket', 'camChamfer', 'camDrill', 'camThread'];
const aliases = { camModel: 'returnModel', camNewSetup: 'newSetup', camToolLibrary: 'toolLibrary' };
const screenshots = process.env.CAM_ICON_SCREENSHOT_DIR;

try {
  if (screenshots) await mkdir(screenshots, { recursive: true });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__appStore?.getState().document);
  await page.evaluate(() => window.__appStore.getState().setActiveTab('cam'));
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="ribbon-command-scroll"] [data-cam-icon]').length === 10);
  const ribbon = page.getByTestId('ribbon-tools');
  const commands = page.getByTestId('ribbon-command-scroll');
  assert.equal(await page.getByTestId('workspace-switcher').locator('[data-cam-icon="camManufacture"]').count(), 1);
  assert.deepEqual(await commands.locator('[data-cam-icon]').evaluateAll((icons) => icons.map((icon) => icon.dataset.camIcon)), expected);
  for (const id of expected) {
    const buttonId = aliases[id] ?? id;
    assert.equal(await ribbon.locator(`[data-ribbon-button="${buttonId}"] svg`).getAttribute('data-cam-icon'), id);
  }

  await page.addScriptTag({ type: 'module', url: `${BASE}/scripts/cam-icon-fixture.tsx` });
  const gallery = page.locator('#cam-icon-gallery');
  await page.waitForFunction(() => document.querySelectorAll('#cam-icon-gallery [data-cam-icon]').length === 105);
  for (const theme of ['light', 'dark']) {
    // Explicit appearance must win even when the OS asks for the opposite.
    await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
    await page.evaluate((value) => window.__appStore.getState().setThemePreference(value), theme);
    await page.waitForFunction((value) => document.documentElement.dataset.theme === value, theme);
    const metrics = await gallery.evaluate((root) => {
      const icons = [...root.querySelectorAll('[data-cam-icon]')];
      const ids = [...document.querySelectorAll('[id^="cam-drill-"]')].map((node) => node.id);
      const invalidPaints = icons.flatMap((icon) => [...icon.querySelectorAll('[fill], [clip-path]')].flatMap((node) =>
        ['fill', 'clip-path'].flatMap((attr) => {
          const ref = node.getAttribute(attr)?.match(/^url\(#(.+)\)$/)?.[1];
          return ref && !icon.contains(document.getElementById(ref)) ? [ref] : [];
        }),
      ));
      return {
        invalidPaints,
        duplicateIds: ids.filter((id, index) => ids.indexOf(id) !== index),
        icons: icons.map((icon) => {
          const css = getComputedStyle(icon);
          return {
            id: icon.dataset.camIcon,
            size: Number(icon.closest('[data-icon-size]').dataset.iconSize),
            width: icon.getBoundingClientRect().width,
            height: icon.getBoundingClientRect().height,
            hidden: icon.getAttribute('aria-hidden'),
            focusable: icon.getAttribute('focusable'),
            disabled: icon.closest('button').disabled,
            opacity: Number(css.opacity),
            line: css.getPropertyValue('--cam-icon-line').trim(),
            cut: css.getPropertyValue('--cam-icon-cut').trim(),
            tool: css.getPropertyValue('--cam-icon-tool').trim(),
            glint: getComputedStyle(icon.querySelector('stop[offset="0.48"]') ?? icon).stopColor,
            pathCount: icon.querySelectorAll('path').length,
          };
        }),
      };
    });
    assert.deepEqual(metrics.duplicateIds, [], 'drill paint IDs must be unique across all live instances');
    assert.deepEqual(metrics.invalidPaints, [], 'every paint/clip reference must resolve inside its own icon');
    for (const icon of metrics.icons) {
      assert.equal(icon.width, icon.size);
      assert.equal(icon.height, icon.size);
      assert.equal(icon.hidden, 'true');
      assert.equal(icon.focusable, 'false');
      assert.equal(icon.opacity, icon.disabled ? 0.4 : 1);
      assert.ok(icon.pathCount > 0);
      assert.equal(icon.line, theme === 'light' ? '#556273' : '#c8d0db');
      assert.equal(icon.cut, theme === 'light' ? '#26769c' : '#82bfdc');
      assert.equal(icon.tool, theme === 'light' ? '#c1ccda' : '#adbacb');
      if (icon.id === 'camDrill' || icon.id === 'camToolLibrary') {
        assert.equal(icon.glint, theme === 'light' ? 'rgb(241, 244, 247)' : 'rgb(226, 232, 239)');
      }
    }
    if (screenshots) {
      await gallery.screenshot({ path: path.join(screenshots, `cam-icons-${theme}.png`) });
      await ribbon.screenshot({ path: path.join(screenshots, `cam-ribbon-${theme}.png`) });
    }
      // The workflow icons must be reachable only on their respective pages.
      // The fixture gallery overlaps the page, so hide it during navigation.
      await gallery.evaluate(element => { element.style.display = 'none'; });
      await page.getByRole('tab', { name: 'Simulate', exact: true }).click();
      assert.deepEqual(await commands.locator('[data-cam-icon]').evaluateAll(icons => icons.map(icon => icon.dataset.camIcon)), ['camSimulate', 'camNcSimulate']);
      if (screenshots) await page.getByTestId('ribbon').screenshot({ path: path.join(screenshots, `cam-simulate-${theme}.png`) });
      await page.getByRole('tab', { name: 'Output', exact: true }).click();
      assert.equal(await ribbon.locator('[data-cam-icon="camPostNc"]').count(), 1);
      assert.equal(await ribbon.locator('[data-ribbon-button="postEvents"]').count(), 0);
      await ribbon.getByRole('button', { name: 'Advanced', exact: true }).click();
      assert.equal(await page.locator('[data-ribbon-menu-id="postEvents"] [data-cam-icon="camPostEvents"]').count(), 1);
      await page.keyboard.press('Escape');
      if (screenshots) await page.getByTestId('ribbon').screenshot({ path: path.join(screenshots, `cam-output-${theme}.png`) });
      await page.getByRole('tab', { name: 'Program', exact: true }).click();
      await gallery.evaluate(element => { element.style.display = ''; });
  }

  // Compact-ribbon menus reuse the same pictograms, including the shared drill.
  // Constrain the ribbon itself so this icon test is independent of the
  // empty workspace's callouts and unrelated narrow-window layout.
  await gallery.evaluate(element => { element.style.display = 'none'; });
  await ribbon.evaluate((element) => { element.style.width = '360px'; });
  const strip = page.getByTestId('ribbon-command-scroll');
  await page.waitForFunction(() => {
    const strip = document.querySelector('[data-testid="ribbon-command-scroll"]');
    return strip?.getAttribute('data-ribbon-layout-ready') === 'true'
      && Number(strip.getAttribute('data-ribbon-layout-width')) === Math.round(strip.clientWidth);
  });
  assert.ok(await strip.locator('[data-cam-icon]').count() < expected.length);
  await page.locator('[data-ribbon-panel="toolpaths"]').getByRole('button', { name: /toolpaths/i }).click();
  const menuDrill = page.locator('[data-ribbon-menu] [data-cam-icon="camDrill"]');
  await menuDrill.waitFor();
  assert.equal(await menuDrill.getAttribute('viewBox'), '0 0 64 64');
  assert.deepEqual(errors, []);
  console.log('CAM icons OK: 21 machining/workflow/page icons; 15/22/28/32px; disabled, light/dark, unique drill paints and compact menu.');
} finally {
  await browser.close();
}
