import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import '../index.css';
import {Viewport} from '../components/viewport/Viewport';
import {getSessionCamera} from '../components/viewport/cameraApi';
import {I18nProvider} from '../i18n';
import {useAppStore} from '../store/appStore';
import {closeProjectTab, createProjectTab, switchProjectTab} from './projectTabs';
import {pendingEngineOperations} from '../engine/activity';
import type {DocumentDto, SolidSceneDto} from '../engine/types';

/** Real tab bookkeeping, engine adapter, viewport scene and camera controller.
 * Only native IPC is replaced, by retained in-memory project sessions. */
export async function checkProjectTabCameras() {
  const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
  const frame = () => new Promise(requestAnimationFrame);
  // The mounted viewport reads hole definitions through the tracked engine
  // adapter, and tab bookkeeping refuses to snapshot a document while any
  // engine read is still in flight; wait the way a human between clicks does.
  const settle = async () => {
    for (let i = 0; i < 300 && pendingEngineOperations() > 0; i++) await frame();
    await frame();
  };
  let definitionReads = 0;
  const initial = useAppStore.getState();
  const scene: SolidSceneDto = {bodies: [], errors: []};
  const settings = {units: 'mm'} as DocumentDto['settings'];
  let documents = 0;
  const freshDocument = (): DocumentDto => ({name: `Design ${++documents}`, settings, features: [], rollback_index: 0, browser: []});
  const ok = (value: unknown) => JSON.stringify({ok: true, value});
  const w = window as typeof window & {__TAURI_INTERNALS__?: unknown; __TAURI_EVENT_PLUGIN_INTERNALS__?: unknown};
  const previousNative = w.__TAURI_INTERNALS__;
  const previousEvents = w.__TAURI_EVENT_PLUGIN_INTERNALS__;
  w.__TAURI_EVENT_PLUGIN_INTERNALS__ = {unregisterListener: () => undefined};
  w.__TAURI_INTERNALS__ = {
    metadata: {currentWindow: {label: 'main'}},
    transformCallback: () => 0, unregisterCallback: () => undefined,
    async invoke(command: string) {
      if (command === 'engine_project_session_create') return ok({document: freshDocument(), scene});
      if (command === 'engine_project_session_activate') return ok(true);
      if (['engine_project_session_bind', 'engine_project_session_drop', 'engine_set_grid_step',
        'engine_set_project_visibility'].includes(command)) return ok(null);
      if (command === 'engine_project_export_model') return ok(JSON.stringify({format: 'nbcad-project', schema_version: 6}));
      if (command === 'engine_body_feature_definitions') { definitionReads += 1; return ok([]); }
      if (['engine_datum_plane_definitions', 'engine_finished_sketches', 'engine_body_appearances',
        'engine_hole_definitions'].includes(command)) return ok([]);
      if (command === 'engine_project_visibility') return ok(initial.projectVisibility);
      if (command === 'native_viewport_metrics') return {available: false, ready: false};
      if (command.startsWith('native_viewport_') || command.startsWith('plugin:event|')) return null;
      throw new Error(`Unexpected tab camera IPC: ${command}`);
    },
  };
  const container = document.createElement('div');
  container.style.cssText = 'position:relative;width:900px;height:600px';
  document.body.replaceChildren(container);
  let root: ReturnType<typeof createRoot> | undefined;
  const mount = async () => {
    const reads = definitionReads;
    root = createRoot(container);
    flushSync(() => root!.render(<I18nProvider locale="en"><Viewport /></I18nProvider>));
    for (let i = 0; i < 300 && definitionReads === reads; i++) await frame();
    await settle();
    check(getSessionCamera(), 'The real viewport must mount');
  };
  const run = async (operation: () => Promise<boolean>, message: string) => {
    await settle();
    check(await operation(), message);
    await settle();
  };
  const unmount = () => { root?.unmount(); root = undefined; };
  const pose = () => JSON.stringify(getSessionCamera()!.getSnapshot());
  const look = (direction: [number, number, number]) => { getSessionCamera()!.snapToDirection(direction, 0); return pose(); };
  const documentA = freshDocument();
  useAppStore.setState({document: documentA, solidScene: scene, dirty: false, activeProjectTabId: 'tab-a',
    activeTab: 'solid', mode: 'solid', solidBusy: false, projectBusy: false, historyEdit: null, activeSketch: null,
    projectTabs: [{id: 'tab-a', name: documentA.name, fileName: null, dirty: false, workspaceTab: 'solid'}]});
  try {
    await mount();
    const poseA = look([0, 0, 1]);
    await run(createProjectTab, 'A new tab must open');
    const tabB = useAppStore.getState().activeProjectTabId!;
    check(tabB !== 'tab-a', 'The new tab must become active');
    const homePose = pose();
    check(homePose !== poseA, 'A new document must not inherit the previous tab camera');
    const poseB = look([1, 0, 0]);
    check(poseB !== homePose, 'The new tab must accept its own navigation');
    await run(() => switchProjectTab('tab-a'), 'Switching back must succeed');
    check(useAppStore.getState().document === documentA, 'Switching back must restore the first document');
    check(pose() === poseA, 'Returning to a tab restores the camera it was last viewed with');
    await run(() => switchProjectTab(tabB), 'Switching forward must succeed');
    check(pose() === poseB, 'Each tab keeps its own camera instead of sharing one viewport pose');

    // Drawings unmounts the 3D viewport. A tab activated meanwhile poses on
    // the next mount, and the outgoing tab still keeps its last pose.
    useAppStore.setState({activeTab: 'drawing'}); unmount();
    await run(() => switchProjectTab('tab-a'), 'Switching while unmounted must succeed');
    check(useAppStore.getState().activeTab === 'solid', 'A modeling tab reopens in its modeling stage');
    await mount();
    check(pose() === poseA, 'A tab activated while the viewport was unmounted frames its camera on mount');
    unmount(); await mount();
    check(pose() === poseA, 'A theme remount must not replay the consumed tab framing');
    const manual = look([0, 1, 0]);
    await run(() => switchProjectTab(tabB), 'Switching forward again must succeed');
    check(pose() === poseB, 'The pose captured while unmounted still belongs to its tab');
    await run(() => closeProjectTab(tabB), 'Closing the active tab must succeed');
    check(useAppStore.getState().activeProjectTabId === 'tab-a', 'Closing shows the neighbouring tab');
    check(pose() === manual, 'The neighbouring tab returns with its own latest camera');
    return {newTabHome: true, roundTrip: true, unmountedSwitch: true, themeRemount: true, closeRestoresNeighbour: true};
  } finally {
    unmount(); container.remove();
    useAppStore.setState(initial);
    if (previousNative === undefined) delete w.__TAURI_INTERNALS__; else w.__TAURI_INTERNALS__ = previousNative;
    if (previousEvents === undefined) Reflect.deleteProperty(w, '__TAURI_EVENT_PLUGIN_INTERNALS__'); else w.__TAURI_EVENT_PLUGIN_INTERNALS__ = previousEvents;
  }
}
