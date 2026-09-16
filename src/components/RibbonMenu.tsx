/**
 * Ribbon dropdown menu: renders a MenuEntry tree (items, separators,
 * flyout submenus) using the application menu system.
 *
 * The flyout is React state, not a CSS `:hover` reveal. On the desktop
 * builds the opaque native viewport is cut open around DOM overlay islands,
 * and that mask is refreshed from DOM mutations: a pure `:hover` reveal
 * neither mounts an island for the flyout nor tells the compositor that the
 * flyout now covers part of the viewport, so the panel used to paint behind
 * the native child on macOS (issue 127).
 */
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type SetStateAction,
} from 'react';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from '../i18n';
import { cx } from '../lib/cx';
import type { MenuEntry, RibbonAction } from '../ribbon/config';
import { dispatchRibbonAction } from '../ribbon/dispatch';
import { useAppStore } from '../store/appStore';
import { CONSTRAINT_ICON_IDS, ToolIcon } from './icons';

/**
 * Grace period before a pointer that left a row closes its flyout. The pointer
 * can leave the row for a frame while crossing into the panel; closing
 * immediately would make the submenu impossible to reach with a fast mouse or
 * a trackpad flick. Keyboard focus always outranks this timer.
 */
const FLYOUT_CLOSE_DELAY_MS = 180;

/** Open flyout per menu level: `openPath[depth]` is the row that owns it. */
type FlyoutPath = string[];

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
  // One panel per level. Keeping the path here (rather than per row) is what
  // makes a hover, a click and keyboard focus agree on a single open submenu:
  // opening a row replaces its siblings and every deeper level.
  const [openPath, setOpenPath] = useState<FlyoutPath>([]);
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
          depth={0}
          openPath={openPath}
          setOpenPath={setOpenPath}
        />
      ))}
    </div>
  );
}

function MenuRow({
  entry,
  onClose,
  submenuSide,
  drawingSheetReady,
  depth,
  openPath,
  setOpenPath,
}: {
  entry: MenuEntry;
  onClose: () => void;
  submenuSide: 'left' | 'right';
  drawingSheetReady: boolean;
  depth: number;
  openPath: FlyoutPath;
  setOpenPath: Dispatch<SetStateAction<FlyoutPath>>;
}) {
  const { t } = useTranslation();
  const activeConstraintTool = useAppStore((state) => state.pendingConstraintTool);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const flyoutRef = useRef<HTMLDivElement | null>(null);
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
  const flyoutOpen = hasFlyout && openPath[depth] === entry.id;
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
    setOpenPath((path) => [...path.slice(0, depth), entry.id]);
  };
  /** Close this row's panel and every level below it. A row that is not the
   *  open one at its depth leaves the path alone. */
  const closeFlyout = () => {
    setOpenPath((path) => (path[depth] === entry.id ? path.slice(0, depth) : path));
  };
  const flyoutOwnsFocus = () => Boolean(flyoutRef.current?.contains(document.activeElement));
  /**
   * A hovered row takes the panel over from a sibling that owned keyboard
   * focus. Move focus onto the hovered row so the panel it replaces cannot
   * strand focus on the document body.
   */
  const claimFocusFromOtherFlyout = () => {
    const focused = document.activeElement;
    if (!(focused instanceof Element) || focused === document.body) return;
    if (rowRef.current?.contains(focused)) return;
    if (!focused.closest('[data-ribbon-flyout]')) return;
    rowRef.current?.focus({ preventScroll: true });
  };
  const onPointerEnterRow = () => {
    if (!hasFlyout || !available) return;
    claimFocusFromOtherFlyout();
    openFlyout();
  };
  const onPointerLeaveRow = () => {
    if (!hasFlyout) return;
    cancelFlyoutClose();
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      // Focus owns the panel: a pointer crossing must not unmount the command
      // the user is working in.
      if (flyoutOwnsFocus()) return;
      closeFlyout();
    }, FLYOUT_CLOSE_DELAY_MS);
  };
  /** Focus departure dismisses the panel it left, so a keyboard-opened submenu
   *  never stays behind while another row owns the keyboard. */
  const onRowBlur = (event: ReactFocusEvent<HTMLDivElement>) => {
    if (!hasFlyout) return;
    const next = event.relatedTarget as Node | null;
    if (next && event.currentTarget.contains(next)) return;
    cancelFlyoutClose();
    closeFlyout();
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
      const restoreFocus = flyoutOwnsFocus();
      cancelFlyoutClose();
      closeFlyout();
      if (restoreFocus) rowRef.current?.focus({ preventScroll: true });
      return;
    }
    if (!clickable || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    activate();
  };

  return (
    <div
      ref={rowRef}
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
      onPointerEnter={hasFlyout ? onPointerEnterRow : undefined}
      onPointerLeave={hasFlyout ? onPointerLeaveRow : undefined}
      onBlur={hasFlyout ? onRowBlur : undefined}
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
          ref={flyoutRef}
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
                depth={depth + 1}
                openPath={openPath}
                setOpenPath={setOpenPath}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
