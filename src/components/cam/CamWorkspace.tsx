import { useEffect, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  Clock3,
  Cuboid,
  Download,
  FileCode2,
  Gauge,
  RefreshCw,
  Route,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import {
  activeCamSetup,
  camOperationLabel,
  camToolCompatible,
  deleteCamOperation,
  findCamOperation,
  setCamUnits,
  updateCamOperation,
  updateCamSetup,
  updateCamTool,
} from '../../cam/document';
import { inspectNbPostFile } from '../../cam/nbpost';
import {
  commitFeed,
  commitLength,
  displayFeed,
  displayLength,
  feedUnitLabel,
  lengthDecimals,
  lengthUnitLabel,
} from '../../cam/units';
import { getEngine } from '../../engine';
import type {
  CamOperationDto,
  CamPoint2Dto,
  CamProgramDto,
  CamSetupDto,
  CamToolDto,
  CamUnits,
  NbPostAnalysisDto,
} from '../../engine/types';
import { cancelCamPointPick } from '../../cam/pointPick';
import { modelTopZInSetup } from '../../cam/geometry';
import { useAppStore } from '../../store/appStore';
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
      .then((engine) => engine.camSimulate({ setup_id: setup.id, stock_mesh: stockMesh }))
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
  }, [setup?.id, simulationGeneration, scene]);

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

/** Renders the active manufacturing editor dialog, if any. */
function CamDialogHost() {
  const dialog = useAppStore((state) => state.camDialog);
  const cam = useAppStore((state) => state.camDocument);
  if (!dialog) return null;
  if (dialog.type === 'setup') return <CamSetupDialog />;
  if (dialog.type === 'setupEdit') {
    const setup = activeCamSetup(cam);
    return setup ? <SetupEditDialog setup={setup} units={cam.units} /> : null;
  }
  if (dialog.type === 'operation') return <CamOperationDialog kind={dialog.kind} />;
  if (dialog.type === 'operationEdit') {
    const operation = findCamOperation(cam, dialog.operationId);
    return operation ? (
      <OperationEditDialog operation={operation} tools={cam.tools} units={cam.units} />
    ) : null;
  }
  if (dialog.type === 'post') return <CamPostDialog />;
  return <CamToolDialog toolId={dialog.toolId} />;
}

/** Modal shell for editing an existing setup's configuration. */
function SetupEditDialog({ setup, units }: { setup: CamSetupDto; units: CamUnits }) {
  const close = () => useAppStore.getState().setCamDialog(null);
  return (
    <div data-native-viewport-dim="0.15" className="pointer-events-none fixed inset-0 z-[70] bg-black/15">
      <div className="feature-dialog pointer-events-auto absolute right-5 top-[132px] flex max-h-[calc(100vh-190px)] w-[340px] flex-col overflow-hidden rounded border border-edge bg-panel shadow-2xl">
        <header className="flex h-10 shrink-0 items-center gap-2 border-b border-edge px-3">
          <Gauge size={15} className="text-accent" />
          <span className="flex-1 text-xs font-semibold text-ink">Setup — {setup.name}</span>
          <button type="button" onClick={close} className="rounded p-1 text-mute hover:bg-edge hover:text-ink">
            <X size={14} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <SetupInspector setup={setup} units={units} />
        </div>
      </div>
    </div>
  );
}

/** Modal shell for editing an existing operation's parameters. */
function OperationEditDialog({
  operation,
  tools,
  units,
}: {
  operation: CamOperationDto;
  tools: CamToolDto[];
  units: CamUnits;
}) {
  const close = () => useAppStore.getState().setCamDialog(null);
  return (
    <div data-native-viewport-dim="0.15" className="pointer-events-none fixed inset-0 z-[70] bg-black/15">
      <div className="feature-dialog pointer-events-auto absolute right-5 top-[132px] flex max-h-[calc(100vh-190px)] w-[340px] flex-col overflow-hidden rounded border border-edge bg-panel shadow-2xl">
        <header className="flex h-10 shrink-0 items-center gap-2 border-b border-edge px-3">
          <Wrench size={15} className="text-accent" />
          <span className="flex-1 text-xs font-semibold text-ink">{operation.name}</span>
          <button type="button" onClick={close} className="rounded p-1 text-mute hover:bg-edge hover:text-ink">
            <X size={14} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <OperationInspector operation={operation} tools={tools} units={units} />
        </div>
      </div>
    </div>
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

/** One-line description of the resolved stock shape, with key dimensions. */
function stockSummary(setup: CamSetupDto, units: CamUnits): string {
  const stock = setup.resolved_stock;
  switch (stock.shape) {
    case 'box':
      return 'Box stock';
    case 'cylinder':
      return `Cylindrical stock · Ø${fmtLength(stock.radius * 2, units)}`;
    case 'hex':
      return `Hex bar stock · ${fmtLength(stock.across_flats, units)} across flats`;
    case 'rest':
      return `Remaining stock from setup ${stock.source_setup_id}`;
    case 'model_body':
      return `Modeled body #${stock.body_id} as stock`;
  }
}

/** One-line description of how the operator defined the stock. */
function stockSpecSummary(setup: CamSetupDto): string {
  switch (setup.stock_spec.mode) {
    case 'fixed':
      return setup.stock_spec.placement.center
        ? 'Fixed size, model centered inside.'
        : 'Fixed size, model parked against a face.';
    case 'from_model':
      return 'Grown from the model bounding box with per-face allowances.';
    case 'rest_from_setup':
      return 'Continues from the earlier setup’s remaining material.';
    case 'model_body':
      return 'A modeled body supplies the stock shape.';
    case 'legacy_box':
      return 'Legacy stock box; edit the setup to redefine it.';
  }
}

function SetupInspector({ setup, units }: { setup: CamSetupDto; units: CamUnits }) {
  const [postAnalysis, setPostAnalysis] = useState<NbPostAnalysisDto | null>(null);
  const [postAnalysisBusy, setPostAnalysisBusy] = useState(false);

  const inspectPost = async () => {
    setPostAnalysisBusy(true);
    try {
      const analysis = await inspectNbPostFile();
      if (analysis) setPostAnalysis(analysis);
    } finally {
      setPostAnalysisBusy(false);
    }
  };

  return (
    <InspectorSection title="SETUP" icon={<Gauge size={13} />}>
      <Field label="Name">
        <CommitText value={setup.name} onCommit={(value) => updateCamSetup(setup.id, (next) => { next.name = value; })} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="First work offset">
          <select
            value={setup.work_offset}
            onChange={(event) => runCamAction(() => updateCamSetup(setup.id, (next) => {
              next.work_offset = event.target.value as CamSetupDto['work_offset'];
              // Keep first + count within G54..G59.
              const index = WORK_OFFSETS.indexOf(next.work_offset);
              next.work_offset_count = Math.min(next.work_offset_count, WORK_OFFSETS.length - index);
            }))}
            className="cam-input"
          >
            {WORK_OFFSETS.map((offset) => (
              <option key={offset} value={offset}>{offset.toUpperCase()}</option>
            ))}
          </select>
        </Field>
        <NumberField
          label="Duplicate parts"
          value={setup.work_offset_count}
          unit="offsets"
          integer
          onCommit={(value) => updateCamSetup(setup.id, (next) => {
            const index = WORK_OFFSETS.indexOf(next.work_offset);
            next.work_offset_count = Math.max(1, Math.min(WORK_OFFSETS.length - index, Math.round(value)));
          })}
        />
      </div>
      {setup.work_offset_count > 1 && (
        <p className="text-[9px] leading-relaxed text-mute">
          Posting repeats the toolpaths under {setup.work_offset_count} consecutive offsets:{' '}
          {WORK_OFFSETS.slice(
            WORK_OFFSETS.indexOf(setup.work_offset),
            WORK_OFFSETS.indexOf(setup.work_offset) + setup.work_offset_count,
          ).map((offset) => offset.toUpperCase()).join(', ')}.
        </p>
      )}
      <InspectorSubheading>Stock</InspectorSubheading>
      <div className="rounded border border-edge bg-header/55 p-2 text-[10px] text-mute">
        <div className="mb-1 font-semibold text-ink">{stockSummary(setup, units)}</div>
        <div className="text-[9px] leading-relaxed">{stockSpecSummary(setup)}</div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Readout label="X size" text={fmtLength(setup.stock.max.x - setup.stock.min.x, units)} />
        <Readout label="Y size" text={fmtLength(setup.stock.max.y - setup.stock.min.y, units)} />
        <Readout label="Z size" text={fmtLength(setup.stock.max.z - setup.stock.min.z, units)} />
      </div>
      <InspectorSubheading>WCS origin in model</InspectorSubheading>
      <div className="grid grid-cols-3 gap-2">
        <Readout label="X" text={fmtLength(setup.wcs.origin.x, units)} />
        <Readout label="Y" text={fmtLength(setup.wcs.origin.y, units)} />
        <Readout label="Z" text={fmtLength(setup.wcs.origin.z, units)} />
      </div>
      <p className="mt-3 text-[10px] leading-relaxed text-mute">
        Toolpaths are planned in this fixed-axis frame and posted in {units === 'millimeters' ? 'millimetres' : 'inches'}. Set the same stock-top origin and work offset on the machine.
      </p>
      <InspectorSubheading>.NBPOST COMPATIBILITY</InspectorSubheading>
      <button
        type="button"
        disabled={postAnalysisBusy}
        onClick={() => runCamAction(inspectPost)}
        className="flex h-7 w-full items-center justify-center gap-1.5 rounded border border-edge bg-header/45 text-[10px] font-semibold text-mute hover:border-accent/40 hover:text-accent disabled:opacity-40"
      >
        <FileCode2 size={13} /> {postAnalysisBusy ? 'Inspecting…' : 'Inspect .nbpost'}
      </button>
      <p className="mt-2 text-[9px] leading-relaxed text-mute">
        Rename a post you are entitled to use to <span className="font-mono text-ink">.nbpost</span>. Inspection is local and non-executing; renaming does not change its license.
      </p>
      {postAnalysis && (
        <div className="mt-2 rounded border border-edge bg-header/45 p-2 text-[9px] leading-relaxed text-mute">
          <div className="truncate font-semibold text-ink">{postAnalysis.file_name}</div>
          <div>
            {postAnalysis.source_kind === 'callback_javascript' ? 'Supported callback shape detected' : 'Post shape not recognized'} · {postAnalysis.callbacks.length} callbacks
          </div>
          <div className="mt-1 text-[#e8c589]">
            Analysis only—script execution remains disabled until the compatibility sandbox is complete.
          </div>
          {postAnalysis.callbacks_outside_v1_target.length > 0 && (
            <div className="mt-1 break-words">
              Beyond fixed 3-axis v1: {postAnalysis.callbacks_outside_v1_target.join(', ')}
            </div>
          )}
        </div>
      )}
    </InspectorSection>
  );
}

function OperationInspector({ operation, tools, units }: { operation: CamOperationDto; tools: CamToolDto[]; units: CamUnits }) {
  const tool = tools.find((candidate) => candidate.id === operation.tool_id) ?? null;
  const compatibleTools = tools.filter((candidate) =>
    camToolCompatible(
      operation.kind,
      candidate,
      operation.kind === 'drill' ? operation.cycle : undefined,
    ),
  );
  const update = (mutate: (next: CamOperationDto) => void) =>
    updateCamOperation(operation.id, mutate);

  return (
    <InspectorSection title={camOperationLabel(operation.kind).toUpperCase()} icon={<Wrench size={13} />}>
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Field label="Name"><CommitText value={operation.name} onCommit={(value) => update((next) => { next.name = value; })} /></Field>
        </div>
        <label className="mb-0.5 flex h-7 items-center gap-1.5 rounded border border-edge px-2 text-[10px] text-mute">
          <input type="checkbox" checked={operation.enabled} onChange={(event) => runCamAction(() => update((next) => { next.enabled = event.target.checked; }))} />
          Enabled
        </label>
      </div>
      <Field label="Tool">
        <select value={operation.tool_id} onChange={(event) => runCamAction(() => update((next) => { next.tool_id = Number(event.target.value); }))} className="cam-input">
          {compatibleTools.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.number != null ? `T${candidate.number} · ` : ''}{candidate.name}</option>)}
        </select>
      </Field>
      {tool && (
        <div className="rounded border border-edge bg-header/55 p-2">
          <div className="mb-2 flex items-center gap-2 text-[10px] text-mute">
            <Wrench size={11} /> TOOL GEOMETRY · PROJECT COPY
          </div>
          <div className="grid grid-cols-2 gap-2">
            <LengthField label="Diameter" valueMm={tool.diameter} units={units} onCommit={(value) => updateCamTool(tool.id, (next) => { next.diameter = value; })} />
            <LengthField label="Flute length" valueMm={tool.flute_length} units={units} onCommit={(value) => updateCamTool(tool.id, (next) => { next.flute_length = value; })} />
          </div>
          <p className="mt-1.5 text-[9px] leading-relaxed text-mute/70">
            Edits stay in this project; push them to the central library from the Tool Library dialog if they should apply everywhere.
          </p>
        </div>
      )}
      <InspectorSubheading>Safe heights</InspectorSubheading>
      <div className="grid grid-cols-2 gap-2">
        <LengthField label="Clearance Z" valueMm={operation.clearance_z} units={units} onCommit={(value) => update((next) => { next.clearance_z = value; })} />
        <LengthField label="Retract Z" valueMm={operation.retract_z} units={units} onCommit={(value) => update((next) => { next.retract_z = value; })} />
      </div>
      <InspectorSubheading>Speeds &amp; feeds</InspectorSubheading>
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="Spindle" value={operation.cutting.spindle_rpm} unit="rpm" integer onCommit={(value) => update((next) => { next.cutting.spindle_rpm = value; })} />
        <Field label="Coolant">
          <select value={operation.cutting.coolant} onChange={(event) => runCamAction(() => update((next) => { next.cutting.coolant = event.target.value as CamOperationDto['cutting']['coolant']; }))} className="cam-input">
            <option value="off">Off</option><option value="mist">Mist</option><option value="flood">Flood</option>
          </select>
        </Field>
        <FeedField label="Cut feed" valueMmPerMin={operation.cutting.feed_xy} units={units} onCommit={(value) => update((next) => { next.cutting.feed_xy = value; })} />
        <FeedField label="Plunge feed" valueMmPerMin={operation.cutting.feed_z} units={units} onCommit={(value) => update((next) => { next.cutting.feed_z = value; })} />
      </div>
      <InspectorSubheading>Passes</InspectorSubheading>
      {operation.kind === 'face' && <FaceFields operation={operation} units={units} update={update} />}
      {operation.kind === 'contour2d' && <ContourFields operation={operation} units={units} update={update} />}
      {operation.kind === 'pocket2d' && <PocketFields operation={operation} units={units} update={update} />}
      {operation.kind === 'chamfer2d' && <ChamferFields operation={operation} units={units} update={update} />}
      {operation.kind === 'drill' && <DrillFields operation={operation} units={units} update={update} />}
      {operation.kind === 'thread' && <ThreadFields operation={operation} units={units} update={update} />}
      <button type="button" onClick={() => runCamAction(() => deleteCamOperation(operation.id))} className="mt-5 flex h-7 w-full items-center justify-center gap-1.5 rounded border border-warn/30 text-[10px] text-warn hover:bg-warn/10">
        <Trash2 size={12} /> Delete operation
      </button>
    </InspectorSection>
  );
}

type FaceOperation = Extract<CamOperationDto, { kind: 'face' }>;
type ContourOperation = Extract<CamOperationDto, { kind: 'contour2d' }>;
type PocketOperation = Extract<CamOperationDto, { kind: 'pocket2d' }>;
type ChamferOperation = Extract<CamOperationDto, { kind: 'chamfer2d' }>;
type DrillOperation = Extract<CamOperationDto, { kind: 'drill' }>;
type ThreadOperation = Extract<CamOperationDto, { kind: 'thread' }>;
type OperationUpdate = (mutate: (next: CamOperationDto) => void) => Promise<void>;

function FaceFields({ operation, units, update }: { operation: FaceOperation; units: CamUnits; update: OperationUpdate }) {
  const scene = useAppStore((state) => state.solidScene);
  const setup = useAppStore((state) => activeCamSetup(state.camDocument));
  // Face targets read as a depth below the model top surface; the stored
  // value stays absolute setup Z.
  const modelTop = setup ? modelTopZInSetup(scene, setup) : null;
  return <div className="grid grid-cols-2 gap-2">
    <LengthField label="Top Z" valueMm={operation.top_z} units={units} onCommit={(value) => update((next) => { if (next.kind === 'face') next.top_z = value; })} />
    {modelTop !== null ? (
      <LengthField label="Depth below model top" valueMm={modelTop - operation.target_z} units={units} onCommit={(value) => update((next) => { if (next.kind === 'face') next.target_z = modelTop - value; })} />
    ) : (
      <LengthField label="Target Z" valueMm={operation.target_z} units={units} onCommit={(value) => update((next) => { if (next.kind === 'face') next.target_z = value; })} />
    )}
    <LengthField label="Stepover" valueMm={operation.step_over} units={units} onCommit={(value) => update((next) => { if (next.kind === 'face') next.step_over = value; })} />
    <LengthField label="Stepdown" valueMm={operation.step_down} units={units} onCommit={(value) => update((next) => { if (next.kind === 'face') next.step_down = value; })} />
  </div>;
}

function ContourFields({ operation, units, update }: { operation: ContourOperation; units: CamUnits; update: OperationUpdate }) {
  return <>
    <div className="grid grid-cols-2 gap-2">
      <LengthField label="Top Z" valueMm={operation.top_z} units={units} onCommit={(value) => update((next) => { if (next.kind === 'contour2d') next.top_z = value; })} />
      <LengthField label="Bottom Z" valueMm={operation.bottom_z} units={units} onCommit={(value) => update((next) => { if (next.kind === 'contour2d') next.bottom_z = value; })} />
      <LengthField label="Stepdown" valueMm={operation.step_down} units={units} onCommit={(value) => update((next) => { if (next.kind === 'contour2d') next.step_down = value; })} />
      <Field label="Tool side"><select value={operation.compensation} onChange={(event) => runCamAction(() => update((next) => { if (next.kind === 'contour2d') next.compensation = event.target.value as ContourOperation['compensation']; }))} className="cam-input"><option value="outside">Outside</option><option value="inside">Inside</option><option value="on">On path</option></select></Field>
    </div>
    <Field label={`Closed path · one X,Y point per line · ${lengthUnitLabel(units)}`}><CommitPoints value={operation.path} units={units} onCommit={(points) => update((next) => { if (next.kind === 'contour2d') next.path = points; })} /></Field>
  </>;
}

function PocketFields({ operation, units, update }: { operation: PocketOperation; units: CamUnits; update: OperationUpdate }) {
  return <>
    <div className="grid grid-cols-2 gap-2">
      <LengthField label="Top Z" valueMm={operation.top_z} units={units} onCommit={(value) => update((next) => { if (next.kind === 'pocket2d') next.top_z = value; })} />
      <LengthField label="Bottom Z" valueMm={operation.bottom_z} units={units} onCommit={(value) => update((next) => { if (next.kind === 'pocket2d') next.bottom_z = value; })} />
      <LengthField label="Stepdown" valueMm={operation.step_down} units={units} onCommit={(value) => update((next) => { if (next.kind === 'pocket2d') next.step_down = value; })} />
      <LengthField label="Stepover" valueMm={operation.step_over} units={units} onCommit={(value) => update((next) => { if (next.kind === 'pocket2d') next.step_over = value; })} />
    </div>
    <Field label={`Closed outline · one X,Y point per line · ${lengthUnitLabel(units)}`}><CommitPoints value={operation.outline} units={units} onCommit={(points) => update((next) => { if (next.kind === 'pocket2d') next.outline = points; })} /></Field>
  </>;
}

function ChamferFields({ operation, units, update }: { operation: ChamferOperation; units: CamUnits; update: OperationUpdate }) {
  return <>
    <div className="grid grid-cols-2 gap-2">
      <LengthField label="Top edge Z" valueMm={operation.top_z} units={units} onCommit={(value) => update((next) => { if (next.kind === 'chamfer2d') next.top_z = value; })} />
      <LengthField label="Chamfer width" valueMm={operation.chamfer_width} units={units} onCommit={(value) => update((next) => { if (next.kind === 'chamfer2d') next.chamfer_width = value; })} />
      <LengthField label="Tip offset" valueMm={operation.tip_offset} units={units} onCommit={(value) => update((next) => { if (next.kind === 'chamfer2d') next.tip_offset = value; })} />
      <Field label="Material side"><select value={operation.wall_side} onChange={(event) => runCamAction(() => update((next) => { if (next.kind === 'chamfer2d') next.wall_side = event.target.value as ChamferOperation['wall_side']; }))} className="cam-input"><option value="outside">Outside of path</option><option value="inside">Inside of path</option></select></Field>
    </div>
    <Field label={`Edge path · one X,Y point per line · ${lengthUnitLabel(units)}`}><CommitPoints value={operation.path} units={units} onCommit={(points) => update((next) => { if (next.kind === 'chamfer2d') next.path = points; })} /></Field>
  </>;
}

const DRILL_CYCLE_LABELS: Record<DrillOperation['cycle'], string> = {
  drill: 'Drilling — rapid out',
  chip_breaking: 'Chip breaking — partial retract',
  deep_hole: 'Deep drilling — full retract',
  tapping_right: 'Tapping — right hand',
  tapping_left: 'Tapping — left hand',
  reaming: 'Reaming — feed out',
  boring: 'Boring — dwell and feed out',
};

function DrillFields({ operation, units, update }: { operation: DrillOperation; units: CamUnits; update: OperationUpdate }) {
  const cycle = operation.cycle;
  const pecking = cycle === 'chip_breaking' || cycle === 'deep_hole';
  const tapping = cycle === 'tapping_right' || cycle === 'tapping_left';
  const feedingOut = cycle === 'reaming' || cycle === 'boring';
  return <>
    <div className="grid grid-cols-2 gap-2">
      <Field label="Cycle"><select value={cycle} onChange={(event) => runCamAction(() => update((next) => {
        if (next.kind === 'drill') {
          next.cycle = event.target.value as DrillOperation['cycle'];
          // Scrub fields that the new cycle rejects so validation cannot fail
          // on a stale carry-over.
          const nowPecking = next.cycle === 'chip_breaking' || next.cycle === 'deep_hole';
          const nowTapping = next.cycle === 'tapping_right' || next.cycle === 'tapping_left';
          const nowFeedingOut = next.cycle === 'reaming' || next.cycle === 'boring';
          if (!nowPecking) { next.peck_depth = null; next.peck_retract = null; }
          if (next.cycle !== 'chip_breaking') next.peck_retract = null;
          if (!nowTapping) next.thread_pitch = null;
          if (!nowFeedingOut) next.feed_out = null;
        }
      }))} className="cam-input">
        {(Object.keys(DRILL_CYCLE_LABELS) as DrillOperation['cycle'][]).map((candidate) => (
          <option key={candidate} value={candidate}>{DRILL_CYCLE_LABELS[candidate]}</option>
        ))}
      </select></Field>
      <LengthField label="Top Z" valueMm={operation.top_z} units={units} onCommit={(value) => update((next) => { if (next.kind === 'drill') next.top_z = value; })} />
      <LengthField label="Bottom Z" valueMm={operation.bottom_z} units={units} onCommit={(value) => update((next) => { if (next.kind === 'drill') next.bottom_z = value; })} />
      {pecking && (
        <OptionalLengthField label="Peck depth" valueMm={operation.peck_depth} units={units} onCommit={(value) => update((next) => { if (next.kind === 'drill') next.peck_depth = value; })} />
      )}
      {cycle === 'chip_breaking' && (
        <OptionalLengthField label="Peck retract" valueMm={operation.peck_retract} units={units} onCommit={(value) => update((next) => { if (next.kind === 'drill') next.peck_retract = value; })} />
      )}
      {tapping && (
        <OptionalLengthField label="Thread pitch" valueMm={operation.thread_pitch} units={units} onCommit={(value) => update((next) => { if (next.kind === 'drill') next.thread_pitch = value; })} />
      )}
      {feedingOut && (
        <OptionalLengthField label="Feed out" valueMm={operation.feed_out} units={units} onCommit={(value) => update((next) => { if (next.kind === 'drill') next.feed_out = value; })} />
      )}
      {!tapping && (
        <NumberField label="Dwell" value={operation.dwell_seconds} unit="sec" onCommit={(value) => update((next) => { if (next.kind === 'drill') next.dwell_seconds = value; })} />
      )}
    </div>
    <Field label={`Hole centers · one X,Y point per line · ${lengthUnitLabel(units)}`}><CommitPoints value={operation.points} units={units} onCommit={(points) => update((next) => { if (next.kind === 'drill') next.points = points; })} /></Field>
  </>;
}

function ThreadFields({ operation, units, update }: { operation: ThreadOperation; units: CamUnits; update: OperationUpdate }) {
  return <>
    <div className="grid grid-cols-2 gap-2">
      <LengthField label="Top Z" valueMm={operation.top_z} units={units} onCommit={(value) => update((next) => { if (next.kind === 'thread') next.top_z = value; })} />
      <LengthField label="Bottom Z" valueMm={operation.bottom_z} units={units} onCommit={(value) => update((next) => { if (next.kind === 'thread') next.bottom_z = value; })} />
      <LengthField label="Pitch" valueMm={operation.pitch} units={units} onCommit={(value) => update((next) => { if (next.kind === 'thread') next.pitch = value; })} />
      <Field label="Hand"><select value={operation.hand} onChange={(event) => runCamAction(() => update((next) => { if (next.kind === 'thread') next.hand = event.target.value as ThreadOperation['hand']; }))} className="cam-input"><option value="right">Right hand</option><option value="left">Left hand</option></select></Field>
      <LengthField label="Major Ø" valueMm={operation.major_diameter} units={units} onCommit={(value) => update((next) => { if (next.kind === 'thread') next.major_diameter = value; })} />
      <LengthField label="Minor Ø" valueMm={operation.minor_diameter} units={units} onCommit={(value) => update((next) => { if (next.kind === 'thread') next.minor_diameter = value; })} />
      <Field label="Direction"><select value={operation.direction} onChange={(event) => runCamAction(() => update((next) => { if (next.kind === 'thread') next.direction = event.target.value as ThreadOperation['direction']; }))} className="cam-input"><option value="climb">Climb</option><option value="conventional">Conventional</option></select></Field>
      <NumberField label="Radial passes" value={operation.radial_passes} unit="passes" integer onCommit={(value) => update((next) => {
        if (next.kind === 'thread') {
          const passes = Math.max(1, Math.min(20, Math.round(value)));
          next.radial_passes = passes;
          // Scrub fields the new pass count rejects so validation cannot fail
          // on a stale carry-over; seed a stepover that splits the radial
          // allowance when single-pass becomes multi-pass.
          if (passes <= 1) next.step_over = null;
          else if (next.step_over === null) {
            next.step_over = Math.max(0.05, (next.major_diameter - next.minor_diameter) / 2 / passes);
          }
        }
      })} />
      {operation.radial_passes > 1 && (
        <LengthField label="Radial stepover" valueMm={operation.step_over ?? 0} units={units} onCommit={(value) => update((next) => { if (next.kind === 'thread') next.step_over = value; })} />
      )}
    </div>
    <Field label={`Hole centers · one X,Y point per line · ${lengthUnitLabel(units)}`}><CommitPoints value={operation.points} units={units} onCommit={(points) => update((next) => { if (next.kind === 'thread') next.points = points; })} /></Field>
  </>;
}

function InspectorSection({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return <div className="p-3">
    <div className="mb-3 flex h-6 items-center gap-2 border-b border-edge pb-2 text-[10px] font-semibold tracking-[0.14em] text-mute">{icon}{title}</div>
    <div className="space-y-2.5">{children}</div>
  </div>;
}

function InspectorSubheading({ children }: { children: ReactNode }) {
  return <div className="pt-2 text-[9px] font-semibold tracking-[0.14em] text-mute/65">{children}</div>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block text-[9px] text-mute"><span className="mb-1 block">{label}</span>{children}</label>;
}

function CommitText({ value, onCommit }: { value: string; onCommit: (value: string) => Promise<void> }) {
  return <input key={value} defaultValue={value} className="cam-input" onBlur={(event) => {
    const next = event.target.value.trim();
    if (next && next !== value) runCamAction(() => onCommit(next));
  }} />;
}

/** Plain numeric field for unit-less values (rpm, seconds, indices). */
function NumberField({ label, value, unit, integer = false, onCommit }: { label: string; value: number; unit: string; integer?: boolean; onCommit: (value: number) => Promise<void> }) {
  return <Field label={label}><div className="relative"><input key={value} type="number" step={integer ? 1 : 'any'} defaultValue={integer ? Math.round(value) : value} className="cam-input pr-14 font-mono" onBlur={(event) => {
    const next = Number(event.target.value);
    if (Number.isFinite(next) && next !== value) runCamAction(() => onCommit(integer ? Math.round(next) : next));
  }} /><span className="pointer-events-none absolute right-2 top-1.5 text-[8px] text-mute/60">{unit}</span></div></Field>;
}

/** Length field: displays in the document units, commits canonical mm. */
function LengthField({ label, valueMm, units, onCommit }: { label: string; valueMm: number; units: CamUnits; onCommit: (valueMm: number) => Promise<void> }) {
  const display = Number(displayLength(valueMm, units).toFixed(lengthDecimals(units)));
  return <NumberField label={label} value={display} unit={lengthUnitLabel(units)} onCommit={(value) => onCommit(commitLength(value, units))} />;
}

/** Feed field: displays mm/min or in/min, commits canonical mm/min. */
function FeedField({ label, valueMmPerMin, units, onCommit }: { label: string; valueMmPerMin: number; units: CamUnits; onCommit: (valueMmPerMin: number) => Promise<void> }) {
  const display = Number(displayFeed(valueMmPerMin, units).toFixed(units === 'inches' ? 3 : 1));
  return <NumberField label={label} value={display} unit={feedUnitLabel(units)} onCommit={(value) => onCommit(commitFeed(value, units))} />;
}

/** Optional length field: blank clears the value, otherwise unit-aware. */
function OptionalLengthField({ label, valueMm, units, onCommit }: { label: string; valueMm: number | null; units: CamUnits; onCommit: (valueMm: number | null) => Promise<void> }) {
  const display = valueMm === null ? null : Number(displayLength(valueMm, units).toFixed(lengthDecimals(units)));
  return <OptionalNumberField label={label} value={display} unit={lengthUnitLabel(units)} onCommit={(value) => onCommit(value === null ? null : commitLength(value, units))} />;
}

function OptionalNumberField({ label, value, unit, onCommit }: { label: string; value: number | null; unit: string; onCommit: (value: number | null) => Promise<void> }) {
  return <Field label={label}><div className="relative"><input key={String(value)} type="number" step="any" defaultValue={value ?? ''} placeholder="Off" className="cam-input pr-10 font-mono" onBlur={(event) => {
    const text = event.target.value.trim();
    const next = text === '' ? null : Number(text);
    if ((next === null || Number.isFinite(next)) && next !== value) runCamAction(() => onCommit(next));
  }} /><span className="pointer-events-none absolute right-2 top-1.5 text-[8px] text-mute/60">{unit}</span></div></Field>;
}

/** Point-list editor. Points are displayed in document units and committed
 *  back as canonical mm setup coordinates. */
function CommitPoints({ value, units, onCommit }: { value: CamPoint2Dto[]; units: CamUnits; onCommit: (value: CamPoint2Dto[]) => Promise<void> }) {
  const text = value.map((point) => `${displayLength(point.x, units)}, ${displayLength(point.y, units)}`).join('\n');
  return <textarea key={text} defaultValue={text} rows={Math.min(6, Math.max(3, value.length))} className="cam-input min-h-16 resize-y font-mono leading-5" onBlur={(event) => {
    try {
      const points = parsePoints(event.target.value).map((point) => ({
        x: commitLength(point.x, units),
        y: commitLength(point.y, units),
      }));
      if (JSON.stringify(points) !== JSON.stringify(value)) runCamAction(() => onCommit(points));
    } catch (error) {
      useAppStore.getState().setConstraintDialog({ titleKey: 'file.errorTitle', message: error instanceof Error ? error.message : String(error) });
      event.target.value = text;
    }
  }} />;
}

function Readout({ label, text }: { label: string; text: string }) {
  return <div className="rounded border border-edge bg-header/60 px-2 py-1.5"><div className="text-[8px] text-mute/60">{label}</div><div className="font-mono text-[10px] text-ink">{text}</div></div>;
}

function fmtLength(valueMm: number, units: CamUnits): string {
  return displayLength(valueMm, units).toFixed(lengthDecimals(units));
}

function parsePoints(text: string): CamPoint2Dto[] {
  const points = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line, index) => {
    const values = line.split(/[\s,;]+/).filter(Boolean).map(Number);
    if (values.length !== 2 || !values.every(Number.isFinite)) throw new Error(`Point line ${index + 1} must contain finite X,Y coordinates.`);
    return { x: values[0], y: values[1] };
  });
  if (points.length === 0) throw new Error('Enter at least one point.');
  return points;
}

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
