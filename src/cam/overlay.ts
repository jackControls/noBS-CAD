import type {
  CamCommandDto,
  CamDocumentDto,
  CamProgramDto,
  CamSetupDto,
  CamSimulationResultDto,
  Point3Dto,
  SolidSceneDto,
} from '../engine/types';
import type {
  NativeViewportArrow,
  NativeViewportLineLayer,
  NativeViewportPointLayer,
  NativeViewportTriangleLayer,
} from '../components/viewport/nativeViewportBridge';
import type {
  CamChainPickSession,
  CamHolePickSession,
  CamLoopPickSession,
  CamPointPickSession,
} from '../store/appStore';
import { activeCamSetup } from './document';
import { modelBoundsOfBodies, setupPointToModel } from './geometry';
import { camPickCandidateKey } from './pointPick';

/**
 * Manufacturing overlays for the shared modeling viewport.
 *
 * The manufacturing tab mounts the same viewport as modeling; everything the
 * operator needs on top — stock ghost, WCS axes, the selected operation's
 * toolpath, simulated remaining stock, and point-pick candidates — is
 * collected here as transient presentation layers and merged into the
 * viewport's native preview channel (see `collectNativeViewportTransient` in
 * Viewport.tsx). Planner and simulator output is setup-space; this module is
 * the single place that transforms it back into model coordinates.
 */

export interface CamOverlayLayers {
  lines: NativeViewportLineLayer[];
  points: NativeViewportPointLayer[];
  triangles: NativeViewportTriangleLayer[];
  arrows: NativeViewportArrow[];
}

/** Store slice the collector reads. Structural, so the viewport can pass its
 *  own state snapshot straight through. */
export interface CamOverlayState {
  activeTab: string;
  camDocument: CamDocumentDto;
  selectedCamOperationId: number | null;
  camProgram: CamProgramDto | null;
  camSimulation: CamSimulationResultDto | null;
  camPointPick: CamPointPickSession | null;
  /** Active viewport hole-picking session (drill/thread dialogs). */
  camHolePick: CamHolePickSession | null;
  /** Active viewport loop-picking session (path-geometry dialogs). */
  camLoopPick: CamLoopPickSession | null;
  /** Active viewport edge-chain picking session (contour dialogs). */
  camChainPick: CamChainPickSession | null;
  /** A manufacturing editor dialog is open — the simulation hides so the
   *  viewport shows the plain model while programming. */
  camDialogOpen: boolean;
  solidScene: SolidSceneDto;
}

type Rgba = [number, number, number, number];

const STOCK_FILL: Rgba = [0.62, 0.68, 0.75, 0.16];
const STOCK_EDGE: Rgba = [0.62, 0.68, 0.75, 0.5];
const RAPID_LINE: Rgba = [0.94, 0.67, 0.29, 0.8];
const CUT_LINE: Rgba = [0.34, 0.84, 0.64, 0.95];
const REST_STOCK_FILL: Rgba = [0.16, 0.6, 0.25, 0.9];
const COLLISION_POINT: Rgba = [0.94, 0.38, 0.35, 0.95];
const PICK_POINT: Rgba = [0.4, 0.73, 0.94, 0.95];
const PICK_POINT_HOVER: Rgba = [1.0, 0.85, 0.4, 1];
/** Picked hole centers in a drill/thread hole-pick session. */
const HOLE_POINT: Rgba = [0.5, 0.9, 0.55, 0.95];
/** Picked holes whose axis is not setup-Z: machinable later, not today. */
const HOLE_POINT_TILTED: Rgba = [0.94, 0.67, 0.29, 0.95];
/** Sketch loops offered in a contour/pocket loop-pick session. */
const LOOP_LINE: Rgba = [0.4, 0.73, 0.94, 0.8];
const LOOP_LINE_HOVER: Rgba = [1.0, 0.85, 0.4, 1];
const LOOP_LINE_SELECTED: Rgba = [0.5, 0.9, 0.55, 1];
const TOOL_FLUTE_FILL: Rgba = [0.78, 0.8, 0.84, 0.55];
const TOOL_SHANK_FILL: Rgba = [0.62, 0.65, 0.7, 0.3];
const AXIS_X: Rgba = [0.93, 0.42, 0.35, 1];
const AXIS_Y: Rgba = [0.34, 0.84, 0.64, 1];
const AXIS_Z: Rgba = [0.4, 0.73, 0.94, 1];

const MAX_STOCK_TRIANGLES = 65_536;
const CYLINDER_SEGMENTS = 64;

interface ToolpathSegment {
  from: Point3Dto;
  to: Point3Dto;
  rapid: boolean;
}

/** Flatten planner motion commands into draw segments, in setup coordinates.
 *  Circular moves are tessellated into chords. */
export function buildToolpathSegments(commands: CamCommandDto[]): ToolpathSegment[] {
  const segments: ToolpathSegment[] = [];
  let position: Point3Dto | null = null;
  for (const command of commands) {
    if (command.kind === 'rapid' || command.kind === 'linear') {
      if (position) {
        segments.push({ from: position, to: command.to, rapid: command.kind === 'rapid' });
      }
      position = command.to;
      continue;
    }
    if (command.kind === 'circular') {
      if (!position) {
        position = command.to;
        continue;
      }
      const startAngle = Math.atan2(position.y - command.center.y, position.x - command.center.x);
      const endAngle = Math.atan2(command.to.y - command.center.y, command.to.x - command.center.x);
      let sweep = endAngle - startAngle;
      if (command.clockwise) {
        while (sweep >= 0) sweep -= Math.PI * 2;
      } else {
        while (sweep <= 0) sweep += Math.PI * 2;
      }
      const radius = Math.hypot(position.x - command.center.x, position.y - command.center.y);
      const count = Math.max(8, Math.min(96, Math.ceil((Math.abs(sweep) * radius) / 1.5)));
      let previous = position;
      for (let index = 1; index <= count; index += 1) {
        const t = index / count;
        const angle = startAngle + sweep * t;
        const next = {
          x: command.center.x + Math.cos(angle) * radius,
          y: command.center.y + Math.sin(angle) * radius,
          z: position.z + (command.to.z - position.z) * t,
        };
        segments.push({ from: previous, to: next, rapid: false });
        previous = next;
      }
      position = command.to;
    }
  }
  return segments;
}

/** Collect the CAM overlay layers for the current store snapshot. Returns
 *  empty layers outside the manufacturing tab so modeling stays untouched. */
export function collectCamOverlay(state: CamOverlayState): CamOverlayLayers {
  const layers: CamOverlayLayers = { lines: [], points: [], triangles: [], arrows: [] };
  if (state.activeTab !== 'cam') return layers;

  const { camDocument: cam, solidScene: scene } = state;
  const setup = activeCamSetup(cam);

  // Point-pick candidates arrive in model coordinates and render on top of
  // everything else, with or without a setup. The hovered candidate draws
  // brighter and larger so the operator sees exactly what a click commits.
  const markerRadius = pickMarkerRadius(scene, setup);
  if (state.camPointPick && state.camPointPick.candidates.length > 0) {
    const rest: number[] = [];
    const hovered: number[] = [];
    for (const candidate of state.camPointPick.candidates) {
      const target =
        camPickCandidateKey(candidate) === state.camPointPick.hoverKey ? hovered : rest;
      target.push(candidate.point.x, candidate.point.y, candidate.point.z);
    }
    if (rest.length > 0) {
      layers.points.push({ color: PICK_POINT, radius: markerRadius, positions: rest });
    }
    if (hovered.length > 0) {
      layers.points.push({
        color: PICK_POINT_HOVER,
        radius: markerRadius * 1.5,
        positions: hovered,
      });
    }
  }

  if (!setup) return layers;

  // Hole-pick session markers: chosen hole centers, the hovered one
  // emphasized. Picks are constrained to setup-Z-parallel faces today; the
  // amber "tilted" bucket is the reserved display path for the indexed/5-axis
  // roadmap (the axis rides on every pick). The face under the pointer is
  // highlighted by the viewport's own face-hover channel.
  if (state.camHolePick && state.camHolePick.holes.length > 0) {
    const rest: number[] = [];
    const tilted: number[] = [];
    const hovered: number[] = [];
    for (const hole of state.camHolePick.holes) {
      if (hole.key === state.camHolePick.hoverKey) {
        hovered.push(hole.modelPoint.x, hole.modelPoint.y, hole.modelPoint.z);
        continue;
      }
      const target = Math.abs(hole.axis[2]) > 1 - 1e-6 ? rest : tilted;
      target.push(hole.modelPoint.x, hole.modelPoint.y, hole.modelPoint.z);
    }
    if (rest.length > 0) {
      layers.points.push({ color: HOLE_POINT, radius: markerRadius * 1.2, positions: rest });
    }
    if (tilted.length > 0) {
      layers.points.push({ color: HOLE_POINT_TILTED, radius: markerRadius * 1.2, positions: tilted });
    }
    if (hovered.length > 0) {
      layers.points.push({
        color: PICK_POINT_HOVER,
        radius: markerRadius * 1.6,
        positions: hovered,
      });
    }
  }

  // Loop-pick session: every closed sketch loop is a clickable candidate.
  // The hovered loop reads as the hover accent, the committed loop in the
  // same green as picked hole centers; width >= 2 draws through geometry so
  // loops buried in the part stay readable.
  if (state.camLoopPick && state.camLoopPick.loops.length > 0) {
    const rest: number[] = [];
    const hovered: number[] = [];
    const selected: number[] = [];
    for (const loop of state.camLoopPick.loops) {
      const target =
        loop.key === state.camLoopPick.hoverKey
          ? hovered
          : loop.key === state.camLoopPick.selectedKey
            ? selected
            : rest;
      const points = loop.modelPoints;
      for (let index = 0; index < points.length; index += 1) {
        const a = points[index];
        const b = points[(index + 1) % points.length];
        target.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }
    if (rest.length > 0) {
      layers.lines.push({ color: LOOP_LINE, width: 2, pattern: 'solid', segments: rest });
    }
    if (selected.length > 0) {
      layers.lines.push({ color: LOOP_LINE_SELECTED, width: 3, pattern: 'solid', segments: selected });
    }
    if (hovered.length > 0) {
      layers.lines.push({ color: LOOP_LINE_HOVER, width: 3, pattern: 'solid', segments: hovered });
    }
  }

  // Chain-pick session (contour): every candidate edge (solid B-rep edge or
  // sketch curve) is clickable; picked edges draw green in their chained
  // polyline, the hovered one amber. Circles render as closed rings, open
  // entities as polylines.
  if (state.camChainPick && state.camChainPick.entities.length > 0) {
    const rest: number[] = [];
    const hovered: number[] = [];
    const selected: number[] = [];
    const selectedKeys = new Set(state.camChainPick.selectedKeys);
    for (const entity of state.camChainPick.entities) {
      const target =
        entity.key === state.camChainPick.hoverKey
          ? hovered
          : selectedKeys.has(entity.key)
            ? selected
            : rest;
      const points = entity.modelPoints;
      const count = entity.kind === 'circle' ? points.length : points.length - 1;
      for (let index = 0; index < count; index += 1) {
        const a = points[index];
        const b = points[(index + 1) % points.length];
        target.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }
    if (rest.length > 0) {
      layers.lines.push({ color: LOOP_LINE, width: 1.5, pattern: 'solid', segments: rest });
    }
    if (selected.length > 0) {
      layers.lines.push({ color: LOOP_LINE_SELECTED, width: 3, pattern: 'solid', segments: selected });
    }
    if (hovered.length > 0) {
      layers.lines.push({ color: LOOP_LINE_HOVER, width: 3, pattern: 'solid', segments: hovered });
    }
  }

  pushWcsAxes(layers, setup);
  pushStockGhost(layers, setup);
  pushSelectedToolpath(layers, state, setup);
  pushSelectedTool(layers, state, setup);
  // The simulated stock belongs to a selected operation under review: with
  // no selection, or while a dialog is open, the viewport shows the plain
  // model instead.
  if (state.selectedCamOperationId !== null && !state.camDialogOpen) {
    pushSimulationStock(layers, state, setup, markerRadius);
  }
  return layers;
}

function pickMarkerRadius(scene: SolidSceneDto, setup: CamSetupDto | null): number {
  // Pick markers read as handles, not geometry: keep them small — the
  // native side fills them solidly at one chord row per pixel.
  if (setup) {
    const extent = Math.max(
      setup.stock.max.x - setup.stock.min.x,
      setup.stock.max.y - setup.stock.min.y,
      setup.stock.max.z - setup.stock.min.z,
      1,
    );
    return clamp(extent * 0.006, 0.5, 3.5);
  }
  const bounds = modelBoundsOfBodies(scene, scene.bodies.map((body) => body.id));
  const extent = bounds
    ? Math.max(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y, bounds.max.z - bounds.min.z, 1)
    : 100;
  return clamp(extent * 0.006, 0.5, 3.5);
}

/** RGB axes at the WCS origin; the WCS origin is already model-space. */
function pushWcsAxes(layers: CamOverlayLayers, setup: CamSetupDto) {
  const { origin, x_axis: xAxis, y_axis: yAxis, z_axis: zAxis } = setup.wcs;
  const length = Math.max(
    4,
    Math.min(setup.stock.max.x - setup.stock.min.x, setup.stock.max.y - setup.stock.min.y) * 0.12,
  );
  const tip = (axis: [number, number, number]): [number, number, number] => [
    origin.x + axis[0] * length,
    origin.y + axis[1] * length,
    origin.z + axis[2] * length,
  ];
  const start: [number, number, number] = [origin.x, origin.y, origin.z];
  layers.arrows.push(
    { start, end: tip(xAxis), color: AXIS_X, width: 2, xray: true },
    { start, end: tip(yAxis), color: AXIS_Y, width: 2, xray: true },
    { start, end: tip(zAxis), color: AXIS_Z, width: 2, xray: true },
  );
}

/** Semi-transparent stock solid plus a crisper envelope outline. */
function pushStockGhost(layers: CamOverlayLayers, setup: CamSetupDto) {
  const toModel = (point: Point3Dto) => setupPointToModel(point, setup.wcs);
  const fillPositions: number[] = [];
  const edgePositions: number[] = [];
  const shape = setup.resolved_stock.shape;
  if (shape === 'model_body') {
    // A modeled stock body is already rendered as a solid; draw only its
    // envelope outline so the machining extent stays visible.
    pushBox(toModel, setup, null, edgePositions);
  } else if (shape === 'cylinder' || shape === 'hex') {
    const stock = setup.resolved_stock;
    const ring =
      stock.shape === 'cylinder'
        ? regularRing(stock.center.x, stock.center.y, stock.radius, CYLINDER_SEGMENTS, 0)
        : regularRing(
            stock.center.x,
            stock.center.y,
            // Flats are perpendicular to setup X, so vertices sit at 30
            // degree offsets and the circumradius is AF / sqrt(3).
            stock.across_flats / Math.sqrt(3),
            6,
            Math.PI / 6,
          );
    pushPrism(toModel, ring, setup.stock.min.z, setup.stock.max.z, fillPositions, edgePositions);
  } else {
    // box and rest both present as the resolved envelope box.
    pushBox(toModel, setup, fillPositions, edgePositions);
  }
  if (fillPositions.length > 0) {
    layers.triangles.push({ color: STOCK_FILL, positions: fillPositions, xray: false });
  }
  if (edgePositions.length > 0) {
    layers.lines.push({ color: STOCK_EDGE, width: 1, pattern: 'solid', segments: edgePositions });
  }
}

/** Entry/exit cone colors: green marks where cutting starts, red where it
 *  leaves (machinist convention for static toolpath display). */
const ENTRY_ARROW: Rgba = [0.32, 0.95, 0.42, 1];
const EXIT_ARROW: Rgba = [0.98, 0.3, 0.24, 1];

/** Append a pure-cone direction marker to `positions` (model space): the
 *  base disc sits at `anchor`, the apex at anchor + dir*len, base radius
 *  0.35x the length, 12 sides. Pure cones read as direction markers at any
 *  zoom without a shaft dominating small parts. */
function pushCone(positions: number[], anchor: Point3Dto, dir: Point3Dto, len: number) {
  const sides = 12;
  const baseRadius = len * 0.35;
  // Orthonormal basis (u, v) perpendicular to dir.
  const ref = Math.abs(dir.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
  const ux = dir.y * ref.z - dir.z * ref.y;
  const uy = dir.z * ref.x - dir.x * ref.z;
  const uz = dir.x * ref.y - dir.y * ref.x;
  const uLen = Math.hypot(ux, uy, uz) || 1;
  const u = { x: ux / uLen, y: uy / uLen, z: uz / uLen };
  const v = {
    x: dir.y * u.z - dir.z * u.y,
    y: dir.z * u.x - dir.x * u.z,
    z: dir.x * u.y - dir.y * u.x,
  };
  const apex = { x: anchor.x + dir.x * len, y: anchor.y + dir.y * len, z: anchor.z + dir.z * len };
  const rim = (angle: number): Point3Dto => ({
    x: anchor.x + (u.x * Math.cos(angle) + v.x * Math.sin(angle)) * baseRadius,
    y: anchor.y + (u.y * Math.cos(angle) + v.y * Math.sin(angle)) * baseRadius,
    z: anchor.z + (u.z * Math.cos(angle) + v.z * Math.sin(angle)) * baseRadius,
  });
  for (let index = 0; index < sides; index += 1) {
    const p0 = rim((index / sides) * Math.PI * 2);
    const p1 = rim(((index + 1) / sides) * Math.PI * 2);
    // Side face (apex fan) and the base cap facing away from the apex.
    positions.push(apex.x, apex.y, apex.z, p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
    positions.push(anchor.x, anchor.y, anchor.z, p1.x, p1.y, p1.z, p0.x, p0.y, p0.z);
  }
}

/** The selected operation's motion commands, in program order. Duplicated
 *  work offsets repeat identical setup-space motions, so the first copy is
 *  enough for display. */
function selectedSectionCommands(
  program: CamProgramDto,
  setup: CamSetupDto,
  operationId: number,
): CamCommandDto[] {
  if (program.setup_id !== setup.id) return [];
  if (!setup.operations.some((operation) => operation.id === operationId)) return [];
  const sectionCommands: CamCommandDto[] = [];
  let inSection = false;
  for (const command of program.commands) {
    if (command.kind === 'section_start') {
      inSection = command.operation_id === operationId;
      continue;
    }
    if (command.kind === 'section_end') {
      inSection = false;
      continue;
    }
    if (inSection) sectionCommands.push(command);
  }
  return sectionCommands;
}

/** The selected operation's motion segments, transformed to model space. */
function pushSelectedToolpath(
  layers: CamOverlayLayers,
  state: CamOverlayState,
  setup: CamSetupDto,
) {
  const operationId = state.selectedCamOperationId;
  const program = state.camProgram;
  if (operationId === null || !program) return;
  const sectionCommands = selectedSectionCommands(program, setup, operationId);
  if (sectionCommands.length === 0) return;

  const rapid: number[] = [];
  const cutting: number[] = [];
  for (const segment of buildToolpathSegments(sectionCommands)) {
    const from = setupPointToModel(segment.from, setup.wcs);
    const to = setupPointToModel(segment.to, setup.wcs);
    (segment.rapid ? rapid : cutting).push(from.x, from.y, from.z, to.x, to.y, to.z);
  }
  // Width >= 2 routes to the viewport's highlight gizmo group, which draws
  // through model and stock geometry — toolpaths must stay readable even
  // where the remaining stock surrounds the cut.
  if (rapid.length > 0) {
    layers.lines.push({ color: RAPID_LINE, width: 2, pattern: 'dotted', segments: rapid });
  }
  if (cutting.length > 0) {
    layers.lines.push({ color: CUT_LINE, width: 2, pattern: 'solid', segments: cutting });
  }
}

/** Static display of the selected operation's tool and its feed endpoints:
 *  the tool ghost parks at the START position (the first approach target,
 *  above the entry point — the XY offset from the stock boundary still reads
 *  as one radius plus facing's safe distance), and green/red cones mark
 *  where the cutting feed starts and leaves, oriented along the cut. */
function pushSelectedTool(
  layers: CamOverlayLayers,
  state: CamOverlayState,
  setup: CamSetupDto,
) {
  const operationId = state.selectedCamOperationId;
  const program = state.camProgram;
  if (operationId === null || !program) return;
  const operation = setup.operations.find((candidate) => candidate.id === operationId);
  if (!operation) return;
  const tool = state.camDocument.tools.find((entry) => entry.id === operation.tool_id);
  if (!tool) return;
  const sectionCommands = selectedSectionCommands(program, setup, operationId);
  if (sectionCommands.length === 0) return;

  // Start position: the first motion target of the section (the approach
  // rapid parks the tool above the entry point at clearance/retract height).
  let startTip: Point3Dto | null = null;
  for (const command of sectionCommands) {
    if (command.kind === 'rapid' || command.kind === 'linear' || command.kind === 'circular') {
      startTip = command.to;
      break;
    }
  }

  const toModel = (point: Point3Dto) => setupPointToModel(point, setup.wcs);
  if (startTip) {
    const ring = regularRing(startTip.x, startTip.y, tool.diameter / 2, CYLINDER_SEGMENTS, 0);
    const flutePositions: number[] = [];
    pushPrism(toModel, ring, startTip.z, startTip.z + tool.flute_length, flutePositions, []);
    if (flutePositions.length > 0) {
      layers.triangles.push({ color: TOOL_FLUTE_FILL, positions: flutePositions, xray: false });
    }
    const shankPositions: number[] = [];
    pushPrism(toModel, ring, startTip.z + tool.flute_length, startTip.z + tool.overall_length, shankPositions, []);
    if (shankPositions.length > 0) {
      layers.triangles.push({ color: TOOL_SHANK_FILL, positions: shankPositions, xray: false });
    }
  }

  interface FeedMove {
    from: Point3Dto;
    to: Point3Dto;
    /** Unit tangent at the move's start / end. */
    startDir: Point3Dto;
    endDir: Point3Dto;
    length: number;
  }
  const feedMoves: FeedMove[] = [];
  let feedPosition: Point3Dto | null = null;
  for (const command of sectionCommands) {
    if (command.kind === 'rapid' || command.kind === 'linear') {
      if (command.kind === 'linear' && feedPosition) {
        const dx = command.to.x - feedPosition.x;
        const dy = command.to.y - feedPosition.y;
        const dz = command.to.z - feedPosition.z;
        const length = Math.hypot(dx, dy, dz);
        if (length > 1e-9) {
          const dir = { x: dx / length, y: dy / length, z: dz / length };
          feedMoves.push({ from: feedPosition, to: command.to, startDir: dir, endDir: dir, length });
        }
      }
      feedPosition = command.to;
      continue;
    }
    if (command.kind === 'circular') {
      if (feedPosition) {
        const startAngle = Math.atan2(
          feedPosition.y - command.center.y,
          feedPosition.x - command.center.x,
        );
        const endAngle = Math.atan2(command.to.y - command.center.y, command.to.x - command.center.x);
        let sweep = endAngle - startAngle;
        if (command.clockwise) {
          while (sweep >= 0) sweep -= Math.PI * 2;
        } else {
          while (sweep <= 0) sweep += Math.PI * 2;
        }
        const radius = Math.hypot(feedPosition.x - command.center.x, feedPosition.y - command.center.y);
        const arc = Math.abs(sweep) * radius;
        const dz = command.to.z - feedPosition.z;
        const length = Math.hypot(arc, dz);
        if (length > 1e-9 && radius > 1e-9) {
          // Circle tangent: the radial direction rotated ±90 degrees (CCW
          // motion: (-sin, cos); CW: (sin, -cos)), scaled to the move's
          // horizontal length; the helical Z rise rides along.
          const tangentScale = arc / length;
          const handedness = command.clockwise ? -1 : 1;
          const tangent = (angle: number): Point3Dto => ({
            x: -Math.sin(angle) * handedness * tangentScale,
            y: Math.cos(angle) * handedness * tangentScale,
            z: dz / length,
          });
          feedMoves.push({
            from: feedPosition,
            to: command.to,
            startDir: tangent(startAngle),
            endDir: tangent(endAngle),
            length,
          });
        }
      }
      feedPosition = command.to;
    }
  }

  // Entry/exit direction markers — the ironclad display rule for EVERY
  // operation kind: identical pure cones, one planted at the very start of
  // the first feed (cutting) move pointing along the cut, one marking where
  // the tool leaves the work. Rapids never carry markers of their own, but
  // the exit cone parks at the last actual motion endpoint on the operation's
  // configured retract plane. That covers rapid retraction after milling or
  // drilling and feed retraction after tapping/reaming without mistaking the
  // later clearance move for the operation exit. Arc tangents are exact
  // (from the circle geometry, not display chords). Cone size follows the
  // MODEL extent alone — a fixed short marker that grows and shrinks with the
  // part — so every operation on the same model carries identically sized
  // cones; host-move length never scales them.
  const firstFeed = feedMoves[0];
  const lastFeed = feedMoves[feedMoves.length - 1];
  let exitAnchor = lastFeed?.to ?? null;
  let exitDir = lastFeed?.endDir ?? null;
  if (lastFeed) {
    let lastFeedCommandIndex = -1;
    for (let index = sectionCommands.length - 1; index >= 0; index -= 1) {
      const command = sectionCommands[index];
      if (command.kind === 'linear' || command.kind === 'circular') {
        lastFeedCommandIndex = index;
        break;
      }
    }
    for (let index = sectionCommands.length - 1; index >= lastFeedCommandIndex; index -= 1) {
      const command = sectionCommands[index];
      if (
        (command.kind === 'rapid' || command.kind === 'linear' || command.kind === 'circular')
        && Math.abs(command.to.z - operation.retract_z) <= 1e-9
      ) {
        exitAnchor = command.to;
        exitDir = { x: 0, y: 0, z: 1 };
        break;
      }
    }
  }
  const modelBounds = modelBoundsOfBodies(state.solidScene, setup.body_ids);
  const modelExtent = modelBounds
    ? Math.max(
        modelBounds.max.x - modelBounds.min.x,
        modelBounds.max.y - modelBounds.min.y,
        modelBounds.max.z - modelBounds.min.z,
        1,
      )
    : 100;
  const coneLength = clamp(modelExtent * 0.025, 1, 12);
  const pushEndpointCone = (anchor: Point3Dto, dir: Point3Dto, color: Rgba) => {
    if (coneLength <= 1e-9) return;
    const start = toModel(anchor);
    const tip = toModel({
      x: anchor.x + dir.x * coneLength,
      y: anchor.y + dir.y * coneLength,
      z: anchor.z + dir.z * coneLength,
    });
    const axis = { x: tip.x - start.x, y: tip.y - start.y, z: tip.z - start.z };
    const axisLength = Math.hypot(axis.x, axis.y, axis.z);
    if (axisLength <= 1e-9) return;
    const positions: number[] = [];
    pushCone(
      positions,
      start,
      { x: axis.x / axisLength, y: axis.y / axisLength, z: axis.z / axisLength },
      axisLength,
    );
    layers.triangles.push({ color, positions, xray: true });
  };
  if (firstFeed) pushEndpointCone(firstFeed.from, firstFeed.startDir, ENTRY_ARROW);
  if (exitAnchor && exitDir) pushEndpointCone(exitAnchor, exitDir, EXIT_ARROW);
}

/** Remaining-stock estimate from the voxel simulator, in machinist green,
 *  plus rapid-collision markers. Meshes are transformed once per simulation
 *  result and cached by object identity. */
function pushSimulationStock(
  layers: CamOverlayLayers,
  state: CamOverlayState,
  setup: CamSetupDto,
  markerRadius: number,
) {
  const simulation = state.camSimulation;
  if (!simulation || simulation.setup_id !== setup.id) return;
  // Only the result truncated at the selected operation may paint: anything
  // else is stale (the selection moved on while the simulator was running).
  if (simulation.through_operation_id !== state.selectedCamOperationId) return;

  if (simulation.stock_mesh) {
    const layer = transformedStockMeshLayer(simulation);
    if (layer) layers.triangles.push(layer);
  }
  if (simulation.collisions.length > 0) {
    const positions: number[] = [];
    for (const collision of simulation.collisions) {
      const point = setupPointToModel(collision.position, simulation.wcs);
      positions.push(point.x, point.y, point.z);
    }
    layers.points.push({ color: COLLISION_POINT, radius: markerRadius * 1.2, positions });
  }
}

let stockMeshCache: {
  source: CamSimulationResultDto;
  layer: NativeViewportTriangleLayer | null;
} | null = null;

function transformedStockMeshLayer(
  simulation: CamSimulationResultDto,
): NativeViewportTriangleLayer | null {
  if (stockMeshCache?.source === simulation) return stockMeshCache.layer;
  let layer: NativeViewportTriangleLayer | null = null;
  const mesh = simulation.stock_mesh;
  if (mesh) {
    const triangleCount = Math.floor(mesh.positions.length / 9);
    const stride = Math.max(1, Math.ceil(triangleCount / MAX_STOCK_TRIANGLES));
    const positions: number[] = [];
    for (let triangle = 0; triangle < triangleCount; triangle += stride) {
      for (let corner = 0; corner < 3; corner += 1) {
        const offset = triangle * 9 + corner * 3;
        const point = setupPointToModel(
          { x: mesh.positions[offset], y: mesh.positions[offset + 1], z: mesh.positions[offset + 2] },
          simulation.wcs,
        );
        positions.push(point.x, point.y, point.z);
      }
    }
    if (positions.length > 0) {
      layer = { color: REST_STOCK_FILL, positions, xray: false };
    }
  }
  stockMeshCache = { source: simulation, layer };
  return layer;
}

// --- Stock shape tessellation (setup space, transformed by the caller) ------

type ToModel = (point: Point3Dto) => Point3Dto;

function pushBox(
  toModel: ToModel,
  setup: CamSetupDto,
  fillPositions: number[] | null,
  edgePositions: number[],
) {
  // Corner index: x bit * 4 + y bit * 2 + z bit.
  const corners: Point3Dto[] = [];
  for (const x of [setup.stock.min.x, setup.stock.max.x]) {
    for (const y of [setup.stock.min.y, setup.stock.max.y]) {
      for (const z of [setup.stock.min.z, setup.stock.max.z]) {
        corners.push(toModel({ x, y, z }));
      }
    }
  }
  const quads = [
    [0, 2, 6, 4], // x min
    [1, 3, 7, 5], // x max
    [0, 1, 3, 2], // y min
    [4, 5, 7, 6], // y max
    [0, 1, 5, 4], // z min
    [2, 3, 7, 6], // z max
  ];
  if (fillPositions) {
    for (const [a, b, c, d] of quads) {
      pushTriangle(fillPositions, corners[a], corners[b], corners[c]);
      pushTriangle(fillPositions, corners[a], corners[c], corners[d]);
    }
  }
  const edges = [
    [0, 1], [2, 3], [4, 5], [6, 7], // x-direction edges
    [0, 2], [1, 3], [4, 6], [5, 7], // y-direction edges
    [0, 4], [1, 5], [2, 6], [3, 7], // z-direction edges
  ];
  for (const [a, b] of edges) {
    edgePositions.push(corners[a].x, corners[a].y, corners[a].z, corners[b].x, corners[b].y, corners[b].z);
  }
}

function pushPrism(
  toModel: ToModel,
  ring: Array<{ x: number; y: number }>,
  zMin: number,
  zMax: number,
  fillPositions: number[],
  edgePositions: number[],
) {
  const bottom = ring.map((point) => toModel({ x: point.x, y: point.y, z: zMin }));
  const top = ring.map((point) => toModel({ x: point.x, y: point.y, z: zMax }));
  const count = ring.length;
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    pushTriangle(fillPositions, bottom[index], bottom[next], top[next]);
    pushTriangle(fillPositions, bottom[index], top[next], top[index]);
    edgePositions.push(
      bottom[index].x, bottom[index].y, bottom[index].z,
      bottom[next].x, bottom[next].y, bottom[next].z,
      top[index].x, top[index].y, top[index].z,
      top[next].x, top[next].y, top[next].z,
      bottom[index].x, bottom[index].y, bottom[index].z,
      top[index].x, top[index].y, top[index].z,
    );
  }
  // Caps: fan from the first ring point; the outline is convex and regular.
  for (let index = 1; index + 1 < count; index += 1) {
    pushTriangle(fillPositions, bottom[0], bottom[index], bottom[index + 1]);
    pushTriangle(fillPositions, top[0], top[index], top[index + 1]);
  }
}

function regularRing(
  centerX: number,
  centerY: number,
  radius: number,
  sides: number,
  phase: number,
): Array<{ x: number; y: number }> {
  const ring: Array<{ x: number; y: number }> = [];
  for (let index = 0; index < sides; index += 1) {
    const angle = phase + (index * 2 * Math.PI) / sides;
    ring.push({ x: centerX + Math.cos(angle) * radius, y: centerY + Math.sin(angle) * radius });
  }
  return ring;
}

function pushTriangle(positions: number[], a: Point3Dto, b: Point3Dto, c: Point3Dto) {
  positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
