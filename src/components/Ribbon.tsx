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
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
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
    window.document.addEventListener('pointerdown', onPointerDown);
    return () => window.document.removeEventListener('pointerdown', onPointerDown);
  }, [openPanel]);

  const tab = ribbonTabById(activeTab);
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
      setMenuPos({ left: rect.left, top: rect.bottom });
    }
    onToggleMenu();
  };

  return (
    <div
      ref={panelRef}
      className="relative flex shrink-0 flex-col border-r border-edge px-1.5 max-[1400px]:px-1"
    >
      <div className="flex h-[62px] items-start gap-0.5 pt-1.5">
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
            <RibbonMenu entries={panel.menu} onClose={onCloseMenu} />
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
  const enabled = documentOpen && (button.enabled ?? false);
  // Drawing-tool buttons show the active-tool state.
  const toolActive = useAppStore(
    (s) => button.action === 'sketchTool' && s.activeTool === button.payload,
  );
  const widthClass =
    button.id === 'patternRectangular' || button.id === 'perpendicular'
      ? 'w-14 max-[1400px]:w-10'
      : button.id === 'sketchDimension' || button.id === 'horizontalVertical'
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
