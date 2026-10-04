import { useEffect, useRef, useState } from 'react';
import type { MeshExportScope, NamedViewConfigurationDto, PrintLayoutReport } from '../engine/types';
import { getEngine, isTauriRuntime } from '../engine';
import { useAppStore } from '../store/appStore';
import { editNamedView } from './NamedViewDialog';
import { useTranslation } from '../i18n';

export interface MeshExportOptions { scope: MeshExportScope; named_view?: string }
let pending: ((options: MeshExportOptions | null) => void) | null = null;
let exportSnapshot: string | undefined;
let exportBodyIds: number[] = [];
let previousFocus: HTMLElement | null = null;
const changeEvent = 'nbcad:mesh-export-options';

/** Both File menus use this choice before opening the native save dialog. */
export function requestMeshExportScope(bodyIds: number[] = [], expectedModelJson?: string): Promise<MeshExportOptions | null> {
  if (pending) return Promise.resolve(null);
  exportBodyIds = [...bodyIds];
  exportSnapshot = expectedModelJson;
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  return new Promise((resolve) => {
    pending = resolve;
    window.dispatchEvent(new Event(changeEvent));
  });
}

function finish(scope: MeshExportOptions | null) {
  const resolve = pending;
  pending = null;
  window.dispatchEvent(new Event(changeEvent));
  resolve?.(scope);
}

export function MeshExportDialog() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(() => pending !== null);
  const [scope, setScope] = useState<MeshExportScope>('assembly');
  const [views, setViews] = useState<NamedViewConfigurationDto[]>([]);
  const [viewName, setViewName] = useState('');
  const [report, setReport] = useState<PrintLayoutReport | null>(null);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const checkEpoch = useRef(0);
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const sync = () => {
      setOpen(pending !== null);
      setScope('assembly');
      setViews([]);
      setViewName(useAppStore.getState().activeNamedView ?? '');
      checkEpoch.current++; setChecking(false);
      setReport(null); setError('');
    };
    window.addEventListener(changeEvent, sync);
    return () => window.removeEventListener(changeEvent, sync);
  }, []);
  useEffect(() => {
    if (!open) return;
    let current = true;
    void getEngine().then(engine => engine.namedViews()).then(result => { if (current) setViews(result.views); }).catch(e => { if (current) setError(String(e)); });
    return () => { current = false; };
  }, [open]);
  useEffect(() => { checkEpoch.current++; setChecking(false); setReport(null); setError(''); }, [viewName, scope]);
  useEffect(() => {
    if (!open) return undefined;
    const restoreFocus = previousFocus;
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        finish(null);
      } else if (event.key === 'Tab') {
        const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled)') ?? [])];
        if (!controls.length) return;
        const index = controls.indexOf(document.activeElement as HTMLElement);
        const next = index < 0 ? 0 : (index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
        event.preventDefault();
        event.stopPropagation();
        controls[next].focus();
      }
    };
    window.addEventListener('keydown', keydown, true);
    return () => {
      window.removeEventListener('keydown', keydown, true);
      if (restoreFocus?.isConnected) restoreFocus.focus({ preventScroll: true });
    };
  }, [open]);
  const check = async () => {
    const epoch = ++checkEpoch.current;
    setChecking(true); setError('');
    try {
      const state = useAppStore.getState();
      const engine = await getEngine();
      const expected_model_json = exportSnapshot ?? await engine.exportProjectModel();
      const result = await engine.meshExportReport({ body_ids: exportBodyIds, scope: 'assembly', named_view: viewName || undefined,
        expected_model_json, linear_deflection: .15, angular_deflection: .35, include_appearance: true });
      if (useAppStore.getState().activeProjectTabId !== state.activeProjectTabId) throw new Error('The document changed during layout checks.');
      if (checkEpoch.current === epoch) setReport(result);
    } catch (e) { if (checkEpoch.current === epoch) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (checkEpoch.current === epoch) setChecking(false); }
  };
  useEffect(() => {
    if (open && scope === 'assembly' && isTauriRuntime()
        && views.some(view => view.name === viewName && view.print_layout)) void check();
  }, [open, scope, viewName, views]);
  if (!open) return null;
  return (
    <div data-native-viewport-dim="0.45" className="fixed inset-0 z-[200] flex items-center justify-center bg-black/45 p-5">
      <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="mesh-export-title" data-testid="mesh-export-options" className="feature-dialog w-[550px] max-w-full max-h-[90vh] overflow-auto bg-panel text-ink">
        <header className="flex items-center justify-between border-b border-edge bg-header px-4 py-3">
          <h2 id="mesh-export-title" className="text-sm font-semibold">{t('meshExport.title')}</h2>
          <button type="button" aria-label={t('meshExport.close')} onClick={() => finish(null)}>×</button>
        </header>
        <div className="space-y-3 px-4 py-4 text-sm">
          {scope === 'assembly' && <label className="block">{t('namedLayout.layout')}<select aria-label={t('namedLayout.exportLayout')} className="drawing-input mt-1 w-full" value={viewName} onChange={e => setViewName(e.target.value)}><option value="">{t('namedLayout.current')}</option>{views.map(view => <option key={view.name} value={view.name}>{view.name}{view.print_layout ? t('namedLayout.designation') : ''}</option>)}</select></label>}
          <label className="block">
            <input type="radio" name="mesh-export-scope" value="assembly" checked={scope === 'assembly'} onChange={() => setScope('assembly')} autoFocus /> {t('meshExport.assembly')}
            <span className="mt-1 block text-xs text-mute">{t('meshExport.assemblyHelp')}</span>
          </label>
          <label className="block">
            <input type="radio" name="mesh-export-scope" value="definition" checked={scope === 'definition'} onChange={() => setScope('definition')} /> {t('meshExport.definition')}
            <span className="mt-1 block text-xs text-mute">{t('meshExport.definitionHelp')}</span>
          </label>
          <p className="text-xs text-mute">{t('namedLayout.quantities')}</p>
          {scope === 'assembly' && isTauriRuntime() && <button disabled={checking} className="h-8 rounded border border-edge px-3 text-xs" onClick={() => void check()}>{checking ? t('namedLayout.checking') : t('namedLayout.checkPrint')}</button>}
          {report && <div className="space-y-2 border-t border-edge pt-3"><p>{report.printable_instances} body occurrences in {report.printable_groups} CAD groups.</p><p className="text-xs text-mute">{report.overlap_check}</p>{report.issues.length > 0 ? <ul className="list-disc pl-5 text-xs space-y-1">{report.issues.map((issue, i) => <li key={i}>{issue.message}</li>)}</ul> : <p>{t('namedLayout.noIssues')}</p>}{report.proposed_translations.length > 0 && <button className="h-8 rounded border border-edge px-3 text-xs" onClick={() => { finish(null); editNamedView(viewName || null); }}>{t('namedLayout.editArrangement')}</button>}<p className="text-xs text-mute">{t('namedLayout.warnings')}</p></div>}
          {error && <p role="alert" className="text-xs text-red-500">{error}</p>}
        </div>
        <footer className="flex justify-end gap-2 border-t border-edge bg-header px-4 py-3">
          <button type="button" onClick={() => finish(null)} className="h-8 rounded border border-edge px-3 text-xs">{t('file.cancel')}</button>
          <button type="button" disabled={checking} onClick={() => finish({ scope, named_view: scope === 'assembly' ? viewName || undefined : undefined })} className="h-8 rounded bg-accent px-3 text-xs text-white">{report?.issues.length ? t('namedLayout.exportWarnings') : t('meshExport.continue')}</button>
        </footer>
      </section>
    </div>
  );
}
