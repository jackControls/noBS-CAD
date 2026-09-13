import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import '../index.css';
import {Viewport} from '../components/viewport/Viewport';
import {getSessionCamera} from '../components/viewport/cameraApi';
import {I18nProvider} from '../i18n';
import {useAppStore} from '../store/appStore';
import {operateUiFile} from '../uiFiles';
import {openProject} from './projectFiles';
import {createNbcadArchive} from './nbcad';
import type {DocumentDto, SolidSceneDto} from '../engine/types';

/** Real Open, archive/engine adapters, viewport scene/assembly placement and
 * camera controller. Only native IPC supplies a small known mesh fixture. */
export async function checkOpenedProjectFraming() {
  const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
  const frames = async () => { for (let i = 0; i < 2; i++) await new Promise(requestAnimationFrame); };
  const initial = useAppStore.getState();
  const corners: [number, number, number][] = [];
  for (const z of [0, 100]) for (const y of [0, 400]) for (const x of [0, 600]) corners.push([x, y, z]);
  const scene: SolidSceneDto = {bodies: [{id: 7, name: 'Fixture stock', feature_id: 1,
    mesh: {positions: corners.flat(), normals: corners.flatMap(() => [0, 0, 1]),
      indices: [0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1,
        2, 3, 7, 2, 7, 6, 0, 2, 6, 0, 6, 4, 1, 5, 7, 1, 7, 3]},
    faces: [{id: 71, key: 'fixture', first_index: 0, index_count: 36, plane: null}], edges: []}], errors: []};
  const freshDocument = (): DocumentDto => ({name: 'Same file title', settings: {units: 'mm'},
    features: [], rollback_index: 0, browser: []});
  let translation: [number, number, number] = [1000, 500, 200];
  let rejectLoad = false;
  let rejectHydration = false;
  let openedDocument = freshDocument();
  let assemblyRead = false;
  const model = () => JSON.stringify({format: 'nbcad-project', schema_version: 6, document: openedDocument});
  const solution = () => ({...initial.assemblySolution, instance_body_poses: [{body_id: 7,
    occurrence_id: 70, component_id: 17, visible: true, translation, rotation: [0, 0, 0, 1]}]});
  const ok = (value: unknown) => JSON.stringify({ok: true, value});
  const w = window as typeof window & {__TAURI_INTERNALS__?: unknown; __TAURI_EVENT_PLUGIN_INTERNALS__?: unknown};
  const previousNative = w.__TAURI_INTERNALS__;
  const previousEvents = w.__TAURI_EVENT_PLUGIN_INTERNALS__;
  w.__TAURI_EVENT_PLUGIN_INTERNALS__ = {unregisterListener: () => undefined};
  w.__TAURI_INTERNALS__ = {
    metadata: {currentWindow: {label: 'main'}},
    transformCallback: () => 0, unregisterCallback: () => undefined,
    async invoke(command: string) {
      if (command === 'read_binary_file') return Array.from(createNbcadArchive(model()));
      if (command === 'engine_project_load') {
        if (rejectLoad) return JSON.stringify({ok: false, error: 'Rejected before replacement', data: {project_load_state: 'unchanged'}});
        openedDocument = freshDocument(); assemblyRead = false;
        return ok({document: openedDocument, scene});
      }
      if (command === 'engine_assembly_solution') { assemblyRead = true; return ok(solution()); }
      if (command === 'engine_finished_sketches' && rejectHydration) throw new Error('Hydration failed');
      if (['engine_datum_plane_definitions', 'engine_finished_sketches', 'engine_body_appearances',
        'engine_hole_definitions', 'engine_body_feature_definitions'].includes(command)) return ok([]);
      if (command === 'engine_drawing_document') return ok(initial.drawingDocument);
      if (command === 'engine_assembly_document') return ok(initial.assemblyDocument);
      if (command === 'engine_cam_document') return ok(initial.camDocument);
      if (command === 'engine_project_visibility') return ok(initial.projectVisibility);
      if (command === 'engine_project_export_model') return ok(model());
      if (command === 'engine_project_session_bind' || command === 'engine_set_grid_step') return ok(null);
      if (command === 'native_viewport_metrics') return {available: false, ready: false};
      if (command.startsWith('native_viewport_') || command.startsWith('plugin:event|')) return null;
      throw new Error(`Unexpected Open framing IPC: ${command}`);
    },
  };
  const container = document.createElement('div');
  container.style.cssText = 'position:relative;width:900px;height:600px';
  document.body.replaceChildren(container);
  let root: ReturnType<typeof createRoot> | undefined;
  const mount = async () => {
    root = createRoot(container);
    flushSync(() => root!.render(<I18nProvider locale="en"><Viewport /></I18nProvider>));
    await frames();
    check(getSessionCamera(), 'The real viewport must mount');
  };
  const unmount = () => { root?.unmount(); root = undefined; };
  const open = () => operateUiFile({command: 'open', path: 'C:/fixture.nbcad', discard_changes: true});
  const snapshot = () => JSON.stringify(getSessionCamera()!.getSnapshot());
  const assertFramed = async () => {
    const api = getSessionCamera()!;
    check(assemblyRead && api.getAnimationState().status === 'completed', 'Open must apply its fitted camera after assembly hydration, before returning');
    check(JSON.stringify(api.getSnapshot().target) === JSON.stringify([
      translation[0] + 300, translation[1] + 200, translation[2] + 50]),
    'Fit must use placed occurrences, not unplaced body definitions');
    await frames();
    const rect = api.bounds();
    for (const corner of corners) {
      const point = api.worldToScreen(corner.map((value, axis) => value + translation[axis]) as [number, number, number]);
      check(point && point.x > rect.x && point.x < rect.x + rect.width
        && point.y > rect.y && point.y < rect.y + rect.height, 'Actual controller must project every placed mesh corner within the viewport');
    }
  };
  const rejectOpen = async () => {
    let error: unknown;
    try { await open(); } catch (cause) { error = cause; }
    check(/Rejected before replacement|Hydration failed/.test(String(error)), 'Open must fail at the intended native boundary');
  };
  useAppStore.setState({document: freshDocument(), solidScene: initial.solidScene, dirty: false,
    activeProjectTabId: 'open-tab', activeTab: 'solid', mode: 'solid', solidBusy: false, projectBusy: false});
  try {
    // A cold/deferred Open succeeds without an artificial mount timeout. A
    // second file with the same name supersedes it before the viewport mounts.
    check(await open(), 'Open without a viewport must succeed');
    translation = [-1400, 800, 300];
    check(await open(), 'A second deferred Open must succeed');
    await mount(); await assertFramed();

    // The mounted shared UI/API file path applies camera framing synchronously.
    translation = [2000, -1000, 500];
    check(await open(), 'Mounted Open must succeed');
    await assertFramed();
    getSessionCamera()!.snapToDirection([0, 0, 1], 0);
    const manual = snapshot();
    useAppStore.setState({activeProjectTabId: 'other-tab'});
    check(snapshot() === manual, 'Ordinary tab changes must preserve the camera');
    useAppStore.setState({activeTab: 'drawing'}); unmount();
    useAppStore.setState({activeTab: 'solid'}); await mount();
    check(snapshot() === manual, 'Drawing return must preserve the chosen camera');
    unmount(); await mount();
    check(snapshot() === manual, 'Theme remount must not replay the consumed Open fit');

    rejectLoad = true; await rejectOpen(); rejectLoad = false;
    check(snapshot() === manual, 'Rejected Open must leave the previous camera unchanged');
    rejectHydration = true; await rejectOpen(); rejectHydration = false;
    check(snapshot() === manual, 'Failed hydration must not frame unpublished geometry');

    // A failed Open must not erase a prior valid deferred request.
    unmount(); translation = [4000, 500, 0]; check(await open(), 'Recovery Open must succeed');
    rejectLoad = true; await rejectOpen(); rejectLoad = false;
    await mount(); await assertFramed();
    const beforeStale = snapshot();
    unmount(); translation = [-5000, -5000, 0]; check(await open(), 'Deferred replacement must succeed');
    // Same tab and same name are deliberately insufficient ownership evidence.
    useAppStore.setState({document: freshDocument()});
    await mount();
    check(snapshot() === beforeStale, 'A stale deferred Open must not fit a later same-name document');

    // The File menu calls the same Open implementation as the explicit path API.
    translation = [500, 500, 0];
    check(await openProject({filePath: 'C:/menu-open.nbcad', discardChanges: true}), 'Shared File menu implementation must open');
    await assertFramed();
    return {deferredOpen: true, latestOpenWins: true, appliedBeforeAcknowledgement: true,
      actualPlacedMeshFits: true, failuresPreserveCamera: true, staleOwnerDiscarded: true,
      tabsDrawingAndThemePreserveManualCamera: true};
  } finally {
    unmount(); container.remove();
    if (previousNative === undefined) delete w.__TAURI_INTERNALS__; else w.__TAURI_INTERNALS__ = previousNative;
    if (previousEvents === undefined) Reflect.deleteProperty(w, '__TAURI_EVENT_PLUGIN_INTERNALS__'); else w.__TAURI_EVENT_PLUGIN_INTERNALS__ = previousEvents;
  }
}
