/** Project controls embedded as the first command-ribbon panel, plus the
 * active project tab rendered directly below that ribbon. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
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
import { NavigationDiagnosticsControl } from './NavigationDiagnosticsControl';

export function AppMenuControls() {
  const { t } = useTranslation();
  const document = useAppStore((s) => s.document);
  const selectedBody = useAppStore((s) => s.selectedBody);
  const bodyCount = useAppStore((s) => s.solidScene.bodies.length);
  const modelBusy = useAppStore((s) => s.solidBusy);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const interactionBusy = busy || modelBusy;

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menuOpen]);

  const run = (action: () => Promise<unknown>) => {
    setMenuOpen(false);
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

  const openSettings = () => {
    setMenuOpen(false);
    setSettingsOpen(true);
  };

  return (
    <div
      data-tauri-drag-region
      data-testid="app-menu-controls"
      className="flex h-full shrink-0 flex-col border-r border-edge bg-header pr-1.5"
    >
      <div className="flex h-[62px] items-start gap-0.5 pt-1.5">
        <div ref={menuRef} className="relative">
          <button
            type="button"
            data-testid="file-menu-button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            disabled={interactionBusy}
            onClick={() => setMenuOpen((open) => !open)}
            className="flex h-[52px] w-11 flex-col items-center justify-center gap-0.5 rounded text-mute hover:bg-edge hover:text-ink disabled:opacity-50"
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
          {menuOpen && (
            <div
              role="menu"
              data-testid="file-menu"
              data-native-viewport-overlay
              className="absolute left-0 top-[86px] z-50 w-64 rounded border border-edge bg-panel py-1 shadow-xl shadow-black/50"
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
              <div className="my-1 border-t border-edge" />
              <FileMenuItem
                icon={<SlidersHorizontal size={14} />}
                label={t('topbar.settings')}
                onClick={openSettings}
              />
              <div className="mt-1 border-t border-edge px-3 pb-1 pt-2 text-[9px] leading-relaxed text-mute">
                {t('file.zipHint')}
              </div>
            </div>
          )}
        </div>

        <button
          type="button"
          title={t('topbar.newDesign')}
          aria-label={t('topbar.newDesign')}
          disabled={interactionBusy}
          onClick={() => run(newProject)}
          className="flex h-[52px] w-11 flex-col items-center justify-center gap-0.5 rounded text-mute hover:bg-edge hover:text-ink disabled:cursor-wait disabled:opacity-50"
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
  const modelBusy = useAppStore((s) => s.solidBusy);
  const [busy, setBusy] = useState(false);
  const docName = document?.name ?? t('app.untitledDocument');
  const interactionBusy = busy || modelBusy;

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
      className="flex h-7 shrink-0 items-stretch border-b border-edge bg-panel"
    >
      {document !== null && (
        <div className="flex min-w-48 max-w-72 items-center gap-1.5 border-r border-t-2 border-edge border-t-accent bg-header px-3 text-xs text-ink">
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
              dirty ? 'bg-[#e8963c]' : 'bg-mute/40'
            }`}
            title={dirty ? t('file.unsaved') : t('file.saved')}
          />
          <button
            type="button"
            data-testid="project-title"
            title={`${projectFileName ?? docName} — ${t('file.renameHint')}`}
            aria-label={t('file.rename')}
            disabled={interactionBusy}
            onDoubleClick={() => run(renameProject)}
            className="min-w-0 flex-1 truncate rounded px-1 text-left hover:bg-edge disabled:pointer-events-none"
          >
            {docName}
          </button>
          <button
            type="button"
            title={t('topbar.closeDocument')}
            aria-label={t('topbar.closeDocument')}
            disabled={interactionBusy}
            onClick={() => run(closeProject)}
            className="shrink-0 rounded p-0.5 text-mute hover:bg-edge hover:text-ink disabled:cursor-wait disabled:opacity-50"
          >
            <X size={11} />
          </button>
        </div>
      )}
      <NavigationDiagnosticsControl />
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
