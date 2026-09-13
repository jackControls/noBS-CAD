/** Built-in IDs enter the same source editor as a manual example selection. */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { isTauriRuntime } from '../engine';
import { currentUnsavedPrompt } from '../files/unsavedChanges';
import { ensureScriptExamples, errorMessage, showScriptExample, showScripts, useScriptWorkspace } from './workspace';

const pending: string[] = [];
let draining = false;
let watching = false;

async function drain(): Promise<void> {
  if (draining || currentUnsavedPrompt()) return;
  const state = useScriptWorkspace.getState();
  if (state.loading || state.running) return;
  draining = true;
  try {
    while (pending.length) {
      const state = useScriptWorkspace.getState();
      if (state.loading || state.running || currentUnsavedPrompt()) return;
      const recipe = pending[0];
      const examples = await ensureScriptExamples();
      const current = useScriptWorkspace.getState();
      if (current.loading || current.running || currentUnsavedPrompt()) return;
      pending.shift();
      const example = examples.find(example => example.id === recipe);
      if (!example) throw new Error(`This application does not include recipe '${recipe}'. Update noBS CAD and try again.`);
      // Source view performs only metadata validation. Even the isolated short
      // lesson preview waits until the user explicitly selects Overview.
      await showScriptExample(example, 'source');
    }
  } catch (error) {
    useScriptWorkspace.setState({ error: errorMessage(error), open: true });
  } finally { draining = false; }
}

export async function queueRecipeOpen(recipe: string): Promise<{status: 'queued'; recipe: string}> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(recipe) || recipe.length > 80) throw new Error('Expected a built-in recipe ID');
  // A newer installed launcher may find an older running window. Validate the
  // receiving application's catalog before acknowledging delivery, so missing
  // recipes can fall back to the new application instead of being dropped.
  const examples = await ensureScriptExamples();
  if (!examples.some(example => example.id === recipe)) throw new Error(`This application does not include recipe '${recipe}'.`);
  if (!pending.includes(recipe)) {
    if (pending.length >= 16) throw new Error('Finish opening pending recipes before opening another link');
    pending.push(recipe);
  }
  if (!watching) {
    watching = true;
    // Install lazily: the shared live-control and workspace modules refer to
    // each other, and MCP delivery must work even before OS event setup.
    useScriptWorkspace.subscribe(() => { void drain(); });
    window.addEventListener('nbcad:unsaved-prompt-change', () => { void drain(); });
  }
  showScripts();
  void drain();
  return {status: 'queued', recipe};
}

/** Listen before reading durable native requests; acknowledge only once queued. */
export function installRecipeLinks(): () => void {
  if (!isTauriRuntime()) return () => undefined;
  let disposed = false;
  let unlisten: (() => void) | undefined;
  const received = new Set<number>();
  let fetching = false;
  let fetchAgain = false;
  const receive = async () => {
    fetchAgain = true;
    if (fetching || disposed) return;
    fetching = true;
    try {
      do {
        fetchAgain = false;
        const requests = await invoke<Array<{id: number; recipe: string}>>('native_recipe_open_pending');
        if (disposed) return;
        for (const request of requests) {
          if (!received.has(request.id)) {
            await queueRecipeOpen(request.recipe);
            received.add(request.id);
          }
          await invoke('native_recipe_open_ack', { id: request.id });
          received.delete(request.id);
        }
        if (requests.length) {
          // OS focus restrictions cannot revoke already acknowledged delivery.
          await invoke('mcp_window_control', { mode: 'foreground' })
            .catch(error => console.debug('Recipe opened; window focus was unavailable', error));
        }
      } while (fetchAgain && !disposed);
    } catch (error) {
      if (!disposed) useScriptWorkspace.setState({ error: errorMessage(error), open: true });
    } finally { fetching = false; }
  };
  void listen('recipe-open-pending', () => { void receive(); }).then(stop => {
    if (disposed) { stop(); return; }
    unlisten = stop;
    void receive();
  }).catch(error => useScriptWorkspace.setState({ error: errorMessage(error) }));
  return () => {
    disposed = true; unlisten?.();
  };
}
