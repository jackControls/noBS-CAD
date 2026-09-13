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

/** Canonical m/min surface speed -> display (m/min, or SFM in inch mode). */
export function displayCuttingSpeed(metersPerMin: number, units: CamUnits): number {
  return units === 'inches' ? metersPerMin / 0.3048 : metersPerMin;
}

/** Display surface speed -> canonical m/min. */
export function commitCuttingSpeed(value: number, units: CamUnits): number {
  return units === 'inches' ? value * 0.3048 : value;
}

export function cuttingSpeedUnitLabel(units: CamUnits): string {
  return units === 'inches' ? 'SFM' : 'm/min';
}

/** Unit label for per-tooth / per-rev chip loads. */
export function chipLoadUnitLabel(units: CamUnits): string {
  return units === 'inches' ? 'in' : 'mm';
}

/** Spindle speed from surface speed and tool diameter (canonical units). */
export function rpmFromCuttingSpeed(metersPerMin: number, diameterMm: number): number {
  if (diameterMm <= 0) return 0;
  return Math.round((metersPerMin * 1000) / (Math.PI * diameterMm));
}

/** Surface speed (m/min) from spindle speed and tool diameter. */
export function cuttingSpeedFromRpm(rpm: number, diameterMm: number): number {
  return (rpm * Math.PI * diameterMm) / 1000;
}
