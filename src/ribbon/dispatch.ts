/**
 * Central dispatcher for ribbon actions (used by the ribbon buttons and the
 * dropdown menus). `enterSketch` arms the plane picker (Create Sketch
 * flow), `exitSketch` finishes the engine session, `sketchTool` activates
 * a drawing tool (payload = tool id), `applyConstraint` applies a
 * constraint to the current selection (payload = constraint icon id).
 */
import {
  finishSketch,
  openExtrude,
  openLoft,
  openRevolve,
  openRib,
  openSweep,
  openSolidFillet,
  openSolidChamfer,
  openHole,
  openBodyFeature,
  openConstructionPlane,
  toggleConstructionReferences,
  startPlanePick,
} from '../engine/controller';
import { applyConstraintById } from '../sketch/applyConstraint';
import {
  useAppStore,
  type BodyFeatureKind,
  type ConstructionPlaneKind,
  type SketchTool,
} from '../store/appStore';
import type { RibbonAction } from './config';
import {
  autoLayoutDrawingViews,
  beginDrawingSheetSetup,
  enterDrawingWorkspace,
  leaveDrawingWorkspace,
} from '../drawing/document';
import { exportActiveDrawingDxf, printActiveDrawing } from '../drawing/export';
import type { CamOperationDto, DrawingViewKind } from '../engine/types';
import {
  enterCamWorkspace,
  leaveCamWorkspace,
} from '../cam/document';
import { exportPostEvents } from '../cam/export';
import { requestCamSimulation } from '../cam/simulationUi';

function runDrawingAction(action: () => Promise<unknown>): void {
  void action().catch((error) => {
    useAppStore.getState().setConstraintDialog({
      titleKey: 'file.errorTitle',
      message: error instanceof Error ? error.message : String(error),
    });
  });
}

export function dispatchRibbonAction(action?: RibbonAction, payload?: string): void {
  if (!action) return;
  if (useAppStore.getState().document === null) return;
  switch (action) {
    case 'enterSketch':
      startPlanePick();
      break;
    case 'exitSketch':
      void finishSketch();
      break;
    case 'extrude':
      openExtrude();
      break;
    case 'revolve':
      openRevolve();
      break;
    case 'sweep':
      openSweep();
      break;
    case 'loft':
      openLoft();
      break;
    case 'rib':
      openRib();
      break;
    case 'solidFillet':
      openSolidFillet();
      break;
    case 'solidChamfer':
      openSolidChamfer();
      break;
    case 'hole':
      openHole();
      break;
    case 'constructionPlane':
      openConstructionPlane(payload as ConstructionPlaneKind);
      break;
    case 'constructionVisibility':
      runDrawingAction(toggleConstructionReferences);
      break;
    case 'bodyFeature':
      openBodyFeature(payload as BodyFeatureKind);
      break;
    case 'sketchPattern': {
      const state = useAppStore.getState();
      const hasSelection =
        state.selectedEntities.length > 0 || state.selectedEntity !== null;
      if (!hasSelection) {
        state.setConstraintDialog({
          titleKey: 'constraints.invalidTitle',
          message: 'Select the sketch entities to repeat before opening a pattern.',
        });
        return;
      }
      state.openSketchPatternDialog(
        payload === 'circular' ? 'circular' : 'rectangular',
      );
      break;
    }
    case 'selectTool':
      useAppStore.getState().setActiveTool(null);
      useAppStore.getState().setNavTool('select');
      break;
    case 'sketchTool': {
      // Payload may carry a mode suffix ("polygon:circumscribed").
      const [tool, mode] = (payload ?? 'line').split(':');
      if (tool === 'polygon') {
        useAppStore.getState().setPolygonMode(mode === 'inscribed' ? 'inscribed' : 'circumscribed');
      }
      if (tool === 'slot') {
        const m = mode === 'overall' ? 'overall' : mode === 'centerPoint' ? 'centerPoint' : 'centerToCenter';
        useAppStore.getState().setSlotMode(m);
      }
      // Mirror/Move/Scale require a selection before activation.
      if (['mirror', 'moveCopy', 'scale'].includes(tool)) {
        const s = useAppStore.getState();
        const hasSelection = s.selectedEntities.length > 0 || s.selectedEntity !== null;
        if (!hasSelection) {
          s.setConstraintDialog({
            titleKey: 'constraints.invalidTitle',
            message:
              tool === 'mirror'
                ? 'Mirror needs selected entities first (click or shift-click geometry, then the mirror line).'
                : tool === 'scale'
                  ? 'Sketch Scale needs selected entities first, then a base point.'
                  : 'Move/Copy needs selected entities first, then drag to place.',
          });
          return;
        }
      }
      useAppStore.getState().setActiveTool(tool as SketchTool);
      break;
    }
    case 'applyConstraint':
      void applyConstraintById(payload);
      break;
    case 'drawingWorkspace':
      useAppStore.getState().setJointDialogOpen(false);
      runDrawingAction(enterDrawingWorkspace);
      break;
    case 'assemblyWorkspace': {
      const state = useAppStore.getState();
      if (state.mode !== 'solid') return;
      state.setDrawingSheetSetupOpen(false);
      state.setDrawingTool(null);
      state.setDrawingPendingViewKind(null);
      state.setActiveTab('solid');
      state.setSolidSidebarMode('assembly');
      break;
    }
    case 'modelWorkspace': {
      const state = useAppStore.getState();
      state.setJointDialogOpen(false);
      state.setSolidSidebarMode('model');
      if (state.activeTab === 'cam') leaveCamWorkspace();
      else leaveDrawingWorkspace();
      break;
    }
    case 'joint':
      useAppStore.getState().setActiveTab('solid');
      useAppStore.getState().setSolidSidebarMode('assembly');
      useAppStore.getState().setJointDialogOpen(true);
      break;
    case 'drawingNewSheet':
      beginDrawingSheetSetup();
      break;
    case 'drawingAutoLayout':
      runDrawingAction(autoLayoutDrawingViews);
      break;
    case 'drawingAddView': {
      const state = useAppStore.getState();
      const kind = (payload ?? 'isometric') as DrawingViewKind;
      state.setDrawingPendingViewKind(kind);
      state.setDrawingTool('place_view');
      state.setSelectedDrawingAnnotationId(null);
      break;
    }
    case 'drawingTool': {
      const state = useAppStore.getState();
      const tool = (
        [
          'dimension', 'diameter', 'radius', 'hole_note', 'center_mark', 'center_line',
          'symmetry_axis', 'bolt_circle', 'chain_dimension', 'baseline_dimension',
          'continued_dimension', 'ordinate_dimension', 'arc_length', 'jogged_radius',
          'section_view', 'detail_view', 'auxiliary_view', 'broken_view', 'removed_section',
          'datum', 'gdt', 'surface_texture', 'edge_requirement', 'weld', 'balloon',
          'revision_cloud', 'angle', 'chamfer_note', 'note',
        ]
          .includes(payload ?? '') ? payload : 'dimension'
      ) as Exclude<typeof state.drawingTool, null>;
      state.setDrawingTool(state.drawingTool === tool ? null : tool);
      state.setDrawingPendingViewKind(null);
      state.setSelectedDrawingViewId(null);
      state.setSelectedDrawingAnnotationId(null);
      break;
    }
    case 'drawingExportDxf':
      runDrawingAction(exportActiveDrawingDxf);
      break;
    case 'drawingExportProfileDxf':
      useAppStore.getState().setDrawingProfileExportOpen(true);
      break;
    case 'drawingPrint':
      printActiveDrawing();
      break;
    case 'camWorkspace':
      runDrawingAction(enterCamWorkspace);
      break;
    case 'camNewSetup':
      useAppStore.getState().setCamDialog({ type: 'setup' });
      break;
    case 'camToolLibrary':
      useAppStore.getState().setCamDialog({ type: 'tool', toolId: null });
      break;
    case 'camAddOperation': {
      const kind: CamOperationDto['kind'] =
        payload === 'adaptive3d' || payload === 'contour2d' || payload === 'pocket2d' || payload === 'chamfer2d' || payload === 'drill' || payload === 'thread'
          ? payload
          : 'face';
      useAppStore.getState().setCamDialog({ type: 'operation', kind });
      break;
    }
    case 'camSimulate':
    case 'camSimulateNc': {
      const state = useAppStore.getState();
      const setupId = state.camDocument.active_setup_id;
      if (setupId == null) return;
      if (action === 'camSimulate' && !state.camDocument.setups.find((setup) => setup.id === setupId)?.operations.some((operation) => operation.enabled)) {
        state.setConstraintDialog({ titleKey: 'file.errorTitle', message: 'Add an enabled toolpath before starting CAM simulation. The setup view already shows its incoming stock.' });
        return;
      }
      requestCamSimulation(action === 'camSimulate' ? 'cam' : 'nc', setupId, state.selectedCamOperationId);
      break;
    }
    case 'camPost':
      useAppStore.getState().setCamDialog({ type: 'post' });
      break;
    case 'camExportEvents':
      runDrawingAction(exportPostEvents);
      break;
  }
}
