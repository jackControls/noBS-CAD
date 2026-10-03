import {useAppStore} from './store/appStore';
import {applyLiveUiControl} from './liveUiBridge';
import {inspectNamedViewState} from './namedViews';
import {getSessionCamera, registerSessionCamera, unregisterSessionCamera, type ViewportCameraApi} from './components/viewport/cameraApi';
import type {BodyDto} from './engine/types';

/** Verify capture comes from the owning live viewport, through the MCP control lane. */
export async function checkNamedViewMcpCapture() {
  const check = (condition: unknown, message: string) => {if (!condition) throw new Error(message);};
  const original = useAppStore.getState();
  const previousCamera = getSessionCamera();
  const w = window as typeof window & {__TAURI_INTERNALS__?: {invoke(command: string, args?: Record<string, unknown>): Promise<unknown>}};
  const previousNative = w.__TAURI_INTERNALS__;
  const pose = {position: [30, 40, 50] as [number, number, number], target: [0, 0, 0] as [number, number, number], up: [0, 0, 1] as [number, number, number]};
  const camera = {getSnapshot: () => pose, bounds: () => ({x: 0, y: 0, width: 100, height: 100})} as ViewportCameraApi;
  const responses: Record<string, unknown>[] = [];
  let pending: unknown = {id: 'capture', session_id: 'capture-session', expires_ms: Date.now() + 10000, ui: {action: 'inspect'}};
  w.__TAURI_INTERNALS__ = {async invoke(command, args = {}) {
    check(command === 'mcp_session_bridge_control', 'Capture must only use the control bridge');
    if (args.response) {responses.push(args.response as Record<string, unknown>); return null;}
    const request = pending; pending = null; return request;
  }};
  registerSessionCamera(camera);
  try {
    useAppStore.setState({engineKind: 'tauri', mode: 'solid', solidBusy: false, projectBusy: false,
      solidScene: {bodies: [{id: 1}, {id: 2}] as BodyDto[], errors: []},
      projectVisibility: {hidden_body_ids: [2], hidden_datum_plane_ids: [], hidden_sketch_names: []},
      viewPartOffsets: [{body_id: 1, translation: [0, 20, 0]}], activeNamedView: 'exploded'});
    await applyLiveUiControl(async () => {throw new Error('Capture must not publish a model mutation');});
    check(responses.length === 1 && responses[0].status === 'applied', 'MCP inspect must acknowledge capture');
    const captured = responses[0].view_state as ReturnType<typeof inspectNamedViewState>;
    check(JSON.stringify(captured.camera) === JSON.stringify(pose), 'Capture must return the current camera');
    check(JSON.stringify(captured.visible_body_ids) === '[1]' && captured.active_named_view === 'exploded', 'Capture must use live visibility and active name');
    check(captured.part_offsets[0].translation[1] === 20, 'Capture must include display offsets');
    captured.camera!.position[0] = 999; captured.part_offsets[0].translation[1] = 999;
    check(pose.position[0] === 30 && useAppStore.getState().viewPartOffsets[0].translation[1] === 20, 'MCP capture must not expose mutable UI references');
    unregisterSessionCamera(camera);
    pending = {id: 'no-camera', session_id: 'capture-session', expires_ms: Date.now() + 10000, ui: {action: 'inspect'}};
    await applyLiveUiControl(async () => {throw new Error('Capture must not mutate');});
    check((responses[1].view_state as ReturnType<typeof inspectNamedViewState>).camera === null, 'Unavailable viewport must return explicit null');
    return {liveCapture: 'passed', independentCopies: 'passed', unavailableCamera: 'passed'};
  } finally {
    unregisterSessionCamera(camera);
    if (previousCamera) registerSessionCamera(previousCamera);
    if (previousNative) w.__TAURI_INTERNALS__ = previousNative; else delete w.__TAURI_INTERNALS__;
    useAppStore.setState(original);
  }
}
