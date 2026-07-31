/**
 * Window-level project tabs.
 *
 * OCCT and the native Bevy viewport intentionally keep one hydrated document
 * per application window. Switching tabs snapshots the outgoing parametric
 * model and transactionally loads the incoming one into that same engine.
 * This keeps tabs inexpensive and avoids duplicating GPU/native kernel state.
 */
import { getEngine } from '../engine';
import type {
  BodyAppearance,
  DatumPlaneDefinitionDto,
  SketchDto,
  SolidUpdateDto,
} from '../engine/types';
import { translate } from '../i18n';
import {
  useAppStore,
  type ProjectTabSummary,
} from '../store/appStore';
import type { SaveTarget } from './fileIO';

interface ProjectTabRuntime {
  modelJson: string;
  /** Native paths/file handles never enter the inspectable Zustand store. */
  saveTarget: SaveTarget | null;
}

export interface RecoverableProjectTab {
  id: string;
  name: string;
  fileName: string | null;
  modelJson: string;
}

const runtimes = new Map<string, ProjectTabRuntime>();
let currentProjectTarget: SaveTarget | null = null;
let nextTabId = 1;

function createTabId(): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  const id = randomId ?? `project-${Date.now()}-${nextTabId}`;
  nextTabId += 1;
  return id;
}

function summaryFromActiveState(id: string): ProjectTabSummary {
  const state = useAppStore.getState();
  return {
    id,
    name: state.document?.name ?? translate('app.untitledDocument'),
    fileName: state.projectFileName,
    dirty: state.dirty,
  };
}

function syncActiveSummary(): void {
  const state = useAppStore.getState();
  const id = state.activeProjectTabId;
  if (!id) return;
  const summary = summaryFromActiveState(id);
  useAppStore.setState({
    projectTabs: state.projectTabs.map((tab) =>
      tab.id === id ? summary : tab,
    ),
  });
}

async function ensureActiveProjectTab(
  knownModelJson?: string,
): Promise<string> {
  const state = useAppStore.getState();
  if (state.activeProjectTabId) return state.activeProjectTabId;

  const id = createTabId();
  const modelJson =
    knownModelJson ?? (await (await getEngine()).exportProjectModel());
  runtimes.set(id, { modelJson, saveTarget: currentProjectTarget });
  useAppStore.setState({
    activeProjectTabId: id,
    projectTabs: [summaryFromActiveState(id)],
  });
  return id;
}

async function snapshotActiveProjectTab(): Promise<string> {
  const state = useAppStore.getState();
  if (state.activeSketch) {
    throw new Error(translate('file.finishBeforeTabSwitch'));
  }
  const modelJson = await (await getEngine()).exportProjectModel();
  const id = await ensureActiveProjectTab(modelJson);
  runtimes.set(id, { modelJson, saveTarget: currentProjectTarget });
  syncActiveSummary();
  return id;
}

async function modelState(
  modelJson: string,
): Promise<{
  update: SolidUpdateDto;
  finishedSketches: SketchDto[];
  datumPlanes: DatumPlaneDefinitionDto[];
  bodyAppearances: BodyAppearance[];
}> {
  const engine = await getEngine();
  const update = await engine.loadProjectModel(modelJson);
  const [finishedSketches, datumPlanes, bodyAppearances] = await Promise.all([
    engine.finishedSketches(),
    engine.datumPlaneDefinitions(),
    engine.bodyAppearances(),
  ]);
  return { update, finishedSketches, datumPlanes, bodyAppearances };
}

async function hydrateProjectTab(tabId: string): Promise<void> {
  const state = useAppStore.getState();
  const tab = state.projectTabs.find((candidate) => candidate.id === tabId);
  const runtime = runtimes.get(tabId);
  if (!tab || !runtime) {
    throw new Error(translate('file.tabUnavailable'));
  }

  const { update, finishedSketches, datumPlanes, bodyAppearances } =
    await modelState(runtime.modelJson);
  currentProjectTarget = runtime.saveTarget;
  useAppStore
    .getState()
    .loadProjectState(
      update,
      finishedSketches,
      datumPlanes,
      tab.fileName,
      bodyAppearances,
    );
  useAppStore.setState({
    activeProjectTabId: tabId,
    dirty: tab.dirty,
  });
}

async function withProjectTransition(
  operation: () => Promise<boolean>,
): Promise<boolean> {
  const state = useAppStore.getState();
  if (state.solidBusy) return false;
  state.setSolidBusy(true);
  try {
    return await operation();
  } finally {
    useAppStore.getState().setSolidBusy(false);
  }
}

/** Register the engine document loaded during application startup. */
export async function initializeProjectTabs(): Promise<void> {
  if (useAppStore.getState().activeProjectTabId) return;
  await ensureActiveProjectTab();
}

/** Add a fresh document while preserving the current one as an inactive tab. */
export function createProjectTab(): Promise<boolean> {
  return withProjectTransition(async () => {
    await snapshotActiveProjectTab();
    const engine = await getEngine();
    const update = await engine.newProject();
    const modelJson = await engine.exportProjectModel();
    currentProjectTarget = null;
    useAppStore.getState().loadProjectState(update, [], [], null);

    const id = createTabId();
    runtimes.set(id, { modelJson, saveTarget: null });
    const state = useAppStore.getState();
    useAppStore.setState({
      activeProjectTabId: id,
      projectTabs: [...state.projectTabs, summaryFromActiveState(id)],
    });
    return true;
  });
}

/** Hydrate an existing tab into the one native modeling/rendering engine. */
export function switchProjectTab(tabId: string): Promise<boolean> {
  return withProjectTransition(async () => {
    const state = useAppStore.getState();
    if (tabId === state.activeProjectTabId) return true;
    if (!state.projectTabs.some((tab) => tab.id === tabId)) return false;
    await snapshotActiveProjectTab();
    await hydrateProjectTab(tabId);
    return true;
  });
}

/** Close one tab. Closing the last document leaves one fresh Untitled tab. */
export function closeProjectTab(tabId?: string): Promise<boolean> {
  return withProjectTransition(async () => {
    const state = useAppStore.getState();
    const id = tabId ?? state.activeProjectTabId;
    if (!id) return false;
    const index = state.projectTabs.findIndex((tab) => tab.id === id);
    if (index < 0) return false;
    const tab = state.projectTabs[index];
    const dirty = id === state.activeProjectTabId ? state.dirty : tab.dirty;
    if (dirty && !window.confirm(translate('file.closeDiscardConfirm'))) {
      return false;
    }

    if (id !== state.activeProjectTabId) {
      runtimes.delete(id);
      useAppStore.setState({
        projectTabs: state.projectTabs.filter((candidate) => candidate.id !== id),
      });
      return true;
    }

    if (state.projectTabs.length > 1) {
      const adjacent =
        state.projectTabs[index + 1] ?? state.projectTabs[index - 1];
      await hydrateProjectTab(adjacent.id);
      runtimes.delete(id);
      useAppStore.setState((current) => ({
        projectTabs: current.projectTabs.filter(
          (candidate) => candidate.id !== id,
        ),
      }));
      return true;
    }

    const engine = await getEngine();
    const update = await engine.newProject();
    const modelJson = await engine.exportProjectModel();
    currentProjectTarget = null;
    runtimes.set(id, { modelJson, saveTarget: null });
    useAppStore.getState().loadProjectState(update, [], [], null);
    useAppStore.setState({
      activeProjectTabId: id,
      projectTabs: [summaryFromActiveState(id)],
    });
    return true;
  });
}

export function getCurrentProjectTarget(): SaveTarget | null {
  return currentProjectTarget;
}

/** Keep active-tab metadata and its reusable Save target in sync after Save. */
export async function recordActiveProjectSave(
  modelJson: string,
  saveTarget: SaveTarget | null,
): Promise<void> {
  const id = await ensureActiveProjectTab(modelJson);
  currentProjectTarget = saveTarget;
  runtimes.set(id, { modelJson, saveTarget });
  syncActiveSummary();
}

/** Replace only the active tab after Open; sibling tabs remain untouched. */
export async function recordActiveProjectOpen(
  modelJson: string,
  saveTarget: SaveTarget | null,
): Promise<void> {
  const id = await ensureActiveProjectTab(modelJson);
  currentProjectTarget = saveTarget;
  runtimes.set(id, { modelJson, saveTarget });
  syncActiveSummary();
}

export function recordActiveProjectMetadata(): void {
  syncActiveSummary();
}

export function hasUnsavedProjects(): boolean {
  const state = useAppStore.getState();
  // Include the active summary as well as the live flag. During a tab
  // hydration these update in adjacent Zustand commits; a brief false
  // positive is safe, while a false negative could erase crash recovery.
  return state.dirty || state.projectTabs.some((tab) => tab.dirty);
}

/** Capture every dirty tab for crash recovery without exposing save paths. */
export async function collectRecoverableProjectTabs(): Promise<{
  activeTabId: string | null;
  tabs: RecoverableProjectTab[];
}> {
  const state = useAppStore.getState();
  let activeModelJson: string | null = null;
  if (state.dirty && !state.activeSketch) {
    try {
      activeModelJson = await (await getEngine()).exportProjectModel();
      if (state.activeProjectTabId) {
        runtimes.set(state.activeProjectTabId, {
          modelJson: activeModelJson,
          saveTarget: currentProjectTarget,
        });
      }
    } catch {
      activeModelJson = null;
    }
  }

  const tabs = state.projectTabs.flatMap((tab): RecoverableProjectTab[] => {
    const dirty =
      tab.id === state.activeProjectTabId ? state.dirty : tab.dirty;
    if (!dirty) return [];
    const modelJson =
      tab.id === state.activeProjectTabId
        ? activeModelJson ?? runtimes.get(tab.id)?.modelJson
        : runtimes.get(tab.id)?.modelJson;
    if (!modelJson) return [];
    return [{
      id: tab.id,
      name:
        tab.id === state.activeProjectTabId
          ? state.document?.name ?? tab.name
          : tab.name,
      fileName:
        tab.id === state.activeProjectTabId
          ? state.projectFileName
          : tab.fileName,
      modelJson,
    }];
  });
  return { activeTabId: state.activeProjectTabId, tabs };
}

/** Restore all recoverable tabs, hydrating only one into OCCT/Bevy. */
export async function restoreProjectTabs(
  recovered: RecoverableProjectTab[],
  requestedActiveId: string | null,
): Promise<boolean> {
  if (recovered.length === 0) return false;
  const active =
    recovered.find((tab) => tab.id === requestedActiveId) ?? recovered[0];
  const { update, finishedSketches, datumPlanes, bodyAppearances } =
    await modelState(active.modelJson);

  runtimes.clear();
  for (const tab of recovered) {
    runtimes.set(tab.id, { modelJson: tab.modelJson, saveTarget: null });
  }
  currentProjectTarget = null;
  useAppStore
    .getState()
    .loadProjectState(
      update,
      finishedSketches,
      datumPlanes,
      active.fileName,
      bodyAppearances,
    );
  useAppStore.setState({
    activeProjectTabId: active.id,
    dirty: true,
    projectTabs: recovered.map((tab) => ({
      id: tab.id,
      name: tab.id === active.id ? update.document.name : tab.name,
      fileName: tab.fileName,
      dirty: true,
    })),
  });
  return true;
}
