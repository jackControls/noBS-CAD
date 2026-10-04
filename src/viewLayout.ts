import type { NamedViewConfigurationDto, PrintLayoutReport, ViewOccurrenceOffsetDto } from './engine/types';

/** Intrinsic XYZ angles, shown in degrees in the shared named-view editor. */
export function rotationFromDegrees(degrees: readonly number[]): [number, number, number, number] {
  const [x, y, z] = degrees.map(v => v * Math.PI / 360);
  const [cx, cy, cz, sx, sy, sz] = [Math.cos(x), Math.cos(y), Math.cos(z), Math.sin(x), Math.sin(y), Math.sin(z)];
  return [sx * cy * cz + cx * sy * sz, cx * sy * cz - sx * cy * sz,
    cx * cy * sz + sx * sy * cz, cx * cy * cz - sx * sy * sz];
}
export function rotationDegrees(rotation: readonly number[] = [0, 0, 0, 1]): [number, number, number] {
  const norm = Math.hypot(...rotation);
  const [x, y, z, w] = rotation.map(v => v / norm);
  return [Math.atan2(2 * (x * w - y * z), 1 - 2 * (x * x + y * y)),
    Math.asin(Math.max(-1, Math.min(1, 2 * (x * z + y * w)))),
    Math.atan2(2 * (z * w - x * y), 1 - 2 * (y * y + z * z))].map(v => v * 180 / Math.PI) as [number, number, number];
}

/** Apply a reviewed proposal to the same saved occurrence offsets the user edits. */
export function applyLayoutProposal(view: NamedViewConfigurationDto, report: PrintLayoutReport): NamedViewConfigurationDto {
  if (!report.proposal_fits) throw new Error('The complete arrangement does not fit this bed.');
  const offsets = new Map<number, ViewOccurrenceOffsetDto>((view.occurrence_offsets ?? []).map(o => [o.occurrence_id, structuredClone(o)]));
  for (const move of report.proposed_translations) {
    const previous = offsets.get(move.occurrence_id) ?? { occurrence_id: move.occurrence_id, translation: [0, 0, 0], rotation: [0, 0, 0, 1] };
    offsets.set(move.occurrence_id, { ...previous,
      translation: previous.translation.map((v, i) => v + move.translation[i]) as [number, number, number] });
  }
  return { ...view, occurrence_offsets: [...offsets.values()].sort((a, b) => a.occurrence_id - b.occurrence_id) };
}
