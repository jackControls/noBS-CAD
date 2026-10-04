import type { ViewPartOffsetDto } from './engine/types';

/** World-axis display offset for one body. Missing offsets stay at the assembled pose. */
export function translateByPartOffset(
  translation: readonly [number, number, number],
  bodyId: number,
  offsets: readonly ViewPartOffsetDto[],
): [number, number, number] {
  const offset = offsets.find((entry) => entry.body_id === bodyId);
  if (!offset) return [translation[0], translation[1], translation[2]];
  return [
    translation[0] + offset.translation[0],
    translation[1] + offset.translation[1],
    translation[2] + offset.translation[2],
  ];
}
