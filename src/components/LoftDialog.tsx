import { useEffect, useState, type FormEvent } from 'react';
import { Layers3, LoaderCircle, X } from 'lucide-react';
import { getEngine } from '../engine';
import { submitLoft } from '../engine/controller';
import type {
  ExtrudeOperation,
  LoftContinuity,
  ProfileCatalogItemDto,
  ProfileRefDto,
} from '../engine/types';
import { useTranslation } from '../i18n';
import { useAppStore } from '../store/appStore';
import { SolidOperationFields } from './SolidOperationFields';

const LABEL_CLASS = 'mb-1 block text-[10px] font-semibold uppercase tracking-wide text-mute';
const INPUT_CLASS =
  'h-7 w-full rounded border border-edge bg-header px-2 text-xs text-ink outline-none focus:border-accent';

function keyOf(section: ProfileRefDto) {
  return `${section.sketch_name}:${section.profile_index}`;
}

export function LoftDialog() {
  const { t } = useTranslation();
  const featureId = useAppStore((state) => state.loftDialogFeature);
  const close = useAppStore((state) => state.closeLoftDialog);
  const busy = useAppStore((state) => state.solidBusy);
  const bodies = useAppStore((state) => state.solidScene.bodies);
  const selectedBody = useAppStore((state) => state.selectedBody);
  const profilePicker = useAppStore((state) =>
    state.profilePicker?.owner === 'loft' ? state.profilePicker : null,
  );
  const configureProfilePicker = useAppStore((state) => state.configureProfilePicker);
  const toggleProfilePick = useAppStore((state) => state.toggleProfilePick);
  const curvePicker = useAppStore((state) =>
    state.curvePicker?.owner === 'loft_centerline' || state.curvePicker?.owner === 'loft_guide'
      ? state.curvePicker
      : null,
  );
  const configureCurvePicker = useAppStore((state) => state.configureCurvePicker);
  const replaceCurvePicks = useAppStore((state) => state.replaceCurvePicks);
  const [catalog, setCatalog] = useState<ProfileCatalogItemDto[]>([]);
  const [ruled, setRuled] = useState(false);
  const [continuity, setContinuity] = useState<LoftContinuity>('g0');
  const [centerlineEnabled, setCenterlineEnabled] = useState(false);
  const [centerlineSketch, setCenterlineSketch] = useState('');
  const [centerlineIds, setCenterlineIds] = useState<number[]>([]);
  const [guideEnabled, setGuideEnabled] = useState(false);
  const [guideSketch, setGuideSketch] = useState('');
  const [guideIds, setGuideIds] = useState<number[]>([]);
  const [operation, setOperation] = useState<ExtrudeOperation>('new_body');
  const [targets, setTargets] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sections = profilePicker?.selected ?? [];

  useEffect(() => {
    if (featureId === null) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void getEngine().then(async (engine) => {
      const [nextCatalog, definitions] = await Promise.all([
        engine.profileCatalog(), engine.loftDefinitions(),
      ]);
      if (cancelled) return;
      const usable = nextCatalog.filter((item) => item.profiles.some((profile) => profile.nesting_depth % 2 === 0));
      const edit = featureId > 0
        ? definitions.find((definition) => definition.feature_id === featureId)
        : undefined;
      const paths = nextCatalog.filter((item) => item.path_curves.length > 0);
      setCatalog(nextCatalog);
      const initialSections = edit?.sections ?? usable.slice(0, 2).flatMap((item) => item.profiles.filter((profile) => profile.nesting_depth % 2 === 0).slice(0, 1).map((profile) => ({ sketch_name: item.sketch_name, profile_index: profile.index })));
      configureProfilePicker(
        'loft',
        usable,
        initialSections,
        initialSections[initialSections.length - 1]?.sketch_name ?? usable[0]?.sketch_name ?? '',
      );
      setRuled(edit?.ruled ?? false);
      setContinuity(edit?.continuity ?? 'g0');
      const initialCenterlineSketch =
        edit?.centerline?.sketch_name ?? paths[0]?.sketch_name ?? '';
      setCenterlineEnabled(edit?.centerline != null);
      setCenterlineSketch(initialCenterlineSketch);
      setCenterlineIds(
        edit?.centerline?.entity_ids ??
          paths
            .find((item) => item.sketch_name === initialCenterlineSketch)
            ?.path_curves.slice(0, 1)
            .map((curve) => curve.entity_id) ??
          [],
      );
      const initialGuideSketch =
        edit?.guide_rail?.sketch_name ?? paths[0]?.sketch_name ?? '';
      setGuideEnabled(edit?.guide_rail != null);
      setGuideSketch(initialGuideSketch);
      setGuideIds(
        edit?.guide_rail?.entity_ids ??
          paths
            .find((item) => item.sketch_name === initialGuideSketch)
            ?.path_curves.slice(0, 1)
            .map((curve) => curve.entity_id) ??
          [],
      );
      setOperation(edit?.operation ?? 'new_body');
      setTargets(edit?.target_body_ids.length ? edit.target_body_ids : selectedBody !== null ? [selectedBody] : bodies[0] ? [bodies[0].id] : []);
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : t('loft.loadFailed'));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [bodies, configureProfilePicker, featureId, selectedBody, t]);

  useEffect(() => {
    if (!curvePicker) return;
    const ids = curvePicker.selected.map((candidate) => candidate.entityId);
    if (curvePicker.owner === 'loft_centerline') {
      setCenterlineEnabled(true);
      setCenterlineSketch(curvePicker.sketchName);
      setCenterlineIds(ids);
    } else {
      setGuideEnabled(true);
      setGuideSketch(curvePicker.sketchName);
      setGuideIds(ids);
    }
  }, [curvePicker]);

  if (featureId === null) return null;
  const profileEntries = catalog.filter((item) =>
    item.profiles.some((profile) => profile.nesting_depth % 2 === 0),
  );
  const pathEntries = catalog.filter((item) => item.path_curves.length > 0);
  const centerlineEntry = catalog.find(
    (item) => item.sketch_name === centerlineSketch,
  );
  const guideEntry = catalog.find((item) => item.sketch_name === guideSketch);
  const canSubmit = !loading && !busy && !error && sections.length >= 2
    && (!centerlineEnabled || (centerlineSketch !== '' && centerlineIds.length > 0))
    && (!guideEnabled || (guideSketch !== '' && guideIds.length > 0))
    && (operation === 'new_body' || targets.length > 0);
  const toggle = (section: ProfileRefDto) => {
    toggleProfilePick(section);
  };
  const choosePathSketch = (
    name: string,
    setSketch: (value: string) => void,
    setIds: (value: number[]) => void,
    owner: 'loft_centerline' | 'loft_guide',
  ) => {
    const ids =
      catalog
        .find((item) => item.sketch_name === name)
        ?.path_curves.slice(0, 1)
        .map((curve) => curve.entity_id) ?? [];
    setSketch(name);
    setIds(ids);
    if (curvePicker?.owner === owner) {
      replaceCurvePicks(owner, ids.map((entityId) => ({ sketchName: name, entityId })), name);
    }
  };
  const togglePathId = (
    id: number,
    setIds: React.Dispatch<React.SetStateAction<number[]>>,
    owner: 'loft_centerline' | 'loft_guide',
    sketchName: string,
  ) => {
    setIds((current) => {
      const next = current.includes(id)
        ? current.filter((candidate) => candidate !== id)
        : [...current, id];
      if (curvePicker?.owner === owner) {
        replaceCurvePicks(
          owner,
          next.map((entityId) => ({ sketchName, entityId })),
          sketchName,
        );
      }
      return next;
    });
  };
  const activateCurvePicker = (
    owner: 'loft_centerline' | 'loft_guide',
    sketchName: string,
    ids: number[],
  ) => {
    configureCurvePicker(
      owner,
      catalog,
      ids.map((entityId) => ({ sketchName, entityId })),
      sketchName,
    );
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    void submitLoft({
      sections,
      ruled,
      operation,
      target_body_ids: operation === 'new_body' ? [] : targets,
      continuity,
      centerline: centerlineEnabled
        ? { sketch_name: centerlineSketch, entity_ids: centerlineIds }
        : null,
      guide_rail: guideEnabled
        ? { sketch_name: guideSketch, entity_ids: guideIds }
        : null,
    }, featureId > 0 ? featureId : undefined);
  };

  return (
    <div
      data-native-viewport-dim="0.15"
      className="pointer-events-none fixed inset-0 z-[70] bg-black/15"
    >
      <form data-testid="loft-dialog" onSubmit={submit} className="feature-dialog pointer-events-auto absolute right-5 top-[132px] flex max-h-[calc(100vh-190px)] w-80 flex-col overflow-hidden border border-edge bg-panel">
        <header className="feature-dialog-header flex h-10 shrink-0 items-center gap-2 border-b border-edge px-3"><Layers3 size={15} className="text-accent" /><span className="flex-1 text-xs font-semibold text-ink">{featureId > 0 ? t('loft.editTitle') : t('loft.title')}</span><button type="button" onClick={close} disabled={busy} className="rounded p-1 text-mute hover:bg-edge hover:text-ink"><X size={14} /></button></header>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
          {loading ? <p className="flex items-center gap-2 text-xs text-mute"><LoaderCircle size={14} className="animate-spin" />{t('loft.loading')}</p>
            : error ? <p className="rounded border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-300">{error}</p>
              : profileEntries.length < 2 ? <p className="text-xs leading-5 text-mute">{t('loft.noProfiles')}</p>
                : <>
                  <p className="text-[10px] leading-4 text-mute">{t('solidProfile.pickHint')}</p>
                  <fieldset><legend className={LABEL_CLASS}>{t('loft.sections')}</legend><div className="space-y-1 rounded border border-edge bg-header p-2">{profileEntries.flatMap((item) => item.profiles.filter((profile) => profile.nesting_depth % 2 === 0).map((profile) => {
                    const section = { sketch_name: item.sketch_name, profile_index: profile.index };
                    const order = sections.findIndex((candidate) => keyOf(candidate) === keyOf(section));
                    return <label key={keyOf(section)} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs text-ink hover:bg-edge"><input type="checkbox" checked={order >= 0} onChange={() => toggle(section)} className="accent-accent" /><span className="flex-1">{item.sketch_name} · {t('loft.profile')} {profile.index + 1}</span>{order >= 0 && <span className="text-[10px] text-accent">#{order + 1}</span>}</label>;
                  }))}</div></fieldset>
                  <p className="text-[10px] leading-4 text-mute">{t('loft.orderHint')}</p>
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-ink"><input type="checkbox" checked={ruled} onChange={(event) => setRuled(event.target.checked)} className="accent-accent" />{t('loft.ruled')}</label>
                  <label><span className={LABEL_CLASS}>Section continuity</span><select data-testid="loft-continuity" value={continuity} onChange={(event) => setContinuity(event.target.value as LoftContinuity)} className={INPUT_CLASS}><option value="g0">G0 · Position</option><option value="g1">G1 · Tangent</option><option value="g2">G2 · Curvature</option></select></label>
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-ink"><input data-testid="loft-centerline-enabled" type="checkbox" checked={centerlineEnabled} onChange={(event) => setCenterlineEnabled(event.target.checked)} disabled={pathEntries.length === 0} className="accent-accent" />Use a centerline</label>
                  {centerlineEnabled && <>
                    <label><span className={LABEL_CLASS}>Centerline sketch</span><select data-testid="loft-centerline-sketch" value={centerlineSketch} onChange={(event) => choosePathSketch(event.target.value, setCenterlineSketch, setCenterlineIds, 'loft_centerline')} className={INPUT_CLASS}>{pathEntries.map((item) => <option key={item.sketch_name}>{item.sketch_name}</option>)}</select></label>
                    <fieldset><legend className={LABEL_CLASS}>Centerline curves</legend><button type="button" onClick={() => activateCurvePicker('loft_centerline', centerlineSketch, centerlineIds)} className={`mb-1 h-7 w-full rounded border px-2 text-xs ${curvePicker?.owner === 'loft_centerline' ? 'border-accent bg-accent/15 text-ink' : 'border-edge text-mute hover:bg-edge hover:text-ink'}`}>Pick centerline in canvas</button><div className="max-h-28 space-y-1 overflow-y-auto rounded border border-edge bg-header p-2">{centerlineEntry?.path_curves.map((curve) => <label key={curve.entity_id} className="flex cursor-pointer gap-2 text-xs text-ink"><input data-testid={`loft-centerline-${curve.entity_id}`} type="checkbox" checked={centerlineIds.includes(curve.entity_id)} onChange={() => togglePathId(curve.entity_id, setCenterlineIds, 'loft_centerline', centerlineSketch)} className="accent-accent" /><span className="capitalize">{curve.kind}</span> {curve.entity_id}</label>)}</div></fieldset>
                  </>}
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-ink"><input data-testid="loft-guide-enabled" type="checkbox" checked={guideEnabled} onChange={(event) => setGuideEnabled(event.target.checked)} disabled={pathEntries.length === 0} className="accent-accent" />Use a guide rail</label>
                  {guideEnabled && <>
                    <label><span className={LABEL_CLASS}>Guide sketch</span><select data-testid="loft-guide-sketch" value={guideSketch} onChange={(event) => choosePathSketch(event.target.value, setGuideSketch, setGuideIds, 'loft_guide')} className={INPUT_CLASS}>{pathEntries.map((item) => <option key={item.sketch_name}>{item.sketch_name}</option>)}</select></label>
                    <fieldset><legend className={LABEL_CLASS}>Guide curves</legend><button type="button" onClick={() => activateCurvePicker('loft_guide', guideSketch, guideIds)} className={`mb-1 h-7 w-full rounded border px-2 text-xs ${curvePicker?.owner === 'loft_guide' ? 'border-accent bg-accent/15 text-ink' : 'border-edge text-mute hover:bg-edge hover:text-ink'}`}>Pick guide curves in canvas</button><div className="max-h-28 space-y-1 overflow-y-auto rounded border border-edge bg-header p-2">{guideEntry?.path_curves.map((curve) => <label key={curve.entity_id} className="flex cursor-pointer gap-2 text-xs text-ink"><input data-testid={`loft-guide-${curve.entity_id}`} type="checkbox" checked={guideIds.includes(curve.entity_id)} onChange={() => togglePathId(curve.entity_id, setGuideIds, 'loft_guide', guideSketch)} className="accent-accent" /><span className="capitalize">{curve.kind}</span> {curve.entity_id}</label>)}</div></fieldset>
                  </>}
                  <SolidOperationFields operation={operation} setOperation={setOperation} targetBodies={targets} setTargetBodies={setTargets} />
                </>}
        </div>
        <footer className="flex h-11 shrink-0 items-center justify-end gap-2 border-t border-edge bg-header px-3"><button type="button" onClick={close} disabled={busy} className="h-7 rounded border border-edge px-3 text-xs text-ink hover:bg-edge">{t('loft.cancel')}</button><button data-testid="loft-ok" type="submit" disabled={!canSubmit} className="h-7 rounded bg-accent px-3 text-xs font-semibold text-white disabled:opacity-40">{t('loft.ok')}</button></footer>
      </form>
    </div>
  );
}
