/**
 * Multi-document lifecycle regression:
 * new/switch/close tab behavior plus authoritative Rename, Save, and Save As.
 */
import assert from 'node:assert/strict';
import { strFromU8, unzipSync } from 'fflate';
import { chromium } from 'playwright';

const BASE = 'http://localhost:7199';
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
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
  await page.waitForFunction(
    () =>
      window.__appStore.getState().document !== null &&
      window.__appStore.getState().projectTabs.length === 1,
  );

  const closeButton = () =>
    page.getByRole('button', { name: 'Close document', exact: true });
  const newButton = page.getByRole('button', { name: 'New design' });

  await renameThroughMenu('First Design');
  await newButton.click();
  await waitForFreshDocument();
  let app = await state();
  assert.equal(app.projectTabs.length, 2, 'New opens a second document tab');
  assert.equal(
    await page.getByRole('tab', { name: 'First Design' }).count(),
    1,
    'the previous design remains available',
  );
  assert.equal(app.document.name, 'Untitled');
  assert.equal(app.document.features.length, 0);
  assert.equal(app.finishedSketches.length, 0);
  assert.equal(app.solidScene.bodies.length, 0);
  assert.equal(app.dirty, false);

  await renameThroughMenu('Second Design');
  await page.getByRole('tab', { name: 'First Design' }).click();
  await page.waitForFunction(
    () => window.__appStore.getState().document?.name === 'First Design',
  );
  app = await state();
  assert.equal(app.projectTabs.length, 2);
  assert.equal(app.dirty, true, 'each tab restores its own dirty state');

  await page.getByRole('tab', { name: 'Second Design' }).click();
  await page.waitForFunction(
    () => window.__appStore.getState().document?.name === 'Second Design',
  );
  await page.waitForFunction(() => {
    const raw = localStorage.getItem('nbcad:recovery:v1');
    if (!raw) return false;
    try {
      return JSON.parse(raw).tabs?.length === 2;
    } catch {
      return false;
    }
  });
  assert.deepEqual(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem('nbcad:recovery:v1')).tabs
        .map((tab) => tab.name)
        .sort(),
    ),
    ['First Design', 'Second Design'],
    'crash recovery retains every dirty document tab',
  );
  const cancelConfirmation = nextConfirmation(false);
  await closeButton().click();
  assert.match(await cancelConfirmation, /discard its unsaved changes/i);
  app = await state();
  assert.equal(app.document.name, 'Second Design', 'Cancel keeps the tab open');
  assert.equal(app.dirty, true, 'Cancel preserves unsaved state');
  assert.equal(app.projectTabs.length, 2);

  const discardConfirmation = nextConfirmation(true);
  await closeButton().click();
  assert.match(await discardConfirmation, /discard its unsaved changes/i);
  await page.waitForFunction(
    () =>
      window.__appStore.getState().document?.name === 'First Design' &&
      window.__appStore.getState().projectTabs.length === 1,
  );
  app = await state();
  assert.equal(app.document.name, 'First Design', 'closing activates the adjacent tab');
  assert.equal(app.dirty, true);
  assert.equal(await closeButton().count(), 1);

  const closeLastConfirmation = nextConfirmation(true);
  await closeButton().click();
  assert.match(await closeLastConfirmation, /discard its unsaved changes/i);
  await waitForFreshDocument();
  app = await state();
  assert.equal(app.projectTabs.length, 1, 'closing the last tab leaves one fresh design');
  assert.equal(
    await page.getByRole('button', { name: 'Create Sketch' }).first().isDisabled(),
    false,
    'modeling commands remain available in the fresh design',
  );

  const ribbonTools = await page.getByTestId('ribbon-tools').boundingBox();
  const appControls = await page.getByTestId('app-menu-controls').boundingBox();
  const browserPanel = await page.getByTestId('browser-panel').boundingBox();
  const projectTabs = await page.getByTestId('project-tabs').boundingBox();
  assert.ok(
    ribbonTools &&
      appControls &&
      browserPanel &&
      projectTabs &&
      appControls.x <= 1 &&
      Math.abs(appControls.y - ribbonTools.y) <= 1 &&
      Math.abs(appControls.height - ribbonTools.height) <= 1 &&
      Math.abs(browserPanel.y - (ribbonTools.y + ribbonTools.height)) <= 1 &&
      Math.abs(projectTabs.y - browserPanel.y) <= 1 &&
      Math.abs(projectTabs.x - (browserPanel.x + browserPanel.width)) <= 1,
    'below the workspace-module row, PROJECT is flush left, Browser starts below the ribbon, and tabs begin at the Browser edge',
  );
  assert.equal(
    await page.getByTestId('main-menu-row').count(),
    0,
    'there is no separate application or workspace top row',
  );

  await renameThroughMenu('Bench Bracket');
  await page.evaluate(async () => {
    const engine = window.__engine;
    const store = window.__appStore.getState();
    await engine.beginSketch({ type: 'origin_plane', plane: 'xy' });
    await engine.setGridSnap(false);
    await engine.addRectangle({
      mode: 'two_point',
      p1: { x: 0, y: 0 },
      p2: { x: 20, y: 10 },
      ctrl_held: true,
    });
    const ended = await engine.endSketch();
    store.setDocument(ended.document);
    store.setFinishedSketches(await engine.finishedSketches());
    store.applySolidUpdate(await engine.extrude({
      sketch_name: 'Sketch1',
      profile_indices: [0],
      operation: 'new_body',
      extent: { type: 'distance', distance: 8 },
      taper_angle_deg: 0,
      flip: false,
      target_body_ids: [],
    }));
    const stack = [...window.__appStore.getState().document.browser];
    let bodyNode = null;
    while (stack.length > 0) {
      const candidate = stack.pop();
      if (candidate.kind === 'body') {
        bodyNode = candidate;
        break;
      }
      stack.push(...candidate.children);
    }
    if (!bodyNode) throw new Error('Visibility fixture did not create a body Browser row.');
    window.__appStore.getState().toggleHidden(bodyNode.id);
  });
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
  assert.equal(model.visibility.hidden_body_ids.length, 1, 'Save persists hidden body identity');

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

  await newButton.click();
  await waitForFreshDocument();
  await renameThroughMenu('Other Project');
  await page.evaluate(() => {
    window.__nextSaveName = 'Other Project File.nbcad';
  });
  await page.getByTestId('file-menu-button').click();
  await page.getByRole('menuitem', { name: 'Save As…' }).click();
  await page.waitForFunction(
    () =>
      window.__appStore.getState().projectFileName ===
        'Other Project File.nbcad' &&
      !window.__appStore.getState().dirty,
  );

  await page.getByRole('tab', { name: 'Internal Project Name' }).click();
  await page.waitForFunction(
    () =>
      window.__appStore.getState().document?.name === 'Internal Project Name' &&
      window.__appStore.getState().projectFileName === 'Saved From Dialog.nbcad',
  );
  assert.equal(
    await page.evaluate(() => {
      const state = window.__appStore.getState();
      const stack = [...state.document.browser];
      while (stack.length > 0) {
        const node = stack.pop();
        if (node.kind === 'body') return Boolean(state.hidden[node.id]);
        stack.push(...node.children);
      }
      return false;
    }),
    true,
    'tab hydration restores hidden status onto reconstructed Browser rows',
  );
  await renameThroughMenu('Internal Target Reused');
  await page.getByTestId('file-menu-button').click();
  await page.getByRole('menuitem', { name: /^Save(?! As)/ }).click();
  await page.waitForFunction(() => !window.__appStore.getState().dirty);
  assert.equal(
    await page.evaluate(() => window.__savePickerCalls.length),
    2,
    'switching tabs restores each document\'s own reusable Save target',
  );
  bytes = Uint8Array.from(
    await page.evaluate(() => window.__testFiles['Saved From Dialog.nbcad']),
  );
  model = JSON.parse(strFromU8(unzipSync(bytes)['model.json']));
  assert.equal(model.document.name, 'Internal Target Reused');

  await renameThroughMenu('Recovery One');
  await newButton.click();
  await waitForFreshDocument();
  await renameThroughMenu('Recovery Two');
  await page.waitForFunction(() => {
    const raw = localStorage.getItem('nbcad:recovery:v1');
    if (!raw) return false;
    try {
      return JSON.parse(raw).tabs?.length === 2;
    } catch {
      return false;
    }
  });
  const previousSession = await page.evaluate(() =>
    localStorage.getItem('nbcad:recovery:v1'),
  );
  assert.ok(previousSession, 'the prior unsaved session has an emergency snapshot');

  const freshContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  await freshContext.addInitScript((snapshot) => {
    localStorage.setItem('nbcad:recovery:v1', snapshot);
  }, previousSession);
  const freshPage = await freshContext.newPage();
  const freshErrors = [];
  const startupDialogs = [];
  freshPage.on('pageerror', (error) => freshErrors.push(String(error)));
  freshPage.on('dialog', async (dialog) => {
    startupDialogs.push(dialog.message());
    await dialog.dismiss();
  });
  await freshPage.goto(BASE, { waitUntil: 'networkidle' });
  await freshPage.waitForFunction(
    () =>
      window.__appStore.getState().projectTabs.length === 1 &&
      window.__appStore.getState().document?.name === 'Untitled',
  );
  assert.deepEqual(
    await freshPage.getByRole('tab').allTextContents(),
    ['Untitled'],
    'a new application launch starts with one fresh document',
  );
  assert.deepEqual(
    await freshPage.evaluate(() => {
      const state = window.__appStore.getState();
      return {
        featureCount: state.document.features.length,
        bodyCount: state.solidScene.bodies.length,
        sheetCount: state.drawingDocument.sheets.length,
        fileName: state.projectFileName,
        dirty: state.dirty,
      };
    }),
    {
      featureCount: 0,
      bodyCount: 0,
      sheetCount: 0,
      fileName: null,
      dirty: false,
    },
    'startup does not reopen prior model, drawing, or file state',
  );
  assert.equal(
    await freshPage.evaluate(() => localStorage.getItem('nbcad:recovery:v1')),
    previousSession,
    'fresh startup retains the prior emergency snapshot without reopening it',
  );
  assert.deepEqual(startupDialogs, [], 'startup does not offer session restore');
  assert.deepEqual(freshErrors, []);
  await freshContext.close();
  assert.deepEqual(pageErrors, []);

  console.log('  [ok] document tabs, menu hierarchy, Rename, Save, and Save As');
} finally {
  await browser.close();
}
