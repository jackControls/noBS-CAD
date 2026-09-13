import { useEffect, useState, type FormEvent } from 'react';
import { FileCode2, X } from 'lucide-react';
import { CamToolIcon } from './CamToolIcon';
import { setCamMachine } from '../../cam/document';
import { prepareActiveCamProgram } from '../../cam/export';
import { compensationGuidance, reviseMachine } from '../../cam/machines';
import { inspectNbPostFile } from '../../cam/nbpost';
import { commitLength, displayLength } from '../../cam/units';
import type {
  CamPostConfigDto,
  CamPostDialect,
  NbPostAnalysisDto,
  Siemens828dPostConfigDto,
} from '../../engine/types';
import { useAppStore } from '../../store/appStore';
import { runCamAction } from './CamBrowser';
import {
  CAM_DIALOG_INPUT,
  CAM_DIALOG_LABEL,
  DialogSection,
  DraftNumber,
  lengthUnit,
  parseDraft,
  parseOptionalDraft,
} from './camFields';

const WORK_OFFSETS = ['g54', 'g55', 'g56', 'g57', 'g58', 'g59'] as const;

const DEFAULT_SIEMENS_828D: Siemens828dPostConfigDto = {
  atc_style: 'double_arm',
  tool_change_positioning: 'supa_z',
  supa_retract_z: 0,
  station_x: null,
  station_y: null,
  tool_length_offset: 1,
  optional_stop_on_tool_change: false,
  preload_next_tool: false,
};

/**
 * Output review is bound to the setup's machine snapshot. Program-specific
 * settings stay editable; changing the controller is an explicit Setup edit.
 */
export function CamPostDialog() {
  const cam = useAppStore((state) => state.camDocument);
  const close = () => useAppStore.getState().setCamDialog(null);
  const units = cam.units;
  const lu = lengthUnit(units);
  const setup = cam.setups.find((candidate) => candidate.id === cam.active_setup_id) ?? null;
  const defaults = setup?.machine?.profile.post ?? cam.post_defaults;
  const initialSiemens = defaults.siemens_828d ?? DEFAULT_SIEMENS_828D;

  const dialect: CamPostDialect = defaults.dialect;
  const [programName, setProgramName] = useState(setup?.name ?? '');
  const [programNumber, setProgramNumber] = useState(
    defaults.program_number === null ? '' : String(defaults.program_number),
  );
  const [sequenceNumbers, setSequenceNumbers] = useState(defaults.sequence_numbers);
  // Siemens sub-fields stay string drafts (display units) until submit, like
  // every other dialog field.
  const [atcStyle, setAtcStyle] = useState(initialSiemens.atc_style);
  const [positioning, setPositioning] = useState(initialSiemens.tool_change_positioning);
  const [supaZ, setSupaZ] = useState(String(displayLength(initialSiemens.supa_retract_z, units)));
  const [toolEdgeD, setToolEdgeD] = useState(String(initialSiemens.tool_length_offset));
  const [stationX, setStationX] = useState(
    initialSiemens.station_x === null ? '' : String(displayLength(initialSiemens.station_x, units)),
  );
  const [stationY, setStationY] = useState(
    initialSiemens.station_y === null ? '' : String(displayLength(initialSiemens.station_y, units)),
  );
  const [m1BetweenTools, setM1BetweenTools] = useState(initialSiemens.optional_stop_on_tool_change);
  const [preloadNextTool, setPreloadNextTool] = useState(initialSiemens.preload_next_tool);
  const [toolCallMode, setToolCallMode] = useState(defaults.tool_call_mode ?? 'automatic');
  const [machineRetractZ, setMachineRetractZ] = useState(defaults.machine_retract_z == null ? '' : String(displayLength(defaults.machine_retract_z, units)));
  const namedTools = ['siemens828d', 'heidenhain', 'hermle_heidenhain'].includes(dialect);
  const conversational = ['heidenhain', 'hermle_heidenhain'].includes(dialect);
  const needsMachineRetract = !['siemens828d', 'grbl', 'linux_cnc'].includes(dialect);
  const usedToolIds = new Set(setup?.operations.filter(op => op.enabled).map(op => op.tool_id) ?? []);
  const usedTools = cam.tools.filter(tool => usedToolIds.has(tool.id));
  const [error, setError] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [prepared, setPrepared] = useState<Awaited<ReturnType<typeof prepareActiveCamProgram>> | null>(null);
  useEffect(() => setReviewed(false), [setup?.machine, units]);
  // .nbpost compatibility inspection (moved here from the retired setup
  // inspector): local, non-executing analysis of a user-supplied post file.
  const [postAnalysis, setPostAnalysis] = useState<NbPostAnalysisDto | null>(null);
  const [postAnalysisBusy, setPostAnalysisBusy] = useState(false);

  if (!setup) {
    return (
      <div data-native-viewport-dim="0.15" className="pointer-events-none fixed inset-0 z-[70] bg-black/15">
        <div className="feature-dialog pointer-events-auto absolute right-5 top-[160px] w-[340px] rounded border border-edge bg-panel p-4 shadow-2xl">
          <p className="text-[11px] text-mute">Create a CAM setup before posting NC code.</p>
          <button
            type="button"
            onClick={close}
            className="mt-3 h-7 rounded border border-edge px-3 text-[10px] font-semibold text-mute hover:text-ink"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  const firstIndex = WORK_OFFSETS.indexOf(setup.work_offset);
  const offsetPreview = WORK_OFFSETS.slice(firstIndex, firstIndex + setup.work_offset_count)
    .map((offset, i) => conversational ? `Preset ${firstIndex + i + 1}` : dialect === 'okuma' ? `G15 H${firstIndex + i + 1}` : offset.toUpperCase());

  const siemensPreview = (profile: Partial<Siemens828dPostConfigDto>): Siemens828dPostConfigDto => ({
    ...DEFAULT_SIEMENS_828D,
    ...initialSiemens,
    atc_style: atcStyle,
    tool_change_positioning: positioning,
    optional_stop_on_tool_change: m1BetweenTools,
    preload_next_tool: preloadNextTool,
    supa_retract_z: Number(supaZ) || 0,
    tool_length_offset: Math.round(Number(toolEdgeD) || 1),
    station_x: stationX.trim() ? Number(stationX) : null,
    station_y: stationY.trim() ? Number(stationY) : null,
    ...profile,
  });

  const inspectPost = async () => {
    setPostAnalysisBusy(true);
    try {
      const analysis = await inspectNbPostFile();
      if (analysis) setPostAnalysis(analysis);
    } finally {
      setPostAnalysisBusy(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (busy) return;
    if (prepared) {
      setBusy(true);
      void prepared.save().then(saved => { if (saved) close(); })
        .catch(cause => { setError(String(cause)); setPrepared(null); setReviewed(false); })
        .finally(() => setBusy(false));
      return;
    }
    try {
      if (!setup.machine) throw new Error('Select a machine/controller in Setup before posting NC.');
      if (!reviewed) throw new Error('Review the machine settings and offset assumptions before preparing NC.');
      const config: CamPostConfigDto = {
        dialect,
        program_number: programNumber.trim()
          ? Math.round(parseDraft(programNumber, 'Program number'))
          : null,
        sequence_numbers: conversational || sequenceNumbers,
        tool_call_mode: toolCallMode,
        machine_retract_z: needsMachineRetract ? commitLength(parseDraft(machineRetractZ, 'Machine retract Z'), units) : null,
        siemens_828d:
          dialect === 'siemens828d'
            ? {
                ...initialSiemens,
                atc_style: atcStyle,
                tool_change_positioning: positioning,
                supa_retract_z: commitLength(parseDraft(supaZ, 'SUPA retract Z'), units),
                station_x: (() => {
                  const value = parseOptionalDraft(stationX, 'Station X');
                  return value === null ? null : commitLength(value, units);
                })(),
                station_y: (() => {
                  const value = parseOptionalDraft(stationY, 'Station Y');
                  return value === null ? null : commitLength(value, units);
                })(),
                tool_length_offset: Math.round(parseDraft(toolEdgeD, 'Tool edge D')),
                optional_stop_on_tool_change: m1BetweenTools,
                preload_next_tool: preloadNextTool,
              }
            : null,
      };
      const name = programName.trim() || null;
      const machine = reviseMachine(setup.machine, setup.machine.profile.name, config, []);
      setBusy(true);
      runCamAction(async () => {
        try {
          await setCamMachine(setup.id, machine, cam);
          setPrepared(await prepareActiveCamProgram(config, name));
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause));
        } finally { setBusy(false); }
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <div data-native-viewport-dim="0.15" className="pointer-events-none fixed inset-0 z-[70] bg-black/15">
      <form
        data-testid="cam-post-dialog"
        onSubmit={submit}
        className="feature-dialog pointer-events-auto absolute right-5 top-[160px] flex max-h-[calc(100vh-218px)] w-[360px] flex-col overflow-hidden rounded border border-edge bg-panel shadow-2xl"
      >
        <header className="flex h-10 shrink-0 items-center gap-2 border-b border-edge px-3">
          <CamToolIcon id="camPostNc" size={18} />
          <span className="flex-1 text-xs font-semibold text-ink">Post NC — {setup.name}</span>
          <button type="button" onClick={close} className="rounded p-1 text-mute hover:bg-edge hover:text-ink">
            <X size={14} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <fieldset disabled={busy || prepared !== null} className="min-w-0 space-y-4"
          onChange={() => { setReviewed(false); setPrepared(null); }}>
          {error && (
            <p role="alert" className="rounded border border-warn/40 bg-warn/10 p-2 text-[10px] text-warn">{error}</p>
          )}
          <DialogSection title="POST">
            <p className="text-[11px] font-semibold text-ink">{setup.machine?.profile.name ?? 'Generic programming · no machine selected'}</p>
            <button type="button" className="text-[10px] text-accent underline"
              onClick={() => useAppStore.getState().setCamDialog({ type: 'setup', editId: setup.id })}>
              {setup.machine ? 'Change machine in Setup…' : 'Choose machine in Setup…'}
            </button>
              <DraftNumber
                label="Program number"
                value={programNumber}
                onChange={setProgramNumber}
                integer
                placeholder={needsMachineRetract ? '1001' : 'Off'}
              />
            <label className="block">
              <span className={CAM_DIALOG_LABEL}>Program name</span>
              <input
                value={programName}
                onChange={(event) => setProgramName(event.target.value)}
                placeholder={setup.name}
                className={CAM_DIALOG_INPUT}
              />
            </label>
            <label className="flex items-center gap-2 text-[11px] text-ink">
              <input
                type="checkbox"
                checked={conversational || sequenceNumbers}
                disabled={conversational}
                onChange={(event) => setSequenceNumbers(event.target.checked)}
              />
              {conversational ? 'Sequence numbers · required by TNC' : 'Sequence numbers'}
            </label>
          </DialogSection>

          <p className="text-[10px] leading-relaxed text-mute">{compensationGuidance(dialect)}
            {' '}In-control checks assume the full project tool radius is entered at the control, not a wear-only offset.
            {' '}No travel, holder, fixture, PLC or whole-machine collision verification is performed.
          </p>

          <DialogSection title="TOOLS FROM PROJECT LIBRARY">
            {namedTools && <label className="block"><span className={CAM_DIALOG_LABEL}>Tool calls</span>
              <select aria-label="Tool calls" className={CAM_DIALOG_INPUT} value={toolCallMode}
                onChange={event => { setToolCallMode(event.target.value as typeof toolCallMode); setReviewed(false); }}>
                <option value="automatic">Automatic · number, otherwise name</option>
                <option value="number">Library tool numbers</option>
                <option value="name">Exact library tool names</option>
              </select></label>}
            <p className="text-[10px] leading-relaxed text-mute">Tool calls come directly from the project tool library. Edit numbers/names there; no separate mapping or per-tool confirmation is needed. Duplicate or unrepresentable calls are rejected.</p>
            <ul className="text-[10px] text-mute space-y-1">{usedTools.map(tool => <li key={tool.id}>
              {toolCallMode === 'name' || (toolCallMode === 'automatic' && namedTools && tool.number == null) ? `“${tool.name}”` : `T${tool.number ?? '—'}`} · {tool.name}
            </li>)}</ul>
          </DialogSection>

          {needsMachineRetract && <DialogSection title="MACHINE RETRACT">
            <DraftNumber label={`Machine retract Z (${lu})`} value={machineRetractZ} onChange={setMachineRetractZ} />
            <p className="text-[10px] leading-relaxed text-mute">Machine coordinates, not workpiece clearance. Used before tool changes, changed work offsets and program end. Confirm the safe Z for this machine; zero is not assumed. Builder macros and rotary motion are not enabled.</p>
          </DialogSection>}

          <DialogSection title="WORK OFFSETS">
            <p className="text-[10px] leading-relaxed text-mute">
              This setup posts {setup.work_offset_count}{' '}
              {setup.work_offset_count > 1 ? 'duplicated parts' : 'part'} under{' '}
              {offsetPreview.join(', ')}. Change the count by editing the setup (double-click it in
              the browser).
            </p>
          </DialogSection>

          {dialect === 'siemens828d' && (
            <DialogSection title="SIEMENS 828D">
              {initialSiemens.spindle_stop_subprogram && <p data-testid="cam-private-spindle-stop" className="rounded border border-warn/40 bg-warn/10 p-2 text-[10px] leading-relaxed text-ink">
                Private spindle stop: <code>{initialSiemens.spindle_stop_subprogram}</code>, then M5. The machine's subprogram is not simulated; verify it on the controller. This setting comes from the selected private profile.
              </p>}
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className={CAM_DIALOG_LABEL}>Changer style</span>
                  <select
                    value={atcStyle}
                    onChange={(event) =>
                      setAtcStyle(event.target.value as Siemens828dPostConfigDto['atc_style'])
                    }
                    className={CAM_DIALOG_INPUT}
                  >
                    <option value="double_arm">Double arm</option>
                    <option value="umbrella">Umbrella / shuttle</option>
                    <option value="carousel_chain">Carousel / chain / wheel</option>
                    <option value="other">Other / custom</option>
                  </select>
                </label>
                <label className="block">
                  <span className={CAM_DIALOG_LABEL}>Positioning before M6</span>
                  <select
                    value={positioning}
                    onChange={(event) =>
                      setPositioning(
                        event.target
                          .value as Siemens828dPostConfigDto['tool_change_positioning'],
                      )
                    }
                    className={CAM_DIALOG_INPUT}
                  >
                    <option value="supa_z">SUPA Z, then M6</option>
                    <option value="controller_managed">M6 / PLC owns motion</option>
                    <option value="supa_z_then_xy">SUPA Z, fixed XY, M6</option>
                  </select>
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <DraftNumber
                  label="SUPA retract Z"
                  value={supaZ}
                  onChange={setSupaZ}
                  unit={`${lu} (machine)`}
                  disabled={positioning === 'controller_managed'}
                />
                <DraftNumber
                  label="Tool edge D"
                  value={toolEdgeD}
                  onChange={setToolEdgeD}
                  integer
                  unit="index"
                  disabled={positioning === 'controller_managed'}
                />
              </div>
              {positioning === 'supa_z_then_xy' && (
                <div className="grid grid-cols-2 gap-2">
                  <DraftNumber
                    label="Station X"
                    value={stationX}
                    onChange={setStationX}
                    unit={lu}
                    placeholder="Off"
                  />
                  <DraftNumber
                    label="Station Y"
                    value={stationY}
                    onChange={setStationY}
                    unit={lu}
                    placeholder="Off"
                  />
                </div>
              )}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-mute">
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={m1BetweenTools}
                    onChange={(event) => setM1BetweenTools(event.target.checked)}
                  />
                  M1 between tools
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={preloadNextTool}
                    onChange={(event) => setPreloadNextTool(event.target.checked)}
                  />
                  Allow next-tool T preload
                </label>
              </div>
              <p className="text-[9px] leading-relaxed text-[#e8c589]">
                {siemensAtcGuidance(siemensPreview({}))} Physical style is informational;
                positioning and preload are separate explicit settings. The standard profile emits
                no custom spindle slowdown macro.
              </p>
              <div className="rounded border border-edge/80 bg-[#11171c]/75 p-2">
                <div className="mb-1 text-[8px] font-semibold tracking-[0.12em] text-mute/65">
                  LATER TOOL-CHANGE EXAMPLE · VERIFY, DO NOT COPY BLINDLY
                </div>
                <pre className="overflow-x-auto whitespace-pre font-mono text-[9px] leading-4 text-ink">
                  {siemensToolChangeExample(siemensPreview({}))}
                </pre>
              </div>
            </DialogSection>
          )}

          <DialogSection title="POST STORAGE & REFERENCES">
            <button type="button" className="text-[10px] text-accent underline"
              onClick={() => useAppStore.getState().setSettingsOpen(true)}>Manage custom posts in Settings…</button>
            <p className="text-[9px] leading-relaxed text-mute">Import private profiles and reference sources in Settings. Select a saved native profile in Setup → Machine & Controller. Imported scripts are not executed.</p>
            <details><summary className="cursor-pointer text-[10px] text-mute">Legacy .nbpost source inspection</summary>
            <button
              type="button"
              disabled={postAnalysisBusy}
              onClick={() => runCamAction(inspectPost)}
              className="flex h-7 w-full items-center justify-center gap-1.5 rounded border border-edge bg-header/45 text-[10px] font-semibold text-mute hover:border-accent/40 hover:text-accent disabled:opacity-40"
            >
              <FileCode2 size={13} /> {postAnalysisBusy ? 'Inspecting…' : 'Inspect legacy source'}
            </button>
            <p className="text-[9px] leading-relaxed text-mute">
              This analyzer reads legacy JavaScript .nbpost references, not native JSON profiles. Inspection is local and non-executing.
            </p>
            {postAnalysis && (
              <div className="rounded border border-edge bg-header/45 p-2 text-[9px] leading-relaxed text-mute">
                <div className="truncate font-semibold text-ink">{postAnalysis.file_name}</div>
                <div>
                  {postAnalysis.source_kind === 'callback_javascript'
                    ? 'Supported callback shape detected'
                    : 'Post shape not recognized'}{' '}
                  · {postAnalysis.callbacks.length} callbacks
                </div>
                <div className="mt-1 text-[#e8c589]">
                  Analysis only—script execution remains disabled until the compatibility sandbox
                  is complete.
                </div>
                {postAnalysis.callbacks_outside_v1_target.length > 0 && (
                  <div className="mt-1 break-words">
                    Beyond fixed 3-axis v1: {postAnalysis.callbacks_outside_v1_target.join(', ')}
                  </div>
                )}
              </div>
            )}
            </details>
          </DialogSection>
        </fieldset>
        </div>
        {prepared ? <div data-testid="cam-post-review" className="max-h-48 shrink-0 space-y-1 overflow-y-auto border-t border-edge p-3">
          <p className="text-[11px] font-semibold text-ink">NC prepared · review before saving</p>
          {prepared.result.warnings.map((warning, i) => <p key={i} className="text-[10px] leading-relaxed text-mute">{warning}</p>)}
          <button type="button" disabled={busy} className="text-[10px] text-accent underline" onClick={() => { setPrepared(null); setReviewed(false); }}>Back to settings</button>
        </div> : <label className="flex shrink-0 items-start gap-2 border-t border-edge p-3 text-[10px] text-ink">
          <input data-testid="cam-post-confirm" type="checkbox" checked={reviewed} disabled={!setup.machine || busy}
            onChange={e => setReviewed(e.target.checked)} />
          I reviewed the target, machine-specific post settings and offset assumptions. This is not machine safety certification.
        </label>}
        <footer className="flex h-11 shrink-0 items-center justify-end gap-2 border-t border-edge px-3">
          <button
            type="button"
            onClick={close}
            className="h-7 rounded border border-edge px-3 text-[10px] font-semibold text-mute hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !setup.machine || (!prepared && !reviewed)}
            className="h-7 rounded border border-accent/50 bg-accent/15 px-3 text-[10px] font-semibold text-accent hover:bg-accent/25 disabled:opacity-40"
          >
            {busy ? 'Checking…' : prepared ? 'Save NC…' : 'Check & prepare NC'}
          </button>
        </footer>
      </form>
    </div>
  );
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
  const lines = [`; ${style} EXAMPLE - MACHINE MANUAL WINS`, 'M9'];
  if (profile.spindle_stop_subprogram) lines.push(profile.spindle_stop_subprogram);
  lines.push('M5');
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
