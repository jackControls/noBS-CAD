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
): HoleThreadDto {
  return {
    standard: preset.standard,
    series: preset.series,
    designation: preset.designation,
    class: preset.class,
    nominal_diameter: preset.nominalDiameterMm,
    pitch: preset.pitchMm,
    threads_per_inch: preset.threadsPerInch,
    hand: options.hand,
    depth: options.depth,
    representation: options.representation,
    tap_drill_designation: preset.tapDrillDesignation,
  };
}
