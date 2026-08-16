import { Save, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from '../i18n';
import {
  currentUnsavedPrompt,
  resolveUnsavedPrompt,
  unsavedPromptMessage,
} from '../files/unsavedChanges';

export function UnsavedChangesDialog() {
  const { t } = useTranslation();
  const [prompt, setPrompt] = useState(currentUnsavedPrompt);

  useEffect(() => {
    const sync = () => setPrompt(currentUnsavedPrompt());
    window.addEventListener('nbcad:unsaved-prompt-change', sync);
    return () => window.removeEventListener('nbcad:unsaved-prompt-change', sync);
  }, []);

  useEffect(() => {
    if (!prompt) return undefined;
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      resolveUnsavedPrompt('cancel');
    };
    window.addEventListener('keydown', cancelOnEscape, true);
    return () => window.removeEventListener('keydown', cancelOnEscape, true);
  }, [prompt]);

  if (!prompt) return null;

  return (
    <div
      data-native-viewport-dim="0.45"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/45 p-5"
    >
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="unsaved-dialog-title"
        aria-describedby="unsaved-dialog-message"
        data-testid="unsaved-changes-dialog"
        className="feature-dialog w-[430px] max-w-full overflow-hidden bg-panel text-ink"
      >
        <header className="flex items-center gap-2 border-b border-edge bg-header px-4 py-3">
          <TriangleAlert size={18} className="shrink-0 text-[#e8963c]" />
          <h2 id="unsaved-dialog-title" className="text-sm font-semibold">
            {t('file.unsaved')}
          </h2>
        </header>
        <div className="px-4 py-4">
          <p id="unsaved-dialog-message" className="text-sm leading-relaxed text-ink/90">
            {unsavedPromptMessage(prompt.kind)}
          </p>
          {prompt.projectName && (
            <p className="mt-2 truncate text-xs font-medium text-mute">
              {prompt.projectName}
            </p>
          )}
        </div>
        <footer className="flex justify-end gap-2 border-t border-edge bg-header px-4 py-3">
          <button
            type="button"
            onClick={() => resolveUnsavedPrompt('cancel')}
            className="h-8 rounded border border-edge bg-panel px-3 text-xs text-ink hover:border-accent"
          >
            {t('file.cancel')}
          </button>
          <button
            type="button"
            onClick={() => resolveUnsavedPrompt('discard')}
            className="h-8 rounded border border-warn/50 bg-warn/10 px-3 text-xs font-medium text-warn hover:bg-warn/20"
          >
            {t('file.discard')}
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => resolveUnsavedPrompt('save')}
            className="flex h-8 items-center gap-1.5 rounded bg-accent px-3 text-xs font-semibold text-white hover:brightness-110"
          >
            <Save size={13} /> {t('file.save')}
          </button>
        </footer>
      </section>
    </div>
  );
}
