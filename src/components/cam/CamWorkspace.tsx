import { useEffect, useState } from 'react';
import { AlertTriangle, Clock3, Cuboid, Download, RefreshCw, Route, ScanEye } from 'lucide-react';
import { activeCamSetup, findCamOperation, setCamUnits } from '../../cam/document';
import { displayLength, lengthUnitLabel } from '../../cam/units';
import { getEngine } from '../../engine';
import type { CamProgramDto, CamUnits } from '../../engine/types';
import { cancelCamPointPick } from '../../cam/pointPick';
import { useAppStore, type CamDialogState } from '../../store/appStore';
import { Viewport } from '../viewport/Viewport';
import { runCamAction } from './CamBrowser';
import { CamOperationDialog } from './CamOperationDialog';
import { CamPostDialog } from './CamPostDialog';
import { CamSetupDialog } from './CamSetupDialog';
import { CamToolDialog } from './CamToolDialog';

export function CamWorkspace() {
  const cam = useAppStore((state) => state.camDocument);
  const scene = useAppStore((state) => state.solidScene);
  const selectedOperationId = useAppStore((state) => state.selectedCamOperationId);
  // The planned program and volumetric simulation live in the store so the
  // shared viewport's overlay collector can read them between React renders.
  const program = useAppStore((state) => state.camProgram);
  const simulation = useAppStore((state) => state.camSimulation);
  const xrayModel = useAppStore((state) => state.camXrayModel);
  const resolvedTheme = useAppStore((state) => state.resolvedTheme);
  const pick = useAppStore((state) => state.camPointPick);
  const setup = activeCamSetup(cam);
  const operation = findCamOperation(cam, selectedOperationId);
  const units = cam.units;
  const [planError, setPlanError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const [busy, setBusy] = useState(false);
  const [simulationError, setSimulationError] = useState<string | null>(null);
  const [simulationGeneration, setSimulationGeneration] = useState(0);
  const [simulationBusy, setSimulationBusy] = useState(false);

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
    useAppStore.getState().setCamSimulation(null);
    setSimulationError(null);
  }, [cam]);

  useEffect(() => {
    const { setCamSimulation } = useAppStore.getState();
    // A stale result must never paint over a freshly selected setup.
    setCamSimulation(null);
    if (!setup) return;
    let cancelled = false;
    setSimulationBusy(true);
    // Modeled-body stock is voxelized from the body's live mesh, which the
    // host owns; every other stock shape is fully described by the setup.
    const stockMesh =
      setup.resolved_stock.shape === 'model_body'
        ? (() => {
            const body = scene.bodies.find(
              (candidate) => candidate.id === (setup.resolved_stock as { body_id: number }).body_id,
            );
            return body
              ? { positions: body.mesh.positions, indices: body.mesh.indices }
              : null;
          })()
        : null;
    void getEngine()
      .then((engine) =>
        // The remaining-stock view of a selected operation must not include
        // material later operations have not removed yet: simulate only
        // through the selection (in setup order). No selection → whole setup.
        engine.camSimulate({
          setup_id: setup.id,
          stock_mesh: stockMesh,
          through_operation_id: selectedOperationId,
        }),
      )
      .then((next) => {
        if (cancelled) return;
        setCamSimulation(next);
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
  }, [setup?.id, simulationGeneration, scene, selectedOperationId]);

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
              title="Regenerate volumetric stock simulation"
              onClick={() => setSimulationGeneration((value) => value + 1)}
              className="flex h-7 items-center gap-1.5 rounded border border-edge bg-panel px-2.5 text-[10px] font-semibold text-mute hover:border-accent/40 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Cuboid size={13} className={simulationBusy ? 'animate-pulse' : ''} /> 3D Sim
            </button>
            <button
              type="button"
              disabled={!setup}
              title="See-through: ghost the part to a wireframe shell while reviewing a simulated operation, so machined surfaces show through"
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
          <Viewport key={resolvedTheme} />
          {pick && (
            <div className="pointer-events-none absolute left-1/2 top-3 z-10 max-w-[80%] -translate-x-1/2 rounded border border-accent/50 bg-header/90 px-3 py-1.5 text-center text-[11px] text-accent shadow-xl backdrop-blur-sm">
              {pick.prompt} · click a highlighted point · Esc to cancel
            </div>
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
          {(planError || simulationError || program?.warnings.length || simulation?.collisions.length) && (
            <div className="absolute bottom-3 left-3 max-w-3xl rounded border border-[#d69b45]/45 bg-[#2a2117]/95 p-2.5 text-[10px] text-[#e8c589] shadow-lg">
              <div className="flex items-start gap-2">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <div>
                  {planError && <div className="font-semibold text-[#ffbd66]">{planError}</div>}
                  {simulationError && <div className="font-semibold text-[#ffbd66]">{simulationError}</div>}
                  {simulation?.collisions.map((collision) => (
                    <div key={`${collision.command_index}-${collision.message}`} className="font-semibold text-[#ff8f7f]">
                      {collision.message}
                    </div>
                  ))}
                  {program?.warnings.map((warning) => <div key={warning}>{warning}</div>)}
                </div>
              </div>
            </div>
          )}
        </div>
      </section>
      {/* No right sidebar in the manufacturing workspace: setup and
          operation configuration live in double-click dialogs. */}
      <CamDialogHost />
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
