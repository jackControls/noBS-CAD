import { isTauriRuntime } from '../engine';
import type { SixDofMotion } from '../components/viewport/cameraApi';
import {
  openThreeDConnexionBridge,
  type DriverBridgeConnection,
  type SixDofDriverView,
} from './threeDConnexionBridge';

export type SixDofMouseConnectionStatus =
  | { state: 'unsupported'; message: string }
  | { state: 'disconnected'; message: string }
  | { state: 'connecting'; message: string }
  | { state: 'connected'; message: string }
  | { state: 'error'; message: string };

export interface SixDofMouseConnectOptions {
  /**
   * Open the browser's WebHID chooser when no previously authorized raw
   * device is available. This must be called from a user gesture.
   */
  requestPermission?: boolean;
  /**
   * Allow the optional hosted 3DconnexionJS bridge to load. Browser startup
   * deliberately leaves this false; the user enables it by clicking Connect.
   */
  allowDriverBridge?: boolean;
}

export interface SixDofMouseController {
  supported: boolean;
  connect(options?: SixDofMouseConnectOptions): Promise<void>;
  disconnect(): Promise<void>;
  dispose(): Promise<void>;
}

interface HidInputReportEventLike extends Event {
  data: DataView;
  reportId: number;
}

interface HidDeviceLike extends EventTarget {
  opened: boolean;
  vendorId: number;
  productId: number;
  productName: string;
  collections: ReadonlyArray<{
    usagePage: number;
    usage: number;
  }>;
  open(): Promise<void>;
  close(): Promise<void>;
}

interface HidConnectionEventLike extends Event {
  device: HidDeviceLike;
}

interface HidApiLike extends EventTarget {
  getDevices(): Promise<HidDeviceLike[]>;
  requestDevice(options: {
    filters: Array<{
      vendorId: number;
      usagePage: number;
      usage: number;
    }>;
  }): Promise<HidDeviceLike[]>;
}

interface HidNavigator {
  hid?: HidApiLike;
}

interface NativeMotionPacket {
  translation?: [number, number, number] | null;
  rotation?: [number, number, number] | null;
}

const VENDOR_IDS = new Set([0x256f, 0x046d]);
const GENERIC_DESKTOP_USAGE_PAGE = 0x01;
const MULTI_AXIS_CONTROLLER_USAGE = 0x08;
const RAW_FULL_SCALE = 350;
// A released cap should stop within roughly three display frames. The old
// 90-ms hold made raw-HID motion feel visibly behind the user's hand.
const MOTION_TIMEOUT_MS = 45;
const HID_OPEN_TIMEOUT_MS = 4_000;
const DEVICE_PICKER_TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function isSixDofDevice(device: HidDeviceLike): boolean {
  return (
    VENDOR_IDS.has(device.vendorId) &&
    device.collections.some(
      (collection) =>
        collection.usagePage === GENERIC_DESKTOP_USAGE_PAGE &&
        collection.usage === MULTI_AXIS_CONTROLLER_USAGE,
    )
  );
}

function normalizeAxis(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  const normalized = Math.max(-1, Math.min(1, raw / RAW_FULL_SCALE));
  return Math.abs(normalized) < 0.025 ? 0 : normalized;
}

const reversedAxis = (value: number) => (value === 0 ? 0 : -value);

/**
 * Convert the 3Dconnexion device basis into the camera API's object-motion
 * basis. A physical push right is +X, while away and lift arrive as -Y/-Z.
 */
export function canonicalizeSixDofTranslation(
  device: [number, number, number],
): [number, number, number] {
  return [device[0], reversedAxis(device[1]), reversedAxis(device[2])];
}

/**
 * Positive camera-API rotation describes the part following the cap. Driver
 * Rx already matches tilt forward/back; Ry and Rz use the inverse sign for
 * tilt left/right and twist in our camera basis.
 */
export function canonicalizeSixDofRotation(
  device: [number, number, number],
): [number, number, number] {
  return [
    device[0],
    reversedAxis(device[1]),
    reversedAxis(device[2]),
  ];
}

function readVector(data: DataView, byteOffset = 0): [number, number, number] | null {
  if (data.byteLength < byteOffset + 6) return null;
  return [
    normalizeAxis(data.getInt16(byteOffset, true)),
    normalizeAxis(data.getInt16(byteOffset + 2, true)),
    normalizeAxis(data.getInt16(byteOffset + 4, true)),
  ];
}

function readButtonMask(data: DataView): number {
  let mask = 0;
  const byteCount = Math.min(4, data.byteLength);
  for (let index = 0; index < byteCount; index += 1) {
    mask |= data.getUint8(index) << (index * 8);
  }
  return mask >>> 0;
}

function createMotionAccumulator(onMotion: (motion: SixDofMotion) => void) {
  let translation: [number, number, number] = [0, 0, 0];
  let rotation: [number, number, number] = [0, 0, 0];
  let translationAt = 0;
  let rotationAt = 0;
  let previousFrame = 0;
  let frame = 0;

  const active = (vector: [number, number, number]) =>
    vector.some((value) => Math.abs(value) > 0);

  const tick = (now: number) => {
    frame = 0;
    if (now - translationAt > MOTION_TIMEOUT_MS) translation = [0, 0, 0];
    if (now - rotationAt > MOTION_TIMEOUT_MS) rotation = [0, 0, 0];
    const deltaSeconds = previousFrame > 0 ? (now - previousFrame) / 1000 : 1 / 60;
    previousFrame = now;
    if (active(translation) || active(rotation)) {
      const motion = {
        translation: [...translation] as [number, number, number],
        rotation: [...rotation] as [number, number, number],
        deltaSeconds,
      };
      onMotion(motion);
      frame = requestAnimationFrame(tick);
    } else {
      previousFrame = 0;
    }
  };

  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(tick);
  };

  return {
    push(packet: NativeMotionPacket) {
      const now = performance.now();
      if (packet.translation) {
        const normalizedDevice = packet.translation.map(normalizeAxis) as [
          number,
          number,
          number,
        ];
        translation = canonicalizeSixDofTranslation(normalizedDevice);
        translationAt = now;
      }
      if (packet.rotation) {
        const normalizedDevice = packet.rotation.map(normalizeAxis) as [
          number,
          number,
          number,
        ];
        rotation = canonicalizeSixDofRotation(normalizedDevice);
        rotationAt = now;
      }
      schedule();
    },
    pushNormalized(packet: NativeMotionPacket) {
      const now = performance.now();
      if (packet.translation) {
        translation = canonicalizeSixDofTranslation(packet.translation);
        translationAt = now;
      }
      if (packet.rotation) {
        rotation = canonicalizeSixDofRotation(packet.rotation);
        rotationAt = now;
      }
      schedule();
    },
    stop() {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      previousFrame = 0;
      translation = [0, 0, 0];
      rotation = [0, 0, 0];
    },
  };
}

export function createSixDofMouseController(
  onMotion: (motion: SixDofMotion) => void,
  onStatus: (status: SixDofMouseConnectionStatus) => void,
  onButton?: (button: number) => void,
  getDriverView?: () => SixDofDriverView | null,
): SixDofMouseController {
  const accumulator = createMotionAccumulator(onMotion);
  let webDevice: HidDeviceLike | null = null;
  let removeWebReport: (() => void) | null = null;
  let driverConnection: DriverBridgeConnection | null = null;
  let driverAbort: AbortController | null = null;
  let nativeUnlisten: Array<() => void> = [];
  let previousButtonMask = 0;
  let autoReconnect = true;
  let disposed = false;
  let connectionAttempt = 0;
  let driverProbeFailed = false;
  const hid = (navigator as Navigator & HidNavigator).hid;
  const browserBridgeSupported =
    typeof window !== 'undefined' &&
    typeof document !== 'undefined' &&
    typeof WebSocket !== 'undefined' &&
    typeof XMLHttpRequest !== 'undefined';
  const supported = isTauriRuntime() || hid !== undefined || browserBridgeSupported;

  const attachWebDevice = async (device: HidDeviceLike, attempt = connectionAttempt) => {
    if (disposed || attempt !== connectionAttempt) return false;
    removeWebReport?.();
    removeWebReport = null;
    if (webDevice && webDevice !== device && webDevice.opened) {
      await webDevice.close().catch(() => undefined);
    }
    if (!device.opened) {
      await withTimeout(
        device.open(),
        HID_OPEN_TIMEOUT_MS,
        'Opening the selected 3D mouse timed out.',
      );
    }
    if (disposed || attempt !== connectionAttempt) {
      if (device.opened) await device.close().catch(() => undefined);
      return false;
    }
    const report = (rawEvent: Event) => {
      const event = rawEvent as HidInputReportEventLike;
      if (event.reportId === 1) {
        const translation = readVector(event.data);
        const rotation = readVector(event.data, 6);
        accumulator.pushNormalized({ translation, rotation });
      } else if (event.reportId === 2) {
        const rotation = readVector(event.data);
        accumulator.pushNormalized({ rotation });
      } else if (event.reportId === 3 && event.data.byteLength >= 1) {
        const mask = readButtonMask(event.data);
        const newlyPressed = mask & ~previousButtonMask;
        previousButtonMask = mask;
        for (let index = 0; index < 32; index += 1) {
          if (newlyPressed & (1 << index)) onButton?.(index + 1);
        }
      }
    };
    device.addEventListener('inputreport', report);
    removeWebReport = () => device.removeEventListener('inputreport', report);
    webDevice = device;
    onStatus({
      state: 'connected',
      message: device.productName || '3D mouse connected',
    });
    return true;
  };

  const detachWebDevice = async (close: boolean) => {
    accumulator.stop();
    removeWebReport?.();
    removeWebReport = null;
    if (close && webDevice?.opened) await webDevice.close().catch(() => undefined);
    webDevice = null;
    previousButtonMask = 0;
  };

  const webConnect = (rawEvent: Event) => {
    const device = (rawEvent as HidConnectionEventLike).device;
    if (
      !autoReconnect ||
      disposed ||
      driverConnection ||
      webDevice ||
      !isSixDofDevice(device)
    ) {
      return;
    }
    void attachWebDevice(device).catch((error) => {
      onStatus({
        state: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    });
  };

  const webDisconnect = (rawEvent: Event) => {
    const device = (rawEvent as HidConnectionEventLike).device;
    if (device !== webDevice) return;
    void detachWebDevice(false).then(() => {
      if (!disposed) {
        onStatus({
          state: 'disconnected',
          message: '3D mouse disconnected. Wake it or click to reconnect.',
        });
      }
    });
  };

  if (!isTauriRuntime() && hid) {
    hid.addEventListener('connect', webConnect);
    hid.addEventListener('disconnect', webDisconnect);
  }

  const connectNative = async () => {
    nativeUnlisten.forEach((unlisten) => unlisten());
    nativeUnlisten = [];
    const [{ invoke }, { listen }] = await Promise.all([
      import('@tauri-apps/api/core'),
      import('@tauri-apps/api/event'),
    ]);
    const listeners: Array<() => void> = [];
    try {
      listeners.push(
        await listen<NativeMotionPacket>('six-dof-mouse-motion', (event) => {
          accumulator.push(event.payload);
        }),
        await listen<{ button: number }>('six-dof-mouse-button', (event) => {
          onButton?.(event.payload.button);
        }),
        await listen<string>('six-dof-mouse-error', (event) => {
          accumulator.stop();
          onStatus({
            state: 'error',
            message: `3D mouse input stopped: ${event.payload}`,
          });
        }),
      );
      nativeUnlisten = listeners;
      const device = await invoke<{ product_name: string }>('six_dof_mouse_connect');
      onStatus({
        state: 'connected',
        message: device.product_name || '3D mouse connected',
      });
    } catch (error) {
      listeners.forEach((unlisten) => unlisten());
      nativeUnlisten = [];
      throw error;
    }
  };

  const detachNative = async () => {
    nativeUnlisten.forEach((unlisten) => unlisten());
    nativeUnlisten = [];
    accumulator.stop();
    if (isTauriRuntime()) {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('six_dof_mouse_disconnect').catch(() => undefined);
    }
  };

  const detachDriver = () => {
    driverAbort?.abort();
    driverAbort = null;
    driverConnection?.disconnect();
    driverConnection = null;
  };

  const connectDriver = async (
    view: SixDofDriverView,
    attempt: number,
  ): Promise<boolean> => {
    detachDriver();
    const abort = new AbortController();
    driverAbort = abort;
    const connection = await openThreeDConnexionBridge(
      view,
      abort.signal,
      (message) => {
        if (disposed || attempt !== connectionAttempt) return;
        driverConnection = null;
        driverAbort = null;
        onStatus({ state: 'disconnected', message });
      },
      onButton,
    );
    if (disposed || attempt !== connectionAttempt) {
      connection.disconnect();
      return false;
    }
    driverConnection = connection;
    driverAbort = null;
    driverProbeFailed = false;
    await detachWebDevice(true);
    onStatus({
      state: 'connected',
      message: '3D mouse connected through the installed driver.',
    });
    // Paint the green connected indicator before allowing any driver callback
    // to mutate the camera. A displaced cap during the handshake stays inert.
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => window.setTimeout(resolve, 0));
    });
    if (disposed || attempt !== connectionAttempt) {
      connection.disconnect();
      return false;
    }
    connection.activate();
    return true;
  };

  return {
    supported,
    async connect(options: SixDofMouseConnectOptions = {}) {
      const {
        requestPermission = false,
        allowDriverBridge = false,
      } = options;
      const attempt = ++connectionAttempt;
      autoReconnect = true;
      driverAbort?.abort();
      if (!supported) {
        onStatus({
          state: 'unsupported',
          message: 'This browser cannot connect to a 3D mouse.',
        });
        return;
      }
      onStatus({ state: 'connecting', message: 'Connecting 3D mouse…' });
      try {
        if (isTauriRuntime()) {
          // A deliberate Connect click on Windows opts into 3DxWare's local
          // Navigation Library. That path honors the driver's calibrated axis
          // mapping and per-application settings; raw HID remains an explicit
          // offline fallback when the driver is unavailable.
          const driverView = getDriverView?.() ?? null;
          const windowsDesktop = /Windows/i.test(navigator.userAgent);
          // Do not silently attach a raw Windows/Bluetooth HID device during
          // startup. A deliberate click prefers 3DxWare's calibrated mapping
          // and may still fall back to raw HID if the driver is unavailable.
          if (windowsDesktop && !allowDriverBridge && !requestPermission) {
            await detachNative();
            onStatus({
              state: 'disconnected',
              message: 'Click to connect the 3D mouse through 3DxWare.',
            });
            return;
          }
          if (allowDriverBridge && windowsDesktop && driverView) {
            await detachNative();
            try {
              if (await connectDriver(driverView, attempt)) return;
            } catch {
              driverProbeFailed = true;
              detachDriver();
            }
            if (disposed || attempt !== connectionAttempt) return;
          }
          await connectNative();
          return;
        }
        const permitted = hid
          ? (await hid.getDevices()).filter(isSixDofDevice)
          : [];
        if (disposed || attempt !== connectionAttempt) return;

        let driverError: unknown = null;
        const driverView = getDriverView?.() ?? null;
        // Loading the hosted bridge is an explicit user choice. If that probe
        // fails, defer Chrome's raw-device chooser to the next click so it
        // still has transient user activation.
        const shouldTryDriver =
          allowDriverBridge &&
          driverView !== null &&
          (!requestPermission || permitted.length > 0 || !driverProbeFailed);
        if (shouldTryDriver) {
          try {
            if (await connectDriver(driverView, attempt)) return;
          } catch (error) {
            driverError = error;
            driverProbeFailed = true;
            detachDriver();
          }
        }
        if (disposed || attempt !== connectionAttempt) return;
        if (!allowDriverBridge && !requestPermission && permitted.length === 0) {
          onStatus({
            state: 'disconnected',
            message:
              'Connect a compatible 3D mouse. The browser driver bridge loads only after you click.',
          });
          return;
        }
        if (!hid) {
          throw (
            driverError ??
            new Error('The installed 3D mouse driver browser service is unavailable.')
          );
        }
        if (driverError && requestPermission && permitted.length === 0) {
          onStatus({
            state: 'disconnected',
            message:
              'The installed driver service is unavailable. Click again to choose a raw 3D mouse.',
          });
          return;
        }

        const devices =
          permitted.length > 0 || !requestPermission
            ? permitted
            : (
                await withTimeout(
                  hid.requestDevice({
                    filters: [...VENDOR_IDS].map((vendorId) => ({
                      vendorId,
                      usagePage: GENERIC_DESKTOP_USAGE_PAGE,
                      usage: MULTI_AXIS_CONTROLLER_USAGE,
                    })),
                  }),
                  DEVICE_PICKER_TIMEOUT_MS,
                  'The device picker timed out. Click the 3D mouse button to try again.',
                )
              ).filter(isSixDofDevice);
        if (disposed || attempt !== connectionAttempt) return;
        if (!devices[0]) {
          onStatus({
            state: 'disconnected',
            message: driverError
              ? 'The 3D mouse driver service is unavailable. Click to choose a raw device.'
              : 'No multi-axis 3D mouse selected. Click to choose one.',
          });
          return;
        }
        try {
          await attachWebDevice(devices[0], attempt);
        } catch (error) {
          if (driverError) {
            throw new Error(
              'The desktop driver owns this device, but its browser service is unavailable. Start 3DxNLServer (or repair 3DxWare), then retry.',
            );
          }
          throw error;
        }
      } catch (error) {
        if (disposed || attempt !== connectionAttempt) return;
        if (error instanceof DOMException && error.name === 'AbortError') return;
        onStatus({
          state: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    async disconnect() {
      connectionAttempt += 1;
      autoReconnect = false;
      detachDriver();
      await detachWebDevice(true);
      await detachNative();
      onStatus({ state: 'disconnected', message: '3D mouse disconnected.' });
    },
    async dispose() {
      disposed = true;
      connectionAttempt += 1;
      autoReconnect = false;
      detachDriver();
      if (hid) {
        hid.removeEventListener('connect', webConnect);
        hid.removeEventListener('disconnect', webDisconnect);
      }
      await detachWebDevice(true);
      await detachNative();
    },
  };
}
