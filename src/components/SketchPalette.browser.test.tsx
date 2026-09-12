import {createRoot} from 'react-dom/client';
import {SketchPalette} from './SketchPalette';
import {useAppStore} from '../store/appStore';
import {I18nProvider} from '../i18n';
import {applicationFileShortcut, isTextEditingTarget, listenForModelKeys} from '../modelKeyboard';
import {runNativeEditCommand} from '../nativeEditMenu';
import type {SketchDto} from '../engine/types';

/** Real palette and document preferences; no replacement controls. */
export function mountSketchPaletteContract() {
  const initial = useAppStore.getState();
  const container = document.createElement('div');
  document.body.replaceChildren(container);
  useAppStore.getState().setPaletteOption('sketchGrid', true);
  const root = createRoot(container);
  root.render(<I18nProvider><div data-mcp-surface="sketch-palette"><SketchPalette /></div></I18nProvider>);
  const fileCommands: string[] = [];
  const stopKeys = listenForModelKeys(event => {
    const command = applicationFileShortcut(event);
    if (command) {
      event.preventDefault();
      fileCommands.push(command);
    }
  });
  return {
    grid: () => useAppStore.getState().palette.sketchGrid,
    fileCommands: () => [...fileCommands],
    checkNativeHistory: checkNativeHistoryFromPalette,
    unmount: () => { stopKeys(); root.unmount(); useAppStore.setState(initial); },
  };
}

/** Keep the actual focus, history controller and Tauri adapter; replace only
 * the native IPC and browser text-editing boundaries. */
async function checkNativeHistoryFromPalette() {
  const check = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };
  check(document.activeElement instanceof HTMLInputElement && document.activeElement.type === 'checkbox',
    'Native history check must start on the real focused palette checkbox');
  const initial = useAppStore.getState();
  const w = window as typeof window & { __TAURI_INTERNALS__?: {
    invoke: (command: string) => Promise<unknown>;
  } };
  const originalNative = w.__TAURI_INTERNALS__;
  const originalExec = document.execCommand;
  const nativeCommands: string[] = [], textCommands: string[] = [];
  const fields = document.createElement('div');
  document.body.append(fields);
  const sketch: SketchDto = {
    name: 'History', plane: {type: 'origin_plane', plane: 'xy'},
    basis: {origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], normal: [0, 0, 1]},
    entities: [], constraints: [], reference_midpoints: [], dimensions: [], dimension_style: 'aligned',
    dof: {value: 0, fully_defined: true}, can_undo: true, can_redo: true,
  };
  try {
    w.__TAURI_INTERNALS__ = {async invoke(command) {
      nativeCommands.push(command);
      check(command === 'engine_undo' || command === 'engine_redo', `Unexpected native call ${command}`);
      return JSON.stringify({ok: true, value: {sketch: {...sketch, name: command}}});
    }};
    document.execCommand = command => { textCommands.push(command); return true; };
    useAppStore.setState({mode: 'sketch', projectBusy: false, solidBusy: false, activeSketch: sketch});
    for (const command of ['undo', 'redo'] as const) {
      await runNativeEditCommand(command);
      check(useAppStore.getState().activeSketch?.name === `engine_${command}`,
        `Focused palette must complete CAD ${command} through the real history controller`);
    }
    check(textCommands.length === 0, 'Focused checkbox must not consume CAD history as text edits');

    const editableTypes = ['text', 'search', 'email', 'url', 'tel', 'password', 'number',
      'date', 'datetime-local', 'month', 'week', 'time', 'color', 'range', 'file'];
    for (const type of [...editableTypes, 'checkbox', 'radio', 'button', 'submit', 'reset', 'image']) {
      const input = document.createElement('input');
      input.type = type;
      check(isTextEditingTarget(input) === editableTypes.includes(type), `Input editing changed for ${type}`);
    }
    const editors: HTMLElement[] = ['text', 'number', 'date'].map(type => {
      const input = document.createElement('input'); input.type = type; return input;
    });
    editors.push(document.createElement('textarea'));
    const editable = document.createElement('div'); editable.contentEditable = 'true';
    editors.push(editable);
    for (const editor of editors) {
      fields.append(editor); editor.focus();
      check(document.activeElement === editor, 'Text editing check must own actual focus');
      check(isTextEditingTarget(editor), 'Text editor must retain its editing route');
      for (const command of ['undo', 'redo'] as const) await runNativeEditCommand(command);
    }
    check(nativeCommands.join(',') === 'engine_undo,engine_redo', 'Text Undo/Redo must not change CAD history');
    check(textCommands.join(',') === Array(editors.length).fill('undo,redo').join(','),
      'Editable fields must retain native text Undo/Redo');
    return {nativeCommands, textEditors: editors.length, inputTypes: editableTypes.length + 6};
  } finally {
    fields.remove();
    document.execCommand = originalExec;
    if (originalNative) w.__TAURI_INTERNALS__ = originalNative;
    else delete w.__TAURI_INTERNALS__;
    useAppStore.setState(initial);
  }
}
