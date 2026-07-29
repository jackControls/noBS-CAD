/**
 * File-bridge co-link publisher for MCP attach.
 * Writes session_dir/<document_id>/{model.json,focus.json}.
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

function safeSessionId(name: string): string {
  const trimmed = name.trim() || 'untitled';
  return trimmed.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 64);
}

let publishTimer: ReturnType<typeof setTimeout> | null = null;
let started = false;

async function publishNow(): Promise<void> {
  const state = useAppStore.getState();
  if (state.engineKind !== 'tauri') return;
  const sessionId = safeSessionId(state.document?.name ?? 'untitled');
  const focus = focusFromUi(state.mode, state.activeTool, activeSolidDialog(state));
  try {
    const engine = await getEngine();
    const model = await engine.exportProjectModel();
    const modelJson = typeof model === 'string' ? model : JSON.stringify(model);
    await invoke<string>('mcp_session_bridge_write', {
      payload: JSON.stringify({
        session_id: sessionId,
        focus,
        model_json: modelJson,
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
    void publishNow();
  }, 300);
}

export function startSessionBridge(): void {
  if (started) return;
  started = true;
  useAppStore.subscribe((state, prev) => {
    const geometryChanged =
      state.document !== prev.document || state.solidScene !== prev.solidScene;
    if (
      geometryChanged ||
      state.mode !== prev.mode ||
      state.activeTool !== prev.activeTool ||
      state.document?.name !== prev.document?.name ||
      activeSolidDialog(state) !== activeSolidDialog(prev)
    ) {
      scheduleSessionBridgePublish();
    }
  });
  scheduleSessionBridgePublish();
}
