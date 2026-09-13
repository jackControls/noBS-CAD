import type { CamHeightReferenceDto } from '../../engine/types';
import { CamToolIcon, type CamIconId } from './CamToolIcon';
import { CAM_DIALOG_INPUT, CAM_DIALOG_LABEL, NOT_APPLIED_YET } from './camFields';

export type HeightFrom = CamHeightReferenceDto;

const HEIGHT_PLANES: Array<{ value: HeightFrom; label: string }> = [
  { value: 'model_top', label: 'Model top' },
  { value: 'model_bottom', label: 'Model bottom' },
  { value: 'stock_top', label: 'Stock top' },
  { value: 'stock_bottom', label: 'Stock bottom' },
  { value: 'origin', label: 'Origin (absolute)' },
];
/** Chain references a height row may offer, per the fixed resolution order
 *  (a row only lists LOWER heights). */
export const HEIGHT_CHAIN_LABELS: Partial<Record<HeightFrom, string>> = {
  bottom: 'Bottom height',
  top: 'Top height',
  feed: 'Feed height',
  retract: 'Retract height',
};
const HEIGHT_FROM_DEAD = [
  'Fixture top',
  'Fixture bottom',
  'Highest of…',
  'Lowest of…',
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
  disabledReason = NOT_APPLIED_YET,
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
  return (
    <div
      className={`grid grid-cols-2 gap-2 ${disabled ? 'opacity-45' : ''}`}
      title={disabled ? disabledReason : undefined}
    >
      <label className="block">
        <span className={CAM_DIALOG_LABEL}>From</span>
        <select
          aria-label="From"
          value={from}
          disabled={disabled}
          onChange={(event) => onFrom(event.target.value as HeightFrom)}
          className={`${CAM_DIALOG_INPUT} ${disabled ? 'cursor-not-allowed' : ''}`}
        >
          {HEIGHT_PLANES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
          {holeRefsAvailable && (
            <optgroup label="Picked holes">
              <option value="hole_top">Hole top</option>
              <option value="hole_bottom">Hole bottom</option>
            </optgroup>
          )}
          {chainBelow.length > 0 && (
            <optgroup label="Operation heights">
              {chainBelow.map((value) => (
                <option key={value} value={value}>
                  {HEIGHT_CHAIN_LABELS[value]}
                </option>
              ))}
            </optgroup>
          )}
          <option
            value="selection"
            disabled={!selectionAvailable}
            title={
              selectionAvailable
                ? 'The picked edge chain or sketch plane in setup Z'
                : 'Pick coplanar edges or a sketch loop on Geometry first'
            }
          >
            Selection (geometry plane)
          </option>
          <optgroup label="Not applied yet">
            {HEIGHT_FROM_DEAD.map((text) => (
              <option key={text} disabled>
                {text}
              </option>
            ))}
          </optgroup>
        </select>
      </label>
      <label className="block">
        <span className={CAM_DIALOG_LABEL}>Offset</span>
        <span className="relative block">
          <input
            aria-label="Offset"
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

const OP_TABS: Array<{ id: OpTab; label: string; icon: CamIconId }> = [
  { id: 'tool', label: 'Tool', icon: 'camTool' },
  { id: 'geometry', label: 'Geometry', icon: 'camGeometry' },
  { id: 'heights', label: 'Heights', icon: 'camHeights' },
  { id: 'passes', label: 'Passes', icon: 'camPasses' },
  { id: 'linking', label: 'Linking', icon: 'camLinking' },
];


export function CamOperationTabs({ value, onChange }: { value: OpTab; onChange: (tab: OpTab) => void }) {
  return (
    <nav aria-label="Operation pages" className="grid grid-cols-5 gap-1 rounded border border-edge bg-header/40 p-1">
      {OP_TABS.map(({ id, label, icon }) => (
        <button key={id} type="button" title={label} aria-pressed={value === id} onClick={() => onChange(id)}
          className={'flex h-9 flex-col items-center justify-center gap-0.5 rounded text-[8px] font-semibold ' + (value === id ? 'bg-accent/15 text-accent' : 'text-mute hover:text-ink')}>
          <CamToolIcon id={icon} size={18} />{label}
        </button>
      ))}
    </nav>
  );
}
