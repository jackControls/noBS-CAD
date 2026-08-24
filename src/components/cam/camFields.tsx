import type { ReactNode } from 'react';
import type { CamUnits } from '../../engine/types';
import { lengthUnitLabel, feedUnitLabel } from '../../cam/units';

export const CAM_DIALOG_INPUT =
  'h-7 w-full rounded border border-edge bg-header px-2 text-xs text-ink outline-none focus:border-accent';
export const CAM_DIALOG_LABEL =
  'mb-1 block text-[10px] font-semibold uppercase tracking-wide text-mute';

export function DialogSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="border-b border-edge/70 pb-1 text-[9px] font-semibold tracking-[0.14em] text-mute/70">
        {title}
      </div>
      {children}
    </section>
  );
}

/** Title hint for fields rendered as placeholders: the option exists in the
 *  UI contract but the planner does not consume it yet. */
export const NOT_APPLIED_YET = 'Not applied yet — planning support lands later';

/** Numeric draft field. Drafts stay strings in the document's display units;
 *  conversion to canonical mm happens once at submit. */
export function DraftNumber({
  label,
  value,
  onChange,
  unit,
  integer = false,
  placeholder,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  unit?: string;
  integer?: boolean;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <label className="block" title={disabled ? NOT_APPLIED_YET : undefined}>
      <span className={CAM_DIALOG_LABEL}>{label}</span>
      <span className="relative block">
        <input
          type="number"
          step={integer ? 1 : 'any'}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className={`${CAM_DIALOG_INPUT} font-mono ${unit ? 'pr-12' : ''} ${
            disabled ? 'cursor-not-allowed opacity-45' : ''
          }`}
        />
        {unit && (
          <span className="pointer-events-none absolute right-2 top-1.5 text-[8px] text-mute/60">
            {unit}
          </span>
        )}
      </span>
    </label>
  );
}

export function parseDraft(value: string, label: string): number {
  const parsed = Number(value.trim());
  if (!value.trim() || !Number.isFinite(parsed)) {
    throw new Error(`${label} needs a finite number.`);
  }
  return parsed;
}

export function parseOptionalDraft(value: string, label: string): number | null {
  if (!value.trim()) return null;
  return parseDraft(value, label);
}

export function lengthUnit(units: CamUnits): string {
  return lengthUnitLabel(units);
}

export function feedUnit(units: CamUnits): string {
  return feedUnitLabel(units);
}
