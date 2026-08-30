import { useRef, useState, type FormEvent } from 'react';
import { FileCode2, FolderOpen, Play, X } from 'lucide-react';
import type { CamGcodeDialectDto } from '../../engine/types';
import { CAM_DIALOG_INPUT, CAM_DIALOG_LABEL } from './camFields';

export interface CamGcodeSimulationInput {
  kind: 'gcode';
  source: string;
  fileName: string;
  dialect: CamGcodeDialectDto;
}

interface Props {
  initial: CamGcodeSimulationInput | null;
  onClose: () => void;
  onRun: (input: CamGcodeSimulationInput) => void;
}

/** Workpiece-only NC input. The dialog deliberately asks for code and a
 * controller language, not a machine model: fixtures, PLC behavior, and
 * machine kinematics belong to the later machine-simulation layer. */
export function CamGcodeSimulationDialog({ initial, onClose, onRun }: Props) {
  const pickerRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState(initial?.source ?? '');
  const [fileName, setFileName] = useState(initial?.fileName ?? 'program.mpf');
  const [dialect, setDialect] = useState<CamGcodeDialectDto>(initial?.dialect ?? 'auto');
  const [error, setError] = useState<string | null>(null);

  const chooseFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      setSource(await file.text());
      setFileName(file.name);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!source.trim()) {
      setError('Choose or paste an NC program first.');
      return;
    }
    onRun({
      kind: 'gcode',
      source,
      fileName: fileName.trim() || 'program.nc',
      dialect,
    });
  };

  return (
    <div
      data-native-viewport-dim="0.15"
      className="pointer-events-none fixed inset-0 z-[75] bg-black/15"
    >
      <form
        data-testid="cam-gcode-simulation-dialog"
        onSubmit={submit}
        className="feature-dialog pointer-events-auto absolute right-5 top-[132px] flex max-h-[calc(100vh-190px)] w-[440px] flex-col overflow-hidden rounded border border-edge bg-panel shadow-2xl"
      >
        <header className="flex h-10 shrink-0 items-center gap-2 border-b border-edge px-3">
          <FileCode2 size={15} className="text-accent" />
          <span className="flex-1 text-xs font-semibold text-ink">Simulate NC program</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-mute hover:bg-edge hover:text-ink"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </header>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
          <p className="text-[10px] leading-relaxed text-mute">
            This mode follows the final controller code against the setup stock and project tools.
            Machine travel, fixtures, PLC macros, and tool holders are outside this first layer.
          </p>
          {error && (
            <p className="rounded border border-warn/40 bg-warn/10 p-2 text-[10px] text-warn">
              {error}
            </p>
          )}
          <div className="grid grid-cols-[1fr_150px] gap-2">
            <label className="block">
              <span className={CAM_DIALOG_LABEL}>Program</span>
              <div className="flex gap-1.5">
                <input
                  value={fileName}
                  onChange={(event) => setFileName(event.target.value)}
                  className={CAM_DIALOG_INPUT}
                />
                <button
                  type="button"
                  onClick={() => pickerRef.current?.click()}
                  className="flex h-8 shrink-0 items-center gap-1 rounded border border-edge px-2 text-[10px] font-semibold text-mute hover:border-accent/40 hover:text-accent"
                >
                  <FolderOpen size={13} /> Open
                </button>
                <input
                  ref={pickerRef}
                  type="file"
                  accept=".mpf,.spf,.nc,.ngc,.tap,.txt,text/plain"
                  className="hidden"
                  onChange={(event) => void chooseFile(event.target.files?.[0])}
                />
              </div>
            </label>
            <label className="block">
              <span className={CAM_DIALOG_LABEL}>Language</span>
              <select
                value={dialect}
                onChange={(event) => setDialect(event.target.value as CamGcodeDialectDto)}
                className={CAM_DIALOG_INPUT}
              >
                <option value="auto">Auto detect</option>
                <option value="siemens828d">Siemens 828D</option>
                <option value="iso">ISO (P in seconds)</option>
                <option value="fanuc">Fanuc-style (P in milliseconds)</option>
              </select>
            </label>
          </div>
          <label className="block">
            <span className={CAM_DIALOG_LABEL}>Controller code</span>
            <textarea
              value={source}
              onChange={(event) => setSource(event.target.value)}
              spellCheck={false}
              placeholder="Paste G-code here, or open an NC file above."
              className={`${CAM_DIALOG_INPUT} h-[330px] resize-y whitespace-pre font-mono text-[10px] leading-4`}
            />
          </label>
        </div>
        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-edge px-3 py-2.5">
          <button
            type="button"
            onClick={onClose}
            className="h-7 rounded border border-edge px-3 text-[10px] font-semibold text-mute hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="flex h-7 items-center gap-1.5 rounded border border-accent/40 bg-accent/15 px-3 text-[10px] font-semibold text-accent hover:bg-accent/25"
          >
            <Play size={12} fill="currentColor" /> Build simulation
          </button>
        </footer>
      </form>
    </div>
  );
}
