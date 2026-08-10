import type { DrawingLineStyleDto, DrawingSheetStyleDto } from '../engine/types';

export type DrawingLineRole =
  | 'visible' | 'hidden' | 'center' | 'cutting_plane' | 'phantom'
  | 'break_line' | 'dimension' | 'extension' | 'leader' | 'hatch';

/** One source of truth for SVG, print, and DXF line presentation. */
export function drawingLineStyle(style: DrawingSheetStyleDto, role: DrawingLineRole): DrawingLineStyleDto {
  return style[role];
}

export function drawingSvgLineAttributes(style: DrawingSheetStyleDto, role: DrawingLineRole): {
  strokeWidth: number;
  strokeDasharray?: string;
} {
  const line = drawingLineStyle(style, role);
  return {
    strokeWidth: line.width_mm,
    ...(line.dash_mm.length > 0 ? { strokeDasharray: line.dash_mm.join(' ') } : {}),
  };
}

/** DXF group 370 stores hundredths of a millimetre. */
export function drawingDxfLineweight(style: DrawingSheetStyleDto, role: DrawingLineRole): number {
  return Math.max(0, Math.min(211, Math.round(drawingLineStyle(style, role).width_mm * 100)));
}

export function drawingDxfLinetypeName(role: DrawingLineRole): string {
  if (role === 'hidden') return 'NBS_HIDDEN';
  if (role === 'center') return 'NBS_CENTER';
  if (role === 'cutting_plane') return 'NBS_CUTTING';
  if (role === 'phantom') return 'NBS_PHANTOM';
  if (role === 'break_line') return 'NBS_BREAK';
  return 'CONTINUOUS';
}

export function drawingDxfPattern(style: DrawingSheetStyleDto, role: DrawingLineRole): number[] {
  const pattern = drawingLineStyle(style, role).dash_mm;
  return pattern.map((value, index) => index % 2 === 0 ? Math.abs(value) : -Math.abs(value));
}
