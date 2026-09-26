import type { CameraSnapshot } from '../components/viewport/cameraApi';

/** One pending camera request, owned by the document that produced it. Open
 * frames the loaded model and a tab activation restores that tab's own view;
 * ordinary edits and drawing navigation never queue one. A viewport may be
 * temporarily unmounted while Drawings replaces it, so the request waits for
 * the next mount and is discarded once another document owns the viewport. */
export interface ProjectFramingOwner {
  document: unknown;
  activeProjectTabId: string | null;
}

export interface ProjectFramingRequest {
  /** Restore this exact pose; `null` frames the home view instead. */
  camera: CameraSnapshot | null;
}

let pending: (ProjectFramingOwner & ProjectFramingRequest) | null = null;
const listeners = new Set<() => void>();

export function requestProjectFraming(
  owner: ProjectFramingOwner,
  camera: CameraSnapshot | null = null,
): void {
  pending = {document: owner.document, activeProjectTabId: owner.activeProjectTabId, camera};
  // A mounted viewport has already rebuilt from the synchronous store update.
  // Its zero-duration pose must apply before the caller acknowledges success.
  for (const listener of listeners) listener();
}

export function consumeProjectFraming(owner: ProjectFramingOwner): ProjectFramingRequest | null {
  const requested = pending;
  // Claim before applying: camera completion may synchronously notify observers.
  pending = null;
  if (requested === null || requested.document !== owner.document
    || requested.activeProjectTabId !== owner.activeProjectTabId) return null;
  return {camera: requested.camera};
}

export function subscribeProjectFraming(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
