import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { BookOpen, FileCode2, FolderOpen, Play, X } from 'lucide-react';
import {
  closeScripts, editScriptSource, errorMessage, loadScriptPath, openScriptFile, previewExample, runLoadedScript, saveScriptSource,
  showScriptExample, stopScript, useScriptWorkspace, validateScriptSource, ownsScriptPlayback,
  type ScriptExample, type ScriptPreviewFrame,
} from '../scripts/workspace';
import { useTranslation } from '../i18n';
import { useAppStore } from '../store/appStore';
import { ScriptPreview } from './ScriptPreview';
import { presentation } from '../operationPlayback';
import { findNoteRange } from '../scripts/sourceNavigation';
import { useSurfaceDismiss } from './useSurfaceDismiss';

const exampleGroups = [
  {labelKey: 'scripts.panel.groupStartHere', match: (id: string, _kind: string) => id === 'fillet-basics'},
  {labelKey: 'scripts.panel.groupCompleteDesigns', match: (_id: string, kind: string) => kind === 'flagship-candidate'},
  {labelKey: 'scripts.panel.groupFeatureLessons', match: (id: string, kind: string) => kind === 'lesson' && id !== 'fillet-basics'},
  {labelKey: 'scripts.panel.groupAssemblyLessons', match: (_id: string, kind: string) => kind === 'assembly'},
  {labelKey: 'scripts.panel.groupCoupons', match: (_id: string, kind: string) => ['manufacturing-coupon', 'calibration'].includes(kind)},
];

const button = 'rounded border border-edge px-2 py-1.5 text-xs hover:bg-edge disabled:opacity-40';

/** A docked document companion: source and lessons never cover the model. */
export function ScriptPanel() {
  const { t } = useTranslation();
  const state = useScriptWorkspace();
  const editor = useRef<HTMLTextAreaElement>(null);
  const loadedTitle = useRef<HTMLHeadingElement>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  useEffect(() => { if (state.info) setLibraryOpen(false); }, [state.info]);
  const playback = useSyncExternalStore(presentation.subscribe, presentation.snapshot, presentation.snapshot);
  const { surface, dismiss, onKeyDown } = useSurfaceDismiss(state.open, closeScripts, 'button[data-interface-group="document/scripts"]');
  const editing = useAppStore(s => !!s.activeSketch || !!s.historyEdit || s.projectBusy || s.solidBusy);
  const [frames, setFrames] = useState<ScriptPreviewFrame[] | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    setFrames(null); setPreviewError(null);
    if (state.open && state.tab === 'overview' && state.selectedExample?.preview) {
      void previewExample(state.selectedExample).then(result => { if (current) setFrames(result); })
        .catch(error => { if (current) setPreviewError(errorMessage(error)); });
    }
    return () => { current = false; };
  }, [state.open, state.tab, state.selectedExample]);
  if (!state.open) return null;
  const busy = state.loading || state.running;
  const live = state.running && ownsScriptPlayback() && playback.active;
  const mode = live ? playback.mode : state.mode;
  const speed = live ? playback.speed : state.speed;
  const speeds = [...new Set([0.25, 0.5, 1, 2, 4, 8, 16, speed])].sort((a, b) => a - b);
  const shortError = state.error?.split(': {')[0].slice(0, 300);
  const selectExample = (example: ScriptExample, trigger: HTMLButtonElement) => {
    const before = useScriptWorkspace.getState().info;
    void showScriptExample(example).then(() => {
      const accepted = useScriptWorkspace.getState().info;
      if (!accepted || accepted === before) return;
      requestAnimationFrame(() => {
        const current = useScriptWorkspace.getState();
        if (!current.open || current.info !== accepted) return;
        // Loading collapses the library and removes its focused button. Keep
        // keyboard users in the lesson, without overriding a newer focus choice.
        if (document.activeElement === trigger || document.activeElement === document.body) loadedTitle.current?.focus();
      });
    });
  };
  return (
    <aside ref={surface} onKeyDown={onKeyDown} aria-label={t('scripts.panel.title')} data-script-companion data-interface-group="document/scripts"
      className="flex w-[380px] min-w-0 shrink-0 flex-col border-l border-edge bg-panel text-ink">
      <header className="flex shrink-0 items-center justify-between border-b border-edge px-4 py-3">
        <div><h2 className="flex items-center gap-2 text-sm font-semibold"><BookOpen size={16} /> {t('scripts.panel.title')}</h2>
          <p className="mt-1 text-xs text-mute">{t('scripts.panel.subtitle')}</p></div>
        <button className={button} aria-label={t('scripts.panel.close')} onClick={dismiss}><X size={14} /></button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <button className={`${button} flex w-full items-center justify-center gap-2`} disabled={busy}
          onClick={() => void openScriptFile()}><FolderOpen size={14} /> {t('scripts.panel.openScript')}</button>
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-mute">{t('scripts.panel.loadFromPath')}</summary>
          <div className="mt-2 flex gap-2"><input aria-label={t('scripts.panel.path')} value={state.path} disabled={busy}
            onChange={event => useScriptWorkspace.setState({ path: event.target.value })}
            onKeyDown={event => { if (event.key === 'Enter') void loadScriptPath(); }}
            className="min-w-0 flex-1 rounded border border-edge bg-header px-2 py-1" />
            <button className={button} disabled={busy || !state.path.trim()} onClick={() => void loadScriptPath()}>{t('scripts.panel.loadScript')}</button></div>
        </details>
        {state.loading && <p role="status" className="mt-3 text-xs text-mute">{t('scripts.panel.loading')}</p>}
        {state.info && <section className="mt-4 border-t border-edge pt-4">
          <h3 ref={loadedTitle} tabIndex={-1} data-script-title className="text-sm font-semibold">{state.info.name}</h3>
          {state.selectedExample && <p className="mt-2 text-xs leading-relaxed text-mute">{state.selectedExample.summary}</p>}
          <p className="mt-1 text-xs text-mute">{t('scripts.panel.stepChecks').replace('{steps}', String(state.info.step_count)).replace('{checks}', String(state.info.check_count))}</p>
          <div className="my-3 flex gap-2" role="tablist" aria-label={t('scripts.panel.details')}>
            <button role="tab" aria-selected={state.tab === 'overview'} className={button}
              onClick={() => useScriptWorkspace.setState({ tab: 'overview' })}>{t('scripts.panel.overview')}</button>
            <button role="tab" aria-selected={state.tab === 'source'} className={`${button} flex items-center gap-1`}
              onClick={() => useScriptWorkspace.setState({ tab: 'source' })}><FileCode2 size={12} /> {t('scripts.panel.source')}</button>
          </div>
          {state.tab === 'source' ? <>
            <label className="mb-2 block text-xs">{t('scripts.panel.findChapter')}
              <select aria-label={t('scripts.panel.sourceChapter')} className="mt-1 w-full rounded border border-edge bg-header p-2"
                value="" disabled={busy || state.source !== state.info.source}
                onChange={event => {
                  if (event.target.value === '') return;
                  const chapter = state.info?.chapters?.[Number(event.target.value)];
                  if (!chapter || !editor.current) return;
                  const range = findNoteRange(state.source, chapter.text, chapter.step_index);
                  if (!range) return;
                  const [position, end] = range;
                  const field = editor.current;
                  field.focus(); field.setSelectionRange(position, end);
                  const line = state.source.slice(0, position).split('\n').length - 1;
                  field.scrollTop = Math.max(0, line * parseFloat(getComputedStyle(field).lineHeight) - 40);
                }}>
                <option value="">{t('scripts.panel.chooseChapter')}</option>
                {state.info.chapters?.map((chapter, index) => <option key={index} value={index}>
                  {chapter.step_index ? `${chapter.step_index}. ` : ''}{chapter.chapter ?? chapter.text.slice(0, 70)}
                </option>)}
              </select>
            </label>
            {state.source !== state.info.source && <p className="mb-2 text-xs text-mute">{t('scripts.panel.validateHint')}</p>}
            <textarea ref={editor} wrap="off" aria-label={t('scripts.panel.scriptSource')} spellCheck={false} value={state.source} readOnly={busy}
              onChange={event => editScriptSource(event.target.value)}
              className="h-80 w-full resize-y rounded border border-edge bg-header p-2 font-mono text-[11px] leading-relaxed" />
            <button className={`${button} mt-2`} disabled={busy} onClick={() => void validateScriptSource()}>{t('scripts.panel.validate')}</button>
            <button className={`${button} ml-2 mt-2`} disabled={busy} onClick={() => void saveScriptSource()}>{t('scripts.panel.saveAs')}</button>
          </> : <>
            {frames && <ScriptPreview frames={frames} autoPlay={false} />}
            {state.selectedExample?.preview && !frames && !previewError && <p className="text-xs text-mute">{t('scripts.panel.preparingPreview')}</p>}
            {previewError && <p className="text-xs text-mute">{t('scripts.panel.previewUnavailable').replace('{error}', previewError.slice(0, 180))}</p>}
            {state.info.chapters?.[0] && <p className="mt-3 text-xs leading-relaxed">{state.info.chapters[0].text}</p>}
            <ol className="mt-3 space-y-2">{state.info.chapters?.map((chapter, index) => <li key={index}>
              <details className="rounded border border-edge p-2">
                <summary className="cursor-pointer text-xs font-semibold">{chapter.chapter ?? t('scripts.panel.stepLabel').replace('{number}', String(chapter.step_index ?? index + 1))}</summary>
                <p className="mt-2 text-xs leading-relaxed text-mute">{chapter.text}</p>
              </details>
            </li>)}</ol>
          </>}
        </section>}
        <section className="mt-4 border-t border-edge pt-3" aria-label={t('scripts.panel.exampleLibrary')}>
          {state.info && <button className={`${button} w-full`} aria-expanded={libraryOpen}
            onClick={() => setLibraryOpen(value => !value)}>{libraryOpen ? t('scripts.panel.hideLibrary') : t('scripts.panel.browseExamples').replace('{count}', String(state.examples.length))}</button>}
          {(!state.info || libraryOpen) && <div className="space-y-4">{exampleGroups.map(group => {
            const examples = state.examples.filter(example => group.match(example.id, example.kind));
            if (!examples.length) return null;
            return <section key={group.labelKey} aria-label={t(group.labelKey)}>
              <h3 className="mb-2 mt-3 text-xs font-semibold text-mute">{t(group.labelKey)}</h3>
              <div className="space-y-2">{examples.map(example => (
                <button key={example.id} aria-label={example.name}
                  className={`w-full rounded border p-3 text-left ${state.selectedExample?.id === example.id ? 'border-accent bg-accent/10' : 'border-edge hover:bg-header'}`}
                  disabled={busy} onClick={event => selectExample(example, event.currentTarget)}>
                  <span className="block text-xs font-semibold">{example.name}</span>
                  <span className="mt-1 block text-xs leading-relaxed text-mute">{example.summary}</span>
                </button>
              ))}</div>
            </section>;
          })}</div>}
        </section>
        {state.error && <div role="alert" className="mt-4 rounded border border-red-400/30 p-3 text-xs">
          <p>{shortError}</p>{state.error !== shortError && <details className="mt-2"><summary>{t('scripts.panel.errorDetails')}</summary><pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words">{state.error}</pre></details>}
        </div>}
        {state.completed && <p role="status" className="mt-4 text-xs text-emerald-500">{t('scripts.panel.complete')}</p>}
      </div>
      {state.info && <footer className="shrink-0 space-y-3 border-t border-edge p-4">
        <div className="flex items-center gap-2 text-xs">
          <label className="flex flex-1 items-center gap-2">{t('scripts.panel.mode')}<select aria-label={t('scripts.panel.runMode')} className="min-w-0 flex-1 rounded border border-edge bg-header p-1" value={mode} disabled={busy}
            onChange={event => useScriptWorkspace.setState({ mode: event.target.value as 'present' | 'fast' })}>
            <option value="present">{t('scripts.panel.presentation')}</option><option value="fast">{t('scripts.panel.maximumSpeed')}</option></select></label>
          {mode === 'present' && <label className="flex items-center gap-1">{t('scripts.panel.speed')}<select aria-label={t('scripts.panel.speedLabel')} className="rounded border border-edge bg-header p-1" value={speed} disabled={busy}
            onChange={event => useScriptWorkspace.setState({ speed: Number(event.target.value) })}>
            {speeds.map(speed => <option key={speed} value={speed}>{speed}×</option>)}</select></label>}
        </div>
        <button className="flex w-full items-center justify-center gap-2 rounded bg-accent px-3 py-2 text-sm text-white disabled:opacity-40"
          disabled={!state.running && (state.loading || editing)} onClick={() => state.running ? stopScript() : void runLoadedScript()}>
          <Play size={14} /> {state.running ? t('scripts.panel.stopScript') : t('scripts.panel.runInNewDesign')}</button>
        <p className="text-[11px] text-mute">{editing && !state.running ? t('scripts.panel.finishEdit') : t('scripts.panel.designNote')}</p>
      </footer>}
    </aside>
  );
}
