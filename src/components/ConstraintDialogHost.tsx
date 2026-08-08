/**
 * Modal host for constraint feedback: invalid selections and D4.2
 * over-constraint conflicts (lists the rejected constraint and the
 * conflicting ones, OK to dismiss).
 */
import { useTranslation } from '../i18n';
import { useAppStore } from '../store/appStore';

export function ConstraintDialogHost() {
  const { t } = useTranslation();
  const dialog = useAppStore((s) => s.constraintDialog);
  const setDialog = useAppStore((s) => s.setConstraintDialog);
  if (!dialog) return null;

  return (
    <div
      data-native-viewport-dim="0.40"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={() => setDialog(null)}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-96 rounded border border-edge bg-panel shadow-xl shadow-black/50"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-edge px-3 py-2 text-xs font-semibold text-ink">
          {t(dialog.titleKey)}
        </div>
        <div className="max-h-64 overflow-y-auto px-3 py-2.5 text-xs leading-relaxed text-ink/90">
          {dialog.message}
          {dialog.conflicts && dialog.conflicts.conflicts_with.length > 0 && (
            <ul className="mt-2 space-y-1">
              {dialog.conflicts.conflicts_with.map((c, i) => (
                <li key={i} className="rounded bg-header px-2 py-1 font-mono text-[10px] text-mute">
                  {c.kind}({c.entities.map((e) => e.label).join(', ')})
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex justify-end border-t border-edge px-3 py-2">
          <button
            type="button"
            onClick={() => setDialog(null)}
            className="h-7 rounded bg-accent px-4 text-xs font-semibold text-white hover:brightness-110"
          >
            {t('constraints.ok')}
          </button>
        </div>
      </div>
    </div>
  );
}
