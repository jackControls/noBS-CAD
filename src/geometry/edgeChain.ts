import { getEngine } from '../engine';
import type { GeometryEdgeChain, GeometryEdgeChainRequest } from '../engine/types';

/** Selection policy/context, independent of CAM. Geometry work stays in Rust.
 * Replace this object when the scene or geometry source changes. */
export interface EdgeChainContext {
  source: 'model' | 'sketch';
  bodyIds: number[];
  normal: [number, number, number];
}

// Only small selection results are retained, not meshes or document snapshots.
const caches = new WeakMap<EdgeChainContext, Map<string, Promise<GeometryEdgeChain>>>();
export function resolveEdgeChain(
  context: EdgeChainContext,
  keys: string[],
  mode: 'manual' | 'closed' = 'manual',
  reversed = false,
): Promise<GeometryEdgeChain> {
  let cache = caches.get(context);
  if (!cache) { cache = new Map(); caches.set(context, cache); }
  const key = JSON.stringify([mode, reversed, keys]);
  const existing = cache.get(key);
  if (existing) return existing;
  const request: GeometryEdgeChainRequest = {
    source: context.source, body_ids: context.bodyIds, normal: context.normal,
    keys, mode, reversed,
  };
  const result = getEngine().then(engine => engine.geometryEdgeChain(request));
  cache.set(key, result);
  while (cache.size > 16) cache.delete(cache.keys().next().value!);
  void result.then(chain => {
    if (chain.points.length > 4096) cache.delete(key);
  }, () => cache.delete(key));
  return result;
}
