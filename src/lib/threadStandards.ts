import threadSizes from '../../interface/thread-sizes.json';
import type {
  HoleThreadDto,
  HoleThreadSeries,
  HoleThreadStandard,
} from '../engine/types';
import { translate } from '../i18n';

export interface ThreadPreset {
  id: string;
  label: string;
  standard: HoleThreadStandard;
  series: HoleThreadSeries;
  designation: string;
  class: string;
  nominalDiameterMm: number;
  pitchMm: number;
  threadsPerInch: number | null;
  tapDrillDiameterMm: number;
  tapDrillDesignation: string | null;
  roundedProfile?: HoleThreadDto['rounded_profile'];
}

export type ThreadFit = 'internal' | 'external';

export type RoundedThreadInputs = Record<keyof NonNullable<HoleThreadDto['rounded_profile']>, string>;

export function roundedThreadInputs(profile: NonNullable<HoleThreadDto['rounded_profile']>): RoundedThreadInputs {
  return {
    radial_depth: String(profile.radial_depth), corner_radius: String(profile.corner_radius),
    radial_clearance: String(profile.radial_clearance), axial_clearance: String(profile.axial_clearance),
  };
}

export function roundedThreadProfile(inputs: RoundedThreadInputs): NonNullable<HoleThreadDto['rounded_profile']> {
  const number = (value: string) => value.trim() === '' ? NaN : Number(value);
  return {
    radial_depth: number(inputs.radial_depth), corner_radius: number(inputs.corner_radius),
    radial_clearance: number(inputs.radial_clearance), axial_clearance: number(inputs.axial_clearance),
  };
}

/** Editable starting dimensions, not a standard or a fit qualification. */
export function initialRoundedThreadProfile(pitch: number): NonNullable<HoleThreadDto['rounded_profile']> {
  const scaled = (ratio: number) => Number((pitch * ratio).toPrecision(12));
  return {radial_depth: scaled(0.5), corner_radius: scaled(0.075),
    radial_clearance: scaled(0.0625), axial_clearance: scaled(0.05)};
}

export function roundedThreadInputsFinite(inputs: RoundedThreadInputs | null): boolean {
  return inputs !== null && Object.values(roundedThreadProfile(inputs)).every(Number.isFinite);
}

export interface IsoMetricThreadEnvelope {
  basicMajorDiameter: number;
  majorMin: number;
  majorMax: number;
  pitchMin: number;
  pitchMax: number;
  minorMin: number;
  minorMax: number;
  modeledMajor: number;
  modeledPitch: number;
  modeledMinor: number;
}

const SQRT_3 = Math.sqrt(3);
const PREFERRED_TOLERANCES_UM = [
  16, 18, 20, 22, 25, 28, 30, 32, 36, 40, 45, 48, 50, 53, 56, 60, 63,
  67, 71, 75, 80, 85, 90, 95, 100, 106, 112, 118, 125, 132, 140, 150,
  160, 170, 180, 190, 200, 212, 224, 236, 250, 265, 280, 300, 315, 335,
  355, 375, 400, 425, 450, 475, 500, 530, 560, 600, 630, 670, 710, 750,
  800, 850, 900, 950, 1_000,
] as const;

const INTERNAL_MINOR_TOLERANCE_UM = new Map<number, number>([
  [0.20, 56], [0.25, 71], [0.30, 85], [0.35, 100], [0.40, 112],
  [0.45, 125], [0.50, 140], [0.60, 160], [0.70, 180], [0.75, 190],
  [0.80, 200], [1.00, 236], [1.25, 265], [1.50, 300], [1.75, 335],
  [2.00, 375], [2.50, 450], [3.00, 500], [3.50, 560], [4.00, 600],
]);

function preferredToleranceUm(value: number): number {
  return PREFERRED_TOLERANCES_UM.reduce((nearest, candidate) => {
    const candidateDistance = Math.abs(candidate - value);
    const nearestDistance = Math.abs(nearest - value);
    return candidateDistance < nearestDistance ? candidate : nearest;
  }, PREFERRED_TOLERANCES_UM[0] ?? Math.round(value));
}

const EXTERNAL_G_FUNDAMENTAL_DEVIATION_UM = new Map<number, number>([
  [0.20, -17], [0.25, -18], [0.30, -18], [0.35, -19], [0.40, -19],
  [0.45, -20], [0.50, -20], [0.60, -21], [0.70, -22], [0.75, -22],
  [0.80, -24], [1.00, -26], [1.25, -28], [1.50, -32], [1.75, -34],
  [2.00, -38], [2.50, -42], [3.00, -48], [3.50, -53], [4.00, -60],
]);

function externalGFundamentalDeviationUm(pitch: number): number {
  for (const [candidate, deviation] of EXTERNAL_G_FUNDAMENTAL_DEVIATION_UM) {
    if (Math.abs(candidate - pitch) <= 1e-9) return deviation;
  }
  return -Math.round(15 + 11 * pitch);
}

function representativeDiameter(diameter: number): number {
  const steps = [
    [0.99, 1.4], [1.4, 2.8], [2.8, 5.6], [5.6, 11.2], [11.2, 22.4],
    [22.4, 45], [45, 90], [90, 180], [180, 355],
  ] as const;
  const step = steps.find(([lower, upper]) => diameter > lower && diameter <= upper);
  return step ? Math.sqrt(step[0] * step[1]) : diameter;
}

function internalMinorToleranceUm(pitch: number): number {
  for (const [candidate, tolerance] of INTERNAL_MINOR_TOLERANCE_UM) {
    if (Math.abs(candidate - pitch) <= 1e-9) return tolerance;
  }
  return preferredToleranceUm(433 * pitch - 190 * pitch ** 1.22);
}

function roundLimitMm(value: number): number {
  // ISO 965-6 limit dimensions are published to the third decimal place.
  return Math.round(value * 1_000) / 1_000;
}

/**
 * ISO 965 grade-6 limit dimensions. Geometry uses the maximum-material GO
 * boundary; the opposite limit remains available for NO-GO checks.
 */
export function isoMetricGrade6Envelope(
  nominalDiameter: number,
  pitch: number,
  fit: ThreadFit,
): IsoMetricThreadEnvelope {
  if (!Number.isFinite(nominalDiameter) || nominalDiameter <= 0) {
    throw new Error(translate('thread.errorNominalDiameterPositive'));
  }
  if (!Number.isFinite(pitch) || pitch <= 0) {
    throw new Error(translate('thread.errorPitchPositive'));
  }
  const basicPitch = nominalDiameter - 3 * SQRT_3 * pitch / 8;
  const basicInternalMinor = nominalDiameter - 5 * SQRT_3 * pitch / 8;
  const basicExternalMinor = nominalDiameter - 17 * SQRT_3 * pitch / 24;
  const externalPitchToleranceUm = preferredToleranceUm(
    90 * pitch ** 0.4 * representativeDiameter(nominalDiameter) ** 0.1,
  );
  if (fit === 'internal') {
    const pitchToleranceUm = preferredToleranceUm(1.32 * externalPitchToleranceUm);
    const minorToleranceUm = internalMinorToleranceUm(pitch);
    const major = roundLimitMm(nominalDiameter);
    const pitchMin = roundLimitMm(basicPitch);
    const minorMin = roundLimitMm(basicInternalMinor);
    return {
      basicMajorDiameter: major,
      majorMin: major,
      majorMax: major,
      pitchMin,
      pitchMax: roundLimitMm(basicPitch + pitchToleranceUm / 1_000),
      minorMin,
      minorMax: roundLimitMm(basicInternalMinor + minorToleranceUm / 1_000),
      modeledMajor: major,
      modeledPitch: pitchMin,
      modeledMinor: minorMin,
    };
  }
  const fundamentalDeviationUm = externalGFundamentalDeviationUm(pitch);
  const majorToleranceUm = preferredToleranceUm(180 * pitch ** (2 / 3));
  const deviation = fundamentalDeviationUm / 1_000;
  const majorMax = roundLimitMm(nominalDiameter + deviation);
  const pitchMax = roundLimitMm(basicPitch + deviation);
  const minorMax = roundLimitMm(basicExternalMinor + deviation);
  const basicProfileMinorMax = nominalDiameter - 5 * SQRT_3 * pitch / 8 + deviation;
  return {
    basicMajorDiameter: roundLimitMm(nominalDiameter),
    majorMin: roundLimitMm(nominalDiameter + deviation - majorToleranceUm / 1_000),
    majorMax,
    pitchMin: roundLimitMm(basicPitch + deviation - externalPitchToleranceUm / 1_000),
    pitchMax,
    minorMin: roundLimitMm(
      basicProfileMinorMax - externalPitchToleranceUm / 1_000
        - SQRT_3 * pitch / 4 + pitch / 4,
    ),
    minorMax,
    modeledMajor: majorMax,
    modeledPitch: pitchMax,
    modeledMinor: minorMax,
  };
}

export function isoMetricThreadEnvelope(
  thread: HoleThreadDto,
  fit: ThreadFit,
): IsoMetricThreadEnvelope | null {
  if (thread.standard !== 'iso_metric') return null;
  const expectedClass = fit === 'internal' ? '6H' : '6g';
  if (thread.class.trim() !== expectedClass) {
    throw new Error(
      translate('thread.errorIsoMetricClassUnsupported').replace('{fit}', fit).replace('{expectedClass}', expectedClass).replace('{threadClass}', thread.class),
    );
  }
  return isoMetricGrade6Envelope(thread.nominal_diameter, thread.pitch, fit);
}
type MetricPreset = readonly [
  nominalDiameterMm: number,
  pitchMm: number,
  tapDrillDiameterMm: number,
];

const metric = (
  series: Extract<HoleThreadSeries, 'metric_coarse' | 'metric_fine'>,
  values: readonly MetricPreset[],
): ThreadPreset[] => values.map(([diameter, pitch, drill]) => {
  const size = `M${diameter} x ${pitch}`;
  return {
    id: `${series}-${diameter}-${pitch}`,
    label: `${size.replace(' x ', ' × ')} — Ø${drill} mm drill`,
    standard: 'iso_metric',
    series,
    designation: `${size} - 6H`,
    class: '6H',
    nominalDiameterMm: diameter,
    pitchMm: pitch,
    threadsPerInch: null,
    tapDrillDiameterMm: drill,
    tapDrillDesignation: `${drill} mm`,
  };
});

const inch = (
  series: Extract<HoleThreadSeries, 'unc' | 'unf'>,
  values: readonly (readonly [
    size: string,
    nominalDiameterIn: number,
    threadsPerInch: number,
    tapDrillDiameterIn: number,
    tapDrillDesignation: string,
  ])[],
): ThreadPreset[] => values.map(([size, diameter, tpi, drill, drillName]) => {
  const seriesLabel = series.toUpperCase();
  return {
    id: `${series}-${size}-${tpi}`,
    label: `${size}-${tpi} ${seriesLabel} — ${drillName} drill`,
    standard: 'unified_inch',
    series,
    designation: `${size}-${tpi} ${seriesLabel}-2B`,
    class: '2B',
    nominalDiameterMm: diameter * 25.4,
    pitchMm: 25.4 / tpi,
    threadsPerInch: tpi,
    tapDrillDiameterMm: drill * 25.4,
    tapDrillDesignation: drillName,
  };
});

// JSON is shared with Rust. Validate tuple shape at the data boundary.
function metricRows(rows: readonly number[][]): MetricPreset[] {
  return rows.map(row => {
    if (row.length !== 3 || row.some(v => !Number.isFinite(v) || v <= 0)) {
      throw new Error('Invalid embedded metric thread size');
    }
    return [row[0], row[1], row[2]];
  });
}
function inchRows(rows: readonly (string | number)[][]): Parameters<typeof inch>[1] {
  return rows.map(row => {
    const [size, diameter, tpi, drill, name] = row;
    if (row.length !== 5 || typeof size !== 'string' || typeof name !== 'string'
      || typeof diameter !== 'number' || typeof tpi !== 'number' || typeof drill !== 'number'
      || [diameter, tpi, drill].some(v => !Number.isFinite(v) || v <= 0)) {
      throw new Error('Invalid embedded Unified thread size');
    }
    return [size, diameter, tpi, drill, name] as const;
  });
}

// Common ISO 261 selections. Tap drills are conventional cut-tap starting
// sizes near 75% engagement; they remain editable because material, tap style,
// and the desired thread percentage can require a different drill.
const METRIC_COARSE = metric('metric_coarse', metricRows(threadSizes.metric_coarse));

const METRIC_FINE = metric('metric_fine', metricRows(threadSizes.metric_fine));

// Common ASME B1.1 Unified selections. Decimal drill diameters are converted
// to millimetres only at the engine boundary; the familiar shop designation
// is retained in the UI and STEP metadata.
const UNC = inch('unc', inchRows(threadSizes.unc));

const UNF = inch('unf', inchRows(threadSizes.unf));

export const THREAD_PRESETS: readonly ThreadPreset[] = [
  ...METRIC_COARSE,
  ...METRIC_FINE,
  ...UNC,
  ...UNF,
];

export function presetsForSeries(series: HoleThreadSeries): readonly ThreadPreset[] {
  return THREAD_PRESETS.filter((preset) => preset.series === series);
}

export function defaultThreadPreset(): ThreadPreset {
  return THREAD_PRESETS.find((preset) => preset.id === 'metric_coarse-6-1')
    ?? THREAD_PRESETS[0]!;
}

export function threadDtoFromPreset(
  preset: ThreadPreset,
  options: Pick<HoleThreadDto, 'hand' | 'depth' | 'representation'>,
  fit: ThreadFit = 'internal',
): HoleThreadDto {
  const external = fit === 'external';
  const standardExternal = external && preset.standard !== 'custom_trapezoidal';
  const toleranceClass = standardExternal
    ? preset.standard === 'iso_metric' ? '6g' : '2A'
    : preset.class;
  const designation = standardExternal
    ? preset.standard === 'iso_metric'
      ? preset.designation.replace(/6H$/, toleranceClass)
      : preset.designation.replace(/2B$/, toleranceClass)
    : preset.designation;
  return {
    standard: preset.standard,
    series: preset.series,
    designation,
    class: toleranceClass,
    nominal_diameter: preset.nominalDiameterMm,
    pitch: preset.pitchMm,
    threads_per_inch: preset.threadsPerInch,
    hand: options.hand,
    depth: options.depth,
    representation: options.representation,
    tap_drill_designation: external ? null : preset.tapDrillDesignation,
    ...(preset.roundedProfile != null ? { rounded_profile: { ...preset.roundedProfile } } : {}),
  };
}
