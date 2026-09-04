import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { LoaderCircle, RefreshCw, X } from 'lucide-react';
import { getEngine } from '../engine';
import { cancelTimelineFeatureEdit, submitRevolve } from '../engine/controller';
import type { ExtrudeOperation, ProfileCatalogItemDto } from '../engine/types';
import { useTranslation } from '../i18n';
import {
  allRevolveAxisLineOptions,
  revolveAxisLineOptions,
} from '../lib/revolveAxis';
import { useAppStore } from '../store/appStore';
import { DimensionInput } from './DimensionInput';
import { SolidOperationFields } from './SolidOperationFields';
import { ViewportSelectionField } from './ViewportSelectionField';

const LABEL_CLASS = 'mb-1 block text-[10px] font-semibold uppercase tracking-wide text-mute';

type AxisPreset = 'x' | 'y' | 'line' | 'custom';

/** First sketch-driven solid after Extrude: a persisted New Body Revolve. */
export function RevolveDialog() {
  const { t } = useTranslation();
  const openFeature = useAppStore((state) => state.revolveDialogFeature);
  const close = useAppStore((state) => state.closeRevolveDialog);
  const cancel = () => void cancelTimelineFeatureEdit(close);
  const busy = useAppStore((state) => state.solidBusy);
  const viewportAxis = useAppStore((state) => state.revolveAxisSelection);
  const setViewportAxis = useAppStore((state) => state.setRevolveAxisSelection);
  const profilePicker = useAppStore((state) =>
    state.profilePicker?.owner === 'revolve' ? state.profilePicker : null,
  );
  const configureProfilePicker = useAppStore((state) => state.configureProfilePicker);
  const replaceProfilePicks = useAppStore((state) => state.replaceProfilePicks);
  const modelingPickTarget = useAppStore((state) => state.modelingPickTarget);
  const setModelingPickTarget = useAppStore((state) => state.setModelingPickTarget);

  const [catalog, setCatalog] = useState<ProfileCatalogItemDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [axisPreset, setAxisPreset] = useState<AxisPreset>('line');
  const [axisLineSketchName, setAxisLineSketchName] = useState<string | null>(null);
  const [axisLineEntityId, setAxisLineEntityId] = useState<number | null>(null);
  const [originX, setOriginX] = useState('0');
  const [originY, setOriginY] = useState('0');
  const [directionX, setDirectionX] = useState('0');
  const [directionY, setDirectionY] = useState('1');
  const [angle, setAngle] = useState('360');
  const [flip, setFlip] = useState(false);
  const [operation, setOperation] = useState<ExtrudeOperation>('new_body');
  const [targetBodies, setTargetBodies] = useState<number[]>([]);
  const sketchName = profilePicker?.sketchName ?? '';
  const profileIndices = profilePicker?.selected
    .filter((profile) => profile.sketch_name === sketchName)
    .map((profile) => profile.profile_index) ?? [];
  const usableCatalog = useMemo(
    () => catalog.filter((entry) =>
      entry.profiles.some((profile) => profile.nesting_depth % 2 === 0)),
    [catalog],
  );
  const axisLineOptions = useMemo(
    () => profileIndices.length > 0
      ? revolveAxisLineOptions(catalog, sketchName)
      : allRevolveAxisLineOptions(catalog),
    [catalog, profileIndices.length, sketchName],
  );
  const selectedAxisLine = axisLineOptions.find(
    (option) =>
      option.sketchName === axisLineSketchName
      && option.line.entity_id === axisLineEntityId,
  );

  useEffect(() => {
    if (openFeature === null) return;
    const initiallySelectedBody = useAppStore.getState().selectedBody;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    void getEngine()
      .then(async (engine) => {
        const [nextCatalog, definitions] = await Promise.all([
          engine.profileCatalog(),
          engine.revolveDefinitions(),
        ]);
        if (cancelled) return;
        const usable = nextCatalog.filter((entry) =>
          entry.profiles.some((profile) => profile.nesting_depth % 2 === 0));
        const edit =
          openFeature > 0
            ? definitions.find((definition) => definition.feature_id === openFeature)
            : undefined;
        const initialSketch = edit?.sketch_name ?? usable[usable.length - 1]?.sketch_name ?? '';
        // Keep line-only sketches in the catalog: they can provide a stable
        // coplanar axis even though they cannot provide a closed profile.
        setCatalog(nextCatalog);
        const initialIndices = edit?.profile_indices ?? [];
        configureProfilePicker(
          'revolve',
          nextCatalog,
          initialIndices.map((profile_index) => ({
            sketch_name: initialSketch,
            profile_index,
          })),
          initialSketch,
        );
        setOriginX(String(edit?.axis_origin.x ?? 0));
        setOriginY(String(edit?.axis_origin.y ?? 0));
        setDirectionX(String(edit?.axis_direction.x ?? 0));
        setDirectionY(String(edit?.axis_direction.y ?? 1));
        setAngle(String(edit?.angle_deg ?? 360));
        setFlip(edit?.flip ?? false);
        setOperation(edit?.operation ?? 'new_body');
        setTargetBodies(
          edit?.target_body_ids.length
            ? edit.target_body_ids
            : initiallySelectedBody !== null
              ? [initiallySelectedBody]
              : [],
        );
        const availableAxes = revolveAxisLineOptions(nextCatalog, initialSketch);
        const savedAxisSketch = edit?.axis_line_sketch_name ?? initialSketch;
        const savedAxis = edit?.axis_line_entity_id != null
          ? availableAxes.find(
              (option) =>
                option.sketchName === savedAxisSketch
                && option.line.entity_id === edit.axis_line_entity_id,
            )
          : undefined;
        const initialAxis = savedAxis ?? null;
        // Preserve a broken saved reference instead of silently retargeting
        // the feature. It remains visibly invalid and disables OK until the
        // user deliberately chooses a replacement axis.
        setAxisLineSketchName(
          edit?.axis_line_entity_id != null
            ? savedAxisSketch
            : initialAxis?.sketchName ?? null,
        );
        setAxisLineEntityId(
          edit?.axis_line_entity_id ?? initialAxis?.line.entity_id ?? null,
        );
        const origin = edit?.axis_origin;
        const direction = edit?.axis_direction;
        setAxisPreset(
          edit?.axis_line_entity_id != null
            ? 'line'
            : origin?.x === 0 && origin.y === 0 && direction?.x === 1 && direction.y === 0
            ? 'x'
            : origin?.x === 0 && origin.y === 0 && direction?.x === 0 && direction.y === 1
              ? 'y'
              : edit
                ? 'custom'
                : 'line',
        );
        setViewportAxis(
          savedAxis
            ? {
                sketchName: savedAxis.sketchName,
                entityId: savedAxis.line.entity_id,
              }
            : null,
        );
        setModelingPickTarget(
          initialIndices.length === 0 ? 'revolve_profile' : 'revolve_axis',
        );
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : t('revolve.loadFailed'));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    configureProfilePicker,
    openFeature,
    setModelingPickTarget,
    setViewportAxis,
    t,
  ]);

  useEffect(() => {
    if (openFeature === null || viewportAxis === null || catalog.length === 0) return;
    const eligibleAxis = axisLineOptions.find(
      (option) =>
        option.sketchName === viewportAxis.sketchName
        && option.line.entity_id === viewportAxis.entityId,
    );
    if (!eligibleAxis) return;
    setAxisPreset('line');
    setAxisLineSketchName(viewportAxis.sketchName);
    setAxisLineEntityId(viewportAxis.entityId);
  }, [axisLineOptions, catalog, openFeature, viewportAxis]);

  if (openFeature === null) return null;

  const numbers = [originX, originY, directionX, directionY, angle].map(Number);
  const [ox, oy, dx, dy, angleDeg] = numbers;
  const canSubmit =
    !loading &&
    !busy &&
    !loadError &&
    sketchName.length > 0 &&
    profileIndices.length > 0 &&
    (axisPreset === 'line'
      ? selectedAxisLine !== undefined
      : numbers.every(Number.isFinite) && Math.hypot(dx, dy) > 1e-9) &&
    Math.abs(angleDeg) > 1e-9 &&
    Math.abs(angleDeg) <= 360 &&
    (operation === 'new_body' || targetBodies.length > 0);

  const chooseAxis = (preset: AxisPreset) => {
    setAxisPreset(preset);
    if (preset === 'line') {
      // Preset modes retain the line choice locally but do not display it as
      // an active axis. Restore the same validated identity used by submit.
      setViewportAxis(selectedAxisLine
        ? { sketchName: selectedAxisLine.sketchName, entityId: selectedAxisLine.line.entity_id }
        : null);
      setModelingPickTarget('revolve_axis');
      return;
    }
    setModelingPickTarget(null);
    setViewportAxis(null);
    if (preset === 'x') {
      setOriginX('0');
      setOriginY('0');
      setDirectionX('1');
      setDirectionY('0');
    } else if (preset === 'y') {
      setOriginX('0');
      setOriginY('0');
      setDirectionX('0');
      setDirectionY('1');
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    void submitRevolve(
      {
        sketch_name: sketchName,
        profile_indices: profileIndices,
        axis_origin: { x: ox, y: oy },
        axis_direction: { x: dx, y: dy },
        axis_line_sketch_name:
          axisPreset === 'line' ? axisLineSketchName : null,
        axis_line_entity_id: axisPreset === 'line' ? axisLineEntityId : null,
        angle_deg: angleDeg,
        flip,
        operation,
        target_body_ids: operation === 'new_body' ? [] : targetBodies,
      },
      openFeature > 0 ? openFeature : undefined,
    );
  };

  return (
    <div
      data-native-viewport-dim="0.15"
      className="pointer-events-none fixed inset-0 z-[70] bg-black/15"
    >
      <form
        data-testid="revolve-dialog"
        onSubmit={submit}
        className="feature-dialog pointer-events-auto absolute right-5 top-[132px] flex max-h-[calc(100vh-190px)] w-80 flex-col overflow-hidden border border-edge bg-panel"
      >
        <header className="feature-dialog-header flex h-10 shrink-0 items-center gap-2 border-b border-edge px-3">
          <RefreshCw size={15} className="text-accent" />
          <span className="flex-1 text-xs font-semibold text-ink">
            {openFeature > 0 ? t('revolve.editTitle') : t('revolve.title')}
          </span>
          <button
            type="button"
            title={t('revolve.cancel')}
            disabled={busy}
            onClick={cancel}
            className="rounded p-1 text-mute hover:bg-edge hover:text-ink disabled:opacity-40"
          >
            <X size={14} />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
          {loading ? (
            <div className="flex items-center gap-2 py-6 text-xs text-mute">
              <LoaderCircle size={14} className="animate-spin" />
              {t('revolve.loading')}
            </div>
          ) : loadError ? (
            <p className="rounded border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-300">
              {loadError}
            </p>
          ) : usableCatalog.length === 0 ? (
            <p className="rounded border border-edge bg-header p-2 text-xs leading-5 text-mute">
              {t('revolve.noProfiles')}
            </p>
          ) : (
            <>
              <ViewportSelectionField
                testId="revolve-profile-selection"
                label={t('revolve.profiles')}
                status={profileIndices.length > 0
                  ? `${profileIndices.length} ${profileIndices.length === 1 ? 'profile' : 'profiles'} selected${sketchName ? ` · ${sketchName}` : ''}`
                  : 'Click a closed profile in the viewport'}
                hint="Selected regions are highlighted in the model. Click this field to change them."
                active={modelingPickTarget === 'revolve_profile'}
                hasSelection={profileIndices.length > 0}
                onActivate={() => setModelingPickTarget('revolve_profile')}
                onClear={() => {
                  replaceProfilePicks('revolve', [], sketchName);
                  setModelingPickTarget('revolve_profile');
                }}
              />

              <fieldset>
                <legend className={LABEL_CLASS}>{t('revolve.axis')}</legend>
                <div
                  role="radiogroup"
                  aria-label={t('revolve.axis')}
                  className="grid grid-cols-2 gap-1"
                >
                  {([
                    ['line', t('revolve.sketchLine')],
                    ['x', t('revolve.xAxis')],
                    ['y', t('revolve.yAxis')],
                    ['custom', t('revolve.customAxis')],
                  ] as Array<[AxisPreset, string]>).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={axisPreset === value}
                      data-testid={`revolve-axis-${value}-mode`}
                      onClick={() => chooseAxis(value)}
                      className={`h-8 rounded border px-2 text-[11px] font-medium transition-colors ${
                        axisPreset === value
                          ? 'border-accent bg-accent/20 text-ink'
                          : 'border-edge bg-header text-mute hover:border-accent/60 hover:bg-edge hover:text-ink'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </fieldset>

              {axisPreset === 'line' && (
                <ViewportSelectionField
                  testId="revolve-axis-selection"
                  label={t('revolve.axisLine')}
                  status={selectedAxisLine
                    ? `Straight line selected · ${selectedAxisLine.sketchName}`
                    : axisLineOptions.length > 0
                      ? 'Click a straight line in the viewport'
                      : t('revolve.noLines')}
                  hint={t('revolve.pickAxisLine')}
                  active={modelingPickTarget === 'revolve_axis'}
                  hasSelection={selectedAxisLine !== undefined}
                  onActivate={() => setModelingPickTarget('revolve_axis')}
                  onClear={() => {
                    setAxisLineSketchName(null);
                    setAxisLineEntityId(null);
                    setViewportAxis(null);
                    setModelingPickTarget('revolve_axis');
                  }}
                />
              )}

              {axisPreset === 'custom' && (
                <div className="grid grid-cols-2 gap-2">
                  {[
                    [t('revolve.originX'), originX, setOriginX],
                    [t('revolve.originY'), originY, setOriginY],
                    [t('revolve.directionX'), directionX, setDirectionX],
                    [t('revolve.directionY'), directionY, setDirectionY],
                  ].map(([label, value, setter]) => (
                    <label key={label as string}>
                      <span className={LABEL_CLASS}>{label as string}</span>
                      <DimensionInput
                        step="any"
                        value={value as string}
                        onValueChange={(next) =>
                          (setter as (value: string) => void)(next)}
                      />
                    </label>
                  ))}
                </div>
              )}

              <label>
                <span className={LABEL_CLASS}>{t('revolve.angle')}</span>
                <DimensionInput
                  autoSelectKey={profileIndices.length > 0
                    ? `${sketchName}:${profileIndices.join(',')}:${axisPreset}:${axisLineEntityId ?? ''}`
                    : null}
                  data-testid="revolve-angle"
                  min="0.000001"
                  max="360"
                  step="any"
                  value={angle}
                  onValueChange={setAngle}
                />
              </label>

              <SolidOperationFields
                operation={operation}
                setOperation={setOperation}
                targetBodies={targetBodies}
                setTargetBodies={setTargetBodies}
                pickTarget="revolve_targets"
              />

              <label className="flex cursor-pointer items-center gap-2 text-xs text-ink">
                <input
                  type="checkbox"
                  checked={flip}
                  onChange={(event) => setFlip(event.target.checked)}
                  className="accent-accent"
                />
                {t('revolve.flip')}
              </label>
            </>
          )}
        </div>

        <footer className="flex h-11 shrink-0 items-center justify-end gap-2 border-t border-edge bg-header px-3">
          <button
            type="button"
            disabled={busy}
            onClick={cancel}
            className="h-7 rounded border border-edge px-3 text-xs text-ink hover:bg-edge disabled:opacity-40"
          >
            {t('revolve.cancel')}
          </button>
          <button
            data-testid="revolve-ok"
            type="submit"
            disabled={!canSubmit}
            className="flex h-7 min-w-16 items-center justify-center gap-1 rounded bg-accent px-3 text-xs font-semibold text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy && <LoaderCircle size={12} className="animate-spin" />}
            {t('revolve.ok')}
          </button>
        </footer>
      </form>
    </div>
  );
}
