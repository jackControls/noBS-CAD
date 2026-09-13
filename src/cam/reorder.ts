import type { CamDocumentDto } from '../engine/types';

/** A drop is a permutation, never a move across WCS boundaries or a copy. */
export function reorderByIds<T extends { id: number }>(items: T[], ids: number[]): T[] {
  if (ids.length !== items.length || new Set(ids).size !== items.length) {
    throw new Error('The CAM list changed while dragging. Try again.');
  }
  const byId = new Map(items.map((item) => [item.id, item]));
  return ids.map((id) => {
    const item = byId.get(id);
    if (!item) throw new Error('The CAM list changed while dragging. Try again.');
    return item;
  });
}

export function reorderedCamDocument(
  cam: CamDocumentDto,
  setupId: number | null,
  ids: number[],
): CamDocumentDto {
  const next = structuredClone(cam);
  if (setupId === null) {
    next.setups = reorderByIds(next.setups, ids);
    const positions = new Map(ids.map((id, index) => [id, index]));
    for (const setup of next.setups) {
      if (setup.resolved_stock.shape !== 'rest') continue;
      const source = positions.get(setup.resolved_stock.source_setup_id);
      if (source === undefined || source >= positions.get(setup.id)!) {
        throw new Error(`“${setup.name}” must stay after the setup that produces its remaining stock.`);
      }
    }
  } else {
    const setup = next.setups.find((item) => item.id === setupId);
    if (!setup) throw new Error('The setup no longer exists.');
    setup.operations = reorderByIds(setup.operations, ids);
  }
  return next;
}
