import { getSessionCamera, subscribeSessionCamera, type ViewportCameraApi } from './components/viewport/cameraApi';
import type { ViewCameraDto } from './engine/types';
import type { AppState } from './store/appStore';
import { armNamedViewCameraRestore } from './namedViewCamera';

export { translateByPartOffset } from './namedViewOffsets';

/** Shared entry guard for Browser recall and the live MCP inbox. */
export function namedViewRecallAllowed(state: AppState, ownsRecallBusy = false): boolean {
  return !((state.solidBusy && !ownsRecallBusy) || state.projectBusy || state.activeSketch || state.historyEdit
    || state.mode !== 'solid' || (state.activeTab !== 'solid' && state.activeTab !== 'drawing')
    || state.settingsOpen || state.constraintDialog
    || state.bodyFeatureDialog || state.constructionPlaneDialog
    || state.jointDialogOpen || state.jointMotionPreview || state.mechanismPreview || state.motionStudyPreview
    || state.extrudeDialogFeature !== null || state.revolveDialogFeature !== null
    || state.sweepDialogFeature !== null || state.loftDialogFeature !== null
    || state.ribDialogFeature !== null || state.filletDialogFeature !== null
    || state.chamferDialogFeature !== null || state.holeDialogFeature !== null);
}

/** MCP capture data uses model body IDs and independent copies of display state. */
export function inspectNamedViewState(
  state: Pick<AppState, 'solidScene' | 'projectVisibility' | 'viewPartOffsets' | 'activeNamedView' | 'mode'>,
  camera: Pick<ViewportCameraApi, 'getSnapshot'> | null = getSessionCamera(),
) {
  const hidden = new Set(state.projectVisibility.hidden_body_ids);
  const pose = camera?.getSnapshot();
  return {
    camera: pose ? {position: [...pose.position], target: [...pose.target], up: [...pose.up]} : null,
    visible_body_ids: state.solidScene.bodies.filter(body => !hidden.has(body.id)).map(body => body.id),
    part_offsets: state.viewPartOffsets.map(offset => ({body_id: offset.body_id, translation: [...offset.translation]})),
    active_named_view: state.activeNamedView,
    mode: state.mode,
  };
}

/** Restore a saved camera once the modeling viewport is mounted. */
export function restoreNamedViewCamera(camera: ViewCameraDto, isCurrent: () => boolean): void {
  armNamedViewCameraRestore(camera, getSessionCamera, subscribeSessionCamera, isCurrent);
}
