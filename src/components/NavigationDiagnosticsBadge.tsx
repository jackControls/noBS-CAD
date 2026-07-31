import { useSyncExternalStore } from 'react';
import {
  dismissNavigationDiagnosticsNotice,
  getNavigationDiagnosticsUiState,
  stopNavigationDiagnostics,
  subscribeNavigationDiagnostics,
} from '../input/navigationDiagnostics';

export function NavigationDiagnosticsBadge() {
  const state = useSyncExternalStore(
    subscribeNavigationDiagnostics,
    getNavigationDiagnosticsUiState,
    getNavigationDiagnosticsUiState,
  );

  if (!state.active && !state.error && !state.directory) return null;

  return (
    <div
      data-native-viewport-overlay
      role="status"
      className="fixed left-1/2 top-2 z-[100] flex max-w-[min(720px,calc(100vw-24px))] -translate-x-1/2 items-center gap-2 rounded border border-edge bg-header px-3 py-2 text-xs text-ink shadow-lg"
    >
      {state.active ? (
        <>
          <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
          <span className="font-semibold">NAV INPUT REC</span>
          <span className="text-mute">Move one control at a time · ⌘⇧D stops</span>
          <button
            type="button"
            disabled={state.busy}
            onClick={() => void stopNavigationDiagnostics()}
            className="ml-1 rounded border border-edge px-2 py-1 font-medium hover:bg-edge disabled:opacity-50"
          >
            Stop
          </button>
        </>
      ) : state.error ? (
        <span className="text-red-400">{state.error}</span>
      ) : (
        <>
          <span className="font-semibold text-emerald-500">Navigation recording saved</span>
          <span className="min-w-0 truncate text-mute" title={state.directory ?? undefined}>
            {state.directory}
          </span>
          {state.directory && (
            <button
              type="button"
              onClick={() => void navigator.clipboard.writeText(state.directory ?? '')}
              className="shrink-0 rounded border border-edge px-2 py-1 font-medium hover:bg-edge"
            >
              Copy path
            </button>
          )}
          <button
            type="button"
            aria-label="Dismiss navigation diagnostic notice"
            onClick={dismissNavigationDiagnosticsNotice}
            className="shrink-0 rounded px-1.5 py-1 text-mute hover:bg-edge hover:text-ink"
          >
            ×
          </button>
        </>
      )}
    </div>
  );
}
