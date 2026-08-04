/**
 * Browser bridge for the 3DxWare Navigation Library Server.
 *
 * Chrome cannot normally open a SpaceMouse through WebHID while the desktop
 * driver owns the HID interface. The optional installed-driver path instead
 * uses 3DconnexionJS to exchange camera state with the local Navigation
 * Library Server. No vendor code is bundled: the library is loaded from the
 * vendor's HTTPS endpoint only after the user explicitly requests a browser
 * connection. WebHID remains an offline/raw-device fallback.
 */

export interface SixDofDriverView {
  focusElement(): HTMLElement | null;
  beginMotion?(): void;
  endMotion?(): void;
  getViewMatrix(): number[];
  setViewMatrix(matrix: number[]): void;
  getViewTarget(): [number, number, number];
  setViewTarget(target: [number, number, number]): void;
  getViewFrustum(): [number, number, number, number, number, number];
  getFov(): number;
  setFov(radians: number): void;
  getModelExtents(): [number, number, number, number, number, number];
  getPivotPosition(): [number, number, number];
  setPivotPosition(position: [number, number, number]): void;
  getPointerPosition(): [number, number, number];
  getConstructionPlane(): [number, number, number, number];
  fit(): void;
}

interface DriverSession {
  close?(): void;
}

interface DriverInstance {
  connexion?: unknown;
  _3dcontroller?: unknown;
  session?: DriverSession | null;
  connect(): number;
  create3dmouse(element: HTMLElement, name: string, options?: number): void;
  delete3dmouse(): void;
  update3dcontroller(update: Record<string, unknown>): void;
}

interface DriverConstructor {
  new (client: Record<string, unknown>): DriverInstance;
  nlOptions?: {
    rowMajorOrder?: number;
  };
}

type DriverWindow = Window & {
  _3Dconnexion?: DriverConstructor;
  /**
   * Test/deployment override. An empty string disables the hosted bridge and
   * leaves WebHID as the only browser transport.
   */
  __sixDofDriverScriptUrl?: string;
};

export interface DriverBridgeConnection {
  activate(): void;
  disconnect(): void;
}

const DEFAULT_DRIVER_SCRIPT_URL =
  'https://3dconnexion.com/technical_support/3dconnexion.min.js';
const SCRIPT_LOAD_TIMEOUT_MS = 4_000;
const DRIVER_CONNECT_TIMEOUT_MS = 3_500;
const DEVICE_FRAME_TIMING_SOURCE = 0;
const IDENTITY_MATRIX = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

let driverLibraryPromise: Promise<DriverConstructor> | null = null;

function abortError(): DOMException {
  return new DOMException('3D mouse connection was cancelled.', 'AbortError');
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

function loadDriverLibrary(signal: AbortSignal): Promise<DriverConstructor> {
  const driverWindow = window as DriverWindow;
  if (driverWindow._3Dconnexion) return Promise.resolve(driverWindow._3Dconnexion);
  const scriptUrl =
    driverWindow.__sixDofDriverScriptUrl === undefined
      ? DEFAULT_DRIVER_SCRIPT_URL
      : driverWindow.__sixDofDriverScriptUrl;
  if (!scriptUrl) {
    return Promise.reject(new Error('The 3D mouse driver bridge is disabled.'));
  }
  if (!driverLibraryPromise) {
    driverLibraryPromise = new Promise<DriverConstructor>((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>(
        'script[data-six-dof-driver-bridge]',
      );
      const script = existing ?? document.createElement('script');
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        script.removeEventListener('load', onLoad);
        script.removeEventListener('error', onError);
        const constructor = (window as DriverWindow)._3Dconnexion;
        if (!error && constructor) resolve(constructor);
        else {
          driverLibraryPromise = null;
          reject(error ?? new Error('The 3D mouse driver bridge did not initialize.'));
        }
      };
      const onLoad = () => finish();
      const onError = () =>
        finish(new Error('Could not load the 3D mouse driver bridge.'));
      const timeout = window.setTimeout(
        () => finish(new Error('Loading the 3D mouse driver bridge timed out.')),
        SCRIPT_LOAD_TIMEOUT_MS,
      );
      script.addEventListener('load', onLoad);
      script.addEventListener('error', onError);
      if (!existing) {
        script.src = scriptUrl;
        script.async = true;
        script.dataset.sixDofDriverBridge = 'true';
        document.head.appendChild(script);
      }
    });
  }
  return new Promise<DriverConstructor>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    driverLibraryPromise!.then(
      (constructor) => {
        signal.removeEventListener('abort', onAbort);
        resolve(constructor);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

export async function openThreeDConnexionBridge(
  view: SixDofDriverView,
  signal: AbortSignal,
  onUnexpectedDisconnect: (message: string) => void,
  onButton?: (button: number) => void,
): Promise<DriverBridgeConnection> {
  throwIfAborted(signal);
  const Driver = await loadDriverLibrary(signal);
  throwIfAborted(signal);

  const element = view.focusElement();
  if (!element) throw new Error('The 3D viewport is not ready.');
  if (element.tabIndex < 0) element.tabIndex = 0;

  let driver: DriverInstance;
  let created = false;
  let connected = false;
  let connectionLost = false;
  let disposed = false;
  let inputEnabled = false;
  let driverMoving = false;
  let moving = false;
  let lookFrom: [number, number, number] = [0, 0, 0];
  let lookDirection: [number, number, number] = [0, 0, -1];
  let lookAperture = 0;
  let selectionOnly = false;

  const stopMotion = () => {
    const wasMoving = moving;
    moving = false;
    if (wasMoving) view.endMotion?.();
  };

  let resolveCreated!: () => void;
  let rejectCreated!: (error: Error) => void;
  const createdPromise = new Promise<void>((resolve, reject) => {
    resolveCreated = resolve;
    rejectCreated = reject;
  });

  const client: Record<string, unknown> = {
    // noBS CAD uses millimetres and a right-handed Z-up world.
    getCoordinateSystem: () => [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1],
    getConstructionPlane: () => view.getConstructionPlane(),
    getFloorPlane: () => [0, 0, 1, 0],
    getUnitsToMeters: () => 0.001,
    getFov: () => view.getFov(),
    getFrontView: () => IDENTITY_MATRIX,
    getLookAt: () => null,
    getModelExtents: () => view.getModelExtents(),
    getPerspective: () => true,
    getPivotPosition: () => view.getPivotPosition(),
    getPointerPosition: () => view.getPointerPosition(),
    getViewRotatable: () => true,
    getViewExtents: () => view.getModelExtents(),
    getViewFrustum: () => view.getViewFrustum(),
    getViewMatrix: () => view.getViewMatrix(),
    getViewTarget: () => view.getViewTarget(),
    getSelectionAffine: () => IDENTITY_MATRIX,
    getSelectionEmpty: () => true,
    getSelectionExtents: () => view.getModelExtents(),
    // Let the device initiate fresh frames. Application-timed frames add a
    // browser rAF and local-server round trip before every camera update.
    getFrameTimingSource: () => DEVICE_FRAME_TIMING_SOURCE,
    getFrameTime: () => performance.now(),

    setMoving: () => undefined,
    setTransaction: () => undefined,
    setViewMatrix: (matrix: number[]) => {
      if (inputEnabled) view.setViewMatrix(matrix);
    },
    setViewExtents: () => undefined,
    setFov: (radians: number) => {
      if (inputEnabled) view.setFov(radians);
    },
    setTarget: (target: [number, number, number]) => {
      if (inputEnabled) view.setViewTarget(target);
    },
    setActiveCommand: (command: string | number | null) => {
      if (
        inputEnabled &&
        (command === 31 || command === 'V3DK_FIT' || command === 'Fit')
      ) {
        view.fit();
      }
    },
    setPivotPosition: (position: [number, number, number]) => {
      if (inputEnabled) view.setPivotPosition(position);
    },
    setPivotVisible: () => undefined,
    setLookFrom: (position: [number, number, number]) => {
      lookFrom = position;
    },
    setLookDirection: (direction: [number, number, number]) => {
      lookDirection = direction;
    },
    setLookAperture: (aperture: number) => {
      lookAperture = aperture;
    },
    setSelectionOnly: (value: boolean) => {
      selectionOnly = value;
    },
    setSelectionAffine: () => undefined,
    setKeyPress: (button: number) => {
      if (inputEnabled) onButton?.(button);
    },
    setKeyRelease: () => undefined,
    setSettingsChanged: () => undefined,

    onStartMotion: () => {
      driverMoving = true;
      if (!inputEnabled) return;
      if (!moving) view.beginMotion?.();
      moving = true;
    },
    onStopMotion: () => {
      driverMoving = false;
      stopMotion();
    },
    onConnect: () => {
      if (disposed || signal.aborted) return;
      connected = true;
      try {
        driver.create3dmouse(element, 'noBS CAD');
      } catch (error) {
        rejectCreated(error instanceof Error ? error : new Error(String(error)));
      }
    },
    on3dmouseCreated: () => {
      if (disposed || signal.aborted) return;
      created = true;
      driver.update3dcontroller({
        frame: { timingSource: DEVICE_FRAME_TIMING_SOURCE },
      });
      element.focus({ preventScroll: true });
      resolveCreated();
    },
    onDisconnect: (reason: unknown) => {
      stopMotion();
      if (!created) {
        rejectCreated(new Error(`3D mouse driver connection failed (${String(reason)}).`));
      } else if (!disposed) {
        connectionLost = true;
        disposed = true;
        onUnexpectedDisconnect('3D mouse driver connection was lost. Click to reconnect.');
      }
    },
  };

  // Keep these state variables observable to the callbacks above. Some
  // Navigation Library versions query all registered properties eagerly.
  void lookFrom;
  void lookDirection;
  void lookAperture;
  void selectionOnly;

  driver = new Driver(client);
  const timeout = window.setTimeout(() => {
    rejectCreated(
      new Error(
        'The 3D mouse driver service did not respond. Start 3DxNLServer, then retry.',
      ),
    );
  }, DRIVER_CONNECT_TIMEOUT_MS);
  const abort = () => rejectCreated(abortError());
  signal.addEventListener('abort', abort, { once: true });

  try {
    if (!driver.connect()) throw new Error('Could not start the 3D mouse driver connection.');
    await createdPromise;
    throwIfAborted(signal);
    if (connectionLost) throw new Error('The 3D mouse driver connection was lost.');
  } catch (error) {
    disposed = true;
    stopMotion();
    if (connected) driver.session?.close?.();
    throw error;
  } finally {
    window.clearTimeout(timeout);
    signal.removeEventListener('abort', abort);
  }

  return {
    activate() {
      if (disposed || inputEnabled) return;
      inputEnabled = true;
      if (driverMoving && !moving) {
        view.beginMotion?.();
        moving = true;
      }
    },
    disconnect() {
      if (disposed) return;
      disposed = true;
      inputEnabled = false;
      stopMotion();
      try {
        if (created && driver.connexion != null) driver.delete3dmouse();
      } catch {
        // The local server may already be gone.
      }
      driver.session?.close?.();
    },
  };
}
