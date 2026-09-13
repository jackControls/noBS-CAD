import {createRoot} from 'react-dom/client';
import {AppearanceDialog} from './AppearanceDialog';
import {listenForModelKeys} from '../modelKeyboard';
import {useAppStore} from '../store/appStore';
import {installNativeEditMenu, runNativeEditCommand} from '../nativeEditMenu';
import type {SketchDto} from '../engine/types';

/** Production settings and keyboard router, with only native build-info IPC replaced. */
export function mountSettingsContract() {
  Object.assign(window, {__TAURI_INTERNALS__: {invoke(command: string) {
    if (command !== 'native_build_info') throw new Error(`Unexpected Settings IPC: ${command}`);
    return Promise.resolve({version: '0.1.0', channel: 'preview', revision: '0123456789abcdef0123456789abcdef01234567ab', modified: true});
  }}});
  useAppStore.setState({settingsOpen: false});
  let modelEscapes = 0;
  // Register before the modal, just as an already-running CAD viewport does.
  const dispose = listenForModelKeys(event => {
    if (event.key === 'Escape') modelEscapes++;
  }, true);
  const container = document.createElement('div');
  document.body.replaceChildren(container);
  const root = createRoot(container);
  root.render(<>
    <button onClick={() => useAppStore.getState().setSettingsOpen(true)}>Settings opener</button>
    <button aria-label="Newer focus">Outside</button>
    <AppearanceDialog />
  </>);
  return {
    modelEscapes: () => modelEscapes,
    checkNativeHistory: checkNativeSettingsHistory,
    unmount: () => {root.unmount(); dispose();},
  };
}

/** Exercise the real native-menu bridge and history controller with Settings
 * mounted. Only OS IPC/event delivery and WebKit's text editing are replaced. */
async function checkNativeSettingsHistory() {
  const check = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };
  const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
  const initial = useAppStore.getState();
  const dialog = document.querySelector<HTMLElement>('[data-settings-dialog]')!;
  const button = dialog?.querySelector<HTMLButtonElement>('button')!;
  check(initial.settingsOpen && button === document.activeElement, 'Settings must own real button focus');
  const w = window as typeof window & {__TAURI_INTERNALS__?: unknown; __TAURI_EVENT_PLUGIN_INTERNALS__?: unknown; isTauri?: boolean};
  const originalNative = w.__TAURI_INTERNALS__;
  const originalEvents = w.__TAURI_EVENT_PLUGIN_INTERNALS__;
  const originalIsTauri = w.isTauri;
  const originalPlatform = Object.getOwnPropertyDescriptor(navigator, 'platform');
  const originalExec = document.execCommand;
  const nativeCommands: string[] = [], textCommands: string[] = [];
  const menuStates: Array<{canUndo: boolean; canRedo: boolean}> = [];
  let callback: ((event: {payload: 'undo' | 'redo'}) => void) | undefined;
  const editor = document.createElement('textarea');
  const sketch: SketchDto = {
    name: 'History', plane: {type: 'origin_plane', plane: 'xy'},
    basis: {origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], normal: [0, 0, 1]},
    entities: [], constraints: [], reference_midpoints: [], dimensions: [], dimension_style: 'aligned',
    dof: {value: 0, fully_defined: true}, can_undo: true, can_redo: true,
  };
  let dispose = () => {};
  try {
    Object.defineProperty(navigator, 'platform', {configurable: true, value: 'MacIntel'});
    w.isTauri = true;
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = {unregisterListener: () => undefined};
    w.__TAURI_INTERNALS__ = {
      transformCallback: (handler: typeof callback) => {callback = handler; return 1;},
      async invoke(command: string, args: {canUndo: boolean; canRedo: boolean}) {
        if (command === 'native_edit_menu_set_state') {menuStates.push(args); return;}
        if (command.startsWith('plugin:event|')) return 1;
        nativeCommands.push(command);
        check(command === 'engine_undo' || command === 'engine_redo', `Unexpected native history IPC: ${command}`);
        return JSON.stringify({ok: true, value: {sketch: {...sketch, name: command}}});
      },
    };
    document.execCommand = command => {textCommands.push(command); return true;};
    useAppStore.setState({mode: 'sketch', projectBusy: false, solidBusy: false, activeSketch: sketch});
    dispose = installNativeEditMenu();
    await settle();
    check(callback && menuStates.length, 'Actual macOS menu bridge must be installed');
    const latest = () => menuStates[menuStates.length - 1];
    const enabled = () => latest()?.canUndo && latest()?.canRedo;
    check(!latest()?.canUndo && !latest()?.canRedo, 'Settings buttons must disable native CAD Undo and Redo');
    for (const command of ['undo', 'redo'] as const) {
      callback!({payload: command}); // Includes delivery of an already queued menu event.
      await runNativeEditCommand(command);
    }
    await settle();
    check(nativeCommands.length === 0 && textCommands.length === 0 && useAppStore.getState().activeSketch === sketch,
      'Native history must not mutate the model behind Settings');

    dialog.append(editor); editor.focus();
    await settle();
    check(enabled(), 'A focused Settings text editor must retain native text history');
    callback!({payload: 'undo'}); callback!({payload: 'redo'});
    await settle();
    check(textCommands.join(',') === 'undo,redo' && nativeCommands.length === 0, 'Native events must route text Undo/Redo only to WebKit');
    editor.remove(); button.focus();
    await settle();
    check(!latest()?.canUndo && !latest()?.canRedo, 'Returning to a Settings button must disable model history again');

    button.click();
    await new Promise(requestAnimationFrame);
    await settle();
    check(!useAppStore.getState().settingsOpen && enabled(), 'Closing Settings must restore native CAD history availability');
    for (const command of ['undo', 'redo'] as const) {
      await runNativeEditCommand(command);
      check(useAppStore.getState().activeSketch?.name === `engine_${command}`, `CAD ${command} must work after Settings closes`);
    }
    check(nativeCommands.join(',') === 'engine_undo,engine_redo', 'Only post-modal history may reach the CAD engine');
    return {nativeCommands, textCommands, disabledInSettings: true};
  } finally {
    dispose(); await settle();
    editor.remove();
    document.execCommand = originalExec;
    if (originalPlatform) Object.defineProperty(navigator, 'platform', originalPlatform);
    else Reflect.deleteProperty(navigator, 'platform');
    w.__TAURI_INTERNALS__ = originalNative;
    if (originalIsTauri === undefined) Reflect.deleteProperty(w, 'isTauri'); else w.isTauri = originalIsTauri;
    if (originalEvents === undefined) Reflect.deleteProperty(w, '__TAURI_EVENT_PLUGIN_INTERNALS__');
    else w.__TAURI_EVENT_PLUGIN_INTERNALS__ = originalEvents;
    useAppStore.setState(initial);
    await new Promise(requestAnimationFrame);
  }
}
