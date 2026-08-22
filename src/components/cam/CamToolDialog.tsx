import { useState, type FormEvent } from 'react';
import { Copy, Plus, Trash2, Wrench, X } from 'lucide-react';
import {
  addCamTool,
  deleteCamTool,
  updateCamTool,
  type CamToolDraft,
} from '../../cam/document';
import {
  commitFeed,
  commitLength,
  displayFeed,
  displayLength,
  feedUnitLabel,
  lengthUnitLabel,
} from '../../cam/units';
import type { CamCoolantMode, CamToolDto, CamToolKind } from '../../engine/types';
import { useAppStore } from '../../store/appStore';
import { runCamAction } from './CamBrowser';
import {
  CAM_DIALOG_INPUT,
  CAM_DIALOG_LABEL,
  DialogSection,
  DraftNumber,
  parseDraft,
} from './camFields';

const KIND_LABELS: Record<CamToolKind, string> = {
  flat_end_mill: 'Flat end mill',
  ball_end_mill: 'Ball end mill',
  drill: 'Drill',
  chamfer_mill: 'Chamfer mill',
  tap: 'Tap',
  reamer: 'Reamer',
  boring_bar: 'Boring bar',
  thread_mill: 'Thread mill',
};

/** Kinds whose shank feeds axially into a hole; the center-cutting flag does
 *  not apply to them (it only gates plunge-capable milling/drilling). */
const HOLE_TOOL_KINDS: CamToolKind[] = ['tap', 'reamer', 'boring_bar', 'thread_mill'];

/** Tool library: a full-window dialog with the tool table on the left and
 *  the editor for the selected (or new) tool on the right. The library is
 *  the only source of tools for operations; every tool carries its geometry
 *  and its cutting-data defaults, which operations copy at creation. */
export function CamToolDialog({ toolId }: { toolId: number | null }) {
  const cam = useAppStore((state) => state.camDocument);
  const close = () => useAppStore.getState().setCamDialog(null);
  const units = cam.units;
  const lu = lengthUnitLabel(units);

  // Selection: the tool being edited, 'new' for a blank draft. Opening from
  // an operation's "edit tool" action lands on that tool directly.
  const [editing, setEditing] = useState<number | 'new' | null>(
    toolId ?? (cam.tools.length > 0 ? null : 'new'),
  );
  // Template for "duplicate": prefill the new-tool editor from an existing
  // tool. The counter forces the editor to remount on every duplicate/new.
  const [template, setTemplate] = useState<CamToolDto | null>(null);
  const [draftSeq, setDraftSeq] = useState(0);
  const startNew = (source: CamToolDto | null) => {
    setTemplate(source);
    setDraftSeq((seq) => seq + 1);
    setEditing('new');
  };
  const selected =
    typeof editing === 'number'
      ? cam.tools.find((tool) => tool.id === editing) ?? null
      : null;

  return (
    <div
      data-native-viewport-dim="0.25"
      className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center bg-black/25 p-6"
    >
      <div
        data-testid="cam-tool-dialog"
        className="feature-dialog pointer-events-auto flex h-[78vh] w-[880px] max-w-full flex-col overflow-hidden rounded border border-edge bg-panel shadow-2xl"
      >
        <header className="flex h-10 shrink-0 items-center gap-2 border-b border-edge px-3">
          <Wrench size={15} className="text-accent" />
          <span className="flex-1 text-xs font-semibold text-ink">
            Tool Library · {cam.tools.length} tools · units {lu}
          </span>
          <button
            type="button"
            onClick={close}
            className="rounded p-1 text-mute hover:bg-edge hover:text-ink"
          >
            <X size={14} />
          </button>
        </header>
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto">
              <table className="w-full border-collapse text-[11px]">
                <thead className="sticky top-0 bg-panel">
                  <tr className="border-b border-edge text-left text-[9px] uppercase tracking-wider text-mute">
                    <th className="px-3 py-1.5 font-semibold">#</th>
                    <th className="px-2 py-1.5 font-semibold">Name</th>
                    <th className="px-2 py-1.5 font-semibold">Type</th>
                    <th className="px-2 py-1.5 font-semibold">Ø</th>
                    <th className="px-2 py-1.5 font-semibold">Flute len</th>
                    <th className="px-2 py-1.5 font-semibold">Overall</th>
                    <th className="px-2 py-1.5 font-semibold">Flutes</th>
                  </tr>
                </thead>
                <tbody>
                  {cam.tools.map((tool) => {
                    const active = editing === tool.id;
                    return (
                      <tr
                        key={tool.id}
                        onClick={() => setEditing(tool.id)}
                        className={`cursor-pointer border-b border-edge/50 ${
                          active ? 'bg-accent/15 text-ink' : 'text-mute hover:bg-edge/30 hover:text-ink'
                        }`}
                      >
                        <td className="px-3 py-1.5 font-mono text-accent">
                          {tool.number != null ? `T${tool.number}` : '—'}
                        </td>
                        <td className="max-w-0 truncate px-2 py-1.5">{tool.name}</td>
                        <td className="px-2 py-1.5">{KIND_LABELS[tool.kind]}</td>
                        <td className="px-2 py-1.5 font-mono">
                          {displayLength(tool.diameter, units).toFixed(2)}
                        </td>
                        <td className="px-2 py-1.5 font-mono">
                          {displayLength(tool.flute_length, units).toFixed(1)}
                        </td>
                        <td className="px-2 py-1.5 font-mono">
                          {displayLength(tool.overall_length, units).toFixed(1)}
                        </td>
                        <td className="px-2 py-1.5 font-mono">{tool.flute_count}</td>
                      </tr>
                    );
                  })}
                  {cam.tools.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-[11px] italic text-mute/70">
                        Empty library — add tools before programming operations.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex h-9 shrink-0 items-center gap-2 border-t border-edge px-3">
              <button
                type="button"
                onClick={() => startNew(null)}
                className="flex h-6 items-center gap-1 rounded border border-accent/50 bg-accent/15 px-2 text-[10px] font-semibold text-accent hover:bg-accent/25"
              >
                <Plus size={12} /> New tool
              </button>
              {selected && (
                <>
                  <button
                    type="button"
                    title="Duplicate the selected tool into a new draft"
                    onClick={() => startNew(selected)}
                    className="flex h-6 items-center gap-1 rounded border border-edge px-2 text-[10px] text-mute hover:text-ink"
                  >
                    <Copy size={11} /> Duplicate
                  </button>
                  <button
                    type="button"
                    title="Delete tool (blocked while operations use it)"
                    onClick={() =>
                      runCamAction(async () => {
                        await deleteCamTool(selected.id);
                        setEditing(null);
                      })
                    }
                    className="flex h-6 items-center gap-1 rounded border border-edge px-2 text-[10px] text-mute hover:text-warn"
                  >
                    <Trash2 size={11} /> Delete
                  </button>
                </>
              )}
            </div>
          </div>
          <div className="w-[320px] shrink-0 overflow-y-auto border-l border-edge">
            {editing !== null ? (
              <ToolEditor
                // Remount per target so the draft fields re-initialise.
                key={editing === 'new' ? `new-${draftSeq}` : editing}
                existing={selected}
                template={editing === 'new' ? template : null}
                onSaved={() => setEditing(null)}
              />
            ) : (
              <p className="p-4 text-[10px] italic text-mute/70">
                Select a tool to edit it, or add a new one.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ToolEditor({
  existing,
  template,
  onSaved,
}: {
  existing: CamToolDto | null;
  template: CamToolDto | null;
  onSaved: () => void;
}) {
  const cam = useAppStore((state) => state.camDocument);
  const units = cam.units;
  const lu = lengthUnitLabel(units);
  const fu = feedUnitLabel(units);
  // New-tool drafts can be prefilled from a duplicate template.
  const source = existing ?? template;

  const [kind, setKind] = useState<CamToolKind>(source?.kind ?? 'flat_end_mill');
  const [name, setName] = useState(existing?.name ?? (template ? `${template.name} copy` : ''));
  const suggestedNumber = Math.max(
    0,
    ...cam.tools.map((tool) => tool.number ?? 0),
  ) + 1;
  const [number, setNumber] = useState(
    existing ? (existing.number != null ? String(existing.number) : '') : String(suggestedNumber),
  );
  const [diameter, setDiameter] = useState(source ? String(displayLength(source.diameter, units)) : '');
  const [fluteLength, setFluteLength] = useState(
    source ? String(displayLength(source.flute_length, units)) : '',
  );
  const [overallLength, setOverallLength] = useState(
    source ? String(displayLength(source.overall_length, units)) : '',
  );
  const [fluteCount, setFluteCount] = useState(source ? String(source.flute_count) : '4');
  const [centerCutting, setCenterCutting] = useState(source?.center_cutting ?? true);
  const [pointAngle, setPointAngle] = useState(
    source?.point_angle_degrees != null ? String(source.point_angle_degrees) : '90',
  );
  const [rpm, setRpm] = useState(source ? String(source.cutting.spindle_rpm) : '');
  const [feedXy, setFeedXy] = useState(
    source ? String(displayFeed(source.cutting.feed_xy, units)) : '',
  );
  const [feedZ, setFeedZ] = useState(
    source ? String(displayFeed(source.cutting.feed_z, units)) : '',
  );
  const [coolant, setCoolant] = useState<CamCoolantMode>(source?.cutting.coolant ?? 'off');
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      // The number is optional: empty means the tool is callable by name only
      // (number-based posts fail closed with a clear error for such tools).
      const toolNumber = number.trim()
        ? Math.round(parseDraft(number, 'Tool number'))
        : null;
      if (toolNumber !== null && toolNumber <= 0) {
        throw new Error('Tool number must be positive when assigned.');
      }
      const draft: CamToolDraft = {
        number: toolNumber,
        name: name.trim() || `${KIND_LABELS[kind]}${toolNumber !== null ? ` T${toolNumber}` : ''}`,
        kind,
        diameter: commitLength(parseDraft(diameter, 'Diameter'), units),
        flute_length: commitLength(parseDraft(fluteLength, 'Flute length'), units),
        overall_length: commitLength(parseDraft(overallLength, 'Overall length'), units),
        center_cutting: HOLE_TOOL_KINDS.includes(kind) ? false : centerCutting,
        flute_count: Math.round(parseDraft(fluteCount, 'Flute count')),
        point_angle_degrees:
          kind === 'chamfer_mill' ? parseDraft(pointAngle, 'Point angle') : null,
        cutting: {
          spindle_rpm: Math.round(parseDraft(rpm, 'Spindle speed')),
          feed_xy: commitFeed(parseDraft(feedXy, 'Cutting feed'), units),
          feed_z: commitFeed(parseDraft(feedZ, 'Plunge feed'), units),
          coolant,
        },
      };
      runCamAction(async () => {
        if (existing) await updateCamTool(existing.id, (tool) => Object.assign(tool, draft));
        else await addCamTool(draft);
        onSaved();
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <form onSubmit={submit} className="flex min-h-full flex-col">
      <div className="flex h-9 shrink-0 items-center border-b border-edge px-3 text-[11px] font-semibold text-ink">
        {existing
          ? `Edit ${existing.number != null ? `T${existing.number} ` : ''}${existing.name}`
          : 'New library tool'}
      </div>
      <div className="min-h-0 flex-1 space-y-4 p-3">
        {error && (
          <p className="rounded border border-warn/40 bg-warn/10 p-2 text-[10px] text-warn">{error}</p>
        )}
        <DialogSection title="TOOL">
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className={CAM_DIALOG_LABEL}>Kind</span>
              <select
                value={kind}
                onChange={(event) => setKind(event.target.value as CamToolKind)}
                className={CAM_DIALOG_INPUT}
              >
                {(Object.keys(KIND_LABELS) as CamToolKind[]).map((candidate) => (
                  <option key={candidate} value={candidate}>
                    {KIND_LABELS[candidate]}
                  </option>
                ))}
              </select>
            </label>
            <DraftNumber label="Tool number (optional)" value={number} onChange={setNumber} integer />
          </div>
          <label className="block">
            <span className={CAM_DIALOG_LABEL}>Name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={KIND_LABELS[kind]}
              className={CAM_DIALOG_INPUT}
            />
          </label>
          <p className="text-[9px] leading-relaxed text-mute">
            Fanuc/GRBL/LinuxCNC-style posts call tools numerically and refuse a
            tool without a number; the Siemens 828D post prefers calling by
            name (T=&quot;NAME&quot;). Operations always reference the tool by
            its internal id, so renumbering or renaming never breaks them.
          </p>
        </DialogSection>

        <DialogSection title={`GEOMETRY (${lu})`}>
          <div className="grid grid-cols-2 gap-2">
            <DraftNumber label="Diameter" value={diameter} onChange={setDiameter} unit={lu} />
            <DraftNumber label="Flute count" value={fluteCount} onChange={setFluteCount} integer />
            <DraftNumber label="Flute length" value={fluteLength} onChange={setFluteLength} unit={lu} />
            <DraftNumber label="Overall length" value={overallLength} onChange={setOverallLength} unit={lu} />
            {kind === 'chamfer_mill' && (
              <DraftNumber label="Point angle" value={pointAngle} onChange={setPointAngle} unit="deg" />
            )}
          </div>
          {!HOLE_TOOL_KINDS.includes(kind) && kind !== 'drill' && (
            <label className="mt-1 flex items-center gap-2 text-[11px] text-ink">
              <input
                type="checkbox"
                checked={centerCutting}
                onChange={(event) => setCenterCutting(event.target.checked)}
              />
              Center-cutting (plunge capable)
            </label>
          )}
        </DialogSection>

        <DialogSection title={`CUTTING DATA · LIBRARY DEFAULTS (${fu})`}>
          <div className="grid grid-cols-2 gap-2">
            <DraftNumber label="Spindle" value={rpm} onChange={setRpm} unit="rpm" integer />
            <label className="block">
              <span className={CAM_DIALOG_LABEL}>Coolant</span>
              <select
                value={coolant}
                onChange={(event) => setCoolant(event.target.value as CamCoolantMode)}
                className={CAM_DIALOG_INPUT}
              >
                <option value="off">Off</option>
                <option value="mist">Mist</option>
                <option value="flood">Flood</option>
              </select>
            </label>
            <DraftNumber label="Cutting feed" value={feedXy} onChange={setFeedXy} unit={fu} />
            <DraftNumber label="Plunge feed" value={feedZ} onChange={setFeedZ} unit={fu} />
          </div>
          <p className="text-[9px] leading-relaxed text-mute">
            These defaults are copied into operations that pick this tool.
            Editing the library later never rewrites existing operations.
          </p>
        </DialogSection>
      </div>
      <footer className="flex h-11 shrink-0 items-center justify-end gap-2 border-t border-edge px-3">
        <button
          type="submit"
          className="h-7 rounded border border-accent/50 bg-accent/15 px-3 text-[10px] font-semibold text-accent hover:bg-accent/25"
        >
          {existing ? 'Save tool' : 'Add to library'}
        </button>
      </footer>
    </form>
  );
}
