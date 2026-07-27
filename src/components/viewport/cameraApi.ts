/**
 * Camera API shared between the Viewport and its navigation overlays.
 * View changes are animated (~250 ms) and every interaction
 * respects free-orbit: the camera is never locked, including inside an
 * active sketch.
 */
export interface CameraSnapshot {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
}

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface SixDofMotion {
  /** Normalized cap translation: right, forward, up. */
  translation: [number, number, number];
  /** Normalized cap rotation about right, forward, and up. */
  rotation: [number, number, number];
  /** Integration interval supplied by the device adapter. */
  deltaSeconds: number;
}

export interface ViewportCameraApi {
  /** Current camera pose (copies; safe to mutate). */
  getSnapshot(): CameraSnapshot;
  /** Animated snap to look at the target from a world direction. */
  snapToDirection(direction: [number, number, number]): void;
  /** Animated return to the default axonometric home view. */
  home(): void;
  /** Animated frame of the currently visible model/sketch geometry. */
  fit(): void;
  /** Immediate free-orbit delta from navigation input, in pixels. */
  orbitBy(dxPx: number, dyPx: number): void;
  /** Immediate six-degree-of-freedom navigation from a 3D mouse. */
  navigateSixDof(motion: SixDofMotion): void;
  /**
   * Camera/property adapter consumed by the browser Navigation Library
   * bridge. Kept separate from raw six-axis motion so the desktop driver can
   * provide its normal CAD navigation model when it owns the HID interface.
   */
  getSixDofDriverView(): import('../../input/threeDConnexionBridge').SixDofDriverView;
  /** Animated snap to look normal at the active sketch plane. */
  lookAtActivePlane(): void;
  /** Project one Z-up world point into application-window pixels. */
  worldToScreen(point: [number, number, number]): ScreenPoint | null;
}

/** easeInOutCubic — used by all camera animations. */
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
