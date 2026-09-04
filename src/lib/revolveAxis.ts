import type {
  PlaneBasis,
  ProfileCatalogItemDto,
  SketchLineDto,
} from '../engine/types';

const NORMAL_TOLERANCE = 1e-6;
const PLANE_DISTANCE_TOLERANCE_MM = 1e-5;

const dot3 = (a: number[], b: number[]) =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const length3 = (value: number[]) => Math.hypot(value[0], value[1], value[2]);

/** True when two sketch bases describe the same infinite world-space plane. */
export function areSketchPlanesCoplanar(
  first: PlaneBasis,
  second: PlaneBasis,
): boolean {
  const firstNormalLength = length3(first.normal);
  const secondNormalLength = length3(second.normal);
  if (firstNormalLength <= Number.EPSILON || secondNormalLength <= Number.EPSILON) {
    return false;
  }
  const alignment = Math.abs(dot3(first.normal, second.normal))
    / (firstNormalLength * secondNormalLength);
  if (alignment < 1 - NORMAL_TOLERANCE) return false;
  const originDelta = [
    second.origin[0] - first.origin[0],
    second.origin[1] - first.origin[1],
    second.origin[2] - first.origin[2],
  ];
  const planeDistance = Math.abs(dot3(originDelta, first.normal)) / firstNormalLength;
  return planeDistance <= PLANE_DISTANCE_TOLERANCE_MM;
}

export interface RevolveAxisLineOption {
  sketchName: string;
  line: SketchLineDto;
}

/** All non-degenerate straight sketch entities. Used before a profile has
 * established the Revolve plane, so choosing the axis first remains valid. */
export function allRevolveAxisLineOptions(
  catalog: ProfileCatalogItemDto[],
): RevolveAxisLineOption[] {
  return catalog.flatMap((entry) =>
    entry.lines
      .filter((line) =>
        Math.hypot(line.end.x - line.start.x, line.end.y - line.start.y) > 1e-9)
      .map((line) => ({ sketchName: entry.sketch_name, line })),
  );
}

/**
 * Every stable straight sketch entity on the selected profile's plane is a
 * valid Revolve-axis candidate. This intentionally includes construction
 * lines, independent line-only sketches, and straight profile boundaries.
 */
export function revolveAxisLineOptions(
  catalog: ProfileCatalogItemDto[],
  profileSketchName: string,
): RevolveAxisLineOption[] {
  const profileSketch = catalog.find(
    (entry) => entry.sketch_name === profileSketchName,
  );
  if (!profileSketch) return [];
  return allRevolveAxisLineOptions(catalog)
    .filter((option) => {
      const entry = catalog.find((candidate) => candidate.sketch_name === option.sketchName);
      return entry ? areSketchPlanesCoplanar(profileSketch.basis, entry.basis) : false;
    });
}

export function revolveProfileAcceptsAxis(
  catalog: ProfileCatalogItemDto[],
  profileSketchName: string,
  axis: { sketchName: string; entityId: number } | null,
): boolean {
  if (!axis) return true;
  return revolveAxisLineOptions(catalog, profileSketchName).some(
    (option) =>
      option.sketchName === axis.sketchName
      && option.line.entity_id === axis.entityId,
  );
}

export function revolveAxisLineKey(
  option: Pick<RevolveAxisLineOption, 'sketchName'> & {
    line?: Pick<SketchLineDto, 'entity_id'>;
    entityId?: number;
  },
): string {
  const entityId = option.line?.entity_id ?? option.entityId;
  return `${encodeURIComponent(option.sketchName)}:${entityId ?? ''}`;
}
