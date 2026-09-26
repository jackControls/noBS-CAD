/**
 * Sketch-center hit resolution.
 *
 * Every drawn circle owns a center point, and concentric circles share one, so
 * a click on that shared handle is ambiguous about which circle the user is
 * aiming at (issue #151 review). Resolve it to the most recently created of
 * those circles.
 *
 * Ownership is read from the point's own `center_coincident` relations, never
 * from distance: two circles whose centers merely sit close together have
 * independent handles, and a point that happens to be near a center is not a
 * center at all. Pointer tolerance belongs to the hit envelope, not to identity.
 */
import type { ConstraintDto, EntityDto } from '../engine/types';

/**
 * The id of the newest circle that binds this exact point as its center, or
 * null when fewer than two circles do.
 *
 * `entities` is in creation order, so the last match is the newest circle.
 */
export function coincidentCircleAt(
  entities: readonly EntityDto[],
  constraints: readonly ConstraintDto[],
  pointId: number,
): number | null {
  const owners = new Set(
    constraints
      .filter(
        (constraint) =>
          constraint.type === 'center_coincident' &&
          constraint.point === pointId &&
          typeof constraint.curve === 'number',
      )
      .map((constraint) => constraint.curve as number),
  );
  const circles = entities.filter(
    (entity): entity is Extract<EntityDto, { kind: 'circle' }> =>
      entity.kind === 'circle' && owners.has(entity.id),
  );
  // A lone circle is not ambiguous: its own center point stays pickable, which
  // is how a center is selected and constrained.
  return circles.length > 1 ? circles[circles.length - 1].id : null;
}
