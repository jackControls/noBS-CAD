import { getEngine } from './engine';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { BrowserTree } from './components/BrowserTree';
import { canRedoApplicationHistory } from './engine/controller';
import { dropApplicationHistory } from './engine/applicationHistory';
import { runNativeEditCommand } from './nativeEditMenu';
import { applyLiveUiControl } from './liveUiBridge';
import { useAppStore } from './store/appStore';
import type { BodyDto, DocumentDto, NamedViewConfigurationDto, ProjectVisibilityDto } from './engine/types';

/** Same controller regression can run against simulated IPC or a native test bridge. */
export async function checkNamedViewHistory(native = false) {
  const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
  const initial = useAppStore.getState();
  const w = window as typeof window & { __TAURI_INTERNALS__?: { invoke(command: string, args?: Record<string, unknown>): Promise<unknown> } };
  const previous = w.__TAURI_INTERNALS__;
  const emptyVisibility: ProjectVisibilityDto = { hidden_body_ids: [], hidden_datum_plane_ids: [], hidden_sketch_names: [] };
  const key = 'named-view-history';
  let pendingHistory: unknown = null;
  const historyResponses: Record<string, unknown>[] = [];
  let failNext: string | null = null;
  let holdNamedViews: {entered(): void; reply: Promise<void>} | null = null;
  const history = async (command: 'undo' | 'redo', failed = false) => {
    if (native) return runNativeEditCommand(command);
    pendingHistory = {id: command, session_id: key, expires_ms: Date.now() + 10000, ui: {action: 'history', command}};
    await applyLiveUiControl(async () => {});
    check(historyResponses[historyResponses.length - 1]?.status === (failed ? 'failed' : 'applied'), `MCP ${command} must report its execution outcome`);
  };
  if (!native) {
    type Model = { document: DocumentDto; views: NamedViewConfigurationDto[]; visibility: ProjectVisibilityDto };
    let model: Model = { document: { name: key, settings: { units: 'mm' }, rollback_index: 2,
      features: [1, 2].map(id => ({ id, name: `Extrude${id}`, kind: 'extrude', suppressed: false, status: { state: 'ok' } })), browser: [] },
      views: [], visibility: emptyVisibility };
    let active: string | null = null;
    let assembly = structuredClone(initial.assemblyDocument);
    const updateViewBrowser = () => {
      model.document = {...model.document, browser: [{id: 100, kind: 'named_views', name: null, reference_id: null, visible: true,
        children: model.views.map((view, index) => ({id: 101 + index, kind: 'named_view', name: view.name, reference_id: null, visible: true, children: []}))}]};
    };
    const update = () => ({ document: model.document, scene: { bodies: model.document.features.map(feature => ({
      id: feature.id, name: feature.name, feature_id: feature.id, faces: [], edges: [],
      mesh: { positions: [], normals: [], indices: [] },
    } as BodyDto)), errors: [] } });
    w.__TAURI_INTERNALS__ = { async invoke(command, args = {}) {
      if (command === 'mcp_session_bridge_control') {
        if (args.response) {historyResponses.push(args.response as Record<string, unknown>); return null;}
        const request = pendingHistory; pendingHistory = null; return request;
      }
      if (command === failNext) {
        failNext = null;
        return JSON.stringify({ok: false, error: 'Injected history rejection', data: {project_load_state: 'unchanged'}});
      }
      const payload = typeof args.payload === 'string' ? JSON.parse(args.payload) : null;
      let value: unknown;
      switch (command) {
        case 'get_document': return model.document;
        case 'engine_document': value = model.document; break;
        case 'engine_solid_scene': value = update().scene; break;
        case 'engine_project_export_model': value = JSON.stringify(model); break;
        case 'engine_project_load': model = JSON.parse(payload); active = null; value = update(); break;
        case 'engine_project_visibility': value = model.visibility; break;
        case 'engine_project_set_visibility': model.visibility = payload; value = model.visibility; break;
        case 'engine_named_views': {
          value = { views: model.views, active };
          const hold = holdNamedViews; holdNamedViews = null;
          if (hold) {hold.entered(); await hold.reply;}
          break;
        }
        case 'engine_set_named_views': model.views = payload.views; updateViewBrowser(); active = null; value = { views: model.views, active }; break;
        case 'engine_upsert_named_view':
          model.views = [...model.views.filter(view => view.name !== payload.name), payload];
          updateViewBrowser();
          active = null; value = { views: model.views, active }; break;
        case 'engine_rename_named_view':
          model.views = model.views.map(view => view.name === payload.name ? {...view, name: payload.new_name} : view);
          updateViewBrowser();
          active = null; value = { views: model.views, active }; break;
        case 'engine_delete_named_view':
          model.views = model.views.filter(view => view.name !== payload.name);
          updateViewBrowser();
          active = null; value = { views: model.views, active }; break;
        case 'engine_clear_named_view': active = null; value = { views: model.views, active }; break;
        case 'engine_recall_named_view': {
          const view = model.views.find(view => view.name === payload.name)!;
          active = view.name;
          model.visibility = { ...model.visibility, hidden_body_ids: update().scene.bodies.map(body => body.id).filter(id => !view.visible_body_ids.includes(id)) };
          value = { view, visibility: model.visibility }; break;
        }
        case 'engine_solid_delete_feature':
          model.document = { ...model.document, features: model.document.features.filter(feature => feature.id !== payload.feature_id), rollback_index: model.document.rollback_index - 1 };
          active = null; value = update(); break;
        case 'engine_finished_sketches': case 'engine_datum_plane_definitions': case 'engine_body_appearances': value = []; break;
        case 'engine_drawing_document': value = initial.drawingDocument; break;
        case 'engine_assembly_document': value = assembly; break;
        case 'engine_assembly_set_document': assembly = payload; value = assembly; break;
        case 'engine_assembly_solution': value = initial.assemblySolution; break;
        case 'engine_cam_document': value = initial.camDocument; break;
        default: throw new Error(`Unexpected named-view history command: ${command}`);
      }
      return JSON.stringify({ ok: true, value });
    } };
  }
  try {
    const engine = await getEngine();
    if (native) {
      await engine.newProject();
      for (let index = 0; index < 2; index++) {
        await engine.beginSketch({ type: 'origin_plane', plane: 'xy' });
        await engine.addRectangle({ mode: 'two_point', p1: { x: index * 20, y: 0 }, p2: { x: index * 20 + 10, y: 10 }, ctrl_held: false });
        await engine.endSketch();
        await engine.extrude({ sketch_name: `Sketch${index + 1}`, profile_indices: [0], operation: 'new_body',
          extent: { type: 'distance', distance: 10 }, taper_angle_deg: 0, flip: false, target_body_ids: [] });
      }
    }
    const scene = await engine.solidScene();
    const bodies = scene.bodies.map(body => body.id);
    check(bodies.length === 2, 'History fixture requires two bodies');
    const view = (name: string, visible: number[]): NamedViewConfigurationDto => ({ name,
      camera: { position: [80, -40, 30], target: [0, 0, 8], up: [0, 0, 1] }, visible_body_ids: visible,
      part_offsets: [{ body_id: bodies[0], translation: [0, 14, 0] }] });
    await engine.setNamedViews([view('first', [bodies[0]]), view('second', [bodies[1]])]);
    const document = await engine.getDocument();
    useAppStore.getState().loadProjectState({ document, scene }, await engine.finishedSketches(), [], null,
      [], initial.drawingDocument, initial.assemblyDocument, emptyVisibility, initial.assemblySolution);
    useAppStore.setState({ activeProjectTabId: key, engineKind: 'tauri', dirty: false });
    if (native) {
      const mount = window.document.createElement('div'); window.document.body.append(mount);
      const root = createRoot(mount);
      try {
        flushSync(() => root.render(createElement(BrowserTree)));
        const row = mount.querySelector<HTMLElement>('[data-named-view="second"]');
        check(row, 'The native model must expose its saved view in the rendered Browser');
        row!.click();
        const deadline = Date.now() + 3000;
        while (useAppStore.getState().activeNamedView !== 'second' || useAppStore.getState().solidBusy) {
          if (Date.now() > deadline) throw new Error('Native Browser recall timed out');
          await new Promise(resolve => setTimeout(resolve, 0));
        }
        check(JSON.stringify(await engine.solidScene()) === JSON.stringify(scene), 'Browser recall must not move native geometry');
        check(useAppStore.getState().viewPartOffsets.length === 1, 'Browser recall must publish the display offsets');
      } finally { root.unmount(); mount.remove(); }
    } else await useAppStore.getState().recallNamedView('second');
    check(useAppStore.getState().dirty && useAppStore.getState().document?.features.length === document.features.length,
      'Recall visibility marks the file dirty without adding a feature/history step');
    if (!native) {
      const before = await engine.exportProjectModel();
      failNext = 'engine_solid_delete_feature';
      await history('undo', true);
      check(await engine.exportProjectModel() === before && !canRedoApplicationHistory(), 'Rejected Undo must not mutate history or create Redo');
      useAppStore.getState().setConstraintDialog(null);
    }
    await history('undo');
    check(useAppStore.getState().document?.features.length === document.features.length - 1,
      'Undo after recall must undo the last model feature');
    check(!useAppStore.getState().viewPartOffsets.length && useAppStore.getState().activeNamedView === null,
      'Undo must return to assembled poses');
    check(useAppStore.getState().projectVisibility.hidden_body_ids.includes(bodies[0]), 'Undo must preserve visibility intent');
    await engine.recallNamedView('first');
    await useAppStore.getState().refreshAfterInboxApply('recall_named_view');
    check(canRedoApplicationHistory(), 'MCP recall must preserve feature Redo');
    await engine.renameNamedView('first', 'updated');
    await useAppStore.getState().refreshAfterInboxApply('rename_named_view');
    check(canRedoApplicationHistory(), 'Renaming a view must preserve feature Redo');
    await engine.upsertNamedView(view('updated', [bodies[0]]));
    await useAppStore.getState().refreshAfterInboxApply('upsert_named_view');
    check(canRedoApplicationHistory(), 'Updating a view must preserve feature Redo');
    const stored = await engine.deleteNamedView('second');
    await useAppStore.getState().refreshAfterInboxApply('delete_named_view');
    await new Promise<void>(resolve => queueMicrotask(resolve));
    check(canRedoApplicationHistory(), 'A saved view edit must not invalidate feature Redo');
    const visibility = useAppStore.getState().projectVisibility;
    if (!native) {
      const before = await engine.exportProjectModel();
      failNext = 'engine_project_load';
      await history('redo', true);
      check(await engine.exportProjectModel() === before && canRedoApplicationHistory(), 'Rejected Redo must preserve the model and retry entry');
      useAppStore.getState().setConstraintDialog(null);
    }
    await history('redo');
    check(useAppStore.getState().document?.features.length === document.features.length && !useAppStore.getState().constraintDialog,
      'Redo must restore the deleted model feature');
    check(JSON.stringify((await engine.namedViews()).views) === JSON.stringify(stored.views), 'Redo must retain later saved-view edits');
    check(JSON.stringify(await engine.projectVisibility()) === JSON.stringify(visibility)
      && JSON.stringify(useAppStore.getState().projectVisibility) === JSON.stringify(visibility),
      'Redo must retain later visibility choices in both engine and UI');
    check((await engine.namedViews()).active == null && !useAppStore.getState().viewPartOffsets.length,
      'Redo must leave both engine and UI in assembled poses');
    await useAppStore.getState().recallNamedView('updated');
    useAppStore.getState().openHoleDialog();
    const { exportProjectModelWithVisibility } = await import('./store/appStore');
    await exportProjectModelWithVisibility(engine);
    check((await engine.namedViews()).active == null, 'Saving an editing project must not retain a dismissed native presentation');
    useAppStore.getState().closeHoleDialog();
    await useAppStore.getState().recallNamedView('updated');
    if (native) {
      await engine.setGroundedBody(bodies[0]);
      await useAppStore.getState().refreshAfterInboxApply('assembly_set_grounded_body');
      check((await engine.namedViews()).active == null, 'Native assembly edits must clear the active marker');
    } else {
      await engine.setAssemblyDocument({...useAppStore.getState().assemblyDocument,
        next_position_id: useAppStore.getState().assemblyDocument.next_position_id + 1});
      await useAppStore.getState().refreshAfterInboxApply('assembly_set_document');
    }
    check(useAppStore.getState().activeNamedView === null && !useAppStore.getState().viewPartOffsets.length,
      'Assembly mutations must dismiss the view');
    if (!native) {
      const assemblyAfter = useAppStore.getState().assemblyDocument;
      await history('undo');
      check(canRedoApplicationHistory(), 'Assembly Undo must create Redo');
      await engine.upsertNamedView(view('assembly review', [bodies[0]]));
      await useAppStore.getState().refreshAfterInboxApply('upsert_named_view');
      await engine.recallNamedView('assembly review');
      await useAppStore.getState().refreshAfterInboxApply('recall_named_view');
      await engine.renameNamedView('assembly review', 'assembly updated');
      await useAppStore.getState().refreshAfterInboxApply('rename_named_view');
      await engine.deleteNamedView('updated');
      await useAppStore.getState().refreshAfterInboxApply('delete_named_view');
      check(canRedoApplicationHistory(), 'View edits and visibility recall must retain assembly Redo');
      const stored = await engine.namedViews();
      await history('redo');
      check(JSON.stringify(useAppStore.getState().assemblyDocument) === JSON.stringify(assemblyAfter), 'Assembly Redo must restore the assembly command');
      check(JSON.stringify((await engine.namedViews()).views) === JSON.stringify(stored.views), 'Assembly Redo must retain later views');
      await engine.recallNamedView('assembly updated');
      let delivered!: () => void; let release!: () => void;
      const entered = new Promise<void>(resolve => {delivered = resolve;});
      const reply = new Promise<void>(resolve => {release = resolve;});
      holdNamedViews = {entered: delivered, reply};
      const lateRecall = useAppStore.getState().refreshAfterInboxApply('recall_named_view');
      await entered;
      await useAppStore.getState().clearNamedView();
      release(); await lateRecall;
      check(useAppStore.getState().activeNamedView === null && !useAppStore.getState().viewPartOffsets.length,
        'Late MCP recall hydration must not undo a newer Clear');
      await engine.recallNamedView('assembly updated');
      const editEntered = new Promise<void>(resolve => {delivered = resolve;});
      const editReply = new Promise<void>(resolve => {release = resolve;});
      holdNamedViews = {entered: delivered, reply: editReply};
      const editedRecall = useAppStore.getState().refreshAfterInboxApply('recall_named_view');
      await editEntered;
      useAppStore.getState().openHoleDialog();
      release(); await editedRecall;
      check(useAppStore.getState().activeNamedView === null && !useAppStore.getState().viewPartOffsets.length,
        'An edit during MCP recall hydration must retain assembled display');
      await exportProjectModelWithVisibility(engine);
      check((await engine.namedViews()).active == null, 'Saving must reconcile a dismissed native recall whose name never reached the frontend');
      useAppStore.getState().closeHoleDialog();
      const before = await engine.exportProjectModel();
      useAppStore.setState({settingsOpen: true});
      pendingHistory = {id: 'blocked-undo', session_id: key, expires_ms: Date.now() + 10000, ui: {action: 'history', command: 'undo'}};
      await applyLiveUiControl(async () => {throw new Error('Blocked history must not publish');});
      check(historyResponses[historyResponses.length - 1]?.status === 'failed', 'MCP history must reject while Settings is open');
      check(await engine.exportProjectModel() === before, 'Blocked history must not change the project');
    }
    return { undo: 'passed', redo: 'passed', laterViewEdits: 'passed', visibility: 'passed', assembledReset: 'passed',
      ...(native ? {} : {rejectedHistory: 'passed', mcpRecallRedo: 'passed', mcpAssemblyHistory: 'passed'}), native };
  } finally {
    dropApplicationHistory(key);
    if (previous) w.__TAURI_INTERNALS__ = previous; else delete w.__TAURI_INTERNALS__;
    useAppStore.setState(initial);
  }
}
