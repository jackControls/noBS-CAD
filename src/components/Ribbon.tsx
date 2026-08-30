/**
 * Ribbon: data-driven panels of icon buttons with dropdown panel menus,
 * driven by src/ribbon/config.ts. The left cell holds the workspace
 * switcher (Solid Modeling / Drawing), a dropdown owned by the active
 * project tab. In sketch mode a green FINISH SKETCH button docks on the
 * right.
 *
 * The ribbon measures its usable command area and progressively condenses
 * secondary commands into their panel menus before horizontal scrolling is
 * allowed. This keeps every workflow group, including Select, in view at
 * normal desktop widths while restoring direct commands as space returns.
 *
 * Dropdown menus are PORTALED to document.body so they escape the 92 px
 * ribbon clip; `data-ribbon-menu` marks them so the outside-pointer closer
 * doesn't treat menu clicks as outside clicks.
 */
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Box, Check, ChevronDown, FileText, Wrench } from 'lucide-react';
import { useTranslation } from '../i18n';
import { cx } from '../lib/cx';
import {
  ribbonTabById,
  type MenuEntry,
  type RibbonAction,
  type RibbonButton,
  type RibbonPanel,
  type RibbonTab,
} from '../ribbon/config';
import { dispatchRibbonAction } from '../ribbon/dispatch';
import { useAppStore } from '../store/appStore';
import { CONSTRAINT_ICON_IDS, ToolIcon } from './icons';
import { RibbonMenu } from './RibbonMenu';

function ribbonButtonKey(panel: RibbonPanel, button: RibbonButton): string {
  return `${panel.id}:${button.id}`;
}

/**
 * Preserve the first button in every panel as its primary command. The
 * remaining buttons are ordered by their position within a panel, so a
 * compact ribbon sheds the last/least-primary command from each group before
 * it ever removes a group's primary action.
 */
function collapsibleButtonKeys(panels: RibbonPanel[]): string[] {
  return panels
    .flatMap((panel, panelIndex) => panel.buttons.map((button, buttonIndex) => ({
      key: ribbonButtonKey(panel, button),
      panelIndex,
      buttonIndex,
    })))
    .filter(({ buttonIndex }) => buttonIndex > 0)
    .sort((a, b) => a.buttonIndex - b.buttonIndex || a.panelIndex - b.panelIndex)
    .map(({ key }) => key);
}

function useResponsiveRibbonLayout(
  tab: RibbonTab,
  commandStripRef: { current: HTMLDivElement | null },
) {
  const allButtonKeys = useMemo(
    () => tab.panels.flatMap((panel) => panel.buttons.map((button) => ribbonButtonKey(panel, button))),
    [tab],
  );
  const candidates = useMemo(() => collapsibleButtonKeys(tab.panels), [tab]);
  const [visibleCandidateCount, setVisibleCandidateCount] = useState(candidates.length);
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const [settled, setSettled] = useState(false);
  const priorWidthRef = useRef<number | null>(null);

  // A workspace switch starts from its complete command set. The layout pass
  // immediately removes only the commands that do not fit in its own usable
  // width (which already excludes the workspace switcher and Finish Sketch).
  useLayoutEffect(() => {
    priorWidthRef.current = null;
    setVisibleCandidateCount(candidates.length);
    setSettled(false);
  }, [tab.id, candidates.length]);

  useLayoutEffect(() => {
    const strip = commandStripRef.current;
    if (!strip) return;

    const noteWidth = (width: number) => {
      const priorWidth = priorWidthRef.current;
      if (priorWidth !== null && Math.abs(width - priorWidth) < 0.5) return;
      priorWidthRef.current = width;
      // Start a fresh fitting pass on every real width change. Restoring the
      // complete set first is deliberate: it lets a newly larger window bring
      // back every command it can accommodate, while the layout effect below
      // trims only what still overflows.
      setVisibleCandidateCount(candidates.length);
      setMeasuredWidth(width);
      setSettled(false);
    };

    noteWidth(strip.clientWidth);
    const observer = new ResizeObserver((entries) => {
      noteWidth(entries[0]?.contentRect.width ?? strip.clientWidth);
    });
    observer.observe(strip);
    const onWindowResize = () => noteWidth(strip.clientWidth);
    window.addEventListener('resize', onWindowResize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', onWindowResize);
    };
  }, [commandStripRef, tab.id]);

  useLayoutEffect(() => {
    const strip = commandStripRef.current;
    if (!strip) return;

    const overflowing = strip.scrollWidth > strip.clientWidth + 1;
    if (overflowing && visibleCandidateCount > 0) {
      setSettled(false);
      setVisibleCandidateCount((count) => Math.max(0, count - 1));
      return;
    }

    setSettled(true);
  }, [candidates.length, commandStripRef, measuredWidth, tab.id, visibleCandidateCount]);

  const visibleButtonKeys = useMemo(() => {
    const hidden = new Set(candidates.slice(visibleCandidateCount));
    return new Set(allButtonKeys.filter((key) => !hidden.has(key)));
  }, [allButtonKeys, candidates, visibleCandidateCount]);

  return {
    visibleButtonKeys,
    atMinimum: visibleCandidateCount === 0,
    measuredWidth,
    settled,
  };
}

export function Ribbon() {
  const { t } = useTranslation();
  const mode = useAppStore((s) => s.mode);
  const activeTab = useAppStore((s) => s.activeTab);
  const documentOpen = useAppStore((s) => s.document !== null);
  const [openPanel, setOpenPanel] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const commandStripRef = useRef<HTMLDivElement>(null);

  // Close open dropdowns on outside pointer down (menu portals are exempt
  // via data-ribbon-menu).
  useEffect(() => {
    if (!openPanel) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('[data-ribbon-menu]')) return;
      setOpenPanel(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenPanel(null);
    };
    window.document.addEventListener('pointerdown', onPointerDown);
    window.document.addEventListener('keydown', onKeyDown);
    return () => {
      window.document.removeEventListener('pointerdown', onPointerDown);
      window.document.removeEventListener('keydown', onKeyDown);
    };
  }, [openPanel]);

  const tab = ribbonTabById(activeTab);
  const responsiveLayout = useResponsiveRibbonLayout(tab, commandStripRef);
  const dispatch = (action?: RibbonAction, payload?: string) => dispatchRibbonAction(action, payload);

  return (
    <div
      ref={rootRef}
      className="relative flex h-[92px] w-full min-w-0 shrink-0 flex-col overflow-hidden"
    >
      <div
        data-testid="ribbon-tools"
        className="flex h-[92px] min-w-0 shrink-0 items-stretch border-b border-edge bg-header"
      >
        <WorkspaceSwitcher onOpen={() => setOpenPanel(null)} />
        <div
          ref={commandStripRef}
          data-testid="ribbon-command-scroll"
          data-ribbon-layout-ready={responsiveLayout.settled ? 'true' : 'false'}
          data-ribbon-layout-width={Math.round(responsiveLayout.measuredWidth)}
          className={cx(
            'flex min-w-0 flex-1 items-stretch',
            responsiveLayout.atMinimum ? 'overflow-x-auto overscroll-x-contain' : 'overflow-hidden',
          )}
        >
          {tab.panels.map((panel) => {
            const visibleButtons = panel.buttons.filter((button) =>
              responsiveLayout.visibleButtonKeys.has(ribbonButtonKey(panel, button)),
            );
            const hiddenButtons = panel.buttons.filter((button) =>
              !responsiveLayout.visibleButtonKeys.has(ribbonButtonKey(panel, button)),
            );
            return (
              <Panel
                key={panel.id}
                panel={panel}
                visibleButtons={visibleButtons}
                hiddenButtons={hiddenButtons}
                menuOpen={openPanel === panel.id}
                documentOpen={documentOpen}
                onToggleMenu={() => setOpenPanel(openPanel === panel.id ? null : panel.id)}
                onCloseMenu={() => setOpenPanel(null)}
                onAction={dispatch}
              />
            );
          })}
        </div>

        {mode === 'sketch' && (
          <div
            data-testid="finish-sketch-container"
            className="flex shrink-0 items-center px-3 max-[1400px]:px-2"
          >
            <button
              type="button"
              onClick={() => dispatchRibbonAction('exitSketch')}
              className="flex h-8 items-center gap-1.5 rounded bg-finish px-3 text-[11px] font-semibold tracking-wide text-white hover:brightness-110 max-[1400px]:px-2"
            >
              <Check size={14} strokeWidth={2.5} />
              {t('ribbon.finishSketch')}
              <ChevronDown size={11} className="opacity-70" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Workspace (Solid Modeling / Drawing) dropdown docked at the left edge of
 * the ribbon. The active project owns this stage, so the switcher lives
 * inside the ribbon rather than above the project tabs. */
function WorkspaceSwitcher({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation();
  const mode = useAppStore((s) => s.mode);
  const activeTab = useAppStore((s) => s.activeTab);
  const documentOpen = useAppStore((s) => s.document !== null);
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (anchorRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.document.addEventListener('pointerdown', onPointerDown);
    window.document.addEventListener('keydown', onKeyDown);
    return () => {
      window.document.removeEventListener('pointerdown', onPointerDown);
      window.document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const sketching = mode === 'sketch';
  const drawingActive = activeTab === 'drawing';
  const camActive = activeTab === 'cam';
  const choose = (action: RibbonAction) => {
    setOpen(false);
    dispatchRibbonAction(action);
  };

  return (
    <div
      ref={anchorRef}
      className="flex h-full w-[108px] shrink-0 flex-col border-r border-edge bg-header px-1.5 max-[1400px]:w-14 max-[1400px]:px-0"
    >
      <div className="flex h-[62px] w-full items-start pt-1.5 max-[1400px]:px-0.5">
        <button
          type="button"
          data-testid="workspace-switcher"
          aria-haspopup="menu"
          aria-expanded={open}
          title={t('workspace.switchWorkspace')}
          aria-label={t('workspace.switchWorkspace')}
          disabled={!documentOpen}
          onClick={() => {
            if (open) {
              setOpen(false);
              return;
            }
            const rect = anchorRef.current?.getBoundingClientRect();
            if (rect) {
              // Menus are portaled out of the ribbon clip; keep the root
              // inside the window like the panel flyouts do.
              setMenuPos({
                left: Math.max(8, Math.min(rect.left, window.innerWidth - 264)),
                top: rect.bottom,
              });
            }
            onOpen();
            setOpen(true);
          }}
          className="flex h-[52px] w-full min-w-0 flex-col items-center justify-center gap-0.5 rounded px-2 text-mute hover:bg-edge hover:text-ink disabled:cursor-default disabled:opacity-50 max-[1400px]:px-1"
        >
          <span className="flex h-6 items-center justify-center text-ink">
            {drawingActive ? <FileText size={20} /> : camActive ? <Wrench size={20} /> : <Box size={20} />}
          </span>
          <span
            data-testid="workspace-mode-label"
            className="flex flex-col items-center gap-0.5 text-[9px] leading-none"
          >
            <span className="flex items-center gap-0.5 whitespace-nowrap">
              <span className="max-[1400px]:hidden">
                {drawingActive
                  ? t('ribbon.tabs.drawingWorkspace')
                  : camActive
                    ? t('ribbon.tabs.camWorkspace')
                    : t('ribbon.tabs.solidModeling')}
              </span>
              <ChevronDown size={8} />
            </span>
            {sketching && (
              <span className="rounded bg-accent/15 px-1 text-[8px] font-medium text-accent max-[1400px]:hidden">
                {t('ribbon.tabs.sketch')}
              </span>
            )}
          </span>
        </button>
      </div>
      <div className="flex h-5 items-center justify-center text-[10px] tracking-wider text-mute max-[1400px]:text-[8px] max-[1400px]:tracking-normal">
        {t('ribbon.panels.workspace')}
      </div>
      {open && menuPos && createPortal(
        <div
          ref={menuRef}
          role="menu"
          data-ribbon-menu
          data-testid="workspace-menu"
          className="fixed z-[100] w-56 rounded border border-edge bg-panel py-1 shadow-xl shadow-black/50"
          style={{ left: menuPos.left, top: menuPos.top }}
        >
          <WorkspaceMenuItem
            icon={<Box size={14} />}
            label={t('ribbon.tabs.solidModeling')}
            checked={!drawingActive && !camActive}
            onClick={() => choose('modelWorkspace')}
          />
          <WorkspaceMenuItem
            icon={<FileText size={14} />}
            label={t('ribbon.tabs.drawingWorkspace')}
            checked={drawingActive}
            disabled={sketching}
            title={sketching ? 'Finish the active sketch before opening Drawings' : undefined}
            onClick={() => choose('drawingWorkspace')}
          />
          <WorkspaceMenuItem
            icon={<Wrench size={14} />}
            label={t('ribbon.tabs.camWorkspace')}
            checked={camActive}
            disabled={sketching}
            title={sketching ? 'Finish the active sketch before opening CAM' : undefined}
            onClick={() => choose('camWorkspace')}
          />
        </div>,
        window.document.body,
      )}
    </div>
  );
}

function WorkspaceMenuItem({
  icon,
  label,
  checked,
  disabled = false,
  title,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  checked: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className="flex h-8 w-full cursor-pointer items-center gap-2 px-3 text-left text-[11px] text-ink hover:bg-accent hover:text-white focus:bg-accent focus:text-white focus:outline-none disabled:pointer-events-none disabled:cursor-default disabled:opacity-40"
    >
      <span className="text-current">{icon}</span>
      <span className="flex-1">{label}</span>
      {checked && <Check size={12} />}
    </button>
  );
}

function Panel({
  panel,
  visibleButtons,
  hiddenButtons,
  menuOpen,
  documentOpen,
  onToggleMenu,
  onCloseMenu,
  onAction,
}: {
  panel: RibbonPanel;
  visibleButtons: RibbonButton[];
  hiddenButtons: RibbonButton[];
  menuOpen: boolean;
  documentOpen: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onAction: (action?: RibbonAction, payload?: string) => void;
}) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null);
  const menuEntries: MenuEntry[] | undefined = panel.menu ?? (
    hiddenButtons.length > 0
      ? hiddenButtons.map((button) => ({
        type: 'item' as const,
        id: `ribbon-overflow-${button.id}`,
        labelKey: button.labelKey,
        icon: button.icon,
        enabled: button.enabled ?? false,
        action: button.action,
        payload: button.payload,
      }))
      : undefined
  );

  const toggle = () => {
    if (!documentOpen) return;
    if (!menuOpen && panelRef.current) {
      const rect = panelRef.current.getBoundingClientRect();
      // Menus are portaled out of the ribbon clip. Keep the root inside the
      // window as well; grouped drawing flyouts can otherwise begin off-screen
      // from the right-most panels in a compact desktop window.
      setMenuPos({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 264)), top: rect.bottom });
    }
    onToggleMenu();
  };

  return (
    <div
      ref={panelRef}
      data-ribbon-panel={panel.id}
      className="relative flex shrink-0 flex-col border-r border-edge px-1"
    >
      <div className="flex h-[62px] items-start justify-center gap-0.5 pt-1.5">
        {visibleButtons.map((button) => (
          <Button
            key={button.id}
            button={button}
            documentOpen={documentOpen}
            onAction={(action, payload) => {
              // A command can be launched from the always-visible panel while
              // this (or another) panel's flyout is still open. Treat every
              // command launch as a terminal menu action so modeless feature
              // dialogs never appear underneath a stale ribbon flyout.
              onCloseMenu();
              onAction(action, payload);
            }}
          />
        ))}
      </div>
      <button
        type="button"
        disabled={!menuEntries || !documentOpen}
        onClick={menuEntries ? toggle : undefined}
        className={cx(
          'flex h-5 w-full items-center justify-center gap-0.5 text-[10px] tracking-wider',
          menuEntries && documentOpen
            ? 'text-mute hover:text-ink'
            : 'cursor-default text-mute/40',
          menuOpen && 'text-ink',
        )}
      >
        {t(panel.labelKey)}
        {menuEntries && <ChevronDown size={10} />}
      </button>

      {menuOpen &&
        menuEntries &&
        menuPos &&
        createPortal(
          <div data-ribbon-menu className="fixed z-50" style={{ left: menuPos.left, top: menuPos.top }}>
            <RibbonMenu
              entries={menuEntries}
              onClose={onCloseMenu}
              submenuSide={menuPos.left + 256 + 240 > window.innerWidth - 8 ? 'left' : 'right'}
            />
          </div>,
          window.document.body,
        )}
    </div>
  );
}

function Button({
  button,
  documentOpen,
  onAction,
}: {
  button: RibbonButton;
  documentOpen: boolean;
  onAction: (action?: RibbonAction, payload?: string) => void;
}) {
  const { t } = useTranslation();
  const drawingSheetReady = useAppStore((s) => {
    const activeSheetExists = s.drawingDocument.active_sheet_id !== null
      && s.drawingDocument.sheets.some((sheet) => sheet.id === s.drawingDocument.active_sheet_id);
    return activeSheetExists && !s.drawingSheetSetupOpen;
  });
  const requiresDrawingSheet = button.action === 'drawingAutoLayout'
    || button.action === 'drawingAddView'
    || button.action === 'drawingTool'
    || button.action === 'drawingExportDxf'
    || button.action === 'drawingPrint';
  const enabled = documentOpen
    && (button.enabled ?? false)
    && (!requiresDrawingSheet || drawingSheetReady);
  // Drawing-tool buttons show the active-tool state.
  const toolActive = useAppStore(
    (s) =>
      (button.action === 'sketchTool' && s.activeTool === button.payload)
      || (button.action === 'drawingTool' && s.drawingTool === button.payload)
      || (
        button.action === 'drawingAddView'
        && s.drawingTool === 'place_view'
        && s.drawingPendingViewKind === button.payload
      ),
  );
  // Keep the standard command-cell width consistent. These two constraint
  // names need one modestly wider cell so their complete localized labels can
  // remain legible without introducing an ellipsis or a third line.
  const widthClass = button.id === 'horizontalVertical' || button.id === 'perpendicular'
    ? 'w-14'
    : 'w-12';
  const label = t(button.labelKey);
  return (
    <button
      type="button"
      data-ribbon-button={button.id}
      title={t(button.labelKey)}
      disabled={!enabled}
      onClick={enabled ? () => onAction(button.action, button.payload) : undefined}
      className={cx(
        'flex h-[52px] shrink-0 flex-col items-center rounded pt-1',
        widthClass,
        enabled
          ? 'cursor-pointer text-ink hover:bg-edge'
          : 'cursor-not-allowed text-mute/40',
        toolActive && 'bg-accent/25 hover:bg-accent/30',
      )}
    >
      <span className="flex h-6 shrink-0 items-center justify-center">
        <ToolIcon
          id={button.icon}
          size={22}
          tone={CONSTRAINT_ICON_IDS.has(button.icon) ? 'constraint' : undefined}
        />
      </span>
      <span
        data-ribbon-button-label
        className="grid h-6 w-full place-items-center text-center text-[8px] leading-[8px] text-mute"
      >
        <span className="max-w-full whitespace-normal">
          {label.split('/').map((part, index) => (
            <Fragment key={`${button.id}-${index}`}>
              {index > 0 && <><span>/</span><wbr /></>}
              {part}
            </Fragment>
          ))}
        </span>
      </span>
    </button>
  );
}
