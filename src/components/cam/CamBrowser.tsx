import {
  AlertTriangle,
  Ban,
  ChevronDown,
  ChevronRight,
  Copy,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  camOperationLabel,
  deleteCamOperation,
  deleteCamSetup,
  duplicateCamOperation,
  duplicateCamSetup,
  regenerateCamOperation,
  regenerateCamSetup,
  reorderCamItems,
  setActiveCamSetup,
  updateCamOperation,
} from '../../cam/document';
import { getEngine } from '../../engine';
import type {
  CamDocumentDto,
  CamOperationDto,
  CamToolDto,
  CamToolpathStatusDto,
} from '../../engine/types';
import { useAppStore } from '../../store/appStore';
import { requestCamSimulation } from '../../cam/simulationUi';
import { useCamReorder } from './useCamReorder';
import { CAM_OPERATION_ICON, CamToolIcon } from './CamToolIcon';

const CAM_SETUPS_HEIGHT_KEY = 'cam-setups-panel-height';

/** Manufacturing section docked under the shared modeling browser. The tree
 *  above stays the modeling browser; this panel adds only what the
 *  manufacturing workspace owns: setups with their operations, and the entry
 *  point to the tool library (a separate dialog, not a browser node). In the
 *  manufacturing tab this is the primary tree, so it opens tall and the top
 *  edge drags to resize (height persists per machine). */
export function CamSetupsPanel() {
  const cam = useAppStore((state) => state.camDocument);
  const solidScene = useAppStore((state) => state.solidScene);
  const selectedOperationId = useAppStore((state) => state.selectedCamOperationId);
  const selectedSetupId = useAppStore((state) => state.selectedCamSetupId);
  const [selectedStockRow, setSelectedStockRow] = useState<number | null>(null);
  const selectSetup = useAppStore((state) => state.setSelectedCamSetupId);
  const selectOperation = useAppStore((state) => state.setSelectedCamOperationId);
  const openDialog = useAppStore((state) => state.setCamDialog);
  const [height, setHeight] = useState(() => {
    const saved = Number(localStorage.getItem(CAM_SETUPS_HEIGHT_KEY));
    return Number.isFinite(saved) && saved >= 140 ? saved : 340;
  });
  const sectionRef = useRef<HTMLElement | null>(null);
  const reorder = useCamReorder(reorderCamItems);
  const [toolpathStatuses, setToolpathStatuses] = useState<CamToolpathStatusDto[]>([]);
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [regenerateBusy, setRegenerateBusy] = useState(false);
  const [regenerateConfirm, setRegenerateConfirm] = useState<{
    setupId: number;
    setupName: string;
    currentCount: number;
    totalCount: number;
  } | null>(null);
  /** Right-click context menu on setup / Stock&WCS / operation rows: edit,
   *  suppress/resume, delete as applicable. Position is clamped when
   *  rendered. */
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    target:
      | { kind: 'operation'; operationId: number }
      | { kind: 'setup'; setupId: number }
      | { kind: 'stock'; setupId: number };
  } | null>(null);

  // Dependency status is computed by Rust from the current scene and CAM
  // document. Re-run after either changes so a CAD edit immediately marks
  // affected rows stale without waiting for planning or simulation.
  useEffect(() => {
    let cancelled = false;
    setStatusBusy(true);
    setStatusError(null);
    setToolpathStatuses([]);
    void getEngine()
      .then((engine) => engine.camToolpathStatuses())
      .then((statuses) => {
        if (!cancelled) setToolpathStatuses(statuses);
      })
      .catch((error) => {
        if (cancelled) return;
        setToolpathStatuses([]);
        setStatusError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setStatusBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cam, solidScene]);

  const toolpathStatus = (operation: CamOperationDto): CamToolpathStatusDto | null => {
    if (!operation.enabled) return null;
    const current = toolpathStatuses.find((status) => status.operation_id === operation.id);
    if (current) return current;
    if (statusBusy && !statusError) return null;
    return (
      {
        setup_id: 0,
        operation_id: operation.id,
        state: 'never_generated',
        reasons: [
          statusError
            ? `Toolpath safety check failed: ${statusError}`
            : 'Toolpath has not been regenerated and checked for this project version.',
        ],
      }
    );
  };

  const requestSetupRegeneration = async (setupId: number): Promise<void> => {
    const setup = cam.setups.find((candidate) => candidate.id === setupId);
    if (!setup) throw new Error('CAM setup does not exist.');
    const enabledOperations = setup.operations.filter((operation) => operation.enabled);
    if (enabledOperations.length === 0) {
      throw new Error('This setup has no enabled toolpaths to regenerate.');
    }
    // Re-read at click time. The confirmation must never rely on a status
    // snapshot that could predate the last model or setup edit.
    const statuses = await (await getEngine()).camToolpathStatuses();
    const enabledIds = new Set(enabledOperations.map((operation) => operation.id));
    const currentCount = statuses.filter(
      (status) => enabledIds.has(status.operation_id) && status.state === 'current',
    ).length;
    if (currentCount > 0) {
      setRegenerateConfirm({
        setupId,
        setupName: setup.name,
        currentCount,
        totalCount: enabledOperations.length,
      });
      return;
    }
    await regenerateCamSetup(setupId);
  };

  // Load-time issues: a project file always opens — operations that failed
  // validation are parked (disabled) and badged with the reason until the
  // operator fixes and re-saves them. Warnings clear on the next write.
  const loadWarnings = cam.load_warnings ?? [];
  const operationWarning = (operationId: number): string | null =>
    loadWarnings.find((warning) => warning.operation_id === operationId)?.message ?? null;
  const setupWarning = (setupId: number): string | null =>
    loadWarnings.find(
      (warning) => warning.setup_id === setupId && (warning.operation_id ?? null) === null,
    )?.message ?? null;
  const documentWarnings = loadWarnings.filter(
    (warning) => (warning.setup_id ?? null) === null && (warning.operation_id ?? null) === null,
  );

  useEffect(() => {
    if (!menu) return;
    const closeMenu = () => setMenu(null);
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
  }, [menu]);

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
      <header className="flex h-8 shrink-0 items-center justify-between border-b border-edge px-2">
        <span className="flex items-center gap-1.5 text-[10px] font-semibold tracking-widest text-mute">
          <CamToolIcon id="camSetup" size={15} />
          SETUPS
          {statusBusy && (
            <RefreshCw
              size={10}
              className="animate-spin text-accent"
              aria-label="Checking toolpath safety"
            />
          )}
        </span>
        <button
          type="button"
          aria-label="New setup"
          title="New setup (manual WCS/stock configuration)"
          onClick={() => openDialog({ type: 'setup' })}
          className="flex h-7 w-7 items-center justify-center rounded text-mute hover:bg-edge hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          <Plus size={19} strokeWidth={1.8} />
        </button>
      </header>
      <div ref={reorder.root} onClickCapture={reorder.captureClick} className="relative min-h-0 flex-1 overflow-y-auto py-1">
        {reorder.ghost}
        <div role="status" aria-live="polite" className={reorder.message ? 'px-2 py-1 text-[10px] text-mute' : 'sr-only'}>{reorder.message}</div>
        {statusError && (
          <div className="mx-2 mb-1 flex items-start gap-1 rounded border border-red-500/50 bg-red-950/35 p-1.5 text-[10px] leading-relaxed text-red-200">
            <AlertTriangle size={10} className="mt-0.5 shrink-0" />
            <span>Toolpath safety check failed: {statusError}</span>
          </div>
        )}
        {documentWarnings.length > 0 && (
          <div className="mx-2 mb-1 rounded border border-[#d69b45]/45 bg-[#2a2117]/80 p-1.5 text-[10px] leading-relaxed text-[#e8c589]">
            {documentWarnings.map((warning, index) => (
              <div key={index} className="flex items-start gap-1">
                <AlertTriangle size={10} className="mt-0.5 shrink-0" />
                <span>{warning.message}</span>
              </div>
            ))}
          </div>
        )}
        {reorder.order(null, cam.setups.map((setup) => setup.id)).map((id) => cam.setups.find((setup) => setup.id === id)!).filter(Boolean).map((setup) => {
          const active = setup.id === cam.active_setup_id;
          const setupSelected = selectedSetupId === setup.id && selectedOperationId === null
            && selectedStockRow !== setup.id;
          const setupIssue = setupWarning(setup.id);
          const stalePathCount = setup.operations.filter((operation) => {
            const status = toolpathStatus(operation);
            return status !== null && status.state !== 'current';
          }).length;
          return (
            <section key={setup.id} data-cam-sort-key={`setup-${setup.id}`}>
              <div
                data-cam-sort-scope="setups" data-cam-sort-id={setup.id}
                onKeyDown={(event)=>reorder.keyboard(event,null,setup.id,cam.setups.map((s)=>s.id))}
                style={{cursor:reorder.drag?'grabbing':'grab',opacity:reorder.drag?.scope===null&&reorder.drag.id===setup.id?0.4:1}}
                onPointerDown={(event) => { if (!(event.target as HTMLElement).closest('[title="Delete setup and its operations"]')) reorder.start(event, null, setup.id, cam.setups.map((s) => s.id), setup.name); }}
                className={`flex h-7 items-center gap-1.5 px-2 ${setupSelected ? 'bg-accent/25' : active ? 'bg-accent/5' : ''}`}
                onDoubleClick={() => {
                  runCamAction(() => setActiveCamSetup(setup.id));
                  openDialog({ type: 'setup', editId: setup.id });
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setSelectedStockRow(null);
                  runCamAction(() => setActiveCamSetup(setup.id));
                  setMenu({
                    x: event.clientX,
                    y: event.clientY,
                    target: { kind: 'setup', setupId: setup.id },
                  });
                }}
                title="Drag to reorder setups (or Option + Up/Down). Double-click to edit, right-click for more"
              >
                <button
                  type="button"
                  aria-pressed={setupSelected}
                  onClick={() => {
                    setSelectedStockRow(null);
                    runCamAction(() => setActiveCamSetup(setup.id));
                  }}
                  className={`flex min-w-0 flex-1 items-center gap-1.5 text-left ${
                    active ? 'text-ink' : 'text-mute hover:text-ink'
                  }`}
                >
                  {active ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  <CamToolIcon id="camSetup" size={15} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-[12px]">{setup.name}</span>
                  {setupIssue && (
                    <span title={setupIssue} className="shrink-0 text-[#e8c589]">
                      <AlertTriangle size={11} />
                    </span>
                  )}
                  {stalePathCount > 0 && (
                    <span
                      title={`${stalePathCount} enabled toolpath${stalePathCount === 1 ? ' needs' : 's need'} attention before NC posting; invalid tools/settings must be corrected before regeneration`}
                      className="flex shrink-0 items-center gap-0.5 font-mono text-[9px] text-red-400"
                    >
                      <AlertTriangle size={11} />
                      {stalePathCount}
                    </span>
                  )}
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
                      setSelectedStockRow(setup.id);
                      selectSetup(setup.id);
                      selectOperation(null);
                    }}
                    onDoubleClick={() => openDialog({ type: 'setup', editId: setup.id })}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setSelectedStockRow(setup.id);
                      selectSetup(setup.id);
                      selectOperation(null);
                      setMenu({
                        x: event.clientX,
                        y: event.clientY,
                        target: { kind: 'stock', setupId: setup.id },
                      });
                    }}
                    title="Stock, WCS, and work offsets — double-click to edit, right-click for more"
                    className={`flex h-7 w-full items-center gap-2 pl-8 pr-2 text-left text-[11px] ${
                      selectedOperationId === null && selectedSetupId === setup.id && selectedStockRow === setup.id
                        ? 'bg-accent/20 text-ink'
                        : 'text-mute hover:bg-edge/40 hover:text-ink'
                    }`}
                  >
                    <CamToolIcon id="camSetup" size={15} />
                    <span>Stock &amp; WCS</span>
                  </button>
                  {reorder.order(setup.id, setup.operations.map((operation) => operation.id)).map((id) => setup.operations.find((operation) => operation.id === id)!).filter(Boolean).map((operation) => {
                    const generationStatus = toolpathStatus(operation);
                    const generationWarning =
                      generationStatus && generationStatus.state !== 'current'
                        ? (generationStatus.reasons ?? []).join(' ')
                        : null;
                    return (
                      <button
                      key={operation.id}
                      data-cam-toolpath-state={generationStatus?.state ?? 'checking'}
                      data-cam-sort-key={`operation-${operation.id}`} data-cam-sort-scope={`operations-${setup.id}`} data-cam-sort-id={operation.id}
                      onKeyDown={(event)=>reorder.keyboard(event,setup.id,operation.id,setup.operations.map((o)=>o.id))}
                      style={{cursor:reorder.drag?'grabbing':'grab',opacity:reorder.drag?.scope===setup.id&&reorder.drag.id===operation.id?0.4:undefined}}
                      onPointerDown={(event) => reorder.start(event, setup.id, operation.id, setup.operations.map((o) => o.id), operation.name)}
                      type="button"
                      onClick={() => {
                        setSelectedStockRow(null);
                        selectSetup(setup.id);
                        selectOperation(operation.id);
                      }}
                      onDoubleClick={() => {
                        selectSetup(setup.id);
                        selectOperation(operation.id);
                        openDialog({ type: 'operation', kind: operation.kind, editId: operation.id });
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        selectSetup(setup.id);
                        selectOperation(operation.id);
                        setMenu({
                          x: event.clientX,
                          y: event.clientY,
                          target: { kind: 'operation', operationId: operation.id },
                        });
                      }}
                      title={
                        generationWarning
                          ? generationStatus?.state === 'invalid'
                            ? `Invalid toolpath: ${generationWarning} Correct the tool or operation, then regenerate.`
                            : `${generationWarning} Right-click to regenerate.`
                          : 'Drag to reorder within this setup (or Option + Up/Down). Double-click to edit, right-click for more'
                      }
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
                      {operationWarning(operation.id) && generationStatus?.state !== 'invalid' && (
                        <span
                          title={operationWarning(operation.id)!}
                          className="shrink-0 text-[#e8c589]"
                        >
                          <AlertTriangle size={11} />
                        </span>
                      )}
                      {generationWarning && (
                        <span title={generationWarning} className="flex shrink-0 items-center gap-1 text-red-400">
                          {generationStatus?.state === 'invalid' ? <><Ban size={11} /><span className="text-[9px]">Invalid</span></> : <AlertTriangle size={11} />}
                        </span>
                      )}
                      <span className="text-[8px] uppercase opacity-60">
                        {camOperationLabel(operation.kind)}
                      </span>
                      </button>
                    );
                  })}
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
      {menu &&
        (() => {
          const target = menu.target;
          const operation =
            target.kind === 'operation'
              ? cam.setups
                  .flatMap((setup) => setup.operations)
                  .find((candidate) => candidate.id === target.operationId) ?? null
              : null;
          if (target.kind === 'operation' && !operation) return null;
          const itemClass =
            'flex h-7 w-full items-center gap-2 px-3 text-left text-[11px] text-mute hover:bg-edge/40 hover:text-ink';
          const close = () => setMenu(null);
          return (
            <div
              role="menu"
              // The native viewport draws over plain DOM; this attribute
              // registers the menu as an overlay cutout so it stays visible.
              data-native-viewport-overlay
              className="fixed z-[90] w-48 rounded border border-edge bg-panel py-1 shadow-2xl"
              style={{
                left: Math.min(menu.x, window.innerWidth - 200),
                top: Math.min(menu.y, window.innerHeight - 235),
              }}
              onPointerDown={(event) => event.stopPropagation()}
              onContextMenu={(event) => event.preventDefault()}
            >
              {target.kind === 'operation' && operation && (
                <>
                  <button type="button" className={`${itemClass} disabled:opacity-40`}
                    disabled={!operation.enabled}
                    onClick={() => {
                      close();
                      runCamAction(async () => {
                        const setup = cam.setups.find((setup) => setup.operations.some((op) => op.id === operation.id));
                        if (!setup) return;
                        await setActiveCamSetup(setup.id);
                        selectOperation(operation.id);
                        requestCamSimulation('cam', setup.id, operation.id);
                      });
                    }}><CamToolIcon id="camSimulate" size={15} /> Simulate toolpath</button>
                  <button
                    type="button"
                    disabled={!operation.enabled}
                    title={
                      operation.enabled
                        ? 'Recompute this toolpath from the current CAD, setup, operation, and tool'
                        : 'Resume this operation before regenerating it'
                    }
                    className={`${itemClass} disabled:cursor-not-allowed disabled:opacity-40`}
                    onClick={() => {
                      close();
                      runCamAction(() => regenerateCamOperation(operation.id));
                    }}
                  >
                    <RefreshCw size={12} /> Regenerate toolpath
                  </button>
                  <div className="my-1 border-t border-edge/60" />
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
                      openDialog({ type: 'operation', kind: operation.kind, editId: operation.id });
                    }}
                  >
                    <Pencil size={12} /> Edit…
                  </button>
                  <button type="button" className={itemClass} onClick={() => {
                    close();
                    setSelectedStockRow(null);
                    runCamAction(() => duplicateCamOperation(operation.id));
                  }}><Copy size={14} /> Duplicate toolpath</button>
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
                </>
              )}
              {target.kind === 'setup' && (
                <>
                  <button type="button" className={itemClass} onClick={() => {
                    close();
                    openDialog({ type: 'setup' });
                  }}><Plus size={16} /> New setup</button>
                  <div className="my-1 border-t border-edge/60" />
                  <button type="button" className={`${itemClass} disabled:opacity-40`}
                    disabled={!cam.setups.find((setup) => setup.id === target.setupId)?.operations.some((operation) => operation.enabled)}
                    onClick={() => {
                      close();
                      runCamAction(async () => {
                        await setActiveCamSetup(target.setupId);
                        requestCamSimulation('cam', target.setupId, null);
                      });
                    }}><CamToolIcon id="camSimulate" size={15} /> Simulate whole setup</button>
                  <button
                    type="button"
                    className={itemClass}
                    onClick={() => {
                      close();
                      runCamAction(() => requestSetupRegeneration(target.setupId));
                    }}
                  >
                    <RefreshCw size={12} /> Regenerate all toolpaths
                  </button>
                  <div className="my-1 border-t border-edge/60" />
                  <button
                    type="button"
                    className={itemClass}
                    onClick={() => {
                      close();
                      openDialog({ type: 'setup', editId: target.setupId });
                    }}
                  >
                    <Pencil size={12} /> Edit…
                  </button>
                  <button type="button" className={itemClass} onClick={() => {
                    close();
                    setSelectedStockRow(null);
                    runCamAction(() => duplicateCamSetup(target.setupId));
                  }}><Copy size={14} /> Duplicate setup</button>
                  <div className="my-1 border-t border-edge/60" />
                  <button
                    type="button"
                    className={`${itemClass} hover:text-warn`}
                    onClick={() => {
                      close();
                      runCamAction(() => deleteCamSetup(target.setupId));
                    }}
                  >
                    <Trash2 size={12} /> Delete setup
                  </button>
                </>
              )}
              {target.kind === 'stock' && (
                <button
                  type="button"
                  className={itemClass}
                  onClick={() => {
                    close();
                    openDialog({ type: 'setup', editId: target.setupId });
                  }}
                >
                  <Pencil size={12} /> Edit stock &amp; WCS…
                </button>
              )}
            </div>
          );
        })()}
      {regenerateConfirm && (
        <div
          data-native-viewport-dim="0.45"
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/45"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget && !regenerateBusy) {
              setRegenerateConfirm(null);
            }
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="cam-regenerate-title"
            className="w-[28rem] max-w-[calc(100vw-2rem)] rounded border border-edge bg-panel shadow-xl shadow-black/50"
          >
            <div
              id="cam-regenerate-title"
              className="border-b border-edge px-4 py-3 text-sm font-semibold text-ink"
            >
              Regenerate all toolpaths?
            </div>
            <div className="space-y-2 px-4 py-4 text-xs leading-relaxed text-ink/90">
              <p>
                {regenerateConfirm.currentCount} of {regenerateConfirm.totalCount} enabled
                toolpaths in “{regenerateConfirm.setupName}”{' '}
                {regenerateConfirm.currentCount === 1 ? 'is' : 'are'} already current and do not
                need regeneration.
              </p>
              <p className="text-mute">
                Continuing will recompute every enabled path. Geometry stored as manual coordinates
                remains manual; inspect the result after a CAD change.
              </p>
            </div>
            <div className="flex justify-end gap-2 border-t border-edge px-4 py-3">
              <button
                type="button"
                disabled={regenerateBusy}
                onClick={() => setRegenerateConfirm(null)}
                className="h-8 rounded border border-edge px-4 text-xs text-ink hover:bg-edge disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={regenerateBusy}
                onClick={() => {
                  const setupId = regenerateConfirm.setupId;
                  setRegenerateBusy(true);
                  runCamAction(async () => {
                    try {
                      await regenerateCamSetup(setupId);
                      setRegenerateConfirm(null);
                    } finally {
                      setRegenerateBusy(false);
                    }
                  });
                }}
                className="flex h-8 items-center gap-2 rounded bg-accent px-4 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-40"
              >
                <RefreshCw size={12} className={regenerateBusy ? 'animate-spin' : ''} />
                Regenerate all
              </button>
            </div>
          </div>
        </div>
      )}
      <button
        type="button"
        title="Central library by default; switch to this project's snapshots inside"
        onClick={() => openDialog({ type: 'tool', toolId: null })}
        className="flex h-9 shrink-0 items-center gap-2 border-t border-edge px-3 text-[12px] text-mute hover:bg-edge/40 hover:text-ink"
      >
        <CamToolIcon id="camToolLibrary" size={18} />
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
  return <CamToolIcon id={CAM_OPERATION_ICON[kind]} size={15} />;
}

export function runCamAction(action: () => Promise<unknown>): void {
  void action().catch((error) => {
    useAppStore.getState().setConstraintDialog({
      titleKey: 'file.errorTitle',
      message: error instanceof Error ? error.message : String(error),
    });
  });
}
