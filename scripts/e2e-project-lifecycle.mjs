/**
 * Single-document lifecycle regression:
 * close/new behavior plus authoritative Rename, Save, and Save As naming.
 */
import assert from 'node:assert/strict';
import { strFromU8, unzipSync } from 'fflate';
import { chromium } from 'playwright';

const BASE = 'http://localhost:7199';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.addInitScript(() => {
  window.__testFiles = {};
  window.__savePickerCalls = [];
  window.__nextSaveName = null;
  window.showSaveFilePicker = async (options) => {
    window.__savePickerCalls.push(options.suggestedName);
    const name = window.__nextSaveName ?? options.suggestedName;
    window.__nextSaveName = null;
    return {
      kind: 'file',
      name,
      async createWritable() {
        return {
          async write(data) {
            const bytes =
              data instanceof Blob
                ? new Uint8Array(await data.arrayBuffer())
                : data instanceof ArrayBuffer
                  ? new Uint8Array(data)
                  : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
            window.__testFiles[name] = Array.from(bytes);
          },
          async close() {},
          async abort() {},
        };
      },
    };
  };
});
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error)));

const state = () => page.evaluate(() => window.__appStore.getState());
const renameVisibleDocument = (name, dirty = false) =>
  page.evaluate(
    ({ nextName, nextDirty }) => {
      const current = window.__appStore.getState().document;
      window.__appStore.setState({
        document: { ...current, name: nextName },
        dirty: nextDirty,
        projectFileName: `${nextName}.nbcad`,
      });
    },
    { nextName: name, nextDirty: dirty },
  );
const waitForFreshDocument = () =>
  page.waitForFunction(() => {
    const app = window.__appStore.getState();
    return (
      app.document?.name === 'Untitled' &&
      app.document.features.length === 0 &&
      app.finishedSketches.length === 0 &&
      app.solidScene.bodies.length === 0 &&
      app.projectFileName === null &&
      !app.dirty
    );
  });
const nextConfirmation = (accept) =>
  new Promise((resolve) => {
    page.once('dialog', async (dialog) => {
      const message = dialog.message();
      if (accept) await dialog.accept();
      else await dialog.dismiss();
      resolve(message);
    });
  });
const renameThroughMenu = async (name) => {
  const prompt = new Promise((resolve) => {
    page.once('dialog', async (dialog) => {
      assert.equal(dialog.type(), 'prompt');
      await dialog.accept(name);
      resolve();
    });
  });
  await page.getByTestId('file-menu-button').click();
  await page.getByRole('menuitem', { name: 'Rename Project…' }).click();
  await prompt;
  await page.waitForFunction(
    (expected) => window.__appStore.getState().document?.name === expected,
    name,
  );
};

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__appStore.getState().document !== null);

  const closeButton = () => page.getByRole('button', { name: 'Close document' });
  const newButton = page.getByRole('button', { name: 'New design' });

  await renameVisibleDocument('Close Me');
  await closeButton().click();
  await waitForFreshDocument();
  assert.equal(
    await closeButton().count(),
    1,
    'closing the current design immediately opens a fresh document',
  );
  assert.equal(
    await page.getByRole('button', { name: 'Create Sketch' }).first().isDisabled(),
    false,
    'modeling commands remain available in the fresh design',
  );

  await renameVisibleDocument('Replace Me');
  await newButton.click();
  await waitForFreshDocument();
  let app = await state();
  assert.equal(app.document.name, 'Untitled');
  assert.equal(app.document.features.length, 0);
  assert.equal(app.finishedSketches.length, 0);
  assert.equal(app.solidScene.bodies.length, 0);
  assert.equal(app.dirty, false);

  await renameVisibleDocument('Unsaved Design', true);
  const cancelConfirmation = nextConfirmation(false);
  await closeButton().click();
  assert.match(await cancelConfirmation, /discard its unsaved changes/i);
  app = await state();
  assert.equal(app.document.name, 'Unsaved Design', 'Cancel keeps the design open');
  assert.equal(app.dirty, true, 'Cancel preserves unsaved state');

  const discardConfirmation = nextConfirmation(true);
  await closeButton().click();
  assert.match(await discardConfirmation, /discard its unsaved changes/i);
  await waitForFreshDocument();
  app = await state();
  assert.equal(app.document.name, 'Untitled', 'Discard opens a fresh design');
  assert.equal(app.dirty, false);
  assert.equal(app.projectFileName, null);
  assert.equal(await closeButton().count(), 1);

  const ribbonTools = await page.getByTestId('ribbon-tools').boundingBox();
  const appControls = await page.getByTestId('app-menu-controls').boundingBox();
  const browserPanel = await page.getByTestId('browser-panel').boundingBox();
  const projectTabs = await page.getByTestId('project-tabs').boundingBox();
  assert.ok(
    ribbonTools &&
      appControls &&
      browserPanel &&
      projectTabs &&
      ribbonTools.y <= 1 &&
      appControls.x <= 1 &&
      Math.abs(appControls.y - ribbonTools.y) <= 1 &&
      Math.abs(appControls.height - ribbonTools.height) <= 1 &&
      Math.abs(browserPanel.y - (ribbonTools.y + ribbonTools.height)) <= 1 &&
      Math.abs(projectTabs.y - browserPanel.y) <= 1 &&
      Math.abs(projectTabs.x - (browserPanel.x + browserPanel.width)) <= 1,
    'PROJECT is flush left, Browser starts below the ribbon, and tabs begin at the Browser edge',
  );
  assert.equal(
    await page.getByTestId('main-menu-row').count(),
    0,
    'there is no separate application or workspace top row',
  );

  await renameThroughMenu('Bench Bracket');
  app = await state();
  assert.equal(app.document.name, 'Bench Bracket');
  assert.equal(app.dirty, true);
  assert.equal(await page.getByTestId('project-title').innerText(), 'Bench Bracket');

  await page.evaluate(() => {
    window.__nextSaveName = 'Saved From Dialog.nbcad';
  });
  await page.getByTestId('file-menu-button').click();
  assert.equal(
    await page.getByRole('menuitem', { name: 'Settings' }).count(),
    1,
    'document settings is consolidated into the main File menu',
  );
  await page.getByRole('menuitem', { name: 'Save As…' }).click();
  await page.waitForFunction(
    () =>
      window.__appStore.getState().projectFileName ===
        'Saved From Dialog.nbcad' &&
      !window.__appStore.getState().dirty,
  );
  app = await state();
  assert.equal(
    app.document.name,
    'Saved From Dialog',
    'Save As filename becomes the authoritative project name',
  );
  assert.deepEqual(
    await page.evaluate(() => window.__savePickerCalls),
    ['Bench Bracket.nbcad'],
    'Rename Project drives the next Save As suggestion',
  );
  let bytes = Uint8Array.from(
    await page.evaluate(() => window.__testFiles['Saved From Dialog.nbcad']),
  );
  let model = JSON.parse(strFromU8(unzipSync(bytes)['model.json']));
  assert.equal(model.document.name, 'Saved From Dialog');

  await renameThroughMenu('Internal Project Name');
  await page.getByTestId('file-menu-button').click();
  await page.getByRole('menuitem', { name: /^Save(?! As)/ }).click();
  await page.waitForFunction(() => !window.__appStore.getState().dirty);
  app = await state();
  assert.equal(app.document.name, 'Internal Project Name');
  assert.equal(
    app.projectFileName,
    'Saved From Dialog.nbcad',
    'Rename does not silently move the current project file',
  );
  assert.equal(
    await page.evaluate(() => window.__savePickerCalls.length),
    1,
    'ordinary Save reuses the current target',
  );
  bytes = Uint8Array.from(
    await page.evaluate(() => window.__testFiles['Saved From Dialog.nbcad']),
  );
  model = JSON.parse(strFromU8(unzipSync(bytes)['model.json']));
  assert.equal(
    model.document.name,
    'Internal Project Name',
    'ordinary Save persists an explicit rename instead of restoring the filename',
  );
  assert.deepEqual(pageErrors, []);

  console.log('  [ok] lifecycle, menu hierarchy, Rename, Save, and Save As');
} finally {
  await browser.close();
}
