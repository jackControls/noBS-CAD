import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowUpDown, Box, CircleDot, Layers, Link2, Wrench, X, type LucideIcon } from 'lucide-react';
import {
  activeCamSetup,
  addCamOperation,
  camOperationLabel,
  camToolCompatible,
  type CamOperationInput,
} from '../../cam/document';
import {
  listSketchLoops,
  loopToSetupPath,
  modelBottomZInSetup,
  modelTopZInSetup,
  type SketchLoop,
} from '../../cam/geometry';
import {
  commitFeed,
  commitLength,
  cuttingSpeedFromRpm,
  cuttingSpeedUnitLabel,
  displayCuttingSpeed,
  displayFeed,
  displayLength,
} from '../../cam/units';
import {
  THREAD_PRESETS,
  defaultThreadPreset,
  isoMetricGrade6Envelope,
} from '../../lib/threadStandards';
import type { CamContourCompensation, CamCoolantMode, CamDrillCycle, CamMillingDirection, CamPoint2Dto, CamThreadHand, CamToolDto } from '../../engine/types';
import { useAppStore } from '../../store/appStore';
import { runCamAction } from './CamBrowser';
import {
  CAM_DIALOG_INPUT,
  CAM_DIALOG_LABEL,
  DialogSection,
  DraftNumber,
  NOT_APPLIED_YET,
  feedUnit,
  lengthUnit,
  parseDraft,
} from './camFields';
import { OP_PAGES, openCamToolPicker, useCamToolPickResult } from './opShared';

type OperationKind = CamOperationInput['kind'];
type GeometrySource = 'sketch' | 'manual';

/** Reference planes an operation height can hang off; resolved to absolute
 *  setup Z at submit. The dead entries round out the option set the UI
 *  contract promises; the planner only consumes the live five today. */
type HeightFrom = 'model_top' | 'model_bottom' | 'stock_top' | 'stock_bottom' | 'origin';

const HEIGHT_FROM_LIVE: Array<{ value: HeightFrom; label: string }> = [
  { value: 'model_top', label: 'Model top' },
  { value: 'model_bottom', label: 'Model bottom' },
  { value: 'stock_top', label: 'Stock top' },
  { value: 'stock_bottom', label: 'Stock bottom' },
  { value: 'origin', label: 'Origin (absolute)' },
];
const HEIGHT_FROM_DEAD = [
  'Retract height',
  'Feed height',
  'Top height',
  'Bottom height',
  'Fixture top',
  'Fixture bottom',
  'Selected contour(s)',
  'Selection',
  'Highest of…',
  'Lowest of…',
];

/** One height row: reference plane + signed offset. */
function HeightField({
  from,
  offset,
  onFrom,
  onOffset,
  unit,
  disabled = false,
}: {
  from: HeightFrom;
  offset: string;
  onFrom: (value: HeightFrom) => void;
  onOffset: (value: string) => void;
  unit: string;
  disabled?: boolean;
}) {
  return (
    <div
      className={`grid grid-cols-2 gap-2 ${disabled ? 'opacity-45' : ''}`}
      title={disabled ? NOT_APPLIED_YET : undefined}
    >
      <label className="block">
        <span className={CAM_DIALOG_LABEL}>From</span>
        <select
          value={from}
          disabled={disabled}
          onChange={(event) => onFrom(event.target.value as HeightFrom)}
          className={`${CAM_DIALOG_INPUT} ${disabled ? 'cursor-not-allowed' : ''}`}
        >
          {HEIGHT_FROM_LIVE.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
          <optgroup label="Not applied yet">
            {HEIGHT_FROM_DEAD.map((text) => (
              <option key={text} disabled>
                {text}
              </option>
            ))}
          </optgroup>
        </select>
      </label>
      <label className="block">
        <span className={CAM_DIALOG_LABEL}>Offset</span>
        <span className="relative block">
          <input
            type="number"
            step="any"
            value={offset}
            disabled={disabled}
            onChange={(event) => onOffset(event.target.value)}
            className={`${CAM_DIALOG_INPUT} pr-12 font-mono ${disabled ? 'cursor-not-allowed' : ''}`}
          />
          <span className="pointer-events-none absolute right-2 top-1.5 text-[8px] text-mute/60">
            {unit}
          </span>
        </span>
      </label>
    </div>
  );
}

/** Placeholder checkbox the planner does not consume yet. */
function DeadCheck({ label, checked = false }: { label: string; checked?: boolean }) {
  return (
    <label
      className="flex cursor-not-allowed items-center gap-2 text-[11px] text-mute/60"
      title={NOT_APPLIED_YET}
    >
      <input type="checkbox" checked={checked} disabled readOnly />
      {label}
    </label>
  );
}

/** Placeholder select pinned to one display value. */
function DeadSelect({ label, value }: { label: string; value: string }) {
  return (
    <label className="block" title={NOT_APPLIED_YET}>
      <span className={CAM_DIALOG_LABEL}>{label}</span>
      <select disabled className={`${CAM_DIALOG_INPUT} cursor-not-allowed opacity-45`}>
        <option>{value}</option>
      </select>
    </label>
  );
}

/** Placeholder button (viewport selection workflows land later). */
function DeadButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      disabled
      title={NOT_APPLIED_YET}
      className="h-7 cursor-not-allowed rounded border border-edge px-3 text-[10px] font-semibold text-mute/60 opacity-60"
    >
      {label}
    </button>
  );
}

/** Read-only derived value (surface speed, chip load, …). */
function DerivedField({ label, text, unit }: { label: string; text: string; unit?: string }) {
  return (
    <label className="block" title="Derived from the live fields">
      <span className={CAM_DIALOG_LABEL}>{label}</span>
      <span className="relative block">
        <input
          value={text}
          disabled
          readOnly
          className={`${CAM_DIALOG_INPUT} cursor-default font-mono opacity-70 ${unit ? 'pr-12' : ''}`}
        />
        {unit && (
          <span className="pointer-events-none absolute right-2 top-1.5 text-[8px] text-mute/60">
            {unit}
          </span>
        )}
      </span>
    </label>
  );
}

type OpTab = 'tool' | 'geometry' | 'heights' | 'passes' | 'linking';

const OP_TABS: Array<{ id: OpTab; label: string; icon: LucideIcon }> = [
  { id: 'tool', label: 'Tool', icon: Wrench },
  { id: 'geometry', label: 'Geometry', icon: Box },
  { id: 'heights', label: 'Heights', icon: ArrowUpDown },
  { id: 'passes', label: 'Passes', icon: Layers },
  { id: 'linking', label: 'Linking', icon: Link2 },
];

/** Program one operation end to end. Every kind runs through the same
 *  five-tab scaffold (Tool / Geometry / Heights / Passes / Linking); the
 *  kind only switches geometry shapes and fields on through `OP_PAGES`, so
 *  a shared tab (tool picking, heights, feeds) is edited once for all
 *  operation kinds. Geometry, tool, heights, and feeds are all explicit;
 *  validation in the engine rejects incomplete input. */
export function CamOperationDialog({ kind }: { kind: OperationKind }) {
  const cam = useAppStore((state) => state.camDocument);
  const sketches = useAppStore((state) => state.finishedSketches);
  const scene = useAppStore((state) => state.solidScene);
  const close = () => useAppStore.getState().setCamDialog(null);
  const units = cam.units;
  const lu = lengthUnit(units);
  const setup = activeCamSetup(cam);
  const pages = OP_PAGES[kind];
  // Drill operations pick the cycle before the tool: the cycle decides which
  // tool kinds are compatible (tap -> tap, reaming -> reamer, ...).
  const [drillCycle, setDrillCycle] = useState<CamDrillCycle>('drill');
  const projectTools = useMemo(
    () =>
      cam.tools.filter((tool) =>
        camToolCompatible(kind, tool, kind === 'drill' ? drillCycle : undefined),
      ),
    [cam.tools, kind, drillCycle],
  );

  const loops = useMemo(() => listSketchLoops(sketches), [sketches]);
  const existingCount = setup?.operations.filter((operation) => operation.kind === kind).length ?? 0;

  const [name, setName] = useState(`${camOperationLabel(kind)} ${existingCount + 1}`);
  const [toolId, setToolId] = useState<number | null>(projectTools[0]?.id ?? null);
  const [presetIndex, setPresetIndex] = useState(0);
  const [rpm, setRpm] = useState('');
  const [feedXy, setFeedXy] = useState('');
  const [feedZ, setFeedZ] = useState('');
  const [coolant, setCoolant] = useState<CamCoolantMode>('flood');
  const [feedsTouched, setFeedsTouched] = useState(false);

  const [source, setSource] = useState<GeometrySource>(loops.length > 0 ? 'sketch' : 'manual');
  const [loopKey, setLoopKey] = useState('');
  const [manualPoints, setManualPoints] = useState('');
  // Drilling/thread: holes are picked as cylindrical faces in the viewport;
  // the session lives in the store so the shared viewport can drive it.
  const holePick = useAppStore((state) => state.camHolePick);

  const [stepDown, setStepDown] = useState('');
  const [stepOver, setStepOver] = useState('');
  // Facing plunge clearance from the stock boundary (see the planner).
  const [safeDistance, setSafeDistance] = useState(displayLength(5, units).toFixed(4));
  // Active tab, structured heights (reference plane + signed offset), and the
  // multiple-depths toggle.
  const [opTab, setOpTab] = useState<OpTab>('tool');
  const [clearanceFrom, setClearanceFrom] = useState<HeightFrom>('stock_top');
  const [clearanceOff, setClearanceOff] = useState(displayLength(10, units).toFixed(4));
  const [retractFrom, setRetractFrom] = useState<HeightFrom>('stock_top');
  const [retractOff, setRetractOff] = useState(displayLength(3, units).toFixed(4));
  // Facing starts from the stock top; every other kind starts from the model
  // top (a drill/contour rarely begins inside the stock allowance).
  const [topFrom, setTopFrom] = useState<HeightFrom>(kind === 'face' ? 'stock_top' : 'model_top');
  const [topOff, setTopOff] = useState('0');
  // Face bottoms ride the model top; hole/path kinds default to the model
  // bottom so a fresh dialog describes a through cut.
  const [bottomFrom, setBottomFrom] = useState<HeightFrom>(
    kind === 'face' ? 'model_top' : 'model_bottom',
  );
  const [bottomOff, setBottomOff] = useState('0');
  const [multipleDepths, setMultipleDepths] = useState(true);
  const [compensation, setCompensation] = useState<CamContourCompensation>('outside');
  const [wallSide, setWallSide] = useState<CamContourCompensation>('inside');
  const [chamferWidth, setChamferWidth] = useState('');
  const [tipOffset, setTipOffset] = useState('');
  const [peckDepth, setPeckDepth] = useState('');
  const [peckRetract, setPeckRetract] = useState('');
  const [threadPitch, setThreadPitch] = useState('');
  const [feedOut, setFeedOut] = useState('');
  const [dwell, setDwell] = useState('0');
  // Thread milling: the designation resolves pitch/major/minor through the
  // standards table; the resolved values are stored on the operation.
  const [threadPresetId, setThreadPresetId] = useState(defaultThreadPreset().id);
  const [threadHand, setThreadHand] = useState<CamThreadHand>('right');
  const [threadDirection, setThreadDirection] = useState<CamMillingDirection>('climb');
  const [radialPasses, setRadialPasses] = useState('1');
  const [threadStepOver, setThreadStepOver] = useState('');
  const [faceMin, setFaceMin] = useState({ x: '', y: '' });
  const [faceMax, setFaceMax] = useState({ x: '', y: '' });
  const [faceFromStock, setFaceFromStock] = useState(true);
  const [error, setError] = useState<string | null>(null);

  if (!setup) return null;

  // Setup-space Z of the model's top surface; face depths are entered
  // relative to it. Null when the setup references no bodies.
  const modelTop = modelTopZInSetup(scene, setup);
  const modelBottom = modelBottomZInSetup(scene, setup);
  const selectedTool = cam.tools.find((candidate) => candidate.id === toolId) ?? null;

  /** Reference plane of a structured height, as absolute setup Z.
   *  Falls back to the stock plane when the setup references no bodies. */
  const heightRefZ = (from: HeightFrom): number => {
    switch (from) {
      case 'model_top':
        return modelTop ?? setup.stock.max.z;
      case 'model_bottom':
        return modelBottom ?? setup.stock.min.z;
      case 'stock_top':
        return setup.stock.max.z;
      case 'stock_bottom':
        return setup.stock.min.z;
      case 'origin':
        return 0;
    }
  };
  const resolveHeight = (from: HeightFrom, offset: string, label: string): number =>
    heightRefZ(from) + commitLength(parseDraft(offset, `${label} offset`), units);

  /** Copy a library cutting profile (default or a named preset) into the
   *  feeds & speeds drafts. */
  const applyCutting = (tool: CamToolDto, preset: number) => {
    const data =
      preset === 0 ? tool.cutting : tool.cutting_presets[preset - 1]?.cutting;
    if (!data) return;
    setRpm(String(data.spindle_rpm));
    setFeedXy(displayFeed(data.feed_xy, units).toFixed(4));
    setFeedZ(displayFeed(data.feed_z, units).toFixed(4));
    setCoolant(data.coolant);
  };

  const chooseTool = (tool: CamToolDto) => {
    setToolId(tool.id);
    setPresetIndex(0);
    if (!feedsTouched) {
      applyCutting(tool, 0);
      if ((kind === 'face' || kind === 'pocket2d') && !stepOver) {
        setStepOver(displayLength(tool.diameter * 0.5, units).toFixed(4));
      }
    }
  };

  /** Switch the drill cycle; keeps the selected tool only when it stays
   *  compatible, otherwise re-selects the first compatible project tool. */
  const changeCycle = (cycle: CamDrillCycle) => {
    setDrillCycle(cycle);
    const compatible = cam.tools.filter((tool) => camToolCompatible('drill', tool, cycle));
    if (!compatible.some((tool) => tool.id === toolId)) {
      setFeedsTouched(false);
      if (compatible[0]) chooseTool(compatible[0]);
      else setToolId(null);
    }
  };
  // Prefill speeds & feeds from the initially selected library tool.
  useEffect(() => {
    if (toolId !== null && !feedsTouched && rpm === '') {
      const tool = cam.tools.find((candidate) => candidate.id === toolId);
      if (tool) chooseTool(tool);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tool picked in the stacked library picker: the picker confirms a tool id
  // into `camToolPick`; this dialog consumes it here.
  const pickCompatible = useMemo(
    () => (tool: CamToolDto) =>
      camToolCompatible(kind, tool, kind === 'drill' ? drillCycle : undefined),
    [kind, drillCycle],
  );
  useCamToolPickResult(pickCompatible, (tool) => {
    setFeedsTouched(false);
    chooseTool(tool);
  });

  // Hole-geometry kinds open a viewport hole-pick session for the dialog's
  // lifetime; closing the dialog ends picking and clears the hover state.
  useEffect(() => {
    if (pages.geometry !== 'holes') return;
    useAppStore.getState().setCamHolePick({ holes: [], hoverKey: null });
    return () => {
      const state = useAppStore.getState();
      state.setCamHolePick(null);
      state.setHoveredFace(null);
    };
  }, [pages.geometry]);

  const selectedLoop = (): SketchLoop | null => {
    const loop = loops.find((candidate) => `${candidate.sketch}:${candidate.entityIds.join(',')}` === loopKey);
    return loop ?? loops[0] ?? null;
  };

  const pathFromLoop = (): CamPoint2Dto[] => {
    const loop = selectedLoop();
    if (!loop) throw new Error('Pick a sketch loop, or switch to manual coordinates.');
    return loopToSetupPath(loop, sketches, setup.wcs);
  };

  const parseManualPoints = (label: string): CamPoint2Dto[] => {
    const points = manualPoints
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, index) => {
        const values = line.split(/[\s,;]+/).filter(Boolean).map(Number);
        if (values.length !== 2 || !values.every(Number.isFinite)) {
          throw new Error(`${label} line ${index + 1} must contain X,Y numbers.`);
        }
        return { x: commitLength(values[0], units), y: commitLength(values[1], units) };
      });
    if (points.length === 0) throw new Error(`${label}: enter at least one point or pick sketch geometry.`);
    return points;
  };

  const resolvePath = (label: string): CamPoint2Dto[] =>
    source === 'sketch' ? pathFromLoop() : parseManualPoints(label);

  const resolveDrillPoints = (): CamPoint2Dto[] => {
    const fromPicks = (holePick?.holes ?? []).map((hole) => ({
      x: hole.point.x,
      y: hole.point.y,
    }));
    const manual = manualPoints.trim() ? parseManualPoints('Hole centers') : [];
    const points = [...fromPicks, ...manual];
    if (points.length === 0) {
      throw new Error('Click hole faces in the viewport, or enter hole centers manually.');
    }
    return points;
  };

  const cutting = () => ({
    spindle_rpm: Math.round(parseDraft(rpm, 'Spindle speed')),
    feed_xy: commitFeed(parseDraft(feedXy, 'Cutting feed'), units),
    feed_z: commitFeed(parseDraft(feedZ, 'Plunge feed'), units),
    coolant,
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      if (toolId === null) throw new Error('Pick a tool from the library first.');
      const base = {
        name: name.trim() || camOperationLabel(kind),
        enabled: true,
        tool_id: toolId,
        clearance_z: resolveHeight(clearanceFrom, clearanceOff, 'Clearance height'),
        retract_z: resolveHeight(retractFrom, retractOff, 'Retract height'),
      };
      const top = resolveHeight(topFrom, topOff, 'Top height');
      // Bottom height is a reference plane plus a signed offset, resolved to
      // absolute setup Z for the kinds that cut to a depth.
      const bottomAbs = () => resolveHeight(bottomFrom, bottomOff, 'Bottom height');
      let operation: CamOperationInput;
      switch (kind) {
        case 'face': {
          const bounds = faceFromStock
            ? { min: { x: setup.stock.min.x, y: setup.stock.min.y }, max: { x: setup.stock.max.x, y: setup.stock.max.y } }
            : {
                min: {
                  x: commitLength(parseDraft(faceMin.x, 'Face min X'), units),
                  y: commitLength(parseDraft(faceMin.y, 'Face min Y'), units),
                },
                max: {
                  x: commitLength(parseDraft(faceMax.x, 'Face max X'), units),
                  y: commitLength(parseDraft(faceMax.y, 'Face max Y'), units),
                },
              };
          const target = bottomAbs();
          operation = {
            ...base,
            kind,
            bounds,
            top_z: top,
            target_z: target,
            step_over: commitLength(parseDraft(stepOver, 'Stepover'), units),
            // Without multiple depths a single pass covers the full depth.
            step_down: multipleDepths
              ? commitLength(parseDraft(stepDown, 'Maximum stepdown'), units)
              : Math.max(Math.abs(top - target), 0.001),
            safe_distance: commitLength(parseDraft(safeDistance, 'Safe distance'), units),
            cutting: cutting(),
          };
          break;
        }
        case 'contour2d': {
          const bottom = bottomAbs();
          operation = {
            ...base,
            kind,
            path: resolvePath('Contour path'),
            top_z: top,
            bottom_z: bottom,
            step_down: multipleDepths
              ? commitLength(parseDraft(stepDown, 'Maximum stepdown'), units)
              : Math.max(Math.abs(top - bottom), 0.001),
            compensation,
            cutting: cutting(),
          };
          break;
        }
        case 'pocket2d': {
          const bottom = bottomAbs();
          operation = {
            ...base,
            kind,
            outline: resolvePath('Pocket outline'),
            top_z: top,
            bottom_z: bottom,
            step_down: multipleDepths
              ? commitLength(parseDraft(stepDown, 'Maximum stepdown'), units)
              : Math.max(Math.abs(top - bottom), 0.001),
            step_over: commitLength(parseDraft(stepOver, 'Stepover'), units),
            cutting: cutting(),
          };
          break;
        }
        case 'chamfer2d':
          operation = {
            ...base,
            kind,
            path: resolvePath('Chamfer path'),
            top_z: top,
            chamfer_width: commitLength(parseDraft(chamferWidth, 'Chamfer width'), units),
            tip_offset: commitLength(parseDraft(tipOffset, 'Tip offset'), units),
            wall_side: wallSide,
            cutting: cutting(),
          };
          break;
        case 'drill': {
          const pecking = drillCycle === 'chip_breaking' || drillCycle === 'deep_hole';
          const tapping = drillCycle === 'tapping_right' || drillCycle === 'tapping_left';
          const feedingOut = drillCycle === 'reaming' || drillCycle === 'boring';
          operation = {
            ...base,
            kind,
            points: resolveDrillPoints(),
            top_z: top,
            bottom_z: bottomAbs(),
            cycle: drillCycle,
            peck_depth: pecking
              ? commitLength(parseDraft(peckDepth, 'Peck depth'), units)
              : null,
            peck_retract:
              drillCycle === 'chip_breaking' && peckRetract.trim()
                ? commitLength(parseDraft(peckRetract, 'Peck retract'), units)
                : null,
            thread_pitch: tapping
              ? commitLength(parseDraft(threadPitch, 'Thread pitch'), units)
              : null,
            feed_out:
              feedingOut && feedOut.trim()
                ? commitFeed(parseDraft(feedOut, 'Feed out'), units)
                : null,
            dwell_seconds: tapping ? 0 : parseDraft(dwell, 'Dwell'),
            cutting: cutting(),
          };
          break;
        }
        case 'thread': {
          // The designation only seeds values here; the stored operation
          // carries the resolved pitch and diameters explicitly.
          const preset =
            THREAD_PRESETS.find((candidate) => candidate.id === threadPresetId) ??
            defaultThreadPreset();
          const envelope = isoMetricGrade6Envelope(
            preset.nominalDiameterMm,
            preset.pitchMm,
            'internal',
          );
          const passes = Math.max(1, Math.round(parseDraft(radialPasses, 'Radial passes')));
          operation = {
            ...base,
            kind,
            points: resolveDrillPoints(),
            top_z: top,
            bottom_z: bottomAbs(),
            pitch: preset.pitchMm,
            major_diameter: envelope.modeledMajor,
            minor_diameter: envelope.modeledMinor,
            hand: threadHand,
            direction: threadDirection,
            radial_passes: passes,
            step_over:
              passes > 1
                ? commitLength(parseDraft(threadStepOver, 'Radial stepover'), units)
                : null,
            cutting: cutting(),
          };
          break;
        }
      }
      runCamAction(() => addCamOperation(operation).then(() => close()));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const threadReadout = (): string => {
    const preset =
      THREAD_PRESETS.find((candidate) => candidate.id === threadPresetId) ??
      defaultThreadPreset();
    const envelope = isoMetricGrade6Envelope(preset.nominalDiameterMm, preset.pitchMm, 'internal');
    const len = (mm: number) => displayLength(mm, units).toFixed(units === 'inches' ? 4 : 3);
    return `Pitch ${len(preset.pitchMm)} ${lu}/rev · major Ø${len(envelope.modeledMajor)} · minor Ø${len(envelope.modeledMinor)} ${lu}. Pre-machine the hole to the minor diameter; custom diameters can be edited on the created operation.`;
  };

  const geometrySection = () => {
    if (pages.geometry === 'holes') {
      const holes = holePick?.holes ?? [];
      return (
        <DialogSection title="HOLES · PICKED IN VIEWPORT">
          <p className="rounded border border-accent/30 bg-accent/5 p-2 text-[10px] leading-relaxed text-mute">
            Click cylindrical hole faces in the viewport to toggle them as hole centers; only
            faces whose axis is parallel to setup Z are pickable.
          </p>
          {holes.length > 0 && (
            <div className="max-h-28 space-y-1 overflow-y-auto rounded border border-edge/70 p-1.5">
              {holes.map((hole) => (
                <div key={hole.key} className="flex items-center gap-2 text-[11px] text-ink">
                  <span className="min-w-0 flex-1 truncate font-mono">
                    Ø{displayLength(hole.radius * 2, units).toFixed(3)} · X{' '}
                    {displayLength(hole.point.x, units).toFixed(3)} · Y{' '}
                    {displayLength(hole.point.y, units).toFixed(3)}
                  </span>
                  <button
                    type="button"
                    title="Remove this hole"
                    onClick={() => useAppStore.getState().toggleCamHolePickHole(hole)}
                    className="shrink-0 rounded p-0.5 text-mute hover:bg-edge hover:text-warn"
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <label className="block">
            <span className={CAM_DIALOG_LABEL}>Manual centers · one X,Y per line ({lu})</span>
            <textarea
              value={manualPoints}
              onChange={(event) => setManualPoints(event.target.value)}
              rows={2}
              className={`${CAM_DIALOG_INPUT} h-auto resize-y font-mono leading-5`}
            />
          </label>
        </DialogSection>
      );
    }
    if (pages.geometry === 'face') {
      return (
        <DialogSection title="STOCK CONTOURS">
          <div className="flex items-center gap-2">
            <span className="flex-1 text-[10px] text-mute">Stock Selections</span>
            <DeadButton label="Select" />
          </div>
          <label className="flex items-center gap-2 text-[11px] text-ink">
            <input
              type="checkbox"
              checked={faceFromStock}
              onChange={(event) => setFaceFromStock(event.target.checked)}
            />
            Face the whole stock top
          </label>
          {!faceFromStock && (
            <div className="grid grid-cols-2 gap-2">
              <DraftNumber label="Min X" value={faceMin.x} onChange={(v) => setFaceMin((c) => ({ ...c, x: v }))} unit={lu} />
              <DraftNumber label="Min Y" value={faceMin.y} onChange={(v) => setFaceMin((c) => ({ ...c, y: v }))} unit={lu} />
              <DraftNumber label="Max X" value={faceMax.x} onChange={(v) => setFaceMax((c) => ({ ...c, x: v }))} unit={lu} />
              <DraftNumber label="Max Y" value={faceMax.y} onChange={(v) => setFaceMax((c) => ({ ...c, y: v }))} unit={lu} />
            </div>
          )}
        </DialogSection>
      );
    }
    return (
      <DialogSection title={`${(pages.pathLabel ?? 'Path').toUpperCase()} · OPERATOR SELECTED`}>
        <div className="grid grid-cols-2 gap-1.5">
          {(
            [
              ['sketch', `Sketch loop (${loops.length})`],
              ['manual', 'Manual points'],
            ] as [GeometrySource, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setSource(value)}
              className={`h-7 rounded border text-[10px] font-semibold ${
                source === value
                  ? 'border-accent/50 bg-accent/15 text-accent'
                  : 'border-edge bg-header/50 text-mute hover:text-ink'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {source === 'sketch' ? (
          loops.length > 0 ? (
            <select
              value={loopKey || (loops[0] ? `${loops[0].sketch}:${loops[0].entityIds.join(',')}` : '')}
              onChange={(event) => setLoopKey(event.target.value)}
              className={`${CAM_DIALOG_INPUT} mt-2`}
            >
              {loops.map((loop) => {
                const key = `${loop.sketch}:${loop.entityIds.join(',')}`;
                return (
                  <option key={key} value={key}>
                    {loop.label}
                  </option>
                );
              })}
            </select>
          ) : (
            <p className="mt-2 text-[10px] italic text-mute">
              No closed sketch loops found. Sketch a closed profile first, or use manual points.
            </p>
          )
        ) : (
          <label className="mt-2 block">
            <span className={CAM_DIALOG_LABEL}>Closed path · one X,Y per line ({lu}, setup frame)</span>
            <textarea
              value={manualPoints}
              onChange={(event) => setManualPoints(event.target.value)}
              rows={4}
              className={`${CAM_DIALOG_INPUT} h-auto resize-y font-mono leading-5`}
            />
          </label>
        )}
      </DialogSection>
    );
  };

  /** THREAD · Geometry tab add-on: the designation resolves pitch and
   *  diameters through the standards table; the readout spells them out. */
  const threadGeometrySection = () => (
    <DialogSection title="THREAD (INTERNAL)">
      <label className="block">
        <span className={CAM_DIALOG_LABEL}>Designation</span>
        <select
          value={threadPresetId}
          onChange={(event) => setThreadPresetId(event.target.value)}
          className={CAM_DIALOG_INPUT}
        >
          {THREAD_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.designation} · {preset.class}
            </option>
          ))}
        </select>
      </label>
      <p className="rounded border border-edge/70 bg-header/50 p-2 font-mono text-[9px] leading-relaxed text-mute">
        {threadReadout()}
      </p>
    </DialogSection>
  );

  /** Tool tab: current tool + Select (library picker), presets, and the
   *  feed & speed grid. Live fields drive the plan; derived fields read out
   *  surface speed and chip loads; the rest are placeholders. Holemaking
   *  cycles drop the lateral-feed pair — a drill only plunges. */
  const toolTab = () => {
    const holemaking = kind === 'drill';
    const rpmValue = Number(rpm);
    const rpmOk = rpm.trim() !== '' && Number.isFinite(rpmValue) && rpmValue > 0;
    const feedXyOk = feedXy.trim() !== '' && Number.isFinite(Number(feedXy));
    const feedZOk = feedZ.trim() !== '' && Number.isFinite(Number(feedZ));
    const surfaceSpeed =
      rpmOk && selectedTool ? cuttingSpeedFromRpm(rpmValue, selectedTool.diameter) : null;
    const perTooth =
      rpmOk && feedXyOk && selectedTool && selectedTool.flute_count > 0
        ? commitFeed(Number(feedXy), units) / (rpmValue * selectedTool.flute_count)
        : null;
    const perRev = rpmOk && feedZOk ? commitFeed(Number(feedZ), units) / rpmValue : null;
    const fu = feedUnit(units);
    return (
      <>
        <DialogSection title="TOOL">
          <div className="flex items-center gap-1.5">
            <div className="flex h-7 min-w-0 flex-1 items-center truncate rounded border border-edge bg-header px-2 font-mono text-[10px] text-ink">
              {selectedTool
                ? `${selectedTool.number != null ? `T${selectedTool.number} · ` : ''}${selectedTool.name} · Ø${displayLength(selectedTool.diameter, units).toFixed(3)} ${lu}`
                : 'No tool selected'}
            </div>
            <button
              type="button"
              title="Pick from the Tool Library (central picks are copied into this project)"
              onClick={() => openCamToolPicker(kind, kind === 'drill' ? drillCycle : undefined)}
              className="h-7 shrink-0 rounded border border-accent/50 bg-accent/15 px-2 text-[10px] font-semibold text-accent hover:bg-accent/25"
            >
              Select…
            </button>
          </div>
        </DialogSection>
        <DialogSection title="FEED & SPEED">
          <div className="grid grid-cols-2 gap-2">
            {selectedTool && selectedTool.cutting_presets.length > 0 && (
              <label className="col-span-2 block">
                <span className={CAM_DIALOG_LABEL}>Preset</span>
                <select
                  value={presetIndex}
                  onChange={(event) => {
                    const index = Number(event.target.value);
                    setPresetIndex(index);
                    setFeedsTouched(false);
                    applyCutting(selectedTool, index);
                  }}
                  className={CAM_DIALOG_INPUT}
                >
                  <option value={0}>Default preset</option>
                  {selectedTool.cutting_presets.map((preset, index) => (
                    <option key={index + 1} value={index + 1}>
                      {preset.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <DraftNumber
              label="Spindle speed"
              value={rpm}
              onChange={(v) => { setFeedsTouched(true); setRpm(v); }}
              unit="rpm"
              integer
            />
            <DerivedField
              label="Surface speed"
              text={surfaceSpeed === null ? '—' : displayCuttingSpeed(surfaceSpeed, units).toFixed(2)}
              unit={cuttingSpeedUnitLabel(units)}
            />
            <DraftNumber label="Ramp spindle speed" value={rpm} onChange={() => {}} unit="rpm" disabled />
            {!holemaking && (
              <>
                <DraftNumber
                  label="Cutting feedrate"
                  value={feedXy}
                  onChange={(v) => { setFeedsTouched(true); setFeedXy(v); }}
                  unit={fu}
                />
                <DerivedField
                  label="Feed per tooth"
                  text={perTooth === null ? '—' : displayLength(perTooth, units).toFixed(4)}
                  unit={lu}
                />
                <DraftNumber label="Lead-in feedrate" value={feedXy} onChange={() => {}} unit={fu} disabled />
                <DraftNumber label="Lead-out feedrate" value={feedXy} onChange={() => {}} unit={fu} disabled />
                <DraftNumber label="Transition feedrate" value={feedXy} onChange={() => {}} unit={fu} disabled />
                <DraftNumber label="Ramp feedrate" value={feedXy} onChange={() => {}} unit={fu} disabled />
              </>
            )}
            <DraftNumber
              label={holemaking ? 'Drilling feedrate' : 'Plunge feedrate'}
              value={feedZ}
              onChange={(v) => { setFeedsTouched(true); setFeedZ(v); }}
              unit={fu}
            />
            <DerivedField
              label={holemaking ? 'Feed per revolution' : 'Plunge feed per revolution'}
              text={perRev === null ? '—' : displayLength(perRev, units).toFixed(4)}
              unit={lu}
            />
            <label className="col-span-2 block">
              <span className={CAM_DIALOG_LABEL}>Coolant</span>
              <select
                value={coolant}
                onChange={(event) => { setFeedsTouched(true); setCoolant(event.target.value as CamCoolantMode); }}
                className={CAM_DIALOG_INPUT}
              >
                <option value="off">Off</option>
                <option value="mist">Mist</option>
                <option value="flood">Flood</option>
              </select>
            </label>
          </div>
        </DialogSection>
      </>
    );
  };

  /** Heights tab: five heights, each a reference plane plus a signed offset.
   *  Feed height stays a placeholder — the planner approaches at retract
   *  height today. The bottom height only exists for kinds that cut to a
   *  depth (facing targets the model top by default). */
  const heightsTab = () => (
    <>
      <DialogSection title="CLEARANCE HEIGHT">
        <HeightField from={clearanceFrom} offset={clearanceOff} onFrom={setClearanceFrom} onOffset={setClearanceOff} unit={lu} />
      </DialogSection>
      <DialogSection title="RETRACT HEIGHT">
        <HeightField from={retractFrom} offset={retractOff} onFrom={setRetractFrom} onOffset={setRetractOff} unit={lu} />
      </DialogSection>
      <DialogSection title="FEED HEIGHT">
        <HeightField from="model_top" offset={displayLength(5, units).toFixed(4)} onFrom={() => {}} onOffset={() => {}} unit={lu} disabled />
      </DialogSection>
      <DialogSection title="TOP HEIGHT">
        <HeightField from={topFrom} offset={topOff} onFrom={setTopFrom} onOffset={setTopOff} unit={lu} />
      </DialogSection>
      {(pages.bottomZ || pages.faceTarget) && (
        <DialogSection title="BOTTOM HEIGHT">
          <HeightField from={bottomFrom} offset={bottomOff} onFrom={setBottomFrom} onOffset={setBottomOff} unit={lu} />
        </DialogSection>
      )}
    </>
  );

  /** MILLING (face / contour / pocket) · Passes tab: stepover, stepdown,
   *  and tool-side compensation go live per kind; the rest of the option set
   *  renders as placeholders so the contract is visible. */
  const millingPassesSection = () => (
    <DialogSection title="PASSES">
      <div className="grid grid-cols-2 gap-2">
        <DraftNumber label="Tolerance" value="0.01" onChange={() => {}} unit={lu} disabled />
        <DraftNumber label="Pass direction" value="0" onChange={() => {}} unit="deg" disabled />
        <div className="col-span-2 flex items-center gap-2">
          <span className="flex-1 text-[10px] text-mute">Pass direction reference</span>
          <DeadButton label="Select" />
        </div>
        <DraftNumber label="Pass extension" value="" onChange={() => {}} unit={lu} disabled placeholder="auto" />
        <DraftNumber label="Stock offset" value="0" onChange={() => {}} unit={lu} disabled />
        {pages.stepOver ? (
          <DraftNumber label="Stepover" value={stepOver} onChange={setStepOver} unit={lu} />
        ) : (
          <DraftNumber label="Stepover" value="" onChange={() => {}} unit={lu} disabled />
        )}
        {pages.compensation ? (
          <label className="block">
            <span className={CAM_DIALOG_LABEL}>Tool side</span>
            <select
              value={compensation}
              onChange={(event) => setCompensation(event.target.value as CamContourCompensation)}
              className={CAM_DIALOG_INPUT}
            >
              <option value="outside">Outside</option>
              <option value="inside">Inside</option>
              <option value="on">On path</option>
            </select>
          </label>
        ) : (
          <DeadSelect label="Direction" value="Both ways" />
        )}
      </div>
      {kind === 'face' && (
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          <DeadCheck label="Order for shorter links" />
          <DeadCheck label="From other side" />
          <DeadCheck label="Use chip thinning" />
        </div>
      )}
      {pages.stepDown && (
        <>
          <label className="flex items-center gap-2 text-[11px] font-semibold text-ink">
            <input
              type="checkbox"
              checked={multipleDepths}
              onChange={(event) => setMultipleDepths(event.target.checked)}
            />
            Multiple depths
          </label>
          {multipleDepths && (
            <div className="grid grid-cols-2 gap-2">
              <DraftNumber label="Maximum stepdown" value={stepDown} onChange={setStepDown} unit={lu} />
            </div>
          )}
        </>
      )}
      {kind === 'face' && (
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          <DeadCheck label="Both sides" />
          <DeadCheck label="Finishing step" />
          <DeadCheck label="Use even stepdowns" />
          <DeadCheck label="Stock to leave" />
        </div>
      )}
    </DialogSection>
  );

  /** DRILL · Passes tab: the cycle drives both the planner and tool
   *  compatibility; cycle-specific fields appear underneath. */
  const drillCycleSection = () => (
    <DialogSection title="CYCLE">
      <label className="block">
        <span className={CAM_DIALOG_LABEL}>Cycle</span>
        <select
          value={drillCycle}
          onChange={(event) => changeCycle(event.target.value as CamDrillCycle)}
          className={CAM_DIALOG_INPUT}
        >
          <option value="drill">Drilling — rapid out</option>
          <option value="chip_breaking">Chip breaking — partial retract</option>
          <option value="deep_hole">Deep drilling — full retract</option>
          <option value="tapping_right">Tapping — right hand</option>
          <option value="tapping_left">Tapping — left hand</option>
          <option value="reaming">Reaming — feed out</option>
          <option value="boring">Boring — dwell and feed out</option>
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        {(drillCycle === 'chip_breaking' || drillCycle === 'deep_hole') && (
          <DraftNumber label="Peck depth" value={peckDepth} onChange={setPeckDepth} unit={lu} />
        )}
        {drillCycle === 'chip_breaking' && (
          <DraftNumber label="Peck retract (empty = auto)" value={peckRetract} onChange={setPeckRetract} unit={lu} />
        )}
        {(drillCycle === 'tapping_right' || drillCycle === 'tapping_left') && (
          <DraftNumber label="Thread pitch" value={threadPitch} onChange={setThreadPitch} unit={`${lu}/rev`} />
        )}
        {(drillCycle === 'reaming' || drillCycle === 'boring') && (
          <DraftNumber label="Feed out (empty = plunge feed)" value={feedOut} onChange={setFeedOut} unit={feedUnit(units)} />
        )}
        {drillCycle !== 'tapping_right' && drillCycle !== 'tapping_left' && (
          <DraftNumber label="Dwell at bottom" value={dwell} onChange={setDwell} unit="sec" />
        )}
      </div>
    </DialogSection>
  );

  /** THREAD · Passes tab: hand, milling direction, and the radial pass
   *  split for multi-pass threading. */
  const threadPassesSection = () => (
    <DialogSection title="PASSES">
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className={CAM_DIALOG_LABEL}>Hand</span>
          <select
            value={threadHand}
            onChange={(event) => setThreadHand(event.target.value as CamThreadHand)}
            className={CAM_DIALOG_INPUT}
          >
            <option value="right">Right hand</option>
            <option value="left">Left hand</option>
          </select>
        </label>
        <label className="block">
          <span className={CAM_DIALOG_LABEL}>Direction</span>
          <select
            value={threadDirection}
            onChange={(event) => setThreadDirection(event.target.value as CamMillingDirection)}
            className={CAM_DIALOG_INPUT}
          >
            <option value="climb">Climb</option>
            <option value="conventional">Conventional</option>
          </select>
        </label>
        <DraftNumber label="Radial passes" value={radialPasses} onChange={setRadialPasses} unit="passes" integer />
        {Number(radialPasses) > 1 && (
          <DraftNumber label="Radial stepover" value={threadStepOver} onChange={setThreadStepOver} unit={lu} />
        )}
      </div>
    </DialogSection>
  );

  /** CHAMFER · Passes tab: chamfer width, tip offset, and which side of the
   *  path the material sits on. */
  const chamferSection = () => (
    <DialogSection title="CHAMFER">
      <div className="grid grid-cols-2 gap-2">
        <DraftNumber label="Chamfer width" value={chamferWidth} onChange={setChamferWidth} unit={lu} />
        <DraftNumber label="Tip offset" value={tipOffset} onChange={setTipOffset} unit={lu} />
        <label className="block">
          <span className={CAM_DIALOG_LABEL}>Material side</span>
          <select
            value={wallSide}
            onChange={(event) => setWallSide(event.target.value as CamContourCompensation)}
            className={CAM_DIALOG_INPUT}
          >
            <option value="inside">Inside path (boss edge)</option>
            <option value="outside">Outside path (hole edge)</option>
          </select>
        </label>
      </div>
    </DialogSection>
  );

  /** Passes tab dispatch: each operation kind gets its live field set. */
  const passesTab = () => {
    if (kind === 'drill') return drillCycleSection();
    if (pages.threadFields) return threadPassesSection();
    if (pages.chamferFields) return chamferSection();
    return millingPassesSection();
  };

  /** Linking tab: the facing safe distance (entry plunge clearance off the
   *  stock boundary) is live for facing; high-feed/keep-down/lead options
   *  stay placeholders for every kind. */
  const linkingTab = () => (
    <>
      <DialogSection title="LINKING">
        <DeadSelect label="High feedrate mode" value="Preserve rapid movements" />
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          <DeadCheck label="Allow rapid retract" checked />
          <DeadCheck label="Keep tool down" checked />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <DraftNumber label="Max stay-down distance" value="100" onChange={() => {}} unit={lu} disabled />
          {pages.safeDistance ? (
            <DraftNumber
              label="Safe distance"
              value={safeDistance}
              onChange={setSafeDistance}
              unit={lu}
            />
          ) : (
            <DraftNumber label="Safe distance" value="" onChange={() => {}} unit={lu} disabled />
          )}
        </div>
        <DeadCheck label="Extend before retract" />
      </DialogSection>
      <DialogSection title="LEADS & TRANSITIONS">
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          <DeadCheck label="Lead-in (entry)" checked />
          <DeadCheck label="Lead-out (exit)" checked />
          <DeadCheck label="Same as lead-in" checked />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <DraftNumber label="Vertical lead-in radius" value="2" onChange={() => {}} unit={lu} disabled />
          <DeadSelect label="Transition type" value="Smooth" />
        </div>
      </DialogSection>
    </>
  );

  return (
    <div data-native-viewport-dim="0.15" className="pointer-events-none fixed inset-0 z-[70] bg-black/15">
      <form
        data-testid="cam-operation-dialog"
        onSubmit={submit}
        className="feature-dialog pointer-events-auto absolute right-5 top-[132px] flex max-h-[calc(100vh-190px)] w-[340px] flex-col overflow-hidden rounded border border-edge bg-panel shadow-2xl"
      >
        <header className="flex h-10 shrink-0 items-center gap-2 border-b border-edge px-3">
          <CircleDot size={15} className="text-accent" />
          <span className="flex-1 text-xs font-semibold text-ink">
            New {camOperationLabel(kind)} operation
          </span>
          <button type="button" onClick={close} className="rounded p-1 text-mute hover:bg-edge hover:text-ink">
            <X size={14} />
          </button>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
          {error && (
            <p className="rounded border border-warn/40 bg-warn/10 p-2 text-[10px] text-warn">{error}</p>
          )}
          <label className="block">
            <span className={CAM_DIALOG_LABEL}>Operation name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} className={CAM_DIALOG_INPUT} />
          </label>

          <nav className="grid grid-cols-5 gap-1 rounded border border-edge bg-header/40 p-1">
            {OP_TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                title={label}
                onClick={() => setOpTab(id)}
                className={`flex h-9 flex-col items-center justify-center gap-0.5 rounded text-[8px] font-semibold ${
                  opTab === id ? 'bg-accent/15 text-accent' : 'text-mute hover:text-ink'
                }`}
              >
                <Icon size={14} />
                {label}
              </button>
            ))}
          </nav>

          {opTab === 'tool' && toolTab()}
          {opTab === 'geometry' && (
            <>
              {geometrySection()}
              {pages.threadFields && threadGeometrySection()}
            </>
          )}
          {opTab === 'heights' && heightsTab()}
          {opTab === 'passes' && passesTab()}
          {opTab === 'linking' && linkingTab()}
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
            Add operation
          </button>
        </footer>
      </form>
    </div>
  );
}
