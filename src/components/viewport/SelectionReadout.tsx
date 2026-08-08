import { useMemo } from 'react';
import { useTranslation } from '../../i18n';
import { useAppStore } from '../../store/appStore';
import {
  measureSketchSelection,
  measureSolidSelection,
  type MeasurementRow,
  type MeasurementUnit,
  type SelectionMeasurement,
} from './selectionMeasurements';

const UNIT_SUFFIX: Record<MeasurementUnit, string> = {
  mm: 'mm',
  mm2: 'mm²',
  mm3: 'mm³',
  deg: '°',
};

function formatNumber(value: number, locale: string, unit: MeasurementUnit): string {
  const normalized = Math.abs(value) < 0.0005 ? 0 : value;
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: unit === 'deg' ? 2 : 3,
    minimumFractionDigits: 0,
  }).format(normalized);
}

function formatRow(row: MeasurementRow, locale: string): string {
  const values = Array.isArray(row.value) ? row.value : [row.value];
  const formatted = values.map((value) => formatNumber(value, locale, row.unit)).join(' × ');
  return `${row.approximate ? '≈ ' : ''}${formatted}${row.unit === 'deg' ? '' : ' '}${UNIT_SUFFIX[row.unit]}`;
}

function titleFor(
  measurement: SelectionMeasurement,
  t: (key: string) => string,
): string {
  if (measurement.name) return measurement.name;
  if (measurement.kind === 'objects') {
    return t('selectionReadout.kinds.objects').replace('{n}', String(measurement.count ?? 0));
  }
  if (measurement.kind === 'edges' && measurement.count !== undefined) {
    return t('selectionReadout.kinds.edges').replace('{n}', String(measurement.count));
  }
  if (
    (measurement.kind === 'faces' ||
      measurement.kind === 'bodies' ||
      measurement.kind === 'features') &&
    measurement.count !== undefined
  ) {
    return t(`selectionReadout.kinds.${measurement.kind}`).replace(
      '{n}',
      String(measurement.count),
    );
  }
  return t(`selectionReadout.kinds.${measurement.kind}`);
}

export function SelectionReadout() {
  const { locale, t } = useTranslation();
  const mode = useAppStore((state) => state.mode);
  const activeSketch = useAppStore((state) => state.activeSketch);
  const selectedEntity = useAppStore((state) => state.selectedEntity);
  const selectedEntities = useAppStore((state) => state.selectedEntities);
  const solidScene = useAppStore((state) => state.solidScene);
  const selectedBody = useAppStore((state) => state.selectedBody);
  const selectedBodies = useAppStore((state) => state.selectedBodies);
  const selectedFace = useAppStore((state) => state.selectedFace);
  const selectedFaces = useAppStore((state) => state.selectedFaces);
  const selectedEdges = useAppStore((state) => state.selectedEdges);

  const measurement = useMemo(
    () =>
      mode === 'sketch'
        ? measureSketchSelection(activeSketch, selectedEntity, selectedEntities)
        : mode === 'solid'
          ? measureSolidSelection(
              solidScene,
              selectedBody,
              selectedFace,
              selectedEdges,
              selectedBodies,
              selectedFaces,
            )
          : null,
    [
      activeSketch,
      mode,
      selectedBody,
      selectedBodies,
      selectedEdges,
      selectedEntities,
      selectedEntity,
      selectedFace,
      selectedFaces,
      solidScene,
    ],
  );

  if (!measurement) return null;

  return (
    <aside
      data-testid="selection-readout"
      data-native-hud="selection"
      data-native-viewport-overlay
      aria-label={t('selectionReadout.title')}
      aria-live="polite"
      className="pointer-events-none absolute bottom-12 right-3 z-10 min-w-[208px] max-w-[280px] select-none rounded border border-edge bg-header/95 px-2.5 py-2 text-[11px] text-ink shadow-lg shadow-black/15 backdrop-blur-sm"
    >
      <div className="mb-1.5 flex items-center justify-between gap-4 border-b border-edge/80 pb-1.5">
        <span
          data-native-hud-title
          className="text-[9px] font-semibold tracking-[0.14em] text-mute"
        >
          {t('selectionReadout.title')}
        </span>
        <span data-native-hud-subject className="truncate font-medium">
          {titleFor(measurement, t)}
        </span>
      </div>
      {measurement.rows.length > 0 ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          {measurement.rows.map((row) => (
            <div
              key={row.label}
              data-native-hud-row
              className="contents"
              data-testid={`selection-measure-${row.label}`}
            >
              <dt data-native-hud-label className="text-mute">
                {t(`selectionReadout.measurements.${row.label}`)}
              </dt>
              <dd
                data-native-hud-value
                className="text-right font-mono tabular-nums text-ink"
              >
                {formatRow(row, locale)}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <div data-native-hud-footer className="text-right text-mute">
          {t('selectionReadout.selectedOnly')}
        </div>
      )}
      {measurement.rows.some((row) => row.approximate) && (
        <div
          data-native-hud-footer
          className="mt-1.5 border-t border-edge/60 pt-1 text-right text-[9px] text-mute"
        >
          {t('selectionReadout.approximate')}
        </div>
      )}
    </aside>
  );
}
