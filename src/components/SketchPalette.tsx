/**
 * SKETCH PALETTE (right overlay, sketch mode only): explicit flat-view
 * action, collapsible option checkboxes, and Finish Sketch.
 *
 * Wired options: Snap, Sketch Grid, Points, Dimensions, and Constraints.
 * Options whose underlying feature is not implemented are shown disabled
 * instead of pretending to change viewport behavior.
 */
import { useState } from 'react';
import { Check, ChevronDown, ChevronRight, Focus } from 'lucide-react';
import { finishSketch, setDimensionStyle, setGridSnap } from '../engine/controller';
import { useTranslation } from '../i18n';
import { cx } from '../lib/cx';
import { PALETTE_OPTION_KEYS, useAppStore, type PaletteOptionKey } from '../store/appStore';

const SUPPORTED_OPTIONS = new Set<PaletteOptionKey>([
  'sketchGrid',
  'snap',
  'points',
  'dimensions',
  'constraints',
]);

/** ISO 129 dimension style row (document-level setting, D4.5). */
function IsoStyleRow() {
  const { t } = useTranslation();
  const iso = useAppStore((s) => s.activeSketch?.dimension_style === 'iso');
  return (
    <li
      className="flex h-6 cursor-pointer items-center justify-between px-3 text-xs text-ink hover:bg-header"
      onClick={() => void setDimensionStyle(iso ? 'aligned' : 'iso')}
    >
      <span>{t('palette.isoDimensions')}</span>
      <span
        role="checkbox"
        aria-checked={iso}
        className={cx(
          'flex h-3.5 w-3.5 items-center justify-center rounded-[2px] border',
          iso ? 'border-accent bg-accent text-white' : 'border-mute/60 bg-transparent',
        )}
      >
        {iso && <Check size={10} strokeWidth={3} />}
      </span>
    </li>
  );
}

export function SketchPalette() {
  const { t } = useTranslation();
  const palette = useAppStore((s) => s.palette);
  const setPaletteOption = useAppStore((s) => s.setPaletteOption);
  const requestLookAt = useAppStore((s) => s.requestLookAt);
  const [collapsed, setCollapsed] = useState(false);

  const onOptionClick = (key: PaletteOptionKey) => {
    if (!SUPPORTED_OPTIONS.has(key)) return;
    const next = !palette[key];
    setPaletteOption(key, next);
    if (key === 'snap') void setGridSnap(next);
  };

  return (
    <aside
      className="absolute right-0 top-0 z-20 flex max-h-full w-60 flex-col border-l border-edge bg-panel/95 backdrop-blur-sm"
      data-sketch-palette
      data-native-viewport-overlay
    >
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="flex h-8 shrink-0 items-center gap-1.5 border-b border-edge px-3 text-[10px] font-semibold tracking-widest text-ink hover:bg-header"
      >
        {collapsed ? <ChevronRight size={12} className="text-mute" /> : <ChevronDown size={12} className="text-mute" />}
        {t('palette.title')}
      </button>

      {!collapsed && (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="px-3 pb-1 pt-2 text-[10px] tracking-wider text-mute">
              {t('palette.options')}
            </div>
            <ul>
              {PALETTE_OPTION_KEYS.map((key) => {
                if (key === 'lookAt') {
                  return (
                    <li key={key} className="px-2 py-1">
                      <button
                        type="button"
                        data-testid="look-at-sketch"
                        onClick={requestLookAt}
                        className="flex h-7 w-full items-center justify-between rounded border border-edge bg-header px-2 text-xs text-ink hover:border-accent hover:text-accent"
                      >
                        <span className="flex items-center gap-2">
                          <Focus size={14} />
                          {t('palette.lookAt')}
                        </span>
                        <ChevronRight size={12} className="text-mute" />
                      </button>
                    </li>
                  );
                }
                const checked = palette[key];
                const supported = SUPPORTED_OPTIONS.has(key);
                return (
                  <li
                    key={key}
                    aria-disabled={!supported}
                    className={cx(
                      'flex h-6 items-center justify-between px-3 text-xs',
                      supported
                        ? 'cursor-pointer text-ink hover:bg-header'
                        : 'cursor-not-allowed text-mute opacity-45',
                    )}
                    onClick={supported ? () => onOptionClick(key) : undefined}
                  >
                    <span>{t(`palette.${key}`)}</span>
                    <span
                      role="checkbox"
                      aria-checked={supported && checked}
                      aria-disabled={!supported}
                      className={cx(
                        'flex h-3.5 w-3.5 items-center justify-center rounded-[2px] border',
                        supported && checked
                          ? 'border-accent bg-accent text-white'
                          : 'border-mute/60 bg-transparent',
                      )}
                    >
                      {supported && checked && <Check size={10} strokeWidth={3} />}
                    </span>
                  </li>
                );
              })}
              {/* ISO 129 dimension style toggle (document setting, D4.5). */}
              <IsoStyleRow />
            </ul>
          </div>

          <div className="shrink-0 p-2">
            <button
              type="button"
              onClick={() => void finishSketch()}
              className="h-7 w-full rounded border border-edge bg-header text-xs text-ink hover:bg-edge"
            >
              {t('palette.finishSketch')}
            </button>
          </div>
        </>
      )}
    </aside>
  );
}
