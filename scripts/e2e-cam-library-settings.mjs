/** Real Settings/library UI with isolated desktop-storage IPC. Native tests
 * exercise the actual filesystem; this never touches the operator's library. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {});
const page = await browser.newPage({ viewport: { width: 1180, height: 820 } });
const errors = [];
page.on('pageerror', error => errors.push(error.stack ?? String(error)));
try {
  await page.goto('http://localhost:7199', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__engine && window.__appStore?.getState().document);
  await page.evaluate(async () => {
    window.__appStore.getState().applySolidUpdate(await window.__engine.newProject());
    const root = '/test/default', shared = '/test/shared', existing = '/test/existing';
    const library = { next_tool_id: 2, tools: [{ id: 1, number: 1, name: 'Shop mill', kind: 'flat_end_mill',
      diameter: 6, flute_length: 15, overall_length: 50, center_cutting: true, flute_count: 3,
      corner_radius: null, point_angle_degrees: null, default_step_down: null, default_step_over: null,
      cutting: { spindle_rpm: 6000, feed_xy: 600, feed_z: 100, coolant: 'flood' }, cutting_presets: [] }] };
    const files = new Map([[root, JSON.stringify(library)], [existing, JSON.stringify({ next_tool_id: 1, tools: [] })]]);
    let directory = root, revision = 1, nextCallback = 0;
    const callbacks = new Map(), listeners = new Map();
    window.__storageCalls = [];
    window.__postStorageCalls = [];
    const machine = (await import('/src/cam/machines.ts')).createMachineAssignment('siemens828d');
    machine.profile.schema_version = 2;
    machine.profile.post.siemens_828d.spindle_stop_subprogram = 'SHOP_STOP';
    machine.profile.name = 'Private shop mill';
    const posts = { directory: '/test/default/cam-posts', entries: [
      { file_name: 'shop.cps', bytes: 512, kind: 'reference_only', machine: null, message: 'Source reference only; not executed.' },
      { file_name: 'shop.nbpost', bytes: 1200, kind: 'native_profile', machine, message: 'Private machine snapshot.' },
    ] };
    window.__chosenLibraryFolder = shared;
    window.__storageFailure = false;
    window.__projectBeforeStorage = JSON.stringify(window.__appStore.getState().camDocument);
    const location = dir => ({ directory: dir, path: `${dir}/cam-tool-library.json`, is_default: dir === root,
      exists: files.has(dir), tool_count: files.has(dir) ? JSON.parse(files.get(dir)).tools.length : 0 });
    const snapshot = () => ({ json: files.get(directory) ?? null, path: location(directory).path, revision: String(revision) });
    window.__changeLibraryExternally = () => { revision++; };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => undefined };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: fn => { const id = ++nextCallback; callbacks.set(id, fn); return id; },
      unregisterCallback: id => callbacks.delete(id),
      invoke: async (command, args) => {
        if (command.startsWith('cam_library_')) window.__storageCalls.push({ command, args });
        if (command.startsWith('cam_posts_')) window.__postStorageCalls.push({ command, args });
        if (command === 'cam_posts_list') return structuredClone(posts);
        if (command === 'cam_posts_open_folder') return null;
        if (command === 'cam_posts_import') {
          const file_name = args.source.split('/').at(-1);
          if (posts.entries.some(p => p.file_name === file_name)) throw new Error('A different post already has that filename. The existing file was kept.');
          posts.entries.push({ file_name, bytes: 1024, kind: 'reference_only', machine: null, message: 'Source reference only; not executed.' });
          return structuredClone(posts);
        }
        if (command === 'cam_posts_save_profile') {
          posts.entries.push({ file_name: args.fileName, bytes: 1024, kind: 'native_profile', machine: structuredClone(args.machine), message: 'Private machine snapshot.' });
          return structuredClone(posts);
        }
        if (command === 'plugin:dialog|open') return window.__chosenLibraryFolder;
        if (command === 'plugin:event|listen') { listeners.set(args.handler, args.event); return args.handler; }
        if (command === 'plugin:event|unlisten') { listeners.delete(args.eventId); return; }
        if (command === 'cam_library_location') return location(directory);
        if (command === 'cam_library_inspect_location') return location(args.directory ?? root);
        if (command === 'cam_library_set_location') {
          if (window.__storageFailure) throw new Error('Library folder is offline; nothing was changed.');
          const target = args.directory ?? root;
          if (args.action === 'copy_current') {
            if (files.has(target)) throw new Error('Destination already exists');
            files.set(target, files.get(directory));
          }
          directory = target; revision++;
          for (const [id, event] of listeners) if (event === 'cam-library-location-changed') callbacks.get(id)?.({ event, id, payload: null });
          return location(directory);
        }
        if (command === 'cam_library_load') return snapshot();
        if (command === 'cam_library_save') {
          if (args.expectedPath !== snapshot().path || args.expectedRevision !== snapshot().revision) {
            throw new Error('The central library or its location changed after loading. Reload; nothing was overwritten.');
          }
          files.set(directory, args.json); revision++;
          return snapshot();
        }
        return null;
      },
    };
    window.__appStore.getState().setSettingsOpen(true);
  });
  const settings = page.getByTestId('appearance-dialog');
  const section = settings.getByTestId('cam-library-settings');
  const path = section.getByTestId('cam-library-location');
  const review = section.getByTestId('cam-library-location-review');
  const applied = () => page.evaluate(() => window.__storageCalls.filter(c => c.command === 'cam_library_set_location'));
  await path.waitFor();
  assert.match(await path.innerText(), /\/test\/default\/cam-tool-library.json/);
  assert.equal(await section.getByRole('button', { name: 'Use default location…' }).isDisabled(), true);
  const postSettings = settings.getByTestId('cam-post-settings');
  await postSettings.getByTestId('cam-post-location').waitFor();
  assert.match(await postSettings.innerText(), /shop.cps/);
  assert.match(await postSettings.innerText(), /Reference only/);
  await postSettings.getByRole('button', { name: 'Open post folder' }).click();
  await page.evaluate(() => { window.__chosenLibraryFolder = '/test/import/new.cps'; });
  await postSettings.getByRole('button', { name: 'Import post…' }).click();
  await postSettings.getByText('new.cps', { exact: true }).waitFor();
  await postSettings.getByRole('button', { name: 'Import post…' }).click();
  await postSettings.getByRole('alert').waitFor();
  assert.match(await postSettings.getByRole('alert').innerText(), /existing file was kept/);
  await postSettings.getByRole('button', { name: 'Refresh posts' }).click();
  assert.equal(await postSettings.getByText('new.cps', { exact: true }).count(), 1);
  assert.deepEqual(await applied(), [], 'post import must not move the tool library');
  await page.evaluate(() => { window.__chosenLibraryFolder = '/test/shared'; });
  await section.getByRole('button', { name: 'Choose folder…' }).click();
  await review.waitFor();
  assert.deepEqual(await applied(), [], 'choosing a directory only previews it');
  await review.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.deepEqual(await applied(), []);
  await section.getByRole('button', { name: 'Choose folder…' }).click();
  await review.getByRole('button', { name: 'Copy current library here' }).click();
  await review.waitFor({ state: 'detached' });
  assert.match(await path.innerText(), /\/test\/shared\//);
  assert.equal(await postSettings.getByTestId('cam-post-location').innerText(), '/test/default/cam-posts', 'posts do not follow central library relocation');
  assert.match(await section.getByRole('status').innerText(), /original file was kept/);
  assert.equal((await applied()).at(-1).args.action, 'copy_current');

  await page.evaluate(() => { window.__chosenLibraryFolder = '/test/existing'; });
  await section.getByRole('button', { name: 'Choose folder…' }).click();
  await review.waitFor();
  assert.equal(await review.getByRole('button', { name: 'Copy current library here' }).count(), 0);
  await review.getByRole('button', { name: 'Use this library' }).click();
  await review.waitFor({ state: 'detached' });
  assert.match(await path.innerText(), /\/test\/existing\//);
  assert.equal((await applied()).at(-1).args.action, 'use_existing');

  await section.getByRole('button', { name: 'Use default location…' }).click();
  await review.getByRole('button', { name: 'Use this library' }).click();
  await review.waitFor({ state: 'detached' });
  assert.match(await path.innerText(), /\/test\/default\//);
  assert.match(await section.innerText(), /1 tool\b/);
  await page.evaluate(() => { window.__chosenLibraryFolder = '/test/offline'; window.__storageFailure = true; });
  await section.getByRole('button', { name: 'Choose folder…' }).click();
  await review.getByRole('button', { name: 'Use empty folder' }).click();
  await section.getByRole('alert').waitFor();
  assert.match(await section.getByRole('alert').innerText(), /offline/);
  assert.match(await path.innerText(), /\/test\/default\//);
  await review.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.screenshot({ path: '/tmp/nbcad-cam-library-settings.png' });

  const stale = await page.evaluate(async () => {
    const api = await import('/src/cam/library.ts');
    const expected = await api.loadCentralLibrary();
    window.__changeLibraryExternally();
    let error;
    try { await api.updateCentralLibraryTool(1, tool => { tool.name = 'Stale edit'; }, expected); }
    catch (cause) { error = String(cause); }
    return { error, oldName: expected.tools[0].name, current: (await api.loadCentralLibrary()).tools[0].name };
  });
  assert.match(stale.error, /nothing was overwritten/);
  assert.equal(stale.oldName, 'Shop mill', 'editing must not mutate the loaded library before a successful save');
  assert.equal(stale.current, 'Shop mill');
  assert.equal(await page.evaluate(() => JSON.stringify(window.__appStore.getState().camDocument) === window.__projectBeforeStorage), true);
  assert.equal(await settings.getByRole('button', { name: 'Done', exact: true }).isVisible(), true);
  await settings.getByRole('button', { name: 'Done', exact: true }).click();

  // Sources stay reference-only; only validated native snapshots are selectable.
  await page.evaluate(() => { const store = window.__appStore.getState(); store.setActiveTab('cam'); store.setCamDialog({ type: 'setup' }); });
  const setup = page.getByTestId('cam-setup-dialog');
  await setup.waitFor();
  const target = setup.getByTestId('cam-machine-select');
  await page.waitForFunction(() => document.querySelector('option[value="private:shop.nbpost"]'));
  assert.equal(await target.locator('option[value="private:shop.cps"]').count(), 0);
  for (const brand of ['fanuc', 'haas', 'mitsubishi', 'mazak', 'syntec', 'okuma', 'heidenhain', 'hermle_heidenhain', 'siemens828d']) {
    assert.equal(await target.locator(`option[value="${brand}"]`).count(), 1);
  }
  await target.selectOption('private:shop.nbpost');
  assert.equal(await setup.getByTestId('cam-machine-name').inputValue(), 'Private shop mill');
  assert.match(await setup.innerText(), /SHOP_STOP/);
  await setup.getByTestId('cam-machine-name').fill('Independent copy');
  await setup.getByRole('button', { name: 'Save as private post profile' }).click();
  await setup.getByRole('status').filter({ hasText: 'Saved in Settings' }).waitFor();
  await setup.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(await page.evaluate(() => JSON.stringify(window.__appStore.getState().camDocument) === window.__projectBeforeStorage), true);
  const postCalls = await page.evaluate(() => window.__postStorageCalls);
  assert.ok(postCalls.some(c => c.command === 'cam_posts_open_folder'));
  assert.ok(postCalls.some(c => c.command === 'cam_posts_save_profile' && c.args.fileName === 'Independent-copy.nbpost'));
  const savedProfile = postCalls.find(c => c.command === 'cam_posts_save_profile').args.machine.profile;
  assert.equal(savedProfile.schema_version, 2);
  assert.equal(savedProfile.post.siemens_828d.spindle_stop_subprogram, 'SHOP_STOP');

  // The Tool Library shortcut opens the same Settings panel above the editor.
  await page.evaluate(() => {
    const store = window.__appStore.getState();
    store.setActiveTab('cam'); store.setCamDialog({ type: 'tool', toolId: null });
  });
  const tools = page.getByTestId('cam-tool-dialog');
  await tools.getByRole('button', { name: 'Storage settings…' }).click();
  await settings.waitFor();
  await section.getByRole('button', { name: 'Choose folder…' }).click();
  await review.waitFor();
  await review.getByRole('button', { name: 'Cancel', exact: true }).click();
  await settings.getByRole('button', { name: 'Done', exact: true }).click();

  // A folder change must not discard an unrelated, unsaved project-tool draft.
  await page.evaluate(() => window.__appStore.getState().setCamDialog(null));
  await tools.waitFor({ state: 'detached' });
  await page.evaluate(async () => {
    const central = await (await import('/src/cam/library.ts')).loadCentralLibrary();
    const doc = await window.__engine.camDocument();
    doc.tools = central.tools; doc.next_tool_id = central.next_tool_id;
    const store = window.__appStore.getState();
    await store.setCamDocument(doc);
    store.setCamDialog({ type: 'tool', toolId: 1 });
    window.__storageFailure = false; window.__chosenLibraryFolder = '/test/shared';
  });
  const draftName = tools.getByLabel('Name', { exact: true });
  await draftName.fill('Unsaved project draft');
  await tools.getByRole('button', { name: 'Storage settings…' }).click();
  await section.getByRole('button', { name: 'Choose folder…' }).click();
  await review.getByRole('button', { name: 'Use this library' }).click();
  await review.waitFor({ state: 'detached' });
  await settings.getByRole('button', { name: 'Done', exact: true }).click();
  assert.equal(await draftName.inputValue(), 'Unsaved project draft');
  assert.equal(await page.evaluate(() => window.__appStore.getState().camDocument.tools[0].name), 'Shop mill');
  assert.deepEqual(errors, []);
  console.log('PASS: private posts import/folder/profiles, no script execution or overwrite, independent library storage, snapshot selection, stale-editor protection and unchanged project tools');
} catch (error) {
  console.error('UI state:', await page.evaluate(() => ({
    tab: window.__appStore?.getState().activeTab,
    dialog: window.__appStore?.getState().camDialog,
    text: document.body.innerText.slice(-6000),
  })), errors);
  await page.screenshot({ path: '/tmp/nbcad-cam-library-settings-failure.png' });
  throw error;
} finally { await browser.close(); }
