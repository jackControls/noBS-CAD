/** Document history uses the same controller as Ctrl/Cmd-Z and the Edit menu. */
import { canUndoApplicationHistory, canRedoApplicationHistory, undoApplicationHistory, redoApplicationHistory } from './engine/controller';
import { useAppStore } from './store/appStore';
import { visible } from './uiControl';

export function inspectUiHistory() {
  const blocked = useAppStore.getState().settingsOpen
    || [...document.querySelectorAll<HTMLElement>('[aria-modal="true"],.feature-dialog')].some(visible);
  return { can_undo: !blocked && canUndoApplicationHistory(), can_redo: !blocked && canRedoApplicationHistory() };
}

export async function operateUiHistory(command?: string): Promise<void> {
  if (command !== 'undo' && command !== 'redo') throw new Error('history requires command undo or redo');
  const available = inspectUiHistory();
  if (!(command === 'undo' ? available.can_undo : available.can_redo)) throw new Error(`Document ${command} is unavailable in the current state`);
  const completed = command === 'undo' ? await undoApplicationHistory() : await redoApplicationHistory();
  if (!completed) throw new Error(useAppStore.getState().constraintDialog?.message ?? `Document ${command} did not complete`);
}
