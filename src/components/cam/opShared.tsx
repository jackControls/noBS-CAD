import { useEffect, useMemo, useState } from 'react';
import { camToolCompatible, importCamToolFromCentral } from '../../cam/document';
import { centralLibraryAvailable, loadCentralLibrary } from '../../cam/library';
import { displayLength } from '../../cam/units';
import type {
  CamCoolantMode,
  CamDrillCycle,
  CamOperationDto,
  CamToolDto,
  CamUnits,
} from '../../engine/types';
import { useAppStore } from '../../store/appStore';
import { runCamAction } from './CamBrowser';
import {
  CAM_DIALOG_INPUT,
  CAM_DIALOG_LABEL,
  DialogSection,
  DraftNumber,
  feedUnit,
  lengthUnit,
} from './camFields';

type OperationKind = CamOperationDto['kind'];

/**
 * Shared building blocks of every operation dialog. One scaffold renders
 * all operation kinds; each kind only declares which pages and fields it
 * needs in `OP_PAGES` below. Editing a shared section (the tool picker,
 * heights, speeds & feeds) once applies to every operation kind.
 */

/** Pages and fields an operation kind switches on in the shared dialog. */
export interface OpPages {
  /** Geometry page shape: hole centers, a face area, or a closed path. */
  geometry: 'holes' | 'face' | 'path';
  /** Section label for the path geometry page. */
  pathLabel?: string;
  /** Thread-milling parameter page. */
  threadFields?: boolean;
  bottomZ?: boolean;
  /** Face depth entered below the model top instead of a bottom Z. */
  faceTarget?: boolean;
  /** Facing plunge clearance from the stock boundary. */
  safeDistance?: boolean;
  stepDown?: boolean;
  stepOver?: boolean;
  compensation?: boolean;
  chamferFields?: boolean;
  drillCycle?: boolean;
}

export const OP_PAGES: Record<OperationKind, OpPages> = {
  face: {
    geometry: 'face',
    faceTarget: true,
    safeDistance: true,
    stepDown: true,
    stepOver: true,
  },
  contour2d: {
    geometry: 'path',
    pathLabel: 'Contour path',
    bottomZ: true,
    stepDown: true,
    compensation: true,
  },
  pocket2d: {
    geometry: 'path',
    pathLabel: 'Pocket outline',
    bottomZ: true,
    stepDown: true,
    stepOver: true,
  },
  chamfer2d: {
    geometry: 'path',
    pathLabel: 'Chamfer profile',
    chamferFields: true,
  },
  drill: { geometry: 'holes', bottomZ: true, drillCycle: true },
  thread: { geometry: 'holes', bottomZ: true, threadFields: true },
};

/** The one tool picker every operation programs through. Defaults to the
 *  project's tool snapshots; switching to the central library lists every
 *  compatible tool there, and picking one copies it into the project and
 *  selects it in a single step — so a large central collection never
 *  floods the project picker. The cutting-profile select rides along when
 *  the chosen tool carries named profiles. */
export function OpToolPicker({
  kind,
  drillCycle,
  toolId,
  presetIndex,
  onChoose,
  onPreset,
}: {
  kind: OperationKind;
  drillCycle?: CamDrillCycle;
  toolId: number | null;
  presetIndex: number;
  /** Select a tool (project pick, or a central tool just imported). */
  onChoose: (tool: CamToolDto) => void;
  /** Copy one of the selected tool's cutting profiles into the drafts. */
  onPreset: (tool: CamToolDto, index: number) => void;
}) {
  const cam = useAppStore((state) => state.camDocument);
  const units = cam.units;
  const lu = lengthUnit(units);
  const centralOn = centralLibraryAvailable();
  const [scope, setScope] = useState<'project' | 'central'>('project');
  const [central, setCentral] = useState<CamToolDto[] | null>(null);
  useEffect(() => {
    if (!centralOn) return;
    void loadCentralLibrary().then((library) => setCentral(library?.tools ?? []));
  }, [centralOn]);

  const compatible = useMemo(
    () => (tool: CamToolDto) => camToolCompatible(kind, tool, drillCycle),
    [kind, drillCycle],
  );
  const projectTools = useMemo(() => cam.tools.filter(compatible), [cam.tools, compatible]);
  const centralTools = useMemo(() => (central ?? []).filter(compatible), [central, compatible]);
  const selected = cam.tools.find((candidate) => candidate.id === toolId) ?? null;

  const label = (tool: CamToolDto) =>
    `${tool.number != null ? `T${tool.number} · ` : ''}${tool.name} · Ø${displayLength(tool.diameter, units).toFixed(3)} ${lu}`;

  /** A central pick is an action, not a state: import the snapshot into the
   *  project, then hand it to the dialog as the chosen tool. */
  const pickCentral = (idText: string) => {
    const tool = centralTools.find((candidate) => candidate.id === Number(idText));
    if (!tool) return;
    runCamAction(async () => {
      await importCamToolFromCentral(tool.id);
      onChoose(tool);
      setScope('project');
    });
  };

  return (
    <DialogSection title="TOOL">
      {centralOn && (
        <div className="mb-2 grid grid-cols-2 gap-1.5">
          {(
            [
              ['project', `This project (${projectTools.length})`],
              ['central', `Central library (${centralTools.length})`],
            ] as const
          ).map(([value, text]) => (
            <button
              key={value}
              type="button"
              onClick={() => setScope(value)}
              className={`h-7 rounded border text-[10px] font-semibold ${
                scope === value
                  ? 'border-accent/50 bg-accent/15 text-accent'
                  : 'border-edge bg-header/50 text-mute hover:text-ink'
              }`}
            >
              {text}
            </button>
          ))}
        </div>
      )}

      {scope === 'project' ? (
        projectTools.length > 0 ? (
          <select
            value={toolId ?? ''}
            onChange={(event) => {
              const tool = projectTools.find(
                (candidate) => candidate.id === Number(event.target.value),
              );
              if (tool) onChoose(tool);
            }}
            className={CAM_DIALOG_INPUT}
          >
            {projectTools.map((tool) => (
              <option key={tool.id} value={tool.id}>
                {label(tool)}
              </option>
            ))}
          </select>
        ) : (
          <p className="rounded border border-warn/40 bg-warn/10 p-2 text-[10px] text-warn">
            {centralOn && centralTools.length > 0
              ? 'No compatible tool in this project yet — switch to the central library above; picking one copies it in.'
              : 'No compatible tool available. Create one in the Tool Library (ribbon) first.'}
          </p>
        )
      ) : central === null ? (
        <p className="text-[10px] italic text-mute">Loading the central library…</p>
      ) : centralTools.length > 0 ? (
        <>
          <select value="" onChange={(event) => pickCentral(event.target.value)} className={CAM_DIALOG_INPUT}>
            <option value="" disabled>
              Pick to copy into this project…
            </option>
            {centralTools.map((tool) => (
              <option key={tool.id} value={tool.id}>
                {label(tool)}
                {cam.tools.some((candidate) => candidate.id === tool.id) ? ' (in project — refresh)' : ''}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[9px] leading-relaxed text-mute/70">
            Picking a central tool copies a snapshot into this project and selects it; later edits on
            either side stay independent until you sync them in the Tool Library.
          </p>
        </>
      ) : (
        <p className="text-[10px] italic text-mute">No compatible tool in the central library.</p>
      )}

      {selected && selected.cutting_presets.length > 0 && (
        <label className="mt-2 block">
          <span className={CAM_DIALOG_LABEL}>Cutting profile</span>
          <select
            value={presetIndex}
            onChange={(event) => onPreset(selected, Number(event.target.value))}
            className={CAM_DIALOG_INPUT}
          >
            <option value={0}>Default preset</option>
            {selected.cutting_presets.map((preset, index) => (
              <option key={index + 1} value={index + 1}>
                {preset.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </DialogSection>
  );
}

/** Speeds & feeds page shared by every operation kind. */
export function OpSpeedsFeeds({
  units,
  rpm,
  feedXy,
  feedZ,
  coolant,
  onRpm,
  onFeedXy,
  onFeedZ,
  onCoolant,
}: {
  units: CamUnits;
  rpm: string;
  feedXy: string;
  feedZ: string;
  coolant: CamCoolantMode;
  onRpm: (value: string) => void;
  onFeedXy: (value: string) => void;
  onFeedZ: (value: string) => void;
  onCoolant: (value: CamCoolantMode) => void;
}) {
  const fu = feedUnit(units);
  return (
    <DialogSection title={`SPEEDS & FEEDS (${fu})`}>
      <div className="grid grid-cols-2 gap-2">
        <DraftNumber label="Spindle" value={rpm} onChange={onRpm} unit="rpm" integer />
        <label className="block">
          <span className={CAM_DIALOG_LABEL}>Coolant</span>
          <select
            value={coolant}
            onChange={(event) => onCoolant(event.target.value as CamCoolantMode)}
            className={CAM_DIALOG_INPUT}
          >
            <option value="off">Off</option>
            <option value="mist">Mist</option>
            <option value="flood">Flood</option>
          </select>
        </label>
        <DraftNumber label="Cutting feed" value={feedXy} onChange={onFeedXy} unit={fu} />
        <DraftNumber label="Plunge feed" value={feedZ} onChange={onFeedZ} unit={fu} />
      </div>
    </DialogSection>
  );
}
