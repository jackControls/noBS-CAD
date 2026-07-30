import { useEffect, useState, type FormEvent } from 'react';
import { LoaderCircle, RefreshCw, X } from 'lucide-react';
import { getEngine } from '../engine';
import { submitRevolve } from '../engine/controller';
import type { ExtrudeOperation, ProfileCatalogItemDto } from '../engine/types';
import { useTranslation } from '../i18n';
import { useAppStore } from '../store/appStore';
import { DimensionInput } from './DimensionInput';
import { SolidOperationFields } from './SolidOperationFields';

const INPUT_CLASS =
  'h-7 w-full rounded border border-edge bg-header px-2 text-xs text-ink outline-none focus:border-accent';
const LABEL_CLASS = 'mb-1 block text-[10px] font-semibold uppercase tracking-wide text-mute';

type AxisPreset = 'x' | 'y' | 'line' | 'custom';

/** First sketch-driven solid after Extrude: a persisted New Body Revolve. */
export function RevolveDialog() {
  const { t } = useTranslation();
  const openFeature = useAppStore((state) => state.revolveDialogFeature);
  const close = useAppStore((state) => state.closeRevolveDialog);
  const busy = useAppStore((state) => state.solidBusy);
  const scene = useAppStore((state) => state.solidScene);
  const selectedBody = useAppStore((state) => state.selectedBody);
  const viewportAxis = useAppStore((state) => state.revolveAxisSelection);
  const setViewportAxis = useAppStore((state) => state.setRevolveAxisSelection);
  const profilePicker = useAppStore((state) =>
    state.profilePicker?.owner === 'revolve' ? state.profilePicker : null,
  );
  const configureProfilePicker = useAppStore((state) => state.configureProfilePicker);
  const replaceProfilePicks = useAppStore((state) => state.replaceProfilePicks);
  const toggleProfilePick = useAppStore((state) => state.toggleProfilePick);

  const [catalog, setCatalog] = useState<ProfileCatalogItemDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [axisPreset, setAxisPreset] = useState<AxisPreset>('y');
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

  useEffect(() => {
    if (openFeature === null) return;
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
        const usable = nextCatalog.filter((entry) => entry.profiles.some((profile) => profile.nesting_depth % 2 === 0));
        const edit =
          openFeature > 0
            ? definitions.find((definition) => definition.feature_id === openFeature)
            : undefined;
        const initialSketch = edit?.sketch_name ?? usable[usable.length - 1]?.sketch_name ?? '';
        const entry = usable.find((item) => item.sketch_name === initialSketch);
        setCatalog(usable);
        const eligible = entry?.profiles.filter((profile) => profile.nesting_depth % 2 === 0) ?? [];
        const initialIndices = edit?.profile_indices ?? (eligible.length === 1 ? [eligible[0].index] : []);
        configureProfilePicker(
          'revolve',
          usable,
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
            : selectedBody !== null
              ? [selectedBody]
              : scene.bodies[0]
                ? [scene.bodies[0].id]
                : [],
        );
        const initialAxisLine = edit?.axis_line_entity_id ?? entry?.lines[0]?.entity_id ?? null;
        setAxisLineEntityId(initialAxisLine);
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
                : 'y',
        );
        setViewportAxis(
          edit?.axis_line_entity_id != null
            ? { sketchName: initialSketch, entityId: edit.axis_line_entity_id }
            : null,
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
  }, [configureProfilePicker, openFeature, scene.bodies, selectedBody, setViewportAxis, t]);

  useEffect(() => {
    if (openFeature === null || viewportAxis === null || catalog.length === 0) return;
    const entry = catalog.find((item) => item.sketch_name === viewportAxis.sketchName);
    if (!entry?.lines.some((line) => line.entity_id === viewportAxis.entityId)) return;
    if (sketchName !== entry.sketch_name) {
      const eligible = entry.profiles.filter((profile) => profile.nesting_depth % 2 === 0);
      replaceProfilePicks(
        'revolve',
        eligible.length === 1
          ? [{ sketch_name: entry.sketch_name, profile_index: eligible[0].index }]
          : [],
        entry.sketch_name,
      );
    }
    setAxisPreset('line');
    setAxisLineEntityId(viewportAxis.entityId);
  }, [catalog, openFeature, replaceProfilePicks, sketchName, viewportAxis]);

  if (openFeature === null) return null;

  const selectedCatalog = catalog.find((entry) => entry.sketch_name === sketchName);
  const numbers = [originX, originY, directionX, directionY, angle].map(Number);
  const [ox, oy, dx, dy, angleDeg] = numbers;
  const canSubmit =
    !loading &&
    !busy &&
    !loadError &&
    sketchName.length > 0 &&
    profileIndices.length > 0 &&
    (axisPreset === 'line'
      ? axisLineEntityId !== null
      : numbers.every(Number.isFinite) && Math.hypot(dx, dy) > 1e-9) &&
    Math.abs(angleDeg) > 1e-9 &&
    Math.abs(angleDeg) <= 360 &&
    (operation === 'new_body' || targetBodies.length > 0);

  const chooseSketch = (name: string) => {
    const entry = catalog.find((item) => item.sketch_name === name);
    const eligible = entry?.profiles.filter((profile) => profile.nesting_depth % 2 === 0) ?? [];
    replaceProfilePicks(
      'revolve',
      eligible.length === 1
        ? [{ sketch_name: name, profile_index: eligible[0].index }]
        : [],
      name,
    );
    const firstLine = entry?.lines[0]?.entity_id ?? null;
    setAxisLineEntityId(firstLine);
    setViewportAxis(
      axisPreset === 'line' && firstLine !== null
        ? { sketchName: name, entityId: firstLine }
        : null,
    );
  };

  const chooseAxis = (preset: AxisPreset) => {
    setAxisPreset(preset);
    setViewportAxis(
      preset === 'line' && axisLineEntityId !== null
        ? { sketchName, entityId: axisLineEntityId }
        : null,
    );
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

  const toggleProfile = (index: number) => {
    toggleProfilePick({ sketch_name: sketchName, profile_index: index });
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
            onClick={close}
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
          ) : catalog.length === 0 ? (
            <p className="rounded border border-edge bg-header p-2 text-xs leading-5 text-mute">
              {t('revolve.noProfiles')}
            </p>
          ) : (
            <>
              <label>
                <span className={LABEL_CLASS}>{t('revolve.sketch')}</span>
                <select
                  data-testid="revolve-sketch"
                  value={sketchName}
                  onChange={(event) => chooseSketch(event.target.value)}
                  className={INPUT_CLASS}
                >
                  {catalog.map((entry) => (
                    <option key={entry.sketch_name} value={entry.sketch_name}>
                      {entry.sketch_name}
                    </option>
                  ))}
                </select>
              </label>

              <fieldset>
                <legend className={LABEL_CLASS}>{t('revolve.profiles')}</legend>
                <p className="mb-1.5 text-[10px] leading-4 text-mute">
                  {t('solidProfile.pickHint')}
                </p>
                <div className="space-y-1 rounded border border-edge bg-header p-2">
                  {selectedCatalog?.profiles.filter((profile) => profile.nesting_depth % 2 === 0).map((profile) => (
                    <label
                      key={profile.index}
                      className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs text-ink hover:bg-edge"
                    >
                      <input
                        type="checkbox"
                        checked={profileIndices.includes(profile.index)}
                        onChange={() => toggleProfile(profile.index)}
                        className="accent-accent"
                      />
                      <span className="flex-1">
                        {t('revolve.profile')} {profile.index + 1}
                      </span>
                      <span className="text-[10px] text-mute">
                        {Math.abs(profile.area).toFixed(2)} mm²
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <label>
                <span className={LABEL_CLASS}>{t('revolve.axis')}</span>
                <select
                  data-testid="revolve-axis"
                  value={axisPreset}
                  onChange={(event) => chooseAxis(event.target.value as AxisPreset)}
                  className={INPUT_CLASS}
                >
                  <option value="x">{t('revolve.xAxis')}</option>
                  <option value="y">{t('revolve.yAxis')}</option>
                  <option value="line">{t('revolve.sketchLine')}</option>
                  <option value="custom">{t('revolve.customAxis')}</option>
                </select>
              </label>

              {axisPreset === 'line' && (
                <label>
                  <span className={LABEL_CLASS}>{t('revolve.axisLine')}</span>
                  <span className="mb-1 block text-[10px] leading-4 text-mute">
                    {t('revolve.pickAxisLine')}
                  </span>
                  <select
                    data-testid="revolve-axis-line"
                    value={axisLineEntityId ?? ''}
                    onChange={(event) => {
                      const entityId = Number(event.target.value);
                      setAxisLineEntityId(entityId);
                      setViewportAxis({ sketchName, entityId });
                    }}
                    className={INPUT_CLASS}
                  >
                    {selectedCatalog?.lines.length ? (
                      selectedCatalog.lines.map((line) => (
                        <option key={line.entity_id} value={line.entity_id}>
                          {t('revolve.line')} {line.entity_id}
                        </option>
                      ))
                    ) : (
                      <option value="">{t('revolve.noLines')}</option>
                    )}
                  </select>
                </label>
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
            onClick={close}
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
