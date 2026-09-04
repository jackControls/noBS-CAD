import { MousePointer2, X } from 'lucide-react';

interface ViewportSelectionFieldProps {
  label: string;
  status: string;
  hint?: string;
  active: boolean;
  hasSelection: boolean;
  onActivate: () => void;
  onClear?: () => void;
  testId?: string;
  clearTestId?: string;
}

/** A geometry-reference field whose value is communicated by highlights in
 * the viewport instead of an opaque face/edge/profile identifier. */
export function ViewportSelectionField({
  label,
  status,
  hint,
  active,
  hasSelection,
  onActivate,
  onClear,
  testId,
  clearTestId,
}: ViewportSelectionFieldProps) {
  return (
    <fieldset data-selection-field={testId}>
      <legend className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-mute">
        {label}
      </legend>
      <button
        type="button"
        data-testid={testId}
        aria-pressed={active}
        onClick={onActivate}
        className={`flex min-h-10 w-full items-center gap-2 rounded border px-2 py-1.5 text-left transition-colors ${
          active
            ? 'border-accent bg-accent/15 text-ink ring-1 ring-accent/30'
            : 'border-edge bg-header text-ink hover:border-accent/60 hover:bg-edge'
        }`}
      >
        <MousePointer2
          size={14}
          className={active || hasSelection ? 'shrink-0 text-accent' : 'shrink-0 text-mute'}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs">{status}</span>
          {hint && <span className="mt-0.5 block text-[10px] leading-4 text-mute">{hint}</span>}
        </span>
        {active && (
          <span className="rounded bg-accent/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-accent">
            Selecting
          </span>
        )}
      </button>
      {hasSelection && onClear && (
        <button
          type="button"
          data-testid={clearTestId}
          onClick={onClear}
          className="mt-1 flex h-6 items-center gap-1 rounded border border-edge px-2 text-[10px] text-mute hover:bg-edge hover:text-ink"
        >
          <X size={11} />
          Clear
        </button>
      )}
    </fieldset>
  );
}
