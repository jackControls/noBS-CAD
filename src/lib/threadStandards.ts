import type {
  HoleThreadDto,
  HoleThreadSeries,
  HoleThreadStandard,
} from '../engine/types';

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
  tapDrillDesignation: string;
}

export type ThreadFit = 'internal' | 'external';

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
    throw new Error('Thread nominal diameter must be positive');
  }
  if (!Number.isFinite(pitch) || pitch <= 0) {
    throw new Error('Thread pitch must be positive');
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
      `ISO metric ${fit} modeling currently supports tolerance class ${expectedClass}, got ${thread.class}`,
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

// Common ISO 261 selections. Tap drills are conventional cut-tap starting
// sizes near 75% engagement; they remain editable because material, tap style,
// and the desired thread percentage can require a different drill.
const METRIC_COARSE = metric('metric_coarse', [
  [1.6, 0.35, 1.25],
  [2, 0.4, 1.6],
  [2.5, 0.45, 2.05],
  [3, 0.5, 2.5],
  [3.5, 0.6, 2.9],
  [4, 0.7, 3.3],
  [4.5, 0.75, 3.7],
  [5, 0.8, 4.2],
  [6, 1, 5],
  [7, 1, 6],
  [8, 1.25, 6.8],
  [10, 1.5, 8.5],
  [12, 1.75, 10.2],
  [14, 2, 12],
  [16, 2, 14],
  [18, 2.5, 15.5],
  [20, 2.5, 17.5],
  [22, 2.5, 19.5],
  [24, 3, 21],
  [27, 3, 24],
  [30, 3.5, 26.5],
  [33, 3.5, 29.5],
  [36, 4, 32],
]);

const METRIC_FINE = metric('metric_fine', [
  [3, 0.35, 2.65],
  [4, 0.5, 3.5],
  [5, 0.5, 4.5],
  [6, 0.75, 5.25],
  [6, 0.5, 5.5],
  [8, 1, 7],
  [8, 0.75, 7.25],
  [10, 1.25, 8.8],
  [10, 1, 9],
  [12, 1.5, 10.5],
  [12, 1.25, 10.8],
  [12, 1, 11],
  [14, 1.5, 12.5],
  [16, 1.5, 14.5],
  [18, 1.5, 16.5],
  [20, 2, 18],
  [20, 1.5, 18.5],
  [22, 1.5, 20.5],
  [24, 2, 22],
  [24, 1.5, 22.5],
  [27, 2, 25],
  [30, 2, 28],
  [33, 2, 31],
  [36, 3, 33],
  [36, 2, 34],
]);

// Common ASME B1.1 Unified selections. Decimal drill diameters are converted
// to millimetres only at the engine boundary; the familiar shop designation
// is retained in the UI and STEP metadata.
const UNC = inch('unc', [
  ['#1', 0.073, 64, 0.0595, '#53'],
  ['#2', 0.086, 56, 0.0700, '#50'],
  ['#3', 0.099, 48, 0.0785, '#47'],
  ['#4', 0.112, 40, 0.0890, '#43'],
  ['#5', 0.125, 40, 0.1015, '#38'],
  ['#6', 0.138, 32, 0.1065, '#36'],
  ['#8', 0.164, 32, 0.1360, '#29'],
  ['#10', 0.190, 24, 0.1495, '#25'],
  ['#12', 0.216, 24, 0.1770, '#16'],
  ['1/4', 0.25, 20, 0.2010, '#7'],
  ['5/16', 0.3125, 18, 0.2570, 'F'],
  ['3/8', 0.375, 16, 0.3125, '5/16 in'],
  ['7/16', 0.4375, 14, 0.3680, 'U'],
  ['1/2', 0.5, 13, 0.421875, '27/64 in'],
  ['9/16', 0.5625, 12, 0.484375, '31/64 in'],
  ['5/8', 0.625, 11, 0.53125, '17/32 in'],
  ['3/4', 0.75, 10, 0.65625, '21/32 in'],
  ['7/8', 0.875, 9, 0.765625, '49/64 in'],
  ['1', 1, 8, 0.875, '7/8 in'],
  ['1 1/8', 1.125, 7, 0.984375, '63/64 in'],
  ['1 1/4', 1.25, 7, 1.109375, '1 7/64 in'],
  ['1 3/8', 1.375, 6, 1.203125, '1 13/64 in'],
  ['1 1/2', 1.5, 6, 1.328125, '1 21/64 in'],
]);

const UNF = inch('unf', [
  ['#0', 0.060, 80, 0.0469, '3/64 in'],
  ['#1', 0.073, 72, 0.0595, '#53'],
  ['#2', 0.086, 64, 0.0700, '#50'],
  ['#3', 0.099, 56, 0.0820, '#45'],
  ['#4', 0.112, 48, 0.0935, '#42'],
  ['#5', 0.125, 44, 0.1040, '#37'],
  ['#6', 0.138, 40, 0.1130, '#33'],
  ['#8', 0.164, 36, 0.1360, '#29'],
  ['#10', 0.190, 32, 0.1590, '#21'],
  ['#12', 0.216, 28, 0.1820, '#14'],
  ['1/4', 0.25, 28, 0.2130, '#3'],
  ['5/16', 0.3125, 24, 0.2720, 'I'],
  ['3/8', 0.375, 24, 0.3320, 'Q'],
  ['7/16', 0.4375, 20, 0.390625, '25/64 in'],
  ['1/2', 0.5, 20, 0.453125, '29/64 in'],
  ['9/16', 0.5625, 18, 0.515625, '33/64 in'],
  ['5/8', 0.625, 18, 0.578125, '37/64 in'],
  ['3/4', 0.75, 16, 0.6875, '11/16 in'],
  ['7/8', 0.875, 14, 0.8125, '13/16 in'],
  ['1', 1, 12, 0.921875, '59/64 in'],
  ['1 1/8', 1.125, 12, 1.046875, '1 3/64 in'],
  ['1 1/4', 1.25, 12, 1.171875, '1 11/64 in'],
  ['1 3/8', 1.375, 12, 1.296875, '1 19/64 in'],
  ['1 1/2', 1.5, 12, 1.421875, '1 27/64 in'],
]);

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
  const toleranceClass = external
    ? preset.standard === 'iso_metric' ? '6g' : '2A'
    : preset.class;
  const designation = external
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
  };
}
