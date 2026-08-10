/**
 * Ribbon dropdown menu: renders a MenuEntry tree (items, separators,
 * hover flyout submenus) using the application menu system.
 */
import { ChevronRight } from 'lucide-react';
import { useTranslation } from '../i18n';
import { cx } from '../lib/cx';
import type { MenuEntry, RibbonAction } from '../ribbon/config';
import { dispatchRibbonAction } from '../ribbon/dispatch';
import { useAppStore } from '../store/appStore';
import { CONSTRAINT_ICON_IDS, ToolIcon } from './icons';

function actionRequiresDrawingSheet(action?: RibbonAction): boolean {
  return action === 'drawingAutoLayout'
    || action === 'drawingAddView'
    || action === 'drawingTool'
    || action === 'drawingExportDxf'
    || action === 'drawingPrint';
}

function entryAvailable(entry: MenuEntry, drawingSheetReady: boolean): boolean {
  if (entry.type === 'separator') return false;
  const ownAvailable = Boolean(
    entry.enabled && (!actionRequiresDrawingSheet(entry.action) || drawingSheetReady),
  );
  return ownAvailable || (entry.children?.some((child) => entryAvailable(child, drawingSheetReady)) ?? false);
}

export function RibbonMenu({
  entries,
  onClose,
  submenuSide = 'right',
}: {
  entries: MenuEntry[];
  onClose: () => void;
  submenuSide?: 'left' | 'right';
}) {
  const drawingSheetReady = useAppStore((state) => {
    const activeSheetExists = state.drawingDocument.active_sheet_id !== null
      && state.drawingDocument.sheets.some((sheet) => sheet.id === state.drawingDocument.active_sheet_id);
    return activeSheetExists && !state.drawingSheetSetupOpen;
  });
  return (
    <div
      role="menu"
      className="w-64 rounded border border-edge bg-header py-1 shadow-xl shadow-black/40"
    >
      {entries.map((entry, i) => (
        <MenuRow
          key={entry.type === 'separator' ? `sep-${i}` : entry.id}
          entry={entry}
          onClose={onClose}
          submenuSide={submenuSide}
          drawingSheetReady={drawingSheetReady}
        />
      ))}
    </div>
  );
}

function MenuRow({ entry, onClose, submenuSide, drawingSheetReady }: {
  entry: MenuEntry;
  onClose: () => void;
  submenuSide: 'left' | 'right';
  drawingSheetReady: boolean;
}) {
  const { t } = useTranslation();

  if (entry.type === 'separator') {
    return <div className="mx-2 my-1 h-px bg-edge" />;
  }

  const run = (action?: RibbonAction, payload?: string) => dispatchRibbonAction(action, payload);

  const available = entryAvailable(entry, drawingSheetReady);
  const clickable = Boolean(
    entry.enabled
      && !entry.children
      && (!actionRequiresDrawingSheet(entry.action) || drawingSheetReady),
  );
  const activate = () => {
    if (!clickable) return;
    run(entry.action, entry.payload);
    onClose();
  };

  return (
    <div
      role="menuitem"
      aria-disabled={!available}
      data-ribbon-menu-id={entry.id}
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
        <div className={cx(
          'absolute top-0 z-10 hidden group-hover:block group-focus-within:block',
          submenuSide === 'left' ? 'right-full pr-0.5' : 'left-full pl-0.5',
        )}>
          <div className="w-60 rounded border border-edge bg-header py-1 shadow-xl shadow-black/40">
            {entry.children.map((child, i) => (
              <MenuRow
                key={child.type === 'separator' ? `sep-${i}` : child.id}
                entry={child}
                onClose={onClose}
                submenuSide={submenuSide}
                drawingSheetReady={drawingSheetReady}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
