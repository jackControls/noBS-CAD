/**
 * Native Bevy viewport interaction layer with noBS CAD navigation and the
 * sketch environment.
 *
 * - Z-up world (engine convention): ground grid on XY, camera.up = +Z.
 * - Theme-aware gradient background, adaptive two-level ground grid, world axes
 *   triad. Mouse mapping: left = select, middle = pan,
 *   Shift+middle / right = orbit, wheel = zoom. Free orbit everywhere,
 *   including inside an active sketch.
 * - Pick-plane mode: translucent origin-plane quads with hover highlight +
 *   name tag, synced with the browser tree; click enters the sketch.
 * - Sketch mode: 2D grid on the sketch plane, origin snap marker, entities,
 *   rubber-band
 *   preview with snap marker and inference glyphs, endpoint dragging,
 *   selection, and a live cursor mm readout.
 *
 * All sketch geometry/behavior comes from the engine (src/engine); this file
 * builds CPU interaction proxies and forwards pointer/camera intent to the
 * native viewport. All scene units are document units (millimeters by default).
 */
import { useEffect, useRef } from 'react';
import * as CAD from './cadInteraction';
import {
  ScreenPolyline,
  PolylineGeometry,
  ScreenLineMaterial,
  ScreenLineSegments,
  SegmentListGeometry,
  CadOrbitControls,
} from './cadInteraction';
import { useTranslation } from '../../i18n';
import { getEngine, EngineError, type Engine } from '../../engine';
import { pickDatumPlane, pickPlanarFace, pickPlane } from '../../engine/controller';
import type {
  DimensionDto,
  EntityDto,
  OriginPlane,
  PlaneBasis,
  PlaneRef,
  Point3Dto,
  ProfileLoopDto,
  ProfileRefDto,
  PreviewCurve,
  PreviewDto,
  SketchDto,
  SketchPointKindDto,
  SnapTarget,
  Vec2,
} from '../../engine/types';
import {
  useAppStore,
  type FinishedSketchPointPick,
  type SketchTool,
} from '../../store/appStore';
import { isStraightSolidEdge } from '../../solidEdgeEligibility';
import type { BrowserNode } from '../../types/document';
import {
  easeInOutCubic,
  type CameraSnapshot,
  type ViewportCameraApi,
} from './cameraApi';
import { computeDimGeometry, formatDimMeasurement } from './dimsRenderer';
import {
  adaptiveSketchGridStep,
  DEFAULT_SKETCH_GRID_STEP_MM,
  snapToGrid,
} from './gridScale';
import {
  angleOf,
  ccwSweep,
  circleSpec,
  circumcircle,
  rectCorner,
  rectCorners,
  slotCapsulePreview,
  tessellateArc,
  tessellateCircle,
  tessellateSpline,
  type ToolLocks,
} from './toolPreview';
import { DynamicInputOverlay } from './DynamicInputOverlay';
import { DimensionEditor } from './DimensionEditor';
import { NavBar } from './NavBar';
import { OrientationDial } from './OrientationDial';
import { SelectionReadout } from './SelectionReadout';
import {
  attachNativeViewport,
  nativeViewportIsActive,
  pickNativeViewport,
  syncNativeViewportCamera,
  syncNativeViewportPreview,
  type NativeViewportSnapKind,
  type NativeViewportTransient,
} from './nativeViewportBridge';
import { triangulateProfileRegion } from './profileTriangulation';

const HOME_POSITION = new CAD.Vector3(170, -170, 130);
const HOME_TARGET = new CAD.Vector3(0, 0, 0);
const WORLD_UP = new CAD.Vector3(0, 0, 1);
const AXIS_LENGTH = 120;
let preservedCameraSnapshot: CameraSnapshot | null = null;

/** Base geometry edge length; runtime scaling keeps planes viewport-relative. */
export const REFERENCE_PLANE_SIZE = 100;
/** Reference planes occupy this fraction of the shorter viewport dimension. */
export const REFERENCE_PLANE_SCREEN_FRACTION = 0.32;
export function referencePlaneHalfSizeForView(
  depth: number,
  verticalFovDegrees: number,
  viewportWidth: number,
  viewportHeight: number,
): number {
  const height = Math.max(1, viewportHeight);
  const worldPerPixel =
    (2 *
      Math.max(0.001, depth) *
      Math.tan(CAD.MathUtils.degToRad(verticalFovDegrees / 2))) /
    height;
  return (
    worldPerPixel *
    Math.max(1, Math.min(viewportWidth, viewportHeight)) *
    (REFERENCE_PLANE_SCREEN_FRACTION / 2)
  );
}
/** Half-height (mm) framed when snapping normal to a sketch plane. */
const SKETCH_FIT_HALF_EXTENT = 75;
/** Magnetic acquisition radius for valid modify-tool targets. */
const MODIFY_CAPTURE_PX = 14;
/** Screen-space forgiveness around visible origin-plane fills and outlines. */
const ORIGIN_PLANE_CAPTURE_PX = 8;
/** Maximum screen-space reach beyond a line endpoint for Point acquisition. */
const POINT_EXTENSION_REACH_PX = 96;
/** Reject near-tied extension candidates rather than constrain arbitrarily. */
const POINT_EXTENSION_AMBIGUITY_PX = 3;
const LINE_TARGET_KINDS: ReadonlySet<EntityDto['kind']> = new Set(['line']);
const CURVE_TARGET_KINDS: ReadonlySet<EntityDto['kind']> = new Set(['line', 'circle', 'arc']);
type SolidEdgePickMode = 'any' | 'refinable' | 'straight';
type BodyFeaturePickMode = 'body-multi' | 'body-single' | 'face-multi';

const COLOR_AXIS_Z = 0x4f9dde; // conventional Z-axis blue, not a brand color

function triangleBoundarySegments(positions: number[]): number[] {
  type BoundaryEdge = {
    count: number;
    a: [number, number, number];
    b: [number, number, number];
  };
  const edges = new Map<string, BoundaryEdge>();
  const pointKey = (point: [number, number, number]) =>
    point.map((value) => Math.round(value * 1e6)).join(',');
  const addEdge = (
    a: [number, number, number],
    b: [number, number, number],
  ) => {
    const aKey = pointKey(a);
    const bKey = pointKey(b);
    const key = aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
    const existing = edges.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      edges.set(key, { count: 1, a, b });
    }
  };
  for (let index = 0; index + 8 < positions.length; index += 9) {
    const a: [number, number, number] = [
      positions[index],
      positions[index + 1],
      positions[index + 2],
    ];
    const b: [number, number, number] = [
      positions[index + 3],
      positions[index + 4],
      positions[index + 5],
    ];
    const c: [number, number, number] = [
      positions[index + 6],
      positions[index + 7],
      positions[index + 8],
    ];
    addEdge(a, b);
    addEdge(b, c);
    addEdge(c, a);
  }
  return [...edges.values()]
    .filter((edge) => edge.count === 1)
    .flatMap((edge) => [...edge.a, ...edge.b]);
}

interface PickerPlane {
  plane: OriginPlane;
  mesh: CAD.Mesh<CAD.PlaneGeometry, CAD.MeshBasicMaterial>;
  border: CAD.LineSegments;
}

interface PickerDef {
  plane: OriginPlane;
  basis: PlaneBasis;
  color: number;
  labelKey: string;
}

const PICKER_PLANES: PickerDef[] = [
  {
    plane: 'xy',
    basis: { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], normal: [0, 0, 1] },
    color: COLOR_AXIS_Z,
    labelKey: 'sketch.planeXy',
  },
  {
    plane: 'xz',
    basis: { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 0, 1], normal: [0, -1, 0] },
    color: 0x58a65c,
    labelKey: 'sketch.planeXz',
  },
  {
    plane: 'yz',
    basis: { origin: [0, 0, 0], u: [0, 1, 0], v: [0, 0, 1], normal: [1, 0, 0] },
    color: 0xd64949,
    labelKey: 'sketch.planeYz',
  },
];

export function Viewport() {
  const containerRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<ViewportCameraApi | null>(null);
  const readoutRef = useRef<HTMLDivElement>(null);
  const chipsRef = useRef<HTMLDivElement>(null);
  const planeTagRef = useRef<HTMLDivElement>(null);
  const zoomRectRef = useRef<HTMLDivElement>(null);
  const pickingPlane = useAppStore((s) => s.mode === 'pickPlane');
  const constructionPlanePickTarget = useAppStore(
    (s) => s.constructionPlanePickTarget,
  );
  const commandSelectionPrompt = useAppStore((s) => {
    if (s.profilePicker) {
      const owner =
        s.profilePicker.owner === 'extrude'
          ? 'Extrude'
          : s.profilePicker.owner === 'revolve'
            ? 'Revolve'
            : s.profilePicker.owner === 'sweep'
              ? 'Sweep'
              : 'Loft';
      return `Select closed sketch profiles for ${owner}`;
    }
    if (s.curvePicker) return 'Select finished sketch curves in the viewport';
    if (s.revolveDialogFeature !== null) return 'Select a straight sketch line for the revolve axis';
    if (s.filletDialogFeature !== null) return 'Select model edges to fillet';
    if (s.chamferDialogFeature !== null) return 'Select model edges to chamfer';
    if (s.holeDialogFeature !== null) return 'Select a planar face, then visible sketch points for holes';
    if (s.bodyFeatureDialog?.kind === 'shell') return 'Select faces to remove for Shell';
    if (s.bodyFeatureDialog?.kind === 'split_body') return 'Select the body to split';
    if (s.bodyFeatureDialog) return 'Select the target and tool bodies in the viewport';
    return null;
  });
  const { t } = useTranslation();

  const selectionPrompt = pickingPlane
    ? t('sketch.pickPlanePrompt')
    : constructionPlanePickTarget === 'first_reference'
      ? 'Select the first planar face or reference plane (Esc to stop selecting)'
      : constructionPlanePickTarget === 'second_reference'
        ? 'Select the second parallel face or plane (Esc to stop selecting)'
        : constructionPlanePickTarget === 'axis_edge'
          ? 'Select a straight model edge for the plane axis (Esc to stop selecting)'
          : commandSelectionPrompt;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const detachNativeViewport = attachNativeViewport(container);
    // Keep WebView2-specific wheel workarounds out of the macOS gesture path.
    // WebView2 and Chromium retain "Windows" in their UA.
    const isWindowsPlatform = /Windows/i.test(navigator.userAgent);

    // DOM and Bevy consume the same theme tokens. Viewport is keyed by the
    // resolved theme in App, so switching theme reconstructs the interaction
    // presentation state without keeping stale dark/light colors.
    const themeStyle = window.getComputedStyle(window.document.documentElement);
    const cssThemeColor = (name: string, fallback: string) =>
      themeStyle.getPropertyValue(name).trim() || fallback;
    const interactionThemeColor = (name: string, fallback: string) =>
      new CAD.Color(cssThemeColor(name, fallback)).getHex();
    const CSS_ACCENT = cssThemeColor('--accent', '#7463d8');
    const CSS_INK = cssThemeColor('--ink', '#d7dce2');
    const CSS_MUTE = cssThemeColor('--mute', '#9aa0a8');
    const CSS_FINISH = cssThemeColor('--finish', '#58a65c');
    const CSS_DIMENSION = cssThemeColor('--dimgreen', '#aecb1e');
    const CSS_DIMENSION_SELECTED = cssThemeColor(
      '--cad-dimension-selected',
      '#c4b9ff',
    );
    const CSS_GRIP_FILL = cssThemeColor('--cad-grip-fill', '#ffffff');
    const COLOR_SKETCH = interactionThemeColor('--sketchline', '#5da9ff');
    const COLOR_DEFINED = interactionThemeColor('--cad-defined', '#e8e9ec');
    const COLOR_HOVER = interactionThemeColor('--cad-hover', '#ffd166');
    const COLOR_ACCENT = interactionThemeColor('--accent', '#7463d8');
    const COLOR_SELECTED = interactionThemeColor(
      '--cad-sketch-selected',
      '#c4b9ff',
    );
    const COLOR_PREVIEW = interactionThemeColor('--cad-preview', '#8fc4ff');
    const COLOR_FINISHED = interactionThemeColor('--cad-finished', '#4ac7ff');
    const COLOR_FINISHED_POINT = interactionThemeColor(
      '--cad-finished-point',
      '#ff9f43',
    );
    const COLOR_FINISHED_POINT_OUTLINE = interactionThemeColor(
      '--cad-finished-point-outline',
      '#15191f',
    );
    const COLOR_BODY = interactionThemeColor('--cad-body', '#8b9bac');
    const COLOR_BODY_SELECTED = interactionThemeColor('--cad-body-selected', '#69a9d4');
    const COLOR_BODY_TOOL = interactionThemeColor('--cad-body-tool', '#b58a43');

    const bodyBaseColor = (bodyId: number, appearances: ReturnType<typeof useAppStore.getState>['bodyAppearances']) => {
      const appearance = appearances.find((entry) => entry.body_id === bodyId);
      if (!appearance) return COLOR_BODY;
      const { r, g, b } = appearance.color;
      return (r << 16) | (g << 8) | b;
    };
    const COLOR_FACE_HOVER = interactionThemeColor('--cad-face-hover', '#9ed5f3');
    const COLOR_FACE_SELECTED = interactionThemeColor('--cad-face-selected', '#30aee8');
    const COLOR_EDGE = interactionThemeColor('--cad-edge', '#29333d');
    const COLOR_EDGE_HOVER = interactionThemeColor('--cad-edge-hover', '#58c7ff');
    const COLOR_EDGE_SELECTED = interactionThemeColor('--cad-edge-selected', '#ffc857');
    const COLOR_HOLE_POINT_SELECTED = interactionThemeColor(
      '--cad-hole-point-selected',
      '#ffd166',
    );
    const COLOR_GROUND_FINE = interactionThemeColor('--cad-ground-fine', '#3a3f47');
    const COLOR_GROUND_MAJOR = interactionThemeColor('--cad-ground-major', '#4d545f');
    const COLOR_SKETCH_GRID_FINE = interactionThemeColor('--cad-sketch-grid-fine', '#41474f');
    const COLOR_SKETCH_GRID_MAJOR = interactionThemeColor('--cad-sketch-grid-major', '#4d545f');
    const COLOR_HEMI_SKY = interactionThemeColor('--cad-hemi-sky', '#dce9f5');
    const COLOR_HEMI_GROUND = interactionThemeColor('--cad-hemi-ground', '#30343b');
    const COLOR_DIMENSION = interactionThemeColor('--dimgreen', '#aecb1e');
    const COLOR_DIMENSION_SELECTED = interactionThemeColor(
      '--cad-dimension-selected',
      '#c4b9ff',
    );

    let engine: Engine | null = null;
    void getEngine().then((e) => {
      engine = e;
      // E2E/debug handle (harmless): direct engine access for automation.
      (window as unknown as { __engine?: Engine }).__engine = e;
    });

    // --- Input surface / interaction scene / camera (Z-up world) ---
    // The canvas exists only to receive DOM pointer events and preserve the
    // established automation contract. It never requests a WebGL context.
    const surface = new CAD.ViewportInputSurface();
    surface.setPixelRatio(window.devicePixelRatio);
    container.appendChild(surface.domElement);
    surface.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

    const scene = new CAD.Scene();
    const camera = new CAD.PerspectiveCamera(45, 1, 0.1, 20000);
    const initialTarget = preservedCameraSnapshot
      ? new CAD.Vector3(...preservedCameraSnapshot.target)
      : HOME_TARGET.clone();
    camera.up.copy(
      preservedCameraSnapshot
        ? new CAD.Vector3(...preservedCameraSnapshot.up)
        : WORLD_UP,
    );
    camera.position.copy(
      preservedCameraSnapshot
        ? new CAD.Vector3(...preservedCameraSnapshot.position)
        : HOME_POSITION,
    );
    camera.lookAt(initialTarget);
    scene.add(new CAD.HemisphereLight(COLOR_HEMI_SKY, COLOR_HEMI_GROUND, 2.1));
    const keyLight = new CAD.DirectionalLight(0xffffff, 2.4);
    keyLight.position.set(150, -180, 240);
    scene.add(keyLight);

    // --- World axes triad (X red, Y green, Z blue up) ---
    const axes = new CAD.Group();
    const axis = (dir: CAD.Vector3, color: number) => {
      const geometry = new CAD.BufferGeometry().setFromPoints([new CAD.Vector3(), dir]);
      return new CAD.Line(geometry, new CAD.LineBasicMaterial({ color }));
    };
    axes.add(axis(new CAD.Vector3(AXIS_LENGTH, 0, 0), 0xd64949));
    axes.add(axis(new CAD.Vector3(0, AXIS_LENGTH, 0), 0x58a65c));
    axes.add(axis(new CAD.Vector3(0, 0, AXIS_LENGTH), COLOR_AXIS_Z));
    axes.position.z = 0.1; // above the grid to avoid z-fighting
    scene.add(axes);

    // --- Viewport mouse controls ---
    // Left = select (no camera action), middle = pan, Shift+middle = orbit,
    // right = orbit, wheel = zoom. The pointerdown listener is registered
    // BEFORE CadOrbitControls is constructed so the remapping is observed.
    let controlsRef: CadOrbitControls | null = null;
    // Bevy is event-driven, so the interaction controller should wake only
    // for input/state changes or an animation that is still settling.
    let wakeControllerFrame: () => void = () => undefined;
    const activeCameraPointerButtons = new Set<number>();
    const onNavPointerDown = (e: PointerEvent) => {
      if (e.button === 1 || e.button === 2) {
        activeCameraPointerButtons.add(e.button);
      }
      if (e.button === 1 && controlsRef) {
        // Assign on every press so a lost Shift-middle release can never leave
        // the next ordinary middle drag stuck in orbit mode.
        controlsRef.mouseButtons.MIDDLE = e.shiftKey
          ? CAD.MOUSE.ROTATE
          : CAD.MOUSE.PAN;
      }
      cancelCameraAnimation();
      wakeControllerFrame();
    };
    const onNavPointerUp = (e: PointerEvent) => {
      activeCameraPointerButtons.delete(e.button);
      if (e.button === 1 && controlsRef) {
        controlsRef.mouseButtons.MIDDLE = CAD.MOUSE.PAN;
      }
    };
    const cancelCapturedNavigation = () => {
      activeCameraPointerButtons.clear();
      controlsRef?.cancelInteraction();
      if (controlsRef) controlsRef.mouseButtons.MIDDLE = CAD.MOUSE.PAN;
    };
    surface.domElement.addEventListener('pointerdown', onNavPointerDown);
    window.addEventListener('pointerup', onNavPointerUp);
    window.addEventListener('pointercancel', cancelCapturedNavigation);
    window.addEventListener('blur', cancelCapturedNavigation);

    const controls = new CadOrbitControls(camera, surface.domElement);
    controlsRef = controls;
    controls.target.copy(initialTarget);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.mouseButtons = {
      LEFT: -1 as unknown as CAD.MOUSE, // disabled: left button is selection
      MIDDLE: CAD.MOUSE.PAN,
      RIGHT: CAD.MOUSE.ROTATE,
    };
    const onControlsChange = () => wakeControllerFrame();
    controls.addEventListener('change', onControlsChange);
    surface.domElement.addEventListener('wheel', cancelCameraAnimation, { passive: true });

    // --- Input device mapping (D11, owner) ---------------------------------
    //   ctrl+wheel  = trackpad PINCH → zoom   (macOS sets ctrlKey on pinch)
    //   Shift+wheel = ORBIT (trackpad two-finger swipe / mouse wheel)
    //   plain wheel = PAN on trackpad swipe, ZOOM on a mouse notch
    //
    // Browser reality (D11): trackpad swipes and mouse notches both arrive as
    // `wheel` events, so plain events are classified by heuristic. The rule:
    //   · deltaMode !== 0 (line/page units)            → mouse  → zoom
    //   · deltaX !== 0 (mice have no horizontal wheel) → trackpad → pan
    //   · non-integer or small (|deltaY| < 50) deltas  → trackpad → pan
    //   · a burst of ≥3 events with <120 ms gaps       → trackpad flick → pan
    //   · integer |deltaY| ≥ 100, isolated (>250 ms)   → mouse notch → zoom
    // A classification sticks for the rest of the gesture (>350 ms gap resets
    // it); a burst re-classifies a false "mouse" reading as trackpad. Known
    // limitation: the FIRST event of a fast trackpad flick can be a large
    // integer delta and may zoom once before the burst flips the gesture to
    // pan — a preferences toggle may replace the heuristic later (D11).
    type WheelGesture = 'mouse' | 'trackpad' | null;
    const TRACKPAD_PINCH_SENSITIVITY = 0.002;
    const TRACKPAD_PINCH_ZOOM_IN_MULTIPLIER = 2;
    let wheelGesture: WheelGesture = null;
    let wheelLastT = 0;
    let wheelCount = 0;
    const MAX_WHEEL_STEP_PX = 240;

    const isDiscreteHorizontalWheel = (e: WheelEvent) =>
      e.deltaY === 0 &&
      e.deltaX !== 0 &&
      !e.ctrlKey &&
      (e.deltaMode !== WheelEvent.DOM_DELTA_PIXEL ||
        (Number.isInteger(e.deltaX) && Math.abs(e.deltaX) >= 50));

    const classifyWheel = (e: WheelEvent): 'pan' | 'zoom' => {
      const now = performance.now();
      const gap = now - wheelLastT;
      wheelLastT = now;
      if (gap > 350) {
        wheelGesture = null;
        wheelCount = 0;
      }
      wheelCount += 1;
      if (e.deltaMode !== 0) {
        wheelGesture = 'mouse';
        return 'zoom';
      }
      if (wheelGesture === 'trackpad') return 'pan';
      if (wheelGesture === 'mouse') {
        if (wheelCount >= 3 && gap < 120) {
          wheelGesture = 'trackpad';
          return 'pan';
        }
        return 'zoom';
      }
      // Undecided: gather evidence from the event shape.
      if (
        e.deltaX !== 0 ||
        !Number.isInteger(e.deltaY) ||
        Math.abs(e.deltaY) < 50 ||
        (wheelCount >= 3 && gap < 120)
      ) {
        wheelGesture = 'trackpad';
        return 'pan';
      }
      if (Math.abs(e.deltaY) >= 100 && gap > 250) {
        wheelGesture = 'mouse';
        return 'zoom';
      }
      return 'pan'; // small isolated integer delta: treat as trackpad
    };

    const onWheelNav = (e: WheelEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation(); // CadOrbitControls never handles wheel
      // Logitech wheel-tilt is a discrete horizontal notch, not a CAD
      // navigation gesture. It must not interrupt a camera restore animation.
      if (isWindowsPlatform && isDiscreteHorizontalWheel(e)) return;
      const unit = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1;
      const boundedWheel = (value: number) =>
        Number.isFinite(value)
          ? CAD.MathUtils.clamp(value * unit, -MAX_WHEEL_STEP_PX, MAX_WHEEL_STEP_PX)
          : 0;
      const deltaX = boundedWheel(e.deltaX);
      const deltaY = boundedWheel(e.deltaY);
      if (deltaX === 0 && deltaY === 0) return;
      cancelCameraAnimation();
      wakeControllerFrame();
      if (e.shiftKey) {
        // Shift+swipe = orbit. Same macOS natural-scrolling inversion as
        // pan (owner 2026-07-19): wheel deltas run opposite to pointer
        // drags — negate so the scene rotates WITH the fingers. The modal
        // Orbit tools use raw pointer deltas (grab feel,
        // already correct).
        api.orbitBy(-deltaX * 0.6, -deltaY * 0.6); // damped
        return;
      }
      if (e.ctrlKey) {
        // Pinch zoom remains magnitude-proportional and smooth. Zoom-in is
        // intentionally twice as responsive as zoom-out (owner 2026-07-26).
        const sensitivity =
          TRACKPAD_PINCH_SENSITIVITY *
          (deltaY < 0 ? TRACKPAD_PINCH_ZOOM_IN_MULTIPLIER : 1);
        dollyBy(Math.exp(deltaY * sensitivity));
        return;
      }
      if (classifyWheel(e) === 'zoom') {
        dollyBy(Math.exp(deltaY * 0.002)); // notch down = zoom out
      } else {
        // macOS natural scrolling: wheel deltas run OPPOSITE to pointer
        // drags, so negate — content tracks the fingers like every other
        // Mac app (owner report 2026-07-19). The modal Pan tool calls
        // panBy with raw pointer deltas and keeps the grab feel as-is.
        panBy(-deltaX, -deltaY);
      }
    };
    surface.domElement.addEventListener('wheel', onWheelNav, {
      capture: true,
      passive: false,
    });

    // --- Camera animation (all view changes ease ~250-400 ms, D7) ---
    interface CamAnim {
      t0: number;
      dur: number;
      fromPos: CAD.Vector3;
      toPos: CAD.Vector3;
      fromTarget: CAD.Vector3;
      toTarget: CAD.Vector3;
      fromUp: CAD.Vector3;
      toUp: CAD.Vector3;
    }
    let camAnim: CamAnim | null = null;

    function animateCamera(
      toPos: CAD.Vector3,
      toTarget: CAD.Vector3,
      toUp: CAD.Vector3,
      dur = 300,
    ) {
      camAnim = {
        t0: performance.now(),
        dur,
        fromPos: camera.position.clone(),
        toPos,
        fromTarget: controls.target.clone(),
        toTarget,
        fromUp: camera.up.clone(),
        toUp: toUp.clone().normalize(),
      };
      controls.enabled = false;
      wakeControllerFrame();
    }

    function cancelCameraAnimation() {
      if (camAnim) {
        camAnim = null;
        controls.enabled = true;
      }
    }

    function stepCameraAnimation(now: number) {
      if (!camAnim) return;
      const k = easeInOutCubic(Math.min(1, (now - camAnim.t0) / camAnim.dur));
      camera.position.lerpVectors(camAnim.fromPos, camAnim.toPos, k);
      controls.target.lerpVectors(camAnim.fromTarget, camAnim.toTarget, k);
      camera.up.lerpVectors(camAnim.fromUp, camAnim.toUp, k).normalize();
      camera.lookAt(controls.target);
      if (k >= 1) cancelCameraAnimation();
    }

    // --- Ground grid (adaptive two-level, XY plane) ---
    let groundLevel = Number.NaN;
    let groundFine: CAD.GridHelper | null = null;
    let groundMajor: CAD.GridHelper | null = null;

    const styleGrid = (grid: CAD.GridHelper, opacity: number, z: number) => {
      const material = grid.material as CAD.LineBasicMaterial;
      material.transparent = true;
      material.opacity = opacity;
      material.depthWrite = false;
      grid.position.z = z;
    };

    const disposeObject = (obj: CAD.Object3D | null) => {
      if (!obj) return;
      scene.remove(obj);
      obj.traverse((child) => {
        if (child instanceof CAD.Mesh || child instanceof CAD.Line || child instanceof CAD.Points || child instanceof CAD.Sprite) {
          child.geometry?.dispose?.();
          const material = child.material as CAD.Material | CAD.Material[] | undefined;
          if (Array.isArray(material)) material.forEach((m) => m.dispose());
          else material?.dispose?.();
        }
      });
    };

    const rebuildGroundGrid = (level: number) => {
      disposeObject(groundFine);
      disposeObject(groundMajor);
      const fineSpacing = 10 ** (level + 1); // mm per fine cell
      const size = fineSpacing * 100;
      // GridHelper lies in XZ; rotate into the XY ground plane (Z-up).
      groundFine = new CAD.GridHelper(size, 100, COLOR_GROUND_MAJOR, COLOR_GROUND_FINE);
      groundMajor = new CAD.GridHelper(size, 10, COLOR_GROUND_MAJOR, COLOR_GROUND_MAJOR);
      groundFine.rotateX(Math.PI / 2);
      groundMajor.rotateX(Math.PI / 2);
      styleGrid(groundFine, 0.5 * groundFade, -0.02);
      styleGrid(groundMajor, 0.85 * groundFade, 0);
      scene.add(groundFine, groundMajor);
    };

    // --- Sketch grid (on the sketch plane, local XY). The minor spacing
    // follows a 1-2-5 engineering sequence and is shared with the engine's
    // snap step, down to one micrometer. ---
    const sketchGroup = new CAD.Group(); // oriented by the plane basis
    const sketchGridFine = new CAD.Group();
    const sketchGridMajor = new CAD.Group();
    sketchGroup.add(sketchGridFine, sketchGridMajor);
    sketchGroup.visible = false;
    scene.add(sketchGroup);
    let sketchGridStep = DEFAULT_SKETCH_GRID_STEP_MM;
    let renderedSketchGridStep = Number.NaN;
    let engineGridStepApplied = Number.NaN;
    let engineGridStepRequested = DEFAULT_SKETCH_GRID_STEP_MM;
    let engineGridStepSyncing = false;

    const syncEngineGridStep = () => {
      if (
        !engine ||
        engineGridStepSyncing ||
        engineGridStepApplied === engineGridStepRequested
      ) {
        return;
      }
      const requested = engineGridStepRequested;
      engineGridStepSyncing = true;
      void engine
        .setGridStep(requested)
        .then(() => {
          engineGridStepApplied = requested;
        })
        .catch(() => {
          // Do not retry every animation frame. A later zoom level or sketch
          // session transition will issue a fresh request.
          engineGridStepApplied = requested;
        })
        .finally(() => {
          engineGridStepSyncing = false;
          if (engineGridStepRequested !== requested) syncEngineGridStep();
        });
    };

    /** User-visible finished sketches remain legible through solid bodies. */
    const finishedGroup = new CAD.Group();
    scene.add(finishedGroup);
    /** Closed sketch regions exposed while a sketch-driven solid dialog is
     * open. These are real triangulated hit targets (including inner holes),
     * so feature selection is spatial rather than list-only. */
    const profileGroup = new CAD.Group();
    profileGroup.name = 'solid-profile-picker';
    scene.add(profileGroup);

    /** OCCT tessellation. Faces are separate pickable meshes so a ray hit
     * maps directly to a stable FaceId; edge DTOs render as topology lines. */
    const solidGroup = new CAD.Group();
    solidGroup.name = 'solid-bodies';
    scene.add(solidGroup);
    const solidBodyHighlightGroup = new CAD.Group();
    solidBodyHighlightGroup.name = 'solid-body-highlights';
    scene.add(solidBodyHighlightGroup);
    const solidFaceHighlightGroup = new CAD.Group();
    solidFaceHighlightGroup.name = 'solid-face-highlights';
    scene.add(solidFaceHighlightGroup);
    /** Constant-screen-width overlays make edge-tool feedback readable over
     * both bright and dark faces without changing the topology hit targets. */
    const solidEdgeHighlightGroup = new CAD.Group();
    solidEdgeHighlightGroup.name = 'solid-edge-highlights';
    scene.add(solidEdgeHighlightGroup);
    const datumGroup = new CAD.Group();
    datumGroup.name = 'construction-planes';
    scene.add(datumGroup);
    const lineMaterials = new Set<ScreenLineMaterial>();

    const clearGroup = (group: CAD.Group) => {
      for (const child of [...group.children]) {
        group.remove(child);
        child.traverse((c) => {
          if (c instanceof CAD.Mesh || c instanceof CAD.Line || c instanceof CAD.Points || c instanceof CAD.Sprite) {
            c.geometry?.dispose?.();
            const material = c.material as CAD.Material | CAD.Material[] | undefined;
            if (Array.isArray(material)) {
              material.forEach((item) => {
                lineMaterials.delete(item as ScreenLineMaterial);
                item.dispose();
              });
            } else if (material) {
              lineMaterials.delete(material as ScreenLineMaterial);
              material.dispose();
            }
          }
        });
      }
    };

    const buildGridLines = (spacing: number, cells: number, color: number, opacity: number) => {
      const half = (spacing * cells) / 2;
      const positions: number[] = [];
      for (let i = 0; i <= cells; i++) {
        const c = -half + i * spacing;
        positions.push(c, -half, 0, c, half, 0);
        positions.push(-half, c, 0, half, c, 0);
      }
      const geometry = new CAD.BufferGeometry();
      geometry.setAttribute('position', new CAD.Float32BufferAttribute(positions, 3));
      const material = new CAD.LineBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthWrite: false,
      });
      return new CAD.LineSegments(geometry, material);
    };

    const rebuildSketchGrid = (spacing: number) => {
      clearGroup(sketchGridFine);
      clearGroup(sketchGridMajor);
      sketchGridFine.add(
        buildGridLines(spacing, 160, COLOR_SKETCH_GRID_FINE, 0.5 * sketchFade),
      );
      sketchGridMajor.add(
        buildGridLines(spacing * 10, 24, COLOR_SKETCH_GRID_MAJOR, 0.9 * sketchFade),
      );
    };

    // --- Pick-plane quads ---
    const picker: PickerPlane[] = PICKER_PLANES.map((def) => {
      const group = new CAD.Group();
      const u = new CAD.Vector3(...def.basis.u);
      const v = new CAD.Vector3(...def.basis.v);
      const n = new CAD.Vector3(...def.basis.normal);
      const m = new CAD.Matrix4().makeBasis(u, v, n);
      group.quaternion.setFromRotationMatrix(m);
      group.position.set(...def.basis.origin);

      const mesh = new CAD.Mesh(
        new CAD.PlaneGeometry(REFERENCE_PLANE_SIZE, REFERENCE_PLANE_SIZE),
        new CAD.MeshBasicMaterial({
          color: def.color,
          transparent: true,
          opacity: 0.1,
          side: CAD.DoubleSide,
          depthWrite: false,
        }),
      );
      mesh.userData.plane = def.plane;
      const border = new CAD.LineSegments(
        new CAD.EdgesGeometry(mesh.geometry),
        new CAD.LineBasicMaterial({ color: def.color, transparent: true, opacity: 0.35 }),
      );
      group.add(mesh, border);
      group.visible = false;
      scene.add(group);
      return { plane: def.plane, mesh, border };
    });

    const setPickerVisible = (visible: boolean) => {
      for (const p of picker) {
        p.mesh.parent!.visible = visible;
      }
      // NOTE: never write to the store here — this runs inside the zustand
      // subscription, and a nested set() re-enters it (infinite recursion).
      if (!visible && planeTagRef.current) planeTagRef.current.style.display = 'none';
    };

    const referencePickerVisible = (
      state: ReturnType<typeof useAppStore.getState>,
    ) =>
      state.mode === 'pickPlane' ||
      state.constructionPlanePickTarget === 'first_reference' ||
      state.constructionPlanePickTarget === 'second_reference';

    setPickerVisible(referencePickerVisible(useAppStore.getState()));

    const highlightPickerPlane = (hovered: OriginPlane | null) => {
      for (const p of picker) {
        const isHovered = p.plane === hovered;
        p.mesh.material.opacity = isHovered ? 0.28 : 0.1;
        (p.border.material as CAD.LineBasicMaterial).opacity = isHovered ? 0.9 : 0.35;
      }
    };
    const highlightDatumPlane = (datumId: number | null, picking: boolean) => {
      datumGroup.traverse((object) => {
        if (!(object instanceof CAD.Mesh) || object.userData.datumPlaneId === undefined) {
          return;
        }
        const material = object.material as CAD.MeshBasicMaterial;
        material.opacity =
          object.userData.datumPlaneId === datumId ? 0.32 : picking ? 0.14 : 0.08;
      });
    };

    // --- Sketch scene: entities, glyphs, preview, markers ---
    const entityGroup = new CAD.Group();
    const glyphGroup = new CAD.Group();
    const previewGroup = new CAD.Group();
    sketchGroup.add(entityGroup, glyphGroup, previewGroup);

    /** Sprites kept at constant screen size; scaled per frame. */
    const scaledSprites: Array<{ sprite: CAD.Sprite; px: number }> = [];

    const glyphTextureCache = new Map<string, CAD.CanvasTexture>();
    const glyphTexture = (text: string): CAD.CanvasTexture => {
      const cached = glyphTextureCache.get(text);
      if (cached) return cached;
      const canvas = window.document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext('2d')!;
      if (text === 'fix') {
        // Padlock glyph for Fix constraints.
        ctx.strokeStyle = CSS_INK;
        ctx.lineWidth = 5;
        ctx.strokeRect(16, 30, 32, 24);
        ctx.beginPath();
        ctx.arc(32, 30, 11, Math.PI, 0);
        ctx.stroke();
      } else {
        ctx.font = '600 40px -apple-system, Segoe UI, Roboto, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = CSS_INK;
        ctx.fillText(text, 32, 34);
      }
      const texture = new CAD.CanvasTexture(canvas);
      glyphTextureCache.set(text, texture);
      return texture;
    };

    const markerTexture = (draw: (ctx: CanvasRenderingContext2D) => void) => {
      const canvas = window.document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      draw(canvas.getContext('2d')!);
      return new CAD.CanvasTexture(canvas);
    };

    // Snap marker: filled square with an accent border.
    const snapTexture = markerTexture((ctx) => {
      ctx.fillStyle = CSS_GRIP_FILL;
      ctx.fillRect(20, 20, 24, 24);
      ctx.strokeStyle = CSS_ACCENT;
      ctx.lineWidth = 5;
      ctx.strokeRect(20, 20, 24, 24);
    });
    // Midpoint snap marker: green outlined up-triangle.
    const midpointTexture = markerTexture((ctx) => {
      ctx.strokeStyle = CSS_FINISH;
      ctx.lineWidth = 5;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(32, 14);
      ctx.lineTo(50, 48);
      ctx.lineTo(14, 48);
      ctx.closePath();
      ctx.stroke();
    });
    // Origin marker: ring with crosshair.
    const originTexture = markerTexture((ctx) => {
      ctx.strokeStyle = CSS_MUTE;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(32, 32, 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(32, 10);
      ctx.lineTo(32, 54);
      ctx.moveTo(10, 32);
      ctx.lineTo(54, 32);
      ctx.stroke();
    });

    const makeSprite = (texture: CAD.Texture, px: number, renderOrder: number) => {
      const sprite = new CAD.Sprite(
        new CAD.SpriteMaterial({ map: texture, transparent: true, depthTest: false }),
      );
      sprite.renderOrder = renderOrder;
      scaledSprites.push({ sprite, px });
      return sprite;
    };

    const originMarker = makeSprite(originTexture, 18, 8);
    originMarker.position.set(0, 0, 0.15);
    sketchGroup.add(originMarker);

    const snapMarker = makeSprite(snapTexture, 15, 9);
    snapMarker.visible = false;
    sketchGroup.add(snapMarker);

    let snapMarkerKind: NativeViewportSnapKind = 'grid';
    const nativeSnapKind = (kind: SnapTarget['kind']): NativeViewportSnapKind =>
      kind === 'none' ? 'grid' : kind;
    const showSnapMarker = (
      point: Vec2,
      kind: NativeViewportSnapKind = 'grid',
    ) => {
      snapMarker.position.set(point.x, point.y, 0.18);
      snapMarker.material.map =
        kind === 'midpoint' || kind === 'reference_midpoint'
          ? midpointTexture
          : kind === 'origin'
            ? originTexture
            : snapTexture;
      snapMarkerKind = kind;
      snapMarker.visible = true;
    };
    const hideSnapMarker = () => {
      snapMarker.visible = false;
      snapMarkerKind = 'grid';
    };

    // Rubber-band preview line (constant screen width).
    const previewMaterial = new ScreenLineMaterial({
      color: COLOR_PREVIEW,
      linewidth: 1.75,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
    });
    const previewLine = new ScreenPolyline(new PolylineGeometry(), previewMaterial);
    previewLine.renderOrder = 6;
    previewLine.visible = false;
    lineMaterials.add(previewMaterial);
    previewGroup.add(previewLine);

    const transientStart = new CAD.Vector3();
    const transientEnd = new CAD.Vector3();
    const transientPosition = new CAD.Vector3();
    const profileRegionCache = new WeakMap<
      ProfileLoopDto,
      {
        holes: ProfileLoopDto[];
        region: ReturnType<typeof triangulateProfileRegion>;
      }
    >();
    const cachedProfileRegion = (
      outer: ProfileLoopDto,
      holes: ProfileLoopDto[],
    ) => {
      const cached = profileRegionCache.get(outer);
      if (
        cached
        && cached.holes.length === holes.length
        && cached.holes.every((hole, index) => hole === holes[index])
      ) {
        return cached.region;
      }
      const region = triangulateProfileRegion(
        outer.points,
        holes.map((hole) => hole.points),
      );
      profileRegionCache.set(outer, { holes, region });
      return region;
    };
    type ViewportState = ReturnType<typeof useAppStore.getState>;
    let cachedPicker: ViewportState['profilePicker'] | undefined;
    let cachedPickerHidden: ViewportState['hidden'] | undefined;
    let cachedPickerDocument: ViewportState['document'] | undefined;
    let cachedPickerTriangles: NativeViewportTransient['triangles'] = [];
    let cachedSolidPreview: ViewportState['solidCommandPreview'] | undefined;
    let cachedSolidScene: ViewportState['solidScene'] | undefined;
    let cachedSolidTriangles: NativeViewportTransient['triangles'] = [];
    let cachedSolidArrows: NativeViewportTransient['arrows'] = [];

    /**
     * Convert the CPU interaction scene into a small semantic payload for
     * Bevy. This deliberately excludes committed sketch curves and OCCT
     * tessellation; Rust already owns both. It includes only presentation
     * details that belong to an active command.
     */
    const collectNativeViewportTransient = (): NativeViewportTransient => {
      type Rgba = [number, number, number, number];
      type LineLayer = NativeViewportTransient['lines'][number];
      type PointLayer = NativeViewportTransient['points'][number];
      const lineLayers = new Map<string, LineLayer>();
      const pointLayers = new Map<string, PointLayer>();
      const triangles: NativeViewportTransient['triangles'] = [];
      const arrows: NativeViewportTransient['arrows'] = [];
      const annotations: NativeViewportTransient['annotations'] = [];
      const transientState = store.getState();

      const rgbaFor = (
        material: CAD.Material | null,
        fallback = COLOR_PREVIEW,
      ): Rgba => {
        const color = material?.color ?? new CAD.Color(fallback);
        return [color.r, color.g, color.b, material?.opacity ?? 1];
      };
      const materialFor = (object: CAD.Object3D): CAD.Material | null => {
        const candidate = (object as CAD.Object3D & {
          material?: CAD.Material | CAD.Material[];
        }).material;
        return Array.isArray(candidate) ? (candidate[0] ?? null) : (candidate ?? null);
      };
      const lineWidthFor = (material: CAD.Material | null) =>
        material instanceof ScreenLineMaterial ? material.linewidth : 1.25;
      const layerKey = (color: Rgba, width: number) =>
        `${color.map((value) => value.toFixed(4)).join(',')}|${width.toFixed(2)}`;
      const pointKey = (color: Rgba, radius: number) =>
        `${color.map((value) => value.toFixed(4)).join(',')}|${radius.toFixed(4)}`;
      const appendSegment = (
        color: Rgba,
        width: number,
        start: CAD.Vector3,
        end: CAD.Vector3,
      ) => {
        const key = layerKey(color, width);
        let layer = lineLayers.get(key);
        if (!layer) {
          layer = { color, width, segments: [] };
          lineLayers.set(key, layer);
        }
        layer.segments.push(start.x, start.y, start.z, end.x, end.y, end.z);
      };
      const appendPoint = (
        color: Rgba,
        radius: number,
        point: CAD.Vector3,
      ) => {
        const key = pointKey(color, radius);
        let layer = pointLayers.get(key);
        if (!layer) {
          layer = { color, radius, positions: [] };
          pointLayers.set(key, layer);
        }
        layer.positions.push(point.x, point.y, point.z);
      };
      const rgbaFromHex = (value: number, alpha: number): Rgba => {
        const color = new CAD.Color(value);
        return [color.r, color.g, color.b, alpha];
      };
      const pointOnBasis = (
        basis: PlaneBasis,
        point: Vec2,
        offset = 0,
      ): [number, number, number] => [
        basis.origin[0] + basis.u[0] * point.x + basis.v[0] * point.y
          + basis.normal[0] * offset,
        basis.origin[1] + basis.u[1] * point.x + basis.v[1] * point.y
          + basis.normal[1] * offset,
        basis.origin[2] + basis.u[2] * point.x + basis.v[2] * point.y
          + basis.normal[2] * offset,
      ];
      const appendAnnotation = (object: CAD.Object3D) => {
        const text = object.userData.nativeAnnotationText;
        if (typeof text !== 'string' || text.length === 0) return;
        const screenRect = surface.domElement.getBoundingClientRect();
        const projected = object
          .getWorldPosition(transientPosition)
          .clone()
          .project(camera);
        if (
          projected.z < -1 ||
          projected.z > 1 ||
          !Number.isFinite(projected.x) ||
          !Number.isFinite(projected.y)
        ) {
          return;
        }
        const colorValue =
          typeof object.userData.nativeAnnotationColor === 'number'
            ? object.userData.nativeAnnotationColor
            : COLOR_DIMENSION;
        const color = new CAD.Color(colorValue);
        annotations.push({
          screen: [
            ((projected.x + 1) * screenRect.width) / 2,
            ((1 - projected.y) * screenRect.height) / 2,
          ],
          color: [color.r, color.g, color.b, 1],
          text,
          kind:
            object.userData.nativeAnnotationKind === 'constraint'
              ? 'constraint'
              : 'dimension',
        });
      };
      const collectRoot = (
        root: CAD.Object3D,
        options: {
          lines?: boolean;
          points?: boolean;
          meshEdges?: boolean;
          annotations?: boolean;
          include?: (object: CAD.Object3D) => boolean;
        } = {},
      ) => {
        root.updateWorldMatrix(true, true);
        root.traverseVisible((object) => {
          if (options.include && !options.include(object)) return;
          if (options.annotations) appendAnnotation(object);

          const geometry = (object as CAD.Object3D & {
            geometry?: CAD.BufferGeometry;
          }).geometry;
          if (!geometry) return;
          const material = materialFor(object);

          if (options.points && object instanceof CAD.Points) {
            const positions = geometry.getAttribute('position');
            if (!positions) return;
            const colors = geometry.getAttribute('color');
            const pointMaterial = material as CAD.PointsMaterial | null;
            const radius = Math.max(
              0.08,
              worldPerPixel() * (pointMaterial?.size ?? 7) * 0.5,
            );
            for (let index = 0; index < positions.count; index += 1) {
              transientPosition
                .set(
                  positions.getX(index),
                  positions.getY(index),
                  positions.getZ(index),
                )
                .applyMatrix4(object.matrixWorld);
              const color: Rgba = colors
                ? [
                    colors.getX(index),
                    colors.getY(index),
                    colors.getZ(index),
                    material?.opacity ?? 1,
                  ]
                : rgbaFor(material);
              appendPoint(color, radius, transientPosition);
            }
            return;
          }

          if (!options.lines) return;
          const color = rgbaFor(material);
          const width = lineWidthFor(material);
          const starts = geometry.getAttribute('instanceStart');
          const ends = geometry.getAttribute('instanceEnd');
          if (starts && ends) {
            const count = Math.min(starts.count, ends.count);
            for (let index = 0; index < count; index += 1) {
              transientStart
                .set(starts.getX(index), starts.getY(index), starts.getZ(index))
                .applyMatrix4(object.matrixWorld);
              transientEnd
                .set(ends.getX(index), ends.getY(index), ends.getZ(index))
                .applyMatrix4(object.matrixWorld);
              appendSegment(color, width, transientStart, transientEnd);
            }
            return;
          }

          const positions = geometry.getAttribute('position');
          if (!positions) return;
          if (object instanceof CAD.LineSegments || object instanceof CAD.Line) {
            const step = object instanceof CAD.LineSegments ? 2 : 1;
            for (let index = 0; index + 1 < positions.count; index += step) {
              transientStart
                .set(
                  positions.getX(index),
                  positions.getY(index),
                  positions.getZ(index),
                )
                .applyMatrix4(object.matrixWorld);
              transientEnd
                .set(
                  positions.getX(index + 1),
                  positions.getY(index + 1),
                  positions.getZ(index + 1),
                )
                .applyMatrix4(object.matrixWorld);
              appendSegment(color, width, transientStart, transientEnd);
            }
            return;
          }
          if (options.meshEdges && object instanceof CAD.Mesh) {
            for (let index = 0; index + 2 < positions.count; index += 3) {
              const vertices = [0, 1, 2].map((offset) =>
                new CAD.Vector3(
                  positions.getX(index + offset),
                  positions.getY(index + offset),
                  positions.getZ(index + offset),
                ).applyMatrix4(object.matrixWorld),
              );
              appendSegment(color, width, vertices[0], vertices[1]);
              appendSegment(color, width, vertices[1], vertices[2]);
              appendSegment(color, width, vertices[2], vertices[0]);
            }
          }
        });
      };

      if (sketchGroup.visible) {
        collectRoot(previewGroup, {
          lines: true,
          points: true,
          meshEdges: true,
          annotations: true,
        });
        collectRoot(dimsGroup, {
          lines: true,
          meshEdges: true,
          annotations: true,
        });
        collectRoot(glyphGroup, { annotations: true });
        collectRoot(entityGroup, { points: true });
      }
      collectRoot(finishedGroup, {
        lines: true,
        points: true,
        include: (object) => object.userData.finishedSketchEmphasis === true,
      });

      // Profile fills are rebuilt from the exact serialized sketch basis, not
      // from the CPU pick proxy's transform matrix. That makes the pixels and
      // the eventual OCCT operation share one orientation contract on XY,
      // vertical, offset, and mid-planes.
      const picker = transientState.profilePicker;
      if (
        picker === cachedPicker
        && transientState.hidden === cachedPickerHidden
        && transientState.document === cachedPickerDocument
      ) {
        triangles.push(...cachedPickerTriangles);
      } else {
        const triangleStart = triangles.length;
        if (picker) {
          const hidden = hiddenSketchNames();
          for (const catalog of picker.catalog) {
            if (hidden.has(catalog.sketch_name)) continue;
            for (const outer of catalog.profiles.filter(
              (profile) => profile.nesting_depth % 2 === 0,
            )) {
              const holes = catalog.profiles.filter(
                (profile) =>
                  profile.nesting_depth % 2 === 1
                  && profile.parent_index === outer.index,
              );
              const region = cachedProfileRegion(outer, holes);
              if (!region) continue;
              const profileRef: ProfileRefDto = {
                sketch_name: catalog.sketch_name,
                profile_index: outer.index,
              };
              const selected = picker.selected.some((candidate) =>
                sameProfile(candidate, profileRef),
              );
              const hovered = sameProfile(picker.hovered, profileRef);
              // Bevy already draws lightweight candidate outlines. Upload a
              // translucent x-ray surface only for the profile the user is
              // actually hovering or has selected; filling every candidate can
              // create severe overdraw on sketch-heavy models.
              if (!selected && !hovered) continue;
              const fill = rgbaFromHex(
                selected
                  ? COLOR_EDGE_SELECTED
                  : hovered
                    ? COLOR_EDGE_HOVER
                    : COLOR_FINISHED,
                selected ? 0.32 : 0.24,
              );
              const positions: number[] = [];
              for (const vertexIndex of region.indices) {
                positions.push(
                  ...pointOnBasis(catalog.basis, region.vertices[vertexIndex]),
                );
              }
              triangles.push({ color: fill, positions, xray: true });
            }
          }
        }
        cachedPicker = picker;
        cachedPickerHidden = transientState.hidden;
        cachedPickerDocument = transientState.document;
        cachedPickerTriangles = triangles.slice(triangleStart);
      }

      // Debounced Extrude tool volume. This is presentation-only, but it is
      // generated from the same basis and signed offsets submitted to OCCT.
      const solidPreview = transientState.solidCommandPreview;
      const solidPreviewCached =
        solidPreview === cachedSolidPreview
        && (!solidPreview?.sourceFace || transientState.solidScene === cachedSolidScene);
      if (solidPreviewCached) {
        triangles.push(...cachedSolidTriangles);
        arrows.push(...cachedSolidArrows);
      } else {
        const triangleStart = triangles.length;
        const arrowStart = arrows.length;
        if (solidPreview?.kind === 'extrude') {
          const operationColor =
            solidPreview.operation === 'cut'
              ? 0xff6b5f
              : solidPreview.operation === 'join'
                ? 0x50c98b
                : solidPreview.operation === 'intersect'
                  ? 0xb18cff
                  : COLOR_PREVIEW;
          const surfaceColor = rgbaFromHex(operationColor, 0.20);
          const toolPositions: number[] = [];
          let faceSourceAnchor: [number, number, number] | null = null;
          if (solidPreview.sourceFace) {
            const body = transientState.solidScene.bodies.find(
              (candidate) => candidate.id === solidPreview.sourceFace?.body_id,
            );
            const face = body?.faces.find(
              (candidate) => candidate.id === solidPreview.sourceFace?.face_id,
            );
            if (body && face) {
              const positionAt = (index: number): [number, number, number] => [
                body.mesh.positions[index * 3],
                body.mesh.positions[index * 3 + 1],
                body.mesh.positions[index * 3 + 2],
              ];
              const offsetPoint = (
                point: [number, number, number],
                offset: number,
              ): [number, number, number] => [
                point[0] + solidPreview.basis.normal[0] * offset,
                point[1] + solidPreview.basis.normal[1] * offset,
                point[2] + solidPreview.basis.normal[2] * offset,
              ];
              const pointKey = (point: [number, number, number]) =>
                point.map((value) => Math.round(value * 1e7)).join(':');
              const boundary = new Map<
                string,
                {
                  a: [number, number, number];
                  b: [number, number, number];
                  count: number;
                }
              >();
              const anchor = [0, 0, 0] as [number, number, number];
              let anchorCount = 0;
              const faceIndices = body.mesh.indices.slice(
                face.first_index,
                face.first_index + face.index_count,
              );
              for (let index = 0; index + 2 < faceIndices.length; index += 3) {
                const points = [
                  positionAt(faceIndices[index]),
                  positionAt(faceIndices[index + 1]),
                  positionAt(faceIndices[index + 2]),
                ] as const;
                for (const point of points) {
                  anchor[0] += point[0];
                  anchor[1] += point[1];
                  anchor[2] += point[2];
                  anchorCount += 1;
                }
                const start = points.map((point) =>
                  offsetPoint(point, solidPreview.startOffset));
                const end = points.map((point) =>
                  offsetPoint(point, solidPreview.endOffset));
                toolPositions.push(
                  ...start[0], ...start[1], ...start[2],
                  ...end[2], ...end[1], ...end[0],
                );
                for (const [a, b] of [
                  [points[0], points[1]],
                  [points[1], points[2]],
                  [points[2], points[0]],
                ] as const) {
                  const aKey = pointKey(a);
                  const bKey = pointKey(b);
                  const key = aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
                  const existing = boundary.get(key);
                  if (existing) existing.count += 1;
                  else boundary.set(key, { a: [...a], b: [...b], count: 1 });
                }
              }
              for (const edge of boundary.values()) {
                if (edge.count !== 1) continue;
                const aStart = offsetPoint(edge.a, solidPreview.startOffset);
                const bStart = offsetPoint(edge.b, solidPreview.startOffset);
                const aEnd = offsetPoint(edge.a, solidPreview.endOffset);
                const bEnd = offsetPoint(edge.b, solidPreview.endOffset);
                toolPositions.push(
                  ...aStart, ...bStart, ...bEnd,
                  ...aStart, ...bEnd, ...aEnd,
                );
              }
              if (anchorCount > 0) {
                faceSourceAnchor = [
                  anchor[0] / anchorCount,
                  anchor[1] / anchorCount,
                  anchor[2] / anchorCount,
                ];
              }
            }
          }
          const selectedOuters = solidPreview.profiles.filter(
            (profile) =>
              profile.nesting_depth % 2 === 0
              && solidPreview.selectedProfileIndices.includes(profile.index),
          );
          for (const outer of selectedOuters) {
            const holes = solidPreview.profiles.filter(
              (profile) =>
                profile.nesting_depth % 2 === 1
                && profile.parent_index === outer.index,
            );
            const region = cachedProfileRegion(outer, holes);
            if (!region) continue;

            for (let index = 0; index + 2 < region.indices.length; index += 3) {
              const a = region.vertices[region.indices[index]];
              const b = region.vertices[region.indices[index + 1]];
              const c = region.vertices[region.indices[index + 2]];
              toolPositions.push(
                ...pointOnBasis(solidPreview.basis, a, solidPreview.startOffset),
                ...pointOnBasis(solidPreview.basis, b, solidPreview.startOffset),
                ...pointOnBasis(solidPreview.basis, c, solidPreview.startOffset),
                ...pointOnBasis(solidPreview.basis, c, solidPreview.endOffset),
                ...pointOnBasis(solidPreview.basis, b, solidPreview.endOffset),
                ...pointOnBasis(solidPreview.basis, a, solidPreview.endOffset),
              );
            }

            for (const loop of region.loops) {
              for (let index = 0; index < loop.length; index += 1) {
                const a = loop[index];
                const b = loop[(index + 1) % loop.length];
                const aStart = pointOnBasis(
                  solidPreview.basis,
                  a,
                  solidPreview.startOffset,
                );
                const bStart = pointOnBasis(
                  solidPreview.basis,
                  b,
                  solidPreview.startOffset,
                );
                const aEnd = pointOnBasis(
                  solidPreview.basis,
                  a,
                  solidPreview.endOffset,
                );
                const bEnd = pointOnBasis(
                  solidPreview.basis,
                  b,
                  solidPreview.endOffset,
                );
                toolPositions.push(
                  ...aStart,
                  ...bStart,
                  ...bEnd,
                  ...aStart,
                  ...bEnd,
                  ...aEnd,
                );
              }
            }
          }
          if (toolPositions.length >= 9) {
            triangles.push({
              color: surfaceColor,
              positions: toolPositions,
              xray: true,
            });
          }

          const anchorPoints = selectedOuters.flatMap((profile) => profile.points);
          if (faceSourceAnchor) {
            arrows.push({
              start: faceSourceAnchor,
              end: [
                faceSourceAnchor[0]
                  + solidPreview.basis.normal[0] * solidPreview.directionOffset,
                faceSourceAnchor[1]
                  + solidPreview.basis.normal[1] * solidPreview.directionOffset,
                faceSourceAnchor[2]
                  + solidPreview.basis.normal[2] * solidPreview.directionOffset,
              ],
              color: rgbaFromHex(COLOR_PREVIEW, 1),
              width: 2,
              xray: true,
            });
          } else if (anchorPoints.length > 0) {
            const anchor2d = anchorPoints.reduce(
              (sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }),
              { x: 0, y: 0 },
            );
            anchor2d.x /= anchorPoints.length;
            anchor2d.y /= anchorPoints.length;
            arrows.push({
              start: pointOnBasis(solidPreview.basis, anchor2d),
              end: pointOnBasis(
                solidPreview.basis,
                anchor2d,
                solidPreview.directionOffset,
              ),
              color: rgbaFromHex(COLOR_PREVIEW, 1),
              width: 2,
              xray: true,
            });
          }
        }
        cachedSolidPreview = solidPreview;
        cachedSolidScene = transientState.solidScene;
        cachedSolidTriangles = triangles.slice(triangleStart);
        cachedSolidArrows = arrows.slice(arrowStart);
      }

      let marker: NativeViewportTransient['marker'] = null;
      if (sketchGroup.visible && snapMarker.visible) {
        snapMarker.getWorldPosition(transientPosition);
        marker = {
          position: [transientPosition.x, transientPosition.y, transientPosition.z],
          kind: snapMarkerKind,
        };
      }
      return {
        lines: [...lineLayers.values()],
        points: [...pointLayers.values()],
        triangles,
        arrows,
        annotations,
        marker,
      };
    };

    const addScreenLine = (
      group: CAD.Group,
      a: Vec2,
      b: Vec2,
      color: number,
      linewidth: number,
    ) => {
      const geometry = new PolylineGeometry();
      geometry.setPositions([a.x, a.y, 0.05, b.x, b.y, 0.05]);
      const material = new ScreenLineMaterial({ color, linewidth, depthTest: false });
      material.resolution.set(surface.domElement.clientWidth, surface.domElement.clientHeight);
      lineMaterials.add(material);
      const line = new ScreenPolyline(geometry, material);
      line.renderOrder = 4;
      group.add(line);
    };

    /** Screen-width polyline (tessellated circles/arcs, rectangle previews). */
    const addScreenPolyline = (
      group: CAD.Group,
      positions: number[],
      color: number,
      linewidth: number,
      renderOrder = 4,
      depthTest = false,
      opacity = 1,
    ) => {
      const geometry = new PolylineGeometry();
      geometry.setPositions(positions);
      const material = new ScreenLineMaterial({
        color,
        linewidth,
        transparent: opacity < 1,
        opacity,
        depthTest,
        depthWrite: depthTest && opacity >= 1,
      });
      material.resolution.set(surface.domElement.clientWidth, surface.domElement.clientHeight);
      lineMaterials.add(material);
      const line = new ScreenPolyline(geometry, material);
      line.renderOrder = renderOrder;
      group.add(line);
      return line;
    };

    /** Independent constant-screen-width segments, used for derived face
     * perimeters and whole-body topology silhouettes. */
    const addScreenSegments = (
      group: CAD.Group,
      positions: number[],
      color: number,
      linewidth: number,
      renderOrder: number,
      depthTest: boolean,
      opacity = 1,
    ) => {
      const geometry = new SegmentListGeometry();
      geometry.setPositions(positions);
      const material = new ScreenLineMaterial({
        color,
        linewidth,
        transparent: opacity < 1,
        opacity,
        depthTest,
        depthWrite: depthTest && opacity >= 1,
      });
      material.resolution.set(
        surface.domElement.clientWidth,
        surface.domElement.clientHeight,
      );
      lineMaterials.add(material);
      const lines = new ScreenLineSegments(geometry, material);
      lines.renderOrder = renderOrder;
      group.add(lines);
      return lines;
    };

    const rebuildEntities = (sketch: SketchDto) => {
      clearGroup(entityGroup);
      clearGroup(glyphGroup);
      // Drop per-entity sprite registrations (origin/snap markers persist).
      scaledSprites.length = 2;
      const { selectedEntity, selectedEntities, hoveredEntity, palette } = store.getState();
      const selectedSet = new Set(selectedEntities);
      if (selectedEntity !== null) selectedSet.add(selectedEntity);
      const showGrips = palette.points; // Palette "Points" visibility toggle

      const colorOf = (id: number, fullyDefined: boolean) =>
        selectedSet.has(id)
          ? COLOR_SELECTED
          : id === hoveredEntity
            ? COLOR_HOVER
            : fullyDefined
              ? COLOR_DEFINED
              : COLOR_SKETCH;
      const emphasized = (id: number) =>
        selectedSet.has(id) || id === hoveredEntity;
      const lineWidthOf = (id: number) => (emphasized(id) ? 2 : 1.25);

      const lines = new Map<number, { start: Vec2; end: Vec2 }>();
      const gripPoints: Array<{ x: number; y: number; id: number; fd: boolean }> = [];
      for (const entity of sketch.entities) {
        const color = colorOf(entity.id, entity.fully_defined);
        switch (entity.kind) {
          case 'line':
            lines.set(entity.id, { start: entity.start, end: entity.end });
            addScreenLine(
              entityGroup,
              entity.start,
              entity.end,
              color,
              lineWidthOf(entity.id),
            );
            break;
          case 'point':
            gripPoints.push({ x: entity.position.x, y: entity.position.y, id: entity.id, fd: entity.fully_defined });
            break;
          case 'circle':
            addScreenPolyline(
              entityGroup,
              tessellateCircle(entity.center, entity.radius),
              color,
              lineWidthOf(entity.id),
            );
            gripPoints.push({ x: entity.center.x, y: entity.center.y, id: entity.id, fd: entity.fully_defined });
            break;
          case 'arc':
            addScreenPolyline(
              entityGroup,
              tessellateArc(entity.center, entity.radius, entity.start_angle, entity.end_angle),
              color,
              lineWidthOf(entity.id),
            );
            gripPoints.push({ x: entity.center.x, y: entity.center.y, id: entity.id, fd: entity.fully_defined });
            break;
          case 'spline': {
            const pts: number[] = [];
            for (const q of entity.tessellation) pts.push(q.x, q.y, 0.05);
            addScreenPolyline(entityGroup, pts, color, lineWidthOf(entity.id));
            for (const q of entity.points) {
              gripPoints.push({ x: q.x, y: q.y, id: entity.id, fd: entity.fully_defined });
            }
            break;
          }
        }
      }

      // Point + center grips use separate normal/emphasis layers so hovered
      // and selected points can grow without changing every marker.
      if (showGrips && gripPoints.length > 0) {
        const addGripLayer = (
          points: typeof gripPoints,
          size: number,
          renderOrder: number,
        ) => {
          if (points.length === 0) return;
          const positions: number[] = [];
          const colors: number[] = [];
          const c = new CAD.Color();
          for (const point of points) {
            positions.push(point.x, point.y, 0.1);
            c.setHex(colorOf(point.id, point.fd));
            colors.push(c.r, c.g, c.b);
          }
          const geometry = new CAD.BufferGeometry();
          geometry.setAttribute(
            'position',
            new CAD.Float32BufferAttribute(positions, 3),
          );
          geometry.setAttribute(
            'color',
            new CAD.Float32BufferAttribute(colors, 3),
          );
          const material = new CAD.PointsMaterial({
            size,
            sizeAttenuation: false,
            vertexColors: true,
            depthTest: false,
          });
          const grips = new CAD.Points(geometry, material);
          grips.renderOrder = renderOrder;
          entityGroup.add(grips);
        };
        addGripLayer(
          gripPoints.filter((point) => !emphasized(point.id)),
          7,
          5,
        );
        addGripLayer(
          gripPoints.filter((point) => emphasized(point.id)),
          10,
          6,
        );
      }

      // Constraint glyph marks (H/V next to lines, padlock on Fixed,
      // triangle at Midpoint) — hidden when the palette "Constraints"
      // toggle is off.
      if (!palette.constraints) return;
      for (const constraint of sketch.constraints) {
        if (constraint.type === 'midpoint') {
          // Green up-triangle at the host line's midpoint,
          // nudged off the line along its normal so endpoint grips and H/V
          // glyphs don't cover it.
          const line = constraint.b != null ? lines.get(constraint.b) : undefined;
          if (!line) continue;
          const mid = {
            x: (line.start.x + line.end.x) / 2,
            y: (line.start.y + line.end.y) / 2,
          };
          const dx = line.end.x - line.start.x;
          const dy = line.end.y - line.start.y;
          const len = Math.hypot(dx, dy) || 1;
          const sprite = makeSprite(midpointTexture, 13, 7);
          sprite.position.set(mid.x + (-dy / len) * 6, mid.y + (dx / len) * 6, 0.2);
          sprite.userData.nativeAnnotationText = '△';
          sprite.userData.nativeAnnotationKind = 'constraint';
          sprite.userData.nativeAnnotationColor = new CAD.Color(CSS_FINISH).getHex();
          glyphGroup.add(sprite);
          continue;
        }
        if (constraint.entity == null) continue;
        if (constraint.type === 'horizontal' || constraint.type === 'vertical') {
          const line = lines.get(constraint.entity);
          if (!line) continue;
          const mid = {
            x: (line.start.x + line.end.x) / 2,
            y: (line.start.y + line.end.y) / 2,
          };
          // H below the line, V to its right.
          const [x, y] =
            constraint.type === 'horizontal' ? [mid.x, mid.y - 7] : [mid.x + 7, mid.y];
          const sprite = makeSprite(
            glyphTexture(constraint.type === 'horizontal' ? 'H' : 'V'),
            15,
            7,
          );
          sprite.position.set(x, y, 0.2);
          sprite.userData.nativeAnnotationText =
            constraint.type === 'horizontal' ? 'H' : 'V';
          sprite.userData.nativeAnnotationKind = 'constraint';
          sprite.userData.nativeAnnotationColor = new CAD.Color(CSS_INK).getHex();
          glyphGroup.add(sprite);
        } else if (constraint.type === 'fix') {
          const target = sketch.entities.find((e) => e.id === constraint.entity);
          if (!target) continue;
          const at =
            target.kind === 'point'
              ? target.position
              : target.kind === 'circle' || target.kind === 'arc'
                ? target.center
                : target.kind === 'spline'
                  ? (target.points[0] ?? { x: 0, y: 0 })
                  : { x: (target.start.x + target.end.x) / 2, y: (target.start.y + target.end.y) / 2 };
          const sprite = makeSprite(glyphTexture('fix'), 16, 7);
          sprite.position.set(at.x + 6, at.y + 6, 0.2);
          sprite.userData.nativeAnnotationText = '▣';
          sprite.userData.nativeAnnotationKind = 'constraint';
          sprite.userData.nativeAnnotationColor = new CAD.Color(CSS_INK).getHex();
          glyphGroup.add(sprite);
        }
      }
    };

    // --- Dimension annotations (D9, driven by the selected document style) ---
    const dimsGroup = new CAD.Group();
    sketchGroup.add(dimsGroup);

    /** Text sprites needing per-frame scale and optional alignment rotation. */
    const dimSprites: Array<{
      sprite: CAD.Sprite;
      px: number;
      dirLocal: CAD.Vector3 | null;
      aligned: boolean;
      dimId: number;
    }> = [];
    /** Arrowhead meshes needing per-frame constant-px scale. */
    const dimArrows: Array<{ mesh: CAD.Mesh; px: number }> = [];

    const dimTextCache = new Map<string, CAD.CanvasTexture>();
    const dimTextTexture = (text: string, selected: boolean): CAD.CanvasTexture => {
      const key = `${text}|${selected ? 1 : 0}`;
      const cached = dimTextCache.get(key);
      if (cached) return cached;
      const canvas = window.document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 64;
      const ctx = canvas.getContext('2d')!;
      ctx.font = '600 44px -apple-system, Segoe UI, Roboto, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = selected ? CSS_DIMENSION_SELECTED : CSS_DIMENSION;
      ctx.fillText(text, 128, 34);
      const texture = new CAD.CanvasTexture(canvas);
      dimTextCache.set(key, texture);
      return texture;
    };

    const makeArrow = (group: CAD.Group, angle: number, at: Vec2, z: number, green: number) => {
      const geometry = new CAD.BufferGeometry();
      geometry.setAttribute(
        'position',
        new CAD.Float32BufferAttribute([0, 0, 0, -1, 0.3, 0, -1, -0.3, 0], 3),
      );
      geometry.computeVertexNormals();
      const mesh = new CAD.Mesh(
        geometry,
        new CAD.MeshBasicMaterial({ color: green, side: CAD.DoubleSide, depthTest: false }),
      );
      mesh.renderOrder = 5;
      mesh.position.set(at.x, at.y, z);
      mesh.rotation.z = angle;
      dimArrows.push({ mesh, px: 9 });
      group.add(mesh);
    };

    const addDimText = (
      group: CAD.Group,
      dimLike: { constraint_id?: number; text: string },
      textPos: Vec2,
      dirLocal: CAD.Vector3 | null,
      opts: { selected: boolean; aligned: boolean; dimId: number },
    ) => {
      const sprite = new CAD.Sprite(
        new CAD.SpriteMaterial({
          map: dimTextTexture(dimLike.text, opts.selected),
          transparent: true,
          depthTest: false,
        }),
      );
      sprite.renderOrder = 9;
      sprite.position.set(textPos.x, textPos.y, 0.24);
      sprite.userData.nativeAnnotationText = dimLike.text;
      sprite.userData.nativeAnnotationKind = 'dimension';
      sprite.userData.nativeAnnotationColor = opts.selected
        ? COLOR_DIMENSION_SELECTED
        : COLOR_DIMENSION;
      dimSprites.push({
        sprite,
        px: 19,
        dirLocal,
        aligned: opts.aligned,
        dimId: opts.dimId,
      });
      group.add(sprite);
    };

    /** Render one dimension annotation into `group` (also used for the
     * tool's placement preview). */
    const renderDimAnnotation = (
      group: CAD.Group,
      dimLike: { kind: DimensionDto['kind']; entities: number[]; text: string; text_pos: Vec2; constraint_id?: number },
      byId: Map<number, EntityDto>,
      opts: { selected: boolean; aligned: boolean },
    ) => {
      const geom = computeDimGeometry(dimLike, byId);
      if (!geom) return;
      const green = opts.selected ? COLOR_DIMENSION_SELECTED : COLOR_DIMENSION;
      const z = 0.22;
      const dimId = dimLike.constraint_id ?? -1;
      switch (geom.shape) {
        case 'linear': {
          const { a, b, textPos } = geom;
          const d = { x: b.x - a.x, y: b.y - a.y };
          const len = Math.hypot(d.x, d.y);
          if (len < 1e-9) return;
          const u = { x: d.x / len, y: d.y / len };
          const n = { x: -u.y, y: u.x };
          let offset = (textPos.x - a.x) * n.x + (textPos.y - a.y) * n.y;
          if (Math.abs(offset) < 6) offset = offset >= 0 ? 6 : -6;
          const s = Math.sign(offset);
          const a2 = { x: a.x + n.x * offset, y: a.y + n.y * offset };
          const b2 = { x: b.x + n.x * offset, y: b.y + n.y * offset };
          addScreenPolyline(group, [a.x + n.x * s * 1.5, a.y + n.y * s * 1.5, z, a2.x + n.x * s * 2, a2.y + n.y * s * 2, z], green, 1.25);
          addScreenPolyline(group, [b.x + n.x * s * 1.5, b.y + n.y * s * 1.5, z, b2.x + n.x * s * 2, b2.y + n.y * s * 2, z], green, 1.25);
          addScreenPolyline(group, [a2.x, a2.y, z, b2.x, b2.y, z], green, 1.25);
          const fits = len >= 14;
          const uAng = Math.atan2(u.y, u.x);
          makeArrow(group, fits ? uAng : uAng + Math.PI, a2, z, green);
          makeArrow(group, fits ? uAng + Math.PI : uAng, b2, z, green);
          addDimText(group, dimLike, textPos, new CAD.Vector3(u.x, u.y, 0), {
            selected: opts.selected,
            aligned: opts.aligned,
            dimId,
          });
          break;
        }
        case 'diameter': {
          const { center, radius, textPos } = geom;
          const ud = { x: textPos.x - center.x, y: textPos.y - center.y };
          const ul = Math.hypot(ud.x, ud.y) || 1;
          const u = { x: ud.x / ul, y: ud.y / ul };
          const far = { x: center.x - u.x * (radius + 4), y: center.y - u.y * (radius + 4) };
          const near = { x: center.x + u.x * (ul + 4), y: center.y + u.y * (ul + 4) };
          addScreenPolyline(group, [far.x, far.y, z, near.x, near.y, z], green, 1.25);
          const uAng = Math.atan2(u.y, u.x);
          makeArrow(group, uAng + Math.PI, { x: center.x - u.x * radius, y: center.y - u.y * radius }, z, green);
          makeArrow(group, uAng, { x: center.x + u.x * radius, y: center.y + u.y * radius }, z, green);
          addDimText(group, dimLike, textPos, new CAD.Vector3(u.x, u.y, 0), {
            selected: opts.selected,
            aligned: opts.aligned,
            dimId,
          });
          break;
        }
        case 'radius': {
          const { center, radius, midAngle, textPos } = geom;
          const m = { x: center.x + radius * Math.cos(midAngle), y: center.y + radius * Math.sin(midAngle) };
          const uAng = midAngle;
          addScreenPolyline(group, [center.x, center.y, z, m.x, m.y, z], green, 1.25);
          makeArrow(group, uAng, m, z, green);
          addDimText(group, dimLike, textPos, new CAD.Vector3(Math.cos(uAng), Math.sin(uAng), 0), {
            selected: opts.selected,
            aligned: opts.aligned,
            dimId,
          });
          break;
        }
        case 'angular': {
          const { vertex, a1, a2, textPos } = geom;
          const rr = Math.min(25, Math.max(8, Math.hypot(textPos.x - vertex.x, textPos.y - vertex.y) - 6));
          addScreenPolyline(group, tessellateArc(vertex, rr, a1, a2, z), green, 1.25);
          makeArrow(group, a1 - Math.PI / 2, { x: vertex.x + rr * Math.cos(a1), y: vertex.y + rr * Math.sin(a1) }, z, green);
          makeArrow(group, a2 + Math.PI / 2, { x: vertex.x + rr * Math.cos(a2), y: vertex.y + rr * Math.sin(a2) }, z, green);
          const bis = a1 + ccwSweep(a1, a2) / 2;
          addDimText(group, dimLike, textPos, new CAD.Vector3(Math.cos(bis), Math.sin(bis), 0), {
            selected: opts.selected,
            aligned: opts.aligned,
            dimId,
          });
          break;
        }
      }
    };

    const rebuildDimensions = (sketch: SketchDto) => {
      clearGroup(dimsGroup);
      dimSprites.length = 0;
      dimArrows.length = 0;
      // Palette "Dimensions" toggle hides all annotations.
      if (!store.getState().palette.dimensions) return;
      const byId = new Map(sketch.entities.map((e) => [e.id, e]));
      const { selectedDimension } = store.getState();
      const aligned = sketch.dimension_style === 'aligned';
      for (const dim of sketch.dimensions) {
        renderDimAnnotation(dimsGroup, dim, byId, {
          selected: dim.constraint_id === selectedDimension,
          aligned,
        });
      }
    };

    /** Nearest dimension text within pixel tolerance (for select/drag/edit). */
    const pickDimension = (p: Vec2): number | null => {
      const sketch = store.getState().activeSketch;
      if (!sketch) return null;
      const tol = worldPerPixel() * 9;
      let best: { id: number; d: number } | null = null;
      for (const dim of sketch.dimensions) {
        const d = Math.hypot(dim.text_pos.x - p.x, dim.text_pos.y - p.y);
        if (d <= tol && (!best || d < best.d)) best = { id: dim.constraint_id, d };
      }
      return best?.id ?? null;
    };
    const setupSketchScene = (sketch: SketchDto) => {
      const { basis } = sketch;
      const u = new CAD.Vector3(...basis.u);
      const v = new CAD.Vector3(...basis.v);
      const n = new CAD.Vector3(...basis.normal);
      const m = new CAD.Matrix4().makeBasis(u, v, n);
      sketchGroup.quaternion.setFromRotationMatrix(m);
      sketchGroup.position.set(...basis.origin);
      sketchGroup.visible = true;
      renderedSketchGridStep = Number.NaN; // force grid rebuild
      engineGridStepApplied = Number.NaN; // new engine session needs the step
      rebuildEntities(sketch);
      rebuildDimensions(sketch);
    };

    const teardownSketchScene = () => {
      sketchGroup.visible = false;
      toolRun = null;
      dragging = null;
      dragSession += 1;
      pendingDragUpdate = null;
      dimDragging = null;
      dimPick = null;
      setPreviewPositions(null);
      hideSnapMarker();
      hideChips();
      clearGroup(dimPreviewGroup);
      store.getState().hideDynInput();
      store.getState().setSelectedDimension(null);
      store.getState().setDimEditor(null);
    };

    // --- Plane-normal fit view ---
    const lookAtPlane = (basis: PlaneBasis, dur: number) => {
      const n = new CAD.Vector3(...basis.normal);
      const o = new CAD.Vector3(...basis.origin);
      const up = new CAD.Vector3(...basis.v).normalize();
      const dist =
        SKETCH_FIT_HALF_EXTENT / Math.tan(CAD.MathUtils.degToRad(camera.fov / 2));
      animateCamera(o.clone().addScaledVector(n, dist), o, up, dur);
    };

    // --- Pointer helpers ---
    const raycaster = new CAD.Raycaster();
    const ndcFromEvent = (e: PointerEvent) => {
      const rect = surface.domElement.getBoundingClientRect();
      return new CAD.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
    };

    /** World mm covered by one screen pixel at the controls-target depth. */
    const worldPerPixel = () => {
      const dist = camera.position.distanceTo(controls.target);
      const height = Math.max(1, surface.domElement.clientHeight);
      return (2 * dist * Math.tan(CAD.MathUtils.degToRad(camera.fov / 2))) / height;
    };

    const referencePlaneHalfSize = (origin: CAD.Vector3) => {
      const forward = new CAD.Vector3(0, 0, -1)
        .applyQuaternion(camera.quaternion)
        .normalize();
      const depth = Math.max(
        camera.near * 2,
        origin.clone().sub(camera.position).dot(forward),
      );
      return referencePlaneHalfSizeForView(
        depth,
        camera.fov,
        surface.domElement.clientWidth,
        surface.domElement.clientHeight,
      );
    };

    const updateReferencePlaneInteractionScale = () => {
      for (const pickerPlane of picker) {
        const definition = PICKER_PLANES.find(
          (candidate) => candidate.plane === pickerPlane.plane,
        );
        const group = pickerPlane.mesh.parent;
        if (!definition || !group) continue;
        const halfSize = referencePlaneHalfSize(
          new CAD.Vector3(...definition.basis.origin),
        );
        group.scale.setScalar(halfSize / (REFERENCE_PLANE_SIZE / 2));
        group.updateWorldMatrix(true, true);
      }
      for (const group of datumGroup.children) {
        const rawOrigin = group.userData.referencePlaneOrigin;
        if (!Array.isArray(rawOrigin) || rawOrigin.length !== 3) continue;
        const halfSize = referencePlaneHalfSize(
          new CAD.Vector3(
            Number(rawOrigin[0]),
            Number(rawOrigin[1]),
            Number(rawOrigin[2]),
          ),
        );
        group.scale.setScalar(halfSize / (REFERENCE_PLANE_SIZE / 2));
        group.updateWorldMatrix(true, true);
      }
    };

    const sketchPlane = new CAD.Plane();
    const pointerToSketch = (e: PointerEvent): Vec2 | null => {
      if (!sketchGroup.visible) return null;
      raycaster.setFromCamera(ndcFromEvent(e), camera);
      const hit = new CAD.Vector3();
      if (!raycaster.ray.intersectPlane(sketchPlane, hit)) return null;
      const local = sketchGroup.worldToLocal(hit);
      return { x: local.x, y: local.y };
    };

    /** Nearest entity within the pixel tolerance (points, then curve
     * edges: lines, circles, arc spans). */
    const pickEntity = (
      p: Vec2,
      tolerancePx = 6,
      allowedKinds?: ReadonlySet<EntityDto['kind']>,
    ): number | null => {
      const sketch = store.getState().activeSketch;
      if (!sketch) return null;
      const tol = worldPerPixel() * tolerancePx;
      let best: { id: number; d: number } | null = null;
      const consider = (current: typeof best, id: number, d: number): typeof best =>
        d <= tol && (!current || d < current.d) ? { id, d } : current;
      for (const entity of sketch.entities) {
        if (allowedKinds && !allowedKinds.has(entity.kind)) continue;
        switch (entity.kind) {
          case 'point': {
            const d = Math.hypot(entity.position.x - p.x, entity.position.y - p.y);
            if (d <= tol) return entity.id; // points win outright
            break;
          }
          case 'line':
            best = consider(best, entity.id, pointToSegment(p, entity.start, entity.end));
            break;
          case 'circle': {
            const d = Math.abs(Math.hypot(p.x - entity.center.x, p.y - entity.center.y) - entity.radius);
            best = consider(best, entity.id, d);
            break;
          }
          case 'arc': {
            const d = Math.abs(Math.hypot(p.x - entity.center.x, p.y - entity.center.y) - entity.radius);
            const ang = Math.atan2(p.y - entity.center.y, p.x - entity.center.x);
            if (ccwSweep(entity.start_angle, ang) <= ccwSweep(entity.start_angle, entity.end_angle)) {
              best = consider(best, entity.id, d);
            }
            break;
          }
          case 'spline': {
            // Polyline distance over the engine tessellation.
            const pts = entity.tessellation;
            for (let i = 0; i + 1 < pts.length; i++) {
              best = consider(best, entity.id, pointToSegment(p, pts[i], pts[i + 1]));
            }
            break;
          }
        }
      }
      return best ? best.id : null;
    };

    const pointToSegment = (p: Vec2, a: Vec2, b: Vec2): number => {
      const abx = b.x - a.x;
      const aby = b.y - a.y;
      const len2 = abx * abx + aby * aby;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
      return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby));
    };

    const pointInScreenPolygon = (point: Vec2, polygon: Vec2[]): boolean => {
      let inside = false;
      for (
        let current = 0, previous = polygon.length - 1;
        current < polygon.length;
        previous = current++
      ) {
        const a = polygon[current];
        const b = polygon[previous];
        if (
          a.y > point.y !== b.y > point.y &&
          point.x <
            ((b.x - a.x) * (point.y - a.y)) /
              (b.y - a.y || Number.EPSILON) +
              a.x
        ) {
          inside = !inside;
        }
      }
      return inside;
    };

    /**
     * Exact rays own unambiguous plane interiors. A small projected-polygon
     * fallback covers the rendered outline thickness and planes that become
     * nearly edge-on in ISO views, where an infinitely thin ray/plane test has
     * visible dead strips even though Bevy still draws several screen pixels.
     */
    const pickOriginPlane = (event: PointerEvent): OriginPlane | null => {
      updateReferencePlaneInteractionScale();
      raycaster.setFromCamera(ndcFromEvent(event), camera);
      const exact = raycaster.intersectObjects(picker.map((plane) => plane.mesh));
      const exactPlane = exact[0]?.object.userData.plane as OriginPlane | undefined;
      if (exactPlane) return exactPlane;

      const viewport = surface.domElement.getBoundingClientRect();
      const pointer = { x: event.clientX, y: event.clientY };
      const candidates: Array<{
        plane: OriginPlane;
        distance: number;
        facing: number;
      }> = [];
      for (const definition of PICKER_PLANES) {
        const origin = new CAD.Vector3(...definition.basis.origin);
        const halfSize = referencePlaneHalfSize(origin);
        const u = new CAD.Vector3(...definition.basis.u).multiplyScalar(halfSize);
        const v = new CAD.Vector3(...definition.basis.v).multiplyScalar(halfSize);
        const corners = [
          origin.clone().sub(u).sub(v),
          origin.clone().add(u).sub(v),
          origin.clone().add(u).add(v),
          origin.clone().sub(u).add(v),
        ].map((world) => {
          const projected = world.project(camera);
          return {
            x: viewport.left + ((projected.x + 1) / 2) * viewport.width,
            y: viewport.top + ((1 - projected.y) / 2) * viewport.height,
            z: projected.z,
          };
        });
        if (corners.some((corner) => corner.z < -1 || corner.z > 1)) continue;
        const polygon = corners.map(({ x, y }) => ({ x, y }));
        const inside = pointInScreenPolygon(pointer, polygon);
        let distance = inside ? 0 : Number.POSITIVE_INFINITY;
        if (!inside) {
          for (let index = 0; index < polygon.length; index += 1) {
            distance = Math.min(
              distance,
              pointToSegment(
                pointer,
                polygon[index],
                polygon[(index + 1) % polygon.length],
              ),
            );
          }
        }
        if (distance > ORIGIN_PLANE_CAPTURE_PX) continue;
        const normal = new CAD.Vector3(...definition.basis.normal).normalize();
        candidates.push({
          plane: definition.plane,
          distance,
          facing: Math.abs(normal.dot(raycaster.ray.direction)),
        });
      }
      candidates.sort(
        (left, right) =>
          left.distance - right.distance || right.facing - left.facing,
      );
      return candidates[0]?.plane ?? null;
    };

    const projectToSegment = (p: Vec2, a: Vec2, b: Vec2): Vec2 => {
      const abx = b.x - a.x;
      const aby = b.y - a.y;
      const len2 = abx * abx + aby * aby;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
      return { x: a.x + t * abx, y: a.y + t * aby };
    };

    /** Nearest point on a rendered entity, used for magnetic modify-tool
     * feedback and for committing curve-point tools at the acquired point. */
    const closestPointOnEntity = (entity: EntityDto, p: Vec2): Vec2 | null => {
      switch (entity.kind) {
        case 'point':
          return entity.position;
        case 'line':
          return projectToSegment(p, entity.start, entity.end);
        case 'circle': {
          const dx = p.x - entity.center.x;
          const dy = p.y - entity.center.y;
          const length = Math.hypot(dx, dy);
          if (length < 1e-12) return { x: entity.center.x + entity.radius, y: entity.center.y };
          return {
            x: entity.center.x + (dx / length) * entity.radius,
            y: entity.center.y + (dy / length) * entity.radius,
          };
        }
        case 'arc': {
          const dx = p.x - entity.center.x;
          const dy = p.y - entity.center.y;
          const angle = Math.atan2(dy, dx);
          const projected = {
            x: entity.center.x + Math.cos(angle) * entity.radius,
            y: entity.center.y + Math.sin(angle) * entity.radius,
          };
          if (ccwSweep(entity.start_angle, angle) <= ccwSweep(entity.start_angle, entity.end_angle)) {
            return projected;
          }
          const start = {
            x: entity.center.x + Math.cos(entity.start_angle) * entity.radius,
            y: entity.center.y + Math.sin(entity.start_angle) * entity.radius,
          };
          const end = {
            x: entity.center.x + Math.cos(entity.end_angle) * entity.radius,
            y: entity.center.y + Math.sin(entity.end_angle) * entity.radius,
          };
          return Math.hypot(p.x - start.x, p.y - start.y) <= Math.hypot(p.x - end.x, p.y - end.y)
            ? start
            : end;
        }
        case 'spline': {
          let best: { point: Vec2; distance: number } | null = null;
          for (let i = 0; i + 1 < entity.tessellation.length; i++) {
            const point = projectToSegment(p, entity.tessellation[i], entity.tessellation[i + 1]);
            const distance = Math.hypot(point.x - p.x, point.y - p.y);
            if (!best || distance < best.distance) best = { point, distance };
          }
          return best?.point ?? null;
        }
      }
    };

    const acquireEntityTarget = (
      p: Vec2,
      allowedKinds: ReadonlySet<EntityDto['kind']>,
    ): { id: number; point: Vec2 } | null => {
      const sketch = store.getState().activeSketch;
      if (!sketch) return null;
      const tolerance = worldPerPixel() * MODIFY_CAPTURE_PX;
      let best: { id: number; point: Vec2; distance: number } | null = null;
      for (const entity of sketch.entities) {
        if (!allowedKinds.has(entity.kind)) continue;
        const point = closestPointOnEntity(entity, p);
        if (!point) continue;
        const distance = Math.hypot(point.x - p.x, point.y - p.y);
        if (distance <= tolerance && (!best || distance < best.distance)) {
          best = { id: entity.id, point, distance };
        }
      }
      return best ? { id: best.id, point: best.point } : null;
    };

    const isPointEntity = (id: number | null): boolean => {
      if (id === null) return false;
      const sketch = store.getState().activeSketch;
      return !!sketch?.entities.some((e) => e.id === id && e.kind === 'point');
    };

    // --- Inference chips + snap marker (HTML overlay near the cursor) ---
    const hideChips = () => {
      if (chipsRef.current) chipsRef.current.style.display = 'none';
    };

    const showChips = (inferences: string[], x: number, y: number) => {
      const chips = chipsRef.current;
      if (!chips) return;
      if (inferences.length === 0) {
        hideChips();
        return;
      }
      const chip = (label: string) =>
        `<span class="flex h-4 min-w-4 items-center justify-center rounded-[3px] bg-accent px-1 text-[10px] font-bold text-white">${label}</span>`;
      const coincident = `<span class="flex h-4 w-4 items-center justify-center rounded-[3px] bg-accent text-white">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4">
          <rect x="5" y="5" width="14" height="14"/><circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none"/>
        </svg></span>`;
      chips.innerHTML = inferences
        .map((i) =>
          i === 'horizontal'
            ? chip(t('sketch.inferenceH'))
            : i === 'vertical'
              ? chip(t('sketch.inferenceV'))
              : coincident,
        )
        .join('');
      chips.style.display = 'flex';
      chips.style.left = `${x + 18}px`;
      chips.style.top = `${y + 14}px`;
    };

    // --- Tool/drag interaction state ---
    let dragging: { pointId: number; session: number; last: Vec2 } | null = null;
    let dragSession = 0;
    let dragSerial: Promise<void> = Promise.resolve();
    let pendingDragUpdate: {
      pointId: number;
      session: number;
      to: Vec2;
      ctrlHeld: boolean;
    } | null = null;
    let dragPumpRunning = false;
    let downInfo: { x: number; y: number; candidate: number | null; dimCandidate: number | null } | null =
      null;
    let previewSeq = 0;
    /** Last cursor position in sketch coords (commit/drag-end fallback). */
    let lastSketchPoint: Vec2 | null = null;
    /** Active modal nav-tool drag (NavBar Orbit/Pan/Zoom/Zoom Window). */
    let navDrag: {
      tool: 'orbit' | 'pan' | 'zoom' | 'zoomWindow';
      x: number;
      y: number;
      startX: number;
      startY: number;
      moved: boolean;
    } | null = null;
    /** Dimension text drag (live sprite move, engine commit on release). */
    let dimDragging: { dimId: number; sprite: CAD.Sprite } | null = null;
    /** Dimension tool pick state (entity picks before placement). */
    let dimPick: { entities: number[]; phase: 'pick' | 'place' } | null = null;
    const dimPreviewGroup = new CAD.Group();
    previewGroup.add(dimPreviewGroup);
    const endDimensionTool = () => {
      dimPick = null;
      clearGroup(dimPreviewGroup);
    };

    /** Modify-tool pick state (fillet/chamfer picks; offset/trim/etc.). */
    let modTool: { picks: number[]; rejected?: boolean } | null = null;
    /** Picked entities render highlighted so modify tools feel alive (M1d). */
    const picksGroup = new CAD.Group();
    previewGroup.add(picksGroup);
    /** Valid target under a modify-tool cursor (magnetic acquisition). */
    const acquireGroup = new CAD.Group();
    previewGroup.add(acquireGroup);
    let modCornerTarget: { point: Vec2; lines: [number, number] } | null = null;
    /** Trim hover preview: entity id + removed-piece render state. */
    let trimHover: number | null = null;
    /** Move/Copy drag state (base point in sketch mm). */
    let moveDrag: { base: Vec2; copy: boolean } | null = null;
    /** Polygon creation phase (center picked, radius/rotation follows). */
    let polygonRun: { center: Vec2 } | null = null;
    /** Scale tool base point. */
    let scaleBase: Vec2 | null = null;
    /** Last pointer client coords (debounced live previews). */
    let lastPointerClient: { x: number; y: number } | null = null;
    let livePreviewTimer = 0;

    /** Line pick for modify tools: nearest line within tolerance, ignoring
     * point entities. Points sit at every curve endpoint and pickEntity lets
     * them "win outright", which shadowed line clicks near corners and made
     * fillet/chamfer feel dead at rectangle vertices. */
    const pickLineOnly = (p: Vec2): number | null => {
      const sketch = store.getState().activeSketch;
      if (!sketch) return null;
      const tol = worldPerPixel() * MODIFY_CAPTURE_PX;
      let best: { id: number; d: number } | null = null;
      for (const entity of sketch.entities) {
        if (entity.kind !== 'line') continue;
        const d = pointToSegment(p, entity.start, entity.end);
        if (d <= tol && (!best || d < best.d)) best = { id: entity.id, d };
      }
      return best?.id ?? null;
    };

    /** Find the nearest valid line intersection in a screen-space capture
     * radius. This includes shared endpoints and intersections of disjoint
     * finite segments' supporting lines—the engine can trim/extend either
     * case for Fillet/Chamfer. */
    const acquireLineCorner = (
      p: Vec2,
      requiredLine?: number,
    ): { point: Vec2; lines: [number, number] } | null => {
      const sketch = store.getState().activeSketch;
      if (!sketch) return null;
      const lines = sketch.entities.filter((entity) => entity.kind === 'line');
      const tol = worldPerPixel() * MODIFY_CAPTURE_PX;
      let best:
        | { point: Vec2; lines: [number, number]; distance: number; quality: number }
        | null = null;

      for (let i = 0; i < lines.length; i++) {
        for (let j = i + 1; j < lines.length; j++) {
          const a = lines[i];
          const b = lines[j];
          if (requiredLine !== undefined && a.id !== requiredLine && b.id !== requiredLine) {
            continue;
          }
          const point = lineIntersection2d(a, b);
          if (!point) continue;
          const distance = Math.hypot(point.x - p.x, point.y - p.y);
          if (distance > tol) continue;
          const da = { x: a.end.x - a.start.x, y: a.end.y - a.start.y };
          const db = { x: b.end.x - b.start.x, y: b.end.y - b.start.y };
          const denom = Math.hypot(da.x, da.y) * Math.hypot(db.x, db.y);
          const quality =
            denom > 1e-12 ? Math.abs(da.x * db.y - da.y * db.x) / denom : 0;
          if (quality < 1e-4) continue;
          if (
            !best ||
            distance < best.distance - 1e-6 ||
            (Math.abs(distance - best.distance) <= 1e-6 && quality > best.quality)
          ) {
            best = {
              point,
              lines: [a.id, b.id],
              distance,
              quality,
            };
          }
        }
      }
      return best ? { point: best.point, lines: best.lines } : null;
    };

    /** Render a magnetic corner target without committing either edge. */
    const showCornerAcquisition = (target: { point: Vec2; lines: [number, number] } | null) => {
      const unchanged =
        target !== null &&
        modCornerTarget !== null &&
        target.lines[0] === modCornerTarget.lines[0] &&
        target.lines[1] === modCornerTarget.lines[1] &&
        Math.hypot(target.point.x - modCornerTarget.point.x, target.point.y - modCornerTarget.point.y) < 1e-6;
      if (unchanged) return;

      modCornerTarget = target;
      clearGroup(acquireGroup);
      if (!target) {
        hideSnapMarker();
        return;
      }

      const byId = new Map((store.getState().activeSketch?.entities ?? []).map((entity) => [entity.id, entity]));
      for (const id of target.lines) {
        const line = byId.get(id);
        if (line?.kind !== 'line') continue;
        addScreenPolyline(
          acquireGroup,
          [line.start.x, line.start.y, 0.13, line.end.x, line.end.y, 0.13],
          COLOR_HOVER,
          2,
        );
      }
      showSnapMarker(target.point, 'point');
    };

    const endModTool = () => {
      modTool = null;
      modCornerTarget = null;
      trimHover = null;
      moveDrag = null;
      polygonRun = null;
      scaleBase = null;
      setPreviewPositions(null);
      clearGroup(dimPreviewGroup);
      clearGroup(picksGroup);
      clearGroup(acquireGroup);
      hideSnapMarker();
      store.getState().hideDynInput();
    };

    /** Debounced live preview while typing (D10): ~200 ms after the last
     * keystroke, re-run the active tool's preview from the CURRENT field
     * text (formula or number); invalid text falls back to cursor tracking. */
    const scheduleLivePreview = () => {
      window.clearTimeout(livePreviewTimer);
      store.getState().setDynPending(true);
      livePreviewTimer = window.setTimeout(() => {
        store.getState().setDynPending(false);
        if (!lastSketchPoint) return;
        const state = store.getState();
        const synth = {
          clientX: lastPointerClient?.x ?? 0,
          clientY: lastPointerClient?.y ?? 0,
          ctrlKey: false,
        } as PointerEvent;
        if (toolRun) {
          previewToolRun(toolRun, lastSketchPoint, synth);
        } else if (modTool) {
          if (modCornerTarget && modTool.picks.length < 2) {
            previewModTool(modCornerTarget.point, modCornerTarget.lines);
          } else {
            previewModTool(lastSketchPoint);
          }
        } else if (polygonRun) {
          previewPolygon(lastSketchPoint);
        } else if (scaleBase && state.activeTool === 'scale') {
          previewScale(lastSketchPoint);
        }
      }, 200);
    };

    // --- Modify-tool previews ---

    const previewModTool = (cursor: Vec2, provisionalPicks?: [number, number]) => {
      if (!engine) return;
      const state = store.getState();
      const texts = dynTexts();
      const locks = dynLocks();
      const seq = ++previewSeq;
      const picks = provisionalPicks ?? modTool?.picks ?? [];
      const operationPoint = (() => {
        if (picks.length !== 2) return cursor;
        const byId = new Map(
          (state.activeSketch?.entities ?? []).map((entity) => [entity.id, entity]),
        );
        const first = byId.get(picks[0]);
        const second = byId.get(picks[1]);
        return first?.kind === 'line' && second?.kind === 'line'
          ? (lineIntersection2d(first, second) ?? cursor)
          : cursor;
      })();

      if (state.activeTool === 'fillet' && picks.length === 2) {
        const text = texts.radius ?? (locks.radius !== undefined ? String(locks.radius) : '10');
        void engine
          .filletPreview({ l1: picks[0], l2: picks[1], radius_text: text })
          .then((p) => {
            if (seq !== previewSeq) return;
            const [a0, a1] = p.ccw ? [p.start_angle, p.end_angle] : [p.end_angle, p.start_angle];
            setPreviewPositions(tessellateArc(p.center, p.radius, a0, a1, 0.12));
            // Keep the magnetic marker at the acquired operation point,
            // matching Line's snapped rubber-band endpoint.
            showSnapMarker(operationPoint, 'point');
          })
          .catch(() => {
            if (seq !== previewSeq) return;
            setPreviewPositions(null);
            hideSnapMarker();
          });
        return;
      }

      if (state.activeTool === 'chamfer' && picks.length === 2) {
        // Client-side presentation preview: cut points + connector line.
        const sketch = state.activeSketch;
        if (!sketch) return;
        const byId = new Map(sketch.entities.map((e) => [e.id, e]));
        const l1 = byId.get(picks[0]);
        const l2 = byId.get(picks[1]);
        if (l1?.kind !== 'line' || l2?.kind !== 'line') return;
        const d = locks.distance ?? (parseFloat(texts.distance ?? '10') || 10);
        const v = lineIntersection2d(l1, l2);
        if (!v) {
          setPreviewPositions(null);
          return;
        }
        const cut1 = chamferPoint(v, l1, d);
        const cut2 = chamferPoint(v, l2, d);
        setPreviewPositions([cut1.x, cut1.y, 0.12, cut2.x, cut2.y, 0.12]);
        showSnapMarker(operationPoint, 'point');
        return;
      }

      if (state.activeTool === 'offset' && picks.length === 1) {
        const text = texts.distance ?? (locks.distance !== undefined ? String(locks.distance) : '10');
        void engine
          .offsetPreview({ entity: picks[0], distance_text: text, cursor })
          .then((p) => {
            if (seq !== previewSeq) return;
            renderPreviewCurve(p.curve);
          })
          .catch(() => {
            if (seq !== previewSeq) return;
            setPreviewPositions(null);
          });
      }
    };

    const renderPreviewCurve = (curve: PreviewCurve) => {
      switch (curve.kind) {
        case 'line':
          setPreviewPositions([curve.a.x, curve.a.y, 0.12, curve.b.x, curve.b.y, 0.12]);
          break;
        case 'arc':
          setPreviewPositions(tessellateArc(curve.center, curve.radius, curve.start_angle, curve.end_angle, 0.12));
          break;
        case 'circle':
          setPreviewPositions(tessellateCircle(curve.center, curve.radius, 0.12));
          break;
      }
    };

    // --- Polygon (client-side presentation preview) ---

    const previewPolygon = (cursor: Vec2) => {
      if (!polygonRun) return;
      const seq = ++previewSeq;
      const state = store.getState();
      const edgesField = state.dynInput.fields.find((f) => f.key === 'edges');
      const radiusField = state.dynInput.fields.find((f) => f.key === 'radius');
      const parsedEdges = Number.parseFloat(edgesField?.value ?? '');
      const evaluatedEdges = edgesField?.locked ? lockValues.edges ?? parsedEdges : 6;
      const edges = Math.max(
        3,
        Math.min(64, Math.round(Number.isFinite(evaluatedEdges) ? evaluatedEdges : 6)),
      );
      const acquired = acquireCreateSnap(cursor);
      const snapped = acquired.point;
      const cursorRadius = Math.hypot(
        snapped.x - polygonRun.center.x,
        snapped.y - polygonRun.center.y,
      );
      const parsedRadius = Number.parseFloat(radiusField?.value ?? '');
      const radius =
        radiusField?.locked && Number.isFinite(lockValues.radius ?? parsedRadius)
          ? (lockValues.radius ?? parsedRadius)
          : cursorRadius;
      const rotation = Math.atan2(
        snapped.y - polygonRun.center.y,
        snapped.x - polygonRun.center.x,
      );
      const mode = state.polygonMode;
      const effRadius = mode === 'circumscribed' ? radius / Math.cos(Math.PI / edges) : radius;
      const positions: number[] = [];
      for (let k = 0; k <= edges; k++) {
        const a = rotation + (2 * Math.PI * (k % edges)) / edges;
        positions.push(
          polygonRun.center.x + effRadius * Math.cos(a),
          polygonRun.center.y + effRadius * Math.sin(a),
          0.12,
        );
      }
      if (seq !== previewSeq) return;
      setPreviewPositions(positions);
      showSnapMarker(snapped, nativeSnapKind(acquired.target.kind));
      store.getState().updateDynInput(
        {
          edges: String(edges),
          radius: radius.toFixed(2),
        },
        {},
        lastPointerClient ? clusterPos(lastPointerClient.x, lastPointerClient.y).x : 0,
        lastPointerClient ? clusterPos(lastPointerClient.x, lastPointerClient.y).y : 0,
      );
    };

    // --- Scale (client-side presentation preview) ---

    const previewScale = (cursor: Vec2) => {
      const state = store.getState();
      const sketch = state.activeSketch;
      if (!sketch || !scaleBase) return;
      const locks = dynLocks();
      const texts = dynTexts();
      const factor = locks.factor ?? (parseFloat(texts.factor ?? '2') || 2);
      clearGroup(dimPreviewGroup);
      setPreviewPositions(null);
      const sx = (p: Vec2) => ({
        x: scaleBase!.x + (p.x - scaleBase!.x) * factor,
        y: scaleBase!.y + (p.y - scaleBase!.y) * factor,
      });
      const idSet = new Set(currentSelection());
      for (const e of sketch.entities) {
        if (!idSet.has(e.id)) continue;
        if (e.kind === 'line') {
          const a = sx(e.start);
          const b = sx(e.end);
          addScreenPolyline(
            dimPreviewGroup,
            [a.x, a.y, 0.1, b.x, b.y, 0.1],
            COLOR_PREVIEW,
            1.75,
          );
        } else if (e.kind === 'point') {
          const point = sx(e.position);
          const r = worldPerPixel() * 4;
          addScreenPolyline(
            dimPreviewGroup,
            [
              point.x - r,
              point.y - r,
              0.1,
              point.x + r,
              point.y - r,
              0.1,
              point.x + r,
              point.y + r,
              0.1,
              point.x - r,
              point.y + r,
              0.1,
              point.x - r,
              point.y - r,
              0.1,
            ],
            COLOR_PREVIEW,
            1.75,
          );
        } else if (e.kind === 'circle') {
          const c = sx(e.center);
          addScreenPolyline(
            dimPreviewGroup,
            tessellateCircle(c, e.radius * Math.abs(factor), 0.1),
            COLOR_PREVIEW,
            1.75,
          );
        } else if (e.kind === 'arc') {
          const c = sx(e.center);
          addScreenPolyline(
            dimPreviewGroup,
            tessellateArc(
              c,
              e.radius * Math.abs(factor),
              e.start_angle,
              e.end_angle,
              0.1,
            ),
            COLOR_PREVIEW,
            1.75,
          );
        } else if (e.kind === 'spline') {
          const positions: number[] = [];
          for (const point of e.tessellation) {
            const scaled = sx(point);
            positions.push(scaled.x, scaled.y, 0.1);
          }
          addScreenPolyline(dimPreviewGroup, positions, COLOR_PREVIEW, 1.75);
        }
      }
    };

    // --- Modal nav-tool drag helpers (camera never locked, D7) ---
    const panBy = (dxPx: number, dyPx: number) => {
      const bounded = CAD.boundedPointerDelta(
        dxPx,
        dyPx,
        surface.domElement.clientWidth,
        surface.domElement.clientHeight,
      );
      if (!bounded) return;
      [dxPx, dyPx] = bounded;
      cancelCameraAnimation();
      const wpp = worldPerPixel();
      const right = new CAD.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      const upv = new CAD.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
      const delta = right.multiplyScalar(-dxPx * wpp).addScaledVector(upv, dyPx * wpp);
      camera.position.add(delta);
      controls.target.add(delta);
      wakeControllerFrame();
    };

    const dollyBy = (factor: number) => {
      if (!Number.isFinite(factor) || factor <= 0) return;
      factor = CAD.MathUtils.clamp(factor, 0.2, 5);
      cancelCameraAnimation();
      const offset = camera.position.clone().sub(controls.target).multiplyScalar(factor);
      offset.setLength(Math.min(5000, Math.max(2, offset.length())));
      camera.position.copy(controls.target).add(offset);
      wakeControllerFrame();
    };

    /** Frame a dragged screen rect (Zoom Window): recentre + dolly to fit. */
    const frameRect = (cx: number, cy: number, w: number, h: number) => {
      const rect = surface.domElement.getBoundingClientRect();
      const ndc = new CAD.Vector2((cx / rect.width) * 2 - 1, -(cy / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const viewDir = controls.target.clone().sub(camera.position).normalize();
      const plane = new CAD.Plane().setFromNormalAndCoplanarPoint(viewDir, controls.target);
      const hit = new CAD.Vector3();
      if (!raycaster.ray.intersectPlane(plane, hit)) return;
      const dist = camera.position.distanceTo(controls.target);
      const scale = Math.max(w / rect.width, h / rect.height);
      const newDist = Math.min(5000, Math.max(2, (dist * scale) / 0.9));
      const dir = camera.position.clone().sub(controls.target).normalize();
      animateCamera(hit.clone().addScaledVector(dir, newDist), hit, camera.up.clone(), 250);
    };

    const updateZoomRect = (x0: number, y0: number, x1: number, y1: number) => {
      const el = zoomRectRef.current;
      if (!el) return;
      const rect = surface.domElement.getBoundingClientRect();
      el.style.display = 'block';
      el.style.left = `${Math.min(x0, x1) - rect.left}px`;
      el.style.top = `${Math.min(y0, y1) - rect.top}px`;
      el.style.width = `${Math.abs(x1 - x0)}px`;
      el.style.height = `${Math.abs(y1 - y0)}px`;
    };

    const hideZoomRect = () => {
      if (zoomRectRef.current) zoomRectRef.current.style.display = 'none';
    };

    // --- Sketch tool framework (Line, Midpoint Line, Point, Rectangle,
    // Circle, Arc) with generic dynamic input (D-M1b) ---
    type ToolId = Exclude<SketchTool, null>;
    interface ToolRun {
      tool: ToolId;
      /** Collected snapped points (line: [chain start]). */
      points: Vec2[];
    }
    let toolRun: ToolRun | null = null;

    /** 2D line intersection for preview math (presentation only). */
    const lineIntersection2d = (
      l1: { start: Vec2; end: Vec2 },
      l2: { start: Vec2; end: Vec2 },
    ): Vec2 | null => {
      const d1 = { x: l1.end.x - l1.start.x, y: l1.end.y - l1.start.y };
      const d2 = { x: l2.end.x - l2.start.x, y: l2.end.y - l2.start.y };
      const det = d1.x * d2.y - d1.y * d2.x;
      if (Math.abs(det) < 1e-12) return null;
      const t = ((l2.start.x - l1.start.x) * d2.y - (l2.start.y - l1.start.y) * d2.x) / det;
      return { x: l1.start.x + t * d1.x, y: l1.start.y + t * d1.y };
    };

    /** Chamfer cut point: from the vertex toward the FARTHER endpoint (gen
     * convention), at distance d. */
    const chamferPoint = (
      v: Vec2,
      l: { start: Vec2; end: Vec2 },
      d: number,
    ): Vec2 => {
      const da = Math.hypot(l.start.x - v.x, l.start.y - v.y);
      const db = Math.hypot(l.end.x - v.x, l.end.y - v.y);
      const far = db >= da ? l.end : l.start;
      const ux = (far.x - v.x) / (Math.max(da, db) || 1);
      const uy = (far.y - v.y) / (Math.max(da, db) || 1);
      return { x: v.x + ux * d, y: v.y + uy * d };
    };

    /** Dynamic-input field sets per tool (generic mechanism, M1c-ready). */
    const TOOL_FIELDS: Partial<Record<ToolId, string[]>> = {
      line: ['length', 'angle'],
      rect2pt: ['width', 'height'],
      rectCenter: ['width', 'height'],
      circleCenter: ['diameter'],
      circle2pt: ['diameter'],
      fillet: ['radius'],
      chamfer: ['distance'],
      offset: ['distance'],
      scale: ['factor'],
      polygon: ['edges', 'radius'],
      slot: ['width'],
    };

    /** Raw typed text of locked fields (formulas pass through, D9). */
    const dynTexts = (): Record<string, string | undefined> => {
      const fields = store.getState().dynInput.fields;
      const get = (key: string) => {
        const f = fields.find((f) => f.key === key);
        return f?.locked && f.value.trim() !== '' ? f.value.trim() : undefined;
      };
      return {
        length: get('length'),
        angle: get('angle'),
        width: get('width'),
        height: get('height'),
        diameter: get('diameter'),
        radius: get('radius'),
        distance: get('distance'),
        factor: get('factor'),
        edges: get('edges'),
      };
    };

    /** Evaluated lock values for previews (formulas resolved engine-side). */
    const lockValues: Record<string, number | undefined> = {
      length: undefined,
      angle: undefined,
      width: undefined,
      height: undefined,
      diameter: undefined,
      radius: undefined,
      distance: undefined,
      factor: undefined,
      edges: undefined,
    };
    let lockValueSeq = 0;

    /** Refresh evaluated values of locked fields (on run start / edits). */
    const refreshLockValues = () => {
      if (!engine) return;
      const texts = dynTexts();
      const seq = ++lockValueSeq;
      for (const key of Object.keys(texts)) {
        const text = texts[key];
        if (text === undefined) {
          lockValues[key] = undefined;
          continue;
        }
        void engine
          .evalExpression(text)
          .then((r) => {
            if (seq === lockValueSeq) lockValues[key] = r.value;
          })
          .catch(() => {
            // Mid-typing formula (e.g. "=d1/") — keep the previous value.
          });
      }
    };

    /** Locks for client preview math: evaluated when present, else live. */
    const dynLocks = (): ToolLocks => {
      // Fields locked but not yet evaluated (or plain numbers) — fall back
      // to direct parse for instant feedback on plain numeric input.
      const fields = store.getState().dynInput.fields;
      const get = (key: string) => {
        const f = fields.find((f) => f.key === key);
        if (!f?.locked) return undefined;
        if (lockValues[key] !== undefined) return lockValues[key];
        const v = parseFloat(f.value);
        return Number.isFinite(v) ? v : undefined;
      };
      return {
        length: get('length'),
        angle: get('angle'),
        width: get('width'),
        height: get('height'),
        diameter: get('diameter'),
        radius: get('radius'),
        distance: get('distance'),
        factor: get('factor'),
      };
    };

    /** Viewport-relative cluster position next to a client point, flipped
     * left/up near the Sketch Palette and bottom edges (D9 polish). */
    const clusterPos = (clientX: number, clientY: number) => {
      const rect = surface.domElement.getBoundingClientRect();
      let x = clientX - rect.left + 20;
      let y = clientY - rect.top + 20;
      const PALETTE_W = 244;
      const CLUSTER_W = 190;
      if (x + CLUSTER_W > rect.width - PALETTE_W) {
        x = clientX - rect.left - CLUSTER_W - 8;
      }
      if (y + 34 > rect.height - 40) {
        y = clientY - rect.top - 34;
      }
      return { x, y };
    };

    /**
     * Screen-space magnetic acquisition shared by every create tool.
     * Passing the acquired coordinate through the engine preserves its
     * structural merge/midpoint semantics while avoiding the old zoom-
     * dependent split between a fixed 2 mm engine tolerance and 14 px
     * modify-tool acquisition.
     */
    const acquireCreateSnap = (
      p: Vec2,
      allowMidpoint = false,
    ): { point: Vec2; target: SnapTarget } => {
      const state = store.getState();
      if (!state.palette.snap) return { point: p, target: { kind: 'none' } };
      const tolerance = worldPerPixel() * MODIFY_CAPTURE_PX;
      const sketch = state.activeSketch;
      let bestPoint: { id: number; point: Vec2; distance: number } | null = null;
      for (const entity of sketch?.entities ?? []) {
        if (entity.kind !== 'point') continue;
        const distance = Math.hypot(entity.position.x - p.x, entity.position.y - p.y);
        if (distance <= tolerance && (!bestPoint || distance < bestPoint.distance)) {
          bestPoint = { id: entity.id, point: entity.position, distance };
        }
      }
      if (bestPoint) {
        return {
          point: { ...bestPoint.point },
          target: { kind: 'point', entity: bestPoint.id },
        };
      }
      if (Math.hypot(p.x, p.y) <= tolerance) {
        return { point: { x: 0, y: 0 }, target: { kind: 'origin' } };
      }
      if (allowMidpoint) {
        let bestMidpoint: { id: number; point: Vec2; distance: number } | null = null;
        for (const entity of sketch?.entities ?? []) {
          if (entity.kind !== 'line') continue;
          const midpoint = {
            x: (entity.start.x + entity.end.x) / 2,
            y: (entity.start.y + entity.end.y) / 2,
          };
          const distance = Math.hypot(midpoint.x - p.x, midpoint.y - p.y);
          if (distance <= tolerance && (!bestMidpoint || distance < bestMidpoint.distance)) {
            bestMidpoint = { id: entity.id, point: midpoint, distance };
          }
        }
        if (bestMidpoint) {
          return {
            point: bestMidpoint.point,
            target: { kind: 'midpoint', entity: bestMidpoint.id },
          };
        }
        let bestReference:
          | { edge: number; point: Vec2; distance: number }
          | null = null;
        for (const reference of sketch?.reference_midpoints ?? []) {
          const distance = Math.hypot(
            reference.position.x - p.x,
            reference.position.y - p.y,
          );
          if (
            distance <= tolerance &&
            (!bestReference || distance < bestReference.distance)
          ) {
            bestReference = {
              edge: reference.edge_id,
              point: reference.position,
              distance,
            };
          }
        }
        if (bestReference) {
          return {
            point: { ...bestReference.point },
            target: { kind: 'reference_midpoint', edge: bestReference.edge },
          };
        }
      }
      return {
        point: {
          x: snapToGrid(p.x, sketchGridStep),
          y: snapToGrid(p.y, sketchGridStep),
        },
        target: { kind: 'grid' },
      };
    };

    /** Preserve the raw cursor ray for line H/V inference. Magnetic point,
     * origin, and midpoint acquisitions remain exact; only ordinary grid
     * rounding is deferred to the engine so it can infer direction first. */
    const acquireLineHint = (p: Vec2, allowMidpoint: boolean): Vec2 => {
      const acquired = acquireCreateSnap(p, allowMidpoint);
      return acquired.target.kind === 'grid' ? p : acquired.point;
    };

    /** Snap the cursor through the engine (points > origin > grid > raw). */
    const snapCursorInfo = async (p: Vec2, allowMidpoint = false): Promise<PreviewDto> => {
      const acquired = acquireCreateSnap(p, allowMidpoint);
      if (!engine) {
        return {
          snapped_to: acquired.point,
          snap: acquired.target,
          inferences: [],
        };
      }
      try {
        return await engine.previewSegment({
          from: acquired.point,
          to_raw: acquired.point,
          ctrl_held: !allowMidpoint,
        });
      } catch {
        return {
          snapped_to: acquired.point,
          snap: acquired.target,
          inferences: [],
        };
      }
    };

    const snapCursor = async (p: Vec2, allowMidpoint = false): Promise<Vec2> =>
      (await snapCursorInfo(p, allowMidpoint)).snapped_to;

    /** Point-tool acquisition includes curve interiors and bounded virtual
     * line extensions. Existing points, the origin, and visible curve spans
     * keep priority. A virtual extension is accepted only when one line is
     * unambiguous; the engine stores the persistent Coincident relation. */
    const acquirePointPlacement = (
      p: Vec2,
      suppressCarrier = false,
    ): {
      position: Vec2;
      coincidentWith: number | null;
      extension: { from: Vec2; to: Vec2 } | null;
    } => {
      const acquired = acquireCreateSnap(p);
      if (acquired.target.kind === 'point' || acquired.target.kind === 'origin') {
        return { position: acquired.point, coincidentWith: null, extension: null };
      }
      const state = store.getState();
      if (!suppressCarrier && state.palette.snap && state.activeSketch) {
        const wpp = worldPerPixel();
        const tolerance = wpp * MODIFY_CAPTURE_PX;
        const extensionReach = wpp * POINT_EXTENSION_REACH_PX;
        const ambiguityTolerance = wpp * POINT_EXTENSION_AMBIGUITY_PX;
        let bestCurve:
          | { entity: EntityDto; point: Vec2; distance: number }
          | null = null;
        const extensions: Array<{
          entity: EntityDto;
          point: Vec2;
          from: Vec2;
          distance: number;
          reach: number;
        }> = [];
        for (const entity of state.activeSketch.entities) {
          if (entity.kind !== 'line' && entity.kind !== 'circle' && entity.kind !== 'arc') {
            continue;
          }
          if (entity.kind === 'line') {
            const dx = entity.end.x - entity.start.x;
            const dy = entity.end.y - entity.start.y;
            const lengthSquared = dx * dx + dy * dy;
            if (lengthSquared <= 1e-12) continue;
            const t =
              ((p.x - entity.start.x) * dx + (p.y - entity.start.y) * dy) /
              lengthSquared;
            const point = {
              x: entity.start.x + t * dx,
              y: entity.start.y + t * dy,
            };
            const distance = Math.hypot(point.x - p.x, point.y - p.y);
            if (t >= 0 && t <= 1) {
              if (
                distance <= tolerance &&
                (!bestCurve || distance < bestCurve.distance)
              ) {
                bestCurve = { entity, point, distance };
              }
              continue;
            }
            const length = Math.sqrt(lengthSquared);
            const reach = t < 0 ? -t * length : (t - 1) * length;
            if (
              distance <= tolerance &&
              reach <= extensionReach
            ) {
              extensions.push({
                entity,
                point,
                from: t < 0 ? entity.start : entity.end,
                distance,
                reach,
              });
            }
            continue;
          }
          const point = closestPointOnEntity(entity, p);
          if (!point) continue;
          const distance = Math.hypot(point.x - p.x, point.y - p.y);
          if (
            distance <= tolerance &&
            (!bestCurve || distance < bestCurve.distance)
          ) {
            bestCurve = { entity, point, distance };
          }
        }
        if (bestCurve) {
          return {
            position: bestCurve.point,
            coincidentWith: bestCurve.entity.id,
            extension: null,
          };
        }
        extensions.sort(
          (a, b) => a.distance - b.distance || a.reach - b.reach,
        );
        const bestExtension = extensions[0];
        const nextExtension = extensions[1];
        const ambiguous =
          bestExtension &&
          nextExtension &&
          nextExtension.distance - bestExtension.distance <=
            ambiguityTolerance;
        if (bestExtension && !ambiguous) {
          return {
            position: bestExtension.point,
            coincidentWith: bestExtension.entity.id,
            extension: { from: bestExtension.from, to: bestExtension.point },
          };
        }
      }
      return {
        position: acquired.point,
        coincidentWith: null,
        extension: null,
      };
    };

    const setPreviewPositions = (positions: number[] | null) => {
      if (!positions || positions.length < 6) {
        previewLine.visible = false;
        return;
      }
      const geometry = new PolylineGeometry();
      geometry.setPositions(positions);
      previewLine.geometry.dispose();
      previewLine.geometry = geometry;
      previewLine.visible = true;
    };

    const endToolRun = () => {
      toolRun = null;
      setPreviewPositions(null);
      clearGroup(acquireGroup);
      hideSnapMarker();
      hideChips();
      store.getState().hideDynInput();
    };

    const reportToolError = (error: unknown, fallback = 'Sketch operation failed') => {
      store.getState().setConstraintDialog({
        titleKey: 'constraints.invalidTitle',
        message: error instanceof Error ? error.message : fallback,
      });
    };

    /**
     * Point drags are serialized and pointer updates are coalesced. Without
     * this queue, slow WASM/Tauri replies could arrive out of order and an
     * older update would visually (and sometimes authoritatively) overwrite
     * the drag end.
     */
    const beginPointDrag = (pointId: number, to: Vec2, ctrlHeld: boolean) => {
      if (!engine) return;
      const session = ++dragSession;
      dragging = { pointId, session, last: to };
      pendingDragUpdate = null;
      dragSerial = dragSerial
        .then(async () => {
          const result = await engine!.movePoint({
            point_id: pointId,
            to_raw: to,
            ctrl_held: ctrlHeld,
            phase: 'begin',
          });
          if (dragging?.session === session) {
            store.getState().setActiveSketch(result.sketch);
          }
        })
        .catch((error) => reportToolError(error, 'Cannot begin point drag'));
    };

    const pumpPointDragUpdates = () => {
      if (!engine || dragPumpRunning || !pendingDragUpdate) return;
      dragPumpRunning = true;
      dragSerial = dragSerial
        .then(async () => {
          while (pendingDragUpdate) {
            const update = pendingDragUpdate;
            pendingDragUpdate = null;
            if (update.session !== dragSession) continue;
            const result = await engine!.movePoint({
              point_id: update.pointId,
              to_raw: update.to,
              ctrl_held: update.ctrlHeld,
              phase: 'update',
            });
            if (dragging?.session === update.session) {
              store.getState().setActiveSketch(result.sketch);
            }
          }
        })
        .catch((error) => reportToolError(error, 'Cannot move point'))
        .finally(() => {
          dragPumpRunning = false;
          if (pendingDragUpdate) pumpPointDragUpdates();
        });
    };

    const queuePointDragUpdate = (to: Vec2, ctrlHeld: boolean) => {
      if (!dragging) return;
      dragging.last = to;
      pendingDragUpdate = {
        pointId: dragging.pointId,
        session: dragging.session,
        to,
        ctrlHeld,
      };
      pumpPointDragUpdates();
    };

    const finishPointDrag = (to: Vec2, ctrlHeld: boolean) => {
      if (!engine || !dragging) return;
      const drag = dragging;
      dragging = null;
      pendingDragUpdate = null;
      dragSerial = dragSerial
        .then(async () => {
          const result = await engine!.movePoint({
            point_id: drag.pointId,
            to_raw: to,
            ctrl_held: ctrlHeld,
            phase: 'end',
          });
          if (drag.session === dragSession) {
            store.getState().setActiveSketch(result.sketch);
          }
        })
        .catch((error) => reportToolError(error, 'Cannot finish point drag'));
    };

    /** Spline commit (Enter or double-click): needs ≥2 fit
     * points; a shorter run is discarded like Esc. The tool stays armed
     * afterwards so the next click starts a new spline. */
    const commitSpline = () => {
      if (!engine || !toolRun || toolRun.tool !== 'splineFit') return;
      if (toolRun.points.length < 2) {
        endToolRun();
        return;
      }
      const points = [...toolRun.points];
      void engine
        .addSpline({ points })
        .then((r) => {
          store.getState().setActiveSketch(r.sketch);
          endToolRun();
        })
        .catch((error) => reportToolError(error, 'Cannot create spline'));
    };

    const applyPreview = (
      from: Vec2,
      snapped: Vec2,
      inferences: string[],
      e: PointerEvent,
      snapKind?: SnapTarget['kind'],
    ) => {
      setPreviewPositions([from.x, from.y, 0.12, snapped.x, snapped.y, 0.12]);
      showSnapMarker(snapped, nativeSnapKind(snapKind ?? 'grid'));
      const rect = surface.domElement.getBoundingClientRect();
      showChips(inferences, e.clientX - rect.left, e.clientY - rect.top);
    };

    /** Live preview for the active tool run (per pointer move). */
    const previewToolRun = (run: ToolRun, p: Vec2, e: PointerEvent) => {
      if (!engine) return;
      const seq = ++previewSeq;
      const locks = dynLocks();
      const anchor = run.points[0];
      const pos = clusterPos(e.clientX, e.clientY);

      switch (run.tool) {
        case 'line': {
          const texts = dynTexts();
          const hint = acquireLineHint(p, !e.ctrlKey);
          void engine
            .previewSegmentLocked({
              from: anchor,
              to_hint: hint,
              length_mm: locks.length ?? null,
              angle_deg: locks.angle ?? null,
              length_text: texts.length ?? null,
              angle_text: texts.angle ?? null,
              ctrl_held: e.ctrlKey,
            })
            .then((preview) => {
              if (seq !== previewSeq) return;
              applyPreview(anchor, preview.snapped_to, preview.inferences, e, preview.snap.kind);
              // Live dynamic-input values from the effective endpoint.
              const dx = preview.snapped_to.x - anchor.x;
              const dy = preview.snapped_to.y - anchor.y;
              const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
              const norm = ((deg % 180) + 180) % 180; // [0, 180)
              const axisAligned = norm < 0.5 || norm > 179.5 || Math.abs(norm - 90) < 0.5;
              store.getState().updateDynInput(
                {
                  length: Math.hypot(dx, dy).toFixed(2),
                  angle: deg.toFixed(2),
                },
                { angle: !axisAligned },
                pos.x,
                pos.y,
              );
            })
            .catch(() => {});
          break;
        }
        case 'midpointLine': {
          const hint = acquireLineHint(p, !e.ctrlKey);
          void engine
            .previewSegment({
              from: anchor,
              to_raw: hint,
              ctrl_held: e.ctrlKey,
            })
            .then((preview) => {
            if (seq !== previewSeq) return;
            const snapped = preview.snapped_to;
            const other = { x: 2 * anchor.x - snapped.x, y: 2 * anchor.y - snapped.y };
            setPreviewPositions([other.x, other.y, 0.12, snapped.x, snapped.y, 0.12]);
            showSnapMarker(snapped, nativeSnapKind(preview.snap.kind));
            const rect = surface.domElement.getBoundingClientRect();
            showChips(
              preview.inferences,
              e.clientX - rect.left,
              e.clientY - rect.top,
            );
          });
          break;
        }
        case 'rect2pt':
        case 'rectCenter': {
          const mode = run.tool === 'rect2pt' ? 'two_point' : 'center';
          void snapCursorInfo(p).then((snap) => {
            if (seq !== previewSeq) return;
            const corner = rectCorner(mode, anchor, snap.snapped_to, locks);
            const corners = rectCorners(mode, anchor, corner);
            if (corners) {
              const pos2: number[] = [];
              for (const c of [...corners, corners[0]]) pos2.push(c.x, c.y, 0.12);
              setPreviewPositions(pos2);
              const preservesAcquisition =
                Math.hypot(
                  corner.x - snap.snapped_to.x,
                  corner.y - snap.snapped_to.y,
                ) < 1e-6;
              showSnapMarker(
                corner,
                preservesAcquisition ? nativeSnapKind(snap.snap.kind) : 'grid',
              );
            } else {
              setPreviewPositions(null);
              hideSnapMarker();
            }
            store.getState().updateDynInput(
              {
                width: Math.abs(corner.x - anchor.x).toFixed(2),
                height: Math.abs(corner.y - anchor.y).toFixed(2),
              },
              {},
              pos.x,
              pos.y,
            );
          });
          break;
        }
        case 'circleCenter':
        case 'circle2pt': {
          const mode = run.tool === 'circleCenter' ? 'center_diameter' : 'two_point';
          void snapCursorInfo(p).then((snap) => {
            if (seq !== previewSeq) return;
            const spec = circleSpec(mode, anchor, snap.snapped_to, locks);
            if (spec) {
              setPreviewPositions(tessellateCircle(spec.center, spec.radius, 0.12));
              showSnapMarker(snap.snapped_to, nativeSnapKind(snap.snap.kind));
            } else {
              setPreviewPositions(null);
              hideSnapMarker();
            }
            store.getState().updateDynInput(
              { diameter: spec ? (spec.radius * 2).toFixed(2) : '0.00' },
              {},
              pos.x,
              pos.y,
            );
          });
          break;
        }
        case 'arc3pt': {
          void snapCursorInfo(p).then((snap) => {
            if (seq !== previewSeq) return;
            const snapped = snap.snapped_to;
            if (run.points.length === 1) {
              setPreviewPositions([
                anchor.x,
                anchor.y,
                0.12,
                snapped.x,
                snapped.y,
                0.12,
              ]);
            } else {
              const circle = circumcircle(run.points[0], run.points[1], snapped);
              if (circle) {
                const a0 = angleOf(circle.center, run.points[0]);
                const a1 = angleOf(circle.center, snapped);
                const am = angleOf(circle.center, run.points[1]);
                const sweepFwd = ccwSweep(a0, a1);
                const [s, e2] = ccwSweep(a0, am) <= sweepFwd ? [a0, a1] : [a1, a0];
                setPreviewPositions(
                  tessellateArc(circle.center, circle.radius, s, e2, 0.12),
                );
              } else {
                setPreviewPositions([
                  anchor.x,
                  anchor.y,
                  0.12,
                  snapped.x,
                  snapped.y,
                  0.12,
                ]);
              }
            }
            showSnapMarker(snapped, nativeSnapKind(snap.snap.kind));
          });
          break;
        }
        case 'arcCenter': {
          void snapCursorInfo(p).then((snap) => {
            if (seq !== previewSeq) return;
            const snapped = snap.snapped_to;
            if (run.points.length === 1) {
              const r = Math.hypot(snapped.x - anchor.x, snapped.y - anchor.y);
              if (r > 1e-6) setPreviewPositions(tessellateCircle(anchor, r, 0.12));
            } else {
              const start = run.points[1];
              const r = Math.hypot(start.x - anchor.x, start.y - anchor.y);
              const a0 = angleOf(anchor, start);
              const a1 = angleOf(anchor, snapped);
              setPreviewPositions(tessellateArc(anchor, r, a0, a1, 0.12));
            }
            showSnapMarker(snapped, nativeSnapKind(snap.snap.kind));
          });
          break;
        }
        case 'slot': {
          const modeMap = { centerToCenter: 'center_to_center', overall: 'overall', centerPoint: 'center_point' } as const;
          const mode = modeMap[store.getState().slotMode];
          void snapCursorInfo(p).then((snap) => {
            if (seq !== previewSeq) return;
            const snapped = snap.snapped_to;
            if (run.points.length === 1) {
              setPreviewPositions([
                anchor.x,
                anchor.y,
                0.12,
                snapped.x,
                snapped.y,
                0.12,
              ]);
            } else {
              const cap = slotCapsulePreview(
                mode,
                run.points[0],
                run.points[1],
                snapped,
                locks,
              );
              if (cap) {
                setPreviewPositions(cap.positions);
              } else {
                setPreviewPositions(null);
              }
              store.getState().updateDynInput(
                { width: cap ? cap.width.toFixed(2) : '0.00' },
                {},
                pos.x,
                pos.y,
              );
            }
            showSnapMarker(snapped, nativeSnapKind(snap.snap.kind));
          });
          break;
        }
        case 'splineFit': {
          void snapCursorInfo(p).then((snap) => {
            if (seq !== previewSeq) return;
            const pts = [...run.points, snap.snapped_to];
            const positions = tessellateSpline(pts, 16, 0.12);
            if (positions.length >= 6) {
              setPreviewPositions(positions);
            } else {
              setPreviewPositions(null);
            }
            showSnapMarker(snap.snapped_to, nativeSnapKind(snap.snap.kind));
          });
          break;
        }
      }
    };

    /** Commit the active tool run at cursor `p` (click or Enter). */
    const commitToolRun = (run: ToolRun, p: Vec2, ctrlHeld: boolean) => {
      if (!engine) return;
      const locks = dynLocks();
      const texts = dynTexts();
      const anchor = run.points[0];
      const done = () => {
        endToolRun();
      };
      switch (run.tool) {
        case 'line': {
          const hint = acquireLineHint(p, !ctrlHeld);
          void engine
            .addLineLocked({
              from: anchor,
              to_hint: hint,
              length_mm: locks.length ?? null,
              angle_deg: locks.angle ?? null,
              length_text: texts.length ?? null,
              angle_text: texts.angle ?? null,
              ctrl_held: ctrlHeld,
            })
            .then((result) => {
              store.getState().setActiveSketch(result.sketch);
              // Chain continues from the new end point; locks reset.
              const end = result.sketch.entities.find((en) => en.id === result.end_point_id);
              if (end && end.kind === 'point') {
                run.points[0] = end.position;
                store.getState().clearDynLocks();
              } else {
                endToolRun();
              }
            })
            .catch((error) => reportToolError(error, 'Cannot create line'));
          break;
        }
        case 'midpointLine': {
          const end = acquireLineHint(p, !ctrlHeld);
          void engine
            .addLineMidpoint({ mid_raw: anchor, end_raw: end, ctrl_held: ctrlHeld })
            .then((r) => {
              store.getState().setActiveSketch(r.sketch);
              done();
            })
            .catch((error) => reportToolError(error, 'Cannot create midpoint line'));
          break;
        }
        case 'rect2pt':
        case 'rectCenter': {
          const corner = acquireCreateSnap(p).point;
          void engine
            .addRectangleLocked({
              mode: run.tool === 'rect2pt' ? 'two_point' : 'center',
              anchor,
              width_mm: locks.width ?? null,
              height_mm: locks.height ?? null,
              width_text: texts.width ?? null,
              height_text: texts.height ?? null,
              corner_hint: corner,
              ctrl_held: ctrlHeld,
            })
            .then((r) => {
              store.getState().setActiveSketch(r.sketch);
              done();
            })
            .catch((error) => reportToolError(error, 'Cannot create rectangle'));
          break;
        }
        case 'circleCenter':
        case 'circle2pt': {
          const edge = acquireCreateSnap(p).point;
          void engine
            .addCircleLocked({
              mode: run.tool === 'circleCenter' ? 'center_diameter' : 'two_point',
              anchor,
              diameter_mm: locks.diameter ?? null,
              diameter_text: texts.diameter ?? null,
              edge_hint: edge,
              ctrl_held: ctrlHeld,
            })
            .then((r) => {
              store.getState().setActiveSketch(r.sketch);
              done();
            })
            .catch((error) => reportToolError(error, 'Cannot create circle'));
          break;
        }
        case 'arc3pt': {
          const next = acquireCreateSnap(p).point;
          if (run.points.length < 2) {
            run.points.push(next);
            break;
          }
          const [p1, p2] = run.points;
          void engine
            .addArc3pt({ p1, p2, p3: next, ctrl_held: ctrlHeld })
            .then((r) => {
              store.getState().setActiveSketch(r.sketch);
              done();
            })
            .catch((error) => reportToolError(error, 'Cannot create three-point arc'));
          break;
        }
        case 'arcCenter': {
          const next = acquireCreateSnap(p).point;
          if (run.points.length < 2) {
            run.points.push(next);
            break;
          }
          const [center, start] = run.points;
          void engine
            .addArcCenter({ center, start, sweep: next, ctrl_held: ctrlHeld })
            .then((r) => {
              store.getState().setActiveSketch(r.sketch);
              done();
            })
            .catch((error) => reportToolError(error, 'Cannot create center arc'));
          break;
        }
        case 'slot': {
          if (run.points.length < 2) {
            // Second end-cap center picked: arm the width field once the
            // slot axis exists.
            run.points.push(acquireCreateSnap(p).point);
            const lp = lastPointerClient ?? { x: 0, y: 0 };
            const pos2 = clusterPos(lp.x, lp.y);
            store.getState().showDynInput(TOOL_FIELDS.slot!, pos2.x, pos2.y);
            refreshLockValues();
            break;
          }
          const modeMap = { centerToCenter: 'center_to_center', overall: 'overall', centerPoint: 'center_point' } as const;
          void engine
            .addSlot({
              mode: modeMap[store.getState().slotMode],
              p1: run.points[0],
              p2: run.points[1],
              cursor: acquireCreateSnap(p).point,
              width_mm: locks.width ?? null,
              width_text: texts.width ?? null,
            })
            .then((r) => store.getState().setActiveSketch(r.sketch))
            .then(() => done())
            .catch((error) => reportToolError(error, 'Cannot create slot'));
          break;
        }
        case 'splineFit': {
          // Chain: every click appends a fit point; Enter or double-click
          // commits (see commitSpline), Esc cancels via endToolRun.
          run.points.push(acquireCreateSnap(p).point);
          break;
        }
      }
    };

    /** Start (or single-shot commit for Point) a tool run at `p`. Fast
     * consecutive clicks are queued: a click arriving while the first
     * point's snap is pending becomes the first commit, not a restart.
     * NOTE: uses `startSeq`, NOT the preview sequence — pointermove
     * previews must never invalidate a pending tool start (they only
     * move the snap marker). */
    let startSnapPending = false;
    let startSeq = 0;
    let queuedCommit: Vec2 | null = null;
    const startToolRun = (tool: ToolId, p: Vec2, e: PointerEvent) => {
      if (!engine) return;
      if (tool === 'point') {
        const placement = acquirePointPlacement(p, e.ctrlKey);
        clearGroup(acquireGroup);
        hideChips();
        void engine
          .addPoint({
            position: placement.position,
            coincident_with: placement.coincidentWith,
          })
          .then((result) => store.getState().setActiveSketch(result.sketch))
          .catch((error) => reportToolError(error, 'Cannot create point'));
        return;
      }
      startSnapPending = true;
      const seq = ++startSeq;
      void snapCursorInfo(p, tool === 'line' || tool === 'midpointLine')
        .then((preview) => {
          startSnapPending = false;
          if (seq !== startSeq) return;
          const snapped = preview.snapped_to;
          toolRun = { tool, points: [snapped] };
          showSnapMarker(snapped, nativeSnapKind(preview.snap.kind));
          const fields = TOOL_FIELDS[tool];
          // Slot arms its width field only after the second center is picked —
          // before that the field has no meaning.
          if (fields && tool !== 'slot') {
            const pos = clusterPos(e.clientX, e.clientY);
            store.getState().showDynInput(fields, pos.x, pos.y);
            refreshLockValues();
          }
          if (queuedCommit) {
            const q = queuedCommit;
            queuedCommit = null;
            commitToolRun(toolRun, q, false);
          }
        })
        .catch((error) => {
          startSnapPending = false;
          reportToolError(error, 'Cannot acquire sketch point');
        });
    };

    /** Keyboard handling for the dynamic-input cluster. Returns true when
     * the key was consumed. */
    const handleDynKey = (e: KeyboardEvent): boolean => {
      const state = store.getState();
      const d = state.dynInput;
      if (!d.active || (!toolRun && !modTool && !polygonRun && !scaleBase)) return false;
      const visible = d.fields.filter((f) => f.visible);

      if (e.key === 'Tab') {
        if (visible.length === 0) return true;
        const next =
          d.focus === null
            ? 0
            : (d.focus + (e.shiftKey ? visible.length - 1 : 1)) % visible.length;
        state.setDynFocus(next);
        return true;
      }
      if (e.key === 'Enter') {
        // M1d field-lock semantics: typing already LOCKS the
        // field; Enter advances focus to the next unlocked field instead of
        // ending the run, so the cluster stays live until the shape's final
        // point commits (click) or Esc cancels. Enter commits only when
        //   · every visible field is locked (fully typed shape), or
        //   · nothing was typed at all (drop the point at the cursor), or
        //   · the focused field is empty (accept the rubber-band value).
        const allLocked = visible.length > 0 && visible.every((f) => f.locked);
        if (!allLocked) {
          const nothingTyped = visible.every((f) => !f.locked);
          const focusedEmpty = d.focus !== null && !visible[d.focus].locked;
          if (!nothingTyped && !focusedEmpty) {
            const start = d.focus ?? 0;
            for (let i = 1; i <= visible.length; i++) {
              const idx = (start + i) % visible.length;
              if (!visible[idx].locked) {
                state.setDynFocus(idx);
                break;
              }
            }
            return true;
          }
        }
        // Enter = "done": value-entry modify tools commit AND exit
        // (owner 2026-07-19: typed a value, pressed Enter — don't make me
        // Esc twice). Click-commits keep the tool armed for repeat ops.
        if (toolRun && lastSketchPoint) commitToolRun(toolRun, lastSketchPoint, false);
        else if (modTool && lastSketchPoint) commitModTool(lastSketchPoint, true);
        else if (scaleBase && lastSketchPoint) commitScale(true);
        else if (polygonRun && lastSketchPoint) commitPolygon(lastSketchPoint, true);
        return true;
      }
      if (e.key === 'Escape') {
        if (d.focus !== null) {
          // Esc inside a field: empty + unlock it.
          const f = visible[d.focus];
          if (f) state.setDynField(f.key, '', false);
          state.setDynFocus(null);
        } else if (modTool) {
          if (modTool.picks.length > 0) {
            endModTool(); // cancel the in-progress op; tool stays armed (M1d)
          } else {
            // Idle modify tool: Esc must RETIRE it. Otherwise the next
            // pointer move re-arms the value field (moveModTool keep-alive)
            // and Esc can never dismiss the input cluster.
            endModTool();
            state.setActiveTool(null);
          }
        } else if (polygonRun || scaleBase) {
          endModTool(); // cancel the current op
        } else if (toolRun) {
          endToolRun(); // cancel the current segment
        }
        return true;
      }
      if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        // Any printable character: digits, operators, and formula
        // identifiers/functions (d1, sin, sqrt, =25*2, …, D9).
        const idx = d.focus ?? 0;
        const f = visible[idx];
        if (!f) return true;
        const current = d.fields.find((x) => x.key === f.key);
        const value = d.selectAll ? e.key : current?.locked ? current.value + e.key : e.key;
        state.setDynField(f.key, value, true); // typing locks the field
        state.setDynFocus(idx, false);
        refreshLockValues();
        scheduleLivePreview(); // ~200 ms live preview while typing (D10)
        return true;
      }
      if (e.key === 'Backspace' && d.focus !== null) {
        const f = visible[d.focus];
        const current = d.fields.find((x) => x.key === f.key);
        if (current) {
          const value = d.selectAll ? '' : current.value.slice(0, -1);
          state.setDynField(f.key, value, value !== ''); // emptied → unlocked
          state.setDynFocus(d.focus, false);
          refreshLockValues();
          scheduleLivePreview();
        }
        return true;
      }
      return false;
    };

    /** Commit the active modify tool (Enter or final click). `exitAfter`
     * (Enter only): retire the tool on success — typed value + Enter means
     * "done" (owner 2026-07-19); on failure the tool stays armed. */
    const commitModTool = (cursor: Vec2, exitAfter = false) => {
      if (!engine || !modTool) return;
      const attemptedModTool = modTool;
      const state = store.getState();
      const texts = dynTexts();
      const locks = dynLocks();
      const focusKey =
        state.activeTool === 'fillet'
          ? 'radius'
          : state.activeTool === 'chamfer' || state.activeTool === 'offset'
            ? 'distance'
            : null;
      const fail = (error: unknown) => {
        // Preserve the acquired geometry so the value can be corrected and
        // retried. Focus the rejected field; the overlay consumes its own
        // pointer events, and double-click clears it for replacement. The
        // next click on the canvas cancels this rejected operation instead
        // of silently submitting the same invalid value again.
        if (modTool === attemptedModTool) modTool.rejected = true;
        const current = store.getState();
        if (focusKey && current.dynInput.active) {
          const visible = current.dynInput.fields.filter((field) => field.visible);
          const index = visible.findIndex((field) => field.key === focusKey);
          if (index >= 0) current.setDynFocus(index);
        }
        current.setDynPending(false);
        reportToolError(error, 'Cannot modify geometry');
      };
      const after = (r: { sketch: SketchDto }) => {
        store.getState().setActiveSketch(r.sketch);
        if (exitAfter) {
          store.getState().setActiveTool(null);
          return;
        }
        // Keep modify tools alive and reset only their picks. The value
        // field stays visible (and locked) so repeated ops reuse it (M1d).
        if (modTool) {
          modTool.picks = [];
          modTool.rejected = false;
        }
        clearGroup(picksGroup);
        setPreviewPositions(null);
      };
      switch (state.activeTool) {
        case 'fillet': {
          if (modTool.picks.length !== 2) return;
          const text = texts.radius ?? (locks.radius !== undefined ? String(locks.radius) : '10');
          void engine
            .filletLines({ l1: modTool.picks[0], l2: modTool.picks[1], radius_text: text })
            .then(after)
            .catch(fail);
          break;
        }
        case 'chamfer': {
          if (modTool.picks.length !== 2) return;
          const text = texts.distance ?? (locks.distance !== undefined ? String(locks.distance) : '10');
          void engine
            .chamferLines({ l1: modTool.picks[0], l2: modTool.picks[1], distance_text: text })
            .then(after)
            .catch(fail);
          break;
        }
        case 'offset': {
          if (modTool.picks.length !== 1) return;
          const text = texts.distance ?? (locks.distance !== undefined ? String(locks.distance) : '10');
          void engine
            .offsetCurve({ entity: modTool.picks[0], distance_text: text, cursor })
            .then(after)
            .catch(fail);
          break;
        }
      }
    };

    /** Scale commit (click or Enter after base point + factor). */
    const commitScale = (exitAfter = false) => {
      if (!engine || !scaleBase) return;
      const texts = dynTexts();
      const locks = dynLocks();
      const text = texts.factor ?? (locks.factor !== undefined ? String(locks.factor) : '2');
      const ids = currentSelection();
      if (ids.length === 0) return;
      void engine
        .scaleEntities({ entity_ids: ids, origin: scaleBase, factor_text: text })
        .then((r) => {
          store.getState().setActiveSketch(r.sketch);
          if (exitAfter) store.getState().setActiveTool(null);
          else endModTool();
        })
        .catch((error) => reportToolError(error, 'Cannot scale selection'));
    };

    /** Polygon commit (second click or Enter). */
    const commitPolygon = (p: Vec2, exitAfter = false) => {
      if (!engine || !polygonRun) return;
      const state = store.getState();
      const center = polygonRun.center;
      const snapped = acquireCreateSnap(p).point;
      const texts = dynTexts();
      const edgesField = state.dynInput.fields.find((f) => f.key === 'edges');
      const fallbackEdges = Number.parseFloat(edgesField?.value ?? '') || 6;
      const edgesValue = texts.edges
        ? engine.evalExpression(texts.edges).then((result) => result.value)
        : Promise.resolve(fallbackEdges);
      const cursorRadius = Math.hypot(snapped.x - center.x, snapped.y - center.y);
      const radiusText = texts.radius ?? cursorRadius.toFixed(6);
      const rotation = (Math.atan2(snapped.y - center.y, snapped.x - center.x) * 180) / Math.PI;
      const mode = state.polygonMode;

      void edgesValue
        .then((value) => {
          if (!Number.isInteger(value) || value < 3 || value > 64) {
            throw new Error('Polygon edge count must be an integer from 3 to 64');
          }
          return engine!.polygonCreate({
            center,
            edge_count: value,
            radius_text: radiusText,
            rotation_deg: rotation,
            mode,
          });
        })
        .then((r) => {
          store.getState().setActiveSketch(r.sketch);
          if (exitAfter) store.getState().setActiveTool(null);
          else endModTool();
        })
        .catch((error) => reportToolError(error, 'Cannot create polygon'));
    };

    /** Modify-tool pointer move (hover previews + dyn live updates). */
    const moveModTool = (p: Vec2, e: PointerEvent) => {
      const state = store.getState();
      switch (state.activeTool) {
        case 'fillet':
        case 'chamfer': {
          if (!modTool) modTool = { picks: [] };
          if (modTool.picks.length < 2) {
            const corner = acquireLineCorner(p, modTool.picks[0]);
            if (corner) {
              showCornerAcquisition(corner);
              previewModTool(corner.point, corner.lines);
              if (state.hoveredEntity !== null) state.setHoveredEntity(null);
            } else {
              showCornerAcquisition(null);
              setPreviewPositions(null);
              const candidate = pickLineOnly(p);
              if (candidate !== state.hoveredEntity) state.setHoveredEntity(candidate);
            }
            // Keep the value field alive + following the cursor while
            // picking (e.g. after an Esc-cancelled op) — M1d.
            const pos = clusterPos(e.clientX, e.clientY);
            if (!state.dynInput.active) {
              state.showDynInput(TOOL_FIELDS[state.activeTool]!, pos.x, pos.y);
              refreshLockValues();
            } else {
              state.updateDynInput({}, {}, pos.x, pos.y);
            }
          } else {
            showCornerAcquisition(null);
            if (!state.dynInput.active) {
              const fields = TOOL_FIELDS[state.activeTool]!;
              const pos = clusterPos(e.clientX, e.clientY);
              state.showDynInput(fields, pos.x, pos.y);
              refreshLockValues();
            }
            previewModTool(p);
          }
          break;
        }
        case 'offset': {
          if (!modTool) modTool = { picks: [] };
          if (modTool.picks.length < 1) {
            const target = acquireEntityTarget(p, CURVE_TARGET_KINDS);
            const candidate = target?.id ?? null;
            if (candidate !== state.hoveredEntity) state.setHoveredEntity(candidate);
            if (target) showSnapMarker(target.point, 'curve');
            else hideSnapMarker();
            const pos = clusterPos(e.clientX, e.clientY);
            if (!state.dynInput.active) {
              state.showDynInput(TOOL_FIELDS.offset!, pos.x, pos.y);
              refreshLockValues();
            } else {
              state.updateDynInput({}, {}, pos.x, pos.y);
            }
          } else {
            if (!state.dynInput.active) {
              const pos = clusterPos(e.clientX, e.clientY);
              state.showDynInput(TOOL_FIELDS.offset!, pos.x, pos.y);
              refreshLockValues();
            }
            previewModTool(p);
          }
          break;
        }
        case 'trim': {
          const target = acquireEntityTarget(p, CURVE_TARGET_KINDS);
          const candidate = target?.id ?? null;
          if (candidate !== state.hoveredEntity) state.setHoveredEntity(candidate);
          if (target) showSnapMarker(target.point, 'curve');
          else hideSnapMarker();
          const seq = ++previewSeq;
          if (candidate !== null && target && engine) {
            trimHover = candidate;
            void engine
              .trimPreview({ entity: candidate, click: target.point })
              .then((preview) => {
                if (seq !== previewSeq) return;
                // Removed piece renders warning-red, kept piece preview-blue.
                clearGroup(dimPreviewGroup);
                renderCurveInto(dimPreviewGroup, preview.removed, 0xe05555, 2);
                for (const kept of preview.kept) {
                  renderCurveInto(dimPreviewGroup, kept, COLOR_PREVIEW, 1.75);
                }
              })
              .catch(() => {
                if (seq === previewSeq) clearGroup(dimPreviewGroup);
              });
          } else if (candidate === null) {
            trimHover = null;
            clearGroup(dimPreviewGroup);
          }
          break;
        }
        case 'extend': {
          const target = acquireEntityTarget(p, LINE_TARGET_KINDS);
          const candidate = target?.id ?? null;
          if (candidate !== state.hoveredEntity) state.setHoveredEntity(candidate);
          if (target) showSnapMarker(target.point, 'curve');
          else hideSnapMarker();
          break;
        }
        case 'break': {
          const target = acquireEntityTarget(p, CURVE_TARGET_KINDS);
          const candidate = target?.id ?? null;
          if (candidate !== state.hoveredEntity) state.setHoveredEntity(candidate);
          if (target) showSnapMarker(target.point, 'curve');
          else hideSnapMarker();
          break;
        }
        case 'mirror': {
          const target = acquireEntityTarget(p, LINE_TARGET_KINDS);
          const candidate = target?.id ?? null;
          if (candidate !== state.hoveredEntity) state.setHoveredEntity(candidate);
          if (target) showSnapMarker(target.point, 'curve');
          else hideSnapMarker();
          break;
        }
        case 'moveCopy': {
          if (moveDrag && state.activeSketch) {
            const acquired = acquireCreateSnap(p);
            const snapped = acquired.point;
            const dx = snapped.x - moveDrag.base.x;
            const dy = snapped.y - moveDrag.base.y;
            showSnapMarker(snapped, nativeSnapKind(acquired.target.kind));
            clearGroup(dimPreviewGroup);
            for (const id of currentSelection()) {
              const ent = state.activeSketch.entities.find((en) => en.id === id);
              if (!ent) continue;
              renderEntityGhost(dimPreviewGroup, ent, dx, dy);
            }
          }
          break;
        }
        case 'scale': {
          if (!scaleBase) {
            const acquired = acquireCreateSnap(p);
            showSnapMarker(acquired.point, nativeSnapKind(acquired.target.kind));
          } else {
            if (!state.dynInput.active) {
              const pos = clusterPos(e.clientX, e.clientY);
              state.showDynInput(TOOL_FIELDS.scale!, pos.x, pos.y);
              refreshLockValues();
            }
            previewScale(p);
          }
          break;
        }
        case 'polygon': {
          if (!polygonRun) {
            const acquired = acquireCreateSnap(p);
            showSnapMarker(acquired.point, nativeSnapKind(acquired.target.kind));
          } else {
            if (!state.dynInput.active) {
              const pos = clusterPos(e.clientX, e.clientY);
              state.showDynInput(TOOL_FIELDS.polygon!, pos.x, pos.y);
              refreshLockValues();
            }
            previewPolygon(p);
          }
          break;
        }
      }
    };

    /** Render a PreviewCurve into a group with a given color/width. */
    const renderCurveInto = (
      group: CAD.Group,
      curve: PreviewCurve,
      color: number,
      linewidth: number,
    ) => {
      switch (curve.kind) {
        case 'line':
          addScreenPolyline(group, [curve.a.x, curve.a.y, 0.14, curve.b.x, curve.b.y, 0.14], color, linewidth);
          break;
        case 'arc':
          addScreenPolyline(
            group,
            tessellateArc(curve.center, curve.radius, curve.start_angle, curve.end_angle, 0.14),
            color,
            linewidth,
          );
          break;
        case 'circle':
          addScreenPolyline(group, tessellateCircle(curve.center, curve.radius, 0.14), color, linewidth);
          break;
      }
    };

    /** Highlight the modify tool's picked entities (fillet/chamfer/offset):
     * without this the first pick is invisible and the tool feels dead. */
    const renderPicks = () => {
      clearGroup(picksGroup);
      if (!modTool || modTool.picks.length === 0) return;
      const sketch = store.getState().activeSketch;
      if (!sketch) return;
      const byId = new Map(sketch.entities.map((e) => [e.id, e]));
      for (const id of modTool.picks) {
        const ent = byId.get(id);
        if (!ent) continue;
        switch (ent.kind) {
          case 'line':
            addScreenPolyline(picksGroup, [ent.start.x, ent.start.y, 0.14, ent.end.x, ent.end.y, 0.14], COLOR_SELECTED, 2);
            break;
          case 'arc':
            addScreenPolyline(picksGroup, tessellateArc(ent.center, ent.radius, ent.start_angle, ent.end_angle, 0.14), COLOR_SELECTED, 2);
            break;
          case 'circle':
            addScreenPolyline(picksGroup, tessellateCircle(ent.center, ent.radius, 0.14), COLOR_SELECTED, 2);
            break;
        }
      }
    };

    /** Names of sketches hidden via the browser eye toggle. */
    const hiddenSketchNames = (): Set<string> => {
      const s = store.getState();
      const names = new Set<string>();
      const walk = (nodes: BrowserNode[]) => {
        for (const n of nodes) {
          if (n.kind === 'sketch' && n.name && s.hidden[n.id]) names.add(n.name);
          walk(n.children);
        }
      };
      if (s.document) walk(s.document.browser);
      return names;
    };

    type LocalSketchPointCandidate = {
      entityId: number;
      point: Vec2;
      kind: SketchPointKindDto;
    };

    const sketchPointCandidates = (entity: EntityDto): LocalSketchPointCandidate[] => {
      switch (entity.kind) {
        case 'point':
          return [{ entityId: entity.id, point: entity.position, kind: { kind: 'point' } }];
        case 'line':
          return [
            { entityId: entity.id, point: entity.start, kind: { kind: 'start' } },
            { entityId: entity.id, point: entity.end, kind: { kind: 'end' } },
          ];
        case 'arc':
          return [
            {
              entityId: entity.id,
              point: {
                x: entity.center.x + Math.cos(entity.start_angle) * entity.radius,
                y: entity.center.y + Math.sin(entity.start_angle) * entity.radius,
              },
              kind: { kind: 'start' },
            },
            {
              entityId: entity.id,
              point: {
                x: entity.center.x + Math.cos(entity.end_angle) * entity.radius,
                y: entity.center.y + Math.sin(entity.end_angle) * entity.radius,
              },
              kind: { kind: 'end' },
            },
            { entityId: entity.id, point: entity.center, kind: { kind: 'center' } },
          ];
        case 'circle':
          return [{ entityId: entity.id, point: entity.center, kind: { kind: 'center' } }];
        case 'spline':
          return entity.points.map((point, index) => ({
            entityId: entity.id,
            point,
            kind: { kind: 'fit_point', index },
          }));
      }
    };

    const sameSketchPoint = (
      candidate: { sketch_name: string; entity_id: number } & SketchPointKindDto,
      pick: FinishedSketchPointPick | null,
    ) =>
      pick !== null &&
      candidate.sketch_name === pick.sketch_name &&
      candidate.entity_id === pick.entity_id &&
      candidate.kind === pick.kind &&
      (candidate.kind === 'fit_point' ? candidate.index : null) ===
        (pick.kind === 'fit_point' ? pick.index : null);

    const resolvedHoleSupportFace = (
      state: ReturnType<typeof useAppStore.getState>,
    ) => {
      const faces = state.solidScene.bodies.flatMap((body) => body.faces);
      return (
        faces.find((face) => face.id === state.selectedFace && face.plane !== null)
        ?? faces.find((face) => face.id === state.hoveredFace && face.plane !== null)
        ?? null
      );
    };

    /** Always-on-top rendering of visible finished sketches in solid mode:
     * each stays on its own plane while the browser eye toggle controls
     * whether it is present at all. */
    const rebuildFinished = () => {
      const s = store.getState();
      const hidden = hiddenSketchNames();
      const holeSupportPlane = s.holeDialogFeature === null
        ? null
        : resolvedHoleSupportFace(s)?.plane ?? null;
      const supportOrigin = holeSupportPlane
        ? new CAD.Vector3(...holeSupportPlane.origin)
        : null;
      const supportNormal = holeSupportPlane
        ? new CAD.Vector3(...holeSupportPlane.normal).normalize()
        : null;
      clearGroup(finishedGroup);
      for (const sketch of s.finishedSketches) {
        if (hidden.has(sketch.name)) continue;
        const g = new CAD.Group();
        const pointPositions: number[] = [];
        const pointColors: number[] = [];
        const emphasisPointPositions: number[] = [];
        const emphasisPointColors: number[] = [];
        const selectedHolePointPositions: number[] = [];
        const pointColor = new CAD.Color();
        const addFinishedPoint = (
          point: Vec2,
          z: number,
          color: number,
          emphasized = false,
        ) => {
          const positions = emphasized ? emphasisPointPositions : pointPositions;
          const colors = emphasized ? emphasisPointColors : pointColors;
          positions.push(point.x, point.y, z);
          pointColor.setHex(color);
          colors.push(pointColor.r, pointColor.g, pointColor.b);
        };
        const u = new CAD.Vector3(...sketch.basis.u);
        const v = new CAD.Vector3(...sketch.basis.v);
        const n = new CAD.Vector3(...sketch.basis.normal);
        g.quaternion.setFromRotationMatrix(new CAD.Matrix4().makeBasis(u, v, n));
        g.position.set(...sketch.basis.origin);
        for (const ent of sketch.entities) {
          const axisSelected =
            s.revolveAxisSelection?.sketchName === sketch.name &&
            s.revolveAxisSelection.entityId === ent.id;
          const axisHovered =
            s.revolveAxisHover?.sketchName === sketch.name &&
            s.revolveAxisHover.entityId === ent.id;
          const curveSelected = s.curvePicker?.selected.some(
            (candidate) =>
              candidate.sketchName === sketch.name && candidate.entityId === ent.id,
          ) ?? false;
          const curveHovered =
            s.curvePicker?.hovered?.sketchName === sketch.name &&
            s.curvePicker.hovered.entityId === ent.id;
          const color = axisSelected || curveSelected
            ? COLOR_SELECTED
            : axisHovered || curveHovered
              ? COLOR_HOVER
              : COLOR_FINISHED;
          const selected = axisSelected || curveSelected;
          const hovered = axisHovered || curveHovered;
          const emphasized = selected || hovered;
          const gripColor = emphasized ? color : COLOR_FINISHED_POINT;
          const linewidth = emphasized ? 1.15 * 1.5 : 1.15;
          const opacity = selected ? 1 : hovered ? 0.95 : 0.42;
          // Mirror the active-sketch point grips in solid mode. Point
          // entities cover line endpoints; curved centers and spline fit
          // points are carried by their parent entity.
          if (s.palette.points) {
            switch (ent.kind) {
              case 'point':
                addFinishedPoint(ent.position, 0.06, gripColor, emphasized);
                break;
              case 'circle':
              case 'arc':
                addFinishedPoint(ent.center, 0.06, gripColor, emphasized);
                break;
              case 'spline':
                ent.points.forEach((point) =>
                  addFinishedPoint(point, 0.06, gripColor, emphasized),
                );
                break;
            }
          }
          const supportsHolePlacement =
            supportNormal !== null && Math.abs(n.dot(supportNormal)) >= 1 - 1e-6;
          if (s.holeDialogFeature !== null && supportsHolePlacement && supportOrigin) {
            for (const candidate of sketchPointCandidates(ent)) {
              const ref = {
                sketch_name: sketch.name,
                entity_id: candidate.entityId,
                ...candidate.kind,
              };
              const selected = s.holePositionSelections.some((pick) =>
                sameSketchPoint(ref, pick),
              );
              const hovered = sameSketchPoint(ref, s.holePositionHover);
              const world = new CAD.Vector3(
                sketch.basis.origin[0]
                  + sketch.basis.u[0] * candidate.point.x
                  + sketch.basis.v[0] * candidate.point.y,
                sketch.basis.origin[1]
                  + sketch.basis.u[1] * candidate.point.x
                  + sketch.basis.v[1] * candidate.point.y,
                sketch.basis.origin[2]
                  + sketch.basis.u[2] * candidate.point.x
                  + sketch.basis.v[2] * candidate.point.y,
              );
              world.addScaledVector(
                supportNormal,
                -world.clone().sub(supportOrigin).dot(supportNormal),
              );
              const local = world.sub(new CAD.Vector3(...sketch.basis.origin));
              const localX = local.dot(u);
              const localY = local.dot(v);
              const localZ = local.dot(n);
              if (selected) {
                selectedHolePointPositions.push(localX, localY, localZ + 0.06);
              } else {
                addFinishedPoint(
                  { x: localX, y: localY },
                  localZ + 0.06,
                  hovered ? COLOR_HOVER : COLOR_FINISHED_POINT,
                  true,
                );
              }
            }
          }
          switch (ent.kind) {
            case 'line': {
              const line = addScreenPolyline(
                g,
                [ent.start.x, ent.start.y, 0.02, ent.end.x, ent.end.y, 0.02],
                color,
                linewidth,
                14,
                false,
                opacity,
              );
              line.userData.finishedSketchEmphasis = emphasized;
              break;
            }
            case 'arc': {
              const line = addScreenPolyline(
                g,
                tessellateArc(
                  ent.center,
                  ent.radius,
                  ent.start_angle,
                  ent.end_angle,
                  0.02,
                ),
                color,
                linewidth,
                14,
                false,
                opacity,
              );
              line.userData.finishedSketchEmphasis = emphasized;
              break;
            }
            case 'circle': {
              const line = addScreenPolyline(
                g,
                tessellateCircle(ent.center, ent.radius, 0.02),
                color,
                linewidth,
                14,
                false,
                opacity,
              );
              line.userData.finishedSketchEmphasis = emphasized;
              break;
            }
            case 'spline': {
              const positions: number[] = [];
              for (const q of ent.tessellation) {
                positions.push(q.x, q.y, 0.02);
              }
              const line = addScreenPolyline(
                g,
                positions,
                color,
                linewidth,
                14,
                false,
                opacity,
              );
              line.userData.finishedSketchEmphasis = emphasized;
              break;
            }
          }
        }
        if (pointPositions.length > 0) {
          const outlineGeometry = new CAD.BufferGeometry();
          outlineGeometry.setAttribute(
            'position',
            new CAD.Float32BufferAttribute(pointPositions, 3),
          );
          const outlineMaterial = new CAD.PointsMaterial({
            size: 6,
            sizeAttenuation: false,
            color: COLOR_FINISHED_POINT_OUTLINE,
            transparent: true,
            opacity: 0.96,
            depthTest: false,
            depthWrite: false,
          });
          const outline = new CAD.Points(outlineGeometry, outlineMaterial);
          outline.renderOrder = 14;
          outline.userData.finishedSketchEmphasis = false;
          outline.userData.finishedSketchPointRole = 'finished-point-outline';
          g.add(outline);

          const geometry = new CAD.BufferGeometry();
          geometry.setAttribute('position', new CAD.Float32BufferAttribute(pointPositions, 3));
          geometry.setAttribute('color', new CAD.Float32BufferAttribute(pointColors, 3));
          const material = new CAD.PointsMaterial({
            size: 4,
            sizeAttenuation: false,
            vertexColors: true,
            transparent: true,
            opacity: 1,
            depthTest: false,
            depthWrite: false,
          });
          const points = new CAD.Points(geometry, material);
          points.renderOrder = 15;
          points.userData.finishedSketchEmphasis = false;
          points.userData.finishedSketchPointRole = 'finished-point-fill';
          g.add(points);
        }
        if (emphasisPointPositions.length > 0) {
          const geometry = new CAD.BufferGeometry();
          geometry.setAttribute(
            'position',
            new CAD.Float32BufferAttribute(emphasisPointPositions, 3),
          );
          geometry.setAttribute(
            'color',
            new CAD.Float32BufferAttribute(emphasisPointColors, 3),
          );
          const material = new CAD.PointsMaterial({
            size: 8,
            sizeAttenuation: false,
            vertexColors: true,
            depthTest: false,
            depthWrite: false,
          });
          const points = new CAD.Points(geometry, material);
          points.renderOrder = 16;
          points.userData.finishedSketchEmphasis = true;
          g.add(points);
        }
        if (selectedHolePointPositions.length > 0) {
          const addSelectedHolePointLayer = (
            size: number,
            color: number,
            renderOrder: number,
            role: 'hole-selected-outline' | 'hole-selected-fill',
          ) => {
            const geometry = new CAD.BufferGeometry();
            geometry.setAttribute(
              'position',
              new CAD.Float32BufferAttribute(selectedHolePointPositions, 3),
            );
            const material = new CAD.PointsMaterial({
              size,
              sizeAttenuation: false,
              color,
              depthTest: false,
              depthWrite: false,
            });
            const points = new CAD.Points(geometry, material);
            points.renderOrder = renderOrder;
            points.userData.finishedSketchEmphasis = true;
            points.userData.finishedSketchPointRole = role;
            g.add(points);
          };
          // A dark 2 px border keeps the bright committed marker legible on
          // both the blue support face and any exposed light viewport.
          addSelectedHolePointLayer(
            12,
            COLOR_EDGE,
            17,
            'hole-selected-outline',
          );
          addSelectedHolePointLayer(
            8,
            COLOR_HOLE_POINT_SELECTED,
            18,
            'hole-selected-fill',
          );
        }
        finishedGroup.add(g);
      }
    };

    const sameProfile = (a: ProfileRefDto | null, b: ProfileRefDto | null) =>
      a?.sketch_name === b?.sketch_name && a?.profile_index === b?.profile_index;

    const closedPath = (points: Vec2[], shape = false): CAD.Shape | CAD.Path | null => {
      if (points.length < 3) return null;
      const path = shape ? new CAD.Shape() : new CAD.Path();
      path.moveTo(points[0].x, points[0].y);
      for (const point of points.slice(1)) path.lineTo(point.x, point.y);
      path.closePath();
      return path;
    };

    const rebuildProfilePicker = () => {
      clearGroup(profileGroup);
      const pickerState = store.getState().profilePicker;
      if (!pickerState) return;
      const hidden = hiddenSketchNames();
      for (const entry of pickerState.catalog) {
        if (hidden.has(entry.sketch_name)) continue;
        const group = new CAD.Group();
        const u = new CAD.Vector3(...entry.basis.u);
        const v = new CAD.Vector3(...entry.basis.v);
        const n = new CAD.Vector3(...entry.basis.normal);
        group.quaternion.setFromRotationMatrix(new CAD.Matrix4().makeBasis(u, v, n));
        group.position.set(...entry.basis.origin);
        for (const profile of entry.profiles.filter(
          (candidate) => candidate.nesting_depth % 2 === 0,
        )) {
          const shape = closedPath(profile.points, true);
          if (!(shape instanceof CAD.Shape)) continue;
          const holes = entry.profiles.filter(
            (candidate) =>
              candidate.nesting_depth % 2 === 1 &&
              candidate.parent_index === profile.index,
          );
          for (const hole of holes) {
            const path = closedPath(hole.points);
            if (path) shape.holes.push(path);
          }
          const ref = {
            sketch_name: entry.sketch_name,
            profile_index: profile.index,
          };
          const selected = pickerState.selected.some((candidate) => sameProfile(candidate, ref));
          const hovered = sameProfile(pickerState.hovered, ref);
          for (const z of [0.045, -0.045]) {
            const geometry = new CAD.ShapeGeometry(shape);
            const material = new CAD.MeshBasicMaterial({
              color: selected
                ? COLOR_EDGE_SELECTED
                : hovered
                  ? COLOR_EDGE_HOVER
                  : 0x2e86b6,
              transparent: true,
              opacity: selected ? 0.3 : hovered ? 0.24 : 0.13,
              side: CAD.DoubleSide,
              // Explicit command candidates remain visible and pickable even
              // when the sketch plane runs through the interior of a body.
              depthTest: false,
              depthWrite: false,
              polygonOffset: true,
              polygonOffsetFactor: -2,
              polygonOffsetUnits: -2,
            });
            const mesh = new CAD.Mesh(geometry, material);
            mesh.position.z = z;
            mesh.renderOrder = 12;
            mesh.userData.profileSurface = true;
            mesh.userData.profileRef = ref;
            group.add(mesh);
          }
          if (selected || hovered) {
            for (const loop of [profile, ...holes]) {
              if (loop.points.length < 2) continue;
              const points = [...loop.points, loop.points[0]];
              const positions = points.flatMap((point) => [
                point.x,
                point.y,
                0.07,
              ]);
              const outline = addScreenPolyline(
                group,
                positions,
                selected ? COLOR_EDGE_SELECTED : COLOR_EDGE_HOVER,
                1.5,
                18,
              );
              outline.userData.profileRef = ref;
              outline.userData.profileHighlightKind = selected
                ? 'selected'
                : 'hover';
            }
          }
        }
        profileGroup.add(group);
      }
    };

    const pickFinishedProfile = (event: PointerEvent): ProfileRefDto | null => {
      if (!store.getState().profilePicker) return null;
      raycaster.setFromCamera(ndcFromEvent(event), camera);
      const hit = raycaster
        .intersectObjects(profileGroup.children, true)
        .find((candidate) => candidate.object.userData.profileSurface === true);
      if (!hit) return null;
      return (hit.object.userData.profileRef as ProfileRefDto | undefined) ?? null;
    };

    /** Screen-space pick for finished straight sketch lines while the
     * non-modal Revolve panel is open. This preserves a stable sketch/entity
     * reference instead of converting the click to transient axis numbers. */
    const pickFinishedSketchLine = (
      event: PointerEvent,
    ): { sketchName: string; entityId: number } | null => {
      const s = store.getState();
      if (s.revolveDialogFeature === null) return null;
      const hidden = hiddenSketchNames();
      const rect = surface.domElement.getBoundingClientRect();
      const distanceToSegment = (
        px: number,
        py: number,
        ax: number,
        ay: number,
        bx: number,
        by: number,
      ) => {
        const dx = bx - ax;
        const dy = by - ay;
        const length2 = dx * dx + dy * dy;
        const t = length2 <= 1e-9
          ? 0
          : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length2));
        return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      };
      const toScreen = (sketch: SketchDto, point: Vec2) => {
        const basis = sketch.basis;
        const world = new CAD.Vector3(
          basis.origin[0] + basis.u[0] * point.x + basis.v[0] * point.y,
          basis.origin[1] + basis.u[1] * point.x + basis.v[1] * point.y,
          basis.origin[2] + basis.u[2] * point.x + basis.v[2] * point.y,
        ).project(camera);
        if (world.z < -1 || world.z > 1) return null;
        return {
          x: rect.left + ((world.x + 1) * rect.width) / 2,
          y: rect.top + ((1 - world.y) * rect.height) / 2,
        };
      };
      let best: { sketchName: string; entityId: number; distance: number } | null = null;
      for (const sketch of s.finishedSketches) {
        if (hidden.has(sketch.name)) continue;
        for (const entity of sketch.entities) {
          if (entity.kind !== 'line') continue;
          const start = toScreen(sketch, entity.start);
          const end = toScreen(sketch, entity.end);
          if (!start || !end) continue;
          const distance = distanceToSegment(
            event.clientX,
            event.clientY,
            start.x,
            start.y,
            end.x,
            end.y,
          );
          if (distance <= MODIFY_CAPTURE_PX && (!best || distance < best.distance)) {
            best = { sketchName: sketch.name, entityId: entity.id, distance };
          }
        }
      }
      return best ? { sketchName: best.sketchName, entityId: best.entityId } : null;
    };

    /** Shared screen-space picker for Sweep paths/rails, Loft
     * centerlines/rails, and Rib centerlines. */
    const pickFinishedSketchCurve = (
      event: PointerEvent,
    ): { sketchName: string; entityId: number } | null => {
      const s = store.getState();
      const pickerState = s.curvePicker;
      if (!pickerState) return null;
      const valid = new Set(
        pickerState.catalog.flatMap((entry) =>
          entry.path_curves.map((curve) => `${entry.sketch_name}:${curve.entity_id}`),
        ),
      );
      const hidden = hiddenSketchNames();
      const rect = surface.domElement.getBoundingClientRect();
      const toScreen = (sketch: SketchDto, point: Vec2) => {
        const basis = sketch.basis;
        const projected = new CAD.Vector3(
          basis.origin[0] + basis.u[0] * point.x + basis.v[0] * point.y,
          basis.origin[1] + basis.u[1] * point.x + basis.v[1] * point.y,
          basis.origin[2] + basis.u[2] * point.x + basis.v[2] * point.y,
        ).project(camera);
        if (projected.z < -1 || projected.z > 1) return null;
        return {
          x: rect.left + ((projected.x + 1) * rect.width) / 2,
          y: rect.top + ((1 - projected.y) * rect.height) / 2,
        };
      };
      const distanceToSegment = (
        point: { x: number; y: number },
        start: { x: number; y: number },
        end: { x: number; y: number },
      ) => {
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const length2 = dx * dx + dy * dy;
        const t = length2 <= 1e-9
          ? 0
          : Math.max(
              0,
              Math.min(
                1,
                ((point.x - start.x) * dx + (point.y - start.y) * dy) / length2,
              ),
            );
        return Math.hypot(
          point.x - (start.x + t * dx),
          point.y - (start.y + t * dy),
        );
      };
      let best: { sketchName: string; entityId: number; distance: number } | null = null;
      for (const sketch of s.finishedSketches) {
        if (hidden.has(sketch.name)) continue;
        for (const entity of sketch.entities) {
          if (!valid.has(`${sketch.name}:${entity.id}`)) continue;
          let localPoints: Vec2[] = [];
          if (entity.kind === 'line') localPoints = [entity.start, entity.end];
          if (entity.kind === 'arc') {
            const positions = tessellateArc(
              entity.center,
              entity.radius,
              entity.start_angle,
              entity.end_angle,
            );
            for (let index = 0; index + 1 < positions.length; index += 3) {
              localPoints.push({ x: positions[index], y: positions[index + 1] });
            }
          }
          if (entity.kind === 'circle') {
            const positions = tessellateCircle(entity.center, entity.radius);
            for (let index = 0; index + 1 < positions.length; index += 3) {
              localPoints.push({ x: positions[index], y: positions[index + 1] });
            }
          }
          if (entity.kind === 'spline') localPoints = entity.tessellation;
          const points = localPoints
            .map((point) => toScreen(sketch, point))
            .filter((point): point is { x: number; y: number } => point !== null);
          let distance = Number.POSITIVE_INFINITY;
          for (let index = 1; index < points.length; index += 1) {
            distance = Math.min(
              distance,
              distanceToSegment(
                { x: event.clientX, y: event.clientY },
                points[index - 1],
                points[index],
              ),
            );
          }
          if (distance <= MODIFY_CAPTURE_PX && (!best || distance < best.distance)) {
            best = { sketchName: sketch.name, entityId: entity.id, distance };
          }
        }
      }
      return best ? { sketchName: best.sketchName, entityId: best.entityId } : null;
    };

    /** Body IDs hidden from the browser tree. */
    const hiddenBodyIds = (): Set<number> => {
      const s = store.getState();
      const ids = new Set<number>();
      const walk = (nodes: BrowserNode[]) => {
        for (const node of nodes) {
          if (
            node.kind === 'body' &&
            node.reference_id !== null &&
            s.hidden[node.id]
          ) {
            ids.add(node.reference_id);
          }
          walk(node.children);
        }
      };
      if (s.document) walk(s.document.browser);
      return ids;
    };

    const hiddenDatumIds = (): Set<number> => {
      const s = store.getState();
      const ids = new Set<number>();
      const walk = (nodes: BrowserNode[]) => {
        for (const node of nodes) {
          if (
            node.kind === 'construction_plane' &&
            node.reference_id !== null &&
            s.hidden[node.id]
          ) {
            ids.add(node.reference_id);
          }
          walk(node.children);
        }
      };
      if (s.document) walk(s.document.browser);
      return ids;
    };

    const rebuildDatumPlanes = () => {
      const s = store.getState();
      const pickingReferences =
        s.mode === 'pickPlane' ||
        s.constructionPlanePickTarget === 'first_reference' ||
        s.constructionPlanePickTarget === 'second_reference';
      const hidden = hiddenDatumIds();
      clearGroup(datumGroup);
      for (const definition of s.datumPlanes) {
        if (hidden.has(definition.datum_id)) continue;
        const group = new CAD.Group();
        const basis = definition.basis;
        group.quaternion.setFromRotationMatrix(
          new CAD.Matrix4().makeBasis(
            new CAD.Vector3(...basis.u),
            new CAD.Vector3(...basis.v),
            new CAD.Vector3(...basis.normal),
          ),
        );
        group.position.set(...basis.origin);
        group.userData.referencePlaneOrigin = [...basis.origin];
        const geometry = new CAD.PlaneGeometry(
          REFERENCE_PLANE_SIZE,
          REFERENCE_PLANE_SIZE,
        );
        const mesh = new CAD.Mesh(
          geometry,
          new CAD.MeshBasicMaterial({
            color: 0xd8a64d,
            transparent: true,
            opacity: pickingReferences ? 0.14 : 0.08,
            side: CAD.DoubleSide,
            depthWrite: false,
          }),
        );
        mesh.userData.datumPlaneId = definition.datum_id;
        mesh.userData.datumPlaneName = definition.name;
        const border = new CAD.LineSegments(
          new CAD.EdgesGeometry(geometry),
          new CAD.LineDashedMaterial({
            color: 0xe0ad52,
            transparent: true,
            opacity: 0.7,
            dashSize: 5,
            gapSize: 3,
          }),
        );
        border.computeLineDistances();
        group.add(mesh, border);
        datumGroup.add(group);
      }
      highlightDatumPlane(null, pickingReferences);
    };

    const activeBodyFeaturePickMode = (
      state: ReturnType<typeof useAppStore.getState>,
    ): BodyFeaturePickMode | null => {
      const kind = state.bodyFeatureDialog?.kind;
      if (kind === 'shell') return 'face-multi';
      if (kind === 'split_body') return 'body-single';
      if (
        kind === 'combine'
        || kind === 'mirror'
        || kind === 'rectangular_pattern'
        || kind === 'circular_pattern'
      ) {
        return 'body-multi';
      }
      return null;
    };

    const updateSolidStyles = () => {
      const s = store.getState();
      const selectedBodyIds = new Set(s.selectedBodies);
      const selectedFaceIds = new Set(s.selectedFaces);
      const hidden = hiddenBodyIds();
      const bodyPickMode = activeBodyFeaturePickMode(s);
      const hoveredBodyId =
        bodyPickMode === 'body-multi' || bodyPickMode === 'body-single'
          ? s.solidScene.bodies.find((body) =>
              body.faces.some((face) => face.id === s.hoveredFace),
            )?.id ?? null
          : null;
      const faceHighlights: Array<{
        bodyId: number;
        faceId: number;
        positions: number[];
        selected: boolean;
      }> = [];
      clearGroup(solidBodyHighlightGroup);
      clearGroup(solidFaceHighlightGroup);
      clearGroup(solidEdgeHighlightGroup);
      solidGroup.traverse((object) => {
        if (object instanceof CAD.Mesh && object.userData.solidFace === true) {
          const material = object.material as CAD.MeshStandardMaterial;
          const bodyId = object.userData.bodyId as number;
          const bodySelectionIndex = s.selectedBodies.indexOf(bodyId);
          const bodySelected = bodySelectionIndex >= 0;
          const faceSelected = selectedFaceIds.has(object.userData.faceId as number);
          const faceHovered = object.userData.faceId === s.hoveredFace;
          material.color.setHex(
            faceSelected
              ? COLOR_FACE_SELECTED
              : faceHovered
                ? COLOR_FACE_HOVER
                : bodySelected
                  ? bodySelectionIndex === 0
                    ? COLOR_BODY_SELECTED
                    : COLOR_BODY_TOOL
                  : bodyBaseColor(bodyId, s.bodyAppearances),
          );
          material.emissive.setHex(faceSelected ? 0x063b55 : faceHovered ? 0x05293a : 0x000000);
          material.emissiveIntensity = faceSelected || faceHovered ? 0.32 : 0;
          if (faceSelected || faceHovered) {
            faceHighlights.push({
              bodyId,
              faceId: object.userData.faceId as number,
              positions:
                (object.userData.boundaryPositions as number[] | undefined) ?? [],
              selected: faceSelected,
            });
          }
        } else if (object instanceof CAD.Line && object.userData.solidEdge === true) {
          const material = object.material as CAD.LineBasicMaterial;
          const selected = s.selectedEdges.includes(object.userData.edgeId as number);
          const hovered = object.userData.edgeId === s.hoveredEdge;
          material.color.setHex(
            selected
              ? COLOR_EDGE_SELECTED
              : hovered
                ? COLOR_EDGE_HOVER
                : selectedBodyIds.has(object.userData.bodyId as number)
                  ? 0x0d75a5
                  : COLOR_EDGE,
          );
          material.opacity =
            selected || hovered || selectedBodyIds.has(object.userData.bodyId as number)
              ? 1
              : 0.72;
          material.depthTest = !(selected || hovered);
          object.renderOrder = selected ? 5 : hovered ? 4 : 0;
        }
      });

      for (const face of faceHighlights) {
        if (face.positions.length < 6) continue;
        const outline = addScreenSegments(
          solidFaceHighlightGroup,
          face.positions,
          face.selected ? COLOR_EDGE_SELECTED : COLOR_EDGE_HOVER,
          1.5,
          19,
          !face.selected,
        );
        outline.userData.faceId = face.faceId;
        outline.userData.bodyId = face.bodyId;
        outline.userData.faceHighlightKind = face.selected ? 'selected' : 'hover';
      }

      for (const body of s.solidScene.bodies) {
        if (hidden.has(body.id)) continue;
        const selectedIndex = s.selectedBodies.indexOf(body.id);
        const selected = selectedIndex >= 0;
        const hovered = body.id === hoveredBodyId;
        if (!selected && !hovered) continue;
        const positions: number[] = [];
        for (const edge of body.edges) {
          for (let index = 1; index < edge.points.length; index += 1) {
            const a = edge.points[index - 1];
            const b = edge.points[index];
            positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
          }
        }
        if (positions.length < 6) continue;
        const toolBody = selected && selectedIndex > 0;
        const outline = addScreenSegments(
          solidBodyHighlightGroup,
          positions,
          selected
            ? toolBody
              ? COLOR_EDGE_SELECTED
              : COLOR_FACE_SELECTED
            : COLOR_EDGE_HOVER,
          1.5,
          16,
          true,
        );
        outline.userData.bodyId = body.id;
        outline.userData.bodyHighlightKind = selected
          ? toolBody
            ? 'tool'
            : 'target'
          : 'hover';
      }

      for (const body of s.solidScene.bodies) {
        if (hidden.has(body.id)) continue;
        for (const edge of body.edges) {
          const selected = s.selectedEdges.includes(edge.id);
          const hovered = edge.id === s.hoveredEdge;
          if ((!selected && !hovered) || edge.points.length < 2) continue;
          const positions = edge.points.flatMap((point) => [
            point.x,
            point.y,
            point.z,
          ]);
          const line = addScreenPolyline(
            solidEdgeHighlightGroup,
            positions,
            selected ? COLOR_EDGE_SELECTED : COLOR_EDGE_HOVER,
            1.5,
            selected ? 23 : 21,
          );
          line.userData.edgeId = edge.id;
          line.userData.edgeHighlightKind = selected ? 'selected' : 'hover';
        }
      }
    };

    /** Rebuild the render layer from the host-neutral mesh/topology DTOs. */
    const rebuildSolids = () => {
      const s = store.getState();
      const hidden = hiddenBodyIds();
      clearGroup(solidGroup);

      for (const body of s.solidScene.bodies) {
        if (hidden.has(body.id)) continue;
        const bodyGroup = new CAD.Group();
        bodyGroup.name = body.name;
        bodyGroup.userData.bodyId = body.id;

        for (const face of body.faces) {
          const positions: number[] = [];
          const normals: number[] = [];
          const first = face.first_index;
          const end = first + face.index_count;
          for (let offset = first; offset < end; offset += 1) {
            const vertex = body.mesh.indices[offset];
            if (vertex === undefined) continue;
            const base = vertex * 3;
            positions.push(
              body.mesh.positions[base] ?? 0,
              body.mesh.positions[base + 1] ?? 0,
              body.mesh.positions[base + 2] ?? 0,
            );
            normals.push(
              body.mesh.normals[base] ?? 0,
              body.mesh.normals[base + 1] ?? 0,
              body.mesh.normals[base + 2] ?? 1,
            );
          }
          if (positions.length < 9) continue;
          const geometry = new CAD.BufferGeometry();
          geometry.setAttribute('position', new CAD.Float32BufferAttribute(positions, 3));
          geometry.setAttribute('normal', new CAD.Float32BufferAttribute(normals, 3));
          geometry.computeBoundingBox();
          geometry.computeBoundingSphere();
          const material = new CAD.MeshStandardMaterial({
            color: bodyBaseColor(body.id, useAppStore.getState().bodyAppearances),
            roughness: 0.72,
            metalness: 0.03,
            side: CAD.DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: 1,
            polygonOffsetUnits: 1,
          });
          const mesh = new CAD.Mesh(geometry, material);
          mesh.name = `${body.name}:${face.key}`;
          mesh.userData.solidFace = true;
          mesh.userData.bodyId = body.id;
          mesh.userData.faceId = face.id;
          mesh.userData.planar = face.plane !== null;
          mesh.userData.boundaryPositions = triangleBoundarySegments(positions);
          bodyGroup.add(mesh);
        }

        for (const edge of body.edges) {
          if (edge.points.length < 2) continue;
          const geometry = new CAD.BufferGeometry().setFromPoints(
            edge.points.map((point) => new CAD.Vector3(point.x, point.y, point.z)),
          );
          const material = new CAD.LineBasicMaterial({
            color: COLOR_EDGE,
            transparent: true,
            opacity: 0.72,
            depthTest: true,
          });
          const line = new CAD.Line(geometry, material);
          line.name = `${body.name}:${edge.key}`;
          line.userData.solidEdge = true;
          line.userData.bodyId = body.id;
          line.userData.edgeId = edge.id;
          line.userData.refinable = edge.refinable;
          line.userData.straight = isStraightSolidEdge(edge.points);
          bodyGroup.add(line);
        }

        solidGroup.add(bodyGroup);
      }
      updateSolidStyles();
    };

    const pickSolidFace = (
      event: PointerEvent,
    ): { bodyId: number; faceId: number; planar: boolean; point: Point3Dto } | null => {
      raycaster.setFromCamera(ndcFromEvent(event), camera);
      const hit = raycaster
        .intersectObjects(solidGroup.children, true)
        .find((candidate) => candidate.object.userData.solidFace === true);
      if (!hit) return null;
      return {
        bodyId: hit.object.userData.bodyId as number,
        faceId: hit.object.userData.faceId as number,
        planar: hit.object.userData.planar as boolean,
        point: { x: hit.point.x, y: hit.point.y, z: hit.point.z },
      };
    };

    /** Hole placement picker for stable points in finished sketches. The
     * selected planar face remains the support while points from coplanar,
     * base, or offset sketches are projected onto that face. */
    const pickFinishedSketchPoint = (
      event: PointerEvent,
    ): {
      pick: FinishedSketchPointPick;
      face: { bodyId: number; faceId: number; point: Point3Dto };
    } | null => {
      const s = store.getState();
      if (s.holeDialogFeature === null) return null;
      const faceHit = pickSolidFace(event);
      const selectedSupport = s.selectedFace === null
        ? null
        : s.solidScene.bodies
            .flatMap((body) => body.faces.map((face) => ({ body, face })))
            .find(({ face }) => face.id === s.selectedFace && face.plane !== null);
      const support = selectedSupport
        ? {
            bodyId: selectedSupport.body.id,
            faceId: selectedSupport.face.id,
            face: selectedSupport.face,
          }
        : faceHit?.planar
          ? {
              bodyId: faceHit.bodyId,
              faceId: faceHit.faceId,
              face: s.solidScene.bodies
                .find((candidate) => candidate.id === faceHit.bodyId)
                ?.faces.find((candidate) => candidate.id === faceHit.faceId),
            }
          : null;
      if (!support) return null;
      const face = support.face;
      if (!face?.plane) return null;

      const hidden = hiddenSketchNames();
      const rect = surface.domElement.getBoundingClientRect();
      const supportOrigin = new CAD.Vector3(...face.plane.origin);
      const supportNormal = new CAD.Vector3(...face.plane.normal).normalize();
      let best: {
        pick: FinishedSketchPointPick;
        projectedWorld: CAD.Vector3;
        distance: number;
      } | null = null;
      for (const sketch of s.finishedSketches) {
        if (hidden.has(sketch.name)) continue;
        const sketchNormal = new CAD.Vector3(...sketch.basis.normal).normalize();
        if (Math.abs(sketchNormal.dot(supportNormal)) < 1 - 1e-6) continue;
        for (const entity of sketch.entities) {
          for (const candidate of sketchPointCandidates(entity)) {
            const basis = sketch.basis;
            const world = new CAD.Vector3(
              basis.origin[0] + basis.u[0] * candidate.point.x + basis.v[0] * candidate.point.y,
              basis.origin[1] + basis.u[1] * candidate.point.x + basis.v[1] * candidate.point.y,
              basis.origin[2] + basis.u[2] * candidate.point.x + basis.v[2] * candidate.point.y,
            );
            const projectedWorld = world.clone();
            projectedWorld.addScaledVector(
              supportNormal,
              -projectedWorld.clone().sub(supportOrigin).dot(supportNormal),
            );
            const projected = projectedWorld.clone().project(camera);
            if (projected.z < -1 || projected.z > 1) continue;
            const screenX = rect.left + ((projected.x + 1) * rect.width) / 2;
            const screenY = rect.top + ((1 - projected.y) * rect.height) / 2;
            const distance = Math.hypot(event.clientX - screenX, event.clientY - screenY);
            if (distance > MODIFY_CAPTURE_PX || (best && distance >= best.distance)) continue;
            best = {
              distance,
              projectedWorld,
              pick: {
                sketch_name: sketch.name,
                entity_id: candidate.entityId,
                ...candidate.kind,
                world: { x: world.x, y: world.y, z: world.z },
              },
            };
          }
        }
      }
      if (!best) return null;
      return {
        pick: best.pick,
        face: {
          bodyId: support.bodyId,
          faceId: support.faceId,
          point: {
            x: best.projectedWorld.x,
            y: best.projectedWorld.y,
            z: best.projectedWorld.z,
          },
        },
      };
    };

    const pickSolidEdge = (
      event: PointerEvent,
      mode: SolidEdgePickMode = 'any',
    ): { bodyId: number; edgeId: number } | null => {
      raycaster.setFromCamera(ndcFromEvent(event), camera);
      raycaster.params.Line = {
        threshold: Math.max(0.15, worldPerPixel() * 6),
      };
      const hit = raycaster
        .intersectObjects(solidGroup.children, true)
        .find((candidate) =>
          candidate.object.userData.solidEdge === true
          && (mode !== 'refinable' || candidate.object.userData.refinable === true)
          && (mode !== 'straight' || candidate.object.userData.straight === true));
      if (!hit) return null;
      return {
        bodyId: hit.object.userData.bodyId as number,
        edgeId: hit.object.userData.edgeId as number,
      };
    };

    const activeSolidEdgePickMode = (
      state: ReturnType<typeof useAppStore.getState>,
    ): Exclude<SolidEdgePickMode, 'any'> | null => {
      if (
        state.filletDialogFeature !== null
        || state.chamferDialogFeature !== null
      ) {
        return 'refinable';
      }
      if (state.constructionPlanePickTarget === 'axis_edge') return 'straight';
      return null;
    };

    type ConstructionReferenceHit = {
      reference: PlaneRef;
      label: string;
      face: { bodyId: number; faceId: number; point: Point3Dto } | null;
    };

    const pickConstructionReference = (
      event: PointerEvent,
    ): ConstructionReferenceHit | null => {
      const face = pickSolidFace(event);
      if (face?.planar) {
        return {
          reference: { type: 'planar_face', face_id: face.faceId },
          label: t('sketch.planarFace'),
          face: {
            bodyId: face.bodyId,
            faceId: face.faceId,
            point: face.point,
          },
        };
      }
      raycaster.setFromCamera(ndcFromEvent(event), camera);
      const datumHit = raycaster
        .intersectObjects(datumGroup.children, true)
        .find((hit) => hit.object.userData.datumPlaneId !== undefined);
      if (datumHit) {
        const datumId = datumHit.object.userData.datumPlaneId as number;
        return {
          reference: { type: 'datum_plane', datum_id: datumId },
          label:
            (datumHit.object.userData.datumPlaneName as string | undefined) ??
            t('browser.constructionPlane'),
          face: null,
        };
      }
      const plane = pickOriginPlane(event);
      if (!plane) return null;
      const definition = PICKER_PLANES.find((candidate) => candidate.plane === plane)!;
      return {
        reference: { type: 'origin_plane', plane },
        label: t(definition.labelKey),
        face: null,
      };
    };

    const renderEntityGhost = (group: CAD.Group, ent: EntityDto, dx: number, dy: number) => {
      const t = (p: Vec2): Vec2 => ({ x: p.x + dx, y: p.y + dy });
      switch (ent.kind) {
        case 'line':
          addScreenPolyline(group, [t(ent.start).x, t(ent.start).y, 0.14, t(ent.end).x, t(ent.end).y, 0.14], COLOR_PREVIEW, 1.75);
          break;
        case 'point':
          addScreenPolyline(group, [t(ent.position).x - 1, t(ent.position).y, 0.14, t(ent.position).x + 1, t(ent.position).y, 0.14], COLOR_PREVIEW, 1.75);
          break;
        case 'circle':
          addScreenPolyline(group, tessellateCircle(t(ent.center), ent.radius, 0.14), COLOR_PREVIEW, 1.75);
          break;
        case 'arc':
          addScreenPolyline(group, tessellateArc(t(ent.center), ent.radius, ent.start_angle, ent.end_angle, 0.14), COLOR_PREVIEW, 1.75);
          break;
        case 'spline': {
          const pts: number[] = [];
          for (const q of ent.tessellation) pts.push(t(q).x, t(q).y, 0.14);
          addScreenPolyline(group, pts, COLOR_PREVIEW, 1.75);
          break;
        }
      }
    };

    /** Modify-tool pointer down (picks + one-click ops). */
    const downModTool = (p: Vec2, e: PointerEvent): boolean => {
      if (!engine) return false;
      const state = store.getState();
      switch (state.activeTool) {
        case 'fillet':
        case 'chamfer': {
          if (!modTool) modTool = { picks: [] };
          if (modTool.rejected) {
            // A pointer event that reached the canvas is, by definition,
            // outside the dynamic-input overlay. Cancel the rejected corner
            // and consume this click; keep the tool armed for a fresh pick.
            endModTool();
            return true;
          }
          if (modTool.picks.length < 2) {
            // Magnetic corner acquisition: clicking anywhere in the visible
            // capture halo commits the exact shared vertex. With no prior
            // pick it selects both incident edges; with one prior pick it
            // acquires the other incident edge.
            const corner = acquireLineCorner(p, modTool.picks[0]);
            if (corner) {
              if (modTool.picks.length === 0) {
                modTool.picks = corner.lines;
              } else {
                const other = corner.lines.find((id) => id !== modTool!.picks[0]);
                if (other !== undefined && !modTool.picks.includes(other)) modTool.picks.push(other);
              }
              showCornerAcquisition(null);
              renderPicks();
              if (!state.dynInput.active) {
                const pos = clusterPos(e.clientX, e.clientY);
                state.showDynInput(TOOL_FIELDS[state.activeTool]!, pos.x, pos.y);
                refreshLockValues();
              }
              if (modTool.picks.length === 2) previewModTool(corner.point);
              return true;
            }
            const hit = pickLineOnly(p);
            if (hit !== null && !modTool.picks.includes(hit)) {
              showCornerAcquisition(null);
              modTool.picks.push(hit);
              renderPicks();
              if (modTool.picks.length === 2) {
                if (!state.dynInput.active) {
                  const pos = clusterPos(e.clientX, e.clientY);
                  state.showDynInput(TOOL_FIELDS[state.activeTool]!, pos.x, pos.y);
                  refreshLockValues();
                }
                previewModTool(p);
              }
            }
            return true;
          }
          commitModTool(p);
          return true;
        }
        case 'offset': {
          if (!modTool) modTool = { picks: [] };
          if (modTool.rejected) {
            endModTool();
            return true;
          }
          if (modTool.picks.length < 1) {
            const target = acquireEntityTarget(p, CURVE_TARGET_KINDS);
            if (target) {
              modTool.picks.push(target.id);
              renderPicks();
              if (!state.dynInput.active) {
                const pos = clusterPos(e.clientX, e.clientY);
                state.showDynInput(TOOL_FIELDS.offset!, pos.x, pos.y);
                refreshLockValues();
              }
              previewModTool(p);
            }
            return true;
          }
          commitModTool(p);
          return true;
        }
        case 'trim': {
          const target = acquireEntityTarget(p, CURVE_TARGET_KINDS);
          if (target) {
            void engine!
              .trimEntity({ entity: target.id, click: target.point })
              .then((r) => store.getState().setActiveSketch(r.sketch))
              .catch((error) => reportToolError(error, 'Cannot trim curve'));
            trimHover = null;
            clearGroup(dimPreviewGroup);
          }
          return true;
        }
        case 'extend': {
          const target = acquireEntityTarget(p, LINE_TARGET_KINDS);
          if (target) {
            void engine!
              .extendEntity({ entity: target.id, click: target.point })
              .then((r) => store.getState().setActiveSketch(r.sketch))
              .catch((error) => reportToolError(error, 'Cannot extend line'));
          }
          return true;
        }
        case 'break': {
          const target = acquireEntityTarget(p, CURVE_TARGET_KINDS);
          if (target) {
            void engine!
              .breakCurve({ entity: target.id, at: target.point })
              .then((r) => store.getState().setActiveSketch(r.sketch))
              .catch((error) => reportToolError(error, 'Cannot break curve'));
          }
          return true;
        }
        case 'mirror': {
          const target = acquireEntityTarget(p, LINE_TARGET_KINDS);
          if (target) {
            const ids = currentSelection();
            if (ids.length === 0) return true;
            void engine!
              .mirrorEntities({ entity_ids: ids, axis_line: target.id })
              .then((r) => store.getState().setActiveSketch(r.sketch))
              .catch((error) => reportToolError(error, 'Cannot mirror selection'));
          }
          return true;
        }
        case 'moveCopy': {
          moveDrag = { base: acquireCreateSnap(p).point, copy: false };
          return true;
        }
        case 'scale': {
          if (!scaleBase) {
            void snapCursor(p).then((snapped) => {
              scaleBase = snapped;
              const pos = clusterPos(e.clientX, e.clientY);
              store.getState().showDynInput(TOOL_FIELDS.scale!, pos.x, pos.y);
              refreshLockValues();
            });
            return true;
          }
          const texts = dynTexts();
          const locks = dynLocks();
          const text = texts.factor ?? (locks.factor !== undefined ? String(locks.factor) : '2');
          const ids = currentSelection();
          if (ids.length === 0) return true;
          void engine!
            .scaleEntities({ entity_ids: ids, origin: scaleBase, factor_text: text })
            .then((r) => {
              store.getState().setActiveSketch(r.sketch);
              endModTool();
            })
            .catch((error) => reportToolError(error, 'Cannot scale selection'));
          return true;
        }
        case 'polygon': {
          if (!polygonRun) {
            void snapCursor(p).then((snapped) => {
              polygonRun = { center: snapped };
              const pos = clusterPos(e.clientX, e.clientY);
              store.getState().showDynInput(TOOL_FIELDS.polygon!, pos.x, pos.y);
              refreshLockValues();
            });
            return true;
          }
          commitPolygon(p);
          return true;
        }
      }
      return false;
    };

    const currentSelection = (): number[] => {
      const s = store.getState();
      const ids = new Set(s.selectedEntities);
      if (s.selectedEntity !== null) ids.add(s.selectedEntity);
      return [...ids];
    };
    const dimKindFor = (entities: number[]): DimensionDto['kind'] | null => {
      const sketch = store.getState().activeSketch;
      if (!sketch || entities.length === 0) return null;
      const byId = new Map(sketch.entities.map((e) => [e.id, e]));
      const kinds = entities.map((id) => byId.get(id)?.kind);
      if (entities.length === 1) {
        if (kinds[0] === 'circle') return 'diameter';
        if (kinds[0] === 'arc') return 'radius';
        return 'distance';
      }
      if (entities.length === 2) {
        if (kinds[0] === 'line' && kinds[1] === 'line') {
          const [l1, l2] = entities.map((id) => byId.get(id));
          if (l1?.kind === 'line' && l2?.kind === 'line') {
            const d1 = { x: l1.end.x - l1.start.x, y: l1.end.y - l1.start.y };
            const d2 = { x: l2.end.x - l2.start.x, y: l2.end.y - l2.start.y };
            const parallel =
              Math.abs(d1.x * d2.y - d1.y * d2.x) < 1e-9 * Math.hypot(d1.x, d1.y) * Math.hypot(d2.x, d2.y);
            return parallel ? 'distance' : 'angle';
          }
        }
        return 'distance';
      }
      return null;
    };

    /** Live preview while placing a dimension. */
    const previewDimPlacement = (p: Vec2) => {
      clearGroup(dimPreviewGroup);
      const sketch = store.getState().activeSketch;
      if (!sketch || !dimPick || dimPick.entities.length === 0) return;
      const kind = dimKindFor(dimPick.entities);
      if (!kind) return;
      const byId = new Map(sketch.entities.map((e) => [e.id, e]));
      const dimLike = { kind, entities: dimPick.entities, text_pos: p };
      const measured = {
        ...dimLike,
        text: formatDimMeasurement(dimLike, byId) ?? '—',
      };
      renderDimAnnotation(dimPreviewGroup, measured, byId, {
        selected: false,
        aligned: sketch.dimension_style === 'aligned',
      });
    };
    const onPointerMove = (e: PointerEvent) => {
      wakeControllerFrame();
      const state = store.getState();

      // Modal nav-tool drag takes over the left button when active.
      if (navDrag) {
        const rawDx = e.clientX - navDrag.x;
        const rawDy = e.clientY - navDrag.y;
        if (Math.hypot(e.clientX - navDrag.startX, e.clientY - navDrag.startY) > 3) {
          navDrag.moved = true;
        }
        navDrag.x = e.clientX;
        navDrag.y = e.clientY;
        const bounded = CAD.boundedPointerDelta(
          rawDx,
          rawDy,
          surface.domElement.clientWidth,
          surface.domElement.clientHeight,
        );
        if (!bounded) return;
        const [dx, dy] = bounded;
        switch (navDrag.tool) {
          case 'orbit':
            api.orbitBy(dx, dy);
            break;
          case 'pan':
            panBy(dx, dy);
            break;
          case 'zoom':
            dollyBy(Math.exp(dy * 0.005));
            break;
          case 'zoomWindow':
            updateZoomRect(navDrag.startX, navDrag.startY, e.clientX, e.clientY);
            break;
        }
        return;
      }

      if (state.mode === 'pickPlane') {
        updateReferencePlaneInteractionScale();
        const faceHit = pickSolidFace(e);
        if (faceHit) {
          highlightDatumPlane(null, true);
          state.setHoveredPlane(null);
          state.setHoveredDatumPlane(null);
          state.setHoveredFace(faceHit.planar ? faceHit.faceId : null);
          const tag = planeTagRef.current;
          if (tag) {
            const rect = surface.domElement.getBoundingClientRect();
            tag.textContent = faceHit.planar
              ? t('sketch.planarFace')
              : t('sketch.nonPlanarFace');
            tag.style.display = 'block';
            tag.style.left = `${e.clientX - rect.left + 14}px`;
            tag.style.top = `${e.clientY - rect.top + 12}px`;
          }
          surface.domElement.style.cursor = faceHit.planar ? 'pointer' : 'not-allowed';
          return;
        }
        state.setHoveredFace(null);
        raycaster.setFromCamera(ndcFromEvent(e), camera);
        const datumHit = raycaster
          .intersectObjects(datumGroup.children, true)
          .find((hit) => hit.object.userData.datumPlaneId !== undefined);
        if (datumHit) {
          state.setHoveredPlane(null);
          const datumId = datumHit.object.userData.datumPlaneId as number;
          state.setHoveredDatumPlane(datumId);
          highlightDatumPlane(datumId, true);
          const tag = planeTagRef.current;
          if (tag) {
            const rect = surface.domElement.getBoundingClientRect();
            tag.textContent =
              (datumHit.object.userData.datumPlaneName as string | undefined) ??
              t('browser.constructionPlane');
            tag.style.display = 'block';
            tag.style.left = `${e.clientX - rect.left + 14}px`;
            tag.style.top = `${e.clientY - rect.top + 12}px`;
          }
          surface.domElement.style.cursor = 'pointer';
          return;
        }
        state.setHoveredDatumPlane(null);
        highlightDatumPlane(null, true);
        const plane = pickOriginPlane(e);
        if (plane !== state.hoveredPlane) state.setHoveredPlane(plane);
        const tag = planeTagRef.current;
        if (tag) {
          if (plane) {
            const def = PICKER_PLANES.find((d) => d.plane === plane)!;
            const rect = surface.domElement.getBoundingClientRect();
            tag.textContent = t(def.labelKey);
            tag.style.display = 'block';
            tag.style.left = `${e.clientX - rect.left + 14}px`;
            tag.style.top = `${e.clientY - rect.top + 12}px`;
          } else {
            tag.style.display = 'none';
          }
        }
        surface.domElement.style.cursor = plane ? 'pointer' : '';
        return;
      }

      if (state.mode === 'solid') {
        if (state.hoveredDatumPlane !== null) state.setHoveredDatumPlane(null);
        if (state.navTool !== 'select') {
          state.setHoveredFace(null);
          state.setHoveredEdge(null);
          state.setRevolveAxisHover(null);
          state.setHoveredCurvePick(null);
          state.setHoveredProfilePick(null);
          return;
        }
        const constructionReferencePicking =
          state.constructionPlanePickTarget === 'first_reference' ||
          state.constructionPlanePickTarget === 'second_reference';
        if (constructionReferencePicking) {
          updateReferencePlaneInteractionScale();
          const referenceHit = pickConstructionReference(e);
          const reference = referenceHit?.reference;
          state.setHoveredFace(
            reference?.type === 'planar_face' ? reference.face_id : null,
          );
          state.setHoveredDatumPlane(
            reference?.type === 'datum_plane' ? reference.datum_id : null,
          );
          state.setHoveredPlane(
            reference?.type === 'origin_plane' ? reference.plane : null,
          );
          highlightDatumPlane(
            reference?.type === 'datum_plane' ? reference.datum_id : null,
            true,
          );
          highlightPickerPlane(
            reference?.type === 'origin_plane' ? reference.plane : null,
          );
          const tag = planeTagRef.current;
          if (tag) {
            if (referenceHit) {
              const rect = surface.domElement.getBoundingClientRect();
              tag.textContent = referenceHit.label;
              tag.style.display = 'block';
              tag.style.left = `${e.clientX - rect.left + 14}px`;
              tag.style.top = `${e.clientY - rect.top + 12}px`;
            } else {
              tag.style.display = 'none';
            }
          }
          state.setHoveredEdge(null);
          state.setHoveredProfilePick(null);
          state.setHoveredCurvePick(null);
          surface.domElement.style.cursor = referenceHit ? 'crosshair' : 'not-allowed';
          return;
        }
        const bodyFeaturePickMode = activeBodyFeaturePickMode(state);
        if (bodyFeaturePickMode) {
          const candidate = pickSolidFace(e);
          const faceHit =
            bodyFeaturePickMode === 'face-multi'
            && state.selectedBody !== null
            && candidate?.bodyId !== state.selectedBody
              ? null
              : candidate;
          state.setRevolveAxisHover(null);
          state.setHoveredCurvePick(null);
          state.setHoveredProfilePick(null);
          state.setHoveredEdge(null);
          state.setHoveredFace(faceHit?.faceId ?? null);
          surface.domElement.style.cursor = faceHit ? 'crosshair' : '';
          return;
        }
        const edgePickMode = activeSolidEdgePickMode(state);
        if (edgePickMode) {
          const edgeHit = pickSolidEdge(e, edgePickMode);
          state.setRevolveAxisHover(null);
          state.setHoveredCurvePick(null);
          state.setHoveredProfilePick(null);
          state.setHoveredEdge(edgeHit?.edgeId ?? null);
          state.setHoveredFace(null);
          surface.domElement.style.cursor = edgeHit ? 'crosshair' : '';
          return;
        }
        const axisLine = pickFinishedSketchLine(e);
        state.setRevolveAxisHover(axisLine);
        if (axisLine) {
          state.setHoveredProfilePick(null);
          state.setHoveredEdge(null);
          state.setHoveredFace(null);
          surface.domElement.style.cursor = 'crosshair';
          return;
        }
        const curve = pickFinishedSketchCurve(e);
        state.setHoveredCurvePick(curve);
        if (curve) {
          state.setHoveredProfilePick(null);
          state.setHoveredEdge(null);
          state.setHoveredFace(null);
          surface.domElement.style.cursor = 'crosshair';
          return;
        }
        const profileHit = pickFinishedProfile(e);
        state.setHoveredProfilePick(profileHit);
        if (profileHit) {
          state.setHoveredEdge(null);
          state.setHoveredFace(null);
          surface.domElement.style.cursor = 'crosshair';
          return;
        }
        if (state.profilePicker?.owner === 'extrude') {
          const faceHit = pickSolidFace(e);
          const planarFace = faceHit?.planar ? faceHit : null;
          state.setHoveredEdge(null);
          state.setHoveredFace(planarFace?.faceId ?? null);
          surface.domElement.style.cursor = planarFace ? 'crosshair' : 'not-allowed';
          return;
        }
        if (state.profilePicker) {
          state.setHoveredEdge(null);
          state.setHoveredFace(null);
          surface.domElement.style.cursor = 'not-allowed';
          return;
        }
        if (state.holeDialogFeature !== null) {
          const point = pickFinishedSketchPoint(e);
          const face = point ? null : pickSolidFace(e);
          state.setHolePositionHover(point?.pick ?? null);
          state.setHoveredEdge(null);
          state.setHoveredFace(point?.face.faceId ?? (face?.planar ? face.faceId : null));
          surface.domElement.style.cursor = point || face?.planar ? 'crosshair' : '';
          return;
        }
        const edgeHit = pickSolidEdge(e);
        const hit = edgeHit ? null : pickSolidFace(e);
        state.setHoveredEdge(edgeHit?.edgeId ?? null);
        state.setHoveredFace(hit?.faceId ?? null);
        surface.domElement.style.cursor = axisLine ? 'crosshair' : edgeHit || hit ? 'pointer' : '';
        return;
      }

      if (state.mode !== 'sketch') return;
      // Track client coords for EVERY sketch tool (not just modify tools):
      // the debounced live-preview while typing synthesizes a PointerEvent
      // from this — a stale/null value positioned the dyn-input cluster at
      // client (0,0), i.e. off-viewport, until the next real mouse move.
      lastPointerClient = { x: e.clientX, y: e.clientY };
      const p = pointerToSketch(e);
      if (!p) return;
      lastSketchPoint = p;

      // Live cursor readout in sketch mm (bottom-right status strip).
      const readout = readoutRef.current;
      if (readout) {
        readout.textContent = t('sketch.coordinates')
          .replace('{x}', p.x.toFixed(3))
          .replace('{y}', p.y.toFixed(3));
      }

      // Start a drag after a 3 px press threshold: dimension text first,
      // then rubber-band point drags.
      if (downInfo && !dragging && !dimDragging && state.activeTool === null) {
        const moved = Math.hypot(e.clientX - downInfo.x, e.clientY - downInfo.y);
        if (moved > 3) {
          if (downInfo.dimCandidate !== null) {
            const entry = dimSprites.find((s) => s.dimId === downInfo!.dimCandidate);
            if (entry) {
              dimDragging = { dimId: downInfo.dimCandidate, sprite: entry.sprite };
            }
          } else if (isPointEntity(downInfo.candidate)) {
            beginPointDrag(downInfo.candidate!, p, e.ctrlKey);
          }
        }
      }

      if (dragging) {
        queuePointDragUpdate(p, e.ctrlKey);
        return;
      }

      // Dimension text drag: move the sprite live, engine commit on release.
      if (dimDragging) {
        dimDragging.sprite.position.set(p.x, p.y, 0.24);
        return;
      }

      // Dimension tool: hover-pick entities, then placement preview.
      if (state.activeTool === 'dimension') {
        if (!dimPick || dimPick.phase === 'pick') {
          const candidate = pickEntity(p);
          if (candidate !== state.hoveredEntity) state.setHoveredEntity(candidate);
        } else {
          previewDimPlacement(p);
        }
        return;
      }

      // Modify tools (fillet/chamfer/offset/trim/extend/break/mirror/
      // moveCopy/scale/polygon).
      if (
        state.activeTool !== null &&
        ['fillet', 'chamfer', 'offset', 'trim', 'extend', 'break', 'mirror', 'moveCopy', 'scale', 'polygon'].includes(
          state.activeTool,
        )
      ) {
        moveModTool(p, e);
        return;
      }

      if (toolRun) {
        previewToolRun(toolRun, p, e);
        return;
      }

      if (state.activeTool !== null && engine) {
        // No run yet: still show the snap marker for the first point.
        if (state.activeTool === 'point') {
          const placement = acquirePointPlacement(p, e.ctrlKey);
          clearGroup(acquireGroup);
          if (placement.extension) {
            addScreenPolyline(
              acquireGroup,
              [
                placement.extension.from.x,
                placement.extension.from.y,
                0.13,
                placement.extension.to.x,
                placement.extension.to.y,
                0.13,
              ],
              COLOR_PREVIEW,
              1.5,
            );
          }
          const acquired = acquireCreateSnap(p);
          const placementKind =
            placement.coincidentWith !== null || placement.extension
              ? 'curve'
              : nativeSnapKind(acquired.target.kind);
          showSnapMarker(placement.position, placementKind);
          const rect = surface.domElement.getBoundingClientRect();
          showChips(
            placement.coincidentWith === null ? [] : ['coincident'],
            e.clientX - rect.left,
            e.clientY - rect.top,
          );
          return;
        }
        const acquired = acquireCreateSnap(
          p,
          !e.ctrlKey && (state.activeTool === 'line' || state.activeTool === 'midpointLine'),
        );
        showSnapMarker(acquired.point, nativeSnapKind(acquired.target.kind));
        return;
      }

      // Hover pre-highlight (select mode only).
      const candidate = pickEntity(p);
      if (candidate !== state.hoveredEntity) state.setHoveredEntity(candidate);
    };

    const onPointerLeave = () => {
      const state = store.getState();
      state.setHoveredPlane(null);
      state.setHoveredDatumPlane(null);
      state.setHoveredFace(null);
      state.setHoveredEdge(null);
      state.setHoveredEntity(null);
      state.setRevolveAxisHover(null);
      state.setHoveredCurvePick(null);
      state.setHoveredProfilePick(null);
      state.setHolePositionHover(null);
      highlightDatumPlane(
        null,
        state.mode === 'pickPlane' ||
          state.constructionPlanePickTarget === 'first_reference' ||
          state.constructionPlanePickTarget === 'second_reference',
      );
      highlightPickerPlane(null);
      const tag = planeTagRef.current;
      if (tag) tag.style.display = 'none';
      surface.domElement.style.cursor = '';
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const state = store.getState();

      // Modal nav tool: left-drag applies it (a clean click in pick-plane
      // mode still picks the plane — handled on pointerup).
      if (state.navTool !== 'select') {
        navDrag = {
          tool: state.navTool,
          x: e.clientX,
          y: e.clientY,
          startX: e.clientX,
          startY: e.clientY,
          moved: false,
        };
        if (state.navTool === 'zoomWindow') {
          updateZoomRect(e.clientX, e.clientY, e.clientX, e.clientY);
        }
        return;
      }

      if (state.mode === 'pickPlane') {
        return;
      }

      if (state.mode === 'solid') {
        const constructionReferencePicking =
          state.constructionPlanePickTarget === 'first_reference' ||
          state.constructionPlanePickTarget === 'second_reference';
        if (constructionReferencePicking) {
          const referenceHit = pickConstructionReference(e);
          if (!referenceHit) return;
          if (referenceHit.face) {
            state.selectSolidFeature(
              'face',
              referenceHit.face.bodyId,
              referenceHit.face.faceId,
              referenceHit.face.point,
              state.constructionPlanePickTarget === 'second_reference',
            );
          } else {
            state.clearSolidSelection();
          }
          state.setConstructionPlanePickedReference(referenceHit.reference);
          return;
        }
        const bodyFeaturePickMode = activeBodyFeaturePickMode(state);
        if (bodyFeaturePickMode) {
          const candidate = pickSolidFace(e);
          const faceHit =
            bodyFeaturePickMode === 'face-multi'
            && state.selectedBody !== null
            && candidate?.bodyId !== state.selectedBody
              ? null
              : candidate;
          if (!faceHit) return;
          state.setSelectedEdges([]);
          if (bodyFeaturePickMode === 'face-multi') {
            if (state.selectedBody === null) state.setSelectedBody(faceHit.bodyId);
            state.selectSolidFeature(
              'face',
              faceHit.bodyId,
              faceHit.faceId,
              faceHit.point,
              true,
            );
          } else {
            state.setSelectedFace(null);
            state.selectSolidFeature(
              'body',
              faceHit.bodyId,
              faceHit.bodyId,
              null,
              bodyFeaturePickMode === 'body-multi',
            );
          }
          return;
        }
        const edgePickMode = activeSolidEdgePickMode(state);
        if (edgePickMode) {
          const edgeHit = pickSolidEdge(e, edgePickMode);
          if (edgeHit) {
            if (state.constructionPlanePickTarget === 'axis_edge') {
              state.selectSolidFeature(
                'edge',
                edgeHit.bodyId,
                edgeHit.edgeId,
                null,
                false,
              );
              state.setConstructionPlanePickedEdge(edgeHit);
            } else if (edgePickMode === 'refinable') {
              const current =
                state.selectedBody === edgeHit.bodyId ? state.selectedEdges : [];
              state.setSelectedBody(edgeHit.bodyId);
              state.setSelectedFace(null);
              state.setSelectedFacePoint(null);
              state.setSelectedEdges(
                current.includes(edgeHit.edgeId)
                  ? current.filter((id) => id !== edgeHit.edgeId)
                  : [...current, edgeHit.edgeId],
              );
            } else {
              state.selectSolidFeature(
                'edge',
                edgeHit.bodyId,
                edgeHit.edgeId,
                null,
                false,
              );
            }
          }
          return;
        }
        const axisLine = pickFinishedSketchLine(e);
        if (axisLine) {
          state.setRevolveAxisSelection(axisLine);
          return;
        }
        const curve = pickFinishedSketchCurve(e);
        if (curve) {
          state.toggleCurvePick(curve);
          return;
        }
        const profileHit = pickFinishedProfile(e);
        if (profileHit) {
          if (state.profilePicker?.owner === 'extrude') {
            state.clearSolidSelection();
          }
          state.toggleProfilePick(profileHit);
          return;
        }
        if (state.profilePicker?.owner === 'extrude') {
          const faceHit = pickSolidFace(e);
          if (faceHit?.planar) {
            state.replaceProfilePicks('extrude', [], '');
            state.selectSolidFeature(
              'face',
              faceHit.bodyId,
              faceHit.faceId,
              faceHit.point,
              false,
            );
          }
          return;
        }
        // A profile command owns the viewport selection role. Do not fall
        // through to ordinary body/face selection and leave a misleading blue
        // model highlight when the click was not a valid closed region.
        if (state.profilePicker) return;
        if (state.holeDialogFeature !== null) {
          const pointHit = pickFinishedSketchPoint(e);
          if (pointHit) {
            state.setSelectedBody(pointHit.face.bodyId);
            state.setSelectedFace(pointHit.face.faceId);
            state.setSelectedFacePoint(pointHit.face.point);
            state.setSelectedEdges([]);
            state.toggleHolePositionSelection(pointHit.pick);
            return;
          }
          const faceHit = pickSolidFace(e);
          if (faceHit?.planar) {
            state.setHolePositionSelections([]);
            state.setSelectedBody(faceHit.bodyId);
            state.setSelectedFace(faceHit.faceId);
            state.setSelectedFacePoint(faceHit.point);
            state.setSelectedEdges([]);
          }
          return;
        }
        const edgeHit = pickSolidEdge(e);
        if (edgeHit) {
          state.selectSolidFeature(
            'edge',
            edgeHit.bodyId,
            edgeHit.edgeId,
            null,
            e.shiftKey || e.ctrlKey || e.metaKey,
          );
          return;
        }
        if (nativeViewportIsActive()) {
          const additive = e.shiftKey || e.ctrlKey || e.metaKey;
          void pickNativeViewport(e, container)
            .then((hit) => {
              const current = store.getState();
              if (current.mode !== 'solid') return;
              if (hit) {
                current.selectSolidFeature(
                  'face',
                  hit.bodyId,
                  hit.faceId,
                  {
                    x: hit.point[0],
                    y: hit.point[1],
                    z: hit.point[2],
                  },
                  additive,
                );
              } else if (!additive) {
                current.clearSolidSelection();
              }
            })
            .catch(() => undefined);
          return;
        }
        const hit = pickSolidFace(e);
        if (hit) {
          state.selectSolidFeature(
            'face',
            hit.bodyId,
            hit.faceId,
            hit.point,
            e.shiftKey || e.ctrlKey || e.metaKey,
          );
        } else if (!(e.shiftKey || e.ctrlKey || e.metaKey)) {
          state.clearSolidSelection();
        }
        return;
      }

      if (state.mode !== 'sketch') return;
      lastPointerClient = { x: e.clientX, y: e.clientY };
      const p = pointerToSketch(e);
      if (!p) return;

      // A spline must consume its second pointerdown before it appends an
      // extra fit point. Other tools are ended by the dedicated `dblclick`
      // listener below. Handling all e.detail >= 2 events here used to drop
      // a legitimate fast second corner while the first snap was pending.
      if (e.detail >= 2 && toolRun?.tool === 'splineFit') {
        commitSpline();
        return;
      }

      // Dimension tool: entity pick, then placement click.
      if (state.activeTool === 'dimension' && engine) {
        if (!dimPick) dimPick = { entities: [], phase: 'pick' };
        if (dimPick.phase === 'pick') {
          const hit = pickEntity(p);
          if (hit !== null) {
            dimPick.entities.push(hit);
            const complete =
              dimPick.entities.length === 2 ||
              (dimPick.entities.length === 1 &&
                store.getState().activeSketch?.entities.find((en) => en.id === hit)?.kind !== 'point');
            if (complete) {
              dimPick.phase = 'place';
              previewDimPlacement(p);
            }
          }
        } else {
          // Placement phase. Clicking ANOTHER entity first upgrades to a
          // two-entity dimension (line+line → distance/angle, point+line,
          // point+point); a click elsewhere places it.
          const hit = pickEntity(p);
          if (hit !== null && dimPick.entities.length === 1 && !dimPick.entities.includes(hit)) {
            const sketchEntities = store.getState().activeSketch?.entities ?? [];
            const first = sketchEntities.find((en) => en.id === dimPick!.entities[0]);
            const second = sketchEntities.find((en) => en.id === hit);
            const twoEntityCombo =
              !!first &&
              !!second &&
              (first.kind === 'line' || first.kind === 'point') &&
              (second.kind === 'line' || second.kind === 'point');
            if (twoEntityCombo) {
              dimPick.entities.push(hit);
              previewDimPlacement(p);
              return;
            }
          }
          // Place the dimension at the drop point.
          const entities = dimPick.entities;
          void engine
            .addDimension({ entities, text_pos: p })
            .then((r) => store.getState().setActiveSketch(r.sketch))
            .catch((err) => {
              store.getState().setConstraintDialog({
                titleKey: 'constraints.invalidTitle',
                message: err?.message ?? 'cannot create dimension',
              });
            });
          endDimensionTool();
        }
        return;
      }

      if (
        state.activeTool !== null &&
        ['fillet', 'chamfer', 'offset', 'trim', 'extend', 'break', 'mirror', 'moveCopy', 'scale', 'polygon'].includes(
          state.activeTool,
        )
      ) {
        downModTool(p, e);
        return;
      }

      if (state.activeTool !== null && engine) {
        if (!toolRun) {
          // A click landing while the first point's snap is still pending
          // becomes the first commit (queued), not a chain restart.
          if (startSnapPending) {
            queuedCommit = p;
            return;
          }
          startToolRun(state.activeTool, p, e);
        } else {
          commitToolRun(toolRun, p, e.ctrlKey);
        }
        return;
      }

      downInfo = { x: e.clientX, y: e.clientY, candidate: pickEntity(p), dimCandidate: pickDimension(p) };
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const state = store.getState();

      if (navDrag) {
        const drag = navDrag;
        navDrag = null;
        if (drag.tool === 'zoomWindow') {
          hideZoomRect();
          if (drag.moved) {
            const rect = surface.domElement.getBoundingClientRect();
            frameRect(
              (Math.min(drag.startX, e.clientX) + Math.abs(e.clientX - drag.startX) / 2) - rect.left,
              (Math.min(drag.startY, e.clientY) + Math.abs(e.clientY - drag.startY) / 2) - rect.top,
              Math.abs(e.clientX - drag.startX),
              Math.abs(e.clientY - drag.startY),
            );
          }
        } else if (!drag.moved && state.mode === 'pickPlane' && state.hoveredPlane) {
          void pickPlane(state.hoveredPlane);
        }
        return;
      }

      // Move/Copy: commit the dragged translation (Alt = copy, D10 choice).
      if (moveDrag && engine) {
        const raw = (state.mode === 'sketch' ? pointerToSketch(e) : null) ?? lastSketchPoint;
        if (raw) {
          const p = acquireCreateSnap(raw).point;
          const dx = p.x - moveDrag.base.x;
          const dy = p.y - moveDrag.base.y;
          const ids = currentSelection();
          if (ids.length > 0 && (Math.abs(dx) > 1e-9 || Math.abs(dy) > 1e-9)) {
            void engine
              .moveCopyEntities({ entity_ids: ids, dx, dy, copy: e.altKey })
              .then((r) => store.getState().setActiveSketch(r.sketch))
              .catch((error) => reportToolError(error, 'Cannot move or copy selection'));
          }
        }
        moveDrag = null;
        clearGroup(dimPreviewGroup);
        return;
      }

      if (dragging && engine) {
        // Pointerup is registered on window, so it can land outside the
        // canvas. The drag's own last valid point guarantees the engine
        // still receives its matching `end` phase in that case.
        const p =
          (state.mode === 'sketch' ? pointerToSketch(e) : null) ??
          lastSketchPoint ??
          dragging.last;
        finishPointDrag(p, e.ctrlKey);
        downInfo = null;
        return;
      }

      // Dimension text drag: commit the new placement on release.
      if (dimDragging && engine) {
        const p = (state.mode === 'sketch' ? pointerToSketch(e) : null) ?? lastSketchPoint;
        if (p) {
          void engine
            .moveDimension({ constraint_id: dimDragging.dimId, text_pos: p })
            .then((r) => store.getState().setActiveSketch(r.sketch))
            .catch((error) => reportToolError(error, 'Cannot move dimension'));
        }
        dimDragging = null;
        downInfo = null;
        return;
      }

      if (state.mode === 'sketch' && downInfo && state.activeTool === null) {
        const moved = Math.hypot(e.clientX - downInfo.x, e.clientY - downInfo.y);
        if (moved <= 3) {
          const cand = downInfo.candidate;
          const dimCand = downInfo.dimCandidate;
          if (dimCand !== null) {
            // Dimension click: select the dimension itself (D9).
            state.setSelectedDimension(dimCand);
            state.setSelectedEntity(null);
            state.setSelectedEntities([]);
          } else if (e.shiftKey || e.ctrlKey || e.metaKey) {
            // Multi-select toggle (constraint application, M1b).
            const cur = new Set(state.selectedEntities);
            if (state.selectedEntity !== null) cur.add(state.selectedEntity);
            let primary = state.selectedEntity;
            if (cand !== null) {
              if (cur.has(cand)) {
                cur.delete(cand);
                if (primary === cand) {
                  const remaining = [...cur];
                  primary = remaining.length > 0 ? remaining[remaining.length - 1] : null;
                }
              } else {
                cur.add(cand);
                primary = cand;
              }
            }
            state.setSelectedEntities([...cur]);
            state.setSelectedEntity(primary);
            state.setSelectedDimension(null);
          } else {
            // Click: select entity, or deselect on empty space.
            state.setSelectedEntity(cand);
            state.setSelectedEntities(cand !== null ? [cand] : []);
            state.setSelectedDimension(null);
          }
        }
      }
      downInfo = null;
    };

    /** Commit plane/face selection on the completed click event. Opening the
     * origin dialog during pointerdown can make that same click activate a
     * newly mounted radio button underneath the cursor. */
    const onCanvasClick = (event: MouseEvent) => {
      const state = store.getState();
      if (state.mode !== 'pickPlane' || state.navTool !== 'select') return;
      const pointer = event as unknown as PointerEvent;
      const faceHit = pickSolidFace(pointer);
      if (faceHit?.planar) {
        pickPlanarFace(faceHit.faceId, faceHit.point);
        return;
      }
      raycaster.setFromCamera(ndcFromEvent(pointer), camera);
      const datumHit = raycaster
        .intersectObjects(datumGroup.children, true)
        .find((hit) => hit.object.userData.datumPlaneId !== undefined);
      if (datumHit) {
        void pickDatumPlane(datumHit.object.userData.datumPlaneId as number);
        return;
      }
      if (state.hoveredPlane) void pickPlane(state.hoveredPlane);
    };

    const onDoubleClick = (e: MouseEvent) => {
      if (toolRun) {
        if (toolRun.tool === 'splineFit') commitSpline();
        else endToolRun();
        return;
      }
      // Double-click a dimension → inline formula-capable editor (D9).
      const state = store.getState();
      if (state.mode !== 'sketch') return;
      const p = pointerToSketch(e as unknown as PointerEvent);
      if (!p) return;
      const dimId = pickDimension(p);
      if (dimId !== null) {
        const dim = state.activeSketch?.dimensions.find((d) => d.constraint_id === dimId);
        if (!dim) return;
        const initial = dim.param_expression ? `=${dim.param_expression}` : dim.text.replace(/[ØR°]/g, '');
        const screen = (() => {
          const v = new CAD.Vector3(dim.text_pos.x, dim.text_pos.y, 0)
            .applyMatrix4(sketchGroup.matrixWorld)
            .project(camera);
          const rect = surface.domElement.getBoundingClientRect();
          return {
            x: rect.left + ((v.x + 1) / 2) * rect.width,
            y: rect.top + ((1 - v.y) / 2) * rect.height,
          };
        })();
        state.setDimEditor({ dimId, initial, x: screen.x, y: screen.y });
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const state = store.getState();
      // Dynamic input captures typing/Tab/Enter/Esc while a tool runs
      // (create tools via toolRun, modify tools via modTool/polygon/scale).
      if (
        state.dynInput.active &&
        (toolRun || modTool || polygonRun || scaleBase) &&
        handleDynKey(e)
      ) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      // Spline commits on Enter (it has no dyn-input fields, so the dyn
      // handler above never sees the key).
      if (e.key === 'Enter' && toolRun?.tool === 'splineFit') {
        commitSpline();
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.key !== 'Escape') return;
      // Escape is application-owned. Prevent AppKit/WebKit's default from
      // also taking the native window out of full-screen mode.
      e.preventDefault();
      // The viewport listens in the capture phase so it sees Escape before
      // the inline input. Dismiss transient dimension feedback here first;
      // a later Escape can then exit the active sketch tool.
      if (state.constraintDialog !== null || state.dimEditor !== null) {
        state.setConstraintDialog(null);
        state.setDimEditor(null);
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      // Modal navigation exits first: Esc returns to Select.
      if (state.navTool !== 'select') {
        state.setNavTool('select');
        e.stopPropagation();
        return;
      }
      if (state.mode === 'solid') {
        if (state.constructionPlanePickTarget !== null) {
          state.setConstructionPlanePickTarget(null);
          e.stopPropagation();
          return;
        }
        if (
          state.selectedBody !== null ||
          state.selectedBodies.length > 0 ||
          state.selectedFace !== null ||
          state.selectedFaces.length > 0 ||
          state.selectedEdges.length > 0
        ) {
          state.clearSolidSelection();
          e.stopPropagation();
        }
        return;
      }
      if (state.mode !== 'sketch') return;
      // Esc ladder: cancel run → exit tool → clear selection.
      if (toolRun) {
        endToolRun();
        e.stopPropagation();
      } else if (state.activeTool !== null) {
        state.setActiveTool(null);
        e.stopPropagation();
      } else if (state.selectedEntity !== null || state.selectedEntities.length > 0) {
        state.setSelectedEntity(null);
        state.setSelectedEntities([]);
        e.stopPropagation();
      }
    };

    surface.domElement.addEventListener('pointermove', onPointerMove);
    surface.domElement.addEventListener('pointerleave', onPointerLeave);
    surface.domElement.addEventListener('pointerdown', onPointerDown);
    surface.domElement.addEventListener('click', onCanvasClick);
    surface.domElement.addEventListener('dblclick', onDoubleClick);
    window.addEventListener('pointerup', onPointerUp);
    const cancelModalNavigation = () => {
      if (navDrag?.tool === 'zoomWindow') hideZoomRect();
      navDrag = null;
      downInfo = null;
    };
    window.addEventListener('pointercancel', cancelModalNavigation);
    window.addEventListener('blur', cancelModalNavigation);
    window.addEventListener('keydown', onKeyDown, true);

    // --- Overlay camera API (Orientation Dial / navigation bar / Look At) ---
    let savedView: { position: CAD.Vector3; target: CAD.Vector3; up: CAD.Vector3 } | null =
      null;

    const getVisibleBounds = () => {
      scene.updateMatrixWorld(true);
      const bounds = new CAD.Box3();
      const include = (group: CAD.Object3D) => {
        if (!group.visible || group.children.length === 0) return;
        bounds.union(new CAD.Box3().setFromObject(group, true));
      };
      if (sketchGroup.visible) include(entityGroup);
      include(solidGroup);
      include(finishedGroup);
      return bounds;
    };

    // Orbit pivot and camera look target are deliberately separate. Panning
    // changes `controls.target`, but orbiting a panned view should still turn
    // the part around its geometric center without first snapping the view.
    const sharedOrbitPivot = initialTarget.clone();
    let sharedOrbitPivotAvailable = false;

    const refreshSharedOrbitPivot = () => {
      scene.updateMatrixWorld(true);
      const solidBounds =
        solidGroup.visible && solidGroup.children.length > 0
          ? new CAD.Box3().setFromObject(solidGroup, true)
          : new CAD.Box3();
      const bounds = solidBounds.isEmpty() ? getVisibleBounds() : solidBounds;
      sharedOrbitPivotAvailable = !bounds.isEmpty();
      if (sharedOrbitPivotAvailable) {
        sharedOrbitPivot
          .addVectors(bounds.min, bounds.max)
          .multiplyScalar(0.5);
      }
    };

    const currentOrbitPivot = () =>
      sharedOrbitPivotAvailable
        ? sharedOrbitPivot.clone()
        : controls.target.clone();

    const orbitFrameQuaternion = (
      position: CAD.Vector3,
      pivot: CAD.Vector3,
      upReference: CAD.Vector3,
    ) => {
      const z = position.clone().sub(pivot).normalize();
      if (z.lengthSq() < 1e-12) z.z = 1;
      let x = new CAD.Vector3().crossVectors(upReference, z).normalize();
      if (x.lengthSq() < 1e-12) {
        z.x += 1e-6;
        x = new CAD.Vector3().crossVectors(upReference, z).normalize();
      }
      const y = new CAD.Vector3().crossVectors(z, x).normalize();
      return new CAD.Quaternion().setFromRotationMatrix(
        new CAD.Matrix4().makeBasis(x, y, z),
      );
    };

    /**
     * Rotate the complete camera rig around a world-space geometry pivot.
     * Rotating position, look target, and up together keeps the pivot at the
     * same screen pixel, so choosing the model center never causes a jump.
     */
    const applyCameraRigTurn = (
      turn: CAD.Quaternion,
      pivot: CAD.Vector3,
    ) => {
      const positionOffset = camera.position
        .clone()
        .sub(pivot)
        .applyQuaternion(turn);
      const targetOffset = controls.target
        .clone()
        .sub(pivot)
        .applyQuaternion(turn);
      camera.position.copy(pivot).add(positionOffset);
      controls.target.copy(pivot).add(targetOffset);
      camera.up.applyQuaternion(turn).normalize();
      camera.lookAt(controls.target);
    };

    const fitVisibleGeometry = () => {
      const bounds = getVisibleBounds();
      if (bounds.isEmpty()) {
        animateCamera(HOME_POSITION.clone(), HOME_TARGET.clone(), WORLD_UP.clone(), 350);
        return;
      }
      const sphere = bounds.getBoundingSphere(new CAD.Sphere());
      const radius = Math.max(1, sphere.radius);
      const verticalFov = CAD.MathUtils.degToRad(camera.fov);
      const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
      const halfFov = Math.max(CAD.MathUtils.degToRad(5), Math.min(verticalFov, horizontalFov) / 2);
      const distance = Math.min(10000, Math.max(2, (radius / Math.sin(halfFov)) * 1.15));
      const viewDirection = camera.position.clone().sub(controls.target).normalize();
      if (viewDirection.lengthSq() < 1e-12) viewDirection.set(1, -1, 1).normalize();
      animateCamera(
        sphere.center.clone().addScaledVector(viewDirection, distance),
        sphere.center,
        camera.up.clone(),
        300,
      );
    };

    let sixDofDriverMotion = false;
    let sixDofDriverTargetUpdated = false;
    let sixDofDriverFocusDistance = Math.max(
      0.001,
      camera.position.distanceTo(controls.target),
    );
    let sixDofDriverControlsWereEnabled = true;
    const sixDofDriverPivot = controls.target.clone();

    const alignSixDofTargetToCamera = (distance: number) => {
      const forward = new CAD.Vector3(0, 0, -1)
        .applyQuaternion(camera.quaternion)
        .normalize();
      controls.target.copy(camera.position).addScaledVector(forward, distance);
    };

    const sixDofDriverView = {
      // Register the complete application workspace with 3DconnexionJS.
      // Feature dialogs live outside the viewport container, so binding only
      // the canvas causes navigation to lose ownership as soon as a workflow
      // control receives focus.
      focusElement: () => document.getElementById('root') ?? container,
      beginMotion: () => {
        if (sixDofDriverMotion) return;
        cancelCameraAnimation();
        sixDofDriverMotion = true;
        sixDofDriverTargetUpdated = false;
        sixDofDriverFocusDistance = Math.max(
          0.001,
          camera.position.distanceTo(controls.target),
        );
        sixDofDriverPivot.copy(controls.target);
        sixDofDriverControlsWereEnabled = controls.enabled;
        // The driver owns the full camera transform while the cap is moving.
        // Pausing CadOrbitControls also prevents any remaining mouse damping from
        // being applied on top of the external camera matrices.
        controls.enabled = false;
        wakeControllerFrame();
      },
      endMotion: () => {
        if (!sixDofDriverMotion) return;
        // Older Navigation Library versions may update only the camera matrix.
        // Preserve their original focus distance when no explicit target was
        // supplied during this movement.
        if (!sixDofDriverTargetUpdated) {
          alignSixDofTargetToCamera(sixDofDriverFocusDistance);
        }
        sixDofDriverMotion = false;
        controls.enabled = sixDofDriverControlsWereEnabled;
        if (controls.enabled) controls.update();
        sixDofDriverPivot.copy(controls.target);
        syncNativeViewportCamera(camera, controls.target);
        wakeControllerFrame();
      },
      getViewMatrix: () => {
        camera.updateMatrixWorld(true);
        return camera.matrixWorld.toArray();
      },
      setViewMatrix: (values: number[]) => {
        if (values.length < 16 || values.some((value) => !Number.isFinite(value))) return;
        cancelCameraAnimation();
        const focusDistance = Math.max(
          0.001,
          camera.position.distanceTo(controls.target),
        );
        const matrix = new CAD.Matrix4().fromArray(values);
        const scale = new CAD.Vector3();
        matrix.decompose(camera.position, camera.quaternion, scale);
        camera.up.set(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
        // During a driver transaction, setTarget is the authoritative look
        // target. Reconstructing it for every matrix callback makes it fight
        // both setTarget and the independently changing rotation pivot.
        if (!sixDofDriverMotion) alignSixDofTargetToCamera(focusDistance);
        camera.updateMatrixWorld(true);
        syncNativeViewportCamera(camera, controls.target);
        wakeControllerFrame();
      },
      getViewTarget: () =>
        controls.target.toArray() as [number, number, number],
      setViewTarget: (target: [number, number, number]) => {
        if (!target.every(Number.isFinite)) return;
        cancelCameraAnimation();
        controls.target.set(...target);
        if (sixDofDriverMotion) sixDofDriverTargetUpdated = true;
        syncNativeViewportCamera(camera, controls.target);
        wakeControllerFrame();
      },
      getViewFrustum: () => {
        const halfHeight =
          camera.near * Math.tan(CAD.MathUtils.degToRad(camera.fov) / 2);
        const halfWidth = halfHeight * camera.aspect;
        return [
          -halfWidth,
          halfWidth,
          -halfHeight,
          halfHeight,
          camera.near,
          camera.far,
        ] as [number, number, number, number, number, number];
      },
      getFov: () => {
        const vertical = CAD.MathUtils.degToRad(camera.fov);
        return (
          2 *
          Math.atan(Math.tan(vertical / 2) * Math.sqrt(1 + camera.aspect * camera.aspect))
        );
      },
      setFov: (diagonalRadians: number) => {
        if (!Number.isFinite(diagonalRadians) || diagonalRadians <= 0) return;
        const vertical =
          2 *
          Math.atan(
            Math.tan(diagonalRadians / 2) /
              Math.sqrt(1 + camera.aspect * camera.aspect),
          );
        camera.fov = CAD.MathUtils.clamp(
          CAD.MathUtils.radToDeg(vertical),
          5,
          150,
        );
        camera.updateProjectionMatrix();
        syncNativeViewportCamera(camera, controls.target);
        wakeControllerFrame();
      },
      getModelExtents: () => {
        const bounds = getVisibleBounds();
        if (bounds.isEmpty()) {
          const center = controls.target;
          const radius = Math.max(1, camera.position.distanceTo(center) / 2);
          return [
            center.x - radius,
            center.y - radius,
            center.z - radius,
            center.x + radius,
            center.y + radius,
            center.z + radius,
          ] as [number, number, number, number, number, number];
        }
        return [
          bounds.min.x,
          bounds.min.y,
          bounds.min.z,
          bounds.max.x,
          bounds.max.y,
          bounds.max.z,
        ] as [number, number, number, number, number, number];
      },
      getPivotPosition: () =>
        sixDofDriverPivot.toArray() as [number, number, number],
      setPivotPosition: (position: [number, number, number]) => {
        if (!position.every(Number.isFinite)) return;
        // The Navigation Library may move its automatic center of rotation
        // after a large pan or dolly. A pivot is not the camera look target:
        // changing CadOrbitControls.target here caused the visible end-of-motion
        // snap reported with larger SpaceMouse movements.
        sixDofDriverPivot.set(...position);
      },
      getPointerPosition: () =>
        controls.target.toArray() as [number, number, number],
      getConstructionPlane: () => {
        const sketch = store.getState().activeSketch;
        if (!sketch) return [0, 0, 1, 0] as [number, number, number, number];
        const normal = new CAD.Vector3(...sketch.basis.normal).normalize();
        const origin = new CAD.Vector3(...sketch.basis.origin);
        return [
          normal.x,
          normal.y,
          normal.z,
          -normal.dot(origin),
        ] as [number, number, number, number];
      },
      fit: fitVisibleGeometry,
    };

    const api: ViewportCameraApi = {
      getSnapshot: () => ({
        position: camera.position.toArray() as [number, number, number],
        target: controls.target.toArray() as [number, number, number],
        up: camera.up.toArray() as [number, number, number],
      }),
      snapToDirection: (direction) => {
        const n = new CAD.Vector3(...direction).normalize();
        const distance = camera.position.distanceTo(controls.target);
        const up =
          Math.abs(n.z) > 0.99 ? new CAD.Vector3(0, n.z > 0 ? 1 : -1, 0) : WORLD_UP.clone();
        animateCamera(
          controls.target.clone().addScaledVector(n, distance),
          controls.target.clone(),
          up,
          250,
        );
      },
      home: () => {
        animateCamera(HOME_POSITION.clone(), HOME_TARGET.clone(), WORLD_UP.clone(), 350);
      },
      fit: fitVisibleGeometry,
      orbitBy: (dx, dy) => {
        const bounded = CAD.boundedPointerDelta(
          dx,
          dy,
          surface.domElement.clientWidth,
          surface.domElement.clientHeight,
        );
        if (!bounded) return;
        [dx, dy] = bounded;
        cancelCameraAnimation();
        // Replicate CadOrbitControls' rotate handling exactly (spherical in the
        // up-mapped frame, deltas scaled by element height), but derive a rigid
        // camera-rig turn around the actual model center rather than assuming
        // the potentially panned look target is also the orbit pivot.
        let pivot = currentOrbitPivot();
        let offset = camera.position.clone().sub(pivot);
        if (offset.lengthSq() < 1e-12) {
          pivot = controls.target.clone();
          offset = camera.position.clone().sub(pivot);
        }
        const frameBefore = orbitFrameQuaternion(
          camera.position,
          pivot,
          camera.up,
        );
        const quat = new CAD.Quaternion().setFromUnitVectors(
          camera.up.clone().normalize(),
          new CAD.Vector3(0, 1, 0),
        );
        const quatInv = quat.clone().invert();
        offset.applyQuaternion(quat);
        const spherical = new CAD.Spherical().setFromVector3(offset);
        const height = Math.max(1, surface.domElement.clientHeight);
        spherical.theta -= (2 * Math.PI * dx) / height;
        spherical.phi -= (2 * Math.PI * dy) / height;
        spherical.makeSafe();
        offset.setFromSpherical(spherical);
        offset.applyQuaternion(quatInv);
        const nextPosition = pivot.clone().add(offset);
        const frameAfter = orbitFrameQuaternion(
          nextPosition,
          pivot,
          camera.up,
        );
        const turn = frameAfter.multiply(frameBefore.invert()).normalize();
        applyCameraRigTurn(turn, pivot);
        wakeControllerFrame();
      },
      navigateSixDof: ({ translation, rotation, deltaSeconds }) => {
        // Never combine an asynchronous 3D-mouse packet with an active mouse
        // navigation gesture. Competing camera writers are perceived as a
        // sudden jump even when each individual delta is valid.
        if (activeCameraPointerButtons.size > 0 || navDrag !== null) return;
        if (
          !Number.isFinite(deltaSeconds) ||
          !translation.every(Number.isFinite) ||
          !rotation.every(Number.isFinite)
        ) {
          return;
        }
        translation = translation.map((value) =>
          CAD.MathUtils.clamp(value, -1, 1),
        ) as [number, number, number];
        rotation = rotation.map((value) =>
          CAD.MathUtils.clamp(value, -1, 1),
        ) as [number, number, number];
        cancelCameraAnimation();
        const dt = Math.min(0.05, Math.max(0.001, deltaSeconds));
        const speedMultiplier = store.getState().sixDofSpeed;
        const pivot = currentOrbitPivot();
        const distance = Math.max(1, camera.position.distanceTo(pivot));
        const right = new CAD.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
        const up = new CAD.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
        const forward = new CAD.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();

        // Object-mode mapping: lateral cap motion pans the rig oppositely so
        // the part follows the cap. Depth motion dollies around the fixed
        // target on every desktop platform; translating the entire rig through
        // a stationary model makes the target drift and can carry the part
        // behind the camera.
        const translationSpeed = distance * 0.9 * dt * speedMultiplier;
        const delta = new CAD.Vector3()
          .addScaledVector(right, -translation[0] * translationSpeed)
          .addScaledVector(up, -translation[2] * translationSpeed);
        camera.position.add(delta);
        controls.target.add(delta);

        if (translation[1] !== 0) {
          const offset = camera.position.clone().sub(controls.target);
          if (offset.lengthSq() > 1e-12) {
            const nextDistance = CAD.MathUtils.clamp(
              offset.length() * Math.exp(translation[1] * 0.9 * dt * speedMultiplier),
              2,
              5_000,
            );
            camera.position.copy(controls.target).add(offset.setLength(nextDistance));
          }
        }

        const angle = 1.65 * dt * speedMultiplier;
        const pitch = new CAD.Quaternion().setFromAxisAngle(right, -rotation[0] * angle);
        const roll = new CAD.Quaternion().setFromAxisAngle(forward, -rotation[1] * angle);
        const yaw = new CAD.Quaternion().setFromAxisAngle(up, -rotation[2] * angle);
        const turn = yaw.multiply(pitch).multiply(roll);
        applyCameraRigTurn(turn, pivot);
        syncNativeViewportCamera(camera, controls.target);
        wakeControllerFrame();
      },
      getSixDofDriverView: () => sixDofDriverView,
      lookAtActivePlane: () => {
        const sketch = store.getState().activeSketch;
        if (sketch) lookAtPlane(sketch.basis, 350);
      },
      worldToScreen: (point) => {
        const projected = new CAD.Vector3(...point).project(camera);
        if (projected.z < -1 || projected.z > 1) return null;
        const rect = surface.domElement.getBoundingClientRect();
        return {
          x: rect.left + ((projected.x + 1) / 2) * rect.width,
          y: rect.top + ((1 - projected.y) / 2) * rect.height,
        };
      },
    };
    apiRef.current = api;
    // E2E/debug handles: let automation verify camera poses and project
    // sketch mm coordinates to screen pixels for deterministic input.
    (window as unknown as { __cameraApi?: ViewportCameraApi }).__cameraApi = api;
    (window as unknown as { __sketchToScreen?: (x: number, y: number) => { x: number; y: number } | null }).__sketchToScreen =
      (x, y) => {
        if (!sketchGroup.visible) return null;
        const v = new CAD.Vector3(x, y, 0).applyMatrix4(sketchGroup.matrixWorld).project(camera);
        const rect = surface.domElement.getBoundingClientRect();
        return {
          x: rect.left + ((v.x + 1) / 2) * rect.width,
          y: rect.top + ((1 - v.y) / 2) * rect.height,
        };
      };
    (
      window as unknown as {
        __worldToScreen?: (x: number, y: number, z: number) => { x: number; y: number };
      }
    ).__worldToScreen = (x, y, z) => api.worldToScreen([x, y, z]) ?? { x: 0, y: 0 };
    (
      window as unknown as {
        __nativeViewportTransient?: () => NativeViewportTransient;
      }
    ).__nativeViewportTransient = () => {
      scene.updateMatrixWorld(true);
      return collectNativeViewportTransient();
    };
    (
      window as unknown as {
        __profileVisualState?: (
          sketchName: string,
          profileIndex: number,
        ) => {
          fillColors: string[];
          fillOpacities: number[];
          overlayKinds: string[];
          overlayWidths: number[];
        };
      }
    ).__profileVisualState = (sketchName, profileIndex) => {
      const result = {
        fillColors: [] as string[],
        fillOpacities: [] as number[],
        overlayKinds: [] as string[],
        overlayWidths: [] as number[],
      };
      profileGroup.traverse((object) => {
        const ref = object.userData.profileRef as ProfileRefDto | undefined;
        if (
          ref?.sketch_name !== sketchName
          || ref.profile_index !== profileIndex
        ) {
          return;
        }
        if (object instanceof CAD.Mesh && object.userData.profileSurface === true) {
          const material = object.material as CAD.MeshBasicMaterial;
          result.fillColors.push(material.color.getHexString());
          result.fillOpacities.push(material.opacity);
        } else if (object instanceof ScreenPolyline) {
          result.overlayKinds.push(
            object.userData.profileHighlightKind as string,
          );
          result.overlayWidths.push((object as ScreenPolyline).material.linewidth);
        }
      });
      return result;
    };
    (
      window as unknown as {
        __solidFaceVisualState?: (faceId: number) => {
          color: string | null;
          overlayKinds: string[];
          overlayWidths: number[];
        };
      }
    ).__solidFaceVisualState = (faceId) => {
      const result = {
        color: null as string | null,
        overlayKinds: [] as string[],
        overlayWidths: [] as number[],
      };
      solidGroup.traverse((object) => {
        if (
          object instanceof CAD.Mesh
          && object.userData.solidFace === true
          && object.userData.faceId === faceId
        ) {
          result.color = (
            object.material as CAD.MeshStandardMaterial
          ).color.getHexString();
        }
      });
      solidFaceHighlightGroup.traverse((object) => {
        if (
          object instanceof ScreenLineSegments
          && object.userData.faceId === faceId
        ) {
          result.overlayKinds.push(object.userData.faceHighlightKind as string);
          result.overlayWidths.push(object.material.linewidth);
        }
      });
      return result;
    };
    (
      window as unknown as {
        __solidBodyVisualState?: (bodyId: number) => {
          faceColors: string[];
          overlayKinds: string[];
          overlayWidths: number[];
        };
      }
    ).__solidBodyVisualState = (bodyId) => {
      const result = {
        faceColors: [] as string[],
        overlayKinds: [] as string[],
        overlayWidths: [] as number[],
      };
      solidGroup.traverse((object) => {
        if (
          object instanceof CAD.Mesh
          && object.userData.solidFace === true
          && object.userData.bodyId === bodyId
        ) {
          result.faceColors.push(
            (object.material as CAD.MeshStandardMaterial).color.getHexString(),
          );
        }
      });
      solidBodyHighlightGroup.traverse((object) => {
        if (
          object instanceof ScreenLineSegments
          && object.userData.bodyId === bodyId
        ) {
          result.overlayKinds.push(object.userData.bodyHighlightKind as string);
          result.overlayWidths.push(object.material.linewidth);
        }
      });
      return result;
    };
    (
      window as unknown as {
        __solidEdgeVisualState?: (edgeId: number) => {
          color: string;
          depthTest: boolean;
          opacity: number;
          renderOrder: number;
          overlayWidths: number[];
          overlayColors: string[];
          overlayKinds: string[];
        } | null;
      }
    ).__solidEdgeVisualState = (edgeId) => {
      let result: {
        color: string;
        depthTest: boolean;
        opacity: number;
        renderOrder: number;
        overlayWidths: number[];
        overlayColors: string[];
        overlayKinds: string[];
      } | null = null;
      solidGroup.traverse((object) => {
        if (
          result === null
          && object instanceof CAD.Line
          && object.userData.solidEdge === true
          && object.userData.edgeId === edgeId
        ) {
          const material = object.material as CAD.LineBasicMaterial;
          result = {
            color: material.color.getHexString(),
            depthTest: material.depthTest,
            opacity: material.opacity,
            renderOrder: object.renderOrder,
            overlayWidths: [],
            overlayColors: [],
            overlayKinds: [],
          };
        }
      });
      solidEdgeHighlightGroup.traverse((object) => {
        if (
          result !== null
          && object instanceof ScreenPolyline
          && object.userData.edgeId === edgeId
        ) {
          const material = (object as ScreenPolyline).material;
          result.overlayWidths.push(material.linewidth);
          result.overlayColors.push(material.color.getHexString());
          result.overlayKinds.push(object.userData.edgeHighlightKind as string);
        }
      });
      return result;
    };
    (
      window as unknown as {
        __finishedSketchVisualState?: () => {
          lineDepthTests: boolean[];
          lineWidths: number[];
          lineOpacities: number[];
          lineEmphasis: boolean[];
          pointDepthTests: boolean[];
          pointSizes: number[];
          pointOpacities: number[];
          pointEmphasis: boolean[];
          pointColors: string[];
          pointRoles: string[];
          pointPositionCounts: number[];
          pointCount: number;
        };
      }
    ).__finishedSketchVisualState = () => {
      const lineDepthTests: boolean[] = [];
      const lineWidths: number[] = [];
      const lineOpacities: number[] = [];
      const lineEmphasis: boolean[] = [];
      const pointDepthTests: boolean[] = [];
      const pointSizes: number[] = [];
      const pointOpacities: number[] = [];
      const pointEmphasis: boolean[] = [];
      const pointColors: string[] = [];
      const pointRoles: string[] = [];
      const pointPositionCounts: number[] = [];
      let pointCount = 0;
      finishedGroup.traverse((object) => {
        if (object instanceof CAD.Points) {
          const material = object.material as CAD.PointsMaterial;
          pointDepthTests.push(material.depthTest);
          pointSizes.push(material.size);
          pointOpacities.push(material.opacity);
          pointEmphasis.push(object.userData.finishedSketchEmphasis === true);
          pointColors.push(material.color.getHexString());
          pointRoles.push(
            (object.userData.finishedSketchPointRole as string | undefined)
              ?? 'finished-sketch',
          );
          const positionCount = object.geometry.getAttribute('position')?.count ?? 0;
          pointPositionCounts.push(positionCount);
          pointCount += positionCount;
          return;
        }
        if (object instanceof ScreenPolyline) {
          const material = (object as ScreenPolyline).material;
          lineDepthTests.push(material.depthTest);
          lineWidths.push(material.linewidth);
          lineOpacities.push(material.opacity);
          lineEmphasis.push(object.userData.finishedSketchEmphasis === true);
        }
      });
      return {
        lineDepthTests,
        lineWidths,
        lineOpacities,
        lineEmphasis,
        pointDepthTests,
        pointSizes,
        pointOpacities,
        pointEmphasis,
        pointColors,
        pointRoles,
        pointPositionCounts,
        pointCount,
      };
    };
    (
      window as unknown as {
        __sketchGridStep?: () => number;
      }
    ).__sketchGridStep = () => sketchGridStep;

    // --- Store subscription: mode transitions, snapshots, hover sync ---
    const store = useAppStore;
    let nativeTransientDirty = true;
    let prevMode = store.getState().mode;
    let lastReferencePickerVisible = referencePickerVisible(store.getState());
    let lastSketch: SketchDto | null = null;
    let lastHoveredPlane: OriginPlane | null = null;
    let lastLookAtNonce = store.getState().lookAtNonce;
    let lastSelection: {
      sel: number | null;
      multi: string;
      hov: number | null;
      dim: number | null;
    } = {
      sel: null,
      multi: '',
      hov: null,
      dim: null,
    };
    let groundFade = 1;
    let sketchFade = 0;
    let groundTarget = 1;
    let sketchTarget = 0;
    let lastNavTool = store.getState().navTool;
    let lastActiveTool = store.getState().activeTool;
    let lastFinished = store.getState().finishedSketches;
    let lastHidden = store.getState().hidden;
    let lastRevolveAxisSelection = store.getState().revolveAxisSelection;
    let lastRevolveAxisHover = store.getState().revolveAxisHover;
    let lastHoleDialogFeature = store.getState().holeDialogFeature;
    let lastHolePositionSelections = store.getState().holePositionSelections;
    let lastHolePositionHover = store.getState().holePositionHover;
    let lastHoleSupportFace = resolvedHoleSupportFace(store.getState())?.id ?? null;
    let lastCurvePicker = store.getState().curvePicker;
    rebuildFinished(); // initial (finished sketches may already be loaded)
    let lastProfilePicker = store.getState().profilePicker;
    let lastProfileHidden = store.getState().hidden;
    rebuildProfilePicker();
    let lastSolidScene = store.getState().solidScene;
    let lastSolidHidden = store.getState().hidden;
    let lastSolidDocument = store.getState().document;
    let lastBodyAppearances = store.getState().bodyAppearances;
    let lastSolidSelection = {
      body: store.getState().selectedBody,
      bodies: store.getState().selectedBodies.join(','),
      face: store.getState().selectedFace,
      faces: store.getState().selectedFaces.join(','),
      hover: store.getState().hoveredFace,
      edges: store.getState().selectedEdges.join(','),
      edgeHover: store.getState().hoveredEdge,
    };
    rebuildSolids();
    refreshSharedOrbitPivot();
    let lastDatumPlanes = store.getState().datumPlanes;
    let lastDatumHidden = store.getState().hidden;
    let lastDatumDocument = store.getState().document;
    rebuildDatumPlanes();
    let lastPalette = {
      points: store.getState().palette.points,
      dimensions: store.getState().palette.dimensions,
      constraints: store.getState().palette.constraints,
    };

    // Track ground-grid rebuild with fade-aware opacity.
    const updateGridFades = (dt: number) => {
      const step = dt * 4; // ~250 ms fade
      groundFade += Math.sign(groundTarget - groundFade) * Math.min(step, Math.abs(groundTarget - groundFade));
      sketchFade += Math.sign(sketchTarget - sketchFade) * Math.min(step, Math.abs(sketchTarget - sketchFade));
      for (const grid of [groundFine, groundMajor]) {
        if (grid) grid.visible = groundFade > 0.01;
      }
      if (groundFine) (groundFine.material as CAD.LineBasicMaterial).opacity = 0.5 * groundFade;
      if (groundMajor) (groundMajor.material as CAD.LineBasicMaterial).opacity = 0.85 * groundFade;
      sketchGridFine.visible = sketchFade > 0.01;
      sketchGridMajor.visible = sketchFade > 0.01;
      for (const child of sketchGridFine.children) {
        ((child as CAD.LineSegments).material as CAD.LineBasicMaterial).opacity = 0.5 * sketchFade;
      }
      for (const child of sketchGridMajor.children) {
        ((child as CAD.LineSegments).material as CAD.LineBasicMaterial).opacity = 0.9 * sketchFade;
      }
      return (
        Math.abs(groundTarget - groundFade) > 1e-4 ||
        Math.abs(sketchTarget - sketchFade) > 1e-4
      );
    };

    const unsub = store.subscribe((s) => {
      nativeTransientDirty = true;
      wakeControllerFrame();
      const referencesVisible = referencePickerVisible(s);
      if (referencesVisible !== lastReferencePickerVisible) {
        lastReferencePickerVisible = referencesVisible;
        setPickerVisible(referencesVisible);
        highlightPickerPlane(null);
        highlightDatumPlane(null, referencesVisible);
      }
      // Finished-sketch rendering: refresh on list or eye-toggle change.
      if (
        s.finishedSketches !== lastFinished ||
        s.hidden !== lastHidden ||
        s.revolveAxisSelection !== lastRevolveAxisSelection ||
        s.revolveAxisHover !== lastRevolveAxisHover ||
        s.holeDialogFeature !== lastHoleDialogFeature ||
        s.holePositionSelections !== lastHolePositionSelections ||
        s.holePositionHover !== lastHolePositionHover ||
        (
          s.holeDialogFeature !== null
          && (resolvedHoleSupportFace(s)?.id ?? null) !== lastHoleSupportFace
        ) ||
        s.curvePicker !== lastCurvePicker
      ) {
        lastFinished = s.finishedSketches;
        lastHidden = s.hidden;
        lastRevolveAxisSelection = s.revolveAxisSelection;
        lastRevolveAxisHover = s.revolveAxisHover;
        lastHoleDialogFeature = s.holeDialogFeature;
        lastHolePositionSelections = s.holePositionSelections;
        lastHolePositionHover = s.holePositionHover;
        lastHoleSupportFace = resolvedHoleSupportFace(s)?.id ?? null;
        lastCurvePicker = s.curvePicker;
        rebuildFinished();
        refreshSharedOrbitPivot();
      }
      if (s.profilePicker !== lastProfilePicker || s.hidden !== lastProfileHidden) {
        lastProfilePicker = s.profilePicker;
        lastProfileHidden = s.hidden;
        rebuildProfilePicker();
      }
      if (
        s.solidScene !== lastSolidScene ||
        s.hidden !== lastSolidHidden ||
        s.document !== lastSolidDocument ||
        s.bodyAppearances !== lastBodyAppearances
      ) {
        lastSolidScene = s.solidScene;
        lastSolidHidden = s.hidden;
        lastSolidDocument = s.document;
        lastBodyAppearances = s.bodyAppearances;
        rebuildSolids();
        refreshSharedOrbitPivot();
      }
      if (
        s.datumPlanes !== lastDatumPlanes ||
        s.hidden !== lastDatumHidden ||
        s.document !== lastDatumDocument
      ) {
        lastDatumPlanes = s.datumPlanes;
        lastDatumHidden = s.hidden;
        lastDatumDocument = s.document;
        rebuildDatumPlanes();
      }
      if (
        s.selectedBody !== lastSolidSelection.body ||
        s.selectedBodies.join(',') !== lastSolidSelection.bodies ||
        s.selectedFace !== lastSolidSelection.face ||
        s.selectedFaces.join(',') !== lastSolidSelection.faces ||
        s.hoveredFace !== lastSolidSelection.hover
        || s.selectedEdges.join(',') !== lastSolidSelection.edges
        || s.hoveredEdge !== lastSolidSelection.edgeHover
      ) {
        lastSolidSelection = {
          body: s.selectedBody,
          bodies: s.selectedBodies.join(','),
          face: s.selectedFace,
          faces: s.selectedFaces.join(','),
          hover: s.hoveredFace,
          edges: s.selectedEdges.join(','),
          edgeHover: s.hoveredEdge,
        };
        updateSolidStyles();
      }
      const prev = prevMode;
      if (s.mode !== prev) {
        // Update prevMode FIRST so re-entrant notifications (if any store
        // write ever happens inside a branch) see a consistent mode.
        prevMode = s.mode;
        if (s.mode === 'sketch' && s.activeSketch) {
          savedView = {
            position: camera.position.clone(),
            target: controls.target.clone(),
            up: camera.up.clone(),
          };
          groundTarget = 0;
          sketchTarget = 1;
          setupSketchScene(s.activeSketch);
          lookAtPlane(s.activeSketch.basis, 400);
          if (readoutRef.current) readoutRef.current.style.display = 'block';
        }
        if (prev === 'sketch' && s.mode !== 'sketch') {
          teardownSketchScene();
          groundTarget = 1;
          sketchTarget = 0;
          if (readoutRef.current) readoutRef.current.style.display = 'none';
          if (savedView) {
            animateCamera(savedView.position, savedView.target, savedView.up, 400);
            savedView = null;
          }
        }
      }

      if (s.activeSketch !== lastSketch) {
        lastSketch = s.activeSketch;
        if (s.mode === 'sketch' && s.activeSketch) {
          rebuildEntities(s.activeSketch);
          rebuildDimensions(s.activeSketch);
        }
      }

      if (
        s.mode === 'sketch' &&
        (s.selectedEntity !== lastSelection.sel ||
          s.selectedEntities.join(',') !== lastSelection.multi ||
          s.hoveredEntity !== lastSelection.hov ||
          s.selectedDimension !== lastSelection.dim)
      ) {
        lastSelection = {
          sel: s.selectedEntity,
          multi: s.selectedEntities.join(','),
          hov: s.hoveredEntity,
          dim: s.selectedDimension,
        };
        if (s.activeSketch) {
          rebuildEntities(s.activeSketch);
          rebuildDimensions(s.activeSketch);
        }
      }

      if (s.hoveredPlane !== lastHoveredPlane) {
        lastHoveredPlane = s.hoveredPlane;
        highlightPickerPlane(s.hoveredPlane);
      }

      if (s.lookAtNonce !== lastLookAtNonce) {
        lastLookAtNonce = s.lookAtNonce;
        api.lookAtActivePlane();
      }

      // Sketch Palette toggles: grid fade + entity/dimension/glyph
      // visibility (Points / Dimensions / Constraints controls).
      sketchTarget = s.mode === 'sketch' && s.palette.sketchGrid ? 1 : 0;
      if (
        s.palette.points !== lastPalette.points ||
        s.palette.dimensions !== lastPalette.dimensions ||
        s.palette.constraints !== lastPalette.constraints
      ) {
        lastPalette = {
          points: s.palette.points,
          dimensions: s.palette.dimensions,
          constraints: s.palette.constraints,
        };
        if (s.mode === 'sketch' && s.activeSketch) {
          rebuildEntities(s.activeSketch);
          rebuildDimensions(s.activeSketch);
        }
      }

      // Tool switch resets every in-progress sketch op, including Dimension's
      // viewport-local entity buffer. Without this reset, Escape followed by
      // reactivating Dimension resumes the cancelled line selection.
      if (s.activeTool !== lastActiveTool) {
        lastActiveTool = s.activeTool;
        endDimensionTool();
        endModTool();
        endToolRun();
        // M1d: value-entry modify tools show their dynamic
        // input field IMMEDIATELY on activation — a silent tool feels dead.
        if (
          s.mode === 'sketch' &&
          s.activeTool !== null &&
          ['fillet', 'chamfer', 'offset'].includes(s.activeTool)
        ) {
          modTool = { picks: [] };
          const rect = surface.domElement.getBoundingClientRect();
          const cx = lastPointerClient?.x ?? rect.left + rect.width / 2;
          const cy = lastPointerClient?.y ?? rect.top + rect.height / 2;
          const pos = clusterPos(cx, cy);
          store.getState().showDynInput(TOOL_FIELDS[s.activeTool]!, pos.x, pos.y);
          refreshLockValues();
        }
      }

      // Modal nav-tool cursor feedback.
      if (s.navTool !== lastNavTool) {
        lastNavTool = s.navTool;
        const cursors: Record<string, string> = {
          orbit: 'grab',
          pan: 'move',
          zoom: 'zoom-in',
          zoomWindow: 'crosshair',
        };
        surface.domElement.style.cursor = cursors[s.navTool] ?? '';
      }
    });

    // --- Resize handling ---
    const resizeObserver = new ResizeObserver(() => {
      const { clientWidth: w, clientHeight: h } = container;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      surface.setSize(w, h);
      for (const material of lineMaterials) material.resolution.set(w, h);
      wakeControllerFrame();
    });
    resizeObserver.observe(container);
    surface.setSize(container.clientWidth, container.clientHeight);
    camera.aspect = container.clientWidth / Math.max(1, container.clientHeight);
    camera.updateProjectionMatrix();

    // --- Event-driven interaction update loop ---
    let raf = 0;
    let lastTime = performance.now();
    const tick = () => {
      raf = 0;
      const now = performance.now();
      const dt = Math.min(0.1, (now - lastTime) / 1000);
      lastTime = now;

      if (camAnim) stepCameraAnimation(now);
      const controlsChanged = controls.enabled ? controls.update() : false;
      syncNativeViewportCamera(camera, controls.target);
      // Manual navigation uses CadOrbitControls.target as its center. Keep the
      // driver's separate pivot ready for the next transaction without ever
      // letting a driver auto-pivot move the camera target mid-transaction.
      if (!sixDofDriverMotion) sixDofDriverPivot.copy(controls.target);
      const gridFading = updateGridFades(dt);

      // Adaptive grid levels.
      const distance = camera.position.distanceTo(controls.target);
      const wpp = worldPerPixel();
      const groundLvl = Math.max(-1, Math.min(3, Math.floor(Math.log10(distance / 25))));
      if (groundLvl !== groundLevel) {
        groundLevel = groundLvl;
        rebuildGroundGrid(groundLvl);
      }
      if (sketchGroup.visible) {
        const nextGridStep = adaptiveSketchGridStep(wpp);
        sketchGridStep = nextGridStep;
        if (renderedSketchGridStep !== nextGridStep) {
          renderedSketchGridStep = nextGridStep;
          rebuildSketchGrid(nextGridStep);
        }
        engineGridStepRequested = nextGridStep;
        syncEngineGridStep();

        // Keep the finite grid patch centered around the current view while
        // preserving intersections on world-coordinate multiples.
        sketchGroup.updateWorldMatrix(true, false);
        const localTarget = sketchGroup.worldToLocal(controls.target.clone());
        const majorSpacing = nextGridStep * 10;
        const gridX = snapToGrid(localTarget.x, majorSpacing);
        const gridY = snapToGrid(localTarget.y, majorSpacing);
        sketchGridFine.position.set(gridX, gridY, -0.02);
        sketchGridMajor.position.set(gridX, gridY, -0.01);

        // Keep the sketch plane equation current for pointer mapping.
        const n = new CAD.Vector3(0, 0, 1).applyQuaternion(sketchGroup.quaternion);
        const o = sketchGroup.position;
        sketchPlane.setFromNormalAndCoplanarPoint(n, o);
      } else {
        // The runtime preference may be used by a sketch started before the
        // next frame, so keep the last valid spacing queued engine-side.
        engineGridStepRequested = sketchGridStep;
        syncEngineGridStep();
      }

      // Constant screen-size sprites (glyphs, markers).
      for (const { sprite, px } of scaledSprites) {
        sprite.scale.setScalar(wpp * px);
      }

      // Dimension text: constant screen size with optional alignment rotation
      // (ISO: upright, above an unbroken dimension line — D4.5).
      for (const { sprite, px, dirLocal, aligned } of dimSprites) {
        const texture = (sprite.material as CAD.SpriteMaterial).map;
        const aspect = texture ? (texture.image?.width ?? 4) / (texture.image?.height ?? 1) : 4;
        sprite.scale.set(wpp * px * aspect, wpp * px, 1);
        if (dirLocal && aligned) {
          const v = dirLocal.clone().applyMatrix4(sketchGroup.matrixWorld).project(camera);
          let rot = Math.atan2(v.y, v.x);
          // Keep text readable (flip beyond ±90°).
          if (rot > Math.PI / 2) rot -= Math.PI;
          else if (rot < -Math.PI / 2) rot += Math.PI;
          (sprite.material as CAD.SpriteMaterial).rotation = rot;
        } else {
          (sprite.material as CAD.SpriteMaterial).rotation = 0;
        }
      }
      for (const { mesh, px } of dimArrows) {
        mesh.scale.setScalar(wpp * px);
      }

      const native = nativeViewportIsActive();
      scene.updateMatrixWorld(true);
      // Solid-command fills and arrows are world-space retained Bevy assets.
      // Camera motion updates their native transforms directly; rebuilding and
      // hashing their JS payload on every orbit frame defeats that contract.
      // Active-sketch annotations are the only camera-projected transient data
      // and therefore keep the camera-frequency collection path.
      if (native && (nativeTransientDirty || sketchGroup.visible)) {
        syncNativeViewportPreview(collectNativeViewportTransient());
        nativeTransientDirty = false;
      }
      if (
        !native ||
        camAnim !== null ||
        sixDofDriverMotion ||
        controlsChanged ||
        gridFading
      ) {
        wakeControllerFrame();
      }
    };
    wakeControllerFrame = () => {
      if (raf === 0) raf = requestAnimationFrame(tick);
    };
    wakeControllerFrame();

    return () => {
      preservedCameraSnapshot = api.getSnapshot();
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      unsub();
      surface.domElement.removeEventListener('pointerdown', onNavPointerDown);
      surface.domElement.removeEventListener('pointermove', onPointerMove);
      surface.domElement.removeEventListener('pointerleave', onPointerLeave);
      surface.domElement.removeEventListener('pointerdown', onPointerDown);
      surface.domElement.removeEventListener('click', onCanvasClick);
      surface.domElement.removeEventListener('dblclick', onDoubleClick);
      surface.domElement.removeEventListener('wheel', cancelCameraAnimation);
      surface.domElement.removeEventListener('wheel', onWheelNav, { capture: true });
      window.removeEventListener('pointerup', onNavPointerUp);
      window.removeEventListener('pointercancel', cancelCapturedNavigation);
      window.removeEventListener('blur', cancelCapturedNavigation);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', cancelModalNavigation);
      window.removeEventListener('blur', cancelModalNavigation);
      window.removeEventListener('keydown', onKeyDown, true);
      controls.removeEventListener('change', onControlsChange);
      wakeControllerFrame = () => undefined;
      controls.dispose();
      scene.traverse((child) => {
        if (child instanceof CAD.Mesh || child instanceof CAD.Line || child instanceof CAD.Points || child instanceof CAD.Sprite) {
          child.geometry?.dispose?.();
          const material = child.material as CAD.Material | CAD.Material[] | undefined;
          if (Array.isArray(material)) material.forEach((m) => m.dispose());
          else material?.dispose?.();
        }
      });
      glyphTextureCache.forEach((texture) => texture.dispose());
      surface.dispose();
      container.removeChild(surface.domElement);
      detachNativeViewport();
      apiRef.current = null;
      const w = window as unknown as {
        __cameraApi?: ViewportCameraApi;
        __sketchToScreen?: unknown;
        __worldToScreen?: unknown;
        __profileVisualState?: unknown;
        __solidFaceVisualState?: unknown;
        __solidBodyVisualState?: unknown;
        __solidEdgeVisualState?: unknown;
        __finishedSketchVisualState?: unknown;
        __sketchGridStep?: unknown;
        __nativeViewportTransient?: unknown;
      };
      delete w.__cameraApi;
      delete w.__sketchToScreen;
      delete w.__worldToScreen;
      delete w.__profileVisualState;
      delete w.__solidFaceVisualState;
      delete w.__solidBodyVisualState;
      delete w.__solidEdgeVisualState;
      delete w.__finishedSketchVisualState;
      delete w.__sketchGridStep;
      delete w.__nativeViewportTransient;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-hidden"
      style={{
        background: 'linear-gradient(180deg, var(--vp-top) 0%, var(--vp-bottom) 100%)',
      }}
    >
      {/* Active viewport selection role (top-center, mirrored by Bevy HUD). */}
      {selectionPrompt && (
        <div
          data-native-hud="prompt"
          data-native-viewport-overlay
          className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded border border-edge bg-header/90 px-3 py-1.5 text-xs text-ink backdrop-blur-sm"
        >
          {selectionPrompt}
        </div>
      )}
      {/* Plane name tag (follows the cursor in pick-plane mode). */}
      <div
        ref={planeTagRef}
        data-native-viewport-overlay
        className="pointer-events-none absolute z-10 hidden rounded border border-edge bg-header/95 px-1.5 py-0.5 text-[10px] text-ink"
        style={{ display: 'none' }}
      />
      {/* Inference glyph chips near the cursor (H / V / coincident). */}
      <div
        ref={chipsRef}
        data-testid="inference-chips"
        data-native-viewport-overlay
        className="pointer-events-none absolute z-10 gap-1"
        style={{ display: 'none' }}
      />
      {/* Zoom Window drag rect. */}
      <div
        ref={zoomRectRef}
        data-native-viewport-overlay
        className="pointer-events-none absolute z-10 border border-accent bg-accent/10"
        style={{ display: 'none' }}
      />
      {/* Dynamic input cluster (while drawing). */}
      <DynamicInputOverlay />
      {/* Inline dimension editor (double-click a dimension). */}
      <DimensionEditor />
      <DofChip />
      <SelectionReadout />
      {/* Cursor readout (bottom-right status strip, sketch mm). */}
      <div
        ref={readoutRef}
        data-testid="sketch-coordinate-readout"
        data-native-hud="coordinate"
        data-native-viewport-overlay
        className="pointer-events-none absolute bottom-3 right-3 z-10 rounded border border-edge bg-header/90 px-2 py-1 font-mono text-[10px] tabular-nums text-mute"
        style={{ display: 'none' }}
      />
      <OrientationDial apiRef={apiRef} />
      <NavBar
        onFit={() => apiRef.current?.fit()}
        onSixDof={(motion) => apiRef.current?.navigateSixDof(motion)}
        getSixDofDriverView={() => apiRef.current?.getSixDofDriverView() ?? null}
      />
    </div>
  );
}

/** Live DOF chip (D4.3 optional display): click toggles the count. */
function DofChip() {
  const { t } = useTranslation();
  const sketchMode = useAppStore((s) => s.mode === 'sketch');
  const showDof = useAppStore((s) => s.showDof);
  const setShowDof = useAppStore((s) => s.setShowDof);
  const dof = useAppStore((s) => s.activeSketch?.dof.value ?? null);
  if (!sketchMode || dof === null) return null;
  return (
    <button
      type="button"
      data-native-hud="dof"
      data-native-hud-control="dof"
      data-native-viewport-overlay
      title={t('sketch.dofToggle')}
      onClick={() => setShowDof(!showDof)}
      className="absolute bottom-3 right-40 z-10 rounded border border-edge bg-header/90 px-2 py-1 font-mono text-[10px] tabular-nums text-mute hover:text-ink"
    >
      {showDof ? t('sketch.dofValue').replace('{n}', String(dof)) : t('sketch.dof')}
    </button>
  );
}
