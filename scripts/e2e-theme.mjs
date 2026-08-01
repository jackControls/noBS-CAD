import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'http://localhost:7199';
const here = path.dirname(fileURLToPath(import.meta.url));
const qa = path.join(here, '..', 'docs', 'qa');

const browser = await chromium.launch();
const context = await browser.newContext({ colorScheme: 'light' });
await context.addInitScript(() => window.localStorage.removeItem('nbcad.theme'));
const page = await context.newPage();

const relativeLuminance = (hex) => {
  const channels = hex
    .replace('#', '')
    .match(/../g)
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) =>
      channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4,
    );
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
};
const contrastRatio = (first, second) => {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__appStore?.getState().document !== null);

  const themeState = () =>
    page.evaluate(() => {
      const state = window.__appStore.getState();
      const root = document.documentElement;
      const css = getComputedStyle(root);
      return {
        preference: state.themePreference,
        resolved: state.resolvedTheme,
        attr: root.dataset.theme,
        colorScheme: root.style.colorScheme,
        panel: css.getPropertyValue('--panel').trim(),
        viewport: css.getPropertyValue('--vp-bottom').trim(),
        body: css.getPropertyValue('--cad-body').trim(),
        dimension: css.getPropertyValue('--dimgreen').trim(),
        selectedDimension: css.getPropertyValue('--cad-dimension-selected').trim(),
        holePointSelected: css.getPropertyValue('--cad-hole-point-selected').trim(),
        sketchHover: css.getPropertyValue('--cad-hover').trim(),
        sketchSelected: css.getPropertyValue('--cad-sketch-selected').trim(),
        finishedPoint: css.getPropertyValue('--cad-finished-point').trim(),
        finishedPointOutline: css
          .getPropertyValue('--cad-finished-point-outline')
          .trim(),
        faceSelected: css.getPropertyValue('--cad-face-selected').trim(),
      };
    });

  let theme = await themeState();
  assert.equal(theme.preference, 'system', 'first run defaults to System');
  assert.equal(theme.resolved, 'light', 'System follows a light OS');
  assert.equal(theme.attr, 'light');
  assert.equal(theme.colorScheme, 'light');
  assert.equal(theme.panel, '#f4f6f8');
  assert.equal(theme.dimension, '#344600');
  assert.equal(theme.selectedDimension, '#2e1b78');
  assert.equal(theme.holePointSelected, '#ffd43b');
  assert.equal(theme.sketchHover, '#9c4400');
  assert.equal(theme.sketchSelected, '#5038a8');
  assert.equal(theme.finishedPoint, '#6b2d00');
  assert.equal(theme.finishedPointOutline, '#ffffff');
  assert.ok(
    contrastRatio(theme.dimension, theme.body) >= 4.5,
    `light dimension/body contrast is ${contrastRatio(theme.dimension, theme.body).toFixed(2)}:1`,
  );
  assert.ok(
    contrastRatio(theme.selectedDimension, theme.body) >= 4.5,
    `light selected-dimension/body contrast is ${contrastRatio(theme.selectedDimension, theme.body).toFixed(2)}:1`,
  );
  assert.ok(
    contrastRatio(theme.sketchHover, theme.viewport) >= 4.5,
    `light sketch-hover/viewport contrast is ${contrastRatio(theme.sketchHover, theme.viewport).toFixed(2)}:1`,
  );
  assert.ok(
    contrastRatio(theme.sketchSelected, theme.viewport) >= 4.5,
    `light sketch-selection/viewport contrast is ${contrastRatio(theme.sketchSelected, theme.viewport).toFixed(2)}:1`,
  );
  assert.ok(
    contrastRatio(theme.finishedPoint, theme.viewport) >= 4.5,
    `light finished-point/viewport contrast is ${contrastRatio(theme.finishedPoint, theme.viewport).toFixed(2)}:1`,
  );
  assert.ok(
    contrastRatio(theme.finishedPointOutline, theme.faceSelected) >= 3,
    `light finished-point-outline/selected-face contrast is ${contrastRatio(theme.finishedPointOutline, theme.faceSelected).toFixed(2)}:1`,
  );
  await page.screenshot({ path: path.join(qa, 'theme-light.png') });

  await page.getByTestId('file-menu-button').click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await page.getByTestId('appearance-dialog').waitFor();
  assert.equal(await page.getByTestId('theme-system').getAttribute('aria-checked'), 'true');
  const legalCredits = page.getByTestId('legal-credits');
  await assert.doesNotReject(() =>
    legalCredits.getByText('noBS CAD is compatible with 3Dconnexion SpaceMouse devices.').waitFor(),
  );
  await assert.doesNotReject(() =>
    legalCredits
      .getByText(/3D input device development tools and related technology/)
      .waitFor(),
  );
  await assert.doesNotReject(() =>
    legalCredits.getByText(/not affiliated with, endorsed by, or certified by 3Dconnexion/).waitFor(),
  );

  const cameraBeforeThemeChange = await page.evaluate(() =>
    window.__cameraApi.getSnapshot(),
  );
  await page.getByTestId('theme-dark').click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.waitForTimeout(150);
  theme = await themeState();
  assert.equal(theme.preference, 'dark');
  assert.equal(theme.resolved, 'dark');
  assert.equal(theme.panel, '#23262b');
  assert.equal(theme.sketchHover, '#ffd166');
  assert.equal(theme.sketchSelected, '#c4b9ff');
  assert.equal(theme.finishedPoint, '#ff9f43');
  assert.equal(theme.finishedPointOutline, '#15191f');
  assert.ok(
    contrastRatio(theme.sketchHover, theme.viewport) >= 4.5,
    `dark sketch-hover/viewport contrast is ${contrastRatio(theme.sketchHover, theme.viewport).toFixed(2)}:1`,
  );
  assert.ok(
    contrastRatio(theme.sketchSelected, theme.viewport) >= 4.5,
    `dark sketch-selection/viewport contrast is ${contrastRatio(theme.sketchSelected, theme.viewport).toFixed(2)}:1`,
  );
  assert.ok(
    contrastRatio(theme.finishedPoint, theme.viewport) >= 4.5,
    `dark finished-point/viewport contrast is ${contrastRatio(theme.finishedPoint, theme.viewport).toFixed(2)}:1`,
  );
  assert.ok(
    contrastRatio(theme.finishedPointOutline, theme.faceSelected) >= 3,
    `dark finished-point-outline/selected-face contrast is ${contrastRatio(theme.finishedPointOutline, theme.faceSelected).toFixed(2)}:1`,
  );
  assert.equal(await page.evaluate(() => localStorage.getItem('nbcad.theme')), 'dark');
  const cameraAfterThemeChange = await page.evaluate(() =>
    window.__cameraApi.getSnapshot(),
  );
  const cameraDelta = Math.max(
    ...cameraAfterThemeChange.position.map((value, index) =>
      Math.abs(value - cameraBeforeThemeChange.position[index]),
    ),
    ...cameraAfterThemeChange.target.map((value, index) =>
      Math.abs(value - cameraBeforeThemeChange.target[index]),
    ),
    ...cameraAfterThemeChange.up.map((value, index) =>
      Math.abs(value - cameraBeforeThemeChange.up[index]),
    ),
  );
  assert.ok(cameraDelta < 1e-9, 'theme changes preserve the current camera pose');
  await page.screenshot({ path: path.join(qa, 'theme-dark.png') });

  await page.getByTestId('theme-system').click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  theme = await themeState();
  assert.equal(theme.preference, 'system');
  assert.equal(theme.resolved, 'dark', 'System updates live when the OS changes');

  await page.getByTestId('theme-light').click();
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(100);
  theme = await themeState();
  assert.equal(theme.preference, 'light');
  assert.equal(theme.resolved, 'light', 'explicit Light overrides a dark OS');
  await page.screenshot({ path: path.join(qa, 'theme-light-settings.png') });

  // Leave test storage at the product default.
  await page.getByTestId('theme-system').click();
  await page.getByRole('button', { name: 'Done' }).click();
  console.log('  [ok] System default, live OS following, and Light/Dark overrides');
} finally {
  await browser.close();
}
