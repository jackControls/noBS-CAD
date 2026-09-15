/**
 * Ribbon dropdown menu: renders a MenuEntry tree (items, separators,
 * hover flyout submenus) using the application menu system.
 *
 * The flyout is React state, not a CSS `:hover` reveal. On the desktop
 * builds the opaque native viewport is cut open around DOM overlay islands,
 * and that mask is refreshed from DOM mutations: a pure `:hover` reveal
 * neither mounts an island for the flyout nor tells the compositor that the
 * flyout now covers part of the viewport, so the panel used to paint behind
 * the native child on macOS (issue 127).
 */
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from '../i18n';
import { cx } from '../lib/cx';
import type { MenuEntry, RibbonAction } from '../ribbon/config';
import { dispatchRibbonAction } from '../ribbon/dispatch';
import { useAppStore } from '../store/appStore';
import { CONSTRAINT_ICON_IDS, ToolIcon } from './icons';

/**
 * Grace period before a flyout closes. The pointer can leave the parent row
 * for a frame while crossing into the panel; closing immediately would make
 * the submenu impossible to reach with a fast mouse or a trackpad flick.
 */
const FLYOUT_CLOSE_DELAY_MS = 180;

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
  const activeConstraintTool = useAppStore((state) => state.pendingConstraintTool);
  const [flyoutOpen, setFlyoutOpen] = useState(false);
  const closeTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    },
    [],
  );

  if (entry.type === 'separator') {
    return <div className="mx-2 my-1 h-px bg-edge" />;
  }

  const run = (action?: RibbonAction, payload?: string) => dispatchRibbonAction(action, payload);

  const available = entryAvailable(entry, drawingSheetReady);
  const hasFlyout = Boolean(entry.children && entry.children.length > 0);
  const clickable = Boolean(
    entry.enabled
      && !entry.children
      && (!actionRequiresDrawingSheet(entry.action) || drawingSheetReady),
  );
  const active = entry.action === 'applyConstraint' && activeConstraintTool === entry.payload;
  const activate = () => {
    if (!clickable) return;
    run(entry.action, entry.payload);
    onClose();
  };

  const cancelFlyoutClose = () => {
    if (closeTimer.current === null) return;
    window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const openFlyout = () => {
    if (!hasFlyout || !available) return;
    cancelFlyoutClose();
    setFlyoutOpen(true);
  };
  const closeFlyout = () => {
    cancelFlyoutClose();
    setFlyoutOpen(false);
  };
  const scheduleFlyoutClose = () => {
    if (!hasFlyout) return;
    cancelFlyoutClose();
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setFlyoutOpen(false);
    }, FLYOUT_CLOSE_DELAY_MS);
  };
  const onRowKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (hasFlyout && (event.key === 'ArrowRight' || event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      openFlyout();
      return;
    }
    if (hasFlyout && flyoutOpen && (event.key === 'Escape' || event.key === 'ArrowLeft')) {
      // Close only this level; the shell must not also dismiss the whole menu.
      event.preventDefault();
      event.stopPropagation();
      closeFlyout();
      return;
    }
    if (!clickable || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    activate();
  };

  return (
    <div
      role="menuitem"
      aria-disabled={!available}
      aria-haspopup={hasFlyout ? 'menu' : undefined}
      aria-expanded={hasFlyout ? flyoutOpen : undefined}
      data-ribbon-menu-id={entry.id}
      data-ribbon-menu-item
      data-enabled={available ? 'true' : 'false'}
      data-active={active ? 'true' : 'false'}
      aria-current={active ? 'true' : undefined}
      tabIndex={available ? 0 : -1}
      className={cx(
        'group relative flex h-7 items-center gap-2 px-3 text-xs outline-none transition-colors duration-75',
        available
          ? 'cursor-pointer text-ink hover:bg-accent/40 focus-visible:bg-accent/40'
          : 'cursor-default text-mute/40 hover:bg-edge/70',
        active && 'bg-accent/25',
      )}
      onPointerEnter={hasFlyout ? openFlyout : undefined}
      onPointerLeave={hasFlyout ? scheduleFlyoutClose : undefined}
      onClick={clickable ? activate : hasFlyout && available ? openFlyout : undefined}
      onKeyDown={onRowKeyDown}
    >
      <ToolIcon
        id={entry.icon}
        size={15}
        tone={entry.icon && CONSTRAINT_ICON_IDS.has(entry.icon) ? 'constraint' : undefined}
      />
      <span className="min-w-0 flex-1 truncate">{t(entry.labelKey)}</span>
      {entry.shortcut && <span className="shrink-0 text-mute">{entry.shortcut}</span>}
      {entry.children && <ChevronRight size={12} className="shrink-0 text-mute" />}

      {hasFlyout && flyoutOpen && (
        <div
          // The panel overflows the portaled menu's own box, so it needs its
          // own cut-out island: the desktop host masks the native viewport
          // with the union of these rectangles, and a child's overflow is not
          // part of the menu wrapper's getBoundingClientRect().
          data-ribbon-flyout
          data-native-viewport-overlay
          className={cx(
            'absolute top-0 z-10',
            submenuSide === 'left' ? 'right-full pr-0.5' : 'left-full pl-0.5',
          )}
        >
          <div className="w-60 rounded border border-edge bg-header py-1 shadow-xl shadow-black/40">
            {entry.children?.map((child, i) => (
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
