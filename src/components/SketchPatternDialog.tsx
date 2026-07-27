import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Grid2X2Plus, LoaderCircle, RotateCw, X } from 'lucide-react';
import { getEngine } from '../engine';
import { useAppStore } from '../store/appStore';
import { DimensionInput } from './DimensionInput';

const LABEL =
  'mb-1 block text-[10px] font-semibold uppercase tracking-wide text-mute';

function finiteValue(label: string, text: string): number {
  const value = Number(text);
  if (!Number.isFinite(value)) throw new Error(`${label} must be a finite number.`);
  return value;
}

function patternCount(label: string, text: string, minimum: number): number {
  const value = finiteValue(label, text);
  if (!Number.isInteger(value) || value < minimum || value > 1000) {
    throw new Error(`${label} must be an integer from ${minimum} to 1000.`);
  }
  return value;
}

export function SketchPatternDialog() {
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
        throw new Error('Select at least one sketch entity before creating a pattern.');
      }
      const occurrences = patternCount('Count', count, 2);
      setBusy(true);
      void getEngine()
        .then((engine) => {
          if (rectangular) {
            const directionAngle = finiteValue('Direction angle', angle) * (Math.PI / 180);
            const secondaryAngle =
              finiteValue('Second direction angle', secondAngle) * (Math.PI / 180);
            return engine.rectangularPattern({
              entity_ids: entityIds,
              direction: {
                x: Math.cos(directionAngle),
                y: Math.sin(directionAngle),
              },
              spacing: finiteValue('Spacing', spacing),
              count: occurrences,
              second_direction: secondDirection
                ? {
                    x: Math.cos(secondaryAngle),
                    y: Math.sin(secondaryAngle),
                  }
                : null,
              second_spacing: secondDirection
                ? finiteValue('Second spacing', secondSpacing)
                : 0,
              second_count: secondDirection
                ? patternCount('Second count', secondCount, 2)
                : 1,
            });
          }
          return engine.circularPattern({
            entity_ids: entityIds,
            center: {
              x: finiteValue('Center X', centerX),
              y: finiteValue('Center Y', centerY),
            },
            count: occurrences,
            total_angle_deg: finiteValue('Total angle', totalAngle),
          });
        })
        .then((result) => {
          useAppStore.getState().setActiveSketch(result.sketch);
          close();
        })
        .catch((cause: unknown) => {
          setError(cause instanceof Error ? cause.message : 'Could not create sketch pattern.');
        })
        .finally(() => setBusy(false));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };

  const title = rectangular ? 'Rectangular Pattern' : 'Circular Pattern';
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
            aria-label="Close"
            onClick={close}
            className="rounded p-1 text-mute hover:bg-edge hover:text-ink"
          >
            <X size={17} />
          </button>
        </header>

        <div className="space-y-3 p-4">
          <p className="text-xs text-mute">
            {entityIds.length} selected {entityIds.length === 1 ? 'entity' : 'entities'}.
            Counts include the selected source geometry.
          </p>

          {rectangular ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <label>
                  <span className={LABEL}>Direction angle (deg)</span>
                  <DimensionInput value={angle} onValueChange={setAngle} step="any" />
                </label>
                <label>
                  <span className={LABEL}>Spacing (mm)</span>
                  <DimensionInput value={spacing} onValueChange={setSpacing} step="any" />
                </label>
              </div>
              <label>
                <span className={LABEL}>Count</span>
                <DimensionInput value={count} onValueChange={setCount} step="1" min="2" />
              </label>
              <label className="flex items-center gap-2 text-xs text-ink">
                <input
                  type="checkbox"
                  checked={secondDirection}
                  onChange={(event) => setSecondDirection(event.currentTarget.checked)}
                />
                Add a second direction
              </label>
              {secondDirection && (
                <div className="grid grid-cols-3 gap-2">
                  <label>
                    <span className={LABEL}>Angle</span>
                    <DimensionInput
                      value={secondAngle}
                      onValueChange={setSecondAngle}
                      step="any"
                    />
                  </label>
                  <label>
                    <span className={LABEL}>Spacing</span>
                    <DimensionInput
                      value={secondSpacing}
                      onValueChange={setSecondSpacing}
                      step="any"
                    />
                  </label>
                  <label>
                    <span className={LABEL}>Count</span>
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
                  <span className={LABEL}>Center X (mm)</span>
                  <DimensionInput value={centerX} onValueChange={setCenterX} step="any" />
                </label>
                <label>
                  <span className={LABEL}>Center Y (mm)</span>
                  <DimensionInput value={centerY} onValueChange={setCenterY} step="any" />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label>
                  <span className={LABEL}>Count</span>
                  <DimensionInput value={count} onValueChange={setCount} step="1" min="2" />
                </label>
                <label>
                  <span className={LABEL}>Total angle (deg)</span>
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
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || entityIds.length === 0}
            className="flex h-8 items-center gap-2 rounded bg-accent px-4 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-50"
          >
            {busy && <LoaderCircle size={14} className="animate-spin" />}
            OK
          </button>
        </footer>
      </form>
    </section>
  );
}
