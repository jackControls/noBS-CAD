// @ts-expect-error The app does not ship Node typings; this contract test runs under tsx.
import { readFileSync } from 'node:fs';
// @ts-expect-error The app does not ship Node typings; this contract test runs under tsx.
import { fileURLToPath } from 'node:url';
import {
  VIEWPORT_INTERACTION_REFERENCE_DIAGONAL_PX,
  VIEWPORT_INTERACTION_SCALE_RANGE,
  VIEWPORT_INTERACTION_STROKE_PX,
  VIEWPORT_INTERACTION_THEME,
  VIEWPORT_ORIGIN_PLANE_THEME,
  contrastRatio,
  viewportInteractionScale,
  viewportInteractionStrokePx,
} from './viewportInteractionTheme';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  [${ok ? 'ok' : 'FAIL'}] ${name}${ok ? '' : ` — ${detail}`}`);
  if (!ok) failures += 1;
};

const cssPath = fileURLToPath(new URL('../index.css', import.meta.url));
const css = readFileSync(cssPath, 'utf8');
const darkStart = css.indexOf(":root[data-theme='dark']");
const lightStart = css.indexOf(":root[data-theme='light']");
const darkCss = css.slice(darkStart, lightStart);
const lightCss = css.slice(lightStart, css.indexOf('\n}', lightStart) + 2);
const cssValue = (block: string, token: string): string | null =>
  new RegExp(`${token}:\\s*(#[0-9a-f]{6})`, 'i').exec(block)?.[1]?.toLowerCase() ?? null;

console.log('viewport interaction theme');

for (const [mode, theme] of Object.entries(VIEWPORT_INTERACTION_THEME)) {
  const block = mode === 'dark' ? darkCss : lightCss;
  for (const state of ['normal', 'hover', 'selected'] as const) {
    const ratio = contrastRatio(theme.background, theme[state]);
    check(
      `${mode} ${state} geometry has at least 3:1 viewport contrast`,
      ratio >= 3,
      ratio.toFixed(2),
    );
    check(
      `${mode} ${state} CSS token matches the canonical theme`,
      cssValue(block, `--cad-pick-${state}`) === theme[state],
      `${cssValue(block, `--cad-pick-${state}`)} !== ${theme[state]}`,
    );
  }
  const haloBackgroundRatio = contrastRatio(theme.halo, theme.background);
  check(
    `${mode} companion outline has at least 7:1 viewport contrast`,
    haloBackgroundRatio >= 7,
    haloBackgroundRatio.toFixed(2),
  );
  for (const state of ['hover', 'selected'] as const) {
    const stateHaloRatio = contrastRatio(theme.halo, theme[state]);
    check(
      `${mode} ${state} remains distinguishable inside its companion outline`,
      stateHaloRatio >= 1.3,
      stateHaloRatio.toFixed(2),
    );
  }
  check(
    `${mode} feedback halo CSS token matches the canonical theme`,
    cssValue(block, '--cad-pick-halo') === theme.halo,
  );
  const originColors = VIEWPORT_ORIGIN_PLANE_THEME[
    mode as keyof typeof VIEWPORT_ORIGIN_PLANE_THEME
  ];
  for (const plane of ['xy', 'xz', 'yz'] as const) {
    const color = originColors[plane];
    check(
      `${mode} ${plane.toUpperCase()} plane keeps its axis color`,
      cssValue(block, `--cad-origin-plane-${plane}`) === color,
    );
    check(
      `${mode} ${plane.toUpperCase()} plane border remains legible`,
      contrastRatio(theme.background, color) >= 3,
      contrastRatio(theme.background, color).toFixed(2),
    );
  }
  check(
    `${mode} origin planes retain three distinct hues`,
    new Set(Object.values(originColors)).size === 3,
  );
  check(
    `${mode} sketch normal uses the shared normal state`,
    cssValue(block, '--sketchline') === theme.normal
      && cssValue(block, '--cad-finished') === theme.normal,
  );
  check(
    `${mode} sketch and solid hover use the shared hover state`,
    cssValue(block, '--cad-hover') === theme.hover
      && cssValue(block, '--cad-edge-hover') === theme.hover,
  );
  check(
    `${mode} sketch and solid selection use the shared selected state`,
    cssValue(block, '--cad-sketch-selected') === theme.selected
      && cssValue(block, '--cad-edge-selected') === theme.selected,
  );
}

check(
  'line hover is one logical pixel while selection remains persistent',
  VIEWPORT_INTERACTION_STROKE_PX.hover === 1
    && VIEWPORT_INTERACTION_STROKE_PX.selected > VIEWPORT_INTERACTION_STROKE_PX.normal,
);
check(
  'reference viewport preserves the authored interaction weights',
  VIEWPORT_INTERACTION_REFERENCE_DIAGONAL_PX === 1200
    && viewportInteractionScale(960, 720) === 1
    && viewportInteractionStrokePx(
      'hover',
      960,
      720,
    ) === VIEWPORT_INTERACTION_STROKE_PX.hover,
);
check(
  'larger logical viewports increase interaction weight within bounds',
  viewportInteractionScale(1600, 1000) > 1
    && viewportInteractionScale(1600, 1000) <= VIEWPORT_INTERACTION_SCALE_RANGE.maximum
    && viewportInteractionScale(10000, 10000) === VIEWPORT_INTERACTION_SCALE_RANGE.maximum,
);
check(
  'small logical viewports retain a readable minimum weight',
  viewportInteractionScale(320, 240) === VIEWPORT_INTERACTION_SCALE_RANGE.minimum,
);
if (failures > 0) {
  throw new Error(`${failures} viewport interaction theme check(s) failed`);
}
console.log('\nall passed');
