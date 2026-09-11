import { useAppStore } from '../store/appStore';
import { deleteEntities, submitExtrude } from '../engine/controller';
import { pendingEngineOperations } from '../engine/activity';
import { applyLiveUiControl } from '../liveUiBridge';
import { applyInboxNow } from '../sessionBridge';
import { setPlaybackPace } from '../operationPlayback';
import { hasUnsavedProjects } from './projectTabs';
import { applicationExitBarrier, createExitController } from './applicationExit';
import { waitForExitEdits } from './exitSettlement';
import { currentUnsavedPrompt, requestUnsavedDecision, resolveUnsavedPrompt } from './unsavedChanges';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

/** Production controllers, native adapter, store, exit settlement and prompts.
 * Only native replies and process termination are replaced at the IPC boundary. */
export async function checkApplicationExitEdits() {
  const check = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };
  const settle = () => new Promise<void>(resolve => setTimeout(resolve, 10));
  const until = async (condition: () => boolean) => {
    const deadline = Date.now() + 3000;
    while (!condition()) { if (Date.now() >= deadline) throw new Error('Exit condition did not settle'); await settle(); }
  };
  const initial = useAppStore.getState();
  const doc = { name: 'Saved design', settings: { units: 'mm' as const }, features: [], rollback_index: 0, browser: [] };
  const scene = { bodies: [], errors: [] };
  const sketch = { name: 'Saved profile', entities: [], dimensions: [], constraints: [], reference_midpoints: [], can_undo: true, can_redo: false };
  const w = window as typeof window & { __TAURI_INTERNALS__?: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> } };
  const native = w.__TAURI_INTERNALS__;
  let reply = deferred<unknown>();
  let entered = deferred<void>();
  let controlDelivered = false;
  let onClose = () => {};
  let acknowledgments = 0, publications = 0;
  let failHydration = false;
  const reset = () => {
    reply = deferred(); entered = deferred(); controlDelivered = false;
    useAppStore.setState({ ...initial, document: doc, engineKind: 'tauri', dirty: false, solidBusy: false, projectBusy: false,
      activeProjectTabId: 'saved', projectTabs: [{ id: 'saved', name: doc.name, fileName: 'Saved.nbcad', dirty: false, workspaceTab: 'solid' }] });
  };
  w.__TAURI_INTERNALS__ = { async invoke(command, args = {}) {
    if (['engine_solid_extrude', 'engine_delete_entities', 'mcp_session_bridge_apply_inbox'].includes(command)) {
      entered.resolve(); return reply.promise;
    }
    if (command === 'mcp_session_bridge_control') {
      if (args.response) { acknowledgments++; return; }
      if (controlDelivered) return null; controlDelivered = true;
      return { id: 'close', session_id: 'saved', expires_ms: Date.now() + 3000, ui: { action: 'window', mode: 'close' } };
    }
    if (command === 'mcp_window_control') { onClose(); return { close_requested: true }; }
    if (command === 'get_document' && failHydration) throw new Error('Applied inbox result cannot hydrate');
    throw new Error(`Unexpected exit test IPC: ${command}`);
  } };
  setPlaybackPace(0);
  const startSolid = () => submitExtrude({ sketch_name: 'Saved profile', profile_indices: [0], operation: 'new_body',
    extent: { type: 'distance', distance: 12 }, taper_angle_deg: 0, flip: false, target_body_ids: [] });
  const controllers: Array<ReturnType<typeof createExitController>> = [];
  const makeExit = () => {
    const observed = { exits: 0, saves: 0 };
    const controller = createExitController({ settle: waitForExitEdits, dirty: hasUnsavedProjects,
      decide: () => requestUnsavedDecision('quit'),
      save: async () => {
        check(hasUnsavedProjects() && !pendingEngineOperations(), 'Save receives the published edit');
        observed.saves++; useAppStore.setState({ dirty: false }); return true;
      },
      exit: async () => {
        observed.exits++;
        const state = useAppStore.getState();
        check(!pendingEngineOperations() && !state.solidBusy && !state.projectBusy, 'Native exit must follow ordinary editing settlement');
      }, error: error => { throw error; },
    });
    controllers.push(controller); return { controller, observed };
  };
  try {
    for (const kind of ['solid', 'sketch'] as const) for (const decision of ['cancel', 'save', 'discard'] as const) {
      reset();
      const editing = kind === 'solid' ? startSolid() : deleteEntities([1]);
      await entered.promise;
      check(!hasUnsavedProjects() && pendingEngineOperations() === 1, 'Begin with saved work and one unresolved native edit');
      if (kind === 'sketch') check(!useAppStore.getState().solidBusy, 'Sketch case must exercise operation tracking without solidBusy');
      const { controller, observed } = makeExit();
      const quitting = controller.request(); await settle();
      check(!currentUnsavedPrompt() && observed.exits === 0, 'Native close must wait before deciding that pending edits are clean');
      reply.resolve(JSON.stringify({ ok: true, value: kind === 'solid' ? { document: { ...doc, name: 'Edited design' }, scene } : { sketch } }));
      await editing; await until(() => !!currentUnsavedPrompt());
      check(hasUnsavedProjects(), 'Result publication precedes the unsaved-work prompt');
      resolveUnsavedPrompt(decision); await quitting;
      check(observed.exits === Number(decision !== 'cancel') && observed.saves === Number(decision === 'save'), 'The selected exit decision is preserved');
      controller.dispose();
    }

    reset();
    const failedEdit = startSolid(); await entered.promise;
    const failed = makeExit(); const failedQuit = failed.controller.request(); await settle();
    check(failed.observed.exits === 0, 'Failed operations still settle before exit');
    reply.reject(new Error('Native operation rejected')); await failedEdit; await failedQuit;
    check(failed.observed.exits === 1 && !hasUnsavedProjects(), 'Rejected edits release all waits without fabricating dirty work');
    failed.controller.dispose();

    reset();
    const editing = startSolid(); await entered.promise;
    const live = makeExit(); let quitting: Promise<void> | undefined;
    onClose = () => { quitting = live.controller.request(); };
    const control = applyLiveUiControl(async () => { publications++; }); await settle();
    check(live.observed.exits === 0 && acknowledgments === 0, 'MCP close must not deadlock or acknowledge before the ordinary edit');
    reply.resolve(JSON.stringify({ ok: true, value: { document: { ...doc, name: 'Edited design' }, scene } }));
    await editing; await control; await until(() => !!currentUnsavedPrompt());
    check(acknowledgments === 1 && publications === 1, 'The live control publishes and acknowledges before prompting');
    resolveUnsavedPrompt('discard'); await quitting; check(live.observed.exits === 1, 'Discard can finish after its MCP close request');
    live.controller.dispose();

    reset();
    const inbox = applyInboxNow(); await entered.promise;
    check(pendingEngineOperations() === 0, 'Raw inbox IPC is protected by its own acknowledgement barrier');
    const incoming = makeExit(); const incomingQuit = incoming.controller.request(); await settle();
    check(incoming.observed.exits === 0 && !currentUnsavedPrompt(), 'Native close waits for raw inbox hydration');
    reply.resolve({ applied: true, name: 'solid_extrude', result: { document: { ...doc, name: 'Inbox result' }, scene } });
    await inbox; await until(() => !!currentUnsavedPrompt());
    resolveUnsavedPrompt('cancel'); await incomingQuit; incoming.controller.dispose();

    reset(); failHydration = true;
    const brokenInbox = applyInboxNow(); await entered.promise;
    const broken = makeExit(); const brokenQuit = broken.controller.request();
    reply.resolve({ applied: true, name: 'sketch_add_line', result: {} });
    await brokenInbox; await until(() => !!currentUnsavedPrompt());
    check(hasUnsavedProjects() && broken.observed.exits === 0, 'A committed inbox edit remains unsaved when hydration fails');
    resolveUnsavedPrompt('cancel'); await brokenQuit; broken.controller.dispose(); failHydration = false;

    reset(); useAppStore.getState().setProjectBusy(true);
    const publishing = makeExit(); const publishedQuit = publishing.controller.request(); await settle();
    check(!pendingEngineOperations() && publishing.observed.exits === 0, 'Store publication may still own the operation after native IPC finishes');
    useAppStore.setState({ dirty: true }); useAppStore.getState().setProjectBusy(false);
    await until(() => !!currentUnsavedPrompt()); resolveUnsavedPrompt('cancel'); await publishedQuit; publishing.controller.dispose();

    for (const busy of ['engine', 'store', 'barrier'] as const) {
      reset();
      const edit = busy === 'engine' ? deleteEntities([1]) : null;
      if (edit) await entered.promise;
      if (busy === 'store') useAppStore.getState().setProjectBusy(true);
      const release = busy === 'barrier' ? applicationExitBarrier.hold() : () => {};
      const disposed = makeExit(); const request = disposed.controller.request(); await settle();
      disposed.controller.dispose(); await request;
      check(disposed.observed.exits === 0, 'Disposal cancels waiting without exit or prompt');
      release(); useAppStore.getState().setProjectBusy(false);
      if (edit) { reply.resolve(JSON.stringify({ ok: true, value: { sketch } })); await edit; }
      await settle(); check(!currentUnsavedPrompt(), 'Disposed settlement cannot revive after a late operation');
    }
    return { checks: ['pending-solid', 'pending-sketch', 'published-dirty', 'cancel-save-discard', 'native-rejection',
      'MCP-close-acknowledgment', 'raw-inbox', 'inbox-hydration-failure', 'store-publication', 'dispose-engine-store-barrier'] };
  } finally {
    for (const controller of controllers) controller.dispose();
    resolveUnsavedPrompt('cancel');
    useAppStore.setState(initial, true);
    if (native) w.__TAURI_INTERNALS__ = native; else delete w.__TAURI_INTERNALS__;
  }
}
