import type {
  CamDocumentDto,
  CamOperationDto,
  CamPoint2Dto,
  CamSetupDto,
  CamToolDto,
  CamToolKind,
  CamWorkCoordinateSystemDto,
  Point3Dto,
  SolidSceneDto,
} from '../engine/types';
import { useAppStore } from '../store/appStore';

type CamOperationKind = CamOperationDto['kind'];
type MutableCamSetup = CamSetupDto;
type MutableCamOperation = CamOperationDto;

let writeQueue: Promise<void> = Promise.resolve();

export function enterCamWorkspace(): Promise<void> {
  return enqueueCamUpdate((cam, state) => {
    if (state.mode !== 'solid') {
      throw new Error('Finish the active sketch before opening CAM.');
    }
    if (state.solidScene.errors.length > 0) {
      throw new Error('Resolve timeline errors before creating toolpaths.');
    }
    if (state.solidScene.bodies.length === 0) {
      throw new Error('Create or import a solid body before opening CAM.');
    }
    if (cam.setups.length > 0) return cam;
    return appendDefaultSetup(cam, state.solidScene, selectedBodyIds(state));
  }).then(() => {
    const state = useAppStore.getState();
    const setupId = state.camDocument.active_setup_id;
    state.setSelectedCamSetupId(setupId);
    state.setSelectedCamOperationId(
      state.camDocument.setups.find((setup) => setup.id === setupId)?.operations[0]?.id ?? null,
    );
    state.setActiveTab('cam');
  });
}

export function leaveCamWorkspace(): void {
  const state = useAppStore.getState();
  state.setSelectedCamSetupId(null);
  state.setSelectedCamOperationId(null);
  state.setActiveTab('solid');
}

export function addCamSetup(): Promise<void> {
  return enqueueCamUpdate((cam, state) => {
    if (state.solidScene.bodies.length === 0) {
      throw new Error('A CAM setup needs at least one solid body.');
    }
    return appendDefaultSetup(cam, state.solidScene, selectedBodyIds(state));
  }).then(() => {
    const state = useAppStore.getState();
    state.setSelectedCamSetupId(state.camDocument.active_setup_id);
    const setup = activeCamSetup(state.camDocument);
    state.setSelectedCamOperationId(setup?.operations[0]?.id ?? null);
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

export function addCamOperation(kind: CamOperationKind): Promise<void> {
  return enqueueCamUpdate((cam, state) => {
    const next = structuredClone(cam);
    const setup = activeCamSetup(next);
    if (!setup) throw new Error('Create a CAM setup first.');
    const operation = defaultOperation(
      kind,
      next.next_operation_id,
      setup,
      next.tools,
      state.solidScene,
    );
    setup.operations.push(operation);
    next.next_operation_id += 1;
    queueMicrotask(() => {
      const store = useAppStore.getState();
      store.setSelectedCamSetupId(setup.id);
      store.setSelectedCamOperationId(operation.id);
    });
    return next;
  });
}

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

export function findCamOperation(cam: CamDocumentDto, operationId: number | null): CamOperationDto | null {
  if (operationId === null) return null;
  return cam.setups
    .flatMap((setup) => setup.operations)
    .find((operation) => operation.id === operationId) ?? null;
}

export function camOperationLabel(kind: CamOperationKind): string {
  switch (kind) {
    case 'face': return 'Face';
    case 'contour2d': return '2D Contour';
    case 'drill': return 'Drill';
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

function appendDefaultSetup(
  cam: CamDocumentDto,
  scene: SolidSceneDto,
  bodyIds: number[],
): CamDocumentDto {
  const world = sceneBounds(scene, bodyIds);
  if (!world) throw new Error('The selected bodies have no machinable mesh.');
  const next = structuredClone(cam);
  const flatTool = ensureTool(next, 'flat_end_mill');
  ensureTool(next, 'drill');

  const margin = 2;
  const topAllowance = 1;
  const bottomAllowance = 2;
  const width = world.max.x - world.min.x;
  const depth = world.max.y - world.min.y;
  const height = world.max.z - world.min.z;
  const setupId = next.next_setup_id;
  const operationId = next.next_operation_id;
  const setup: CamSetupDto = {
    id: setupId,
    name: `Setup ${next.setups.length + 1}`,
    wcs: {
      origin: {
        x: world.min.x - margin,
        y: world.min.y - margin,
        z: world.max.z + topAllowance,
      },
      x_axis: [1, 0, 0],
      y_axis: [0, 1, 0],
      z_axis: [0, 0, 1],
    },
    work_offset: 'g54',
    stock: {
      min: { x: 0, y: 0, z: -(height + topAllowance + bottomAllowance) },
      max: { x: width + margin * 2, y: depth + margin * 2, z: 0 },
    },
    body_ids: bodyIds,
    clearance_z: 10,
    retract_z: 3,
    rapid_feed: 3000,
    post: {
      dialect: 'grbl',
      program_number: 1001,
      sequence_numbers: false,
      siemens_828d: null,
    },
    operations: [{
      kind: 'face',
      id: operationId,
      name: 'Face stock',
      enabled: true,
      tool_id: flatTool.id,
      bounds: {
        min: { x: 0, y: 0 },
        max: { x: width + margin * 2, y: depth + margin * 2 },
      },
      top_z: 0,
      target_z: -topAllowance,
      step_over: flatTool.diameter * 0.6,
      step_down: Math.min(1, topAllowance),
      cutting: defaultCutting('face'),
    }],
  };
  next.setups.push(setup);
  next.active_setup_id = setupId;
  next.next_setup_id += 1;
  next.next_operation_id += 1;
  return next;
}

function defaultOperation(
  kind: CamOperationKind,
  id: number,
  setup: CamSetupDto,
  tools: CamToolDto[],
  scene: SolidSceneDto,
): CamOperationDto {
  const part = sceneBoundsInSetup(scene, setup.body_ids, setup.wcs) ?? setup.stock;
  const topZ = clamp(part.max.z, setup.stock.min.z + 0.1, setup.stock.max.z - 0.001);
  const bottomZ = Math.max(part.min.z, topZ - (kind === 'drill' ? 5 : 2));
  if (bottomZ >= topZ - 0.001) {
    throw new Error('The setup geometry has no usable cutting depth.');
  }
  const count = setup.operations.filter((operation) => operation.kind === kind).length + 1;
  if (kind === 'face') {
    const tool = firstTool(tools, 'flat_end_mill');
    return {
      kind,
      id,
      name: `Face ${count}`,
      enabled: true,
      tool_id: tool.id,
      bounds: {
        min: { x: setup.stock.min.x, y: setup.stock.min.y },
        max: { x: setup.stock.max.x, y: setup.stock.max.y },
      },
      top_z: setup.stock.max.z,
      target_z: Math.max(setup.stock.min.z, setup.stock.max.z - 1),
      step_over: tool.diameter * 0.6,
      step_down: 1,
      cutting: defaultCutting(kind),
    };
  }
  if (kind === 'contour2d') {
    const tool = firstTool(tools, 'flat_end_mill');
    return {
      kind,
      id,
      name: `2D Contour ${count}`,
      enabled: true,
      tool_id: tool.id,
      path: rectanglePath(part.min, part.max),
      top_z: topZ,
      bottom_z: bottomZ,
      step_down: Math.min(2, topZ - bottomZ),
      compensation: 'outside',
      cutting: defaultCutting(kind),
    };
  }
  const tool = firstTool(tools, 'drill');
  return {
    kind,
    id,
    name: `Drill ${count}`,
    enabled: true,
    tool_id: tool.id,
    points: [{
      x: (part.min.x + part.max.x) * 0.5,
      y: (part.min.y + part.max.y) * 0.5,
    }],
    top_z: topZ,
    bottom_z: bottomZ,
    retract_z: Math.min(setup.clearance_z, Math.max(setup.retract_z, topZ + 2)),
    peck_depth: Math.min(3, topZ - bottomZ),
    dwell_seconds: 0,
    cutting: defaultCutting(kind),
  };
}

function defaultCutting(kind: CamOperationKind) {
  return kind === 'drill'
    ? { spindle_rpm: 5000, feed_xy: 250, feed_z: 150, coolant: 'off' as const }
    : { spindle_rpm: 12000, feed_xy: 800, feed_z: 220, coolant: 'off' as const };
}

function ensureTool(cam: CamDocumentDto, kind: CamToolKind): CamToolDto {
  const existing = cam.tools.find((tool) => tool.kind === kind);
  if (existing) return existing;
  const id = cam.next_tool_id;
  const number = Math.max(0, ...cam.tools.map((tool) => tool.number)) + 1;
  const drill = kind === 'drill';
  const tool: CamToolDto = {
    id,
    number,
    name: drill ? '5 mm drill' : '6 mm flat end mill',
    kind,
    diameter: drill ? 5 : 6,
    flute_length: drill ? 30 : 20,
    overall_length: drill ? 60 : 50,
    center_cutting: true,
  };
  cam.tools.push(tool);
  cam.next_tool_id += 1;
  return tool;
}

function firstTool(tools: CamToolDto[], kind: CamToolKind): CamToolDto {
  const tool = tools.find((candidate) => candidate.kind === kind);
  if (!tool) throw new Error(`The CAM tool library has no ${kind.replace(/_/g, ' ')}.`);
  return tool;
}

function selectedBodyIds(state: ReturnType<typeof useAppStore.getState>): number[] {
  const selected = new Set(state.selectedBodies);
  if (state.selectedBody !== null) selected.add(state.selectedBody);
  return selected.size > 0
    ? [...selected]
    : state.solidScene.bodies.map((body) => body.id);
}

interface Bounds3 {
  min: Point3Dto;
  max: Point3Dto;
}

function sceneBounds(scene: SolidSceneDto, bodyIds: number[]): Bounds3 | null {
  const wanted = new Set(bodyIds);
  const points: Point3Dto[] = [];
  for (const body of scene.bodies) {
    if (!wanted.has(body.id)) continue;
    for (let index = 0; index + 2 < body.mesh.positions.length; index += 3) {
      points.push({
        x: body.mesh.positions[index],
        y: body.mesh.positions[index + 1],
        z: body.mesh.positions[index + 2],
      });
    }
  }
  return boundsOf(points);
}

function sceneBoundsInSetup(
  scene: SolidSceneDto,
  bodyIds: number[],
  wcs: CamWorkCoordinateSystemDto,
): Bounds3 | null {
  const world = sceneBounds(scene, bodyIds);
  if (!world) return null;
  const corners: Point3Dto[] = [];
  for (const x of [world.min.x, world.max.x]) {
    for (const y of [world.min.y, world.max.y]) {
      for (const z of [world.min.z, world.max.z]) {
        corners.push(modelPointToSetup({ x, y, z }, wcs));
      }
    }
  }
  return boundsOf(corners);
}

function modelPointToSetup(point: Point3Dto, wcs: CamWorkCoordinateSystemDto): Point3Dto {
  const relative = [
    point.x - wcs.origin.x,
    point.y - wcs.origin.y,
    point.z - wcs.origin.z,
  ];
  const project = (axis: [number, number, number]) =>
    relative[0] * axis[0] + relative[1] * axis[1] + relative[2] * axis[2];
  return { x: project(wcs.x_axis), y: project(wcs.y_axis), z: project(wcs.z_axis) };
}

function boundsOf(points: Point3Dto[]): Bounds3 | null {
  if (points.length === 0) return null;
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const point of points) {
    min.x = Math.min(min.x, point.x);
    min.y = Math.min(min.y, point.y);
    min.z = Math.min(min.z, point.z);
    max.x = Math.max(max.x, point.x);
    max.y = Math.max(max.y, point.y);
    max.z = Math.max(max.z, point.z);
  }
  return { min, max };
}

function rectanglePath(min: Point3Dto, max: Point3Dto): CamPoint2Dto[] {
  return [
    { x: min.x, y: min.y },
    { x: max.x, y: min.y },
    { x: max.x, y: max.y },
    { x: min.x, y: max.y },
  ];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
