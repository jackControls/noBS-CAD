import { useTranslation } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { getEngine, isTauriRuntime } from '../engine';
import { DEFAULT_PRINT_BED, PRINTER_PROFILES, type NamedViewConfigurationDto, type PrintLayoutReport } from '../engine/types';
import { useAppStore, exportProjectModelWithVisibility } from '../store/appStore';
import { projectTransitions } from '../files/projectTransitions';
import { getSessionCameraSnapshot } from './viewport/cameraApi';
import { applyLayoutProposal, rotationDegrees, rotationFromDegrees } from '../viewLayout';

let requested: { name: string | null } | null = null;
const eventName = 'nbcad:edit-named-view';
export function editNamedView(name: string | null = null) {
  if (requested) return;
  requested = { name };
  window.dispatchEvent(new Event(eventName));
}
function close() { requested = null; window.dispatchEvent(new Event(eventName)); }

export function NamedViewDialog() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<NamedViewConfigurationDto | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<PrintLayoutReport | null>(null);
  const context = useRef<{ views: NamedViewConfigurationDto[]; originalName: string | null; model: string; tab: string | null } | null>(null);
  const dialog = useRef<HTMLElement>(null);
  const assembly = useAppStore(s => s.assemblyDocument.component_structure);
  const bodies = useAppStore(s => s.solidScene.bodies);
  useEffect(() => {
    let epoch = 0;
    const sync = () => {
      const ticket = ++epoch;
      const request = requested;
      setOpen(!!request); setView(null); setError(''); setReport(null);
      if (!request) return;
      const owner = useAppStore.getState();
      void (async () => {
        const engine = await getEngine();
        const model = await exportProjectModelWithVisibility(engine);
        const listed = await engine.namedViews();
        if (ticket !== epoch || useAppStore.getState().activeProjectTabId !== owner.activeProjectTabId) return;
        const existing = listed.views.find(v => v.name === request.name);
        if (request.name && !existing) throw new Error('This named view no longer exists.');
        const camera = getSessionCameraSnapshot() ?? { position: [200, -200, 150] as [number, number, number], target: [0, 0, 0] as [number, number, number], up: [0, 0, 1] as [number, number, number] };
        context.current = { views: listed.views, originalName: request.name, model, tab: owner.activeProjectTabId };
        setView(existing ? structuredClone(existing) : {
          name: '', camera, visible_body_ids: owner.solidScene.bodies.filter(b => !owner.projectVisibility.hidden_body_ids.includes(b.id)).map(b => b.id),
          part_offsets: [], occurrence_offsets: [], print_layout: false, print_bed: structuredClone(DEFAULT_PRINT_BED),
        });
        setSelected(owner.selectedOccurrenceId ?? owner.assemblyDocument.component_structure.occurrences[0]?.id ?? null);
      })().catch(e => { if (ticket === epoch) setError(String(e instanceof Error ? e.message : e)); });
    };
    window.addEventListener(eventName, sync);
    return () => { ++epoch; window.removeEventListener(eventName, sync); };
  }, []);
  useEffect(() => {
    if (!open) return;
    const oldFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) { e.preventDefault(); e.stopPropagation(); close(); }
      if (e.key === 'Tab') {
        const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled)') ?? [])];
        if (!controls.length) return;
        const index = controls.indexOf(document.activeElement as HTMLElement);
        e.preventDefault(); controls[(index + (e.shiftKey ? -1 : 1) + controls.length) % controls.length].focus();
      }
    };
    window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('keydown', key, true); oldFocus?.focus(); };
  }, [open, busy]);
  if (!open) return null;
  const update = (next: NamedViewConfigurationDto) => { setView(next); setReport(null); };
  const bed = view?.print_bed ?? DEFAULT_PRINT_BED;
  const profile = PRINTER_PROFILES.find(p => p.main.source?.repository === bed.source?.repository);
  const customBed = () => ({ ...bed, source: undefined, printable_regions: [], excluded_regions: [] });
  const offset = view?.occurrence_offsets?.find(o => o.occurrence_id === selected) ?? { occurrence_id: selected ?? 0, translation: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0, 1] as [number, number, number, number] };
  const angles = rotationDegrees(offset.rotation);
  const editOffset = (kind: 'translation' | 'rotation', axis: number, value: number) => {
    if (!view || selected === null || !Number.isFinite(value)) return;
    const values = [...(kind === 'translation' ? offset.translation : angles)]; values[axis] = value;
    const next = { ...offset, [kind]: kind === 'translation' ? values : rotationFromDegrees(values) };
    update({ ...view, occurrence_offsets: [...(view.occurrence_offsets ?? []).filter(o => o.occurrence_id !== selected), next] });
  };
  const assertOwner = () => {
    if (!context.current || useAppStore.getState().activeProjectTabId !== context.current.tab) throw new Error('The document changed while editing this view. Reopen the editor.');
  };
  const check = async () => {
    if (!view) return;
    setBusy(true); setError('');
    try {
      assertOwner();
      const result = await (await getEngine()).meshExportReport({ body_ids: [], scope: 'assembly', linear_deflection: .15, angular_deflection: .35, include_appearance: true,
        expected_model_json: context.current!.model, draft_view: { ...view, name: view.name.trim() || 'Unsaved layout' }, print_bed: bed });
      assertOwner(); setReport(result);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const save = async () => {
    if (!view || !view.name.trim()) { setError('Give this view a name.'); return; }
    const snapshot = projectTransitions.beginSnapshot(); setBusy(true); setError('');
    try {
      assertOwner(); snapshot.assertCurrent();
      const saved = { ...view, name: view.name.trim() };
      if (context.current!.views.some(v => v.name === saved.name && v.name !== context.current!.originalName)) throw new Error('A view with this name already exists.');
      const engine = await getEngine();
      await engine.setNamedViews([...context.current!.views.filter(v => v.name !== context.current!.originalName), saved], context.current!.model);
      assertOwner(); snapshot.assertCurrent();
      useAppStore.getState().setDocument(await engine.getDocument());
      await useAppStore.getState().recallNamedView(saved.name);
      useAppStore.setState({ dirty: true }); close();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { snapshot.release(); setBusy(false); }
  };
  const path = (id: number): string => {
    const row = assembly.occurrences.find(o => o.id === id);
    return row ? (row.parent_occurrence_id === null ? row.name : `${path(row.parent_occurrence_id)} / ${row.name}`) : String(id);
  };
  return <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/45 p-5" data-native-viewport-dim="0.45">
    <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="named-view-title" className="feature-dialog max-h-[90vh] w-[650px] overflow-auto bg-panel text-ink">
      <header className="flex items-center justify-between border-b border-edge bg-header px-4 py-3"><h2 id="named-view-title" className="text-sm font-semibold">{t('namedLayout.title')}</h2><button disabled={busy} onClick={close} aria-label={t('namedLayout.close')}>×</button></header>
      <div className="space-y-4 p-4 text-sm">
        {view && <fieldset disabled={busy} className="space-y-4">
          <label className="block">{t('namedLayout.name')}<input autoFocus aria-label={t('namedLayout.viewName')} value={view.name} onChange={e => update({ ...view, name: e.target.value })} className="drawing-input mt-1 w-full" /></label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={!!view.print_layout} onChange={e => update({ ...view, print_layout: e.target.checked })} />{t('namedLayout.printLayout')}</label>
          <p className="text-xs text-mute">{t('namedLayout.help')}</p>
          <div className="flex gap-2"><button onClick={() => { const camera = getSessionCameraSnapshot(); if (camera) update({ ...view, camera }); }}>{t('namedLayout.camera')}</button><button onClick={() => update({ ...view, visible_body_ids: useAppStore.getState().solidScene.bodies.filter(b => !useAppStore.getState().projectVisibility.hidden_body_ids.includes(b.id)).map(b => b.id) })}>{t('namedLayout.visibility')}</button></div>
          <details><summary>{t('namedLayout.included')}</summary><div className="mt-2 max-h-32 overflow-auto space-y-1">{bodies.map(body => <label key={body.id} className="flex gap-2"><input type="checkbox" checked={view.visible_body_ids.includes(body.id)} onChange={e => update({ ...view, visible_body_ids: e.target.checked ? [...view.visible_body_ids, body.id] : view.visible_body_ids.filter(id => id !== body.id) })} />{body.name} ({assembly.occurrences.filter(o => assembly.definitions.find(d => d.id === o.component_id)?.body_ids.includes(body.id)).length} occurrences)</label>)}</div></details>
          <label className="block">{t('namedLayout.occurrence')}<select aria-label={t('namedLayout.layoutOccurrence')} className="drawing-input mt-1 w-full" value={selected ?? ''} onChange={e => setSelected(Number(e.target.value))}>{assembly.occurrences.map(o => <option key={o.id} value={o.id}>{path(o.id)}</option>)}</select></label>
          {selected !== null && <><p className="text-xs text-mute">{t('namedLayout.children')}</p>{(['translation', 'rotation'] as const).map(kind => <div key={kind}><span>{kind === 'translation' ? t('namedLayout.offset') : t('namedLayout.rotation')}</span><div className="grid grid-cols-3 gap-2 mt-1">{['X', 'Y', 'Z'].map((axis, i) => <label key={axis} className="flex items-center gap-2">{axis}<input type="number" aria-label={`${kind} ${axis}`} className="drawing-input w-full" step="any" value={Number((kind === 'translation' ? offset.translation[i] : angles[i]).toFixed(5))} onChange={e => editOffset(kind, i, e.target.valueAsNumber)} /></label>)}</div></div>)}</>}
          {view.print_layout && <div className="space-y-2 border-t border-edge pt-3"><label>Printer profile<select aria-label="Printer profile" className="drawing-input ml-2" value={profile?.id ?? "custom"} onChange={e => { const p = PRINTER_PROFILES.find(p => p.id === e.target.value); update({ ...view, print_bed: p ? { ...structuredClone(p[bed.nozzle_mode]), margin_mm: bed.margin_mm } : customBed() }); }}><option value="custom">Custom envelope</option>{PRINTER_PROFILES.map(p => <option key={p.id} value={p.id}>{p.main.name} ({p.main.source?.repository.split("/")[1]})</option>)}</select></label><label className="block">{t('namedLayout.printer')}<input className="drawing-input ml-2" value={bed.name} onChange={e => update({ ...view, print_bed: { ...bed, name: e.target.value } })} /></label><label>{t('namedLayout.nozzle')}<select className="drawing-input ml-2" value={bed.nozzle_mode} onChange={e => { const mode = e.target.value as 'main' | 'dual'; update({ ...view, print_bed: profile ? { ...structuredClone(profile[mode]), margin_mm: bed.margin_mm } : { ...bed, nozzle_mode: mode } }); }}><option value="main">{t('namedLayout.main')}</option><option value="dual">{t('namedLayout.dual')}</option></select></label><div className="grid grid-cols-4 gap-2">{['width', 'depth', 'height', 'margin'].map(key => t('namedLayout.' + key)).map((label, i) => <label key={label}>{label} (mm)<input className="drawing-input w-full" type="number" step="any" value={i === 3 ? bed.margin_mm : bed.size_mm[i]} onChange={e => { const v = e.target.valueAsNumber; if (!Number.isFinite(v)) return; const size = [...bed.size_mm] as [number, number, number]; if (i < 3) size[i] = v; update({ ...view, print_bed: { ...(i < 3 ? customBed() : bed), size_mm: size, margin_mm: i === 3 ? v : bed.margin_mm } }); }} /></label>)}</div><div className="grid grid-cols-2 gap-2">{["X", "Y"].map((axis, i) => <label key={axis}>Bed origin {axis} (mm)<input aria-label={`Bed origin ${axis} (mm)`} type="number" step="any" className="drawing-input w-full" value={bed.origin_mm?.[i] ?? 0} onChange={e => { const v = e.target.valueAsNumber; if (!Number.isFinite(v)) return; const origin = [...(bed.origin_mm ?? [0, 0])] as [number, number]; origin[i] = v; update({ ...view, print_bed: { ...customBed(), origin_mm: origin } }); }} /></label>)}</div>{bed.source && <p className="text-xs text-mute">Profile: {bed.source.repository} at {bed.source.revision.slice(0, 12)}. Saved dimensions and regions stay fixed until you select a profile again.</p>}</div>}
          {isTauriRuntime() && <button className="h-8 rounded border border-edge px-3" onClick={() => void check()}>{t('namedLayout.check')}</button>}
        </fieldset>}
        {report && <div className="space-y-2 border-t border-edge pt-3"><p>{report.printable_instances} body occurrences in {report.printable_groups} CAD groups; {report.excluded_instances} excluded.</p><p className="text-xs text-mute">{report.overlap_check}</p>{report.issues.length ? <ul className="list-disc pl-5 text-xs space-y-1">{report.issues.map((issue, i) => <li key={i}>{issue.message}</li>)}</ul> : <p>{t('namedLayout.noIssues')}</p>}{report.proposed_translations.length > 0 && <><p className="text-xs">Proposed: arrange {report.proposed_translations.length} whole groups on the bed with {report.clearance_mm} mm between group bounds.</p><ul className="text-xs space-y-1">{report.proposed_translations.map(move => <li key={move.occurrence_id}>{assembly.occurrences.find(o => o.id === move.occurrence_id)?.name ?? `Occurrence ${move.occurrence_id}`}: move {move.translation.map(v => v.toFixed(2)).join(", ")} mm (X, Y, Z)</li>)}</ul><button disabled={busy} onClick={() => { if (view) update(applyLayoutProposal(view, report)); }} className="h-8 rounded border border-edge px-3">{t('namedLayout.apply')}</button></>}</div>}
        {error && <p role="alert" className="text-xs text-red-500">{error}</p>}
      </div>
      <footer className="flex justify-end gap-2 border-t border-edge px-4 py-3"><button disabled={busy} onClick={close}>{t('file.cancel')}</button><button disabled={busy || !view} onClick={() => void save()} className="h-8 rounded bg-accent px-3 text-xs text-white">{t('namedLayout.save')}</button></footer>
    </section>
  </div>;
}
