import { getSessionCamera, subscribeSessionCamera } from './components/viewport/cameraApi';
import type { ViewCameraDto } from './engine/types';
import { armNamedViewCameraRestore } from './namedViewCamera';

export { translateByPartOffset } from './namedViewOffsets';

/** Restore a saved camera once the modeling viewport is mounted. */
export function restoreNamedViewCamera(camera: ViewCameraDto): void {
  armNamedViewCameraRestore(camera, getSessionCamera, subscribeSessionCamera);
}
