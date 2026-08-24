import {
  Ban,
  Box,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Layers3,
  Pencil,
  Play,
  Plus,
  Route,
  ScanLine,
  Square,
  Trash2,
  Triangle,
  Wrench,
} from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  camOperationLabel,
  deleteCamOperation,
  deleteCamSetup,
  setActiveCamSetup,
  updateCamOperation,
} from '../../cam/document';
import type { CamDocumentDto, CamOperationDto, CamToolDto } from '../../engine/types';
import { useAppStore } from '../../store/appStore';

const CAM_SETUPS_HEIGHT_KEY = 'cam-setups-panel-height';

/** Manufacturing section docked under the shared modeling browser. The tree
 *  above stays the modeling browser; this panel adds only what the
 *  manufacturing workspace owns: setups with their operations, and the entry
 *  point to the tool library (a separate dialog, not a browser node). In the
 *  manufacturing tab this is the primary tree, so it opens tall and the top
 *  edge drags to resize (height persists per machine). */
export function CamSetupsPanel() {
  const cam = useAppStore((state) => state.camDocument);
  const selectedOperationId = useAppStore((state) => state.selectedCamOperationId);
  const selectSetup = useAppStore((state) => state.setSelectedCamSetupId);
  const selectOperation = useAppStore((state) => state.setSelectedCamOperationId);
  const openDialog = useAppStore((state) => state.setCamDialog);
  const [height, setHeight] = useState(() => {
    const saved = Number(localStorage.getItem(CAM_SETUPS_HEIGHT_KEY));
    return Number.isFinite(saved) && saved >= 140 ? saved : 340;
  });
  const sectionRef = useRef<HTMLElement | null>(null);
  /** Right-click context menu on an operation row: suppress/resume, edit,
   *  delete. Position is clamped when rendered. */
  const [opMenu, setOpMenu] = useState<{ x: number; y: number; operationId: number } | null>(null);

  useEffect(() => {
    if (!opMenu) return;
    const closeMenu = () => setOpMenu(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };
    window.addEventListener('pointerdown', closeMenu);
    window.addEventListener('blur', closeMenu);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', closeMenu);
      window.removeEventListener('blur', closeMenu);
      window.removeEventListener('keydown', onKey);
    };
  }, [opMenu]);

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = height;
    let current = startHeight;
    const onMove = (move: PointerEvent) => {
      const parent = sectionRef.current?.parentElement;
      const max = parent ? parent.clientHeight * 0.8 : 720;
      current = Math.min(max, Math.max(140, startHeight + (startY - move.clientY)));
      setHeight(current);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      localStorage.setItem(CAM_SETUPS_HEIGHT_KEY, String(Math.round(current)));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  };

  return (
    <section
      ref={sectionRef}
      data-testid="cam-setups-panel"
      style={{ height }}
      className="relative flex shrink-0 flex-col border-t border-edge bg-panel"
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        title="Drag to resize the setups panel"
        onPointerDown={startDrag}
        className="absolute -top-1 left-0 right-0 z-10 h-2 cursor-row-resize"
      />
      <header className="flex h-7 shrink-0 items-center justify-between border-b border-edge px-2">
        <span className="flex items-center gap-1.5 text-[10px] font-semibold tracking-widest text-mute">
          <Layers3 size={12} />
          SETUPS
        </span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            title="Open the tool library"
            onClick={() => openDialog({ type: 'tool', toolId: null })}
            className="rounded p-1 text-mute hover:bg-edge hover:text-ink"
          >
            <Wrench size={13} />
          </button>
          <button
            type="button"
            title="New setup (manual WCS/stock configuration)"
            onClick={() => openDialog({ type: 'setup' })}
            className="rounded p-1 text-mute hover:bg-edge hover:text-ink"
          >
            <Plus size={14} />
          </button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {cam.setups.map((setup) => {
          const active = setup.id === cam.active_setup_id;
          return (
            <section key={setup.id}>
              <div
                className={`flex h-7 items-center gap-1.5 px-2 ${active ? 'bg-accent/18' : ''}`}
                onDoubleClick={() => {
                  runCamAction(() => setActiveCamSetup(setup.id));
                  openDialog({ type: 'setupEdit' });
                }}
                title="Double-click to edit the setup configuration"
              >
                <button
                  type="button"
                  onClick={() => runCamAction(() => setActiveCamSetup(setup.id))}
                  className={`flex min-w-0 flex-1 items-center gap-1.5 text-left ${
                    active ? 'text-ink' : 'text-mute hover:text-ink'
                  }`}
                >
                  {active ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  <span className="min-w-0 flex-1 truncate text-[12px]">{setup.name}</span>
                  <span className="font-mono text-[9px] uppercase text-mute/70">
                    {setup.work_offset}
                  </span>
                </button>
                <button
                  type="button"
                  title="Delete setup and its operations"
                  onClick={() => runCamAction(() => deleteCamSetup(setup.id))}
                  className="rounded p-0.5 text-mute/50 hover:text-warn"
                >
                  <Trash2 size={12} />
                </button>
              </div>
              {active && (
                <div className="pb-1">
                  <button
                    type="button"
                    onClick={() => {
                      selectSetup(setup.id);
                      selectOperation(null);
                    }}
                    onDoubleClick={() => openDialog({ type: 'setupEdit' })}
                    title="Stock, WCS, and work offsets — double-click to edit"
                    className={`flex h-7 w-full items-center gap-2 pl-8 pr-2 text-left text-[11px] ${
                      selectedOperationId === null
                        ? 'bg-accent/20 text-ink'
                        : 'text-mute hover:bg-edge/40 hover:text-ink'
                    }`}
                  >
                    <Box size={12} />
                    <span>Stock &amp; WCS</span>
                  </button>
                  {setup.operations.map((operation) => (
                    <button
                      key={operation.id}
                      type="button"
                      onClick={() => {
                        selectSetup(setup.id);
                        selectOperation(operation.id);
                      }}
                      onDoubleClick={() => {
                        selectSetup(setup.id);
                        selectOperation(operation.id);
                        openDialog({ type: 'operationEdit', operationId: operation.id });
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        selectSetup(setup.id);
                        selectOperation(operation.id);
                        setOpMenu({ x: event.clientX, y: event.clientY, operationId: operation.id });
                      }}
                      title="Double-click to edit, right-click for more"
                      className={`flex h-7 w-full items-center gap-2 pl-8 pr-2 text-left text-[11px] ${
                        selectedOperationId === operation.id
                          ? 'bg-accent/25 text-ink'
                          : 'text-mute hover:bg-edge/40 hover:text-ink'
                      } ${operation.enabled ? '' : 'opacity-45'}`}
                    >
                      <OperationIcon kind={operation.kind} />
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-mono text-accent/80">
                          [{toolTag(cam, operation)}]
                        </span>{' '}
                        {operation.name}
                        {!operation.enabled && (
                          <span className="ml-1 text-[8px] uppercase tracking-wider text-warn/80">
                            suppressed
                          </span>
                        )}
                      </span>
                      <span className="text-[8px] uppercase opacity-60">
                        {camOperationLabel(operation.kind)}
                      </span>
                    </button>
                  ))}
                  {setup.operations.length === 0 && (
                    <div className="px-8 py-2 text-[10px] italic text-mute/70">
                      No operations — program one from the ribbon.
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}
        {cam.setups.length === 0 && (
          <div className="px-4 py-4 text-center text-[11px] text-mute">
            Create a setup to begin. You choose the WCS, stock, and every operation yourself.
          </div>
        )}
      </div>
      {opMenu &&
        (() => {
          const operation = cam.setups
            .flatMap((setup) => setup.operations)
            .find((candidate) => candidate.id === opMenu.operationId);
          if (!operation) return null;
          const itemClass =
            'flex h-7 w-full items-center gap-2 px-3 text-left text-[11px] text-mute hover:bg-edge/40 hover:text-ink';
          const close = () => setOpMenu(null);
          return (
            <div
              role="menu"
              className="fixed z-[90] w-48 rounded border border-edge bg-panel py-1 shadow-2xl"
              style={{
                left: Math.min(opMenu.x, window.innerWidth - 200),
                top: Math.min(opMenu.y, window.innerHeight - 130),
              }}
              onPointerDown={(event) => event.stopPropagation()}
              onContextMenu={(event) => event.preventDefault()}
            >
              <button
                type="button"
                className={itemClass}
                onClick={() => {
                  close();
                  runCamAction(() =>
                    updateCamOperation(operation.id, (next) => {
                      next.enabled = !operation.enabled;
                    }),
                  );
                }}
              >
                {operation.enabled ? <Ban size={12} /> : <Play size={12} />}
                {operation.enabled ? 'Suppress (skip in post)' : 'Resume'}
              </button>
              <button
                type="button"
                className={itemClass}
                onClick={() => {
                  close();
                  openDialog({ type: 'operationEdit', operationId: operation.id });
                }}
              >
                <Pencil size={12} /> Edit…
              </button>
              <div className="my-1 border-t border-edge/60" />
              <button
                type="button"
                className={`${itemClass} hover:text-warn`}
                onClick={() => {
                  close();
                  runCamAction(() => deleteCamOperation(operation.id));
                }}
              >
                <Trash2 size={12} /> Delete
              </button>
            </div>
          );
        })()}
      <button
        type="button"
        title="Central library by default; switch to this project's snapshots inside"
        onClick={() => openDialog({ type: 'tool', toolId: null })}
        className="flex h-8 shrink-0 items-center gap-2 border-t border-edge px-3 text-[11px] text-mute hover:bg-edge/40 hover:text-ink"
      >
        <Wrench size={12} />
        <span className="flex-1 text-left">Tool Library…</span>
        <span className="font-mono text-[9px] text-mute/60">{cam.tools.length} in project</span>
      </button>
    </section>
  );
}

/** Tool tag shown in front of an operation name: the tool number when the
 *  library entry has one, otherwise its name (controls that call tools by
 *  name use exactly this identifier). */
function toolTag(cam: CamDocumentDto, operation: CamOperationDto): string {
  const tool: CamToolDto | undefined = cam.tools.find((entry) => entry.id === operation.tool_id);
  if (!tool) return '?';
  return tool.number != null ? `T${tool.number}` : tool.name;
}

function OperationIcon({ kind }: { kind: CamOperationDto['kind'] }) {
  switch (kind) {
    case 'face':
      return <ScanLine size={12} />;
    case 'contour2d':
      return <Route size={12} />;
    case 'pocket2d':
      return <Square size={12} />;
    case 'chamfer2d':
      return <Triangle size={12} />;
    case 'drill':
      return <CircleDot size={12} />;
    case 'thread':
      return <CircleDot size={12} />;
  }
}

export function runCamAction(action: () => Promise<unknown>): void {
  void action().catch((error) => {
    useAppStore.getState().setConstraintDialog({
      titleKey: 'file.errorTitle',
      message: error instanceof Error ? error.message : String(error),
    });
  });
}
