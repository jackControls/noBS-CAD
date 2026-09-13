import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { getEngine } from '../../engine';
import { resolveEdgeChain } from '../../geometry/edgeChain';
import { addCamChain, editCamChain, pickCamChain, removeCamChain, selectCamChain } from '../../cam/chainPicking';
import type { CamChamferChainDto, CamChamferGeometry, GeometryEdgeChain } from '../../engine/types';
import { useChamferChains } from './useChamferChains';
import { X } from 'lucide-react';
import { CAM_OPERATION_ICON, CamToolIcon } from './CamToolIcon';
import { CamLinkingFields, useCamLinking } from './camLinkingFields';
import { CamCuttingPair, CamCuttingHint, useCamCutting } from './camCuttingFields';
import { compensationGuidance } from '../../cam/machines';
import type { CamOperationPlacement } from '../../cam/editing';
import {
  activeCamSetup,
  addCamOperation,
  camOperationLabel,
  camToolCompatible,
  regenerateCamOperation,
  replaceCamOperation,
  type CamOperationInput,
  type CamOperationHeightExpressionsInput,
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
  sketchUvToModel,
  type SketchLoop,
} from '../../cam/geometry';
import {
  commitFeed,
  commitLength,
  displayFeed,
  displayLength,
} from '../../cam/units';
import {
  THREAD_PRESETS,
  defaultThreadPreset,
  isoMetricGrade6Envelope,
} from '../../lib/threadStandards';
import type { CamChainRefDto, CamCompensationMode, CamContourCompensation, CamCoolantMode, CamDrillCycle, CamFaceDirection, CamHeightExpressionDto, CamHoleDto, CamMillingDirection, CamOperationDto, CamPoint2Dto, CamThreadHand, CamToolDto } from '../../engine/types';
import { useAppStore, type CamChainSelection, type CamHolePickHole } from '../../store/appStore';
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

import { CamOperationTabs, HeightField, HEIGHT_CHAIN_LABELS, type HeightFrom, type OpTab } from './camOperationFields';

type OperationKind = Exclude<CamOperationInput['kind'], 'adaptive3d'>;
/** Geometry input mode. Chain kinds (contour) offer all three — the solid's
 *  own edges are the primary source; pocket operations pick closed
 *  sketch loops or manual coordinates. */
type GeometrySource = 'model' | 'sketch' | 'manual';

/** Stable loop identity shared by the dialog and the viewport loop-pick
 *  session (`CamLoopPickLoop.key`). */
const loopKeyOf = (loop: SketchLoop): string => `${loop.sketch}:${loop.entityIds.join(',')}`;

/** Convert persisted `sketch:name:entity` references back into the loop
 *  picker's public identity. Names may contain colons, so split at the final
 *  delimiter rather than treating the key as three naive fields. */
function loopKeyFromChainRef(reference: CamChainRefDto | null | undefined): string | null {
  if (!reference || reference.source !== 'sketch' || reference.keys.length === 0) return null;
  let sketch: string | null = null;
  const ids: string[] = [];
  for (const key of reference.keys) {
    if (!key.startsWith('sketch:')) return null;
    const value = key.slice('sketch:'.length);
    const split = value.lastIndexOf(':');
    if (split <= 0) return null;
    const owner = value.slice(0, split);
    const id = value.slice(split + 1);
    if (!/^\d+$/.test(id) || (sketch !== null && sketch !== owner)) return null;
    sketch = owner;
    ids.push(id);
  }
  return sketch === null ? null : `${sketch}:${ids.join(',')}`;
}

/** Reference planes an operation height can hang off; resolved to absolute
 *  setup Z at submit. Chain references hang a height off a LOWER height of
 *  the same operation (fixed resolution order bottom → top → feed → retract
 *  → clearance, so cycles are impossible by construction); 'selection' reads
 *  the picked sketch loop's plane Z. 'hole_top'/'hole_bottom' read the picked
 *  hole faces' own span (highest top / lowest bottom across the pick set;
 *  drill/thread only). The dead entries round out the option set the UI
 *  contract promises; the planner only consumes the resolved absolute
 *  values. */
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

/** Program one operation end to end. Every kind runs through the same
 *  five-tab scaffold (Tool / Geometry / Heights / Passes / Linking); the
 *  kind only switches geometry shapes and fields on through `OP_PAGES`, so
 *  a shared tab (tool picking, heights, feeds) is edited once for all
 *  operation kinds. Geometry, tool, heights, and feeds are all explicit;
 *  validation in the engine rejects incomplete input. */
export function CamOperationDialog({ kind, editing, insertion }: { kind: OperationKind; editing?: CamOperationDto; insertion?: CamOperationPlacement }) {
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
  const [savedId, setSavedId] = useState<number | null>(editing?.id ?? null);
  const [saveBusy, setSaveBusy] = useState(false);
  const close = () => { if (!saveBusy) useAppStore.getState().setCamDialog(null); };
  const units = cam.units;
  const lu = lengthUnit(units);
  const setup = editing ? cam.setups.find(s => s.operations.some(o => o.id === editing.id)) ?? null
    : insertion ? cam.setups.find(s => s.id === insertion.setupId) ?? null : activeCamSetup(cam);
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
  // CAM status/stock refreshes replace setup DTOs without changing geometry.
  // They must not restart an in-flight pick or discard its pending result.
  const pickGeometryKey = JSON.stringify([setup?.id, setup?.body_ids, setup?.wcs]);
  // Contour chain-picking candidates: the setup bodies' solid edges (primary
  // source — no sketch required) and the finished sketches' curve entities.
  const modelEdges = useMemo(
    () => (pages.pathChain && setup ? listModelEdgeCandidates(scene, setup) : []),
    [pages.pathChain, pickGeometryKey, scene],
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
  const storedHeightExpressions = editing
    ? cam.height_expressions?.find((entry) => entry.operation_id === editing.id) ?? null
    : null;

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
  const heightDraftFromExpression = (
    expression: CamHeightExpressionDto | null | undefined,
  ): { from: HeightFrom; off: string } | null =>
    expression
      ? {
          from: expression.reference,
          off: String(Number(displayLength(expression.offset, units).toFixed(4)) + 0),
        }
      : null;

  const bottomStored =
    faceOp?.target_z ?? contourOp?.bottom_z ?? pocketOp?.bottom_z ?? pointsOp?.bottom_z ?? null;
  const bottomDraft =
    heightDraftFromExpression(storedHeightExpressions?.bottom) ??
    (bottomStored !== null ? heightDraftFrom(bottomStored) : null);
  const topDraft =
    heightDraftFromExpression(storedHeightExpressions?.top) ??
    (editing ? heightDraftFrom(editing.top_z, [{ from: 'bottom', z: bottomStored }]) : null);
  const feedStored = editing?.feed_height_z ?? null;
  const feedDraft =
    heightDraftFromExpression(storedHeightExpressions?.feed) ??
    (feedStored !== null
      ? heightDraftFrom(feedStored, [
          { from: 'top', z: editing?.top_z ?? null },
          { from: 'bottom', z: bottomStored },
        ])
      : null);
  const retractDraft =
    heightDraftFromExpression(storedHeightExpressions?.retract) ??
    (editing
      ? heightDraftFrom(editing.retract_z, [
          { from: 'feed', z: feedStored },
          { from: 'top', z: editing.top_z },
          { from: 'bottom', z: bottomStored },
        ])
      : null);
  const clearanceDraft =
    heightDraftFromExpression(storedHeightExpressions?.clearance) ??
    (editing
      ? heightDraftFrom(editing.clearance_z, [
          { from: 'retract', z: editing.retract_z },
          { from: 'feed', z: feedStored },
          { from: 'top', z: editing.top_z },
          { from: 'bottom', z: bottomStored },
        ])
      : null);
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
    // Closed contours persist without a duplicate endpoint, while the
    // manual editor expresses closure by repeating its first coordinate.
    // Restore that representation so a linking-only edit cannot open a loop.
    const first = pts[0], last = pts[pts.length - 1];
    const draftPoints = (contourOp ?? chamferOp) && (contourOp ?? chamferOp)?.closed !== false && first && last
      && Math.hypot(first.x-last.x,first.y-last.y)>1e-6 ? [...pts,first] : pts;
    return draftPoints
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
  const feeds = useCamCutting({ units, tool: cam.tools.find(t => t.id === toolId) }, editing?.cutting);
  const { rpm, feedXy } = feeds.values;
  const [coolant, setCoolant] = useState<CamCoolantMode>(editing?.cutting.coolant ?? 'flood');
  // Editing keeps the operation's own cutting data; picking another tool must
  // not silently overwrite it.
  const [feedsTouched, setFeedsTouched] = useState(editing != null);

  const [source, setSource] = useState<GeometrySource>(() => {
    if (editing) {
      // A viewport-picked chain re-opens on its own source so the edit
      // session re-selects the same entities instead of dropping to raw
      // coordinates (the keys are seeded into the pick session below).
      const reference = contourOp?.chain_ref ?? pocketOp?.chain_ref ?? chamferOp?.chain_ref;
      if (reference) return reference.source;
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
  const [singleChainReversed, setSingleChainReversed] = useState((contourOp ?? chamferOp)?.chain_ref?.reversed ?? false);
  const activeChainIndex = chainPick?.activeChainIndex ?? 0;
  const chainReversed = chainPick?.chains?.[activeChainIndex]?.reversed ?? singleChainReversed;
  const setChainReversed = (value: boolean) => chainPick?.chains ? editCamChain({ reversed: value }) : setSingleChainReversed(value);
  // Editing a picked chain: the first pick session seeds from the stored
  // entity keys (consumed once — afterwards the live session owns the
  // selection, so switching sources and back keeps the operator's picks).
  const chainSeedRef = useRef((contourOp ?? chamferOp)?.chain_ref ?? null);
  const multiChainSeed = useRef<CamChainSelection[] | null>(chamferOp?.chain_ref ? [chamferOp, ...(chamferOp.additional_chains ?? [])].map(c => ({
    keys: c.chain_ref?.keys ?? [], reversed: c.chain_ref?.reversed ?? false,
    mode: c.closed === false ? 'manual' : 'closed', wallSide: c.wall_side,
  })) : null);
  const chainDrafts = useRef(new Map<string, { keys: string[]; mode: 'manual' | 'closed'; chains?: CamChainSelection[]; activeChainIndex?: number }>());
  const loopSeedRef = useRef(
    loopKeyFromChainRef(pocketOp?.chain_ref ?? chamferOp?.chain_ref),
  );
  // Editing drill/thread: the first hole-pick session re-seeds from the
  // stored holes, rebuilt from the CURRENT model faces so edited geometry
  // refreshes each hole's span. Broken references remain a blocking error;
  // they never degrade into trusted manual coordinates.
  const holeSeedRef = useRef<CamHoleDto[] | null>(drillOp?.holes ?? threadOp?.holes ?? null);
  const [unresolvedHoleRefs, setUnresolvedHoleRefs] = useState<string[]>([]);

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
  const [topFrom, setTopFrom] = useState<HeightFrom>(topDraft?.from ?? (kind === 'chamfer2d' && source !== 'manual' ? 'selection' : heightDefaults.top[0]));
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
  const [modeledChamfer, setModeledChamfer] = useState(chamferOp ? !!chamferOp.modeled_chamfer : true);
  const [additionalWidth, setAdditionalWidth] = useState(displayLength(chamferOp?.modeled_chamfer?.additional_width ?? 0, units).toFixed(4));
  const [chamferWidth, setChamferWidth] = useState(displayLength(chamferOp?.chamfer_width ?? 0.5, units).toFixed(4));
  const [tipOffset, setTipOffset] = useState(displayLength(chamferOp?.tip_offset ?? 0.5, units).toFixed(4));
  const [peckDepth, setPeckDepth] = useState(drillOp?.peck_depth != null ? displayLength(drillOp.peck_depth, units).toFixed(4) : '');
  const [peckRetract, setPeckRetract] = useState(drillOp?.peck_retract != null ? displayLength(drillOp.peck_retract, units).toFixed(4) : '');
  const [threadPitch, setThreadPitch] = useState(drillOp?.thread_pitch != null ? displayLength(drillOp.thread_pitch, units).toFixed(4) : '');
  const [floatingTapHolder, setFloatingTapHolder] = useState(
    drillOp?.floating_tap_holder ?? false,
  );
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
  const linking = useCamLinking(kind, units, selectedTool, editing);
  const [manualChamferLeads, setManualChamferLeads] = useState(() =>
    kind === 'chamfer2d' && !!useAppStore.getState().camDocument.linking?.some(l => l.operation_id === editing?.id),
  );

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
          throw new Error(`${label}: select a chain in one setup-Z plane on Geometry to use the Selection reference.`);
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
    feeds.reset(data);
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
  // current model so a changed face refreshes the span). A vanished face is
  // kept as an unresolved association and blocks Save until explicitly
  // discarded/reselected; it must never silently become a manual center.
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
    setUnresolvedHoleRefs(
      leftover.map((hole) => hole.face_key ?? 'unknown cylindrical face'),
    );
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
    const previous = useAppStore.getState().camLoopPick?.selectedKey ?? loopSeedRef.current;
    loopSeedRef.current = null;
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
    const retained = chainDrafts.current.get(source);
    let previous = retained?.keys;
    if (previous === undefined) {
      const seed = chainSeedRef.current;
      previous = seed && seed.source === source ? seed.keys : [];
      if (seed?.source === source) chainSeedRef.current = null;
    }
    const chains = kind === 'chamfer2d' ? retained?.chains ?? multiChainSeed.current ?? [{ keys: previous, reversed: singleChainReversed,
      mode: (chamferOp?.closed ?? true) ? 'closed' as const : 'manual' as const, wallSide: chamferOp?.wall_side }] : undefined;
    if (kind === 'chamfer2d') multiChainSeed.current = null;
    const activeChainIndex = retained?.activeChainIndex ?? 0;
    useAppStore.getState().setCamChainPick({
      entities,
      context: { source, bodyIds: setup?.body_ids ?? [], normal: setup?.wcs.z_axis ?? [0, 0, 1] },
      mode: chains?.[activeChainIndex]?.mode ?? retained?.mode ?? ((contourOp?.closed ?? chamferOp?.closed ?? true) ? 'closed' : 'manual'),
      selectedKeys: chains?.[activeChainIndex]?.keys ?? previous,
      chains, activeChainIndex,
      hoverKey: null,
    });
    return () => {
      const current = useAppStore.getState().camChainPick;
      if (current?.context?.source === source) chainDrafts.current.set(source, { keys: current.selectedKeys, mode: current.mode ?? 'manual', chains: current.chains, activeChainIndex: current.activeChainIndex });
      useAppStore.getState().setCamChainPick(null);
    };
  }, [pages.pathChain, source, modelEdges, sketchCurves, pickGeometryKey]);

  /** The picked chain resolved in click order, or the resolution error —
   *  kept out of exceptions during render so typing never crashes. */
  const context = chainPick?.context;
  const selectedKeys = chainPick?.selectedKeys;
  const [resolvedSelection, setResolvedSelection] = useState<{
    context: typeof context; keys: typeof selectedKeys; reversed: boolean;
    chain: GeometryEdgeChain | null; error: string | null;
  } | null>(null);
  useEffect(() => {
    const initial = useAppStore.getState().camChainPick;
    if (initial?.direction) useAppStore.getState().setCamChainPick({ ...initial, direction: null });
    if (!context || !selectedKeys?.length) { setResolvedSelection(null); return; }
    let current = true;
    void resolveEdgeChain(context, selectedKeys, 'manual', chainReversed).then(
      chain => {
        if (!current) return;
        setResolvedSelection({ context, keys: selectedKeys, reversed: chainReversed, chain, error: null });
        let a = chain.points[0], b = chain.points[1], length = 0;
        for (let i = 0; i < chain.points.length - (chain.closed ? 0 : 1); i++) {
          const p = chain.points[i], q = chain.points[(i + 1) % chain.points.length];
          const d = Math.hypot(...p.map((v, j) => v - q[j]));
          if (d > length) { a = p; b = q; length = d; }
        }
        const at = (t: number) => a.map((v, i) => v + (b[i] - v) * t) as [number, number, number];
        const state = useAppStore.getState();
        if (state.camChainPick?.context === context && state.camChainPick.selectedKeys === selectedKeys) {
          state.setCamChainPick({ ...state.camChainPick, direction: { start: at(0.35), end: at(0.65) } });
        }
      },
      error => { if (current) setResolvedSelection({ context, keys: selectedKeys, reversed: chainReversed, chain: null, error: String(error) }); },
    );
    return () => { current = false; };
  }, [context, selectedKeys, chainReversed]);
  const chainResolution = resolvedSelection?.context === context && resolvedSelection?.keys === selectedKeys && resolvedSelection?.reversed === chainReversed ? resolvedSelection : null;
  const chainPending = !!selectedKeys?.length && !chainResolution;
  const chainClosed = source === 'manual' ? (() => {
    const lines = manualPoints.trim().split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return null;
    const ends = [lines[0], lines[lines.length - 1]].map(line => line.trim().split(/[\s,;]+/).map(Number));
    if (ends.some(p => p.length !== 2 || p.some(v => !Number.isFinite(v)))) return null;
    return lines.length >= 3 && Math.hypot(ends[0][0] - ends[1][0], ends[0][1] - ends[1][1]) <= 1e-6;
  })() : chainResolution?.chain?.closed ?? null;
  const isModeledChamfer = kind === 'chamfer2d' && source === 'model' && modeledChamfer;
  const [resolvedChamfer, setResolvedChamfer] = useState<{
    selection: typeof chainResolution; geometry: CamChamferGeometry | null; error: string | null;
  } | null>(null);
  useEffect(() => {
    if (!isModeledChamfer || !chainResolution?.chain || !setup || !selectedKeys) { setResolvedChamfer(null); return; }
    let current = true;
    void getEngine().then(engine => engine.camChamferGeometry({
      setup_id: setup.id, chain_ref: { source: 'model', keys: selectedKeys, reversed: chainReversed },
    })).then(
      geometry => { if (current) setResolvedChamfer({ selection: chainResolution, geometry, error: null }); },
      error => { if (current) setResolvedChamfer({ selection: chainResolution, geometry: null, error: String(error) }); },
    );
    return () => { current = false; };
  }, [isModeledChamfer, chainResolution, setup?.id, selectedKeys, chainReversed]);
  const chamferResolution = resolvedChamfer?.selection === chainResolution ? resolvedChamfer : null;
  const modeledGeometry = isModeledChamfer ? chamferResolution?.geometry : null;
  const multiChains = chainPick?.chains;
  const resolvedChains = useChamferChains(context, multiChains, setup?.id, isModeledChamfer);
  const highestModeledTop = isModeledChamfer && resolvedChains
    ? resolvedChains.reduce<number | undefined>((z, r) => r.geometry ? Math.max(z ?? -Infinity, r.geometry.top_z) : z, undefined) : undefined;
  // Explicit-width chains have their own material side; changing the active
  // chain must not silently apply its inside/outside choice to another rim.
  const activeWallSide = multiChains?.[activeChainIndex]?.wallSide ?? wallSide;
  const changeWallSide = (side: CamContourCompensation) => multiChains ? editCamChain({ wallSide: side }) : setWallSide(side);

  useEffect(() => {
    if (chainClosed === false && (activeWallSide === 'inside' || activeWallSide === 'outside')) changeWallSide('right');
    if (chainClosed === true && (activeWallSide === 'left' || activeWallSide === 'right')) changeWallSide('inside');
  }, [chainClosed, activeWallSide]);

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

  const selectedLoop = (): SketchLoop | null =>
    loops.find((candidate) => loopKeyOf(candidate) === loopPick?.selectedKey) ?? null;

  /** Setup Z of the picked sketch loop's plane — the live 'Selection' height
   *  reference (path kinds only; hole picks carry no usable surface Z). */
  const selectionZ = (): number | null => {
    if (pages.geometry !== 'path' || !setup) return null;
    if (pages.pathChain) {
      if (multiChains) {
        if (!resolvedChains) return null;
        const levels = resolvedChains.flatMap(r => r.chain?.points.map(([x, y, z]) => modelPointToSetup({ x, y, z }, setup.wcs).z) ?? []);
        return levels.length ? levels.reduce((highest, z) => Math.max(highest, z), -Infinity) : null;
      }
      const points = chainResolution?.chain?.points;
      if (!points?.length) return null;
      const levels = points.map(([x, y, z]) => modelPointToSetup({ x, y, z }, setup.wcs).z);
      return levels.every(z => Math.abs(z - levels[0]) <= 1e-4) ? levels[0] : null;
    }
    if (source !== 'sketch') return null;
    const loop = selectedLoop();
    if (!loop) return null;
    const sketch = sketches.find((candidate) => candidate.name === loop.sketch);
    if (!sketch) return null;
    const origin = sketch.basis.origin;
    return modelPointToSetup({ x: origin[0], y: origin[1], z: origin[2] }, setup.wcs).z;
  };
  const selectionAvailable =
    pages.geometry === 'path' && (pages.pathChain ? source !== 'manual' : source === 'sketch' && selectedLoop() !== null);

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

  const loopChainRef = (): CamChainRefDto | null => {
    if (source !== 'sketch') return null;
    const loop = selectedLoop();
    if (!loop) throw new Error('Pick a closed sketch loop in the viewport.');
    return {
      source: 'sketch',
      keys: loop.entityIds.map((id) => `sketch:${loop.sketch}:${id}`),
      reversed: false,
    };
  };

  /** Contour geometry: the picked chain (open allowed) or manual points,
   *  with the closed flag the planner needs to decide whether the path may
   *  close itself. Compensation is validated against openness here so a
   *  mismatch fails with an actionable message, not a planner rejection. */
  const resolveContourGeometry = (): { path: CamPoint2Dto[]; closed: boolean } => {
    const checkCompensation = (closed: boolean) => {
      if (kind !== 'contour2d') return;
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
      const points = chainResolution.chain.points.map(([x, y, z]) => {
        const projected = modelPointToSetup({ x, y, z }, setup.wcs);
        return { x: projected.x, y: projected.y };
      });
      checkCompensation(chainResolution.chain.closed);
      return {
        path: points,
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
    if (unresolvedHoleRefs.length > 0) {
      throw new Error(
        `${unresolvedHoleRefs.length} referenced hole face${unresolvedHoleRefs.length > 1 ? 's no longer exist' : ' no longer exists'}. Discard the broken reference and reselect the current face before saving.`,
      );
    }
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

  const cutting = () => feeds.read(coolant, kind === 'drill');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (saveBusy) return;
    setError(null);
    try {
      if (!setup) throw new Error('No active CAM setup.');
      if (toolId === null) throw new Error('Pick a tool from the library first.');
      if (!selectedTool || !pickCompatible(selectedTool)) throw new Error('The assigned tool is incompatible with this operation. Choose a supported tool from the library.');
      // Heights resolve low to high so chain references (bottom → top →
      // feed → retract → clearance) read already-resolved values; the
      // stored result stays absolute setup Z either way.
      const hasBottomRow = pages.bottomZ === true || pages.faceTarget === true;
      const heightOffset = (offset: string, label: string): number =>
        commitLength(parseDraft(offset, `${label} offset`), units);
      const resolveOne = (
        from: HeightFrom,
        offset: string,
        label: string,
        resolved: { bottom?: number; top?: number; feed?: number; retract?: number },
      ): number =>
        heightRefZ(from, resolved, label) + heightOffset(offset, label);
      const bottomValue = hasBottomRow
        ? resolveOne(bottomFrom, bottomOff, 'Bottom height', {})
        : undefined;
      if (isModeledChamfer && highestModeledTop === undefined) throw new Error(chamferResolution?.error ?? 'Select the modeled bevel and wait for its geometry to resolve.');
      const topValue = highestModeledTop ?? resolveOne(topFrom, topOff, 'Top height', { bottom: bottomValue });
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
      const heightExpressions: CamOperationHeightExpressionsInput = {
        clearance: {
          reference: clearanceFrom,
          offset: heightOffset(clearanceOff, 'Clearance height'),
        },
        retract: {
          reference: retractFrom,
          offset: heightOffset(retractOff, 'Retract height'),
        },
        feed: {
          reference: feedFrom,
          offset: heightOffset(feedOff, 'Feed height'),
        },
        top: {
          reference: topFrom,
          offset: heightOffset(topOff, 'Top height'),
        },
        bottom: hasBottomRow
          ? {
              reference: bottomFrom,
              offset: heightOffset(bottomOff, 'Bottom height'),
            }
          : null,
      };
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
          const links = linking.read();
          // Legacy fields remain readable by older documents; Rust consumes
          // the explicit linking record, including disabled software leads.
          const leadInMm = Math.max(1e-6, links.lead_in.linear_distance);
          const leadOutMm = Math.max(1e-6, links.same_as_lead_in ? links.lead_in.linear_distance : links.lead_out.linear_distance);
          if (leadInMm <= 0 || leadOutMm <= 0) {
            throw new Error('Lead lengths must be positive.');
          }
          const arcMm = links.lead_in.horizontal_radius || null;
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
            // Viewport-picked chains store provenance so both editing and
            // backend regeneration resolve the current entities.
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
            chain_ref: loopChainRef(),
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
        case 'chamfer2d': {
          const added = isModeledChamfer ? commitLength(parseDraft(additionalWidth, 'Additional chamfer width'), units) : 0;
          const width = isModeledChamfer ? 0 : commitLength(parseDraft(chamferWidth, 'Chamfer width'), units);
          let chains: CamChamferChainDto[];
          if (source !== 'manual' && multiChains) {
            if (!resolvedChains || chainPick?.busy) throw new Error('Wait for all selected chains to resolve.');
            chains = multiChains.flatMap((selection, i) => {
              if (!selection.keys.length) return [];
              const resolved = resolvedChains[i];
              if (resolved.error || !resolved.chain || (isModeledChamfer && !resolved.geometry)) {
                throw new Error(`Chain ${i + 1}: ${resolved.error ?? 'Geometry is not ready.'}`);
              }
              const geometry = resolved.geometry;
              return [{
                path: geometry?.path ?? resolved.chain.points.map(([x, y, z]) => {
                  const p = modelPointToSetup({ x, y, z }, setup.wcs); return { x: p.x, y: p.y };
                }), closed: geometry?.closed ?? resolved.chain.closed,
                chain_ref: { source, keys: selection.keys, reversed: selection.reversed },
                modeled_chamfer: isModeledChamfer ? { additional_width: added } : null,
                top_z: geometry?.top_z ?? top, chamfer_width: geometry ? geometry.width + added : width,
                wall_side: geometry?.wall_side ?? selection.wallSide ?? wallSide,
              }];
            });
            if (!chains.length) throw new Error('Select at least one chamfer chain.');
          } else {
            const geometry = resolveContourGeometry();
            chains = [{ ...geometry, chain_ref: null, modeled_chamfer: null, top_z: top, chamfer_width: width, wall_side: wallSide }];
          }
          operation = {
            ...base,
            kind,
            ...chains[0],
            additional_chains: chains.slice(1),
            tip_offset: commitLength(parseDraft(tipOffset, 'Tip offset'), units),
            direction: millingDirection,
            cutting: cutting(),
          };
          break;
        }
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
            floating_tap_holder: tapping && floatingTapHolder,
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
      const links = kind === 'chamfer2d' ? (manualChamferLeads ? linking.read() : null)
        : kind === 'face' || kind === 'contour2d' ? linking.read() : undefined;
      if (operation.kind==='face' && links) operation.safe_distance=links.safe_distance;
      setSaveBusy(true);
      runCamAction(async () => {
        try {
          let id = savedId;
          if (id === null) {
            id = await addCamOperation(operation, heightExpressions, links, insertion);
            // Retrying a failed generation updates this inserted draft; it
            // must not insert another path or pick a new insertion anchor.
            setSavedId(id);
          } else await replaceCamOperation(id, operation, heightExpressions, links);
          if (operation.enabled) await regenerateCamOperation(id);
          useAppStore.getState().setCamDialog(null);
        } finally { setSaveBusy(false); }
      });
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
          {unresolvedHoleRefs.length > 0 && (
            <div className="rounded border border-warn/50 bg-warn/10 p-2 text-[10px] leading-relaxed text-warn">
              <p>
                {unresolvedHoleRefs.length} saved hole reference{unresolvedHoleRefs.length > 1 ? 's are' : ' is'} broken. Regeneration and Save are blocked so stale coordinates cannot be certified.
              </p>
              <button
                type="button"
                onClick={() => setUnresolvedHoleRefs([])}
                className="mt-1 rounded border border-warn/50 px-2 py-1 font-semibold"
              >
                Discard broken reference{unresolvedHoleRefs.length > 1 ? 's' : ''} and reselect
              </button>
            </div>
          )}
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
              <div className="mt-2 flex gap-1.5" role="group" aria-label="Chain selection mode">
                {([['closed', 'Closed loop'], ['manual', 'Manual edges']] as const).map(([mode, label]) => (
                  <button key={mode} type="button" aria-pressed={chainPick?.mode === mode}
                    onClick={() => editCamChain({ mode })}
                    className={`h-8 flex-1 rounded border text-[11px] ${chainPick?.mode === mode ? 'border-accent/50 bg-accent/15 text-accent' : 'border-edge text-mute hover:text-ink'}`}>{label}</button>
                ))}
              </div>
              <p className="mt-2 rounded border border-accent/30 bg-accent/5 p-2 text-[10px] leading-relaxed text-mute">
                {chainPick?.mode === 'closed'
                  ? multiChains ? 'Click each perimeter or hole rim to add another chain. Selected chains stay highlighted. Click an existing chain to edit it; Option-click picks an individual edge.'
                    : 'Hover an edge to preview its loop; click once to select the complete perimeter. Inner rims and outer boundaries stay separate. Option-click picks a single edge.'
                  : 'Click individual connected edges to build an open or closed chain. Click again to remove an edge. No gaps, branches, or automatic closing segments are added.'}
              </p>
              {multiChains && <div className="mt-2 space-y-1" aria-label="Chamfer chains">
                <div className="flex items-center justify-between text-[11px] text-mute">
                  <span>{multiChains.filter(c => c.keys.length).length} chains selected</span>
                  <button type="button" onClick={addCamChain} disabled={multiChains.length >= 64}
                    className="rounded border border-edge px-2 py-1 hover:text-ink disabled:opacity-40">+ New chain</button>
                </div>
                <div className="max-h-32 overflow-y-auto rounded border border-edge">
                  {multiChains.map((selection, i) => <div key={i} className={`flex items-center ${i === activeChainIndex ? 'bg-accent/10' : ''}`}>
                    <button type="button" aria-label={`Edit chain ${i + 1}`} aria-pressed={i === activeChainIndex}
                      onClick={() => selectCamChain(i)} className="min-w-0 flex-1 truncate px-2 py-1.5 text-left text-[11px] hover:bg-header">
                      Chain {i + 1} · {!selection.keys.length ? 'pick edges' : resolvedChains?.[i]?.error ? 'needs attention'
                        : !resolvedChains ? 'resolving…' : resolvedChains[i].chain?.closed ? 'closed' : 'open'}
                      {selection.reversed ? ' · reversed' : ''}
                    </button>
                    <button type="button" aria-label={`Remove chain ${i + 1}`} onClick={() => removeCamChain(i)} className="p-2 text-mute hover:text-ink"><X size={12} /></button>
                  </div>)}
                </div>
                {resolvedChains?.some(r => r.error) && <p role="alert" className="text-[11px] text-amber-600">One or more chains need attention. Select the marked chain to inspect it; all chains must resolve before saving.</p>}
              </div>}
              {chainPick && chainPick.entities.length === 0 && (
                <p className="mt-1.5 text-[10px] italic text-mute">
                  Nothing to pick for this source — switch to another one above.
                </p>
              )}
              <div className="mt-2 flex h-7 min-w-0 items-center gap-2 rounded border border-edge bg-header px-2 font-mono text-[10px] text-ink">
                <span className="min-w-0 flex-1 truncate">
                  {chainPick && chainPick.selectedKeys.length > 0
                    ? `${chainPick.selectedKeys.length} edge${chainPick.selectedKeys.length > 1 ? 's' : ''} · ${
                        chainPending || chainPick.busy ? 'resolving…' : chainResolution?.chain
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
                  title="Reverse the selected chain; left/right sides are relative to its arrow. Milling direction still controls cutting travel."
                  onClick={() => setChainReversed(!chainReversed)}
                  className="shrink-0 rounded border border-edge px-1.5 py-0.5 text-[9px] font-semibold text-mute hover:border-accent/40 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Reverse{chainReversed ? ' ✓' : ''}
                </button>
                <button type="button" title="Clear chain selection" aria-label="Clear chain selection"
                  onClick={() => editCamChain({ selectedKeys: [] })}
                  className="p-1 text-mute hover:text-ink"><X size={14} /></button>
              </div>
              {!!chainPick?.selectedKeys.length && (
                <div className="mt-1 max-h-28 overflow-y-auto rounded border border-edge" aria-label="Selected chain edges">
                  {chainPick.selectedKeys.map((key, index) => (
                    <div key={key} className="flex min-h-7 items-center gap-2 px-2 text-[10px] text-mute">
                      <span className="flex-1 truncate" title={key}>Edge {index + 1} · {key}</span>
                      <button type="button" aria-label={`Remove edge ${index + 1}`} onClick={() => void pickCamChain(key, true)} className="p-1 hover:text-ink"><X size={12} /></button>
                    </div>
                  ))}
                </div>
              )}
              {chainPick?.pickError && <p role="alert" className="mt-2 text-[11px] text-amber-600">{chainPick.pickError}</p>}
              {chainResolution?.error && chainPick && chainPick.selectedKeys.length > 0 && (
                <p className="mt-1.5 rounded border border-[#d69b45]/45 bg-[#2a2117]/80 p-1.5 text-[10px] leading-relaxed text-[#e8c589]">
                  {chainResolution.error}
                </p>
              )}
              {kind === 'chamfer2d' && source === 'model' && (
                <div className="mt-3 space-y-2 rounded border border-edge p-2">
                  <label className="block"><span className={CAM_DIALOG_LABEL}>Chamfer geometry</span>
                    <select aria-label="Chamfer geometry" className={CAM_DIALOG_INPUT} value={modeledChamfer ? 'modeled' : 'sharp'} onChange={e => setModeledChamfer(e.target.value === 'modeled')}>
                      <option value="modeled">Modeled chamfer</option><option value="sharp">Sharp edge + width</option>
                    </select>
                  </label>
                  <p className="text-[10px] leading-relaxed text-mute">{modeledChamfer
                    ? 'Select the upper or lower rim of a modeled 45° bevel. Width, top height and material side are measured from its adjacent faces. Use a 90° chamfer mill.'
                    : 'Select the sharp edge and enter the required width on Passes. Top height can follow the selected edge plane.'}</p>
                  {modeledChamfer && modeledGeometry && <p className="text-[11px] text-ink">Model width {displayLength(modeledGeometry.width, units).toFixed(3)} {lu} · top Z {displayLength(modeledGeometry.top_z, units).toFixed(3)} {lu} · material {modeledGeometry.wall_side}</p>}
                  {modeledChamfer && modeledGeometry?.corner_transitions && <p role="status" className="text-[11px] text-amber-600">The bevel has separate corner transitions. This pass follows the upper rim and may leave material on those corners; inspect the simulated result before posting.</p>}
                  {modeledChamfer && chamferResolution?.error && <p role="alert" className="text-[11px] text-amber-600">{chamferResolution.error}</p>}
                  {modeledChamfer && chainResolution?.chain && !chamferResolution && <p className="text-[10px] text-mute">Measuring adjacent bevel…</p>}
                </div>
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
                {kind === 'chamfer2d' && ' This source saves one typed chain only. Switch back to Model edges or Sketch curves to use your picked chains.'}
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

  /** Tool tab: shared linked feed/speed pairs. Holemaking cycles use feed
   * per revolution instead of the lateral-feed/per-tooth pair. */
  const toolTab = () => {
    const holemaking = kind === 'drill';
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
        {selectedTool && !pickCompatible(selectedTool) && <p role="alert" className="text-xs text-warn">The assigned tool is incompatible. Choose a supported tool before generating this path.</p>}
        <DialogSection title="FEED & SPEED">
          <div className="grid grid-cols-2 gap-2">
            {selectedTool && selectedTool.cutting_presets.length > 0 && (
              <label className="col-span-2 block">
                <span className={CAM_DIALOG_LABEL}>Preset</span>
                <select
                  aria-label="Cutting preset"
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
            <CamCuttingPair feeds={feeds} pair="speed" onEdit={() => setFeedsTouched(true)} />
            {!holemaking && <CamCuttingPair feeds={feeds} pair="cutting" onEdit={() => setFeedsTouched(true)} />}
            <CamCuttingPair feeds={feeds} pair="plunge" onEdit={() => setFeedsTouched(true)}
              primaryLabel={holemaking ? 'Drilling feedrate' : 'Plunge feedrate'}
              secondaryLabel={holemaking ? 'Feed per revolution' : 'Plunge feed per revolution'} />
            <CamCuttingHint />
            <DraftNumber label="Ramp spindle speed" value={rpm} onChange={() => {}} unit="rpm" disabled />
            {!holemaking && (
              <>
                {kind === 'chamfer2d' ? manualChamferLeads ? <>
                  <DraftNumber label="Lead-in feedrate" value={String(linking.draft.lead_in_feed)} onChange={v => linking.change('lead_in_feed', v)} unit={fu} />
                  <DraftNumber label="Lead-out feedrate" value={String(linking.draft.lead_out_feed)} onChange={v => linking.change('lead_out_feed', v)} unit={fu} />
                </> : <p className="col-span-2 text-[10px] text-mute">Automatic leads use Cutting feedrate. Choose Manual in Linking to set separate lead feedrates and geometry.</p> : <>
                  <DraftNumber label="Lead-in feedrate" value={feedXy} onChange={() => {}} unit={fu} disabled />
                  <DraftNumber label="Lead-out feedrate" value={feedXy} onChange={() => {}} unit={fu} disabled />
                </>}
                <DraftNumber label="Transition feedrate" value={feedXy} onChange={() => {}} unit={fu} disabled />
                <DraftNumber label="Ramp feedrate" value={feedXy} onChange={() => {}} unit={fu} disabled />
              </>
            )}
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
          {isModeledChamfer ? <p className="text-[11px] text-mute">Each chain follows its modeled bevel. Shared transfer heights reference the highest selected top: {highestModeledTop === undefined ? 'select a modeled chamfer' : `${displayLength(highestModeledTop, units).toFixed(3)} ${lu}`}. Switch to Sharp edge + width for an explicit top height.</p> : <HeightField
            from={topFrom}
            offset={topOff}
            onFrom={setTopFrom}
            onOffset={setTopOff}
            unit={lu}
            chainBelow={bottomRef}
            selectionAvailable={selectionAvailable}
            holeRefsAvailable={holeRefs}
          />}
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
          {pages.compensation && compensationMode === 'in_control' && compensation !== 'on' && (
            <p className="col-span-2 text-[10px] leading-relaxed text-mute">
              {setup?.machine
                ? compensationGuidance(setup.machine.profile.post.dialect)
                : 'Generic setup: choose a machine/controller before NC output. Actual XY engagement and cancellation moves will be checked for that target; arcs are optional.'}
              {' '}The check uses generated move length, not just the lead distance field. In-control assumes the full project tool radius, not wear-only compensation.
            </p>
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
          <>
            <DraftNumber label="Thread pitch" value={threadPitch} onChange={setThreadPitch} unit={`${lu}/rev`} />
            <label
              className="col-span-2 flex items-start gap-2 rounded border border-warning/40 bg-warning/5 p-2 text-[10px] text-ink"
              title="Longhand tapping is not controller-synchronized rigid tapping"
            >
              <input
                type="checkbox"
                checked={floatingTapHolder}
                onChange={(event) => setFloatingTapHolder(event.target.checked)}
              />
              <span>
                Confirm a suitable floating tap holder. This operation uses feed/reverse longhand motion and is not rigid tapping.
              </span>
            </label>
          </>
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
        {isModeledChamfer
          ? <DraftNumber label="Additional width" value={additionalWidth} onChange={setAdditionalWidth} unit={lu} />
          : <DraftNumber label="Chamfer width" value={chamferWidth} onChange={setChamferWidth} unit={lu} />}
        <DraftNumber label="Tip offset" value={tipOffset} onChange={setTipOffset} unit={lu} />
        <label className="block">
          <span className={CAM_DIALOG_LABEL}>Material side</span>
          <select
            value={modeledGeometry?.wall_side ?? activeWallSide}
            disabled={isModeledChamfer}
            onChange={(event) => changeWallSide(event.target.value as CamContourCompensation)}
            className={CAM_DIALOG_INPUT}
          >
            {(modeledGeometry?.closed ?? chainClosed ?? true) ? <><option value="inside">Inside path (boss edge)</option><option value="outside">Outside path (hole edge)</option></>
              : <><option value="left">Left of selected direction</option><option value="right">Right of selected direction</option></>}
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
      {multiChains && <p className="mt-2 text-[10px] text-mute">Material side is for chain {activeChainIndex + 1}. Width allowance, tip offset and milling direction apply to all chains. Return to Geometry to edit another chain.</p>}
      <p className="mt-2 text-[10px] leading-relaxed text-mute">{isModeledChamfer ? 'Additional width 0 follows the modeled bevel. ' : ''}Tip offset positions the cutting flank below the bevel root. Width + tip offset must fit within the cutter radius. Tangent entry/exit moves are clearance-checked.</p>
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

  /** Describe implemented policies only; disabled affirmative placeholders
   *  otherwise look like active machining guarantees. */
  const linkingTab = () => (
    kind === 'chamfer2d' && setup ? <>
      <DialogSection title="CHAMFER LEADS">
        <label className="block">
          <span className={CAM_DIALOG_LABEL}>Lead sizing</span>
          <select aria-label="Lead sizing" className={CAM_DIALOG_INPUT} value={manualChamferLeads ? 'manual' : 'automatic'}
            onChange={e => setManualChamferLeads(e.target.value === 'manual')}>
            <option value="automatic">Automatic fitting</option>
            <option value="manual">Manual</option>
          </select>
        </label>
        {!manualChamferLeads && <p className="mt-2 text-[10px] leading-relaxed text-mute">Fits a tangent entry and exit to each chain, reporting any reduction. Uses Cutting feedrate and the configured Heights. Choose Manual to specify radii, sweep angles, straight distances, vertical rounding and separate lead feedrates.</p>}
      </DialogSection>
      {manualChamferLeads && <CamLinkingFields value={linking} setup={setup} />}
    </> :
    (kind === 'face' || kind === 'contour2d') && setup ? <CamLinkingFields value={linking} setup={setup} /> :
    <>
      <DialogSection title="LINKING">
        <p className="text-[10px] leading-relaxed text-mute">
          XY rapid transfers lift to clearance first. One-way facing returns at clearance;
          pocket clearing uses axial entry with a center-cutting tool. Reaming and boring
          feed out. High-feed conversion and general keep-down controls are not implemented.
        </p>
          {pages.safeDistance && (
            <DraftNumber
              label="Safe distance"
              value={safeDistance}
              onChange={setSafeDistance}
              unit={lu}
            />
          )}
      </DialogSection>
      <DialogSection title="LEADS & TRANSITIONS">
        {pages.leads ? (
          <>
            <p className="rounded border border-accent/30 bg-accent/5 p-2 text-[10px] leading-relaxed text-mute">
              Tangent leads are checked against the selected profile using the project's
              cutter diameter, including controller-compensated entry and exit. This does
              not certify neighboring bodies, fixtures, or a different machine offset.
              Inside profiles start on a straight edge. Regenerate after changing geometry.
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
                <DraftNumber
                  label="Lead arc radius (empty = straight)"
                  value={leadArcRadius}
                  onChange={(v) => { setLeadsTouched(true); setLeadArcRadius(v); }}
                  unit={lu}
                />
            </div>
          </>
        ) : (
          <p className="text-[10px] leading-relaxed text-mute">
            Entry and exit follow this operation's generated policy. Independent vertical
            lead radii, overlap, and transition-style controls are not implemented.
          </p>
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
        className="feature-dialog pointer-events-auto absolute right-5 top-[160px] flex max-h-[calc(100vh-218px)] w-[340px] flex-col overflow-hidden rounded border border-edge bg-panel shadow-2xl"
      >
        <header className="flex h-10 shrink-0 items-center gap-2 border-b border-edge px-3">
          <CamToolIcon id={CAM_OPERATION_ICON[kind]} size={18} />
          <span className="flex-1 text-xs font-semibold text-ink">
            {editing ? `Edit — ${editing.name}` : `New ${camOperationLabel(kind)} operation`}
          </span>
          <button type="button" disabled={saveBusy} onClick={close} className="rounded p-1 text-mute hover:bg-edge hover:text-ink disabled:opacity-40">
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

          <CamOperationTabs value={opTab} onChange={setOpTab} />

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
            disabled={saveBusy}
            onClick={close}
            className="h-7 rounded border border-edge px-3 text-[10px] font-semibold text-mute hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saveBusy}
            className="h-7 rounded border border-accent/50 bg-accent/15 px-3 text-[10px] font-semibold text-accent hover:bg-accent/25"
          >
            {editing ? 'Save changes' : 'Add operation'}
          </button>
        </footer>
      </form>
    </div>
  );
}
