/**
 * Dynamic input cluster (M1b): floating fields next to the cursor while a
 * drawing tool rubber-bands. Live values update per move; a user-typed
 * value LOCKS the field (padlock indicator) and the rubber band respects
 * the lock. Tab cycles focus; the Viewport's key handler owns text entry.
 * Pointer interaction stays here so clicking a field cannot fall through to
 * the canvas and accidentally commit the active sketch tool.
 */
import { Lock } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { cx } from '../../lib/cx';
import { useAppStore, type DynField } from '../../store/appStore';
import { DimensionInput } from '../DimensionInput';

export function DynamicInputOverlay() {
  const { t } = useTranslation();
  const dyn = useAppStore((s) => s.dynInput);
  const setDynField = useAppStore((s) => s.setDynField);
  const setDynFocus = useAppStore((s) => s.setDynFocus);
  if (!dyn.active) return null;

  const visible = dyn.fields.filter((f) => f.visible);
  if (visible.length === 0) return null;

  return (
    <div
      data-dyn-input
      data-native-viewport-overlay
      className="pointer-events-auto absolute z-20 flex items-center gap-1"
      style={{ left: dyn.x, top: dyn.y }}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {visible.map((field, index) => {
        const focused = dyn.focus !== null && visible[dyn.focus]?.key === field.key;
        return (
          <DynamicFieldInput
            key={field.key}
            field={field}
            index={index}
            label={t(`dyn.${field.key}`)}
            focused={focused}
            selectAll={focused && dyn.selectAll}
            pending={dyn.pending}
            onFocus={setDynFocus}
            onClear={setDynField}
          />
        );
      })}
    </div>
  );
}

function DynamicFieldInput({
  field,
  index,
  label,
  focused,
  selectAll,
  pending,
  onFocus,
  onClear,
}: {
  field: DynField;
  index: number;
  label: string;
  focused: boolean;
  selectAll: boolean;
  pending: boolean;
  onFocus: (index: number | null, selectAll?: boolean) => void;
  onClear: (key: string, value: string, locked: boolean) => void;
}) {
  return (
    <div
      data-dyn-field={field.key}
      title="Click to select the value; type to replace"
      onPointerDown={(event) => {
        event.stopPropagation();
        onFocus(index);
      }}
      onPointerUp={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onFocus(index);
      }}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClear(field.key, '', false);
        onFocus(index);
      }}
      className={cx(
        'flex h-6 cursor-text items-center gap-1 rounded-[3px] border px-1.5 font-mono text-[11px] tabular-nums shadow-md shadow-black/40 outline-none',
        pending
          ? 'border-accent/70 border-dashed bg-header/95 text-ink'
          : focused
            ? 'border-accent bg-accent/15 text-ink'
            : field.locked
              ? 'border-accent/60 bg-header/95 text-ink'
              : 'border-edge bg-header/90 text-ink/90',
      )}
    >
      <span className="text-[9px] uppercase tracking-wide text-mute">{label}</span>
      <DimensionInput
        allowExpressions
        readOnly
        tabIndex={-1}
        aria-label={`${label} ${field.value || 'empty'}`}
        value={field.value}
        onValueChange={() => undefined}
        placeholder="—"
        style={{ width: `${Math.max(4, field.value.length + 1)}ch` }}
        className={cx(
          'pointer-events-none h-5 min-w-8 rounded-sm px-0.5 text-right text-current outline-none',
          selectAll ? 'bg-accent/70 text-white' : 'bg-transparent',
        )}
      />
      {field.locked && <Lock size={9} className="text-accent" />}
    </div>
  );
}
