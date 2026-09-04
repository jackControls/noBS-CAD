import type { ConstraintDto } from '../engine/types';

/** Entity ids a geometric constraint refers to (for glyphs / related highlights). */
export function constraintReferencedEntityIds(
  constraint: ConstraintDto,
): number[] {
  const ids: number[] = [];
  if (constraint.entity != null) ids.push(constraint.entity);
  if (constraint.a != null) ids.push(constraint.a);
  if (constraint.b != null) ids.push(constraint.b);
  if (constraint.point != null) ids.push(constraint.point);
  if (constraint.curve != null) ids.push(constraint.curve);
  if (constraint.arc != null) ids.push(constraint.arc);
  if (constraint.origin != null) ids.push(constraint.origin);
  if (constraint.start != null) ids.push(constraint.start);
  if (typeof constraint.end === 'number') ids.push(constraint.end);
  if (constraint.axis != null) ids.push(constraint.axis);
  if (constraint.from != null) ids.push(constraint.from);
  if (constraint.to != null) ids.push(constraint.to);
  return ids;
}
