import type { Point3Dto, ViewPartOffsetDto } from './engine/types';

/** Undo only the display translation before a picked point edits the model. */
export function modelPointFromDisplay(
  point: Point3Dto,
  bodyId: number,
  offsets: readonly ViewPartOffsetDto[],
): Point3Dto {
  const offset = offsets.find((entry) => entry.body_id === bodyId)?.translation ?? [0, 0, 0];
  return { x: point.x - offset[0], y: point.y - offset[1], z: point.z - offset[2] };
}

export function displayPointFromModel(
  point: Point3Dto,
  bodyId: number,
  offsets: readonly ViewPartOffsetDto[],
): Point3Dto {
  const [x, y, z] = translateByPartOffset([point.x, point.y, point.z], bodyId, offsets);
  return { x, y, z };
}

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
