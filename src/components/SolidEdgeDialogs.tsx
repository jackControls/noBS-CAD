import { useEffect, useState, type FormEvent } from 'react';
import { Blend, LoaderCircle, MousePointer2, Triangle, X } from 'lucide-react';
import { getEngine } from '../engine';
import {
  submitSolidChamfer,
  submitSolidFillet,
  tangentChainEdges,
} from '../engine/controller';
import { useTranslation } from '../i18n';
import { useAppStore } from '../store/appStore';
import { DimensionInput } from './DimensionInput';

const INPUT_CLASS = 'h-7 w-full rounded border border-edge bg-header px-2 text-xs text-ink outline-none focus:border-accent';
const LABEL_CLASS = 'mb-1 block text-[10px] font-semibold uppercase tracking-wide text-mute';

function SolidEdgeDialog({ kind }: { kind: 'fillet' | 'chamfer' }) {
  const { t } = useTranslation();
  const featureId = useAppStore((state) =>
    kind === 'fillet' ? state.filletDialogFeature : state.chamferDialogFeature,
  );
  const close = useAppStore((state) =>
    kind === 'fillet' ? state.closeFilletDialog : state.closeChamferDialog,
  );
  const busy = useAppStore((state) => state.solidBusy);
  const bodies = useAppStore((state) => state.solidScene.bodies);
  const selectedBody = useAppStore((state) => state.selectedBody);
  const selectedEdges = useAppStore((state) => state.selectedEdges);
  const setSelectedBody = useAppStore((state) => state.setSelectedBody);
  const setSelectedFace = useAppStore((state) => state.setSelectedFace);
  const setSelectedFacePoint = useAppStore((state) => state.setSelectedFacePoint);
  const setSelectedEdges = useAppStore((state) => state.setSelectedEdges);
  const setHoveredEdge = useAppStore((state) => state.setHoveredEdge);
  const [size, setSize] = useState(kind === 'fillet' ? '2' : '2');
  const [tangentChain, setTangentChain] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (featureId === null) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void getEngine()
      .then(async (engine) => {
        const definitions = kind === 'fillet'
          ? await engine.filletDefinitions()
          : await engine.chamferDefinitions();
        if (cancelled) return;
        const edit = featureId > 0
          ? definitions.find((definition) => definition.feature_id === featureId)
          : undefined;
        const current = useAppStore.getState();
        const currentBody = current.selectedBody !== null
          && bodies.some((candidate) => candidate.id === current.selectedBody)
          ? current.selectedBody
          : null;
        const initialBody = edit?.body_id ?? currentBody ?? bodies[0]?.id ?? 0;
        const validEdgeIds = new Set(
          bodies
            .find((candidate) => candidate.id === initialBody)
            ?.edges
            .filter((edge) => edge.refinable)
            .map((edge) => edge.id) ?? [],
        );
        const initialEdges = (
          edit?.edge_ids
          ?? (current.selectedBody === initialBody ? current.selectedEdges : [])
        ).filter((edgeId) => validEdgeIds.has(edgeId));
        current.setSelectedBody(initialBody > 0 ? initialBody : null);
        current.setSelectedFace(null);
        current.setSelectedFacePoint(null);
        current.setSelectedEdges(initialEdges);
        current.setHoveredEdge(null);
        setSize(String(edit ? ('radius' in edit ? edit.radius : edit.distance) : 2));
        setTangentChain(edit?.tangent_chain ?? false);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : t('solidEdge.loadFailed'));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [bodies, featureId, kind, t]);

  if (featureId === null) return null;
  const bodyId = selectedBody ?? bodies[0]?.id ?? 0;
  const body = bodies.find((candidate) => candidate.id === bodyId);
  const validEdgeIds = new Set(
    body?.edges.filter((edge) => edge.refinable).map((edge) => edge.id) ?? [],
  );
  const edgeIds = selectedEdges.filter((edgeId) => validEdgeIds.has(edgeId));
  const value = Number(size);
  const canSubmit = !loading && !busy && !error && bodyId > 0 && edgeIds.length > 0
    && Number.isFinite(value) && value > 0;
  const selectBody = (nextBodyId: number) => {
    setSelectedBody(nextBodyId);
    setSelectedFace(null);
    setSelectedFacePoint(null);
    setSelectedEdges([]);
    setHoveredEdge(null);
  };
  const closeDialog = () => {
    setHoveredEdge(null);
    close();
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    const resolvedEdges = tangentChain ? tangentChainEdges(bodyId, edgeIds) : edgeIds;
    if (kind === 'fillet') {
      void submitSolidFillet(
        { body_id: bodyId, edge_ids: resolvedEdges, radius: value, tangent_chain: tangentChain },
        featureId > 0 ? featureId : undefined,
      );
    } else {
      void submitSolidChamfer(
        { body_id: bodyId, edge_ids: resolvedEdges, distance: value, tangent_chain: tangentChain },
        featureId > 0 ? featureId : undefined,
      );
    }
  };
  const Icon = kind === 'fillet' ? Blend : Triangle;
  const title = featureId > 0
    ? t(kind === 'fillet' ? 'solidEdge.editFillet' : 'solidEdge.editChamfer')
    : t(kind === 'fillet' ? 'solidEdge.fillet' : 'solidEdge.chamfer');

  return (
    <div
      data-native-viewport-dim="0.15"
      className="pointer-events-none fixed inset-0 z-[70] bg-black/15"
    >
      <form data-testid={`solid-${kind}-dialog`} onSubmit={submit} className="feature-dialog pointer-events-auto absolute right-5 top-[132px] flex max-h-[calc(100vh-190px)] w-80 flex-col overflow-hidden border border-edge bg-panel">
        <header className="feature-dialog-header flex h-10 shrink-0 items-center gap-2 border-b border-edge px-3">
          <Icon size={15} className="text-accent" />
          <span className="flex-1 text-xs font-semibold text-ink">{title}</span>
          <button type="button" title={t('solidEdge.cancel')} onClick={closeDialog} disabled={busy} className="rounded p-1 text-mute hover:bg-edge hover:text-ink"><X size={14} /></button>
        </header>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
          {loading ? <p className="flex items-center gap-2 text-xs text-mute"><LoaderCircle size={14} className="animate-spin" />{t('solidEdge.loading')}</p>
            : error ? <p className="rounded border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-300">{error}</p>
              : bodies.length === 0 ? <p className="text-xs text-mute">{t('solidEdge.noBodies')}</p>
                : <>
                  <label><span className={LABEL_CLASS}>{t('solidEdge.body')}</span><select data-testid={`solid-${kind}-body`} value={bodyId} onChange={(event) => selectBody(Number(event.target.value))} className={INPUT_CLASS}>{bodies.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label>
                  <fieldset>
                    <legend className={LABEL_CLASS}>{t('solidEdge.edges')}</legend>
                    <div data-testid={`solid-${kind}-edge-selection`} className="rounded border border-edge bg-header p-2">
                      <div className="flex min-h-7 items-center gap-2 text-xs text-ink">
                        <MousePointer2 size={14} className={edgeIds.length > 0 ? 'text-accent' : 'text-mute'} />
                        <span aria-live="polite" className="flex-1">
                          {edgeIds.length === 0
                            ? t('solidEdge.pickEdges')
                            : `${edgeIds.length} ${t(edgeIds.length === 1 ? 'solidEdge.edgeSelected' : 'solidEdge.edgesSelected')}`}
                        </span>
                        {edgeIds.length > 0 && (
                          <button
                            data-testid={`solid-${kind}-clear-edges`}
                            type="button"
                            onClick={() => {
                              setSelectedEdges([]);
                              setHoveredEdge(null);
                            }}
                            className="rounded border border-edge px-2 py-1 text-[10px] text-mute hover:bg-edge hover:text-ink"
                          >
                            {t('solidEdge.clear')}
                          </button>
                        )}
                      </div>
                      <p className="mt-1 text-[10px] leading-4 text-mute">{t('solidEdge.selectionHint')}</p>
                    </div>
                  </fieldset>
                  <label><span className={LABEL_CLASS}>{t(kind === 'fillet' ? 'solidEdge.radius' : 'solidEdge.distance')}</span><DimensionInput data-testid={`solid-${kind}-size`} min="0.000001" step="any" value={size} onValueChange={setSize} /></label>
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-ink"><input type="checkbox" checked={tangentChain} onChange={(event) => setTangentChain(event.target.checked)} className="accent-accent" />{t('solidEdge.tangentChain')}</label>
                </>}
        </div>
        <footer className="flex h-11 shrink-0 items-center justify-end gap-2 border-t border-edge bg-header px-3"><button data-testid={`solid-${kind}-cancel`} type="button" onClick={closeDialog} disabled={busy} className="h-7 rounded border border-edge px-3 text-xs text-ink hover:bg-edge">{t('solidEdge.cancel')}</button><button data-testid={`solid-${kind}-ok`} type="submit" disabled={!canSubmit} className="h-7 rounded bg-accent px-3 text-xs font-semibold text-white disabled:opacity-40">{t('solidEdge.ok')}</button></footer>
      </form>
    </div>
  );
}

export function SolidFilletDialog() {
  return <SolidEdgeDialog kind="fillet" />;
}

export function SolidChamferDialog() {
  return <SolidEdgeDialog kind="chamfer" />;
}
