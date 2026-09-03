/**
 * Canonical interaction colors and emphasis for geometry in both sketch and
 * solid-modeling viewports. Runtime colors are exposed as CSS custom
 * properties in index.css so DOM, WebGL, and the native renderer all consume
 * the same theme. This typed copy is the reviewable/testable contract.
 */
export const VIEWPORT_INTERACTION_THEME = {
  dark: {
    background: '#2a2d33',
    normal: '#86a9c7',
    hover: '#00f5ff',
    selected: '#ffd000',
    halo: '#ffffff',
  },
  light: {
    background: '#dce3ea',
    normal: '#38566a',
    hover: '#004fd8',
    selected: '#b83200',
    halo: '#17212b',
  },
} as const;

/** Permanent orientation identity for the three origin planes. Hover and
 * selection only brighten these colors; generic picker hues never replace
 * their fills or borders. */
export const VIEWPORT_ORIGIN_PLANE_THEME = {
  dark: {
    xy: '#57a8ff',
    xz: '#55c978',
    yz: '#ff7078',
  },
  light: {
    xy: '#0b63b6',
    xz: '#257942',
    yz: '#b5323a',
  },
} as const;

export const VIEWPORT_INTERACTION_STROKE_PX = {
  normal: 1.25,
  hover: 1,
  selected: 2,
} as const;

export const VIEWPORT_INTERACTION_REFERENCE_DIAGONAL_PX = 1200;
export const VIEWPORT_INTERACTION_SCALE_RANGE = {
  minimum: 0.9,
  maximum: 1.6,
} as const;

/**
 * Scale visual feedback from the logical viewport extent. Device-pixel ratio
 * is deliberately absent: native renderers convert this logical weight to
 * backing pixels only after the design weight has been resolved.
 */
export function viewportInteractionScale(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return 1;
  }
  const relative = Math.hypot(width, height) / VIEWPORT_INTERACTION_REFERENCE_DIAGONAL_PX;
  return Math.min(
    VIEWPORT_INTERACTION_SCALE_RANGE.maximum,
    Math.max(VIEWPORT_INTERACTION_SCALE_RANGE.minimum, relative),
  );
}

export function viewportInteractionStrokePx(
  state: ViewportInteractionState,
  width: number,
  height: number,
): number {
  return VIEWPORT_INTERACTION_STROKE_PX[state] * viewportInteractionScale(width, height);
}

export type ViewportInteractionState = 'normal' | 'hover' | 'selected';

const linearChannel = (value: number): number => {
  const channel = value / 255;
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
};

export function relativeLuminance(hex: string): number {
  const normalized = hex.replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(normalized)) {
    throw new Error(`Expected a six-digit hex color, received ${hex}`);
  }
  const channels = [0, 2, 4].map((offset) =>
    linearChannel(Number.parseInt(normalized.slice(offset, offset + 2), 16)),
  );
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function contrastRatio(first: string, second: string): number {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  return (
    (Math.max(firstLuminance, secondLuminance) + 0.05)
    / (Math.min(firstLuminance, secondLuminance) + 0.05)
  );
}
