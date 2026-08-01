/**
 * Application-level history metadata that sits above the sketch command
 * stack and parametric feature timeline.
 *
 * Solid Undo keeps its established behavior of deleting the latest feature.
 * The pre-delete project model is retained in memory so Redo can restore the
 * exact feature definition, references, appearances, and stable IDs. Nothing
 * is written to disk, and a normal mutation after Undo invalidates the branch.
 */
import { useAppStore } from '../store/appStore';

export type SolidRedoSnapshot = {
  modelJson: string;
  /** The active model generation this snapshot is allowed to replace. */
  expectedGeneration: number;
};

type ObservedModel = {
  projectKey: string;
  document: unknown;
  activeSketch: unknown;
  finishedSketches: unknown;
  solidScene: unknown;
  datumPlanes: unknown;
  bodyAppearances: unknown;
};

const SOLID_REDO_LIMIT = 32;
const solidRedoByProject = new Map<string, SolidRedoSnapshot[]>();
const solidGenerationByProject = new Map<string, number>();
const listeners = new Set<() => void>();
let historyMutationDepth = 0;
let reconcileQueued = false;

export function currentHistoryProjectKey(): string {
  return useAppStore.getState().activeProjectTabId ?? '__bootstrap__';
}

function observeModel(): ObservedModel {
  const state = useAppStore.getState();
  return {
    projectKey: currentHistoryProjectKey(),
    document: state.document,
    activeSketch: state.activeSketch,
    finishedSketches: state.finishedSketches,
    solidScene: state.solidScene,
    datumPlanes: state.datumPlanes,
    bodyAppearances: state.bodyAppearances,
  };
}

function sameObservedModel(left: ObservedModel, right: ObservedModel): boolean {
  return (
    left.document === right.document &&
    left.activeSketch === right.activeSketch &&
    left.finishedSketches === right.finishedSketches &&
    left.solidScene === right.solidScene &&
    left.datumPlanes === right.datumPlanes &&
    left.bodyAppearances === right.bodyAppearances
  );
}

function generation(projectKey = currentHistoryProjectKey()): number {
  return solidGenerationByProject.get(projectKey) ?? 0;
}

function stack(projectKey = currentHistoryProjectKey()): SolidRedoSnapshot[] {
  let value = solidRedoByProject.get(projectKey);
  if (!value) {
    value = [];
    solidRedoByProject.set(projectKey, value);
  }
  return value;
}

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribeApplicationHistory(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Hold lower Redo entries stable while an Undo/Redo model replay advances
 * the observed generation. The returned closer must always be called. */
export function beginHistoryMutation(): () => void {
  historyMutationDepth += 1;
  return () => {
    historyMutationDepth = Math.max(0, historyMutationDepth - 1);
    if (historyMutationDepth === 0) notify();
  };
}

export function hasValidSolidRedo(
  projectKey = currentHistoryProjectKey(),
): boolean {
  const redo = stack(projectKey);
  const entry = redo[redo.length - 1];
  if (!entry) return false;
  if (entry.expectedGeneration === generation(projectKey)) return true;
  // A normal model mutation after Undo starts a new branch. During a guarded
  // history replay, lower entries are repaired before the transaction closes.
  if (historyMutationDepth === 0) redo.length = 0;
  return false;
}

export function pushSolidRedoSnapshot(
  projectKey: string,
  modelJson: string,
): void {
  const redo = stack(projectKey);
  redo.push({ modelJson, expectedGeneration: generation(projectKey) });
  if (redo.length > SOLID_REDO_LIMIT) {
    redo.splice(0, redo.length - SOLID_REDO_LIMIT);
  }
}

export function takeSolidRedoSnapshot(
  projectKey: string,
): SolidRedoSnapshot | null {
  if (!hasValidSolidRedo(projectKey)) return null;
  return stack(projectKey).pop() ?? null;
}

export function returnSolidRedoSnapshot(
  projectKey: string,
  snapshot: SolidRedoSnapshot,
): void {
  snapshot.expectedGeneration = generation(projectKey);
  stack(projectKey).push(snapshot);
}

/** After one Redo, the next older snapshot is now valid against the restored
 * model even though that model has a fresh store generation. */
export function authorizeNextSolidRedo(projectKey: string): void {
  const redo = stack(projectKey);
  const next = redo[redo.length - 1];
  if (next) next.expectedGeneration = generation(projectKey);
}

let observedModel = observeModel();
useAppStore.subscribe((state, previous) => {
  const mayAffectHistory =
    state.activeProjectTabId !== previous.activeProjectTabId ||
    state.document !== previous.document ||
    state.activeSketch !== previous.activeSketch ||
    state.finishedSketches !== previous.finishedSketches ||
    state.solidScene !== previous.solidScene ||
    state.datumPlanes !== previous.datumPlanes ||
    state.bodyAppearances !== previous.bodyAppearances;
  if (!mayAffectHistory || reconcileQueued) return;
  reconcileQueued = true;
  queueMicrotask(() => {
    reconcileQueued = false;
    const next = observeModel();
    if (
      next.projectKey === observedModel.projectKey &&
      !sameObservedModel(next, observedModel)
    ) {
      solidGenerationByProject.set(
        next.projectKey,
        generation(next.projectKey) + 1,
      );
      if (historyMutationDepth === 0) notify();
    }
    // Project-tab hydration changes the model and active id in adjacent store
    // writes. Treat that as changing contexts, not mutating either document.
    observedModel = next;
  });
});
