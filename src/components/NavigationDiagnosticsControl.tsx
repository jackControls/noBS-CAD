import { Check, CircleDot, Square } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { cx } from '../lib/cx';
import {
  getNavigationDiagnosticsUiState,
  subscribeNavigationDiagnostics,
  toggleNavigationDiagnostics,
} from '../input/navigationDiagnostics';

/**
 * Recorder activation lives in the opaque React ribbon, outside the embedded
 * native viewport. It therefore remains clickable and visible even when
 * AppKit/WebView keyboard shortcuts or native compositing behave differently.
 */
export function NavigationDiagnosticsControl() {
  const state = useSyncExternalStore(
    subscribeNavigationDiagnostics,
    getNavigationDiagnosticsUiState,
    getNavigationDiagnosticsUiState,
  );
  const saved = !state.active && state.directory !== null;
  const failed = !state.active && state.error !== null;
  const title = state.active
    ? 'Stop navigation recording'
    : state.error
      ? `Navigation recorder error: ${state.error}`
      : saved
        ? `Start another navigation recording. Last saved to ${state.directory}`
        : 'Record SpaceMouse and touchpad diagnostics';

  return (
    <div
      data-testid="navigation-recorder-control"
      className="ml-auto flex h-full shrink-0 items-center border-l border-edge bg-header px-1"
    >
      <button
        type="button"
        data-testid="navigation-recorder-toggle"
        aria-pressed={state.active}
        title={title}
        disabled={state.busy}
        onClick={() => void toggleNavigationDiagnostics().catch(() => undefined)}
        className={cx(
          'relative flex h-6 min-w-[82px] items-center justify-center gap-1.5 rounded px-2 text-mute transition-colors hover:bg-edge hover:text-ink disabled:opacity-50',
          state.active && 'bg-red-500/10 text-red-500 hover:bg-red-500/15 hover:text-red-500',
          failed && 'text-red-500',
        )}
      >
        {state.active ? (
          <Square size={12} fill="currentColor" />
        ) : saved ? (
          <Check size={14} className="text-emerald-500" />
        ) : (
          <CircleDot size={14} />
        )}
        <span className="text-[10px] font-medium leading-none">
          {state.active ? 'RECORDING' : failed ? 'REC ERROR' : saved ? 'REC SAVED' : 'NAV REC'}
        </span>
        {state.active && (
          <span className="absolute right-1 top-1 h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
        )}
      </button>
    </div>
  );
}
