import { resolveEdgeChain } from '../geometry/edgeChain';
import { useAppStore, type CamChainPickSession, type CamChainSelection } from '../store/appStore';

let pickRevision = 0;
let pendingPicks: Promise<void> = Promise.resolve();
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

function activate(session: CamChainPickSession, chains: CamChainSelection[], index: number): CamChainPickSession {
  const chain = chains[index];
  return { ...session, chains, activeChainIndex: index, selectedKeys: chain.keys, mode: chain.mode,
    hoverKey: null, hoverKeys: [], busy: false, pickError: null, direction: null };
}

export function selectCamChain(index: number): void {
  ++pickRevision;
  const state = useAppStore.getState(), session = state.camChainPick;
  if (session?.chains?.[index]) state.setCamChainPick(activate(session, session.chains, index));
}

export function addCamChain(): void {
  ++pickRevision;
  const state = useAppStore.getState(), session = state.camChainPick;
  if (!session?.chains || session.chains.length >= 64) return;
  const empty = session.chains.findIndex(c => !c.keys.length);
  const chains = empty >= 0 ? session.chains : [...session.chains, { keys: [], reversed: false, mode: session.mode ?? 'closed' }];
  state.setCamChainPick(activate(session, chains, empty >= 0 ? empty : chains.length - 1));
}

export function removeCamChain(index: number): void {
  ++pickRevision;
  const state = useAppStore.getState(), session = state.camChainPick;
  if (!session?.chains?.[index]) return;
  const chains = session.chains.filter((_, i) => i !== index);
  if (!chains.length) chains.push({ keys: [], reversed: false, mode: session.mode ?? 'closed' });
  const active = session.activeChainIndex ?? 0;
  state.setCamChainPick(activate(session, chains, Math.min(active - Number(index < active), chains.length - 1)));
}

export function editCamChain(change: { mode?: 'closed' | 'manual'; selectedKeys?: string[]; reversed?: boolean; wallSide?: CamChainSelection['wallSide'] }): void {
  ++pickRevision;
  const state = useAppStore.getState();
  const session = state.camChainPick;
  if (!session) return;
  if (session.chains) {
    const index = session.activeChainIndex ?? 0;
    const chains = session.chains.map((c, i) => i !== index ? c : { ...c,
      keys: change.selectedKeys ?? c.keys, mode: change.mode ?? c.mode,
      reversed: change.reversed ?? c.reversed, wallSide: change.wallSide ?? c.wallSide });
    state.setCamChainPick(activate(session, chains, index));
  } else state.setCamChainPick({ ...session, ...change, hoverKey: null, hoverKeys: [], busy: false, pickError: null, direction: null });
}

export async function pickCamChain(key: string, individual = false): Promise<void> {
  const state = useAppStore.getState();
  const session = state.camChainPick;
  if (!session) return;
  if (!session.entities.some(e => e.key === key)) return;
  if (individual || session.mode !== 'closed' || !session.context) {
    if (session.chains?.some((c, i) => i !== (session.activeChainIndex ?? 0) && c.keys.includes(key))) {
      state.setCamChainPick({ ...session, pickError: 'That edge belongs to another chain. Select that chain to edit it.' });
      return;
    }
    editCamChain({ mode: 'manual', selectedKeys: session.selectedKeys.includes(key)
      ? session.selectedKeys.filter(k => k !== key) : [...session.selectedKeys, key] });
    return;
  }
  if (session.chains) {
    // Queue successive clicks in pick order. A slow loop resolver must not
    // discard the previous hole just because the next rim was clicked.
    const revision = pickRevision;
    const context = session.context;
    pendingPicks = pendingPicks.catch(() => {}).then(async () => {
      let current = useAppStore.getState().camChainPick;
      if (revision !== pickRevision || current?.context !== context || !current.chains) return;
      state.setCamChainPick({ ...current, busy: true, pickError: null });
      try {
        const chain = await resolveEdgeChain(context, [key], 'closed');
        current = useAppStore.getState().camChainPick;
        if (revision !== pickRevision || current?.context !== context || !current.chains) return;
        const overlaps = current.chains.map((c, i) => c.keys.some(k => chain.keys.includes(k)) ? i : -1).filter(i => i >= 0);
        if (overlaps.length > 1) throw Error('This loop overlaps more than one selected chain. Remove those chains before selecting the complete loop.');
        const index = overlaps[0] ?? (current.selectedKeys.length ? current.chains.length : current.activeChainIndex ?? 0);
        if (index >= 64) throw Error('A chamfer operation supports up to 64 chains.');
        const chains = [...current.chains];
        chains[index] = { keys: chain.keys, reversed: chains[index]?.reversed ?? false, mode: 'closed', wallSide: chains[index]?.wallSide };
        state.setCamChainPick(activate(current, chains, index));
      } catch (error) {
        current = useAppStore.getState().camChainPick;
        if (revision === pickRevision && current?.context === context) state.setCamChainPick({ ...current, busy: false, pickError: message(error) });
      }
    });
    return pendingPicks;
  }
  const revision = ++pickRevision;
  state.setCamChainPick({ ...session, busy: true, pickError: null });
  try {
    const chain = await resolveEdgeChain(session.context, [key], 'closed');
    const current = useAppStore.getState().camChainPick;
    if (!current || revision !== pickRevision || current.context !== session.context || current.mode !== 'closed') return;
    const same = chain.keys.length === current.selectedKeys.length && chain.keys.every(k => current.selectedKeys.includes(k));
    useAppStore.getState().setCamChainPick({ ...current, selectedKeys: same ? [] : chain.keys, busy: false, pickError: null });
  } catch (error) {
    const current = useAppStore.getState().camChainPick;
    if (!current || revision !== pickRevision || current.context !== session.context || current.mode !== 'closed') return;
    useAppStore.getState().setCamChainPick({ ...current, busy: false, pickError: message(error) });
  }
}

export async function hoverCamChain(key: string | null): Promise<void> {
  const state = useAppStore.getState();
  const session = state.camChainPick;
  if (!session || session.hoverKey === key) return;
  state.setCamChainPick({ ...session, hoverKey: key, hoverKeys: key ? [key] : [] });
  if (!key || session.mode !== 'closed' || !session.context) return;
  try {
    const chain = await resolveEdgeChain(session.context, [key], 'closed');
    const current = useAppStore.getState().camChainPick;
    if (current?.context === session.context && current.hoverKey === key && current.mode === 'closed') {
      useAppStore.getState().setCamChainPick({ ...current, hoverKeys: chain.keys });
    }
  } catch { /* A failed hover is not an operation error; a click explains it. */ }
}
