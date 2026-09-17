import type { CamHeightReferenceDto } from '../../engine/types';
import { useTranslation } from '../../i18n';
import { CamToolIcon, type CamIconId } from './CamToolIcon';
import { CAM_DIALOG_INPUT, CAM_DIALOG_LABEL, notAppliedYetTitle } from './camFields';

export type HeightFrom = CamHeightReferenceDto;

const HEIGHT_PLANES: Array<{ value: HeightFrom; labelKey: string }> = [
  { value: 'model_top', labelKey: 'cam.operation.heightModelTop' },
  { value: 'model_bottom', labelKey: 'cam.operation.heightModelBottom' },
  { value: 'stock_top', labelKey: 'cam.operation.heightStockTop' },
  { value: 'stock_bottom', labelKey: 'cam.operation.heightStockBottom' },
  { value: 'origin', labelKey: 'cam.operation.heightOriginAbsolute' },
];
/** Chain references a height row may offer, per the fixed resolution order
 *  (a row only lists LOWER heights). */
export const HEIGHT_CHAIN_LABEL_KEYS: Partial<Record<HeightFrom, string>> = {
  bottom: 'cam.operation.heightBottom',
  top: 'cam.operation.heightTop',
  feed: 'cam.operation.heightFeed',
  retract: 'cam.operation.heightRetract',
};
const HEIGHT_FROM_DEAD_KEYS = [
  'cam.operation.heightFixtureTop',
  'cam.operation.heightFixtureBottom',
  'cam.operation.heightHighestOf',
  'cam.operation.heightLowestOf',
];

/** One height row: reference plane + signed offset. `chainBelow` lists the
 *  lower operation heights this row may reference; the Selection option
 *  (picked sketch loop's plane Z) is enabled where geometry plumbing gives
 *  it a value; `holeRefsAvailable` (drill/thread) unlocks the picked hole
 *  faces' own top/bottom references. */
export function HeightField({
  from,
  offset,
  onFrom,
  onOffset,
  unit,
  chainBelow = [],
  selectionAvailable = false,
  holeRefsAvailable = false,
  disabled = false,
  disabledReason = notAppliedYetTitle(),
}: {
  from: HeightFrom;
  offset: string;
  onFrom: (value: HeightFrom) => void;
  onOffset: (value: string) => void;
  unit: string;
  chainBelow?: HeightFrom[];
  selectionAvailable?: boolean;
  holeRefsAvailable?: boolean;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={`grid grid-cols-2 gap-2 ${disabled ? 'opacity-45' : ''}`}
      title={disabled ? disabledReason : undefined}
    >
      <label className="block">
        <span className={CAM_DIALOG_LABEL}>{t('cam.operation.from')}</span>
        <select
          aria-label={t('cam.operation.from')}
          value={from}
          disabled={disabled}
          onChange={(event) => onFrom(event.target.value as HeightFrom)}
          className={`${CAM_DIALOG_INPUT} ${disabled ? 'cursor-not-allowed' : ''}`}
        >
          {HEIGHT_PLANES.map((option) => (
            <option key={option.value} value={option.value}>
              {t(option.labelKey)}
            </option>
          ))}
          {holeRefsAvailable && (
            <optgroup label={t('cam.operation.pickedHoles')}>
              <option value="hole_top">{t('cam.operation.holeTop')}</option>
              <option value="hole_bottom">{t('cam.operation.holeBottom')}</option>
            </optgroup>
          )}
          {chainBelow.length > 0 && (
            <optgroup label={t('cam.operation.operationHeights')}>
              {chainBelow.map((value) => (
                <option key={value} value={value}>
                  {t(HEIGHT_CHAIN_LABEL_KEYS[value]!)}
                </option>
              ))}
            </optgroup>
          )}
          <option
            value="selection"
            disabled={!selectionAvailable}
            title={
              selectionAvailable
                ? t('cam.operation.selectionRefTitle')
                : t('cam.operation.selectionPickHint')
            }
          >
            {t('cam.operation.selectionGeometryPlane')}
          </option>
          <optgroup label={t('cam.operation.notAppliedYet')}>
            {HEIGHT_FROM_DEAD_KEYS.map((text) => (
              <option key={text} disabled>
                {t(text)}
              </option>
            ))}
          </optgroup>
        </select>
      </label>
      <label className="block">
        <span className={CAM_DIALOG_LABEL}>{t('cam.operation.offset')}</span>
        <span className="relative block">
          <input
            aria-label={t('cam.operation.offset')}
            type="number"
            step="any"
            value={offset}
            disabled={disabled}
            onChange={(event) => onOffset(event.target.value)}
            className={`${CAM_DIALOG_INPUT} pr-12 font-mono ${disabled ? 'cursor-not-allowed' : ''}`}
          />
          <span className="pointer-events-none absolute right-2 top-1.5 text-[8px] text-mute/60">
            {unit}
          </span>
        </span>
      </label>
    </div>
  );
}


export type OpTab = 'tool' | 'geometry' | 'heights' | 'passes' | 'linking';

const OP_TABS: Array<{ id: OpTab; labelKey: string; icon: CamIconId }> = [
  { id: 'tool', labelKey: 'cam.operation.tabTool', icon: 'camTool' },
  { id: 'geometry', labelKey: 'cam.operation.tabGeometry', icon: 'camGeometry' },
  { id: 'heights', labelKey: 'cam.operation.tabHeights', icon: 'camHeights' },
  { id: 'passes', labelKey: 'cam.operation.tabPasses', icon: 'camPasses' },
  { id: 'linking', labelKey: 'cam.operation.tabLinking', icon: 'camLinking' },
];


export function CamOperationTabs({ value, onChange }: { value: OpTab; onChange: (tab: OpTab) => void }) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t('cam.operation.operationPages')} className="grid grid-cols-5 gap-1 rounded border border-edge bg-header/40 p-1">
      {OP_TABS.map(({ id, labelKey, icon }) => (
        <button key={id} type="button" title={t(labelKey)} aria-pressed={value === id} onClick={() => onChange(id)}
          className={'flex h-9 flex-col items-center justify-center gap-0.5 rounded text-[8px] font-semibold ' + (value === id ? 'bg-accent/15 text-accent' : 'text-mute hover:text-ink')}>
          <CamToolIcon id={icon} size={18} />{t(labelKey)}
        </button>
      ))}
    </nav>
  );
}
