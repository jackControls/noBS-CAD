import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const output = process.env.NBCAD_PART_DEMOS;
if (!output) throw new Error('Set NBCAD_PART_DEMOS to the packaged demo output directory');
const browser = await chromium.launch();
try {
  for (const name of ['mounting-plate', 'spacer', 'angle-bracket']) {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.addInitScript(() => { window.showOpenFilePicker = undefined; });
    await page.goto('http://127.0.0.1:7199', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__appStore?.getState().document);
    await page.getByTestId('file-menu-button').click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('menuitem', { name: 'Open Project…', exact: false }).click();
    await (await chooser).setFiles(resolve(output, name, `${name}.nbcad`));
    await page.waitForFunction(expected => {
      const state = window.__appStore.getState();
      return state.projectFileName === `${expected}.nbcad` && state.solidScene.bodies.length === 1;
    }, name, { timeout: 60000 });
    const state = await page.evaluate(() => {
      const state = window.__appStore.getState();
      return { errors: state.solidScene.errors, features: state.document.features.length };
    });
    assert.deepEqual(state.errors, []);
    assert(state.features >= 2, 'editable feature history survives');
    assert.deepEqual(errors, []);
    await page.screenshot({ path: resolve(output, name, 'app.png') });
    console.log(`PASS UI open ${name}: ${state.features} features, one body`);
    await context.close();
  }
} finally { await browser.close(); }
