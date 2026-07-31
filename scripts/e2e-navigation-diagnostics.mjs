import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

try {
  await page.goto('http://localhost:7199');
  await page.waitForFunction(() => window.__cameraApi !== undefined);
  await page.evaluate(() => {
    const info = {
      id: 'navigation-test',
      directory: '/tmp/noBS CAD Diagnostics/navigation-test',
      tracePath: '/tmp/noBS CAD Diagnostics/navigation-test/navigation-trace.jsonl',
      startedUnixMs: Date.now(),
    };
    window.__navigationDiagnosticTest = {
      calls: [],
      entries: [],
      capture: 0,
    };
    window.__TAURI_INTERNALS__ = {
      async invoke(command, args = {}) {
        const test = window.__navigationDiagnosticTest;
        test.calls.push({ command, args });
        if (command === 'navigation_diagnostics_start') return info;
        if (command === 'navigation_diagnostics_append') {
          test.entries.push(...args.entries);
          return null;
        }
        if (command === 'navigation_diagnostics_capture') {
          test.capture += 1;
          return `frame-${String(test.capture).padStart(4, '0')}.png`;
        }
        if (command === 'native_viewport_metrics') {
          return {
            available: true,
            ready: true,
            backend: 'test',
            logicalWidth: 1200,
            logicalHeight: 700,
            scaleFactor: 2,
            physicalWidth: 2400,
            physicalHeight: 1400,
          };
        }
        if (command === 'navigation_diagnostics_stop') return info;
        return null;
      },
    };
  });

  const recorder = page.getByTestId('navigation-recorder-toggle');
  await recorder.click();
  await page.getByText('RECORDING', { exact: true }).waitFor();
  assert.equal(await recorder.getAttribute('aria-pressed'), 'true');
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    canvas.dispatchEvent(
      new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        deltaX: 24.5,
        deltaY: -13.25,
        shiftKey: true,
      }),
    );
  });
  await page.waitForTimeout(700);
  await recorder.click();
  await page.getByText('REC SAVED', { exact: true }).waitFor();
  assert.equal(await recorder.getAttribute('aria-pressed'), 'false');

  const result = await page.evaluate(() => ({
    calls: window.__navigationDiagnosticTest.calls.map((call) => call.command),
    stages: window.__navigationDiagnosticTest.entries.map((entry) => entry.stage),
    capture: window.__navigationDiagnosticTest.capture,
  }));
  assert.ok(result.calls.includes('navigation_diagnostics_start'));
  assert.ok(result.calls.includes('navigation_diagnostics_append'));
  assert.ok(result.calls.includes('navigation_diagnostics_stop'));
  assert.ok(result.capture >= 2, `expected periodic captures, received ${result.capture}`);
  assert.ok(result.stages.includes('touchpad.wheel.raw'));
  assert.ok(result.stages.includes('camera.orbit.applied'));
  assert.ok(result.stages.includes('recorder.snapshot'));
  console.log('  [ok] explicit navigation recorder captures input, camera, and screenshots');
} finally {
  await browser.close();
}
