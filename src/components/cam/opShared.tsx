import { useEffect } from 'react';
import type { CamDrillCycle, CamOperationDto, CamToolDto } from '../../engine/types';
import { useAppStore } from '../../store/appStore';

type OperationKind = CamOperationDto['kind'];

/**
 * Shared configuration of the operation dialog. Every operation kind renders
 * through the same five-tab scaffold (Tool / Geometry / Heights / Passes /
 * Linking); each kind only declares which geometry shape, heights, and pass
 * fields it needs in `OP_PAGES` below. Editing a shared tab once applies to
 * every operation kind.
 */

/** Pages and fields an operation kind switches on in the shared dialog. */
export interface OpPages {
  /** Geometry tab shape: hole picking, a face area, or a closed path. */
  geometry: 'holes' | 'face' | 'path';
  /** Section label for the path geometry tab. */
  pathLabel?: string;
  /** Path geometry is picked edge by edge (viewport chain picking); open
   *  chains are accepted and compensation reads left/right of travel. */
  pathChain?: boolean;
  /** Thread-milling parameters (designation on Geometry, passes on Passes). */
  threadFields?: boolean;
  /** Bottom height on the Heights tab. */
  bottomZ?: boolean;
  /** The bottom height targets the model top by default (facing). */
  faceTarget?: boolean;
  /** Facing plunge clearance from the stock boundary (Linking tab). */
  safeDistance?: boolean;
  /** Live straight lead-in/out lengths on the Linking tab (contour): in
   *  control compensation activates on the lead-in, so the leads must
   *  exceed the tool radius. */
  leads?: boolean;
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
    pathChain: true,
    bottomZ: true,
    stepDown: true,
    compensation: true,
    leads: true,
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
