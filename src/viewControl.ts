import type { CameraFocus, CameraSnapshot, ViewportCameraApi } from './components/viewport/cameraApi';
import { presentation } from './operationPlayback';

export interface ViewRequest extends CameraFocus {
  view: string;
  fit: boolean;
  expires_ms: number;
  duration_ms?: number;
  /** Signed rotation about the current target/up axis, after optional framing. */
  orbit_degrees?: number;
}
export interface ViewState {
  document: unknown;
  activeProjectTabId: string | null;
  activeTab: string;
  mode: string;
  activeSketch: unknown;
  solidBusy: boolean;
  projectBusy: boolean;
}
export interface ViewControl {
  state(): ViewState;
  camera(): ViewportCameraApi | null;
  leaveDrawingWorkspace(): void;
  /** Document, workspace, camera mount/unmount and animation-completion events. */
  subscribe(changed: () => void): () => void;
  now?(): number;
  schedule?(expired: () => void, delayMs: number): () => void;
}
const directions: Record<string, [number, number, number]> = {
  front: [0, -1, 0], back: [0, 1, 0], left: [-1, 0, 0], right: [1, 0, 0],
  top: [0, 0, 1], bottom: [0, 0, -1],
};

/** A view request owns one document through workspace mounting and animation.
 * Only the Drawings workspace is left: navigation inside an active sketch must
 * neither finish that sketch nor switch its editing mode. */
export async function applyView(
  request: ViewRequest,
  owner: Pick<ViewState, 'document' | 'activeProjectTabId'>,
  control: ViewControl,
): Promise<CameraSnapshot> {
  const direction = request.view === 'isometric' ? 'isometric'
    : Object.prototype.hasOwnProperty.call(directions, request.view) ? directions[request.view] : undefined;
  if (request.view !== 'current' && !direction) throw new Error('Unknown view');
  if (typeof request.fit !== 'boolean') throw new Error('View fit must be a boolean');
  if (!Number.isSafeInteger(request.expires_ms) || request.expires_ms < 0) throw new Error('Invalid view expiry');
  const duration = request.duration_ms ?? 300;
  if (!Number.isSafeInteger(duration) || duration < 0 || duration > 10_000) throw new Error('Invalid view duration');
  if (request.orbit_degrees !== undefined && (!Number.isFinite(request.orbit_degrees)
    || Math.abs(request.orbit_degrees) > 360 || request.view !== 'current')) {
    throw new Error('Invalid view orbit: use current view and a finite angle from -360 to 360 degrees');
  }
  if (request.target !== undefined && request.target !== 'active_sketch') throw new Error('Unknown view target');
  for (const id of [request.body_id, request.component_id]) {
    if (id !== undefined && (!Number.isSafeInteger(id) || id < 0)) throw new Error('Invalid view geometry ID');
  }
  const targets = [request.target, request.body_id, request.component_id].filter(value => value !== undefined).length;
  if (targets > 1) throw new Error('Choose one view target');
  const now = control.now ?? Date.now;
  const schedule = control.schedule ?? ((expired, delay) => {
    const timer = setTimeout(expired, delay);
    return () => clearTimeout(timer);
  });
  const sketch = control.state().activeSketch;
  function assertCurrent() {
    const state = control.state();
    if (state.document !== owner.document || state.activeProjectTabId !== owner.activeProjectTabId
      || state.solidBusy || state.projectBusy) throw new Error('Document changed or is transitioning');
    if (now() >= request.expires_ms) throw new Error('View request expired');
    if (request.target === 'active_sketch' && (!sketch || state.activeSketch !== sketch || state.mode !== 'sketch')) {
      throw new Error('No unchanged active sketch to frame');
    }
  }
  assertCurrent();
  if (control.state().activeTab === 'drawing') {
    if (control.state().mode !== 'solid') throw new Error('Drawing workspace has an active sketch');
    control.leaveDrawingWorkspace();
  }
  function assertViewportWorkspace() {
    assertCurrent();
    if (control.state().activeTab === 'drawing') throw new Error('Viewport workspace changed');
  }
  function waitUntil<T>(ready: () => T | undefined): Promise<T> {
    return new Promise((resolve, reject) => {
      let unsubscribe = () => {};
      let cancelDeadline = () => {};
      let settled = false;
      const check = () => {
        if (settled) return;
        try {
          assertViewportWorkspace();
          const result = ready();
          if (result === undefined) return;
          settled = true;
          unsubscribe();
          cancelDeadline();
          resolve(result);
        } catch (error) {
          settled = true;
          unsubscribe();
          cancelDeadline();
          reject(error);
        }
      };
      unsubscribe = control.subscribe(check);
      cancelDeadline = schedule(check, Math.max(0, request.expires_ms - now()));
      check();
    });
  }
  // Registration happens after the real viewport has initialized its geometry.
  // Wait for that event, not an assumed React mount delay.
  const api = await waitUntil(() => control.camera() ?? undefined);
  const assertCamera = () => {
    assertViewportWorkspace();
    if (control.camera() !== api) throw new Error('Viewport camera changed');
  };
  assertCamera();
  // Frame and orient in one deliberate motion.
  let animationId: number | undefined;
  if (request.orbit_degrees !== undefined) {
    // Establish the requested framing before rotating at a constant radius.
    if (targets || request.fit) api.focus(request, 0);
    animationId = api.orbit(request.orbit_degrees, duration);
  } else if (targets || request.fit) animationId = api.focus(request, duration, direction);
  else if (request.view === 'isometric') animationId = api.home(duration);
  else if (direction && direction !== 'isometric') animationId = api.snapToDirection(direction, duration);
  const animationCompleted = () => {
    // A current-view read requests no motion and can inspect a manually moved
    // camera even if an earlier, unrelated animation was cancelled.
    if (animationId === undefined) return true;
    const current = api.getAnimationState();
    if (current.id !== animationId) throw new Error('Camera animation was replaced');
    if (current.status === 'cancelled') throw new Error('Camera animation was cancelled');
    return current.status === 'completed' ? true : undefined;
  };
  await waitUntil(() => {
    assertCamera();
    return animationCompleted();
  });
  assertCamera();
  animationCompleted();
  presentation.applied(request.orbit_degrees === undefined ? `Camera: ${request.view}` : `Camera: orbit ${request.orbit_degrees}°`);
  return api.getSnapshot();
}
