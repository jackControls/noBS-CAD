import { useEffect, useMemo } from 'react';
import { camToolCompatible } from '../../cam/document';
import { displayLength } from '../../cam/units';
import type {
  CamCoolantMode,
  CamDrillCycle,
  CamOperationDto,
  CamToolDto,
  CamUnits,
} from '../../engine/types';
import { useAppStore } from '../../store/appStore';
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
  /** Render the dialog body as Tool / Geometry / Heights / Passes / Linking
   *  tabs instead of one flat scroll. */
  tabs?: boolean;
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
    tabs: true,
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

/** Adopt the result of a library picker round trip: the picker dialog
 *  confirms a tool id into `camToolPick`; the waiting operation dialog
 *  consumes it here and clears it back. */
export function useCamToolPickResult(
  compatible: (tool: CamToolDto) => boolean,
  onChoose: (tool: CamToolDto) => void,
) {
  const pick = useAppStore((state) => state.camToolPick);
  useEffect(() => {
    if (pick === null) return;
    const tool = useAppStore.getState().camDocument.tools.find(
      (candidate) => candidate.id === pick,
    );
    useAppStore.getState().setCamToolPick(null);
    if (tool && compatible(tool)) onChoose(tool);
  }, [pick, compatible, onChoose]);
}

/** Stack the Tool Library dialog on top as a picker for this operation. */
export function openCamToolPicker(kind: OperationKind, drillCycle?: CamDrillCycle) {
  useAppStore.getState().pushCamDialog({
    type: 'tool',
    toolId: null,
    pickFor: { kind, cycle: drillCycle },
  });
}

/** The one tool picker every operation programs through. Project tools with
 *  a compatible kind show in a dropdown; anything else goes through the Tool
 *  Library dialog stacked on top as a picker (filtered to compatible tools,
 *  double-click or confirm to choose — central picks are copied into the
 *  project automatically), so a large central collection never floods this
 *  dialog. The cutting-profile select rides along when the chosen tool
 *  carries named profiles. */
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

  const compatible = useMemo(
    () => (tool: CamToolDto) => camToolCompatible(kind, tool, drillCycle),
    [kind, drillCycle],
  );
  const projectTools = useMemo(() => cam.tools.filter(compatible), [cam.tools, compatible]);
  const selected = cam.tools.find((candidate) => candidate.id === toolId) ?? null;

  // Result of a library picker round trip: adopt the confirmed tool.
  useCamToolPickResult(compatible, onChoose);

  const label = (tool: CamToolDto) =>
    `${tool.number != null ? `T${tool.number} · ` : ''}${tool.name} · Ø${displayLength(tool.diameter, units).toFixed(3)} ${lu}`;

  const openLibraryPicker = () => openCamToolPicker(kind, drillCycle);

  return (
    <DialogSection title="TOOL">
      {projectTools.length > 0 ? (
        <div className="flex items-center gap-1.5">
          <select
            value={toolId ?? ''}
            onChange={(event) => {
              const tool = projectTools.find(
                (candidate) => candidate.id === Number(event.target.value),
              );
              if (tool) onChoose(tool);
            }}
            className={`${CAM_DIALOG_INPUT} min-w-0 flex-1`}
          >
            {projectTools.map((tool) => (
              <option key={tool.id} value={tool.id}>
                {label(tool)}
              </option>
            ))}
          </select>
          <button
            type="button"
            title="Pick from the full library (central tools are copied into this project)"
            onClick={openLibraryPicker}
            className="h-7 shrink-0 rounded border border-edge px-2 text-[10px] font-semibold text-mute hover:border-accent/40 hover:text-accent"
          >
            Library…
          </button>
        </div>
      ) : (
        <div className="rounded border border-edge bg-header/40 p-2">
          <p className="mb-1.5 text-[10px] leading-relaxed text-mute">
            No compatible tool in this project yet.
          </p>
          <button
            type="button"
            onClick={openLibraryPicker}
            className="flex h-7 w-full items-center justify-center rounded border border-accent/50 bg-accent/15 text-[10px] font-semibold text-accent hover:bg-accent/25"
          >
            Select from the library…
          </button>
        </div>
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
