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
  }
}
