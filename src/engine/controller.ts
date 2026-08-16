/**
 * Sketch session controller: high-level flows that bind the engine to app
 * state (Create Sketch → pick plane → sketch mode → Finish Sketch, undo /
 * redo, delete, grid-snap toggle). Low-frequency engine calls live here;
 * high-frequency drawing calls (preview/add/move during pointer gestures)
 * are issued by the Viewport directly against `getEngine()`.
 */
import { getEngine } from './index';
import type {
  BodyFeatureRequestDto,
  DatumPlaneRequest,
  DimensionStyle,
  ExtrudeRequest,
  FaceSketchOrigin,
  LoftRequest,
  OriginPlane,
  PlaneRef,
  RevolveRequest,
  RibRequest,
  SolidFilletRequest,
  SolidChamferRequest,
  HoleRequest,
  SweepRequest,
} from './types';
import {
  exportProjectModelWithVisibility,
  useAppStore,
  type BodyFeatureKind,
  type ConstructionPlaneKind,
} from '../store/appStore';
import {
  authorizeNextSolidRedo,
  beginHistoryMutation,
  canRedoAssemblyHistory,
  canRedoDrawingHistory,
  canUndoAssemblyHistory,
  canUndoDrawingHistory,
  commitAssemblyRedoHistory,
  commitAssemblyUndoHistory,
  currentHistoryProjectKey,
  hasValidSolidRedo,
  peekAssemblyRedoHistory,
  peekAssemblyUndoHistory,
  pushSolidRedoSnapshot,
  returnSolidRedoSnapshot,
  takeSolidRedoSnapshot,
} from './applicationHistory';
import {
  redoDrawingDocument,
  undoDrawingDocument,
} from '../drawing/document';

export function canUndoApplicationHistory(): boolean {
  const state = useAppStore.getState();
  if (state.projectBusy || state.solidBusy) return false;
  if (state.mode === 'sketch') return state.activeSketch?.can_undo ?? false;
  if (state.activeTab === 'drawing') return canUndoDrawingHistory();
  if (state.activeTab !== 'solid') return false;
  return state.mode === 'solid' && (
    canUndoAssemblyHistory() || (state.document?.rollback_index ?? 0) > 0
  );
}

export function canRedoApplicationHistory(): boolean {
  const state = useAppStore.getState();
  if (state.projectBusy || state.solidBusy) return false;
  if (state.mode === 'sketch') return state.activeSketch?.can_redo ?? false;
  if (state.activeTab === 'drawing') return canRedoDrawingHistory();
  if (state.activeTab !== 'solid') return false;
  if (state.mode !== 'solid' || !state.document) return false;
  return (
    canRedoAssemblyHistory() ||
    state.document.rollback_index < state.document.features.length ||
    hasValidSolidRedo()
  );
}

export { subscribeApplicationHistory } from './applicationHistory';

/** Arm Create Sketch: origin planes become pickable (Esc cancels). */
export function startPlanePick(): void {
  const state = useAppStore.getState();
  state.closeExtrudeDialog();
  state.closeRevolveDialog();
  state.closeSweepDialog();
  state.closeLoftDialog();
  state.closeRibDialog();
  state.closeFilletDialog();
  state.closeChamferDialog();
  state.closeHoleDialog();
  state.closeConstructionPlaneDialog();
  state.closeBodyFeatureDialog();
  state.setHoveredDatumPlane(null);
  state.setMode('pickPlane');
  if (state.selectedFace !== null) {
    const planar = state.solidScene.bodies
      .flatMap((body) => body.faces)
      .find((face) => face.id === state.selectedFace)?.plane;
    if (planar) {
      state.openSketchPlaneOrigin(state.selectedFace);
      return;
    }
  }
}

export function cancelPlanePick(): void {
  const s = useAppStore.getState();
  s.setHoveredPlane(null);
  s.setHoveredDatumPlane(null);
  s.setHoveredFace(null);
  s.closeSketchPlaneOrigin();
  s.setMode('solid');
}

/** Pick a plane (viewport quad or browser row) → begin the sketch session. */
export async function pickPlane(plane: OriginPlane): Promise<void> {
  return beginSketchOn({ type: 'origin_plane', plane });
}

export async function pickDatumPlane(datumId: number): Promise<void> {
  return beginSketchOn({ type: 'datum_plane', datum_id: datumId });
}

/** Select a planar body face while Create Sketch is armed. */
export function pickPlanarFace(faceId: number, point?: { x: number; y: number; z: number }): void {
  const state = useAppStore.getState();
  const face = state.solidScene.bodies
    .flatMap((body) => body.faces)
    .find((candidate) => candidate.id === faceId);
  if (!face?.plane) return;
  const body = state.solidScene.bodies.find((candidate) =>
    candidate.faces.some((candidateFace) => candidateFace.id === faceId),
  );
  state.setSelectedBody(body?.id ?? null);
  state.setSelectedFace(faceId);
  state.setSelectedFacePoint(point ?? null);
  state.openSketchPlaneOrigin(faceId);
}

/** Confirm the coordinate-zero placement for a face-hosted sketch. */
export async function confirmPlanarFaceSketch(origin: FaceSketchOrigin): Promise<void> {
  const state = useAppStore.getState();
  const faceId = state.sketchPlaneFace;
  if (faceId === null) return;
  state.closeSketchPlaneOrigin();
  try {
    await beginSketchOn({ type: 'planar_face', face_id: faceId }, origin);
  } catch (error) {
    state.setMode('solid');
    state.setConstraintDialog({
      titleKey: 'constraints.invalidTitle',
      message: error instanceof Error ? error.message : 'Could not create sketch on this face',
    });
  }
}

async function beginSketchOn(
  plane: PlaneRef,
  faceOrigin: FaceSketchOrigin = 'face_center',
): Promise<void> {
  const engine = await getEngine();
  const sketch = await engine.beginSketch(plane, faceOrigin);
  const s = useAppStore.getState();
  s.setHoveredPlane(null);
  s.setHoveredDatumPlane(null);
  s.setHoveredFace(null);
  s.closeSketchPlaneOrigin();
  s.setActiveSketch(sketch);
  s.setActiveTool(null);
  s.setSelectedEntity(null);
  s.setMode('sketch');
  // Refresh the document so the browser shows the new sketch node.
  s.setDocument(await engine.getDocument());
  // Expand the Sketches folder so the active sketch is visible.
  const folder = useAppStore
    .getState()
    .document?.browser.find((n) => n.kind === 'sketches_folder');
  if (folder && !useAppStore.getState().expanded[folder.id]) {
    s.toggleExpanded(folder.id);
  }
}

/** FINISH SKETCH → end the engine session and return to solid mode. */
export async function finishSketch(): Promise<void> {
  const engine = await getEngine();
  const result = await engine.endSketch();
  const s = useAppStore.getState();
  s.setActiveTool(null);
  s.setSelectedEntity(null);
  s.setHoveredEntity(null);
  s.setActiveSketch(null);
  s.setDocument(result.document);
  s.setFinishedSketches(await engine.finishedSketches());
  s.setMode('solid');
  try {
    s.applySolidUpdate(await engine.recomputeSolids());
  } catch (error) {
    s.setConstraintDialog({
      titleKey: 'constraints.invalidTitle',
      message: error instanceof Error ? error.message : 'Solid recompute failed',
    });
  }
}

/** Re-enter a finished sketch (browser double-click / pencil, M1d). The
 * engine moves the retained session back to active with entities,
 * constraints, dimensions, and undo intact. */
export async function editSketch(name: string): Promise<void> {
  const engine = await getEngine();
  const sketch = await engine.editSketch(name);
  const s = useAppStore.getState();
  s.setActiveTool(null);
  s.setSelectedEntity(null);
  s.setHoveredEntity(null);
  s.setActiveSketch(sketch);
  s.setFinishedSketches(await engine.finishedSketches());
  s.setMode('sketch');
}

export async function undoSketch(): Promise<void> {
  const engine = await getEngine();
  try {
    const result = await engine.undo();
    useAppStore.getState().setActiveSketch(result.sketch);
  } catch {
    // Nothing to undo — the UI already reflects can_undo.
  }
}

export async function redoSketch(): Promise<void> {
  const engine = await getEngine();
  try {
    const result = await engine.redo();
    useAppStore.getState().setActiveSketch(result.sketch);
  } catch {
    // Nothing to redo.
  }
}

/** Application-level Undo shared by the keyboard and native Edit menu.
 * Sketch, Drawing, and Solid each own their command boundary. At the latest
 * solid marker the feature is removed from authoritative history, while
 * Drawing restores a complete DrawingDocument command snapshot. */
export async function undoApplicationHistory(): Promise<void> {
  const state = useAppStore.getState();
  if (state.projectBusy || state.solidBusy) return;
  if (state.mode === 'sketch') {
    if (state.activeSketch?.can_undo) await undoSketch();
    return;
  }
  if (state.activeTab === 'drawing') {
    await undoDrawingDocument();
    return;
  }
  if (state.activeTab !== 'solid') return;
  if (state.mode !== 'solid' || !state.document) return;
  const projectKey = currentHistoryProjectKey();
  const assemblyEntry = peekAssemblyUndoHistory(projectKey);
  if (assemblyEntry) {
    await restoreAssemblyHistoryDocument(
      projectKey,
      assemblyEntry.before,
      () => commitAssemblyUndoHistory(projectKey, assemblyEntry),
    );
    return;
  }
  const current = state.document.rollback_index;
  if (current === 0) return;
  if (current === state.document.features.length) {
    const engine = await getEngine();
    // Prune a stale branch before adding another consecutive Undo entry.
    hasValidSolidRedo(projectKey);
    const modelJson = await exportProjectModelWithVisibility(engine);
    const finishHistoryMutation = beginHistoryMutation();
    try {
      const deleted = await deleteTimelineFeature(
        state.document.features[current - 1].id,
      );
      if (!deleted) return;
      // applySolidUpdate publishes synchronously, while the history observer
      // advances its generation in a microtask. Keep the transaction guarded
      // until that generation exists, then bind Redo to the resulting model.
      await new Promise<void>((resolve) => queueMicrotask(resolve));
      pushSolidRedoSnapshot(projectKey, modelJson);
    } finally {
      finishHistoryMutation();
    }
  } else {
    await setTimelineRollback(current - 1);
  }
}

/** Application-level Redo shared by the keyboard and native Edit menu. */
export async function redoApplicationHistory(): Promise<void> {
  const state = useAppStore.getState();
  if (state.projectBusy || state.solidBusy) return;
  if (state.mode === 'sketch') {
    if (state.activeSketch?.can_redo) await redoSketch();
    return;
  }
  if (state.activeTab === 'drawing') {
    await redoDrawingDocument();
    return;
  }
  if (state.activeTab !== 'solid') return;
  if (state.mode !== 'solid' || !state.document) return;
  const projectKey = currentHistoryProjectKey();
  const assemblyEntry = peekAssemblyRedoHistory(projectKey);
  if (assemblyEntry) {
    await restoreAssemblyHistoryDocument(
      projectKey,
      assemblyEntry.after,
      () => commitAssemblyRedoHistory(projectKey, assemblyEntry),
    );
    return;
  }
  const current = state.document.rollback_index;
  if (current < state.document.features.length) {
    await setTimelineRollback(current + 1);
    return;
  }

  const entry = takeSolidRedoSnapshot(projectKey);
  if (!entry) return;
  const finishHistoryMutation = beginHistoryMutation();
  state.setSolidBusy(true);
  try {
    const engine = await getEngine();
    const update = await engine.loadProjectModel(entry.modelJson);
    const [finishedSketches, datumPlanes, bodyAppearances] = await Promise.all([
      engine.finishedSketches(),
      engine.datumPlaneDefinitions(),
      engine.bodyAppearances(),
    ]);
    state.applySolidUpdate(update);
    state.setFinishedSketches(finishedSketches);
    state.applyDatumPlaneUpdate({
      document: update.document,
      planes: datumPlanes,
    });
    state.setBodyAppearances(bodyAppearances);
    // Let the store observer advance this tab's model generation while the
    // history transaction is still protected, then authorize the next older
    // Redo entry against the newly restored model.
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    authorizeNextSolidRedo(projectKey);
  } catch (error) {
    // The project load is transactional. If replay fails, retain the Redo
    // entry and leave the current model untouched.
    returnSolidRedoSnapshot(projectKey, entry);
    state.setConstraintDialog({
      titleKey: 'constraints.invalidTitle',
      message: error instanceof Error ? error.message : 'Redo failed',
    });
  } finally {
    state.setSolidBusy(false);
    finishHistoryMutation();
  }
}

async function restoreAssemblyHistoryDocument(
  projectKey: string,
  document: import('./types').AssemblyDocumentDto,
  commit: () => boolean,
): Promise<void> {
  const finishHistoryMutation = beginHistoryMutation();
  const state = useAppStore.getState();
  state.setSolidBusy(true);
  try {
    const engine = await getEngine();
    const assemblyDocument = await engine.setAssemblyDocument(structuredClone(document));
    const assemblySolution = await engine.assemblySolution();
    const occurrenceIds = new Set(
      assemblyDocument.component_structure.occurrences.map((occurrence) => occurrence.id),
    );
    const jointIds = new Set(assemblyDocument.joints.map((joint) => joint.id));
    useAppStore.setState((current) => ({
      assemblyDocument,
      assemblySolution,
      selectedOccurrenceId: current.selectedOccurrenceId !== null
        && occurrenceIds.has(current.selectedOccurrenceId)
        ? current.selectedOccurrenceId
        : null,
      hoveredOccurrenceId: null,
      selectedJointId: current.selectedJointId !== null
        && jointIds.has(current.selectedJointId)
        ? current.selectedJointId
        : null,
      jointEditingId: null,
      jointDialogOpen: false,
      jointConnectorPicks: [],
      jointConnectorHover: null,
      jointPreviewSolution: null,
      jointMotionPreview: null,
      mechanismPreview: null,
      motionStudyPreview: null,
      dirty: true,
    }));
    commit();
  } catch (error) {
    state.setConstraintDialog({
      titleKey: 'constraints.invalidTitle',
      message: error instanceof Error ? error.message : 'Assembly history replay failed',
    });
  } finally {
    state.setSolidBusy(false);
    finishHistoryMutation();
  }
}

export async function deleteEntity(id: number): Promise<void> {
  return deleteEntities([id]);
}

/** Batch delete (multi-select) as one undoable engine command. */
export async function deleteEntities(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const engine = await getEngine();
  try {
    const result = await engine.deleteEntities(ids);
    useAppStore.getState().setActiveSketch(result.sketch);
  } catch {
    // Entities already gone.
  }
}

/** Delete a dimension (constraint + orphaned parameter, undoable). */
export async function deleteDimension(constraintId: number): Promise<void> {
  const engine = await getEngine();
  try {
    const result = await engine.deleteDimension(constraintId);
    useAppStore.getState().setActiveSketch(result.sketch);
  } catch {
    // Dimension already gone.
  }
}

/** ISO 129 ↔ aligned dimension style toggle (document setting, D4.5). */
export async function setDimensionStyle(style: DimensionStyle): Promise<void> {
  const engine = await getEngine();
  try {
    const sketch = await engine.setDimensionStyle(style);
    useAppStore.getState().setActiveSketch(sketch);
  } catch {
    // No active sketch — the document setting still applied engine-side.
  }
}

/** Sketch Palette "Snap" toggle → engine grid-snap preference. */
export async function setGridSnap(enabled: boolean): Promise<void> {
  const engine = await getEngine();
  try {
    const sketch = await engine.setGridSnap(enabled);
    useAppStore.getState().setActiveSketch(sketch);
  } catch {
    // No active sketch — preference is still stored engine-side.
  }
}

export function openExtrude(featureId?: number): void {
  useAppStore.getState().openExtrudeDialog(featureId);
}

export function openRevolve(featureId?: number): void {
  useAppStore.getState().openRevolveDialog(featureId);
}

export function openSweep(featureId?: number): void {
  useAppStore.getState().openSweepDialog(featureId);
}

export function openLoft(featureId?: number): void {
  useAppStore.getState().openLoftDialog(featureId);
}

export function openRib(featureId?: number): void {
  useAppStore.getState().openRibDialog(featureId);
}

export function openSolidFillet(featureId?: number): void {
  useAppStore.getState().openFilletDialog(featureId);
}

export function openSolidChamfer(featureId?: number): void {
  useAppStore.getState().openChamferDialog(featureId);
}

export function openHole(featureId?: number): void {
  useAppStore.getState().openHoleDialog(featureId);
}

export function openConstructionPlane(
  kind: ConstructionPlaneKind,
  featureId?: number,
): void {
  useAppStore.getState().openConstructionPlaneDialog(kind, featureId);
}

export function openBodyFeature(kind: BodyFeatureKind, featureId?: number): void {
  useAppStore.getState().openBodyFeatureDialog(kind, featureId);
}

export async function submitConstructionPlane(
  request: DatumPlaneRequest,
  featureId?: number,
): Promise<void> {
  const state = useAppStore.getState();
  state.setSolidBusy(true);
  try {
    const engine = await getEngine();
    const update = featureId
      ? await engine.editDatumPlane(featureId, request)
      : await engine.createDatumPlane(request);
    state.applyDatumPlaneUpdate(update);
    // Editing a datum plane changes the world bases of every sketch hosted
    // by it. Recompute immediately so dependent solids do not remain drawn
    // at the old plane until the next unrelated modeling command.
    if (featureId) {
      const settled = await engine.recomputeSolids();
      state.applySolidUpdate(settled);
      state.applyDatumPlaneUpdate({
        document: settled.document,
        planes: await engine.datumPlaneDefinitions(),
      });
    }
    state.clearSolidSelection();
    state.closeConstructionPlaneDialog();
    const folder = update.document.browser.find(
      (node) => node.kind === 'construction_folder',
    );
    if (folder && !useAppStore.getState().expanded[folder.id]) {
      state.toggleExpanded(folder.id);
    }
  } catch (error) {
    state.setConstraintDialog({
      titleKey: 'constraints.invalidTitle',
      message:
        error instanceof Error ? error.message : 'Construction plane failed',
    });
  } finally {
    state.setSolidBusy(false);
  }
}

export async function submitBodyFeature(
  request: BodyFeatureRequestDto,
  featureId?: number,
): Promise<void> {
  const state = useAppStore.getState();
  state.setSolidBusy(true);
  try {
    const engine = await getEngine();
    const update = featureId
      ? await engine.editBodyFeature(featureId, request)
      : await engine.bodyFeature(request);
    state.applySolidUpdate(update);
    state.clearSolidSelection();
    state.closeBodyFeatureDialog();
    const bodies = update.document.browser.find(
      (node) => node.kind === 'bodies_folder',
    );
    if (bodies && !useAppStore.getState().expanded[bodies.id]) {
      state.toggleExpanded(bodies.id);
    }
  } catch (error) {
    state.setConstraintDialog({
      titleKey: 'constraints.invalidTitle',
      message: error instanceof Error ? error.message : 'Body operation failed',
    });
  } finally {
    state.setSolidBusy(false);
  }
}

/** Expand selected tessellated topology edges through smooth endpoint joins. */
export function tangentChainEdges(bodyId: number, edgeIds: number[]): number[] {
  const body = useAppStore.getState().solidScene.bodies.find((candidate) => candidate.id === bodyId);
  if (!body || edgeIds.length === 0) return edgeIds;
  const near = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
    Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) <= 1e-4;
  const endpointTangent = (edge: typeof body.edges[number], atStart: boolean) => {
    const points = edge.points;
    const a = atStart ? points[0] : points[points.length - 1];
    const b = atStart ? points[1] : points[points.length - 2];
    const length = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) || 1;
    return { x: (b.x - a.x) / length, y: (b.y - a.y) / length, z: (b.z - a.z) / length };
  };
  const requested = new Set(edgeIds);
  const queue = body.edges.filter((edge) => edge.refinable && requested.has(edge.id));
  const selected = new Set(queue.map((edge) => edge.id));
  while (queue.length > 0) {
    const edge = queue.shift()!;
    for (const candidate of body.edges) {
      if (
        !candidate.refinable
        || selected.has(candidate.id)
        || candidate.points.length < 2
        || edge.points.length < 2
      ) continue;
      const pairs = [
        [true, true],
        [true, false],
        [false, true],
        [false, false],
      ] as const;
      const tangent = pairs.some(([edgeStart, candidateStart]) => {
        const a = edgeStart ? edge.points[0] : edge.points[edge.points.length - 1];
        const b = candidateStart ? candidate.points[0] : candidate.points[candidate.points.length - 1];
        if (!near(a, b)) return false;
        const ta = endpointTangent(edge, edgeStart);
        const tb = endpointTangent(candidate, candidateStart);
        return Math.abs(ta.x * tb.x + ta.y * tb.y + ta.z * tb.z) >= Math.cos(Math.PI / 36);
      });
      if (tangent) {
        selected.add(candidate.id);
        queue.push(candidate);
      }
    }
  }
  return [...selected];
}

export async function submitExtrude(
  request: ExtrudeRequest,
  featureId?: number,
): Promise<void> {
  const state = useAppStore.getState();
  state.setSolidBusy(true);
  try {
    const engine = await getEngine();
    const update =
      featureId && featureId > 0
        ? await engine.editExtrude(featureId, request)
        : await engine.extrude(request);
    state.applySolidUpdate(update);
    state.clearSolidSelection();
    state.closeExtrudeDialog();
    const bodies = update.document.browser.find((node) => node.kind === 'bodies_folder');
    if (bodies && !useAppStore.getState().expanded[bodies.id]) {
      state.toggleExpanded(bodies.id);
    }
  } catch (error) {
    state.setConstraintDialog({
      titleKey: 'extrude.errorTitle',
      message: error instanceof Error ? error.message : 'Extrude failed',
    });
  } finally {
    state.setSolidBusy(false);
  }
}

export async function submitRevolve(
  request: RevolveRequest,
  featureId?: number,
): Promise<void> {
  const state = useAppStore.getState();
  state.setSolidBusy(true);
  try {
    const engine = await getEngine();
    const update =
      featureId && featureId > 0
        ? await engine.editRevolve(featureId, request)
        : await engine.revolve(request);
    state.applySolidUpdate(update);
    state.clearSolidSelection();
    state.closeRevolveDialog();
    const bodies = update.document.browser.find((node) => node.kind === 'bodies_folder');
    if (bodies && !useAppStore.getState().expanded[bodies.id]) {
      state.toggleExpanded(bodies.id);
    }
  } catch (error) {
    state.setConstraintDialog({
      titleKey: 'constraints.invalidTitle',
      message: error instanceof Error ? error.message : 'Revolve failed',
    });
  } finally {
    state.setSolidBusy(false);
  }
}

async function submitAdvancedSolid(
  request: SweepRequest | LoftRequest | RibRequest,
  featureId: number | undefined,
  kind: 'sweep' | 'loft' | 'rib',
): Promise<void> {
  const state = useAppStore.getState();
  state.setSolidBusy(true);
  try {
    const engine = await getEngine();
    let update;
    if (kind === 'sweep') {
      update = featureId
        ? await engine.editSweep(featureId, request as SweepRequest)
        : await engine.sweep(request as SweepRequest);
    } else if (kind === 'loft') {
      update = featureId
        ? await engine.editLoft(featureId, request as LoftRequest)
        : await engine.loft(request as LoftRequest);
    } else {
      update = featureId
        ? await engine.editRib(featureId, request as RibRequest)
        : await engine.rib(request as RibRequest);
    }
    state.applySolidUpdate(update);
    state.clearSolidSelection();
    if (kind === 'sweep') state.closeSweepDialog();
    else if (kind === 'loft') state.closeLoftDialog();
    else state.closeRibDialog();
    const bodies = update.document.browser.find((node) => node.kind === 'bodies_folder');
    if (bodies && !useAppStore.getState().expanded[bodies.id]) {
      state.toggleExpanded(bodies.id);
    }
  } catch (error) {
    state.setConstraintDialog({
      titleKey: 'constraints.invalidTitle',
      message: error instanceof Error ? error.message : `${kind} failed`,
    });
  } finally {
    state.setSolidBusy(false);
  }
}

export function submitSweep(request: SweepRequest, featureId?: number): Promise<void> {
  return submitAdvancedSolid(request, featureId, 'sweep');
}

export function submitLoft(request: LoftRequest, featureId?: number): Promise<void> {
  return submitAdvancedSolid(request, featureId, 'loft');
}

export function submitRib(request: RibRequest, featureId?: number): Promise<void> {
  return submitAdvancedSolid(request, featureId, 'rib');
}

export async function submitSolidFillet(
  request: SolidFilletRequest,
  featureId?: number,
): Promise<void> {
  return submitRefinement('fillet', request, featureId);
}

export async function submitSolidChamfer(
  request: SolidChamferRequest,
  featureId?: number,
): Promise<void> {
  return submitRefinement('chamfer', request, featureId);
}

export async function submitHole(request: HoleRequest, featureId?: number): Promise<void> {
  return submitRefinement('hole', request, featureId);
}

async function submitRefinement(
  kind: 'fillet' | 'chamfer' | 'hole',
  request: SolidFilletRequest | SolidChamferRequest | HoleRequest,
  featureId?: number,
): Promise<void> {
  const state = useAppStore.getState();
  state.setSolidBusy(true);
  try {
    const engine = await getEngine();
    const update = kind === 'fillet'
      ? featureId
        ? await engine.editSolidFillet(featureId, request as SolidFilletRequest)
        : await engine.solidFillet(request as SolidFilletRequest)
      : kind === 'chamfer'
        ? featureId
          ? await engine.editSolidChamfer(featureId, request as SolidChamferRequest)
          : await engine.solidChamfer(request as SolidChamferRequest)
        : featureId
          ? await engine.editHole(featureId, request as HoleRequest)
          : await engine.hole(request as HoleRequest);
    state.applySolidUpdate(update);
    state.clearSolidSelection();
    if (kind === 'fillet') state.closeFilletDialog();
    else if (kind === 'chamfer') state.closeChamferDialog();
    else state.closeHoleDialog();
  } catch (error) {
    state.setConstraintDialog({
      titleKey: 'constraints.invalidTitle',
      message: error instanceof Error ? error.message : `${kind} failed`,
    });
  } finally {
    state.setSolidBusy(false);
  }
}

export async function setTimelineRollback(rollbackIndex: number): Promise<void> {
  const state = useAppStore.getState();
  state.setSolidBusy(true);
  try {
    const engine = await getEngine();
    state.applySolidUpdate(await engine.setRollback(rollbackIndex));
  } catch (error) {
    state.setConstraintDialog({
      titleKey: 'constraints.invalidTitle',
      message: error instanceof Error ? error.message : 'Recompute failed',
    });
  } finally {
    state.setSolidBusy(false);
  }
}

export async function deleteTimelineFeature(featureId: number): Promise<boolean> {
  const state = useAppStore.getState();
  state.setSolidBusy(true);
  try {
    const engine = await getEngine();
    const update = await engine.deleteFeature(featureId);
    const [finishedSketches, datumPlanes] = await Promise.all([
      engine.finishedSketches(),
      engine.datumPlaneDefinitions(),
    ]);
    state.applySolidUpdate(update);
    state.setFinishedSketches(finishedSketches);
    state.applyDatumPlaneUpdate({
      document: update.document,
      planes: datumPlanes,
    });
    return true;
  } catch (error) {
    state.setConstraintDialog({
      titleKey: 'timeline.deleteFailed',
      message: error instanceof Error ? error.message : 'Feature deletion failed',
    });
    return false;
  } finally {
    state.setSolidBusy(false);
  }
}

export async function reorderTimelineFeature(
  featureId: number,
  targetIndex: number,
): Promise<boolean> {
  const state = useAppStore.getState();
  state.setSolidBusy(true);
  try {
    const engine = await getEngine();
    const update = await engine.reorderFeature(featureId, targetIndex);
    const [finishedSketches, datumPlanes] = await Promise.all([
      engine.finishedSketches(),
      engine.datumPlaneDefinitions(),
    ]);
    state.applySolidUpdate(update);
    state.setFinishedSketches(finishedSketches);
    state.applyDatumPlaneUpdate({
      document: update.document,
      planes: datumPlanes,
    });
    return true;
  } catch (error) {
    state.setConstraintDialog({
      titleKey: 'timeline.reorderFailed',
      message: error instanceof Error ? error.message : 'Feature reorder failed',
    });
    return false;
  } finally {
    state.setSolidBusy(false);
  }
}
