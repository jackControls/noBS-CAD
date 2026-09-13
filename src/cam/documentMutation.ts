import { getEngine, type Engine } from '../engine';
import { trackEngineOperation } from '../engine/activity';
import type { CamDocumentDto } from '../engine/types';
import { applicationExitBarrier } from '../files/applicationExit';
import { captureProjectOwner } from '../files/projectOwnership';
import { projectTransitions } from '../files/projectTransitions';
import { presentation } from '../operationPlayback';
import { useAppStore } from '../store/appStore';
import { beginCamActivity, inheritCamSimulationInputs, paintCamActivity } from './simulationUi';

type State = ReturnType<typeof useAppStore.getState>;
export type CamSelection = Pick<State, 'selectedCamSetupId' | 'selectedCamOperationId'>;

let writeQueue: Promise<void> = Promise.resolve();
const changedMessage = 'The document changed while updating CAM. Retry the action in the intended project.';

/** Capture ownership at invocation, not after the queue, paint or library IO.
 * The snapshot fences native writes AND their UI publication against Open,
 * tab hydration and live inbox work. Queued replacements may proceed only
 * after the owning document has received its result. */
export function enqueueCamMutation<T>(label: string, mutate: (context: {
  engine: Engine;
  state: State;
  assertCurrent(): void;
  publish(document: CamDocumentDto, selection?: Partial<CamSelection>, preserveSimulationInputs?: boolean): void;
}) => Promise<T>): Promise<T> {
  const owner = captureProjectOwner();
  const revision = projectTransitions.capture();
  const documentVersion = presentation.documentVersion();
  const finish = beginCamActivity(label);
  const releaseExit = applicationExitBarrier.hold();
  const assertOwner = () => {
    try { owner.assertUnchanged(); } catch { throw new Error(changedMessage); }
    if (presentation.documentVersion() !== documentVersion) throw new Error(changedMessage);
  };
  const operation = trackEngineOperation(writeQueue.then(async () => {
    await paintCamActivity();
    // An empty background inbox poll is harmless; a real replacement changes
    // the revision and cancels the queued action before acquiring the engine.
    try { await projectTransitions.assertCurrent(revision); } catch { throw new Error(changedMessage); }
    assertOwner();
    const snapshot = projectTransitions.beginSnapshot();
    try {
      const engine = await getEngine();
      const state = useAppStore.getState();
      const assertOwned = () => {
        snapshot.assertOwned();
        assertOwner();
        if (useAppStore.getState().camDocument !== state.camDocument) throw new Error(changedMessage);
      };
      const assertCurrent = () => {
        snapshot.assertCurrent();
        assertOwned();
        const current = useAppStore.getState();
        if (current.solidBusy || current.projectBusy || current.activeSketch || current.historyEdit) {
          throw new Error('Finish the current document operation before updating CAM.');
        }
      };
      assertCurrent();
      return await mutate({ engine, state, assertCurrent, publish: (camDocument, selection = {}, preserveSimulationInputs = false) => {
        // Do not reject a replacement waiting on this snapshot: it must see
        // the completed edit in A before it can hydrate B. An actual ownership
        // change, including Open in the same tab, still rejects late replies.
        assertOwned();
        if (preserveSimulationInputs) inheritCamSimulationInputs(state.camDocument, camDocument);
        useAppStore.setState({ camDocument, dirty: true, ...selection });
      } });
    } finally { snapshot.release(); }
  }));
  writeQueue = operation.then(() => undefined, () => undefined);
  return operation.finally(() => { finish(); releaseExit(); });
}

/** The store's explicit replacement route uses the same queue and fences. */
export function writeCamDocument(document: CamDocumentDto): Promise<void> {
  return enqueueCamMutation('Updating CAM…', async ({ engine, assertCurrent, publish }) => {
    assertCurrent();
    publish(await engine.setCamDocument(document));
  });
}
