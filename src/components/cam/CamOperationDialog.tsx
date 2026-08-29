import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowUpDown, Box, CircleDot, Layers, Link2, Wrench, X, type LucideIcon } from 'lucide-react';
import {
  activeCamSetup,
  addCamOperation,
  camOperationLabel,
  camToolCompatible,
  replaceCamOperation,
  type CamOperationInput,
} from '../../cam/document';
import {
  camHoleFromCylinderFace,
  faceVerticesOfRange,
  listModelEdgeCandidates,
  listSketchCurveCandidates,
  listSketchLoops,
  loopToSetupPath,
  modelBottomZInSetup,
  modelPointToSetup,
  modelTopZInSetup,
  resolvePickedChain,
  sketchUvToModel,
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
import type { CamCompensationMode, CamContourCompensation, CamCoolantMode, CamDrillCycle, CamFaceDirection, CamHoleDto, CamMillingDirection, CamOperationDto, CamPoint2Dto, CamThreadHand, CamToolDto } from '../../engine/types';
import { useAppStore, type CamHolePickHole } from '../../store/appStore';
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
/** Geometry input mode. Chain kinds (contour) offer all three — the solid's
 *  own edges are the primary source; loop kinds (pocket/chamfer) pick closed
 *  sketch loops or manual coordinates. */
type GeometrySource = 'model' | 'sketch' | 'manual';

/** Stable loop identity shared by the dialog and the viewport loop-pick
 *  session (`CamLoopPickLoop.key`). */
const loopKeyOf = (loop: SketchLoop): string => `${loop.sketch}:${loop.entityIds.join(',')}`;

/** Reference planes an operation height can hang off; resolved to absolute
 *  setup Z at submit. Chain references hang a height off a LOWER height of
 *  the same operation (fixed resolution order bottom → top → feed → retract
 *  → clearance, so cycles are impossible by construction); 'selection' reads
 *  the picked sketch loop's plane Z. 'hole_top'/'hole_bottom' read the picked
 *  hole faces' own span (highest top / lowest bottom across the pick set;
 *  drill/thread only). The dead entries round out the option set the UI
 *  contract promises; the planner only consumes the resolved absolute
 *  values. */
type HeightFrom =
  | 'model_top'
  | 'model_bottom'
  | 'stock_top'
  | 'stock_bottom'
  | 'origin'
  | 'hole_top'
  | 'hole_bottom'
  | 'bottom'
  | 'top'
  | 'feed'
  | 'retract'
  | 'selection';

const HEIGHT_PLANES: Array<{ value: HeightFrom; label: string }> = [
  { value: 'model_top', label: 'Model top' },
  { value: 'model_bottom', label: 'Model bottom' },
  { value: 'stock_top', label: 'Stock top' },
  { value: 'stock_bottom', label: 'Stock bottom' },
  { value: 'origin', label: 'Origin (absolute)' },
];
/** Chain references a height row may offer, per the fixed resolution order
 *  (a row only lists LOWER heights). */
const HEIGHT_CHAIN_LABELS: Partial<Record<HeightFrom, string>> = {
  bottom: 'Bottom height',
  top: 'Top height',
  feed: 'Feed height',
  retract: 'Retract height',
};
const HEIGHT_FROM_DEAD = [
  'Fixture top',
  'Fixture bottom',
  'Highest of…',
  'Lowest of…',
];

/** Fresh-dialog height defaults per operation kind (offsets in mm, converted
 *  to the display unit at seed time). Established CAM workflows default these
 *  planes differently per kind: facing starts a skin above the stock top and
 *  cuts to the model top; contours run stock-to-stock with a break-through;
 *  hole kinds hang off the model top / stock bottom or the picked holes' own
 *  span. Feed and retract intentionally resolve to the same default height
 *  for face, contour, and drill operations; editing always re-opens the
 *  stored absolute values instead. */
const HEIGHT_DEFAULTS: Record<
  OperationKind,
  {
    clearance: [HeightFrom, number];
    retract: [HeightFrom, number];
    feed: [HeightFrom, number];
    top: [HeightFrom, number];
    bottom: [HeightFrom, number];
  }
> = {
  face: {
    clearance: ['model_top', 10],
    retract: ['model_top', 5],
    feed: ['model_top', 5],
    top: ['stock_top', 0.2],
    bottom: ['model_top', 0],
  },
  contour2d: {
    clearance: ['retract', 10],
    retract: ['stock_top', 5],
    feed: ['stock_top', 5],
    top: ['stock_top', 0],
    bottom: ['stock_bottom', -1],
  },
  pocket2d: {
    clearance: ['stock_top', 10],
    retract: ['stock_top', 5],
    feed: ['model_top', 5],
    top: ['model_top', 0],
    bottom: ['model_bottom', -0.2],
  },
  chamfer2d: {
    clearance: ['model_top', 10],
    retract: ['model_top', 5],
    feed: ['model_top', 5],
    top: ['model_top', 0],
    bottom: ['selection', 0],
  },
  drill: {
    clearance: ['model_top', 10],
    retract: ['model_top', 5],
    feed: ['model_top', 5],
    top: ['model_top', 0],
    bottom: ['stock_bottom', 0],
  },
  thread: {
    clearance: ['stock_top', 10],
    retract: ['stock_top', 5],
    feed: ['model_top', 5],
    top: ['hole_top', 0],
    bottom: ['hole_bottom', 0],
  },
};

/** One height row: reference plane + signed offset. `chainBelow` lists the
 *  lower operation heights this row may reference; the Selection option
 *  (picked sketch loop's plane Z) is enabled where geometry plumbing gives
 *  it a value; `holeRefsAvailable` (drill/thread) unlocks the picked hole
 *  faces' own top/bottom references. */
function HeightField({
  from,
  offset,
  onFrom,
  onOffset,
  unit,
  chainBelow = [],
  selectionAvailable = false,
  holeRefsAvailable = false,
  disabled = false,
}: {
  from: HeightFrom;
  offset: string;
  onFrom: (value: HeightFrom) => void;
  onOffset: (value: string) => void;
  unit: string;
  chainBelow?: HeightFrom[];
  selectionAvailable?: boolean;
  holeRefsAvailable?: boolean;
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
          {HEIGHT_PLANES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
          {holeRefsAvailable && (
            <optgroup label="Picked holes">
              <option value="hole_top">Hole top</option>
              <option value="hole_bottom">Hole bottom</option>
            </optgroup>
          )}
          {chainBelow.length > 0 && (
            <optgroup label="Operation heights">
              {chainBelow.map((value) => (
                <option key={value} value={value}>
                  {HEIGHT_CHAIN_LABELS[value]}
                </option>
              ))}
            </optgroup>
          )}
          <option
            value="selection"
            disabled={!selectionAvailable}
            title={
              selectionAvailable
                ? 'The picked sketch loop’s plane Z'
                : 'Pick a sketch loop on the Geometry tab first'
            }
          >
            Selection (sketch plane)
          </option>
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
    <label className="block cursor-not-allowed opacity-45" title={NOT_APPLIED_YET}>
      <span className={CAM_DIALOG_LABEL}>{label}</span>
      <select disabled className={`${CAM_DIALOG_INPUT} cursor-not-allowed`}>
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
export function CamOperationDialog({ kind, editing }: { kind: OperationKind; editing?: CamOperationDto }) {
  // Editing reuses this exact dialog: every draft below seeds from the stored
  // operation and Save writes back through the same submit path as Add, so
  // create and edit can never drift apart.
  const faceOp = editing?.kind === 'face' ? editing : null;
  const contourOp = editing?.kind === 'contour2d' ? editing : null;
  const pocketOp = editing?.kind === 'pocket2d' ? editing : null;
  const chamferOp = editing?.kind === 'chamfer2d' ? editing : null;
  const drillOp = editing?.kind === 'drill' ? editing : null;
  const threadOp = editing?.kind === 'thread' ? editing : null;
  const pointsOp = drillOp ?? threadOp;
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
  const [drillCycle, setDrillCycle] = useState<CamDrillCycle>(drillOp?.cycle ?? 'drill');
  const projectTools = useMemo(
    () =>
      cam.tools.filter((tool) =>
        camToolCompatible(kind, tool, kind === 'drill' ? drillCycle : undefined),
      ),
    [cam.tools, kind, drillCycle],
  );

  const loops = useMemo(() => listSketchLoops(sketches), [sketches]);
  // Contour chain-picking candidates: the setup bodies' solid edges (primary
  // source — no sketch required) and the finished sketches' curve entities.
  const modelEdges = useMemo(
    () => (pages.pathChain && setup ? listModelEdgeCandidates(scene, setup) : []),
    [pages.pathChain, setup, scene],
  );
  const sketchCurves = useMemo(
    () => (pages.pathChain ? listSketchCurveCandidates(sketches) : []),
    [pages.pathChain, sketches],
  );
  const existingCount = setup?.operations.filter((operation) => operation.kind === kind).length ?? 0;

  // Setup-space model Z extremes seed the height drafts when editing; null
  // when the setup references no bodies (heights then hang off stock/origin).
  const modelTop = setup ? modelTopZInSetup(scene, setup) : null;
  const modelBottom = setup ? modelBottomZInSetup(scene, setup) : null;

  /** Re-express a stored absolute setup Z as reference plane + signed offset,
   *  picking the plane the value sits closest to so the heights tab re-opens
   *  with sensible drafts. `extra` offers the operation's lower heights as
   *  chain references (their stored absolute values); planes listed first
   *  win ties. */
  const heightDraftFrom = (
    absZ: number,
    extra: Array<{ from: HeightFrom; z: number | null }> = [],
  ): { from: HeightFrom; off: string } => {
    const candidates: Array<{ from: HeightFrom; z: number | null }> = [
      { from: 'model_top', z: modelTop },
      { from: 'model_bottom', z: modelBottom },
      { from: 'stock_top', z: setup?.stock.max.z ?? null },
      { from: 'stock_bottom', z: setup?.stock.min.z ?? null },
      { from: 'origin', z: 0 },
      ...extra,
    ];
    let best: { from: HeightFrom; z: number } = { from: 'origin', z: 0 };
    for (const candidate of candidates) {
      if (candidate.z === null) continue;
      if (Math.abs(candidate.z - absZ) < Math.abs(best.z - absZ)) {
        best = { from: candidate.from, z: candidate.z };
      }
    }
    return { from: best.from, off: String(Number(displayLength(absZ - best.z, units).toFixed(4)) + 0) };
  };

  const bottomStored =
    faceOp?.target_z ?? contourOp?.bottom_z ?? pocketOp?.bottom_z ?? pointsOp?.bottom_z ?? null;
  const bottomDraft = bottomStored !== null ? heightDraftFrom(bottomStored) : null;
  const topDraft = editing
    ? heightDraftFrom(editing.top_z, [{ from: 'bottom', z: bottomStored }])
    : null;
  const feedStored = editing?.feed_height_z ?? null;
  const feedDraft =
    feedStored !== null
      ? heightDraftFrom(feedStored, [
          { from: 'top', z: editing?.top_z ?? null },
          { from: 'bottom', z: bottomStored },
        ])
      : null;
  const retractDraft = editing
    ? heightDraftFrom(editing.retract_z, [
        { from: 'feed', z: feedStored },
        { from: 'top', z: editing.top_z },
        { from: 'bottom', z: bottomStored },
      ])
    : null;
  const clearanceDraft = editing
    ? heightDraftFrom(editing.clearance_z, [
        { from: 'retract', z: editing.retract_z },
        { from: 'feed', z: feedStored },
        { from: 'top', z: editing.top_z },
        { from: 'bottom', z: bottomStored },
      ])
    : null;
  const storedStepDown = faceOp?.step_down ?? contourOp?.step_down ?? pocketOp?.step_down ?? null;
  const depthFull =
    editing && bottomStored !== null ? Math.abs(editing.top_z - bottomStored) : null;
  const multipleDepthsInit =
    storedStepDown !== null && depthFull !== null
      ? storedStepDown < depthFull - 1e-9
      : true;

  /** Stored paths/hole centers re-open as manual coordinates (display units),
   *  one X,Y per line — the same text the create flow would parse. */
  const initManualPoints = (): string => {
    const pts = contourOp?.path ?? pocketOp?.outline ?? chamferOp?.path ?? pointsOp?.points;
    if (!pts) return '';
    return pts
      .map(
        (p) =>
          `${Number(displayLength(p.x, units).toFixed(4)) + 0}, ${Number(displayLength(p.y, units).toFixed(4)) + 0}`,
      )
      .join('\n');
  };
  const facePointDraft = (p: CamPoint2Dto) => ({
    x: String(Number(displayLength(p.x, units).toFixed(4)) + 0),
    y: String(Number(displayLength(p.y, units).toFixed(4)) + 0),
  });
  /** A face bounds that still matches the stock box re-opens with the
   *  "whole stock top" toggle on; anything else is treated as custom. */
  const faceBoundsFromStock = (() => {
    if (!faceOp || !setup) return true;
    const b = faceOp.bounds;
    const s = setup.stock;
    return (
      Math.abs(b.min.x - s.min.x) < 1e-6 &&
      Math.abs(b.min.y - s.min.y) < 1e-6 &&
      Math.abs(b.max.x - s.max.x) < 1e-6 &&
      Math.abs(b.max.y - s.max.y) < 1e-6
    );
  })();
  const threadPresetInit = threadOp
    ? (THREAD_PRESETS.find((p) => Math.abs(p.pitchMm - threadOp.pitch) < 1e-9) ?? defaultThreadPreset()).id
    : defaultThreadPreset().id;

  const [name, setName] = useState(editing?.name ?? `${camOperationLabel(kind)} ${existingCount + 1}`);
  const [toolId, setToolId] = useState<number | null>(editing?.tool_id ?? projectTools[0]?.id ?? null);
  const [presetIndex, setPresetIndex] = useState(0);
  const [rpm, setRpm] = useState(editing ? String(editing.cutting.spindle_rpm) : '');
  const [feedXy, setFeedXy] = useState(editing ? displayFeed(editing.cutting.feed_xy, units).toFixed(4) : '');
  const [feedZ, setFeedZ] = useState(editing ? displayFeed(editing.cutting.feed_z, units).toFixed(4) : '');
  const [coolant, setCoolant] = useState<CamCoolantMode>(editing?.cutting.coolant ?? 'flood');
  // Editing keeps the operation's own cutting data; picking another tool must
  // not silently overwrite it.
  const [feedsTouched, setFeedsTouched] = useState(editing != null);

  const [source, setSource] = useState<GeometrySource>(() => {
    if (editing) {
      // A viewport-picked chain re-opens on its own source so the edit
      // session re-selects the same entities instead of dropping to raw
      // coordinates (the keys are seeded into the pick session below).
      if (contourOp?.chain_ref) return contourOp.chain_ref.source;
      return 'manual';
    }
    // Contour: the part's own edges are the primary geometry source — the
    // operator picks the silhouette to machine, no sketch required.
    if (pages.pathChain) {
      if (modelEdges.length > 0) return 'model';
      if (sketchCurves.length > 0) return 'sketch';
      return 'manual';
    }
    return loops.length > 0 ? 'sketch' : 'manual';
  });
  const [manualPoints, setManualPoints] = useState(initManualPoints);
  // Drilling/thread: holes are picked as cylindrical faces in the viewport;
  // the session lives in the store so the shared viewport can drive it.
  const holePick = useAppStore((state) => state.camHolePick);
  // Path kinds: the sketch loop is clicked in the viewport, never chosen
  // from a list of labels; the session lives in the store for the viewport.
  const loopPick = useAppStore((state) => state.camLoopPick);
  // Contour: edges are toggled one by one into a chain (open allowed).
  const chainPick = useAppStore((state) => state.camChainPick);
  const [chainReversed, setChainReversed] = useState(contourOp?.chain_ref?.reversed ?? false);
  // Editing a picked chain: the first pick session seeds from the stored
  // entity keys (consumed once — afterwards the live session owns the
  // selection, so switching sources and back keeps the operator's picks).
  const chainSeedRef = useRef(contourOp?.chain_ref ?? null);
  // Editing drill/thread: the first hole-pick session re-seeds from the
  // stored holes, rebuilt from the CURRENT model faces so edited geometry
  // refreshes each hole's span; holes whose face vanished degrade to manual
  // center lines below instead of silently dropping out of the operation.
  const holeSeedRef = useRef<CamHoleDto[] | null>(drillOp?.holes ?? threadOp?.holes ?? null);

  const [stepDown, setStepDown] = useState(
    storedStepDown !== null ? displayLength(storedStepDown, units).toFixed(4) : '',
  );
  const [stepOver, setStepOver] = useState(() => {
    const stored = faceOp?.step_over ?? pocketOp?.step_over ?? null;
    return stored !== null ? displayLength(stored, units).toFixed(4) : '';
  });
  // Facing plunge clearance from the stock boundary (see the planner).
  const [safeDistance, setSafeDistance] = useState(
    faceOp ? displayLength(faceOp.safe_distance, units).toFixed(4) : displayLength(5, units).toFixed(4),
  );
  // Active tab, structured heights (reference plane + signed offset), and the
  // multiple-depths toggle. Fresh dialogs seed from the per-kind default
  // table; editing re-opens the stored absolute Z as the nearest plane.
  const heightDefaults = HEIGHT_DEFAULTS[kind];
  const heightOffsetSeed = (mm: number): string =>
    mm === 0 ? '0' : displayLength(mm, units).toFixed(4);
  const [opTab, setOpTab] = useState<OpTab>('tool');
  const [clearanceFrom, setClearanceFrom] = useState<HeightFrom>(
    clearanceDraft?.from ?? heightDefaults.clearance[0],
  );
  const [clearanceOff, setClearanceOff] = useState(
    clearanceDraft?.off ?? heightOffsetSeed(heightDefaults.clearance[1]),
  );
  const [retractFrom, setRetractFrom] = useState<HeightFrom>(
    retractDraft?.from ?? heightDefaults.retract[0],
  );
  const [retractOff, setRetractOff] = useState(
    retractDraft?.off ?? heightOffsetSeed(heightDefaults.retract[1]),
  );
  // Feed height: rapids stop here, everything below runs at feed rate.
  const [feedFrom, setFeedFrom] = useState<HeightFrom>(feedDraft?.from ?? heightDefaults.feed[0]);
  const [feedOff, setFeedOff] = useState(feedDraft?.off ?? heightOffsetSeed(heightDefaults.feed[1]));
  const [topFrom, setTopFrom] = useState<HeightFrom>(topDraft?.from ?? heightDefaults.top[0]);
  const [topOff, setTopOff] = useState(topDraft?.off ?? heightOffsetSeed(heightDefaults.top[1]));
  const [bottomFrom, setBottomFrom] = useState<HeightFrom>(
    bottomDraft?.from ?? heightDefaults.bottom[0],
  );
  const [bottomOff, setBottomOff] = useState(
    bottomDraft?.off ?? heightOffsetSeed(heightDefaults.bottom[1]),
  );
  const [multipleDepths, setMultipleDepths] = useState(multipleDepthsInit);
  // Cutting direction: facing rows zigzag by default or run one way
  // (climb/conventional); contour/pocket/chamfer travel climb or
  // conventional along the profile.
  const [faceDirection, setFaceDirection] = useState<CamFaceDirection>(faceOp?.direction ?? 'both_ways');
  const [millingDirection, setMillingDirection] = useState<CamMillingDirection>(
    contourOp?.direction ?? pocketOp?.direction ?? chamferOp?.direction ?? 'climb',
  );
  // Contour radial multi-pass: roughing passes step toward the wall leaving
  // the finish allowance; the finishing pass takes the wall to size,
  // optionally at a reduced feed; a spring pass repeats the final lap so
  // tool deflection relaxes (closed loops only).
  const [roughingPasses, setRoughingPasses] = useState(String(contourOp?.roughing_passes ?? 1));
  const [roughingStepOver, setRoughingStepOver] = useState(
    contourOp?.roughing_step_over != null
      ? displayLength(contourOp.roughing_step_over, units).toFixed(4)
      : '',
  );
  const [finishingPass, setFinishingPass] = useState(contourOp?.finishing_pass ?? false);
  const [finishAllowance, setFinishAllowance] = useState(
    contourOp?.finish_allowance != null
      ? displayLength(contourOp.finish_allowance, units).toFixed(4)
      : '',
  );
  const [finishFeed, setFinishFeed] = useState(
    contourOp?.finish_feed != null ? displayFeed(contourOp.finish_feed, units).toFixed(4) : '',
  );
  const [springPass, setSpringPass] = useState(contourOp?.spring_pass ?? false);
  const [compensation, setCompensation] = useState<CamContourCompensation>(contourOp?.compensation ?? 'outside');
  // Who applies the radius offset: the control (G41/G42 on the lead-in,
  // default) or pre-offset coordinates planned here. On-path compensation
  // has no offset to apply, so the mode is irrelevant there.
  const [compensationMode, setCompensationMode] = useState<CamCompensationMode>(
    contourOp?.compensation_mode ?? 'in_control',
  );
  // Straight tangent lead lengths. Fresh dialogs seed at 1.5x the radius of
  // the initially selected tool (5 mm fallback) and re-seed on tool picks
  // until the operator touches them; editing keeps the stored values.
  const [leadsTouched, setLeadsTouched] = useState(editing != null);
  const seedLead = (stored: number | undefined): string => {
    if (stored != null) return displayLength(stored, units).toFixed(4);
    const tool =
      cam.tools.find((candidate) => candidate.id === editing?.tool_id) ?? projectTools[0] ?? null;
    return displayLength(tool ? tool.diameter * 0.75 : 5, units).toFixed(4);
  };
  const [leadIn, setLeadIn] = useState(() => seedLead(contourOp?.lead_in));
  const [leadOut, setLeadOut] = useState(() => seedLead(contourOp?.lead_out));
  // Optional physical cutter-center arc radius rounding each straight lead
  // into a tangential meet with the profile (empty = straight leads).
  const [leadArcRadius, setLeadArcRadius] = useState(
    contourOp?.lead_arc_radius != null
      ? displayLength(contourOp.lead_arc_radius, units).toFixed(4)
      : '',
  );
  const [wallSide, setWallSide] = useState<CamContourCompensation>(chamferOp?.wall_side ?? 'inside');
  const [chamferWidth, setChamferWidth] = useState(chamferOp ? displayLength(chamferOp.chamfer_width, units).toFixed(4) : '');
  const [tipOffset, setTipOffset] = useState(chamferOp ? displayLength(chamferOp.tip_offset, units).toFixed(4) : '');
  const [peckDepth, setPeckDepth] = useState(drillOp?.peck_depth != null ? displayLength(drillOp.peck_depth, units).toFixed(4) : '');
  const [peckRetract, setPeckRetract] = useState(drillOp?.peck_retract != null ? displayLength(drillOp.peck_retract, units).toFixed(4) : '');
  const [threadPitch, setThreadPitch] = useState(drillOp?.thread_pitch != null ? displayLength(drillOp.thread_pitch, units).toFixed(4) : '');
  const [feedOut, setFeedOut] = useState(drillOp?.feed_out != null ? displayFeed(drillOp.feed_out, units).toFixed(4) : '');
  const [dwell, setDwell] = useState(drillOp ? String(drillOp.dwell_seconds) : '0');
  // Drilling-family cycles: drive the point past the bottom plane so the
  // full diameter clears the hole bottom (point length + break-through).
  const [tipThrough, setTipThrough] = useState(drillOp?.drill_tip_through ?? true);
  const [breakthrough, setBreakthrough] = useState(
    drillOp?.breakthrough_depth != null && drillOp.breakthrough_depth > 0
      ? displayLength(drillOp.breakthrough_depth, units).toFixed(4)
      : displayLength(1, units).toFixed(4),
  );
  // Thread milling: the designation resolves pitch/major/minor through the
  // standards table; the resolved values are stored on the operation.
  const [threadPresetId, setThreadPresetId] = useState(threadPresetInit);
  // Editing keeps the stored pitch/diameters until the operator deliberately
  // picks another designation.
  const [threadPresetTouched, setThreadPresetTouched] = useState(false);
  const [threadHand, setThreadHand] = useState<CamThreadHand>(threadOp?.hand ?? 'right');
  const [threadDirection, setThreadDirection] = useState<CamMillingDirection>(threadOp?.direction ?? 'climb');
  const [radialPasses, setRadialPasses] = useState(String(threadOp?.radial_passes ?? 1));
  const [threadStepOver, setThreadStepOver] = useState(threadOp?.step_over != null ? displayLength(threadOp.step_over, units).toFixed(4) : '');
  const [faceMin, setFaceMin] = useState(faceOp ? facePointDraft(faceOp.bounds.min) : { x: '', y: '' });
  const [faceMax, setFaceMax] = useState(faceOp ? facePointDraft(faceOp.bounds.max) : { x: '', y: '' });
  const [faceFromStock, setFaceFromStock] = useState(faceBoundsFromStock);
  const [error, setError] = useState<string | null>(null);

  const selectedTool = cam.tools.find((candidate) => candidate.id === toolId) ?? null;

  /** Reference plane of a structured height, as absolute setup Z. Planes fall
   *  back to the stock plane when the setup references no bodies; chain
   *  references read already-resolved lower heights (resolution order bottom
   *  → top → feed → retract → clearance); 'selection' reads the picked
   *  sketch loop's plane Z. */
  const heightRefZ = (
    from: HeightFrom,
    resolved: { bottom?: number; top?: number; feed?: number; retract?: number },
    label: string,
  ): number => {
    const stockMaxZ = setup?.stock.max.z ?? 0;
    const stockMinZ = setup?.stock.min.z ?? 0;
    switch (from) {
      case 'model_top':
        return modelTop ?? stockMaxZ;
      case 'model_bottom':
        return modelBottom ?? stockMinZ;
      case 'stock_top':
        return stockMaxZ;
      case 'stock_bottom':
        return stockMinZ;
      case 'origin':
        return 0;
      case 'hole_top':
      case 'hole_bottom': {
        // Highest picked hole top / lowest picked hole bottom: the heights
        // bracket every picked hole so rapids and feeds never start inside
        // a deeper face's span.
        const holes = holePick?.holes ?? [];
        if (holes.length === 0) {
          throw new Error(
            `${label}: pick hole faces in the viewport to use the hole top/bottom reference.`,
          );
        }
        return from === 'hole_top'
          ? Math.max(...holes.map((hole) => hole.topZ))
          : Math.min(...holes.map((hole) => hole.bottomZ));
      }
      case 'selection': {
        const z = selectionZ();
        if (z === null) {
          throw new Error(`${label}: pick a sketch loop on the Geometry tab to use as the selection reference.`);
        }
        return z;
      }
      case 'bottom':
      case 'top':
      case 'feed':
      case 'retract': {
        const z = resolved[from];
        if (z === undefined) {
          throw new Error(`${label} references the ${HEIGHT_CHAIN_LABELS[from]}, which this operation does not resolve.`);
        }
        return z;
      }
    }
  };

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
        // Library step defaults win; half the diameter is the fallback.
        const seed = tool.default_step_over ?? tool.diameter * 0.5;
        setStepOver(displayLength(seed, units).toFixed(4));
      }
    }
    // Library step defaults seed the passes tab until the operator types one.
    if (!stepDown && tool.default_step_down != null) {
      setStepDown(displayLength(tool.default_step_down, units).toFixed(4));
    }
    if (kind === 'contour2d' && !roughingStepOver && tool.default_step_over != null) {
      setRoughingStepOver(displayLength(tool.default_step_over, units).toFixed(4));
    }
    // Leads seed at 1.5x the tool radius until the operator edits them — a
    // comfortable entry move, not a requirement: lead lengths carry no
    // tool-diameter floor (the control owns its compensation activation).
    if (kind === 'contour2d' && !leadsTouched) {
      const lead = displayLength(tool.diameter * 0.75, units).toFixed(4);
      setLeadIn(lead);
      setLeadOut(lead);
      // The arc radius seeds the same way; a tangential arc meet is the
      // comfortable default, never a hard floor.
      if (!leadArcRadius) {
        setLeadArcRadius(displayLength(tool.diameter * 0.75, units).toFixed(4));
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
  // An edit session re-seeds from the stored holes (rebuilt against the
  // current model so a changed face refreshes the span); holes whose face
  // vanished degrade to manual center lines so they are never silently lost.
  useEffect(() => {
    if (pages.geometry !== 'holes') return;
    const seed = holeSeedRef.current;
    holeSeedRef.current = null;
    const seeded: CamHolePickHole[] = [];
    const leftover: CamHoleDto[] = [];
    if (seed && setup) {
      for (const stored of seed) {
        const [bodyText, faceText] = (stored.face_key ?? '').split(':');
        const body = scene.bodies.find((candidate) => candidate.id === Number(bodyText));
        const face = body?.faces.find((candidate) => candidate.id === Number(faceText));
        const rebuilt =
          body && face?.cylinder
            ? camHoleFromCylinderFace(
                body.id,
                face.id,
                face.cylinder,
                setup,
                faceVerticesOfRange(
                  body.mesh.positions,
                  body.mesh.indices,
                  face.first_index,
                  face.index_count,
                ),
              )
            : null;
        if (rebuilt) seeded.push(rebuilt);
        else leftover.push(stored);
      }
    }
    if (leftover.length > 0) {
      const lines = leftover
        .map(
          (hole) =>
            `${Number(displayLength(hole.point.x, units).toFixed(4)) + 0}, ${Number(displayLength(hole.point.y, units).toFixed(4)) + 0}`,
        )
        .join('\n');
      setManualPoints((text) => (text.trim() ? `${text.trimEnd()}\n${lines}` : lines));
    }
    useAppStore.getState().setCamHolePick({ holes: seeded, hoverKey: null });
    return () => {
      const state = useAppStore.getState();
      state.setCamHolePick(null);
      state.setHoveredFace(null);
    };
    // Seeding consumes mount-time scene/setup; the session then owns itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages.geometry]);

  // Path kinds with sketch geometry open a viewport loop-pick session: every
  // closed sketch loop becomes clickable in the viewport. The selection
  // survives candidate rebuilds (sketch edits) while its key still exists.
  // Contour kinds use edge-chain picking instead (see the effect below).
  useEffect(() => {
    if (pages.geometry !== 'path' || source !== 'sketch' || pages.pathChain) return;
    const previous = useAppStore.getState().camLoopPick?.selectedKey ?? null;
    const candidates = loops.flatMap((loop) => {
      const sketch = sketches.find((candidate) => candidate.name === loop.sketch);
      if (!sketch) return [];
      return [{
        key: loopKeyOf(loop),
        label: loop.label,
        modelPoints: loop.points.map((uv) => sketchUvToModel(sketch.basis, uv)),
      }];
    });
    useAppStore.getState().setCamLoopPick({
      loops: candidates,
      selectedKey: candidates.some((loop) => loop.key === previous) ? previous : null,
      hoverKey: null,
    });
    return () => {
      useAppStore.getState().setCamLoopPick(null);
    };
  }, [pages.geometry, pages.pathChain, source, loops, sketches]);

  // Contour chain picking: the candidate edges (solid edges or sketch
  // curves, per the geometry source) are clickable in the viewport; the
  // dialog resolves the picks into one connected chain (open or closed) at
  // submit. The selection survives candidate rebuilds (model edits) while
  // its keys still exist. An edit session seeds the first session from the
  // operation's stored chain reference.
  useEffect(() => {
    if (!pages.pathChain || (source !== 'model' && source !== 'sketch')) return;
    const entities = source === 'model' ? modelEdges : sketchCurves;
    let previous = useAppStore.getState().camChainPick?.selectedKeys;
    if (previous === undefined) {
      const seed = chainSeedRef.current;
      previous = seed && seed.source === source ? seed.keys : [];
      chainSeedRef.current = null;
    }
    useAppStore.getState().setCamChainPick({
      entities,
      selectedKeys: previous.filter((key) => entities.some((entity) => entity.key === key)),
      hoverKey: null,
    });
    return () => {
      useAppStore.getState().setCamChainPick(null);
    };
  }, [pages.pathChain, source, modelEdges, sketchCurves]);

  /** The picked chain resolved in click order, or the resolution error —
   *  kept out of exceptions during render so typing never crashes. */
  const chainResolution = useMemo(() => {
    if (!pages.pathChain || (source !== 'model' && source !== 'sketch') || !chainPick) return null;
    try {
      return { chain: resolvePickedChain(chainPick.entities, chainPick.selectedKeys), error: null };
    } catch (cause) {
      return { chain: null, error: cause instanceof Error ? cause.message : String(cause) };
    }
  }, [pages.pathChain, source, chainPick]);
  const chainClosed = chainResolution?.chain?.closed ?? null;

  // Compensation follows the resolved chain: open chains read left/right of
  // travel, closed loops inside/outside. An incompatible draft snaps to the
  // nearest edge-hugging side — never to 'on': on-path rides the tool center
  // on the contour and cuts a radius into both sides, which destroys the
  // part wall when the operator expected the tool to hug the edge. The
  // passes tab shows a loud hint for open chains so the snap is seen.
  useEffect(() => {
    if (chainClosed === false && (compensation === 'inside' || compensation === 'outside')) {
      setCompensation('left');
    }
    if (chainClosed === true && (compensation === 'left' || compensation === 'right')) {
      setCompensation('outside');
    }
  }, [chainClosed, compensation]);

  // Arc leads need swing room an inside closed profile does not have; drop
  // the radius while that combination holds so submit plans straight leads.
  useEffect(() => {
    if (chainClosed === true && compensation === 'inside' && leadArcRadius) {
      setLeadArcRadius('');
    }
  }, [chainClosed, compensation, leadArcRadius]);

  const selectedLoop = (): SketchLoop | null =>
    loops.find((candidate) => loopKeyOf(candidate) === loopPick?.selectedKey) ?? null;

  /** Setup Z of the picked sketch loop's plane — the live 'Selection' height
   *  reference (path kinds only; hole picks carry no usable surface Z). */
  const selectionZ = (): number | null => {
    if (pages.geometry !== 'path' || source !== 'sketch' || !setup) return null;
    const loop = selectedLoop();
    if (!loop) return null;
    const sketch = sketches.find((candidate) => candidate.name === loop.sketch);
    if (!sketch) return null;
    const origin = sketch.basis.origin;
    return modelPointToSetup({ x: origin[0], y: origin[1], z: origin[2] }, setup.wcs).z;
  };
  const selectionAvailable =
    pages.geometry === 'path' && source === 'sketch' && selectedLoop() !== null;

  // The 'Selection' height reference only exists while a sketch loop is the
  // geometry source; fall back to the model top when that goes away so the
  // drafts stay valid instead of erroring at submit.
  useEffect(() => {
    if (selectionAvailable) return;
    setClearanceFrom((from) => (from === 'selection' ? 'model_top' : from));
    setRetractFrom((from) => (from === 'selection' ? 'model_top' : from));
    setFeedFrom((from) => (from === 'selection' ? 'model_top' : from));
    setTopFrom((from) => (from === 'selection' ? 'model_top' : from));
    setBottomFrom((from) => (from === 'selection' ? 'model_top' : from));
  }, [selectionAvailable]);

  const pathFromLoop = (): CamPoint2Dto[] => {
    if (!setup) throw new Error('No active CAM setup.');
    const loop = selectedLoop();
    if (!loop) {
      throw new Error('Click a closed sketch loop in the viewport, or switch to manual coordinates.');
    }
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

  /** Contour geometry: the picked chain (open allowed) or manual points,
   *  with the closed flag the planner needs to decide whether the path may
   *  close itself. Compensation is validated against openness here so a
   *  mismatch fails with an actionable message, not a planner rejection. */
  const resolveContourGeometry = (): { path: CamPoint2Dto[]; closed: boolean } => {
    const checkCompensation = (closed: boolean) => {
      if (!closed && (compensation === 'inside' || compensation === 'outside')) {
        throw new Error(
          'An open chain has no interior — choose On path, Left, or Right compensation.',
        );
      }
      if (closed && (compensation === 'left' || compensation === 'right')) {
        throw new Error(
          'A closed path compensates Inside/Outside; left/right is for open chains.',
        );
      }
    };
    if (source === 'model' || source === 'sketch') {
      if (!setup) throw new Error('No active CAM setup.');
      if (!chainResolution?.chain) {
        throw new Error(chainResolution?.error ?? 'Click edges in the viewport to build the contour path.');
      }
      const points = chainResolution.chain.modelPoints.map((point) => {
        const projected = modelPointToSetup(point, setup.wcs);
        return { x: projected.x, y: projected.y };
      });
      checkCompensation(chainResolution.chain.closed);
      return {
        path: chainReversed ? [...points].reverse() : points,
        closed: chainResolution.chain.closed,
      };
    }
    const manual = parseManualPoints('Contour path');
    // A manual path whose last point repeats its first is closed; store it
    // without the duplicate, like every other closed outline.
    let closed = false;
    let path = manual;
    if (manual.length >= 3) {
      const first = manual[0];
      const last = manual[manual.length - 1];
      if (Math.hypot(first.x - last.x, first.y - last.y) <= 1e-6) {
        closed = true;
        path = manual.slice(0, -1);
      }
    }
    checkCompensation(closed);
    return { path, closed };
  };

  /** Hole targets: viewport-picked holes carry their own top/bottom span and
   *  axis (each machines across exactly its face's height); manual centers
   *  use the operation's top/bottom planes. */
  const resolveDrillTargets = (): { points: CamPoint2Dto[]; holes: CamHoleDto[] } => {
    // Fixed-axis planning drills along setup Z only; a picked hole whose axis
    // tilts away from setup Z needs indexed/5-axis tool orientation, which is
    // not supported yet — fail closed instead of drilling a wrong hole.
    const tilted = (holePick?.holes ?? []).filter((hole) => Math.abs(hole.axis[2]) < 1 - 1e-6);
    if (tilted.length > 0) {
      throw new Error(
        `${tilted.length} picked hole${tilted.length > 1 ? 's are' : ' is'} not aligned with setup Z — fixed-axis planning drills along setup Z only; indexed/5-axis tool orientation is not supported yet.`,
      );
    }
    const holes: CamHoleDto[] = (holePick?.holes ?? []).map((hole) => ({
      point: { x: hole.point.x, y: hole.point.y },
      top_z: hole.topZ,
      bottom_z: hole.bottomZ,
      axis: hole.axis,
      face_key: hole.key,
    }));
    const points = manualPoints.trim() ? parseManualPoints('Hole centers') : [];
    if (holes.length === 0 && points.length === 0) {
      throw new Error('Click hole faces in the viewport, or enter hole centers manually.');
    }
    return { points, holes };
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
      if (!setup) throw new Error('No active CAM setup.');
      if (toolId === null) throw new Error('Pick a tool from the library first.');
      // Heights resolve low to high so chain references (bottom → top →
      // feed → retract → clearance) read already-resolved values; the
      // stored result stays absolute setup Z either way.
      const hasBottomRow = pages.bottomZ === true || pages.faceTarget === true;
      const resolveOne = (
        from: HeightFrom,
        offset: string,
        label: string,
        resolved: { bottom?: number; top?: number; feed?: number; retract?: number },
      ): number =>
        heightRefZ(from, resolved, label) + commitLength(parseDraft(offset, `${label} offset`), units);
      const bottomValue = hasBottomRow
        ? resolveOne(bottomFrom, bottomOff, 'Bottom height', {})
        : undefined;
      const topValue = resolveOne(topFrom, topOff, 'Top height', { bottom: bottomValue });
      const feedValue = resolveOne(feedFrom, feedOff, 'Feed height', {
        bottom: bottomValue,
        top: topValue,
      });
      const retractValue = resolveOne(retractFrom, retractOff, 'Retract height', {
        bottom: bottomValue,
        top: topValue,
        feed: feedValue,
      });
      // Rapids stop at the feed plane: below it everything runs at feed
      // rate, so it must sit between the cut top and the retract plane.
      if (feedValue < topValue - 1e-9 || feedValue > retractValue + 1e-9) {
        throw new Error('Feed height must sit between the top and retract heights.');
      }
      const clearanceValue = resolveOne(clearanceFrom, clearanceOff, 'Clearance height', {
        bottom: bottomValue,
        top: topValue,
        feed: feedValue,
        retract: retractValue,
      });
      const base = {
        name: name.trim() || camOperationLabel(kind),
        enabled: editing?.enabled ?? true,
        tool_id: toolId,
        clearance_z: clearanceValue,
        retract_z: retractValue,
        feed_height_z: feedValue,
      };
      const top = topValue;
      // Bottom height is a reference plane plus a signed offset, resolved to
      // absolute setup Z for the kinds that cut to a depth.
      const bottomAbs = () => {
        if (bottomValue === undefined) throw new Error('This operation has no bottom height.');
        return bottomValue;
      };
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
            direction: faceDirection,
            cutting: cutting(),
          };
          break;
        }
        case 'contour2d': {
          const bottom = bottomAbs();
          const geometry = resolveContourGeometry();
          const leadInMm = commitLength(parseDraft(leadIn, 'Lead-in length'), units);
          const leadOutMm = commitLength(parseDraft(leadOut, 'Lead-out length'), units);
          if (leadInMm <= 0 || leadOutMm <= 0) {
            throw new Error('Lead lengths must be positive.');
          }
          const arcMm = leadArcRadius.trim()
            ? commitLength(parseDraft(leadArcRadius, 'Lead arc radius'), units)
            : null;
          if (arcMm !== null && arcMm <= 0) {
            throw new Error('Lead arc radius must be positive.');
          }
          // Lead lengths and arc radius describe physical cutter-center
          // motion and carry no tool-diameter floor. In-control planning
          // expands the programmed lead arc by the selected tool radius so
          // the controller's compensated result still matches this value.
          const passes = Math.max(1, Math.round(parseDraft(roughingPasses, 'Roughing passes')));
          let roughStepMm: number | null = null;
          if (passes > 1) {
            roughStepMm = commitLength(parseDraft(roughingStepOver, 'Roughing stepover'), units);
            if (roughStepMm <= 0) throw new Error('Roughing stepover must be positive.');
            if (selectedTool && roughStepMm > selectedTool.diameter + 1e-9) {
              throw new Error('Roughing stepover must not exceed the tool diameter.');
            }
          }
          let allowanceMm = 0;
          let finishFeedMm: number | null = null;
          if (finishingPass) {
            allowanceMm = commitLength(parseDraft(finishAllowance, 'Finish allowance'), units);
            if (allowanceMm <= 0) throw new Error('Finish allowance must be positive.');
            finishFeedMm = finishFeed.trim()
              ? commitFeed(parseDraft(finishFeed, 'Finish feed'), units)
              : null;
          }
          if (springPass && !geometry.closed) {
            throw new Error('A spring pass repeats the final lap, which needs a closed path.');
          }
          // On-path compensation rides the tool center on the contour — no
          // offset to step, so radial passes and a finishing pass have no
          // meaning (the engine rejects the combination too).
          if (compensation === 'on' && (passes > 1 || finishingPass)) {
            throw new Error(
              'On-path compensation has no wall offset to step — multi-pass roughing and a finishing pass need Inside/Outside (or Left/Right on open chains).',
            );
          }
          operation = {
            ...base,
            kind,
            path: geometry.path,
            closed: geometry.closed,
            top_z: top,
            bottom_z: bottom,
            step_down: commitLength(parseDraft(stepDown, 'Maximum stepdown'), units),
            compensation,
            compensation_mode: compensationMode,
            direction: millingDirection,
            lead_in: leadInMm,
            lead_out: leadOutMm,
            lead_arc_radius: arcMm,
            roughing_passes: passes,
            roughing_step_over: roughStepMm,
            finishing_pass: finishingPass,
            finish_allowance: allowanceMm,
            finish_feed: finishFeedMm,
            spring_pass: springPass,
            // Viewport-picked chains store their provenance so an edit
            // session re-selects the same entities; the planner only reads
            // the baked point list above.
            chain_ref:
              (source === 'model' || source === 'sketch') &&
              (chainPick?.selectedKeys.length ?? 0) > 0
                ? { source, keys: [...(chainPick?.selectedKeys ?? [])], reversed: chainReversed }
                : null,
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
            direction: millingDirection,
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
            direction: millingDirection,
            cutting: cutting(),
          };
          break;
        case 'drill': {
          const pecking = drillCycle === 'chip_breaking' || drillCycle === 'deep_hole';
          const tapping = drillCycle === 'tapping_right' || drillCycle === 'tapping_left';
          const feedingOut = drillCycle === 'reaming' || drillCycle === 'boring';
          // Tip-through belongs to the drilling family; tapping/reaming/
          // boring stop at the bottom plane by definition.
          const tipFamily = drillCycle === 'drill' || pecking;
          const tipThroughOn = tipFamily && tipThrough;
          operation = {
            ...base,
            kind,
            ...resolveDrillTargets(),
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
            drill_tip_through: tipThroughOn,
            breakthrough_depth: tipThroughOn
              ? commitLength(parseDraft(breakthrough, 'Break-through depth'), units)
              : 0,
            cutting: cutting(),
          };
          break;
        }
        case 'thread': {
          // The designation only seeds values here; the stored operation
          // carries the resolved pitch and diameters explicitly. Editing keeps
          // the stored values until the operator picks another designation.
          const keepStored = threadOp !== null && !threadPresetTouched;
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
            ...resolveDrillTargets(),
            top_z: top,
            bottom_z: bottomAbs(),
            pitch: keepStored ? threadOp.pitch : preset.pitchMm,
            major_diameter: keepStored ? threadOp.major_diameter : envelope.modeledMajor,
            minor_diameter: keepStored ? threadOp.minor_diameter : envelope.modeledMinor,
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
      runCamAction(() =>
        (editing ? replaceCamOperation(editing.id, operation) : addCamOperation(operation)).then(() => close()),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const threadReadout = (): string => {
    const len = (mm: number) => displayLength(mm, units).toFixed(units === 'inches' ? 4 : 3);
    if (threadOp && !threadPresetTouched) {
      return `Stored on this operation: pitch ${len(threadOp.pitch)} ${lu}/rev · major Ø${len(threadOp.major_diameter)} · minor Ø${len(threadOp.minor_diameter)} ${lu}. Picking a designation re-resolves these.`;
    }
    const preset =
      THREAD_PRESETS.find((candidate) => candidate.id === threadPresetId) ??
      defaultThreadPreset();
    const envelope = isoMetricGrade6Envelope(preset.nominalDiameterMm, preset.pitchMm, 'internal');
    return `Pitch ${len(preset.pitchMm)} ${lu}/rev · major Ø${len(envelope.modeledMajor)} · minor Ø${len(envelope.modeledMinor)} ${lu}. Pre-machine the hole to the minor diameter.`;
  };

  const geometrySection = () => {
    if (pages.geometry === 'holes') {
      const holes = holePick?.holes ?? [];
      return (
        <DialogSection title="HOLES · PICKED IN VIEWPORT">
          <p className="rounded border border-accent/30 bg-accent/5 p-2 text-[10px] leading-relaxed text-mute">
            Click cylindrical hole faces in the viewport to toggle them as hole centers; only
            faces whose axis is parallel to setup Z are pickable (fixed-axis planning).
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
        <div className={`grid ${pages.pathChain ? 'grid-cols-3' : 'grid-cols-2'} gap-1.5`}>
          {(
            pages.pathChain
              ? ([
                  ['model', `Model edges (${modelEdges.length})`],
                  ['sketch', `Sketch curves (${sketchCurves.length})`],
                  ['manual', 'Manual points'],
                ] as Array<[GeometrySource, string]>)
              : ([
                  ['sketch', `Sketch loop (${loops.length})`],
                  ['manual', 'Manual points'],
                ] as Array<[GeometrySource, string]>)
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
        {source !== 'manual' ? (
          pages.pathChain ? (
            <>
              <p className="mt-2 rounded border border-accent/30 bg-accent/5 p-2 text-[10px] leading-relaxed text-mute">
                {source === 'model'
                  ? "Click the part's edges one by one in the viewport — every edge must touch the next; the first pick anchors the travel direction. Click a picked edge again to unchain it. A full circular rim is a complete closed loop on its own."
                  : 'Click sketch curves one by one in the viewport — every curve must touch the next; the first pick anchors the travel direction. Click a picked curve again to unchain it. A circle is a complete closed loop on its own.'}
              </p>
              {chainPick && chainPick.entities.length === 0 && (
                <p className="mt-1.5 text-[10px] italic text-mute">
                  Nothing to pick for this source — switch to another one above.
                </p>
              )}
              <div className="mt-2 flex h-7 min-w-0 items-center gap-2 rounded border border-edge bg-header px-2 font-mono text-[10px] text-ink">
                <span className="min-w-0 flex-1 truncate">
                  {chainPick && chainPick.selectedKeys.length > 0
                    ? `${chainPick.selectedKeys.length} edge${chainPick.selectedKeys.length > 1 ? 's' : ''} · ${
                        chainResolution?.chain
                          ? chainResolution.chain.closed
                            ? 'closed chain'
                            : 'open chain'
                          : 'broken chain'
                      }`
                    : 'No edges picked yet'}
                </span>
                <button
                  type="button"
                  disabled={!chainResolution?.chain}
                  title="Flip the chain's travel direction (swaps left/right compensation sides)"
                  onClick={() => setChainReversed((value) => !value)}
                  className="shrink-0 rounded border border-edge px-1.5 py-0.5 text-[9px] font-semibold text-mute hover:border-accent/40 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Reverse{chainReversed ? ' ✓' : ''}
                </button>
              </div>
              {chainResolution?.error && chainPick && chainPick.selectedKeys.length > 0 && (
                <p className="mt-1.5 rounded border border-[#d69b45]/45 bg-[#2a2117]/80 p-1.5 text-[10px] leading-relaxed text-[#e8c589]">
                  {chainResolution.error}
                </p>
              )}
            </>
          ) : loops.length > 0 ? (
            <>
              <p className="mt-2 rounded border border-accent/30 bg-accent/5 p-2 text-[10px] leading-relaxed text-mute">
                Click a closed sketch loop in the viewport — hovering highlights it, clicking
                makes it the operation's path. Clicking inside a profile works too.
              </p>
              <div className="mt-2 flex h-7 min-w-0 items-center truncate rounded border border-edge bg-header px-2 font-mono text-[10px] text-ink">
                {selectedLoop()?.label ?? 'No loop picked yet'}
              </div>
            </>
          ) : (
            <p className="mt-2 text-[10px] italic text-mute">
              No closed sketch loops found. Sketch a closed profile first, or use manual points.
            </p>
          )
        ) : (
          <div className="mt-2">
            <label className="block">
              <span className={CAM_DIALOG_LABEL}>
                {pages.pathChain
                  ? `Path coordinates · one X,Y per line (${lu}, setup frame)`
                  : `Closed path · one X,Y per line (${lu}, setup frame)`}
              </span>
              <textarea
                value={manualPoints}
                onChange={(event) => setManualPoints(event.target.value)}
                rows={4}
                className={`${CAM_DIALOG_INPUT} h-auto resize-y font-mono leading-5`}
              />
            </label>
            {pages.pathChain && (
              <p className="mt-1.5 text-[9px] leading-relaxed text-mute/80">
                Typed coordinates in the setup frame — the fallback when there is nothing to
                pick in the viewport. Repeat the first point at the end for a closed path;
                leave it open for an open chain.
              </p>
            )}
          </div>
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
          onChange={(event) => {
            setThreadPresetTouched(true);
            setThreadPresetId(event.target.value);
          }}
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
   *  A row may also reference a LOWER operation height (fixed resolution
   *  order bottom → top → feed → retract → clearance), the picked sketch
   *  loop's plane Z ('Selection'), or — drill/thread — the picked hole
   *  faces' own top/bottom. Rapids stop at the feed plane: below it the tool
   *  moves at feed rate. The bottom height only exists for kinds that cut to
   *  a depth (facing targets the model top by default). Drilling-family
   *  cycles add the tip-through controls here, next to the bottom plane they
   *  extend past. */
  const heightsTab = () => {
    const hasBottomRow = pages.bottomZ === true || pages.faceTarget === true;
    const bottomRef: HeightFrom[] = hasBottomRow ? ['bottom'] : [];
    const holeRefs = pages.geometry === 'holes';
    const tipFamily =
      drillCycle === 'drill' || drillCycle === 'chip_breaking' || drillCycle === 'deep_hole';
    return (
      <>
        <DialogSection title="CLEARANCE HEIGHT">
          <HeightField
            from={clearanceFrom}
            offset={clearanceOff}
            onFrom={setClearanceFrom}
            onOffset={setClearanceOff}
            unit={lu}
            chainBelow={[...bottomRef, 'top', 'feed', 'retract']}
            selectionAvailable={selectionAvailable}
            holeRefsAvailable={holeRefs}
          />
        </DialogSection>
        <DialogSection title="RETRACT HEIGHT">
          <HeightField
            from={retractFrom}
            offset={retractOff}
            onFrom={setRetractFrom}
            onOffset={setRetractOff}
            unit={lu}
            chainBelow={[...bottomRef, 'top', 'feed']}
            selectionAvailable={selectionAvailable}
            holeRefsAvailable={holeRefs}
          />
        </DialogSection>
        <DialogSection title="FEED HEIGHT">
          <HeightField
            from={feedFrom}
            offset={feedOff}
            onFrom={setFeedFrom}
            onOffset={setFeedOff}
            unit={lu}
            chainBelow={[...bottomRef, 'top']}
            selectionAvailable={selectionAvailable}
            holeRefsAvailable={holeRefs}
          />
        </DialogSection>
        <DialogSection title="TOP HEIGHT">
          <HeightField
            from={topFrom}
            offset={topOff}
            onFrom={setTopFrom}
            onOffset={setTopOff}
            unit={lu}
            chainBelow={bottomRef}
            selectionAvailable={selectionAvailable}
            holeRefsAvailable={holeRefs}
          />
        </DialogSection>
        {hasBottomRow && (
          <DialogSection title="BOTTOM HEIGHT">
            <HeightField
              from={bottomFrom}
              offset={bottomOff}
              onFrom={setBottomFrom}
              onOffset={setBottomOff}
              unit={lu}
              selectionAvailable={selectionAvailable}
              holeRefsAvailable={holeRefs}
            />
          </DialogSection>
        )}
        {kind === 'drill' && (
          <DialogSection title="DRILL TIP">
            <label
              className={`flex items-center gap-2 text-[11px] ${tipFamily ? 'text-ink' : 'text-mute'}`}
              title={
                tipFamily
                  ? 'Drive the drill point past the bottom plane so the full diameter clears the hole bottom'
                  : 'Tip-through applies to the drilling family (drill, chip breaking, deep hole); tapping, reaming, and boring stop at the bottom plane'
              }
            >
              <input
                type="checkbox"
                checked={tipFamily && tipThrough}
                disabled={!tipFamily}
                onChange={(event) => setTipThrough(event.target.checked)}
              />
              Drill tip through bottom
            </label>
            {(tipFamily && tipThrough) && (
              <DraftNumber
                label="Break-through depth"
                value={breakthrough}
                onChange={setBreakthrough}
                unit={lu}
              />
            )}
          </DialogSection>
        )}
      </>
    );
  };

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
              {(chainClosed === false
                ? ([['on', 'On path'], ['left', 'Left of travel'], ['right', 'Right of travel']] as const)
                : chainClosed === true
                  ? ([['outside', 'Outside'], ['inside', 'Inside'], ['on', 'On path']] as const)
                  // Manual entry: openness is only known at submit, so offer
                  // every side; submit validates the combination.
                  : ([['outside', 'Outside'], ['inside', 'Inside'], ['on', 'On path'], ['left', 'Left of travel'], ['right', 'Right of travel']] as const)
              ).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label
            className="block"
            title={
              kind === 'face'
                ? 'Row-to-row cutting direction; one-way rows reposition at the feed plane'
                : 'Finishing-lap travel direction along the wall'
            }
          >
            <span className={CAM_DIALOG_LABEL}>Direction</span>
            <select
              value={kind === 'face' ? faceDirection : millingDirection}
              onChange={(event) =>
                kind === 'face'
                  ? setFaceDirection(event.target.value as CamFaceDirection)
                  : setMillingDirection(event.target.value as CamMillingDirection)
              }
              className={CAM_DIALOG_INPUT}
            >
              {kind === 'face' ? (
                <>
                  <option value="both_ways">Both ways (zigzag)</option>
                  <option value="climb">Climb (one way)</option>
                  <option value="conventional">Conventional (one way)</option>
                </>
              ) : (
                <>
                  <option value="climb">Climb</option>
                  <option value="conventional">Conventional</option>
                </>
              )}
            </select>
          </label>
        )}
        {pages.compensation && chainClosed === false && (
          <p className="col-span-2 rounded border border-[#d69b45]/45 bg-[#2a2117]/80 p-1.5 text-[10px] leading-relaxed text-[#e8c589]">
            Open chain — choose the side the MATERIAL is on (Left/Right of travel; flip travel
            with Reverse on the Geometry tab). “On path” rides the tool center on the edge and
            cuts one radius into BOTH sides of it.
          </p>
        )}
        {pages.compensation && (
          <label
            className="block"
            title={
              compensation === 'on'
                ? 'On path applies no radius offset in either mode'
                : 'Who turns the contour into the tool-center path'
            }
          >
            <span className={CAM_DIALOG_LABEL}>Compensation mode</span>
            <select
              value={compensationMode}
              onChange={(event) => setCompensationMode(event.target.value as CamCompensationMode)}
              className={CAM_DIALOG_INPUT}
            >
              <option value="in_control">In control — machine offsets (G41/G42)</option>
              <option value="in_software">In software — pre-offset path</option>
            </select>
          </label>
        )}
        {kind === 'contour2d' && (
          <label className="block" title="Travel direction along the profile">
            <span className={CAM_DIALOG_LABEL}>Milling direction</span>
            <select
              value={millingDirection}
              onChange={(event) => setMillingDirection(event.target.value as CamMillingDirection)}
              className={CAM_DIALOG_INPUT}
            >
              <option value="climb">Climb</option>
              <option value="conventional">Conventional</option>
            </select>
          </label>
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
        kind === 'contour2d' ? (
          // Contour slices by a plain maximum stepdown — no toggle; a value
          // past the full depth simply cuts in one pass.
          <div className="grid grid-cols-2 gap-2">
            <DraftNumber label="Maximum stepdown" value={stepDown} onChange={setStepDown} unit={lu} />
          </div>
        ) : (
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
        )
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
        <label className="block" title="Travel direction along the profile">
          <span className={CAM_DIALOG_LABEL}>Milling direction</span>
          <select
            value={millingDirection}
            onChange={(event) => setMillingDirection(event.target.value as CamMillingDirection)}
            className={CAM_DIALOG_INPUT}
          >
            <option value="climb">Climb</option>
            <option value="conventional">Conventional</option>
          </select>
        </label>
      </div>
    </DialogSection>
  );

  /** CONTOUR · radial multi-pass: roughing passes step toward the wall at
   *  the roughing stepover, leaving the finish allowance; the finishing
   *  pass takes the wall to size (optionally at a reduced feed); a spring
   *  pass repeats the final lap so tool deflection relaxes. */
  const contourPassesSection = () => (
    <DialogSection title="RADIAL PASSES">
      <div className="grid grid-cols-2 gap-2">
        <DraftNumber label="Roughing passes" value={roughingPasses} onChange={setRoughingPasses} unit="passes" integer />
        {Number(roughingPasses) > 1 && (
          <DraftNumber label="Roughing stepover" value={roughingStepOver} onChange={setRoughingStepOver} unit={lu} />
        )}
      </div>
      <label className="flex items-center gap-2 text-[11px] font-semibold text-ink">
        <input
          type="checkbox"
          checked={finishingPass}
          onChange={(event) => {
            setFinishingPass(event.target.checked);
            if (event.target.checked && !finishAllowance) {
              setFinishAllowance(displayLength(0.2, units).toFixed(4));
            }
          }}
        />
        Separate finishing pass
      </label>
      {finishingPass && (
        <div className="grid grid-cols-2 gap-2">
          <DraftNumber label="Finish allowance" value={finishAllowance} onChange={setFinishAllowance} unit={lu} />
          <DraftNumber label="Finish feed (empty = cutting feed)" value={finishFeed} onChange={setFinishFeed} unit={feedUnit(units)} />
        </div>
      )}
      <label
        className="flex items-center gap-2 text-[11px] text-ink"
        title="Repeat the final profile lap once so tool deflection relaxes (closed paths only)"
      >
        <input
          type="checkbox"
          checked={springPass}
          onChange={(event) => setSpringPass(event.target.checked)}
        />
        Spring pass (repeat the final lap)
      </label>
      {compensation === 'on' && (Number(roughingPasses) > 1 || finishingPass) && (
        <p className="rounded border border-[#d69b45]/45 bg-[#2a2117]/80 p-1.5 text-[10px] leading-relaxed text-[#e8c589]">
          On-path compensation has no wall offset to step — multi-pass roughing and a finishing
          pass need Inside/Outside (or Left/Right on open chains).
        </p>
      )}
    </DialogSection>
  );

  /** Passes tab dispatch: each operation kind gets its live field set. */
  const passesTab = () => {
    if (kind === 'drill') return drillCycleSection();
    if (pages.threadFields) return threadPassesSection();
    if (pages.chamferFields) return chamferSection();
    if (kind === 'contour2d') {
      return (
        <>
          {millingPassesSection()}
          {contourPassesSection()}
        </>
      );
    }
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
        {pages.leads ? (
          <>
            <p className="rounded border border-accent/30 bg-accent/5 p-2 text-[10px] leading-relaxed text-mute">
              Leads meet the profile tangentially — straight, or rounded into an arc when a
              radius is given (the arc swings in from the non-material side, so the cut never
              gouges the entry corner). Lead lengths carry no tool-diameter floor: with
              machine-side compensation the control owns its activation travel.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <DraftNumber
                label="Lead-in length"
                value={leadIn}
                onChange={(v) => { setLeadsTouched(true); setLeadIn(v); }}
                unit={lu}
              />
              <DraftNumber
                label="Lead-out length"
                value={leadOut}
                onChange={(v) => { setLeadsTouched(true); setLeadOut(v); }}
                unit={lu}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              {chainClosed === true && compensation === 'inside' ? (
                <DraftNumber
                  label="Lead arc radius"
                  value=""
                  onChange={() => {}}
                  unit={lu}
                  disabled
                  placeholder="straight only (inside closed)"
                />
              ) : (
                <DraftNumber
                  label="Lead arc radius (empty = straight)"
                  value={leadArcRadius}
                  onChange={(v) => { setLeadsTouched(true); setLeadArcRadius(v); }}
                  unit={lu}
                />
              )}
              <DraftNumber label="Vertical lead-in radius" value="2" onChange={() => {}} unit={lu} disabled />
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-x-2 gap-y-1">
              <DeadCheck label="Lead-in (entry)" checked />
              <DeadCheck label="Lead-out (exit)" checked />
              <DeadCheck label="Same as lead-in" checked />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <DraftNumber label="Vertical lead-in radius" value="2" onChange={() => {}} unit={lu} disabled />
              <DeadSelect label="Transition type" value="Smooth" />
            </div>
          </>
        )}
      </DialogSection>
    </>
  );

  if (!setup) return null;

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
            {editing ? `Edit — ${editing.name}` : `New ${camOperationLabel(kind)} operation`}
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
            {editing ? 'Save changes' : 'Add operation'}
          </button>
        </footer>
      </form>
    </div>
  );
}
