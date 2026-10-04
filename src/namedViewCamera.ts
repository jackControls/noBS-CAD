import type { ViewCameraDto } from './engine/types';

export interface NamedViewCameraApi {
  restore(camera: ViewCameraDto): void;
}

let pendingStop: (() => void) | null = null;

/** Apply this camera, cancelling a restore that is still waiting for the viewport. */
export function armNamedViewCameraRestore(
  camera: ViewCameraDto,
  getCamera: () => NamedViewCameraApi | null,
  subscribe: (listener: () => void) => () => void,
): void {
  pendingStop?.();
  pendingStop = null;
  const current = getCamera();
  if (current) {
    current.restore(camera);
    return;
  }
  let stop = () => {};
  let applied = false;
  stop = subscribe(() => {
    if (applied) return;
    const api = getCamera();
    if (!api) return;
    // Drop the listener before restore. A zero-duration camera snap notifies
    // subscribers synchronously, and this listener is still in that snapshot.
    applied = true;
    stop();
    if (pendingStop === stop) pendingStop = null;
    api.restore(camera);
  });
  pendingStop = stop;
}
