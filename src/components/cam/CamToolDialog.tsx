import { useState, type FormEvent } from 'react';
import { Copy, Plus, Trash2, Wrench, X } from 'lucide-react';
import {
  addCamTool,
  deleteCamTool,
  updateCamTool,
  type CamToolDraft,
} from '../../cam/document';
import {
  chipLoadUnitLabel,
  commitCuttingSpeed,
  commitFeed,
  commitLength,
  cuttingSpeedFromRpm,
  cuttingSpeedUnitLabel,
  displayCuttingSpeed,
  displayFeed,
  displayLength,
  feedUnitLabel,
  lengthUnitLabel,
  rpmFromCuttingSpeed,
} from '../../cam/units';
import type {
  CamCoolantMode,
  CamCuttingParametersDto,
  CamToolDto,
  CamToolKind,
  CamUnits,
} from '../../engine/types';
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
  face_mill: 'Face / shell mill',
  drill: 'Drill',
  chamfer_mill: 'Chamfer mill',
  tap: 'Tap',
  reamer: 'Reamer',
  boring_bar: 'Boring bar',
  thread_mill: 'Thread mill',
};

/** New-tool wizard page 1: kinds grouped the way machinists shop for them. */
const KIND_GROUPS: Array<{ label: string; kinds: CamToolKind[] }> = [
  {
    label: 'Milling',
    kinds: ['flat_end_mill', 'ball_end_mill', 'face_mill', 'chamfer_mill', 'thread_mill'],
  },
  { label: 'Hole making', kinds: ['drill', 'tap', 'reamer', 'boring_bar'] },
];

/** Kinds whose shank feeds axially into a hole; the center-cutting flag does
 *  not apply to them (it only gates plunge-capable milling/drilling). */
const HOLE_TOOL_KINDS: CamToolKind[] = ['tap', 'reamer', 'boring_bar', 'thread_mill'];

/** Tool library: a full-window dialog with the tool table on the left and
 *  the editor for the selected (or new) tool on the right. The library is
 *  the only source of tools for operations; every tool carries its geometry
 *  and its cutting-data defaults, which operations copy at creation. New
 *  tools go through a short wizard: kind, then geometry, then cutting data
 *  with named profiles. */
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
                    <th className="px-2 py-1.5 font-semibold">Profiles</th>
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
                        <td className="px-2 py-1.5 font-mono">{1 + tool.cutting_presets.length}</td>
                      </tr>
                    );
                  })}
                  {cam.tools.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-[11px] italic text-mute/70">
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
          <div className="w-[340px] shrink-0 overflow-y-auto border-l border-edge">
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

/** Editable state of one cutting-data profile; drafts stay strings in the
 *  document's display units until submit. */
interface ProfileDraft {
  name: string;
  rpm: string;
  feedXy: string;
  feedZ: string;
  coolant: CamCoolantMode;
}

function profileDraftFrom(
  name: string,
  cutting: CamCuttingParametersDto,
  units: CamUnits,
): ProfileDraft {
  return {
    name,
    rpm: String(cutting.spindle_rpm),
    feedXy: String(displayFeed(cutting.feed_xy, units)),
    feedZ: String(displayFeed(cutting.feed_z, units)),
    coolant: cutting.coolant,
  };
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
  // New tools are a three-page wizard (type → geometry → cutting data);
  // editing an existing tool shows one scrolling page.
  const wizard = existing === null;
  const [step, setStep] = useState(0);

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
  // Cutting-data profiles: index 0 is the default preset, the rest are named
  // extra profiles the operator can pick when programming an operation.
  const [profiles, setProfiles] = useState<ProfileDraft[]>(() => {
    const defaults: CamCuttingParametersDto = {
      spindle_rpm: 0,
      feed_xy: 0,
      feed_z: 0,
      coolant: 'off',
    };
    const first = source
      ? profileDraftFrom('Default preset', source.cutting, units)
      : { name: 'Default preset', rpm: '', feedXy: '', feedZ: '', coolant: defaults.coolant };
    const extra = (source?.cutting_presets ?? []).map((preset) =>
      profileDraftFrom(preset.name, preset.cutting, units),
    );
    return [first, ...extra];
  });
  const [activeProfile, setActiveProfile] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const patchProfile = (index: number, patch: Partial<ProfileDraft>) =>
    setProfiles((current) =>
      current.map((profile, i) => (i === index ? { ...profile, ...patch } : profile)),
    );

  // Derived linked values, recomputed live like a chip-load calculator.
  const diameterMm = diameter.trim() ? commitLength(Number(diameter), units) : NaN;
  const rpmNum = Number(profiles[activeProfile]?.rpm);
  const flutesNum = Number(fluteCount);
  const feedXyMm = profiles[activeProfile]?.feedXy.trim()
    ? commitFeed(Number(profiles[activeProfile].feedXy), units)
    : NaN;
  const feedZMm = profiles[activeProfile]?.feedZ.trim()
    ? commitFeed(Number(profiles[activeProfile].feedZ), units)
    : NaN;
  const valid = (value: number) => Number.isFinite(value) && value > 0;
  const surfaceSpeed =
    valid(rpmNum) && valid(diameterMm)
      ? displayCuttingSpeed(cuttingSpeedFromRpm(rpmNum, diameterMm), units)
      : null;
  const feedPerTooth =
    valid(feedXyMm) && valid(rpmNum) && valid(flutesNum)
      ? displayLength(feedXyMm / (rpmNum * flutesNum), units)
      : null;
  const plungePerRev =
    valid(feedZMm) && valid(rpmNum) ? displayLength(feedZMm / rpmNum, units) : null;

  const cuttingOf = (profile: ProfileDraft): CamCuttingParametersDto => ({
    spindle_rpm: Math.round(parseDraft(profile.rpm, `${profile.name || 'Default preset'} spindle speed`)),
    feed_xy: commitFeed(parseDraft(profile.feedXy, `${profile.name || 'Default preset'} cutting feed`), units),
    feed_z: commitFeed(parseDraft(profile.feedZ, `${profile.name || 'Default preset'} plunge feed`), units),
    coolant: profile.coolant,
  });

  /** Parse the geometry/identity pages so Next cannot advance on bad input. */
  const checkGeometry = () => {
    if (number.trim()) parseDraft(number, 'Tool number');
    parseDraft(diameter, 'Diameter');
    parseDraft(fluteLength, 'Flute length');
    parseDraft(overallLength, 'Overall length');
    parseDraft(fluteCount, 'Flute count');
    if (kind === 'chamfer_mill') parseDraft(pointAngle, 'Point angle');
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      checkGeometry();
      // The number is optional: empty means the tool is callable by name only
      // (number-based posts fail closed with a clear error for such tools).
      const toolNumber = number.trim()
        ? Math.round(parseDraft(number, 'Tool number'))
        : null;
      if (toolNumber !== null && toolNumber <= 0) {
        throw new Error('Tool number must be positive when assigned.');
      }
      const presetNames = profiles.slice(1).map((profile) => profile.name.trim());
      if (presetNames.some((presetName) => !presetName)) {
        throw new Error('Cutting-data profiles must have names.');
      }
      if (new Set(presetNames).size !== presetNames.length) {
        throw new Error('Cutting-data profile names must be unique.');
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
        cutting: cuttingOf(profiles[0]),
        cutting_presets: profiles.slice(1).map((profile) => ({
          name: profile.name.trim(),
          cutting: cuttingOf(profile),
        })),
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

  const typePicker = (
    <DialogSection title="TOOL TYPE">
      {KIND_GROUPS.map((group) => (
        <div key={group.label} className="mb-3">
          <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-widest text-mute/60">
            {group.label}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {group.kinds.map((candidate) => (
              <button
                key={candidate}
                type="button"
                onClick={() => {
                  setKind(candidate);
                  if (HOLE_TOOL_KINDS.includes(candidate)) setCenterCutting(false);
                  setStep(1);
                }}
                className={`h-8 rounded border text-[10px] font-semibold ${
                  kind === candidate
                    ? 'border-accent/50 bg-accent/15 text-accent'
                    : 'border-edge bg-header/50 text-mute hover:border-accent/40 hover:text-ink'
                }`}
              >
                {KIND_LABELS[candidate]}
              </button>
            ))}
          </div>
        </div>
      ))}
      <p className="text-[9px] leading-relaxed text-mute">
        The kind decides which operations can pick this tool. Its geometry and
        cutting data come next.
      </p>
    </DialogSection>
  );

  const identityAndGeometry = (
    <>
      <DialogSection title="TOOL">
        {wizard && (
          <div className="mb-2 flex items-center gap-2 text-[10px] text-mute">
            <span className="rounded border border-accent/40 bg-accent/10 px-2 py-0.5 font-semibold text-accent">
              {KIND_LABELS[kind]}
            </span>
            <button
              type="button"
              onClick={() => setStep(0)}
              className="text-mute underline decoration-dotted hover:text-ink"
            >
              Change type
            </button>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          {!wizard && (
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
          )}
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
    </>
  );

  const profile = profiles[activeProfile];
  const cuttingData = (
    <DialogSection title={`CUTTING DATA (${fu})`}>
      <div className="flex flex-wrap items-center gap-1">
        {profiles.map((candidate, index) => (
          <button
            key={index}
            type="button"
            onClick={() => setActiveProfile(index)}
            className={`h-6 rounded border px-2 text-[9px] font-semibold ${
              index === activeProfile
                ? 'border-accent/50 bg-accent/15 text-accent'
                : 'border-edge bg-header/50 text-mute hover:text-ink'
            }`}
          >
            {index === 0 ? 'Default preset' : candidate.name || '(unnamed)'}
          </button>
        ))}
        <button
          type="button"
          title="Add a cutting-data profile"
          onClick={() =>
            setProfiles((current) => [
              ...current,
              { ...current[0], name: `Profile ${current.length}` },
            ])
          }
          className="flex h-6 items-center rounded border border-edge px-1.5 text-mute hover:text-ink"
        >
          <Plus size={11} />
        </button>
        {activeProfile > 0 && (
          <button
            type="button"
            title="Delete this profile"
            onClick={() => {
              setProfiles((current) => current.filter((_, index) => index !== activeProfile));
              setActiveProfile(0);
            }}
            className="flex h-6 items-center rounded border border-edge px-1.5 text-mute hover:text-warn"
          >
            <Trash2 size={11} />
          </button>
        )}
      </div>
      {activeProfile > 0 && (
        <label className="block">
          <span className={CAM_DIALOG_LABEL}>Profile name</span>
          <input
            value={profile.name}
            onChange={(event) => patchProfile(activeProfile, { name: event.target.value })}
            placeholder="e.g. Aluminum 6061"
            className={CAM_DIALOG_INPUT}
          />
        </label>
      )}
      <div className="grid grid-cols-2 gap-2">
        <DraftNumber
          label="Spindle"
          value={profile.rpm}
          onChange={(value) => patchProfile(activeProfile, { rpm: value })}
          unit="rpm"
          integer
        />
        <label className="block">
          <span className={CAM_DIALOG_LABEL}>Coolant</span>
          <select
            value={profile.coolant}
            onChange={(event) =>
              patchProfile(activeProfile, { coolant: event.target.value as CamCoolantMode })
            }
            className={CAM_DIALOG_INPUT}
          >
            <option value="off">Off</option>
            <option value="mist">Mist</option>
            <option value="flood">Flood</option>
          </select>
        </label>
        <DraftNumber
          label="Cutting feed"
          value={profile.feedXy}
          onChange={(value) => patchProfile(activeProfile, { feedXy: value })}
          unit={fu}
        />
        <DraftNumber
          label="Plunge feed"
          value={profile.feedZ}
          onChange={(value) => patchProfile(activeProfile, { feedZ: value })}
          unit={fu}
        />
      </div>
      <div className="rounded border border-edge/70 bg-header/40 p-2">
        <div className="mb-1.5 text-[8px] font-semibold uppercase tracking-widest text-mute/60">
          Chip-load calculator · edits update the fields above
        </div>
        <div className="grid grid-cols-2 gap-2">
          <LinkedNumber
            label="Surface speed"
            unit={cuttingSpeedUnitLabel(units)}
            computed={surfaceSpeed}
            onApply={(value) => {
              const rpm = rpmFromCuttingSpeed(commitCuttingSpeed(value, units), diameterMm);
              if (rpm > 0) patchProfile(activeProfile, { rpm: String(rpm) });
            }}
          />
          <LinkedNumber
            label="Feed per tooth"
            unit={`${chipLoadUnitLabel(units)}/tooth`}
            computed={feedPerTooth}
            onApply={(value) => {
              const feedMm = commitLength(value, units) * rpmNum * flutesNum;
              patchProfile(activeProfile, { feedXy: displayFeed(feedMm, units).toFixed(4) });
            }}
          />
          <LinkedNumber
            label="Plunge per rev"
            unit={`${chipLoadUnitLabel(units)}/rev`}
            computed={plungePerRev}
            onApply={(value) => {
              const feedMm = commitLength(value, units) * rpmNum;
              patchProfile(activeProfile, { feedZ: displayFeed(feedMm, units).toFixed(4) });
            }}
          />
        </div>
      </div>
      <p className="text-[9px] leading-relaxed text-mute">
        The picked profile is copied into operations that choose this tool.
        Editing the library later never rewrites existing operations.
      </p>
    </DialogSection>
  );

  return (
    <form onSubmit={submit} className="flex min-h-full flex-col">
      <div className="flex h-9 shrink-0 items-center border-b border-edge px-3 text-[11px] font-semibold text-ink">
        {existing
          ? `Edit ${existing.number != null ? `T${existing.number} ` : ''}${existing.name}`
          : step === 0
            ? 'New library tool · 1/3 type'
            : step === 1
              ? 'New library tool · 2/3 geometry'
              : 'New library tool · 3/3 cutting data'}
      </div>
      <div className="min-h-0 flex-1 space-y-4 p-3">
        {error && (
          <p className="rounded border border-warn/40 bg-warn/10 p-2 text-[10px] text-warn">{error}</p>
        )}
        {wizard && step === 0 && typePicker}
        {(!wizard || step === 1) && identityAndGeometry}
        {(!wizard || step === 2) && cuttingData}
      </div>
      <footer className="flex h-11 shrink-0 items-center justify-end gap-2 border-t border-edge px-3">
        {wizard && step > 0 && (
          <button
            type="button"
            onClick={() => setStep((current) => current - 1)}
            className="h-7 rounded border border-edge px-3 text-[10px] font-semibold text-mute hover:text-ink"
          >
            Back
          </button>
        )}
        {wizard && step === 1 && (
          <button
            type="button"
            onClick={() => {
              try {
                checkGeometry();
                setError(null);
                setStep(2);
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : String(cause));
              }
            }}
            className="h-7 rounded border border-accent/50 bg-accent/15 px-3 text-[10px] font-semibold text-accent hover:bg-accent/25"
          >
            Next: cutting data
          </button>
        )}
        {(!wizard || step === 2) && (
          <button
            type="submit"
            className="h-7 rounded border border-accent/50 bg-accent/15 px-3 text-[10px] font-semibold text-accent hover:bg-accent/25"
          >
            {existing ? 'Save tool' : 'Add to library'}
          </button>
        )}
      </footer>
    </form>
  );
}

/** A cutting-data field linked by formula: it shows the value derived from
 *  the canonical fields and writes back through the inverse formula. */
function LinkedNumber({
  label,
  unit,
  computed,
  onApply,
}: {
  label: string;
  unit: string;
  computed: number | null;
  onApply: (value: number) => void;
}) {
  if (computed === null) {
    return (
      <label className="block opacity-50">
        <span className={CAM_DIALOG_LABEL}>{label} · ƒx</span>
        <span className="relative block">
          <input disabled placeholder="—" className={`${CAM_DIALOG_INPUT} pr-12 font-mono`} />
          <span className="pointer-events-none absolute right-2 top-1.5 text-[8px] text-mute/60">
            {unit}
          </span>
        </span>
      </label>
    );
  }
  const rounded = Number(computed.toFixed(4));
  return (
    <label className="block">
      <span className={CAM_DIALOG_LABEL}>{label} · ƒx</span>
      <span className="relative block">
        <input
          key={computed.toFixed(6)}
          type="number"
          step="any"
          defaultValue={rounded}
          className={`${CAM_DIALOG_INPUT} pr-12 font-mono`}
          onBlur={(event) => {
            const next = Number(event.target.value);
            if (event.target.value.trim() && Number.isFinite(next) && next > 0 && next !== rounded) {
              onApply(next);
            }
          }}
        />
        <span className="pointer-events-none absolute right-2 top-1.5 text-[8px] text-mute/60">
          {unit}
        </span>
      </span>
    </label>
  );
}
