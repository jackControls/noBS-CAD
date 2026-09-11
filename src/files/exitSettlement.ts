import { pendingEngineOperations, subscribeEngineOperations } from '../engine/activity';
import { useAppStore } from '../store/appStore';

/** Native replies release their operation count before adapter/controller
 * continuations publish the result. Check on the next task, after those
 * continuations and any follow-up engine requests, before testing dirty. */
export function waitForExitEdits(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise(resolve => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const busy = () => {
      const state = useAppStore.getState();
      return pendingEngineOperations() > 0 || state.solidBusy || state.projectBusy;
    };
    const finish = () => {
      if (timer !== null) clearTimeout(timer);
      unsubscribeStore(); unsubscribeEngine();
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const changed = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      if (!busy()) timer = setTimeout(() => { timer = null; if (!busy()) finish(); }, 0);
    };
    const unsubscribeStore = useAppStore.subscribe(changed);
    const unsubscribeEngine = subscribeEngineOperations(changed);
    signal.addEventListener('abort', finish, { once: true });
    changed();
  });
}
