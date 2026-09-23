/**
 * Sketch-center hit resolution.
 *
 * Every drawn circle owns a center point, and concentric circles share one, so
 * a click on that shared handle is ambiguous about which circle the user is
 * aiming at (issue #151 review). Resolve it to the most recently created of
 * those circles. A circle's center is still pickable on its own when only one
 * circle sits there, because selecting the center is how a center gets
 * constrained.
 */
import type { EntityDto, Vec2 } from '../engine/types';

/**
 * The id of the last circle centered on `center`, or null when the position is
 * not shared by at least two circles.
 *
 * `entities` is in creation order, so the last match is the newest circle.
 */
export function coincidentCircleAt(
  entities: readonly EntityDto[],
  center: Vec2,
  tolerance: number,
): number | null {
  const circles = entities.filter(
    (entity): entity is Extract<EntityDto, { kind: 'circle' }> =>
      entity.kind === 'circle' &&
      Math.hypot(entity.center.x - center.x, entity.center.y - center.y) <= tolerance,
  );
  // A lone circle is not ambiguous: its own center point must stay pickable.
  return circles.length > 1 ? circles[circles.length - 1].id : null;
}
