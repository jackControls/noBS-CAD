import { useAppStore } from '../store/appStore';
import { pendingEngineOperations, type EngineOperationOwner } from '../engine/activity';
import { translate } from '../i18n';
import { projectTransitions } from './projectTransitions';

/** Retain the published document and every frontend-owned part of its model.
 * A tab ID survives Open, and dirty alone does not identify a later edit. */
export function captureProjectOwner(allowSolidBusy = false, operationOwner?: EngineOperationOwner) {
  const state = useAppStore.getState();
  const revision = projectTransitions.capture();
  const assertUnchanged = () => {
    projectTransitions.assertPublished(revision);
    const current = useAppStore.getState();
    if (current.activeProjectTabId !== state.activeProjectTabId
      || current.document !== state.document || current.solidScene !== state.solidScene
      || current.finishedSketches !== state.finishedSketches || current.datumPlanes !== state.datumPlanes
      || current.bodyAppearances !== state.bodyAppearances || current.drawingDocument !== state.drawingDocument
      || current.assemblyDocument !== state.assemblyDocument || current.projectVisibility !== state.projectVisibility
      || current.activeSketch !== state.activeSketch || current.historyEdit !== state.historyEdit) {
      throw new Error(translate('file.errorDocumentChangedDuringSave'));
    }
  };
  const assertSettled = () => {
    projectTransitions.assertSettled(revision);
    const current = useAppStore.getState();
    if ((!allowSolidBusy && current.solidBusy) || pendingEngineOperations(operationOwner) > 0
      || (!state.projectBusy && current.projectBusy)) throw new Error(translate('file.errorDocumentChangedDuringSave'));
    assertUnchanged();
  };
  return { state, assertSettled, assertUnchanged, async assertCurrent() {
    await projectTransitions.assertCurrent(revision);
    assertSettled();
  } };
}
