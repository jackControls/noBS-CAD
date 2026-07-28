import { invoke } from '@tauri-apps/api/core';
import type * as THREE from 'three';
import { useAppStore } from '../../store/appStore';

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
  gridFine: [number, number, number];
  gridMajor: [number, number, number];
  body: [number, number, number];
  edge: [number, number, number];
  activeSketch: [number, number, number];
  finishedSketch: [number, number, number];
  preview: [number, number, number];
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
let pendingPreview:
  | {
      segments: number[];
      marker: [number, number, number] | null;
    }
  | null = null;
let previewInFlight = false;
let lastLayoutKey = '';

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
  const elements = [...document.querySelectorAll(overlaySelector)];
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
    gridFine: cssRgb('--cad-ground-fine', '#3a3f47'),
    gridMajor: cssRgb('--cad-ground-major', '#4d545f'),
    body: cssRgb('--cad-body', '#8b9bac'),
    edge: cssRgb('--cad-edge', '#29333d'),
    activeSketch: cssRgb('--sketchline', '#5da9ff'),
    finishedSketch: cssRgb('--cad-finished', '#4ac7ff'),
    preview: cssRgb('--cad-preview', '#8fc4ff'),
  };
}

async function sendLayout(container: HTMLElement): Promise<void> {
  if (!(await probe())) return;
  const viewport = rectFor(container);
  if (!viewport) return;
  const layout = {
    viewport,
    overlays: collectOverlays(),
    palette: collectPalette(),
  };
  const key = JSON.stringify(layout);
  if (key === lastLayoutKey) return;
  lastLayoutKey = key;
  await invoke('native_viewport_set_layout', {
    layout,
  });
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
  let probeTimer = 0;
  const scheduleLayout = () => {
    if (disposed || layoutFrame !== 0) return;
    layoutFrame = requestAnimationFrame(() => {
      layoutFrame = 0;
      void sendLayout(container).catch(() => undefined);
    });
  };

  const resize = new ResizeObserver(scheduleLayout);
  resize.observe(container);
  const mutation = new MutationObserver(scheduleLayout);
  mutation.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'hidden'],
  });
  window.addEventListener('resize', scheduleLayout);

  let previous = useAppStore.getState();
  const unsubscribe = useAppStore.subscribe((next) => {
    if (
      next.activeSketch !== previous.activeSketch ||
      next.finishedSketches !== previous.finishedSketches ||
      next.solidScene !== previous.solidScene
    ) {
      void syncModel().catch(() => undefined);
    }
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
      // Do the first cut immediately. requestAnimationFrame may be throttled
      // while a newly launched desktop window is still behind another app.
      void sendLayout(container).catch(() => undefined);
      void syncModel().catch(() => undefined);
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
    resize.disconnect();
    mutation.disconnect();
    window.removeEventListener('resize', scheduleLayout);
    unsubscribe();
    delete container.dataset.nativeViewport;
  };
}

function previewKey(
  segments: number[],
  marker: [number, number, number] | null,
): string {
  // Quantization avoids waking the native renderer for insignificant
  // float noise while preserving sub-micron precision in millimeter models.
  let hash = 2_166_136_261;
  for (const value of segments) {
    hash ^= Math.round(value * 10_000);
    hash = Math.imul(hash, 16_777_619);
  }
  if (marker) {
    for (const value of marker) {
      hash ^= Math.round(value * 10_000);
      hash = Math.imul(hash, 16_777_619);
    }
  }
  return `${segments.length}:${marker ? 1 : 0}:${hash >>> 0}`;
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
 * Sends only transient rubber-band geometry through IPC. Committed sketches
 * and OCCT meshes stay on the direct Rust path and never cross JavaScript.
 */
export function syncNativeViewportPreview(
  segments: number[],
  marker: [number, number, number] | null,
): void {
  if (!active) return;
  const key = previewKey(segments, marker);
  if (key === lastPreviewKey) return;
  lastPreviewKey = key;
  pendingPreview = { segments, marker };
  pumpPreview();
}

export function syncNativeViewportCamera(
  camera: THREE.PerspectiveCamera,
  target: THREE.Vector3,
): void {
  if (!active) return;
  const next = {
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
