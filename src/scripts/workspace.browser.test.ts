// The production workspace and panel run unchanged; only native IPC is faked.
import {createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {ScriptPanel} from '../components/ScriptPanel';
import {UnsavedChangesDialog} from '../components/UnsavedChangesDialog';
import {currentUnsavedPrompt, resolveUnsavedPrompt} from '../files/unsavedChanges';
import {useAppStore} from '../store/appStore';
import {queueRecipeOpen} from './recipeLinks';
import {applyLiveUiControl} from '../liveUiBridge';
import {inspectUi, operateUi} from '../uiControl';
import {closeScripts, editScriptSource, loadScriptPath, runLoadedScript, showScriptExample,
  useScriptWorkspace, validateScriptSource, type ScriptExample, type ScriptInfo} from './workspace';
import {checkScriptHandoffOwnership} from './handoff.browser.test';

export async function checkScriptSourceOwnership() {
  const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
  const initial = useScriptWorkspace.getState();
  const initialApp = useAppStore.getState();
  const info = (source: string): ScriptInfo => ({name: source, source, step_count: 1, check_count: 0});
  // The lifecycle fixture also runs before the collection metadata migration.
  const exampleData = {id: 'replacement', name: 'Replacement', summary: '', group: 'document', operation: 'cad_document',
    kind: 'lesson' as const, focus_operations: [], operations: [], preview: false, source: 'replacement source'};
  const example: ScriptExample = exampleData;
  let resolveInspect!: (value: ScriptInfo) => void;
  let rejectInspect!: (reason: Error) => void;
  const calls: string[] = [];
  const saved: string[] = [];
  let immediateInspect = false;
  let saveResult: string | null = null;
  let failWrite = false;
  let liveRequest: Record<string, unknown> | null = null;
  let liveReceipt: Record<string, unknown> | undefined;
  const w = window as typeof window & {__TAURI_INTERNALS__?: {invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>}};
  const native = w.__TAURI_INTERNALS__;
  w.__TAURI_INTERNALS__ = {invoke(command, args) {
    calls.push(command);
    if (command === 'native_script_examples') return Promise.resolve([example]);
    if (command === 'native_viewport_set_suspended') return Promise.resolve(null);
    if (command === 'mcp_window_control') return Promise.reject(new Error('OS denied foreground focus'));
    if (command === 'mcp_session_bridge_control') {
      if (args?.response) { liveReceipt = args.response as Record<string, unknown>; return Promise.resolve(null); }
      const request = liveRequest; liveRequest = null; return Promise.resolve(request);
    }
    if (command === 'plugin:dialog|save') return Promise.resolve(saveResult);
    if (command === 'write_binary_file_atomic') {
      if (failWrite) return Promise.reject(new Error('Disk full'));
      saved.push(new TextDecoder().decode(new Uint8Array(args!.bytes as number[])));
      return Promise.resolve(null);
    }
    if (command === 'native_script_inspect' && immediateInspect) {
      return Promise.resolve(args!.path ? {...info(`loaded:${args!.path}`), path: args!.path} : info(args!.source as string));
    }
    if (command === 'native_script_inspect') return new Promise<ScriptInfo>((resolve, reject) => {
      resolveInspect = resolve; rejectInspect = reject;
    });
    throw new Error(`Unexpected model/file action during source loading: ${command}`);
  }};
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const render = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  const until = async (condition: () => boolean) => {
    const deadline = Date.now() + 3000;
    while (!condition()) {
      if (Date.now() >= deadline) throw new Error('Script source/link lifecycle did not settle');
      await render();
    }
  };
  try {
    useScriptWorkspace.setState({open: true, info: info('existing source'), source: 'existing source', sourceBaseline: 'existing source',
      tab: 'source', completed: true, loading: false, running: false});
    root.render(createElement('div', null, createElement(ScriptPanel), createElement(UnsavedChangesDialog)));
    await render();
    const loading = showScriptExample(example);
    await render();
    const editor = container.querySelector('textarea')!;
    check(editor.readOnly, 'The actual source field must lock while inspection is pending');
    const sourceControl = inspectUi().surfaces.flatMap(surface => surface.controls)
      .find(control => control.label === 'Script source')!;
    let readOnlyRejected = false;
    try { operateUi({action: 'set_value', target: sourceControl.id, value: 'lost edit'}); }
    catch (error) { readOnlyRejected = String(error).includes('read-only'); }
    check(readOnlyRejected, 'The shared UI/MCP edit path must respect the pending inspection');
    editScriptSource('lost edit');
    await runLoadedScript();
    check(useScriptWorkspace.getState().source === 'existing source', 'Pending load cannot race a source edit or run');
    closeScripts();
    resolveInspect(info(example.source));
    await loading;
    check(!useScriptWorkspace.getState().open, 'A completed load must not reopen a panel the user closed');
    check(useScriptWorkspace.getState().source === example.source, 'The selected source still loads without executing');
    check(!useScriptWorkspace.getState().loading && !useScriptWorkspace.getState().completed, 'Load releases its gate and prior completion');
    editScriptSource('revised source');
    const validation = validateScriptSource();
    closeScripts();
    rejectInspect(new Error('Invalid edited source'));
    await validation;
    check(useScriptWorkspace.getState().source === 'revised source' && !useScriptWorkspace.getState().loading
      && !useScriptWorkspace.getState().open && useScriptWorkspace.getState().error === 'Invalid edited source',
      'Failed inspection preserves editable source and Close while releasing the load gate');
    const retry = showScriptExample(example);
    check(currentUnsavedPrompt()?.kind === 'replace-script', 'Manual replacement also guards edited script source');
    resolveUnsavedPrompt('discard');
    await render();
    resolveInspect(info(example.source));
    await retry;
    check(useScriptWorkspace.getState().error === null && useScriptWorkspace.getState().open, 'A subsequent explicit load recovers');
    immediateInspect = true;
    useAppStore.setState({engineKind: 'tauri'});
    const appBefore = useAppStore.getState();
    editScriptSource('valuable unfinished edit');
    await validateScriptSource();
    check(useScriptWorkspace.getState().sourceBaseline === example.source, 'Validation cannot mark edited source as saved');
    liveRequest = {id: 'unsupported-recipe', session_id: 'retained-session', expires_ms: Date.now() + 30000,
      ui: {action: 'open_recipe', recipe: 'recipe-only-in-newer-version'}};
    await applyLiveUiControl(async () => { throw new Error('Opening source must not change the model'); });
    check(liveReceipt?.status === 'failed' && String(liveReceipt?.error).includes('does not include recipe')
      && useScriptWorkspace.getState().source === 'valuable unfinished edit', 'An older receiving catalog rejects unknown recipes before queueing so the current-version launcher can fall back');
    useScriptWorkspace.setState({running: true});
    liveRequest = {id: 'open-recipe-1', session_id: 'retained-session', expires_ms: Date.now() + 30000,
      ui: {action: 'open_recipe', recipe: example.id}};
    await applyLiveUiControl(async () => { throw new Error('Opening a recipe must not publish model changes'); });
    check(liveReceipt?.status === 'applied' && (liveReceipt.recipe as {status: string}).status === 'queued', 'The actual MCP bridge acknowledges queueing without waiting for playback or user input');
    check(String(liveReceipt?.focus_error).includes('OS denied foreground focus'), 'A focus restriction is reported separately and never turns queued source into a failed/duplicate delivery');
    await render();
    check(!currentUnsavedPrompt() && useScriptWorkspace.getState().source === 'valuable unfinished edit', 'Playback retains source and defers the prompt');
    useScriptWorkspace.setState({running: false});
    await until(() => !!currentUnsavedPrompt());
    await render();
    check(container.querySelector('[role="alertdialog"]')?.textContent?.includes('script edits'), 'The existing visible Save/Discard/Cancel dialog explains script replacement');
    resolveUnsavedPrompt('cancel');
    await until(() => !useScriptWorkspace.getState().loading);
    check(useScriptWorkspace.getState().source === 'valuable unfinished edit', 'Cancel preserves source');
    queueRecipeOpen(example.id);
    await until(() => !!currentUnsavedPrompt());
    resolveUnsavedPrompt('save');
    await until(() => !useScriptWorkspace.getState().loading);
    check(useScriptWorkspace.getState().source === 'valuable unfinished edit' && !saved.length, 'Cancelled file picker preserves source');
    saveResult = 'C:/test/preserved.jsonc'; failWrite = true;
    queueRecipeOpen(example.id);
    await until(() => !!currentUnsavedPrompt());
    resolveUnsavedPrompt('save');
    await until(() => !useScriptWorkspace.getState().loading);
    check(useScriptWorkspace.getState().source === 'valuable unfinished edit' && useScriptWorkspace.getState().error === 'Disk full', 'Failed save never replaces source');
    failWrite = false;
    queueRecipeOpen(example.id);
    await until(() => !!currentUnsavedPrompt());
    resolveUnsavedPrompt('save');
    await until(() => !useScriptWorkspace.getState().loading);
    check(saved[0] === 'valuable unfinished edit', 'Save preserves the exact edited source before replacement');
    check(useScriptWorkspace.getState().source === example.source && useScriptWorkspace.getState().tab === 'source', 'The link opens editable source, not playback or preview');
    editScriptSource('edits saved to A');
    useScriptWorkspace.setState({path: 'C:/test/requested-B.jsonc'});
    saveResult = 'C:/test/preserved-A.jsonc';
    const openPath = loadScriptPath();
    check(currentUnsavedPrompt()?.kind === 'replace-script', 'Loading a path also protects edited source');
    resolveUnsavedPrompt('save');
    await openPath;
    check(saved[saved.length - 1] === 'edits saved to A' && useScriptWorkspace.getState().source === 'loaded:C:/test/requested-B.jsonc'
      && useScriptWorkspace.getState().path === 'C:/test/requested-B.jsonc', 'Saving old edits to A must still load the originally requested B');
    check(useAppStore.getState() === appBefore, 'Recipe links do not mutate, replace or switch the active CAD design');
    check(!calls.includes('native_script_run') && !calls.includes('native_script_preview'), 'Opening the recipe never executes its commands');
    return {checks: ['busy-source-lock', 'MCP-readonly', 'load-run-exclusion', 'close-during-load', 'inspection-failure-recovery', 'deferred-recipe-link', 'source-dirty-after-validation', 'source-cancel', 'save-picker-cancel', 'save-failure', 'save-exact-source', 'save-before-path-load-identity', 'link-never-runs-or-replaces-design'], calls,
      handoff: await checkScriptHandoffOwnership()};
  } finally {
    resolveUnsavedPrompt('cancel');
    root.unmount(); container.remove();
    useScriptWorkspace.setState(initial);
    useAppStore.setState(initialApp);
    if (native) w.__TAURI_INTERNALS__ = native; else delete w.__TAURI_INTERNALS__;
  }
}
