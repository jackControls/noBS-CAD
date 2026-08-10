/**
 * Read-only MCP snapshot bridge publisher (Jack §3 model 1).
 *
 * Writes `<NBCAD_SESSION_DIR>/<uuid>/{model.json,focus.json,heartbeat.json}`
 * via Tauri. Not a live UI co-link — MCP never writebacks these files.
 */
import { invoke } from '@tauri-apps/api/core';
import { getEngine } from './engine';
import {
  exportProjectModelWithVisibility,
  useAppStore,
  type AppMode,
  type SketchTool,
} from './store/appStore';

export type McpFocusPack =
  | 'document'
  | 'sketch'
  | 'solid'
  | 'modify'
  | 'body_ops'
  | 'datums'
  | 'history'
  | 'inspect'
  | 'print';

/** Keep in sync with mcp-server/src/disclosure.rs focus packs. */
export function focusFromUi(
  mode: AppMode,
  activeTool: SketchTool,
  solidDialog: string | null,
): McpFocusPack {
  if (solidDialog) {
    switch (solidDialog) {
      case 'fillet':
      case 'chamfer':
      case 'hole':
        return 'modify';
      case 'shell':
      case 'mirror':
      case 'rectangular_pattern':
      case 'circular_pattern':
      case 'combine':
      case 'split_body':
        return 'body_ops';
      case 'construction_plane':
        return 'datums';
      case 'extrude':
      case 'revolve':
      case 'sweep':
      case 'loft':
      case 'rib':
        return 'solid';
      default:
        return 'solid';
    }
  }
  if (mode === 'sketch') return 'sketch';
  if (mode === 'pickPlane') return 'datums';
  if (mode === 'solid') return 'solid';
  if (activeTool) return 'sketch';
  return 'document';
}

function activeSolidDialog(state: ReturnType<typeof useAppStore.getState>): string | null {
  if (state.filletDialogFeature !== null) return 'fillet';
  if (state.chamferDialogFeature !== null) return 'chamfer';
  if (state.holeDialogFeature !== null) return 'hole';
  if (state.extrudeDialogFeature !== null) return 'extrude';
  if (state.revolveDialogFeature !== null) return 'revolve';
  if (state.sweepDialogFeature !== null) return 'sweep';
  if (state.loftDialogFeature !== null) return 'loft';
  if (state.ribDialogFeature !== null) return 'rib';
  if (state.constructionPlaneDialog) return 'construction_plane';
  if (state.bodyFeatureDialog) return state.bodyFeatureDialog.kind;
  return null;
}

let publishTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let started = false;

interface PublishReservation {
  session_id: string;
  generation: number;
}

async function publishNow(): Promise<void> {
  const state = useAppStore.getState();
  if (state.engineKind !== 'tauri') return;
  const focus = focusFromUi(state.mode, state.activeTool, activeSolidDialog(state));
  try {
    // Reserve before export so a slower older export cannot overwrite a newer one.
    // Tauri owns this counter across WebView reloads and scopes it per window.
    const reservation = await invoke<PublishReservation>('mcp_session_bridge_reserve');
    const engine = await getEngine();
    const model = await exportProjectModelWithVisibility(engine);
    const modelJson = typeof model === 'string' ? model : JSON.stringify(model);
    await invoke('mcp_session_bridge_write', {
      payload: JSON.stringify({
        focus,
        model_json: modelJson,
        generation: reservation.generation,
      }),
    });
  } catch (error) {
    console.debug('[sessionBridge] publish failed', error);
  }
}

/** Lightweight keep-alive — does not re-export the model or bump generation. */
async function heartbeatNow(): Promise<void> {
  const state = useAppStore.getState();
  if (state.engineKind !== 'tauri') return;
  try {
    await invoke('mcp_session_bridge_heartbeat');
  } catch (error) {
    console.debug('[sessionBridge] heartbeat failed', error);
  }
}

export function scheduleSessionBridgePublish(): void {
  if (publishTimer) clearTimeout(publishTimer);
  publishTimer = setTimeout(() => {
    publishTimer = null;
    void publishNow();
  }, 300);
}

export function startSessionBridge(): void {
  if (started) return;
  started = true;
  useAppStore.subscribe((state, prev) => {
    if (
      state.document !== prev.document ||
      state.solidScene !== prev.solidScene ||
      state.mode !== prev.mode ||
      state.activeTool !== prev.activeTool ||
      activeSolidDialog(state) !== activeSolidDialog(prev)
    ) {
      scheduleSessionBridgePublish();
    }
  });
  scheduleSessionBridgePublish();
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    void heartbeatNow();
  }, 10_000);
}
