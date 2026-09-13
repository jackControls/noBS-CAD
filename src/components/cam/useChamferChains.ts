import { useEffect, useState } from 'react';
import { getEngine } from '../../engine';
import type { CamChamferGeometry, GeometryEdgeChain } from '../../engine/types';
import { resolveEdgeChain, type EdgeChainContext } from '../../geometry/edgeChain';
import type { CamChainSelection } from '../../store/appStore';

export interface ResolvedChamferChain {
  chain: GeometryEdgeChain | null;
  geometry: CamChamferGeometry | null;
  error: string | null;
}

/** Geometry remains Rust-owned. Draft/result identity fences prevent a stale
 * asynchronous result being saved after a pick, reverse, source or model edit. */
export function useChamferChains(context: EdgeChainContext | undefined,
  chains: CamChainSelection[] | undefined, setupId: number | undefined, modeled: boolean) {
  const [result, setResult] = useState<{
    context: typeof context; chains: typeof chains; setupId: typeof setupId; modeled: boolean;
    resolved: ResolvedChamferChain[];
  } | null>(null);
  useEffect(() => {
    if (!context || !chains || setupId === undefined) { setResult(null); return; }
    let active = true;
    void Promise.all(chains.map(async (selection): Promise<ResolvedChamferChain> => {
      if (!selection.keys.length) return { chain: null, geometry: null, error: null };
      try {
        const chain = await resolveEdgeChain(context, selection.keys, 'manual', selection.reversed);
        const geometry = modeled ? await (await getEngine()).camChamferGeometry({
          setup_id: setupId, chain_ref: { source: context.source, keys: selection.keys, reversed: selection.reversed },
        }) : null;
        return { chain, geometry, error: null };
      } catch (error) { return { chain: null, geometry: null, error: String(error) }; }
    })).then(resolved => { if (active) setResult({ context, chains, setupId, modeled, resolved }); });
    return () => { active = false; };
  }, [context, chains, setupId, modeled]);
  return result?.context === context && result?.chains === chains && result?.setupId === setupId && result?.modeled === modeled
    ? result.resolved : null;
}
