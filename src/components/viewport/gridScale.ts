/** Finest supported grid interval: one micrometer in millimeter documents. */
export const MIN_SKETCH_GRID_STEP_MM = 0.001;
export const MAX_SKETCH_GRID_STEP_MM = 1_000_000;
export const DEFAULT_SKETCH_GRID_STEP_MM = 10;

/** Keep adjacent minor lines comfortably visible without making the canvas
 * visually dense. The selected interval follows the standard engineering
 * 1-2-5 sequence as the camera zooms. */
// A 24 px minor interval keeps 5 mm available at the zoom level where a
// 10 mm-only grid felt too coarse, while remaining legible on Retina and
// standard-density displays. The same 1-2-5 sequence naturally reaches
// 1 / 0.1 / 0.01 mm as the user zooms in.
export const TARGET_SKETCH_GRID_PX = 24;

export function adaptiveSketchGridStep(
  worldPerPixel: number,
  targetPixels = TARGET_SKETCH_GRID_PX,
): number {
  if (!Number.isFinite(worldPerPixel) || worldPerPixel <= 0) {
    return DEFAULT_SKETCH_GRID_STEP_MM;
  }

  const desired = Math.max(
    MIN_SKETCH_GRID_STEP_MM,
    worldPerPixel * Math.max(1, targetPixels),
  );
  const decade = 10 ** Math.floor(Math.log10(desired));
  const normalized = desired / decade;
  // Nearest member of the 1-2-5 sequence, using geometric midpoints so the
  // choice is symmetric on a logarithmic zoom scale.
  const multiplier =
    normalized < Math.sqrt(2)
      ? 1
      : normalized < Math.sqrt(10)
        ? 2
        : normalized < Math.sqrt(50)
          ? 5
          : 10;
  const step = Math.min(
    MAX_SKETCH_GRID_STEP_MM,
    Math.max(MIN_SKETCH_GRID_STEP_MM, multiplier * decade),
  );

  // Remove binary-noise such as 0.009999999999998 from values crossing the
  // JSON/WASM/native boundary.
  return Number(step.toPrecision(12));
}

export function snapToGrid(value: number, step: number): number {
  return Math.round(value / step) * step;
}
