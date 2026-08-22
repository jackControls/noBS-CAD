import { useState, type FormEvent } from 'react';
import { Download, X } from 'lucide-react';
import { setCamPostDefaults } from '../../cam/document';
import { exportActiveCamProgram } from '../../cam/export';
import { commitLength, displayLength } from '../../cam/units';
import type {
  CamPostConfigDto,
  CamPostDialect,
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
  optional_stop_on_tool_change: true,
  preload_next_tool: false,
};

/**
 * Post-at-export dialog. The toolpath program is fully dialect-neutral; the
 * post configuration is chosen here, remembered as document prefill, and
 * applied only while rendering G-code — never baked into planning.
 */
export function CamPostDialog() {
  const cam = useAppStore((state) => state.camDocument);
  const close = () => useAppStore.getState().setCamDialog(null);
  const units = cam.units;
  const lu = lengthUnit(units);
  const setup = cam.setups.find((candidate) => candidate.id === cam.active_setup_id) ?? null;
  const defaults = cam.post_defaults;
  const initialSiemens = defaults.siemens_828d ?? DEFAULT_SIEMENS_828D;

  const [dialect, setDialect] = useState<CamPostDialect>(defaults.dialect);
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
  const [error, setError] = useState<string | null>(null);

  if (!setup) {
    return (
      <div data-native-viewport-dim="0.15" className="pointer-events-none fixed inset-0 z-[70] bg-black/15">
        <div className="feature-dialog pointer-events-auto absolute right-5 top-[132px] w-[340px] rounded border border-edge bg-panel p-4 shadow-2xl">
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
    .map((offset) => offset.toUpperCase());

  const chooseDialect = (next: CamPostDialect) => {
    setDialect(next);
    if (next === 'siemens828d') setSequenceNumbers(true);
  };

  const siemensPreview = (profile: Partial<Siemens828dPostConfigDto>): Siemens828dPostConfigDto => ({
    ...DEFAULT_SIEMENS_828D,
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

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      const config: CamPostConfigDto = {
        dialect,
        program_number: programNumber.trim()
          ? Math.round(parseDraft(programNumber, 'Program number'))
          : null,
        sequence_numbers: sequenceNumbers,
        siemens_828d:
          dialect === 'siemens828d'
            ? {
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
      runCamAction(async () => {
        await setCamPostDefaults(config);
        const saved = await exportActiveCamProgram(config, name);
        if (saved) close();
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
        className="feature-dialog pointer-events-auto absolute right-5 top-[132px] flex max-h-[calc(100vh-190px)] w-[360px] flex-col overflow-hidden rounded border border-edge bg-panel shadow-2xl"
      >
        <header className="flex h-10 shrink-0 items-center gap-2 border-b border-edge px-3">
          <Download size={15} className="text-accent" />
          <span className="flex-1 text-xs font-semibold text-ink">Post NC — {setup.name}</span>
          <button type="button" onClick={close} className="rounded p-1 text-mute hover:bg-edge hover:text-ink">
            <X size={14} />
          </button>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
          {error && (
            <p className="rounded border border-warn/40 bg-warn/10 p-2 text-[10px] text-warn">{error}</p>
          )}
          <DialogSection title="POST">
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className={CAM_DIALOG_LABEL}>Dialect</span>
                <select
                  value={dialect}
                  onChange={(event) => chooseDialect(event.target.value as CamPostDialect)}
                  className={CAM_DIALOG_INPUT}
                >
                  <option value="grbl">GRBL</option>
                  <option value="linux_cnc">LinuxCNC</option>
                  <option value="fanuc">Generic Fanuc</option>
                  <option value="siemens828d">Siemens 828D native</option>
                </select>
              </label>
              <DraftNumber
                label="Program number"
                value={programNumber}
                onChange={setProgramNumber}
                integer
                placeholder="Off"
              />
            </div>
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
                checked={sequenceNumbers}
                onChange={(event) => setSequenceNumbers(event.target.checked)}
              />
              Sequence numbers
            </label>
          </DialogSection>

          <DialogSection title="WORK OFFSETS">
            <p className="text-[10px] leading-relaxed text-mute">
              This setup posts {setup.work_offset_count}{' '}
              {setup.work_offset_count > 1 ? 'duplicated parts' : 'part'} under{' '}
              {offsetPreview.join(', ')}. Change the count in the setup inspector.
            </p>
          </DialogSection>

          {dialect === 'siemens828d' && (
            <DialogSection title="SIEMENS 828D">
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
                />
                <DraftNumber
                  label="Tool edge D"
                  value={toolEdgeD}
                  onChange={setToolEdgeD}
                  integer
                  unit="index"
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
        </div>
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
            className="h-7 rounded border border-accent/50 bg-accent/15 px-3 text-[10px] font-semibold text-accent hover:bg-accent/25"
          >
            Post &amp; save…
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
