import { getEngine } from '../engine';
import { translate } from '../i18n';
import {
  exportProjectModelWithVisibility,
  useAppStore,
} from '../store/appStore';
import {
  chooseOpenFile,
  chooseSaveTarget,
  writeSaveTarget,
  type SaveType,
} from './fileIO';
import {
  createNbcadArchive,
  readNbcadArchive,
  LEGACY_PROJECT_EXTENSION,
  NBCAD_EXTENSION,
} from './nbcad';
import {
  closeProjectTab,
  collectRecoverableProjectTabs,
  createProjectTab,
  getCurrentProjectTarget,
  hasUnsavedProjects,
  recordActiveProjectMetadata,
  recordActiveProjectOpen,
  recordActiveProjectSave,
  restoreProjectTabs,
  type RecoverableProjectTab,
} from './projectTabs';

const PROJECT_TYPE: SaveType = {
  description: 'noBS CAD Project',
  extension: NBCAD_EXTENSION,
  alternateExtensions: [LEGACY_PROJECT_EXTENSION],
  mime: 'application/vnd.nbcad.project+zip',
};
const STEP_TYPE: SaveType = {
  description: 'STEP AP242',
  extension: '.step',
  alternateExtensions: ['.stp'],
  mime: 'model/step',
};
const STL_TYPE: SaveType = {
  description: 'STL mesh (millimetres)',
  extension: '.stl',
  mime: 'model/stl',
};
const THREEMF_TYPE: SaveType = {
  description: '3MF (millimetres)',
  extension: '.3mf',
  mime: 'model/3mf',
};
const MAX_STEP_IMPORT_BYTES = 96 * 1024 * 1024;
const AUTOSAVE_KEY = 'nbcad:recovery:v1';
const LEGACY_AUTOSAVE_KEYS = ['tfcad:recovery:v1'] as const;

function recoveryEntry(): { key: string; value: string } | null {
  const current = localStorage.getItem(AUTOSAVE_KEY);
  if (current) return { key: AUTOSAVE_KEY, value: current };
  for (const key of LEGACY_AUTOSAVE_KEYS) {
    const value = localStorage.getItem(key);
    if (value) return { key, value };
  }
  return null;
}

function clearProjectRecovery() {
  localStorage.removeItem(AUTOSAVE_KEY);
  LEGACY_AUTOSAVE_KEYS.forEach((key) => localStorage.removeItem(key));
}

function withoutExtension(name: string): string {
  return name.replace(/\.[^.]+$/, '') || 'Untitled';
}

function currentSuggestedName(): string {
  const state = useAppStore.getState();
  return `${withoutExtension(state.document?.name ?? state.projectFileName ?? 'Untitled')}.nbcad`;
}

function normalizedProjectName(name: string): string {
  return name
    .trim()
    .replace(/\.(?:nbcad|tfcad)$/i, '')
    .trim();
}

/** Rename the project model without silently changing its current file path.
 * The next Save persists the name to that file; Save As also adopts the new
 * filename as the project name. */
export async function renameProject(requestedName?: string): Promise<boolean> {
  const state = useAppStore.getState();
  if (state.document === null) {
    throw new Error(translate('file.noOpenProject'));
  }
  const input =
    requestedName ??
    window.prompt(translate('file.renamePrompt'), state.document.name);
  if (input === null) return false;
  const name = normalizedProjectName(input);
  if (!name) throw new Error(translate('file.renameEmpty'));
  if (name === state.document.name) return true;

  const document = await (await getEngine()).setDocumentName(name);
  useAppStore.setState({ document, dirty: true });
  recordActiveProjectMetadata();
  return true;
}

export async function saveProject(saveAs = false): Promise<boolean> {
  const state = useAppStore.getState();
  if (state.document === null) {
    throw new Error(translate('file.noOpenProject'));
  }
  if (state.activeSketch) {
    throw new Error(translate('file.finishBeforeSave'));
  }
  const existingTarget = !saveAs ? getCurrentProjectTarget() : null;
  const target =
    existingTarget ??
    (await chooseSaveTarget(currentSuggestedName(), PROJECT_TYPE));
  if (!target) return false;

  const engine = await getEngine();
  // An explicit Rename Project changes model identity without moving the
  // file. Only a new destination (first Save or Save As) derives the model
  // name from the filename selected by the user.
  const designName = existingTarget
    ? state.document.name
    : withoutExtension(target.name);
  const originalName = state.document?.name ?? 'Untitled';
  const document = await engine.setDocumentName(designName);
  let modelJson: string;
  try {
    modelJson = await exportProjectModelWithVisibility(engine);
    await writeSaveTarget(target, createNbcadArchive(modelJson));
  } catch (error) {
    if (designName !== originalName) {
      await engine.setDocumentName(originalName).catch(() => undefined);
    }
    throw error;
  }
  const reusableTarget = target.kind === 'download' ? null : target;
  useAppStore.setState({
    document,
    dirty: false,
    projectFileName: target.name,
  });
  await recordActiveProjectSave(modelJson, reusableTarget);
  if (!hasUnsavedProjects()) clearProjectRecovery();
  return true;
}

/** Open a fresh untitled design in a new window-level document tab. */
export function newProject(): Promise<boolean> {
  return createProjectTab();
}

/** Close one document tab; the last tab is replaced with a fresh Untitled. */
export async function closeProject(tabId?: string): Promise<boolean> {
  const closed = await closeProjectTab(tabId);
  if (closed && !hasUnsavedProjects()) clearProjectRecovery();
  return closed;
}

export async function openProject(): Promise<boolean> {
  const state = useAppStore.getState();
  if (
    state.dirty &&
    !window.confirm(translate('file.discardConfirm'))
  ) {
    return false;
  }
  const opened = await chooseOpenFile(PROJECT_TYPE);
  if (!opened) return false;
  const { modelJson } = readNbcadArchive(opened.bytes);
  const engine = await getEngine();
  const update = await engine.loadProjectModel(modelJson);
  const [finishedSketches, datumPlanes, bodyAppearances, drawingDocument, projectVisibility] = await Promise.all([
    engine.finishedSketches(),
    engine.datumPlaneDefinitions(),
    engine.bodyAppearances(),
    engine.drawingDocument(),
    engine.projectVisibility(),
  ]);
  // A legacy project is readable, but the next Save must choose a new
  // `.nbcad` destination instead of silently overwriting the old container.
  const reusableTarget = opened.name.toLowerCase().endsWith(NBCAD_EXTENSION)
    ? opened.writableTarget
    : null;
  useAppStore
    .getState()
    .loadProjectState(
      update,
      finishedSketches,
      datumPlanes,
      opened.name,
      bodyAppearances,
      drawingDocument,
      projectVisibility,
    );
  await recordActiveProjectOpen(modelJson, reusableTarget);
  if (!hasUnsavedProjects()) clearProjectRecovery();
  return true;
}

export async function exportStep(selectedOnly: boolean): Promise<boolean> {
  const state = useAppStore.getState();
  if (state.activeSketch) {
    throw new Error(translate('file.finishBeforeStep'));
  }
  if (state.solidScene.errors.length > 0) {
    throw new Error(translate('file.resolveErrors'));
  }
  const bodyIds =
    selectedOnly && state.selectedBody !== null
      ? [state.selectedBody]
      : state.solidScene.bodies.map((body) => body.id);
  if (selectedOnly && state.selectedBody === null) {
    throw new Error(translate('file.selectBody'));
  }
  if (bodyIds.length === 0) {
    throw new Error(translate('file.noBodies'));
  }
  const documentName = withoutExtension(state.document?.name ?? state.projectFileName ?? 'Untitled');
  const suffix = selectedOnly && state.selectedBody !== null ? `-Body${state.selectedBody}` : '';
  const target = await chooseSaveTarget(`${documentName}${suffix}.step`, STEP_TYPE);
  if (!target) return false;
  const engine = await getEngine();
  const activeFeatureIds = new Set(
    (state.document?.features ?? [])
      .slice(0, state.document?.rollback_index ?? 0)
      .filter((feature) => !feature.suppressed)
      .map((feature) => feature.id),
  );
  const threadMetadata = (await engine.holeDefinitions()).flatMap((definition) => {
    if (
      !definition.thread
      || !bodyIds.includes(definition.body_id)
      || !activeFeatureIds.has(definition.feature_id)
    ) {
      return [];
    }
    return [{
      body_id: definition.body_id,
      feature_id: definition.feature_id,
      feature_name: definition.name,
      position_count: Math.max(1, definition.positions.length),
      predrill_diameter: definition.diameter,
      thread: definition.thread,
    }];
  });
  const bytes = await engine.exportStep({
    body_ids: bodyIds,
    thread_metadata: threadMetadata,
  });
  await writeSaveTarget(target, bytes);
  return true;
}

function meshExportBodyIds(selectedOnly: boolean): number[] {
  const state = useAppStore.getState();
  if (state.activeSketch) {
    throw new Error(translate('file.finishBeforeMesh'));
  }
  if (state.solidScene.errors.length > 0) {
    throw new Error(translate('file.resolveErrors'));
  }
  if (selectedOnly && state.selectedBody === null) {
    throw new Error(translate('file.selectBody'));
  }
  const bodyIds =
    selectedOnly && state.selectedBody !== null
      ? [state.selectedBody]
      : state.solidScene.bodies.map((body) => body.id);
  if (bodyIds.length === 0) {
    throw new Error(translate('file.noBodies'));
  }
  return bodyIds;
}

export async function exportStl(selectedOnly: boolean): Promise<boolean> {
  const state = useAppStore.getState();
  const bodyIds = meshExportBodyIds(selectedOnly);
  if (state.bodyAppearances.some((entry) => bodyIds.includes(entry.body_id))) {
    window.alert(translate('file.stlDropsAppearance'));
  }
  const documentName = withoutExtension(state.document?.name ?? state.projectFileName ?? 'Untitled');
  const suffix = selectedOnly && state.selectedBody !== null ? `-Body${state.selectedBody}` : '';
  const target = await chooseSaveTarget(`${documentName}${suffix}.stl`, STL_TYPE);
  if (!target) return false;
  const engine = await getEngine();
  const bytes = await engine.exportStl({
    body_ids: bodyIds,
    linear_deflection: 0.15,
    angular_deflection: 0.35,
    include_appearance: false,
  });
  await writeSaveTarget(target, bytes);
  return true;
}

export async function export3mf(selectedOnly: boolean): Promise<boolean> {
  const state = useAppStore.getState();
  const bodyIds = meshExportBodyIds(selectedOnly);
  const documentName = withoutExtension(state.document?.name ?? state.projectFileName ?? 'Untitled');
  const suffix = selectedOnly && state.selectedBody !== null ? `-Body${state.selectedBody}` : '';
  const target = await chooseSaveTarget(`${documentName}${suffix}.3mf`, THREEMF_TYPE);
  if (!target) return false;
  const engine = await getEngine();
  const bytes = await engine.export3mf({
    body_ids: bodyIds,
    linear_deflection: 0.15,
    angular_deflection: 0.35,
    include_appearance: true,
    slicer_target: (await import('../materials')).readSlicerTarget(),
  });
  await writeSaveTarget(target, bytes);
  return true;
}

function bytesToBase64(bytes: Uint8Array): string {
  // Keep every intermediate chunk divisible by three so independently
  // encoded chunks concatenate into one valid base64 stream.
  const chunkSize = 3 * 16_384;
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    let binary = '';
    for (let index = 0; index < chunk.length; index += 1) {
      binary += String.fromCharCode(chunk[index]);
    }
    chunks.push(btoa(binary));
  }
  return chunks.join('');
}

/** Add a STEP/STP file to the current parametric history. The original
 * exchange bytes are embedded in the project archive so recompute works on
 * browser, macOS, and Windows without retaining an external file path. */
export async function importStep(): Promise<boolean> {
  const state = useAppStore.getState();
  if (state.activeSketch) {
    throw new Error(translate('file.finishBeforeStepImport'));
  }
  const opened = await chooseOpenFile(STEP_TYPE);
  if (!opened) return false;
  if (opened.bytes.byteLength > MAX_STEP_IMPORT_BYTES) {
    throw new Error(translate('file.stepImportTooLarge'));
  }

  const previousBodies = new Set(state.solidScene.bodies.map((body) => body.id));
  state.setSolidBusy(true);
  try {
    const engine = await getEngine();
    const update = await engine.bodyFeature({
      type: 'import_step',
      request: {
        file_name: opened.name,
        data_base64: bytesToBase64(opened.bytes),
      },
    });
    state.applySolidUpdate(update);
    const imported = update.scene.bodies.find(
      (body) => !previousBodies.has(body.id),
    );
    state.setSelectedBody(imported?.id ?? null);
    state.setSelectedFace(null);
    state.setSelectedEdges([]);
    const bodiesFolder = update.document.browser.find(
      (node) => node.kind === 'bodies_folder',
    );
    if (
      bodiesFolder &&
      !useAppStore.getState().expanded[bodiesFolder.id]
    ) {
      state.toggleExpanded(bodiesFolder.id);
    }
    return true;
  } finally {
    state.setSolidBusy(false);
  }
}

/** Periodic JSON recovery is intentionally separate from the user-owned
 * ZIP. It is never authoritative after a successful Save/Open. */
export function installProjectRecovery(): () => void {
  let timer: number | null = null;
  // Do not treat a clean, freshly bootstrapped document as permission to
  // erase the previous process's emergency snapshot. This session owns the
  // recovery slot only after it has produced unsaved work of its own.
  let sessionOwnsRecovery = false;
  const schedule = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    // Initial engine registration runs asynchronously. Startup intentionally
    // ignores the old snapshot, but retains it as a last-resort fallback.
    if (useAppStore.getState().projectTabs.length === 0) return;
    if (!hasUnsavedProjects()) {
      if (sessionOwnsRecovery) clearProjectRecovery();
      return;
    }
    sessionOwnsRecovery = true;
    timer = window.setTimeout(async () => {
      try {
        const recovery = await collectRecoverableProjectTabs();
        if (recovery.tabs.length === 0) return;
        localStorage.setItem(
          AUTOSAVE_KEY,
          JSON.stringify({
            schema_version: 2,
            saved_at: new Date().toISOString(),
            active_tab_id: recovery.activeTabId,
            tabs: recovery.tabs.map((tab) => ({
              id: tab.id,
              name: tab.name,
              file_name: tab.fileName,
              model_json: tab.modelJson,
            })),
          }),
        );
      } catch {
        // Recovery is best-effort; explicit Save continues to surface errors.
      }
    }, 2_000);
  };
  const unsubscribe = useAppStore.subscribe(schedule);
  schedule();
  return () => {
    unsubscribe();
    if (timer !== null) window.clearTimeout(timer);
  };
}

export async function offerProjectRecovery(): Promise<boolean> {
  const recoveryEntryValue = recoveryEntry();
  if (!recoveryEntryValue) return false;
  if (!window.confirm(translate('file.recoverConfirm'))) return false;
  try {
    const recovery = JSON.parse(recoveryEntryValue.value) as {
      model_json?: unknown;
      active_tab_id?: unknown;
      tabs?: unknown;
    };
    let recoveredTabs: RecoverableProjectTab[];
    let activeTabId: string | null;
    if (Array.isArray(recovery.tabs)) {
      const recoveredIds = new Set<string>();
      recoveredTabs = recovery.tabs.map((entry, index) => {
        if (
          typeof entry !== 'object' ||
          entry === null ||
          typeof (entry as { model_json?: unknown }).model_json !== 'string'
        ) {
          throw new Error(translate('file.recoveryInvalid'));
        }
        const value = entry as {
          id?: unknown;
          name?: unknown;
          file_name?: unknown;
          model_json: string;
        };
        const requestedId =
          typeof value.id === 'string' && value.id ? value.id : null;
        const id =
          requestedId && !recoveredIds.has(requestedId)
            ? requestedId
            : `recovered-${Date.now()}-${index}`;
        recoveredIds.add(id);
        return {
          id,
          name:
            typeof value.name === 'string' && value.name
              ? value.name
              : translate('app.untitledDocument'),
          fileName:
            typeof value.file_name === 'string' ? value.file_name : null,
          modelJson: value.model_json,
        };
      });
      activeTabId =
        typeof recovery.active_tab_id === 'string'
          ? recovery.active_tab_id
          : null;
    } else if (typeof recovery.model_json === 'string') {
      const id = `recovered-${Date.now()}`;
      recoveredTabs = [{
        id,
        name: translate('app.untitledDocument'),
        fileName: 'Recovered.nbcad',
        modelJson: recovery.model_json,
      }];
      activeTabId = id;
    } else {
      throw new Error(translate('file.recoveryInvalid'));
    }
    const restored = await restoreProjectTabs(recoveredTabs, activeTabId);
    if (!restored) throw new Error(translate('file.recoveryInvalid'));
    if (recoveryEntryValue.key !== AUTOSAVE_KEY) {
      localStorage.removeItem(recoveryEntryValue.key);
    }
    return true;
  } catch (error) {
    localStorage.removeItem(recoveryEntryValue.key);
    throw error;
  }
}
