import { useEffect, useState, type FormEvent } from 'react';
import { LoaderCircle, MoveRight, X } from 'lucide-react';
import { getEngine } from '../engine';
import { submitSweep } from '../engine/controller';
import type {
  ExtrudeOperation,
  ProfileCatalogItemDto,
  SweepOrientation,
  SweepTransition,
} from '../engine/types';
import { useTranslation } from '../i18n';
import { useAppStore } from '../store/appStore';
import { SolidOperationFields } from './SolidOperationFields';

const INPUT_CLASS =
  'h-7 w-full rounded border border-edge bg-header px-2 text-xs text-ink outline-none focus:border-accent';
const LABEL_CLASS = 'mb-1 block text-[10px] font-semibold uppercase tracking-wide text-mute';

export function SweepDialog() {
  const { t } = useTranslation();
  const featureId = useAppStore((state) => state.sweepDialogFeature);
  const close = useAppStore((state) => state.closeSweepDialog);
  const busy = useAppStore((state) => state.solidBusy);
  const bodies = useAppStore((state) => state.solidScene.bodies);
  const selectedBody = useAppStore((state) => state.selectedBody);
  const profilePicker = useAppStore((state) =>
    state.profilePicker?.owner === 'sweep' ? state.profilePicker : null,
  );
  const configureProfilePicker = useAppStore((state) => state.configureProfilePicker);
  const replaceProfilePicks = useAppStore((state) => state.replaceProfilePicks);
  const curvePicker = useAppStore((state) =>
    state.curvePicker?.owner === 'sweep_path' || state.curvePicker?.owner === 'sweep_guide'
      ? state.curvePicker
      : null,
  );
  const configureCurvePicker = useAppStore((state) => state.configureCurvePicker);
  const replaceCurvePicks = useAppStore((state) => state.replaceCurvePicks);
  const [catalog, setCatalog] = useState<ProfileCatalogItemDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pathSketch, setPathSketch] = useState('');
  const [pathIds, setPathIds] = useState<number[]>([]);
  const [guideEnabled, setGuideEnabled] = useState(false);
  const [guideSketch, setGuideSketch] = useState('');
  const [guideIds, setGuideIds] = useState<number[]>([]);
  const [orientation, setOrientation] =
    useState<SweepOrientation>('corrected_frenet');
  const [transition, setTransition] =
    useState<SweepTransition>('transformed');
  const [forceC1, setForceC1] = useState(false);
  const [operation, setOperation] = useState<ExtrudeOperation>('new_body');
  const [targetBodies, setTargetBodies] = useState<number[]>([]);
  const pickedProfile = profilePicker?.selected[0];
  const profileSketch = pickedProfile?.sketch_name ?? profilePicker?.sketchName ?? '';
  const profileIndex = pickedProfile?.profile_index ?? 0;

  useEffect(() => {
    if (featureId === null) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void getEngine()
      .then(async (engine) => {
        const [nextCatalog, definitions] = await Promise.all([
          engine.profileCatalog(),
          engine.sweepDefinitions(),
        ]);
        if (cancelled) return;
        const profiles = nextCatalog.filter((item) => item.profiles.some((profile) => profile.nesting_depth % 2 === 0));
        const paths = nextCatalog.filter((item) => item.path_curves.length > 0);
        const edit = featureId > 0
          ? definitions.find((definition) => definition.feature_id === featureId)
          : undefined;
        const nextProfileSketch = edit?.profile.sketch_name ?? profiles[0]?.sketch_name ?? '';
        const nextPathSketch = edit?.path_sketch_name ?? paths[paths.length - 1]?.sketch_name ?? '';
        setCatalog(nextCatalog);
        const nextProfileIndex =
          edit?.profile.profile_index
          ?? profiles.find((item) => item.sketch_name === nextProfileSketch)?.profiles.find((profile) => profile.nesting_depth % 2 === 0)?.index;
        configureProfilePicker(
          'sweep',
          nextCatalog,
          nextProfileIndex === undefined
            ? []
            : [{ sketch_name: nextProfileSketch, profile_index: nextProfileIndex }],
          nextProfileSketch,
        );
        const nextPathIds =
          edit?.path_entity_ids
          ?? paths.find((item) => item.sketch_name === nextPathSketch)?.path_curves.slice(0, 1).map((curve) => curve.entity_id)
          ?? [];
        setPathSketch(nextPathSketch);
        setPathIds(nextPathIds);
        configureCurvePicker(
          'sweep_path',
          nextCatalog,
          nextPathIds.map((entityId) => ({ sketchName: nextPathSketch, entityId })),
          nextPathSketch,
        );
        const nextGuideSketch =
          edit?.guide_rail?.sketch_name ?? paths[0]?.sketch_name ?? '';
        setGuideEnabled(edit?.guide_rail != null);
        setGuideSketch(nextGuideSketch);
        setGuideIds(
          edit?.guide_rail?.entity_ids ??
            paths
              .find((item) => item.sketch_name === nextGuideSketch)
              ?.path_curves.slice(0, 1)
              .map((curve) => curve.entity_id) ??
            [],
        );
        setOrientation(edit?.orientation ?? 'corrected_frenet');
        setTransition(edit?.transition ?? 'transformed');
        setForceC1(edit?.force_c1 ?? false);
        setOperation(edit?.operation ?? 'new_body');
        setTargetBodies(
          edit?.target_body_ids.length
            ? edit.target_body_ids
            : selectedBody !== null
              ? [selectedBody]
              : bodies[0]
                ? [bodies[0].id]
                : [],
        );
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : t('sweep.loadFailed'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [bodies, configureCurvePicker, configureProfilePicker, featureId, selectedBody, t]);

  useEffect(() => {
    if (!curvePicker) return;
    const ids = curvePicker.selected.map((candidate) => candidate.entityId);
    if (curvePicker.owner === 'sweep_path') {
      setPathSketch(curvePicker.sketchName);
      setPathIds(ids);
    } else {
      setGuideEnabled(true);
      setGuideSketch(curvePicker.sketchName);
      setGuideIds(ids);
    }
  }, [curvePicker]);

  if (featureId === null) return null;
  const profileEntries = catalog.filter((item) => item.profiles.some((profile) => profile.nesting_depth % 2 === 0));
  const pathEntries = catalog.filter((item) => item.path_curves.length > 0);
  const selectedProfileSketch = catalog.find((item) => item.sketch_name === profileSketch);
  const selectedPathSketch = catalog.find((item) => item.sketch_name === pathSketch);
  const selectedGuideSketch = catalog.find((item) => item.sketch_name === guideSketch);
  const canSubmit = !loading && !busy && !error && profileSketch !== '' && pathSketch !== ''
    && pickedProfile !== undefined && pathIds.length > 0
    && (!guideEnabled || (guideSketch !== '' && guideIds.length > 0))
    && (operation === 'new_body' || targetBodies.length > 0);

  const chooseProfileSketch = (name: string) => {
    const nextIndex = catalog.find((item) => item.sketch_name === name)
      ?.profiles.find((profile) => profile.nesting_depth % 2 === 0)?.index;
    replaceProfilePicks(
      'sweep',
      nextIndex === undefined ? [] : [{ sketch_name: name, profile_index: nextIndex }],
      name,
    );
  };
  const choosePathSketch = (name: string) => {
    const ids = catalog.find((item) => item.sketch_name === name)?.path_curves.slice(0, 1).map((curve) => curve.entity_id) ?? [];
    setPathSketch(name);
    setPathIds(ids);
    if (curvePicker?.owner === 'sweep_path') {
      replaceCurvePicks('sweep_path', ids.map((entityId) => ({ sketchName: name, entityId })), name);
    }
  };
  const togglePath = (id: number) => {
    setPathIds((current) => {
      const next = current.includes(id)
        ? current.filter((candidate) => candidate !== id)
        : [...current, id];
      if (curvePicker?.owner === 'sweep_path') {
        replaceCurvePicks('sweep_path', next.map((entityId) => ({ sketchName: pathSketch, entityId })), pathSketch);
      }
      return next;
    });
  };
  const chooseGuideSketch = (name: string) => {
    const ids =
      catalog
        .find((item) => item.sketch_name === name)
        ?.path_curves.slice(0, 1)
        .map((curve) => curve.entity_id) ?? [];
    setGuideSketch(name);
    setGuideIds(ids);
    if (curvePicker?.owner === 'sweep_guide') {
      replaceCurvePicks(
        'sweep_guide',
        ids.map((entityId) => ({ sketchName: name, entityId })),
        name,
      );
    }
  };
  const toggleGuide = (id: number) => {
    setGuideIds((current) => {
      const next = current.includes(id)
        ? current.filter((candidate) => candidate !== id)
        : [...current, id];
      if (curvePicker?.owner === 'sweep_guide') {
        replaceCurvePicks('sweep_guide', next.map((entityId) => ({ sketchName: guideSketch, entityId })), guideSketch);
      }
      return next;
    });
  };
  const activateCurvePicker = (
    owner: 'sweep_path' | 'sweep_guide',
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
    void submitSweep({
      profile: { sketch_name: profileSketch, profile_index: profileIndex },
      path_sketch_name: pathSketch,
      path_entity_ids: pathIds,
      operation,
      target_body_ids: operation === 'new_body' ? [] : targetBodies,
      guide_rail: guideEnabled
        ? { sketch_name: guideSketch, entity_ids: guideIds }
        : null,
      orientation,
      transition,
      force_c1: forceC1,
    }, featureId > 0 ? featureId : undefined);
  };

  return (
    <div
      data-native-viewport-dim="0.15"
      className="pointer-events-none fixed inset-0 z-[70] bg-black/15"
    >
      <form data-testid="sweep-dialog" onSubmit={submit} className="feature-dialog pointer-events-auto absolute right-5 top-[132px] flex max-h-[calc(100vh-190px)] w-80 flex-col overflow-hidden border border-edge bg-panel">
        <header className="feature-dialog-header flex h-10 shrink-0 items-center gap-2 border-b border-edge px-3">
          <MoveRight size={15} className="text-accent" />
          <span className="flex-1 text-xs font-semibold text-ink">{featureId > 0 ? t('sweep.editTitle') : t('sweep.title')}</span>
          <button type="button" onClick={close} disabled={busy} className="rounded p-1 text-mute hover:bg-edge hover:text-ink"><X size={14} /></button>
        </header>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
          {loading ? <p className="flex items-center gap-2 text-xs text-mute"><LoaderCircle size={14} className="animate-spin" />{t('sweep.loading')}</p>
            : error ? <p className="rounded border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-300">{error}</p>
              : profileEntries.length === 0 || pathEntries.length === 0 ? <p className="text-xs text-mute">{t('sweep.noGeometry')}</p>
                : <>
                  <label><span className={LABEL_CLASS}>{t('sweep.profileSketch')}</span><select data-testid="sweep-profile-sketch" value={profileSketch} onChange={(event) => chooseProfileSketch(event.target.value)} className={INPUT_CLASS}>{profileEntries.map((item) => <option key={item.sketch_name}>{item.sketch_name}</option>)}</select></label>
                  <p className="text-[10px] leading-4 text-mute">{t('solidProfile.pickHint')}</p>
                  <label><span className={LABEL_CLASS}>{t('sweep.profile')}</span><select data-testid="sweep-profile" value={profileIndex} onChange={(event) => replaceProfilePicks('sweep', [{ sketch_name: profileSketch, profile_index: Number(event.target.value) }], profileSketch)} className={INPUT_CLASS}>{selectedProfileSketch?.profiles.filter((profile) => profile.nesting_depth % 2 === 0).map((profile) => <option key={profile.index} value={profile.index}>{t('sweep.profile')} {profile.index + 1}</option>)}</select></label>
                  <label><span className={LABEL_CLASS}>{t('sweep.pathSketch')}</span><select data-testid="sweep-path-sketch" value={pathSketch} onChange={(event) => choosePathSketch(event.target.value)} className={INPUT_CLASS}>{pathEntries.map((item) => <option key={item.sketch_name}>{item.sketch_name}</option>)}</select></label>
                  <fieldset><legend className={LABEL_CLASS}>Path curves</legend><button type="button" onClick={() => activateCurvePicker('sweep_path', pathSketch, pathIds)} className={`mb-1 h-7 w-full rounded border px-2 text-xs ${curvePicker?.owner === 'sweep_path' ? 'border-accent bg-accent/15 text-ink' : 'border-edge text-mute hover:bg-edge hover:text-ink'}`}>Pick path curves in canvas</button><div className="max-h-32 space-y-1 overflow-y-auto rounded border border-edge bg-header p-2">{selectedPathSketch?.path_curves.map((curve) => <label key={curve.entity_id} className="flex cursor-pointer gap-2 text-xs text-ink"><input data-testid={`sweep-path-${curve.entity_id}`} type="checkbox" checked={pathIds.includes(curve.entity_id)} onChange={() => togglePath(curve.entity_id)} className="accent-accent" /><span className="capitalize">{curve.kind}</span> {curve.entity_id}</label>)}</div></fieldset>
                  <div className="grid grid-cols-2 gap-2">
                    <label><span className={LABEL_CLASS}>Orientation</span><select data-testid="sweep-orientation" value={orientation} onChange={(event) => setOrientation(event.target.value as SweepOrientation)} className={INPUT_CLASS}><option value="corrected_frenet">Corrected Frenet</option><option value="frenet">Frenet</option><option value="fixed">Fixed profile</option></select></label>
                    <label><span className={LABEL_CLASS}>Corner transition</span><select data-testid="sweep-transition" value={transition} onChange={(event) => setTransition(event.target.value as SweepTransition)} className={INPUT_CLASS}><option value="transformed">Transformed</option><option value="right_corner">Right corner</option><option value="round_corner">Round corner</option></select></label>
                  </div>
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-ink"><input data-testid="sweep-force-c1" type="checkbox" checked={forceC1} onChange={(event) => setForceC1(event.target.checked)} className="accent-accent" />Force C1 continuity where possible</label>
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-ink"><input data-testid="sweep-guide-enabled" type="checkbox" checked={guideEnabled} onChange={(event) => setGuideEnabled(event.target.checked)} className="accent-accent" />Use a guide rail</label>
                  {guideEnabled && <>
                    <label><span className={LABEL_CLASS}>Guide sketch</span><select data-testid="sweep-guide-sketch" value={guideSketch} onChange={(event) => chooseGuideSketch(event.target.value)} className={INPUT_CLASS}>{pathEntries.map((item) => <option key={item.sketch_name}>{item.sketch_name}</option>)}</select></label>
                    <fieldset><legend className={LABEL_CLASS}>Guide curves</legend><button type="button" onClick={() => activateCurvePicker('sweep_guide', guideSketch, guideIds)} className={`mb-1 h-7 w-full rounded border px-2 text-xs ${curvePicker?.owner === 'sweep_guide' ? 'border-accent bg-accent/15 text-ink' : 'border-edge text-mute hover:bg-edge hover:text-ink'}`}>Pick guide curves in canvas</button><div className="max-h-28 space-y-1 overflow-y-auto rounded border border-edge bg-header p-2">{selectedGuideSketch?.path_curves.map((curve) => <label key={curve.entity_id} className="flex cursor-pointer gap-2 text-xs text-ink"><input data-testid={`sweep-guide-${curve.entity_id}`} type="checkbox" checked={guideIds.includes(curve.entity_id)} onChange={() => toggleGuide(curve.entity_id)} className="accent-accent" /><span className="capitalize">{curve.kind}</span> {curve.entity_id}</label>)}</div></fieldset>
                  </>}
                  <SolidOperationFields operation={operation} setOperation={setOperation} targetBodies={targetBodies} setTargetBodies={setTargetBodies} />
                </>}
        </div>
        <footer className="flex h-11 shrink-0 items-center justify-end gap-2 border-t border-edge bg-header px-3"><button type="button" onClick={close} disabled={busy} className="h-7 rounded border border-edge px-3 text-xs text-ink hover:bg-edge">{t('sweep.cancel')}</button><button data-testid="sweep-ok" type="submit" disabled={!canSubmit} className="h-7 rounded bg-accent px-3 text-xs font-semibold text-white disabled:opacity-40">{t('sweep.ok')}</button></footer>
      </form>
    </div>
  );
}
