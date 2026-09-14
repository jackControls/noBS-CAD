import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Grid2X2Plus, LoaderCircle, RotateCw, X } from 'lucide-react';
import { getEngine } from '../engine';
import { translate, useTranslation } from '../i18n';
import { useAppStore } from '../store/appStore';
import { DimensionInput } from './DimensionInput';

const LABEL =
  'mb-1 block text-[10px] font-semibold uppercase tracking-wide text-mute';

function finiteValue(label: string, text: string): number {
  const value = Number(text);
  if (!Number.isFinite(value)) {
    throw new Error(
      translate('sketchPattern.errorFinite').replace('{label}', label),
    );
  }
  return value;
}

function patternCount(label: string, text: string, minimum: number): number {
  const value = finiteValue(label, text);
  if (!Number.isInteger(value) || value < minimum || value > 1000) {
    throw new Error(
      translate('sketchPattern.errorInteger')
        .replace('{label}', label)
        .replace('{minimum}', String(minimum)),
    );
  }
  return value;
}

export function SketchPatternDialog() {
  const { t } = useTranslation();
  const kind = useAppStore((state) => state.sketchPatternDialog);
  const selectedEntity = useAppStore((state) => state.selectedEntity);
  const selectedEntities = useAppStore((state) => state.selectedEntities);
  const close = useAppStore((state) => state.closeSketchPatternDialog);
  const [angle, setAngle] = useState('0');
  const [spacing, setSpacing] = useState('10');
  const [count, setCount] = useState('3');
  const [secondDirection, setSecondDirection] = useState(false);
  const [secondAngle, setSecondAngle] = useState('90');
  const [secondSpacing, setSecondSpacing] = useState('10');
  const [secondCount, setSecondCount] = useState('2');
  const [centerX, setCenterX] = useState('0');
  const [centerY, setCenterY] = useState('0');
  const [totalAngle, setTotalAngle] = useState('360');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const entityIds = useMemo(
    () =>
      [
        ...new Set([
          ...selectedEntities,
          ...(selectedEntity === null ? [] : [selectedEntity]),
        ]),
      ],
    [selectedEntities, selectedEntity],
  );

  useEffect(() => {
    if (kind) setError(null);
  }, [kind]);

  if (!kind) return null;

  const rectangular = kind === 'rectangular';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError(null);
    try {
      if (entityIds.length === 0) {
        throw new Error(t('sketchPattern.errorNoSelection'));
      }
      const occurrences = patternCount(t('sketchPattern.count'), count, 2);
      setBusy(true);
      void getEngine()
        .then((engine) => {
          if (rectangular) {
            const directionAngle =
              finiteValue(t('sketchPattern.directionAngle'), angle) * (Math.PI / 180);
            const secondaryAngle =
              finiteValue(t('sketchPattern.secondDirectionAngle'), secondAngle) *
              (Math.PI / 180);
            return engine.rectangularPattern({
              entity_ids: entityIds,
              direction: {
                x: Math.cos(directionAngle),
                y: Math.sin(directionAngle),
              },
              spacing: finiteValue(t('sketchPattern.spacing'), spacing),
              count: occurrences,
              second_direction: secondDirection
                ? {
                    x: Math.cos(secondaryAngle),
                    y: Math.sin(secondaryAngle),
                  }
                : null,
              second_spacing: secondDirection
                ? finiteValue(t('sketchPattern.secondSpacing'), secondSpacing)
                : 0,
              second_count: secondDirection
                ? patternCount(t('sketchPattern.secondCount'), secondCount, 2)
                : 1,
            });
          }
          return engine.circularPattern({
            entity_ids: entityIds,
            center: {
              x: finiteValue(t('sketchPattern.centerX'), centerX),
              y: finiteValue(t('sketchPattern.centerY'), centerY),
            },
            count: occurrences,
            total_angle_deg: finiteValue(t('sketchPattern.totalAngle'), totalAngle),
          });
        })
        .then((result) => {
          useAppStore.getState().setActiveSketch(result.sketch);
          close();
        })
        .catch((cause: unknown) => {
          setError(cause instanceof Error ? cause.message : t('sketchPattern.createFailed'));
        })
        .finally(() => setBusy(false));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };

  const title = rectangular
    ? t('sketchPattern.rectangularPattern')
    : t('sketchPattern.circularPattern');
  const Icon = rectangular ? Grid2X2Plus : RotateCw;

  return (
    <section
      role="dialog"
      aria-label={title}
      className="absolute right-5 top-[136px] z-40 w-[340px] rounded-lg border border-edge bg-panel shadow-2xl"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <form onSubmit={submit}>
        <header className="flex h-12 items-center gap-2 border-b border-edge px-4">
          <Icon size={18} className="text-accent" />
          <h2 className="flex-1 text-sm font-semibold text-ink">{title}</h2>
          <button
            type="button"
            aria-label={t('sketchPattern.close')}
            onClick={close}
            className="rounded p-1 text-mute hover:bg-edge hover:text-ink"
          >
            <X size={17} />
          </button>
        </header>

        <div className="space-y-3 p-4">
          <p className="text-xs text-mute">
            {entityIds.length === 1
              ? t('sketchPattern.selectedEntity').replace('{count}', String(entityIds.length))
              : t('sketchPattern.selectedEntities').replace('{count}', String(entityIds.length))}
          </p>

          {rectangular ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <label>
                  <span className={LABEL}>{t('sketchPattern.directionAngleDeg')}</span>
                  <DimensionInput value={angle} onValueChange={setAngle} step="any" />
                </label>
                <label>
                  <span className={LABEL}>{t('sketchPattern.spacingMm')}</span>
                  <DimensionInput value={spacing} onValueChange={setSpacing} step="any" />
                </label>
              </div>
              <label>
                <span className={LABEL}>{t('sketchPattern.count')}</span>
                <DimensionInput value={count} onValueChange={setCount} step="1" min="2" />
              </label>
              <label className="flex items-center gap-2 text-xs text-ink">
                <input
                  type="checkbox"
                  checked={secondDirection}
                  onChange={(event) => setSecondDirection(event.currentTarget.checked)}
                />
                {t('sketchPattern.addSecondDirection')}
              </label>
              {secondDirection && (
                <div className="grid grid-cols-3 gap-2">
                  <label>
                    <span className={LABEL}>{t('sketchPattern.angle')}</span>
                    <DimensionInput
                      value={secondAngle}
                      onValueChange={setSecondAngle}
                      step="any"
                    />
                  </label>
                  <label>
                    <span className={LABEL}>{t('sketchPattern.spacing')}</span>
                    <DimensionInput
                      value={secondSpacing}
                      onValueChange={setSecondSpacing}
                      step="any"
                    />
                  </label>
                  <label>
                    <span className={LABEL}>{t('sketchPattern.count')}</span>
                    <DimensionInput
                      value={secondCount}
                      onValueChange={setSecondCount}
                      step="1"
                      min="2"
                    />
                  </label>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <label>
                  <span className={LABEL}>{t('sketchPattern.centerXMm')}</span>
                  <DimensionInput value={centerX} onValueChange={setCenterX} step="any" />
                </label>
                <label>
                  <span className={LABEL}>{t('sketchPattern.centerYMm')}</span>
                  <DimensionInput value={centerY} onValueChange={setCenterY} step="any" />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label>
                  <span className={LABEL}>{t('sketchPattern.count')}</span>
                  <DimensionInput value={count} onValueChange={setCount} step="1" min="2" />
                </label>
                <label>
                  <span className={LABEL}>{t('sketchPattern.totalAngleDeg')}</span>
                  <DimensionInput
                    value={totalAngle}
                    onValueChange={setTotalAngle}
                    step="any"
                  />
                </label>
              </div>
            </>
          )}

          {error && (
            <p role="alert" className="rounded border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-300">
              {error}
            </p>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-edge px-4 py-3">
          <button
            type="button"
            onClick={close}
            className="h-8 rounded border border-edge px-4 text-xs text-ink hover:bg-edge"
          >
            {t('sketchPattern.cancel')}
          </button>
          <button
            type="submit"
            disabled={busy || entityIds.length === 0}
            className="flex h-8 items-center gap-2 rounded bg-accent px-4 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-50"
          >
            {busy && <LoaderCircle size={14} className="animate-spin" />}
            {t('sketchPattern.ok')}
          </button>
        </footer>
      </form>
    </section>
  );
}
