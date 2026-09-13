import {useAppStore} from '../store/appStore';
import {applyInboxNow, publishCurrentSession} from '../sessionBridge';
import {presentation} from '../operationPlayback';
import {projectTransitions} from '../files/projectTransitions';
import type {DocumentDto} from '../engine/types';

/** Exercise progress through actual solid and drawing inbox publication. */
export async function checkInboxProgress() {
  for (const mode of ['fast', 'present'] as const) await checkInboxProgressMode(mode);
  return {solidProgress: true, drawingProgress: true, noExtraIpc: true, finalProgress: true, retiredOwner: true, modes: ['fast', 'present']};
}

async function checkInboxProgressMode(mode: 'fast' | 'present') {
  const check = (value: unknown, message: string) => { if (!value) throw new Error(message); };
  const initial = useAppStore.getState();
  const document: DocumentDto = {name: 'A', settings: {units: 'mm'}, features: [], rollback_index: 0, browser: []};
  const scene = {bodies: [], errors: []};
  const ok = (value: unknown) => JSON.stringify({ok: true, value});
  const w = window as typeof window & {__TAURI_INTERNALS__?: {invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>}};
  const previousNative = w.__TAURI_INTERNALS__;
  let reply: unknown;
  const calls: string[] = [];
  w.__TAURI_INTERNALS__ = {async invoke(command, args = {}) {
    calls.push(command);
    if (command === 'mcp_session_bridge_reserve') return {session_id: 'session-A', project_session_id: 'tab-A', generation: 1};
    if (command === 'mcp_session_bridge_write') return {skipped: false};
    if (command === 'mcp_session_bridge_apply_inbox') {
      check(args.documentId === 'tab-A' && args.sessionId === 'session-A', 'Progress must use the published inbox owner');
      return reply;
    }
    if (command === 'get_document') return document;
    if (command === 'engine_project_export_model') return ok(JSON.stringify({document}));
    if (command === 'engine_project_visibility') return ok(initial.projectVisibility);
    if (command === 'engine_active_sketch') return ok(null);
    if (command === 'engine_solid_scene') return ok(scene);
    if (command === 'engine_drawing_document') return ok(initial.drawingDocument);
    if (command === 'engine_assembly_document') return ok(initial.assemblyDocument);
    if (command === 'engine_cam_document') return ok(initial.camDocument);
    if (command === 'engine_assembly_solution') return ok(initial.assemblySolution);
    if (['engine_finished_sketches', 'engine_datum_plane_definitions', 'engine_body_appearances'].includes(command)) return ok([]);
    throw new Error(`Unexpected progress command: ${command}`);
  }};
  try {
    const setup = projectTransitions.begin();
    useAppStore.getState().loadProjectState({document, scene}, [], [], 'A.nbcad');
    useAppStore.setState({engineKind: 'tauri', activeProjectTabId: 'tab-A', solidBusy: false, projectBusy: false});
    setup(true, true);
    check(await publishCurrentSession(), 'Seed A publication');
    presentation.control({command: 'configure', mode, step_index: 0, step_count: 692});
    if (mode === 'present') presentation.control({command: 'note', text: 'Sparse chapter', step_index: 3, duration_ms: 0});
    const version = presentation.documentVersion();
    for (const name of ['solid_extrude', 'drawing_add_view']) {
      const applied = {applied: true, name, ...(name === 'solid_extrude' ? {result: {document, scene}} : {})};
      calls.length = 0;
      reply = applied;
      await applyInboxNow();
      const ordinaryCalls = [...calls];
      const ordinaryModel = JSON.stringify(useAppStore.getState().document);
      calls.length = 0;
      const completed = name === 'solid_extrude' ? 401 : 611;
      reply = {...applied, script_progress: {steps_completed: completed, step_count: 692}};
      await applyInboxNow();
      check(presentation.snapshot().step_index === completed && !presentation.snapshot().finished,
        `${name}: an in-flight ${mode} run must report completed authored steps between chapter notes`);
      check(JSON.stringify(calls) === JSON.stringify(ordinaryCalls), `${name}: progress must add no native calls or awaits`);
      check(JSON.stringify(useAppStore.getState().document) === ordinaryModel, `${name}: progress must not alter model data`);
    }
    check(presentation.documentVersion() === version && presentation.canApply(), 'Progress must preserve document ownership and maximum rate');
    reply = {applied: false, dead_lettered: true, script_progress: {steps_completed: 690, step_count: 692}};
    await applyInboxNow();
    check(presentation.snapshot().step_index === 611, 'A rejected operation cannot advance progress');
    presentation.control({command: 'finish', step_index: 692, step_count: 692});
    const finished = presentation.snapshot();
    reply = {applied: true, name: 'solid_extrude', result: {document, scene}, script_progress: {steps_completed: 612, step_count: 692}};
    await applyInboxNow();
    check(presentation.snapshot() === finished, 'Late ordinary work cannot overwrite final progress');

    presentation.control({command: 'configure', mode, step_index: 0, step_count: 692});
    let release!: (value: unknown) => void;
    reply = new Promise(resolve => { release = resolve; });
    calls.length = 0;
    const pending = applyInboxNow();
    for (let turn = 0; turn < 20 && !calls.includes('mcp_session_bridge_apply_inbox'); turn++) await Promise.resolve();
    check(calls.includes('mcp_session_bridge_apply_inbox'), 'The owned inbox poll must begin');
    const replacement = projectTransitions.begin();
    useAppStore.getState().loadProjectState({document: {...document, name: 'B'}, scene}, [], [], 'B.nbcad');
    replacement(true, true);
    presentation.control({command: 'configure', mode, step_index: 0, step_count: 692});
    const playbackB = presentation.snapshot();
    release({applied: true, name: 'solid_extrude', result: {document, scene}, script_progress: {steps_completed: 611, step_count: 692}});
    await pending;
    check(presentation.snapshot() === playbackB && useAppStore.getState().document?.name === 'B',
      'A delayed A progress response cannot change B even when its step count matches');
    return {solidProgress: true, drawingProgress: true, noExtraIpc: true, finalProgress: true, retiredOwner: true};
  } finally {
    const restore = projectTransitions.begin();
    useAppStore.setState(initial); presentation.documentChanged(); restore(true, true);
    if (previousNative) w.__TAURI_INTERNALS__ = previousNative; else delete w.__TAURI_INTERNALS__;
  }
}
