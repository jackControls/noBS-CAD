/**
 * Application-level history metadata that sits above the sketch command
 * stack and parametric feature timeline.
 *
 * Solid Undo keeps its established behavior of deleting the latest feature.
 * Drawing Undo stores complete before/after DrawingDocument snapshots, because
 * one user command can create several related projected views. Nothing is
 * written to disk, and a normal mutation after Undo invalidates that branch.
 */
import { useAppStore } from '../store/appStore';
import type { DrawingDocumentDto } from './types';

export type SolidRedoSnapshot = {
  modelJson: string;
  /** The active model generation this snapshot is allowed to replace. */
  expectedGeneration: number;
};

export type DrawingHistoryEntry = {
  before: DrawingDocumentDto;
  after: DrawingDocumentDto;
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
const DRAWING_HISTORY_LIMIT = 64;
const solidRedoByProject = new Map<string, SolidRedoSnapshot[]>();
const solidGenerationByProject = new Map<string, number>();
const drawingUndoByProject = new Map<string, DrawingHistoryEntry[]>();
const drawingRedoByProject = new Map<string, DrawingHistoryEntry[]>();
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

function drawingStack(
  stacks: Map<string, DrawingHistoryEntry[]>,
  projectKey = currentHistoryProjectKey(),
): DrawingHistoryEntry[] {
  let value = stacks.get(projectKey);
  if (!value) {
    value = [];
    stacks.set(projectKey, value);
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

/** Permanently release one closed project's application-level history. Tab
 * eviction intentionally does not call this because the project remains open. */
export function dropApplicationHistory(projectKey: string): void {
  const removedRedo = solidRedoByProject.delete(projectKey);
  const removedGeneration = solidGenerationByProject.delete(projectKey);
  const removedDrawingUndo = drawingUndoByProject.delete(projectKey);
  const removedDrawingRedo = drawingRedoByProject.delete(projectKey);
  if (
    removedRedo
    || removedGeneration
    || removedDrawingUndo
    || removedDrawingRedo
  ) notify();
}

/** After one Redo, the next older snapshot is now valid against the restored
 * model even though that model has a fresh store generation. */
export function authorizeNextSolidRedo(projectKey: string): void {
  const redo = stack(projectKey);
  const next = redo[redo.length - 1];
  if (next) next.expectedGeneration = generation(projectKey);
}

/** Record one complete drawing command. Call this only after the Rust document
 * accepted the new snapshot, so a failed write cannot create a phantom Undo. */
export function recordDrawingHistory(
  projectKey: string,
  before: DrawingDocumentDto,
  after: DrawingDocumentDto,
): void {
  const undo = drawingStack(drawingUndoByProject, projectKey);
  undo.push({
    before: structuredClone(before),
    after: structuredClone(after),
  });
  if (undo.length > DRAWING_HISTORY_LIMIT) {
    undo.splice(0, undo.length - DRAWING_HISTORY_LIMIT);
  }
  drawingStack(drawingRedoByProject, projectKey).length = 0;
  notify();
}

export function canUndoDrawingHistory(
  projectKey = currentHistoryProjectKey(),
): boolean {
  return drawingStack(drawingUndoByProject, projectKey).length > 0;
}

export function canRedoDrawingHistory(
  projectKey = currentHistoryProjectKey(),
): boolean {
  return drawingStack(drawingRedoByProject, projectKey).length > 0;
}

/** Peek first and commit only after the engine accepts the restored drawing.
 * Drawing writes are serialized by drawing/document.ts, so the identity check
 * also protects against committing a different queued operation. */
export function peekDrawingUndoHistory(
  projectKey: string,
): DrawingHistoryEntry | null {
  const undo = drawingStack(drawingUndoByProject, projectKey);
  return undo[undo.length - 1] ?? null;
}

export function commitDrawingUndoHistory(
  projectKey: string,
  entry: DrawingHistoryEntry,
): boolean {
  const undo = drawingStack(drawingUndoByProject, projectKey);
  if (undo[undo.length - 1] !== entry) return false;
  undo.pop();
  drawingStack(drawingRedoByProject, projectKey).push(entry);
  notify();
  return true;
}

export function peekDrawingRedoHistory(
  projectKey: string,
): DrawingHistoryEntry | null {
  const redo = drawingStack(drawingRedoByProject, projectKey);
  return redo[redo.length - 1] ?? null;
}

export function commitDrawingRedoHistory(
  projectKey: string,
  entry: DrawingHistoryEntry,
): boolean {
  const redo = drawingStack(drawingRedoByProject, projectKey);
  if (redo[redo.length - 1] !== entry) return false;
  redo.pop();
  drawingStack(drawingUndoByProject, projectKey).push(entry);
  notify();
  return true;
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
