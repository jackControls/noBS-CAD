import type { CamDocumentDto, CamSetupDto, CamSimulationResultDto } from '../engine/types';
import { modeledStockBodyId } from './geometry';

export type CamWorkpieceView = 'model' | 'stock' | 'compare';

interface CamStageState {
  camSimulation: CamSimulationResultDto | null;
  camSimulationTimeline: CamSimulationResultDto | null;
  selectedCamOperationId: number | null;
}

export function simulationHasStockSurface(simulation: CamSimulationResultDto): boolean {
  return simulation.stock_mesh !== null || simulation.native_stock_present === true;
}

/** Selection/source freshness is shared by the native and overlay renderers. */
export function currentStageSimulation(state: CamStageState, setup: CamSetupDto): CamSimulationResultDto | null {
  const simulation = state.camSimulation;
  if (!simulation || !simulationHasStockSurface(simulation) || simulation.setup_id !== setup.id) return null;
  if (simulation.source === 'cam_toolpath' && simulation.through_operation_id !== state.selectedCamOperationId) return null;
  if (state.camSimulationTimeline && simulation.source !== state.camSimulationTimeline.source) return null;
  return simulation;
}

/** Presentation only: never touches CAM inputs, generations, or retained stock. */
export function camWorkpiecePresentation(state: CamStageState & {
  activeTab: string;
  camDocument: CamDocumentDto;
  camDialogOpen: boolean;
  camWorkpieceView?: CamWorkpieceView;
}) {
  const result = { stockVisible: false, hiddenBodyIds: [] as number[], ghostedBodyIds: [] as number[] };
  if (state.activeTab !== 'cam' || state.camDialogOpen) return result;
  const setup = state.camDocument.setups.find(candidate => candidate.id === state.camDocument.active_setup_id);
  if (!setup) return result;
  const mode = state.camWorkpieceView ?? 'stock';
  const stockBodyId = modeledStockBodyId(setup, state.camDocument);
  // In Model mode, raw stock must stay hidden even before a simulation exists.
  result.stockVisible = mode !== 'model' && currentStageSimulation(state, setup) !== null;
  if (mode === 'model' || result.stockVisible) {
    if (stockBodyId !== null) result.hiddenBodyIds.push(stockBodyId);
  }
  if (result.stockVisible) {
    const targets = setup.body_ids.filter(id => id !== stockBodyId);
    if (mode === 'compare') result.ghostedBodyIds = targets;
    else result.hiddenBodyIds.push(...targets);
  }
  return result;
}
