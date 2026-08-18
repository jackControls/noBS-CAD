import { useEffect, useRef } from 'react';
import { useTranslation } from '../i18n';
import type { FeatureDto } from '../types/document';

/** Shared dependency-aware feature deletion confirmation for tree and history. */
export function DeleteFeatureDialog({
  features,
  busy,
  onCancel,
  onConfirm,
}: {
  features: FeatureDto[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  const confirmRef = useRef<HTMLButtonElement>(null);
  const message = features.length === 1
    ? t('timeline.deleteMessage').replace('{name}', features[0].name)
    : t('timeline.deleteMultipleMessage')
      .replace('{count}', String(features.length))
      .replace('{names}', features.map((feature) => feature.name).join(', '));

  useEffect(() => {
    confirmRef.current?.focus({ preventScroll: true });
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [busy, onCancel]);

  return (
    <div
      data-native-viewport-dim="0.45"
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/45"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-feature-title"
        aria-describedby="delete-feature-message"
        className="w-[28rem] max-w-[calc(100vw-2rem)] rounded border border-edge bg-panel shadow-xl shadow-black/50"
      >
        <div
          id="delete-feature-title"
          className="border-b border-edge px-4 py-3 text-sm font-semibold text-ink"
        >
          {t('timeline.deleteTitle')}
        </div>
        <div
          id="delete-feature-message"
          className="px-4 py-4 text-xs leading-relaxed text-ink/90"
        >
          {message}
        </div>
        <div className="flex justify-end gap-2 border-t border-edge px-4 py-3">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="h-8 rounded border border-edge px-4 text-xs text-ink hover:bg-edge disabled:opacity-40"
          >
            {t('timeline.deleteCancel')}
          </button>
          <button
            ref={confirmRef}
            type="button"
            data-testid="delete-feature-confirm"
            disabled={busy}
            onClick={onConfirm}
            className="h-8 rounded bg-red-600 px-4 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-40"
          >
            {t('timeline.deleteConfirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
