import {useAppStore} from '../store/appStore';
import {startSessionBridge, applyInboxNow} from '../sessionBridge';
import {initializeProjectTabs} from '../files/projectTabs';
import {projectTransitions} from '../files/projectTransitions';
import type {DocumentDto} from '../engine/types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, failed) => { resolve = done; reject = failed; });
  return {promise, resolve, reject};
}

/** Fresh page per scenario: real startup, tab binding, publisher and inbox.
 * Control native replies and the publisher's debounce instead of sleeping. */
export async function checkStartupPublication(phase: 'before-bind' | 'during-bind') {
  const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
  const initial = useAppStore.getState();
  const doc: DocumentDto = {name: 'Startup', settings: {units: 'mm'}, features: [], rollback_index: 0, browser: []};
  const scene = {bodies: [], errors: []};
  const model = JSON.stringify({format: 'nbcad-project', schema_version: 6, document: doc});
  let binding = deferred<void>();
  let bindStarted = deferred<void>();
  let nextWrite = deferred<void>();
  let publishRejected = deferred<void>();
  let nativeDocumentId: string | null = '__bootstrap__';
  let nativeSessionId = 'bootstrap-session';
  let generation = 0;
  let applyOperation = false;
  let failExport = false;
  const writes: {session_id: string; project_session_id: string | null; model_json: string}[] = [];
  const ok = (value: unknown) => JSON.stringify({ok: true, value});
  const w = window as typeof window & {__TAURI_INTERNALS__?: {
    invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
    transformCallback: () => number;
  }};
  const previousNative = w.__TAURI_INTERNALS__;
  const originalTimeout = window.setTimeout;
  const originalClear = window.clearTimeout;
  const originalInterval = window.setInterval;
  const originalDebug = console.debug;
  const timers = new Map<number, () => void>();
  let timerId = -1;
  window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    if (timeout !== 300) return originalTimeout(handler, timeout, ...args);
    check(typeof handler === 'function', 'Publication debounce must have a callback');
    const id = timerId--;
    timers.set(id, () => (handler as (...args: unknown[]) => void)(...args));
    return id;
  }) as typeof window.setTimeout;
  window.clearTimeout = id => { if (id !== undefined && timers.delete(id)) return; originalClear(id); };
  // The test explicitly drives inbox work; no background wall-clock polling.
  window.setInterval = (() => timerId--) as typeof window.setInterval;
  console.debug = (...args: unknown[]) => {
    if (args[0] === '[sessionBridge] publish failed') publishRejected.resolve();
    else originalDebug(...args);
  };
  const firePublication = () => {
    check(timers.size === 1, `Expected one pending publication, received ${timers.size}`);
    const [id, callback] = [...timers][0];
    timers.delete(id);
    callback();
  };
  const settled = () => new Promise<void>(resolve => {
    if (projectTransitions.isSettled()) { resolve(); return; }
    const stop = projectTransitions.subscribe(() => {
      if (projectTransitions.isSettled()) { stop(); resolve(); }
    });
  });
  const publishScheduled = async () => {
    nextWrite = deferred<void>();
    firePublication();
    await nextWrite.promise;
    await settled();
    check(timers.size === 0, 'Snapshot completion must not schedule another export');
  };
  w.__TAURI_INTERNALS__ = {transformCallback: () => timerId--, async invoke(command, args = {}) {
    if (command === 'plugin:event|listen') return 1;
    if (command === 'mcp_session_bridge_control' || command === 'mcp_session_bridge_heartbeat') return null;
    if (command === 'get_document') return doc;
    if (['engine_finished_sketches', 'engine_datum_plane_definitions', 'engine_body_appearances'].includes(command)) return ok([]);
    if (command === 'engine_solid_scene') return ok(scene);
    if (command === 'engine_drawing_document') return ok(initial.drawingDocument);
    if (command === 'engine_assembly_document') return ok(initial.assemblyDocument);
    if (command === 'engine_assembly_solution') return ok(initial.assemblySolution);
    if (command === 'engine_project_visibility') return ok(initial.projectVisibility);
    if (command === 'engine_project_export_model') {
      if (failExport) throw new Error('Controlled export failure');
      return ok(model);
    }
    if (command === 'engine_active_sketch') return ok(null);
    if (command === 'engine_project_session_bind') {
      bindStarted.resolve();
      await binding.promise;
      nativeDocumentId = args.sessionId as string;
      nativeSessionId = `bound-${++generation}`;
      return ok(null);
    }
    if (command === 'mcp_session_bridge_reserve') return {
      session_id: nativeSessionId, project_session_id: nativeDocumentId, generation: generation + 1,
    };
    if (command === 'mcp_session_bridge_write') {
      const payload = JSON.parse(args.payload as string);
      check(payload.session_id === nativeSessionId && payload.project_session_id === nativeDocumentId,
        'Publication must retain the exact bound native identity');
      writes.push(payload);
      nextWrite.resolve();
      return {skipped: false};
    }
    if (command === 'mcp_session_bridge_apply_inbox') {
      check(args.sessionId === nativeSessionId && args.documentId === nativeDocumentId,
        'Inbox must target the bound document, never its bootstrap/retired session');
      const applied = applyOperation;
      applyOperation = false;
      return applied ? {applied: true, name: 'solid_extrude', result: {document: doc, scene}} : {applied: false};
    }
    throw new Error(`Unexpected native command: ${command}`);
  }};
  try {
    startSessionBridge();
    await useAppStore.getState().loadDocument();
    if (phase === 'before-bind') {
      await publishScheduled();
      check(writes[0]?.project_session_id === '__bootstrap__', 'Exercise the real bootstrap identity before tab binding');
    }
    const initializing = initializeProjectTabs();
    await bindStarted.promise;
    check(!projectTransitions.isSettled(), 'The actual native bind must hold startup publication');
    if (phase === 'during-bind') {
      firePublication();
      await publishRejected.promise;
      check(writes.length === 0, 'A startup timer during native binding must not publish an unowned model');
    }
    check(timers.size === 0, 'The first debounce must be exhausted before native bind completes');
    binding.resolve();
    await initializing;
    const bindTimer = [...timers.keys()][0];
    for (let poll = 0; poll < 3; poll++) {
      projectTransitions.begin()(false, true);
      check(timers.size === 1 && [...timers.keys()][0] === bindTimer,
        'Unchanged polls must preserve the pending publication deadline, not debounce it indefinitely');
    }
    // A delayed empty/bootstrap inbox poll can intercept the new debounce.
    // Its unchanged release must retry the publication already owed by bind.
    const emptyPoll = projectTransitions.begin();
    publishRejected = deferred<void>();
    firePublication(); await publishRejected.promise;
    check(timers.size === 0, 'A rejected publication must wait for its competing owner to settle');
    emptyPoll(false, true);
    await publishScheduled();
    check(writes[writes.length - 1]?.project_session_id === useAppStore.getState().activeProjectTabId
      && writes[writes.length - 1]?.model_json === model, 'Bind completion must automatically publish the loaded model with its real document ID');

    const startupWrites = writes.length;
    await applyInboxNow();
    check(timers.size === 0 && writes.length === startupWrites, 'Empty inbox polling must not re-export the model');
    applyOperation = true;
    await applyInboxNow();
    await settled();
    check(!applyOperation && writes.length === startupWrites + 1 && timers.size === 0,
      'A successful inbox operation must publish once, without a second debounced export');

    failExport = true; publishRejected = deferred<void>();
    useAppStore.setState({document: {...doc}});
    firePublication(); await publishRejected.promise;
    check(projectTransitions.isSettled() && timers.size === 0,
      'A settled native export failure must not create an automatic retry loop');
    failExport = false;

    // Fail the real binding after exhausting another store-triggered debounce.
    binding = deferred<void>(); bindStarted = deferred<void>(); publishRejected = deferred<void>();
    useAppStore.setState({document: {...doc}});
    const failed = initializeProjectTabs().then(() => null, error => error);
    await bindStarted.promise;
    firePublication(); await publishRejected.promise;
    const beforeFailure = writes.length;
    binding.reject(new Error('Controlled bind failure'));
    check(await failed instanceof Error, 'Native bind failure must propagate');
    check(!projectTransitions.isSettled() && timers.size === 0 && writes.length === beforeFailure,
      'Failed native binding must not publish or authorize a document');

    // A later verified bind recovers, but waits for competing ownership work.
    binding = deferred<void>(); bindStarted = deferred<void>();
    const recovering = initializeProjectTabs();
    await bindStarted.promise;
    const competing = projectTransitions.begin();
    binding.resolve(); await recovering;
    check(timers.size === 0, 'A completed bind cannot publish across a competing document transition');
    competing(true, true);
    await publishScheduled();
    check(writes[writes.length - 1]?.session_id === nativeSessionId, 'Only the final recovered session may publish');
    return {phase, checks: ['automatic-bound-publication', 'unchanged-transition-retry', 'stable-debounce-deadline', 'no-snapshot-loop', 'no-empty-poll-export',
      'single-inbox-export', 'export-failure-no-loop', 'failed-bind-fenced', 'competing-transition-recovery'], writes: writes.length};
  } finally {
    window.setTimeout = originalTimeout; window.clearTimeout = originalClear;
    window.setInterval = originalInterval; console.debug = originalDebug;
    if (previousNative) w.__TAURI_INTERNALS__ = previousNative; else delete w.__TAURI_INTERNALS__;
  }
}
