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
} from 'lucide-react';
import {
  activeCamSetup,
  deleteCamOperation,
  findCamOperation,
  updateCamOperation,
  updateCamSetup,
  updateCamTool,
} from '../../cam/document';
import { exportActiveCamProgram } from '../../cam/export';
import { inspectNbPostFile } from '../../cam/nbpost';
import { getEngine } from '../../engine';
import type {
  CamDocumentDto,
  CamOperationDto,
  CamPoint2Dto,
  CamProgramDto,
  CamSimulationResultDto,
  CamSetupDto,
  CamToolDto,
  NbPostAnalysisDto,
  Siemens828dPostConfigDto,
} from '../../engine/types';
import { useAppStore } from '../../store/appStore';
import { runCamAction } from './CamBrowser';
import { CamSimulationViewport } from './CamSimulationViewport';

export function CamWorkspace() {
  const cam = useAppStore((state) => state.camDocument);
  const scene = useAppStore((state) => state.solidScene);
  const selectedOperationId = useAppStore((state) => state.selectedCamOperationId);
  const setup = activeCamSetup(cam);
  const operation = findCamOperation(cam, selectedOperationId);
  const [program, setProgram] = useState<CamProgramDto | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const [busy, setBusy] = useState(false);
  const [simulation, setSimulation] = useState<CamSimulationResultDto | null>(null);
  const [simulationError, setSimulationError] = useState<string | null>(null);
  const [simulationGeneration, setSimulationGeneration] = useState(0);
  const [simulationBusy, setSimulationBusy] = useState(false);

  useEffect(() => {
    if (!setup) {
      setProgram(null);
      setPlanError(null);
      return;
    }
    let cancelled = false;
    setBusy(true);
    void getEngine()
      .then((engine) => engine.camPlan(setup.id))
      .then((next) => {
        if (cancelled) return;
        setProgram(next);
        setPlanError(null);
      })
      .catch((error) => {
        if (cancelled) return;
        setProgram(null);
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
    setSimulation(null);
    setSimulationError(null);
  }, [cam]);

  useEffect(() => {
    if (!setup) return;
    let cancelled = false;
    setSimulationBusy(true);
    void getEngine()
      .then((engine) => engine.camSimulate({ setup_id: setup.id }))
      .then((next) => {
        if (cancelled) return;
        setSimulation(next);
        setSimulationError(null);
      })
      .catch((error) => {
        if (cancelled) return;
        setSimulation(null);
        setSimulationError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setSimulationBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [setup?.id, simulationGeneration]);

  if (!setup) {
    return (
      <div className="flex h-full items-center justify-center bg-viewport text-mute">
        Create a CAM setup to begin.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 bg-viewport" data-testid="cam-workspace">
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-edge bg-header px-3">
          <div className="flex min-w-0 items-center gap-2 text-[11px] text-mute">
            <span className="truncate font-semibold text-ink">{setup.name}</span>
            <span>·</span>
            <span className="uppercase">{setup.work_offset}</span>
            <span>·</span>
            <span>Fixed Z / 3-axis</span>
            {program && <ProgramStats program={program} />}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              title="Regenerate toolpath"
              onClick={() => setGeneration((value) => value + 1)}
              className="drawing-mini-button"
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
              onClick={() => runCamAction(exportActiveCamProgram)}
              className="flex h-7 items-center gap-1.5 rounded border border-accent/40 bg-accent/10 px-2.5 text-[10px] font-semibold text-accent hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Download size={13} /> Post NC
            </button>
          </div>
        </div>
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <CamSimulationViewport
            setup={setup}
            program={program}
            simulation={simulation}
            scene={scene}
            busy={simulationBusy}
            error={simulationError}
          />
          {(planError || simulationError || program?.warnings.length || simulation?.collisions.length) && (
            <div className="absolute bottom-3 left-3 right-3 max-w-3xl rounded border border-[#d69b45]/45 bg-[#2a2117]/95 p-2.5 text-[10px] text-[#e8c589] shadow-lg">
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
      <aside className="w-[310px] shrink-0 overflow-y-auto border-l border-edge bg-panel">
        {operation ? (
          <OperationInspector operation={operation} tools={cam.tools} />
        ) : (
          <SetupInspector setup={setup} />
        )}
      </aside>
    </div>
  );
}

function ProgramStats({ program }: { program: CamProgramDto }) {
  return (
    <div className="ml-2 flex items-center gap-2">
      <span className="flex items-center gap-1 rounded bg-edge/50 px-1.5 py-0.5 font-mono text-[9px]">
        <Route size={10} /> {program.stats.cutting_distance.toFixed(1)} mm
      </span>
      <span className="flex items-center gap-1 rounded bg-edge/50 px-1.5 py-0.5 font-mono text-[9px]">
        <Clock3 size={10} /> {formatDuration(program.stats.estimated_seconds)}
      </span>
    </div>
  );
}

function SetupInspector({ setup }: { setup: CamSetupDto }) {
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
        <Field label="Work offset">
          <select
            value={setup.work_offset}
            onChange={(event) => runCamAction(() => updateCamSetup(setup.id, (next) => {
              next.work_offset = event.target.value as CamSetupDto['work_offset'];
            }))}
            className="cam-input"
          >
            {['g54', 'g55', 'g56', 'g57', 'g58', 'g59'].map((offset) => (
              <option key={offset} value={offset}>{offset.toUpperCase()}</option>
            ))}
          </select>
        </Field>
        <Field label="Post">
          <select
            value={setup.post.dialect}
            onChange={(event) => runCamAction(() => updateCamSetup(setup.id, (next) => {
              const dialect = event.target.value as CamSetupDto['post']['dialect'];
              next.post.dialect = dialect;
              if (dialect === 'siemens828d') {
                next.post.siemens_828d ??= {
                  atc_style: 'double_arm',
                  tool_change_positioning: 'supa_z',
                  supa_retract_z: 0,
                  station_x: null,
                  station_y: null,
                  tool_length_offset: 1,
                  optional_stop_on_tool_change: true,
                  preload_next_tool: false,
                };
                next.post.sequence_numbers = true;
              }
            }))}
            className="cam-input"
          >
            <option value="grbl">GRBL</option>
            <option value="linux_cnc">LinuxCNC</option>
            <option value="fanuc">Generic Fanuc</option>
            <option value="siemens828d">Siemens 828D native</option>
          </select>
        </Field>
      </div>
      {setup.post.dialect === 'siemens828d' && setup.post.siemens_828d && (
        <div className="mt-3 rounded border border-[#d69b45]/35 bg-[#2a2117]/45 p-2.5">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Changer style">
              <select
                value={setup.post.siemens_828d.atc_style}
                onChange={(event) => runCamAction(() => updateCamSetup(setup.id, (next) => {
                  if (next.post.siemens_828d) {
                    next.post.siemens_828d.atc_style = event.target.value as Siemens828dPostConfigDto['atc_style'];
                  }
                }))}
                className="cam-input"
              >
                <option value="double_arm">Double arm</option>
                <option value="umbrella">Umbrella / shuttle</option>
                <option value="carousel_chain">Carousel / chain / wheel</option>
                <option value="other">Other / custom</option>
              </select>
            </Field>
            <Field label="Positioning before M6">
              <select
                value={setup.post.siemens_828d.tool_change_positioning}
                onChange={(event) => runCamAction(() => updateCamSetup(setup.id, (next) => {
                  if (next.post.siemens_828d) {
                    next.post.siemens_828d.tool_change_positioning = event.target.value as Siemens828dPostConfigDto['tool_change_positioning'];
                  }
                }))}
                className="cam-input"
              >
                <option value="supa_z">SUPA Z, then M6</option>
                <option value="controller_managed">M6 / PLC owns motion</option>
                <option value="supa_z_then_xy">SUPA Z, fixed XY, M6</option>
              </select>
            </Field>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <NumberField
              label="SUPA retract Z"
              value={setup.post.siemens_828d.supa_retract_z}
              unit="machine mm"
              onCommit={(value) => updateCamSetup(setup.id, (next) => {
                if (next.post.siemens_828d) next.post.siemens_828d.supa_retract_z = value;
              })}
            />
            <NumberField
              label="Tool edge D"
              value={setup.post.siemens_828d.tool_length_offset}
              unit="index"
              integer
              onCommit={(value) => updateCamSetup(setup.id, (next) => {
                if (next.post.siemens_828d) next.post.siemens_828d.tool_length_offset = value;
              })}
            />
          </div>
          {setup.post.siemens_828d.tool_change_positioning === 'supa_z_then_xy' && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <OptionalNumberField
                label="Station X"
                value={setup.post.siemens_828d.station_x}
                unit="machine mm"
                onCommit={(value) => updateCamSetup(setup.id, (next) => {
                  if (next.post.siemens_828d) next.post.siemens_828d.station_x = value;
                })}
              />
              <OptionalNumberField
                label="Station Y"
                value={setup.post.siemens_828d.station_y}
                unit="machine mm"
                onCommit={(value) => updateCamSetup(setup.id, (next) => {
                  if (next.post.siemens_828d) next.post.siemens_828d.station_y = value;
                })}
              />
            </div>
          )}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-mute">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={setup.post.siemens_828d.optional_stop_on_tool_change}
                onChange={(event) => runCamAction(() => updateCamSetup(setup.id, (next) => {
                  if (next.post.siemens_828d) {
                    next.post.siemens_828d.optional_stop_on_tool_change = event.target.checked;
                  }
                }))}
              />
              M1 between tools
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={setup.post.siemens_828d.preload_next_tool}
                onChange={(event) => runCamAction(() => updateCamSetup(setup.id, (next) => {
                  if (next.post.siemens_828d) {
                    next.post.siemens_828d.preload_next_tool = event.target.checked;
                  }
                }))}
              />
              Allow next-tool T preload
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={setup.post.sequence_numbers}
                onChange={(event) => runCamAction(() => updateCamSetup(setup.id, (next) => {
                  next.post.sequence_numbers = event.target.checked;
                }))}
              />
              Sequence numbers
            </label>
          </div>
          <p className="mt-2 text-[9px] leading-relaxed text-[#e8c589]">
            {siemensAtcGuidance(setup.post.siemens_828d)} Physical style is informational; positioning and preload are separate explicit settings. The standard profile emits no custom spindle slowdown macro.
          </p>
          <div className="mt-2 rounded border border-edge/80 bg-[#11171c]/75 p-2">
            <div className="mb-1 text-[8px] font-semibold tracking-[0.12em] text-mute/65">LATER TOOL-CHANGE EXAMPLE · VERIFY, DO NOT COPY BLINDLY</div>
            <pre className="overflow-x-auto whitespace-pre font-mono text-[9px] leading-4 text-ink">{siemensToolChangeExample(setup.post.siemens_828d)}</pre>
          </div>
        </div>
      )}
      <InspectorSubheading>Safe heights</InspectorSubheading>
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="Clearance Z" value={setup.clearance_z} unit="mm" onCommit={(value) => updateCamSetup(setup.id, (next) => { next.clearance_z = value; })} />
        <NumberField label="Retract Z" value={setup.retract_z} unit="mm" onCommit={(value) => updateCamSetup(setup.id, (next) => { next.retract_z = value; })} />
      </div>
      <NumberField label="Rapid estimate" value={setup.rapid_feed} unit="mm/min" onCommit={(value) => updateCamSetup(setup.id, (next) => { next.rapid_feed = value; })} />
      <InspectorSubheading>Stock in setup coordinates</InspectorSubheading>
      <div className="grid grid-cols-3 gap-2">
        <Readout label="X" value={setup.stock.max.x - setup.stock.min.x} />
        <Readout label="Y" value={setup.stock.max.y - setup.stock.min.y} />
        <Readout label="Z" value={setup.stock.max.z - setup.stock.min.z} />
      </div>
      <InspectorSubheading>WCS origin in model</InspectorSubheading>
      <div className="grid grid-cols-3 gap-2">
        <Readout label="X" value={setup.wcs.origin.x} />
        <Readout label="Y" value={setup.wcs.origin.y} />
        <Readout label="Z" value={setup.wcs.origin.z} />
      </div>
      <p className="mt-3 text-[10px] leading-relaxed text-mute">
        Toolpaths use millimetres in this fixed-axis frame. Set the same stock-top origin and work offset on the machine.
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

function OperationInspector({ operation, tools }: { operation: CamOperationDto; tools: CamToolDto[] }) {
  const tool = tools.find((candidate) => candidate.id === operation.tool_id) ?? null;
  const compatibleTools = tools.filter((candidate) =>
    operation.kind === 'face'
      ? candidate.kind === 'flat_end_mill'
      : operation.kind === 'drill'
        ? candidate.kind === 'drill' || candidate.center_cutting
        : candidate.kind !== 'drill',
  );
  const update = (mutate: (next: CamOperationDto) => void) =>
    updateCamOperation(operation.id, mutate);

  return (
    <InspectorSection title={operation.kind === 'contour2d' ? '2D CONTOUR' : operation.kind.toUpperCase()} icon={<Wrench size={13} />}>
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
          {compatibleTools.map((candidate) => <option key={candidate.id} value={candidate.id}>T{candidate.number} · {candidate.name}</option>)}
        </select>
      </Field>
      {tool && (
        <div className="rounded border border-edge bg-header/55 p-2">
          <div className="mb-2 flex items-center gap-2 text-[10px] text-mute"><Wrench size={11} /> TOOL GEOMETRY</div>
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="Diameter" value={tool.diameter} unit="mm" onCommit={(value) => updateCamTool(tool.id, (next) => { next.diameter = value; })} />
            <NumberField label="Flute length" value={tool.flute_length} unit="mm" onCommit={(value) => updateCamTool(tool.id, (next) => { next.flute_length = value; })} />
          </div>
        </div>
      )}
      <InspectorSubheading>Speeds &amp; feeds</InspectorSubheading>
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="Spindle" value={operation.cutting.spindle_rpm} unit="rpm" integer onCommit={(value) => update((next) => { next.cutting.spindle_rpm = value; })} />
        <Field label="Coolant">
          <select value={operation.cutting.coolant} onChange={(event) => runCamAction(() => update((next) => { next.cutting.coolant = event.target.value as CamOperationDto['cutting']['coolant']; }))} className="cam-input">
            <option value="off">Off</option><option value="mist">Mist</option><option value="flood">Flood</option>
          </select>
        </Field>
        <NumberField label="Cut feed" value={operation.cutting.feed_xy} unit="mm/min" onCommit={(value) => update((next) => { next.cutting.feed_xy = value; })} />
        <NumberField label="Plunge feed" value={operation.cutting.feed_z} unit="mm/min" onCommit={(value) => update((next) => { next.cutting.feed_z = value; })} />
      </div>
      <InspectorSubheading>Passes</InspectorSubheading>
      {operation.kind === 'face' && <FaceFields operation={operation} update={update} />}
      {operation.kind === 'contour2d' && <ContourFields operation={operation} update={update} />}
      {operation.kind === 'drill' && <DrillFields operation={operation} update={update} />}
      <button type="button" onClick={() => runCamAction(() => deleteCamOperation(operation.id))} className="mt-5 flex h-7 w-full items-center justify-center gap-1.5 rounded border border-warn/30 text-[10px] text-warn hover:bg-warn/10">
        <Trash2 size={12} /> Delete operation
      </button>
    </InspectorSection>
  );
}

type FaceOperation = Extract<CamOperationDto, { kind: 'face' }>;
type ContourOperation = Extract<CamOperationDto, { kind: 'contour2d' }>;
type DrillOperation = Extract<CamOperationDto, { kind: 'drill' }>;

function FaceFields({ operation, update }: { operation: FaceOperation; update: (mutate: (next: CamOperationDto) => void) => Promise<void> }) {
  return <div className="grid grid-cols-2 gap-2">
    <NumberField label="Top Z" value={operation.top_z} unit="mm" onCommit={(value) => update((next) => { if (next.kind === 'face') next.top_z = value; })} />
    <NumberField label="Target Z" value={operation.target_z} unit="mm" onCommit={(value) => update((next) => { if (next.kind === 'face') next.target_z = value; })} />
    <NumberField label="Stepover" value={operation.step_over} unit="mm" onCommit={(value) => update((next) => { if (next.kind === 'face') next.step_over = value; })} />
    <NumberField label="Stepdown" value={operation.step_down} unit="mm" onCommit={(value) => update((next) => { if (next.kind === 'face') next.step_down = value; })} />
  </div>;
}

function ContourFields({ operation, update }: { operation: ContourOperation; update: (mutate: (next: CamOperationDto) => void) => Promise<void> }) {
  return <>
    <div className="grid grid-cols-2 gap-2">
      <NumberField label="Top Z" value={operation.top_z} unit="mm" onCommit={(value) => update((next) => { if (next.kind === 'contour2d') next.top_z = value; })} />
      <NumberField label="Bottom Z" value={operation.bottom_z} unit="mm" onCommit={(value) => update((next) => { if (next.kind === 'contour2d') next.bottom_z = value; })} />
      <NumberField label="Stepdown" value={operation.step_down} unit="mm" onCommit={(value) => update((next) => { if (next.kind === 'contour2d') next.step_down = value; })} />
      <Field label="Tool side"><select value={operation.compensation} onChange={(event) => runCamAction(() => update((next) => { if (next.kind === 'contour2d') next.compensation = event.target.value as ContourOperation['compensation']; }))} className="cam-input"><option value="outside">Outside</option><option value="inside">Inside</option><option value="on">On path</option></select></Field>
    </div>
    <Field label="Closed path · one X,Y point per line"><CommitPoints value={operation.path} onCommit={(points) => update((next) => { if (next.kind === 'contour2d') next.path = points; })} /></Field>
  </>;
}

function DrillFields({ operation, update }: { operation: DrillOperation; update: (mutate: (next: CamOperationDto) => void) => Promise<void> }) {
  return <>
    <div className="grid grid-cols-2 gap-2">
      <NumberField label="Top Z" value={operation.top_z} unit="mm" onCommit={(value) => update((next) => { if (next.kind === 'drill') next.top_z = value; })} />
      <NumberField label="Bottom Z" value={operation.bottom_z} unit="mm" onCommit={(value) => update((next) => { if (next.kind === 'drill') next.bottom_z = value; })} />
      <NumberField label="Retract Z" value={operation.retract_z} unit="mm" onCommit={(value) => update((next) => { if (next.kind === 'drill') next.retract_z = value; })} />
      <OptionalNumberField label="Peck depth" value={operation.peck_depth} unit="mm" onCommit={(value) => update((next) => { if (next.kind === 'drill') next.peck_depth = value; })} />
      <NumberField label="Dwell" value={operation.dwell_seconds} unit="sec" onCommit={(value) => update((next) => { if (next.kind === 'drill') next.dwell_seconds = value; })} />
    </div>
    <Field label="Hole centers · one X,Y point per line"><CommitPoints value={operation.points} onCommit={(points) => update((next) => { if (next.kind === 'drill') next.points = points; })} /></Field>
  </>;
}

function InspectorSection({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return <div className="p-3">
    <div className="mb-3 flex h-6 items-center gap-2 border-b border-edge pb-2 text-[10px] font-semibold tracking-[0.14em] text-mute">{icon}{title}</div>
    <div className="space-y-2.5">{children}</div>
  </div>;
}

function siemensAtcGuidance(profile: Siemens828dPostConfigDto): string {
  const style = profile.atc_style === 'double_arm'
    ? 'Double-arm machines normally have a calibrated tool-change height and spindle orientation.'
    : profile.atc_style === 'umbrella'
      ? 'Umbrella machines also use a calibrated tool-change height; the shuttle layout does not prove that an XY move is required.'
      : profile.atc_style === 'carousel_chain'
        ? 'Carousel, chain, or wheel storage does not by itself define the spindle-side change station.'
        : 'Use the machine-builder manual or a proven M6 program to define this custom changer.';
  const positioning = profile.tool_change_positioning === 'supa_z'
    ? ` This profile emits G0 SUPA Z${profile.supa_retract_z} D0 before later changes.`
    : profile.tool_change_positioning === 'controller_managed'
      ? ' This profile assumes the M6/PLC cycle owns all station motion.'
      : profile.station_x === null || profile.station_y === null
        ? ' Enter both verified machine X and Y station coordinates before posting.'
        : ` This profile retracts Z first, then moves to machine X${profile.station_x} Y${profile.station_y}.`;
  const preload = profile.preload_next_tool
    ? profile.atc_style === 'carousel_chain'
      ? ' Warning: next-tool T preload is enabled even though it may index this carousel/chain/wheel magazine; verify it on this exact machine.'
      : ' Next-tool T preload is enabled; verify that an early T call safely stages the magazine on this exact machine.'
    : ' Next-tool T preload is disabled, so every executable T call belongs to the M6 immediately following it.';
  return `${style}${positioning}${preload}`;
}

function siemensToolChangeExample(profile: Siemens828dPostConfigDto): string {
  const style = profile.atc_style === 'double_arm'
    ? 'DOUBLE-ARM'
    : profile.atc_style === 'umbrella'
      ? 'UMBRELLA / SHUTTLE'
      : profile.atc_style === 'carousel_chain'
        ? 'CAROUSEL / CHAIN / WHEEL'
        : 'CUSTOM ATC';
  const lines = [`; ${style} EXAMPLE - MACHINE MANUAL WINS`, 'M9', 'M5'];
  if (profile.tool_change_positioning === 'supa_z') {
    lines.push(`G0 SUPA Z${profile.supa_retract_z} D0`, `D${profile.tool_length_offset}`);
  } else if (profile.tool_change_positioning === 'controller_managed') {
    lines.push('; M6/PLC CONTROLS TOOL-CHANGE POSITIONING');
  } else {
    lines.push(
      `G0 SUPA Z${profile.supa_retract_z} D0`,
      `G0 SUPA X${profile.station_x ?? '<SET>'} Y${profile.station_y ?? '<SET>'}`,
      `D${profile.tool_length_offset}`,
    );
  }
  lines.push('', 'MSG ("NEXT OPERATION")');
  if (profile.optional_stop_on_tool_change) lines.push('M1');
  lines.push('T19', 'M6', `D${profile.tool_length_offset}`);
  if (profile.preload_next_tool) lines.push('T44');
  return lines.join('\n');
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

function NumberField({ label, value, unit, integer = false, onCommit }: { label: string; value: number; unit: string; integer?: boolean; onCommit: (value: number) => Promise<void> }) {
  return <Field label={label}><div className="relative"><input key={value} type="number" step={integer ? 1 : 'any'} defaultValue={integer ? Math.round(value) : value} className="cam-input pr-14 font-mono" onBlur={(event) => {
    const next = Number(event.target.value);
    if (Number.isFinite(next) && next !== value) runCamAction(() => onCommit(integer ? Math.round(next) : next));
  }} /><span className="pointer-events-none absolute right-2 top-1.5 text-[8px] text-mute/60">{unit}</span></div></Field>;
}

function OptionalNumberField({ label, value, unit, onCommit }: { label: string; value: number | null; unit: string; onCommit: (value: number | null) => Promise<void> }) {
  return <Field label={label}><div className="relative"><input key={String(value)} type="number" step="any" defaultValue={value ?? ''} placeholder="Off" className="cam-input pr-10 font-mono" onBlur={(event) => {
    const text = event.target.value.trim();
    const next = text === '' ? null : Number(text);
    if ((next === null || Number.isFinite(next)) && next !== value) runCamAction(() => onCommit(next));
  }} /><span className="pointer-events-none absolute right-2 top-1.5 text-[8px] text-mute/60">{unit}</span></div></Field>;
}

function CommitPoints({ value, onCommit }: { value: CamPoint2Dto[]; onCommit: (value: CamPoint2Dto[]) => Promise<void> }) {
  const text = value.map((point) => `${point.x}, ${point.y}`).join('\n');
  return <textarea key={text} defaultValue={text} rows={Math.min(6, Math.max(3, value.length))} className="cam-input min-h-16 resize-y font-mono leading-5" onBlur={(event) => {
    try {
      const points = parsePoints(event.target.value);
      if (JSON.stringify(points) !== JSON.stringify(value)) runCamAction(() => onCommit(points));
    } catch (error) {
      useAppStore.getState().setConstraintDialog({ titleKey: 'file.errorTitle', message: error instanceof Error ? error.message : String(error) });
      event.target.value = text;
    }
  }} />;
}

function Readout({ label, value }: { label: string; value: number }) {
  return <div className="rounded border border-edge bg-header/60 px-2 py-1.5"><div className="text-[8px] text-mute/60">{label}</div><div className="font-mono text-[10px] text-ink">{value.toFixed(3)}</div></div>;
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
