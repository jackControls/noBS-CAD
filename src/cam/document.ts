import type {
  CamDocumentDto,
  CamDrillCycle,
  CamOperationDto,
  CamPostConfigDto,
  CamSetupDto,
  CamStockSpecDto,
  CamToolDto,
  CamUnits,
  CamWcsOriginSpec,
  CamWorkOffset,
} from '../engine/types';
import { useAppStore } from '../store/appStore';
import {
  addCentralLibraryTool,
  centralLibraryTool,
  publishToolToCentralLibrary,
} from './library';
import {
  modelBoundsOfBodies,
  resolveStock,
  resolveWcsOrigin,
  stockToSetup,
  wcsFromOrientation,
} from './geometry';

type CamOperationKind = CamOperationDto['kind'];
type MutableCamSetup = CamSetupDto;
type MutableCamOperation = CamOperationDto;

let writeQueue: Promise<void> = Promise.resolve();

/**
 * Entering the manufacturing workspace never creates or edits anything. The
 * operator builds setups, tools, and operations one explicit action at a
 * time (or drives the same document through the MCP tools).
 */
export function enterCamWorkspace(): Promise<void> {
  const state = useAppStore.getState();
  if (state.mode !== 'solid') {
    return Promise.reject(new Error('Finish the active sketch before opening CAM.'));
  }
  if (state.solidScene.errors.length > 0) {
    return Promise.reject(new Error('Resolve timeline errors before creating toolpaths.'));
  }
  if (state.solidScene.bodies.length === 0) {
    return Promise.reject(new Error('Create or import a solid body before opening CAM.'));
  }
  const setup = activeCamSetup(state.camDocument);
  state.setSelectedCamSetupId(setup?.id ?? null);
  state.setSelectedCamOperationId(setup?.operations[0]?.id ?? null);
  state.setActiveTab('cam');
  // No library synchronisation happens here: the project keeps its own tool
  // snapshots and the operator imports from the central library explicitly.
  return Promise.resolve();
}

export function leaveCamWorkspace(): void {
  const state = useAppStore.getState();
  state.setSelectedCamSetupId(null);
  state.setSelectedCamOperationId(null);
  state.setActiveTab('solid');
}

export function setCamUnits(units: CamUnits): Promise<void> {
  return enqueueCamUpdate((cam) => {
    if (cam.units === units) return cam;
    const next = structuredClone(cam);
    next.units = units;
    return next;
  });
}

/** Remember the post configuration chosen at the last NC export; it only
 *  pre-fills the next export dialog. Toolpath planning never reads it. */
export function setCamPostDefaults(config: CamPostConfigDto): Promise<void> {
  return enqueueCamUpdate((cam) => {
    const next = structuredClone(cam);
    next.post_defaults = structuredClone(config);
    return next;
  });
}

// --- Tool library ----------------------------------------------------------

export type CamToolDraft = Omit<CamToolDto, 'id'>;

/** Add one operator-defined tool to the project library. The id is
 *  allocated by the central library (which also receives a copy), so ids
 *  stay unique across projects on this machine; off the desktop runtime the
 *  project's own counter allocates. Nothing is created implicitly — the
 *  library is the only source of tools for operations. */
export async function addCamTool(draft: CamToolDraft): Promise<number> {
  const centralTool = await addCentralLibraryTool(draft);
  let createdId = 0;
  await enqueueCamUpdate((cam) => {
    const next = structuredClone(cam);
    let id = centralTool?.id ?? next.next_tool_id;
    // Defensive: never collide with a snapshot the project already holds.
    const taken = new Set(next.tools.map((tool) => tool.id));
    while (taken.has(id)) id += 1;
    const tool: CamToolDto = { ...structuredClone(draft), id };
    next.tools.push(tool);
    next.tools.sort((a, b) => a.id - b.id);
    next.next_tool_id = Math.max(next.next_tool_id, id + 1);
    createdId = id;
    return next;
  });
  return createdId;
}

/** Import (or refresh) a central-library tool as a project snapshot. The
 *  same-id snapshot is replaced outright: operations keep their own copied
 *  cutting data, and geometry edits are exactly what the operator asked for
 *  by pulling the update in. */
export async function importCamToolFromCentral(toolId: number): Promise<void> {
  const central = await centralLibraryTool(toolId);
  if (!central) throw new Error('That tool is no longer in the central library.');
  await enqueueCamUpdate((cam) => {
    const next = structuredClone(cam);
    const index = next.tools.findIndex((candidate) => candidate.id === toolId);
    if (index >= 0) next.tools[index] = structuredClone(central);
    else next.tools.push(structuredClone(central));
    next.tools.sort((a, b) => a.id - b.id);
    next.next_tool_id = Math.max(next.next_tool_id, toolId + 1);
    return next;
  });
}

/** Publish a project snapshot back into the central collection, replacing
 *  the same-id entry there. */
export async function publishCamToolToCentral(toolId: number): Promise<void> {
  const tool = useAppStore.getState().camDocument.tools.find((candidate) => candidate.id === toolId);
  if (!tool) return;
  await publishToolToCentralLibrary(tool);
}

export function deleteCamTool(toolId: number): Promise<void> {
  return enqueueCamUpdate((cam) => {
    const referenced = cam.setups
      .flatMap((setup) => setup.operations)
      .some((operation) => operation.tool_id === toolId);
    if (referenced) {
      throw new Error('This tool is used by an operation; reassign those operations first.');
    }
    const next = structuredClone(cam);
    const before = next.tools.length;
    next.tools = next.tools.filter((tool) => tool.id !== toolId);
    return next.tools.length === before ? cam : next;
  });
}

// --- Setups ----------------------------------------------------------------

export interface CamSetupDraft {
  name: string;
  body_ids: number[];
  /** First work offset (e.g. G54) the program posts with. */
  work_offset: CamWorkOffset;
  /** Duplicate part count: the posted program repeats the toolpaths under
   *  this many consecutive offsets starting at `work_offset`. */
  work_offset_count: number;
  /** Operator's stock definition; resolved against the live scene here. */
  stock_spec: CamStockSpecDto;
  wcs_origin: CamWcsOriginSpec;
  /** Explicit origin used when `wcs_origin.mode === 'explicit'`, model mm. */
  explicit_origin: { x: number; y: number; z: number };
  z_down: boolean;
  z_rotation_deg: 0 | 90 | 180 | 270;
}

/** Create an empty setup from a fully operator-specified draft. The setup
 *  starts with zero operations; toolpaths are programmed one by one. */
export function createCamSetup(draft: CamSetupDraft): Promise<number> {
  let createdId = 0;
  return enqueueCamUpdate((cam, state) => {
    if (draft.body_ids.length === 0) {
      throw new Error('A CAM setup needs at least one solid body.');
    }
    const partBounds = modelBoundsOfBodies(state.solidScene, draft.body_ids);
    // Modeled-body stock is measured from the stock body's mesh, not the parts.
    const stockBounds =
      draft.stock_spec.mode === 'model_body'
        ? modelBoundsOfBodies(state.solidScene, [draft.stock_spec.body_id])
        : partBounds;
    const sourceSetup =
      draft.stock_spec.mode === 'rest_from_setup'
        ? cam.setups.find((setup) => setup.id === (draft.stock_spec as { setup_id: number }).setup_id) ?? null
        : null;
    const resolved = resolveStock(
      draft.stock_spec,
      stockBounds,
      sourceSetup,
      draft.z_rotation_deg,
    );
    // Rest machining inherits the source setup's WCS: the remaining material
    // is only meaningful in the frame that produced it.
    const inheritWcs = draft.stock_spec.mode === 'rest_from_setup' && sourceSetup !== null;
    const origin =
      draft.wcs_origin.mode === 'explicit'
        ? draft.explicit_origin
        : resolveWcsOrigin(
            draft.wcs_origin,
            resolved.modelBox,
            partBounds,
            state.finishedSketches,
          );
    const wcs = inheritWcs
      ? sourceSetup.wcs
      : wcsFromOrientation(origin, draft.z_down, draft.z_rotation_deg);
    const stock = stockToSetup(resolved.modelBox, wcs);
    const next = structuredClone(cam);
    const setup: CamSetupDto = {
      id: next.next_setup_id,
      name: draft.name.trim() || `Setup ${next.setups.length + 1}`,
      wcs,
      wcs_origin: inheritWcs ? sourceSetup.wcs_origin : draft.wcs_origin,
      work_offset: draft.work_offset,
      work_offset_count: Math.max(1, Math.min(6, Math.round(draft.work_offset_count))),
      stock_spec: draft.stock_spec,
      resolved_stock: resolved.resolve(wcs),
      stock,
      stock_model_box: resolved.modelBox,
      body_ids: draft.body_ids,
      operations: [],
    };
    next.setups.push(setup);
    next.active_setup_id = setup.id;
    next.next_setup_id += 1;
    createdId = setup.id;
    return next;
  }).then(() => {
    const state = useAppStore.getState();
    state.setSelectedCamSetupId(createdId);
    state.setSelectedCamOperationId(null);
    return createdId;
  });
}

export function deleteCamSetup(setupId: number): Promise<void> {
  return enqueueCamUpdate((cam) => {
    const next = structuredClone(cam);
    const before = next.setups.length;
    next.setups = next.setups.filter((setup) => setup.id !== setupId);
    if (next.setups.length === before) return cam;
    if (next.active_setup_id === setupId) {
      next.active_setup_id = next.setups[0]?.id ?? null;
    }
    queueMicrotask(() => {
      const state = useAppStore.getState();
      state.setSelectedCamSetupId(next.active_setup_id);
      state.setSelectedCamOperationId(null);
    });
    return next;
  });
}

export function setActiveCamSetup(setupId: number): Promise<void> {
  return enqueueCamUpdate((cam) => {
    if (!cam.setups.some((setup) => setup.id === setupId)) return cam;
    const next = structuredClone(cam);
    next.active_setup_id = setupId;
    queueMicrotask(() => {
      const state = useAppStore.getState();
      state.setSelectedCamSetupId(setupId);
      state.setSelectedCamOperationId(null);
    });
    return next;
  });
}

// --- Operations ------------------------------------------------------------

/** Operations are appended exactly as the operator programmed them in the
 *  operation dialog. Geometry, tool, heights, and feeds are all explicit;
 *  validation in the engine rejects incomplete input. */
export function addCamOperation(operation: CamOperationInput): Promise<void> {
  return enqueueCamUpdate((cam) => {
    const next = structuredClone(cam);
    const setup = activeCamSetup(next);
    if (!setup) throw new Error('Create a CAM setup first.');
    const id = next.next_operation_id;
    setup.operations.push({ ...operation, id } as CamOperationDto);
    next.next_operation_id += 1;
    queueMicrotask(() => {
      const store = useAppStore.getState();
      store.setSelectedCamSetupId(setup.id);
      store.setSelectedCamOperationId(id);
    });
    return next;
  });
}

/** `Omit` does not distribute over unions; this keeps each operation
 *  variant intact so object literals type-check per kind. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type CamOperationInput = DistributiveOmit<CamOperationDto, 'id'>;

export function deleteCamOperation(operationId: number): Promise<void> {
  return enqueueCamUpdate((cam) => {
    const next = structuredClone(cam);
    let changed = false;
    for (const setup of next.setups) {
      const before = setup.operations.length;
      setup.operations = setup.operations.filter((operation) => operation.id !== operationId);
      changed ||= before !== setup.operations.length;
    }
    if (!changed) return cam;
    queueMicrotask(() => useAppStore.getState().setSelectedCamOperationId(null));
    return next;
  });
}

export function updateCamSetup(
  setupId: number,
  mutate: (setup: MutableCamSetup) => void,
): Promise<void> {
  return enqueueCamUpdate((cam) => {
    const next = structuredClone(cam);
    const setup = next.setups.find((candidate) => candidate.id === setupId);
    if (!setup) return cam;
    mutate(setup);
    return next;
  });
}

export function updateCamOperation(
  operationId: number,
  mutate: (operation: MutableCamOperation) => void,
): Promise<void> {
  return enqueueCamUpdate((cam) => {
    const next = structuredClone(cam);
    const operation = next.setups
      .flatMap((setup) => setup.operations)
      .find((candidate) => candidate.id === operationId);
    if (!operation) return cam;
    mutate(operation);
    return next;
  });
}

/** Edit the project's snapshot of a tool. The central library is NOT
 *  touched — syncing back is the operator's explicit choice
 *  (`publishCamToolToCentral`). */
export function updateCamTool(
  toolId: number,
  mutate: (tool: CamToolDto) => void,
): Promise<void> {
  return enqueueCamUpdate((cam) => {
    const next = structuredClone(cam);
    const tool = next.tools.find((candidate) => candidate.id === toolId);
    if (!tool) return cam;
    mutate(tool);
    return next;
  });
}

export function activeCamSetup(cam: CamDocumentDto): CamSetupDto | null {
  return cam.setups.find((setup) => setup.id === cam.active_setup_id) ?? null;
}

export function findCamOperation(
  cam: CamDocumentDto,
  operationId: number | null,
): CamOperationDto | null {
  if (operationId === null) return null;
  return (
    cam.setups
      .flatMap((setup) => setup.operations)
      .find((operation) => operation.id === operationId) ?? null
  );
}

export function camOperationLabel(kind: CamOperationKind): string {
  switch (kind) {
    case 'face':
      return 'Face';
    case 'contour2d':
      return '2D Contour';
    case 'pocket2d':
      return '2D Pocket';
    case 'chamfer2d':
      return '2D Chamfer';
    case 'drill':
      return 'Drill';
    case 'thread':
      return 'Thread';
  }
}

/** True when an operation kind can use the given tool kind. Drill operations
 *  are cycle-aware: tapping needs a tap, reaming a reamer, boring a boring
 *  bar, and the drilling cycles a drill or any center-cutting tool. Facing
 *  enters from outside the stock boundary, so plunge capability is not
 *  required — but the cutter still needs a flat-ish bottom edge: flat and
 *  bull-nose end mills and face mills only (ball noses scallop, chamfer
 *  mills cut on an angled edge, thread mills cannot side-mill at all).
 *  Pocket/contour entries still plunge into material and keep their
 *  restrictions. */
export function camToolCompatible(
  kind: CamOperationKind,
  tool: CamToolDto,
  drillCycle?: CamDrillCycle,
): boolean {
  switch (kind) {
    case 'face':
      return (
        tool.kind === 'flat_end_mill' ||
        tool.kind === 'bull_nose_end_mill' ||
        tool.kind === 'face_mill'
      );
    case 'pocket2d':
      return (
        (tool.kind === 'flat_end_mill' || tool.kind === 'ball_end_mill' || tool.kind === 'bull_nose_end_mill' || tool.kind === 'face_mill') && tool.center_cutting
      );
    case 'contour2d':
      return tool.kind === 'flat_end_mill' || tool.kind === 'ball_end_mill' || tool.kind === 'bull_nose_end_mill' || tool.kind === 'face_mill';
    case 'chamfer2d':
      return tool.kind === 'chamfer_mill';
    case 'drill':
      switch (drillCycle ?? 'drill') {
        case 'tapping_right':
        case 'tapping_left':
          return tool.kind === 'tap';
        case 'reaming':
          return tool.kind === 'reamer';
        case 'boring':
          return tool.kind === 'boring_bar';
        default:
          return tool.kind === 'drill' || tool.center_cutting;
      }
    case 'thread':
      return tool.kind === 'thread_mill';
  }
}

function enqueueCamUpdate(
  mutate: (
    cam: CamDocumentDto,
    state: ReturnType<typeof useAppStore.getState>,
  ) => CamDocumentDto,
): Promise<void> {
  const operation = writeQueue.then(async () => {
    const state = useAppStore.getState();
    const next = mutate(state.camDocument, state);
    if (next === state.camDocument) return;
    await state.setCamDocument(next);
  });
  writeQueue = operation.catch(() => undefined);
  return operation;
}
