/** Project controls embedded as the first command-ribbon panel, plus the
 * active project tab rendered directly below that ribbon. */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import {
  Box,
  ChevronDown,
  FileDown,
  FileUp,
  FolderOpen,
  Pencil,
  Plus,
  Save,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { useTranslation } from '../i18n';
import {
  closeProject,
  export3mf,
  exportStep,
  exportStl,
  importStep,
  newProject,
  openProject,
  renameProject,
  saveProject,
} from '../files/projectFiles';
import { useAppStore } from '../store/appStore';
import { switchProjectTab } from '../files/projectTabs';
import { exportActiveDrawingDxf } from '../drawing/export';
import { requestNativeViewportLayout } from './viewport/nativeViewportBridge';

const FILE_MENU_VIEWPORT_MARGIN = 6;
const FILE_MENU_FALLBACK_WIDTH = 256;

interface FileMenuPosition {
  left: number;
  top: number;
  maxHeight: number;
}

export function AppMenuControls() {
  const { t } = useTranslation();
  const document = useAppStore((s) => s.document);
  const selectedBody = useAppStore((s) => s.selectedBody);
  const bodyCount = useAppStore((s) => s.solidScene.bodies.length);
  const drawingWorkspace = useAppStore((s) => s.activeTab === 'drawing');
  const drawingSheetReady = useAppStore((s) => s.drawingDocument.active_sheet_id !== null
    && s.drawingDocument.sheets.some((sheet) => sheet.id === s.drawingDocument.active_sheet_id)
    && !s.drawingSheetSetupOpen);
  const modelBusy = useAppStore((s) => s.solidBusy);
  const projectBusy = useAppStore((s) => s.projectBusy);
  const setProjectBusy = useAppStore((s) => s.setProjectBusy);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const setDrawingProfileExportOpen = useAppStore((s) => s.setDrawingProfileExportOpen);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<FileMenuPosition | null>(null);
  const [busy, setBusy] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const interactionBusy = busy || modelBusy || projectBusy;

  const updateMenuPosition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const anchorRect = anchor.getBoundingClientRect();
    const menuWidth = menuRef.current?.getBoundingClientRect().width
      ?? FILE_MENU_FALLBACK_WIDTH;
    const left = Math.max(
      FILE_MENU_VIEWPORT_MARGIN,
      Math.min(
        anchorRect.left,
        window.innerWidth - menuWidth - FILE_MENU_VIEWPORT_MARGIN,
      ),
    );
    const top = Math.max(
      FILE_MENU_VIEWPORT_MARGIN,
      Math.min(
        anchorRect.bottom,
        window.innerHeight - FILE_MENU_VIEWPORT_MARGIN - 40,
      ),
    );
    const next = {
      left,
      top,
      maxHeight: Math.max(40, window.innerHeight - top - FILE_MENU_VIEWPORT_MARGIN),
    };
    setMenuPosition((current) => (
      current
      && current.left === next.left
      && current.top === next.top
      && current.maxHeight === next.maxHeight
        ? current
        : next
    ));
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !anchorRef.current?.contains(target)
        && !menuRef.current?.contains(target)
      ) {
        setMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setMenuOpen(false);
      window.requestAnimationFrame(() => menuButtonRef.current?.focus());
    };
    window.document.addEventListener('pointerdown', close);
    window.document.addEventListener('keydown', closeOnEscape);
    return () => {
      window.document.removeEventListener('pointerdown', close);
      window.document.removeEventListener('keydown', closeOnEscape);
    };
  }, [menuOpen]);

  useLayoutEffect(() => {
    if (!menuOpen) return;
    updateMenuPosition();
    // The Bevy surface is a native sibling beneath WebKit. Cut the freshly
    // mounted menu out of that surface before the browser paints it.
    requestNativeViewportLayout();
    const frame = window.requestAnimationFrame(updateMenuPosition);
    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(updateMenuPosition);
    if (anchorRef.current) observer?.observe(anchorRef.current);
    if (menuRef.current) observer?.observe(menuRef.current);
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [menuOpen, updateMenuPosition]);

  useLayoutEffect(() => {
    if (menuOpen && menuPosition) requestNativeViewportLayout();
  }, [menuOpen, menuPosition]);

  const run = (action: () => Promise<unknown>) => {
    if (useAppStore.getState().projectBusy) return;
    setMenuOpen(false);
    setBusy(true);
    setProjectBusy(true);
    void action()
      .catch((error) => {
        useAppStore.getState().setConstraintDialog({
          titleKey: 'file.errorTitle',
          message: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        setBusy(false);
        useAppStore.getState().setProjectBusy(false);
      });
  };

  const openSettings = () => {
    setMenuOpen(false);
    setSettingsOpen(true);
  };

  return (
    <div
      ref={anchorRef}
      data-tauri-drag-region
      data-testid="app-menu-controls"
      className="flex h-full shrink-0 flex-col border-r border-edge bg-header pr-1.5"
    >
      <div className="flex h-[62px] items-start gap-0.5 pt-1.5">
        <div className="relative">
          <button
            ref={menuButtonRef}
            type="button"
            data-testid="file-menu-button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            disabled={interactionBusy}
            onClick={() => {
              if (menuOpen) {
                setMenuOpen(false);
                return;
              }
              updateMenuPosition();
              setMenuOpen(true);
            }}
            className="flex h-[52px] w-11 flex-col items-center justify-center gap-0.5 rounded text-mute hover:bg-edge hover:text-ink disabled:opacity-50 max-[1400px]:w-10"
          >
            <div
              data-testid="product-mark"
              title={t('app.name')}
              aria-label={t('app.name')}
              className="flex h-6 w-7 shrink-0 items-center justify-center rounded-md border border-accent/40 bg-accent/10 font-mono text-[9px] font-black tracking-[-0.08em] text-accent"
            >
              NB
            </div>
            <span className="flex items-center gap-0.5 text-[9px] leading-tight">
              {busy ? t('file.working') : t('file.menu')}
              <ChevronDown size={8} />
            </span>
          </button>
          {menuOpen && menuPosition && createPortal(
            <div
              ref={menuRef}
              role="menu"
              data-testid="file-menu"
              data-native-viewport-overlay
              className="fixed z-[100] w-64 overflow-y-auto rounded border border-edge bg-panel py-1 shadow-xl shadow-black/50"
              style={{
                left: menuPosition.left,
                top: menuPosition.top,
                maxHeight: menuPosition.maxHeight,
              }}
            >
              <FileMenuItem
                icon={<FolderOpen size={14} />}
                label={t('file.open')}
                shortcut="⌘O"
                onClick={() => run(openProject)}
              />
              <FileMenuItem
                icon={<Save size={14} />}
                label={t('file.save')}
                shortcut="⌘S"
                disabled={document === null}
                onClick={() => run(() => saveProject(false))}
              />
              <FileMenuItem
                icon={<FileDown size={14} />}
                label={t('file.saveAs')}
                shortcut="⇧⌘S"
                disabled={document === null}
                onClick={() => run(() => saveProject(true))}
              />
              <FileMenuItem
                icon={<Pencil size={14} />}
                label={t('file.rename')}
                disabled={document === null}
                onClick={() => run(renameProject)}
              />
              <div className="my-1 border-t border-edge" />
              <FileMenuItem
                icon={<FileUp size={14} />}
                label={t('file.importStep')}
                disabled={document === null}
                onClick={() => run(importStep)}
              />
              <div className="my-1 border-t border-edge" />
              <FileMenuItem
                icon={<Box size={14} />}
                label={t('file.exportStepAll')}
                disabled={bodyCount === 0}
                onClick={() => run(() => exportStep(false))}
              />
              <FileMenuItem
                icon={<Box size={14} />}
                label={t('file.exportStepSelected')}
                disabled={selectedBody === null}
                onClick={() => run(() => exportStep(true))}
              />
              <FileMenuItem
                icon={<FileDown size={14} />}
                label={t('file.export3mfAll')}
                disabled={bodyCount === 0}
                onClick={() => run(() => export3mf(false))}
              />
              <FileMenuItem
                icon={<FileDown size={14} />}
                label={t('file.export3mfSelected')}
                disabled={selectedBody === null}
                onClick={() => run(() => export3mf(true))}
              />
              <FileMenuItem
                icon={<FileDown size={14} />}
                label={t('file.exportStlAll')}
                disabled={bodyCount === 0}
                onClick={() => run(() => exportStl(false))}
              />
              <FileMenuItem
                icon={<FileDown size={14} />}
                label={t('file.exportStlSelected')}
                disabled={selectedBody === null}
                onClick={() => run(() => exportStl(true))}
              />
              {drawingWorkspace && (
                <>
                  <FileMenuItem
                    icon={<FileDown size={14} />}
                    label={t('file.exportDrawingDxf')}
                    disabled={!drawingSheetReady}
                    onClick={() => run(exportActiveDrawingDxf)}
                  />
                  <FileMenuItem
                    icon={<FileDown size={14} />}
                    label={t('file.exportManufacturingProfileDxf')}
                    onClick={() => {
                      setMenuOpen(false);
                      setDrawingProfileExportOpen(true);
                    }}
                  />
                </>
              )}
              <div className="my-1 border-t border-edge" />
              <FileMenuItem
                icon={<SlidersHorizontal size={14} />}
                label={t('topbar.settings')}
                onClick={openSettings}
              />
              <div className="mt-1 border-t border-edge px-3 pb-1 pt-2 text-[9px] leading-relaxed text-mute">
                {t('file.zipHint')}
              </div>
            </div>,
            window.document.body,
          )}
        </div>

        <button
          type="button"
          title={t('topbar.newDesign')}
          aria-label={t('topbar.newDesign')}
          disabled={interactionBusy}
          onClick={() => run(newProject)}
          className="flex h-[52px] w-11 flex-col items-center justify-center gap-0.5 rounded text-mute hover:bg-edge hover:text-ink disabled:cursor-wait disabled:opacity-50 max-[1400px]:w-10"
        >
          <Plus size={22} />
          <span className="text-[9px] leading-tight">{t('file.new')}</span>
        </button>
      </div>

      <div className="flex h-5 items-center justify-center text-[10px] tracking-wider text-mute">
        {t('file.panel')}
      </div>
    </div>
  );
}

export function ProjectTabBar() {
  const { t } = useTranslation();
  const document = useAppStore((s) => s.document);
  const dirty = useAppStore((s) => s.dirty);
  const projectFileName = useAppStore((s) => s.projectFileName);
  const projectTabs = useAppStore((s) => s.projectTabs);
  const activeProjectTabId = useAppStore((s) => s.activeProjectTabId);
  const modelBusy = useAppStore((s) => s.solidBusy);
  const projectBusy = useAppStore((s) => s.projectBusy);
  const [busy, setBusy] = useState(false);
  const activeTabRef = useRef<HTMLDivElement>(null);
  const interactionBusy = busy || modelBusy || projectBusy;

  useEffect(() => {
    activeTabRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'nearest',
    });
  }, [activeProjectTabId]);

  const run = (action: () => Promise<unknown>) => {
    setBusy(true);
    void action()
      .catch((error) => {
        useAppStore.getState().setConstraintDialog({
          titleKey: 'file.errorTitle',
          message: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => setBusy(false));
  };

  return (
    <div
      data-testid="project-tabs"
      data-tauri-drag-region
      data-native-viewport-overlay
      role="tablist"
      aria-label={t('file.openDocuments')}
      className="project-tab-scroll flex h-7 shrink-0 items-stretch overflow-x-auto overflow-y-hidden border-b border-edge bg-panel"
    >
      {projectTabs.map((tab, index) => {
        const active = tab.id === activeProjectTabId;
        const docName = active
          ? document?.name ?? tab.name
          : tab.name;
        const tabDirty = active ? dirty : tab.dirty;
        const fileName = active ? projectFileName : tab.fileName;
        const closeLabel = active
          ? t('topbar.closeDocument')
          : `${t('topbar.closeDocument')}: ${docName}`;
        const switchRelative = (offset: number) => {
          const target = projectTabs[index + offset];
          if (target) run(() => switchProjectTab(target.id));
        };
        return (
          <div
            key={tab.id}
            ref={active ? activeTabRef : undefined}
            data-project-tab-id={tab.id}
            className={`flex min-w-48 max-w-72 shrink-0 items-center gap-1.5 border-r border-t-2 border-edge px-3 text-xs text-ink ${
              active
                ? 'border-t-accent bg-header'
                : 'border-t-transparent bg-panel text-mute hover:bg-header'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                tabDirty ? 'bg-[#e8963c]' : 'bg-mute/40'
              }`}
              title={tabDirty ? t('file.unsaved') : t('file.saved')}
            />
            <button
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              data-testid={active ? 'project-title' : 'project-tab'}
              title={`${fileName ?? docName}${active ? ` — ${t('file.renameHint')}` : ''}`}
              disabled={interactionBusy}
              onClick={() => {
                if (!active) run(() => switchProjectTab(tab.id));
              }}
              onDoubleClick={() => {
                if (active) run(renameProject);
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowLeft') {
                  event.preventDefault();
                  switchRelative(-1);
                } else if (event.key === 'ArrowRight') {
                  event.preventDefault();
                  switchRelative(1);
                }
              }}
              className="min-w-0 flex-1 truncate rounded px-1 text-left hover:bg-edge disabled:pointer-events-none"
            >
              {docName}
            </button>
            <button
              type="button"
              title={closeLabel}
              aria-label={closeLabel}
              disabled={interactionBusy}
              onClick={() => run(() => closeProject(tab.id))}
              className="shrink-0 rounded p-0.5 text-mute hover:bg-edge hover:text-ink disabled:cursor-wait disabled:opacity-50"
            >
              <X size={11} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function FileMenuItem({
  icon,
  label,
  shortcut,
  disabled = false,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className="flex h-8 w-full cursor-pointer items-center gap-2 px-3 text-left text-[11px] text-ink hover:bg-accent hover:text-white focus:bg-accent focus:text-white focus:outline-none disabled:pointer-events-none disabled:cursor-default disabled:opacity-40"
    >
      <span className="text-current">{icon}</span>
      <span className="flex-1">{label}</span>
      {shortcut && <span className="text-[10px] opacity-60">{shortcut}</span>}
    </button>
  );
}
