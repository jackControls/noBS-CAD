/**
 * Read-only MCP snapshot bridge publisher (Jack §3 model 1).
 *
 * Writes `<NBCAD_SESSION_DIR>/<uuid>/{model.json,focus.json,heartbeat.json}`
 * via Tauri. Not a live UI co-link — MCP never writebacks these files.
 */
import { invoke } from '@tauri-apps/api/core';
import { getEngine } from './engine';
import { useAppStore, type AppMode, type SketchTool } from './store/appStore';

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
let publishGeneration = 0;

async function publishNow(heartbeatOnly = false): Promise<void> {
  const state = useAppStore.getState();
  if (state.engineKind !== 'tauri') return;
  const sessionId = state.mcpSessionId;
  const focus = focusFromUi(state.mode, state.activeTool, activeSolidDialog(state));
  const generation = ++publishGeneration;
  try {
    let modelJson = '{"version":1}';
    if (!heartbeatOnly) {
      const engine = await getEngine();
      const model = await engine.exportProjectModel();
      modelJson = typeof model === 'string' ? model : JSON.stringify(model);
    } else {
      // Heartbeat keeps age fresh; still refresh model so attach stays current.
      try {
        const engine = await getEngine();
        const model = await engine.exportProjectModel();
        modelJson = typeof model === 'string' ? model : JSON.stringify(model);
      } catch {
        // keep placeholder if export fails mid-heartbeat
      }
    }
    await invoke('mcp_session_bridge_write', {
      payload: JSON.stringify({
        session_id: sessionId,
        focus,
        model_json: modelJson,
        generation,
      }),
    });
  } catch (error) {
    console.debug('[sessionBridge] publish failed', error);
  }
}

export function scheduleSessionBridgePublish(): void {
  if (publishTimer) clearTimeout(publishTimer);
  publishTimer = setTimeout(() => {
    publishTimer = null;
    void publishNow(false);
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
    void publishNow(true);
  }, 10_000);
}
