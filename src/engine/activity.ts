let pending = 0;
export function pendingEngineOperations(): number { return pending; }
export async function trackEngineOperation<T>(operation: Promise<T>): Promise<T> {
  pending++;
  try { return await operation; } finally { pending--; }
}
