import { useAppStore } from './store/appStore';
import type { DocumentDto, ProjectVisibilityDto, NamedViewConfigurationDto } from './engine/types';
import { createProjectTab, initializeProjectTabs, installProjectTabRetention, switchProjectTab } from './files/projectTabs';
import { consumeProjectFraming } from './files/projectFraming';
import { registerSessionCamera, unregisterSessionCamera, type ViewportCameraApi } from './components/viewport/cameraApi';

/** Real tab eviction/hydration path; replace only native IPC and the timer. */
export async function checkNamedViewTabEviction() {
  const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
  const initial = useAppStore.getState();
  const w = window as typeof window & { __TAURI_INTERNALS__?: { invoke(command: string, args?: Record<string, unknown>): Promise<unknown> } };
  const previous = w.__TAURI_INTERNALS__;
  const emptyVisibility: ProjectVisibilityDto = { hidden_body_ids: [], hidden_datum_plane_ids: [], hidden_sketch_names: [] };
  const view: NamedViewConfigurationDto = { name: 'exploded',
    camera: { position: [80, -40, 30], target: [0, 0, 8], up: [0, 0, 1] },
    visible_body_ids: [1], part_offsets: [{ body_id: 1, translation: [0, 14, 0] }] };
  const document = (name: string): DocumentDto => ({ name, settings: { units: 'mm' }, features: [], rollback_index: 0, browser: [] });
  type Model = { document: DocumentDto; visibility: ProjectVisibilityDto; views: NamedViewConfigurationDto[]; active: string | null };
  const fresh = (name: string): Model => ({ document: document(name), visibility: structuredClone(emptyVisibility), views: [], active: null });
  let model = fresh('A'); model.views = [view];
  let activeId = '';
  const sessions = new Map<string, Model>();
  const dropped: string[] = [];
  let pressure = false;
  const update = () => ({ document: model.document, scene: { bodies: [], errors: [] } });
  w.__TAURI_INTERNALS__ = { async invoke(command, args = {}) {
    if (command === 'system_memory_status') return { pressure: pressure ? 'critical' : 'normal', totalBytes: 100, availableBytes: 1 };
    if (command === 'get_document') return model.document;
    const payload = typeof args.payload === 'string' ? JSON.parse(args.payload) : null;
    let value: unknown;
    switch (command) {
      case 'engine_project_session_bind': activeId = args.sessionId as string; sessions.set(activeId, model); break;
      case 'engine_project_session_create': activeId = args.sessionId as string; model = fresh('B'); sessions.set(activeId, model); value = update(); break;
      case 'engine_project_session_activate': {
        const retained = sessions.get(args.sessionId as string);
        value = !!retained;
        if (retained) { model = retained; activeId = args.sessionId as string; }
        break;
      }
      case 'engine_project_session_drop': sessions.delete(args.sessionId as string); dropped.push(args.sessionId as string); break;
      case 'engine_project_load': model = JSON.parse(payload); model.active = null; sessions.set(activeId, model); value = update(); break;
      case 'engine_project_export_model': value = JSON.stringify(model); break;
      case 'engine_project_visibility': value = model.visibility; break;
      case 'engine_project_set_visibility': model.visibility = payload; value = model.visibility; break;
      case 'engine_recall_named_view': {
        const recalled = model.views.find(candidate => candidate.name === payload.name);
        if (!recalled) throw new Error('View missing');
        model.active = recalled.name;
        model.visibility = { ...model.visibility, hidden_body_ids: [2] };
        value = { view: recalled, visibility: model.visibility }; break;
      }
      case 'engine_named_views': value = { views: model.views, active: model.active }; break;
      case 'engine_document': value = model.document; break;
      case 'engine_solid_scene': value = update().scene; break;
      case 'engine_finished_sketches': case 'engine_datum_plane_definitions': case 'engine_body_appearances': value = []; break;
      case 'engine_drawing_document': value = initial.drawingDocument; break;
      case 'engine_assembly_document': value = initial.assemblyDocument; break;
      case 'engine_assembly_solution': value = initial.assemblySolution; break;
      case 'engine_cam_document': value = initial.camDocument; break;
      default: throw new Error(`Unexpected tab command ${command}`);
    }
    return JSON.stringify({ ok: true, value });
  } };
  const setInterval = window.setInterval;
  let tick: (() => void) | undefined;
  window.setInterval = ((callback: () => void) => { tick = callback; return 0; }) as typeof window.setInterval;
  let stop: (() => void) | undefined;
  const camera = { getSnapshot: () => view.camera, restore: () => {} } as unknown as ViewportCameraApi;
  try {
    useAppStore.getState().loadProjectState(update(), [], [], null);
    useAppStore.setState({ activeProjectTabId: null, projectTabs: [], engineKind: 'tauri' });
    await initializeProjectTabs();
    const firstId = useAppStore.getState().activeProjectTabId!;
    await useAppStore.getState().recallNamedView('exploded');
    // An eye toggle after recall must also survive hydration.
    useAppStore.getState().applyProjectVisibility({ ...emptyVisibility, hidden_body_ids: [3] });
    registerSessionCamera(camera);
    await createProjectTab();
    unregisterSessionCamera(camera);
    stop = installProjectTabRetention(); pressure = true;
    tick!();
    const deadline = Date.now() + 5000;
    while (!dropped.includes(firstId) || useAppStore.getState().solidBusy) {
      if (Date.now() > deadline) throw new Error('Tab eviction timed out');
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    check(await switchProjectTab(firstId), 'Evicted tab must activate successfully');
    const state = useAppStore.getState();
    check(state.activeNamedView === 'exploded' && JSON.stringify(state.viewPartOffsets) === JSON.stringify(view.part_offsets),
      'Cold hydration must preserve the active named view and display offsets');
    check(JSON.stringify(state.projectVisibility.hidden_body_ids) === '[3]' && model.active === 'exploded',
      'Hydration must preserve post-recall eye toggles and restore backend active metadata');
    check(JSON.stringify(consumeProjectFraming(state)?.camera) === JSON.stringify(view.camera),
      'The evicted tab must retain its matching camera');
    return { coldHydration: 'passed', visibility: 'passed', camera: 'passed' };
  } finally {
    stop?.(); window.setInterval = setInterval;
    unregisterSessionCamera(camera);
    if (previous) w.__TAURI_INTERNALS__ = previous; else delete w.__TAURI_INTERNALS__;
    useAppStore.setState(initial);
  }
}
