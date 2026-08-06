import type {
  DrawingDocumentDto,
  DrawingSheetDto,
  DrawingViewDto,
  DrawingViewKind,
  SolidSceneDto,
} from '../engine/types';
import { useAppStore } from '../store/appStore';

let writeQueue: Promise<void> = Promise.resolve();

export function enterDrawingWorkspace(): Promise<void> {
  return enqueueDrawingUpdate((drawing, state) => {
    if (state.mode !== 'solid') {
      throw new Error('Finish the active sketch before opening Drawings.');
    }
    const next = drawing.sheets.length === 0
      ? createFirstDrawing(drawing, state.document?.name ?? 'Untitled', state.solidScene)
      : drawing;
    return next;
  }).then(() => useAppStore.getState().setActiveTab('drawing'));
}

export function leaveDrawingWorkspace(): void {
  useAppStore.getState().setSelectedDrawingViewId(null);
  useAppStore.getState().setActiveTab('solid');
}

export function addDrawingSheet(): Promise<void> {
  return enqueueDrawingUpdate((drawing, state) => {
    const next = cloneDrawing(drawing);
    const sheet = standardSheet(
      next.next_sheet_id,
      next.next_view_id,
      `Sheet ${next.sheets.length + 1}`,
      state.document?.name ?? 'Untitled',
      state.solidScene,
    );
    next.sheets.push(sheet);
    next.active_sheet_id = sheet.id;
    next.next_sheet_id += 1;
    next.next_view_id += sheet.views.length;
    queueMicrotask(() => useAppStore.getState().setSelectedDrawingViewId(null));
    return next;
  });
}

export function setActiveDrawingSheet(sheetId: number): Promise<void> {
  return enqueueDrawingUpdate((drawing) => {
    if (!drawing.sheets.some((sheet) => sheet.id === sheetId)) return drawing;
    const next = cloneDrawing(drawing);
    next.active_sheet_id = sheetId;
    queueMicrotask(() => useAppStore.getState().setSelectedDrawingViewId(null));
    return next;
  });
}

export function deleteDrawingSheet(sheetId: number): Promise<void> {
  return enqueueDrawingUpdate((drawing) => {
    if (drawing.sheets.length <= 1) {
      throw new Error('A drawing must keep at least one sheet.');
    }
    const next = cloneDrawing(drawing);
    next.sheets = next.sheets.filter((sheet) => sheet.id !== sheetId);
    if (next.active_sheet_id === sheetId) next.active_sheet_id = next.sheets[0]?.id ?? null;
    queueMicrotask(() => useAppStore.getState().setSelectedDrawingViewId(null));
    return next;
  });
}

export function addDrawingView(kind: DrawingViewKind = 'isometric'): Promise<void> {
  return enqueueDrawingUpdate((drawing, state) => {
    const next = cloneDrawing(drawing);
    const sheet = activeSheet(next);
    if (!sheet) throw new Error('Create a drawing sheet first.');
    const id = next.next_view_id;
    const basis = standardViewBasis(kind);
    sheet.views.push({
      id,
      name: viewLabel(kind),
      kind,
      direction: basis.direction,
      up: basis.up,
      position: [sheet.orientation === 'landscape' ? 148 : 105, 95],
      scale: suggestedViewScale(state.solidScene),
      body_ids: [],
      show_hidden_lines: false,
      show_tangent_edges: false,
    });
    next.next_view_id += 1;
    queueMicrotask(() => useAppStore.getState().setSelectedDrawingViewId(id));
    return next;
  });
}

export function updateDrawingView(
  viewId: number,
  update: Partial<DrawingViewDto>,
): Promise<void> {
  return enqueueDrawingUpdate((drawing) => {
    const next = cloneDrawing(drawing);
    const view = next.sheets.flatMap((sheet) => sheet.views).find((candidate) => candidate.id === viewId);
    if (!view) return drawing;
    Object.assign(view, update);
    return next;
  });
}

export function deleteDrawingView(viewId: number): Promise<void> {
  return enqueueDrawingUpdate((drawing) => {
    const next = cloneDrawing(drawing);
    for (const sheet of next.sheets) {
      sheet.views = sheet.views.filter((view) => view.id !== viewId);
    }
    queueMicrotask(() => useAppStore.getState().setSelectedDrawingViewId(null));
    return next;
  });
}

export function updateActiveDrawingSheet(update: Partial<DrawingSheetDto>): Promise<void> {
  return enqueueDrawingUpdate((drawing) => {
    const next = cloneDrawing(drawing);
    const sheet = activeSheet(next);
    if (!sheet) return drawing;
    Object.assign(sheet, update);
    return next;
  });
}

export function activeDrawingSheet(drawing: DrawingDocumentDto): DrawingSheetDto | null {
  return activeSheet(drawing);
}

function enqueueDrawingUpdate(
  mutate: (
    drawing: DrawingDocumentDto,
    state: ReturnType<typeof useAppStore.getState>,
  ) => DrawingDocumentDto,
): Promise<void> {
  const operation = writeQueue.then(async () => {
    const state = useAppStore.getState();
    const next = mutate(state.drawingDocument, state);
    if (next === state.drawingDocument) return;
    await state.setDrawingDocument(next);
  });
  writeQueue = operation.catch(() => undefined);
  return operation;
}

function createFirstDrawing(
  drawing: DrawingDocumentDto,
  documentName: string,
  scene: SolidSceneDto,
): DrawingDocumentDto {
  const next = cloneDrawing(drawing);
  const sheetId = next.next_sheet_id;
  const firstViewId = next.next_view_id;
  const sheet = standardSheet(sheetId, firstViewId, 'Sheet 1', documentName, scene);
  next.sheets = [sheet];
  next.active_sheet_id = sheet.id;
  next.next_sheet_id = sheetId + 1;
  next.next_view_id = firstViewId + sheet.views.length;
  return next;
}

function standardSheet(
  sheetId: number,
  firstViewId: number,
  name: string,
  documentName: string,
  scene: SolidSceneDto,
): DrawingSheetDto {
  const scale = suggestedViewScale(scene);
  const view = (
    offset: number,
    kind: DrawingViewKind,
    position: [number, number],
  ): DrawingViewDto => {
    const basis = standardViewBasis(kind);
    return {
      id: firstViewId + offset,
      name: viewLabel(kind),
      kind,
      direction: basis.direction,
      up: basis.up,
      position,
      scale,
      body_ids: [],
      show_hidden_lines: false,
      show_tangent_edges: false,
    };
  };
  return {
    id: sheetId,
    name,
    format: 'a4',
    orientation: 'landscape',
    title_block: {
      title: documentName,
      drawing_number: '',
      revision: 'A',
      author: '',
    },
    views: [
      view(0, 'front', [70, 70]),
      view(1, 'top', [70, 145]),
      view(2, 'right', [150, 70]),
      view(3, 'isometric', [220, 115]),
    ],
  };
}

function standardViewBasis(kind: DrawingViewKind): {
  direction: [number, number, number];
  up: [number, number, number];
} {
  switch (kind) {
    case 'front': return { direction: [0, -1, 0], up: [0, 0, 1] };
    case 'rear': return { direction: [0, 1, 0], up: [0, 0, 1] };
    case 'left': return { direction: [-1, 0, 0], up: [0, 0, 1] };
    case 'right': return { direction: [1, 0, 0], up: [0, 0, 1] };
    case 'top': return { direction: [0, 0, 1], up: [0, 1, 0] };
    case 'bottom': return { direction: [0, 0, -1], up: [0, 1, 0] };
    case 'isometric': return { direction: [1, -1, 1], up: [0, 0, 1] };
    case 'custom': return { direction: [1, -1, 1], up: [0, 0, 1] };
  }
}

function viewLabel(kind: DrawingViewKind): string {
  return kind === 'isometric'
    ? 'Isometric'
    : `${kind.charAt(0).toUpperCase()}${kind.slice(1)}`;
}

function suggestedViewScale(scene: SolidSceneDto): number {
  let min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  let max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (const body of scene.bodies) {
    for (let index = 0; index + 2 < body.mesh.positions.length; index += 3) {
      for (let axis = 0; axis < 3; axis += 1) {
        const value = body.mesh.positions[index + axis];
        min[axis] = Math.min(min[axis], value);
        max[axis] = Math.max(max[axis], value);
      }
    }
  }
  const largest = Math.max(...max.map((value, index) => value - min[index]));
  if (!Number.isFinite(largest) || largest <= 0) return 1;
  const target = 52 / largest;
  const standard = [10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01];
  return standard.find((candidate) => candidate <= target) ?? 0.01;
}

function activeSheet(drawing: DrawingDocumentDto): DrawingSheetDto | null {
  return drawing.sheets.find((sheet) => sheet.id === drawing.active_sheet_id) ?? null;
}

function cloneDrawing(drawing: DrawingDocumentDto): DrawingDocumentDto {
  return structuredClone(drawing);
}
