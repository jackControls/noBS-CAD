import { useAppStore } from '../store/appStore';
import { deleteEntities, submitExtrude } from '../engine/controller';
import { pendingEngineOperations } from '../engine/activity';
import { applyLiveUiControl } from '../liveUiBridge';
import { applyInboxNow, publishCurrentSession } from '../sessionBridge';
import { presentation, setPlaybackPace } from '../operationPlayback';
import { projectTransitions } from './projectTransitions';
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
  const bounded = async <T,>(operation: Promise<T>, label: string): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([operation, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Exit fixture timed out: ${label}`)), 3000);
      })]);
    } finally { if (timer !== undefined) clearTimeout(timer); }
  };
  const running = new Set<Promise<unknown>>();
  const track = <T,>(operation: Promise<T>): Promise<T> => {
    running.add(operation);
    void operation.then(() => running.delete(operation), () => running.delete(operation));
    return operation;
  };
  const until = async (condition: () => boolean) => {
    const deadline = Date.now() + 3000;
    while (!condition()) { if (Date.now() >= deadline) throw new Error('Exit condition did not settle'); await settle(); }
  };
  const initial = useAppStore.getState();
  const doc = { name: 'Saved design', settings: { units: 'mm' as const }, features: [], rollback_index: 0, browser: [] };
  const scene = { bodies: [], errors: [] };
  const ok = (value: unknown) => JSON.stringify({ ok: true, value });
  const sketch = { name: 'Saved profile', entities: [], dimensions: [], constraints: [], reference_midpoints: [], can_undo: true, can_redo: false };
  const w = window as typeof window & { __TAURI_INTERNALS__?: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> } };
  const native = w.__TAURI_INTERNALS__;
  let reply = deferred<unknown>();
  let entered = deferred<void>();
  let controlDelivered = false;
  let onClose = () => {};
  let acknowledgments = 0, publications = 0;
  let failHydration = false;
  let hydrationFailures = 0, snapshotWrites = 0;
  const nativePending = new Set<ReturnType<typeof deferred<unknown>>>();
  const barrierReleases = new Set<() => void>();
  const reset = () => {
    reply = deferred(); entered = deferred(); controlDelivered = false;
    hydrationFailures = 0; snapshotWrites = 0; failHydration = false;
    const setup = projectTransitions.begin();
    useAppStore.setState({ ...initial, document: doc, engineKind: 'tauri', dirty: false, solidBusy: false, projectBusy: false,
      activeProjectTabId: 'saved', projectTabs: [{ id: 'saved', name: doc.name, fileName: 'Saved.nbcad', dirty: false, workspaceTab: 'solid' }] });
    presentation.documentChanged(); setup(true, true);
    presentation.control({ command: 'configure', mode: 'fast' });
  };
  w.__TAURI_INTERNALS__ = { async invoke(command, args = {}) {
    if (['engine_solid_extrude', 'engine_delete_entities', 'mcp_session_bridge_apply_inbox'].includes(command)) {
      if (command === 'mcp_session_bridge_apply_inbox') {
        check(args.documentId === 'saved-document' && args.sessionId === 'saved-session',
          'Inbox exit tests must use the document/session from a successful publication');
      }
      const pending = reply;
      nativePending.add(pending); entered.resolve();
      try { return await pending.promise; } finally { nativePending.delete(pending); }
    }
    if (command === 'mcp_session_bridge_reserve') return { session_id: 'saved-session', project_session_id: 'saved-document', generation: 1 };
    if (command === 'mcp_session_bridge_write') {
      const payload = JSON.parse(args.payload as string);
      check(payload.session_id === 'saved-session' && payload.project_session_id === 'saved-document',
        'Publication must retain its reserved document/session');
      snapshotWrites++; return { skipped: false };
    }
    if (command === 'engine_project_visibility') return ok(useAppStore.getState().projectVisibility);
    if (command === 'engine_project_export_model') return ok(JSON.stringify({ document: useAppStore.getState().document }));
    if (command === 'engine_active_sketch') return ok(null);
    if (command === 'engine_assembly_document') return ok(initial.assemblyDocument);
    if (command === 'engine_cam_document') return ok(initial.camDocument);
    if (command === 'engine_assembly_solution') return ok(initial.assemblySolution);
    if (command === 'mcp_session_bridge_control') {
      if (args.response) { acknowledgments++; return; }
      if (controlDelivered) return null; controlDelivered = true;
      return { id: 'close', session_id: 'saved', expires_ms: Date.now() + 3000, ui: { action: 'window', mode: 'close' } };
    }
    if (command === 'mcp_window_control') { onClose(); return { close_requested: true }; }
    if (command === 'get_document' && failHydration) {
      hydrationFailures++; throw new Error('Applied inbox result cannot hydrate');
    }
    throw new Error(`Unexpected exit test IPC: ${command}`);
  } };
  setPlaybackPace(0);
  const startSolid = () => track(submitExtrude({ sketch_name: 'Saved profile', profile_indices: [0], operation: 'new_body',
    extent: { type: 'distance', distance: 12 }, taper_angle_deg: 0, flip: false, target_body_ids: [] }));
  const startSketch = () => track(deleteEntities([1]));
  const publishOwner = async () => {
    check(await bounded(track(publishCurrentSession()), 'initial inbox publication'), 'Seed the current document owner before inbox polling');
    check(snapshotWrites === 1, 'Initial inbox ownership requires a successful snapshot write');
  };
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
      const editing = kind === 'solid' ? startSolid() : startSketch();
      await bounded(entered.promise, `${kind} native request`);
      check(!hasUnsavedProjects() && pendingEngineOperations() === 1, 'Begin with saved work and one unresolved native edit');
      if (kind === 'sketch') check(!useAppStore.getState().solidBusy, 'Sketch case must exercise operation tracking without solidBusy');
      const { controller, observed } = makeExit();
      const quitting = track(controller.request()); await settle();
      check(!currentUnsavedPrompt() && observed.exits === 0, 'Native close must wait before deciding that pending edits are clean');
      reply.resolve(JSON.stringify({ ok: true, value: kind === 'solid' ? { document: { ...doc, name: 'Edited design' }, scene } : { sketch } }));
      await bounded(editing, `${kind} result publication`); await until(() => !!currentUnsavedPrompt());
      check(hasUnsavedProjects(), 'Result publication precedes the unsaved-work prompt');
      resolveUnsavedPrompt(decision); await bounded(quitting, `${kind} exit decision`);
      check(observed.exits === Number(decision !== 'cancel') && observed.saves === Number(decision === 'save'), 'The selected exit decision is preserved');
      controller.dispose();
    }

    reset();
    const failedEdit = startSolid(); await bounded(entered.promise, 'rejected native request');
    const failed = makeExit(); const failedQuit = track(failed.controller.request()); await settle();
    check(failed.observed.exits === 0, 'Failed operations still settle before exit');
    reply.reject(new Error('Native operation rejected')); await bounded(failedEdit, 'rejected edit cleanup'); await bounded(failedQuit, 'exit after rejection');
    check(failed.observed.exits === 1 && !hasUnsavedProjects(), 'Rejected edits release all waits without fabricating dirty work');
    failed.controller.dispose();

    reset();
    const editing = startSolid(); await bounded(entered.promise, 'MCP close native request');
    const live = makeExit(); let quitting: Promise<void> | undefined;
    onClose = () => { quitting = track(live.controller.request()); };
    const control = track(applyLiveUiControl(async () => { publications++; })); await settle();
    check(live.observed.exits === 0 && acknowledgments === 0, 'MCP close must not deadlock or acknowledge before the ordinary edit');
    reply.resolve(JSON.stringify({ ok: true, value: { document: { ...doc, name: 'Edited design' }, scene } }));
    await bounded(editing, 'MCP edit publication'); await bounded(control, 'MCP close acknowledgment'); await until(() => !!currentUnsavedPrompt());
    check(acknowledgments === 1 && publications === 1, 'The live control publishes and acknowledges before prompting');
    check(quitting, 'MCP close must reach the production exit controller');
    resolveUnsavedPrompt('discard'); await bounded(quitting!, 'MCP discard'); check(live.observed.exits === 1, 'Discard can finish after its MCP close request');
    live.controller.dispose();

    reset();
    await publishOwner();
    const inbox = track(applyInboxNow()); await bounded(entered.promise, 'owned inbox request');
    check(pendingEngineOperations() === 0, 'Raw inbox IPC is protected by its own acknowledgement barrier');
    const incoming = makeExit(); const incomingQuit = track(incoming.controller.request()); await settle();
    check(incoming.observed.exits === 0 && !currentUnsavedPrompt(), 'Native close waits for raw inbox hydration');
    reply.resolve({ applied: true, name: 'solid_extrude', result: { document: { ...doc, name: 'Inbox result' }, scene } });
    await bounded(inbox, 'owned inbox publication'); await until(() => !!currentUnsavedPrompt());
    check(snapshotWrites === 2, 'Successful inbox work publishes through the canonical owned snapshot path');
    resolveUnsavedPrompt('cancel'); await bounded(incomingQuit, 'inbox cancel'); incoming.controller.dispose();

    reset(); await publishOwner(); failHydration = true;
    const brokenInbox = track(applyInboxNow()); await bounded(entered.promise, 'failed-hydration inbox request');
    const broken = makeExit(); const brokenQuit = track(broken.controller.request());
    reply.resolve({ applied: true, name: 'sketch_add_line', result: {} });
    await bounded(brokenInbox, 'failed inbox hydration'); await until(() => !!currentUnsavedPrompt());
    check(hydrationFailures === 1 && snapshotWrites === 1, 'Failed hydration must run and must not publish a mixed snapshot');
    check(hasUnsavedProjects() && broken.observed.exits === 0, 'A committed inbox edit remains unsaved when hydration fails');
    resolveUnsavedPrompt('cancel'); await bounded(brokenQuit, 'failed-hydration cancel'); broken.controller.dispose(); failHydration = false;

    reset(); useAppStore.getState().setProjectBusy(true);
    const publishing = makeExit(); const publishedQuit = track(publishing.controller.request()); await settle();
    check(!pendingEngineOperations() && publishing.observed.exits === 0, 'Store publication may still own the operation after native IPC finishes');
    useAppStore.setState({ dirty: true }); useAppStore.getState().setProjectBusy(false);
    await until(() => !!currentUnsavedPrompt()); resolveUnsavedPrompt('cancel'); await bounded(publishedQuit, 'store publication'); publishing.controller.dispose();

    for (const busy of ['engine', 'store', 'barrier'] as const) {
      reset();
      const edit = busy === 'engine' ? startSketch() : null;
      if (edit) await bounded(entered.promise, 'dispose native request');
      if (busy === 'store') useAppStore.getState().setProjectBusy(true);
      const release = busy === 'barrier' ? applicationExitBarrier.hold() : () => {};
      barrierReleases.add(release);
      const disposed = makeExit(); const request = track(disposed.controller.request()); await settle();
      disposed.controller.dispose(); await bounded(request, `dispose ${busy}`);
      check(disposed.observed.exits === 0, 'Disposal cancels waiting without exit or prompt');
      release(); barrierReleases.delete(release); useAppStore.getState().setProjectBusy(false);
      if (edit) { reply.resolve(JSON.stringify({ ok: true, value: { sketch } })); await bounded(edit, 'disposed edit cleanup'); }
      await settle(); check(!currentUnsavedPrompt(), 'Disposed settlement cannot revive after a late operation');
    }
    return { checks: ['pending-solid', 'pending-sketch', 'published-dirty', 'cancel-save-discard', 'native-rejection',
      'MCP-close-acknowledgment', 'raw-inbox', 'inbox-hydration-failure', 'store-publication', 'dispose-engine-store-barrier'] };
  } finally {
    for (const controller of controllers) controller.dispose();
    resolveUnsavedPrompt('cancel');
    for (const release of barrierReleases) release();
    for (const pending of nativePending) pending.reject(new Error('Exit fixture disposed'));
    useAppStore.setState({ solidBusy: false, projectBusy: false });
    try { await bounded(Promise.allSettled([...running]), 'fixture cleanup'); }
    finally {
      const restore = projectTransitions.begin();
      useAppStore.setState(initial, true); presentation.documentChanged(); restore(true, true);
      if (native) w.__TAURI_INTERNALS__ = native; else delete w.__TAURI_INTERNALS__;
    }
  }
}
