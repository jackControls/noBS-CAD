import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Copy, Plus, Search, Trash2, X } from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { CamToolIcon } from './CamToolIcon';
import { getEngine } from '../../engine';
import { cutterGeometry } from '../../cam/cutter';
import {
  addCamTool,
  camToolCompatible,
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
  CamDrillCycle,
  CamOperationDto,
  CamToolDto,
  CamToolKind,
} from '../../engine/types';
import { useAppStore } from '../../store/appStore';
import { useTranslation } from '../../i18n';
import { runCamAction } from './CamBrowser';
import {
  CAM_DIALOG_INPUT,
  CAM_DIALOG_LABEL,
  DialogSection,
  DraftNumber,
  parseDraft,
} from './camFields';

type CamToolPickKind = CamOperationDto['kind'];

const KIND_LABELS: Record<CamToolKind, string> = {
  flat_end_mill: 'cam.tool.kindFlatEndMill',
  ball_end_mill: 'cam.tool.kindBallEndMill',
  bull_nose_end_mill: 'cam.tool.kindBullNoseEndMill',
  face_mill: 'cam.tool.kindFaceShellMill',
  drill: 'cam.tool.kindDrill',
  chamfer_mill: 'cam.tool.kindChamferMill',
  tap: 'cam.tool.kindTap',
  reamer: 'cam.tool.kindReamer',
  boring_bar: 'cam.tool.kindBoringBar',
  thread_mill: 'cam.tool.kindThreadMill',
  turning_general: 'cam.tool.kindGeneralTurning',
};

/** New-tool picker page: kinds grouped the way machinists shop for them.
 *  Turning lands with its own workspace; the tile stays visible as a
 *  promise, disabled. */
const KIND_GROUPS: Array<{ labelKey: string; kinds: CamToolKind[]; planned?: boolean }> = [
  {
    labelKey: 'cam.tool.groupMilling',
    kinds: ['flat_end_mill', 'ball_end_mill', 'bull_nose_end_mill', 'face_mill', 'chamfer_mill', 'thread_mill'],
  },
  { labelKey: 'cam.tool.groupHoleMaking', kinds: ['drill', 'tap', 'reamer', 'boring_bar'] },
  { labelKey: 'cam.tool.groupTurningPlanned', kinds: ['turning_general'], planned: true },
];

/** Kinds whose shank feeds axially into a hole; the center-cutting flag does
 *  not apply to them (it only gates plunge-capable milling/drilling). */
const HOLE_TOOL_KINDS: CamToolKind[] = ['tap', 'reamer', 'boring_bar', 'thread_mill'];

/** Explicit corner treatments are tool geometry, not wear compensation. */
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
export function CamToolDialog({
  toolId,
  pickFor = null,
}: {
  toolId: number | null;
  /** Picker mode: stacked over an operation dialog; confirming a compatible
   *  tool hands its id back through `camToolPick` instead of editing it. */
  pickFor?: { kind: CamToolPickKind; cycle?: CamDrillCycle } | null;
}) {
  const { t } = useTranslation();
  const cam = useAppStore((state) => state.camDocument);
  // In picker mode closing cancels the pick and returns to the dialog below.
  const close = () =>
    pickFor
      ? useAppStore.getState().popCamDialog()
      : useAppStore.getState().setCamDialog(null);
  const units = cam.units;
  const lu = lengthUnitLabel(units);
  const [query, setQuery] = useState('');

  const centralOn = centralLibraryAvailable();
  // Picking starts on the project scope; the operator can flip to central.
  const [scope, setScope] = useState<'central' | 'project'>(
    toolId !== null || pickFor || !centralOn ? 'project' : 'central',
  );
  const [central, setCentral] = useState<CentralCamLibrary | null>(null);
  const reloadCentral = useCallback(async () => {
    setCentral(await loadCentralLibrary());
  }, []);
  useEffect(() => {
    void reloadCentral();
  }, [reloadCentral]);

  const tools = scope === 'central' ? central?.tools ?? [] : cam.tools;
  // Free-text filter over the visible scope: name, tool number, or type.
  const needle = query.trim().toLowerCase();
  const filteredTools = needle
    ? tools.filter((tool) =>
        [
          tool.name,
          tool.number != null ? `t${tool.number}` : '',
          t(KIND_LABELS[tool.kind]),
        ].some((field) => field.toLowerCase().includes(needle)),
      )
    : tools;
  // In picker mode only tools the waiting operation can use are selectable.
  const compatible = (tool: CamToolDto) =>
    !pickFor || camToolCompatible(pickFor.kind, tool, pickFor.cycle);
  const [pickId, setPickId] = useState<number | null>(null);
  const pickSelected =
    pickId !== null ? tools.find((tool) => tool.id === pickId) ?? null : null;
  /** Confirm a picker selection: central picks are copied into the project
   *  first — operations reference project snapshots, never the shared
   *  collection directly — then the id travels back via `camToolPick`. */
  const confirmPick = (tool: CamToolDto) =>
    runCamAction(async () => {
      if (scope === 'central') await importCamToolFromCentral(tool.id);
      useAppStore.getState().setCamToolPick(tool.id);
      useAppStore.getState().popCamDialog();
    });
  const [editing, setEditing] = useState<number | 'new' | null>(toolId);
  const [template, setTemplate] = useState<CamToolDto | null>(null);
  const [draftSeq, setDraftSeq] = useState(0);
  useEffect(() => {
    if (!centralOn) return;
    const remove = listen('cam-library-location-changed', () => {
      if (scope === 'central') {
        setEditing(null); setTemplate(null); setPickId(null); setDraftSeq(value => value + 1);
      }
      void reloadCentral();
    });
    return () => { void remove.then(unlisten => unlisten()).catch(() => undefined); };
  }, [centralOn, reloadCentral, scope]);
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
  // First run with an empty library lands straight on the type picker —
  // except in picker mode, where the empty list speaks for itself.
  useEffect(() => {
    if (pickFor || editing !== null) return;
    if (scope === 'project' && cam.tools.length === 0) setEditing('new');
    if (scope === 'central' && central !== null && central.tools.length === 0) setEditing('new');
  }, [pickFor, editing, scope, cam.tools.length, central]);

  // Picker mode: when the project scope holds nothing the operation can use
  // but the central library does, flip over automatically — an empty project
  // list looks like the filter swallowed every tool otherwise.
  useEffect(() => {
    if (!pickFor || scope !== 'project' || central === null) return;
    if (cam.tools.some(compatible)) return;
    if (central.tools.some(compatible)) setScope('central');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickFor, scope, central, cam.tools]);

  const saveTool = async (draft: CamToolDraft, existingId: number | null) => {
    if (scope === 'central') {
      if (!central) throw new Error(t('cam.tool.errorCentralUnavailable'));
      if (existingId !== null) {
        await updateCentralLibraryTool(existingId, (tool) => Object.assign(tool, draft), central);
      } else {
        await addCentralLibraryTool(draft, central);
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
        await deleteCentralLibraryTool(tool.id, central ?? undefined);
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
            title={t('cam.tool.copyToCentralHint')}
            onClick={() =>
              runCamAction(async () => {
                await publishCamToolToCentral(selected.id);
                await reloadCentral();
              })
            }
            className="flex h-7 items-center rounded border border-edge px-2 text-[10px] font-semibold text-mute hover:border-accent/40 hover:text-accent"
          >
            {t('cam.tool.addToCentral')}
          </button>
        ) : twinDiffers ? (
          <>
            <button
              type="button"
              title={t('cam.tool.overwriteCentralHint')}
              onClick={() =>
                runCamAction(async () => {
                  await publishCamToolToCentral(selected.id);
                  await reloadCentral();
                })
              }
              className="flex h-7 items-center rounded border border-edge px-2 text-[10px] font-semibold text-mute hover:border-accent/40 hover:text-accent"
            >
              {t('cam.tool.updateCentral')}
            </button>
            <button
              type="button"
              title={t('cam.tool.resetCentralHint')}
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
              {t('cam.tool.resetCentral')}
            </button>
          </>
        ) : (
          <span className="px-1 text-[9px] italic text-mute/60">{t('cam.tool.inSyncCentral')}</span>
        )}
      </div>
    ) : null;

  return (
    <div
      data-native-viewport-dim="0.25"
      className={`fixed inset-0 z-[70] flex items-center justify-center bg-black/25 p-6 ${
        // Picker mode sits over an operation dialog: capture every click so
        // the suspended dialog underneath stays inert.
        pickFor ? 'pointer-events-auto' : 'pointer-events-none'
      }`}
    >
      <div
        data-testid="cam-tool-dialog"
        className="feature-dialog pointer-events-auto flex h-[78vh] w-[880px] max-w-full flex-col overflow-hidden rounded border border-edge bg-panel shadow-2xl"
      >
        <header className="flex h-10 shrink-0 items-center gap-2 border-b border-edge px-3">
          <CamToolIcon id="camToolLibrary" size={18} />
          <span className="text-xs font-semibold text-ink">
            {pickFor ? t('cam.tool.selectTool') : t('cam.tool.libraryTitle')}
          </span>
          {centralOn && <button type="button" className="text-[10px] text-mute underline hover:text-ink"
            onClick={() => useAppStore.getState().setSettingsOpen(true)}>{t('cam.tool.storageSettings')}</button>}
          {centralOn && (
            <div className="ml-1 flex items-center gap-0.5 rounded border border-edge bg-header/40 p-0.5">
              {(
                [
                  ['central', t('cam.tool.scopeCentral')],
                  ['project', t('cam.tool.scopeProject')],
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
            {t('cam.tool.toolCountUnits').replace('{count}', String(tools.length)).replace('{unit}', lu)}
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
            {!pickFor && scope === 'project' && centralOn && importable.length > 0 && (
              <div className="flex h-9 shrink-0 items-center gap-2 border-b border-edge px-3">
                <span className="text-[9px] font-semibold uppercase tracking-widest text-mute/60">
                  {t('cam.tool.importSection')}
                </span>
                <select
                  value={importId}
                  onChange={(event) => setImportId(event.target.value)}
                  className="h-6 min-w-0 flex-1 rounded border border-edge bg-header/60 px-1.5 text-[10px] text-ink"
                >
                  <option value="">{t('cam.tool.fromCentralLibrary')}</option>
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
                  {t('cam.tool.addToProject')}
                </button>
              </div>
            )}
            <div className="flex h-9 shrink-0 items-center gap-2 border-b border-edge px-3">
              <Search size={12} className="shrink-0 text-mute/60" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('cam.tool.filterPlaceholder')}
                className="h-6 min-w-0 flex-1 rounded border border-edge bg-header/60 px-1.5 text-[10px] text-ink outline-none placeholder:text-mute/50 focus:border-accent/50"
              />
              {needle && (
                <span className="shrink-0 text-[9px] text-mute/70">
                  {filteredTools.length} of {tools.length}
                </span>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <table className="w-full border-collapse text-[11px]">
                <thead className="sticky top-0 bg-panel">
                  <tr className="border-b border-edge text-left text-[9px] uppercase tracking-wider text-mute">
                    <th className="px-3 py-1.5 font-semibold">#</th>
                    <th className="px-2 py-1.5 font-semibold">{t('cam.tool.name')}</th>
                    <th className="px-2 py-1.5 font-semibold">{t('cam.tool.colType')}</th>
                    <th className="px-2 py-1.5 font-semibold">Ø</th>
                    <th className="px-2 py-1.5 font-semibold">{t('cam.tool.colCornerR')}</th>
                    <th className="px-2 py-1.5 font-semibold">{t('cam.tool.colFluteLen')}</th>
                    <th className="px-2 py-1.5 font-semibold">{t('cam.tool.colOverall')}</th>
                    <th className="px-2 py-1.5 font-semibold">{t('cam.tool.colFlutes')}</th>
                    <th className="px-2 py-1.5 font-semibold">{t('cam.tool.colProfiles')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTools.map((tool) => {
                    const usable = compatible(tool);
                    const active = pickFor ? pickId === tool.id : editing === tool.id;
                    return (
                      <tr
                        key={tool.id}
                        onClick={() => {
                          if (pickFor) {
                            if (usable) setPickId(tool.id);
                          } else {
                            setEditing(tool.id);
                          }
                        }}
                        onDoubleClick={() => {
                          if (pickFor && usable) void confirmPick(tool);
                        }}
                        title={
                          pickFor && !usable
                            ? t('cam.tool.notUsable')
                            : pickFor
                              ? t('cam.tool.doubleClickSelect')
                              : undefined
                        }
                        className={`border-b border-edge/50 ${
                          pickFor && !usable
                            ? 'cursor-not-allowed opacity-35'
                            : 'cursor-pointer'
                        } ${
                          active ? 'bg-accent/15 text-ink' : 'text-mute hover:bg-edge/30 hover:text-ink'
                        }`}
                      >
                        <td className="px-3 py-1.5 font-mono text-accent">
                          {tool.number != null ? `T${tool.number}` : '—'}
                        </td>
                        <td className="max-w-0 truncate px-2 py-1.5">{tool.name}</td>
                        <td className="px-2 py-1.5">{t(KIND_LABELS[tool.kind])}</td>
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
                  {filteredTools.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-4 py-8 text-center text-[11px] italic text-mute/70">
                        {needle
                          ? t('cam.tool.noMatch').replace('{query}', query.trim())
                          : pickFor
                            ? centralOn
                              ? t('cam.tool.nothingUsableOtherScope')
                              : t('cam.tool.nothingUsableCreate')
                            : scope === 'central'
                              ? central === null
                                ? t('cam.tool.loadingCentral')
                                : t('cam.tool.centralEmpty')
                              : centralOn
                                ? t('cam.tool.projectEmptyWithCentral')
                                : t('cam.tool.emptyLibrary')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {pickFor ? (
              <div className="flex h-9 shrink-0 items-center gap-2 border-t border-edge px-3">
                <span className="min-w-0 flex-1 truncate text-[10px] text-mute">
                  {pickSelected
                    ? `${pickSelected.number != null ? `T${pickSelected.number} · ` : ''}${pickSelected.name}`
                    : t('cam.tool.pickCompatibleHint')}
                </span>
                <button
                  type="button"
                  onClick={close}
                  className="h-6 rounded border border-edge px-2 text-[10px] text-mute hover:text-ink"
                >
                  {t('cam.tool.cancel')}
                </button>
                <button
                  type="button"
                  disabled={!pickSelected || !compatible(pickSelected)}
                  onClick={() => pickSelected && void confirmPick(pickSelected)}
                  className="h-6 rounded border border-accent/50 bg-accent/15 px-2 text-[10px] font-semibold text-accent hover:bg-accent/25 disabled:opacity-40"
                >
                  {t('cam.tool.selectToolAction')}
                </button>
              </div>
            ) : (
            <div className="flex h-9 shrink-0 items-center gap-2 border-t border-edge px-3">
              <button
                type="button"
                title={
                  scope === 'project'
                    ? t('cam.tool.createProjectHint')
                    : t('cam.tool.createCentralHint')
                }
                onClick={() => startNew(null)}
                className="flex h-6 items-center gap-1 rounded border border-accent/50 bg-accent/15 px-2 text-[10px] font-semibold text-accent hover:bg-accent/25"
              >
                <Plus size={12} /> {t('cam.tool.newTool')}
              </button>
              {selected && (
                <>
                  <button
                    type="button"
                    title={t('cam.tool.duplicateHint')}
                    onClick={() => startNew(selected)}
                    className="flex h-6 items-center gap-1 rounded border border-edge px-2 text-[10px] text-mute hover:text-ink"
                  >
                    <Copy size={11} /> {t('cam.tool.duplicate')}
                  </button>
                  <button
                    type="button"
                    title={
                      scope === 'central'
                        ? t('cam.tool.deleteCentralHint')
                        : t('cam.tool.deleteProjectHint')
                    }
                    onClick={() => removeTool(selected)}
                    className="flex h-6 items-center gap-1 rounded border border-edge px-2 text-[10px] text-mute hover:text-warn"
                  >
                    <Trash2 size={11} /> {t('cam.tool.delete')}
                  </button>
                </>
              )}
            </div>
            )}
          </div>
          {!pickFor && (
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
                {t('cam.tool.selectToEdit')}
              </p>
            )}
          </div>
          )}
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
  const { t } = useTranslation();
  const cam = useAppStore((state) => state.camDocument);
  const units = cam.units;
  const lu = lengthUnitLabel(units);
  const fu = feedUnitLabel(units);
  const source = existing ?? template;
  // Brand-new tools (no duplicate template) start on the type picker.
  const [picking, setPicking] = useState(existing === null && template === null);
  const [tab, setTab] = useState<EditorTab>('general');

  const [kind, setKind] = useState<CamToolKind>(source?.kind ?? 'flat_end_mill');
  // Holemaking tools follow drilling convention: surface speed drives rpm
  // and the feed is entered per revolution (there is no per-tooth feed on a
  // two-flute drill). Milling tools keep the rpm + per-tooth convention.
  const holemaking = kind === 'drill' || kind === 'reamer' || kind === 'boring_bar';
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
  const [cornerShape, setCornerShape] = useState<'sharp' | 'radius' | 'chamfer'>(
    source?.corner_chamfer ? 'chamfer' : source?.corner_radius != null || source?.kind === 'bull_nose_end_mill' ? 'radius' : 'sharp',
  );
  const [cornerChamferWidth, setCornerChamferWidth] = useState(
    source?.corner_chamfer ? String(displayLength(source.corner_chamfer.width, units)) : '',
  );
  const [cornerChamferAngle, setCornerChamferAngle] = useState(String(source?.corner_chamfer?.angle_degrees ?? 45));
  const [fluteLength, setFluteLength] = useState(
    source ? String(displayLength(source.flute_length, units)) : '',
  );
  const [overallLength, setOverallLength] = useState(
    source ? String(displayLength(source.overall_length, units)) : '',
  );
  const [fluteCount, setFluteCount] = useState(source ? String(source.flute_count) : '4');
  const [centerCutting, setCenterCutting] = useState(source?.center_cutting ?? true);
  const [pointAngle, setPointAngle] = useState(
    String(source?.point_angle_degrees ?? (source?.kind === 'drill' ? 118 : 90)),
  );
  const selectKind = (next: CamToolKind) => {
    if (next !== kind) {
      setPointAngle(String(next === 'drill' ? 118 : 90));
      setCornerShape(next === 'bull_nose_end_mill' ? 'radius' : 'sharp');
    }
    setKind(next);
  };
  // Planner-step defaults: operations that pick this tool seed their
  // passes tab from these until the operator types a value.
  const [defaultStepDown, setDefaultStepDown] = useState(
    source?.default_step_down != null ? String(displayLength(source.default_step_down, units)) : '',
  );
  const [defaultStepOver, setDefaultStepOver] = useState(
    source?.default_step_over != null ? String(displayLength(source.default_step_over, units)) : '',
  );
  const [error, setError] = useState<string | null>(null);

  // --- Geometry parsing shared by the calculator and submit ---------------
  const parsePositive = (value: string): number | null => {
    const parsed = Number(value);
    return value.trim() && Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };
  const diameterMm = parsePositive(diameter) !== null ? commitLength(Number(diameter), units) : null;
  const cornerRadiusMm = cornerShape === 'radius' && CORNER_RADIUS_KINDS.includes(kind) && parsePositive(cornerRadius) !== null
    ? commitLength(Number(cornerRadius), units) : null;
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
      speedDriver: holemaking ? 'vc' : 'rpm',
      feedDriver: 'feed',
      plungeDriver: holemaking ? 'fpr' : 'plunge',
    });
    const first = source
      ? fromCutting(t('cam.tool.defaultPreset'), source.cutting)
      : fromCutting(t('cam.tool.defaultPreset'), { spindle_rpm: 0, feed_xy: 0, feed_z: 0, coolant: 'flood' });
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
      if (de === null) throw new Error(t('cam.tool.errorDiameterRequired'));
      return rpmFromCuttingSpeed(
        commitCuttingSpeed(parseDraft(profile.surfaceSpeed, t('cam.tool.paramSurfaceSpeed')), units),
        de,
      );
    }
    return Math.round(parseDraft(profile.rpm, t('cam.tool.paramSpindleSpeed').replace('{profile}', profile.name || t('cam.tool.defaultPreset'))));
  };

  const cuttingOf = (profile: ProfileDraft): CamCuttingParametersDto => {
    const rpm = resolveRpm(profile);
    const plungeMm =
      profile.plungeDriver === 'fpr' && profile.plungePerRev.trim()
        ? commitLength(parseDraft(profile.plungePerRev, t('cam.tool.paramFeedPerRevolution')), units) * rpm
        : commitFeed(parseDraft(profile.feedZ, t('cam.tool.paramPlungeFeed').replace('{profile}', profile.name || t('cam.tool.defaultPreset'))), units);
    // Holemaking has no transverse feed: the drilling feed serves both axes
    // so downstream consumers (drill feed-out, boring) read a real value.
    const feedMm = holemaking
      ? plungeMm
      : profile.feedDriver === 'fz' && profile.feedPerTooth.trim()
        ? commitLength(parseDraft(profile.feedPerTooth, t('cam.tool.paramFeedPerTooth')), units) * rpm * (flutes ?? 1)
        : commitFeed(parseDraft(profile.feedXy, t('cam.tool.paramCuttingFeed').replace('{profile}', profile.name || t('cam.tool.defaultPreset'))), units);
    return { spindle_rpm: rpm, feed_xy: feedMm, feed_z: plungeMm, coolant: profile.coolant };
  };

  /** Parse the identity/geometry tabs so a bad field blocks submit early. */
  const checkGeometry = () => {
    if (number.trim()) parseDraft(number, t('cam.tool.toolNumber'));
    parseDraft(diameter, t('cam.tool.diameter'));
    if (CORNER_RADIUS_KINDS.includes(kind) && cornerShape === 'radius') {
      if (parseDraft(cornerRadius, t('cam.tool.cornerRadiusLabel')) <= 0) throw new Error(t('cam.tool.errorCornerRadiusPositive'));
    }
    if (CORNER_RADIUS_KINDS.includes(kind) && cornerShape === 'chamfer') {
      parseDraft(cornerChamferWidth, t('cam.tool.cornerChamferWidth'));
      parseDraft(cornerChamferAngle, t('cam.tool.paramCornerChamferAngle'));
    }
    parseDraft(fluteLength, t('cam.tool.fluteLength'));
    parseDraft(overallLength, t('cam.tool.overallLength'));
    parseDraft(fluteCount, t('cam.tool.fluteCount'));
    if (kind === 'chamfer_mill' || kind === 'drill') parseDraft(pointAngle, t('cam.tool.paramPointAngle'));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      checkGeometry();
      const toolNumber = number.trim()
        ? Math.round(parseDraft(number, t('cam.tool.toolNumber')))
        : null;
      if (toolNumber !== null && toolNumber <= 0) {
        throw new Error(t('cam.tool.errorToolNumberPositive'));
      }
      const presetNames = profiles.slice(1).map((profile) => profile.name.trim());
      if (presetNames.some((presetName) => !presetName)) {
        throw new Error(t('cam.tool.errorProfileNamesRequired'));
      }
      if (new Set(presetNames).size !== presetNames.length) {
        throw new Error(t('cam.tool.errorProfileNamesUnique'));
      }
      // Optional planner-step defaults: positive, and a step-over past the
      // diameter can never clear the web between passes.
      const stepDownDefault = defaultStepDown.trim()
        ? commitLength(parseDraft(defaultStepDown, t('cam.tool.paramDefaultStepDown')), units)
        : null;
      const stepOverDefault = defaultStepOver.trim()
        ? commitLength(parseDraft(defaultStepOver, t('cam.tool.paramDefaultStepOver')), units)
        : null;
      if (stepDownDefault !== null && stepDownDefault <= 0) {
        throw new Error(t('cam.tool.errorStepDownPositive'));
      }
      if (stepOverDefault !== null && stepOverDefault <= 0) {
        throw new Error(t('cam.tool.errorStepOverPositive'));
      }
      const diameterMmForSteps = commitLength(parseDraft(diameter, t('cam.tool.diameter')), units);
      if (stepOverDefault !== null && stepOverDefault > diameterMmForSteps + 1e-9) {
        throw new Error(t('cam.tool.errorStepOverExceedsDiameter'));
      }
      const draft: CamToolDraft = {
        number: toolNumber,
        name: name.trim() || `${t(KIND_LABELS[kind])}${toolNumber !== null ? ` T${toolNumber}` : ''}`,
        kind,
        diameter: commitLength(parseDraft(diameter, t('cam.tool.diameter')), units),
        corner_radius:
          CORNER_RADIUS_KINDS.includes(kind) && cornerShape === 'radius'
            ? commitLength(parseDraft(cornerRadius, t('cam.tool.cornerRadiusLabel')), units)
            : null,
        corner_chamfer: CORNER_RADIUS_KINDS.includes(kind) && cornerShape === 'chamfer'
          ? { width: commitLength(parseDraft(cornerChamferWidth, t('cam.tool.cornerChamferWidth')), units),
              angle_degrees: parseDraft(cornerChamferAngle, t('cam.tool.paramCornerChamferAngle')) }
          : null,
        flute_length: commitLength(parseDraft(fluteLength, t('cam.tool.fluteLength')), units),
        overall_length: commitLength(parseDraft(overallLength, t('cam.tool.overallLength')), units),
        center_cutting: HOLE_TOOL_KINDS.includes(kind) ? false : centerCutting,
        flute_count: Math.round(parseDraft(fluteCount, t('cam.tool.fluteCount'))),
        point_angle_degrees:
          kind === 'chamfer_mill' || kind === 'drill' ? parseDraft(pointAngle, t('cam.tool.paramPointAngle')) : null,
        default_step_down: stepDownDefault,
        default_step_over: stepOverDefault,
        cutting: cuttingOf(profiles[0]),
        cutting_presets: profiles.slice(1).map((profile) => ({
          name: profile.name.trim(),
          cutting: cuttingOf(profile),
        })),
      };
      runCamAction(async () => {
        // Validate central-library geometry too, not only project snapshots.
        await (await getEngine()).camCutterMesh(cutterGeometry({ ...draft, id: existing?.id ?? 1 }));
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
          {t('cam.tool.newToolPickType')}
        </div>
        <div className="min-h-0 flex-1 space-y-3 p-3">
          {KIND_GROUPS.map((group) => (
            <div key={group.labelKey}>
              <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-widest text-mute/60">
                {t(group.labelKey)}
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {group.kinds.map((candidate) => (
                  <button
                    key={candidate}
                    type="button"
                    disabled={group.planned}
                    title={group.planned ? t('cam.tool.turningPlannedHint') : undefined}
                    onClick={() => {
                      selectKind(candidate);
                      if (HOLE_TOOL_KINDS.includes(candidate)) setCenterCutting(false);
                      setPicking(false);
                    }}
                    className={`h-8 rounded border text-[10px] font-semibold ${
                      group.planned
                        ? 'cursor-not-allowed border-edge/50 bg-header/30 text-mute/40'
                        : 'border-edge bg-header/50 text-mute hover:border-accent/40 hover:text-ink'
                    }`}
                  >
                    {t(KIND_LABELS[candidate])}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <p className="text-[9px] leading-relaxed text-mute">
            {t('cam.tool.kindExplainer')}
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
          ? t('cam.tool.editTitle').replace('{name}', `${existing.number != null ? `T${existing.number} ` : ''}${existing.name}`)
          : t('cam.tool.newLibraryTool')}
      </div>
      <div className="flex shrink-0 items-center gap-1 border-b border-edge px-2 py-1">
        {(
          [
            ['general', t('cam.tool.tabGeneral')],
            ['cutter', t('cam.tool.tabCutter')],
            ['cutting', t('cam.tool.tabCuttingData')],
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
            <DialogSection title={t('cam.tool.sectionTool')}>
              {!existing && (
                <div className="mb-2 flex items-center gap-2 text-[10px] text-mute">
                  <span className="rounded border border-accent/40 bg-accent/10 px-2 py-0.5 font-semibold text-accent">
                    {t(KIND_LABELS[kind])}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPicking(true)}
                    className="text-mute underline decoration-dotted hover:text-ink"
                  >
                    {t('cam.tool.changeType')}
                  </button>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                {existing && (
                  <label className="block">
                    <span className={CAM_DIALOG_LABEL}>{t('cam.tool.kind')}</span>
                    <select
                      value={kind}
                      onChange={(event) => selectKind(event.target.value as CamToolKind)}
                      className={CAM_DIALOG_INPUT}
                    >
                      {(Object.keys(KIND_LABELS) as CamToolKind[])
                        .filter((candidate) => candidate !== 'turning_general')
                        .map((candidate) => (
                          <option key={candidate} value={candidate}>
                            {t(KIND_LABELS[candidate])}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
                <DraftNumber label={t('cam.tool.toolNumberOptional')} value={number} onChange={setNumber} integer />
              </div>
              <label className="block">
                <span className={CAM_DIALOG_LABEL}>{t('cam.tool.name')}</span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={t(KIND_LABELS[kind])}
                  className={CAM_DIALOG_INPUT}
                />
              </label>
              <p className="text-[9px] leading-relaxed text-mute">
                {t('cam.tool.nameHelp')}
              </p>
            </DialogSection>
          </>
        )}

        {tab === 'cutter' && (
          <DialogSection title={t('cam.tool.sectionGeometry').replace('{unit}', lu)}>
            <div className="grid grid-cols-2 gap-2">
              <DraftNumber label={t('cam.tool.diameter')} value={diameter} onChange={(value) => { setDiameter(value); }} unit={lu} />
              {(kind === 'flat_end_mill' || kind === 'face_mill') && (
                <label className="block">
                  <span className={CAM_DIALOG_LABEL}>{t('cam.tool.cornerShape')}</span>
                  <select aria-label={t('cam.tool.cornerShape')} className={CAM_DIALOG_INPUT} value={cornerShape}
                    onChange={event => setCornerShape(event.target.value as typeof cornerShape)}>
                    <option value="sharp">{t('cam.tool.cornerSharp')}</option>
                    <option value="radius">{t('cam.tool.cornerRadius')}</option>
                    <option value="chamfer">{t('cam.tool.cornerChamfer')}</option>
                  </select>
                </label>
              )}
              {CORNER_RADIUS_KINDS.includes(kind) && cornerShape === 'radius' && (
                <DraftNumber
                  label={t('cam.tool.cornerRadiusLabel')}
                  value={cornerRadius}
                  onChange={(value) => { setCornerRadius(value); }}
                  unit={lu}
                />
              )}
              {CORNER_RADIUS_KINDS.includes(kind) && cornerShape === 'chamfer' && (<>
                <DraftNumber label={t('cam.tool.cornerChamferWidth')} value={cornerChamferWidth} onChange={setCornerChamferWidth} unit={lu} />
                <DraftNumber label={t('cam.tool.cornerChamferAngle')} value={cornerChamferAngle} onChange={setCornerChamferAngle} unit="deg" />
              </>)}
              <DraftNumber label={t('cam.tool.fluteCount')} value={fluteCount} onChange={setFluteCount} integer />
              <DraftNumber label={t('cam.tool.fluteLength')} value={fluteLength} onChange={setFluteLength} unit={lu} />
              <DraftNumber label={t('cam.tool.overallLength')} value={overallLength} onChange={setOverallLength} unit={lu} />
              {(kind === 'chamfer_mill' || kind === 'drill') && (
                <DraftNumber label={t('cam.tool.pointAngle')} value={pointAngle} onChange={setPointAngle} unit="deg" />
              )}
            </div>
            {(cornerRadiusMm !== null || CORNER_RADIUS_KINDS.includes(kind)) && (
              <button
                type="button"
                onClick={refreshAfterGeometry}
                className="mt-1 text-[9px] text-mute underline decoration-dotted hover:text-ink"
              >
                {t('cam.tool.refreshLinks')}
              </button>
            )}
            {!HOLE_TOOL_KINDS.includes(kind) && kind !== 'drill' && (
              <label className="mt-1 flex items-center gap-2 text-[11px] text-ink">
                <input
                  type="checkbox"
                  checked={centerCutting}
                  onChange={(event) => setCenterCutting(event.target.checked)}
                />
                {t('cam.tool.centerCutting')}
              </label>
            )}
          </DialogSection>
        )}

        {tab === 'cutting' && (
          <>
          <DialogSection title={t('cam.tool.sectionCuttingData').replace('{unit}', fu)}>
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
                  {index === 0 ? t('cam.tool.defaultPreset') : candidate.name || t('cam.tool.unnamed')}
                </button>
              ))}
              <button
                type="button"
                title={t('cam.tool.addProfileHint')}
                onClick={() =>
                  setProfiles((current) => [
                    ...current,
                    { ...current[0], name: t('cam.tool.profileName').replace('{number}', String(current.length)) },
                  ])
                }
                className="flex h-6 items-center rounded border border-edge px-1.5 text-mute hover:text-ink"
              >
                <Plus size={11} />
              </button>
              {activeProfile > 0 && (
                <button
                  type="button"
                  title={t('cam.tool.deleteProfileHint')}
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
                <span className={CAM_DIALOG_LABEL}>{t('cam.tool.profileNameLabel')}</span>
                <input
                  value={profile.name}
                  onChange={(event) => patchProfile(activeProfile, { name: event.target.value })}
                  placeholder={t('cam.tool.profileNamePlaceholder')}
                  className={CAM_DIALOG_INPUT}
                />
              </label>
            )}
            <div className="grid grid-cols-2 gap-2">
              <DraftNumber
                label={t('cam.tool.spindle')}
                value={profile.rpm}
                onChange={commitRpm}
                unit="rpm"
                integer
              />
              <DraftNumber
                label={`${t('cam.tool.surfaceSpeed')}${profile.speedDriver === 'vc' ? t('cam.tool.drivesSuffix') : ''}`}
                value={profile.surfaceSpeed}
                onChange={commitSurfaceSpeed}
                unit={cuttingSpeedUnitLabel(units)}
              />
              {!holemaking && (
                <>
                  <DraftNumber
                    label={t('cam.tool.cuttingFeed')}
                    value={profile.feedXy}
                    onChange={commitFeedXy}
                    unit={fu}
                  />
                  <DraftNumber
                    label={`${t('cam.tool.feedPerTooth')}${profile.feedDriver === 'fz' ? t('cam.tool.drivesSuffix') : ''}`}
                    value={profile.feedPerTooth}
                    onChange={commitFeedPerTooth}
                    unit={`${chipLoadUnitLabel(units)}/tooth`}
                  />
                </>
              )}
              <DraftNumber
                label={holemaking ? t('cam.tool.drillingFeed') : t('cam.tool.plungeFeed')}
                value={profile.feedZ}
                onChange={commitFeedZ}
                unit={fu}
              />
              <DraftNumber
                label={
                  holemaking
                    ? `${t('cam.tool.feedPerRevolution')}${profile.plungeDriver === 'fpr' ? t('cam.tool.drivesSuffix') : ''}`
                    : `${t('cam.tool.plungePerRev')}${profile.plungeDriver === 'fpr' ? t('cam.tool.drivesSuffix') : ''}`
                }
                value={profile.plungePerRev}
                onChange={commitPlungePerRev}
                unit={`${chipLoadUnitLabel(units)}/rev`}
              />
              <label className="block">
                <span className={CAM_DIALOG_LABEL}>{t('cam.tool.coolant')}</span>
                <select
                  value={profile.coolant}
                  onChange={(event) =>
                    patchProfile(activeProfile, { coolant: event.target.value as CamCoolantMode })
                  }
                  className={CAM_DIALOG_INPUT}
                >
                  <option value="off">{t('cam.tool.coolantOff')}</option>
                  <option value="mist">{t('cam.tool.coolantMist')}</option>
                  <option value="flood">{t('cam.tool.coolantFlood')}</option>
                </select>
              </label>
            </div>
            <div className="rounded border border-edge/70 bg-header/40 p-2 text-[9px] leading-relaxed text-mute">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="font-semibold uppercase tracking-widest text-mute/60">
                  {t('cam.tool.effectiveDiameter')}
                </span>
                <span className="font-mono text-ink">
                  {effectiveDiameter !== null ? `${displayLength(effectiveDiameter, units).toFixed(3)} ${lu}` : '—'}
                </span>
              </div>
              {cornerRadiusMm !== null && (
                <div className="mb-1">
                  <DraftNumber
                    label={t('cam.tool.atDepthOfCut')}
                    value={chipAp}
                    onChange={(value) => { setChipAp(value); }}
                    unit={lu}
                    placeholder={String(displayLength(cornerRadiusMm, units).toFixed(3))}
                  />
                </div>
              )}
              {cornerRadiusMm !== null
                ? t('cam.tool.effectiveDiameterHelp')
                : t('cam.tool.fxPairHelp')}
            </div>
            <p className="text-[9px] leading-relaxed text-mute">
              {t('cam.tool.profileCopyHelp')}
            </p>
          </DialogSection>
          <DialogSection title={t('cam.tool.sectionStepDefaults')}>
            <div className="grid grid-cols-2 gap-2">
              <DraftNumber
                label={t('cam.tool.defaultStepDown')}
                value={defaultStepDown}
                onChange={setDefaultStepDown}
                unit={lu}
              />
              <DraftNumber
                label={t('cam.tool.defaultStepOver')}
                value={defaultStepOver}
                onChange={setDefaultStepOver}
                unit={lu}
              />
            </div>
            <p className="text-[9px] leading-relaxed text-mute">
              {t('cam.tool.stepDefaultsHelp')}
            </p>
          </DialogSection>
          </>
        )}
      </div>
      <footer className="flex h-11 shrink-0 items-center justify-end gap-2 border-t border-edge px-3">
        {syncActions}
        <button
          type="submit"
          className="h-7 rounded border border-accent/50 bg-accent/15 px-3 text-[10px] font-semibold text-accent hover:bg-accent/25"
        >
          {existing ? t('cam.tool.saveTool') : t('cam.tool.addToLibrary')}
        </button>
      </footer>
    </form>
  );
}
