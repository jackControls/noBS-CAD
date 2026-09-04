import { useEffect, useState, type FormEvent } from 'react';
import { Layers3, LoaderCircle, X } from 'lucide-react';
import { getEngine } from '../engine';
import { cancelTimelineFeatureEdit, submitLoft } from '../engine/controller';
import type {
  ExtrudeOperation,
  LoftContinuity,
  ProfileCatalogItemDto,
  ProfileRefDto,
} from '../engine/types';
import { useTranslation } from '../i18n';
import { useAppStore } from '../store/appStore';
import { SolidOperationFields } from './SolidOperationFields';
import { ViewportSelectionField } from './ViewportSelectionField';

const LABEL_CLASS = 'mb-1 block text-[10px] font-semibold uppercase tracking-wide text-mute';
const INPUT_CLASS =
  'h-7 w-full rounded border border-edge bg-header px-2 text-xs text-ink outline-none focus:border-accent';

export function LoftDialog() {
  const { t } = useTranslation();
  const featureId = useAppStore((state) => state.loftDialogFeature);
  const close = useAppStore((state) => state.closeLoftDialog);
  const cancel = () => void cancelTimelineFeatureEdit(close);
  const busy = useAppStore((state) => state.solidBusy);
  const profilePicker = useAppStore((state) =>
    state.profilePicker?.owner === 'loft' ? state.profilePicker : null,
  );
  const configureProfilePicker = useAppStore((state) => state.configureProfilePicker);
  const replaceProfilePicks = useAppStore((state) => state.replaceProfilePicks);
  const curvePicker = useAppStore((state) =>
    state.curvePicker?.owner === 'loft_centerline' || state.curvePicker?.owner === 'loft_guide'
      ? state.curvePicker
      : null,
  );
  const configureCurvePicker = useAppStore((state) => state.configureCurvePicker);
  const replaceCurvePicks = useAppStore((state) => state.replaceCurvePicks);
  const modelingPickTarget = useAppStore((state) => state.modelingPickTarget);
  const setModelingPickTarget = useAppStore((state) => state.setModelingPickTarget);
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
    const initiallySelectedBody = useAppStore.getState().selectedBody;
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
      const initialSections = edit?.sections ?? [];
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
      const initialCenterlineIds = edit?.centerline?.entity_ids ?? [];
      configureCurvePicker(
        'loft_centerline',
        nextCatalog,
        initialCenterlineIds.map((entityId) => ({
          sketchName: initialCenterlineSketch,
          entityId,
        })),
        initialCenterlineSketch,
      );
      setCenterlineEnabled(edit?.centerline != null);
      setCenterlineSketch(initialCenterlineSketch);
      setCenterlineIds(initialCenterlineIds);
      const initialGuideSketch =
        edit?.guide_rail?.sketch_name ?? paths[0]?.sketch_name ?? '';
      setGuideEnabled(edit?.guide_rail != null);
      setGuideSketch(initialGuideSketch);
      setGuideIds(edit?.guide_rail?.entity_ids ?? []);
      setOperation(edit?.operation ?? 'new_body');
      setTargets(
        edit?.target_body_ids.length
          ? edit.target_body_ids
          : initiallySelectedBody !== null
            ? [initiallySelectedBody]
            : [],
      );
      setModelingPickTarget('loft_sections');
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : t('loft.loadFailed'));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [configureCurvePicker, configureProfilePicker, featureId, setModelingPickTarget, t]);

  useEffect(() => {
    if (!curvePicker) return;
    const ids = curvePicker.selected.map((candidate) => candidate.entityId);
    if (curvePicker.owner === 'loft_centerline') {
      if (ids.length > 0) setCenterlineEnabled(true);
      setCenterlineSketch(curvePicker.sketchName);
      setCenterlineIds(ids);
    } else {
      if (ids.length > 0) setGuideEnabled(true);
      setGuideSketch(curvePicker.sketchName);
      setGuideIds(ids);
    }
  }, [curvePicker]);

  if (featureId === null) return null;
  const profileEntries = catalog.filter((item) =>
    item.profiles.some((profile) => profile.nesting_depth % 2 === 0),
  );
  const pathEntries = catalog.filter((item) => item.path_curves.length > 0);
  const canSubmit = !loading && !busy && !error && sections.length >= 2
    && (!centerlineEnabled || (centerlineSketch !== '' && centerlineIds.length > 0))
    && (!guideEnabled || (guideSketch !== '' && guideIds.length > 0))
    && (operation === 'new_body' || targets.length > 0);
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
    setModelingPickTarget(owner === 'loft_centerline' ? 'loft_centerline' : 'loft_guide');
  };
  const activateSections = () => {
    configureProfilePicker(
      'loft',
      profileEntries,
      sections,
      sections[sections.length - 1]?.sketch_name ?? '',
    );
    setModelingPickTarget('loft_sections');
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
        <header className="feature-dialog-header flex h-10 shrink-0 items-center gap-2 border-b border-edge px-3"><Layers3 size={15} className="text-accent" /><span className="flex-1 text-xs font-semibold text-ink">{featureId > 0 ? t('loft.editTitle') : t('loft.title')}</span><button type="button" onClick={cancel} disabled={busy} className="rounded p-1 text-mute hover:bg-edge hover:text-ink"><X size={14} /></button></header>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
          {loading ? <p className="flex items-center gap-2 text-xs text-mute"><LoaderCircle size={14} className="animate-spin" />{t('loft.loading')}</p>
            : error ? <p className="rounded border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-300">{error}</p>
              : profileEntries.length < 2 ? <p className="text-xs leading-5 text-mute">{t('loft.noProfiles')}</p>
                : <>
                  <ViewportSelectionField
                    testId="loft-sections-selection"
                    label={t('loft.sections')}
                    status={sections.length > 0 ? `${sections.length} ${sections.length === 1 ? 'section' : 'sections'} selected` : 'Click closed profiles in the viewport'}
                    hint="Select profiles in loft order. The viewport highlights and numbered badges show the current order."
                    active={modelingPickTarget === 'loft_sections'}
                    hasSelection={sections.length > 0}
                    onActivate={activateSections}
                    onClear={() => {
                      replaceProfilePicks('loft', [], '');
                      setModelingPickTarget('loft_sections');
                    }}
                  />
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-ink"><input type="checkbox" checked={ruled} onChange={(event) => setRuled(event.target.checked)} className="accent-accent" />{t('loft.ruled')}</label>
                  <label><span className={LABEL_CLASS}>Section continuity</span><select data-testid="loft-continuity" value={continuity} onChange={(event) => setContinuity(event.target.value as LoftContinuity)} className={INPUT_CLASS}><option value="g0">G0 · Position</option><option value="g1">G1 · Tangent</option><option value="g2">G2 · Curvature</option></select></label>
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-ink"><input data-testid="loft-centerline-enabled" type="checkbox" checked={centerlineEnabled} onChange={(event) => {
                    const enabled = event.target.checked;
                    setCenterlineEnabled(enabled);
                    if (enabled) activateCurvePicker('loft_centerline', centerlineSketch, centerlineIds);
                    else if (modelingPickTarget === 'loft_centerline') setModelingPickTarget('loft_sections');
                  }} disabled={pathEntries.length === 0} className="accent-accent" />Use a centerline</label>
                  {centerlineEnabled && <>
                    <ViewportSelectionField
                      testId="loft-centerline-selection"
                      label="Centerline"
                      status={centerlineIds.length > 0 ? `${centerlineIds.length} centerline ${centerlineIds.length === 1 ? 'curve' : 'curves'} selected · ${centerlineSketch}` : 'Click a centerline in the viewport'}
                      active={modelingPickTarget === 'loft_centerline'}
                      hasSelection={centerlineIds.length > 0}
                      onActivate={() => activateCurvePicker('loft_centerline', centerlineSketch, centerlineIds)}
                      onClear={() => {
                        setCenterlineIds([]);
                        replaceCurvePicks('loft_centerline', [], centerlineSketch);
                        setModelingPickTarget('loft_centerline');
                      }}
                    />
                  </>}
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-ink"><input data-testid="loft-guide-enabled" type="checkbox" checked={guideEnabled} onChange={(event) => {
                    const enabled = event.target.checked;
                    setGuideEnabled(enabled);
                    if (enabled) activateCurvePicker('loft_guide', guideSketch, guideIds);
                    else if (modelingPickTarget === 'loft_guide') setModelingPickTarget('loft_sections');
                  }} disabled={pathEntries.length === 0} className="accent-accent" />Use a guide rail</label>
                  {guideEnabled && <>
                    <ViewportSelectionField
                      testId="loft-guide-selection"
                      label="Guide rail"
                      status={guideIds.length > 0 ? `${guideIds.length} guide ${guideIds.length === 1 ? 'curve' : 'curves'} selected · ${guideSketch}` : 'Click a guide rail in the viewport'}
                      active={modelingPickTarget === 'loft_guide'}
                      hasSelection={guideIds.length > 0}
                      onActivate={() => activateCurvePicker('loft_guide', guideSketch, guideIds)}
                      onClear={() => {
                        setGuideIds([]);
                        replaceCurvePicks('loft_guide', [], guideSketch);
                        setModelingPickTarget('loft_guide');
                      }}
                    />
                  </>}
                  <SolidOperationFields operation={operation} setOperation={setOperation} targetBodies={targets} setTargetBodies={setTargets} pickTarget="loft_targets" />
                </>}
        </div>
        <footer className="flex h-11 shrink-0 items-center justify-end gap-2 border-t border-edge bg-header px-3"><button type="button" onClick={cancel} disabled={busy} className="h-7 rounded border border-edge px-3 text-xs text-ink hover:bg-edge">{t('loft.cancel')}</button><button data-testid="loft-ok" type="submit" disabled={!canSubmit} className="h-7 rounded bg-accent px-3 text-xs font-semibold text-white disabled:opacity-40">{t('loft.ok')}</button></footer>
      </form>
    </div>
  );
}
