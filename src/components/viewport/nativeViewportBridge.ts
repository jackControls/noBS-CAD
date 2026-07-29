import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../../store/appStore';
import type { BrowserNode } from '../../types/document';

export interface NativeCameraState {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  verticalFovDegrees: number;
}

interface NativeViewportMetrics {
  available: boolean;
  ready: boolean;
  backend: string;
  logicalWidth: number;
  logicalHeight: number;
  scaleFactor: number;
  physicalWidth: number;
  physicalHeight: number;
  renderedFrames: number;
  wakeups: number;
  averageFrameMs: number;
  lastPointerLatencyMs: number;
  bodyCount: number;
  triangleCount: number;
}

export interface NativeViewportPick {
  bodyId: number;
  faceId: number;
  point: [number, number, number];
  distance: number;
}

interface NativeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface NativePalette {
  background: [number, number, number];
  panel: [number, number, number];
  header: [number, number, number];
  uiEdge: [number, number, number];
  ink: [number, number, number];
  mute: [number, number, number];
  accent: [number, number, number];
  gridFine: [number, number, number];
  gridMajor: [number, number, number];
  body: [number, number, number];
  bodySelected: [number, number, number];
  bodyTool: [number, number, number];
  bodySelectedEdge: [number, number, number];
  faceHover: [number, number, number];
  faceSelected: [number, number, number];
  edge: [number, number, number];
  edgeHover: [number, number, number];
  edgeSelected: [number, number, number];
  activeSketch: [number, number, number];
  definedSketch: [number, number, number];
  hover: [number, number, number];
  selection: [number, number, number];
  finishedSketch: [number, number, number];
  preview: [number, number, number];
}

interface NativeHudSelection {
  title: string;
  subject: string;
  rows: Array<{ label: string; value: string }>;
  footer: string | null;
}

interface NativeHud {
  navTool: string;
  sketchMode: boolean;
  canUndo: boolean;
  canRedo: boolean;
  sixDofState: string;
  selection: NativeHudSelection | null;
}

interface NativePresentation {
  mode: 'solid' | 'pick_plane' | 'sketch';
  hoveredOriginPlane: 'xy' | 'xz' | 'yz' | null;
  hoveredDatumPlaneId: number | null;
  selectedBodyIds: number[];
  hoveredBodyId: number | null;
  selectedFaceIds: number[];
  hoveredFaceId: number | null;
  selectedEdgeIds: number[];
  hoveredEdgeId: number | null;
  selectedSketchEntityIds: number[];
  hoveredSketchEntityId: number | null;
  hiddenBodyIds: number[];
  hiddenDatumPlaneIds: number[];
}

export interface NativeViewportLineLayer {
  color: [number, number, number, number];
  width: number;
  segments: number[];
}

export interface NativeViewportPointLayer {
  color: [number, number, number, number];
  radius: number;
  positions: number[];
}

export interface NativeViewportAnnotation {
  screen: [number, number];
  color: [number, number, number, number];
  text: string;
  kind: 'dimension' | 'constraint';
}

export interface NativeViewportTransient {
  lines: NativeViewportLineLayer[];
  points: NativeViewportPointLayer[];
  annotations: NativeViewportAnnotation[];
  marker: [number, number, number] | null;
}

const overlaySelector = [
  '[data-native-viewport-overlay]',
  '.feature-dialog',
  '[role="dialog"]',
  '[data-ribbon-menu]',
  '[data-testid="extrude-dialog"]',
  '[data-testid="revolve-dialog"]',
  '[data-testid="construction-plane-dialog"]',
  '[data-testid="body-feature-dialog"]',
].join(',');

let probeInFlight: Promise<boolean> | null = null;
let active = false;
let latestMetrics: NativeViewportMetrics | null = null;
let pendingCameraFrame = 0;
let pendingCamera:
  | {
      position: [number, number, number];
      target: [number, number, number];
      up: [number, number, number];
      verticalFovDegrees: number;
    }
  | null = null;
let lastCameraKey = '';
let lastPreviewKey = '';
let pendingPreview: NativeViewportTransient | null = null;
let previewInFlight = false;
let lastLayoutKey = '';
let layoutRevision = Date.now() * 1000;
let pendingPresentation: NativePresentation | null = null;
let presentationInFlight = false;
let lastPresentationKey = '';

function isTauriRuntime(): boolean {
  return '__TAURI_INTERNALS__' in window;
}

function probe(): Promise<boolean> {
  if (active) return Promise.resolve(true);
  if (probeInFlight) return probeInFlight;
  probeInFlight = (async () => {
    if (!isTauriRuntime()) return false;
    try {
      latestMetrics = await invoke<NativeViewportMetrics>('native_viewport_metrics');
      active = latestMetrics.available && latestMetrics.ready;
      return active;
    } catch {
      active = false;
      return false;
    }
  })().finally(() => {
    probeInFlight = null;
  });
  return probeInFlight;
}

export function nativeViewportIsActive(): boolean {
  return active;
}

export function nativeViewportMetrics(): NativeViewportMetrics | null {
  return latestMetrics;
}

function rectFor(element: Element): NativeRect | null {
  const style = getComputedStyle(element);
  if (
    style.display === 'none' ||
    style.visibility === 'hidden' ||
    Number(style.opacity) === 0
  ) {
    return null;
  }
  const rect = element.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return null;
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function overlaps(a: NativeRect, b: NativeRect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function union(a: NativeRect, b: NativeRect): NativeRect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.width, b.x + b.width);
  const bottom = Math.max(a.y + a.height, b.y + b.height);
  return { x, y, width: right - x, height: bottom - y };
}

/** CAShapeLayer uses even/odd fill, so overlapping islands must be merged. */
function mergeOverlayRects(rects: NativeRect[]): NativeRect[] {
  const merged: NativeRect[] = [];
  for (const rect of rects) {
    let candidate = rect;
    let index = 0;
    while (index < merged.length) {
      if (overlaps(candidate, merged[index])) {
        candidate = union(candidate, merged[index]);
        merged.splice(index, 1);
        index = 0;
      } else {
        index += 1;
      }
    }
    merged.push(candidate);
  }
  return merged;
}

function collectOverlays(): NativeRect[] {
  const elements = [...document.querySelectorAll(overlaySelector)].filter(
    (element) => !element.closest('[data-native-hud]'),
  );
  return mergeOverlayRects(
    elements
      .map(rectFor)
      .filter((rect): rect is NativeRect => rect !== null),
  );
}

function cssRgb(variable: string, fallback: string): [number, number, number] {
  const value =
    getComputedStyle(document.documentElement).getPropertyValue(variable).trim() ||
    fallback;
  const match = /^#([0-9a-f]{6})$/i.exec(value);
  const hex = match?.[1] ?? fallback.slice(1);
  return [
    Number.parseInt(hex.slice(0, 2), 16) / 255,
    Number.parseInt(hex.slice(2, 4), 16) / 255,
    Number.parseInt(hex.slice(4, 6), 16) / 255,
  ];
}

function collectPalette(): NativePalette {
  return {
    background: cssRgb('--viewport', '#2a2d33'),
    panel: cssRgb('--panel', '#22262c'),
    header: cssRgb('--header', '#282d34'),
    uiEdge: cssRgb('--edge', '#3a3e46'),
    ink: cssRgb('--ink', '#e7ebef'),
    mute: cssRgb('--mute', '#9aa3ad'),
    accent: cssRgb('--accent', '#7c6df2'),
    gridFine: cssRgb('--cad-ground-fine', '#3a3f47'),
    gridMajor: cssRgb('--cad-ground-major', '#4d545f'),
    body: cssRgb('--cad-body', '#8b9bac'),
    bodySelected: cssRgb('--cad-body-selected', '#69a9d4'),
    bodyTool: cssRgb('--cad-body-tool', '#b58a43'),
    bodySelectedEdge: [13 / 255, 117 / 255, 165 / 255],
    faceHover: cssRgb('--cad-face-hover', '#9ed5f3'),
    faceSelected: cssRgb('--cad-face-selected', '#30aee8'),
    edge: cssRgb('--cad-edge', '#29333d'),
    edgeHover: cssRgb('--cad-edge-hover', '#58c7ff'),
    edgeSelected: cssRgb('--cad-edge-selected', '#ffc857'),
    activeSketch: cssRgb('--sketchline', '#5da9ff'),
    definedSketch: cssRgb('--cad-defined', '#e8e9ec'),
    hover: cssRgb('--cad-hover', '#9ccaff'),
    selection: cssRgb('--accent', '#7463d8'),
    finishedSketch: cssRgb('--cad-finished', '#4ac7ff'),
    preview: cssRgb('--cad-preview', '#8fc4ff'),
  };
}

function elementText(element: Element | null): string {
  return element?.textContent?.trim().replace(/\s+/g, ' ') ?? '';
}

function collectSelectionHud(): NativeHudSelection | null {
  const root = document.querySelector('[data-native-hud="selection"]');
  if (!root) return null;
  const rows = [...root.querySelectorAll('[data-native-hud-row]')].map((row) => ({
    label: elementText(row.querySelector('[data-native-hud-label]')),
    value: elementText(row.querySelector('[data-native-hud-value]')),
  }));
  return {
    title: elementText(root.querySelector('[data-native-hud-title]')) || 'SELECTION',
    subject: elementText(root.querySelector('[data-native-hud-subject]')),
    rows,
    footer: elementText(root.querySelector('[data-native-hud-footer]')) || null,
  };
}

function collectHud(): NativeHud {
  const state = useAppStore.getState();
  const navigation = document.querySelector('[data-native-hud="navigation"]');
  return {
    navTool: state.navTool,
    sketchMode: state.mode === 'sketch',
    canUndo: state.activeSketch?.can_undo ?? false,
    canRedo: state.activeSketch?.can_redo ?? false,
    sixDofState: navigation?.getAttribute('data-native-six-dof-state') ?? 'disconnected',
    selection: collectSelectionHud(),
  };
}

function hiddenReferences(
  nodes: BrowserNode[],
  hidden: Record<number, boolean>,
  kind: BrowserNode['kind'],
): number[] {
  const ids: number[] = [];
  const visit = (entries: BrowserNode[]) => {
    for (const node of entries) {
      if (node.kind === kind && node.reference_id !== null && hidden[node.id]) {
        ids.push(node.reference_id);
      }
      visit(node.children);
    }
  };
  visit(nodes);
  return ids;
}

function collectPresentation(): NativePresentation {
  const state = useAppStore.getState();
  const bodyHoverKinds = new Set([
    'combine',
    'mirror',
    'rectangular_pattern',
    'circular_pattern',
    'split_body',
  ]);
  const hoveredBodyId =
    state.hoveredFace !== null &&
    state.bodyFeatureDialog !== null &&
    bodyHoverKinds.has(state.bodyFeatureDialog.kind)
      ? state.solidScene.bodies.find((body) =>
          body.faces.some((face) => face.id === state.hoveredFace),
        )?.id ?? null
      : null;
  const selectedSketchEntityIds = [...new Set(state.selectedEntities)];
  if (
    state.selectedEntity !== null &&
    !selectedSketchEntityIds.includes(state.selectedEntity)
  ) {
    selectedSketchEntityIds.push(state.selectedEntity);
  }
  const browser = state.document?.browser ?? [];

  return {
    mode: state.mode === 'pickPlane' ? 'pick_plane' : state.mode,
    hoveredOriginPlane: state.hoveredPlane,
    hoveredDatumPlaneId: state.hoveredDatumPlane,
    selectedBodyIds: state.selectedBodies,
    hoveredBodyId,
    selectedFaceIds: state.selectedFaces,
    hoveredFaceId: state.hoveredFace,
    selectedEdgeIds: state.selectedEdges,
    hoveredEdgeId: state.hoveredEdge,
    selectedSketchEntityIds,
    hoveredSketchEntityId: state.hoveredEntity,
    hiddenBodyIds: hiddenReferences(browser, state.hidden, 'body'),
    hiddenDatumPlaneIds: hiddenReferences(
      browser,
      state.hidden,
      'construction_plane',
    ),
  };
}

function pumpPresentation(): void {
  if (presentationInFlight || !pendingPresentation || !active) return;
  const presentation = pendingPresentation;
  pendingPresentation = null;
  presentationInFlight = true;
  void invoke('native_viewport_set_presentation', { presentation })
    .catch(() => {
      lastPresentationKey = '';
    })
    .finally(() => {
      presentationInFlight = false;
      pumpPresentation();
    });
}

function syncPresentation(): void {
  if (!active) return;
  const presentation = collectPresentation();
  const key = JSON.stringify(presentation);
  if (key === lastPresentationKey) return;
  lastPresentationKey = key;
  pendingPresentation = presentation;
  pumpPresentation();
}

async function syncModel(): Promise<void> {
  if (!(await probe())) return;
  await invoke('native_viewport_sync_model');
}

/**
 * Binds native layout/model synchronization to the existing viewport. The
 * mutation observer watches only layout-bearing attributes; the orientation
 * dial's continuously changing SVG coordinates do not wake the Rust worker.
 */
export function attachNativeViewport(container: HTMLElement): () => void {
  let disposed = false;
  let layoutFrame = 0;
  let layoutInFlight = false;
  let layoutRequested = false;
  let probeTimer = 0;
  let settleTimers: number[] = [];

  const flushLayout = async () => {
    if (disposed) return;
    if (layoutInFlight) {
      layoutRequested = true;
      return;
    }
    layoutInFlight = true;
    try {
      do {
        layoutRequested = false;
        if (!(await probe()) || disposed) break;
        const viewport = rectFor(container);
        if (!viewport) break;
        const payload = {
          viewport,
          overlays: collectOverlays(),
          palette: collectPalette(),
          hud: collectHud(),
        };
        // CSS geometry can stay identical while the native backing scale
        // changes after moving between Retina/DPI monitors. Keep the ratio in
        // the deduplication key so the platform host gets a fresh layout and
        // rebuilds its physical swapchain.
        const key = JSON.stringify({
          ...payload,
          devicePixelRatio: window.devicePixelRatio,
        });
        if (key === lastLayoutKey) continue;
        const layout = {
          revision: ++layoutRevision,
          ...payload,
        };
        try {
          await invoke('native_viewport_set_layout', { layout });
          lastLayoutKey = key;
        } catch {
          lastLayoutKey = '';
        }
      } while (layoutRequested && !disposed);
    } finally {
      layoutInFlight = false;
      if (layoutRequested && !disposed) void flushLayout();
    }
  };

  const scheduleLayout = () => {
    if (disposed || layoutFrame !== 0) return;
    layoutFrame = requestAnimationFrame(() => {
      layoutFrame = 0;
      void flushLayout();
    });
  };
  const settleLayout = () => {
    scheduleLayout();
    for (const timer of settleTimers) window.clearTimeout(timer);
    settleTimers = [80, 180, 350].map((delay) =>
      window.setTimeout(scheduleLayout, delay),
    );
    requestAnimationFrame(() => requestAnimationFrame(scheduleLayout));
  };

  const observedLayoutElements = new Set<Element>();
  const resize = new ResizeObserver(scheduleLayout);
  resize.observe(container);
  const refreshObservedLayoutElements = () => {
    const next = new Set(
      document.querySelectorAll(`${overlaySelector}, [data-native-hud]`),
    );
    for (const element of observedLayoutElements) {
      if (!next.has(element)) {
        resize.unobserve(element);
        observedLayoutElements.delete(element);
      }
    }
    for (const element of next) {
      if (observedLayoutElements.has(element)) continue;
      observedLayoutElements.add(element);
      resize.observe(element);
    }
  };
  refreshObservedLayoutElements();
  const mutation = new MutationObserver(() => {
    refreshObservedLayoutElements();
    scheduleLayout();
  });
  mutation.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [
      'class',
      'style',
      'data-theme',
      'hidden',
      'disabled',
      'data-native-nav-active',
      'data-native-six-dof-state',
    ],
  });
  window.addEventListener('resize', settleLayout);
  window.visualViewport?.addEventListener('resize', settleLayout);
  document.addEventListener('fullscreenchange', settleLayout);
  document.addEventListener('input', scheduleLayout, true);
  document.addEventListener('change', scheduleLayout, true);
  document.addEventListener('transitionend', scheduleLayout, true);

  let previous = useAppStore.getState();
  const unsubscribe = useAppStore.subscribe((next) => {
    if (
      next.activeSketch !== previous.activeSketch ||
      next.finishedSketches !== previous.finishedSketches ||
      next.solidScene !== previous.solidScene ||
      next.datumPlanes !== previous.datumPlanes
    ) {
      void syncModel().catch(() => undefined);
    }
    if (
      next.mode !== previous.mode ||
      next.navTool !== previous.navTool ||
      next.activeSketch !== previous.activeSketch ||
      next.selectedEntity !== previous.selectedEntity ||
      next.selectedEntities !== previous.selectedEntities ||
      next.selectedBody !== previous.selectedBody ||
      next.selectedBodies !== previous.selectedBodies ||
      next.selectedFace !== previous.selectedFace ||
      next.selectedFaces !== previous.selectedFaces ||
      next.selectedEdges !== previous.selectedEdges
    ) {
      scheduleLayout();
    }
    syncPresentation();
    previous = next;
  });

  let probeAttempt = 0;
  const activate = async () => {
    if (disposed || !isTauriRuntime()) return;
    if (await probe()) {
      if (disposed) return;
      container.dataset.nativeViewport = 'bevy';
      lastPreviewKey = '';
      lastLayoutKey = '';
      lastPresentationKey = '';
      // Do the first cut immediately. requestAnimationFrame may be throttled
      // while a newly launched desktop window is still behind another app.
      void flushLayout();
      void syncModel().catch(() => undefined);
      syncPresentation();
      // Web fonts and SVG icon metrics can settle after the first native cut.
      // Observed overlay roots catch the size change; these extra passes cover
      // engines that batch font layout without emitting ResizeObserver yet.
      requestAnimationFrame(scheduleLayout);
      window.setTimeout(scheduleLayout, 120);
      void document.fonts?.ready.then(scheduleLayout);
      return;
    }
    probeAttempt += 1;
    if (probeAttempt < 100) {
      probeTimer = window.setTimeout(() => void activate(), 100);
    }
  };
  void activate();

  return () => {
    disposed = true;
    if (layoutFrame !== 0) cancelAnimationFrame(layoutFrame);
    if (probeTimer !== 0) window.clearTimeout(probeTimer);
    for (const timer of settleTimers) window.clearTimeout(timer);
    resize.disconnect();
    mutation.disconnect();
    window.removeEventListener('resize', settleLayout);
    window.visualViewport?.removeEventListener('resize', settleLayout);
    document.removeEventListener('fullscreenchange', settleLayout);
    document.removeEventListener('input', scheduleLayout, true);
    document.removeEventListener('change', scheduleLayout, true);
    document.removeEventListener('transitionend', scheduleLayout, true);
    unsubscribe();
    delete container.dataset.nativeViewport;
  };
}

function previewKey(preview: NativeViewportTransient): string {
  // Quantization avoids waking the native renderer for insignificant
  // float noise while preserving sub-micron precision in millimeter models.
  let hash = 2_166_136_261;
  let numericCount = 0;
  const addNumber = (value: number) => {
    hash ^= Math.round(value * 10_000);
    hash = Math.imul(hash, 16_777_619);
    numericCount += 1;
  };
  const addString = (value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16_777_619);
    }
  };
  for (const layer of preview.lines) {
    layer.color.forEach(addNumber);
    addNumber(layer.width);
    layer.segments.forEach(addNumber);
  }
  for (const layer of preview.points) {
    layer.color.forEach(addNumber);
    addNumber(layer.radius);
    layer.positions.forEach(addNumber);
  }
  for (const annotation of preview.annotations) {
    annotation.screen.forEach(addNumber);
    annotation.color.forEach(addNumber);
    addString(annotation.text);
    addString(annotation.kind);
  }
  preview.marker?.forEach(addNumber);
  return [
    preview.lines.length,
    preview.points.length,
    preview.annotations.length,
    numericCount,
    preview.marker ? 1 : 0,
    hash >>> 0,
  ].join(':');
}

function pumpPreview(): void {
  if (previewInFlight || !pendingPreview) return;
  const preview = pendingPreview;
  pendingPreview = null;
  previewInFlight = true;
  void invoke('native_viewport_set_preview', { preview })
    .catch(() => undefined)
    .finally(() => {
      previewInFlight = false;
      pumpPreview();
    });
}

/**
 * Sends only transient presentation geometry through IPC: tool previews,
 * dialog-owned highlights, point grips, and dimension/constraint annotations.
 * Committed sketches and OCCT meshes stay on the direct Rust path.
 */
export function syncNativeViewportPreview(preview: NativeViewportTransient): void {
  if (!active) return;
  const key = previewKey(preview);
  if (key === lastPreviewKey) return;
  lastPreviewKey = key;
  pendingPreview = preview;
  pumpPreview();
}

export function syncNativeViewportCamera(
  camera: {
    position: { toArray(): number[] };
    up: { toArray(): number[] };
    fov: number;
  },
  target: { toArray(): number[] },
): void {
  if (!active) return;
  const next: NativeCameraState = {
    position: camera.position.toArray() as [number, number, number],
    target: target.toArray() as [number, number, number],
    up: camera.up.toArray() as [number, number, number],
    verticalFovDegrees: camera.fov,
  };
  const key = [
    ...next.position,
    ...next.target,
    ...next.up,
    next.verticalFovDegrees,
  ]
    .map((value) => value.toFixed(4))
    .join(',');
  if (key === lastCameraKey) return;
  lastCameraKey = key;
  pendingCamera = next;
  if (pendingCameraFrame !== 0) return;
  pendingCameraFrame = requestAnimationFrame(() => {
    pendingCameraFrame = 0;
    const cameraState = pendingCamera;
    pendingCamera = null;
    if (!cameraState) return;
    void invoke('native_viewport_set_camera', { camera: cameraState }).catch(
      () => undefined,
    );
  });
}

export async function pickNativeViewport(
  event: PointerEvent,
  container: HTMLElement,
): Promise<NativeViewportPick | null> {
  if (!active) return null;
  const rect = container.getBoundingClientRect();
  return invoke<NativeViewportPick | null>('native_viewport_pick', {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  });
}
