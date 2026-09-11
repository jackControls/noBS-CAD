import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { UnsavedChangesDialog } from '../components/UnsavedChangesDialog';
import { pendingEngineOperations } from '../engine/activity';
import { applyLiveUiControl } from '../liveUiBridge';
import { presentation, setPlaybackPace } from '../operationPlayback';
import { applyInboxNow, publishCurrentSession } from '../sessionBridge';
import { useAppStore } from '../store/appStore';
import { inspectUi } from '../uiControl';
import { createExitController } from './applicationExit';
import { waitForExitEdits } from './exitSettlement';
import { readNbcadArchive } from './nbcad';
import { saveAllUnsavedProjects } from './projectFiles';
import { hasUnsavedProjects, recordActiveProjectOpen } from './projectTabs';
import { projectTransitions } from './projectTransitions';
import { currentUnsavedPrompt, requestUnsavedDecision, resolveUnsavedPrompt } from './unsavedChanges';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
}

/** Exercise Save from the actual quit dialog and MCP control lane. Only native
 * IPC and process termination are replaced; export, archive, save adoption,
 * edit settlement, publication, and inbox ownership run their production code. */
export async function checkSaveOnExitPolling() {
  const check = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };
  const bounded = async <T,>(operation: Promise<T>, label: string): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([operation, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Save-on-exit timed out: ${label}`)), 3000);
      })]);
    } finally { if (timer !== undefined) clearTimeout(timer); }
  };
  const task = () => new Promise<void>(resolve => setTimeout(resolve, 0));
  const initial = useAppStore.getState();
  const w = window as typeof window & { __TAURI_INTERNALS__?: {
    invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
  } };
  const originalNative = w.__TAURI_INTERNALS__;
  const phases = ['visibility', 'guarded capture', 'file write', 'adoption'] as const;
  const results: { phase: string; writes: number; exits: number; inboxPolls: number }[] = [];
  try {
    for (const phase of phases) {
      const entered = deferred(), release = deferred();
      const operations = new Set<Promise<unknown>>();
      const track = <T,>(operation: Promise<T>): Promise<T> => {
        operations.add(operation);
        void operation.then(() => operations.delete(operation), () => operations.delete(operation));
        return operation;
      };
      const doc = { name: 'Saved design', settings: { units: 'mm' as const }, features: [], rollback_index: 0, browser: [] };
      const model = JSON.stringify({ format: 'nbcad-project', schema_version: 6, document: doc, edit: 'unsaved native sketch' });
      const target = { kind: 'native' as const, path: 'C:/saved.nbcad', name: 'saved.nbcad' };
      const writes: Uint8Array[] = [];
      const errors: string[] = [];
      let saveTarget: string | undefined;
      let controlDelivered = false, saving = false, held = false;
      let acknowledgments = 0, inboxPolls = 0, publications = 0, exits = 0;
      const hold = async (at: typeof phase) => {
        if (!saving || held || at !== phase) return;
        held = true; entered.resolve(); await release.promise;
      };
      const ok = (value: unknown) => JSON.stringify({ ok: true, value });
      w.__TAURI_INTERNALS__ = { async invoke(command, args = {}) {
        if (command === 'engine_project_visibility') {
          await hold('visibility'); return ok(initial.projectVisibility);
        }
        if (command === 'engine_project_export_model') {
          if (args.payload) {
            await hold('guarded capture');
            const input = JSON.parse(args.payload as string);
            check(input.expected_model_json === model && input.save_name === doc.name,
              'Save must capture the guarded original native model with its existing name');
          }
          return ok(model);
        }
        if (command === 'engine_document_set_name') {
          await hold('adoption');
          const input = JSON.parse(args.payload as string);
          check(input.expected_model_json === model && input.name === doc.name,
            'Save adoption must retain its native model precondition');
          return ok({ ...doc });
        }
        if (command === 'engine_active_sketch') return ok(null);
        if (command === 'mcp_session_bridge_reserve') {
          return { session_id: 'save-session', project_session_id: 'save-document', generation: 1 };
        }
        if (command === 'mcp_session_bridge_write') {
          const input = JSON.parse(args.payload as string);
          check(input.model_json === model && input.session_id === 'save-session'
            && input.project_session_id === 'save-document', 'Publisher must establish the original inbox owner');
          publications++; return { skipped: false };
        }
        if (command === 'mcp_session_bridge_control') {
          if (args.response) {
            const response = args.response as { status: string };
            check(response.status === 'applied', 'The real MCP Save click must be acknowledged');
            acknowledgments++; return;
          }
          if (controlDelivered) return null;
          controlDelivered = true;
          return { id: 'save-click', session_id: 'save-session', expires_ms: Date.now() + 3000,
            ui: { action: 'click', target: saveTarget } };
        }
        if (command === 'mcp_session_bridge_apply_inbox') {
          check(args.sessionId === 'save-session' && args.documentId === 'save-document',
            'Poll must use the successfully published owner');
          inboxPolls++; return { applied: false };
        }
        if (command === 'write_binary_file_atomic') {
          await hold('file write');
          check(args.path === target.path, 'Save must keep the existing file destination');
          writes.push(new Uint8Array(args.bytes as number[])); return;
        }
        throw new Error(`Unexpected Save-on-exit IPC: ${command}`);
      } };
      const mount = document.createElement('div'); document.body.append(mount);
      const ui = createRoot(mount);
      const controller = createExitController({ dirty: hasUnsavedProjects, settle: waitForExitEdits,
        decide: () => requestUnsavedDecision('quit'), save: saveAllUnsavedProjects,
        exit: async () => { exits++; }, error: error => { errors.push(String(error)); } });
      try {
        const setup = projectTransitions.begin();
        useAppStore.setState({ ...initial, document: doc, engineKind: 'tauri', dirty: true,
          solidBusy: false, projectBusy: false, activeSketch: null, historyEdit: null,
          activeProjectTabId: 'save-document', projectTabs: [{ id: 'save-document', name: doc.name,
            fileName: target.name, dirty: true, workspaceTab: 'solid' }] });
        presentation.documentChanged(); setup(true, true);
        presentation.control({ command: 'configure', mode: 'fast' }); setPlaybackPace(0);
        await recordActiveProjectOpen(model, target);
        check(await publishCurrentSession(), 'Save fixture must first publish its real inbox owner');
        check(publications === 1, 'Initial session publication must complete before quit');
        ui.render(createElement(UnsavedChangesDialog));
        const quitting = track(controller.request());
        await bounded((async () => {
          while (!currentUnsavedPrompt() || !mount.querySelector('[role="alertdialog"]')) await task();
        })(), `${phase}: unsaved dialog`);
        saveTarget = inspectUi(useAppStore.getState().document).surfaces.flatMap(surface => surface.controls)
          .find(control => control.label === 'Save' || control.label === 'file.save')?.id;
        check(saveTarget, 'The actual quit dialog must expose Save to MCP');
        saving = true;
        await bounded(track(applyLiveUiControl(async () => { await publishCurrentSession(); })), `${phase}: Save click`);
        await bounded(entered.promise, `${phase}: native gate`);
        check(acknowledgments === 1 && (pendingEngineOperations() > 0) === (phase !== 'file write'),
          'The Save acknowledgment may finish while the native/file save is still in progress');
        const poll = track(applyInboxNow());
        if (phase === 'file write') {
          // Save releases its read lease while writing already captured bytes.
          // An empty poll here is legal and must not invalidate later adoption.
          await bounded(poll, 'empty poll between Save leases');
          check(inboxPolls === 1, 'An idle inbox poll must still run between Save leases');
        } else {
          await task();
          check(inboxPolls === 0, 'Background polling must not enter native while Save owns a snapshot');
        }
        release.resolve();
        await bounded(Promise.all([quitting, poll]), `${phase}: Save and poll completion`);
        check(errors.length === 0, `${phase}: Save must not fail from an empty background poll: ${errors.join('; ')}`);
        check(writes.length === 1 && exits === 1 && !hasUnsavedProjects(),
          `${phase}: Save must write, mark all tabs clean, and finish quit exactly once`);
        check(readNbcadArchive(writes[0]).modelJson.trim() === model,
          `${phase}: the written archive must retain the unsaved native model exactly`);
        check(inboxPolls === (phase === 'file write' ? 1 : 0),
          'A skipped background poll must not remain queued behind Save');
        await bounded(track(applyInboxNow()), `${phase}: following poll`);
        check(inboxPolls === (phase === 'file write' ? 2 : 1),
          'The next ordinary poll must resume after Save releases its lease');
        check(pendingEngineOperations() === 0, 'Save and publication must drain tracked native work');
        results.push({ phase, writes: writes.length, exits, inboxPolls });
      } finally {
        controller.dispose(); release.resolve();
        if (currentUnsavedPrompt()) resolveUnsavedPrompt('cancel');
        await bounded(Promise.allSettled(operations), `${phase}: cleanup`);
        ui.unmount(); mount.remove();
      }
    }
    return results;
  } finally {
    w.__TAURI_INTERNALS__ = originalNative;
    useAppStore.setState(initial);
  }
}
