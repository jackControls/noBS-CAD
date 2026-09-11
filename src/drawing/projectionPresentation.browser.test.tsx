import {createRoot} from 'react-dom/client';
import {useLayoutEffect} from 'react';
import {DrawingWorkspace} from '../components/drawing/DrawingWorkspace';
import {useAppStore} from '../store/appStore';
import {presentation} from '../operationPlayback';
import {projectTransitions} from '../files/projectTransitions';
import {applyInboxNow, publishCurrentSession} from '../sessionBridge';
import {applyLiveUiControl} from '../liveUiBridge';
import {pendingEngineOperations} from '../engine/activity';
import {defaultDrawingSheetStyle} from './sheet';
import {drawingProjectionRequestForView} from './projection';
import type {DrawingDocumentDto, DrawingProjectionDto, DrawingViewDto} from '../engine/types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return {promise, resolve};
}

/** Actual mounted drawing workspace, inbox hydration, publisher and native
 * control handoff. Only the native IPC boundary is replaced. */
export async function checkDrawingProjectionPublication() {
  const check = (value: unknown, message: string) => { if (!value) throw new Error(message); };
  const until = async (condition: () => boolean, message: string) => {
    const deadline = Date.now() + 2500;
    while (!condition()) {
      if (Date.now() >= deadline) throw new Error(message);
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  };
  const frames = async () => { for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame); };
  const initial = useAppStore.getState();
  const nativeWindow = window as typeof window & {__TAURI_INTERNALS__?: {invoke(command: string, args?: Record<string, unknown>): Promise<unknown>}};
  const previousNative = nativeWindow.__TAURI_INTERNALS__;
  const doc = {name: 'Drawing A', settings: {units: 'mm' as const}, features: [], browser: [], rollback_index: 0};
  const scene = {bodies: [], errors: []};
  let documentId = 'drawing-A', sessionId = 'session-A', revision = 10;
  let drawing: DrawingDocumentDto = {...initial.drawingDocument, active_sheet_id: 1, next_sheet_id: 2, sheets: [{
    id: 1, name: 'Assembly', format: 'a4', orientation: 'landscape', standard: 'iso', projection_method: 'third_angle',
    tolerance_note: {preset: 'custom', custom: ''}, template_name: '', style: defaultDrawingSheetStyle(),
    title_block: {title: 'Assembly', drawing_number: '', revision: '', author: '', checked_by: '', approved_by: '', company: '', material: '', finish: ''},
    views: [], annotations: [], bom: [], revisions: [], release: {status: 'draft', released_at: '', released_revision: ''},
    bom_table_position: null, revision_table_position: null,
  }]};
  const view = (id: number): DrawingViewDto => ({id, name: `View ${id}`, kind: 'custom', alignment: 'free', parent_view_id: null,
    direction: [0, 0, 1], up: [0, 1, 0], position: [50 * id, 60], scale: 1, body_ids: [id], scope: 'definition', occurrence_ids: [],
    show_hidden_lines: false, show_tangent_edges: false, derivation: null});
  const projection = (n: number): DrawingProjectionDto => ({visible: [{points: [[n, 0], [n + 10, 10]]}], hidden: [], anchors: [], circles: [], section: [], bounds: [0, 0, 20, 20]});
  const request = (id: number) => drawingProjectionRequestForView(view(id), drawing.sheets[0].views, scene);
  const completed = (id: number, n: number, extra = {}) => ({session_id: sessionId, document_id: documentId, engine_revision: revision,
    drawing_projection: {request: request(id), projection: projection(n)}, ...extra});
  const ok = (value: unknown) => JSON.stringify({ok: true, value});
  const calls: string[] = [];
  let control: unknown = null, exportGate: ReturnType<typeof deferred<void>> | null = null;
  let projectionGate: ReturnType<typeof deferred<void>> | null = null;
  let publications = 0, automatic = 0, exportEntered = false;
  const running = new Set<Promise<unknown>>();
  const releaseControls = new Set<() => void>();
  const track = <T,>(promise: Promise<T>) => { running.add(promise); void promise.then(() => running.delete(promise), () => running.delete(promise)); return promise; };
  nativeWindow.__TAURI_INTERNALS__ = {async invoke(command, args = {}) {
    calls.push(command);
    if (command === 'mcp_session_bridge_reserve') return {session_id: sessionId, project_session_id: documentId, generation: revision, engine_revision: revision};
    if (command === 'mcp_session_bridge_write') { publications++; return {skipped: false}; }
    if (command === 'mcp_session_bridge_apply_inbox') {
      check(args.sessionId === sessionId && args.documentId === documentId, 'Inbox keeps its published owner');
      revision++;
      return {applied: true, name: 'drawing_add_view', result: drawing};
    }
    if (command === 'engine_drawing_document') return ok(drawing);
    if (command === 'engine_project_visibility') return ok(useAppStore.getState().projectVisibility);
    if (command === 'engine_active_sketch') return ok(null);
    if (command === 'engine_project_export_model') { exportEntered = true; await exportGate?.promise; return ok(JSON.stringify({document: doc, drawing})); }
    if (command === 'engine_drawing_projection') { automatic++; await projectionGate?.promise; return ok(projection(91)); }
    if (command === 'mcp_session_bridge_control') { check(!args.response, 'Completed native query must not receive a second acknowledgment'); const reply = control; control = null; return reply; }
    throw new Error(`Unexpected drawing publication IPC: ${command}`);
  }};
  const container = document.createElement('div'); container.style.cssText = 'width:1000px;height:700px'; document.body.append(container);
  const root = createRoot(container);
  let mounted = true;
  const hasLine = (n: number) => !!container.querySelector(`polyline[points="${n},0 ${n + 10},10"]`);
  let firstReplacementHadOldPixels: boolean | null = null;
  function MountedDrawing() {
    const name = useAppStore(state => state.document?.name);
    // Observe the actual committed DOM before passive effect cleanup. Merely
    // waiting a few frames would miss old pixels in B's first render.
    useLayoutEffect(() => {
      if (name === 'B' && firstReplacementHadOldPixels === null) firstReplacementHadOldPixels = hasLine(44) || hasLine(55);
    }, [name]);
    return <DrawingWorkspace />;
  }
  const handoff = async (reply: unknown) => { control = reply; await track(applyLiveUiControl(async () => { throw new Error('Projection must not mutate or republish'); })); };
  try {
    const setup = projectTransitions.begin();
    useAppStore.getState().loadProjectState({document: doc, scene}, [], [], 'A.nbcad', [], drawing);
    useAppStore.setState({engineKind: 'tauri', activeProjectTabId: documentId, activeTab: 'drawing', solidBusy: false, projectBusy: false});
    setup(true, true);
    check(await publishCurrentSession(), 'Initial exact publication');
    presentation.control({command: 'configure', mode: 'fast'});
    root.render(<MountedDrawing />);
    await until(() => !!container.querySelector('[data-testid="drawing-sheet"]'), 'Workspace did not mount');

    // Hold the real publication after hydration long enough for React effects.
    drawing = {...drawing, next_view_id: 2, sheets: [{...drawing.sheets[0], views: [view(1)]}]};
    exportGate = deferred(); exportEntered = false;
    const first = track(applyInboxNow());
    await until(() => exportEntered, 'Applied drawing did not start publication');
    await frames();
    check(automatic === 0, 'Automatic HLR started before the applied drawing snapshot was published');
    exportGate.resolve(); exportGate = null; await first;
    check(publications === 2 && useAppStore.getState().dirty, 'Drawing apply must finish its real dirty publication');
    await handoff(completed(1, 11)); await until(() => hasLine(11), 'Completed native projection did not paint during playback');

    // A second view must neither replace the first linework nor queue cold HLR
    // behind its next mutation. Pause retains the same script work ownership.
    drawing = {...drawing, next_view_id: 3, sheets: [{...drawing.sheets[0], views: [view(1), view(2)]}]};
    await track(applyInboxNow()); await frames();
    presentation.control({command: 'pause'}); await frames();
    check(publications === 3 && automatic === 0 && hasLine(11), 'Second view/pause launched competing HLR or lost completed linework');
    await handoff(completed(2, 22)); await until(() => hasLine(22), 'Second explicit projection was not rendered');
    await handoff(completed(2, 33, {session_id: 'forged-session'})); await frames();
    check(hasLine(22) && !hasLine(33), 'Wrong-session linework was accepted');
    await handoff(completed(2, 34, {engine_revision: revision - 1})); await frames();
    check(!hasLine(34), 'Wrong native generation linework was accepted');
    const wrongRequest = completed(2, 35);
    wrongRequest.drawing_projection.request.deflection = 0.04;
    await handoff(wrongRequest); await frames();
    check(hasLine(22) && !hasLine(35), 'Different requested projection accuracy reused another view result');

    // Same-document geometry/pose refresh invalidates retained linework.
    useAppStore.setState({solidScene: {...scene}, assemblySolution: {...initial.assemblySolution}});
    check(await publishCurrentSession(), 'Publish the changed scene and poses'); await frames();
    check(!hasLine(11) && !hasLine(22) && automatic === 0, 'Geometry/pose changes reused stale projection');
    await handoff(completed(1, 44)); await until(() => hasLine(44), 'Fresh changed-scene result was not displayed');

    // A delayed native poll cannot deliver A into a same-tab replacement B.
    const delayed = deferred<unknown>(); control = delayed.promise;
    releaseControls.add(() => delayed.resolve(null));
    const polling = track(applyLiveUiControl(async () => {})); await frames();
    const oldReply = completed(1, 55);
    const replace = projectTransitions.begin(); sessionId = 'session-B'; revision++;
    useAppStore.getState().loadProjectState({document: {...doc, name: 'B'}, scene: {...scene}}, [], [], 'B.nbcad', [], drawing);
    replace(true, true); presentation.control({command: 'configure', mode: 'fast'});
    check(await publishCurrentSession(), 'Publish replacement B');
    delayed.resolve(oldReply); await polling; await frames();
    check(!hasLine(55) && !hasLine(44), 'Delayed predecessor pixels reached replacement B');
    check(firstReplacementHadOldPixels === false, 'The first replacement frame retained predecessor pixels before effect cleanup');
    await handoff(completed(1, 66)); await until(() => hasLine(66), 'B did not receive its own completed linework');

    // The presentation cache retains at most twelve results, independent of
    // the model's number of drawing views. A remount must not resurrect one
    // evicted by later, completed exact queries.
    for (let id = 10; id < 23; id++) await handoff(completed(id, id));
    root.render(<MountedDrawing key="bounded-cache-remount" />); await frames();
    check(!hasLine(66) && automatic === 0, 'Evicted projection survived remount or launched HLR during playback');
    await handoff(completed(1, 66)); await until(() => hasLine(66), 'Fresh projection after bounded eviction did not paint');

    // Finishing allows remaining cold views through the ordinary native path.
    projectionGate = deferred(); presentation.control({command: 'finish'});
    await until(() => automatic === 1, 'Finish did not schedule remaining native view');
    check(hasLine(66), 'Existing completed linework vanished during cold projection');
    root.unmount(); mounted = false; projectionGate.resolve(); projectionGate = null;
    await until(() => !running.size, 'Drawing fixture retained work'); await frames();
    return {publishBeforeHlr: true, secondView: true, incrementalNativeLinework: true, pausedScript: true,
      nativeSessionRevision: true, exactRequest: true, boundedCache: true, geometryPoseInvalidation: true, replacedDocument: true, firstReplacementFrame: true, finishAndUnmount: true};
  } finally {
    if (mounted) root.unmount();
    exportGate?.resolve(); projectionGate?.resolve();
    for (const release of releaseControls) release();
    await Promise.allSettled(running);
    await until(() => pendingEngineOperations() === 0, 'Projection fixture did not drain native operations');
    container.remove();
    const restore = projectTransitions.begin(); useAppStore.setState(initial); presentation.documentChanged(); restore(true, true);
    if (previousNative) nativeWindow.__TAURI_INTERNALS__ = previousNative; else delete nativeWindow.__TAURI_INTERNALS__;
  }
}
