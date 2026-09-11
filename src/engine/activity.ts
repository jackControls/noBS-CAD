let pending = 0;
const listeners = new Set<() => void>();
export function subscribeEngineOperations(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function changed(): void { for (const listener of listeners) listener(); }
export function pendingEngineOperations(): number { return pending; }
export async function trackEngineOperation<T>(operation: Promise<T>): Promise<T> {
  pending++;
  changed();
  try { return await operation; } finally { pending--; changed(); }
}
