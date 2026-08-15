import { useEffect, useState, type FormEvent } from 'react';
import { LoaderCircle, PanelTop, X } from 'lucide-react';
import { getEngine } from '../engine';
import { submitRib } from '../engine/controller';
import type {
  ExtrudeOperation,
  ProfileCatalogItemDto,
  RibExtent,
} from '../engine/types';
import { useTranslation } from '../i18n';
import { useAppStore } from '../store/appStore';
import { DimensionInput } from './DimensionInput';
import { SolidOperationFields } from './SolidOperationFields';

const INPUT_CLASS = 'h-7 w-full rounded border border-edge bg-header px-2 text-xs text-ink outline-none focus:border-accent';
const LABEL_CLASS = 'mb-1 block text-[10px] font-semibold uppercase tracking-wide text-mute';

export function RibDialog() {
  const { t } = useTranslation();
  const featureId = useAppStore((state) => state.ribDialogFeature);
  const close = useAppStore((state) => state.closeRibDialog);
  const busy = useAppStore((state) => state.solidBusy);
  const bodies = useAppStore((state) => state.solidScene.bodies);
  const selectedBody = useAppStore((state) => state.selectedBody);
  const selectedFace = useAppStore((state) => state.selectedFace);
  const curvePicker = useAppStore((state) =>
    state.curvePicker?.owner === 'rib_centerline' ? state.curvePicker : null,
  );
  const configureCurvePicker = useAppStore((state) => state.configureCurvePicker);
  const replaceCurvePicks = useAppStore((state) => state.replaceCurvePicks);
  const [catalog, setCatalog] = useState<ProfileCatalogItemDto[]>([]);
  const [sketchName, setSketchName] = useState('');
  const [lineIds, setLineIds] = useState<number[]>([]);
  const [thickness, setThickness] = useState('2');
  const [depth, setDepth] = useState('10');
  const [extentType, setExtentType] = useState<RibExtent['type']>('distance');
  const [toFaceId, setToFaceId] = useState(0);
  const [symmetric, setSymmetric] = useState(false);
  const [flip, setFlip] = useState(false);
  const [operation, setOperation] = useState<ExtrudeOperation>('new_body');
  const [targets, setTargets] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (featureId === null) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void getEngine().then(async (engine) => {
      const [nextCatalog, definitions] = await Promise.all([engine.profileCatalog(), engine.ribDefinitions()]);
      if (cancelled) return;
      const usable = nextCatalog.filter((item) => item.path_curves.length > 0);
      const edit = featureId > 0 ? definitions.find((definition) => definition.feature_id === featureId) : undefined;
      const initialSketch = edit?.sketch_name ?? usable[usable.length - 1]?.sketch_name ?? '';
      const initialLineIds = edit?.line_entity_ids ?? usable.find((item) => item.sketch_name === initialSketch)?.path_curves.map((curve) => curve.entity_id) ?? [];
      setCatalog(usable);
      setSketchName(initialSketch);
      setLineIds(initialLineIds);
      configureCurvePicker(
        'rib_centerline',
        usable,
        initialLineIds.map((entityId) => ({ sketchName: initialSketch, entityId })),
        initialSketch,
      );
      setThickness(String(edit?.thickness ?? 2));
      setDepth(String(edit?.extent?.type === 'distance' ? edit.extent.depth : edit?.depth ?? 10));
      setExtentType(edit?.extent?.type ?? 'distance');
      setToFaceId(
        edit?.extent?.type === 'to_face'
          ? edit.extent.face_id
          : bodies
              .flatMap((body) => body.faces)
              .find((face) => face.plane !== null)?.id ?? 0,
      );
      setSymmetric(edit?.symmetric ?? false);
      setFlip(edit?.flip ?? false);
      setOperation(edit?.operation ?? (bodies.length ? 'join' : 'new_body'));
      setTargets(edit?.target_body_ids.length ? edit.target_body_ids : selectedBody !== null ? [selectedBody] : bodies[0] ? [bodies[0].id] : []);
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : t('rib.loadFailed'));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [bodies, configureCurvePicker, featureId, selectedBody, t]);

  useEffect(() => {
    if (!curvePicker) return;
    setSketchName(curvePicker.sketchName);
    setLineIds(curvePicker.selected.map((candidate) => candidate.entityId));
  }, [curvePicker]);

  useEffect(() => {
    if (featureId === null || extentType !== 'to_face' || selectedFace === null) return;
    const planar = bodies.some((body) =>
      body.faces.some((face) => face.id === selectedFace && face.plane !== null),
    );
    if (planar) setToFaceId(selectedFace);
  }, [bodies, extentType, featureId, selectedFace]);

  if (featureId === null) return null;
  const selected = catalog.find((item) => item.sketch_name === sketchName);
  const thicknessValue = Number(thickness);
  const depthValue = Number(depth);
  const canSubmit = !loading && !busy && !error && sketchName !== '' && lineIds.length > 0
    && Number.isFinite(thicknessValue) && thicknessValue > 0
    && (extentType !== 'distance' || (Number.isFinite(depthValue) && depthValue > 0))
    && (extentType !== 'to_face' || toFaceId > 0)
    && (extentType !== 'to_next' || operation !== 'new_body')
    && (operation === 'new_body' || targets.length > 0);
  const chooseSketch = (name: string) => {
    const entry = catalog.find((item) => item.sketch_name === name);
    const ids = entry?.path_curves.map((curve) => curve.entity_id) ?? [];
    setSketchName(name);
    setLineIds(ids);
    replaceCurvePicks(
      'rib_centerline',
      ids.map((entityId) => ({ sketchName: name, entityId })),
      name,
    );
  };
  const toggleLine = (id: number) => setLineIds((current) => {
    const next = current.includes(id)
      ? current.filter((candidate) => candidate !== id)
      : [...current, id];
    replaceCurvePicks(
      'rib_centerline',
      next.map((entityId) => ({ sketchName, entityId })),
      sketchName,
    );
    return next;
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    const extent: RibExtent =
      extentType === 'distance'
        ? { type: 'distance', depth: depthValue }
        : extentType === 'to_face'
          ? { type: 'to_face', face_id: toFaceId }
          : extentType === 'to_next'
            ? { type: 'to_next' }
            : { type: 'through_all' };
    void submitRib({ sketch_name: sketchName, line_entity_ids: lineIds, thickness: thicknessValue, depth: depthValue, extent, symmetric, flip, operation, target_body_ids: operation === 'new_body' ? [] : targets }, featureId > 0 ? featureId : undefined);
  };

  return (
    <div
      data-native-viewport-dim="0.15"
      className="pointer-events-none fixed inset-0 z-[70] bg-black/15"
    >
      <form data-testid="rib-dialog" onSubmit={submit} className="feature-dialog pointer-events-auto absolute right-5 top-[132px] flex max-h-[calc(100vh-190px)] w-80 flex-col overflow-hidden border border-edge bg-panel">
        <header className="feature-dialog-header flex h-10 shrink-0 items-center gap-2 border-b border-edge px-3"><PanelTop size={15} className="text-accent" /><span className="flex-1 text-xs font-semibold text-ink">{featureId > 0 ? t('rib.editTitle') : t('rib.title')}</span><button type="button" onClick={close} disabled={busy} className="rounded p-1 text-mute hover:bg-edge hover:text-ink"><X size={14} /></button></header>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
          {loading ? <p className="flex items-center gap-2 text-xs text-mute"><LoaderCircle size={14} className="animate-spin" />{t('rib.loading')}</p>
            : error ? <p className="rounded border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-300">{error}</p>
              : catalog.length === 0 ? <p className="text-xs text-mute">{t('rib.noLines')}</p>
                : <>
                  <label><span className={LABEL_CLASS}>{t('rib.sketch')}</span><select data-testid="rib-sketch" value={sketchName} onChange={(event) => chooseSketch(event.target.value)} className={INPUT_CLASS}>{catalog.map((item) => <option key={item.sketch_name}>{item.sketch_name}</option>)}</select></label>
                  <fieldset><legend className={LABEL_CLASS}>Centerline curves</legend><p className="mb-1 text-[10px] leading-4 text-mute">Click visible finished-sketch curves in the canvas to add or remove them.</p><div className="max-h-32 space-y-1 overflow-y-auto rounded border border-edge bg-header p-2">{selected?.path_curves.map((curve) => <label key={curve.entity_id} className="flex cursor-pointer gap-2 text-xs text-ink"><input data-testid={`rib-centerline-${curve.entity_id}`} type="checkbox" checked={lineIds.includes(curve.entity_id)} onChange={() => toggleLine(curve.entity_id)} className="accent-accent" /><span className="capitalize">{curve.kind}</span> {curve.entity_id}</label>)}</div></fieldset>
                  <label><span className={LABEL_CLASS}>Extent</span><select data-testid="rib-extent" value={extentType} onChange={(event) => setExtentType(event.target.value as RibExtent['type'])} className={INPUT_CLASS}><option value="distance">Distance</option><option value="to_next">To Next</option><option value="to_face">Up to Face</option><option value="through_all">Through All</option></select></label>
                  {extentType === 'to_next' && operation === 'new_body' && <p className="rounded border border-amber-500/30 bg-amber-500/10 p-2 text-[10px] leading-4 text-amber-200">To Next needs Add, Subtract, or Common so there is a target body to stop at.</p>}
                  <div className="grid grid-cols-2 gap-2"><label><span className={LABEL_CLASS}>{t('rib.thickness')}</span><DimensionInput autoSelectKey={lineIds.length > 0 ? `${sketchName}:${lineIds.join(',')}` : null} data-testid="rib-thickness" min="0.000001" step="any" value={thickness} onValueChange={setThickness} /></label>{extentType === 'distance' && <label><span className={LABEL_CLASS}>{t('rib.depth')}</span><DimensionInput data-testid="rib-depth" min="0.000001" step="any" value={depth} onValueChange={setDepth} /></label>}</div>
                  {extentType === 'to_face' && <label><span className={LABEL_CLASS}>Target planar face</span><select data-testid="rib-to-face" value={toFaceId} onChange={(event) => setToFaceId(Number(event.target.value))} className={INPUT_CLASS}><option value={0}>Select a face</option>{bodies.flatMap((body) => body.faces.map((face, index) => ({ body, face, index }))).filter(({ face }) => face.plane !== null).map(({ body, face, index }) => <option key={face.id} value={face.id}>{body.name} · Face {index + 1} (#{face.id})</option>)}</select></label>}
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-ink"><input type="checkbox" checked={symmetric} onChange={(event) => setSymmetric(event.target.checked)} className="accent-accent" />{t('rib.symmetric')}</label>
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-ink"><input type="checkbox" checked={flip} onChange={(event) => setFlip(event.target.checked)} className="accent-accent" />{t('rib.flip')}</label>
                  <SolidOperationFields operation={operation} setOperation={setOperation} targetBodies={targets} setTargetBodies={setTargets} />
                </>}
        </div>
        <footer className="flex h-11 shrink-0 items-center justify-end gap-2 border-t border-edge bg-header px-3"><button type="button" onClick={close} disabled={busy} className="h-7 rounded border border-edge px-3 text-xs text-ink hover:bg-edge">{t('rib.cancel')}</button><button data-testid="rib-ok" type="submit" disabled={!canSubmit} className="h-7 rounded bg-accent px-3 text-xs font-semibold text-white disabled:opacity-40">{t('rib.ok')}</button></footer>
      </form>
    </div>
  );
}
