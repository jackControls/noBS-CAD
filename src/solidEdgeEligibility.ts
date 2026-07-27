import type { Point3Dto } from './engine/types';

/** Keep viewport preselection and feature-dialog validation on the same
 * geometric definition of a straight topology edge. */
export function isStraightSolidEdge(points: Point3Dto[]): boolean {
  if (points.length < 2) return false;
  const start = points[0];
  const end = points[points.length - 1];
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dz = end.z - start.z;
  const length = Math.hypot(dx, dy, dz);
  if (length < 1e-9) return false;
  return points.every((point) => {
    const px = point.x - start.x;
    const py = point.y - start.y;
    const pz = point.z - start.z;
    return (
      Math.hypot(
        py * dz - pz * dy,
        pz * dx - px * dz,
        px * dy - py * dx,
      ) /
        length <
      1e-4
    );
  });
}
