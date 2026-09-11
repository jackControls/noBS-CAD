import { applyView, type ViewControl, type ViewRequest, type ViewState } from './viewControl';
import { presentation } from './operationPlayback';
import {
  getSessionCamera, notifySessionCameraChanged, registerSessionCamera, subscribeSessionCamera,
  unregisterSessionCamera, type CameraSnapshot, type ViewportCameraApi,
  orbitCameraSnapshot,
} from './components/viewport/cameraApi';

function same(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(message);
}
async function rejects(promise: Promise<unknown>, expected: RegExp) {
  try { await promise; } catch (error) {
    if (expected.test(String(error))) return;
    throw error;
  }
  throw new Error(`Expected rejection: ${expected}`);
}
function fixture() {
  let time = 100;
  let animating = false;
  let animate = true;
  const timers = new Map<() => void, number>();
  const listeners = new Set<() => void>();
  let subscriptions = 0;
  const state: ViewState = {document: {}, activeProjectTabId: 'one', activeTab: 'drawing',
    mode: 'solid', activeSketch: null, solidBusy: false, projectBusy: false};
  const owner = {document: state.document, activeProjectTabId: state.activeProjectTabId};
  const calls: unknown[] = [];
  const snapshot: CameraSnapshot = {position: [1, -1, 1], target: [0, 0, 0], up: [0, 0, 1]};
  // Only the camera navigation contract is relevant to this lifecycle test.
  const camera = {
    focus(target, duration, direction) { calls.push(['focus', target, duration, direction]); animating = animate; },
    home(duration) { calls.push(['home', duration]); animating = animate; },
    snapToDirection(direction, duration) { calls.push(['direction', direction, duration]); animating = animate; },
    orbit(degrees, duration) { calls.push(['orbit', degrees, duration]); animating = animate; },
    isAnimating() { return animating; },
    getSnapshot() { return snapshot; },
  } satisfies Pick<ViewportCameraApi, 'focus' | 'home' | 'snapToDirection' | 'orbit' | 'isAnimating' | 'getSnapshot'>;
  const api = camera as ViewportCameraApi;
  const changed = () => { for (const listener of [...listeners]) listener(); };
  const control: ViewControl = {
    state: () => state,
    camera: getSessionCamera,
    leaveDrawingWorkspace() { calls.push('leave drawing'); state.activeTab = 'solid'; changed(); },
    subscribe(listener) {
      subscriptions++;
      listeners.add(listener);
      const unsubscribe = subscribeSessionCamera(listener);
      return () => { subscriptions--; listeners.delete(listener); unsubscribe(); };
    },
    now: () => time,
    schedule(callback, delay) {
      timers.set(callback, time + delay);
      return () => { timers.delete(callback); };
    },
  };
  const request: ViewRequest = {view: 'isometric', fit: true, expires_ms: 1000, duration_ms: 650};
  return {state, owner, calls, request, api, control, snapshot,
    run: (override: Partial<ViewRequest> = {}) => applyView({...request, ...override}, owner, control),
    mount() { registerSessionCamera(api); },
    finish() { animating = false; notifySessionCameraChanged(); },
    instant() { animate = false; },
    change(update: Partial<ViewState>) { Object.assign(state, update); changed(); },
    time(value: number) {
      time = value;
      for (const [callback, deadline] of [...timers]) if (deadline <= time) callback();
    },
    clean() {
      same(subscriptions, 0, 'Every completion/error must release state and camera listeners');
      same(timers.size, 0, 'Every completion/error must cancel its deadline timer');
      unregisterSessionCamera(api);
    },
  };
}

async function main() {
  presentation.control({command: 'configure', mode: 'present'});
  presentation.applied('drawing_add_view');
  const drawing = fixture();
  const pending = drawing.run();
  same(drawing.calls, ['leave drawing'], 'Drawings must be left before waiting for the real viewport');
  drawing.mount();
  await Promise.resolve();
  same(drawing.calls, ['leave drawing', ['focus', drawing.request, 650, 'isometric']],
    'A mounted camera must frame and orient in one operation');
  let completed = false;
  void pending.then(() => { completed = true; });
  await Promise.resolve();
  same(completed, false, 'Mount alone cannot acknowledge an unfinished animation');
  same(presentation.snapshot().operation, 'drawing add view', 'An unfinished camera move must not replace completed operation feedback');
  drawing.finish();
  same(await pending, drawing.snapshot, 'Return the actual completed camera pose');
  same(presentation.snapshot().operation, 'Camera: isometric', 'Successful final camera framing replaces earlier drawing operation feedback');
  drawing.clean();

  for (const invalid of [
    {view: '__proto__'}, {duration_ms: -1}, {duration_ms: 10_001}, {body_id: -1},
    {body_id: 2, component_id: 3}, {fit: 'yes' as unknown as boolean}, {expires_ms: NaN},
    {target: 'active_sketch' as const},
    {view: 'current', orbit_degrees: NaN}, {view: 'current', orbit_degrees: Infinity},
    {view: 'current', orbit_degrees: 361}, {view: 'current', orbit_degrees: -361},
    {view: 'current', orbit_degrees: '120' as unknown as number},
    {view: 'isometric', orbit_degrees: 120},
  ]) {
    const invalidRequest = fixture();
    await rejects(invalidRequest.run(invalid), /Unknown view|Invalid view|one view target|boolean|active sketch/);
    same(invalidRequest.calls, [], 'Invalid requests must not change workspace');
    invalidRequest.clean();
  }

  const expired = fixture();
  expired.time(1000);
  await rejects(expired.run(), /expired/);
  same(expired.calls, [], 'Already expired requests must not leave Drawings');
  expired.clean();

  const missing = fixture();
  const missingCamera = missing.run();
  missing.time(1000);
  await rejects(missingCamera, /expired/);
  missing.mount();
  same(missing.calls, ['leave drawing'], 'A late camera mount must not apply an expired request');
  missing.clean();

  for (const replacement of [{document: {}}, {activeProjectTabId: 'two'}, {solidBusy: true}, {projectBusy: true}]) {
    const changed = fixture();
    const obsolete = changed.run();
    changed.change(replacement);
    await rejects(obsolete, /Document changed/);
    changed.mount();
    same(changed.calls, ['leave drawing'], 'Document replacement/transition while mounting must not navigate');
    changed.clean();
  }

  const queued = fixture();
  const queuedView = queued.run();
  queued.mount();
  queued.change({document: {}}); // After mount resolves, before its promise continuation.
  await rejects(queuedView, /Document changed/);
  same(queued.calls, ['leave drawing'], 'Recheck ownership immediately before touching the camera');
  queued.clean();

  const unmounted = fixture();
  const unmountedView = unmounted.run();
  unmounted.mount();
  await Promise.resolve();
  unregisterSessionCamera(unmounted.api);
  await rejects(unmountedView, /camera changed/);
  unmounted.clean();

  const interrupted = fixture();
  const interruptedView = interrupted.run();
  interrupted.mount();
  await Promise.resolve();
  interrupted.change({activeTab: 'drawing'});
  await rejects(interruptedView, /workspace changed/);
  interrupted.clean();

  const slow = fixture();
  const slowView = slow.run();
  slow.mount();
  await Promise.resolve();
  slow.time(1000);
  await rejects(slowView, /expired/);
  slow.clean();

  const late = fixture();
  const lateView = late.run();
  late.mount();
  await Promise.resolve();
  late.finish();
  late.change({document: {}});
  await rejects(lateView, /Document changed/);
  late.clean();

  const sketch = fixture();
  sketch.state.activeTab = 'sketch';
  sketch.state.mode = 'sketch';
  sketch.state.activeSketch = {};
  sketch.instant();
  sketch.mount();
  await sketch.run({view: 'top', target: 'active_sketch'});
  same(sketch.state.mode, 'sketch', 'Camera navigation must retain the active sketch');
  same(sketch.calls, [['focus', {...sketch.request, view: 'top', target: 'active_sketch'}, 650, [0, 0, 1]]],
    'Sketch focus must not use the Drawings exit operation');
  sketch.clean();

  const oriented = fixture();
  oriented.state.activeTab = 'solid';
  oriented.instant();
  oriented.mount();
  await oriented.run({view: 'front', fit: false});
  await oriented.run({view: 'isometric', fit: false});
  await oriented.run({view: 'current', fit: false});
  same(oriented.calls, [['direction', [0, -1, 0], 650], ['home', 650]],
    'Existing orientation, home and current-view semantics must stay intact');
  oriented.clean();

  const orbit = fixture();
  orbit.state.activeTab = 'solid';
  orbit.mount();
  const orbitRequest = {...orbit.request, view: 'current', orbit_degrees: 120, duration_ms: 3000};
  const orbitResult = orbit.run(orbitRequest);
  await Promise.resolve();
  same(orbit.calls, [['focus', orbitRequest, 0, undefined], ['orbit', 120, 3000]],
    'Optional framing happens before one continuous orbit, without interpolating the radius');
  let orbitCompleted = false;
  void orbitResult.then(() => { orbitCompleted = true; });
  await Promise.resolve();
  same(orbitCompleted, false, 'An orbit must not acknowledge before its animation completes');
  orbit.finish();
  same(await orbitResult, orbit.snapshot, 'Orbit returns the completed camera snapshot');
  orbit.clean();

  const orbitWithoutFit = fixture();
  orbitWithoutFit.state.activeTab = 'solid';
  orbitWithoutFit.instant();
  orbitWithoutFit.mount();
  await orbitWithoutFit.run({view: 'current', fit: false, orbit_degrees: -360});
  same(orbitWithoutFit.calls, [['orbit', -360, 650]], 'Existing current framing can orbit without an extra camera move');
  orbitWithoutFit.clean();

  // Geometric properties, not an endpoint-only comparison: a full turn must
  // visibly leave home and preserve radius/elevation at every intermediate pose.
  const start: CameraSnapshot = {position: [12, -4, 19], target: [2, 3, 5], up: [1, 2, 3]};
  const initial = JSON.stringify(start);
  const offset = (pose: CameraSnapshot) => pose.position.map((value, index) => value - pose.target[index]);
  const radius = Math.hypot(...offset(start));
  const height = (pose: CameraSnapshot) => offset(pose).reduce((sum, value, index) => sum + value * start.up[index], 0);
  const near = (actual: number, expected: number, message: string) => {
    if (Math.abs(actual - expected) > 1e-10) throw new Error(message);
  };
  for (const degrees of [-360, -120, 0, 120, 360]) {
    for (let frame = 0; frame <= 90; frame++) {
      const pose = orbitCameraSnapshot(start, degrees, frame / 90);
      near(Math.hypot(...offset(pose)), radius, 'Orbit radius must remain constant');
      near(height(pose), height(start), 'Orbit elevation about an arbitrary up axis must remain constant');
      same(pose.target, start.target, 'Orbit target must remain fixed');
      same(pose.up, start.up, 'Orbit must not roll the camera');
    }
  }
  const quarterTurn = orbitCameraSnapshot(start, 360, .25);
  if (Math.hypot(...quarterTurn.position.map((value, index) => value - start.position[index])) < 1) {
    throw new Error('A 360-degree orbit must move through intermediate viewpoints');
  }
  const fullTurn = orbitCameraSnapshot(start, 360, 1);
  fullTurn.position.forEach((value, index) => near(value, start.position[index], 'A full orbit must return home'));
  const clockwise: CameraSnapshot = {position: [5, 0, 2], target: [0, 0, 0], up: [0, 0, 1]};
  near(orbitCameraSnapshot(clockwise, 90, 1).position[1], 5, 'Positive angles must have a defined direction');
  near(orbitCameraSnapshot(clockwise, -90, 1).position[1], -5, 'Negative angles must reverse direction');
  same(JSON.stringify(start), initial, 'Sampling an orbit must not mutate its starting pose');

  const first = fixture();
  const replacement = fixture();
  first.mount();
  replacement.mount();
  unregisterSessionCamera(first.api);
  same(getSessionCamera() === replacement.api, true, 'Old viewport teardown cannot clear a replacement camera');
  first.clean();
  replacement.clean();
  console.log('View workspace, mounted-camera, animation completion, ownership and expiry checks passed.');
}
await main();
