/**
 * Ribbon: data-driven panels of icon buttons with dropdown panel menus,
 * driven by src/ribbon/config.ts. In sketch mode a green FINISH SKETCH
 * button docks on the right.
 *
 * Dropdown menus are PORTALED to document.body: the panels row uses
 * `overflow-x-auto` for narrow windows, and CSS computes overflow-y to
 * auto in that case — an in-tree dropdown would be clipped to the 92 px
 * ribbon box (in the DOM but invisible). Fixed-position portal menus
 * escape the clip; `data-ribbon-menu` marks them so the outside-pointer
 * closer doesn't treat menu clicks as outside clicks.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Box, Check, ChevronDown, FileText } from 'lucide-react';
import { useTranslation } from '../i18n';
import { cx } from '../lib/cx';
import { ribbonTabById, type RibbonAction, type RibbonButton, type RibbonPanel } from '../ribbon/config';
import { dispatchRibbonAction } from '../ribbon/dispatch';
import { useAppStore } from '../store/appStore';
import { CONSTRAINT_ICON_IDS, ToolIcon } from './icons';
import { RibbonMenu } from './RibbonMenu';
import { AppMenuControls } from './TopBar';

export function Ribbon() {
  const { t } = useTranslation();
  const mode = useAppStore((s) => s.mode);
  const activeTab = useAppStore((s) => s.activeTab);
  const documentOpen = useAppStore((s) => s.document !== null);
  const [openPanel, setOpenPanel] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

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
  const dispatch = (action?: RibbonAction, payload?: string) => dispatchRibbonAction(action, payload);

  return (
    <div
      ref={rootRef}
      className="relative flex h-[122px] w-full min-w-0 shrink-0 flex-col overflow-hidden"
    >
      <nav
        aria-label="Application workspace"
        className="flex h-[30px] shrink-0 items-end gap-1 border-b border-edge bg-panel px-2"
      >
        <span className="mb-1.5 mr-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-mute/70">Workspace</span>
        <WorkspaceButton
          active={activeTab === 'solid' || activeTab === 'sketch'}
          disabled={!documentOpen}
          icon={<Box size={13} />}
          label={t('ribbon.tabs.solidModeling')}
          detail={mode === 'sketch' ? t('ribbon.tabs.sketch') : undefined}
          onClick={() => dispatchRibbonAction('modelWorkspace')}
        />
        <WorkspaceButton
          active={activeTab === 'drawing'}
          disabled={!documentOpen || mode === 'sketch'}
          icon={<FileText size={13} />}
          label={t('ribbon.tabs.drawingWorkspace')}
          title={mode === 'sketch' ? 'Finish the active sketch before opening Drawings' : undefined}
          onClick={() => dispatchRibbonAction('drawingWorkspace')}
        />
      </nav>
      <div
        data-testid="ribbon-tools"
        className="flex h-[92px] min-w-0 shrink-0 items-stretch border-b border-edge bg-header"
      >
        <AppMenuControls />
        <div
          data-testid="ribbon-command-scroll"
          className="flex min-w-0 flex-1 items-stretch overflow-x-auto overscroll-x-contain"
        >
          {tab.panels.map((panel) => (
            <Panel
              key={panel.id}
              panel={panel}
              menuOpen={openPanel === panel.id}
              documentOpen={documentOpen}
              onToggleMenu={() => setOpenPanel(openPanel === panel.id ? null : panel.id)}
              onCloseMenu={() => setOpenPanel(null)}
              onAction={dispatch}
            />
          ))}
        </div>

        {mode === 'sketch' && (
          <div className="flex shrink-0 items-center border-l border-edge px-3 max-[1400px]:px-2">
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

function WorkspaceButton({
  active,
  disabled,
  icon,
  label,
  detail,
  title,
  onClick,
}: {
  active: boolean;
  disabled: boolean;
  icon: ReactNode;
  label: string;
  detail?: string;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={cx(
        'relative flex h-[27px] items-center gap-1.5 rounded-t px-3 text-[10px] font-semibold transition-colors',
        active
          ? 'bg-header text-ink after:absolute after:inset-x-0 after:bottom-[-1px] after:h-px after:bg-header'
          : 'text-mute hover:bg-edge/50 hover:text-ink',
        disabled && 'cursor-not-allowed opacity-40',
      )}
    >
      {icon}
      <span>{label}</span>
      {detail && <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[8px] font-medium text-accent">{detail}</span>}
      {active && <span className="absolute inset-x-2 top-0 h-0.5 rounded-full bg-accent" />}
    </button>
  );
}

function Panel({
  panel,
  menuOpen,
  documentOpen,
  onToggleMenu,
  onCloseMenu,
  onAction,
}: {
  panel: RibbonPanel;
  menuOpen: boolean;
  documentOpen: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onAction: (action?: RibbonAction, payload?: string) => void;
}) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null);

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
      className="relative flex shrink-0 flex-col border-r border-edge px-1.5 max-[1400px]:px-0.5"
    >
      <div className={cx(
        'flex h-[62px] items-start gap-0.5 pt-1.5',
        panel.id === 'dimensions' && 'justify-center',
      )}>
        {panel.buttons.map((button) => (
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
        disabled={!panel.menu || !documentOpen}
        onClick={panel.menu ? toggle : undefined}
        className={cx(
          'flex h-5 items-center justify-center gap-0.5 text-[10px] tracking-wider',
          panel.menu && documentOpen
            ? 'text-mute hover:text-ink'
            : 'cursor-default text-mute/40',
          menuOpen && 'text-ink',
        )}
      >
        {t(panel.labelKey)}
        {panel.menu && <ChevronDown size={10} />}
      </button>

      {menuOpen &&
        panel.menu &&
        menuPos &&
        createPortal(
          <div data-ribbon-menu className="fixed z-50" style={{ left: menuPos.left, top: menuPos.top }}>
            <RibbonMenu
              entries={panel.menu}
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
  const widthClass =
    button.action?.startsWith('drawing')
      ? 'w-12'
      : button.id === 'patternRectangular'
        ? 'w-14 max-[1400px]:w-12'
      : button.id === 'sectionAnalysis'
        ? 'w-11 max-[1400px]:w-10'
      : button.id === 'perpendicular'
      ? 'w-14 max-[1400px]:w-10'
      : button.id === 'sketchDimension'
          || button.id === 'drawingDimension'
          || button.id === 'horizontalVertical'
        ? 'w-12 max-[1400px]:w-10'
        : 'w-11 max-[1400px]:w-9';

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
        className="flex h-5 w-full items-center justify-center whitespace-normal break-words text-center text-[9px] leading-[9px] text-mute [overflow-wrap:anywhere]"
      >
        {t(button.labelKey)}
      </span>
    </button>
  );
}
