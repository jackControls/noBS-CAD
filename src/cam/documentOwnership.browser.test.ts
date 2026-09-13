import { useAppStore } from '../store/appStore';
import { pendingEngineOperations } from '../engine/activity';
import type { CamDocumentDto, CamToolDto, DocumentDto } from '../engine/types';
import { applicationExitBarrier, createExitController } from '../files/applicationExit';
import { projectTransitions } from '../files/projectTransitions';
import { presentation } from '../operationPlayback';
import { useCamActivity } from './simulationUi';
import {
  addCamTool, deleteCamOperation, duplicateCamSetup, importCamToolFromCentral,
  regenerateCamOperation, regenerateCamSetup, setCamPostDefaults, setCamUnits,
} from './document';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, failed) => { resolve = done; reject = failed; });
  return { promise, resolve, reject };
}

/** Real CAM queue, adapters, store publication, transition/exit fences; only
 * native IPC is substituted. No geometry or private library files are used. */
export async function checkCamDocumentOwnership() {
  const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
  const settled = async (promise: Promise<unknown>) => {
    try { await promise; return ''; } catch (error) { return String(error); }
  };
  const initial = useAppStore.getState();
  const appDocument = (name: string): DocumentDto => ({ name, settings: { units: 'mm' }, features: [], rollback_index: 0, browser: [] });
  const tool = { id: 1, name: 'Library tool' } as CamToolDto;
  const library = { json: JSON.stringify({ next_tool_id: 2, tools: [tool] }), path: 'contract-library', revision: '1' };
  let nativeCam = structuredClone(initial.camDocument);
  let nativeOwner = 'A';
  const writes: { owner: string; command: string }[] = [];
  let gate: { started: ReturnType<typeof deferred<void>>; reply: ReturnType<typeof deferred<void>> } | undefined;
  let libraryGate: typeof gate;
  const w = window as typeof window & { __TAURI_INTERNALS__?: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> } };
  const previousNative = w.__TAURI_INTERNALS__;
  w.__TAURI_INTERNALS__ = { async invoke(command, args = {}) {
    if (command === 'cam_library_load') {
      const current = libraryGate; libraryGate = undefined;
      if (current) { current.started.resolve(); await current.reply.promise; }
      return library;
    }
    if (command === 'cam_library_save') return { ...library, json: args.json, revision: '2' };
    if (!['engine_cam_set_document', 'engine_cam_regenerate_operation', 'engine_cam_regenerate_setup'].includes(command)) {
      throw new Error(`Unexpected CAM contract command: ${command}`);
    }
    writes.push({ owner: nativeOwner, command });
    const result: CamDocumentDto = command === 'engine_cam_set_document'
      ? JSON.parse(args.payload as string) : structuredClone(nativeCam);
    nativeCam = result;
    const current = gate; gate = undefined;
    if (current) { current.started.resolve(); await current.reply.promise; }
    return JSON.stringify({ ok: true, value: result });
  } };
  const replace = (name: string, sameTab = false) => {
    nativeOwner = name;
    nativeCam = structuredClone(initial.camDocument);
    useAppStore.getState().loadProjectState({ document: appDocument(name), scene: { bodies: [], errors: [] } }, [], [], `${name}.nbcad`);
    useAppStore.setState({ engineKind: 'tauri', activeProjectTabId: sameTab ? 'A' : name,
      camDocument: nativeCam, selectedCamSetupId: 91, selectedCamOperationId: 92, dirty: false });
  };
  const unchangedB = (document: CamDocumentDto) => {
    const state = useAppStore.getState();
    check(state.camDocument === document && !state.dirty && state.selectedCamSetupId === 91 && state.selectedCamOperationId === 92,
      'Retired CAM work must not replace B, mark it dirty or change its selection');
  };
  const idle = () => check(!applicationExitBarrier.isHeld() && !pendingEngineOperations()
    && !useCamActivity.getState().jobs.size && projectTransitions.isSettled(), 'All CAM fences and busy indicators must be released');
  try {
    for (const sameTab of [false, true]) {
      replace('A');
      const count = writes.length;
      const pending = [setCamUnits('inches'), regenerateCamOperation(1), regenerateCamSetup(1)].map(settled);
      check(applicationExitBarrier.isHeld() && pendingEngineOperations() === 3,
        'Queued work must hold exit and count as busy before its first paint');
      replace('B', sameTab);
      const document = useAppStore.getState().camDocument;
      const errors = await Promise.all(pending);
      check(errors.every(error => /document changed/i.test(error)) && writes.length === count,
        'Switch/Open before the queued write must cancel edits and regeneration without native dispatch');
      unchangedB(document); idle();
    }

    for (const action of [() => setCamUnits('inches'), () => regenerateCamOperation(1), () => regenerateCamSetup(1),
      () => setCamPostDefaults(structuredClone(initial.camDocument.post_defaults)),
      () => useAppStore.getState().setCamDocument(structuredClone(initial.camDocument))]) {
      replace('A');
      const hold = { started: deferred<void>(), reply: deferred<void>() }; gate = hold;
      const first = settled(action());
      await hold.started.promise;
      const queued = settled(setCamUnits('inches'));
      replace('B', true);
      const document = useAppStore.getState().camDocument;
      const count = writes.length;
      hold.reply.resolve();
      check(/document changed/i.test(await first) && /document changed/i.test(await queued) && writes.length === count,
        'A late reply and its queued successor must not write or publish to a replacement in the same tab');
      unchangedB(document); idle();
    }

    // A normal replacing transition waits for publication, not just the IPC.
    replace('A');
    const hold = { started: deferred<void>(), reply: deferred<void>() }; gate = hold;
    const edit = setCamUnits('inches');
    await hold.started.promise;
    const events: string[] = [];
    const unsubscribe = useAppStore.subscribe(state => {
      if (state.document?.name === 'A' && state.camDocument.units === 'inches' && state.dirty) events.push('published A');
    });
    const transition = projectTransitions.begin();
    const switching = (async () => {
      try { await transition.waitForSnapshots(); events.push('replace'); replace('B'); }
      finally { transition(); }
    })();
    await Promise.resolve();
    check(!events.length && nativeOwner === 'A', 'Native hydration must wait while CAM owns a snapshot');
    hold.reply.resolve();
    try { await edit; await switching; } finally { unsubscribe(); }
    check(events.join(',') === 'published A,replace', 'CAM must publish to A before a waiting replacement hydrates B');
    unchangedB(useAppStore.getState().camDocument); idle();

    // Slow central-library reads must not recapture B as the import target.
    for (const action of [() => importCamToolFromCentral(1), () => addCamTool(tool)]) {
      replace('A');
      const hold = { started: deferred<void>(), reply: deferred<void>() }; libraryGate = hold;
      const pending = settled(action());
      await hold.started.promise;
      replace('B');
      const document = useAppStore.getState().camDocument;
      const count = writes.length;
      hold.reply.resolve();
      check(/document changed/i.test(await pending) && writes.length === count, 'Library IO must retain the project captured before enqueueing');
      unchangedB(document); idle();
    }

    // Selection is part of guarded publication, never a trailing microtask.
    for (const action of [() => duplicateCamSetup(1), () => deleteCamOperation(1)]) {
      replace('A');
      const cam = structuredClone(nativeCam);
      cam.setups = [{ id: 1, name: 'Setup', operations: [{ id: 1 }] }] as CamDocumentDto['setups'];
      cam.active_setup_id = 1; cam.next_setup_id = 2; cam.next_operation_id = 2;
      nativeCam = cam; useAppStore.setState({ camDocument: cam });
      const hold = { started: deferred<void>(), reply: deferred<void>() }; gate = hold;
      const pending = settled(action());
      await hold.started.promise;
      replace('B');
      const document = useAppStore.getState().camDocument;
      hold.reply.resolve();
      check(/document changed/i.test(await pending), 'Selection-changing actions must reject a retired reply');
      unchangedB(document); idle();
    }

    replace('A');
    const failure = { started: deferred<void>(), reply: deferred<void>() }; gate = failure;
    const failing = settled(regenerateCamSetup(1));
    await failure.started.promise;
    failure.reply.reject(new Error('Native planning failed'));
    check((await failing).includes('Native planning failed'), 'Native failures must remain visible');
    await setCamUnits('inches');
    check(useAppStore.getState().camDocument.units === 'inches', 'A failed job must not poison the queue'); idle();

    replace('A');
    const queued = setCamUnits('inches');
    const exitEvents: string[] = [];
    const exit = createExitController({ dirty: () => useAppStore.getState().dirty,
      decide: async () => { exitEvents.push('unsaved'); return 'discard'; }, save: async () => true,
      exit: async () => { exitEvents.push('exit'); }, error: error => { throw error; } });
    const closing = exit.request();
    check(!exitEvents.length, 'Quit cannot miss queued CAM edits while they wait to paint');
    await queued; await closing; exit.dispose();
    check(exitEvents.join(',') === 'unsaved,exit', 'Quit must observe the dirty result before deciding'); idle();
    return { checks: ['queued-tab-switch', 'queued-same-tab-open', 'late-edit-reply', 'late-regeneration-reply',
      'metadata-owner', 'store-replacement-owner', 'snapshot-publication-fence', 'central-library-owner',
      'selection-owner', 'failure-recovery', 'queued-exit-barrier'], nativeWrites: writes.length };
  } finally {
    useAppStore.setState(initial); presentation.documentChanged();
    if (previousNative) w.__TAURI_INTERNALS__ = previousNative; else delete w.__TAURI_INTERNALS__;
  }
}
