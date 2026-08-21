import type { CamUnits } from '../engine/types';

export const MM_PER_INCH = 25.4;

/** Canonical mm -> operator-facing document units. */
export function displayLength(valueMm: number, units: CamUnits): number {
  return units === 'inches' ? valueMm / MM_PER_INCH : valueMm;
}

/** Operator-facing document units -> canonical mm. */
export function commitLength(value: number, units: CamUnits): number {
  return units === 'inches' ? value * MM_PER_INCH : value;
}

/** Canonical mm/min -> display feed (mm/min or in/min). */
export function displayFeed(valueMmPerMin: number, units: CamUnits): number {
  return displayLength(valueMmPerMin, units);
}

export function commitFeed(value: number, units: CamUnits): number {
  return commitLength(value, units);
}

export function lengthUnitLabel(units: CamUnits): string {
  return units === 'inches' ? 'in' : 'mm';
}

export function feedUnitLabel(units: CamUnits): string {
  return units === 'inches' ? 'in/min' : 'mm/min';
}

/** Decimals shown for a length in the given units. */
export function lengthDecimals(units: CamUnits): number {
  return units === 'inches' ? 4 : 3;
}

export function formatLength(valueMm: number, units: CamUnits): string {
  return `${displayLength(valueMm, units).toFixed(lengthDecimals(units))} ${lengthUnitLabel(units)}`;
}
