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
import type { CamHolePickSession, CamPointPickSession } from '../store/appStore';
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
  // emphasized. The face under the pointer is highlighted by the viewport's
  // own face-hover channel, so only the chosen set draws here.
  if (state.camHolePick && state.camHolePick.holes.length > 0) {
    const rest: number[] = [];
    const hovered: number[] = [];
    for (const hole of state.camHolePick.holes) {
      const target = hole.key === state.camHolePick.hoverKey ? hovered : rest;
      target.push(hole.modelPoint.x, hole.modelPoint.y, hole.modelPoint.z);
    }
    if (rest.length > 0) {
      layers.points.push({ color: HOLE_POINT, radius: markerRadius * 1.2, positions: rest });
    }
    if (hovered.length > 0) {
      layers.points.push({
        color: PICK_POINT_HOVER,
        radius: markerRadius * 1.6,
        positions: hovered,
      });
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

/** The selected operation's motion segments, transformed to model space. */
function pushSelectedToolpath(
  layers: CamOverlayLayers,
  state: CamOverlayState,
  setup: CamSetupDto,
) {
  const operationId = state.selectedCamOperationId;
  const program = state.camProgram;
  if (operationId === null || !program || program.setup_id !== setup.id) return;
  if (!setup.operations.some((operation) => operation.id === operationId)) return;

  // Keep only the selected operation's sections. Duplicated work offsets
  // repeat identical setup-space motions; drawing them again is harmless.
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

/** Ghost of the selected operation's tool parked at its last cutting
 *  position: the fluted section opaque enough to read, the shank fainter.
 *  The tool axis is parallel to setup Z (fixed-axis planning). */
function pushSelectedTool(
  layers: CamOverlayLayers,
  state: CamOverlayState,
  setup: CamSetupDto,
) {
  const operationId = state.selectedCamOperationId;
  const program = state.camProgram;
  if (operationId === null || !program || program.setup_id !== setup.id) return;
  const operation = setup.operations.find((candidate) => candidate.id === operationId);
  if (!operation) return;
  const tool = state.camDocument.tools.find((entry) => entry.id === operation.tool_id);
  if (!tool) return;

  // Walk the operation's sections; duplicated work offsets repeat identical
  // setup-space motion, so any copy's endpoint positions the ghost.
  let inSection = false;
  let cuttingTip: Point3Dto | null = null;
  let anyTip: Point3Dto | null = null;
  for (const command of program.commands) {
    if (command.kind === 'section_start') {
      inSection = command.operation_id === operationId;
      continue;
    }
    if (command.kind === 'section_end') {
      inSection = false;
      continue;
    }
    if (!inSection) continue;
    if (command.kind === 'rapid') anyTip = command.to;
    if (command.kind === 'linear' || command.kind === 'circular') {
      cuttingTip = command.to;
      anyTip = command.to;
    }
  }
  const tip = cuttingTip ?? anyTip;
  if (!tip) return;

  const toModel = (point: Point3Dto) => setupPointToModel(point, setup.wcs);
  const ring = regularRing(tip.x, tip.y, tool.diameter / 2, CYLINDER_SEGMENTS, 0);
  const flutePositions: number[] = [];
  pushPrism(toModel, ring, tip.z, tip.z + tool.flute_length, flutePositions, []);
  if (flutePositions.length > 0) {
    layers.triangles.push({ color: TOOL_FLUTE_FILL, positions: flutePositions, xray: false });
  }
  const shankPositions: number[] = [];
  pushPrism(toModel, ring, tip.z + tool.flute_length, tip.z + tool.overall_length, shankPositions, []);
  if (shankPositions.length > 0) {
    layers.triangles.push({ color: TOOL_SHANK_FILL, positions: shankPositions, xray: false });
  }
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
