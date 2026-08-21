import { useAppStore, type CamPointPickCandidate } from '../store/appStore';

/**
 * Shared viewport point-picking session.
 *
 * Several CAM inputs are "a point the operator can see": stock/model box
 * lattice points, sketch points drawn earlier, and (later) hole/feature
 * positions. This module is the single abstraction for that interaction: the
 * requester (a dialog) supplies candidates + a prompt, the CAM viewport
 * renders and hit-tests them, and the promise resolves with the chosen
 * candidate (or null on cancel). Modeling-side pickers (e.g. hole placement)
 * can migrate onto the same session instead of growing parallel systems.
 *
 * At most one session runs at a time; starting a new one cancels the old.
 */

let resolver: ((candidate: CamPointPickCandidate | null) => void) | null = null;

export function requestCamPointPick(
  candidates: CamPointPickCandidate[],
  prompt: string,
): Promise<CamPointPickCandidate | null> {
  finish(null);
  useAppStore.getState().setCamPointPick({ prompt, candidates });
  return new Promise((resolve) => {
    resolver = resolve;
  });
}

/** Called by the viewport when the operator clicks a candidate. */
export function completeCamPointPick(candidate: CamPointPickCandidate): void {
  finish(candidate);
}

/** Called by the viewport (Escape) or when the requesting dialog closes. */
export function cancelCamPointPick(): void {
  finish(null);
}

function finish(candidate: CamPointPickCandidate | null): void {
  const resolve = resolver;
  resolver = null;
  if (useAppStore.getState().camPointPick) {
    useAppStore.getState().setCamPointPick(null);
  }
  resolve?.(candidate);
}
