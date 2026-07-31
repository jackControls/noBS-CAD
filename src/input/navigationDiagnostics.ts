import { invoke } from '@tauri-apps/api/core';

export interface NavigationDiagnosticSessionInfo {
  id: string;
  directory: string;
  tracePath: string;
  startedUnixMs: number;
}

export interface NavigationDiagnosticUiState {
  active: boolean;
  busy: boolean;
  directory: string | null;
  error: string | null;
  startedAt: number | null;
}

interface NavigationDiagnosticEntry {
  sequence: number;
  stage: string;
  performanceMs: number;
  unixMs: number;
  data: unknown;
}

const CAPTURE_INTERVAL_MS = 250;
const FLUSH_INTERVAL_MS = 200;
const MAX_SESSION_MS = 60_000;
const MAX_BUFFERED_ENTRIES = 50_000;

let uiState: NavigationDiagnosticUiState = {
  active: false,
  busy: false,
  directory: null,
  error: null,
  startedAt: null,
};
let session: NavigationDiagnosticSessionInfo | null = null;
let sequence = 0;
let entries: NavigationDiagnosticEntry[] = [];
let flushTimer = 0;
let captureTimer = 0;
let stopTimer = 0;
let captureInFlight = false;
let flushInFlight: Promise<void> | null = null;
let contextProvider: (() => unknown) | null = null;
const subscribers = new Set<() => void>();

function isTauriRuntime(): boolean {
  return '__TAURI_INTERNALS__' in window;
}

function publish(patch: Partial<NavigationDiagnosticUiState>): void {
  uiState = { ...uiState, ...patch };
  for (const subscriber of subscribers) subscriber();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function subscribeNavigationDiagnostics(subscriber: () => void): () => void {
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
}

export function getNavigationDiagnosticsUiState(): NavigationDiagnosticUiState {
  return uiState;
}

export function dismissNavigationDiagnosticsNotice(): void {
  if (uiState.active || uiState.busy) return;
  publish({ directory: null, error: null });
}

export function registerNavigationDiagnosticContext(
  provider: () => unknown,
): () => void {
  contextProvider = provider;
  return () => {
    if (contextProvider === provider) contextProvider = null;
  };
}

export function recordNavigationDiagnostic(stage: string, data: unknown): void {
  if (!uiState.active) return;
  if (entries.length >= MAX_BUFFERED_ENTRIES) {
    entries.shift();
  }
  entries.push({
    sequence: ++sequence,
    stage,
    performanceMs: performance.now(),
    unixMs: Date.now(),
    data,
  });
}

async function flushEntries(): Promise<void> {
  if (flushInFlight) return flushInFlight;
  if (entries.length === 0 || !session) return;
  const batch = entries.splice(0, entries.length);
  flushInFlight = invoke<void>('navigation_diagnostics_append', { entries: batch })
    .catch((error) => {
      entries.unshift(...batch);
      publish({ error: `Could not write diagnostic trace: ${errorMessage(error)}` });
    })
    .finally(() => {
      flushInFlight = null;
    });
  await flushInFlight;
}

async function captureFrame(reason: string): Promise<void> {
  if (!uiState.active || captureInFlight || !session) return;
  captureInFlight = true;
  const context = contextProvider?.() ?? null;
  recordNavigationDiagnostic('recorder.snapshot', { reason, context });
  try {
    const [frame, metrics] = await Promise.all([
      invoke<string>('navigation_diagnostics_capture'),
      invoke<unknown>('native_viewport_metrics').catch((error) => ({
        error: errorMessage(error),
      })),
    ]);
    recordNavigationDiagnostic('native.capture.queued', { reason, frame, metrics, context });
  } catch (error) {
    recordNavigationDiagnostic('native.capture.error', {
      reason,
      error: errorMessage(error),
      context,
    });
  } finally {
    captureInFlight = false;
  }
}

function clearTimers(): void {
  if (flushTimer) window.clearInterval(flushTimer);
  if (captureTimer) window.clearInterval(captureTimer);
  if (stopTimer) window.clearTimeout(stopTimer);
  flushTimer = 0;
  captureTimer = 0;
  stopTimer = 0;
}

export async function startNavigationDiagnostics(): Promise<NavigationDiagnosticSessionInfo> {
  if (session && uiState.active) return session;
  if (!isTauriRuntime()) {
    throw new Error('Navigation recording is available in the native desktop app.');
  }
  publish({ busy: true, error: null, directory: null });
  try {
    session = await invoke<NavigationDiagnosticSessionInfo>('navigation_diagnostics_start');
    sequence = 0;
    entries = [];
    publish({
      active: true,
      busy: false,
      directory: session.directory,
      startedAt: Date.now(),
    });
    recordNavigationDiagnostic('recorder.frontend.start', {
      session,
      userAgent: navigator.userAgent,
      language: navigator.language,
      devicePixelRatio: window.devicePixelRatio,
      screen: {
        width: window.screen.width,
        height: window.screen.height,
        availableWidth: window.screen.availWidth,
        availableHeight: window.screen.availHeight,
      },
      window: {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        outerWidth: window.outerWidth,
        outerHeight: window.outerHeight,
      },
      context: contextProvider?.() ?? null,
    });
    void captureFrame('start');
    flushTimer = window.setInterval(() => void flushEntries(), FLUSH_INTERVAL_MS);
    captureTimer = window.setInterval(
      () => void captureFrame('periodic'),
      CAPTURE_INTERVAL_MS,
    );
    stopTimer = window.setTimeout(
      () => void stopNavigationDiagnostics('time-limit'),
      MAX_SESSION_MS,
    );
    return session;
  } catch (error) {
    session = null;
    publish({ active: false, busy: false, error: errorMessage(error), startedAt: null });
    throw error;
  }
}

export async function stopNavigationDiagnostics(
  reason = 'user',
): Promise<NavigationDiagnosticSessionInfo | null> {
  if (!session || !uiState.active) return session;
  clearTimers();
  publish({ busy: true });
  recordNavigationDiagnostic('recorder.frontend.stop', {
    reason,
    context: contextProvider?.() ?? null,
  });
  await captureFrame('stop');
  await flushEntries();
  try {
    const finished = await invoke<NavigationDiagnosticSessionInfo>(
      'navigation_diagnostics_stop',
    );
    session = null;
    entries = [];
    publish({
      active: false,
      busy: false,
      directory: finished.directory,
      startedAt: null,
    });
    return finished;
  } catch (error) {
    publish({ busy: false, error: errorMessage(error) });
    throw error;
  }
}

export async function toggleNavigationDiagnostics(): Promise<void> {
  if (uiState.busy) return;
  if (uiState.active) {
    await stopNavigationDiagnostics();
  } else {
    await startNavigationDiagnostics();
  }
}
