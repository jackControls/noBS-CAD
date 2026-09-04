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
  const dimension = useAppStore((s) =>
    editor
      ? s.activeSketch?.dimensions.find((candidate) => candidate.constraint_id === editor.dimId)
      : undefined,
  );
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

  if (!editor || !dimension) return null;

  const reportError = (err: unknown, fallback: string) => {
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
      message: err instanceof Error ? err.message : fallback,
      conflicts: report,
    });
  };

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
      reportError(err, 'Cannot update dimension');
    }
  };

  const toggleMode = async () => {
    const engine = await getEngine();
    try {
      const result = await engine.setDimensionMode({
        constraint_id: editor.dimId,
        mode: dimension.mode === 'driving' ? 'reference' : 'driving',
      });
      useAppStore.getState().setActiveSketch(result.sketch);
      setDimEditor(null);
    } catch (err) {
      reportError(err, 'Cannot change dimension mode');
    }
  };

  return (
    <div
      data-native-viewport-overlay
      className="absolute z-30 flex items-center gap-1"
      style={{ left: editor.x + 10, top: editor.y - 14 }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {dimension.mode === 'driving' ? (
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
      ) : (
        <div
          data-reference-dimension-value
          className="flex h-7 min-w-24 items-center rounded border border-edge bg-header px-2 font-mono text-xs text-mute shadow-lg shadow-black/50"
          title={t('dimEditor.referenceDescription')}
        >
          {dimension.text}
        </div>
      )}
      <button
        type="button"
        data-dimension-mode-toggle
        className="h-7 whitespace-nowrap rounded border border-edge bg-panel px-2 text-xs text-ink hover:border-accent hover:text-accent"
        title={dimension.mode === 'driving'
          ? t('dimEditor.makeReferenceDescription')
          : t('dimEditor.makeDrivingDescription')}
        onClick={() => void toggleMode()}
      >
        {dimension.mode === 'driving'
          ? t('dimEditor.makeReference')
          : t('dimEditor.makeDriving')}
      </button>
    </div>
  );
}
