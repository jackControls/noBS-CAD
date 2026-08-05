/**
 * Browser six-DOF regressions:
 * - never loads the hosted bridge before an explicit user click;
 * - connects through the optional installed-driver bridge after that click;
 * - falls back to the standard WebHID Multi-axis Controller collection;
 * - accepts the combined 12-byte report used by current Bluetooth devices;
 * - leaves a stalled Chrome device chooser in a retryable state.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE = 'http://localhost:7199';
const browser = await chromium.launch();
const pages = [];

const newPage = async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  pages.push({ page, errors });
  return { page, errors };
};

const waitForReady = async (page) => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.waitForFunction(
    () => window.__appStore.getState().document !== null,
    undefined,
    { timeout: 90_000 },
  );
  const connect = page.getByTestId('six-dof-mouse-connect');
  await connect.waitFor({ state: 'visible' });
  return connect;
};

const readOrientation = (page) =>
  page.locator('[aria-label="Current XYZ orientation"]').evaluate((element) =>
    [...element.querySelectorAll('[data-axis-line]')].map((line) => ({
      axis: line.getAttribute('data-axis-line'),
      x2: line.getAttribute('x2'),
      y2: line.getAttribute('y2'),
    })),
  );

try {
  {
    const { page, errors } = await newPage();
    await page.addInitScript(() => {
      class MockDriver {
        constructor(client) {
          this.client = client;
          this.connexion = 1;
          this.session = {
            close: () => {
              window.__driverMock.closed = true;
            },
          };
          window.__driverMock.client = client;
        }

        connect() {
          queueMicrotask(() => this.client.onConnect());
          return 1;
        }

        create3dmouse(element) {
          window.__driverMock.focusElement = element;
          // A cap can already be displaced while the local driver handshake is
          // still gray/amber. These callbacks must be ignored until the UI has
          // painted the connected state.
          const matrix = this.client.getViewMatrix();
          const target = this.client.getViewTarget();
          this.client.onStartMotion();
          matrix[12] += 75;
          this.client.setViewMatrix(matrix);
          this.client.setTarget([target[0] + 75, target[1], target[2]]);
          this.client.onStopMotion();
          window.__driverMock.preReadyMutationAttempted = true;
          queueMicrotask(() => this.client.on3dmouseCreated());
        }

        update3dcontroller(update) {
          window.__driverMock.updates.push(update);
        }

        delete3dmouse() {
          window.__driverMock.deleted = true;
        }
      }

      window.__driverMock = {
        client: null,
        closed: false,
        deleted: false,
        focusElement: null,
        preReadyMutationAttempted: false,
        updates: [],
      };
      window._3Dconnexion = MockDriver;
      Object.defineProperty(navigator, 'hid', {
        configurable: true,
        value: {
          addEventListener() {},
          removeEventListener() {},
          async getDevices() {
            return [];
          },
          async requestDevice() {
            throw new Error('WebHID should not be requested when the driver is available.');
          },
        },
      });
    });

    let connect = await waitForReady(page);
    await page.evaluate(() => window.__appStore.getState().setSettingsOpen(true));
    const speed = page.getByTestId('six-dof-speed');
    await speed.waitFor({ state: 'visible' });
    assert.equal(
      await speed.inputValue(),
      '1.5',
      'new installs use the requested 150% 3D mouse speed',
    );
    await speed.fill('2');
    await page.waitForFunction(
      () => window.__appStore.getState().sixDofSpeed === 2,
    );
    assert.equal(
      await page.evaluate(() => localStorage.getItem('nbcad.sixDofSpeed')),
      '2',
      '3D mouse speed is persisted as an application preference',
    );
    await page.reload({ waitUntil: 'networkidle' });
    connect = await waitForReady(page);
    assert.equal(
      await page.evaluate(() => window.__appStore.getState().sixDofSpeed),
      2,
      'the 3D mouse speed survives an application reload',
    );
    await page.evaluate(() => window.__appStore.getState().setSixDofSpeed(1.5));
    assert.equal(
      await page.evaluate(() => window.__driverMock.client),
      null,
      'browser startup does not connect to the optional driver bridge',
    );
    assert.equal(
      await page.locator('script[data-six-dof-driver-bridge]').count(),
      0,
      'browser startup does not inject a hosted bridge script',
    );
    const beforeConnect = await page.evaluate(() => window.__cameraApi.getSnapshot());
    await connect.click();
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="six-dof-mouse-connect"]')
          ?.getAttribute('title') ===
        '3D mouse connected through the installed driver.',
    );
    // Production deliberately paints the green connected state one frame
    // before enabling driver callbacks, so a cap displaced during the local
    // handshake cannot jump the camera. Wait through that paint boundary
    // before asserting post-connection motion.
    await page.evaluate(() => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
    const afterConnect = await page.evaluate(() => window.__cameraApi.getSnapshot());
    assert.equal(
      await page.evaluate(() => window.__driverMock.preReadyMutationAttempted),
      true,
    );
    assert.deepEqual(
      afterConnect,
      beforeConnect,
      'driver motion must remain gated until the connected state is visible',
    );
    assert.equal(
      await page.evaluate(
        () => window.__driverMock.focusElement === document.getElementById('root'),
      ),
      true,
      'driver focus spans the complete application workspace',
    );

    // Feature dialogs are siblings of the viewport inside #root. Navigation
    // must remain active while their controls own keyboard focus.
    await page.evaluate(() => window.__appStore.getState().openFilletDialog(0));
    const workflowDialog = page.getByTestId('solid-fillet-dialog');
    await workflowDialog.waitFor({ state: 'visible' });
    const workflowCancel = page.getByTestId('solid-fillet-cancel');
    await workflowCancel.focus();
    assert.equal(
      await page.evaluate(
        () =>
          window.__driverMock.focusElement.contains(document.activeElement) &&
          document.activeElement.closest('[data-testid="solid-fillet-dialog"]') !== null,
      ),
      true,
      'focused workflow controls remain inside the driver-owned workspace',
    );

    const before = await page.evaluate(() => window.__cameraApi.getSnapshot());
    await page.evaluate(() => {
      const client = window.__driverMock.client;
      client.onStartMotion();
      const matrix = window.__driverMock.client.getViewMatrix();
      matrix[12] += 120;
      matrix[13] -= 35;
      client.setViewMatrix(matrix);
      const target = client.getViewTarget();
      const expectedTarget = [target[0] + 120, target[1] - 35, target[2]];
      client.setTarget(expectedTarget);
      // Simulate the driver's auto-pivot changing after a large movement.
      // This must not replace the camera's explicit look target.
      client.setPivotPosition([10_000, -10_000, 5_000]);
      client.onStopMotion();
      window.__driverMock.expectedTarget = expectedTarget;
      window.__driverMock.stoppedSnapshot = window.__cameraApi.getSnapshot();
    });
    await page.waitForTimeout(50);
    const after = await page.evaluate(() => window.__cameraApi.getSnapshot());
    assert.notDeepEqual(after.position, before.position, 'driver camera matrices move the viewport');
    assert.deepEqual(
      after.target.map((value) => Math.round(value * 1e6) / 1e6),
      await page.evaluate(() =>
        window.__driverMock.expectedTarget.map(
          (value) => Math.round(value * 1e6) / 1e6,
        ),
      ),
      'an automatic rotation-pivot update does not replace the camera target',
    );
    const stoppedSnapshot = await page.evaluate(
      () => window.__driverMock.stoppedSnapshot,
    );
    const postStopDrift = Math.max(
      ...['position', 'target', 'up'].flatMap((key) =>
        after[key].map((value, index) =>
          Math.abs(value - stoppedSnapshot[key][index]),
        ),
      ),
    );
    assert.ok(
      postStopDrift < 1e-8,
      `the camera does not jump after motion stops (drift ${postStopDrift})`,
    );
    assert.deepEqual(
      await page.evaluate(() => window.__driverMock.updates[0]),
      { frame: { timingSource: 0 } },
      'the driver uses device-timed frames without an application rAF round trip',
    );

    await workflowCancel.click();
    await connect.click();
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="six-dof-mouse-connect"]')
          ?.getAttribute('title') === '3D mouse disconnected.',
    );
    assert.deepEqual(
      await page.evaluate(() => ({
        deleted: window.__driverMock.deleted,
        closed: window.__driverMock.closed,
      })),
      { deleted: true, closed: true },
    );
    assert.deepEqual(errors, []);
    console.log('  [ok] Installed-driver bridge connects and drives the viewport');
  }

  {
    const { page, errors } = await newPage();
    await page.addInitScript(() => {
      // Exercise the offline/raw-device fallback without loading a remote script.
      window.__sixDofDriverScriptUrl = '';

      class MockHidDevice extends EventTarget {
        constructor({ productName, productId, collections }) {
          super();
          this.opened = false;
          this.vendorId = 0x256f;
          this.productId = productId;
          this.productName = productName;
          this.collections = collections;
        }

        async open() {
          this.opened = true;
        }

        async close() {
          this.opened = false;
        }
      }

      const physicalDevice = new MockHidDevice({
        productName: 'SpaceMouse Wireless BT',
        productId: 0xc63a,
        collections: [{ usagePage: 0x01, usage: 0x08 }],
      });
      const virtualDriverDevice = new MockHidDevice({
        productName: '3D mouse virtual data',
        productId: 0xc672,
        collections: [{ usagePage: 0xff00, usage: 0x01 }],
      });
      class MockHid extends EventTarget {
        requestOptions = null;

        async getDevices() {
          return [virtualDriverDevice];
        }

        async requestDevice(options) {
          this.requestOptions = options;
          return [physicalDevice];
        }

        dispatchReport(reportId, bytes) {
          const event = new Event('inputreport');
          Object.defineProperties(event, {
            reportId: { value: reportId },
            data: { value: new DataView(Uint8Array.from(bytes).buffer) },
          });
          physicalDevice.dispatchEvent(event);
        }

        dispatchConnection(type) {
          const event = new Event(type);
          Object.defineProperty(event, 'device', { value: physicalDevice });
          this.dispatchEvent(event);
        }
      }
      const mock = new MockHid();
      mock.physicalDevice = physicalDevice;
      Object.defineProperty(navigator, 'hid', {
        configurable: true,
        value: mock,
      });
      window.__sixDofMock = mock;
    });

    const connect = await waitForReady(page);
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="six-dof-mouse-connect"]')
          ?.getAttribute('title')
          ?.includes('loads only after you click'),
    );
    await connect.click();
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="six-dof-mouse-connect"]')
          ?.getAttribute('title')
          ?.includes('Click again to choose a raw 3D mouse.'),
    );
    await connect.click();
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="six-dof-mouse-connect"]')
          ?.getAttribute('title') === 'SpaceMouse Wireless BT',
    );

    const connection = await page.evaluate(() => ({
      opened: window.__sixDofMock.physicalDevice.opened,
      filters: window.__sixDofMock.requestOptions.filters,
    }));
    assert.equal(connection.opened, true);
    assert.deepEqual(connection.filters, [
      { vendorId: 0x256f, usagePage: 0x01, usage: 0x08 },
      { vendorId: 0x046d, usagePage: 0x01, usage: 0x08 },
    ]);
    const canonicalCalibration = await page.evaluate(async () => {
      const input = await import('/src/input/sixDofMouse.ts');
      return {
        translation: input.canonicalizeSixDofTranslation([1, -2, -3]),
        rotation: input.canonicalizeSixDofRotation([1, -2, 3]),
      };
    });
    assert.deepEqual(
      canonicalCalibration,
      {
        translation: [1, 2, 3],
        rotation: [1, 2, -3],
      },
      'device axes are converted to right/forward/up object-motion signs',
    );

    let previousOrientation = await readOrientation(page);
    const axisReports = [
      {
        name: 'pitch',
        bytes: [0, 0, 0, 0, 0, 0, 0x5e, 0x01, 0, 0, 0, 0],
      },
      {
        name: 'roll',
        bytes: [0, 0, 0, 0, 0, 0, 0, 0, 0x5e, 0x01, 0, 0],
      },
      {
        name: 'yaw',
        bytes: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x5e, 0x01],
      },
    ];
    for (const report of axisReports) {
      await page.evaluate(
        (bytes) => window.__sixDofMock.dispatchReport(1, bytes),
        report.bytes,
      );
      await page.waitForTimeout(140);
      const nextOrientation = await readOrientation(page);
      assert.notDeepEqual(
        nextOrientation,
        previousOrientation,
        `${report.name} input independently changes the viewport orientation`,
      );
      previousOrientation = nextOrientation;
    }

    await page.evaluate(() => {
      window.__sixDofMock.physicalDevice.opened = false;
      window.__sixDofMock.dispatchConnection('disconnect');
    });
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="six-dof-mouse-connect"]')
          ?.getAttribute('title') ===
        '3D mouse disconnected. Wake it or click to reconnect.',
    );
    await page.evaluate(() => window.__sixDofMock.dispatchConnection('connect'));
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="six-dof-mouse-connect"]')
          ?.getAttribute('title') === 'SpaceMouse Wireless BT',
    );
    assert.equal(
      await page.evaluate(() => window.__sixDofMock.physicalDevice.opened),
      true,
      'a permitted wireless device reconnects when it wakes',
    );

    await connect.click();
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="six-dof-mouse-connect"]')
          ?.getAttribute('title') === '3D mouse disconnected.',
    );
    assert.equal(
      await page.evaluate(() => window.__sixDofMock.physicalDevice.opened),
      false,
    );
    assert.deepEqual(errors, []);
    console.log('  [ok] Chrome WebHID selects and drives a multi-axis 3D mouse');
  }

  {
    const { page, errors } = await newPage();
    await page.addInitScript(() => {
      window.__sixDofDriverScriptUrl = '';
      window.__pickerRequests = 0;
      const hid = new EventTarget();
      hid.getDevices = async () => [];
      hid.requestDevice = () => {
        window.__pickerRequests += 1;
        return new Promise(() => {});
      };
      Object.defineProperty(navigator, 'hid', {
        configurable: true,
        value: hid,
      });
    });

    const connect = await waitForReady(page);
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="six-dof-mouse-connect"]')
          ?.getAttribute('title')
          ?.includes('loads only after you click'),
    );
    await connect.click();
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="six-dof-mouse-connect"]')
          ?.getAttribute('title')
          ?.includes('Click again to choose a raw 3D mouse.'),
    );
    await connect.click();
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="six-dof-mouse-connect"]')
          ?.getAttribute('title')
          ?.includes('device picker timed out'),
      undefined,
      { timeout: 20_000 },
    );
    assert.equal(await connect.isEnabled(), true, 'a timed-out picker remains retryable');
    await connect.click();
    await page.waitForFunction(() => window.__pickerRequests === 2);
    assert.deepEqual(errors, []);
    console.log('  [ok] A stalled device chooser times out and can be retried');
  }

  if (process.platform === 'win32') {
    const { page, errors } = await newPage();
    await waitForReady(page);
    const nativeStartup = await page.evaluate(async () => {
      const calls = [];
      let callbackId = 0;
      window.__TAURI_INTERNALS__ = {
        invoke: async (command) => {
          calls.push(command);
          return null;
        },
        transformCallback: () => {
          callbackId += 1;
          return callbackId;
        },
        unregisterCallback: () => undefined,
      };
      const statuses = [];
      const { createSixDofMouseController } = await import(
        '/src/input/sixDofMouse.ts?native-startup-regression'
      );
      const controller = createSixDofMouseController(
        () => undefined,
        (status) => statuses.push(status),
      );
      await controller.connect();
      const startupCalls = [...calls];
      await controller.dispose();
      delete window.__TAURI_INTERNALS__;
      return { startupCalls, statuses };
    });
    assert.equal(
      nativeStartup.startupCalls.includes('six_dof_mouse_connect'),
      false,
      'Windows startup must not silently attach the raw Bluetooth HID path',
    );
    assert.equal(
      nativeStartup.statuses.at(-1)?.message,
      'Click to connect the 3D mouse through 3DxWare.',
    );
    assert.deepEqual(errors, []);
    console.log('  [ok] Windows startup leaves raw Bluetooth HID disconnected');
  } else {
    console.log('  [skip] Windows native startup policy on non-Windows host');
  }
} finally {
  await browser.close();
}
