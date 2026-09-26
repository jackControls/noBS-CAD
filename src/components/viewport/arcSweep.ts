import { signedSweep } from './toolPreview';

const TAU = 2 * Math.PI;
// Ignore hand jitter before choosing CW/CCW; never relatch during this arc.
const DIRECTION_THRESHOLD = 2 * Math.PI / 180;

export interface ArcTravel {
  lastAngle: number;
  travel: number;
  direction: -1 | 0 | 1;
}

export function beginArcTravel(startAngle: number): ArcTravel {
  return { lastAngle: startAngle, travel: 0, direction: 0 };
}

/** Follow the cursor around the first deliberately chosen direction, including
 * major arcs and a full revolution. Crossing the start ray cannot flip sign. */
export function advanceArcTravel(state: ArcTravel, cursorAngle: number): number {
  const step = signedSweep(state.lastAngle, cursorAngle);
  state.lastAngle = cursorAngle;
  state.travel = Math.max(-TAU, Math.min(TAU, state.travel + step));
  if (state.direction === 0) {
    if (Math.abs(state.travel) < DIRECTION_THRESHOLD) return 0;
    state.direction = state.travel < 0 ? -1 : 1;
  }
  const directed = state.direction * state.travel;
  const magnitude = Math.abs(directed) >= TAU - 1e-9
    ? TAU
    : ((directed % TAU) + TAU) % TAU;
  return state.direction * magnitude;
}

/** A typed signed angle is authoritative, even if the pointer moves afterwards.
 * Zero stays zero (a non-committable arc), rather than reverting to the mouse. */
export function resolvedArcSweep(travel: number, lockedAngleDeg: number | undefined): number {
  return lockedAngleDeg === undefined || !Number.isFinite(lockedAngleDeg)
    ? travel
    : lockedAngleDeg * Math.PI / 180;
}

/** Replacing an autofilled negative magnitude keeps CW. An explicit + or -
 * always replaces the sign too; formulas are entered verbatim. */
export function beginArcAngleText(autofill: string, key: string): string {
  return autofill.startsWith('-') && /^[\d.]$/.test(key) ? `-${key}` : key;
}
