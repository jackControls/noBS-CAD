/**
 * Ribbon dropdown menu: renders a MenuEntry tree (items, separators,
 * hover flyout submenus) using the application menu system.
 */
import { ChevronRight } from 'lucide-react';
import { useTranslation } from '../i18n';
import { cx } from '../lib/cx';
import type { MenuEntry, RibbonAction } from '../ribbon/config';
import { dispatchRibbonAction } from '../ribbon/dispatch';
import { CONSTRAINT_ICON_IDS, ToolIcon } from './icons';

export function RibbonMenu({
  entries,
  onClose,
}: {
  entries: MenuEntry[];
  onClose: () => void;
}) {
  return (
    <div
      role="menu"
      className="w-64 rounded border border-edge bg-header py-1 shadow-xl shadow-black/40"
    >
      {entries.map((entry, i) => (
        <MenuRow key={entry.type === 'separator' ? `sep-${i}` : entry.id} entry={entry} onClose={onClose} />
      ))}
    </div>
  );
}

function MenuRow({ entry, onClose }: { entry: MenuEntry; onClose: () => void }) {
  const { t } = useTranslation();

  if (entry.type === 'separator') {
    return <div className="mx-2 my-1 h-px bg-edge" />;
  }

  const run = (action?: RibbonAction, payload?: string) => dispatchRibbonAction(action, payload);

  const hasAvailableChild =
    entry.children?.some(
      (child) =>
        child.type === 'item' &&
        (child.enabled || child.children?.some((grandchild) => grandchild.type === 'item' && grandchild.enabled)),
    ) ?? false;
  const available = Boolean(entry.enabled || hasAvailableChild);
  const clickable = Boolean(entry.enabled && !entry.children);
  const activate = () => {
    if (!clickable) return;
    run(entry.action, entry.payload);
    onClose();
  };

  return (
    <div
      role="menuitem"
      aria-disabled={!available}
      data-ribbon-menu-item
      data-enabled={available ? 'true' : 'false'}
      tabIndex={available ? 0 : -1}
      className={cx(
        'group relative flex h-7 items-center gap-2 px-3 text-xs outline-none transition-colors duration-75',
        available
          ? 'cursor-pointer text-ink hover:bg-accent/40 focus-visible:bg-accent/40'
          : 'cursor-default text-mute/40 hover:bg-edge/70',
      )}
      onClick={clickable ? activate : undefined}
      onKeyDown={
        clickable
          ? (event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              activate();
            }
          : undefined
      }
    >
      <ToolIcon
        id={entry.icon}
        size={15}
        tone={entry.icon && CONSTRAINT_ICON_IDS.has(entry.icon) ? 'constraint' : undefined}
      />
      <span className="min-w-0 flex-1 truncate">{t(entry.labelKey)}</span>
      {entry.shortcut && <span className="shrink-0 text-mute">{entry.shortcut}</span>}
      {entry.children && <ChevronRight size={12} className="shrink-0 text-mute" />}

      {entry.children && (
        <div className="absolute left-full top-0 z-10 hidden pl-0.5 group-hover:block group-focus-within:block">
          <div className="w-60 rounded border border-edge bg-header py-1 shadow-xl shadow-black/40">
            {entry.children.map((child, i) => (
              <MenuRow
                key={child.type === 'separator' ? `sep-${i}` : child.id}
                entry={child}
                onClose={onClose}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
