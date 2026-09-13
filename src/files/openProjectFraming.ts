/** Open owns one initial view; ordinary edits, tabs and drawing navigation do
 * not. A viewport may be temporarily unmounted while Open replaces a drawing. */
export interface OpenedProjectOwner {
  document: unknown;
  activeProjectTabId: string | null;
}

let pending: OpenedProjectOwner | null = null;
const listeners = new Set<() => void>();

export function requestOpenedProjectFraming(owner: OpenedProjectOwner): void {
  pending = {document: owner.document, activeProjectTabId: owner.activeProjectTabId};
  // A mounted viewport has already rebuilt from the synchronous store update.
  // Its zero-duration fit must apply before Open acknowledges success.
  for (const listener of listeners) listener();
}

export function consumeOpenedProjectFraming(owner: OpenedProjectOwner): boolean {
  const requested = pending;
  // Claim before fitting: camera completion may synchronously notify observers.
  pending = null;
  return requested !== null && requested.document === owner.document
    && requested.activeProjectTabId === owner.activeProjectTabId;
}

export function subscribeOpenedProjectFraming(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
