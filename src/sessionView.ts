import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from './store/appStore';
import { getSessionCamera } from './components/viewport/cameraApi';

export const viewDirections: Record<string, [number, number, number]> = {
  front: [0, -1, 0], back: [0, 1, 0], left: [-1, 0, 0], right: [1, 0, 0],
  top: [0, 0, 1], bottom: [0, 0, -1],
};
let applying = false;
interface ViewRequest { id: string; session_id: string; view: string; fit: boolean; expires_ms: number }

/** Called by the existing UI heartbeat loop; never changes the model revision. */
export async function applySessionView(): Promise<void> {
  if (applying || useAppStore.getState().engineKind !== 'tauri') return;
  applying = true;
  try {
    const document = useAppStore.getState().document;
    const request = await invoke<ViewRequest | null>('mcp_session_bridge_view');
    if (!request) return;
    const response: Record<string, unknown> = { request_id: request.id, session_id: request.session_id };
    try {
      if (document !== useAppStore.getState().document || request.expires_ms < Date.now()) {
        throw new Error('Document changed or view request expired');
      }
      const api = getSessionCamera();
      if (!api) throw new Error('Viewport camera is not ready');
      const waitForCamera = async () => {
        while (api.isAnimating()) {
          if (Date.now() >= request.expires_ms) throw new Error('Camera animation did not complete before the request expired');
          if (document !== useAppStore.getState().document || getSessionCamera() !== api) throw new Error('Document or viewport changed');
          await new Promise(resolve => setTimeout(resolve, 25));
        }
      };
      if (request.view === 'isometric') api.home();
      else if (viewDirections[request.view]) api.snapToDirection(viewDirections[request.view]);
      else if (request.view !== 'current') throw new Error('Unknown view');
      await waitForCamera();
      if (document !== useAppStore.getState().document) throw new Error('Document changed');
      if (request.fit) {
        api.fit();
        await waitForCamera();
      }
      if (document !== useAppStore.getState().document) throw new Error('Document changed');
      response.status = 'applied';
      response.camera = api.getSnapshot();
    } catch (error) {
      response.status = 'failed';
      response.error = String(error);
    }
    await invoke('mcp_session_bridge_view', { response });
  } catch (error) {
    console.debug('[sessionBridge] view request failed', error);
  } finally { applying = false; }
}
