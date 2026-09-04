import { useEffect, useState, type FormEvent } from 'react';
import { LoaderCircle, MoveRight, X } from 'lucide-react';
import { getEngine } from '../engine';
import { cancelTimelineFeatureEdit, submitSweep } from '../engine/controller';
import type {
  ExtrudeOperation,
  ProfileCatalogItemDto,
  SweepOrientation,
  SweepTransition,
} from '../engine/types';
import { useTranslation } from '../i18n';
import { useAppStore } from '../store/appStore';
import { SolidOperationFields } from './SolidOperationFields';
import { ViewportSelectionField } from './ViewportSelectionField';

const INPUT_CLASS =
  'h-7 w-full rounded border border-edge bg-header px-2 text-xs text-ink outline-none focus:border-accent';
const LABEL_CLASS = 'mb-1 block text-[10px] font-semibold uppercase tracking-wide text-mute';

export function SweepDialog() {
  const { t } = useTranslation();
  const featureId = useAppStore((state) => state.sweepDialogFeature);
  const close = useAppStore((state) => state.closeSweepDialog);
  const cancel = () => void cancelTimelineFeatureEdit(close);
  const busy = useAppStore((state) => state.solidBusy);
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
  const modelingPickTarget = useAppStore((state) => state.modelingPickTarget);
  const setModelingPickTarget = useAppStore((state) => state.setModelingPickTarget);
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
    const initiallySelectedBody = useAppStore.getState().selectedBody;
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
        const nextProfileIndex = edit?.profile.profile_index;
        configureProfilePicker(
          'sweep',
          nextCatalog,
          nextProfileIndex === undefined
            ? []
            : [{ sketch_name: nextProfileSketch, profile_index: nextProfileIndex }],
          nextProfileSketch,
        );
        const nextPathIds = edit?.path_entity_ids ?? [];
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
        setGuideIds(edit?.guide_rail?.entity_ids ?? []);
        setOrientation(edit?.orientation ?? 'corrected_frenet');
        setTransition(edit?.transition ?? 'transformed');
        setForceC1(edit?.force_c1 ?? false);
        setOperation(edit?.operation ?? 'new_body');
        setTargetBodies(
          edit?.target_body_ids.length
            ? edit.target_body_ids
            : initiallySelectedBody !== null
              ? [initiallySelectedBody]
              : [],
        );
        setModelingPickTarget(
          nextProfileIndex === undefined ? 'sweep_profile' : 'sweep_path',
        );
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : t('sweep.loadFailed'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [
    configureCurvePicker,
    configureProfilePicker,
    featureId,
    setModelingPickTarget,
    t,
  ]);

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
  const canSubmit = !loading && !busy && !error && profileSketch !== '' && pathSketch !== ''
    && pickedProfile !== undefined && pathIds.length > 0
    && (!guideEnabled || (guideSketch !== '' && guideIds.length > 0))
    && (operation === 'new_body' || targetBodies.length > 0);

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
    setModelingPickTarget(owner === 'sweep_path' ? 'sweep_path' : 'sweep_guide');
  };
  const activateProfilePicker = () => {
    configureProfilePicker(
      'sweep',
      catalog,
      pickedProfile ? [pickedProfile] : [],
      profileSketch,
    );
    setModelingPickTarget('sweep_profile');
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
          <button type="button" onClick={cancel} disabled={busy} className="rounded p-1 text-mute hover:bg-edge hover:text-ink"><X size={14} /></button>
        </header>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
          {loading ? <p className="flex items-center gap-2 text-xs text-mute"><LoaderCircle size={14} className="animate-spin" />{t('sweep.loading')}</p>
            : error ? <p className="rounded border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-300">{error}</p>
              : profileEntries.length === 0 || pathEntries.length === 0 ? <p className="text-xs text-mute">{t('sweep.noGeometry')}</p>
                : <>
                  <ViewportSelectionField
                    testId="sweep-profile-selection"
                    label={t('sweep.profile')}
                    status={pickedProfile ? `Profile selected · ${profileSketch}` : 'Click a closed profile in the viewport'}
                    hint="The selected profile is highlighted in the model."
                    active={modelingPickTarget === 'sweep_profile'}
                    hasSelection={pickedProfile !== undefined}
                    onActivate={activateProfilePicker}
                    onClear={() => {
                      replaceProfilePicks('sweep', [], profileSketch);
                      setModelingPickTarget('sweep_profile');
                    }}
                  />
                  <ViewportSelectionField
                    testId="sweep-path-selection"
                    label="Path"
                    status={pathIds.length > 0 ? `${pathIds.length} path ${pathIds.length === 1 ? 'curve' : 'curves'} selected · ${pathSketch}` : 'Click the path in the viewport'}
                    hint="Click connected sketch curves to add or remove them."
                    active={modelingPickTarget === 'sweep_path'}
                    hasSelection={pathIds.length > 0}
                    onActivate={() => activateCurvePicker('sweep_path', pathSketch, pathIds)}
                    onClear={() => {
                      setPathIds([]);
                      replaceCurvePicks('sweep_path', [], pathSketch);
                      setModelingPickTarget('sweep_path');
                    }}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <label><span className={LABEL_CLASS}>Orientation</span><select data-testid="sweep-orientation" value={orientation} onChange={(event) => setOrientation(event.target.value as SweepOrientation)} className={INPUT_CLASS}><option value="corrected_frenet">Corrected Frenet</option><option value="frenet">Frenet</option><option value="fixed">Fixed profile</option></select></label>
                    <label><span className={LABEL_CLASS}>Corner transition</span><select data-testid="sweep-transition" value={transition} onChange={(event) => setTransition(event.target.value as SweepTransition)} className={INPUT_CLASS}><option value="transformed">Transformed</option><option value="right_corner">Right corner</option><option value="round_corner">Round corner</option></select></label>
                  </div>
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-ink"><input data-testid="sweep-force-c1" type="checkbox" checked={forceC1} onChange={(event) => setForceC1(event.target.checked)} className="accent-accent" />Force C1 continuity where possible</label>
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-ink"><input data-testid="sweep-guide-enabled" type="checkbox" checked={guideEnabled} onChange={(event) => {
                    const enabled = event.target.checked;
                    setGuideEnabled(enabled);
                    if (enabled) activateCurvePicker('sweep_guide', guideSketch, guideIds);
                    else if (modelingPickTarget === 'sweep_guide') {
                      activateCurvePicker('sweep_path', pathSketch, pathIds);
                    }
                  }} className="accent-accent" />Use a guide rail</label>
                  {guideEnabled && <>
                    <ViewportSelectionField
                      testId="sweep-guide-selection"
                      label="Guide rail"
                      status={guideIds.length > 0 ? `${guideIds.length} guide ${guideIds.length === 1 ? 'curve' : 'curves'} selected · ${guideSketch}` : 'Click a guide rail in the viewport'}
                      hint="The guide is optional and may use connected sketch curves."
                      active={modelingPickTarget === 'sweep_guide'}
                      hasSelection={guideIds.length > 0}
                      onActivate={() => activateCurvePicker('sweep_guide', guideSketch, guideIds)}
                      onClear={() => {
                        setGuideIds([]);
                        replaceCurvePicks('sweep_guide', [], guideSketch);
                        setModelingPickTarget('sweep_guide');
                      }}
                    />
                  </>}
                  <SolidOperationFields operation={operation} setOperation={setOperation} targetBodies={targetBodies} setTargetBodies={setTargetBodies} pickTarget="sweep_targets" />
                </>}
        </div>
        <footer className="flex h-11 shrink-0 items-center justify-end gap-2 border-t border-edge bg-header px-3"><button type="button" onClick={cancel} disabled={busy} className="h-7 rounded border border-edge px-3 text-xs text-ink hover:bg-edge">{t('sweep.cancel')}</button><button data-testid="sweep-ok" type="submit" disabled={!canSubmit} className="h-7 rounded bg-accent px-3 text-xs font-semibold text-white disabled:opacity-40">{t('sweep.ok')}</button></footer>
      </form>
    </div>
  );
}
