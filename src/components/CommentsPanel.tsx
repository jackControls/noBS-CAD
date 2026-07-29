/**
 * Comments strip (bottom-left overlay): collapsed application-shell placeholder.
 * Expansion is post-M0 scope.
 */
import { ChevronUp, Plus } from 'lucide-react';
import { useTranslation } from '../i18n';

export function CommentsPanel() {
  const { t } = useTranslation();

  return (
    <div
      data-native-viewport-overlay
      className="absolute bottom-3 left-3 z-10 flex h-7 w-64 items-center justify-between rounded border border-edge bg-header/95 px-2 backdrop-blur-sm"
    >
      <div className="flex items-center gap-1.5">
        <ChevronUp size={12} className="text-mute" />
        <span className="text-[10px] font-semibold tracking-widest text-mute">
          {t('comments.title')}
        </span>
      </div>
      <button
        type="button"
        title={t('comments.add')}
        className="flex h-5 w-5 items-center justify-center rounded text-mute hover:bg-edge hover:text-ink"
      >
        <Plus size={12} />
      </button>
    </div>
  );
}
