import {createRoot} from 'react-dom/client';
import '../index.css';
import {DrawingWorkspace} from '../components/drawing/DrawingWorkspace';
import {useAppStore} from '../store/appStore';
import {inspectUi, operateUi} from '../uiControl';
import {defaultDrawingSheetStyle} from './sheet';
import type {DrawingDocumentDto, DrawingSheetDto} from '../engine/types';

/** Real workspace and production CSS. Only the outer allotted pane is sized;
 * no test layout, sheet sizing, fit formula, or CAD geometry is substituted. */
export async function checkDrawingSheetFit() {
  const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
  const frames = async () => { for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame); };
  const until = async (condition: () => boolean, message: string) => {
    const deadline = Date.now() + 3000;
    while (!condition()) {
      if (Date.now() >= deadline) throw new Error(message);
      await new Promise(requestAnimationFrame);
    }
  };
  const initial = useAppStore.getState();
  const nativeWindow = window as typeof window & {__TAURI_INTERNALS__?: {invoke(command: string): Promise<unknown>}};
  const previousNative = nativeWindow.__TAURI_INTERNALS__;
  const nativeCalls: string[] = [];
  nativeWindow.__TAURI_INTERNALS__ = {invoke(command) {
    nativeCalls.push(command);
    return Promise.reject(new Error(`Paper navigation must not invoke native modeling: ${command}`));
  }};
  const sheets: DrawingSheetDto[] = (['a3', 'a0'] as const).flatMap((format, formatIndex) =>
    (['portrait', 'landscape'] as const).map((orientation, orientationIndex) => {
      const id = 1 + formatIndex * 2 + orientationIndex;
      return {
        id, name: `${format.toUpperCase()} ${orientation}`, format, orientation,
        standard: 'iso', projection_method: 'third_angle', tolerance_note: {preset: 'custom', custom: ''},
        template_name: '', style: defaultDrawingSheetStyle(),
        title_block: {title: 'Fit contract', drawing_number: '', revision: '', author: '', checked_by: '', approved_by: '', company: '', material: '', finish: ''},
        views: [], annotations: [{id, kind: 'note', text: 'Keep this annotation selected', position: [30, 40]}],
        bom: [], revisions: [], release: {status: 'draft', released_at: '', released_revision: ''},
        bom_table_position: null, revision_table_position: null,
      };
    }));
  const drawing: DrawingDocumentDto = {...initial.drawingDocument, sheets, active_sheet_id: 1, next_sheet_id: 5, next_annotation_id: 5};
  const container = document.createElement('div');
  container.style.width = '1080px'; container.style.height = '640px';
  document.body.append(container);
  const root = createRoot(container);
  const scroll = () => container.querySelector<HTMLDivElement>('[data-drawing-zoom]')!;
  const paper = () => container.querySelector<SVGSVGElement>('[data-testid="drawing-sheet"]')!;
  const zoom = () => Number(scroll().dataset.drawingZoom);
  const fitButton = () => container.querySelector<HTMLButtonElement>('button[title="Fit sheet"]')!;
  const fitMode = () => fitButton().getAttribute('aria-pressed') === 'true';
  const click = async (label: string) => {
    const context = useAppStore.getState().document;
    const controls = inspectUi(context).surfaces.flatMap(surface => surface.controls)
      .filter(control => control.label === label && control.surface === 'drawing/sheet');
    check(controls.length === 1, `${label} must appear once in drawing/sheet`);
    operateUi({action: 'click', target: controls[0].id}, context);
    await frames();
  };
  const snapshot = () => {
    const state = useAppStore.getState();
    return {drawing: state.drawingDocument, document: state.document, scene: state.solidScene,
      selectedView: state.selectedDrawingViewId, selectedAnnotation: state.selectedDrawingAnnotationId,
      dirty: state.dirty, content: JSON.stringify([state.drawingDocument, state.document, state.solidScene])};
  };
  const unchanged = (before: ReturnType<typeof snapshot>) => {
    const after = snapshot();
    check(before.drawing === after.drawing && before.document === after.document && before.scene === after.scene
      && before.content === after.content && before.dirty === after.dirty
      && before.selectedView === after.selectedView && before.selectedAnnotation === after.selectedAnnotation,
    'Paper navigation changed model, drawing data, dirty state or selection');
  };
  const measurements = () => {
    const pane = scroll();
    const paneRect = pane.getBoundingClientRect(), sheetRect = paper().getBoundingClientRect();
    const style = getComputedStyle(pane);
    const left = paneRect.left + pane.clientLeft + parseFloat(style.paddingLeft);
    const top = paneRect.top + pane.clientTop + parseFloat(style.paddingTop);
    const right = paneRect.left + pane.clientLeft + pane.clientWidth - parseFloat(style.paddingRight);
    const bottom = paneRect.top + pane.clientTop + pane.clientHeight - parseFloat(style.paddingBottom);
    const inspector = container.querySelector<HTMLElement>('[data-mcp-surface="drawing/inspector"]')!.getBoundingClientRect();
    return {left, top, right, bottom, x: sheetRect.left, y: sheetRect.top, width: sheetRect.width, height: sheetRect.height,
      paperRight: sheetRect.right, paperBottom: sheetRect.bottom, scrollWidth: pane.scrollWidth, scrollHeight: pane.scrollHeight,
      clientWidth: pane.clientWidth, clientHeight: pane.clientHeight, inspectorWidth: inspector.width,
      inspectorLeft: inspector.left, padding: parseFloat(style.paddingLeft), zoom: zoom()};
  };
  const fits = () => {
    const m = measurements();
    return m.width > 0 && m.height > 0 && m.x >= m.left - 1 && m.y >= m.top - 1
      && m.paperRight <= m.right + 1 && m.paperBottom <= m.bottom + 1
      && m.scrollWidth <= m.clientWidth + 1 && m.scrollHeight <= m.clientHeight + 1;
  };
  const assertFit = async (label: string) => {
    await frames();
    await until(fits, `${label} clips the actual sheet: ${JSON.stringify(measurements())}`);
    const m = measurements();
    check(m.padding === 32 && Math.abs(m.inspectorWidth - 300) < 1,
      'Fixture must use production padding and the real Properties pane');
    check(m.paperRight <= m.inspectorLeft, 'Sheet overlaps the Properties pane');
    check(Math.min((m.right - m.left) - m.width, (m.bottom - m.top) - m.height) < 2,
      `${label} leaves avoidable blank space instead of fitting the page`);
    check(fitMode(), `${label} did not enter fit mode`);
    return {label, zoom: m.zoom, width: m.width, height: m.height};
  };
  const results: Array<Awaited<ReturnType<typeof assertFit>>> = [];
  try {
    useAppStore.setState({drawingDocument: drawing, activeProjectTabId: 'paper-fit', activeTab: 'drawing',
      drawingSheetSetupOpen: false, drawingProfileExportOpen: false, drawingTool: null, drawingPendingViewKind: null,
      selectedDrawingViewId: null, selectedDrawingAnnotationId: 1, engineKind: 'tauri'});
    root.render(<DrawingWorkspace />);
    await until(() => !!paper() && !!fitButton(), 'Production drawing workspace did not mount');
    results.push(await assertFit('initial A3 portrait'));
    for (const sheet of sheets) {
      const nextDrawing = {...drawing, active_sheet_id: sheet.id};
      useAppStore.setState({drawingDocument: nextDrawing, selectedDrawingAnnotationId: sheet.id});
      const before = snapshot();
      results.push(await assertFit(sheet.name));
      container.style.width = '860px'; container.style.height = '520px';
      results.push(await assertFit(`${sheet.name}, smaller pane`));
      container.style.width = '1080px'; container.style.height = '640px';
      results.push(await assertFit(`${sheet.name}, restored pane`));
      unchanged(before);
    }

    const longName = 'Complete workshop assembly drawing with detailed manufacturing notes and a deliberately long sheet name';
    useAppStore.setState({drawingDocument: {...drawing, active_sheet_id: 4,
      sheets: sheets.map(sheet => sheet.id === 4 ? {...sheet, name: longName} : sheet)}});
    container.style.width = '640px'; container.style.height = '480px';
    const compactBefore = snapshot();
    results.push(await assertFit('compact pane with long sheet name'));
    const paneBounds = scroll().getBoundingClientRect();
    const workspaceBounds = container.getBoundingClientRect();
    for (const title of ['Fit sheet', 'Zoom out', 'Zoom in', 'Print / Save as PDF']) {
      const button = container.querySelector<HTMLButtonElement>(`button[title="${title}"]`)!;
      const rect = button.getBoundingClientRect();
      check(rect.width > 0 && rect.left >= paneBounds.left && rect.right <= paneBounds.right
        && rect.top >= workspaceBounds.top && rect.bottom <= paneBounds.top,
      `${title} is clipped by the long name or compact pane`);
      check(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.closest('button') === button,
        `${title} is covered by another element`);
    }
    const nameElement = container.querySelector<HTMLElement>(`span[title="${longName}"]`)!;
    check(nameElement.scrollWidth > nameElement.clientWidth, 'Long sheet title does not exercise production truncation');
    await click('Fit sheet'); unchanged(compactBefore);

    // A sheet may retain its ID while the user changes paper setup.
    useAppStore.setState({drawingDocument: {...drawing, active_sheet_id: 4,
      sheets: sheets.map(sheet => sheet.id === 4 ? {...sheet, format: 'a3', orientation: 'portrait'} : sheet)}});
    results.push(await assertFit('same sheet id, changed format and orientation'));
    useAppStore.setState({drawingDocument: {...drawing, active_sheet_id: 4}});
    container.style.width = '1080px'; container.style.height = '640px';
    results.push(await assertFit('paper setup restored'));

    const before = snapshot();
    const fittedZoom = zoom();
    await click('Zoom in');
    check(zoom() > fittedZoom && !fitMode(), 'Manual zoom button did not leave automatic fit');
    const manualZoom = zoom();
    container.style.width = '900px'; container.style.height = '540px';
    await frames();
    check(zoom() === manualZoom && !fitMode(), 'Resize discarded the manually chosen zoom');
    await click('Fit sheet'); results.push(await assertFit('shared MCP/UI Fit sheet'));
    unchanged(before);

    // Real wheel handler: trackpad pan exits fit even at a page edge; resize
    // must not unexpectedly override that manual navigation choice.
    const panZoom = zoom();
    scroll().dispatchEvent(new WheelEvent('wheel', {bubbles: true, cancelable: true, deltaX: 12, deltaY: 20}));
    await frames();
    check(!fitMode() && zoom() === panZoom, 'Trackpad pan did not leave fit without changing zoom');
    container.style.width = '960px'; container.style.height = '570px'; await frames();
    check(zoom() === panZoom, 'Resize overrode manual pan mode');
    await click('Fit sheet'); results.push(await assertFit('fit after manual pan'));
    const bounds = scroll().getBoundingClientRect();
    scroll().dispatchEvent(new WheelEvent('wheel', {bubbles: true, cancelable: true,
      deltaY: -220, ctrlKey: true, clientX: bounds.left + 100, clientY: bounds.top + 100}));
    await frames();
    check(!fitMode() && !fits(), 'Pinch zoom should enlarge the paper beyond the fitted pane');
    scroll().scrollLeft = 50; scroll().scrollTop = 50;
    const panBefore = {left: scroll().scrollLeft, top: scroll().scrollTop};
    scroll().dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, button: 1, buttons: 4, pointerId: 17, clientX: 200, clientY: 200}));
    scroll().dispatchEvent(new PointerEvent('pointermove', {bubbles: true, buttons: 4, pointerId: 17, clientX: 160, clientY: 170}));
    scroll().dispatchEvent(new PointerEvent('pointerup', {bubbles: true, button: 1, pointerId: 17}));
    await frames();
    check(scroll().scrollLeft > panBefore.left && scroll().scrollTop > panBefore.top && !fitMode(),
      'Middle-button drag did not pan enlarged paper');
    await click('Fit sheet'); results.push(await assertFit('fit resets scroll after drag'));
    check(scroll().scrollLeft === 0 && scroll().scrollTop === 0, 'Fit retained a clipped scroll offset');
    unchanged(before);

    await click('Zoom in');
    useAppStore.setState({drawingDocument: {...drawing, active_sheet_id: 1}, selectedDrawingAnnotationId: 1});
    results.push(await assertFit('sheet switch restores fit from manual mode'));
    await click('Zoom in');
    useAppStore.setState({activeProjectTabId: 'another-project-with-sheet-1'});
    results.push(await assertFit('new project with same sheet id restores fit'));
    check(nativeCalls.length === 0, 'Viewing paper issued native model operations');
    return {productionCss: true, actualInspectorAndPadding: true, cases: results, groupedFitControl: true,
      compactControlsVisible: true, manualZoomAndPan: true, resizePolicy: true,
      sheetAndProjectChanges: true, selectionAndModelPreserved: true};
  } finally {
    root.unmount(); container.remove(); useAppStore.setState(initial);
    if (previousNative) nativeWindow.__TAURI_INTERNALS__ = previousNative; else delete nativeWindow.__TAURI_INTERNALS__;
  }
}
