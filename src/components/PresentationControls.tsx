import { useSyncExternalStore } from 'react';
import { presentation, type PresentationSnapshot } from '../operationPlayback';
import { useTranslation } from '../i18n';
import { useSurfaceDismiss } from './useSurfaceDismiss';

const buttonClass = 'shrink-0 rounded border border-edge bg-panel px-2 py-1 text-xs hover:bg-edge disabled:opacity-40';
function label(t: (key: string) => string, state: PresentationSnapshot): string {
  return state.stopped ? t('presentation.stopped') : state.finished ? t('presentation.complete') : state.paused ? t('presentation.paused')
    : state.mode === 'fast' ? t('presentation.maximumSpeed') : `${state.speed}×`;
}

/** Keep this in ordinary app chrome so hidden, paused runs stay discoverable. */
export function PresentationReopen() {
  const { t } = useTranslation();
  const state = useSyncExternalStore(presentation.subscribe, presentation.snapshot, presentation.snapshot);
  if (!state.active || state.visible) return null;
  return <span data-interface-group="document/presentation" className="inline-flex shrink-0 items-center gap-2">
    <button type="button" aria-label={t('presentation.showPlaybackControls')} className={buttonClass}
      onClick={() => presentation.control({ command: 'show' })}>{t('presentation.showPlayback').replace('{label}', label(t, state))}</button>
  </span>;
}

/** The visible controls and MCP operate the same presentation controller. */
export function PresentationControls() {
  const { t } = useTranslation();
  const state = useSyncExternalStore(presentation.subscribe, presentation.snapshot, presentation.snapshot);
  const { surface, dismiss, onKeyDown } = useSurfaceDismiss(state.active && state.visible,
    () => presentation.control({ command: 'dismiss' }), `button[aria-label="${t('presentation.showPlaybackControls')}"]`);
  if (!state.active || !state.visible) return null;
  const complete = state.finished || state.stopped;
  const presets = [0.25, 0.5, 1, 2, 4, 8, 16];
  const speeds = presets.includes(state.speed) ? presets : [...presets, state.speed].sort((a, b) => a - b);
  return (
    <section ref={surface} onKeyDown={onKeyDown} aria-label={t('presentation.playback')} data-script-companion data-interface-group="document/presentation"
      className="min-w-0 shrink-0 border-t border-edge bg-header px-3 py-2 text-ink">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-72">
          <div className="flex min-w-0 items-baseline gap-2 text-xs">
            <strong className="truncate">{state.chapter || t('presentation.modelWalkthrough')}</strong>
            <span className="shrink-0 text-mute">{label(t, state)}</span>
            {state.step_count > 0 && <span className="shrink-0 text-mute">{state.step_index} / {state.step_count}</span>}
            <span className="min-w-0 truncate text-mute">{state.operation || t('presentation.ready')}</span>
          </div>
          {state.text && <p className="mt-1 max-h-16 overflow-y-auto whitespace-pre-line text-sm leading-snug" role="status" aria-live="polite">{state.text}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button type="button" className={buttonClass} disabled={complete} onClick={() => presentation.control({ command: state.paused ? 'resume' : 'pause' })}>{state.paused ? t('presentation.resume') : t('presentation.pause')}</button>
          <button type="button" className={buttonClass} disabled={complete} title={t('presentation.stepTitle')} onClick={() => presentation.control({ command: 'step' })}>{t('presentation.step')}</button>
          <label className="flex items-center gap-1 text-xs">{t('presentation.speed')}
            <select aria-label={t('presentation.speedLabel')} disabled={complete} className="rounded border border-edge bg-panel px-1 py-1" value={state.mode === 'fast' ? 'fast' : String(state.speed)}
              onChange={event => presentation.control({ command: 'configure', mode: event.target.value === 'fast' ? 'fast' : 'present', ...(event.target.value === 'fast' ? {} : { speed: Number(event.target.value) }) })}>
              {speeds.map(speed => <option key={speed} value={speed}>{speed}×</option>)}
              <option value="fast">{t('presentation.maximum')}</option>
            </select>
          </label>
          <button type="button" className={buttonClass} disabled={complete} onClick={() => presentation.control({ command: 'stop' })}>{t('presentation.stop')}</button>
          <button type="button" className={buttonClass} aria-label={t('presentation.closeControls')} title={t('presentation.closeControlsTitle')}
            onClick={dismiss}>{t('presentation.close')}</button>
        </div>
      </div>
      {state.step_count > 0 && <progress aria-label={t('presentation.progress')} className="mt-1 block h-0.5 w-full accent-emerald-500" value={state.step_index} max={state.step_count} />}
    </section>
  );
}
