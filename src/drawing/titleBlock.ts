import type {DrawingSheetDto} from '../engine/types';
import {drawingFormatShortLabel, drawingToleranceNoteText} from './sheet';

const MIN_TEXT_HEIGHT = 1.8;
const PAD_X = 1.5;
const PAD_Y = 1;

export interface TitleBlockCell {
  id: string; label: string; text: string;
  x: number; y: number; width: number; height: number;
  fontSize: number; lines: Array<{text: string; x: number; y: number; width: number}>;
  overflow: boolean;
}

/** Conservative font-independent advances shared with the native title renderer.
 * SVG uses these bounded lengths; DXF receives the same explicit wrapped lines. */
export function titleTextAdvance(text: string): number {
  return Array.from(text).reduce((sum, ch) => sum + (
    /\s/u.test(ch) ? 0.33 : /[ilI.,:;!|'`]/u.test(ch) ? 0.32
      : /[MW@%]/u.test(ch) ? 0.95 : /[A-Z]/u.test(ch) ? 0.75
        : ch.codePointAt(0)! < 128 ? 0.65 : 1
  ), 0);
}

function wrap(text: string, maxAdvance: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    let line = '';
    for (const word of paragraph.trim().split(/\s+/u).filter(Boolean)) {
      if (line && titleTextAdvance(`${line} ${word}`) <= maxAdvance) { line += ` ${word}`; continue; }
      if (line) { lines.push(line); line = ''; }
      for (const ch of word) {
        if (line && titleTextAdvance(line + ch) > maxAdvance) { lines.push(line); line = ''; }
        line += ch;
      }
    }
    lines.push(line);
  }
  return lines;
}

export function fitTitleBlockCell(
  cell: Omit<TitleBlockCell, 'fontSize' | 'lines' | 'overflow'>, requestedSize: number,
): TitleBlockCell {
  const maximum = Math.max(MIN_TEXT_HEIGHT, Math.min(5, Number.isFinite(requestedSize) ? requestedSize : MIN_TEXT_HEIGHT));
  const usableWidth = cell.width - PAD_X * 2, usableHeight = cell.height - PAD_Y * 2;
  for (let size = maximum; ; size = Math.max(MIN_TEXT_HEIGHT, size - 0.1)) {
    const textLines = wrap(cell.text, usableWidth / size);
    if (size + (textLines.length - 1) * size * 1.2 <= usableHeight + 1e-8
      && textLines.every(line => titleTextAdvance(line) * size <= usableWidth + 1e-8)) {
      return {...cell, fontSize: size, overflow: false, lines: textLines.map((text, i) => ({
        text, x: cell.x + PAD_X, y: cell.y + PAD_Y + size * 0.85 + i * size * 1.2,
        width: titleTextAdvance(text) * size,
      }))};
    }
    if (size <= MIN_TEXT_HEIGHT) break;
  }
  // The model keeps the complete value. Never disguise overflow by silently
  // dropping characters or reducing engineering text to an unreadable size.
  const text = '! TEXT TOO LONG';
  return {...cell, fontSize: MIN_TEXT_HEIGHT, overflow: true, lines: [{
    text, x: cell.x + PAD_X, y: cell.y + PAD_Y + MIN_TEXT_HEIGHT,
    width: Math.min(usableWidth, titleTextAdvance(text) * MIN_TEXT_HEIGHT),
  }]};
}

export function drawingTitleBlock(sheet: DrawingSheetDto, paperWidth: number, paperHeight: number) {
  const width = Math.min(180, paperWidth - 10), height = 44;
  const x = paperWidth - width - 5, y = paperHeight - height - 5;
  const cells: TitleBlockCell[] = [];
  const add = (id: string, label: string, text: string, left: number, top: number, w: number, h: number,
    fontSize = sheet.style.small_text_height_mm) => cells.push(fitTitleBlockCell({
      id, label, text, x: x + left * width, y: y + top, width: w * width, height: h,
    }, fontSize));
  const title = sheet.title_block;
  add('title', 'Title', title.title || sheet.name, 0, 0, 0.64, 9, Math.min(3.5, sheet.style.text_height_mm));
  add('number', 'Drawing number', `DRAWING: ${title.drawing_number || '—'}`, 0, 9, 0.64, 5);
  add('sheet', 'Sheet name', `SHEET: ${sheet.name}`, 0.64, 0, 0.36, 9);
  add('format', 'Format', `${drawingFormatShortLabel(sheet.format)} · ${sheet.projection_method === 'first_angle' ? '1ST ANGLE' : '3RD ANGLE'}`, 0.64, 9, 0.36, 5);
  add('tolerance', 'Tolerance note', drawingToleranceNoteText(sheet.tolerance_note) || 'TOLERANCES: AS SPECIFIED', 0, 14, 1, 8);
  add('company', 'Company', `COMPANY: ${title.company || '—'}`, 0, 22, 0.7, 6);
  add('revision', 'Revision', `REV ${title.revision || '—'}`, 0.7, 22, 0.3, 6);
  add('material', 'Material', `MATERIAL: ${title.material || '—'}`, 0, 28, 0.45, 10);
  add('finish', 'Finish', `FINISH: ${title.finish || '—'}`, 0.45, 28, 0.55, 10);
  add('author', 'Author', `DRAWN: ${title.author || '—'}`, 0, 38, 1 / 3, 6);
  add('checked', 'Checked by', `CHECKED: ${title.checked_by || '—'}`, 1 / 3, 38, 1 / 3, 6);
  add('approved', 'Approved by', `APPROVED: ${title.approved_by || '—'}`, 2 / 3, 38, 1 / 3, 6);
  const segments = [
    [0, 14, 1, 14], [0, 22, 1, 22], [0, 28, 1, 28], [0, 38, 1, 38],
    [0.64, 0, 0.64, 14], [0.7, 22, 0.7, 28], [0.45, 28, 0.45, 38],
    [1 / 3, 38, 1 / 3, 44], [2 / 3, 38, 2 / 3, 44],
  ].map(([x1, y1, x2, y2]) => [[x + x1 * width, y + y1], [x + x2 * width, y + y2]] as [[number, number], [number, number]]);
  return {x, y, width, height, cells, segments};
}

export function assertTitleBlockFits(layout: ReturnType<typeof drawingTitleBlock>): void {
  const overflow = layout.cells.filter(cell => cell.overflow);
  if (overflow.length) throw new Error(`Title block text does not fit at a readable size: ${overflow.map(cell => cell.label).join(', ')}. Shorten these fields or move detailed instructions into drawing notes. The complete text remains in Sheet Properties.`);
}
