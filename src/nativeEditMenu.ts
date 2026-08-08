/** Bridge the macOS application Edit menu into the CAD history controller. */
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  canRedoApplicationHistory,
  canUndoApplicationHistory,
  redoApplicationHistory,
  subscribeApplicationHistory,
  undoApplicationHistory,
} from './engine/controller';
import { useAppStore } from './store/appStore';

type NativeEditCommand = 'undo' | 'redo';

function isMacOS(): boolean {
  return typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
}

export function nativeMacMenuOwnsUndoRedo(): boolean {
  return isTauri() && isMacOS();
}

function activeTextEditor(): HTMLElement | null {
  const active = document.activeElement;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    return active;
  }
  return active instanceof HTMLElement && active.isContentEditable ? active : null;
}

function availability(): { canUndo: boolean; canRedo: boolean } {
  // Keep native text editing available while a field owns focus. AppKit no
  // longer supplies the responder-chain Undo item after we replace it with a
  // CAD command, so the event handler below delegates back to WebKit.
  if (activeTextEditor()) return { canUndo: true, canRedo: true };

  return {
    canUndo: canUndoApplicationHistory(),
    canRedo: canRedoApplicationHistory(),
  };
}

async function run(command: NativeEditCommand): Promise<void> {
  if (activeTextEditor()) {
    document.execCommand(command);
    return;
  }
  if (command === 'undo') await undoApplicationHistory();
  else await redoApplicationHistory();
}

/** Install once at the App boundary. Browser/WASM development keeps using the
 * existing keydown path and never attempts native IPC. */
export function installNativeEditMenu(): () => void {
  if (!nativeMacMenuOwnsUndoRedo()) return () => {};

  let disposed = false;
  let unlisten: UnlistenFn | null = null;
  let lastState = '';
  let syncQueue = Promise.resolve();

  const sync = () => {
    const next = availability();
    const key = `${next.canUndo}:${next.canRedo}`;
    if (key === lastState) return;
    lastState = key;
    syncQueue = syncQueue
      .then(() => invoke<void>('native_edit_menu_set_state', next))
      .catch(() => {
        // Allow a later state change to retry after startup or teardown races.
        lastState = '';
      });
  };
  const syncAfterFocusChange = () => queueMicrotask(sync);

  const unsubscribeStore = useAppStore.subscribe(sync);
  const unsubscribeHistory = subscribeApplicationHistory(sync);
  window.addEventListener('focusin', sync);
  window.addEventListener('focusout', syncAfterFocusChange);
  void listen<NativeEditCommand>('native-edit-command', (event) => {
    if (event.payload === 'undo' || event.payload === 'redo') {
      void run(event.payload);
    }
  }).then((stop) => {
    if (disposed) stop();
    else unlisten = stop;
  }).catch(() => {});
  sync();

  return () => {
    disposed = true;
    unsubscribeStore();
    unsubscribeHistory();
    window.removeEventListener('focusin', sync);
    window.removeEventListener('focusout', syncAfterFocusChange);
    unlisten?.();
  };
}
