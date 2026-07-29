import { getEngine } from '../engine';
import { translate } from '../i18n';
import { useAppStore } from '../store/appStore';
import {
  chooseOpenFile,
  chooseSaveTarget,
  writeSaveTarget,
  type SaveTarget,
  type SaveType,
} from './fileIO';
import {
  createNbcadArchive,
  readNbcadArchive,
  LEGACY_PROJECT_EXTENSION,
  NBCAD_EXTENSION,
} from './nbcad';

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

let currentProjectTarget: SaveTarget | null = null;

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
  const existingTarget = !saveAs ? currentProjectTarget : null;
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
  try {
    const modelJson = await engine.exportProjectModel();
    await writeSaveTarget(target, createNbcadArchive(modelJson));
  } catch (error) {
    if (designName !== originalName) {
      await engine.setDocumentName(originalName).catch(() => undefined);
    }
    throw error;
  }
  currentProjectTarget = target.kind === 'download' ? null : target;
  useAppStore.setState({
    document,
    dirty: false,
    projectFileName: target.name,
  });
  clearProjectRecovery();
  return true;
}

async function resetCurrentProject(mode: 'new' | 'close'): Promise<boolean> {
  const state = useAppStore.getState();
  const confirmationKey =
    mode === 'new' ? 'file.newDiscardConfirm' : 'file.closeDiscardConfirm';
  if (state.dirty && !window.confirm(translate(confirmationKey))) {
    return false;
  }

  const update = await (await getEngine()).newProject();
  currentProjectTarget = null;
  clearProjectRecovery();
  useAppStore.getState().loadProjectState(update, [], [], null);
  return true;
}

/** Start a fresh untitled design in both the UI and the host engine. */
export function newProject(): Promise<boolean> {
  return resetCurrentProject('new');
}

/** Close the visible design and immediately replace the last tab with Untitled. */
export function closeProject(): Promise<boolean> {
  return resetCurrentProject('close');
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
  const [finishedSketches, datumPlanes, bodyAppearances] = await Promise.all([
    engine.finishedSketches(),
    engine.datumPlaneDefinitions(),
    engine.bodyAppearances(),
  ]);
  // A legacy project is readable, but the next Save must choose a new
  // `.nbcad` destination instead of silently overwriting the old container.
  currentProjectTarget = opened.name.toLowerCase().endsWith(NBCAD_EXTENSION)
    ? opened.writableTarget
    : null;
  useAppStore
    .getState()
    .loadProjectState(update, finishedSketches, datumPlanes, opened.name, bodyAppearances);
  clearProjectRecovery();
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
  const schedule = () => {
    if (timer !== null) window.clearTimeout(timer);
    const state = useAppStore.getState();
    if (!state.dirty || state.activeSketch) return;
    timer = window.setTimeout(async () => {
      try {
        const modelJson = await (await getEngine()).exportProjectModel();
        localStorage.setItem(
          AUTOSAVE_KEY,
          JSON.stringify({ saved_at: new Date().toISOString(), model_json: modelJson }),
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
    const recovery = JSON.parse(recoveryEntryValue.value) as { model_json?: unknown };
    if (typeof recovery.model_json !== 'string') {
      throw new Error(translate('file.recoveryInvalid'));
    }
    const engine = await getEngine();
    const update = await engine.loadProjectModel(recovery.model_json);
    const [finishedSketches, datumPlanes, bodyAppearances] = await Promise.all([
      engine.finishedSketches(),
      engine.datumPlaneDefinitions(),
      engine.bodyAppearances(),
    ]);
    currentProjectTarget = null;
    useAppStore
      .getState()
      .loadProjectState(
        update,
        finishedSketches,
        datumPlanes,
        'Recovered.nbcad',
        bodyAppearances,
      );
    useAppStore.getState().markDirty();
    if (recoveryEntryValue.key !== AUTOSAVE_KEY) {
      localStorage.removeItem(recoveryEntryValue.key);
    }
    return true;
  } catch (error) {
    localStorage.removeItem(recoveryEntryValue.key);
    throw error;
  }
}
