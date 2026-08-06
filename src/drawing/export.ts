import { getEngine } from '../engine';
import type {
  DrawingPolylineDto,
  DrawingProjectionDto,
  DrawingSheetDto,
  DrawingViewDto,
} from '../engine/types';
import { chooseSaveTarget, writeSaveTarget, type SaveType } from '../files/fileIO';
import { useAppStore } from '../store/appStore';
import { drawingSheetSize, drawingViewTransform } from './sheet';

const SVG_TYPE: SaveType = {
  description: 'Scalable Vector Drawing',
  extension: '.svg',
  mime: 'image/svg+xml',
};

export async function exportActiveDrawingSvg(): Promise<boolean> {
  const state = useAppStore.getState();
  const sheet = state.drawingDocument.sheets.find(
    (candidate) => candidate.id === state.drawingDocument.active_sheet_id,
  );
  if (!sheet) throw new Error('There is no active drawing sheet to export.');
  const svg = await drawingSheetSvg(sheet);
  const project = safeFilePart(state.document?.name ?? 'Untitled');
  const sheetName = safeFilePart(sheet.name);
  const target = await chooseSaveTarget(`${project}-${sheetName}.svg`, SVG_TYPE);
  if (!target) return false;
  await writeSaveTarget(target, new TextEncoder().encode(svg));
  return true;
}

export function printActiveDrawing(): void {
  window.print();
}

export async function drawingSheetSvg(sheet: DrawingSheetDto): Promise<string> {
  const engine = await getEngine();
  const projections = await Promise.all(
    sheet.views.map((view) =>
      engine.drawingProjection({
        body_ids: view.body_ids,
        direction: view.direction,
        up: view.up,
        include_hidden: view.show_hidden_lines,
        include_tangent_edges: view.show_tangent_edges,
        deflection: Math.max(0.01, 0.08 / view.scale),
      }),
    ),
  );
  const [width, height] = drawingSheetSize(sheet.format, sheet.orientation);
  const views = sheet.views
    .map((view, index) => viewSvg(view, projections[index]))
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="white"/>
  <g fill="none" stroke="#17191c" stroke-linecap="round" stroke-linejoin="round">${views}</g>
  ${borderAndTitleBlock(sheet, width, height)}
</svg>`;
}

function viewSvg(view: DrawingViewDto, projection: DrawingProjectionDto): string {
  const visible = projection.visible.map((polyline) => pathSvg(polyline, false)).join('');
  const hidden = projection.hidden.map((polyline) => pathSvg(polyline, true)).join('');
  return `
    <g transform="${drawingViewTransform(view, projection)}">
      ${visible}${hidden}
    </g>
    <text x="${view.position[0]}" y="${view.position[1] + Math.max(8, (projection.bounds[3] - projection.bounds[1]) * view.scale / 2 + 5)}" fill="#30343a" stroke="none" font-family="system-ui, sans-serif" font-size="3.2" text-anchor="middle">${escapeXml(view.name)} · ${scaleLabel(view.scale)}</text>`;
}

function pathSvg(polyline: DrawingPolylineDto, hidden: boolean): string {
  if (polyline.points.length < 2) return '';
  const data = polyline.points
    .map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${round(x)} ${round(y)}`)
    .join(' ');
  return `<path d="${data}" vector-effect="non-scaling-stroke" stroke-width="${hidden ? 0.25 : 0.35}"${hidden ? ' stroke-dasharray="2 1" opacity="0.72"' : ''}/>`;
}

function borderAndTitleBlock(
  sheet: DrawingSheetDto,
  width: number,
  height: number,
): string {
  const blockWidth = Math.min(180, width - 10);
  const blockHeight = 27;
  const x = width - 5 - blockWidth;
  const y = height - 5 - blockHeight;
  const title = sheet.title_block;
  return `<g fill="none" stroke="#30343a" stroke-width="0.25">
    <rect x="5" y="5" width="${width - 10}" height="${height - 10}"/>
    <rect x="${x}" y="${y}" width="${blockWidth}" height="${blockHeight}"/>
    <path d="M${x} ${y + 16}H${x + blockWidth} M${x + blockWidth * 0.62} ${y}V${y + blockHeight} M${x + blockWidth * 0.82} ${y + 16}V${y + blockHeight}"/>
  </g>
  <g fill="#30343a" font-family="system-ui, sans-serif">
    <text x="${x + 4}" y="${y + 7}" font-size="4.6" font-weight="650">${escapeXml(title.title || sheet.name)}</text>
    <text x="${x + 4}" y="${y + 13}" font-size="2.8">DRAWING: ${escapeXml(title.drawing_number || '—')}</text>
    <text x="${x + blockWidth * 0.64}" y="${y + 7}" font-size="2.8">SHEET: ${escapeXml(sheet.name)}</text>
    <text x="${x + blockWidth * 0.64}" y="${y + 13}" font-size="2.8">FORMAT: ${sheet.format.toUpperCase()}</text>
    <text x="${x + 4}" y="${y + 23}" font-size="2.8">AUTHOR: ${escapeXml(title.author || '—')}</text>
    <text x="${x + blockWidth * 0.84}" y="${y + 23}" font-size="2.8">REV ${escapeXml(title.revision || '—')}</text>
  </g>`;
}

function scaleLabel(scale: number): string {
  if (scale >= 1) return `${round(scale)}:1`;
  return `1:${round(1 / scale)}`;
}

function round(value: number): string {
  return Number(value.toFixed(5)).toString();
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[character] ?? character);
}

function safeFilePart(value: string): string {
  return value.trim().replace(/[^a-z0-9._-]+/gi, '-') || 'Drawing';
}
