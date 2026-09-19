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
import { translate, useTranslation } from '../../i18n';
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
  const { t } = useTranslation();
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
          <p className="text-[11px] text-mute">{t('cam.post.noSetup')}</p>
          <button
            type="button"
            onClick={close}
            className="mt-3 h-7 rounded border border-edge px-3 text-[10px] font-semibold text-mute hover:text-ink"
          >
            {t('cam.post.close')}
          </button>
        </div>
      </div>
    );
  }

  const firstIndex = WORK_OFFSETS.indexOf(setup.work_offset);
  const offsetPreview = WORK_OFFSETS.slice(firstIndex, firstIndex + setup.work_offset_count)
    .map((offset, i) => conversational ? t('cam.post.preset').replace('{number}', String(firstIndex + i + 1)) : dialect === 'okuma' ? `G15 H${firstIndex + i + 1}` : offset.toUpperCase());

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
      if (!setup.machine) throw new Error(t('cam.post.errorSelectMachine'));
      if (!reviewed) throw new Error(t('cam.post.errorReviewMachine'));
      const config: CamPostConfigDto = {
        dialect,
        program_number: programNumber.trim()
          ? Math.round(parseDraft(programNumber, t('cam.post.programNumber')))
          : null,
        sequence_numbers: conversational || sequenceNumbers,
        tool_call_mode: toolCallMode,
        machine_retract_z: needsMachineRetract ? commitLength(parseDraft(machineRetractZ, t('cam.post.paramMachineRetractZ')), units) : null,
        siemens_828d:
          dialect === 'siemens828d'
            ? {
                ...initialSiemens,
                atc_style: atcStyle,
                tool_change_positioning: positioning,
                supa_retract_z: commitLength(parseDraft(supaZ, t('cam.post.supaRetractZ')), units),
                station_x: (() => {
                  const value = parseOptionalDraft(stationX, t('cam.post.stationX'));
                  return value === null ? null : commitLength(value, units);
                })(),
                station_y: (() => {
                  const value = parseOptionalDraft(stationY, t('cam.post.stationY'));
                  return value === null ? null : commitLength(value, units);
                })(),
                tool_length_offset: Math.round(parseDraft(toolEdgeD, t('cam.post.toolEdgeD'))),
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
          <span className="flex-1 text-xs font-semibold text-ink">{t('cam.post.title').replace('{name}', setup.name)}</span>
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
          <DialogSection title={t('cam.post.sectionPost')}>
            <p className="text-[11px] font-semibold text-ink">{setup.machine?.profile.name ?? t('cam.post.genericProgramming')}</p>
            <button type="button" className="text-[10px] text-accent underline"
              onClick={() => useAppStore.getState().setCamDialog({ type: 'setup', editId: setup.id })}>
              {setup.machine ? t('cam.post.changeMachine') : t('cam.post.chooseMachine')}
            </button>
              <DraftNumber
                label={t('cam.post.programNumber')}
                value={programNumber}
                onChange={setProgramNumber}
                integer
                placeholder={needsMachineRetract ? '1001' : t('cam.post.off')}
              />
            <label className="block">
              <span className={CAM_DIALOG_LABEL}>{t('cam.post.programName')}</span>
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
              {conversational ? t('cam.post.sequenceRequired') : t('cam.post.sequenceNumbers')}
            </label>
          </DialogSection>

          <p className="text-[10px] leading-relaxed text-mute">{compensationGuidance(dialect)}
            {' '}{t('cam.post.compensationNote1')}
            {' '}{t('cam.post.compensationNote2')}
          </p>

          <DialogSection title={t('cam.post.sectionTools')}>
            {namedTools && <label className="block"><span className={CAM_DIALOG_LABEL}>{t('cam.post.toolCalls')}</span>
              <select aria-label={t('cam.post.toolCalls')} className={CAM_DIALOG_INPUT} value={toolCallMode}
                onChange={event => { setToolCallMode(event.target.value as typeof toolCallMode); setReviewed(false); }}>
                <option value="automatic">{t('cam.post.toolCallAutomatic')}</option>
                <option value="number">{t('cam.post.toolCallNumbers')}</option>
                <option value="name">{t('cam.post.toolCallNames')}</option>
              </select></label>}
            <p className="text-[10px] leading-relaxed text-mute">{t('cam.post.toolCallsHelp')}</p>
            <ul className="text-[10px] text-mute space-y-1">{usedTools.map(tool => <li key={tool.id}>
              {toolCallMode === 'name' || (toolCallMode === 'automatic' && namedTools && tool.number == null) ? `“${tool.name}”` : `T${tool.number ?? '—'}`} · {tool.name}
            </li>)}</ul>
          </DialogSection>

          {needsMachineRetract && <DialogSection title={t('cam.post.sectionMachineRetract')}>
            <DraftNumber label={t('cam.post.machineRetractZ').replace('{unit}', lu)} value={machineRetractZ} onChange={setMachineRetractZ} />
            <p className="text-[10px] leading-relaxed text-mute">{t('cam.post.machineRetractHelp')}</p>
          </DialogSection>}

          <DialogSection title={t('cam.post.sectionWorkOffsets')}>
            <p className="text-[10px] leading-relaxed text-mute">
              {t('cam.post.workOffsetsIntro')
                .replace('{count}', String(setup.work_offset_count))
                .replace('{parts}', setup.work_offset_count > 1 ? t('cam.post.partPlural') : t('cam.post.partSingular'))
                .replace('{offsets}', offsetPreview.join(', '))}
            </p>
          </DialogSection>

          {dialect === 'siemens828d' && (
            <DialogSection title={t('cam.post.sectionSiemens')}>
              {initialSiemens.spindle_stop_subprogram && <p data-testid="cam-private-spindle-stop" className="rounded border border-warn/40 bg-warn/10 p-2 text-[10px] leading-relaxed text-ink">
                {t('cam.post.privateSpindleStopBefore')} <code>{initialSiemens.spindle_stop_subprogram}</code>{t('cam.post.privateSpindleStopAfter')}
              </p>}
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className={CAM_DIALOG_LABEL}>{t('cam.post.changerStyle')}</span>
                  <select
                    value={atcStyle}
                    onChange={(event) =>
                      setAtcStyle(event.target.value as Siemens828dPostConfigDto['atc_style'])
                    }
                    className={CAM_DIALOG_INPUT}
                  >
                    <option value="double_arm">{t('cam.post.atcDoubleArm')}</option>
                    <option value="umbrella">{t('cam.post.atcUmbrella')}</option>
                    <option value="carousel_chain">{t('cam.post.atcCarouselChain')}</option>
                    <option value="other">{t('cam.post.atcOther')}</option>
                  </select>
                </label>
                <label className="block">
                  <span className={CAM_DIALOG_LABEL}>{t('cam.post.positioningBeforeM6')}</span>
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
                    <option value="supa_z">{t('cam.post.positionSupaZ')}</option>
                    <option value="controller_managed">{t('cam.post.positionControllerManaged')}</option>
                    <option value="supa_z_then_xy">{t('cam.post.positionSupaZThenXy')}</option>
                  </select>
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <DraftNumber
                  label={t('cam.post.supaRetractZ')}
                  value={supaZ}
                  onChange={setSupaZ}
                  unit={t('cam.post.unitMachine').replace('{unit}', lu)}
                  disabled={positioning === 'controller_managed'}
                />
                <DraftNumber
                  label={t('cam.post.toolEdgeD')}
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
                    label={t('cam.post.stationX')}
                    value={stationX}
                    onChange={setStationX}
                    unit={lu}
                    placeholder={t('cam.post.off')}
                  />
                  <DraftNumber
                    label={t('cam.post.stationY')}
                    value={stationY}
                    onChange={setStationY}
                    unit={lu}
                    placeholder={t('cam.post.off')}
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
                  {t('cam.post.m1BetweenTools')}
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={preloadNextTool}
                    onChange={(event) => setPreloadNextTool(event.target.checked)}
                  />
                  {t('cam.post.allowPreload')}
                </label>
              </div>
              <p className="text-[9px] leading-relaxed text-[#e8c589]">
                {siemensAtcGuidance(siemensPreview({}))} {t('cam.post.atcGuidanceTail')}
              </p>
              <div className="rounded border border-edge/80 bg-[#11171c]/75 p-2">
                <div className="mb-1 text-[8px] font-semibold tracking-[0.12em] text-mute/65">
                  {t('cam.post.toolChangeExampleHeader')}
                </div>
                <pre className="overflow-x-auto whitespace-pre font-mono text-[9px] leading-4 text-ink">
                  {siemensToolChangeExample(siemensPreview({}))}
                </pre>
              </div>
            </DialogSection>
          )}

          <DialogSection title={t('cam.post.sectionStorage')}>
            <button type="button" className="text-[10px] text-accent underline"
              onClick={() => useAppStore.getState().setSettingsOpen(true)}>{t('cam.post.manageCustomPosts')}</button>
            <p className="text-[9px] leading-relaxed text-mute">{t('cam.post.storageHelp')}</p>
            <details><summary className="cursor-pointer text-[10px] text-mute">{t('cam.post.legacyInspection')}</summary>
            <button
              type="button"
              disabled={postAnalysisBusy}
              onClick={() => runCamAction(inspectPost)}
              className="flex h-7 w-full items-center justify-center gap-1.5 rounded border border-edge bg-header/45 text-[10px] font-semibold text-mute hover:border-accent/40 hover:text-accent disabled:opacity-40"
            >
              <FileCode2 size={13} /> {postAnalysisBusy ? t('cam.post.inspecting') : t('cam.post.inspectLegacySource')}
            </button>
            <p className="text-[9px] leading-relaxed text-mute">
              {t('cam.post.analyzerHelp')}
            </p>
            {postAnalysis && (
              <div className="rounded border border-edge bg-header/45 p-2 text-[9px] leading-relaxed text-mute">
                <div className="truncate font-semibold text-ink">{postAnalysis.file_name}</div>
                <div>
                  {postAnalysis.source_kind === 'callback_javascript'
                    ? t('cam.post.callbackShapeSupported')
                    : t('cam.post.postShapeUnrecognized')}{' '}
                  · {postAnalysis.callbacks.length} {t('cam.post.callbacks')}
                </div>
                <div className="mt-1 text-[#e8c589]">
                  {t('cam.post.analysisOnly')}
                </div>
                {postAnalysis.callbacks_outside_v1_target.length > 0 && (
                  <div className="mt-1 break-words">
                    {t('cam.post.beyondV1')} {postAnalysis.callbacks_outside_v1_target.join(', ')}
                  </div>
                )}
              </div>
            )}
            </details>
          </DialogSection>
        </fieldset>
        </div>
        {prepared ? <div data-testid="cam-post-review" className="max-h-48 shrink-0 space-y-1 overflow-y-auto border-t border-edge p-3">
          <p className="text-[11px] font-semibold text-ink">{t('cam.post.ncPrepared')}</p>
          {prepared.result.warnings.map((warning, i) => <p key={i} className="text-[10px] leading-relaxed text-mute">{warning}</p>)}
          <button type="button" disabled={busy} className="text-[10px] text-accent underline" onClick={() => { setPrepared(null); setReviewed(false); }}>{t('cam.post.backToSettings')}</button>
        </div> : <label className="flex shrink-0 items-start gap-2 border-t border-edge p-3 text-[10px] text-ink">
          <input data-testid="cam-post-confirm" type="checkbox" checked={reviewed} disabled={!setup.machine || busy}
            onChange={e => setReviewed(e.target.checked)} />
          {t('cam.post.reviewConfirm')}
        </label>}
        <footer className="flex h-11 shrink-0 items-center justify-end gap-2 border-t border-edge px-3">
          <button
            type="button"
            onClick={close}
            className="h-7 rounded border border-edge px-3 text-[10px] font-semibold text-mute hover:text-ink"
          >
            {t('cam.post.cancel')}
          </button>
          <button
            type="submit"
            disabled={busy || !setup.machine || (!prepared && !reviewed)}
            className="h-7 rounded border border-accent/50 bg-accent/15 px-3 text-[10px] font-semibold text-accent hover:bg-accent/25 disabled:opacity-40"
          >
            {busy ? t('cam.post.checking') : prepared ? t('cam.post.saveNc') : t('cam.post.checkPrepareNc')}
          </button>
        </footer>
      </form>
    </div>
  );
}

function siemensAtcGuidance(profile: Siemens828dPostConfigDto): string {
  const style = profile.atc_style === 'double_arm'
    ? translate('cam.post.atcGuidanceDoubleArm')
    : profile.atc_style === 'umbrella'
      ? translate('cam.post.atcGuidanceUmbrella')
      : profile.atc_style === 'carousel_chain'
        ? translate('cam.post.atcGuidanceCarousel')
        : translate('cam.post.atcGuidanceCustom');
  const positioning = profile.tool_change_positioning === 'supa_z'
    ? translate('cam.post.atcPositioningSupaZ').replace('{height}', String(profile.supa_retract_z))
    : profile.tool_change_positioning === 'controller_managed'
      ? translate('cam.post.atcPositioningController')
      : profile.station_x === null || profile.station_y === null
        ? translate('cam.post.atcPositioningEnterXy')
        : translate('cam.post.atcPositioningStation')
          .replace('{x}', String(profile.station_x))
          .replace('{y}', String(profile.station_y));
  const preload = profile.preload_next_tool
    ? profile.atc_style === 'carousel_chain'
      ? translate('cam.post.atcPreloadCarouselWarning')
      : translate('cam.post.atcPreloadEnabled')
    : translate('cam.post.atcPreloadDisabled');
  return `${style} ${positioning} ${preload}`;
}

function siemensToolChangeExample(profile: Siemens828dPostConfigDto): string {
  const style = profile.atc_style === 'double_arm'
    ? translate('cam.post.exampleDoubleArm')
    : profile.atc_style === 'umbrella'
      ? translate('cam.post.exampleUmbrella')
      : profile.atc_style === 'carousel_chain'
        ? translate('cam.post.exampleCarousel')
        : translate('cam.post.exampleCustom');
  const lines = [translate('cam.post.exampleHeader').replace('{style}', style), 'M9'];
  if (profile.spindle_stop_subprogram) lines.push(profile.spindle_stop_subprogram);
  lines.push('M5');
  if (profile.tool_change_positioning === 'supa_z') {
    lines.push(`G0 SUPA Z${profile.supa_retract_z} D0`, `D${profile.tool_length_offset}`);
  } else if (profile.tool_change_positioning === 'controller_managed') {
    lines.push(translate('cam.post.exampleControllerManaged'));
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
