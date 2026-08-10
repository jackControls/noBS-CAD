import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { FileText, LayoutTemplate, X } from 'lucide-react';
import type {
  DrawingProjectionMethod,
  DrawingSheetFormat,
  DrawingSheetOrientation,
  DrawingStandard,
  DrawingTolerancePreset,
} from '../../engine/types';
import {
  createDrawingSheet,
  defaultDrawingSheetSetup,
  leaveDrawingWorkspace,
} from '../../drawing/document';
import {
  drawingFormatLabel,
  drawingFormatsForStandard,
  drawingSheetSize,
} from '../../drawing/sheet';
import { useAppStore } from '../../store/appStore';
import { showDrawingError } from './DrawingBrowser';

const ISO_TOLERANCES: Array<[DrawingTolerancePreset, string]> = [
  ['none', 'No general tolerance note'],
  ['iso2768_fine', 'ISO 2768-f · Fine'],
  ['iso2768_medium', 'ISO 2768-m · Medium'],
  ['iso2768_coarse', 'ISO 2768-c · Coarse'],
  ['iso2768_very_coarse', 'ISO 2768-v · Very coarse'],
  ['custom', 'Custom note'],
];

const ANSI_TOLERANCES: Array<[DrawingTolerancePreset, string]> = [
  ['none', 'No general tolerance note'],
  ['ansi_decimal', 'ANSI decimal-place tolerances'],
  ['custom', 'Custom note'],
];

export function DrawingSheetSetup() {
  const documentName = useAppStore((state) => state.document?.name ?? 'Untitled');
  const sheets = useAppStore((state) => state.drawingDocument.sheets);
  const setOpen = useAppStore((state) => state.setDrawingSheetSetupOpen);
  const lastStandard = sheets[sheets.length - 1]?.standard ?? 'iso';
  const [setup, setSetup] = useState(() => defaultDrawingSheetSetup(lastStandard, documentName));
  const [busy, setBusy] = useState(false);
  const formats = drawingFormatsForStandard(setup.standard);
  const [paperWidth, paperHeight] = drawingSheetSize(setup.format, setup.orientation);
  const previewRatio = paperWidth / paperHeight;

  useEffect(() => {
    setSetup((current) => ({ ...current, title: current.title || documentName }));
  }, [documentName]);

  const toleranceOptions = useMemo(
    () => setup.standard === 'ansi' ? ANSI_TOLERANCES : ISO_TOLERANCES,
    [setup.standard],
  );

  const changeStandard = (standard: DrawingStandard) => {
    const defaults = defaultDrawingSheetSetup(standard, setup.title || documentName);
    setSetup((current) => ({
      ...current,
      standard,
      format: defaults.format,
      projection_method: defaults.projection_method,
      tolerance_note: defaults.tolerance_note,
    }));
  };

  const submit = () => {
    setBusy(true);
    void createDrawingSheet(setup)
      .catch(showDrawingError)
      .finally(() => setBusy(false));
  };

  const cancel = () => {
    if (sheets.length > 0) setOpen(false);
    else leaveDrawingWorkspace();
  };

  return (
    <div className="flex h-full min-h-0 bg-viewport" data-testid="drawing-sheet-setup">
      <section className="flex min-w-0 flex-1 items-center justify-center overflow-auto p-8">
        <div className="w-full max-w-[1020px] overflow-hidden rounded-xl border border-edge bg-panel shadow-2xl shadow-black/25">
          <header className="flex h-14 items-center justify-between border-b border-edge bg-header px-5">
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent/15 text-accent">
                <FileText size={19} />
              </span>
              <div>
                <h1 className="text-[15px] font-semibold text-ink">Create drawing sheet</h1>
                <p className="text-[10px] text-mute">Choose the drafting standard and paper before placing views.</p>
              </div>
            </div>
            <button type="button" onClick={cancel} className="rounded p-1.5 text-mute hover:bg-edge hover:text-ink" title="Cancel">
              <X size={17} />
            </button>
          </header>

          <div className="grid min-h-[520px] grid-cols-[minmax(330px,0.9fr)_minmax(420px,1.1fr)] max-[900px]:grid-cols-1">
            <div className="flex items-center justify-center border-r border-edge bg-viewport/55 p-8 max-[900px]:border-b max-[900px]:border-r-0">
              <div className="w-full max-w-[430px]">
                <div className="mb-4 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-mute">
                  <LayoutTemplate size={14} /> Sheet preview
                </div>
                <div className="flex aspect-[1.35] items-center justify-center rounded-lg border border-edge bg-viewport p-6">
                  <div
                    className="relative bg-white shadow-xl shadow-black/25"
                    style={previewRatio >= 1
                      ? { width: '100%', aspectRatio: previewRatio }
                      : { height: '100%', aspectRatio: previewRatio }}
                  >
                    <div className="absolute inset-[4%] border border-slate-600" />
                    <div className="absolute bottom-[4%] right-[4%] h-[19%] w-[52%] border border-slate-600">
                      <div className="absolute inset-x-0 top-[55%] border-t border-slate-500" />
                      <div className="absolute inset-y-0 left-[63%] border-l border-slate-500" />
                      <span className="absolute left-[4%] top-[9%] text-[7px] font-semibold text-slate-700">{setup.title || 'UNTITLED'}</span>
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between text-[11px] text-mute">
                  <span>{drawingFormatLabel(setup.format)}</span>
                  <span>{Math.round(paperWidth)} × {Math.round(paperHeight)} mm</span>
                </div>
                <div className="mt-5 rounded-lg border border-accent/25 bg-accent/8 p-3 text-[11px] leading-relaxed text-mute">
                  This creates a blank framed sheet. Use <strong className="text-ink">Auto Layout</strong> afterward, or place each projected view manually. Related views stay aligned to their parent view.
                </div>
              </div>
            </div>

            <form className="p-6" onSubmit={(event) => { event.preventDefault(); submit(); }}>
              <SetupGroup label="Drafting standard">
                <div className="grid grid-cols-2 gap-2">
                  <ChoiceButton active={setup.standard === 'iso'} title="ISO" detail="Metric paper · first-angle default" onClick={() => changeStandard('iso')} />
                  <ChoiceButton active={setup.standard === 'ansi'} title="ANSI / ASME" detail="US paper · third-angle default" onClick={() => changeStandard('ansi')} />
                </div>
              </SetupGroup>

              <div className="grid grid-cols-2 gap-3">
                <SetupField label="Paper size">
                  <select className="drawing-input" value={setup.format} onChange={(event) => setSetup({ ...setup, format: event.target.value as DrawingSheetFormat })}>
                    {formats.map((format) => <option key={format} value={format}>{drawingFormatLabel(format)}</option>)}
                  </select>
                </SetupField>
                <SetupField label="Orientation">
                  <select className="drawing-input" value={setup.orientation} onChange={(event) => setSetup({ ...setup, orientation: event.target.value as DrawingSheetOrientation })}>
                    <option value="landscape">Landscape</option>
                    <option value="portrait">Portrait</option>
                  </select>
                </SetupField>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <SetupField label="Projection convention">
                  <select className="drawing-input" value={setup.projection_method} onChange={(event) => setSetup({ ...setup, projection_method: event.target.value as DrawingProjectionMethod })}>
                    <option value="first_angle">First-angle projection</option>
                    <option value="third_angle">Third-angle projection</option>
                  </select>
                </SetupField>
                <SetupField label="General tolerances">
                  <select className="drawing-input" value={setup.tolerance_note.preset} onChange={(event) => setSetup({ ...setup, tolerance_note: { ...setup.tolerance_note, preset: event.target.value as DrawingTolerancePreset } })}>
                    {toleranceOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </SetupField>
              </div>

              {setup.tolerance_note.preset === 'custom' && (
                <SetupField label="Custom tolerance note">
                  <textarea className="drawing-input min-h-16 resize-y py-2" value={setup.tolerance_note.custom} onChange={(event) => setSetup({ ...setup, tolerance_note: { ...setup.tolerance_note, custom: event.target.value } })} />
                </SetupField>
              )}

              <div className="mt-2 border-t border-edge pt-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-mute">Title block</div>
              <SetupField label="Drawing title">
                <input className="drawing-input" value={setup.title} onChange={(event) => setSetup({ ...setup, title: event.target.value })} />
              </SetupField>
              <div className="grid grid-cols-3 gap-3">
                <SetupField label="Drawing number"><input className="drawing-input" value={setup.drawing_number} onChange={(event) => setSetup({ ...setup, drawing_number: event.target.value })} /></SetupField>
                <SetupField label="Revision"><input className="drawing-input" value={setup.revision} onChange={(event) => setSetup({ ...setup, revision: event.target.value })} /></SetupField>
                <SetupField label="Author"><input className="drawing-input" value={setup.author} onChange={(event) => setSetup({ ...setup, author: event.target.value })} /></SetupField>
              </div>

              <div className="mt-5 flex justify-end gap-2 border-t border-edge pt-4">
                <button type="button" onClick={cancel} className="h-9 rounded border border-edge px-4 text-[12px] text-ink hover:bg-edge">Cancel</button>
                <button type="submit" disabled={busy || !setup.title.trim()} className="h-9 rounded bg-accent px-5 text-[12px] font-semibold text-white hover:brightness-110 disabled:opacity-45">
                  {busy ? 'Creating…' : 'Create blank sheet'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </section>
    </div>
  );
}

function SetupGroup({ label, children }: { label: string; children: ReactNode }) {
  return <fieldset className="mb-4"><legend className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-mute">{label}</legend>{children}</fieldset>;
}

function SetupField({ label, children }: { label: string; children: ReactNode }) {
  return <label className="mb-3 block"><span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-mute">{label}</span>{children}</label>;
}

function ChoiceButton({ active, title, detail, onClick }: { active: boolean; title: string; detail: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`rounded-lg border p-3 text-left transition-colors ${active ? 'border-accent bg-accent/12' : 'border-edge hover:bg-edge/40'}`}>
      <span className={`block text-[12px] font-semibold ${active ? 'text-accent' : 'text-ink'}`}>{title}</span>
      <span className="mt-0.5 block text-[9px] text-mute">{detail}</span>
    </button>
  );
}
