import type { CamCoolantMode, CamCuttingParametersDto, CamToolDto, CamUnits } from '../engine/types';
import {
  commitCuttingSpeed, commitFeed, commitLength, cuttingSpeedFromRpm,
  displayCuttingSpeed, displayFeed, displayLength, rpmFromCuttingSpeed,
} from './units';

/** Only the last-edited side of each pair is stored. Derived display rounding
 * never feeds back into calculations or overwrites an unfinished input. */
export interface CuttingDraft {
  speed: { mode: 'rpm' | 'surface'; value: string };
  feed: { mode: 'feed' | 'per_tooth'; value: string };
  plunge: { mode: 'feed' | 'per_rev'; value: string };
}
export type CuttingField = 'rpm' | 'surfaceSpeed' | 'feedXy' | 'feedPerTooth' | 'feedZ' | 'feedPerRev';
export interface CuttingContext {
  units: CamUnits;
  tool: Pick<CamToolDto, 'diameter' | 'flute_count'> | null | undefined;
}
const text = (value: number) => Number.isFinite(value) ? String(Number(value.toPrecision(12))) : '';
function positive(value: string | number | undefined, label: string): number {
  const parsed = Number(value);
  if (value === undefined || String(value).trim() === '' || !Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} needs a positive finite number.`);
  }
  return parsed;
}
function flutes(context: CuttingContext): number {
  const count = positive(context.tool?.flute_count, 'Tool flute/insert count');
  if (!Number.isInteger(count)) throw new Error('Tool flute/insert count must be a whole number.');
  return count;
}
const diameter = (context: CuttingContext) => positive(context.tool?.diameter, 'Tool diameter');

export function cuttingDraftFrom(cutting: CamCuttingParametersDto | undefined, units: CamUnits): CuttingDraft {
  return {
    speed: { mode: 'rpm', value: cutting ? String(cutting.spindle_rpm) : '' },
    feed: { mode: 'feed', value: cutting ? String(displayFeed(cutting.feed_xy, units)) : '' },
    plunge: { mode: 'feed', value: cutting ? String(displayFeed(cutting.feed_z, units)) : '' },
  };
}

export function editCuttingDraft(draft: CuttingDraft, field: CuttingField, value: string): CuttingDraft {
  switch (field) {
    case 'rpm': return { ...draft, speed: { mode: 'rpm', value } };
    case 'surfaceSpeed': return { ...draft, speed: { mode: 'surface', value } };
    case 'feedXy': return { ...draft, feed: { mode: 'feed', value } };
    case 'feedPerTooth': return { ...draft, feed: { mode: 'per_tooth', value } };
    case 'feedZ': return { ...draft, plunge: { mode: 'feed', value } };
    case 'feedPerRev': return { ...draft, plunge: { mode: 'per_rev', value } };
  }
}

function resolveRpm(draft: CuttingDraft, context: CuttingContext): number {
  const rpm = draft.speed.mode === 'surface'
    ? rpmFromCuttingSpeed(commitCuttingSpeed(positive(draft.speed.value, 'Surface speed'), context.units), diameter(context))
    : Math.round(positive(draft.speed.value, 'Spindle speed'));
  if (!Number.isSafeInteger(rpm) || rpm < 1 || rpm > 0xffff_ffff) {
    throw new Error('Resolved spindle speed must be between 1 and 4294967295 rpm. Check surface speed and tool diameter.');
  }
  return rpm;
}
function resolveFeed(draft: CuttingDraft, context: CuttingContext): number {
  return positive(draft.feed.mode === 'per_tooth'
    ? commitLength(positive(draft.feed.value, 'Feed per tooth'), context.units) * resolveRpm(draft, context) * flutes(context)
    : commitFeed(positive(draft.feed.value, 'Cutting feedrate'), context.units), 'Resolved cutting feedrate');
}
function resolvePlunge(draft: CuttingDraft, context: CuttingContext): number {
  return positive(draft.plunge.mode === 'per_rev'
    ? commitLength(positive(draft.plunge.value, 'Feed per revolution'), context.units) * resolveRpm(draft, context)
    : commitFeed(positive(draft.plunge.value, 'Plunge feed'), context.units), 'Resolved plunge feed');
}

/** Invalid or incomplete driver inputs blank their dependents, never retain a
 * stale number that could accidentally be saved. Submit resolves them strictly. */
export function cuttingDraftValues(draft: CuttingDraft, context: CuttingContext): Record<CuttingField, string> {
  const derive = (calculate: () => number) => { try { return text(calculate()); } catch { return ''; } };
  return {
    rpm: draft.speed.mode === 'rpm' ? draft.speed.value : derive(() => resolveRpm(draft, context)),
    surfaceSpeed: draft.speed.mode === 'surface' ? draft.speed.value
      : derive(() => displayCuttingSpeed(cuttingSpeedFromRpm(resolveRpm(draft, context), diameter(context)), context.units)),
    feedXy: draft.feed.mode === 'feed' ? draft.feed.value
      : derive(() => displayFeed(resolveFeed(draft, context), context.units)),
    feedPerTooth: draft.feed.mode === 'per_tooth' ? draft.feed.value
      : derive(() => displayLength(resolveFeed(draft, context) / (resolveRpm(draft, context) * flutes(context)), context.units)),
    feedZ: draft.plunge.mode === 'feed' ? draft.plunge.value
      : derive(() => displayFeed(resolvePlunge(draft, context), context.units)),
    feedPerRev: draft.plunge.mode === 'per_rev' ? draft.plunge.value
      : derive(() => displayLength(resolvePlunge(draft, context) / resolveRpm(draft, context), context.units)),
  };
}

export function resolveCuttingDraft(
  draft: CuttingDraft, context: CuttingContext, coolant: CamCoolantMode, holemaking = false,
): CamCuttingParametersDto {
  const spindle_rpm = resolveRpm(draft, context);
  const feed_z = resolvePlunge(draft, context);
  return { spindle_rpm, feed_xy: holemaking ? feed_z : resolveFeed(draft, context), feed_z, coolant };
}

export function convertCuttingDraftUnits(draft: CuttingDraft, from: CamUnits, to: CamUnits): CuttingDraft {
  if (from === to) return draft;
  const convert = (value: string, surface = false) => {
    if (!value.trim() || !Number.isFinite(Number(value))) return value;
    return text(surface ? displayCuttingSpeed(commitCuttingSpeed(Number(value), from), to)
      : displayLength(commitLength(Number(value), from), to));
  };
  return {
    speed: { ...draft.speed, value: draft.speed.mode === 'surface' ? convert(draft.speed.value, true) : draft.speed.value },
    feed: { ...draft.feed, value: convert(draft.feed.value) },
    plunge: { ...draft.plunge, value: convert(draft.plunge.value) },
  };
}
