import type {
  DrawingProjectionDto,
  DrawingSheetDto,
  DrawingSheetFormat,
  DrawingSheetOrientation,
  DrawingViewDto,
} from '../engine/types';

const PAPER: Record<DrawingSheetFormat, [number, number]> = {
  a4: [210, 297],
  a3: [297, 420],
  letter: [215.9, 279.4],
};

export function drawingSheetSize(
  format: DrawingSheetFormat,
  orientation: DrawingSheetOrientation,
): [number, number] {
  const [shortEdge, longEdge] = PAPER[format];
  return orientation === 'landscape'
    ? [longEdge, shortEdge]
    : [shortEdge, longEdge];
}

export function drawingViewTransform(
  view: DrawingViewDto,
  projection: DrawingProjectionDto,
): string {
  const centerX = (projection.bounds[0] + projection.bounds[2]) / 2;
  const centerY = (projection.bounds[1] + projection.bounds[3]) / 2;
  return `translate(${view.position[0]} ${view.position[1]}) scale(${view.scale} ${-view.scale}) translate(${-centerX} ${-centerY})`;
}

export function drawingViewPaperBounds(
  view: DrawingViewDto,
  projection: DrawingProjectionDto,
): [number, number, number, number] {
  const width = (projection.bounds[2] - projection.bounds[0]) * view.scale;
  const height = (projection.bounds[3] - projection.bounds[1]) * view.scale;
  return [
    view.position[0] - width / 2,
    view.position[1] - height / 2,
    width,
    height,
  ];
}

export function activeSheetOf(
  sheets: DrawingSheetDto[],
  activeId: number | null,
): DrawingSheetDto | null {
  return sheets.find((sheet) => sheet.id === activeId) ?? null;
}
