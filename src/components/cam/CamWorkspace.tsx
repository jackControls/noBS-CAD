import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Clock3,
  Cuboid,
  Download,
  FileCode2,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Route,
  ScanEye,
} from 'lucide-react';
import { activeCamSetup, findCamOperation, setCamUnits } from '../../cam/document';
import { modeledStockBodyId } from '../../cam/geometry';
import { commitLength, displayLength, lengthUnitLabel } from '../../cam/units';
import { getEngine } from '../../engine';
import type {
  CamDocumentDto,
  CamProgramDto,
  CamSetupDto,
  CamSimulationResultDto,
  CamSimulationTargetDto,
  CamStockMeshDto,
  CamUnits,
  SolidSceneDto,
} from '../../engine/types';
import { cancelCamPointPick } from '../../cam/pointPick';
import {
  useAppStore,
  type CamDialogState,
  type CamSimulationPlaybackState,
} from '../../store/appStore';
import {
  simulationMeshPresentationWarnings,
  simulationPlaybackPose,
} from '../../cam/overlay';
import { Viewport } from '../viewport/Viewport';
import { runCamAction } from './CamBrowser';
import { CamOperationDialog } from './CamOperationDialog';
import {
  CamGcodeSimulationDialog,
  type CamGcodeSimulationInput,
} from './CamGcodeSimulationDialog';
import { CamPostDialog } from './CamPostDialog';
import { CamSetupDialog } from './CamSetupDialog';
import { CamToolDialog } from './CamToolDialog';

type SimulationInput = { kind: 'cam' } | CamGcodeSimulationInput;
type SimulationDetail = 'auto' | 'fine' | 'balanced' | 'fast';
const StableViewport = memo(Viewport);

export function CamWorkspace() {
  const cam = useAppStore((state) => state.camDocument);
  const scene = useAppStore((state) => state.solidScene);
  const selectedOperationId = useAppStore((state) => state.selectedCamOperationId);
  // The planned program and volumetric simulation live in the store so the
  // shared viewport's overlay collector can read them between React renders.
  const program = useAppStore((state) => state.camProgram);
  const simulation = useAppStore((state) => state.camSimulation);
  const simulationTimeline = useAppStore((state) => state.camSimulationTimeline);
  const simulationPlayback = useAppStore((state) => state.camSimulationPlayback);
  const xrayModel = useAppStore((state) => state.camXrayModel);
  const resolvedTheme = useAppStore((state) => state.resolvedTheme);
  const pick = useAppStore((state) => state.camPointPick);
  const setup = activeCamSetup(cam);
  const operation = findCamOperation(cam, selectedOperationId);
  const verificationScopeName = simulation?.through_operation_id == null
    ? null
    : findCamOperation(cam, simulation.through_operation_id)?.name
      ?? `Operation ${simulation.through_operation_id}`;
  const units = cam.units;
  const [planError, setPlanError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const [busy, setBusy] = useState(false);
  const [simulationError, setSimulationError] = useState<string | null>(null);
  const [simulationGeneration, setSimulationGeneration] = useState(0);
  const [simulationBusy, setSimulationBusy] = useState(false);
  const [simulationFrameBusy, setSimulationFrameBusy] = useState(false);
  const [simulationInput, setSimulationInput] = useState<SimulationInput>({ kind: 'cam' });
  const [simulationDetail, setSimulationDetail] = useState<SimulationDetail>('auto');
  const [comparisonToleranceMm, setComparisonToleranceMm] = useState(0.1);
  const [gcodeDialogOpen, setGcodeDialogOpen] = useState(false);
  const simulationFrameRequest = useRef(0);
  const preparedTargetKey = useRef<string | null>(null);
  const stockMesh = useMemo(
    () => setup ? simulationStockMesh(setup, cam, scene) : null,
    [cam, scene, setup],
  );
  const targetCacheKey = useMemo(
    () => setup
      ? createSimulationTargetCacheKey(setup.id)
      : null,
    [cam, comparisonToleranceMm, scene, setup, simulationDetail],
  );
  const simulationTargetInput = useMemo(
    () => setup && targetCacheKey
      ? simulationTarget(setup, cam, scene, comparisonToleranceMm, targetCacheKey, true)
      : null,
    [cam, comparisonToleranceMm, scene, setup, targetCacheKey],
  );
  const playbackTargetInput = useMemo(
    () => simulationTargetInput
      ? { ...simulationTargetInput, meshes: [] }
      : null,
    [simulationTargetInput],
  );
  const simulationScope = simulationInput.kind === 'cam' ? selectedOperationId : null;
  const programWarnings = program?.warnings ?? [];
  // Simulation starts with the program warnings and appends its own accuracy
  // and collision-model limitations. Show those additions exactly once; the
  // old panel rendered program warnings only and silently hid simulator ones.
  const presentationWarnings = simulation
    ? simulationMeshPresentationWarnings(simulation)
    : [];
  const simulationWarnings = [...new Set([
    ...(simulationTimeline?.warnings ?? simulation?.warnings ?? []),
    ...presentationWarnings,
  ])].filter((warning) => !programWarnings.includes(warning));
  const simulationResolution = simulation
    ? formatSimulationResolution(simulation, units)
    : null;

  useEffect(() => {
    const { setCamProgram } = useAppStore.getState();
    if (!setup) {
      setCamProgram(null);
      setPlanError(null);
      return;
    }
    let cancelled = false;
    setBusy(true);
    void getEngine()
      .then((engine) => engine.camPlan(setup.id))
      .then((next) => {
        if (cancelled) return;
        setCamProgram(next);
        setPlanError(null);
      })
      .catch((error) => {
        if (cancelled) return;
        setCamProgram(null);
        setPlanError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cam, setup?.id, generation]);

  useEffect(() => {
    simulationFrameRequest.current += 1;
    const {
      setCamSimulation,
      setCamSimulationTimeline,
      setCamSimulationPlayback,
    } = useAppStore.getState();
    // A stale result must never paint over a freshly selected setup.
    setCamSimulation(null);
    setCamSimulationTimeline(null);
    setCamSimulationPlayback(null);
    setSimulationError(null);
    if (!setup) {
      setSimulationBusy(false);
      return;
    }
    let cancelled = false;
    setSimulationBusy(true);
    const voxelSize = simulationVoxelSize(simulationDetail, setup);
    const maxVoxels = simulationVoxelBudget(simulationDetail);
    void getEngine()
      .then(async (engine) => {
        const run = (target: typeof simulationTargetInput) => simulationInput.kind === 'cam'
          ? engine.camSimulate({
              setup_id: setup.id,
              voxel_size: voxelSize,
              max_voxels: maxVoxels,
              stock_mesh: stockMesh,
              target,
              // The selected operation's review cannot include later removal.
              through_operation_id: simulationScope,
            })
          : engine.camSimulateGcode({
              setup_id: setup.id,
              source: simulationInput.source,
              file_name: simulationInput.fileName,
              dialect: simulationInput.dialect,
              voxel_size: voxelSize,
              max_voxels: maxVoxels,
              stock_mesh: stockMesh,
              target,
            });
        const canReuseTarget = targetCacheKey !== null
          && preparedTargetKey.current === targetCacheKey;
        try {
          return await run(canReuseTarget ? playbackTargetInput : simulationTargetInput);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!canReuseTarget || !message.includes('target cache is not prepared')) throw error;
          // Both Rust caches are deliberately bounded. If this setup was
          // evicted, resend the exact target once and prepare it again.
          preparedTargetKey.current = null;
          return run(simulationTargetInput);
        }
      })
      .then((next) => {
        if (cancelled) return;
        preparedTargetKey.current = targetCacheKey;
        // A setup row represents the material arriving at that setup, not the
        // result after every operation. Keep the complete run as the hidden
        // verification/playback timeline, then let the block-frame effect
        // request its zero-step stock. Rest setups reconstruct their source
        // setup first, so time zero is already the previous setup's remainder.
        const presentIncomingSetupStock = simulationInput.kind === 'cam'
          && simulationScope === null
          && next.steps.length > 0;
        setCamSimulation(presentIncomingSetupStock ? null : next);
        setCamSimulationTimeline(next);
        setCamSimulationPlayback({
          playing: false,
          time_seconds: presentIncomingSetupStock ? 0 : next.estimated_seconds,
          speed: 1,
        });
        setSimulationError(null);
      })
      .catch((error) => {
        if (cancelled) return;
        setCamSimulation(null);
        setSimulationError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setSimulationBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    cam,
    setup?.id,
    simulationGeneration,
    scene,
    simulationInput,
    simulationScope,
    simulationDetail,
    comparisonToleranceMm,
    simulationTargetInput,
    playbackTargetInput,
    stockMesh,
    targetCacheKey,
  ]);

  // The presentation clock is independent from the renderer. Bevy continues
  // receiving pointer/orbit input while React advances only this timestamp.
  useEffect(() => {
    if (!simulationTimeline || !simulationPlayback?.playing) return;
    let animationFrame = 0;
    let previous = performance.now();
    const tick = (now: number) => {
      const state = useAppStore.getState();
      const playback = state.camSimulationPlayback;
      if (!playback?.playing || state.camSimulationTimeline !== simulationTimeline) return;
      const elapsed = Math.min(0.1, Math.max(0, (now - previous) / 1000));
      previous = now;
      const time = Math.min(
        simulationTimeline.estimated_seconds,
        playback.time_seconds + elapsed * playback.speed,
      );
      state.setCamSimulationPlayback({
        ...playback,
        playing: time < simulationTimeline.estimated_seconds - 1e-9,
        time_seconds: time,
      });
      if (time < simulationTimeline.estimated_seconds - 1e-9) {
        animationFrame = requestAnimationFrame(tick);
      }
    };
    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
  }, [simulationTimeline, simulationPlayback?.playing]);

  const completedPlaybackSteps = simulationTimeline && simulationPlayback
    ? completedStepsAtTime(simulationTimeline, simulationPlayback.time_seconds)
    : null;

  // Stock is authoritative only at completed controller/CAM motion blocks in
  // this first playback slice. Requests are debounced and stale responses are
  // discarded; the cutter pose still interpolates every animation frame.
  useEffect(() => {
    if (!setup || !simulationTimeline || completedPlaybackSteps === null) return;
    if (useAppStore.getState().camSimulationTimeline !== simulationTimeline) return;
    if (simulationTimeline.setup_id !== setup.id) return;
    if (
      (simulationInput.kind === 'cam' && simulationTimeline.source !== 'cam_toolpath')
      || (simulationInput.kind === 'gcode' && simulationTimeline.source !== 'g_code')
    ) return;

    const current = useAppStore.getState().camSimulation;
    if (completedPlaybackSteps >= simulationTimeline.steps.length) {
      simulationFrameRequest.current += 1;
      if (current !== simulationTimeline) useAppStore.getState().setCamSimulation(simulationTimeline);
      setSimulationFrameBusy(false);
      return;
    }
    if (
      current?.source === simulationTimeline.source
      && current.setup_id === setup.id
      && current.completed_steps === completedPlaybackSteps
    ) return;

    const requestId = ++simulationFrameRequest.current;
    const timer = window.setTimeout(() => {
      setSimulationFrameBusy(true);
      const voxelSize = simulationVoxelSize(simulationDetail, setup);
      const maxVoxels = simulationVoxelBudget(simulationDetail);
      void getEngine()
        .then((engine) => simulationInput.kind === 'cam'
          ? engine.camSimulate({
              setup_id: setup.id,
              voxel_size: voxelSize,
              max_voxels: maxVoxels,
              stock_mesh: stockMesh,
              target: playbackTargetInput,
              through_operation_id: simulationTimeline.through_operation_id,
              completed_steps: completedPlaybackSteps,
            })
          : engine.camSimulateGcode({
              setup_id: setup.id,
              source: simulationInput.source,
              file_name: simulationInput.fileName,
              dialect: simulationInput.dialect,
              voxel_size: voxelSize,
              max_voxels: maxVoxels,
              stock_mesh: stockMesh,
              target: playbackTargetInput,
              completed_steps: completedPlaybackSteps,
            }))
        .then((next) => {
          if (simulationFrameRequest.current !== requestId) return;
          const state = useAppStore.getState();
          if (state.camSimulationTimeline !== simulationTimeline) return;
          state.setCamSimulation(next);
          setSimulationError(null);
        })
        .catch((error) => {
          if (simulationFrameRequest.current !== requestId) return;
          setSimulationError(error instanceof Error ? error.message : String(error));
          const playback = useAppStore.getState().camSimulationPlayback;
          if (playback) useAppStore.getState().setCamSimulationPlayback({ ...playback, playing: false });
        })
        .finally(() => {
          if (simulationFrameRequest.current === requestId) setSimulationFrameBusy(false);
        });
    }, 75);
    return () => window.clearTimeout(timer);
  }, [
    completedPlaybackSteps,
    scene,
    setup,
    simulationInput,
    simulationTimeline,
    simulationDetail,
    comparisonToleranceMm,
    playbackTargetInput,
    stockMesh,
  ]);

  // Escape cancels an active viewport point-pick session.
  useEffect(() => {
    if (!pick) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelCamPointPick();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pick]);

  // The manufacturing tab opens straight onto the modeled parts, even before
  // the first setup exists; setups are created from the ribbon or the empty
  // sidebar panel, never implicitly.

  const regenerateCamSimulation = () => {
    if (simulationInput.kind !== 'cam') setSimulationInput({ kind: 'cam' });
    setSimulationGeneration((value) => value + 1);
  };

  const runGcodeSimulation = (input: CamGcodeSimulationInput) => {
    setGcodeDialogOpen(false);
    setSimulationInput(input);
    setSimulationGeneration((value) => value + 1);
  };

  const togglePlayback = () => {
    if (!simulationTimeline || !simulationPlayback) return;
    const atEnd = simulationPlayback.time_seconds >= simulationTimeline.estimated_seconds - 1e-9;
    useAppStore.getState().setCamSimulationPlayback({
      ...simulationPlayback,
      playing: !simulationPlayback.playing,
      time_seconds: !simulationPlayback.playing && atEnd ? 0 : simulationPlayback.time_seconds,
    });
  };

  const seekPlayback = (time: number) => {
    if (!simulationPlayback || !simulationTimeline) return;
    useAppStore.getState().setCamSimulationPlayback({
      ...simulationPlayback,
      playing: false,
      time_seconds: Math.max(0, Math.min(simulationTimeline.estimated_seconds, time)),
    });
  };

  return (
    <div className="flex h-full min-h-0 bg-viewport" data-testid="cam-workspace">
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-edge bg-header px-3">
          <div className="flex min-w-0 items-center gap-2 text-[11px] text-mute">
            {setup ? (
              <>
                <span className="truncate font-semibold text-ink">{setup.name}</span>
                <span>·</span>
                <span className="uppercase">
                  {setup.work_offset}
                  {setup.work_offset_count > 1 && ` → ${WORK_OFFSETS[WORK_OFFSETS.indexOf(setup.work_offset) + setup.work_offset_count - 1]}`}
                </span>
                <span>·</span>
                <span>Fixed Z / 3-axis</span>
                {program && <ProgramStats program={program} units={units} />}
              </>
            ) : (
              <span className="text-mute">
                No setup yet — model shown as designed. Create a setup from the ribbon to program toolpaths.
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              title="Switch document units — stored geometry stays canonical; display and posted output follow this choice"
              onClick={() => runCamAction(() => setCamUnits(units === 'millimeters' ? 'inches' : 'millimeters'))}
              className="flex h-7 items-center rounded border border-edge bg-panel px-2.5 text-[10px] font-semibold text-mute hover:border-accent/40 hover:text-accent"
              data-testid="cam-units-toggle"
            >
              {units === 'millimeters' ? 'mm' : 'inch'}
            </button>
            <select
              aria-label="3D simulation detail"
              disabled={!setup || simulationBusy}
              value={simulationDetail}
              onChange={(event) => setSimulationDetail(event.target.value as SimulationDetail)}
              title="Model-relative volumetric detail. Quality targets a cell count across the stock's longest side and stays independent of camera zoom; actual cell size is shown beside this control."
              className="h-7 rounded border border-edge bg-panel px-2 text-[9px] font-semibold text-mute outline-none disabled:opacity-40"
            >
              <option value="auto">Detail · Auto</option>
              <option value="fine">Detail · Fine</option>
              <option value="balanced">Detail · Balanced</option>
              <option value="fast">Detail · Fast</option>
            </select>
            <label
              className="flex h-7 items-center gap-1 rounded border border-edge bg-panel px-2 text-[9px] text-mute"
              title="Requested radial tolerance for comparing remaining stock with the intended part. The verifier will show a larger effective value when the voxel grid cannot resolve this request."
            >
              Compare ±
              <input
                aria-label="Part comparison tolerance"
                type="number"
                min={0}
                step={units === 'millimeters' ? 0.01 : 0.001}
                value={Number(displayLength(comparisonToleranceMm, units).toFixed(units === 'millimeters' ? 3 : 4))}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (Number.isFinite(value) && value >= 0) {
                    setComparisonToleranceMm(commitLength(value, units));
                  }
                }}
                className="w-14 bg-transparent text-right font-mono text-ink outline-none"
              />
              {lengthUnitLabel(units)}
            </label>
            {simulation && simulationResolution && (
              <span
                data-testid="cam-simulation-resolution"
                title={`3D stock preview grid: ${simulation.dimensions.join(' × ')} cells. Displayed edges and remaining-stock measurements can vary by about one ${simulationResolution} cell.`}
                className="rounded border border-edge bg-panel px-2 py-1 font-mono text-[9px] text-mute"
              >
                3D detail {simulationResolution}
              </span>
            )}
            <button
              type="button"
              disabled={!setup}
              title="Regenerate toolpath"
              onClick={() => setGeneration((value) => value + 1)}
              className="drawing-mini-button disabled:cursor-not-allowed disabled:opacity-40"
            >
              <RefreshCw size={14} className={busy ? 'animate-spin' : ''} />
            </button>
            <button
              type="button"
              disabled={!program || busy || simulationBusy}
              title="Predict stock removal from our CAM toolpaths"
              onClick={regenerateCamSimulation}
              className={`flex h-7 items-center gap-1.5 rounded border px-2.5 text-[10px] font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${
                simulationInput.kind === 'cam'
                  ? 'border-accent/45 bg-accent/10 text-accent'
                  : 'border-edge bg-panel text-mute hover:border-accent/40 hover:text-accent'
              }`}
            >
              <Cuboid size={13} className={simulationBusy ? 'animate-pulse' : ''} /> CAM Sim
            </button>
            <button
              type="button"
              disabled={!setup || simulationBusy}
              title="Simulate a final NC program against this setup's stock and tools"
              onClick={() => setGcodeDialogOpen(true)}
              className={`flex h-7 items-center gap-1.5 rounded border px-2.5 text-[10px] font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${
                simulationInput.kind === 'gcode'
                  ? 'border-accent/45 bg-accent/10 text-accent'
                  : 'border-edge bg-panel text-mute hover:border-accent/40 hover:text-accent'
              }`}
            >
              <FileCode2 size={13} /> NC Sim
            </button>
            <button
              type="button"
              disabled={!setup}
              title="Overlay the finished model as a faint X-ray reference; with X-Ray off, the simulation shows only remaining stock"
              onClick={() => useAppStore.getState().setCamXrayModel(!xrayModel)}
              className={`flex h-7 items-center gap-1.5 rounded border px-2.5 text-[10px] font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${
                xrayModel
                  ? 'border-accent/50 bg-accent/15 text-accent'
                  : 'border-edge bg-panel text-mute hover:border-accent/40 hover:text-accent'
              }`}
              data-testid="cam-xray-toggle"
            >
              <ScanEye size={13} /> X-Ray
            </button>
            <button
              type="button"
              disabled={!program || busy}
              title="Choose post settings and export the NC program"
              onClick={() => useAppStore.getState().setCamDialog({ type: 'post' })}
              className="flex h-7 items-center gap-1.5 rounded border border-accent/40 bg-accent/10 px-2.5 text-[10px] font-semibold text-accent hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Download size={13} /> Post NC
            </button>
          </div>
        </div>
        <div className="relative min-h-0 flex-1 overflow-hidden">
          {/* The manufacturing tab shares the modeling viewport outright:
              same navigation, same grid, same model. CAM adds its overlays
              (stock, WCS, toolpaths, simulated stock) through the viewport's
              transient preview channel. */}
          <StableViewport key={resolvedTheme} />
          {pick && (
            <div className="pointer-events-none absolute left-1/2 top-3 z-10 max-w-[80%] -translate-x-1/2 rounded border border-accent/50 bg-header/90 px-3 py-1.5 text-center text-[11px] text-accent shadow-xl backdrop-blur-sm">
              {pick.prompt} · click a highlighted point · Esc to cancel
            </div>
          )}
          {simulationTimeline && simulationPlayback && (
            <SimulationPlaybackControls
              timeline={simulationTimeline}
              playback={simulationPlayback}
              buffering={simulationFrameBusy}
              onToggle={togglePlayback}
              onReset={() => seekPlayback(0)}
              onSeek={seekPlayback}
              onSpeed={(speed) => useAppStore.getState().setCamSimulationPlayback({
                ...simulationPlayback,
                speed,
              })}
            />
          )}
          {simulation?.comparison && (
            <SimulationVerificationPanel
              simulation={simulation}
              units={units}
              scopeName={verificationScopeName}
              displaySimplified={presentationWarnings.length > 0}
            />
          )}
          {/* Machining-time readout: the selected operation's own totals when
              one is selected, otherwise the whole setup's program. */}
          {program && (
            <div
              data-testid="cam-machining-time"
              className="pointer-events-none absolute bottom-3 right-3 z-10 rounded border border-edge bg-header/85 px-2.5 py-1 font-mono text-[10px] text-mute shadow backdrop-blur-sm"
            >
              {operation
                ? `${operation.name} | Machining time: ${formatMachiningTime(program.per_operation.find((entry) => entry.operation_id === operation.id)?.estimated_seconds)}`
                : `${program.name} | Total machining time: ${formatMachiningTime(program.stats.estimated_seconds)}`}
            </div>
          )}
          {(planError
            || simulationError
            || programWarnings.length
            || simulationWarnings.length
            || (simulationTimeline?.collisions.length ?? simulation?.collisions.length)) && (
            <div className="absolute bottom-3 left-3 max-h-48 max-w-3xl overflow-y-auto rounded border border-[#d69b45]/45 bg-[#2a2117]/95 p-2.5 text-[10px] text-[#e8c589] shadow-lg">
              <div className="flex items-start gap-2">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <div>
                  {planError && <div className="font-semibold text-[#ffbd66]">{planError}</div>}
                  {simulationError && <div className="font-semibold text-[#ffbd66]">{simulationError}</div>}
                  {(simulationTimeline?.collisions ?? simulation?.collisions ?? []).map((collision) => {
                    const step = simulationTimeline?.steps.find(
                      (candidate) => candidate.command_index === collision.command_index,
                    );
                    const location = step?.source_line != null
                      ? `Block ${step.source_line}`
                      : `Move ${collision.command_index + 1}`;
                    return (
                      <button
                        type="button"
                        key={`${collision.kind}-${collision.command_index}-${collision.message}`}
                        disabled={!step}
                        onClick={() => step && seekPlayback(step.cumulative_seconds)}
                        title={step ? `Jump to ${location}` : undefined}
                        className={`block text-left font-semibold hover:underline disabled:no-underline ${
                          collision.kind === 'target_gouge' ? 'text-[#ff75a8]' : 'text-[#e8c589]'
                        }`}
                      >
                        {collision.message} · {location}
                      </button>
                    );
                  })}
                  {programWarnings.map((warning) => <div key={warning}>{warning}</div>)}
                  {simulationWarnings.map((warning) => <div key={warning}>{warning}</div>)}
                </div>
              </div>
            </div>
          )}
        </div>
      </section>
      {/* No right sidebar in the manufacturing workspace: setup and
          operation configuration live in double-click dialogs. */}
      <CamDialogHost />
      {gcodeDialogOpen && (
        <CamGcodeSimulationDialog
          initial={simulationInput.kind === 'gcode' ? simulationInput : null}
          onClose={() => setGcodeDialogOpen(false)}
          onRun={runGcodeSimulation}
        />
      )}
    </div>
  );
}

/** Renders the active manufacturing editor dialog, if any. When the tool
 *  library is stacked on top as a picker, the suspended dialog underneath
 *  stays mounted so its drafts survive the round trip. Creation and editing
 *  share one dialog each — editing just seeds the same drafts from the stored
 *  setup/operation (the key re-seeds when the edit target changes). */
function CamDialogHost() {
  const dialog = useAppStore((state) => state.camDialog);
  const below = useAppStore((state) => state.camDialogBelow);
  const cam = useAppStore((state) => state.camDocument);
  if (!dialog) return null;
  const render = (state: CamDialogState) => {
    if (state.type === 'setup') {
      const setupEdit =
        state.editId != null
          ? cam.setups.find((candidate) => candidate.id === state.editId) ?? null
          : null;
      if (state.editId != null && !setupEdit) return null;
      return <CamSetupDialog key={state.editId ?? 'new'} editing={setupEdit ?? undefined} />;
    }
    if (state.type === 'operation') {
      const operationEdit = state.editId != null ? findCamOperation(cam, state.editId) : null;
      if (state.editId != null && !operationEdit) return null;
      return (
        <CamOperationDialog
          key={`${state.kind}-${state.editId ?? 'new'}`}
          kind={state.kind}
          editing={operationEdit ?? undefined}
        />
      );
    }
    if (state.type === 'post') return <CamPostDialog />;
    return <CamToolDialog toolId={state.toolId} pickFor={state.pickFor ?? null} />;
  };
  return (
    <>
      {below ? render(below) : null}
      {render(dialog)}
    </>
  );
}

function ProgramStats({ program, units }: { program: CamProgramDto; units: CamUnits }) {
  return (
    <div className="ml-2 flex items-center gap-2">
      <span className="flex items-center gap-1 rounded bg-edge/50 px-1.5 py-0.5 font-mono text-[9px]">
        <Route size={10} /> {displayLength(program.stats.cutting_distance, units).toFixed(1)} {lengthUnitLabel(units)}
      </span>
      <span className="flex items-center gap-1 rounded bg-edge/50 px-1.5 py-0.5 font-mono text-[9px]">
        <Clock3 size={10} /> {formatDuration(program.stats.estimated_seconds)}
      </span>
    </div>
  );
}

function SimulationVerificationPanel({
  simulation,
  units,
  scopeName,
  displaySimplified,
}: {
  simulation: CamSimulationResultDto;
  units: CamUnits;
  scopeName: string | null;
  displaySimplified: boolean;
}) {
  const comparison = simulation.comparison;
  if (!comparison) return null;
  const inProgress = simulation.completed_steps !== null;
  const hasTargetLoss = comparison.gouged_voxels > 0 || comparison.initial_shortfall_voxels > 0;
  const hasExcess = comparison.excess_voxels > 0;
  const status = inProgress
    ? 'In progress'
    : hasTargetLoss
      ? 'Review overcut'
      : hasExcess
        ? scopeName
          ? 'Stock remains at stage'
          : 'Stock remains'
        : 'Within tolerance';
  const statusClass = inProgress
    ? 'border-accent/45 bg-accent/10 text-accent'
    : hasTargetLoss
      ? 'border-[#ef6a62]/60 bg-[#ef6a62]/15 text-[#ff9a91]'
      : hasExcess
        ? 'border-[#e39a38]/55 bg-[#e39a38]/12 text-[#f2bb68]'
        : 'border-[#4fd17b]/55 bg-[#4fd17b]/12 text-[#7fe3a0]';
  return (
    <div
      data-testid="cam-simulation-verification"
      className="pointer-events-none absolute left-3 top-3 z-10 min-w-64 max-w-72 rounded border border-edge bg-header/90 p-2.5 text-[10px] text-mute shadow-lg backdrop-blur-sm"
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="font-semibold uppercase tracking-wide text-ink">Part verification</span>
        <span className={`rounded border px-1.5 py-0.5 text-[9px] font-semibold ${statusClass}`}>
          {status}
        </span>
      </div>
      {scopeName && (
        <div className="mb-2 rounded border border-accent/25 bg-accent/8 px-1.5 py-1 text-[9px] text-ink">
          Scope: through “{scopeName}” · compared with the finished part
        </div>
      )}
      {displaySimplified && (
        <div className="mb-2 text-[9px] font-semibold text-[#f2bb68]">
          Remaining-stock surface simplified · verification remains full-detail
        </div>
      )}
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-[9px]">
        <span className="text-[#f2bb68]">Extra stock</span>
        <span className="text-right text-ink">{formatSimulationVolume(comparison.excess_volume_mm3, units)}</span>
        <span className="text-[#ff75a8]">Overcut</span>
        <span className="text-right text-ink">{formatSimulationVolume(comparison.gouged_volume_mm3, units)}</span>
        <span>Effective band</span>
        <span className="text-right text-ink">
          ±{displayLength(comparison.effective_tolerance_mm, units).toFixed(units === 'millimeters' ? 3 : 4)} {lengthUnitLabel(units)}
        </span>
      </div>
    </div>
  );
}

function SimulationPlaybackControls({
  timeline,
  playback,
  buffering,
  onToggle,
  onReset,
  onSeek,
  onSpeed,
}: {
  timeline: CamSimulationResultDto;
  playback: CamSimulationPlaybackState;
  buffering: boolean;
  onToggle: () => void;
  onReset: () => void;
  onSeek: (time: number) => void;
  onSpeed: (speed: number) => void;
}) {
  const pose = simulationPlaybackPose(timeline, playback.time_seconds);
  const total = Math.max(0, timeline.estimated_seconds);
  return (
    <div
      data-testid="cam-simulation-playback"
      className="absolute bottom-3 left-1/2 z-20 flex w-[min(720px,calc(100%-32px))] -translate-x-1/2 items-center gap-2 rounded border border-edge bg-header/92 px-2.5 py-2 shadow-xl backdrop-blur-sm"
    >
      <span className="shrink-0 rounded bg-accent/15 px-1.5 py-1 text-[9px] font-semibold uppercase tracking-wide text-accent">
        {timeline.source === 'g_code' ? 'NC program' : 'CAM prediction'}
      </span>
      <button
        type="button"
        onClick={onReset}
        title="Return to the beginning"
        className="drawing-mini-button"
      >
        <RotateCcw size={13} />
      </button>
      <button
        type="button"
        onClick={onToggle}
        title={playback.playing ? 'Pause simulation' : 'Play simulation'}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-accent/50 bg-accent/15 text-accent hover:bg-accent/25"
      >
        {playback.playing ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}
      </button>
      <input
        aria-label="Simulation time"
        type="range"
        min={0}
        max={Math.max(total, 0.001)}
        step={Math.max(total / 2000, 0.001)}
        value={Math.min(playback.time_seconds, Math.max(total, 0.001))}
        onChange={(event) => onSeek(Number(event.target.value))}
        className="min-w-0 flex-1 accent-[var(--accent)]"
      />
      <span className="w-[92px] shrink-0 text-right font-mono text-[9px] text-mute">
        {formatPlaybackTime(playback.time_seconds)} / {formatPlaybackTime(total)}
      </span>
      {pose?.sourceLine !== null && pose?.sourceLine !== undefined && (
        <span className="shrink-0 rounded border border-edge px-1.5 py-1 font-mono text-[9px] text-mute">
          Block {pose.sourceLine}
        </span>
      )}
      <select
        aria-label="Playback speed"
        value={playback.speed}
        onChange={(event) => onSpeed(Number(event.target.value))}
        className="h-7 shrink-0 rounded border border-edge bg-panel px-1.5 text-[9px] font-semibold text-mute outline-none"
      >
        <option value={0.25}>¼×</option>
        <option value={0.5}>½×</option>
        <option value={1}>1×</option>
        <option value={2}>2×</option>
        <option value={5}>5×</option>
        <option value={10}>10×</option>
      </select>
      <span
        title={buffering ? 'Updating removed stock' : 'Stock is current at this motion block'}
        className={`h-2 w-2 shrink-0 rounded-full ${buffering ? 'animate-pulse bg-warn' : 'bg-[#4fd17b]'}`}
      />
    </div>
  );
}

function completedStepsAtTime(timeline: CamSimulationResultDto, timeSeconds: number): number {
  const time = Math.max(0, Math.min(timeline.estimated_seconds, timeSeconds));
  let low = 0;
  let high = timeline.steps.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (timeline.steps[middle].cumulative_seconds <= time + 1e-9) low = middle + 1;
    else high = middle;
  }
  return low;
}

function simulationStockMesh(
  setup: CamSetupDto,
  cam: CamDocumentDto,
  scene: SolidSceneDto,
): CamStockMeshDto | null {
  const bodyId = modeledStockBodyId(setup, cam);
  if (bodyId === null) return null;
  const body = scene.bodies.find((candidate) => candidate.id === bodyId);
  return body ? { positions: body.mesh.positions, indices: body.mesh.indices } : null;
}

function simulationTarget(
  setup: CamSetupDto,
  cam: CamDocumentDto,
  scene: SolidSceneDto,
  toleranceMm: number,
  cacheKey: string,
  includeMeshes: boolean,
): CamSimulationTargetDto | null {
  const bodyIds = new Set(setup.body_ids);
  const stockBodyId = modeledStockBodyId(setup, cam);
  const targetBodies = scene.bodies
    // A dedicated modeled-stock body is raw material, never the intended
    // finished part even if a legacy/default setup selection included it.
    .filter((body) => bodyIds.has(body.id) && body.id !== stockBodyId);
  if (targetBodies.length === 0) return null;
  return {
    cache_key: cacheKey,
    meshes: includeMeshes
      ? targetBodies.map((body) => ({ positions: body.mesh.positions, indices: body.mesh.indices }))
      : [],
    tolerance_mm: toleranceMm,
  };
}

function createSimulationTargetCacheKey(setupId: number): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `cam-target-${setupId}-${uuid}`;
  return `cam-target-${setupId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function simulationVoxelSize(detail: SimulationDetail, setup: CamSetupDto): number | null {
  // Every level is dimensionless: it describes samples across the stock's
  // longest side rather than a hard-coded millimetre size. Auto is a little
  // over 10x the former volumetric density (352^3 / 160^3 = 10.65).
  const extent = [
    setup.stock.max.x - setup.stock.min.x,
    setup.stock.max.y - setup.stock.min.y,
    setup.stock.max.z - setup.stock.min.z,
  ];
  const longestSide = Math.max(...extent);
  const cellsAcross = detail === 'fine'
    ? 512
    : detail === 'balanced'
      ? 256
      : detail === 'fast'
        ? 128
        : 352;
  return longestSide / cellsAcross;
}

function simulationVoxelBudget(detail: SimulationDetail): number | null {
  if (detail === 'fine' || detail === 'auto') return 8_000_000;
  if (detail === 'balanced') return 4_000_000;
  return 1_000_000;
}

function formatPlaybackTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—';
  const value = Math.max(0, seconds);
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const rest = value % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${rest.toFixed(1).padStart(4, '0')}`
    : `${minutes}:${rest.toFixed(1).padStart(4, '0')}`;
}

function formatSimulationResolution(simulation: CamSimulationResultDto, units: CamUnits): string {
  const edge = Math.max(...simulation.cell_size);
  const precision = units === 'millimeters' ? 3 : 4;
  return `${displayLength(edge, units).toFixed(precision)} ${lengthUnitLabel(units)}`;
}

function formatSimulationVolume(volumeMm3: number, units: CamUnits): string {
  if (!Number.isFinite(volumeMm3)) return '—';
  if (units === 'inches') return `${(volumeMm3 / (25.4 ** 3)).toFixed(4)} in³`;
  return `${volumeMm3.toFixed(volumeMm3 < 10 ? 2 : 1)} mm³`;
}

const WORK_OFFSETS = ['g54', 'g55', 'g56', 'g57', 'g58', 'g59'] as const;

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—';
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}m ${remainder}s`;
}

/** Machinist-style h:mm:ss readout for the manufacturing status line. */
function formatMachiningTime(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return '—';
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}
