import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Copy, Plus, Trash2, Wrench, X } from 'lucide-react';
import {
  addCamTool,
  deleteCamTool,
  importCamToolFromCentral,
  publishCamToolToCentral,
  updateCamTool,
  type CamToolDraft,
} from '../../cam/document';
import {
  addCentralLibraryTool,
  centralLibraryAvailable,
  deleteCentralLibraryTool,
  loadCentralLibrary,
  updateCentralLibraryTool,
  type CentralCamLibrary,
} from '../../cam/library';
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
  bull_nose_end_mill: 'Bull nose end mill',
  face_mill: 'Face / shell mill',
  drill: 'Drill',
  chamfer_mill: 'Chamfer mill',
  tap: 'Tap',
  reamer: 'Reamer',
  boring_bar: 'Boring bar',
  thread_mill: 'Thread mill',
  turning_general: 'General turning',
};

/** New-tool picker page: kinds grouped the way machinists shop for them.
 *  Turning lands with its own workspace; the tile stays visible as a
 *  promise, disabled. */
const KIND_GROUPS: Array<{ label: string; kinds: CamToolKind[]; planned?: boolean }> = [
  {
    label: 'Milling',
    kinds: ['flat_end_mill', 'ball_end_mill', 'bull_nose_end_mill', 'face_mill', 'chamfer_mill', 'thread_mill'],
  },
  { label: 'Hole making', kinds: ['drill', 'tap', 'reamer', 'boring_bar'] },
  { label: 'Turning (planned)', kinds: ['turning_general'], planned: true },
];

/** Kinds whose shank feeds axially into a hole; the center-cutting flag does
 *  not apply to them (it only gates plunge-capable milling/drilling). */
const HOLE_TOOL_KINDS: CamToolKind[] = ['tap', 'reamer', 'boring_bar', 'thread_mill'];

/** Kinds that carry a corner (nose) radius. */
const CORNER_RADIUS_KINDS: CamToolKind[] = ['flat_end_mill', 'bull_nose_end_mill', 'face_mill'];

/** Tool library: a full-window dialog with the tool table on the left and a
 *  tabbed editor (General / Cutter / Cutting data) on the right.
 *
 *  Two scopes share the dialog. The CENTRAL scope (default) is the per-user
 *  collection that follows the operator across projects. The PROJECT scope
 *  holds the snapshots this project actually uses — operations reference
 *  these, and editing them never touches the central copy. Syncing is
 *  explicit: import pulls central tools into the project, publish pushes a
 *  project snapshot back into the collection. New tools start on a
 *  type-picker page; editing an existing tool lands directly on the tabs. */
export function CamToolDialog({ toolId }: { toolId: number | null }) {
  const cam = useAppStore((state) => state.camDocument);
  const close = () => useAppStore.getState().setCamDialog(null);
  const units = cam.units;
  const lu = lengthUnitLabel(units);

  const centralOn = centralLibraryAvailable();
  const [scope, setScope] = useState<'central' | 'project'>(
    toolId !== null || !centralOn ? 'project' : 'central',
  );
  const [central, setCentral] = useState<CentralCamLibrary | null>(null);
  const reloadCentral = useCallback(async () => {
    setCentral(await loadCentralLibrary());
  }, []);
  useEffect(() => {
    void reloadCentral();
  }, [reloadCentral]);

  const tools = scope === 'central' ? central?.tools ?? [] : cam.tools;
  const [editing, setEditing] = useState<number | 'new' | null>(toolId);
  const [template, setTemplate] = useState<CamToolDto | null>(null);
  const [draftSeq, setDraftSeq] = useState(0);
  const [importId, setImportId] = useState('');
  const startNew = (source: CamToolDto | null) => {
    setTemplate(source);
    setDraftSeq((seq) => seq + 1);
    setEditing('new');
  };
  const selected =
    typeof editing === 'number'
      ? tools.find((tool) => tool.id === editing) ?? null
      : null;
  // First run with an empty library lands straight on the type picker.
  useEffect(() => {
    if (editing !== null) return;
    if (scope === 'project' && cam.tools.length === 0) setEditing('new');
    if (scope === 'central' && central !== null && central.tools.length === 0) setEditing('new');
  }, [editing, scope, cam.tools.length, central]);

  const saveTool = async (draft: CamToolDraft, existingId: number | null) => {
    if (scope === 'central') {
      if (existingId !== null) {
        await updateCentralLibraryTool(existingId, (tool) => Object.assign(tool, draft));
      } else {
        await addCentralLibraryTool(draft);
      }
    } else if (existingId !== null) {
      await updateCamTool(existingId, (tool) => Object.assign(tool, draft));
    } else {
      // Project-scope creation also registers the tool centrally, so it is
      // importable from every other project on this machine.
      await addCamTool(draft);
    }
    await reloadCentral();
  };

  const removeTool = (tool: CamToolDto) =>
    runCamAction(async () => {
      if (scope === 'central') {
        await deleteCentralLibraryTool(tool.id);
        await reloadCentral();
      } else {
        await deleteCamTool(tool.id);
      }
      setEditing(null);
    });

  // Sync state of the selected project snapshot against its central twin.
  const centralTwin =
    scope === 'project' && selected
      ? central?.tools.find((candidate) => candidate.id === selected.id) ?? null
      : null;
  const twinDiffers =
    selected !== null &&
    centralTwin !== null &&
    JSON.stringify(centralTwin) !== JSON.stringify(selected);

  const importable =
    scope === 'project'
      ? (central?.tools ?? []).filter(
          (candidate) => !cam.tools.some((tool) => tool.id === candidate.id),
        )
      : [];

  const syncActions: ReactNode =
    scope === 'project' && selected && centralOn ? (
      <div className="mr-auto flex items-center gap-1.5">
        {centralTwin === null ? (
          <button
            type="button"
            title="Copy this project tool into the central library"
            onClick={() =>
              runCamAction(async () => {
                await publishCamToolToCentral(selected.id);
                await reloadCentral();
              })
            }
            className="flex h-7 items-center rounded border border-edge px-2 text-[10px] font-semibold text-mute hover:border-accent/40 hover:text-accent"
          >
            Add to central library
          </button>
        ) : twinDiffers ? (
          <>
            <button
              type="button"
              title="Overwrite the central copy with this project's edits"
              onClick={() =>
                runCamAction(async () => {
                  await publishCamToolToCentral(selected.id);
                  await reloadCentral();
                })
              }
              className="flex h-7 items-center rounded border border-edge px-2 text-[10px] font-semibold text-mute hover:border-accent/40 hover:text-accent"
            >
              Update central copy
            </button>
            <button
              type="button"
              title="Discard this project's edits and reload the central copy"
              onClick={() =>
                runCamAction(async () => {
                  await importCamToolFromCentral(selected.id);
                  await reloadCentral();
                  // Remount the editor so the pulled values re-initialise it.
                  setDraftSeq((seq) => seq + 1);
                })
              }
              className="flex h-7 items-center rounded border border-edge px-2 text-[10px] font-semibold text-mute hover:border-warn/40 hover:text-warn"
            >
              Reset to central copy
            </button>
          </>
        ) : (
          <span className="px-1 text-[9px] italic text-mute/60">In sync with the central copy</span>
        )}
      </div>
    ) : null;

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
          <span className="text-xs font-semibold text-ink">Tool Library</span>
          {centralOn && (
            <div className="ml-1 flex items-center gap-0.5 rounded border border-edge bg-header/40 p-0.5">
              {(
                [
                  ['central', 'Central library'],
                  ['project', 'This project'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setScope(value);
                    setEditing(null);
                  }}
                  className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
                    scope === value ? 'bg-accent/15 text-accent' : 'text-mute hover:text-ink'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <span className="flex-1 text-right text-[10px] text-mute">
            {tools.length} tools · units {lu}
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
            {scope === 'project' && centralOn && importable.length > 0 && (
              <div className="flex h-9 shrink-0 items-center gap-2 border-b border-edge px-3">
                <span className="text-[9px] font-semibold uppercase tracking-widest text-mute/60">
                  Import
                </span>
                <select
                  value={importId}
                  onChange={(event) => setImportId(event.target.value)}
                  className="h-6 min-w-0 flex-1 rounded border border-edge bg-header/60 px-1.5 text-[10px] text-ink"
                >
                  <option value="">From the central library…</option>
                  {importable.map((tool) => (
                    <option key={tool.id} value={tool.id}>
                      {tool.number != null ? `T${tool.number} · ` : ''}
                      {tool.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={importId === ''}
                  onClick={() =>
                    runCamAction(async () => {
                      await importCamToolFromCentral(Number(importId));
                      setImportId('');
                    })
                  }
                  className="h-6 rounded border border-accent/50 bg-accent/15 px-2 text-[10px] font-semibold text-accent hover:bg-accent/25 disabled:opacity-40"
                >
                  Add to project
                </button>
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto">
              <table className="w-full border-collapse text-[11px]">
                <thead className="sticky top-0 bg-panel">
                  <tr className="border-b border-edge text-left text-[9px] uppercase tracking-wider text-mute">
                    <th className="px-3 py-1.5 font-semibold">#</th>
                    <th className="px-2 py-1.5 font-semibold">Name</th>
                    <th className="px-2 py-1.5 font-semibold">Type</th>
                    <th className="px-2 py-1.5 font-semibold">Ø</th>
                    <th className="px-2 py-1.5 font-semibold">Corner R</th>
                    <th className="px-2 py-1.5 font-semibold">Flute len</th>
                    <th className="px-2 py-1.5 font-semibold">Overall</th>
                    <th className="px-2 py-1.5 font-semibold">Flutes</th>
                    <th className="px-2 py-1.5 font-semibold">Profiles</th>
                  </tr>
                </thead>
                <tbody>
                  {tools.map((tool) => {
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
                          {tool.corner_radius != null ? displayLength(tool.corner_radius, units).toFixed(2) : '—'}
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
                  {tools.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-4 py-8 text-center text-[11px] italic text-mute/70">
                        {scope === 'central'
                          ? central === null
                            ? 'Loading the central library…'
                            : 'Central library is empty — tools added here are importable from every project.'
                          : centralOn
                            ? 'No tools in this project — import from the central library above, or create a new one.'
                            : 'Empty library — add tools before programming operations.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex h-9 shrink-0 items-center gap-2 border-t border-edge px-3">
              <button
                type="button"
                title={
                  scope === 'project'
                    ? 'Create a tool in this project (also registered in the central library)'
                    : 'Create a tool in the central library'
                }
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
                    title={
                      scope === 'central'
                        ? 'Delete from the central library (project snapshots are unaffected)'
                        : 'Delete from this project (blocked while operations use it)'
                    }
                    onClick={() => removeTool(selected)}
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
                key={editing === 'new' ? `new-${draftSeq}` : `${editing}-${draftSeq}`}
                existing={selected}
                template={editing === 'new' ? template : null}
                scopeTools={tools}
                onSave={saveTool}
                onSaved={() => setEditing(null)}
                syncActions={syncActions}
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

/** Which side of a linked pair the operator last edited; the other side is
 *  derived at commit time and re-resolved from this side at submit. */
type SpeedDriver = 'rpm' | 'vc';
type FeedDriver = 'feed' | 'fz';
type PlungeDriver = 'plunge' | 'fpr';

/** Editable state of one cutting-data profile; drafts stay strings in the
 *  document's display units until submit. */
interface ProfileDraft {
  name: string;
  rpm: string;
  feedXy: string;
  feedZ: string;
  coolant: CamCoolantMode;
  surfaceSpeed: string;
  feedPerTooth: string;
  plungePerRev: string;
  speedDriver: SpeedDriver;
  feedDriver: FeedDriver;
  plungeDriver: PlungeDriver;
}

type EditorTab = 'general' | 'cutter' | 'cutting';

function ToolEditor({
  existing,
  template,
  scopeTools,
  onSave,
  onSaved,
  syncActions,
}: {
  existing: CamToolDto | null;
  template: CamToolDto | null;
  /** Tools of the active scope; seeds the next suggested tool number. */
  scopeTools: CamToolDto[];
  /** Scope-aware save (central collection vs project snapshot). */
  onSave: (draft: CamToolDraft, existingId: number | null) => Promise<void>;
  onSaved: () => void;
  /** Optional project↔central sync buttons rendered in the footer. */
  syncActions?: ReactNode;
}) {
  const cam = useAppStore((state) => state.camDocument);
  const units = cam.units;
  const lu = lengthUnitLabel(units);
  const fu = feedUnitLabel(units);
  const source = existing ?? template;
  // Brand-new tools (no duplicate template) start on the type picker.
  const [picking, setPicking] = useState(existing === null && template === null);
  const [tab, setTab] = useState<EditorTab>('general');

  const [kind, setKind] = useState<CamToolKind>(source?.kind ?? 'flat_end_mill');
  const [name, setName] = useState(existing?.name ?? (template ? `${template.name} copy` : ''));
  const suggestedNumber = Math.max(
    0,
    ...scopeTools.map((tool) => tool.number ?? 0),
  ) + 1;
  const [number, setNumber] = useState(
    existing ? (existing.number != null ? String(existing.number) : '') : String(suggestedNumber),
  );
  const [diameter, setDiameter] = useState(source ? String(displayLength(source.diameter, units)) : '');
  const [cornerRadius, setCornerRadius] = useState(
    source?.corner_radius != null ? String(displayLength(source.corner_radius, units)) : '',
  );
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
  const [error, setError] = useState<string | null>(null);

  // --- Geometry parsing shared by the calculator and submit ---------------
  const parsePositive = (value: string): number | null => {
    const parsed = Number(value);
    return value.trim() && Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };
  const diameterMm = parsePositive(diameter) !== null ? commitLength(Number(diameter), units) : null;
  const cornerRadiusMm = parsePositive(cornerRadius) !== null ? commitLength(Number(cornerRadius), units) : null;
  const flutes = parsePositive(fluteCount);

  // --- Cutting-data profiles ------------------------------------------------
  // Axial depth of cut for the effective-diameter engagement, mm/inch display.
  // Declared before `profiles` because the profile initializer derives the
  // linked chip-load fields through the effective diameter.
  const [chipAp, setChipAp] = useState('');
  const [profiles, setProfiles] = useState<ProfileDraft[]>(() => {
    const fromCutting = (profileName: string, cutting: CamCuttingParametersDto): ProfileDraft => ({
      name: profileName,
      rpm: String(cutting.spindle_rpm),
      feedXy: String(displayFeed(cutting.feed_xy, units)),
      feedZ: String(displayFeed(cutting.feed_z, units)),
      coolant: cutting.coolant,
      surfaceSpeed: '',
      feedPerTooth: '',
      plungePerRev: '',
      speedDriver: 'rpm',
      feedDriver: 'feed',
      plungeDriver: 'plunge',
    });
    const first = source
      ? fromCutting('Default preset', source.cutting)
      : fromCutting('Default preset', { spindle_rpm: 0, feed_xy: 0, feed_z: 0, coolant: 'flood' });
    if (!source) {
      first.rpm = '';
      first.feedXy = '';
      first.feedZ = '';
    }
    return [
      first,
      ...(source?.cutting_presets ?? []).map((preset) => fromCutting(preset.name, preset.cutting)),
    ].map((profile) => ({
      ...profile,
      surfaceSpeed: deriveSurfaceSpeed(profile.rpm) ?? '',
      feedPerTooth: deriveFeedPerTooth(profile.feedXy, profile.rpm) ?? '',
      plungePerRev: derivePlungePerRev(profile.feedZ, profile.rpm) ?? '',
    }));
  });
  const [activeProfile, setActiveProfile] = useState(0);

  const patchProfile = (index: number, patch: Partial<ProfileDraft>) =>
    setProfiles((current) =>
      current.map((profile, i) => (i === index ? { ...profile, ...patch } : profile)),
    );

  /** Effective cutting diameter (mm) at the calculator's depth of cut. For a
   *  corner-radius tool engaged shallower than its radius, contact happens
   *  on the radius, not the full diameter:
   *  De = D - 2R + 2·sqrt(2·R·ap - ap^2)  (ap <= R; beyond that De = D). */
  function effectiveDiameterMm(apOverride?: number | null): number | null {
    if (diameterMm === null) return null;
    const apMm =
      apOverride !== undefined
        ? apOverride
        : parsePositive(chipAp) !== null
          ? commitLength(Number(chipAp), units)
          : null;
    if (cornerRadiusMm === null || apMm === null || apMm >= cornerRadiusMm) return diameterMm;
    if (apMm <= 0) return null;
    const engaged =
      diameterMm - 2 * cornerRadiusMm + 2 * Math.sqrt(2 * cornerRadiusMm * apMm - apMm * apMm);
    return Math.min(diameterMm, engaged);
  }

  function deriveSurfaceSpeed(rpm: string): string | null {
    const rpmValue = parsePositive(rpm);
    const de = effectiveDiameterMm();
    if (rpmValue === null || de === null) return null;
    return displayCuttingSpeed(cuttingSpeedFromRpm(rpmValue, de), units).toFixed(2);
  }

  function deriveRpm(surfaceSpeed: string): string | null {
    const vc = parsePositive(surfaceSpeed);
    const de = effectiveDiameterMm();
    if (vc === null || de === null) return null;
    const rpm = rpmFromCuttingSpeed(commitCuttingSpeed(vc, units), de);
    return rpm > 0 ? String(rpm) : null;
  }

  function deriveFeedPerTooth(feedXy: string, rpm: string): string | null {
    const feed = parsePositive(feedXy);
    const rpmValue = parsePositive(rpm);
    if (feed === null || rpmValue === null || flutes === null) return null;
    const feedMm = commitFeed(feed, units);
    return displayLength(feedMm / (rpmValue * flutes), units).toFixed(4);
  }

  function deriveFeed(feedPerTooth: string, rpm: string): string | null {
    const fz = parsePositive(feedPerTooth);
    const rpmValue = parsePositive(rpm);
    if (fz === null || rpmValue === null || flutes === null) return null;
    const feedMm = commitLength(fz, units) * rpmValue * flutes;
    return displayFeed(feedMm, units).toFixed(2);
  }

  function derivePlungePerRev(feedZ: string, rpm: string): string | null {
    const plunge = parsePositive(feedZ);
    const rpmValue = parsePositive(rpm);
    if (plunge === null || rpmValue === null) return null;
    return displayLength(commitFeed(plunge, units) / rpmValue, units).toFixed(4);
  }

  function derivePlunge(plungePerRev: string, rpm: string): string | null {
    const fpr = parsePositive(plungePerRev);
    const rpmValue = parsePositive(rpm);
    if (fpr === null || rpmValue === null) return null;
    return displayFeed(commitLength(fpr, units) * rpmValue, units).toFixed(2);
  }

  /** rpm changed (either side of the speed pair): refresh every field that
   *  is currently driven by its chip-load side. */
  function cascadeFromRpm(profile: ProfileDraft): Partial<ProfileDraft> {
    const patch: Partial<ProfileDraft> = {};
    if (profile.feedDriver === 'fz') {
      const feed = deriveFeed(profile.feedPerTooth, profile.rpm);
      if (feed !== null) patch.feedXy = feed;
    }
    if (profile.plungeDriver === 'fpr') {
      const plunge = derivePlunge(profile.plungePerRev, profile.rpm);
      if (plunge !== null) patch.feedZ = plunge;
    }
    return patch;
  }

  const commitRpm = (value: string) => {
    const next = { ...profiles[activeProfile], rpm: value, speedDriver: 'rpm' as const };
    const vc = deriveSurfaceSpeed(value);
    if (vc !== null) next.surfaceSpeed = vc;
    patchProfile(activeProfile, { rpm: value, speedDriver: 'rpm', surfaceSpeed: next.surfaceSpeed, ...cascadeFromRpm(next) });
  };
  const commitSurfaceSpeed = (value: string) => {
    const rpm = deriveRpm(value);
    const next = { ...profiles[activeProfile], surfaceSpeed: value, speedDriver: 'vc' as const };
    if (rpm !== null) next.rpm = rpm;
    patchProfile(activeProfile, { surfaceSpeed: value, speedDriver: 'vc', ...(rpm !== null ? { rpm } : {}), ...cascadeFromRpm(next) });
  };
  const commitFeedXy = (value: string) => {
    const fz = deriveFeedPerTooth(value, profiles[activeProfile].rpm);
    patchProfile(activeProfile, { feedXy: value, feedDriver: 'feed', ...(fz !== null ? { feedPerTooth: fz } : {}) });
  };
  const commitFeedPerTooth = (value: string) => {
    const feed = deriveFeed(value, profiles[activeProfile].rpm);
    patchProfile(activeProfile, { feedPerTooth: value, feedDriver: 'fz', ...(feed !== null ? { feedXy: feed } : {}) });
  };
  const commitFeedZ = (value: string) => {
    const fpr = derivePlungePerRev(value, profiles[activeProfile].rpm);
    patchProfile(activeProfile, { feedZ: value, plungeDriver: 'plunge', ...(fpr !== null ? { plungePerRev: fpr } : {}) });
  };
  const commitPlungePerRev = (value: string) => {
    const plunge = derivePlunge(value, profiles[activeProfile].rpm);
    patchProfile(activeProfile, { plungePerRev: value, plungeDriver: 'fpr', ...(plunge !== null ? { feedZ: plunge } : {}) });
  };

  /** Geometry commits that move the effective diameter or the flute count:
   *  re-derive whichever side of each linked pair is not the driver. */
  const refreshAfterGeometry = () => {
    const profile = profiles[activeProfile];
    const patch: Partial<ProfileDraft> = {};
    if (profile.speedDriver === 'rpm') {
      const vc = deriveSurfaceSpeed(profile.rpm);
      if (vc !== null) patch.surfaceSpeed = vc;
    } else {
      const rpm = deriveRpm(profile.surfaceSpeed);
      if (rpm !== null) patch.rpm = rpm;
    }
    if (profile.feedDriver === 'fz') {
      const feed = deriveFeed(profile.feedPerTooth, profile.rpm);
      if (feed !== null) patch.feedXy = feed;
    }
    patchProfile(activeProfile, patch);
  };

  const resolveRpm = (profile: ProfileDraft): number => {
    if (profile.speedDriver === 'vc' && profile.surfaceSpeed.trim()) {
      const de = effectiveDiameterMm();
      if (de === null) throw new Error('Diameter is required to resolve surface speed.');
      return rpmFromCuttingSpeed(
        commitCuttingSpeed(parseDraft(profile.surfaceSpeed, 'Surface speed'), units),
        de,
      );
    }
    return Math.round(parseDraft(profile.rpm, `${profile.name || 'Default preset'} spindle speed`));
  };

  const cuttingOf = (profile: ProfileDraft): CamCuttingParametersDto => {
    const rpm = resolveRpm(profile);
    const feedMm =
      profile.feedDriver === 'fz' && profile.feedPerTooth.trim()
        ? commitLength(parseDraft(profile.feedPerTooth, 'Feed per tooth'), units) * rpm * (flutes ?? 1)
        : commitFeed(parseDraft(profile.feedXy, `${profile.name || 'Default preset'} cutting feed`), units);
    const plungeMm =
      profile.plungeDriver === 'fpr' && profile.plungePerRev.trim()
        ? commitLength(parseDraft(profile.plungePerRev, 'Plunge per rev'), units) * rpm
        : commitFeed(parseDraft(profile.feedZ, `${profile.name || 'Default preset'} plunge feed`), units);
    return { spindle_rpm: rpm, feed_xy: feedMm, feed_z: plungeMm, coolant: profile.coolant };
  };

  /** Parse the identity/geometry tabs so a bad field blocks submit early. */
  const checkGeometry = () => {
    if (number.trim()) parseDraft(number, 'Tool number');
    parseDraft(diameter, 'Diameter');
    if (CORNER_RADIUS_KINDS.includes(kind)) {
      if (kind === 'bull_nose_end_mill' && !cornerRadius.trim()) {
        throw new Error('A bull nose end mill is defined by its corner radius.');
      }
      if (cornerRadius.trim()) parseDraft(cornerRadius, 'Corner radius');
    }
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
        corner_radius:
          CORNER_RADIUS_KINDS.includes(kind) && cornerRadius.trim()
            ? commitLength(parseDraft(cornerRadius, 'Corner radius'), units)
            : null,
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
        await onSave(draft, existing?.id ?? null);
        onSaved();
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  if (picking) {
    return (
      <div className="flex min-h-full flex-col">
        <div className="flex h-9 shrink-0 items-center border-b border-edge px-3 text-[11px] font-semibold text-ink">
          New library tool · pick a type
        </div>
        <div className="min-h-0 flex-1 space-y-3 p-3">
          {KIND_GROUPS.map((group) => (
            <div key={group.label}>
              <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-widest text-mute/60">
                {group.label}
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {group.kinds.map((candidate) => (
                  <button
                    key={candidate}
                    type="button"
                    disabled={group.planned}
                    title={group.planned ? 'Turning support lands with its own workspace' : undefined}
                    onClick={() => {
                      setKind(candidate);
                      if (HOLE_TOOL_KINDS.includes(candidate)) setCenterCutting(false);
                      setPicking(false);
                    }}
                    className={`h-8 rounded border text-[10px] font-semibold ${
                      group.planned
                        ? 'cursor-not-allowed border-edge/50 bg-header/30 text-mute/40'
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
            The kind decides which operations can pick this tool. Everything
            else — geometry, cutting data — is edited on the tabs, in any
            order, now or later.
          </p>
        </div>
      </div>
    );
  }

  const profile = profiles[activeProfile];
  const effectiveDiameter = effectiveDiameterMm();

  return (
    <form onSubmit={submit} className="flex min-h-full flex-col">
      <div className="flex h-9 shrink-0 items-center border-b border-edge px-3 text-[11px] font-semibold text-ink">
        {existing
          ? `Edit ${existing.number != null ? `T${existing.number} ` : ''}${existing.name}`
          : 'New library tool'}
      </div>
      <div className="flex shrink-0 items-center gap-1 border-b border-edge px-2 py-1">
        {(
          [
            ['general', 'General'],
            ['cutter', 'Cutter'],
            ['cutting', 'Cutting data'],
          ] as [EditorTab, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={`h-6 rounded px-2.5 text-[10px] font-semibold ${
              tab === value ? 'bg-accent/15 text-accent' : 'text-mute hover:text-ink'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 space-y-4 p-3">
        {error && (
          <p className="rounded border border-warn/40 bg-warn/10 p-2 text-[10px] text-warn">{error}</p>
        )}

        {tab === 'general' && (
          <>
            <DialogSection title="TOOL">
              {!existing && (
                <div className="mb-2 flex items-center gap-2 text-[10px] text-mute">
                  <span className="rounded border border-accent/40 bg-accent/10 px-2 py-0.5 font-semibold text-accent">
                    {KIND_LABELS[kind]}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPicking(true)}
                    className="text-mute underline decoration-dotted hover:text-ink"
                  >
                    Change type
                  </button>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                {existing && (
                  <label className="block">
                    <span className={CAM_DIALOG_LABEL}>Kind</span>
                    <select
                      value={kind}
                      onChange={(event) => setKind(event.target.value as CamToolKind)}
                      className={CAM_DIALOG_INPUT}
                    >
                      {(Object.keys(KIND_LABELS) as CamToolKind[])
                        .filter((candidate) => candidate !== 'turning_general')
                        .map((candidate) => (
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
          </>
        )}

        {tab === 'cutter' && (
          <DialogSection title={`GEOMETRY (${lu})`}>
            <div className="grid grid-cols-2 gap-2">
              <DraftNumber label="Diameter" value={diameter} onChange={(value) => { setDiameter(value); }} unit={lu} />
              {CORNER_RADIUS_KINDS.includes(kind) && (
                <DraftNumber
                  label={kind === 'bull_nose_end_mill' ? 'Corner radius (required)' : 'Corner radius (0 = sharp)'}
                  value={cornerRadius}
                  onChange={(value) => { setCornerRadius(value); }}
                  unit={lu}
                />
              )}
              <DraftNumber label="Flute count" value={fluteCount} onChange={setFluteCount} integer />
              <DraftNumber label="Flute length" value={fluteLength} onChange={setFluteLength} unit={lu} />
              <DraftNumber label="Overall length" value={overallLength} onChange={setOverallLength} unit={lu} />
              {kind === 'chamfer_mill' && (
                <DraftNumber label="Point angle" value={pointAngle} onChange={setPointAngle} unit="deg" />
              )}
            </div>
            {(cornerRadiusMm !== null || CORNER_RADIUS_KINDS.includes(kind)) && (
              <button
                type="button"
                onClick={refreshAfterGeometry}
                className="mt-1 text-[9px] text-mute underline decoration-dotted hover:text-ink"
              >
                Refresh the cutting-data links after geometry edits
              </button>
            )}
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
        )}

        {tab === 'cutting' && (
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
                onChange={commitRpm}
                unit="rpm"
                integer
              />
              <DraftNumber
                label={`Surface speed · ƒx${profile.speedDriver === 'vc' ? ' (drives)' : ''}`}
                value={profile.surfaceSpeed}
                onChange={commitSurfaceSpeed}
                unit={cuttingSpeedUnitLabel(units)}
              />
              <DraftNumber
                label="Cutting feed"
                value={profile.feedXy}
                onChange={commitFeedXy}
                unit={fu}
              />
              <DraftNumber
                label={`Feed per tooth · ƒx${profile.feedDriver === 'fz' ? ' (drives)' : ''}`}
                value={profile.feedPerTooth}
                onChange={commitFeedPerTooth}
                unit={`${chipLoadUnitLabel(units)}/tooth`}
              />
              <DraftNumber
                label="Plunge feed"
                value={profile.feedZ}
                onChange={commitFeedZ}
                unit={fu}
              />
              <DraftNumber
                label={`Plunge per rev · ƒx${profile.plungeDriver === 'fpr' ? ' (drives)' : ''}`}
                value={profile.plungePerRev}
                onChange={commitPlungePerRev}
                unit={`${chipLoadUnitLabel(units)}/rev`}
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
            </div>
            <div className="rounded border border-edge/70 bg-header/40 p-2 text-[9px] leading-relaxed text-mute">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="font-semibold uppercase tracking-widest text-mute/60">
                  Effective Ø
                </span>
                <span className="font-mono text-ink">
                  {effectiveDiameter !== null ? `${displayLength(effectiveDiameter, units).toFixed(3)} ${lu}` : '—'}
                </span>
              </div>
              {cornerRadiusMm !== null && (
                <div className="mb-1">
                  <DraftNumber
                    label="At depth of cut ap"
                    value={chipAp}
                    onChange={(value) => { setChipAp(value); }}
                    unit={lu}
                    placeholder={String(displayLength(cornerRadiusMm, units).toFixed(3))}
                  />
                </div>
              )}
              {cornerRadiusMm !== null
                ? 'Engaged shallower than the corner radius, the contact point rides the radius: De = D − 2R + 2√(2R·ap − ap²). This is what moves surface speed vs rpm on high-feed tooling. Leave ap empty for full-radius engagement (De = D).'
                : 'Each ƒx pair is two-way: edit either side and the other follows; the side you touched last wins at save time.'}
            </div>
            <p className="text-[9px] leading-relaxed text-mute">
              The picked profile is copied into operations that choose this tool.
              Editing the library later never rewrites existing operations.
            </p>
          </DialogSection>
        )}
      </div>
      <footer className="flex h-11 shrink-0 items-center justify-end gap-2 border-t border-edge px-3">
        {syncActions}
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
