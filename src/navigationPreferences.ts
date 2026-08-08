export const SIX_DOF_SPEED_STORAGE_KEY = 'nbcad.sixDofSpeed';
export const DEFAULT_SIX_DOF_SPEED = 1.5;
export const MIN_SIX_DOF_SPEED = 0.25;
export const MAX_SIX_DOF_SPEED = 3;

export function clampSixDofSpeed(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SIX_DOF_SPEED;
  return Math.min(MAX_SIX_DOF_SPEED, Math.max(MIN_SIX_DOF_SPEED, value));
}

/** Missing or invalid preferences intentionally use the faster CAD default. */
export function readSixDofSpeed(): number {
  if (typeof window === 'undefined') return DEFAULT_SIX_DOF_SPEED;
  try {
    const stored = Number.parseFloat(
      window.localStorage.getItem(SIX_DOF_SPEED_STORAGE_KEY) ?? '',
    );
    return Number.isFinite(stored)
      ? clampSixDofSpeed(stored)
      : DEFAULT_SIX_DOF_SPEED;
  } catch {
    return DEFAULT_SIX_DOF_SPEED;
  }
}

export function persistSixDofSpeed(value: number): number {
  const clamped = clampSixDofSpeed(value);
  if (typeof window === 'undefined') return clamped;
  try {
    window.localStorage.setItem(SIX_DOF_SPEED_STORAGE_KEY, String(clamped));
  } catch {
    // A locked-down webview can deny storage. The live preference still works.
  }
  return clamped;
}
