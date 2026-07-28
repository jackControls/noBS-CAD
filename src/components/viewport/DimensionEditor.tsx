/**
 * Inline dimension editor (D9): opens on double-click over a dimension.
 * Accepts plain values or formulas (`=50/2`, `=d1*2`) — Enter commits via
 * the engine (geometry re-solves live), Esc cancels.
 */
import { useEffect, useRef, useState } from 'react';
import { EngineError, getEngine } from '../../engine';
import { useTranslation } from '../../i18n';
import { useAppStore } from '../../store/appStore';
import { DimensionInput } from '../DimensionInput';

export function DimensionEditor() {
  const { t } = useTranslation();
  const editor = useAppStore((s) => s.dimEditor);
  const setDimEditor = useAppStore((s) => s.setDimEditor);
  const setConstraintDialog = useAppStore((s) => s.setConstraintDialog);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setValue(editor?.initial ?? '');
    // Focus after mount.
    const id = window.setTimeout(() => inputRef.current?.select(), 0);
    return () => window.clearTimeout(id);
  }, [editor?.dimId, editor?.initial]);

  if (!editor) return null;

  const commit = async () => {
    const engine = await getEngine();
    try {
      const result = await engine.editDimension({
        constraint_id: editor.dimId,
        text: value,
      });
      useAppStore.getState().setActiveSketch(result.sketch);
      setDimEditor(null);
    } catch (err) {
      // Expression, solver, and transport errors all stay visible to the
      // user; the editor remains open so the value can be corrected.
      const report = err instanceof EngineError
        ? err.data as
          | {
              rejected: { kind: string; entities: Array<{ label: string }> };
              conflicts_with: Array<{ kind: string; entities: Array<{ label: string }> }>;
            }
          | undefined
        : undefined;
      setConstraintDialog({
        titleKey: report ? 'constraints.conflictTitle' : 'dimEditor.errorTitle',
        message: err instanceof Error ? err.message : 'Cannot update dimension',
        conflicts: report,
      });
    }
  };

  return (
    <div
      data-native-viewport-overlay
      className="absolute z-30"
      style={{ left: editor.x + 10, top: editor.y - 14 }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <DimensionInput
        ref={inputRef}
        allowExpressions
        value={value}
        onValueChange={setValue}
        placeholder={t('dimEditor.placeholder')}
        title={t('dimEditor.title')}
        className="h-7 w-32 rounded border border-accent bg-header px-2 font-mono text-xs text-ink shadow-lg shadow-black/50 outline-none"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') void commit();
          else if (e.key === 'Escape') setDimEditor(null);
        }}
      />
    </div>
  );
}
