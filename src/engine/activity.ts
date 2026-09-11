export type EngineOperationOwner = symbol;
const pending = new Set<EngineOperationOwner>();
const listeners = new Set<() => void>();
export function subscribeEngineOperations(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function changed(): void { for (const listener of listeners) listener(); }
export function pendingEngineOperations(owner?: EngineOperationOwner): number {
  return pending.size - (owner && pending.has(owner) ? 1 : 0);
}
export async function trackEngineOperation<T>(operation: Promise<T> | ((owner: EngineOperationOwner) => Promise<T>)): Promise<T> {
  const owner = Symbol('engine operation');
  pending.add(owner);
  changed();
  try { return await (typeof operation === 'function' ? operation(owner) : operation); }
  finally { pending.delete(owner); changed(); }
}
