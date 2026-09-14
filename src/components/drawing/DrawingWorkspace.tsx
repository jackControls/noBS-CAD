import {
  createContext,
  useCallback,
  useEffect,
  useLayoutEffect,
  useContext,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { Eye, EyeOff, Maximize, Minus, Plus, Printer, Trash2, X } from 'lucide-react';
import { translate, useTranslation } from '../../i18n';
import { getEngine } from '../../engine';
import type {
  DrawingAnnotationDto,
  DrawingAttachmentRefDto,
  DrawingCircularRefDto,
  DrawingDimensionPresentationDto,
  DrawingLineDimensionMode,
  DrawingLineRefDto,
  DrawingProjectionAnchorDto,
  DrawingProjectionDto,
  DrawingProjectedCircleDto,
  DrawingSheetDto,
  DrawingSheetStyleDto,
  DrawingSheetFormat,
  DrawingStandard,
  DrawingTolerancePreset,
  DrawingTopologyAnchorRefDto,
  DrawingViewDto,
  DrawingViewKind,
  ProfileCatalogItemDto,
} from '../../engine/types';
import {
  addDrawingArcLengthDimension,
  addDrawingAngularDimension,
  addDrawingAutomaticSymmetryAxis,
  addDrawingBoltCircleCenterLine,
  addDrawingBomItem,
  addDrawingRevision,
  addDrawingChainDimension,
  addDrawingCenterLine,
  addDrawingCenterLineBetweenEdges,
  addDrawingCenterMark,
  addDrawingChamferNote,
  addDrawingDatumFeature,
  addDrawingDerivedView,
  addDrawingEdgeRequirement,
  addDrawingGdtFrame,
  addDrawingHoleNote,
  addDrawingLinearDimension,
  addDrawingLineDimension,
  addDrawingPointLineDimension,
  addDrawingNote,
  addDrawingOrdinateDimension,
  addDrawingRadialDimension,
  addDrawingJoggedRadiusDimension,
  addDrawingRevisionCloud,
  addDrawingSurfaceTexture,
  addDrawingWeldSymbol,
  addDrawingItemBalloon,
  addDrawingView,
  applyDrawingTemplate,
  defaultDrawingViewPlacementPosition,
  deleteDrawingAnnotation,
  deleteDrawingBomItem,
  deleteDrawingRevision,
  deleteDrawingView,
  deleteDrawingTemplate,
  defaultDrawingDimensionPresentation,
  drawingViewGroupRoot,
  drawingViewPlacementDraft,
  drawingViewPlacementRoot,
  saveActiveDrawingTemplate,
  type DrawingAnnotationUpdate,
  updateActiveDrawingSheet,
  updateDrawingAnnotation,
  updateDrawingBomItem,
  updateDrawingRevision,
  updateDrawingView,
} from '../../drawing/document';
import {
  angularDimensionGeometry,
  arcLengthDimensionGeometry,
  arrowPolygon,
  automaticSymmetryAxisGeometry,
  boltCircleGeometry,
  centerLineGeometry,
  centerLineBetweenEdgesGeometry,
  centerMarkGeometry,
  drawingAnchorRef,
  drawingAngularDimensionText,
  drawingChamferText,
  drawingCircleCenterAnchorRef,
  drawingCircularRef,
  drawingDimensionText,
  drawingDimensionTextWidth,
  drawingLinearDimensionLayout,
  drawingLineDimensionMode,
  drawingHoleCalloutText,
  drawingProjectedPointToPaper,
  linearDimensionGeometry,
  lineDimensionGeometry,
  pointLineDimensionGeometry,
  ordinateDimensionGeometry,
  radialDimensionGeometry,
  resolveDrawingAnchor,
  resolveDrawingAttachment,
  resolveDrawingCircle,
  resolveDrawingLine,
} from '../../drawing/annotations';
import {
  drawingCenterlineEdgeCandidates,
  drawingCenterlineEdgesCompatible,
  nearestDrawingCenterlineEdgeCandidate,
  sameDrawingLineRef,
  type DrawingCenterlineEdgeCandidate,
} from '../../drawing/centerlines';
import {
  defaultChamferNotePosition,
  drawingChamferCandidates,
  type DrawingChamferCandidate,
} from '../../drawing/chamfer';
import { exportManufacturingProfileDxf, printActiveDrawing } from '../../drawing/export';
import {drawingTitleBlock} from '../../drawing/titleBlock';
import { drawingProjectionRequestForView, drawingSourceAnchorPoint, drawingSectionSourceExtent } from '../../drawing/projection';
import {captureDrawingProjectionScope, isDrawingProjectionScopeCurrent, observeDrawingProjection} from '../../drawing/projectionPresentation';
import {presentation} from '../../operationPlayback';
import {
  defaultDrawingFormat,
  defaultDrawingSheetStyle,
  drawingFormatLabel,
  drawingFormatsForStandard,
  drawingFormatShortLabel,
  drawingSheetSize,
  drawingViewPaperBounds,
  drawingViewTransform,
} from '../../drawing/sheet';
import { drawingSvgLineAttributes, type DrawingLineRole } from '../../drawing/styles';
import { useAppStore, type DrawingTool } from '../../store/appStore';
import { DrawingSheetSetup } from './DrawingSheetSetup';
import { showDrawingError } from './DrawingBrowser';

type AnchorDraft = {
  viewId: number;
  anchors: DrawingTopologyAnchorRefDto[];
  paper: Array<[number, number]>;
} | null;

type ChamferDraft = {
  viewId: number;
  candidate: DrawingChamferCandidate;
  position: [number, number];
} | null;

type CircleDraft = {
  viewId: number;
  features: DrawingCircularRefDto[];
} | null;

type CenterlineEdgeDraft = {
  viewId: number;
  reference: DrawingLineRefDto;
} | null;

type LineDimensionDraft = {
  viewId: number;
  first: DrawingLineRefDto;
  firstPaperStart: [number, number];
  firstPaperEnd: [number, number];
  second: DrawingLineRefDto | null;
  mode: DrawingLineDimensionMode;
  position: [number, number];
} | null;

type PointLineDimensionDraft = {
  viewId: number;
  point: DrawingTopologyAnchorRefDto;
  pointPaper: [number, number];
  line: DrawingLineRefDto;
  linePaperStart: [number, number];
  linePaperEnd: [number, number];
  position: [number, number];
} | null;

type PaperPointDraft = Array<[number, number]>;

const DrawingStyleContext = createContext<DrawingSheetStyleDto | null>(null);

function useDrawingLine(role: DrawingLineRole) {
  return drawingSvgLineAttributes(useContext(DrawingStyleContext) ?? defaultDrawingSheetStyle(), role);
}

function useDrawingStyle(): DrawingSheetStyleDto {
  return useContext(DrawingStyleContext) ?? defaultDrawingSheetStyle();
}

const drawingScales = [10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01] as const;
const MIN_DRAWING_ZOOM = 0.01;
const MAX_DRAWING_ZOOM = 5;
const MACOS_DRAWING_INPUT = typeof navigator !== 'undefined'
  && /Macintosh|Mac OS X/.test(navigator.userAgent);

type WebKitGestureEvent = Event & {
  scale: number;
  clientX: number;
  clientY: number;
};

type DrawingWheelGesture = 'mouse' | 'trackpad' | null;

type DrawingWheelGestureState = {
  kind: DrawingWheelGesture;
  lastTime: number;
  count: number;
};

type SheetPanDrag = {
  pointerId: number;
  clientStart: [number, number];
  scrollStart: [number, number];
};

export function DrawingWorkspace() {
  const { t } = useTranslation();
  const drawing = useAppStore((state) => state.drawingDocument);
  const projectTabId = useAppStore((state) => state.activeProjectTabId);
  const scene = useAppStore((state) => state.solidScene);
  const selectedViewId = useAppStore((state) => state.selectedDrawingViewId);
  const selectedAnnotationId = useAppStore((state) => state.selectedDrawingAnnotationId);
  const drawingTool = useAppStore((state) => state.drawingTool);
  const pendingViewKind = useAppStore((state) => state.drawingPendingViewKind);
  const sheetSetupOpen = useAppStore((state) => state.drawingSheetSetupOpen);
  const profileExportOpen = useAppStore((state) => state.drawingProfileExportOpen);
  const setProfileExportOpen = useAppStore((state) => state.setDrawingProfileExportOpen);
  const selectView = useAppStore((state) => state.setSelectedDrawingViewId);
  const selectAnnotation = useAppStore((state) => state.setSelectedDrawingAnnotationId);
  const setDrawingTool = useAppStore((state) => state.setDrawingTool);
  const setPendingViewKind = useAppStore((state) => state.setDrawingPendingViewKind);
  const sheet = drawing.sheets.find((candidate) => candidate.id === drawing.active_sheet_id) ?? null;
  const [width, height] = sheet ? drawingSheetSize(sheet.format, sheet.orientation) : [0, 0];
  const [zoom, setZoom] = useState(1);
  const [sheetFitted, setSheetFitted] = useState(true);
  const sheetFittedRef = useRef(true);
  const [anchorDraft, setAnchorDraft] = useState<AnchorDraft>(null);
  const [circleDraft, setCircleDraft] = useState<CircleDraft>(null);
  const [centerlineEdgeDraft, setCenterlineEdgeDraft] = useState<CenterlineEdgeDraft>(null);
  const [lineDimensionDraft, setLineDimensionDraft] = useState<LineDimensionDraft>(null);
  const [pointLineDimensionDraft, setPointLineDimensionDraft] = useState<PointLineDimensionDraft>(null);
  const [chamferDraft, setChamferDraft] = useState<ChamferDraft>(null);
  const [paperPointDraft, setPaperPointDraft] = useState<PaperPointDraft>([]);
  const [placementPoint, setPlacementPoint] = useState<[number, number] | null>(null);
  const [placementScale, setPlacementScale] = useState(1);
  const drawingScrollRef = useRef<HTMLDivElement>(null);
  const drawingSheetRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef(zoom);
  const zoomFrameRef = useRef(0);
  const wheelGestureRef = useRef<DrawingWheelGestureState>({
    kind: null,
    lastTime: 0,
    count: 0,
  });
  const sheetPanDragRef = useRef<SheetPanDrag | null>(null);
  const [sheetPanning, setSheetPanning] = useState(false);
  const clearSelection = () => {
    selectView(null);
    selectAnnotation(null);
  };

  const leaveSheetFit = () => {
    sheetFittedRef.current = false;
    setSheetFitted(false);
  };

  const fitSheet = useCallback(() => {
    const scroll = drawingScrollRef.current;
    if (!scroll || width <= 0 || height <= 0) return;
    const padding = getComputedStyle(scroll);
    const bounds = scroll.getBoundingClientRect();
    // The fitted page needs no scrollbars. Using the currently zoomed pane's
    // client size includes its old scrollbar deduction and causes a second
    // visible fit when the scrollbar disappears on the next layout frame.
    const availableWidth = bounds.width - parseFloat(padding.borderLeftWidth) - parseFloat(padding.borderRightWidth)
      - parseFloat(padding.paddingLeft) - parseFloat(padding.paddingRight);
    const availableHeight = bounds.height - parseFloat(padding.borderTopWidth) - parseFloat(padding.borderBottomWidth)
      - parseFloat(padding.paddingTop) - parseFloat(padding.paddingBottom);
    if (availableWidth <= 0 || availableHeight <= 0) return;
    // Measure the paper pane itself: its siblings already reserve the ribbon,
    // inspector and playback controls. Sheet dimensions use three pixels/mm
    // at 100%; zoom changes only the view, never the drawing's paper scale.
    const nextZoom = Math.min(MAX_DRAWING_ZOOM, availableWidth / (width * 3), availableHeight / (height * 3));
    sheetFittedRef.current = true;
    setSheetFitted(true);
    zoomRef.current = nextZoom;
    setZoom(nextZoom);
    if (zoomFrameRef.current !== 0) cancelAnimationFrame(zoomFrameRef.current);
    scroll.scrollLeft = 0;
    scroll.scrollTop = 0;
    zoomFrameRef.current = requestAnimationFrame(() => {
      zoomFrameRef.current = 0;
      scroll.scrollLeft = 0;
      scroll.scrollTop = 0;
    });
  }, [width, height]);

  useLayoutEffect(() => {
    const scroll = drawingScrollRef.current;
    if (!scroll || !sheet || sheetSetupOpen) return;
    fitSheet();
    const resize = new ResizeObserver(() => {
      if (sheetFittedRef.current) fitSheet();
    });
    resize.observe(scroll);
    return () => resize.disconnect();
  }, [projectTabId, sheet?.id, sheetSetupOpen, fitSheet]);

  const zoomAtPoint = useCallback((requestedZoom: number, clientPoint?: [number, number]) => {
    sheetFittedRef.current = false;
    setSheetFitted(false);
    const nextZoom = Math.max(MIN_DRAWING_ZOOM, Math.min(MAX_DRAWING_ZOOM, requestedZoom));
    const scroll = drawingScrollRef.current;
    const svg = drawingSheetRef.current;
    const currentZoom = zoomRef.current;
    if (Math.abs(nextZoom - currentZoom) < 1e-4) return;

    let anchor: { fractionX: number; fractionY: number; clientX: number; clientY: number } | null = null;
    if (scroll && svg) {
      const scrollRect = scroll.getBoundingClientRect();
      const svgRect = svg.getBoundingClientRect();
      const clientX = clientPoint?.[0] ?? scrollRect.left + scrollRect.width / 2;
      const clientY = clientPoint?.[1] ?? scrollRect.top + scrollRect.height / 2;
      anchor = {
        fractionX: Math.max(0, Math.min(1, (clientX - svgRect.left) / Math.max(1, svgRect.width))),
        fractionY: Math.max(0, Math.min(1, (clientY - svgRect.top) / Math.max(1, svgRect.height))),
        clientX,
        clientY,
      };
    }

    zoomRef.current = nextZoom;
    setZoom(nextZoom);
    if (zoomFrameRef.current !== 0) cancelAnimationFrame(zoomFrameRef.current);
    zoomFrameRef.current = requestAnimationFrame(() => {
      zoomFrameRef.current = 0;
      if (!anchor || !scroll || !svg) return;
      const nextRect = svg.getBoundingClientRect();
      scroll.scrollLeft += nextRect.left + nextRect.width * anchor.fractionX - anchor.clientX;
      scroll.scrollTop += nextRect.top + nextRect.height * anchor.fractionY - anchor.clientY;
    });
  }, []);

  const classifyDrawingWheel = (event: ReactWheelEvent<HTMLDivElement>): 'pan' | 'zoom' => {
    const state = wheelGestureRef.current;
    const now = performance.now();
    const gap = now - state.lastTime;
    state.lastTime = now;
    if (gap > 350) {
      state.kind = null;
      state.count = 0;
    }
    state.count += 1;
    if (event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL) {
      state.kind = 'mouse';
      return 'zoom';
    }

    // Pixel-mode horizontal, fractional, and small continuous deltas are the
    // shape of a trackpad swipe. Treat that evidence as authoritative even if
    // it arrives shortly after a mouse-wheel gesture.
    if (
      event.deltaX !== 0
      || !Number.isInteger(event.deltaY)
      || Math.abs(event.deltaY) < 50
    ) {
      state.kind = 'trackpad';
      return 'pan';
    }
    if (state.kind === 'trackpad') return 'pan';
    if (state.kind === 'mouse') {
      if (state.count >= 3 && gap < 120) {
        state.kind = 'trackpad';
        return 'pan';
      }
      return 'zoom';
    }
    if (state.count >= 3 && gap < 120) {
      state.kind = 'trackpad';
      return 'pan';
    }
    if (Math.abs(event.deltaY) >= 100 && gap > 250) {
      state.kind = 'mouse';
      return 'zoom';
    }
    return 'pan';
  };

  const navigateDrawingWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const deltaScale = event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? Math.max(1, event.currentTarget.clientHeight)
        : 1;
    const bounded = (value: number) => Number.isFinite(value)
      ? Math.max(-240, Math.min(240, value * deltaScale))
      : 0;
    const deltaX = bounded(event.deltaX);
    const deltaY = bounded(event.deltaY);
    if (deltaX === 0 && deltaY === 0) return;

    // On macOS, an unmodified pixel-mode wheel event is the trackpad's
    // two-finger surface gesture. Keep that gesture exclusively mapped to
    // paper pan; pinch-to-zoom arrives with ctrlKey (or WebKit's gesture
    // events). Option-wheel remains an explicit zoom path for external mice
    // whose drivers also report pixel-mode deltas.
    const shouldPan = !event.ctrlKey
      && !event.altKey
      && (MACOS_DRAWING_INPUT
        ? event.deltaMode === WheelEvent.DOM_DELTA_PIXEL
        : classifyDrawingWheel(event) === 'pan');
    if (shouldPan) {
      leaveSheetFit();
      event.currentTarget.scrollLeft += deltaX;
      event.currentTarget.scrollTop += deltaY;
      return;
    }

    const sensitivity = event.ctrlKey ? 0.007 : 0.002;
    zoomAtPoint(
      zoomRef.current * Math.exp(-deltaY * sensitivity),
      [event.clientX, event.clientY],
    );
  };

  const startSheetPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button === 1) {
      leaveSheetFit();
      event.preventDefault();
      event.stopPropagation();
      sheetPanDragRef.current = {
        pointerId: event.pointerId,
        clientStart: [event.clientX, event.clientY],
        scrollStart: [event.currentTarget.scrollLeft, event.currentTarget.scrollTop],
      };
      if (event.isTrusted) event.currentTarget.setPointerCapture(event.pointerId);
      setSheetPanning(true);
      return;
    }
    if (event.button === 0 && event.target === event.currentTarget) clearSelection();
  };

  const moveSheetPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = sheetPanDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.currentTarget.scrollLeft = drag.scrollStart[0] - (event.clientX - drag.clientStart[0]);
    event.currentTarget.scrollTop = drag.scrollStart[1] - (event.clientY - drag.clientStart[1]);
  };

  const finishSheetPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = sheetPanDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    sheetPanDragRef.current = null;
    setSheetPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  useEffect(() => {
    if (![
      'dimension', 'angle', 'chain_dimension', 'baseline_dimension',
      'continued_dimension', 'ordinate_dimension', 'arc_length',
      'section_view', 'detail_view', 'broken_view', 'removed_section',
      'datum', 'gdt', 'surface_texture', 'balloon',
    ].includes(drawingTool ?? '')) setAnchorDraft(null);
    if (drawingTool !== 'dimension') {
      setLineDimensionDraft(null);
      setPointLineDimensionDraft(null);
    }
  }, [drawingTool]);
  useEffect(() => {
    if (![
      'center_line', 'bolt_circle', 'arc_length', 'jogged_radius',
      'datum', 'gdt', 'surface_texture', 'balloon',
    ].includes(drawingTool ?? '')) {
      setCircleDraft(null);
    }
    if (![
      'center_line', 'auxiliary_view', 'edge_requirement', 'weld',
      'datum', 'gdt', 'surface_texture', 'balloon',
    ].includes(drawingTool ?? '')) {
      setCenterlineEdgeDraft(null);
    }
  }, [drawingTool]);
  useEffect(() => {
    if (drawingTool !== 'chamfer_note') setChamferDraft(null);
  }, [drawingTool]);
  useEffect(() => {
    if (drawingTool !== 'revision_cloud') setPaperPointDraft([]);
  }, [drawingTool]);
  useEffect(() => {
    setAnchorDraft(null);
    setCircleDraft(null);
    setCenterlineEdgeDraft(null);
    setLineDimensionDraft(null);
    setPointLineDimensionDraft(null);
    setChamferDraft(null);
    setPaperPointDraft([]);
  }, [sheet?.id]);
  useEffect(() => {
    if (drawingTool !== 'place_view' || !pendingViewKind || !sheet) return;
    const initialPoint = defaultDrawingViewPlacementPosition(sheet, pendingViewKind, selectedViewId);
    const draft = drawingViewPlacementDraft(
      sheet,
      scene,
      pendingViewKind,
      initialPoint,
      selectedViewId,
    );
    setPlacementPoint(initialPoint);
    setPlacementScale(draft.scale);
  }, [drawingTool, pendingViewKind, scene, selectedViewId, sheet]);
  useEffect(() => {
    const target = drawingScrollRef.current;
    if (!target || sheetSetupOpen || !sheet) return;
    let gestureStartZoom = zoomRef.current;
    const gestureStart = (rawEvent: Event) => {
      const event = rawEvent as WebKitGestureEvent;
      event.preventDefault();
      gestureStartZoom = zoomRef.current;
    };
    const gestureChange = (rawEvent: Event) => {
      const event = rawEvent as WebKitGestureEvent;
      event.preventDefault();
      zoomAtPoint(gestureStartZoom * event.scale, [event.clientX, event.clientY]);
    };
    target.addEventListener('gesturestart', gestureStart, { passive: false });
    target.addEventListener('gesturechange', gestureChange, { passive: false });
    return () => {
      target.removeEventListener('gesturestart', gestureStart);
      target.removeEventListener('gesturechange', gestureChange);
      if (zoomFrameRef.current !== 0) cancelAnimationFrame(zoomFrameRef.current);
      zoomFrameRef.current = 0;
    };
  }, [sheet?.id, sheetSetupOpen, zoomAtPoint]);

  if (sheetSetupOpen || !sheet) return <>
    <DrawingSheetSetup />
    {profileExportOpen && <ManufacturingProfileExportDialog onClose={() => setProfileExportOpen(false)} />}
  </>;

  const placementActive = drawingTool === 'place_view' && pendingViewKind !== null;
  const placementRoot = placementActive
    ? drawingViewPlacementRoot(sheet, selectedViewId)
    : null;
  const placementPreview = placementActive && placementPoint && pendingViewKind
    ? drawingViewPlacementDraft(
      sheet,
      scene,
      pendingViewKind,
      placementPoint,
      selectedViewId,
      placementScale,
    )
    : null;
  const cancelTool = () => {
    setDrawingTool(null);
    setPendingViewKind(null);
    setAnchorDraft(null);
    setCircleDraft(null);
    setCenterlineEdgeDraft(null);
    setLineDimensionDraft(null);
    setPointLineDimensionDraft(null);
    setChamferDraft(null);
    setPaperPointDraft([]);
    setPlacementPoint(null);
  };
  const selectOnlyView = (viewId: number) => {
    selectAnnotation(null);
    selectView(viewId);
  };
  const selectOnlyAnnotation = (annotationId: number) => {
    selectView(null);
    selectAnnotation(annotationId);
  };

  const defaultDerivedPosition = (viewId: number): [number, number] => {
    const parent = sheet.views.find((view) => view.id === viewId);
    return parent
      ? boundedDrawingPoint([parent.position[0] + 65, parent.position[1] + 45], width, height)
      : [width * 0.62, height * 0.48];
  };

  const addSymbolAtAttachment = (
    viewId: number,
    attachment: DrawingAttachmentRefDto,
    paper: [number, number],
    bodyId: number,
  ) => {
    const position = boundedDrawingPoint([paper[0] + 18, paper[1] - 12], width, height);
    if (drawingTool === 'datum') return addDrawingDatumFeature(viewId, attachment, position);
    if (drawingTool === 'gdt') return addDrawingGdtFrame(viewId, attachment, position);
    if (drawingTool === 'surface_texture') return addDrawingSurfaceTexture(viewId, attachment, position);
    if (drawingTool === 'balloon') {
      const existing = sheet.bom.find((item) => item.body_id === bodyId);
      if (existing) return addDrawingItemBalloon(viewId, attachment, position, existing.id);
      return addDrawingBomItem({ body_id: bodyId }).then(() => {
        const active = useAppStore.getState().drawingDocument.sheets.find((candidate) => candidate.id === sheet.id);
        const created = active?.bom.find((item) => item.body_id === bodyId);
        if (!created) throw new Error(t('drawing.workspace.errorBomItemCreateFailed'));
        return addDrawingItemBalloon(viewId, attachment, position, created.id);
      });
    }
    return null;
  };

  const pickAnchorReference = (
    viewId: number,
    anchor: DrawingTopologyAnchorRefDto,
    paper: [number, number],
  ) => {
    if (drawingTool === 'dimension') {
      if (pointLineDimensionDraft?.viewId === viewId) {
        setPointLineDimensionDraft({
          ...pointLineDimensionDraft,
          point: anchor,
          pointPaper: paper,
          position: boundedDrawingPoint(defaultPointLineDimensionPosition(
            paper,
            pointLineDimensionDraft.linePaperStart,
            pointLineDimensionDraft.linePaperEnd,
          ), width, height),
        });
        setAnchorDraft(null);
        return;
      }
      if (lineDimensionDraft?.viewId === viewId && !lineDimensionDraft.second) {
        setPointLineDimensionDraft({
          viewId,
          point: anchor,
          pointPaper: paper,
          line: lineDimensionDraft.first,
          linePaperStart: lineDimensionDraft.firstPaperStart,
          linePaperEnd: lineDimensionDraft.firstPaperEnd,
          position: boundedDrawingPoint(defaultPointLineDimensionPosition(
            paper,
            lineDimensionDraft.firstPaperStart,
            lineDimensionDraft.firstPaperEnd,
          ), width, height),
        });
        setLineDimensionDraft(null);
        setAnchorDraft(null);
        selectOnlyView(viewId);
        return;
      }
      setLineDimensionDraft(null);
      setPointLineDimensionDraft(null);
    }
    const current = anchorDraft?.viewId === viewId ? anchorDraft.anchors : [];
    const currentPaper = anchorDraft?.viewId === viewId ? anchorDraft.paper : [];
    if (current.some((candidate) => sameDrawingAnchor(candidate, anchor))) return;
    const next = [...current, anchor];
    const nextPaper = [...currentPaper, paper];
    if (drawingTool === 'dimension' && next.length === 2) {
      void addDrawingLinearDimension(viewId, next[0], next[1]).catch(showDrawingError);
      setAnchorDraft(null);
      return;
    }
    if (drawingTool === 'angle' && next.length === 3) {
      void addDrawingAngularDimension(viewId, next[0], next[1], next[2]).catch(showDrawingError);
      setAnchorDraft(null);
      return;
    }
    if (
      (drawingTool === 'chain_dimension'
        || drawingTool === 'baseline_dimension'
        || drawingTool === 'continued_dimension')
      && next.length === 3
    ) {
      const layout = drawingTool === 'baseline_dimension' ? 'baseline'
        : drawingTool === 'continued_dimension' ? 'continued' : 'chain';
      void addDrawingChainDimension(viewId, next, layout).catch(showDrawingError);
      setAnchorDraft(null);
      return;
    }
    if (drawingTool === 'ordinate_dimension' && next.length === 2) {
      void addDrawingOrdinateDimension(viewId, next[0], next[1]).catch(showDrawingError);
      setAnchorDraft(null);
      return;
    }
    if (drawingTool === 'arc_length' && circleDraft?.viewId === viewId && next.length === 2) {
      void addDrawingArcLengthDimension(viewId, circleDraft.features[0], next[0], next[1]).catch(showDrawingError);
      setAnchorDraft(null);
      setCircleDraft(null);
      return;
    }
    if ((drawingTool === 'section_view' || drawingTool === 'removed_section') && next.length === 2) {
      const kind = drawingTool === 'section_view' ? 'section' : 'removed_section';
      const label = nextDerivedViewLabel(sheet, kind === 'section' ? 'SECTION' : 'REMOVED SECTION');
      const derivation = kind === 'section'
        ? {
          type: 'section' as const, parent_view_id: viewId, first: next[0], second: next[1],
          label, depth: null, hatch_angle_deg: sheet.style.hatch_angle_deg,
          hatch_spacing_mm: sheet.style.hatch_spacing_mm,
        }
        : {
          type: 'removed_section' as const, parent_view_id: viewId, first: next[0], second: next[1],
          label, hatch_angle_deg: sheet.style.hatch_angle_deg,
          hatch_spacing_mm: sheet.style.hatch_spacing_mm,
        };
      void addDrawingDerivedView(kind, viewId, defaultDerivedPosition(viewId), derivation).catch(showDrawingError);
      setAnchorDraft(null);
      return;
    }
    if (drawingTool === 'detail_view' && next.length === 1) {
      const parent = sheet.views.find((view) => view.id === viewId);
      const label = nextDerivedViewLabel(sheet, 'DETAIL');
      void addDrawingDerivedView('detail', viewId, defaultDerivedPosition(viewId), {
        type: 'detail', parent_view_id: viewId, center: next[0],
        radius: 15 / Math.max(parent?.scale ?? 1, 1e-6), label,
      }).catch(showDrawingError);
      setAnchorDraft(null);
      return;
    }
    if (drawingTool === 'broken_view' && next.length === 2) {
      const delta = [Math.abs(nextPaper[1][0] - nextPaper[0][0]), Math.abs(nextPaper[1][1] - nextPaper[0][1])];
      const axis = delta[0] >= delta[1] ? 'horizontal' : 'vertical';
      const values = axis === 'horizontal'
        ? [nextPaper[0][0], nextPaper[1][0]]
        : [nextPaper[0][1], nextPaper[1][1]];
      void addDrawingDerivedView('broken', viewId, defaultDerivedPosition(viewId), {
        type: 'broken', parent_view_id: viewId, axis,
        first: Math.min(...values), second: Math.max(...values), gap_mm: 8,
      }).catch(showDrawingError);
      setAnchorDraft(null);
      return;
    }
    if (['datum', 'gdt', 'surface_texture', 'balloon'].includes(drawingTool ?? '')) {
      const operation = addSymbolAtAttachment(viewId, { type: 'anchor', reference: anchor }, paper, anchor.body_id);
      if (operation) void operation.catch(showDrawingError);
      setAnchorDraft(null);
      return;
    }
    setAnchorDraft({ viewId, anchors: next, paper: nextPaper });
  };
  const pickAnchor = (
    viewId: number,
    projectionAnchor: DrawingProjectionAnchorDto,
    paper: [number, number],
  ) => pickAnchorReference(viewId, drawingAnchorRef(projectionAnchor), paper);

  const pickCircleCenter = (
    viewId: number,
    circle: DrawingProjectedCircleDto,
    paper: [number, number],
  ) => {
    const feature = drawingCircularRef(circle);
    if (drawingTool === 'dimension') {
      pickAnchorReference(viewId, drawingCircleCenterAnchorRef(circle), paper);
      return;
    }
    if (drawingTool === 'center_mark') {
      void addDrawingCenterMark(viewId, feature).catch(showDrawingError);
      return;
    }
    if (drawingTool === 'jogged_radius') {
      void addDrawingJoggedRadiusDimension(viewId, feature, boundedDrawingPoint([paper[0] + 26, paper[1] - 18], width, height)).catch(showDrawingError);
      return;
    }
    if (drawingTool === 'arc_length') {
      setCircleDraft({ viewId, features: [feature] });
      setAnchorDraft(null);
      return;
    }
    if (drawingTool === 'bolt_circle') {
      const current = circleDraft?.viewId === viewId ? circleDraft.features : [];
      if (current.some((candidate) => sameDrawingCircle(candidate, feature))) return;
      const next = [...current, feature];
      if (next.length === 3) {
        void addDrawingBoltCircleCenterLine(viewId, next).catch(showDrawingError);
        setCircleDraft(null);
      } else setCircleDraft({ viewId, features: next });
      return;
    }
    if (['datum', 'gdt', 'surface_texture', 'balloon'].includes(drawingTool ?? '')) {
      const operation = addSymbolAtAttachment(viewId, { type: 'circle', reference: feature }, paper, feature.body_id);
      if (operation) void operation.catch(showDrawingError);
      return;
    }
    if (drawingTool !== 'center_line') return;
    if (centerlineEdgeDraft?.viewId === viewId) return;
    const current = circleDraft?.viewId === viewId ? circleDraft.features : [];
    if (current.some((candidate) => sameDrawingCircle(candidate, feature))) return;
    if (current.length === 1) {
      void addDrawingCenterLine(viewId, current[0], feature).catch(showDrawingError);
      setCircleDraft(null);
      return;
    }
    setCenterlineEdgeDraft(null);
    setCircleDraft({ viewId, features: [feature] });
  };

  const pickCenterlineEdge = (
    viewId: number,
    candidate: DrawingCenterlineEdgeCandidate,
  ) => {
    if (drawingTool === 'dimension') {
      if (pointLineDimensionDraft?.viewId === viewId) {
        setPointLineDimensionDraft({
          ...pointLineDimensionDraft,
          line: candidate.reference,
          linePaperStart: candidate.paperStart,
          linePaperEnd: candidate.paperEnd,
          position: boundedDrawingPoint(defaultPointLineDimensionPosition(
            pointLineDimensionDraft.pointPaper,
            candidate.paperStart,
            candidate.paperEnd,
          ), width, height),
        });
        return;
      }
      if (anchorDraft?.viewId === viewId && anchorDraft.anchors.length === 1) {
        const point = anchorDraft.anchors[0];
        const pointPaper = anchorDraft.paper[0];
        setPointLineDimensionDraft({
          viewId,
          point,
          pointPaper,
          line: candidate.reference,
          linePaperStart: candidate.paperStart,
          linePaperEnd: candidate.paperEnd,
          position: boundedDrawingPoint(defaultPointLineDimensionPosition(
            pointPaper,
            candidate.paperStart,
            candidate.paperEnd,
          ), width, height),
        });
        setAnchorDraft(null);
        setLineDimensionDraft(null);
        selectOnlyView(viewId);
        return;
      }
      const current = lineDimensionDraft?.viewId === viewId ? lineDimensionDraft : null;
      if (!current) {
        const vector: [number, number] = [
          candidate.paperEnd[0] - candidate.paperStart[0],
          candidate.paperEnd[1] - candidate.paperStart[1],
        ];
        const length = Math.hypot(...vector);
        if (length < 1e-7) return;
        const midpoint = midpoint2(candidate.paperStart, candidate.paperEnd);
        const normal: [number, number] = [-vector[1] / length, vector[0] / length];
        setAnchorDraft(null);
        setCircleDraft(null);
        setPointLineDimensionDraft(null);
        setLineDimensionDraft({
          viewId,
          first: candidate.reference,
          firstPaperStart: candidate.paperStart,
          firstPaperEnd: candidate.paperEnd,
          second: null,
          mode: 'length',
          position: [midpoint[0] + normal[0] * 12, midpoint[1] + normal[1] * 12],
        });
        selectOnlyView(viewId);
        return;
      }
      if (sameDrawingLineRef(current.first, candidate.reference)) {
        if (current.second) setLineDimensionDraft({ ...current, second: null, mode: 'length' });
        return;
      }
      if (current.second && sameDrawingLineRef(current.second, candidate.reference)) {
        setLineDimensionDraft({ ...current, second: null, mode: 'length' });
        return;
      }
      const mode = drawingLineDimensionMode(
        { start: current.firstPaperStart, end: current.firstPaperEnd },
        { start: candidate.paperStart, end: candidate.paperEnd },
      );
      setLineDimensionDraft({ ...current, second: candidate.reference, mode });
      return;
    }
    if (drawingTool === 'auxiliary_view') {
      const label = nextDerivedViewLabel(sheet, 'AUXILIARY');
      void addDrawingDerivedView('auxiliary', viewId, defaultDerivedPosition(viewId), {
        type: 'auxiliary', parent_view_id: viewId, reference: candidate.reference,
        label, flipped: false,
      }).catch(showDrawingError);
      return;
    }
    if (drawingTool === 'edge_requirement') {
      void addDrawingEdgeRequirement(viewId, candidate.reference, boundedDrawingPoint([candidate.paperEnd[0] + 18, candidate.paperEnd[1] - 12], width, height)).catch(showDrawingError);
      return;
    }
    if (drawingTool === 'weld') {
      void addDrawingWeldSymbol(viewId, candidate.reference, boundedDrawingPoint([candidate.paperEnd[0] + 18, candidate.paperEnd[1] - 12], width, height)).catch(showDrawingError);
      return;
    }
    if (['datum', 'gdt', 'surface_texture', 'balloon'].includes(drawingTool ?? '')) {
      const paper = midpoint2(candidate.paperStart, candidate.paperEnd);
      const operation = addSymbolAtAttachment(viewId, { type: 'line', reference: candidate.reference }, paper, candidate.reference.body_id);
      if (operation) void operation.catch(showDrawingError);
      return;
    }
    if (drawingTool !== 'center_line') return;
    if (circleDraft?.viewId === viewId) return;
    const current = centerlineEdgeDraft?.viewId === viewId ? centerlineEdgeDraft : null;
    if (current) {
      if (sameDrawingLineRef(current.reference, candidate.reference)) return;
      void addDrawingCenterLineBetweenEdges(viewId, current.reference, candidate.reference)
        .then(() => setCenterlineEdgeDraft(null))
        .catch(showDrawingError);
      return;
    }
    setCircleDraft(null);
    setCenterlineEdgeDraft({ viewId, reference: candidate.reference });
  };

  const selectChamferCandidate = (
    viewId: number,
    candidate: DrawingChamferCandidate,
  ) => {
    setChamferDraft({
      viewId,
      candidate,
      position: defaultChamferNotePosition(candidate),
    });
    selectOnlyView(viewId);
  };

  const placeSheetItem = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    const point = drawingSheetPoint(event, width, height);
    if (drawingTool === 'dimension' && pointLineDimensionDraft) {
      const target = event.target;
      if (target instanceof Element && target.closest(
        '[data-drawing-line-dimension-target], [data-testid="drawing-annotation-anchor"], [data-testid="drawing-smart-dimension-center-target"]',
      )) return;
      event.preventDefault();
      event.stopPropagation();
      void addDrawingPointLineDimension(
        pointLineDimensionDraft.viewId,
        pointLineDimensionDraft.point,
        pointLineDimensionDraft.line,
        boundedDrawingPoint(point, width, height),
      ).then(() => setPointLineDimensionDraft(null)).catch(showDrawingError);
    } else if (drawingTool === 'dimension' && lineDimensionDraft) {
      const target = event.target;
      if (target instanceof Element && target.closest(
        '[data-drawing-line-dimension-target], [data-testid="drawing-annotation-anchor"], [data-testid="drawing-smart-dimension-center-target"]',
      )) return;
      event.preventDefault();
      event.stopPropagation();
      const placementPosition = lineDimensionDraft.second
        ? boundedDrawingPoint(point, width, height)
        : lineDimensionDraft.position;
      void addDrawingLineDimension(
        lineDimensionDraft.viewId,
        lineDimensionDraft.first,
        lineDimensionDraft.second,
        lineDimensionDraft.mode,
        placementPosition,
      ).then(() => setLineDimensionDraft(null)).catch(showDrawingError);
    } else if (drawingTool === 'chamfer_note' && chamferDraft) {
      const target = event.target;
      if (target instanceof Element && target.closest('[data-chamfer-candidate]')) return;
      event.preventDefault();
      event.stopPropagation();
      const { candidate } = chamferDraft;
      void addDrawingChamferNote(
        chamferDraft.viewId,
        candidate.first,
        candidate.second,
        point,
        candidate.distance,
        candidate.angleDeg,
      ).then(() => setChamferDraft(null)).catch(showDrawingError);
    } else if (drawingTool === 'note') {
      event.preventDefault();
      event.stopPropagation();
      void addDrawingNote(point).catch(showDrawingError);
    } else if (drawingTool === 'revision_cloud') {
      event.preventDefault();
      event.stopPropagation();
      const closeToFirst = paperPointDraft.length >= 3
        && Math.hypot(point[0] - paperPointDraft[0][0], point[1] - paperPointDraft[0][1]) <= 4;
      const next = closeToFirst ? paperPointDraft : [...paperPointDraft, point];
      if (closeToFirst || next.length >= 4) {
        void addDrawingRevisionCloud(next, sheet.title_block.revision || 'A')
          .then(() => setPaperPointDraft([]))
          .catch(showDrawingError);
      } else {
        setPaperPointDraft(next);
      }
    } else if (drawingTool === 'place_view' && pendingViewKind) {
      event.preventDefault();
      event.stopPropagation();
      void addDrawingView(pendingViewKind, point, selectedViewId, placementScale).catch(showDrawingError);
    }
  };

  const trackSheetPointer = (event: ReactPointerEvent<SVGSVGElement>) => {
    if ((event.buttons & 4) !== 0) return;
    if (!placementActive && !chamferDraft && !lineDimensionDraft && !pointLineDimensionDraft) return;
    const point = drawingSheetPoint(event, width, height);
    const bounded: [number, number] = [
      Math.max(5, Math.min(width - 5, point[0])),
      Math.max(5, Math.min(height - 5, point[1])),
    ];
    if (placementActive) setPlacementPoint(bounded);
    if (chamferDraft) {
      setChamferDraft((current) => current ? { ...current, position: bounded } : null);
    }
    if (pointLineDimensionDraft) {
      setPointLineDimensionDraft((current) => current ? { ...current, position: bounded } : null);
    }
    if (lineDimensionDraft) {
      setLineDimensionDraft((current) => {
        if (!current) return null;
        if (current.second) return { ...current, position: bounded };

        // While only the first edge is selected, keep its provisional length
        // dimension beyond the pointer. The cursor remains clear so a second
        // edge can be inspected and selected without the preview sitting on
        // top of it.
        const vector: [number, number] = [
          current.firstPaperEnd[0] - current.firstPaperStart[0],
          current.firstPaperEnd[1] - current.firstPaperStart[1],
        ];
        const length = Math.hypot(...vector);
        if (length < 1e-7) return { ...current, position: bounded };
        const midpoint = midpoint2(current.firstPaperStart, current.firstPaperEnd);
        const normal: [number, number] = [-vector[1] / length, vector[0] / length];
        const pointerOffset = (bounded[0] - midpoint[0]) * normal[0]
          + (bounded[1] - midpoint[1]) * normal[1];
        const previousOffset = (current.position[0] - midpoint[0]) * normal[0]
          + (current.position[1] - midpoint[1]) * normal[1];
        const side = Math.abs(pointerOffset) > 0.5
          ? Math.sign(pointerOffset)
          : Math.sign(previousOffset) || 1;
        const previewClearance = 7;
        return {
          ...current,
          position: boundedDrawingPoint([
            bounded[0] + normal[0] * side * previewClearance,
            bounded[1] + normal[1] * side * previewClearance,
          ], width, height),
        };
      });
    }
  };

  return (
    <div className="flex h-full min-h-0 bg-viewport" data-testid="drawing-workspace">
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-9 shrink-0 items-center justify-between border-b border-edge bg-header px-3">
          <div className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap text-[11px] text-mute">
            <span className="truncate font-semibold text-ink" title={sheet.name}>{sheet.name}</span>
            <span>·</span>
            <span>{drawingFormatShortLabel(sheet.format)} {sheet.orientation === 'portrait' ? t('drawing.workspace.orientationPortrait') : t('drawing.workspace.orientationLandscape')}</span>
            <span>·</span>
            <span>{sheet.projection_method === 'first_angle' ? t('drawing.workspace.projectionFirstAngle') : t('drawing.workspace.projectionThirdAngle')}</span>
            {drawingTool && (
              <span className="ml-2 flex min-w-0 items-center gap-2 rounded border border-accent/45 bg-accent/10 px-2 py-1 text-accent">
                <span className="truncate">{drawingToolPrompt(
                  drawingTool,
                  pendingViewKind,
                  drawingTool === 'chamfer_note'
                    ? Number(chamferDraft !== null)
                    : drawingTool === 'dimension' && pointLineDimensionDraft
                      ? 3
                    : drawingTool === 'dimension' && lineDimensionDraft
                      ? lineDimensionDraft.second ? 3 : 2
                    : drawingTool === 'center_line'
                      ? circleDraft?.features.length ?? Number(centerlineEdgeDraft !== null)
                      : anchorDraft?.anchors.length ?? 0,
                )}</span>
                <button type="button" title={t('drawing.workspace.cancelDrawingTool')} onClick={cancelTool} className="rounded hover:bg-accent/15"><X size={12} /></button>
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1" data-interface-group="drawing/sheet">
            <button className="drawing-mini-button" type="button" onClick={fitSheet} title={t('drawing.workspace.fitSheet')} aria-pressed={sheetFitted}><Maximize size={14} /></button>
            <button className="drawing-mini-button" type="button" onClick={() => zoomAtPoint(zoomRef.current - 0.1)} title={t('drawing.workspace.zoomOut')}><Minus size={14} /></button>
            <span className="w-12 text-center font-mono text-[10px] text-mute">{Math.round(zoom * 100)}%</span>
            <button className="drawing-mini-button" type="button" onClick={() => zoomAtPoint(zoomRef.current + 0.1)} title={t('drawing.workspace.zoomIn')}><Plus size={14} /></button>
            <button className="drawing-mini-button ml-2" type="button" data-interface-group="drawing/output" onClick={printActiveDrawing} title={t('drawing.workspace.printSaveAsPdf')}><Printer size={14} /></button>
          </div>
        </div>
        <div
          ref={drawingScrollRef}
          className={`drawing-scroll min-h-0 flex-1 overflow-auto p-8 ${sheetPanning ? 'cursor-grabbing select-none' : ''}`}
          data-drawing-zoom={zoom}
          data-drawing-panning={sheetPanning ? 'true' : 'false'}
          onWheel={navigateDrawingWheel}
          onPointerDown={startSheetPan}
          onPointerMove={moveSheetPan}
          onPointerUp={finishSheetPan}
          onPointerCancel={finishSheetPan}
          onAuxClick={(event) => { if (event.button === 1) event.preventDefault(); }}
        >
          <svg
            ref={drawingSheetRef}
            data-mcp-canvas="drawing"
            className="drawing-sheet mx-auto block overflow-visible bg-white shadow-2xl shadow-black/35"
            data-testid="drawing-sheet"
            width={width * 3 * zoom}
            height={height * 3 * zoom}
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={t('drawing.workspace.sheetAriaLabel').replace('{name}', sheet.name)}
            onPointerDownCapture={placeSheetItem}
            onPointerMove={trackSheetPointer}
          >
            <DrawingStyleContext.Provider value={sheet.style}>
              <rect width={width} height={height} fill="#fff" onPointerDown={drawingTool ? undefined : clearSelection} />
              <SheetFrame sheet={sheet} width={width} height={height} />
              {sheet.views.map((view) => {
              const previewingGroupScale = placementRoot
                && drawingViewGroupRoot(sheet, view.id)?.id === placementRoot.id;
              const displayView = previewingGroupScale
                ? { ...view, scale: placementScale }
                : view;
              return <ProjectedDrawingView
                key={view.id}
                view={displayView}
                allViews={sheet.views}
                sheetWidth={width}
                sheetHeight={height}
                selected={selectedViewId === view.id}
                annotations={sheet.annotations.filter((annotation) => 'view_id' in annotation && annotation.view_id === view.id)}
                derivedChildren={sheet.views.filter((candidate) => candidate.derivation?.parent_view_id === view.id)}
                selectedAnnotationId={selectedAnnotationId}
                standard={sheet.standard}
                drawingTool={drawingTool}
                anchorDraft={anchorDraft}
                circleDraft={circleDraft}
                centerlineEdgeDraft={centerlineEdgeDraft}
                lineDimensionDraft={lineDimensionDraft}
                pointLineDimensionDraft={pointLineDimensionDraft}
                chamferDraft={chamferDraft}
                onSelect={() => selectOnlyView(view.id)}
                onSelectAnnotation={selectOnlyAnnotation}
                onPickAnchor={pickAnchor}
                onPickCircleCenter={pickCircleCenter}
                onPickCenterlineEdge={pickCenterlineEdge}
                onSelectChamferCandidate={selectChamferCandidate}
                onAddSymmetryAxis={(axis) => {
                  void addDrawingAutomaticSymmetryAxis(view.id, axis).catch(showDrawingError);
                }}
              />;
              })}
              {placementPreview && (
              <ProjectedDrawingView
                key={`placement-${pendingViewKind}`}
                view={placementPreview}
                allViews={sheet.views}
                sheetWidth={width}
                sheetHeight={height}
                selected={false}
                annotations={[]}
                derivedChildren={[]}
                selectedAnnotationId={null}
                standard={sheet.standard}
                drawingTool={drawingTool}
                anchorDraft={null}
                circleDraft={null}
                centerlineEdgeDraft={null}
                lineDimensionDraft={null}
                pointLineDimensionDraft={null}
                chamferDraft={null}
                onSelect={() => undefined}
                onSelectAnnotation={() => undefined}
                onPickAnchor={() => undefined}
                onPickCircleCenter={() => undefined}
                onPickCenterlineEdge={() => undefined}
                onSelectChamferCandidate={() => undefined}
                onAddSymmetryAxis={() => undefined}
                preview
              />
              )}
              {chamferDraft && (
              <ChamferPlacementPreview draft={chamferDraft} standard={sheet.standard} />
              )}
              {sheet.annotations.filter((annotation): annotation is Extract<DrawingAnnotationDto, { kind: 'note' }> => annotation.kind === 'note').map((note) => (
              <DrawingNoteGraphic key={note.id} note={note} sheetWidth={width} sheetHeight={height} selected={selectedAnnotationId === note.id} onSelect={() => selectOnlyAnnotation(note.id)} />
              ))}
              {sheet.annotations.filter((annotation): annotation is Extract<DrawingAnnotationDto, { kind: 'revision_cloud' }> => annotation.kind === 'revision_cloud').map((cloud) => (
              <RevisionCloudGraphic key={cloud.id} cloud={cloud} sheetWidth={width} sheetHeight={height} selected={selectedAnnotationId === cloud.id} onSelect={() => selectOnlyAnnotation(cloud.id)} />
              ))}
              {drawingTool === 'revision_cloud' && paperPointDraft.length > 0 && (
              <g className="pointer-events-none" fill="none" stroke="#6654c7" strokeWidth="0.55" strokeDasharray="2 1">
                <polyline points={paperPointDraft.map((point) => point.join(',')).join(' ')} />
                {paperPointDraft.map((point, index) => <circle key={index} cx={point[0]} cy={point[1]} r={index === 0 ? 1.6 : 1.1} fill="#fff" />)}
              </g>
              )}
            </DrawingStyleContext.Provider>
          </svg>
        </div>
      </section>
      <DrawingInspector
        sheet={sheet}
        selectedViewId={selectedViewId}
        selectedAnnotationId={selectedAnnotationId}
        placement={placementActive && pendingViewKind ? {
          kind: pendingViewKind,
          scale: placementScale,
          root: placementRoot,
          onScaleChange: setPlacementScale,
          onCancel: cancelTool,
        } : null}
        chamfer={drawingTool === 'chamfer_note' ? {
          draft: chamferDraft,
          standard: sheet.standard,
          onPositionChange: (position) => setChamferDraft((current) => current ? { ...current, position } : null),
          onCancel: cancelTool,
        } : null}
      />
      {profileExportOpen && <ManufacturingProfileExportDialog onClose={() => setProfileExportOpen(false)} />}
    </div>
  );
}

type ManufacturingProfileChoice = {
  catalog: ProfileCatalogItemDto;
  profile: ProfileCatalogItemDto['profiles'][number];
};

function ManufacturingProfileExportDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [catalogs, setCatalogs] = useState<ProfileCatalogItemDto[]>([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choices: ManufacturingProfileChoice[] = catalogs.flatMap((catalog) => catalog.profiles
    .filter((profile) => profile.nesting_depth % 2 === 0)
    .map((profile) => ({ catalog, profile })));
  const keyFor = (choice: ManufacturingProfileChoice) => `${choice.catalog.feature_id}:${choice.profile.index}`;
  const selected = choices.find((choice) => keyFor(choice) === selectedKey) ?? choices[0] ?? null;

  useEffect(() => {
    let alive = true;
    void getEngine().then((engine) => engine.profileCatalog()).then((catalog) => {
      if (!alive) return;
      setCatalogs(catalog);
      const first = catalog.flatMap((entry) => entry.profiles
        .filter((profile) => profile.nesting_depth % 2 === 0)
        .map((profile) => `${entry.feature_id}:${profile.index}`))[0];
      setSelectedKey(first ?? '');
    }).catch((cause) => {
      if (alive) setError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => {
      if (alive) setLoading(false);
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || busy) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', closeOnEscape, true);
    return () => window.removeEventListener('keydown', closeOnEscape, true);
  }, [busy, onClose]);

  const exportSelected = () => {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    void exportManufacturingProfileDxf(selected.catalog, selected.profile.index)
      .then((saved) => { if (saved) onClose(); })
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false));
  };

  return <div
    className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/35 p-5"
    data-testid="drawing-profile-export-dialog"
    onPointerDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}
  >
    <section className="flex max-h-[min(720px,calc(100vh-40px))] w-[min(860px,calc(100vw-40px))] flex-col overflow-hidden rounded-xl border border-edge bg-panel shadow-2xl">
      <header className="flex items-start justify-between border-b border-edge bg-header px-5 py-4">
        <div><h2 className="text-[15px] font-semibold text-ink">{t('drawing.workspace.exportManufacturingProfile')}</h2><p className="mt-1 text-[11px] text-mute">{t('drawing.workspace.exportManufacturingProfileHint')}</p></div>
        <button type="button" title={t('drawing.workspace.close')} disabled={busy} onClick={onClose} className="drawing-mini-button"><X size={15} /></button>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(260px,0.8fr)_minmax(320px,1.2fr)]">
        <div className="min-h-0 overflow-auto border-r border-edge p-4">
          {loading && <p className="text-[12px] text-mute">{t('drawing.workspace.loadingFinishedSketchProfiles')}</p>}
          {!loading && choices.length === 0 && <div className="rounded-lg border border-edge bg-header/60 p-4 text-[12px] leading-relaxed text-mute">{t('drawing.workspace.noFinishedSketchProfile')}</div>}
          <div className="space-y-2">
            {choices.map((choice) => {
              const key = keyFor(choice);
              const holes = choice.catalog.profiles.filter((profile) => profile.parent_index === choice.profile.index).length;
              return <button
                key={key}
                type="button"
                onClick={() => setSelectedKey(key)}
                className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors ${key === (selected ? keyFor(selected) : '') ? 'border-accent bg-accent/10' : 'border-edge bg-header/45 hover:bg-edge/50'}`}
              >
                <div className="flex items-center justify-between gap-3"><span className="truncate text-[12px] font-semibold text-ink">{t('drawing.workspace.profileChoiceLabel').replace('{name}', choice.catalog.sketch_name).replace('{index}', String(choice.profile.index + 1))}</span><span className="shrink-0 font-mono text-[10px] text-mute">{trimNumber(choice.profile.area)} mm²</span></div>
                <div className="mt-1 text-[10px] text-mute">{t('drawing.workspace.profileBoundarySummary').replace('{elements}', String(choice.profile.curves.length || choice.profile.points.length)).replace('{holes}', String(holes))}</div>
              </button>;
            })}
          </div>
        </div>
        <div className="flex min-h-0 flex-col bg-viewport p-5">
          {selected ? <ManufacturingProfilePreview choice={selected} /> : <div className="flex flex-1 items-center justify-center text-[12px] text-mute">{t('drawing.workspace.noProfileSelected')}</div>}
          <div className="mt-4 rounded-lg border border-edge bg-panel px-3 py-2 text-[10px] leading-relaxed text-mute"><strong className="text-ink">{t('drawing.workspace.industrialOutput')}</strong> {t('drawing.workspace.industrialOutputHint')}</div>
        </div>
      </div>
      {error && <div className="border-t border-red-400/40 bg-red-500/10 px-5 py-2 text-[11px] text-red-600">{error}</div>}
      <footer className="flex items-center justify-end gap-2 border-t border-edge bg-header px-5 py-3"><button type="button" disabled={busy} onClick={onClose} className="rounded border border-edge px-4 py-2 text-[12px] text-ink hover:bg-edge">{t('drawing.workspace.cancel')}</button><button type="button" disabled={!selected || busy} onClick={exportSelected} className="rounded bg-accent px-4 py-2 text-[12px] font-semibold text-white disabled:opacity-45">{busy ? t('drawing.workspace.exporting') : t('drawing.workspace.exportProfileDxf')}</button></footer>
    </section>
  </div>;
}

function ManufacturingProfilePreview({ choice }: { choice: ManufacturingProfileChoice }) {
  const { t } = useTranslation();
  const holes = choice.catalog.profiles.filter((profile) => profile.parent_index === choice.profile.index);
  const loops = [choice.profile, ...holes];
  const points = loops.flatMap((loop) => loop.points);
  if (points.length === 0) {
    return <div className="flex min-h-[300px] flex-1 items-center justify-center rounded-lg border border-edge bg-white text-[12px] text-mute">{t('drawing.workspace.noPreviewableBoundaryPoints')}</div>;
  }
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const extent = Math.max(maxX - minX, maxY - minY, 1);
  const pad = extent * 0.12;
  const path = loops.map((loop) => loop.points.length < 3 ? '' : `M${loop.points.map((point) => `${point.x},${-point.y}`).join('L')}Z`).join(' ');
  return <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-edge bg-white shadow-inner">
    <svg className="h-full min-h-[300px] w-full" viewBox={`${minX - pad} ${-(maxY + pad)} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={t('drawing.workspace.profilePreviewAriaLabel').replace('{name}', choice.catalog.sketch_name)}>
      <path d={path} fill="#7160d7" fillOpacity="0.13" fillRule="evenodd" stroke="#5546b8" strokeWidth={extent / 280} vectorEffect="non-scaling-stroke" />
    </svg>
  </div>;
}

function ProjectedDrawingView({
  view,
  allViews,
  sheetWidth,
  sheetHeight,
  selected,
  annotations,
  derivedChildren,
  selectedAnnotationId,
  standard,
  drawingTool,
  anchorDraft,
  circleDraft,
  centerlineEdgeDraft,
  lineDimensionDraft,
  pointLineDimensionDraft,
  chamferDraft,
  onSelect,
  onSelectAnnotation,
  onPickAnchor,
  onPickCircleCenter,
  onPickCenterlineEdge,
  onSelectChamferCandidate,
  onAddSymmetryAxis,
  preview = false,
}: {
  view: DrawingViewDto;
  allViews: DrawingViewDto[];
  sheetWidth: number;
  sheetHeight: number;
  selected: boolean;
  annotations: DrawingAnnotationDto[];
  derivedChildren: DrawingViewDto[];
  selectedAnnotationId: number | null;
  standard: DrawingStandard;
  drawingTool: DrawingTool;
  anchorDraft: AnchorDraft;
  circleDraft: CircleDraft;
  centerlineEdgeDraft: CenterlineEdgeDraft;
  lineDimensionDraft: LineDimensionDraft;
  pointLineDimensionDraft: PointLineDimensionDraft;
  chamferDraft: ChamferDraft;
  onSelect: () => void;
  onSelectAnnotation: (annotationId: number) => void;
  onPickAnchor: (
    viewId: number,
    anchor: DrawingProjectionAnchorDto,
    paper: [number, number],
  ) => void;
  onPickCircleCenter: (
    viewId: number,
    circle: DrawingProjectedCircleDto,
    paper: [number, number],
  ) => void;
  onPickCenterlineEdge: (
    viewId: number,
    candidate: DrawingCenterlineEdgeCandidate,
  ) => void;
  onSelectChamferCandidate: (
    viewId: number,
    candidate: DrawingChamferCandidate,
  ) => void;
  onAddSymmetryAxis: (axis: 'x' | 'y' | 'both') => void;
  preview?: boolean;
}) {
  const { t } = useTranslation();
  const scene = useAppStore((state) => state.solidScene);
  const globallySelectedViewId = useAppStore((state) => state.selectedDrawingViewId);
  const [projected, setProjection] = useState<{value: DrawingProjectionDto; requestKey: string;
    scope: ReturnType<typeof captureDrawingProjectionScope>} | null>(null);
  const [error, setError] = useState<string | null>(null);
  const drag = useRef<{ pointerId: number; start: [number, number]; origin: [number, number] } | null>(null);
  const [dragPosition, setDragPosition] = useState<[number, number] | null>(null);
  const [hoveredChamferKey, setHoveredChamferKey] = useState<string | null>(null);
  const [hoveredCircleKey, setHoveredCircleKey] = useState<string | null>(null);
  const [hoveredCenterlineEdgeKey, setHoveredCenterlineEdgeKey] = useState<string | null>(null);
  const assemblySolution = useAppStore((state) => state.assemblySolution);
  const projectDocument = useAppStore((state) => state.document);
  const projectTab = useAppStore((state) => state.activeProjectTabId);
  const documentVersion = presentation.documentVersion();
  let requestError: string | null = null;
  let projectionRequest: ReturnType<typeof drawingProjectionRequestForView> | null = null;
  try {
    projectionRequest = drawingProjectionRequestForView(view, allViews, scene, assemblySolution);
  } catch (reason) {
    requestError = reason instanceof Error ? reason.message : String(reason);
  }
  const requestKey = JSON.stringify(projectionRequest) + (requestError ?? '');
  // Suppress predecessor pixels during the render itself, before the effect
  // cleanup runs for a replacement document, changed pose or changed request.
  const projection = projected?.requestKey === requestKey && isDrawingProjectionScopeCurrent(projected.scope)
    ? projected.value : null;

  useEffect(() => {
    setError(null);
    setProjection(null);
    if (!projectionRequest) return;
    const scope = captureDrawingProjectionScope();
    return observeDrawingProjection(projectionRequest, value => setProjection({value, scope, requestKey}),
      reason => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [requestKey, scene, assemblySolution, projectDocument, projectTab, documentVersion]);

  const style = useDrawingStyle();
  const visibleLine = drawingSvgLineAttributes(style, 'visible');
  const hiddenLine = drawingSvgLineAttributes(style, 'hidden');
  const hatchLine = drawingSvgLineAttributes(style, 'hatch');

  if (error || requestError) return <text x={view.position[0]} y={view.position[1]} fill={preview ? '#6654c7' : '#b33'} fontSize="3" textAnchor="middle"><title>{requestError ?? error}</title>{requestError ? t('drawing.workspace.reassociateViewReference') : t('drawing.workspace.projectionFailed')}</text>;
  if (!projection) return <g data-testid={preview ? 'drawing-view-placement-preview' : undefined} data-preview-scale={preview ? view.scale : undefined} data-preview-x={preview ? view.position[0] : undefined} data-preview-y={preview ? view.position[1] : undefined} stroke={preview ? '#6654c7' : '#9aa0a8'} strokeWidth={preview ? 0.45 : visibleLine.strokeWidth} className="pointer-events-none"><path d={`M${view.position[0] - 4} ${view.position[1]}h8M${view.position[0]} ${view.position[1] - 4}v8`} /></g>;

  const position = dragPosition ?? view.position;
  const displayView = position === view.position ? view : { ...view, position };
  const repairAnnotation = drawingTool === 'reassociate'
    ? annotations.find((annotation) => annotation.id === selectedAnnotationId) ?? null
    : null;
  const repairTarget = repairAnnotation
    ? drawingReferenceRepairTarget(repairAnnotation, displayView, projection)
    : null;
  const repairDerivedView = drawingTool === 'reassociate'
    ? derivedChildren.find((candidate) => candidate.id === globallySelectedViewId) ?? null
    : null;
  const derivedRepairTarget = repairDerivedView
    ? drawingDerivedReferenceRepairTarget(repairDerivedView, displayView, projection)
    : null;
  const activeRepairKind = repairTarget?.kind ?? derivedRepairTarget?.kind ?? null;
  const confirmRepair = (label: string) => window.confirm(
    t('drawing.workspace.reassociateConfirm').replace('{label}', label),
  );
  const completeRepair = (update: DrawingAnnotationUpdate) => {
    if (!repairAnnotation) return;
    void updateDrawingAnnotation(repairAnnotation.id, update).then(() => {
      useAppStore.getState().setDrawingTool(null);
    }).catch(showDrawingError);
  };
  const completeDerivedRepair = (derivation: NonNullable<DrawingViewDto['derivation']>) => {
    if (!repairDerivedView) return;
    void updateDrawingView(repairDerivedView.id, { derivation }).then(() => {
      useAppStore.getState().setDrawingTool(null);
    }).catch(showDrawingError);
  };
  const [x, y, width, height] = drawingViewPaperBounds(displayView, projection);
  const labelY = y + Math.max(height, 1) + 5;
  const paperPoint = (event: ReactPointerEvent<SVGGElement>) => drawingSheetPoint(event, sheetWidth, sheetHeight);
  const onPointerDown = (event: ReactPointerEvent<SVGGElement>) => {
    if (preview || event.button !== 0 || drawingTool !== null) return;
    event.stopPropagation();
    onSelect();
    drag.current = { pointerId: event.pointerId, start: paperPoint(event), origin: view.position };
    if (event.isTrusted) event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<SVGGElement>) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    const current = paperPoint(event);
    setDragPosition([
      Math.max(5, Math.min(sheetWidth - 5, drag.current.origin[0] + current[0] - drag.current.start[0])),
      Math.max(5, Math.min(sheetHeight - 5, drag.current.origin[1] + current[1] - drag.current.start[1])),
    ]);
  };
  const finishDrag = (event: ReactPointerEvent<SVGGElement>) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    drag.current = null;
    if (dragPosition) void updateDrawingView(view.id, { position: dragPosition }).catch(showDrawingError);
    setDragPosition(null);
  };
  const pickCircle = (circle: DrawingProjectedCircleDto) => {
    if (repairTarget?.kind === 'circle') {
      if (confirmRepair(repairTarget.label)) completeRepair(repairTarget.update(drawingCircularRef(circle, projection)));
    } else if (drawingTool === 'dimension') {
      // The primary Dimension command is context-aware: a full circular edge
      // is a diameter, while an open arc is a radius. Its center has a separate
      // hit target below so center-to-center dimensions remain equally direct.
      void addDrawingRadialDimension(
        view.id,
        drawingCircularRef(circle, projection),
        circle.closed ? 'diameter' : 'radius',
      ).catch(showDrawingError);
    } else if (drawingTool === 'diameter' || drawingTool === 'radius') {
      void addDrawingRadialDimension(view.id, drawingCircularRef(circle, projection), drawingTool).catch(showDrawingError);
    } else if (drawingTool === 'hole_note') {
      const center = drawingProjectedPointToPaper(displayView, projection, circle.center);
      // Keep the default hole-note leader in a different quadrant from the
      // default radial/diameter leader so both remain independently hittable.
      void addDrawingHoleNote(view.id, drawingCircularRef(circle, projection), [center[0] + 20, center[1] + 15]).catch(showDrawingError);
    } else if ([
      'dimension', 'center_mark', 'center_line', 'bolt_circle', 'arc_length',
      'jogged_radius', 'datum', 'gdt', 'surface_texture', 'balloon',
    ].includes(drawingTool ?? '')) {
      const center = drawingProjectedPointToPaper(displayView, projection, circle.center);
      onPickCircleCenter(view.id, circle, center);
    }
  };

  const pickingAnchors = !preview && ([
    'dimension', 'angle', 'chain_dimension', 'baseline_dimension',
    'continued_dimension', 'ordinate_dimension', 'arc_length', 'section_view',
    'detail_view', 'broken_view', 'removed_section', 'datum', 'gdt',
    'surface_texture', 'balloon',
  ].includes(drawingTool ?? '') || activeRepairKind === 'anchor');
  const centerPicking = ([
    'dimension', 'center_mark', 'center_line', 'bolt_circle', 'arc_length',
    'jogged_radius', 'datum', 'gdt', 'surface_texture', 'balloon',
  ].includes(drawingTool ?? '') || activeRepairKind === 'circle');
  const pickingCircles = !preview && (
    centerPicking || drawingTool === 'diameter' || drawingTool === 'radius' || drawingTool === 'hole_note'
  );
  const chamferCandidates = !preview && drawingTool === 'chamfer_note'
    ? drawingChamferCandidates(scene, displayView, projection)
    : [];
  const drawingAnchors = uniqueProjectionAnchors(
    projection.anchors.filter((anchor) => !anchor.hidden || view.show_hidden_lines),
    displayView,
  );
  const visibleCircles = projection.circles
    .filter((circle) => !circle.hidden || view.show_hidden_lines)
    .filter((circle) => activeRepairKind === 'circle' || ['dimension', 'radius', 'arc_length', 'jogged_radius'].includes(drawingTool ?? '') || circle.closed);
  const circleTargets = drawingTool === 'center_line' && centerlineEdgeDraft?.viewId === view.id
    ? []
    : centerPicking
      ? uniqueProjectionCircleCenters(visibleCircles)
      : visibleCircles;
  const linePickingTools = [
    'dimension', 'center_line', 'auxiliary_view', 'edge_requirement', 'weld',
    'datum', 'gdt', 'surface_texture', 'balloon',
  ];
  const allCenterlineEdges = (linePickingTools.includes(drawingTool ?? '') || activeRepairKind === 'line')
    && (drawingTool !== 'center_line' || circleDraft?.viewId !== view.id)
    ? drawingCenterlineEdgeCandidates(scene, displayView, projection)
    : [];
  const selectedCenterlineEdge = centerlineEdgeDraft?.viewId === view.id
    ? allCenterlineEdges.find((candidate) => sameDrawingLineRef(candidate.reference, centerlineEdgeDraft.reference)) ?? null
    : null;
  const centerlineEdgeTargets = drawingTool === 'dimension'
    ? allCenterlineEdges
    : selectedCenterlineEdge
    ? [
      selectedCenterlineEdge,
      ...allCenterlineEdges.filter((candidate) =>
        !sameDrawingLineRef(candidate.reference, selectedCenterlineEdge.reference)
          && drawingCenterlineEdgesCompatible(selectedCenterlineEdge, candidate),
      ),
    ]
    : allCenterlineEdges;
  const lineColor = preview ? '#6654c7' : '#17191c';
  const detailDerivation = view.derivation?.type === 'detail' ? view.derivation : null;
  const detailCenter = detailDerivation
    ? resolveDrawingAnchor(detailDerivation.center, displayView, projection)?.paper ?? null
    : null;
  const detailRadius = detailDerivation ? detailDerivation.radius * displayView.scale : 0;
  const detailClipId = `drawing-detail-clip-${view.id}`;
  const hatchPatternId = `drawing-section-hatch-${view.id}`;
  const brokenDerivation = view.derivation?.type === 'broken' ? view.derivation : null;
  const sectionLike = view.derivation?.type === 'section' || view.derivation?.type === 'removed_section';
  const sectionRegion = sectionLike ? sectionRegionPath(displayView, projection) : '';
  const sectionClipId = `drawing-section-region-${view.id}`;
  const removedSection = view.derivation?.type === 'removed_section';
  // Center geometry owns endpoint grips that must paint above overlapping
  // dimensions and model-edge pick targets. Keep every draggable annotation in
  // its stable paint position, though: reordering it during pointer-down would
  // interrupt that annotation's active pointer capture.
  const selectedAnnotation = selectedAnnotationId === null
    ? null
    : annotations.find((annotation) => annotation.id === selectedAnnotationId) ?? null;
  const selectedHasExtensionGrips = selectedAnnotation !== null && (
    selectedAnnotation.kind === 'center_mark'
      || selectedAnnotation.kind === 'center_line'
      || selectedAnnotation.kind === 'center_line_between_edges'
      || selectedAnnotation.kind === 'automatic_symmetry_axis'
      || selectedAnnotation.kind === 'bolt_circle_center_line'
  );
  const displayAnnotations = !selectedHasExtensionGrips
    ? annotations
    : [
      ...annotations.filter((annotation) => annotation.id !== selectedAnnotationId),
      ...annotations.filter((annotation) => annotation.id === selectedAnnotationId),
    ];

  return (
    <g
      data-drawing-view-id={preview ? undefined : view.id}
      data-testid={preview ? 'drawing-view-placement-preview' : undefined}
      data-preview-scale={preview ? view.scale : undefined}
      data-preview-x={preview ? position[0] : undefined}
      data-preview-y={preview ? position[1] : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={preview ? undefined : onPointerMove}
      onPointerUp={preview ? undefined : finishDrag}
      onPointerCancel={preview ? undefined : finishDrag}
      className={preview ? 'pointer-events-none' : drawingTool ? 'cursor-crosshair' : 'cursor-move'}
      opacity={preview ? 0.82 : 1}
    >
      <defs>
        {detailCenter && <clipPath id={detailClipId}><circle cx={detailCenter[0]} cy={detailCenter[1]} r={detailRadius} /></clipPath>}
        {sectionLike && <pattern id={hatchPatternId} patternUnits="userSpaceOnUse" width={style.hatch_spacing_mm} height={style.hatch_spacing_mm} patternTransform={`rotate(${view.derivation && 'hatch_angle_deg' in view.derivation ? view.derivation.hatch_angle_deg : style.hatch_angle_deg})`}><line x1="0" y1="0" x2="0" y2={style.hatch_spacing_mm} stroke="#65717c" {...hatchLine} /></pattern>}
        {sectionRegion && <clipPath id={sectionClipId}><path d={sectionRegion} fillRule="evenodd" /></clipPath>}
      </defs>
      <g clipPath={detailCenter ? `url(#${detailClipId})` : undefined}>
        {sectionLike && sectionRegion && <rect x={x} y={y} width={Math.max(width, 1)} height={Math.max(height, 1)} fill={`url(#${hatchPatternId})`} clipPath={`url(#${sectionClipId})`} opacity="0.9" />}
        {!removedSection && <g transform={drawingViewTransform(displayView, projection)} fill="none" stroke={lineColor} strokeLinecap="round" strokeLinejoin="round">
          {projection.visible.map((polyline, index) => <polyline key={`v-${index}`} points={polyline.points.map((point) => point.join(',')).join(' ')} vectorEffect="non-scaling-stroke" {...(preview ? { strokeWidth: Math.max(visibleLine.strokeWidth, 0.5) } : visibleLine)} />)}
          {projection.hidden.map((polyline, index) => <polyline key={`h-${index}`} points={polyline.points.map((point) => point.join(',')).join(' ')} vectorEffect="non-scaling-stroke" {...(preview ? { ...hiddenLine, strokeWidth: Math.max(hiddenLine.strokeWidth, 0.38) } : hiddenLine)} opacity="0.68" />)}
        </g>}
        {sectionLike && <g transform={drawingViewTransform(displayView, projection)} fill="none" stroke={lineColor} strokeLinecap="round" strokeLinejoin="round">{projection.section.map((polyline, index) => <polyline key={`s-${index}`} points={polyline.points.map((point) => point.join(',')).join(' ')} vectorEffect="non-scaling-stroke" {...visibleLine} />)}</g>}
        {brokenDerivation && <BrokenViewMask derivation={brokenDerivation} bounds={[x, y, width, height]} />}
      </g>
      {detailCenter && <circle cx={detailCenter[0]} cy={detailCenter[1]} r={detailRadius} fill="none" stroke={lineColor} strokeWidth="0.4" />}
      <rect
        x={x - 2}
        y={y - 2}
        width={Math.max(width + 4, 8)}
        height={Math.max(height + 4, 8)}
        fill={preview ? '#6654c7' : 'transparent'}
        fillOpacity={preview ? 0.055 : 0}
        stroke={preview || selected || drawingTool === 'symmetry_axis' ? '#6654c7' : 'transparent'}
        strokeWidth={preview ? 0.55 : 0.45}
        strokeDasharray="2 1"
        pointerEvents={drawingTool === 'symmetry_axis' ? 'all' : undefined}
        className={drawingTool === 'symmetry_axis' ? 'cursor-crosshair' : undefined}
        onPointerDown={drawingTool === 'symmetry_axis' ? (event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          onAddSymmetryAxis('both');
        } : undefined}
      />
      <text x={position[0]} y={labelY} fill={preview || selected ? '#6654c7' : '#4b5159'} fontFamily={style.font_family} fontSize={style.small_text_height_mm} fontWeight={preview ? 650 : 400} textAnchor="middle" className="pointer-events-none">{preview ? t('drawing.workspace.placePrefix') : ''}{view.name} · {scaleLabel(view.scale)}</text>
      {derivedChildren.map((child) => <DerivedViewSourceGraphic key={child.id} child={child} parentView={displayView} projection={projection} />)}
      {lineDimensionDraft?.viewId === view.id && (
        <LineDimensionPreviewGraphic
          draft={lineDimensionDraft}
          view={displayView}
          projection={projection}
          standard={standard}
        />
      )}
      {pointLineDimensionDraft?.viewId === view.id && (
        <PointLineDimensionPreviewGraphic
          draft={pointLineDimensionDraft}
          view={displayView}
          projection={projection}
          standard={standard}
        />
      )}
      {pickingAnchors && drawingAnchors.map((anchor) => {
        const paper = drawingProjectedPointToPaper(displayView, projection, anchor.point);
        const reference = drawingAnchorRef(anchor, projection);
        const active = anchorDraft?.viewId === view.id && anchorDraft.anchors.some((candidate) => sameDrawingAnchor(candidate, reference))
          || pointLineDimensionDraft?.viewId === view.id
            && sameDrawingAnchor(pointLineDimensionDraft.point, reference);
        return <circle key={`${anchor.occurrence_id ?? 'definition'}-${anchor.body_id}-${anchor.edge_id}-${anchor.endpoint}`} data-testid="drawing-annotation-anchor" data-body-id={anchor.body_id} data-edge-id={anchor.edge_id} cx={paper[0]} cy={paper[1]} r={active ? 1.7 : 1.15} fill={active ? '#6654c7' : '#fff'} stroke={active ? '#6654c7' : '#1688c9'} strokeWidth={active ? 0.65 : 0.48} className="cursor-crosshair" onPointerDown={(event) => { if (event.button !== 0) return; event.preventDefault(); event.stopPropagation(); if (repairTarget?.kind === 'anchor') { if (confirmRepair(repairTarget.label)) completeRepair(repairTarget.update(drawingAnchorRef(anchor, projection))); } else if (derivedRepairTarget?.kind === 'anchor') { if (confirmRepair(derivedRepairTarget.label)) completeDerivedRepair(derivedRepairTarget.update(drawingAnchorRef(anchor, projection))); } else onPickAnchor(view.id, anchor, paper); }} />;
      })}
      {pickingCircles && circleTargets.map((circle) => {
        const center = drawingProjectedPointToPaper(displayView, projection, circle.center);
        const feature = drawingCircularRef(circle, projection);
        const key = `${circle.occurrence_id ?? 'definition'}-${circle.body_id}-${circle.edge_id}`;
        const active = centerPicking && (
          circleDraft?.viewId === view.id
            && circleDraft.features.some((candidate) => sameDrawingCircle(candidate, feature))
          || anchorDraft?.viewId === view.id
            && anchorDraft.anchors.some((candidate) => sameDrawingAnchor(candidate, drawingCircleCenterAnchorRef(circle, projection)))
          || pointLineDimensionDraft?.viewId === view.id
            && sameDrawingAnchor(pointLineDimensionDraft.point, drawingCircleCenterAnchorRef(circle, projection))
        );
        const hovered = hoveredCircleKey === key;
        const color = active ? '#6654c7' : hovered ? '#d97706' : '#1688c9';
        const markerHalf = active || hovered ? 2.35 : 1.8;
        const smartDimension = drawingTool === 'dimension';
        const pickSmartCenter = (event: ReactPointerEvent<SVGCircleElement>) => {
          if (!smartDimension || event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          onPickCircleCenter(view.id, circle, center);
        };
        const pickSmartFeature = (event: ReactPointerEvent<SVGCircleElement>) => {
          if (!smartDimension || event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          pickCircle(circle);
        };
        return <g
          key={key}
          data-testid={centerPicking ? 'drawing-hole-center-target' : 'drawing-circle-target'}
          data-body-id={circle.body_id}
          data-edge-id={circle.edge_id}
          data-circle-center={centerPicking ? 'true' : undefined}
          className="cursor-crosshair"
          onPointerEnter={() => setHoveredCircleKey(key)}
          onPointerLeave={() => setHoveredCircleKey((current) => current === key ? null : current)}
          onPointerDown={(event) => { if (event.button !== 0) return; event.preventDefault(); event.stopPropagation(); pickCircle(circle); }}
        >
          <circle cx={center[0]} cy={center[1]} r={circle.radius * displayView.scale} fill="transparent" stroke={color} strokeWidth={active || hovered ? 0.82 : 0.6} strokeDasharray="1.4 0.8" pointerEvents="none" />
          <circle
            data-testid={smartDimension ? 'drawing-smart-dimension-feature-target' : undefined}
            cx={center[0]}
            cy={center[1]}
            r={Math.max(4, circle.radius * displayView.scale)}
            fill="transparent"
            stroke="transparent"
            strokeWidth="4"
            pointerEvents={smartDimension ? 'stroke' : 'all'}
            onPointerDown={smartDimension ? pickSmartFeature : undefined}
          />
          <path d={`M${center[0] - markerHalf} ${center[1]}h${markerHalf * 2}M${center[0]} ${center[1] - markerHalf}v${markerHalf * 2}`} stroke={color} strokeWidth={active || hovered ? 0.72 : 0.52} />
          <circle cx={center[0]} cy={center[1]} r={active || hovered ? 0.72 : 0.5} fill="#fff" stroke={color} strokeWidth="0.42" />
          {smartDimension && <circle
            data-testid="drawing-smart-dimension-center-target"
            cx={center[0]}
            cy={center[1]}
            r="3.1"
            fill="transparent"
            pointerEvents="all"
            onPointerDown={pickSmartCenter}
          ><title>{t('drawing.workspace.centerPointForLinearDimension')}</title></circle>}
          <title>{smartDimension ? t('drawing.workspace.circleEdgeOrCenterForSmartDimension') : centerPicking ? t('drawing.workspace.circularCenter') : t('drawing.workspace.circularEdge')}</title>
        </g>;
      })}
      {centerlineEdgeTargets.length > 0 && (
        <g
          data-testid="drawing-centerline-edge-candidates"
          onPointerLeave={() => setHoveredCenterlineEdgeKey(null)}
        >
          {centerlineEdgeTargets.map((candidate) => {
            const active = centerlineEdgeDraft?.viewId === view.id
              && sameDrawingLineRef(centerlineEdgeDraft.reference, candidate.reference)
              || lineDimensionDraft?.viewId === view.id
                && (sameDrawingLineRef(lineDimensionDraft.first, candidate.reference)
                  || (lineDimensionDraft.second !== null
                    && sameDrawingLineRef(lineDimensionDraft.second, candidate.reference)))
              || pointLineDimensionDraft?.viewId === view.id
                && sameDrawingLineRef(pointLineDimensionDraft.line, candidate.reference);
            const hovered = hoveredCenterlineEdgeKey === candidate.key;
            const color = active ? '#6654c7' : hovered ? '#d97706' : '#1688c9';
            const hitVector: [number, number] = [
              candidate.paperEnd[0] - candidate.paperStart[0],
              candidate.paperEnd[1] - candidate.paperStart[1],
            ];
            const hitLength = Math.hypot(...hitVector);
            const hitInset = Math.min(2.4, hitLength * 0.22);
            const hitDirection: [number, number] = [hitVector[0] / hitLength, hitVector[1] / hitLength];
            const hitStart: [number, number] = [
              candidate.paperStart[0] + hitDirection[0] * hitInset,
              candidate.paperStart[1] + hitDirection[1] * hitInset,
            ];
            const hitEnd: [number, number] = [
              candidate.paperEnd[0] - hitDirection[0] * hitInset,
              candidate.paperEnd[1] - hitDirection[1] * hitInset,
            ];
            return <g
              key={candidate.key}
              data-testid="drawing-centerline-edge-target"
              data-drawing-line-dimension-target={drawingTool === 'dimension' ? 'true' : undefined}
              data-body-id={candidate.reference.body_id}
              data-edge-id={candidate.reference.edge_id}
              data-start-x={candidate.paperStart[0]}
              data-start-y={candidate.paperStart[1]}
              data-end-x={candidate.paperEnd[0]}
              data-end-y={candidate.paperEnd[1]}
              className="cursor-crosshair"
              onPointerEnter={(event) => {
                const nearest = nearestDrawingCenterlineEdgeCandidate(
                  drawingSheetPoint(event, sheetWidth, sheetHeight),
                  centerlineEdgeTargets,
                  candidate.key,
                );
                setHoveredCenterlineEdgeKey(nearest?.key ?? candidate.key);
              }}
              onPointerMove={(event) => {
                const nearest = nearestDrawingCenterlineEdgeCandidate(
                  drawingSheetPoint(event, sheetWidth, sheetHeight),
                  centerlineEdgeTargets,
                  candidate.key,
                );
                setHoveredCenterlineEdgeKey(nearest?.key ?? candidate.key);
              }}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                event.stopPropagation();
                const picked = nearestDrawingCenterlineEdgeCandidate(
                  drawingSheetPoint(event, sheetWidth, sheetHeight),
                  centerlineEdgeTargets,
                  candidate.key,
                ) ?? candidate;
                if (repairTarget?.kind === 'line') {
                  if (confirmRepair(repairTarget.label)) completeRepair(repairTarget.update(picked.reference));
                } else if (derivedRepairTarget?.kind === 'line') {
                  if (confirmRepair(derivedRepairTarget.label)) completeDerivedRepair(derivedRepairTarget.update(picked.reference));
                } else {
                  onPickCenterlineEdge(view.id, picked);
                }
              }}
            >
              <line
                x1={candidate.paperStart[0]}
                y1={candidate.paperStart[1]}
                x2={candidate.paperEnd[0]}
                y2={candidate.paperEnd[1]}
                stroke={color}
                strokeWidth={active ? 1.1 : hovered ? 0.95 : 0.72}
                strokeDasharray={candidate.hidden ? '1.5 1' : undefined}
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
              <line
                x1={hitStart[0]}
                y1={hitStart[1]}
                x2={hitEnd[0]}
                y2={hitEnd[1]}
                stroke="transparent"
                strokeWidth="7"
                pointerEvents="stroke"
              />
              <title>{drawingTool === 'dimension'
                ? active ? t('drawing.workspace.selectedDimensionEdge') : t('drawing.workspace.straightEdgeForSmartDimension')
                : active ? t('drawing.workspace.firstSymmetryEdgeSelected')
                  : drawingTool === 'center_line' ? t('drawing.workspace.straightEdgeForCenterline') : t('drawing.workspace.selectableStraightEdge')}</title>
            </g>;
          })}
        </g>
      )}
      {chamferCandidates.length > 0 && (
        <g data-testid="drawing-chamfer-candidates">
          {chamferCandidates.map((candidate) => {
            const active = chamferDraft?.viewId === view.id
              && chamferDraft.candidate.key === candidate.key;
            const hovered = hoveredChamferKey === candidate.key;
            const color = active ? '#6654c7' : hovered ? '#d97706' : '#1688c9';
            return <g
              key={candidate.key}
              data-chamfer-candidate="true"
              data-testid="drawing-chamfer-candidate"
              data-body-id={candidate.bodyId}
              data-edge-id={candidate.edgeId}
              className="cursor-crosshair"
              onPointerEnter={() => setHoveredChamferKey(candidate.key)}
              onPointerLeave={() => setHoveredChamferKey((current) => current === candidate.key ? null : current)}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                event.stopPropagation();
                onSelectChamferCandidate(view.id, candidate);
              }}
            >
              <line
                x1={candidate.paperStart[0]}
                y1={candidate.paperStart[1]}
                x2={candidate.paperEnd[0]}
                y2={candidate.paperEnd[1]}
                stroke={color}
                strokeWidth={active ? 1.15 : hovered ? 1 : 0.78}
                strokeDasharray={candidate.hidden ? '1.5 1' : undefined}
                vectorEffect="non-scaling-stroke"
              />
              <circle cx={candidate.paperStart[0]} cy={candidate.paperStart[1]} r={active || hovered ? 1.45 : 1.05} fill="#fff" stroke={color} strokeWidth="0.5" />
              <circle cx={candidate.paperEnd[0]} cy={candidate.paperEnd[1]} r={active || hovered ? 1.45 : 1.05} fill="#fff" stroke={color} strokeWidth="0.5" />
              <line
                x1={candidate.paperStart[0]}
                y1={candidate.paperStart[1]}
                x2={candidate.paperEnd[0]}
                y2={candidate.paperEnd[1]}
                stroke="transparent"
                strokeWidth="7"
                pointerEvents="stroke"
              />
              <title>{t('drawing.workspace.chamferPreviewTitle').replace('{distance}', trimNumber(candidate.distance)).replace('{angle}', trimNumber(candidate.angleDeg))}</title>
            </g>;
          })}
        </g>
      )}
      {displayAnnotations.map((annotation) => {
        const annotationSelected = selectedAnnotationId === annotation.id;
        return <g
          key={annotation.id}
          pointerEvents={drawingTool && !annotationSelected ? 'none' : undefined}
        >
          <DrawingAnnotationGraphic
            annotation={annotation}
            view={displayView}
            projection={projection}
            standard={standard}
            sheetWidth={sheetWidth}
            sheetHeight={sheetHeight}
            selected={annotationSelected}
            onSelect={() => onSelectAnnotation(annotation.id)}
          />
        </g>;
      })}
    </g>
  );
}

function DerivedViewSourceGraphic({ child, parentView, projection }: {
  child: DrawingViewDto;
  parentView: DrawingViewDto;
  projection: DrawingProjectionDto;
}) {
  const scene = useAppStore((state) => state.solidScene);
  const solution = useAppStore((state) => state.assemblySolution);
  const drawings = useAppStore((state) => state.drawingDocument);
  const cuttingLine = useDrawingLine('cutting_plane');
  const phantomLine = useDrawingLine('phantom');
  const breakLine = useDrawingLine('break_line');
  const derivation = child.derivation;
  if (!derivation) return null;
  const color = '#5d50c8';
  const views = drawings.sheets.flatMap((sheet) => sheet.views);
  const source = (reference: DrawingTopologyAnchorRefDto) => drawingSourceAnchorPoint(reference, parentView, views, scene, projection, solution);
  if (derivation.type === 'section' || derivation.type === 'removed_section') {
    const firstPoint = source(derivation.first);
    const secondPoint = source(derivation.second);
    if (!firstPoint || !secondPoint) return null;
    const ends = drawingSectionSourceExtent(firstPoint, secondPoint, parentView, projection);
    if (!ends) return null;
    const first = { paper: ends[0] };
    const second = { paper: ends[1] };
    const direction = normalize2([second.paper[0] - first.paper[0], second.paper[1] - first.paper[1]]);
    const normal: [number, number] = [-direction[1], direction[0]];
    const arrowEnd: [number, number] = [first.paper[0] + normal[0] * 5, first.paper[1] + normal[1] * 5];
    const arrowEnd2: [number, number] = [second.paper[0] + normal[0] * 5, second.paper[1] + normal[1] * 5];
    return <g data-testid="drawing-cutting-plane" className="pointer-events-none" fill={color} stroke={color}>
      <path d={`M${first.paper.join(' ')}L${second.paper.join(' ')}`} fill="none" {...cuttingLine} />
      <polygon points={arrowPolygon(first.paper, arrowEnd, 2.4)} />
      <polygon points={arrowPolygon(second.paper, arrowEnd2, 2.4)} />
      <OutlinedText x={first.paper[0] - direction[0] * 4} y={first.paper[1] - direction[1] * 4} color={color} selected>{shortDerivedLabel(derivation.label)}</OutlinedText>
      <OutlinedText x={second.paper[0] + direction[0] * 4} y={second.paper[1] + direction[1] * 4} color={color} selected>{shortDerivedLabel(derivation.label)}</OutlinedText>
    </g>;
  }
  if (derivation.type === 'detail') {
    const center = source(derivation.center);
    if (!center) return null;
    const radius = derivation.radius * parentView.scale;
    return <g data-testid="drawing-detail-boundary" className="pointer-events-none" fill="none" stroke={color}>
      <circle cx={center[0]} cy={center[1]} r={radius} {...phantomLine} />
      <OutlinedText x={center[0] + radius + 3} y={center[1] - radius - 1} color={color} selected textAnchor="start">{derivation.label}</OutlinedText>
    </g>;
  }
  if (derivation.type === 'auxiliary') {
    const line = resolveDrawingLine(derivation.reference, parentView, projection);
    if (!line) return null;
    const center = midpoint2(line.start, line.end);
    const direction = normalize2([line.end[0] - line.start[0], line.end[1] - line.start[1]]);
    const normal: [number, number] = [-direction[1], direction[0]];
    const arrow: [number, number] = [center[0] + normal[0] * (derivation.flipped ? -8 : 8), center[1] + normal[1] * (derivation.flipped ? -8 : 8)];
    return <g data-testid="drawing-auxiliary-reference" className="pointer-events-none" fill={color} stroke={color}>
      <path d={`M${line.start.join(' ')}L${line.end.join(' ')}`} fill="none" {...phantomLine} />
      <path d={`M${center.join(' ')}L${arrow.join(' ')}`} fill="none" strokeWidth="0.48" />
      <polygon points={arrowPolygon(arrow, center, 2.2)} />
      <OutlinedText x={arrow[0] + normal[0] * 3} y={arrow[1] + normal[1] * 3} color={color} selected>{derivation.label}</OutlinedText>
    </g>;
  }
  if (derivation.type === 'broken') {
    const [x, y, width, height] = drawingViewPaperBounds(parentView, projection);
    const center = derivation.axis === 'horizontal' ? x + width / 2 : y + height / 2;
    return <g data-testid="drawing-break-source" className="pointer-events-none" stroke={color} fill="none">
      <path d={derivation.axis === 'horizontal'
        ? breakZigzagPath(center, y, y + height, 'vertical')
        : breakZigzagPath(center, x, x + width, 'horizontal')} {...breakLine} />
    </g>;
  }
  return null;
}

function BrokenViewMask({ derivation, bounds }: {
  derivation: Extract<NonNullable<DrawingViewDto['derivation']>, { type: 'broken' }>;
  bounds: [number, number, number, number];
}) {
  const breakLine = useDrawingLine('break_line');
  const [x, y, width, height] = bounds;
  const gap = Math.max(3, derivation.gap_mm);
  if (derivation.axis === 'horizontal') {
    const center = x + width / 2;
    return <g data-testid="drawing-broken-view-mask"><rect x={center - gap / 2} y={y - 1} width={gap} height={height + 2} fill="#fff" /><path d={breakZigzagPath(center - gap / 2, y, y + height, 'vertical')} fill="none" stroke="#17191c" {...breakLine} /><path d={breakZigzagPath(center + gap / 2, y, y + height, 'vertical')} fill="none" stroke="#17191c" {...breakLine} /></g>;
  }
  const center = y + height / 2;
  return <g data-testid="drawing-broken-view-mask"><rect x={x - 1} y={center - gap / 2} width={width + 2} height={gap} fill="#fff" /><path d={breakZigzagPath(center - gap / 2, x, x + width, 'horizontal')} fill="none" stroke="#17191c" {...breakLine} /><path d={breakZigzagPath(center + gap / 2, x, x + width, 'horizontal')} fill="none" stroke="#17191c" {...breakLine} /></g>;
}

function breakZigzagPath(position: number, start: number, end: number, orientation: 'horizontal' | 'vertical'): string {
  const middle = (start + end) / 2;
  return orientation === 'vertical'
    ? `M${position} ${start}L${position} ${middle - 4}l-2 2 4 2-4 2 2 2L${position} ${end}`
    : `M${start} ${position}L${middle - 4} ${position}l2 -2 2 4 2-4 2 2L${end} ${position}`;
}

function sectionRegionPath(view: DrawingViewDto, projection: DrawingProjectionDto): string {
  const edges = projection.section.flatMap((polyline) => polyline.points.slice(1).map((point, index) => [
    drawingProjectedPointToPaper(view, projection, polyline.points[index]),
    drawingProjectedPointToPaper(view, projection, point),
  ] as [[number, number], [number, number]])).filter(([first, second]) => Math.hypot(first[0] - second[0], first[1] - second[1]) > 1e-5);
  if (edges.length === 0) return '';
  const key = (point: [number, number]) => `${Math.round(point[0] * 1000)},${Math.round(point[1] * 1000)}`;
  const adjacency = new Map<string, number[]>();
  edges.forEach((edge, index) => edge.forEach((point) => adjacency.set(key(point), [...(adjacency.get(key(point)) ?? []), index])));
  const used = new Set<number>();
  const loops: Array<Array<[number, number]>> = [];
  for (let seed = 0; seed < edges.length; seed += 1) {
    if (used.has(seed)) continue;
    used.add(seed);
    const chain: Array<[number, number]> = [edges[seed][0], edges[seed][1]];
    for (let guard = 0; guard < edges.length; guard += 1) {
      const end = chain[chain.length - 1];
      if (chain.length > 2 && key(end) === key(chain[0])) break;
      const nextIndex = (adjacency.get(key(end)) ?? []).find((candidate) => !used.has(candidate));
      if (nextIndex === undefined) break;
      used.add(nextIndex);
      const next = edges[nextIndex];
      chain.push(key(next[0]) === key(end) ? next[1] : next[0]);
    }
    if (chain.length >= 4 && key(chain[0]) === key(chain[chain.length - 1])) loops.push(chain);
  }
  return loops.map((loop) => `M${loop.map((point) => point.join(' ')).join('L')}Z`).join(' ');
}

function shortDerivedLabel(label: string): string { const parts = label.trim().split(/\s+/); return parts[parts.length - 1] || label; }

function DrawingAnnotationGraphic({
  annotation,
  view,
  projection,
  standard,
  sheetWidth,
  sheetHeight,
  selected,
  onSelect,
}: {
  annotation: DrawingAnnotationDto;
  view: DrawingViewDto;
  projection: DrawingProjectionDto;
  standard: DrawingStandard;
  sheetWidth: number;
  sheetHeight: number;
  selected: boolean;
  onSelect: () => void;
}) {
  switch (annotation.kind) {
    case 'linear_dimension': return <LinearDimensionGraphic annotation={annotation} view={view} projection={projection} standard={standard} sheetWidth={sheetWidth} sheetHeight={sheetHeight} selected={selected} onSelect={onSelect} />;
    case 'line_dimension': return <LineDimensionGraphic annotation={annotation} view={view} projection={projection} standard={standard} sheetWidth={sheetWidth} sheetHeight={sheetHeight} selected={selected} onSelect={onSelect} />;
    case 'point_line_dimension': return <PointLineDimensionGraphic annotation={annotation} view={view} projection={projection} standard={standard} sheetWidth={sheetWidth} sheetHeight={sheetHeight} selected={selected} onSelect={onSelect} />;
    case 'radial_dimension': return <RadialDimensionGraphic annotation={annotation} view={view} projection={projection} standard={standard} sheetWidth={sheetWidth} sheetHeight={sheetHeight} selected={selected} onSelect={onSelect} />;
    case 'angular_dimension': return <AngularDimensionGraphic annotation={annotation} view={view} projection={projection} standard={standard} sheetWidth={sheetWidth} sheetHeight={sheetHeight} selected={selected} onSelect={onSelect} />;
    case 'hole_note': return <HoleNoteGraphic annotation={annotation} view={view} projection={projection} sheetWidth={sheetWidth} sheetHeight={sheetHeight} selected={selected} onSelect={onSelect} />;
    case 'chamfer_note': return <ChamferNoteGraphic annotation={annotation} view={view} projection={projection} standard={standard} sheetWidth={sheetWidth} sheetHeight={sheetHeight} selected={selected} onSelect={onSelect} />;
    case 'center_mark': return <CenterMarkGraphic annotation={annotation} view={view} projection={projection} sheetWidth={sheetWidth} sheetHeight={sheetHeight} selected={selected} onSelect={onSelect} />;
    case 'center_line': return <CenterLineGraphic annotation={annotation} view={view} projection={projection} sheetWidth={sheetWidth} sheetHeight={sheetHeight} selected={selected} onSelect={onSelect} />;
    case 'center_line_between_edges': return <CenterLineBetweenEdgesGraphic annotation={annotation} view={view} projection={projection} sheetWidth={sheetWidth} sheetHeight={sheetHeight} selected={selected} onSelect={onSelect} />;
    case 'automatic_symmetry_axis': return <AutomaticSymmetryAxisGraphic annotation={annotation} view={view} projection={projection} sheetWidth={sheetWidth} sheetHeight={sheetHeight} selected={selected} onSelect={onSelect} />;
    case 'bolt_circle_center_line': return <BoltCircleCenterLineGraphic annotation={annotation} view={view} projection={projection} sheetWidth={sheetWidth} sheetHeight={sheetHeight} selected={selected} onSelect={onSelect} />;
    case 'chain_dimension': return <ChainDimensionGraphic annotation={annotation} view={view} projection={projection} standard={standard} sheetWidth={sheetWidth} sheetHeight={sheetHeight} selected={selected} onSelect={onSelect} />;
    case 'ordinate_dimension': return <OrdinateDimensionGraphic annotation={annotation} view={view} projection={projection} standard={standard} sheetWidth={sheetWidth} sheetHeight={sheetHeight} selected={selected} onSelect={onSelect} />;
    case 'arc_length_dimension': return <ArcLengthDimensionGraphic annotation={annotation} view={view} projection={projection} standard={standard} sheetWidth={sheetWidth} sheetHeight={sheetHeight} selected={selected} onSelect={onSelect} />;
    case 'jogged_radius_dimension': return <JoggedRadiusDimensionGraphic annotation={annotation} view={view} projection={projection} standard={standard} sheetWidth={sheetWidth} sheetHeight={sheetHeight} selected={selected} onSelect={onSelect} />;
    case 'datum_feature': return <DatumFeatureGraphic annotation={annotation} view={view} projection={projection} sheetWidth={sheetWidth} sheetHeight={sheetHeight} selected={selected} onSelect={onSelect} />;
    case 'gdt_frame': return <GdtFrameGraphic annotation={annotation} view={view} projection={projection} sheetWidth={sheetWidth} sheetHeight={sheetHeight} selected={selected} onSelect={onSelect} />;
    case 'surface_texture': return <SurfaceTextureGraphic annotation={annotation} view={view} projection={projection} sheetWidth={sheetWidth} sheetHeight={sheetHeight} selected={selected} onSelect={onSelect} />;
    case 'edge_requirement': return <EdgeRequirementGraphic annotation={annotation} view={view} projection={projection} sheetWidth={sheetWidth} sheetHeight={sheetHeight} selected={selected} onSelect={onSelect} />;
    case 'weld_symbol': return <WeldSymbolGraphic annotation={annotation} view={view} projection={projection} sheetWidth={sheetWidth} sheetHeight={sheetHeight} selected={selected} onSelect={onSelect} />;
    case 'item_balloon': return <ItemBalloonGraphic annotation={annotation} view={view} projection={projection} sheetWidth={sheetWidth} sheetHeight={sheetHeight} selected={selected} onSelect={onSelect} />;
    case 'note':
    case 'revision_cloud': return null;
  }
}

function ChamferPlacementPreview({
  draft,
  standard,
}: {
  draft: NonNullable<ChamferDraft>;
  standard: DrawingStandard;
}) {
  const units = useAppStore((state) => state.document?.settings.units ?? 'mm');
  const leaderLine = useDrawingLine('leader');
  const style = useDrawingStyle();
  const { candidate, position } = draft;
  const label = drawingChamferText(
    candidate.distance,
    candidate.angleDeg,
    '',
    standard,
    units,
  );
  return <g
    data-testid="drawing-chamfer-placement-preview"
    className="pointer-events-none"
    fill="#6654c7"
    stroke="#6654c7"
  >
    <path d={`M${candidate.attachment.join(' ')}L${position.join(' ')}`} fill="none" {...leaderLine} />
    <polygon points={arrowPolygon(candidate.attachment, position, style.arrow_size_mm)} />
    <OutlinedText x={position[0] + 1.2} y={position[1] - 0.8} color="#6654c7" selected textAnchor="start">{label}</OutlinedText>
  </g>;
}

function LineDimensionPreviewGraphic({
  draft,
  view,
  projection,
  standard,
}: {
  draft: NonNullable<LineDimensionDraft>;
  view: DrawingViewDto;
  projection: DrawingProjectionDto;
  standard: DrawingStandard;
}) {
  const first = resolveDrawingLine(draft.first, view, projection);
  const second = draft.second ? resolveDrawingLine(draft.second, view, projection) : null;
  if (!first || (draft.second && !second)) return null;
  const geometry = lineDimensionGeometry(first, second, draft.mode, draft.position, view.scale);
  if (!geometry) return null;
  return <g data-testid="drawing-line-dimension-preview" className="pointer-events-none">
    <LineDimensionShape
      geometry={geometry}
      precision={draft.mode === 'angle' ? 1 : 2}
      prefix=""
      suffix=""
      presentation={defaultDrawingDimensionPresentation()}
      standard={standard}
      color="#6654c7"
      active
    />
  </g>;
}

function PointLineDimensionPreviewGraphic({
  draft,
  view,
  projection,
  standard,
}: {
  draft: NonNullable<PointLineDimensionDraft>;
  view: DrawingViewDto;
  projection: DrawingProjectionDto;
  standard: DrawingStandard;
}) {
  const point = resolveDrawingAnchor(draft.point, view, projection);
  const line = resolveDrawingLine(draft.line, view, projection);
  if (!point || !line) return null;
  const geometry = pointLineDimensionGeometry(point, line, draft.position, view.scale);
  if (!geometry) return null;
  return <g data-testid="drawing-point-line-dimension-preview" className="pointer-events-none">
    <LineDimensionShape
      geometry={{ kind: 'linear', geometry }}
      precision={2}
      prefix=""
      suffix=""
      presentation={defaultDrawingDimensionPresentation()}
      standard={standard}
      color="#6654c7"
      active
    />
  </g>;
}

function PointLineDimensionGraphic({
  annotation,
  view,
  projection,
  standard,
  sheetWidth,
  sheetHeight,
  selected,
  onSelect,
}: AnnotationGraphicProps<'point_line_dimension'> & DrawingSheetBounds & { standard: DrawingStandard }) {
  const point = resolveDrawingAnchor(annotation.point, view, projection);
  const line = resolveDrawingLine(annotation.line, view, projection);
  if (!point || !line) return <BrokenAnnotation view={view} onSelect={onSelect} />;
  return <DraggableAnnotationGraphic
    id={annotation.id}
    testId="drawing-point-line-dimension"
    sheetWidth={sheetWidth}
    sheetHeight={sheetHeight}
    onSelect={onSelect}
    updateForDelta={(delta) => ({
      position: boundedDrawingPoint(addPaperDelta(annotation.position, delta), sheetWidth, sheetHeight),
    })}
  >
    {(delta, dragging) => {
      const position = boundedDrawingPoint(addPaperDelta(annotation.position, delta), sheetWidth, sheetHeight);
      const geometry = pointLineDimensionGeometry(point, line, position, view.scale);
      if (!geometry) return null;
      const active = selected || dragging;
      return <LineDimensionShape
        geometry={{ kind: 'linear', geometry }}
        precision={annotation.precision}
        prefix={annotation.prefix}
        suffix={annotation.suffix}
        presentation={annotation.presentation}
        standard={standard}
        color={active ? '#6654c7' : '#23272d'}
        active={active}
      />;
    }}
  </DraggableAnnotationGraphic>;
}

function LineDimensionGraphic({
  annotation,
  view,
  projection,
  standard,
  sheetWidth,
  sheetHeight,
  selected,
  onSelect,
}: AnnotationGraphicProps<'line_dimension'> & DrawingSheetBounds & { standard: DrawingStandard }) {
  const first = resolveDrawingLine(annotation.first, view, projection);
  const second = annotation.second ? resolveDrawingLine(annotation.second, view, projection) : null;
  if (!first || (annotation.second && !second)) return <BrokenAnnotation view={view} onSelect={onSelect} />;
  return <DraggableAnnotationGraphic
    id={annotation.id}
    testId="drawing-line-dimension"
    sheetWidth={sheetWidth}
    sheetHeight={sheetHeight}
    onSelect={onSelect}
    updateForDelta={(delta) => ({
      position: boundedDrawingPoint(addPaperDelta(annotation.position, delta), sheetWidth, sheetHeight),
    })}
  >
    {(delta, dragging) => {
      const position = boundedDrawingPoint(addPaperDelta(annotation.position, delta), sheetWidth, sheetHeight);
      const geometry = lineDimensionGeometry(first, second, annotation.mode, position, view.scale);
      if (!geometry) return null;
      const active = selected || dragging;
      return <LineDimensionShape
        geometry={geometry}
        precision={annotation.precision}
        prefix={annotation.prefix}
        suffix={annotation.suffix}
        presentation={annotation.presentation}
        standard={standard}
        color={active ? '#6654c7' : '#23272d'}
        active={active}
      />;
    }}
  </DraggableAnnotationGraphic>;
}

function LineDimensionShape({
  geometry,
  precision,
  prefix,
  suffix,
  presentation,
  standard,
  color,
  active,
}: {
  geometry: NonNullable<ReturnType<typeof lineDimensionGeometry>>;
  precision: number;
  prefix: string;
  suffix: string;
  presentation: DrawingDimensionPresentationDto;
  standard: DrawingStandard;
  color: string;
  active: boolean;
}) {
  const units = useAppStore((state) => state.document?.settings.units ?? 'mm');
  const dimensionLine = useDrawingLine('dimension');
  if (geometry.kind === 'angular') {
    const value = geometry.geometry;
    const path = `M${value.vertex.join(' ')}L${value.firstRay.join(' ')} M${value.vertex.join(' ')}L${value.secondRay.join(' ')} ${value.arcPath}`;
    const text = drawingAngularDimensionText(value.value, precision, prefix, suffix, presentation, standard);
    return <>
      <path d={path} fill="none" stroke={color} {...dimensionLine} strokeWidth={active ? dimensionLine.strokeWidth + 0.14 : dimensionLine.strokeWidth} />
      <path d={path} fill="none" stroke="transparent" strokeWidth="5" />
      <DimensionValueText x={value.textPosition[0]} y={value.textPosition[1]} color={color} selected={active}>{text}</DimensionValueText>
    </>;
  }
  const value = geometry.geometry;
  const text = drawingDimensionText(value.value, precision, prefix, suffix, units, presentation, standard);
  return <LinearDimensionShape geometry={value} text={text} standard={standard} color={color} active={active} />;
}

function LinearDimensionShape({
  geometry,
  text,
  standard,
  color,
  active,
}: {
  geometry: NonNullable<ReturnType<typeof linearDimensionGeometry>>;
  text: string;
  standard: DrawingStandard;
  color: string;
  active: boolean;
}) {
  const style = useDrawingStyle();
  const dimensionLine = useDrawingLine('dimension');
  const layout = drawingLinearDimensionLayout(
    geometry,
    text,
    style.text_height_mm,
    style.arrow_size_mm,
    standard,
  );
  const path = `M${geometry.firstExtension[0].join(' ')}L${geometry.firstExtension[1].join(' ')} M${geometry.secondExtension[0].join(' ')}L${geometry.secondExtension[1].join(' ')} M${layout.lineStart.join(' ')}L${layout.lineEnd.join(' ')}`;
  const textBaselineOffset = layout.maskDimensionLine
    ? 0.8
    : Math.max(1.2, style.text_height_mm * 0.22 + dimensionLine.strokeWidth * 2);
  const transform = `rotate(${geometry.textAngle} ${layout.textPosition[0]} ${layout.textPosition[1]})`;
  return <g
    data-testid="drawing-linear-dimension-layout"
    data-dimension-arrows={layout.arrowsOutside ? 'outside' : 'inside'}
    data-dimension-text={layout.textOutside ? 'outside' : 'inside'}
    data-dimension-line={layout.maskDimensionLine ? 'interrupted' : 'continuous'}
  >
    <path d={path} fill="none" stroke={color} {...dimensionLine} strokeWidth={active ? dimensionLine.strokeWidth + 0.14 : dimensionLine.strokeWidth} />
    <path d={path} fill="none" stroke="transparent" strokeWidth="5" />
    <polygon data-testid="drawing-dimension-arrow" points={arrowPolygon(geometry.dimensionStart, layout.firstArrowToward, style.arrow_size_mm)} fill={color} />
    <polygon data-testid="drawing-dimension-arrow" points={arrowPolygon(geometry.dimensionEnd, layout.secondArrowToward, style.arrow_size_mm)} fill={color} />
    <DimensionValueText
      x={layout.textPosition[0]}
      y={layout.textPosition[1] - textBaselineOffset}
      color={color}
      selected={active}
      transform={transform}
      maskDimensionLine={layout.maskDimensionLine}
    >{text}</DimensionValueText>
  </g>;
}

function LinearDimensionGraphic({
  annotation,
  view,
  projection,
  standard,
  sheetWidth,
  sheetHeight,
  selected,
  onSelect,
}: AnnotationGraphicProps<'linear_dimension'> & DrawingSheetBounds & { standard: DrawingStandard }) {
  const units = useAppStore((state) => state.document?.settings.units ?? 'mm');
  const first = resolveDrawingAnchor(annotation.first, view, projection);
  const second = resolveDrawingAnchor(annotation.second, view, projection);
  if (!first || !second) return <BrokenAnnotation view={view} onSelect={onSelect} />;
  const offsetForDelta = (delta: PaperDelta) => linearDimensionOffsetAfterDrag(
    first.paper,
    second.paper,
    annotation.mode,
    annotation.offset,
    delta,
  );
  return <DraggableAnnotationGraphic
    id={annotation.id}
    testId="drawing-linear-dimension"
    sheetWidth={sheetWidth}
    sheetHeight={sheetHeight}
    onSelect={onSelect}
    updateForDelta={(delta) => ({ offset: offsetForDelta(delta) })}
  >
    {(delta, dragging) => {
      const geometry = linearDimensionGeometry(first, second, annotation.mode, offsetForDelta(delta), view.scale);
      if (!geometry) return null;
      const active = selected || dragging;
      const color = active ? '#6654c7' : '#23272d';
      const text = drawingDimensionText(geometry.value, annotation.precision, annotation.prefix, annotation.suffix, units, annotation.presentation, standard);
      return <LinearDimensionShape geometry={geometry} text={text} standard={standard} color={color} active={active} />;
    }}
  </DraggableAnnotationGraphic>;
}

function RadialDimensionGraphic({
  annotation,
  view,
  projection,
  standard,
  sheetWidth,
  sheetHeight,
  selected,
  onSelect,
}: AnnotationGraphicProps<'radial_dimension'> & DrawingSheetBounds & { standard: DrawingStandard }) {
  const units = useAppStore((state) => state.document?.settings.units ?? 'mm');
  const dimensionLine = useDrawingLine('dimension');
  const style = useDrawingStyle();
  const resolved = resolveDrawingCircle(annotation.feature, view, projection);
  if (!resolved) return <BrokenAnnotation view={view} onSelect={onSelect} />;
  const symbol = annotation.mode === 'diameter' ? '⌀' : 'R';
  const baseGeometry = radialDimensionGeometry(resolved, annotation.mode, annotation.leader_angle_deg, annotation.offset);
  const placementForDelta = (delta: PaperDelta) => radialDimensionPlacementAfterDrag(
    resolved.center,
    resolved.paperRadius,
    baseGeometry.shoulder,
    delta,
  );
  return <DraggableAnnotationGraphic
    id={annotation.id}
    testId="drawing-radial-dimension"
    sheetWidth={sheetWidth}
    sheetHeight={sheetHeight}
    onSelect={onSelect}
    updateForDelta={(delta) => placementForDelta(delta)}
  >
    {(delta, dragging) => {
      const placement = placementForDelta(delta);
      const geometry = radialDimensionGeometry(resolved, annotation.mode, placement.leader_angle_deg, placement.offset);
      const active = selected || dragging;
      const color = active ? '#6654c7' : '#23272d';
      const text = drawingDimensionText(geometry.value, annotation.precision, `${annotation.prefix}${symbol}`, annotation.suffix, units, annotation.presentation, standard);
      const path = `M${geometry.center.join(' ')}L${geometry.featurePoint.join(' ')}L${geometry.shoulder.join(' ')}`;
      return <>
        <path d={path} fill="none" stroke={color} {...dimensionLine} strokeWidth={active ? dimensionLine.strokeWidth + 0.14 : dimensionLine.strokeWidth} />
        <path d={path} fill="none" stroke="transparent" strokeWidth="5" />
        <polygon points={arrowPolygon(geometry.featurePoint, geometry.center, style.arrow_size_mm)} fill={color} />
        <DimensionValueText x={geometry.textPosition[0]} y={geometry.textPosition[1]} color={color} selected={active} textAnchor={geometry.textPosition[0] >= geometry.center[0] ? 'start' : 'end'}>{text}</DimensionValueText>
      </>;
    }}
  </DraggableAnnotationGraphic>;
}

function AngularDimensionGraphic({
  annotation,
  view,
  projection,
  standard,
  sheetWidth,
  sheetHeight,
  selected,
  onSelect,
}: AnnotationGraphicProps<'angular_dimension'> & DrawingSheetBounds & { standard: DrawingStandard }) {
  const dimensionLine = useDrawingLine('dimension');
  const vertex = resolveDrawingAnchor(annotation.vertex, view, projection);
  const first = resolveDrawingAnchor(annotation.first, view, projection);
  const second = resolveDrawingAnchor(annotation.second, view, projection);
  const baseGeometry = vertex && first && second
    ? angularDimensionGeometry(vertex, first, second, annotation.radius)
    : null;
  if (!vertex || !first || !second || !baseGeometry) return <BrokenAnnotation view={view} onSelect={onSelect} />;
  const radiusForDelta = (delta: PaperDelta) => angularDimensionRadiusAfterDrag(
    baseGeometry.vertex,
    baseGeometry.textPosition,
    delta,
  );
  return <DraggableAnnotationGraphic
    id={annotation.id}
    testId="drawing-angular-dimension"
    sheetWidth={sheetWidth}
    sheetHeight={sheetHeight}
    onSelect={onSelect}
    updateForDelta={(delta) => ({ radius: radiusForDelta(delta) })}
  >
    {(delta, dragging) => {
      const geometry = angularDimensionGeometry(vertex, first, second, radiusForDelta(delta));
      if (!geometry) return null;
      const active = selected || dragging;
      const color = active ? '#6654c7' : '#23272d';
      const text = drawingAngularDimensionText(
        geometry.value,
        annotation.precision,
        annotation.prefix,
        annotation.suffix,
        annotation.presentation,
        standard,
      );
      const path = `M${geometry.vertex.join(' ')}L${geometry.firstRay.join(' ')} M${geometry.vertex.join(' ')}L${geometry.secondRay.join(' ')} ${geometry.arcPath}`;
      return <>
        <path d={path} fill="none" stroke={color} {...dimensionLine} strokeWidth={active ? dimensionLine.strokeWidth + 0.14 : dimensionLine.strokeWidth} />
        <path d={path} fill="none" stroke="transparent" strokeWidth="5" />
        <DimensionValueText x={geometry.textPosition[0]} y={geometry.textPosition[1]} color={color} selected={active}>{text}</DimensionValueText>
      </>;
    }}
  </DraggableAnnotationGraphic>;
}

function HoleNoteGraphic({
  annotation,
  view,
  projection,
  sheetWidth,
  sheetHeight,
  selected,
  onSelect,
}: AnnotationGraphicProps<'hole_note'> & DrawingSheetBounds) {
  const standard = useAppStore((state) => state.drawingDocument.sheets.find((sheet) => sheet.views.some((candidate) => candidate.id === annotation.view_id))?.standard ?? 'iso');
  const units = useAppStore((state) => state.document?.settings.units ?? 'mm');
  const leaderLine = useDrawingLine('leader');
  const style = useDrawingStyle();
  const resolved = resolveDrawingCircle(annotation.feature, view, projection);
  if (!resolved) return <BrokenAnnotation view={view} onSelect={onSelect} />;
  const label = drawingHoleCalloutText(annotation, standard, units);
  const positionForDelta = (delta: PaperDelta) => boundedDrawingPoint(
    addPaperDelta(annotation.position, delta),
    sheetWidth,
    sheetHeight,
  );
  return <DraggableAnnotationGraphic
    id={annotation.id}
    testId="drawing-hole-note"
    sheetWidth={sheetWidth}
    sheetHeight={sheetHeight}
    onSelect={onSelect}
    updateForDelta={(delta) => ({ position: positionForDelta(delta) })}
  >
    {(delta, dragging) => {
      const position = positionForDelta(delta);
      const direction = normalize2([position[0] - resolved.center[0], position[1] - resolved.center[1]]);
      const featurePoint: [number, number] = [resolved.center[0] + direction[0] * resolved.paperRadius, resolved.center[1] + direction[1] * resolved.paperRadius];
      const active = selected || dragging;
      const color = active ? '#6654c7' : '#23272d';
      const path = `M${featurePoint.join(' ')}L${position.join(' ')}`;
      return <>
        <path d={path} fill="none" stroke={color} {...leaderLine} strokeWidth={active ? leaderLine.strokeWidth + 0.14 : leaderLine.strokeWidth} />
        <path d={path} fill="none" stroke="transparent" strokeWidth="5" />
        <polygon points={arrowPolygon(featurePoint, position, style.arrow_size_mm)} fill={color} />
        <MultilineOutlinedText position={[position[0] + 1.2, position[1] - 0.8]} text={label} color={color} selected={active} />
      </>;
    }}
  </DraggableAnnotationGraphic>;
}

function ChamferNoteGraphic({
  annotation,
  view,
  projection,
  standard,
  sheetWidth,
  sheetHeight,
  selected,
  onSelect,
}: AnnotationGraphicProps<'chamfer_note'> & {
  standard: DrawingStandard;
  sheetWidth: number;
  sheetHeight: number;
}) {
  const units = useAppStore((state) => state.document?.settings.units ?? 'mm');
  const leaderLine = useDrawingLine('leader');
  const style = useDrawingStyle();
  const first = resolveDrawingAnchor(annotation.first, view, projection);
  const second = resolveDrawingAnchor(annotation.second, view, projection);
  if (!first || !second) return <BrokenAnnotation view={view} onSelect={onSelect} />;
  const attachment = midpoint2(first.paper, second.paper);
  const label = drawingChamferText(
    annotation.length,
    annotation.angle_deg,
    annotation.prefix,
    standard,
    units,
  );
  const positionForDelta = (delta: PaperDelta) => boundedDrawingPoint(
    addPaperDelta(annotation.position, delta),
    sheetWidth,
    sheetHeight,
  );
  return <DraggableAnnotationGraphic
    id={annotation.id}
    testId="drawing-chamfer-note"
    sheetWidth={sheetWidth}
    sheetHeight={sheetHeight}
    onSelect={onSelect}
    updateForDelta={(delta) => ({ position: positionForDelta(delta) })}
  >
    {(delta, dragging) => {
      const position = positionForDelta(delta);
      const active = selected || dragging;
      const color = active ? '#6654c7' : '#23272d';
      const path = `M${attachment.join(' ')}L${position.join(' ')}`;
      return <>
        <path d={path} fill="none" stroke={color} {...leaderLine} strokeWidth={active ? leaderLine.strokeWidth + 0.14 : leaderLine.strokeWidth} />
        <path d={path} fill="none" stroke="transparent" strokeWidth="5" />
        <polygon points={arrowPolygon(attachment, position, style.arrow_size_mm)} fill={color} />
        <OutlinedText x={position[0] + 1.2} y={position[1] - 0.8} color={color} selected={active} textAnchor="start">{label}</OutlinedText>
      </>;
    }}
  </DraggableAnnotationGraphic>;
}

function CenterMarkGraphic({
  annotation,
  view,
  projection,
  sheetWidth,
  sheetHeight,
  selected,
  onSelect,
}: AnnotationGraphicProps<'center_mark'> & DrawingSheetBounds) {
  const centerLine = useDrawingLine('center');
  const resolved = resolveDrawingCircle(annotation.feature, view, projection);
  const adjustment = useAnnotationExtensionAdjustment(annotation.id, annotation.extension, sheetWidth, sheetHeight, onSelect);
  if (!resolved) return <BrokenAnnotation view={view} onSelect={onSelect} />;
  const geometry = centerMarkGeometry(resolved, adjustment.extension);
  const color = selected || adjustment.adjusting ? '#6654c7' : '#356170';
  const path = `M${geometry.horizontal[0].join(' ')}L${geometry.horizontal[1].join(' ')} M${geometry.vertical[0].join(' ')}L${geometry.vertical[1].join(' ')}`;
  return <g
    data-testid="drawing-center-mark"
    data-annotation-id={annotation.id}
    className="cursor-pointer"
    onPointerDown={(event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      onSelect();
    }}
  >
    <path d={path} fill="none" stroke={color} {...centerLine} strokeWidth={selected ? centerLine.strokeWidth + 0.14 : centerLine.strokeWidth} />
    <path d={path} fill="none" stroke="transparent" strokeWidth="5" />
    <circle cx={geometry.center[0]} cy={geometry.center[1]} r="0.48" fill="#fff" stroke={color} strokeWidth="0.36" />
    {selected && <>
      <AnnotationExtensionGrip testId="drawing-center-mark-extension-grip" index={0} position={geometry.horizontal[0]} binding={adjustment.bindGrip([resolved.center[0] - resolved.paperRadius, resolved.center[1]], [-1, 0])} />
      <AnnotationExtensionGrip testId="drawing-center-mark-extension-grip" index={1} position={geometry.horizontal[1]} binding={adjustment.bindGrip([resolved.center[0] + resolved.paperRadius, resolved.center[1]], [1, 0])} />
      <AnnotationExtensionGrip testId="drawing-center-mark-extension-grip" index={2} position={geometry.vertical[0]} binding={adjustment.bindGrip([resolved.center[0], resolved.center[1] - resolved.paperRadius], [0, -1])} />
      <AnnotationExtensionGrip testId="drawing-center-mark-extension-grip" index={3} position={geometry.vertical[1]} binding={adjustment.bindGrip([resolved.center[0], resolved.center[1] + resolved.paperRadius], [0, 1])} />
    </>}
  </g>;
}

function CenterLineGraphic({
  annotation,
  view,
  projection,
  sheetWidth,
  sheetHeight,
  selected,
  onSelect,
}: AnnotationGraphicProps<'center_line'> & DrawingSheetBounds) {
  const centerLine = useDrawingLine('center');
  const first = resolveDrawingCircle(annotation.first, view, projection);
  const second = resolveDrawingCircle(annotation.second, view, projection);
  const adjustment = useAnnotationExtensionAdjustment(annotation.id, annotation.extension, sheetWidth, sheetHeight, onSelect);
  const geometry = first && second
    ? centerLineGeometry(first, second, adjustment.extension)
    : null;
  if (!geometry) return <BrokenAnnotation view={view} onSelect={onSelect} />;
  const centerVector: [number, number] = [
    geometry.secondCenter[0] - geometry.firstCenter[0],
    geometry.secondCenter[1] - geometry.firstCenter[1],
  ];
  const centerDistance = Math.hypot(...centerVector);
  const direction: [number, number] = [centerVector[0] / centerDistance, centerVector[1] / centerDistance];
  const firstBoundary: [number, number] = [
    geometry.firstCenter[0] - direction[0] * first!.paperRadius,
    geometry.firstCenter[1] - direction[1] * first!.paperRadius,
  ];
  const secondBoundary: [number, number] = [
    geometry.secondCenter[0] + direction[0] * second!.paperRadius,
    geometry.secondCenter[1] + direction[1] * second!.paperRadius,
  ];
  const color = selected || adjustment.adjusting ? '#6654c7' : '#356170';
  const path = `M${geometry.start.join(' ')}L${geometry.end.join(' ')}`;
  return <g
    data-testid="drawing-center-line"
    data-annotation-id={annotation.id}
    className="cursor-pointer"
    onPointerDown={(event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      onSelect();
    }}
  >
    <path d={path} fill="none" stroke={color} {...centerLine} strokeWidth={selected ? centerLine.strokeWidth + 0.14 : centerLine.strokeWidth} />
    <path d={path} fill="none" stroke="transparent" strokeWidth="5" />
    <circle cx={geometry.firstCenter[0]} cy={geometry.firstCenter[1]} r="0.48" fill="#fff" stroke={color} strokeWidth="0.36" />
    <circle cx={geometry.secondCenter[0]} cy={geometry.secondCenter[1]} r="0.48" fill="#fff" stroke={color} strokeWidth="0.36" />
    {selected && <>
      <AnnotationExtensionGrip testId="drawing-center-line-extension-grip" index={0} position={geometry.start} binding={adjustment.bindGrip(firstBoundary, [-direction[0], -direction[1]])} />
      <AnnotationExtensionGrip testId="drawing-center-line-extension-grip" index={1} position={geometry.end} binding={adjustment.bindGrip(secondBoundary, direction)} />
    </>}
  </g>;
}

function CenterLineBetweenEdgesGraphic({
  annotation,
  view,
  projection,
  sheetWidth,
  sheetHeight,
  selected,
  onSelect,
}: AnnotationGraphicProps<'center_line_between_edges'> & DrawingSheetBounds) {
  const centerLine = useDrawingLine('center');
  const first = resolveDrawingLine(annotation.first, view, projection);
  const second = resolveDrawingLine(annotation.second, view, projection);
  const baseGeometry = first && second ? centerLineBetweenEdgesGeometry(first, second, 0) : null;
  const adjustment = useAnnotationExtensionAdjustment(annotation.id, annotation.extension, sheetWidth, sheetHeight, onSelect);
  const geometry = first && second ? centerLineBetweenEdgesGeometry(first, second, adjustment.extension) : null;
  if (!geometry || !baseGeometry) return <BrokenAnnotation view={view} onSelect={onSelect} />;
  const vector: [number, number] = [baseGeometry.end[0] - baseGeometry.start[0], baseGeometry.end[1] - baseGeometry.start[1]];
  const length = Math.hypot(...vector);
  const direction: [number, number] = [vector[0] / length, vector[1] / length];
  const color = selected || adjustment.adjusting ? '#6654c7' : '#356170';
  const path = `M${geometry.start.join(' ')}L${geometry.end.join(' ')}`;
  return <g
    data-testid="drawing-center-line-between-edges"
    data-annotation-id={annotation.id}
    className="cursor-pointer"
    onPointerDown={(event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      onSelect();
    }}
  >
    <path d={path} fill="none" stroke={color} {...centerLine} strokeWidth={selected ? centerLine.strokeWidth + 0.14 : centerLine.strokeWidth} />
    <path d={path} fill="none" stroke="transparent" strokeWidth="5" />
    {selected && <>
      <AnnotationExtensionGrip testId="drawing-edge-center-line-extension-grip" index={0} position={geometry.start} binding={adjustment.bindGrip(baseGeometry.start, [-direction[0], -direction[1]])} />
      <AnnotationExtensionGrip testId="drawing-edge-center-line-extension-grip" index={1} position={geometry.end} binding={adjustment.bindGrip(baseGeometry.end, direction)} />
    </>}
  </g>;
}

function AutomaticSymmetryAxisGraphic({
  annotation,
  view,
  projection,
  sheetWidth,
  sheetHeight,
  selected,
  onSelect,
}: AnnotationGraphicProps<'automatic_symmetry_axis'> & DrawingSheetBounds) {
  const centerLine = useDrawingLine('center');
  const adjustment = useAnnotationExtensionAdjustment(annotation.id, annotation.extension, sheetWidth, sheetHeight, onSelect);
  const baseSegments = automaticSymmetryAxisGeometry(view, projection, annotation.axis, 0);
  const segments = automaticSymmetryAxisGeometry(view, projection, annotation.axis, adjustment.extension);
  const color = selected || adjustment.adjusting ? '#6654c7' : '#356170';
  const path = segments.map(([start, end]) => `M${start.join(' ')}L${end.join(' ')}`).join(' ');
  return <SelectableAnnotationGroup id={annotation.id} testId="drawing-automatic-symmetry-axis" onSelect={onSelect}>
    <path d={path} fill="none" stroke={color} {...centerLine} strokeWidth={selected ? centerLine.strokeWidth + 0.14 : centerLine.strokeWidth} />
    <path d={path} fill="none" stroke="transparent" strokeWidth="5" />
    {selected && segments.flatMap(([start, end], segmentIndex) => {
      const [baseStart, baseEnd] = baseSegments[segmentIndex];
      const vector: [number, number] = [baseEnd[0] - baseStart[0], baseEnd[1] - baseStart[1]];
      const length = Math.hypot(...vector);
      const direction: [number, number] = [vector[0] / length, vector[1] / length];
      return [
        <AnnotationExtensionGrip key={`${segmentIndex}-start`} testId="drawing-symmetry-axis-extension-grip" index={segmentIndex * 2} position={start} binding={adjustment.bindGrip(baseStart, [-direction[0], -direction[1]])} />,
        <AnnotationExtensionGrip key={`${segmentIndex}-end`} testId="drawing-symmetry-axis-extension-grip" index={segmentIndex * 2 + 1} position={end} binding={adjustment.bindGrip(baseEnd, direction)} />,
      ];
    })}
  </SelectableAnnotationGroup>;
}

function BoltCircleCenterLineGraphic({
  annotation,
  view,
  projection,
  sheetWidth,
  sheetHeight,
  selected,
  onSelect,
}: AnnotationGraphicProps<'bolt_circle_center_line'> & DrawingSheetBounds) {
  const centerLine = useDrawingLine('center');
  const circles = annotation.features.map((feature) => resolveDrawingCircle(feature, view, projection));
  const adjustment = useAnnotationExtensionAdjustment(annotation.id, annotation.extension, sheetWidth, sheetHeight, onSelect);
  if (circles.some((circle) => circle === null)) return <BrokenAnnotation view={view} onSelect={onSelect} />;
  const resolvedCircles = circles.filter((circle): circle is NonNullable<typeof circle> => circle !== null);
  const geometry = boltCircleGeometry(resolvedCircles, adjustment.extension);
  if (!geometry) return <BrokenAnnotation view={view} onSelect={onSelect} />;
  const color = selected || adjustment.adjusting ? '#6654c7' : '#356170';
  return <SelectableAnnotationGroup id={annotation.id} testId="drawing-bolt-circle-center-line" onSelect={onSelect}>
    <circle cx={geometry.center[0]} cy={geometry.center[1]} r={geometry.radius} fill="none" stroke={color} {...centerLine} strokeWidth={selected ? centerLine.strokeWidth + 0.14 : centerLine.strokeWidth} />
    <circle cx={geometry.center[0]} cy={geometry.center[1]} r={geometry.radius} fill="none" stroke="transparent" strokeWidth="5" />
    {geometry.marks.map((mark, index) => <path key={index} d={`M${mark.horizontal[0].join(' ')}L${mark.horizontal[1].join(' ')} M${mark.vertical[0].join(' ')}L${mark.vertical[1].join(' ')}`} fill="none" stroke={color} {...centerLine} />)}
    {selected && resolvedCircles[0] && <AnnotationExtensionGrip
      testId="drawing-bolt-circle-extension-grip"
      index={0}
      position={geometry.marks[0].horizontal[1]}
      binding={adjustment.bindGrip([
        resolvedCircles[0].center[0] + resolvedCircles[0].paperRadius,
        resolvedCircles[0].center[1],
      ], [1, 0])}
    />}
  </SelectableAnnotationGroup>;
}

function ChainDimensionGraphic({
  annotation,
  view,
  projection,
  standard,
  sheetWidth,
  sheetHeight,
  selected,
  onSelect,
}: AnnotationGraphicProps<'chain_dimension'> & DrawingSheetBounds & { standard: DrawingStandard }) {
  const units = useAppStore((state) => state.document?.settings.units ?? 'mm');
  const resolved = annotation.anchors.map((anchor) => resolveDrawingAnchor(anchor, view, projection));
  if (resolved.length < 2 || resolved.some((anchor) => anchor === null)) return <BrokenAnnotation view={view} onSelect={onSelect} />;
  const anchors = resolved.filter((anchor): anchor is NonNullable<typeof anchor> => anchor !== null);
  const pairs = annotation.layout === 'baseline'
    ? anchors.slice(1).map((anchor) => [anchors[0], anchor] as const)
    : anchors.slice(0, -1).map((anchor, index) => [anchor, anchors[index + 1]] as const);
  const offsetForDelta = (delta: PaperDelta) => linearDimensionOffsetAfterDrag(
    pairs[0][0].paper,
    pairs[0][1].paper,
    annotation.mode,
    annotation.offset,
    delta,
  );
  return <DraggableAnnotationGraphic
    id={annotation.id}
    testId="drawing-chain-dimension"
    sheetWidth={sheetWidth}
    sheetHeight={sheetHeight}
    onSelect={onSelect}
    updateForDelta={(delta) => ({ offset: offsetForDelta(delta) })}
  >
    {(delta, dragging) => {
      const active = selected || dragging;
      const color = active ? '#6654c7' : '#23272d';
      const baseOffset = offsetForDelta(delta);
      return <>
        {pairs.map(([first, second], index) => {
          const offset = baseOffset + (annotation.layout === 'baseline' ? index * annotation.spacing : 0);
          const geometry = linearDimensionGeometry(first, second, annotation.mode, offset, view.scale);
          if (!geometry) return null;
          const text = drawingDimensionText(geometry.value, annotation.precision, annotation.prefix, annotation.suffix, units, annotation.presentation, standard);
          return <LinearDimensionShape key={index} geometry={geometry} text={text} standard={standard} color={color} active={active} />;
        })}
      </>;
    }}
  </DraggableAnnotationGraphic>;
}

function OrdinateDimensionGraphic({
  annotation,
  view,
  projection,
  standard,
  sheetWidth,
  sheetHeight,
  selected,
  onSelect,
}: AnnotationGraphicProps<'ordinate_dimension'> & DrawingSheetBounds & { standard: DrawingStandard }) {
  const units = useAppStore((state) => state.document?.settings.units ?? 'mm');
  const dimensionLine = useDrawingLine('dimension');
  const style = useDrawingStyle();
  const origin = resolveDrawingAnchor(annotation.origin, view, projection);
  const target = resolveDrawingAnchor(annotation.target, view, projection);
  if (!origin || !target) return <BrokenAnnotation view={view} onSelect={onSelect} />;
  const offsetForDelta = (delta: PaperDelta) => annotation.offset + (Math.abs(delta[0]) > Math.abs(delta[1]) ? delta[0] : delta[1]);
  return <DraggableAnnotationGraphic id={annotation.id} testId="drawing-ordinate-dimension" sheetWidth={sheetWidth} sheetHeight={sheetHeight} onSelect={onSelect} updateForDelta={(delta) => ({ offset: offsetForDelta(delta) })}>
    {(delta, dragging) => {
      const geometry = ordinateDimensionGeometry(origin, target, offsetForDelta(delta), view.scale);
      if (!geometry) return null;
      const active = selected || dragging;
      const color = active ? '#6654c7' : '#23272d';
      const values = annotation.axis === 'x' ? [['X', geometry.xValue]]
        : annotation.axis === 'y' ? [['Y', geometry.yValue]]
          : [['X', geometry.xValue], ['Y', geometry.yValue]];
      const text = values.map(([label, value]) => `${label}${drawingDimensionText(Number(value), annotation.precision, '', '', units, annotation.presentation, standard)}`).join('  ');
      const path = `M${geometry.target.join(' ')}L${geometry.elbow.join(' ')}L${geometry.textPosition.join(' ')}`;
      return <>
        <path d={path} fill="none" stroke={color} {...dimensionLine} strokeWidth={active ? dimensionLine.strokeWidth + 0.14 : dimensionLine.strokeWidth} />
        <path d={path} fill="none" stroke="transparent" strokeWidth="5" />
        <circle cx={geometry.origin[0]} cy={geometry.origin[1]} r="1.2" fill="#fff" stroke={color} strokeWidth="0.45" />
        <polygon points={arrowPolygon(geometry.target, geometry.elbow, style.arrow_size_mm)} fill={color} />
        <DimensionValueText x={geometry.textPosition[0]} y={geometry.textPosition[1] - 0.7} color={color} selected={active} textAnchor="start">{text}</DimensionValueText>
      </>;
    }}
  </DraggableAnnotationGraphic>;
}

function ArcLengthDimensionGraphic({
  annotation,
  view,
  projection,
  standard,
  sheetWidth,
  sheetHeight,
  selected,
  onSelect,
}: AnnotationGraphicProps<'arc_length_dimension'> & DrawingSheetBounds & { standard: DrawingStandard }) {
  const units = useAppStore((state) => state.document?.settings.units ?? 'mm');
  const dimensionLine = useDrawingLine('dimension');
  const style = useDrawingStyle();
  const circle = resolveDrawingCircle(annotation.feature, view, projection);
  const first = resolveDrawingAnchor(annotation.first, view, projection);
  const second = resolveDrawingAnchor(annotation.second, view, projection);
  if (!circle || !first || !second) return <BrokenAnnotation view={view} onSelect={onSelect} />;
  const offsetForDelta = (delta: PaperDelta) => Math.max(1, annotation.offset + Math.hypot(...delta) * Math.sign(delta[1] || 1));
  return <DraggableAnnotationGraphic id={annotation.id} testId="drawing-arc-length-dimension" sheetWidth={sheetWidth} sheetHeight={sheetHeight} onSelect={onSelect} updateForDelta={(delta) => ({ offset: offsetForDelta(delta) })}>
    {(delta, dragging) => {
      const geometry = arcLengthDimensionGeometry(circle, first, second, offsetForDelta(delta));
      if (!geometry) return null;
      const active = selected || dragging;
      const color = active ? '#6654c7' : '#23272d';
      const text = drawingDimensionText(geometry.value, annotation.precision, '⌒', '', units, annotation.presentation, standard);
      return <>
        <path d={geometry.path} fill="none" stroke={color} {...dimensionLine} strokeWidth={active ? dimensionLine.strokeWidth + 0.14 : dimensionLine.strokeWidth} />
        <path d={geometry.path} fill="none" stroke="transparent" strokeWidth="5" />
        <polygon points={arrowPolygon(geometry.start, geometry.end, style.arrow_size_mm)} fill={color} />
        <polygon points={arrowPolygon(geometry.end, geometry.start, style.arrow_size_mm)} fill={color} />
        <DimensionValueText x={geometry.textPosition[0]} y={geometry.textPosition[1]} color={color} selected={active}>{text}</DimensionValueText>
      </>;
    }}
  </DraggableAnnotationGraphic>;
}

function JoggedRadiusDimensionGraphic({
  annotation,
  view,
  projection,
  standard,
  sheetWidth,
  sheetHeight,
  selected,
  onSelect,
}: AnnotationGraphicProps<'jogged_radius_dimension'> & DrawingSheetBounds & { standard: DrawingStandard }) {
  const units = useAppStore((state) => state.document?.settings.units ?? 'mm');
  const dimensionLine = useDrawingLine('dimension');
  const style = useDrawingStyle();
  const circle = resolveDrawingCircle(annotation.feature, view, projection);
  if (!circle) return <BrokenAnnotation view={view} onSelect={onSelect} />;
  const positionForDelta = (delta: PaperDelta) => boundedDrawingPoint(addPaperDelta(annotation.position, delta), sheetWidth, sheetHeight);
  return <DraggableAnnotationGraphic id={annotation.id} testId="drawing-jogged-radius-dimension" sheetWidth={sheetWidth} sheetHeight={sheetHeight} onSelect={onSelect} updateForDelta={(delta) => ({ position: positionForDelta(delta), jog: addPaperDelta(annotation.jog, delta) })}>
    {(delta, dragging) => {
      const position = positionForDelta(delta);
      const jog = addPaperDelta(annotation.jog, delta);
      const direction = normalize2([position[0] - circle.center[0], position[1] - circle.center[1]]);
      const featurePoint: [number, number] = [circle.center[0] + direction[0] * circle.paperRadius, circle.center[1] + direction[1] * circle.paperRadius];
      const normal: [number, number] = [-direction[1], direction[0]];
      const before: [number, number] = [jog[0] - direction[0] * 2 - normal[0] * 1.5, jog[1] - direction[1] * 2 - normal[1] * 1.5];
      const after: [number, number] = [jog[0] + direction[0] * 2 + normal[0] * 1.5, jog[1] + direction[1] * 2 + normal[1] * 1.5];
      const active = selected || dragging;
      const color = active ? '#6654c7' : '#23272d';
      const path = `M${featurePoint.join(' ')}L${before.join(' ')}L${after.join(' ')}L${position.join(' ')}`;
      const text = drawingDimensionText(circle.circle.radius, annotation.precision, 'R', '', units, annotation.presentation, standard);
      return <>
        <path d={path} fill="none" stroke={color} {...dimensionLine} strokeWidth={active ? dimensionLine.strokeWidth + 0.14 : dimensionLine.strokeWidth} />
        <path d={path} fill="none" stroke="transparent" strokeWidth="5" />
        <polygon points={arrowPolygon(featurePoint, before, style.arrow_size_mm)} fill={color} />
        <DimensionValueText x={position[0] + 1.2} y={position[1] - 0.8} color={color} selected={active} textAnchor="start">{text}</DimensionValueText>
      </>;
    }}
  </DraggableAnnotationGraphic>;
}

function DatumFeatureGraphic(props: AnnotationGraphicProps<'datum_feature'> & DrawingSheetBounds) {
  const { annotation, view, projection } = props;
  const leaderLine = useDrawingLine('leader');
  return <AttachedLeaderGraphic {...props} testId="drawing-datum-feature" attachment={annotation.attachment} position={annotation.position} render={(position, color, active) => <g>
    <rect x={position[0]} y={position[1] - 4.4} width="7" height="5.5" fill="#fff" stroke={color} {...leaderLine} strokeWidth={active ? leaderLine.strokeWidth + 0.14 : leaderLine.strokeWidth} />
    <OutlinedText x={position[0] + 3.5} y={position[1] - 0.5} color={color} selected={active}>{annotation.target_index === null ? annotation.label : `${annotation.label}${annotation.target_index}`}</OutlinedText>
  </g>} />;
}

function GdtFrameGraphic(props: AnnotationGraphicProps<'gdt_frame'> & DrawingSheetBounds) {
  const { annotation } = props;
  const leaderLine = useDrawingLine('leader');
  const cells = [gdtCharacteristicSymbol(annotation.characteristic), `${annotation.diameter_zone ? '⌀' : ''}${trimNumber(annotation.tolerance)}${materialConditionSymbol(annotation.material_condition)}`,
    ...annotation.datums.map((datum) => `${datum.label}${materialConditionSymbol(datum.material_condition)}`)];
  if (annotation.projected_zone !== null) cells.push(`P${trimNumber(annotation.projected_zone)}`);
  if (annotation.free_state) cells.push('F');
  return <AttachedLeaderGraphic {...props} testId="drawing-gdt-frame" attachment={annotation.attachment} position={annotation.position} render={(position, color, active) => {
    const widths = cells.map((cell) => Math.max(7, cell.length * 2.1 + 3));
    let x = position[0];
    return <g>{cells.map((cell, index) => {
      const width = widths[index];
      const element = <g key={index}><rect x={x} y={position[1] - 5} width={width} height="6" fill="#fff" stroke={color} {...leaderLine} strokeWidth={active ? leaderLine.strokeWidth + 0.14 : leaderLine.strokeWidth} /><OutlinedText x={x + width / 2} y={position[1] - 0.8} color={color} selected={active}>{cell}</OutlinedText></g>;
      x += width;
      return element;
    })}</g>;
  }} />;
}

function SurfaceTextureGraphic(props: AnnotationGraphicProps<'surface_texture'> & DrawingSheetBounds) {
  const { annotation } = props;
  const leaderLine = useDrawingLine('leader');
  const label = `Ra ${trimNumber(annotation.roughness_ra)}${annotation.process ? ` ${annotation.process}` : ''}`;
  return <AttachedLeaderGraphic {...props} testId="drawing-surface-texture" attachment={annotation.attachment} position={annotation.position} render={(position, color, active) => <g>
    <path d={`M${position[0]} ${position[1]}l3 -6 3 6m-3 -6h6`} fill="none" stroke={color} {...leaderLine} strokeWidth={active ? leaderLine.strokeWidth + 0.14 : leaderLine.strokeWidth} />
    <OutlinedText x={position[0] + 7} y={position[1] - 2} color={color} selected={active} textAnchor="start">{label}</OutlinedText>
  </g>} />;
}

function EdgeRequirementGraphic(props: AnnotationGraphicProps<'edge_requirement'> & DrawingSheetBounds) {
  const { annotation } = props;
  const leaderLine = useDrawingLine('leader');
  const attachment: DrawingAttachmentRefDto = { type: 'line', reference: annotation.attachment };
  const label = `${annotation.upper_deviation >= 0 ? '+' : ''}${trimNumber(annotation.upper_deviation)} / ${trimNumber(annotation.lower_deviation)}${annotation.note ? ` ${annotation.note}` : ''}`;
  return <AttachedLeaderGraphic {...props} testId="drawing-edge-requirement" attachment={attachment} position={annotation.position} render={(position, color, active) => <g>
    <path d={`M${position[0]} ${position[1]}v-5h5`} fill="none" stroke={color} {...leaderLine} strokeWidth={active ? leaderLine.strokeWidth + 0.14 : leaderLine.strokeWidth} />
    <OutlinedText x={position[0] + 6} y={position[1] - 1.5} color={color} selected={active} textAnchor="start">{label}</OutlinedText>
  </g>} />;
}

function WeldSymbolGraphic(props: AnnotationGraphicProps<'weld_symbol'> & DrawingSheetBounds) {
  const { annotation } = props;
  const leaderLine = useDrawingLine('leader');
  const attachment: DrawingAttachmentRefDto = { type: 'line', reference: annotation.attachment };
  const details = `${trimNumber(annotation.size)}${annotation.length !== null ? `-${trimNumber(annotation.length)}` : ''}${annotation.pitch !== null ? ` (${trimNumber(annotation.pitch)})` : ''}`;
  return <AttachedLeaderGraphic {...props} testId="drawing-weld-symbol" attachment={attachment} position={annotation.position} render={(position, color, active) => <g>
    <line x1={position[0]} y1={position[1]} x2={position[0] + 25} y2={position[1]} stroke={color} {...leaderLine} strokeWidth={active ? leaderLine.strokeWidth + 0.14 : leaderLine.strokeWidth} />
    <path d={weldGlyphPath(annotation.weld_type, position)} fill="none" stroke={color} {...leaderLine} strokeWidth={active ? leaderLine.strokeWidth + 0.14 : leaderLine.strokeWidth} />
    {annotation.all_around && <circle cx={position[0]} cy={position[1]} r="1.8" fill="#fff" stroke={color} {...leaderLine} />}
    {annotation.field_weld && <path d={`M${position[0]} ${position[1] - 1}v-6l4 2-4 2`} fill="none" stroke={color} {...leaderLine} />}
    <OutlinedText x={position[0] + 8} y={position[1] - 1.5} color={color} selected={active} textAnchor="start">{details}</OutlinedText>
    {annotation.tail && <OutlinedText x={position[0] + 26} y={position[1] - 1.5} color={color} selected={active} textAnchor="start">{annotation.tail}</OutlinedText>}
  </g>} />;
}

function ItemBalloonGraphic(props: AnnotationGraphicProps<'item_balloon'> & DrawingSheetBounds) {
  const { annotation } = props;
  const leaderLine = useDrawingLine('leader');
  const sheet = useAppStore((state) => state.drawingDocument.sheets.find((candidate) => candidate.views.some((view) => view.id === annotation.view_id)) ?? null);
  const item = sheet?.bom.find((candidate) => candidate.id === annotation.bom_item_id);
  const label = item?.item_number || String(annotation.bom_item_id);
  return <AttachedLeaderGraphic {...props} testId="drawing-item-balloon" attachment={annotation.attachment} position={annotation.position} render={(position, color, active) => <g>
    <circle cx={position[0] + 4} cy={position[1] - 2} r="4" fill="#fff" stroke={color} {...leaderLine} strokeWidth={active ? leaderLine.strokeWidth + 0.14 : leaderLine.strokeWidth} />
    <OutlinedText x={position[0] + 4} y={position[1] - 0.8} color={color} selected={active}>{label}</OutlinedText>
  </g>} />;
}

function AttachedLeaderGraphic({
  annotation,
  view,
  projection,
  sheetWidth,
  sheetHeight,
  selected,
  onSelect,
  attachment,
  position,
  testId,
  render,
}: DrawingSheetBounds & {
  annotation: { id: number };
  view: DrawingViewDto;
  projection: DrawingProjectionDto;
  selected: boolean;
  onSelect: () => void;
  attachment: DrawingAttachmentRefDto;
  position: [number, number];
  testId: string;
  render: (position: [number, number], color: string, active: boolean) => ReactNode;
}) {
  const leaderLine = useDrawingLine('leader');
  const style = useDrawingStyle();
  const resolved = resolveDrawingAttachment(attachment, view, projection);
  if (!resolved) return <BrokenAnnotation view={view} onSelect={onSelect} />;
  const positionForDelta = (delta: PaperDelta) => boundedDrawingPoint(addPaperDelta(position, delta), sheetWidth, sheetHeight);
  return <DraggableAnnotationGraphic id={annotation.id} testId={testId} sheetWidth={sheetWidth} sheetHeight={sheetHeight} onSelect={onSelect} updateForDelta={(delta) => ({ position: positionForDelta(delta) })}>
    {(delta, dragging) => {
      const displayPosition = positionForDelta(delta);
      const active = selected || dragging;
      const color = active ? '#6654c7' : '#23272d';
      const path = `M${resolved.point.join(' ')}L${displayPosition.join(' ')}`;
      return <>
        <path d={path} fill="none" stroke={color} {...leaderLine} strokeWidth={active ? leaderLine.strokeWidth + 0.14 : leaderLine.strokeWidth} />
        <path d={path} fill="none" stroke="transparent" strokeWidth="5" />
        <polygon points={arrowPolygon(resolved.point, displayPosition, style.arrow_size_mm)} fill={color} />
        {render(displayPosition, color, active)}
      </>;
    }}
  </DraggableAnnotationGraphic>;
}

function SelectableAnnotationGroup({ id, testId, onSelect, children }: { id: number; testId: string; onSelect: () => void; children: ReactNode }) {
  return <g data-testid={testId} data-annotation-id={id} className="cursor-pointer" onPointerDown={(event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect();
  }}>{children}</g>;
}

type AnnotationGraphicProps<K extends DrawingAnnotationDto['kind']> = {
  annotation: Extract<DrawingAnnotationDto, { kind: K }>;
  view: DrawingViewDto;
  projection: DrawingProjectionDto;
  selected: boolean;
  onSelect: () => void;
};

type DrawingSheetBounds = {
  sheetWidth: number;
  sheetHeight: number;
};

type DrawingReferenceRepairTarget =
  | { kind: 'anchor'; label: string; update: (reference: DrawingTopologyAnchorRefDto) => DrawingAnnotationUpdate }
  | { kind: 'circle'; label: string; update: (reference: DrawingCircularRefDto) => DrawingAnnotationUpdate }
  | { kind: 'line'; label: string; update: (reference: DrawingLineRefDto) => DrawingAnnotationUpdate };

type DrawingDerivedReferenceRepairTarget =
  | { kind: 'anchor'; label: string; update: (reference: DrawingTopologyAnchorRefDto) => NonNullable<DrawingViewDto['derivation']> }
  | { kind: 'line'; label: string; update: (reference: DrawingLineRefDto) => NonNullable<DrawingViewDto['derivation']> };

function drawingReferenceRepairTarget(
  annotation: DrawingAnnotationDto,
  view: DrawingViewDto,
  projection: DrawingProjectionDto,
): DrawingReferenceRepairTarget | null {
  const anchorTarget = (
    entries: Array<{ label: string; reference: DrawingTopologyAnchorRefDto; update: (reference: DrawingTopologyAnchorRefDto) => DrawingAnnotationUpdate }>,
  ): DrawingReferenceRepairTarget | null => {
    const entry = entries.find((candidate) => !resolveDrawingAnchor(candidate.reference, view, projection)) ?? entries[0];
    return entry ? { kind: 'anchor', label: entry.label, update: entry.update } : null;
  };
  const circleTarget = (
    entries: Array<{ label: string; reference: DrawingCircularRefDto; update: (reference: DrawingCircularRefDto) => DrawingAnnotationUpdate }>,
  ): DrawingReferenceRepairTarget | null => {
    const entry = entries.find((candidate) => !resolveDrawingCircle(candidate.reference, view, projection)) ?? entries[0];
    return entry ? { kind: 'circle', label: entry.label, update: entry.update } : null;
  };
  const lineTarget = (
    entries: Array<{ label: string; reference: DrawingLineRefDto; update: (reference: DrawingLineRefDto) => DrawingAnnotationUpdate }>,
  ): DrawingReferenceRepairTarget | null => {
    const entry = entries.find((candidate) => !resolveDrawingLine(candidate.reference, view, projection)) ?? entries[0];
    return entry ? { kind: 'line', label: entry.label, update: entry.update } : null;
  };
  const attachmentTarget = (
    attachment: DrawingAttachmentRefDto,
    update: (attachment: DrawingAttachmentRefDto) => DrawingAnnotationUpdate,
  ): DrawingReferenceRepairTarget => {
    if (attachment.type === 'anchor') return { kind: 'anchor', label: translate('drawing.workspace.repairAttachmentPoint'), update: (reference) => update({ type: 'anchor', reference }) };
    if (attachment.type === 'circle') return { kind: 'circle', label: translate('drawing.workspace.repairCircularAttachment'), update: (reference) => update({ type: 'circle', reference }) };
    return { kind: 'line', label: translate('drawing.workspace.repairEdgeAttachment'), update: (reference) => update({ type: 'line', reference }) };
  };

  switch (annotation.kind) {
    case 'linear_dimension': return anchorTarget([
      { label: translate('drawing.workspace.repairFirstDimensionPoint'), reference: annotation.first, update: (first) => ({ first }) },
      { label: translate('drawing.workspace.repairSecondDimensionPoint'), reference: annotation.second, update: (second) => ({ second }) },
    ]);
    case 'line_dimension': return lineTarget([
      { label: translate('drawing.workspace.repairFirstDimensionEdge'), reference: annotation.first, update: (first) => ({ first }) },
      ...(annotation.second ? [{
        label: translate('drawing.workspace.repairSecondDimensionEdge'),
        reference: annotation.second,
        update: (second: DrawingLineRefDto) => ({ second }),
      }] : []),
    ]);
    case 'point_line_dimension': {
      if (!resolveDrawingAnchor(annotation.point, view, projection)) {
        return { kind: 'anchor', label: translate('drawing.workspace.repairDimensionPoint'), update: (point) => ({ point }) };
      }
      if (!resolveDrawingLine(annotation.line, view, projection)) {
        return { kind: 'line', label: translate('drawing.workspace.repairDimensionEdge'), update: (line) => ({ line }) };
      }
      return { kind: 'anchor', label: translate('drawing.workspace.repairDimensionPoint'), update: (point) => ({ point }) };
    }
    case 'angular_dimension': return anchorTarget([
      { label: translate('drawing.workspace.repairAngleVertex'), reference: annotation.vertex, update: (vertex) => ({ vertex }) },
      { label: translate('drawing.workspace.repairFirstAngleRay'), reference: annotation.first, update: (first) => ({ first }) },
      { label: translate('drawing.workspace.repairSecondAngleRay'), reference: annotation.second, update: (second) => ({ second }) },
    ]);
    case 'chamfer_note': return anchorTarget([
      { label: translate('drawing.workspace.repairFirstChamferEndpoint'), reference: annotation.first, update: (first) => ({ first }) },
      { label: translate('drawing.workspace.repairSecondChamferEndpoint'), reference: annotation.second, update: (second) => ({ second }) },
    ]);
    case 'chain_dimension': return anchorTarget(annotation.anchors.map((reference, index) => ({
      label: translate('drawing.workspace.repairDimensionPointIndexed').replace('{index}', String(index + 1)),
      reference,
      update: (replacement) => ({ anchors: annotation.anchors.map((value, candidate) => candidate === index ? replacement : value) }),
    })));
    case 'ordinate_dimension': return anchorTarget([
      { label: translate('drawing.workspace.repairOrdinateOrigin'), reference: annotation.origin, update: (origin) => ({ origin }) },
      { label: translate('drawing.workspace.repairOrdinateTarget'), reference: annotation.target, update: (target) => ({ target }) },
    ]);
    case 'arc_length_dimension': {
      const brokenCircle = !resolveDrawingCircle(annotation.feature, view, projection);
      if (brokenCircle) return { kind: 'circle', label: translate('drawing.workspace.repairArcFeature'), update: (feature) => ({ feature }) };
      return anchorTarget([
        { label: translate('drawing.workspace.repairArcStart'), reference: annotation.first, update: (first) => ({ first }) },
        { label: translate('drawing.workspace.repairArcEnd'), reference: annotation.second, update: (second) => ({ second }) },
      ]) ?? { kind: 'circle', label: translate('drawing.workspace.repairArcFeature'), update: (feature) => ({ feature }) };
    }
    case 'radial_dimension':
    case 'hole_note':
    case 'center_mark':
    case 'jogged_radius_dimension':
      return { kind: 'circle', label: translate('drawing.workspace.repairCircularFeature'), update: (feature) => ({ feature }) };
    case 'center_line': return circleTarget([
      { label: translate('drawing.workspace.repairFirstCenter'), reference: annotation.first, update: (first) => ({ first }) },
      { label: translate('drawing.workspace.repairSecondCenter'), reference: annotation.second, update: (second) => ({ second }) },
    ]);
    case 'bolt_circle_center_line': return circleTarget(annotation.features.map((reference, index) => ({
      label: translate('drawing.workspace.repairBoltCircleCenter').replace('{index}', String(index + 1)),
      reference,
      update: (replacement) => ({ features: annotation.features.map((value, candidate) => candidate === index ? replacement : value) }),
    })));
    case 'center_line_between_edges': return lineTarget([
      { label: translate('drawing.workspace.repairFirstSymmetryEdge'), reference: annotation.first, update: (first) => ({ first }) },
      { label: translate('drawing.workspace.repairSecondSymmetryEdge'), reference: annotation.second, update: (second) => ({ second }) },
    ]);
    case 'edge_requirement': return { kind: 'line', label: translate('drawing.workspace.repairRequiredEdge'), update: (attachment) => ({ attachment }) };
    case 'weld_symbol': return { kind: 'line', label: translate('drawing.workspace.repairWeldAttachmentEdge'), update: (attachment) => ({ attachment }) };
    case 'datum_feature':
    case 'gdt_frame':
    case 'surface_texture':
    case 'item_balloon':
      return attachmentTarget(annotation.attachment, (attachment) => ({ attachment }));
    case 'automatic_symmetry_axis':
    case 'note':
    case 'revision_cloud':
      return null;
  }
}

function drawingDerivedReferenceRepairTarget(
  child: DrawingViewDto,
  parent: DrawingViewDto,
  projection: DrawingProjectionDto,
): DrawingDerivedReferenceRepairTarget | null {
  const derivation = child.derivation;
  if (!derivation) return null;
  if (derivation.type === 'section' || derivation.type === 'removed_section') {
    const repairFirst = !resolveDrawingAnchor(derivation.first, parent, projection)
      || Boolean(resolveDrawingAnchor(derivation.second, parent, projection));
    return repairFirst
      ? { kind: 'anchor', label: translate('drawing.workspace.repairCuttingPlaneStart'), update: (first) => ({ ...derivation, first }) }
      : { kind: 'anchor', label: translate('drawing.workspace.repairCuttingPlaneEnd'), update: (second) => ({ ...derivation, second }) };
  }
  if (derivation.type === 'detail') {
    return { kind: 'anchor', label: translate('drawing.workspace.repairDetailCenter'), update: (center) => ({ ...derivation, center }) };
  }
  if (derivation.type === 'auxiliary') {
    return { kind: 'line', label: translate('drawing.workspace.repairAuxiliaryReferenceEdge'), update: (reference) => ({ ...derivation, reference }) };
  }
  return null;
}

type PaperDelta = [number, number];

function DraggableAnnotationGraphic({
  id,
  testId,
  sheetWidth,
  sheetHeight,
  onSelect,
  updateForDelta,
  children,
}: DrawingSheetBounds & {
  id: number;
  testId: string;
  onSelect: () => void;
  updateForDelta: (delta: PaperDelta) => DrawingAnnotationUpdate;
  children: (delta: PaperDelta, dragging: boolean) => ReactNode;
}) {
  const drag = useRef<{
    pointerId: number;
    start: [number, number];
    delta: PaperDelta;
  } | null>(null);
  const [dragDelta, setDragDelta] = useState<PaperDelta | null>(null);

  const onPointerDown = (event: ReactPointerEvent<SVGGElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect();
    drag.current = {
      pointerId: event.pointerId,
      start: drawingSheetPoint(event, sheetWidth, sheetHeight),
      delta: [0, 0],
    };
    if (event.isTrusted) event.currentTarget.setPointerCapture(event.pointerId);
    setDragDelta([0, 0]);
  };
  const onPointerMove = (event: ReactPointerEvent<SVGGElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const current = drawingSheetPoint(event, sheetWidth, sheetHeight);
    active.delta = [current[0] - active.start[0], current[1] - active.start[1]];
    setDragDelta(active.delta);
  };
  const finishDrag = (event: ReactPointerEvent<SVGGElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragDelta(null);
    if (Math.hypot(...active.delta) > 1e-4) {
      void updateDrawingAnnotation(id, updateForDelta(active.delta)).catch(showDrawingError);
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const cancelDrag = (event: ReactPointerEvent<SVGGElement>) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragDelta(null);
  };
  const delta = dragDelta ?? [0, 0];
  return <g
    data-testid={testId}
    data-annotation-id={id}
    data-annotation-dragging={dragDelta ? 'true' : 'false'}
    onPointerDown={onPointerDown}
    onPointerMove={onPointerMove}
    onPointerUp={finishDrag}
    onPointerCancel={cancelDrag}
    className="cursor-move"
  >
    {children(delta, dragDelta !== null)}
  </g>;
}

type AnnotationExtensionGripBinding = {
  onPointerDown: (event: ReactPointerEvent<SVGCircleElement>) => void;
  onPointerMove: (event: ReactPointerEvent<SVGCircleElement>) => void;
  onPointerUp: (event: ReactPointerEvent<SVGCircleElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<SVGCircleElement>) => void;
};

function useAnnotationExtensionAdjustment(
  annotationId: number,
  storedExtension: number,
  sheetWidth: number,
  sheetHeight: number,
  onSelect: () => void,
) {
  const drag = useRef<{
    pointerId: number;
    origin: [number, number];
    direction: [number, number];
    extension: number;
  } | null>(null);
  const [previewExtension, setPreviewExtension] = useState<number | null>(null);

  const bindGrip = (
    origin: [number, number],
    rawDirection: [number, number],
  ): AnnotationExtensionGripBinding => {
    const directionLength = Math.hypot(...rawDirection);
    const direction: [number, number] = directionLength < 1e-7
      ? [1, 0]
      : [rawDirection[0] / directionLength, rawDirection[1] / directionLength];
    return {
      onPointerDown: (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        onSelect();
        drag.current = {
          pointerId: event.pointerId,
          origin,
          direction,
          extension: storedExtension,
        };
        setPreviewExtension(storedExtension);
        if (event.isTrusted) event.currentTarget.setPointerCapture(event.pointerId);
      },
      onPointerMove: (event) => {
        const active = drag.current;
        if (!active || active.pointerId !== event.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        const point = drawingSheetPoint(event, sheetWidth, sheetHeight);
        active.extension = Math.max(0,
          (point[0] - active.origin[0]) * active.direction[0]
            + (point[1] - active.origin[1]) * active.direction[1],
        );
        setPreviewExtension(active.extension);
      },
      onPointerUp: (event) => {
        const active = drag.current;
        if (!active || active.pointerId !== event.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        drag.current = null;
        setPreviewExtension(null);
        if (Math.abs(active.extension - storedExtension) > 1e-4) {
          void updateDrawingAnnotation(annotationId, { extension: active.extension }).catch(showDrawingError);
        }
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      },
      onPointerCancel: (event) => {
        if (!drag.current || drag.current.pointerId !== event.pointerId) return;
        drag.current = null;
        setPreviewExtension(null);
      },
    };
  };

  return {
    extension: previewExtension ?? storedExtension,
    adjusting: previewExtension !== null,
    bindGrip,
  };
}

function AnnotationExtensionGrip({
  testId,
  index,
  position,
  binding,
}: {
  testId: string;
  index: number;
  position: [number, number];
  binding: AnnotationExtensionGripBinding;
}) {
  const { t } = useTranslation();
  return <g>
    <circle
      data-testid={testId}
      data-grip-index={index}
      cx={position[0]}
      cy={position[1]}
      r="2.8"
      fill="transparent"
      className="cursor-grab active:cursor-grabbing"
      {...binding}
    >
      <title>{t('drawing.workspace.dragToAdjustCenterLineExtension')}</title>
    </circle>
    <rect
      x={position[0] - 0.85}
      y={position[1] - 0.85}
      width="1.7"
      height="1.7"
      rx="0.3"
      fill="#fff"
      stroke="#6654c7"
      strokeWidth="0.5"
      pointerEvents="none"
    />
  </g>;
}

function OutlinedText({ x, y, color, selected, children, textAnchor = 'middle', transform }: { x: number; y: number; color: string; selected: boolean; children: ReactNode; textAnchor?: 'start' | 'middle' | 'end'; transform?: string }) {
  const style = useDrawingStyle();
  return <text x={x} y={y} transform={transform} fill={color} stroke="#fff" strokeWidth="1.6" paintOrder="stroke" fontFamily={style.font_family} fontSize={style.text_height_mm} fontWeight={selected ? 650 : 500} textAnchor={textAnchor}>{children}</text>;
}

function DimensionValueText({
  x,
  y,
  color,
  selected,
  children,
  textAnchor = 'middle',
  transform,
  maskDimensionLine = true,
}: {
  x: number;
  y: number;
  color: string;
  selected: boolean;
  children: string;
  textAnchor?: 'start' | 'middle' | 'end';
  transform?: string;
  maskDimensionLine?: boolean;
}) {
  const style = useDrawingStyle();
  const width = drawingDimensionTextWidth(children, style.text_height_mm);
  const paddingY = 0.75;
  const height = style.text_height_mm * 1.18 + paddingY * 2;
  const rectX = textAnchor === 'middle'
    ? x - width / 2
    : textAnchor === 'start'
      ? x - 0.8
      : x - width + 0.8;
  const rectY = y - style.text_height_mm * 0.94 - paddingY;
  const text = maskDimensionLine
    ? <OutlinedText x={x} y={y} color={color} selected={selected} textAnchor={textAnchor} transform={transform}>{children}</OutlinedText>
    : <text
      x={x}
      y={y}
      transform={transform}
      fill={color}
      stroke="none"
      fontFamily={style.font_family}
      fontSize={style.text_height_mm}
      fontWeight={selected ? 650 : 500}
      textAnchor={textAnchor}
    >{children}</text>;
  return <>
    {maskDimensionLine && <rect
      data-testid="drawing-dimension-text-mask"
      x={rectX}
      y={rectY}
      width={width}
      height={height}
      fill="#fff"
      stroke="none"
      transform={transform}
      pointerEvents="none"
    />}
    {text}
  </>;
}

function MultilineOutlinedText({ position, text, color, selected }: { position: [number, number]; text: string; color: string; selected: boolean }) {
  const style = useDrawingStyle();
  const lines = text.split('\n');
  return <text x={position[0]} y={position[1]} fill={color} stroke="#fff" strokeWidth="1.6" paintOrder="stroke" fontFamily={style.font_family} fontSize={style.text_height_mm} fontWeight={selected ? 650 : 500} textAnchor="start">{lines.map((line, index) => <tspan key={index} x={position[0]} dy={index === 0 ? 0 : style.text_height_mm * 1.25}>{line}</tspan>)}</text>;
}

function BrokenAnnotation({ view, onSelect }: { view: DrawingViewDto; onSelect: () => void }) {
  const { t } = useTranslation();
  return <g data-testid="drawing-broken-annotation" onPointerDown={(event) => { event.stopPropagation(); onSelect(); }} className="cursor-pointer"><circle cx={view.position[0]} cy={view.position[1] - 8} r="3.1" fill="#fff3f0" stroke="#b54432" strokeWidth="0.45" /><text x={view.position[0]} y={view.position[1] - 6.8} fill="#b54432" fontSize="3.5" fontWeight="700" textAnchor="middle">!</text><title>{t('drawing.workspace.annotationReferenceMissing')}</title></g>;
}

type ViewPlacementInspectorState = {
  kind: DrawingViewKind;
  scale: number;
  root: DrawingViewDto | null;
  onScaleChange: (scale: number) => void;
  onCancel: () => void;
};

type ChamferPlacementInspectorState = {
  draft: ChamferDraft;
  standard: DrawingStandard;
  onPositionChange: (position: [number, number]) => void;
  onCancel: () => void;
};

function DrawingInspector({
  sheet,
  selectedViewId,
  selectedAnnotationId,
  placement,
  chamfer,
}: {
  sheet: DrawingSheetDto;
  selectedViewId: number | null;
  selectedAnnotationId: number | null;
  placement: ViewPlacementInspectorState | null;
  chamfer: ChamferPlacementInspectorState | null;
}) {
  const { t } = useTranslation();
  const assembly = useAppStore((state) => state.assemblyDocument);
  const scene = useAppStore((state) => state.solidScene);
  const view = sheet.views.find((candidate) => candidate.id === selectedViewId) ?? null;
  const annotation = sheet.annotations.find((candidate) => candidate.id === selectedAnnotationId) ?? null;
  const run = (action: Promise<void>) => void action.catch(showDrawingError);
  return <aside data-mcp-surface="drawing/inspector" className="w-[300px] shrink-0 overflow-y-auto border-l border-edge bg-panel p-3">
    <div className="mb-3 text-[10px] font-semibold tracking-[0.16em] text-mute">{placement ? t('drawing.workspace.sectionPlacingView') : chamfer ? t('drawing.workspace.sectionChamferNote') : annotation ? t('drawing.workspace.sectionAnnotation') : view ? t('drawing.workspace.sectionDrawingView') : t('drawing.workspace.sectionSheetProperties')}</div>
    {placement ? <ViewPlacementInspector placement={placement} /> : chamfer ? <ChamferPlacementInspector chamfer={chamfer} /> : annotation ? <AnnotationInspector annotation={annotation} sheet={sheet} run={run} /> : view ? <>
      <Field label={t('drawing.workspace.fieldName')}><input className="drawing-input" value={view.name} onChange={(event) => run(updateDrawingView(view.id, { name: event.target.value || t('drawing.workspace.defaultViewName') }))} /></Field>
      <Field label={t('drawing.workspace.fieldModelScope')}><select className="drawing-input" value={view.scope ?? 'definition'} onChange={(event) => run(updateDrawingView(view.id, { scope: event.target.value as 'definition' | 'assembly', occurrence_ids: [] }))}><option value="definition">{t('drawing.workspace.scopePartDefinitions')}</option><option value="assembly">{t('drawing.workspace.scopePlacedAssembly')}</option></select></Field>
      {view.scope === 'assembly' && <Field label={t('drawing.workspace.fieldOccurrence')}><select className="drawing-input" value={(view.occurrence_ids ?? []).length === 1 ? view.occurrence_ids![0] : ''} onChange={(event) => run(updateDrawingView(view.id, { occurrence_ids: event.target.value ? [Number(event.target.value)] : [] }))}><option value="">{t('drawing.workspace.optionAllVisibleOccurrences')}</option>{assembly.component_structure.occurrences.map((occurrence) => <option key={occurrence.id} value={occurrence.id}>{occurrence.name}</option>)}</select></Field>}
      <Field label={t('drawing.workspace.fieldProjectionGroupScale')}><select className="drawing-input" value={view.scale} onChange={(event) => run(updateDrawingView(view.id, { scale: Number(event.target.value) }))}>{drawingScales.map((scale) => <option key={scale} value={scale}>{scaleLabel(scale)}</option>)}</select></Field>
      {view.parent_view_id !== null && <div className="mb-3 rounded border border-accent/30 bg-accent/8 p-2 text-[10px] leading-relaxed text-mute"><span className="font-semibold text-accent">{t('drawing.workspace.sectionGroupedView')}</span><br />{t('drawing.workspace.groupedViewFollows').replace('{field}', view.alignment === 'vertical' ? t('drawing.workspace.alignmentXPosition') : view.alignment === 'horizontal' ? t('drawing.workspace.alignmentYPosition') : t('drawing.workspace.alignmentScale')).replace('{root}', drawingViewGroupRoot(sheet, view.id)?.name ?? t('drawing.workspace.defaultBaseViewName'))}</div>}
      {view.derivation && <DerivedViewInspector view={view} run={run} />}
      <Toggle label={t('drawing.workspace.toggleHiddenLines')} checked={view.show_hidden_lines} icon={view.show_hidden_lines ? <Eye size={14} /> : <EyeOff size={14} />} onChange={(checked) => run(updateDrawingView(view.id, { show_hidden_lines: checked }))} />
      <Toggle label={t('drawing.workspace.toggleTangentEdges')} checked={view.show_tangent_edges} onChange={(checked) => run(updateDrawingView(view.id, { show_tangent_edges: checked }))} />
      <div className="mt-4 border-t border-edge pt-3"><div className="mb-2 text-[10px] font-semibold tracking-wider text-mute">{t('drawing.workspace.sectionBodies')}</div>
        <label className="flex items-center gap-2 py-1.5 text-[11px] text-ink"><input type="checkbox" checked={view.body_ids.length === 0} onChange={() => run(updateDrawingView(view.id, { body_ids: [] }))} />{t('drawing.workspace.optionAllActiveBodies')}</label>
        {scene.bodies.map((body) => { const all = view.body_ids.length === 0; const explicit = view.body_ids.includes(body.id); return <label key={body.id} className="flex items-center gap-2 py-1.5 pl-3 text-[11px] text-mute"><input type="checkbox" checked={all || explicit} onChange={() => { const base = all ? scene.bodies.map((candidate) => candidate.id) : view.body_ids; const ids = all || explicit ? base.filter((id) => id !== body.id) : [...new Set([...base, body.id])]; if (ids.length > 0) run(updateDrawingView(view.id, { body_ids: ids.length === scene.bodies.length ? [] : ids })); }} />{body.name}</label>; })}
      </div>
      <button type="button" onClick={() => run(deleteDrawingView(view.id))} className="mt-5 flex h-8 w-full items-center justify-center gap-2 rounded border border-warn/35 text-[11px] text-warn hover:bg-warn/10"><Trash2 size={13} /> {t('drawing.workspace.deleteView')}</button>
    </> : <SheetInspector sheet={sheet} run={run} />}
  </aside>;
}

const derivationKindKeys: Record<string, string> = {
  section: 'drawing.workspace.derivationSection',
  removed_section: 'drawing.workspace.derivationRemovedSection',
  detail: 'drawing.workspace.derivationDetail',
  auxiliary: 'drawing.workspace.derivationAuxiliary',
  broken: 'drawing.workspace.derivationBroken',
};
function derivationKindKey(type: string): string { return derivationKindKeys[type] ?? 'drawing.workspace.derivationSection'; }

const titleBlockFieldKeys: Record<string, string> = {
  title: 'drawing.workspace.titleBlockTitle',
  drawing_number: 'drawing.workspace.titleBlockDrawingNumber',
  revision: 'drawing.workspace.titleBlockRevision',
  author: 'drawing.workspace.titleBlockAuthor',
  checked_by: 'drawing.workspace.titleBlockCheckedBy',
  approved_by: 'drawing.workspace.titleBlockApprovedBy',
  company: 'drawing.workspace.titleBlockCompany',
  material: 'drawing.workspace.titleBlockMaterial',
  finish: 'drawing.workspace.titleBlockFinish',
};
function titleBlockFieldKey(key: string): string { return titleBlockFieldKeys[key] ?? key; }

const lineRoleKeys: Record<string, string> = {
  visible: 'drawing.workspace.lineRoleVisible',
  hidden: 'drawing.workspace.lineRoleHidden',
  center: 'drawing.workspace.lineRoleCenter',
  cutting_plane: 'drawing.workspace.lineRoleCuttingPlane',
  phantom: 'drawing.workspace.lineRolePhantom',
  break_line: 'drawing.workspace.lineRoleBreakLine',
  dimension: 'drawing.workspace.lineRoleDimension',
  extension: 'drawing.workspace.lineRoleExtension',
  leader: 'drawing.workspace.lineRoleLeader',
  hatch: 'drawing.workspace.lineRoleHatch',
};
function lineRoleKey(role: string): string { return lineRoleKeys[role] ?? role; }

const surfaceLayKeys: Record<string, string> = {
  none: 'drawing.workspace.surfaceLayNone',
  parallel: 'drawing.workspace.surfaceLayParallel',
  perpendicular: 'drawing.workspace.surfaceLayPerpendicular',
  crossed: 'drawing.workspace.surfaceLayCrossed',
  multidirectional: 'drawing.workspace.surfaceLayMultidirectional',
  circular: 'drawing.workspace.surfaceLayCircular',
  radial: 'drawing.workspace.surfaceLayRadial',
  particulate: 'drawing.workspace.surfaceLayParticulate',
};
function surfaceLayKey(lay: string): string { return surfaceLayKeys[lay] ?? lay; }

const weldTypeKeys: Record<string, string> = {
  fillet: 'drawing.workspace.weldTypeFillet',
  square_groove: 'drawing.workspace.weldTypeSquareGroove',
  v_groove: 'drawing.workspace.weldTypeVGroove',
  bevel_groove: 'drawing.workspace.weldTypeBevelGroove',
  u_groove: 'drawing.workspace.weldTypeUGroove',
  j_groove: 'drawing.workspace.weldTypeJGroove',
  plug_slot: 'drawing.workspace.weldTypePlugSlot',
  spot: 'drawing.workspace.weldTypeSpot',
  seam: 'drawing.workspace.weldTypeSeam',
  surfacing: 'drawing.workspace.weldTypeSurfacing',
};
function weldTypeKey(type: string): string { return weldTypeKeys[type] ?? type; }

const gdtCharacteristicKeys: Record<string, string> = {
  straightness: 'drawing.workspace.gdtStraightness',
  flatness: 'drawing.workspace.gdtFlatness',
  circularity: 'drawing.workspace.gdtCircularity',
  cylindricity: 'drawing.workspace.gdtCylindricity',
  profile_line: 'drawing.workspace.gdtProfileLine',
  profile_surface: 'drawing.workspace.gdtProfileSurface',
  angularity: 'drawing.workspace.gdtAngularity',
  perpendicularity: 'drawing.workspace.gdtPerpendicularity',
  parallelism: 'drawing.workspace.gdtParallelism',
  position: 'drawing.workspace.gdtPosition',
  concentricity: 'drawing.workspace.gdtConcentricity',
  symmetry: 'drawing.workspace.gdtSymmetry',
  circular_runout: 'drawing.workspace.gdtCircularRunout',
  total_runout: 'drawing.workspace.gdtTotalRunout',
};
function gdtCharacteristicKey(characteristic: string): string { return gdtCharacteristicKeys[characteristic] ?? characteristic; }

const viewKindKeys: Record<string, string> = {
  front: 'drawing.workspace.viewKindFront',
  rear: 'drawing.workspace.viewKindRear',
  left: 'drawing.workspace.viewKindLeft',
  right: 'drawing.workspace.viewKindRight',
  top: 'drawing.workspace.viewKindTop',
  bottom: 'drawing.workspace.viewKindBottom',
  isometric: 'drawing.workspace.viewKindIsometric',
  custom: 'drawing.workspace.viewKindCustom',
  section: 'drawing.workspace.viewKindSection',
  detail: 'drawing.workspace.viewKindDetail',
  auxiliary: 'drawing.workspace.viewKindAuxiliary',
};
function viewKindWordKey(kind: string): string { return viewKindKeys[kind] ?? kind; }

function DerivedViewInspector({ view, run }: { view: DrawingViewDto; run: (action: Promise<void>) => void }) {
  const { t } = useTranslation();
  const derivation = view.derivation;
  const setDrawingTool = useAppStore((state) => state.setDrawingTool);
  if (!derivation) return null;
  const update = (changes: Partial<typeof derivation>) => run(updateDrawingView(view.id, { derivation: { ...derivation, ...changes } as typeof derivation }));
  return <div className="mb-4 rounded border border-accent/30 bg-accent/8 p-2">
    <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-accent">{t('drawing.workspace.associativeView').replace('{kind}', t(derivationKindKey(derivation.type)))}</div>
    {derivation.type !== 'broken' && <button type="button" data-testid="drawing-reassociate-view-reference" onClick={() => setDrawingTool('reassociate')} className="mb-3 flex h-7 w-full items-center justify-center rounded border border-accent/40 bg-panel text-[10px] font-semibold text-accent hover:bg-accent/10">{t('drawing.workspace.reassociateSourceReference')}</button>}
    {'label' in derivation && <Field label={t('drawing.workspace.fieldViewIdentifier')}><input className="drawing-input" value={derivation.label} onChange={(event) => update({ label: event.target.value } as Partial<typeof derivation>)} /></Field>}
    {derivation.type === 'detail' && <NumberField label={t('drawing.workspace.fieldDetailRadius')} value={derivation.radius} onChange={(radius) => update({ radius })} />}
    {(derivation.type === 'section' || derivation.type === 'removed_section') && <>
      {derivation.type === 'section' && <OptionalNumberField label={t('drawing.workspace.fieldSectionDepth')} value={derivation.depth} onChange={(depth) => update({ depth })} />}
      <div className="grid grid-cols-2 gap-2"><NumberField label={t('drawing.workspace.fieldHatchAngle')} value={derivation.hatch_angle_deg} onChange={(hatch_angle_deg) => update({ hatch_angle_deg })} /><NumberField label={t('drawing.workspace.fieldHatchSpacing')} value={derivation.hatch_spacing_mm} onChange={(hatch_spacing_mm) => update({ hatch_spacing_mm })} /></div>
    </>}
    {derivation.type === 'auxiliary' && <Toggle label={t('drawing.workspace.toggleFlipViewingDirection')} checked={derivation.flipped} onChange={(flipped) => update({ flipped })} />}
    {derivation.type === 'broken' && <>
      <Field label={t('drawing.workspace.fieldBreakAxis')}><select className="drawing-input" value={derivation.axis} onChange={(event) => update({ axis: event.target.value as typeof derivation.axis })}><option value="horizontal">{t('drawing.workspace.optionHorizontalShortening')}</option><option value="vertical">{t('drawing.workspace.optionVerticalShortening')}</option></select></Field>
      <NumberField label={t('drawing.workspace.fieldPaperGap')} value={derivation.gap_mm} onChange={(gap_mm) => update({ gap_mm: Math.max(2, gap_mm) })} />
    </>}
  </div>;
}

function ChamferPlacementInspector({
  chamfer,
}: {
  chamfer: ChamferPlacementInspectorState;
}) {
  const { t } = useTranslation();
  const units = useAppStore((state) => state.document?.settings.units ?? 'mm');
  if (!chamfer.draft) {
    return <div data-testid="drawing-chamfer-placement-controls">
      <div className="mb-3 rounded border border-[#1688c9]/45 bg-[#1688c9]/10 p-3 text-[11px] leading-relaxed text-ink">
        <div className="font-semibold text-[#1688c9]">{t('drawing.workspace.selectHighlightedChamferEdge')}</div>
        <div className="mt-1 text-mute">{t('drawing.workspace.chamferEligibleHint')}</div>
      </div>
      <button type="button" onClick={chamfer.onCancel} className="drawing-mini-button h-8 w-full">{t('drawing.workspace.cancelChamferNote')}</button>
    </div>;
  }
  const { candidate, position } = chamfer.draft;
  return <div data-testid="drawing-chamfer-placement-controls">
    <div className="mb-3 rounded border border-accent/40 bg-accent/10 p-3 text-[11px] leading-relaxed text-ink">
      <div className="font-semibold text-accent">{t('drawing.workspace.leaderPreviewActive')}</div>
      <div className="mt-1 text-mute">{t('drawing.workspace.leaderPreviewHint')}</div>
    </div>
    <Field label={t('drawing.workspace.calloutLabel').replace('{standard}', chamfer.standard === 'iso' ? 'ISO' : 'ANSI / ASME')}>
      <div className="drawing-input flex items-center font-mono font-semibold" data-testid="drawing-chamfer-callout-preview">
        {drawingChamferText(candidate.distance, candidate.angleDeg, '', chamfer.standard, units)}
      </div>
    </Field>
    <div className="grid grid-cols-2 gap-2">
      <NumberField label={t('drawing.workspace.fieldPaperX')} value={position[0]} onChange={(value) => chamfer.onPositionChange([value, position[1]])} />
      <NumberField label={t('drawing.workspace.fieldPaperY')} value={position[1]} onChange={(value) => chamfer.onPositionChange([position[0], value])} />
    </div>
    <div className="mb-3 rounded border border-edge bg-header/45 p-2 text-[10px] leading-relaxed text-mute">
      {t('drawing.workspace.chamferAutoGeometry').replace('{distance}', trimNumber(candidate.distance)).replace('{angle}', trimNumber(candidate.angleDeg))}
    </div>
    <button type="button" onClick={chamfer.onCancel} className="drawing-mini-button h-8 w-full">{t('drawing.workspace.cancelPlacement')}</button>
  </div>;
}

function ViewPlacementInspector({ placement }: { placement: ViewPlacementInspectorState }) {
  const { t } = useTranslation();
  const alignment = placement.kind === 'top' || placement.kind === 'bottom'
    ? 'vertical'
    : placement.kind === 'left' || placement.kind === 'right'
      ? 'horizontal'
      : 'free';
  return <div data-testid="drawing-view-placement-controls">
    <div className="mb-3 rounded border border-accent/40 bg-accent/10 p-3 text-[11px] leading-relaxed text-ink">
      <div className="font-semibold text-accent">{t('drawing.workspace.viewPreviewActive').replace('{kind}', viewKindLabel(placement.kind))}</div>
      <div className="mt-1 text-mute">{t('drawing.workspace.viewPlacementHint')}</div>
    </div>
    <Field label={t('drawing.workspace.fieldProjectionGroupScale')}>
      <select
        className="drawing-input"
        data-testid="drawing-placement-scale"
        value={placement.scale}
        onChange={(event) => placement.onScaleChange(Number(event.target.value))}
      >
        {drawingScales.map((scale) => <option key={scale} value={scale}>{scaleLabel(scale)}</option>)}
      </select>
    </Field>
    <div className="mb-3 rounded border border-edge bg-header/45 p-2 text-[10px] leading-relaxed text-mute">
      {placement.root ? <>
        <span className="font-semibold text-ink">{t('drawing.workspace.alignedTo').replace('{name}', placement.root.name)}</span><br />
        {t('drawing.workspace.alignmentInherit').replace('{position}', alignment === 'vertical' ? t('drawing.workspace.sharesPaperXPosition') : alignment === 'horizontal' ? t('drawing.workspace.sharesPaperYPosition') : t('drawing.workspace.positionRemainsFree'))}
      </> : <>
        <span className="font-semibold text-ink">{t('drawing.workspace.newProjectionGroup')}</span><br />
        {t('drawing.workspace.newProjectionGroupHint')}
      </>}
    </div>
    <button type="button" onClick={placement.onCancel} className="drawing-mini-button h-8 w-full">{t('drawing.workspace.cancelPlacement')}</button>
  </div>;
}

function SheetInspector({ sheet, run }: { sheet: DrawingSheetDto; run: (action: Promise<void>) => void }) {
  const { t } = useTranslation();
  const formats = drawingFormatsForStandard(sheet.standard);
  const scene = useAppStore((state) => state.solidScene);
  const templates = useAppStore((state) => state.drawingDocument.templates);
  const [templateName, setTemplateName] = useState(sheet.template_name || translate('drawing.workspace.defaultCompanyStandard'));
  const setStandard = (standard: DrawingStandard) => run(updateActiveDrawingSheet({
    standard,
    format: defaultDrawingFormat(standard),
    projection_method: standard === 'ansi' ? 'third_angle' : 'first_angle',
    tolerance_note: { preset: standard === 'ansi' ? 'ansi_decimal' : 'iso2768_medium', custom: '' },
  }));
  return <>
    <Field label={t('drawing.workspace.fieldSheetName')}><input className="drawing-input" value={sheet.name} onChange={(event) => run(updateActiveDrawingSheet({ name: event.target.value || t('drawing.workspace.defaultSheetName') }))} /></Field>
    <Field label={t('drawing.workspace.fieldStandard')}><select className="drawing-input" value={sheet.standard} onChange={(event) => setStandard(event.target.value as DrawingStandard)}><option value="iso">ISO</option><option value="ansi">ANSI / ASME</option></select></Field>
    <Field label={t('drawing.workspace.fieldPaper')}><select className="drawing-input" value={sheet.format} onChange={(event) => run(updateActiveDrawingSheet({ format: event.target.value as DrawingSheetFormat }))}>{formats.map((format) => <option key={format} value={format}>{drawingFormatLabel(format)}</option>)}</select></Field>
    <Field label={t('drawing.workspace.fieldOrientation')}><select className="drawing-input" value={sheet.orientation} onChange={(event) => run(updateActiveDrawingSheet({ orientation: event.target.value as DrawingSheetDto['orientation'] }))}><option value="landscape">{t('drawing.workspace.orientationLandscape')}</option><option value="portrait">{t('drawing.workspace.orientationPortrait')}</option></select></Field>
    <Field label={t('drawing.workspace.fieldProjectionConvention')}><select className="drawing-input" value={sheet.projection_method} onChange={(event) => run(updateActiveDrawingSheet({ projection_method: event.target.value as DrawingSheetDto['projection_method'] }))}><option value="first_angle">{t('drawing.workspace.projectionFirstAngle')}</option><option value="third_angle">{t('drawing.workspace.projectionThirdAngle')}</option></select></Field>
    <Field label={t('drawing.workspace.fieldGeneralTolerance')}><select className="drawing-input" value={sheet.tolerance_note.preset} onChange={(event) => run(updateActiveDrawingSheet({ tolerance_note: { ...sheet.tolerance_note, preset: event.target.value as DrawingTolerancePreset } }))}><option value="none">{t('drawing.workspace.toleranceNone')}</option>{sheet.standard === 'iso' ? <><option value="iso2768_fine">ISO 2768-f</option><option value="iso2768_medium">ISO 2768-m</option><option value="iso2768_coarse">ISO 2768-c</option><option value="iso2768_very_coarse">ISO 2768-v</option></> : <option value="ansi_decimal">{t('drawing.workspace.toleranceAnsiDecimal')}</option>}<option value="custom">{t('drawing.workspace.toleranceCustom')}</option></select></Field>
    {sheet.tolerance_note.preset === 'custom' && <Field label={t('drawing.workspace.fieldToleranceNote')}><textarea className="drawing-input min-h-16 py-2" value={sheet.tolerance_note.custom} onChange={(event) => run(updateActiveDrawingSheet({ tolerance_note: { ...sheet.tolerance_note, custom: event.target.value } }))} /></Field>}
    <div className="mt-4 border-t border-edge pt-3 text-[10px] font-semibold tracking-wider text-mute">{t('drawing.workspace.sectionTitleBlock')}</div>
    {(['title', 'drawing_number', 'revision', 'author', 'checked_by', 'approved_by', 'company', 'material', 'finish'] as const).map((key) => <Field key={key} label={t(titleBlockFieldKey(key))}><input className="drawing-input" value={sheet.title_block[key]} onChange={(event) => run(updateActiveDrawingSheet({ title_block: { ...sheet.title_block, [key]: event.target.value } }))} /></Field>)}

    <div className="mt-4 border-t border-edge pt-3 text-[10px] font-semibold tracking-wider text-mute">{t('drawing.workspace.sectionStyleTemplate')}</div>
    <Field label={t('drawing.workspace.fieldCompanyTemplate')}><select className="drawing-input" value={templates.find((template) => template.name === sheet.template_name)?.id ?? ''} onChange={(event) => { if (event.target.value) run(applyDrawingTemplate(Number(event.target.value))); }}><option value="">{sheet.template_name || t('drawing.workspace.templateSheetLocalStyle')}</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></Field>
    <div className="mb-3 grid grid-cols-[1fr_76px_30px] gap-1"><input className="drawing-input" aria-label={t('drawing.workspace.ariaTemplateName')} value={templateName} onChange={(event) => setTemplateName(event.target.value)} /><button type="button" className="drawing-mini-button" onClick={() => run(saveActiveDrawingTemplate(templateName))}>{t('drawing.workspace.actionSave')}</button><button type="button" className="drawing-mini-button" title={t('drawing.workspace.titleDeleteCompanyTemplate')} disabled={!templates.some((template) => template.name === sheet.template_name)} onClick={() => { const template = templates.find((candidate) => candidate.name === sheet.template_name); if (template) run(deleteDrawingTemplate(template.id)); }}><Trash2 size={12} /></button></div>
    <div className="mb-3 rounded border border-edge bg-header/35 p-2 text-[10px] leading-relaxed text-mute">{t('drawing.workspace.templateStoredHint')}</div>
    <Field label={t('drawing.workspace.fieldStyleName')}><input className="drawing-input" value={sheet.style.name} onChange={(event) => run(updateActiveDrawingSheet({ style: { ...sheet.style, name: event.target.value } }))} /></Field>
    <Field label={t('drawing.workspace.fieldFontFamily')}><input className="drawing-input" value={sheet.style.font_family} onChange={(event) => run(updateActiveDrawingSheet({ style: { ...sheet.style, font_family: event.target.value } }))} /></Field>
    <div className="grid grid-cols-2 gap-2"><NumberField label={t('drawing.workspace.fieldTextHeight')} value={sheet.style.text_height_mm} onChange={(text_height_mm) => run(updateActiveDrawingSheet({ style: { ...sheet.style, text_height_mm } }))} /><NumberField label={t('drawing.workspace.fieldSmallText')} value={sheet.style.small_text_height_mm} onChange={(small_text_height_mm) => run(updateActiveDrawingSheet({ style: { ...sheet.style, small_text_height_mm } }))} /><NumberField label={t('drawing.workspace.fieldArrowSize')} value={sheet.style.arrow_size_mm} onChange={(arrow_size_mm) => run(updateActiveDrawingSheet({ style: { ...sheet.style, arrow_size_mm } }))} /></div>
    <div className="mb-3 rounded border border-edge bg-header/25 p-2"><div className="mb-2 grid grid-cols-[1fr_58px_1.2fr] gap-1 text-[9px] font-semibold uppercase tracking-wider text-mute"><span>{t('drawing.workspace.lineRoleHeader')}</span><span>mm</span><span>{t('drawing.workspace.lineDashGapHeader')}</span></div>{(['visible', 'hidden', 'center', 'cutting_plane', 'phantom', 'break_line', 'dimension', 'extension', 'leader', 'hatch'] as DrawingLineRole[]).map((role) => <DrawingLineStyleEditor key={role} sheet={sheet} role={role} run={run} />)}</div>
    <div className="grid grid-cols-2 gap-2"><NumberField label={t('drawing.workspace.fieldHatchAngle')} value={sheet.style.hatch_angle_deg} onChange={(hatch_angle_deg) => run(updateActiveDrawingSheet({ style: { ...sheet.style, hatch_angle_deg } }))} /><NumberField label={t('drawing.workspace.fieldHatchSpacing')} value={sheet.style.hatch_spacing_mm} onChange={(hatch_spacing_mm) => run(updateActiveDrawingSheet({ style: { ...sheet.style, hatch_spacing_mm } }))} /></div>

    <div className="mt-4 border-t border-edge pt-3 text-[10px] font-semibold tracking-wider text-mute">{t('drawing.workspace.sectionRevisionsRelease')}</div>
    <Field label={t('drawing.workspace.fieldDocumentStatus')}><select className="drawing-input" value={sheet.release.status} disabled={sheet.release.status === 'released'} onChange={(event) => run(updateActiveDrawingSheet({ release: { ...sheet.release, status: event.target.value as typeof sheet.release.status } }))}><option value="draft">{t('drawing.workspace.statusDraft')}</option><option value="in_review">{t('drawing.workspace.statusInReview')}</option><option value="released">{t('drawing.workspace.statusReleased')}</option><option value="superseded">{t('drawing.workspace.statusSuperseded')}</option><option value="obsolete">{t('drawing.workspace.statusObsolete')}</option></select></Field>
    {sheet.release.released_revision && <div className="mb-3 rounded border border-accent/30 bg-accent/8 p-2 text-[10px] leading-relaxed text-mute">{t('drawing.workspace.lastIssuedRevision')} <span className="font-semibold text-accent">{sheet.release.released_revision}</span>{sheet.release.released_at ? ` · ${sheet.release.released_at}` : ''}. {t('drawing.workspace.editingIssuedContent')}</div>}
    <Toggle label={t('drawing.workspace.toggleShowRevisionTable')} checked={sheet.revision_table_position !== null} onChange={(checked) => run(updateActiveDrawingSheet({ revision_table_position: checked ? [10, 10] : null }))} />
    <div className="space-y-2">
      {sheet.revisions.map((revision) => { const locked = revision.status === 'released'; return <div key={revision.id} className="rounded border border-edge bg-header/35 p-2">
        <div className="mb-2 grid grid-cols-[54px_1fr_28px] gap-1"><input className="drawing-input uppercase px-1" disabled={locked} value={revision.revision} onChange={(event) => run(updateDrawingRevision(revision.id, { revision: event.target.value.toUpperCase() }))} /><input className="drawing-input px-1" disabled={locked} value={revision.description} placeholder={t('drawing.workspace.placeholderDescription')} onChange={(event) => run(updateDrawingRevision(revision.id, { description: event.target.value }))} /><button type="button" className="drawing-mini-button" disabled={locked} title={locked ? t('drawing.workspace.titleReleasedRevisionImmutable') : t('drawing.workspace.deleteRevision')} onClick={() => run(deleteDrawingRevision(revision.id))}><Trash2 size={12} /></button></div>
        <div className="grid grid-cols-2 gap-1"><input className="drawing-input px-1" disabled={locked} type="date" value={revision.date} onChange={(event) => run(updateDrawingRevision(revision.id, { date: event.target.value }))} /><select className="drawing-input px-1" disabled={locked} value={revision.status} onChange={(event) => run(updateDrawingRevision(revision.id, { status: event.target.value as typeof revision.status }))}><option value="draft">{t('drawing.workspace.statusDraft')}</option><option value="in_review">{t('drawing.workspace.statusInReview')}</option><option value="released">{t('drawing.workspace.statusReleased')}</option><option value="superseded">{t('drawing.workspace.statusSuperseded')}</option><option value="obsolete">{t('drawing.workspace.statusObsolete')}</option></select></div>
        {locked && <div className="mt-1 text-[9px] font-semibold uppercase tracking-wider text-accent">{t('drawing.workspace.issuedImmutable')}</div>}
      </div>; })}
    </div>
    <div className="mt-2 grid grid-cols-2 gap-2"><button type="button" className="drawing-mini-button h-8" onClick={() => run(addDrawingRevision({ revision: nextRevisionCode(sheet.title_block.revision), description: '', date: currentIsoDate(), author: sheet.title_block.author, checked_by: sheet.title_block.checked_by, approved_by: sheet.title_block.approved_by, change_order: '', status: 'draft' }))}>{t('drawing.workspace.actionAddRevision')}</button><button type="button" className="drawing-mini-button h-8 border-accent/45 text-accent" onClick={() => run(addDrawingRevision({ revision: nextRevisionCode(sheet.title_block.revision), description: t('drawing.workspace.releasedDrawingDescription'), date: currentIsoDate(), author: sheet.title_block.author, checked_by: sheet.title_block.checked_by, approved_by: sheet.title_block.approved_by, change_order: '', status: 'released' }))}>{t('drawing.workspace.actionReleaseRevision')}</button></div>

    <div className="mt-4 border-t border-edge pt-3 text-[10px] font-semibold tracking-wider text-mute">{t('drawing.workspace.sectionBillOfMaterials')}</div>
    <Toggle label={t('drawing.workspace.toggleShowBomTable')} checked={sheet.bom_table_position !== null} onChange={(checked) => run(updateActiveDrawingSheet({ bom_table_position: checked ? [10, 45] : null }))} />
    <div className="space-y-2">
      {sheet.bom.map((item) => <div key={item.id} className="rounded border border-edge bg-header/35 p-2">
        <div className="mb-1 grid grid-cols-[42px_1fr_28px] gap-1"><input className="drawing-input px-1" value={item.item_number} onChange={(event) => run(updateDrawingBomItem(item.id, { item_number: event.target.value }))} /><input className="drawing-input px-1" value={item.part_number} placeholder={t('drawing.workspace.placeholderPartNumber')} onChange={(event) => run(updateDrawingBomItem(item.id, { part_number: event.target.value }))} /><button type="button" className="drawing-mini-button" title={t('drawing.workspace.titleDeleteBomItem')} onClick={() => run(deleteDrawingBomItem(item.id))}><Trash2 size={12} /></button></div>
        <input className="drawing-input mb-1 px-1" value={item.description} placeholder={t('drawing.workspace.placeholderDescription')} onChange={(event) => run(updateDrawingBomItem(item.id, { description: event.target.value }))} />
        <div className="grid grid-cols-2 gap-1"><select className="drawing-input px-1" value={item.body_id ?? ''} onChange={(event) => run(updateDrawingBomItem(item.id, { body_id: event.target.value ? Number(event.target.value) : null }))}><option value="">{t('drawing.workspace.optionNoModelBody')}</option>{scene.bodies.map((body) => <option key={body.id} value={body.id}>{body.name}</option>)}</select><input className="drawing-input px-1" type="number" min="1" value={item.quantity} onChange={(event) => run(updateDrawingBomItem(item.id, { quantity: Math.max(1, Math.round(Number(event.target.value) || 1)) }))} /></div>
      </div>)}
    </div>
    <button type="button" className="drawing-mini-button mt-2 h-8 w-full" onClick={() => run(addDrawingBomItem())}>{t('drawing.workspace.actionAddBomItem')}</button>
  </>;
}

function DrawingLineStyleEditor({ sheet, role, run }: { sheet: DrawingSheetDto; role: DrawingLineRole; run: (action: Promise<void>) => void }) {
  const { t } = useTranslation();
  const line = sheet.style[role];
  const update = (changes: Partial<typeof line>) => run(updateActiveDrawingSheet({ style: { ...sheet.style, [role]: { ...line, ...changes } } }));
  const roleLabel = t(lineRoleKey(role));
  return <div className="mb-1 grid grid-cols-[1fr_58px_1.2fr] items-center gap-1"><span className="truncate text-[10px] capitalize text-ink">{roleLabel}</span><input className="drawing-input h-7 px-1" aria-label={t('drawing.workspace.lineRoleWidth').replace('{role}', roleLabel)} type="number" min="0.05" max="5" step="0.05" value={line.width_mm} onChange={(event) => { const value = Number(event.target.value); if (value > 0) update({ width_mm: value }); }} /><input className="drawing-input h-7 px-1 font-mono" aria-label={t('drawing.workspace.lineRoleDashPattern').replace('{role}', roleLabel)} value={line.dash_mm.join(' ')} placeholder={t('drawing.workspace.placeholderContinuous')} onChange={(event) => update({ dash_mm: event.target.value.split(/[ ,]+/).map(Number).filter((value) => Number.isFinite(value) && value > 0).slice(0, 16) })} /></div>;
}

function AnnotationInspector({ annotation, sheet, run }: { annotation: DrawingAnnotationDto; sheet: DrawingSheetDto; run: (action: Promise<void>) => void }) {
  const { t } = useTranslation();
  const standard = sheet.standard;
  const units = useAppStore((state) => state.document?.settings.units ?? 'mm');
  const setDrawingTool = useAppStore((state) => state.setDrawingTool);
  if (annotation.kind === 'note') return <NoteAnnotationInspector note={annotation} run={run} />;
  const canReassociate = !['revision_cloud', 'automatic_symmetry_axis'].includes(annotation.kind);
  const associative = annotation.kind === 'revision_cloud' ? null : <div className="mb-3 rounded border border-accent/35 bg-accent/10 p-2 text-[10px] leading-relaxed text-mute"><span className="font-semibold text-accent">{t('drawing.workspace.sectionAssociative')}</span><br />{t('drawing.workspace.associativeHint')}{canReassociate && <button type="button" data-testid="drawing-reassociate-reference" onClick={() => setDrawingTool('reassociate')} className="mt-2 flex h-7 w-full items-center justify-center rounded border border-accent/40 bg-panel text-[10px] font-semibold text-accent hover:bg-accent/10">{t('drawing.workspace.reassociateTopologyReference')}</button>}</div>;
  let fields: ReactNode;
  switch (annotation.kind) {
    case 'linear_dimension': fields = <>
      <Field label={t('drawing.workspace.fieldOrientation')}><select className="drawing-input" value={annotation.mode} onChange={(event) => run(updateDrawingAnnotation(annotation.id, { mode: event.target.value as typeof annotation.mode }))}><option value="aligned">{t('drawing.workspace.optionAligned')}</option><option value="horizontal">{t('drawing.workspace.optionHorizontal')}</option><option value="vertical">{t('drawing.workspace.optionVertical')}</option></select></Field>
      <NumberField label={t('drawing.workspace.fieldOffset')} value={annotation.offset} onChange={(offset) => run(updateDrawingAnnotation(annotation.id, { offset }))} />
      <DimensionTextFields annotation={annotation} run={run} />
    </>; break;
    case 'line_dimension': fields = <>
      <Field label={t('drawing.workspace.fieldSmartRelationship')}><div className="drawing-input flex items-center capitalize">{annotation.mode === 'length' ? t('drawing.workspace.smartSelectedEdgeLength') : annotation.mode === 'distance' ? t('drawing.workspace.smartDistanceBetweenParallelEdges') : t('drawing.workspace.smartAngleBetweenEdges')}</div></Field>
      <div className="grid grid-cols-2 gap-2"><NumberField label={t('drawing.workspace.fieldPaperX')} value={annotation.position[0]} onChange={(value) => run(updateDrawingAnnotation(annotation.id, { position: [value, annotation.position[1]] }))} /><NumberField label={t('drawing.workspace.fieldPaperY')} value={annotation.position[1]} onChange={(value) => run(updateDrawingAnnotation(annotation.id, { position: [annotation.position[0], value] }))} /></div>
      <DimensionTextFields annotation={annotation} run={run} />
    </>; break;
    case 'point_line_dimension': fields = <>
      <Field label={t('drawing.workspace.fieldSmartRelationship')}><div className="drawing-input flex items-center">{t('drawing.workspace.smartPerpendicularDistance')}</div></Field>
      <div className="grid grid-cols-2 gap-2"><NumberField label={t('drawing.workspace.fieldPaperX')} value={annotation.position[0]} onChange={(value) => run(updateDrawingAnnotation(annotation.id, { position: [value, annotation.position[1]] }))} /><NumberField label={t('drawing.workspace.fieldPaperY')} value={annotation.position[1]} onChange={(value) => run(updateDrawingAnnotation(annotation.id, { position: [annotation.position[0], value] }))} /></div>
      <DimensionTextFields annotation={annotation} run={run} />
    </>; break;
    case 'radial_dimension': fields = <>
      <Field label={t('drawing.workspace.fieldType')}><select className="drawing-input" value={annotation.mode} onChange={(event) => run(updateDrawingAnnotation(annotation.id, { mode: event.target.value as typeof annotation.mode }))}><option value="diameter" disabled={!annotation.feature.closed}>{t('drawing.workspace.optionDiameter')}</option><option value="radius">{t('drawing.workspace.optionRadius')}</option></select></Field>
      <NumberField label={t('drawing.workspace.fieldLeaderAngle')} value={annotation.leader_angle_deg} onChange={(leader_angle_deg) => run(updateDrawingAnnotation(annotation.id, { leader_angle_deg }))} />
      <NumberField label={t('drawing.workspace.fieldLeaderOffset')} value={annotation.offset} onChange={(offset) => run(updateDrawingAnnotation(annotation.id, { offset }))} />
      <DimensionTextFields annotation={annotation} run={run} />
    </>; break;
    case 'angular_dimension': fields = <>
      <NumberField label={t('drawing.workspace.fieldArcRadius')} value={annotation.radius} onChange={(radius) => run(updateDrawingAnnotation(annotation.id, { radius }))} />
      <DimensionTextFields annotation={annotation} run={run} />
    </>; break;
    case 'hole_note': fields = <>
      {annotation.source_feature_id !== null && <div className="mb-3 rounded border border-accent/35 bg-accent/10 p-2 text-[10px] text-mute"><span className="font-semibold text-accent">{t('drawing.workspace.sectionModeledHoleFeature')}</span><br />{annotation.feature_name || t('drawing.workspace.featureFallback').replace('{id}', String(annotation.source_feature_id))} · {t('drawing.workspace.valuesFromFeatureHistory')}</div>}
      <NumberField label={t('drawing.workspace.fieldQuantity')} value={annotation.quantity} step={1} onChange={(quantity) => run(updateDrawingAnnotation(annotation.id, { quantity: Math.max(1, Math.round(quantity)) }))} />
      <NumberField label={t('drawing.workspace.fieldDiameter')} value={annotation.diameter} onChange={(diameter) => run(updateDrawingAnnotation(annotation.id, { diameter }))} />
      <OptionalNumberField label={t('drawing.workspace.fieldDepth')} value={annotation.depth} onChange={(depth) => run(updateDrawingAnnotation(annotation.id, { depth }))} />
      <Field label={t('drawing.workspace.fieldHoleStyle')}><select className="drawing-input" value={annotation.hole_style} onChange={(event) => run(updateDrawingAnnotation(annotation.id, { hole_style: event.target.value as typeof annotation.hole_style }))}><option value="simple">{t('drawing.workspace.optionSimple')}</option><option value="counterbore">{t('drawing.workspace.optionCounterbore')}</option><option value="countersink">{t('drawing.workspace.optionCountersink')}</option></select></Field>
      {annotation.hole_style === 'counterbore' && <div className="grid grid-cols-2 gap-2"><OptionalNumberField label={t('drawing.workspace.fieldCounterboreDiameter')} value={annotation.counterbore_diameter} onChange={(counterbore_diameter) => run(updateDrawingAnnotation(annotation.id, { counterbore_diameter }))} /><OptionalNumberField label={t('drawing.workspace.fieldCounterboreDepth')} value={annotation.counterbore_depth} onChange={(counterbore_depth) => run(updateDrawingAnnotation(annotation.id, { counterbore_depth }))} /></div>}
      {annotation.hole_style === 'countersink' && <div className="grid grid-cols-2 gap-2"><OptionalNumberField label={t('drawing.workspace.fieldCountersinkDiameter')} value={annotation.countersink_diameter} onChange={(countersink_diameter) => run(updateDrawingAnnotation(annotation.id, { countersink_diameter }))} /><OptionalNumberField label={t('drawing.workspace.fieldCountersinkAngle')} value={annotation.countersink_angle_deg} onChange={(countersink_angle_deg) => run(updateDrawingAnnotation(annotation.id, { countersink_angle_deg }))} /></div>}
      <Field label={t('drawing.workspace.fieldThreadDesignation')}><input className="drawing-input" placeholder={t('drawing.workspace.placeholderThreadDesignation')} value={annotation.thread} onChange={(event) => run(updateDrawingAnnotation(annotation.id, { thread: event.target.value }))} /></Field>
      <OptionalNumberField label={t('drawing.workspace.fieldThreadDepth')} value={annotation.thread_depth} onChange={(thread_depth) => run(updateDrawingAnnotation(annotation.id, { thread_depth }))} />
      <Field label={t('drawing.workspace.fieldPatternNote')}><input className="drawing-input" placeholder={t('drawing.workspace.placeholderPatternNote')} value={annotation.pattern_note} onChange={(event) => run(updateDrawingAnnotation(annotation.id, { pattern_note: event.target.value }))} /></Field>
      <Field label={t('drawing.workspace.fieldAdditionalNote')}><input className="drawing-input" placeholder={t('drawing.workspace.placeholderAdditionalNote')} value={annotation.note} onChange={(event) => run(updateDrawingAnnotation(annotation.id, { note: event.target.value }))} /></Field>
      <Field label={t('drawing.workspace.generatedCallout').replace('{standard}', standard === 'iso' ? 'ISO' : 'ANSI / ASME')}><pre className="drawing-input h-auto min-h-10 whitespace-pre-wrap py-2 font-mono text-[10px]">{drawingHoleCalloutText(annotation, standard, units)}</pre></Field>
    </>; break;
    case 'chamfer_note': fields = <>
      <Field label={t('drawing.workspace.calloutLabel').replace('{standard}', standard === 'iso' ? 'ISO' : 'ANSI / ASME')}><div className="drawing-input flex items-center font-mono font-semibold" data-testid="drawing-chamfer-callout-text">{drawingChamferText(annotation.length, annotation.angle_deg, annotation.prefix, standard, units)}</div></Field>
      <NumberField label={t('drawing.workspace.fieldChamferSetback')} value={annotation.length} onChange={(length) => run(updateDrawingAnnotation(annotation.id, { length }))} />
      <NumberField label={t('drawing.workspace.fieldAngle')} value={annotation.angle_deg} onChange={(angle_deg) => run(updateDrawingAnnotation(annotation.id, { angle_deg }))} />
      <Field label={t('drawing.workspace.fieldPrefix')}><input className="drawing-input" value={annotation.prefix} onChange={(event) => run(updateDrawingAnnotation(annotation.id, { prefix: event.target.value }))} /></Field>
      <div className="grid grid-cols-2 gap-2"><NumberField label={t('drawing.workspace.fieldPaperX')} value={annotation.position[0]} onChange={(value) => run(updateDrawingAnnotation(annotation.id, { position: [value, annotation.position[1]] }))} /><NumberField label={t('drawing.workspace.fieldPaperY')} value={annotation.position[1]} onChange={(value) => run(updateDrawingAnnotation(annotation.id, { position: [annotation.position[0], value] }))} /></div>
    </>; break;
    case 'center_mark': fields = <>
      <Field label={t('drawing.workspace.fieldReference')}><div className="drawing-input flex items-center font-mono">{t('drawing.workspace.refBodyCircle').replace('{body}', String(annotation.feature.body_id)).replace('{circle}', String(annotation.feature.edge_id))}</div></Field>
      <NumberField label={t('drawing.workspace.fieldExtensionBeyondHole')} value={annotation.extension} onChange={(extension) => run(updateDrawingAnnotation(annotation.id, { extension }))} />
    </>; break;
    case 'center_line': fields = <>
      <Field label={t('drawing.workspace.fieldReferences')}><div className="drawing-input flex items-center font-mono">{t('drawing.workspace.refCircleToCircle').replace('{first}', String(annotation.first.edge_id)).replace('{second}', String(annotation.second.edge_id))}</div></Field>
      <NumberField label={t('drawing.workspace.fieldEndExtension')} value={annotation.extension} onChange={(extension) => run(updateDrawingAnnotation(annotation.id, { extension }))} />
    </>; break;
    case 'center_line_between_edges': fields = <>
      <Field label={t('drawing.workspace.fieldReferences')}><div className="drawing-input flex items-center font-mono">{t('drawing.workspace.refEdgeToEdge').replace('{first}', String(annotation.first.edge_id)).replace('{second}', String(annotation.second.edge_id))}</div></Field>
      <Field label={t('drawing.workspace.fieldConstruction')}><div className="drawing-input flex items-center">{t('drawing.workspace.constructionMidline')}</div></Field>
      <NumberField label={t('drawing.workspace.fieldEndExtension')} value={annotation.extension} onChange={(extension) => run(updateDrawingAnnotation(annotation.id, { extension }))} />
    </>; break;
    case 'automatic_symmetry_axis': fields = <>
      <Field label={t('drawing.workspace.fieldAxes')}><select className="drawing-input" value={annotation.axis} onChange={(event) => run(updateDrawingAnnotation(annotation.id, { axis: event.target.value as typeof annotation.axis }))}><option value="both">{t('drawing.workspace.optionHorizontalAndVertical')}</option><option value="x">{t('drawing.workspace.optionHorizontal')}</option><option value="y">{t('drawing.workspace.optionVertical')}</option></select></Field>
      <NumberField label={t('drawing.workspace.fieldEndExtension')} value={annotation.extension} onChange={(extension) => run(updateDrawingAnnotation(annotation.id, { extension }))} />
    </>; break;
    case 'bolt_circle_center_line': fields = <>
      <Field label={t('drawing.workspace.fieldPattern')}><div className="drawing-input flex items-center">{t('drawing.workspace.patternCircularCenters').replace('{count}', String(annotation.features.length))}</div></Field>
      <NumberField label={t('drawing.workspace.fieldCenterMarkExtension')} value={annotation.extension} onChange={(extension) => run(updateDrawingAnnotation(annotation.id, { extension }))} />
    </>; break;
    case 'chain_dimension': fields = <>
      <Field label={t('drawing.workspace.fieldLayout')}><select className="drawing-input" value={annotation.layout} onChange={(event) => run(updateDrawingAnnotation(annotation.id, { layout: event.target.value as typeof annotation.layout }))}><option value="chain">{t('drawing.workspace.optionChain')}</option><option value="baseline">{t('drawing.workspace.optionBaseline')}</option><option value="continued">{t('drawing.workspace.optionContinued')}</option></select></Field>
      <Field label={t('drawing.workspace.fieldOrientation')}><select className="drawing-input" value={annotation.mode} onChange={(event) => run(updateDrawingAnnotation(annotation.id, { mode: event.target.value as typeof annotation.mode }))}><option value="aligned">{t('drawing.workspace.optionAligned')}</option><option value="horizontal">{t('drawing.workspace.optionHorizontal')}</option><option value="vertical">{t('drawing.workspace.optionVertical')}</option></select></Field>
      <NumberField label={t('drawing.workspace.fieldOffset')} value={annotation.offset} onChange={(offset) => run(updateDrawingAnnotation(annotation.id, { offset }))} />
      <NumberField label={t('drawing.workspace.fieldBaselineSpacing')} value={annotation.spacing} onChange={(spacing) => run(updateDrawingAnnotation(annotation.id, { spacing }))} />
      <DimensionTextFields annotation={annotation} run={run} />
    </>; break;
    case 'ordinate_dimension': fields = <>
      <Field label={t('drawing.workspace.fieldAxis')}><select className="drawing-input" value={annotation.axis} onChange={(event) => run(updateDrawingAnnotation(annotation.id, { axis: event.target.value as typeof annotation.axis }))}><option value="both">{t('drawing.workspace.optionXAndY')}</option><option value="x">X</option><option value="y">Y</option></select></Field>
      <NumberField label={t('drawing.workspace.fieldLeaderOffset')} value={annotation.offset} onChange={(offset) => run(updateDrawingAnnotation(annotation.id, { offset }))} />
      <DimensionTextFields annotation={annotation} run={run} />
    </>; break;
    case 'arc_length_dimension': fields = <>
      <NumberField label={t('drawing.workspace.fieldArcOffset')} value={annotation.offset} onChange={(offset) => run(updateDrawingAnnotation(annotation.id, { offset }))} />
      <DimensionTextFields annotation={annotation} run={run} />
    </>; break;
    case 'jogged_radius_dimension': fields = <>
      <div className="grid grid-cols-2 gap-2"><NumberField label={t('drawing.workspace.fieldTextX')} value={annotation.position[0]} onChange={(value) => run(updateDrawingAnnotation(annotation.id, { position: [value, annotation.position[1]] }))} /><NumberField label={t('drawing.workspace.fieldTextY')} value={annotation.position[1]} onChange={(value) => run(updateDrawingAnnotation(annotation.id, { position: [annotation.position[0], value] }))} /></div>
      <div className="grid grid-cols-2 gap-2"><NumberField label={t('drawing.workspace.fieldJogX')} value={annotation.jog[0]} onChange={(value) => run(updateDrawingAnnotation(annotation.id, { jog: [value, annotation.jog[1]] }))} /><NumberField label={t('drawing.workspace.fieldJogY')} value={annotation.jog[1]} onChange={(value) => run(updateDrawingAnnotation(annotation.id, { jog: [annotation.jog[0], value] }))} /></div>
      <DimensionTextFields annotation={annotation} run={run} />
    </>; break;
    case 'datum_feature': fields = <>
      <Field label={t('drawing.workspace.fieldDatumIdentifier')}><input className="drawing-input uppercase" maxLength={3} value={annotation.label} onChange={(event) => run(updateDrawingAnnotation(annotation.id, { label: event.target.value.toUpperCase() || 'A' }))} /></Field>
      <OptionalNumberField label={t('drawing.workspace.fieldDatumTargetIndex')} value={annotation.target_index} onChange={(target_index) => run(updateDrawingAnnotation(annotation.id, { target_index: target_index === null ? null : Math.max(1, Math.round(target_index)) }))} />
      <PositionFields position={annotation.position} onChange={(position) => run(updateDrawingAnnotation(annotation.id, { position }))} />
    </>; break;
    case 'gdt_frame': fields = <>
      <Field label={t('drawing.workspace.characteristicLabel').replace('{standard}', standard === 'iso' ? 'ISO 1101' : 'ASME Y14.5')}><select className="drawing-input" value={annotation.characteristic} onChange={(event) => run(updateDrawingAnnotation(annotation.id, { characteristic: event.target.value as typeof annotation.characteristic }))}>{gdtCharacteristics.map((value) => <option key={value} value={value}>{gdtCharacteristicLabel(value)}</option>)}</select></Field>
      <NumberField label={t('drawing.workspace.fieldTolerance')} value={annotation.tolerance} onChange={(tolerance) => run(updateDrawingAnnotation(annotation.id, { tolerance }))} />
      <Toggle label={t('drawing.workspace.toggleDiameterToleranceZone')} checked={annotation.diameter_zone} onChange={(diameter_zone) => run(updateDrawingAnnotation(annotation.id, { diameter_zone }))} />
      <Field label={t('drawing.workspace.fieldMaterialCondition')}><select className="drawing-input" value={annotation.material_condition} onChange={(event) => run(updateDrawingAnnotation(annotation.id, { material_condition: event.target.value as typeof annotation.material_condition }))}>{materialConditions.map((condition) => <option key={condition} value={condition}>{materialConditionLabel(condition)}</option>)}</select></Field>
      {[0, 1, 2].map((index) => <div key={index} className="mb-2 grid grid-cols-[1fr_1.5fr] gap-2"><Field label={t('drawing.workspace.fieldDatum').replace('{index}', String(index + 1))}><input className="drawing-input uppercase" maxLength={3} value={annotation.datums[index]?.label ?? ''} onChange={(event) => { const datums = [...annotation.datums]; const label = event.target.value.toUpperCase(); if (!label) datums.splice(index, 1); else datums[index] = { label, material_condition: datums[index]?.material_condition ?? 'none' }; run(updateDrawingAnnotation(annotation.id, { datums })); }} /></Field><Field label={t('drawing.workspace.fieldModifier')}><select className="drawing-input" value={annotation.datums[index]?.material_condition ?? 'none'} onChange={(event) => { const datums = [...annotation.datums]; if (!datums[index]) datums[index] = { label: String.fromCharCode(65 + index), material_condition: 'none' }; datums[index] = { ...datums[index], material_condition: event.target.value as typeof annotation.material_condition }; run(updateDrawingAnnotation(annotation.id, { datums })); }}>{materialConditions.map((condition) => <option key={condition} value={condition}>{materialConditionLabel(condition)}</option>)}</select></Field></div>)}
      <OptionalNumberField label={t('drawing.workspace.fieldProjectedToleranceZone')} value={annotation.projected_zone} onChange={(projected_zone) => run(updateDrawingAnnotation(annotation.id, { projected_zone }))} />
      <Toggle label={t('drawing.workspace.toggleFreeStateModifier')} checked={annotation.free_state} onChange={(free_state) => run(updateDrawingAnnotation(annotation.id, { free_state }))} />
      <PositionFields position={annotation.position} onChange={(position) => run(updateDrawingAnnotation(annotation.id, { position }))} />
    </>; break;
    case 'surface_texture': fields = <>
      <NumberField label={t('drawing.workspace.fieldRaRoughness')} value={annotation.roughness_ra} onChange={(roughness_ra) => run(updateDrawingAnnotation(annotation.id, { roughness_ra }))} />
      <Field label={t('drawing.workspace.fieldManufacturingProcess')}><input className="drawing-input" value={annotation.process} onChange={(event) => run(updateDrawingAnnotation(annotation.id, { process: event.target.value }))} /></Field>
      <Field label={t('drawing.workspace.fieldSurfaceLay')}><select className="drawing-input" value={annotation.lay} onChange={(event) => run(updateDrawingAnnotation(annotation.id, { lay: event.target.value as typeof annotation.lay }))}>{surfaceLays.map((lay) => <option key={lay} value={lay}>{t(surfaceLayKey(lay))}</option>)}</select></Field>
      <OptionalNumberField label={t('drawing.workspace.fieldMachiningAllowance')} value={annotation.machining_allowance} onChange={(machining_allowance) => run(updateDrawingAnnotation(annotation.id, { machining_allowance }))} />
      <PositionFields position={annotation.position} onChange={(position) => run(updateDrawingAnnotation(annotation.id, { position }))} />
    </>; break;
    case 'edge_requirement': fields = <>
      <div className="grid grid-cols-2 gap-2"><NumberField label={t('drawing.workspace.fieldUpperDeviation')} value={annotation.upper_deviation} onChange={(upper_deviation) => run(updateDrawingAnnotation(annotation.id, { upper_deviation }))} /><NumberField label={t('drawing.workspace.fieldLowerDeviation')} value={annotation.lower_deviation} onChange={(lower_deviation) => run(updateDrawingAnnotation(annotation.id, { lower_deviation }))} /></div>
      <Field label={t('drawing.workspace.fieldAdditionalRequirement')}><input className="drawing-input" value={annotation.note} onChange={(event) => run(updateDrawingAnnotation(annotation.id, { note: event.target.value }))} /></Field>
      <PositionFields position={annotation.position} onChange={(position) => run(updateDrawingAnnotation(annotation.id, { position }))} />
    </>; break;
    case 'weld_symbol': fields = <>
      <Field label={t('drawing.workspace.fieldWeldType')}><select className="drawing-input" value={annotation.weld_type} onChange={(event) => run(updateDrawingAnnotation(annotation.id, { weld_type: event.target.value as typeof annotation.weld_type }))}>{weldTypes.map((type) => <option key={type} value={type}>{t(weldTypeKey(type))}</option>)}</select></Field>
      <Field label={t('drawing.workspace.fieldSide')}><select className="drawing-input" value={annotation.side} onChange={(event) => run(updateDrawingAnnotation(annotation.id, { side: event.target.value as typeof annotation.side }))}><option value="arrow">{t('drawing.workspace.optionArrowSide')}</option><option value="other">{t('drawing.workspace.optionOtherSide')}</option><option value="both">{t('drawing.workspace.optionBothSides')}</option></select></Field>
      <NumberField label={t('drawing.workspace.fieldSize')} value={annotation.size} onChange={(size) => run(updateDrawingAnnotation(annotation.id, { size }))} />
      <div className="grid grid-cols-2 gap-2"><OptionalNumberField label={t('drawing.workspace.fieldLength')} value={annotation.length} onChange={(length) => run(updateDrawingAnnotation(annotation.id, { length }))} /><OptionalNumberField label={t('drawing.workspace.fieldPitch')} value={annotation.pitch} onChange={(pitch) => run(updateDrawingAnnotation(annotation.id, { pitch }))} /></div>
      <Field label={t('drawing.workspace.fieldContour')}><select className="drawing-input" value={annotation.contour} onChange={(event) => run(updateDrawingAnnotation(annotation.id, { contour: event.target.value as typeof annotation.contour }))}><option value="none">{t('drawing.workspace.optionNone')}</option><option value="flush">{t('drawing.workspace.optionFlush')}</option><option value="convex">{t('drawing.workspace.optionConvex')}</option><option value="concave">{t('drawing.workspace.optionConcave')}</option></select></Field>
      <Field label={t('drawing.workspace.fieldFinishMethod')}><input className="drawing-input" value={annotation.finish} onChange={(event) => run(updateDrawingAnnotation(annotation.id, { finish: event.target.value }))} /></Field>
      <Toggle label={t('drawing.workspace.toggleAllAround')} checked={annotation.all_around} onChange={(all_around) => run(updateDrawingAnnotation(annotation.id, { all_around }))} />
      <Toggle label={t('drawing.workspace.toggleFieldWeld')} checked={annotation.field_weld} onChange={(field_weld) => run(updateDrawingAnnotation(annotation.id, { field_weld }))} />
      <Field label={t('drawing.workspace.fieldTailNote')}><input className="drawing-input" value={annotation.tail} onChange={(event) => run(updateDrawingAnnotation(annotation.id, { tail: event.target.value }))} /></Field>
      <PositionFields position={annotation.position} onChange={(position) => run(updateDrawingAnnotation(annotation.id, { position }))} />
    </>; break;
    case 'item_balloon': fields = <>
      <Field label={t('drawing.workspace.fieldBomItem')}><select className="drawing-input" value={annotation.bom_item_id} onChange={(event) => run(updateDrawingAnnotation(annotation.id, { bom_item_id: Number(event.target.value) }))}>{sheet.bom.map((item) => <option key={item.id} value={item.id}>{item.item_number} · {item.description}</option>)}</select></Field>
      <PositionFields position={annotation.position} onChange={(position) => run(updateDrawingAnnotation(annotation.id, { position }))} />
    </>; break;
    case 'revision_cloud': fields = <>
      <Field label={t('drawing.workspace.fieldRevision')}><input className="drawing-input uppercase" value={annotation.revision} onChange={(event) => run(updateDrawingAnnotation(annotation.id, { revision: event.target.value.toUpperCase() }))} /></Field>
      <div className="rounded border border-edge bg-header/40 p-2 text-[10px] text-mute">{t('drawing.workspace.revisionCloudSummary').replace('{count}', String(annotation.points.length))}</div>
    </>; break;
  }
  return <>{associative}{fields}<DeleteAnnotationButton annotationId={annotation.id} run={run} /></>;
}

type DrawingDimensionAnnotation = Extract<DrawingAnnotationDto, {
  kind: 'linear_dimension' | 'line_dimension' | 'point_line_dimension' | 'radial_dimension' | 'angular_dimension' | 'chain_dimension' | 'ordinate_dimension' | 'arc_length_dimension' | 'jogged_radius_dimension';
}>;

function DimensionTextFields({ annotation, run }: { annotation: DrawingDimensionAnnotation; run: (action: Promise<void>) => void }) {
  const { t } = useTranslation();
  const presentation = annotation.presentation;
  const updatePresentation = (update: Partial<typeof presentation>) => run(updateDrawingAnnotation(annotation.id, { presentation: { ...presentation, ...update } }));
  const updateTolerance = (update: Partial<typeof presentation.tolerance>) => updatePresentation({ tolerance: { ...presentation.tolerance, ...update } });
  return <>
    <Field label={t('drawing.workspace.fieldPrecision')}><select className="drawing-input" value={annotation.precision} onChange={(event) => run(updateDrawingAnnotation(annotation.id, { precision: Number(event.target.value) }))}>{[0, 1, 2, 3, 4, 5, 6].map((precision) => <option key={precision} value={precision}>{t(precision === 1 ? 'drawing.workspace.precisionDecimalsSingular' : 'drawing.workspace.precisionDecimalsPlural').replace('{precision}', String(precision))}</option>)}</select></Field>
    {'prefix' in annotation && <Field label={t('drawing.workspace.fieldPrefix')}><input className="drawing-input" value={annotation.prefix} onChange={(event) => run(updateDrawingAnnotation(annotation.id, { prefix: event.target.value }))} /></Field>}
    {'suffix' in annotation && <Field label={t('drawing.workspace.fieldSuffix')}><input className="drawing-input" value={annotation.suffix} onChange={(event) => run(updateDrawingAnnotation(annotation.id, { suffix: event.target.value }))} /></Field>}
    <div className="mt-4 border-t border-edge pt-3 text-[10px] font-semibold tracking-wider text-mute">{t('drawing.workspace.sectionToleranceDisplay')}</div>
    <Field label={t('drawing.workspace.fieldToleranceMode')}><select className="drawing-input" value={presentation.tolerance.mode} onChange={(event) => updateTolerance({ mode: event.target.value as typeof presentation.tolerance.mode })}><option value="none">{t('drawing.workspace.optionNone')}</option><option value="symmetric">{t('drawing.workspace.optionPlusMinus')}</option><option value="deviation">{t('drawing.workspace.optionUnequalDeviation')}</option><option value="limits">{t('drawing.workspace.optionLimitDimensions')}</option></select></Field>
    {presentation.tolerance.mode !== 'none' && <div className="grid grid-cols-2 gap-2"><NumberField label={presentation.tolerance.mode === 'symmetric' ? t('drawing.workspace.fieldSymmetricTolerance') : t('drawing.workspace.fieldUpper')} value={presentation.tolerance.upper} onChange={(upper) => updateTolerance({ upper })} /><NumberField label={t('drawing.workspace.fieldLower')} value={presentation.tolerance.lower} onChange={(lower) => updateTolerance({ lower })} /></div>}
    <Toggle label={t('drawing.workspace.toggleBasicDimension')} checked={presentation.basic} onChange={(basic) => updatePresentation({ basic, reference: basic ? false : presentation.reference })} />
    <Toggle label={t('drawing.workspace.toggleReferenceDimension')} checked={presentation.reference} onChange={(reference) => updatePresentation({ reference, basic: reference ? false : presentation.basic })} />
    <Field label={t('drawing.workspace.fieldFitClass')}><input className="drawing-input" placeholder="H7, h6, RC3…" value={presentation.fit_class} onChange={(event) => updatePresentation({ fit_class: event.target.value })} /></Field>
    <Toggle label={t('drawing.workspace.toggleDualUnits')} checked={presentation.dual_units !== null} onChange={(checked) => updatePresentation({ dual_units: checked ? { unit: 'inch', precision: 3, placement: 'bracketed' } : null })} />
    {presentation.dual_units && <div className="grid grid-cols-2 gap-2"><Field label={t('drawing.workspace.fieldSecondaryUnit')}><select className="drawing-input" value={presentation.dual_units.unit} onChange={(event) => updatePresentation({ dual_units: { ...presentation.dual_units!, unit: event.target.value as typeof presentation.dual_units.unit } })}><option value="millimetre">{t('drawing.workspace.unitMillimetre')}</option><option value="centimetre">{t('drawing.workspace.unitCentimetre')}</option><option value="inch">{t('drawing.workspace.unitInch')}</option></select></Field><Field label={t('drawing.workspace.fieldPlacement')}><select className="drawing-input" value={presentation.dual_units.placement} onChange={(event) => updatePresentation({ dual_units: { ...presentation.dual_units!, placement: event.target.value as typeof presentation.dual_units.placement } })}><option value="bracketed">{t('drawing.workspace.optionBracketed')}</option><option value="stacked">{t('drawing.workspace.optionStacked')}</option></select></Field><NumberField label={t('drawing.workspace.fieldDualPrecision')} value={presentation.dual_units.precision} step={1} onChange={(precision) => updatePresentation({ dual_units: { ...presentation.dual_units!, precision: Math.max(0, Math.min(8, Math.round(precision))) } })} /></div>}
  </>;
}

function NoteAnnotationInspector({ note, run }: { note: Extract<DrawingAnnotationDto, { kind: 'note' }>; run: (action: Promise<void>) => void }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(note.text);
  useEffect(() => setDraft(note.text), [note.id, note.text]);
  useEffect(() => { if (!draft.trim() || draft === note.text) return; const timer = window.setTimeout(() => run(updateDrawingAnnotation(note.id, { text: draft })), 180); return () => window.clearTimeout(timer); }, [draft, note.id, note.text, run]);
  return <><Field label={t('drawing.workspace.fieldText')}><textarea className="drawing-input min-h-24 resize-y py-2" value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={() => { if (!draft.trim()) setDraft(note.text); }} /></Field><div className="grid grid-cols-2 gap-2"><NumberField label={t('drawing.workspace.fieldPaperX')} value={note.position[0]} onChange={(value) => run(updateDrawingAnnotation(note.id, { position: [value, note.position[1]] }))} /><NumberField label={t('drawing.workspace.fieldPaperY')} value={note.position[1]} onChange={(value) => run(updateDrawingAnnotation(note.id, { position: [note.position[0], value] }))} /></div><DeleteAnnotationButton annotationId={note.id} run={run} /></>;
}

function DrawingNoteGraphic({ note, sheetWidth, sheetHeight, selected, onSelect }: { note: Extract<DrawingAnnotationDto, { kind: 'note' }>; sheetWidth: number; sheetHeight: number; selected: boolean; onSelect: () => void }) {
  const lines = note.text.split('\n');
  const width = Math.max(12, ...lines.map((line) => line.length * 1.9));
  const height = Math.max(5, lines.length * 4);
  const positionForDelta = (delta: PaperDelta) => boundedDrawingPoint(
    addPaperDelta(note.position, delta),
    sheetWidth,
    sheetHeight,
  );
  return <DraggableAnnotationGraphic
    id={note.id}
    testId="drawing-note"
    sheetWidth={sheetWidth}
    sheetHeight={sheetHeight}
    onSelect={onSelect}
    updateForDelta={(delta) => ({ position: positionForDelta(delta) })}
  >
    {(delta, dragging) => {
      const position = positionForDelta(delta);
      return <g transform={`translate(${position[0]} ${position[1]})`}>
        <rect x="-2" y="-4" width={width + 4} height={height + 2} rx="1" fill="transparent" stroke={selected || dragging ? '#6654c7' : 'transparent'} strokeWidth="0.45" strokeDasharray="2 1" />
        <text fill="#23272d" fontFamily="system-ui, sans-serif" fontSize="3.4">{lines.map((line, index) => <tspan key={index} x="0" dy={index === 0 ? 0 : 4}>{line}</tspan>)}</text>
      </g>;
    }}
  </DraggableAnnotationGraphic>;
}

function RevisionCloudGraphic({ cloud, sheetWidth, sheetHeight, selected, onSelect }: {
  cloud: Extract<DrawingAnnotationDto, { kind: 'revision_cloud' }>;
  sheetWidth: number;
  sheetHeight: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const pointsForDelta = (delta: PaperDelta) => cloud.points.map((point) => boundedDrawingPoint(addPaperDelta(point, delta), sheetWidth, sheetHeight));
  return <DraggableAnnotationGraphic id={cloud.id} testId="drawing-revision-cloud" sheetWidth={sheetWidth} sheetHeight={sheetHeight} onSelect={onSelect} updateForDelta={(delta) => ({ points: pointsForDelta(delta) })}>
    {(delta, dragging) => {
      const points = pointsForDelta(delta);
      const active = selected || dragging;
      const color = active ? '#6654c7' : '#c43b4d';
      const path = revisionCloudPath(points);
      return <>
        <path d={path} fill="none" stroke={color} strokeWidth={active ? 0.62 : 0.45} />
        <path d={path} fill="none" stroke="transparent" strokeWidth="6" />
        <OutlinedText x={Math.min(...points.map((point) => point[0]))} y={Math.min(...points.map((point) => point[1])) - 2} color={color} selected={active} textAnchor="start">REV {cloud.revision}</OutlinedText>
      </>;
    }}
  </DraggableAnnotationGraphic>;
}

function SheetFrame({ sheet, width, height }: { sheet: DrawingSheetDto; width: number; height: number }) {
  const { t } = useTranslation();
  const style = useDrawingStyle();
  const visibleLine = useDrawingLine('visible');
  const tableLine = useDrawingLine('dimension');
  const layout = drawingTitleBlock(sheet, width, height);
  return <>
    <g fill="none" stroke="#4a5058" className="pointer-events-none">
      <rect x="5" y="5" width={width - 10} height={height - 10} {...visibleLine} />
      <rect x={layout.x} y={layout.y} width={layout.width} height={layout.height} {...tableLine} />
      <path d={layout.segments.map(([a, b]) => `M${a[0]} ${a[1]}L${b[0]} ${b[1]}`).join(' ')} {...tableLine} />
      <g fill="#30343a" stroke="none" fontFamily={style.font_family}>
        {layout.cells.map(cell => <g key={cell.id} data-title-block-cell={cell.id}
          data-cell-bounds={[cell.x, cell.y, cell.width, cell.height].join(',')}
          data-overflow={cell.overflow || undefined} className="pointer-events-auto">
          <title>{cell.overflow ? t('drawing.workspace.titleBlockCellTooLong').replace('{label}', cell.label) : ''}{cell.text}</title>
          {cell.lines.map((line, index) => <text key={index} x={line.x} y={line.y}
            style={{fontSize: cell.fontSize}} fontWeight={cell.id === 'title' ? 650 : undefined}
            fill={cell.overflow ? '#b54432' : undefined}
            textLength={line.width || undefined} lengthAdjust="spacingAndGlyphs">{line.text}</text>)}
        </g>)}
      </g>
    </g>
    {sheet.revision_table_position && <RevisionTableGraphic sheet={sheet} position={sheet.revision_table_position} sheetWidth={width} sheetHeight={height} />}
    {sheet.bom_table_position && <BomTableGraphic sheet={sheet} position={sheet.bom_table_position} sheetWidth={width} sheetHeight={height} />}
  </>;
}

function RevisionTableGraphic({ sheet, position, sheetWidth, sheetHeight }: { sheet: DrawingSheetDto; position: [number, number]; sheetWidth: number; sheetHeight: number }) {
  const style = useDrawingStyle();
  const rows = sheet.revisions.length > 0 ? sheet.revisions : [];
  const width = 112;
  const rowHeight = 6;
  const height = rowHeight * (rows.length + 1);
  return <DraggableSheetTable position={position} size={[width, height]} sheetWidth={sheetWidth} sheetHeight={sheetHeight} update={(next) => ({ revision_table_position: next })} testId="drawing-revision-table">
    <g fontFamily={style.font_family} fontSize={style.small_text_height_mm}>
      <TableGrid width={width} rowHeight={rowHeight} rows={rows.length + 1} columns={[12, 28, 82]} />
      <text x="2" y="4.2" fontWeight="700">REV</text><text x="14" y="4.2" fontWeight="700">DATE</text><text x="30" y="4.2" fontWeight="700">DESCRIPTION / APPROVAL</text>
      {rows.map((revision, index) => <g key={revision.id} transform={`translate(0 ${(index + 1) * rowHeight})`}>
        <text x="2" y="4.2">{revision.revision}</text><text x="14" y="4.2">{revision.date}</text><text x="30" y="4.2">{revision.description || revision.change_order || '—'}{revision.approved_by ? ` · ${revision.approved_by}` : ''}</text>
      </g>)}
    </g>
  </DraggableSheetTable>;
}

function BomTableGraphic({ sheet, position, sheetWidth, sheetHeight }: { sheet: DrawingSheetDto; position: [number, number]; sheetWidth: number; sheetHeight: number }) {
  const style = useDrawingStyle();
  const rows = sheet.bom;
  const width = 132;
  const rowHeight = 6;
  const height = rowHeight * (rows.length + 1);
  return <DraggableSheetTable position={position} size={[width, height]} sheetWidth={sheetWidth} sheetHeight={sheetHeight} update={(next) => ({ bom_table_position: next })} testId="drawing-bom-table">
    <g fontFamily={style.font_family} fontSize={style.small_text_height_mm}>
      <TableGrid width={width} rowHeight={rowHeight} rows={rows.length + 1} columns={[12, 40, 100, 112]} />
      <text x="2" y="4.2" fontWeight="700">ITEM</text><text x="14" y="4.2" fontWeight="700">PART</text><text x="42" y="4.2" fontWeight="700">DESCRIPTION</text><text x="102" y="4.2" fontWeight="700">QTY</text><text x="114" y="4.2" fontWeight="700">MATERIAL</text>
      {rows.map((item, index) => <g key={item.id} transform={`translate(0 ${(index + 1) * rowHeight})`}>
        <text x="2" y="4.2">{item.item_number}</text><text x="14" y="4.2">{item.part_number || '—'}</text><text x="42" y="4.2">{item.description}</text><text x="102" y="4.2">{trimNumber(item.quantity)}</text><text x="114" y="4.2">{item.material || '—'}</text>
      </g>)}
    </g>
  </DraggableSheetTable>;
}

function TableGrid({ width, rowHeight, rows, columns }: { width: number; rowHeight: number; rows: number; columns: number[] }) {
  const line = useDrawingLine('dimension');
  const height = rows * rowHeight;
  return <g fill="white" stroke="#4a5058"><rect width={width} height={height} {...line} />{Array.from({ length: rows - 1 }, (_, index) => <line key={`r-${index}`} x1="0" y1={(index + 1) * rowHeight} x2={width} y2={(index + 1) * rowHeight} {...line} />)}{columns.map((column) => <line key={`c-${column}`} x1={column} y1="0" x2={column} y2={height} {...line} />)}</g>;
}

function DraggableSheetTable({ position, size, sheetWidth, sheetHeight, update, testId, children }: { position: [number, number]; size: [number, number]; sheetWidth: number; sheetHeight: number; update: (position: [number, number]) => Partial<DrawingSheetDto>; testId: string; children: ReactNode }) {
  const drag = useRef<{ pointerId: number; start: [number, number]; delta: [number, number] } | null>(null);
  const [delta, setDelta] = useState<[number, number]>([0, 0]);
  const current: [number, number] = [position[0] + delta[0], position[1] + delta[1]];
  return <g transform={`translate(${current[0]} ${current[1]})`} data-testid={testId} className="cursor-move" onPointerDown={(event) => { if (event.button !== 0) return; event.preventDefault(); event.stopPropagation(); drag.current = { pointerId: event.pointerId, start: drawingSheetPoint(event, sheetWidth, sheetHeight), delta: [0, 0] }; if (event.isTrusted) event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { if (!drag.current || drag.current.pointerId !== event.pointerId) return; const point = drawingSheetPoint(event, sheetWidth, sheetHeight); const next: [number, number] = [point[0] - drag.current.start[0], point[1] - drag.current.start[1]]; drag.current.delta = next; setDelta(next); }} onPointerUp={(event) => { if (!drag.current || drag.current.pointerId !== event.pointerId) return; const next: [number, number] = [Math.max(5, Math.min(sheetWidth - size[0] - 5, position[0] + drag.current.delta[0])), Math.max(5, Math.min(sheetHeight - size[1] - 5, position[1] + drag.current.delta[1]))]; drag.current = null; setDelta([0, 0]); void updateActiveDrawingSheet(update(next)).catch(showDrawingError); }} onPointerCancel={() => { drag.current = null; setDelta([0, 0]); }}>{children}</g>;
}

const gdtCharacteristics = [
  'straightness', 'flatness', 'circularity', 'cylindricity', 'profile_line',
  'profile_surface', 'angularity', 'perpendicularity', 'parallelism', 'position',
  'concentricity', 'symmetry', 'circular_runout', 'total_runout',
] as const;
const materialConditions = ['none', 'maximum', 'least', 'regardless'] as const;
const surfaceLays = ['none', 'parallel', 'perpendicular', 'crossed', 'multidirectional', 'circular', 'radial', 'particulate'] as const;
const weldTypes = ['fillet', 'square_groove', 'v_groove', 'bevel_groove', 'u_groove', 'j_groove', 'plug_slot', 'spot', 'seam', 'surfacing'] as const;
function gdtCharacteristicLabel(value: typeof gdtCharacteristics[number]): string { return `${gdtCharacteristicSymbol(value)}  ${translate(gdtCharacteristicKey(value))}`; }
function materialConditionLabel(value: typeof materialConditions[number]): string {
  return value === 'maximum' ? translate('drawing.workspace.materialConditionMaximum')
    : value === 'least' ? translate('drawing.workspace.materialConditionLeast')
      : value === 'regardless' ? translate('drawing.workspace.materialConditionRegardless')
        : translate('drawing.workspace.optionNone');
}
function currentIsoDate(): string { return new Date().toISOString().slice(0, 10); }
function nextRevisionCode(current: string): string {
  const normalized = current.trim().toUpperCase();
  if (/^\d+$/.test(normalized)) return String(Number(normalized) + 1);
  if (/^[A-Z]$/.test(normalized)) return normalized === 'Z' ? 'AA' : String.fromCharCode(normalized.charCodeAt(0) + 1);
  if (/^[A-Z]{2}$/.test(normalized)) {
    const value = (normalized.charCodeAt(0) - 65) * 26 + normalized.charCodeAt(1) - 65 + 1;
    return `${String.fromCharCode(65 + Math.floor(value / 26))}${String.fromCharCode(65 + value % 26)}`;
  }
  return 'A';
}
function PositionFields({ position, onChange }: { position: [number, number]; onChange: (position: [number, number]) => void }) {
  const { t } = useTranslation();
  return <div className="grid grid-cols-2 gap-2"><NumberField label={t('drawing.workspace.fieldPaperX')} value={position[0]} onChange={(value) => onChange([value, position[1]])} /><NumberField label={t('drawing.workspace.fieldPaperY')} value={position[1]} onChange={(value) => onChange([position[0], value])} /></div>;
}

function NumberField({ label, value, onChange, step = 0.5 }: { label: string; value: number; onChange: (value: number) => void; step?: number }) { return <Field label={label}><input type="number" step={step} className="drawing-input" value={value} onChange={(event) => { const next = Number(event.target.value); if (Number.isFinite(next)) onChange(next); }} /></Field>; }
function OptionalNumberField({ label, value, onChange }: { label: string; value: number | null; onChange: (value: number | null) => void }) { const { t } = useTranslation(); return <Field label={label}><input type="number" step="0.5" className="drawing-input" value={value ?? ''} placeholder={t('drawing.workspace.placeholderThrough')} onChange={(event) => { if (!event.target.value.trim()) onChange(null); else { const next = Number(event.target.value); if (Number.isFinite(next)) onChange(next); } }} /></Field>; }
function DeleteAnnotationButton({ annotationId, run }: { annotationId: number; run: (action: Promise<void>) => void }) { const { t } = useTranslation(); return <button type="button" onClick={() => run(deleteDrawingAnnotation(annotationId))} className="mt-4 flex h-8 w-full items-center justify-center gap-2 rounded border border-warn/35 text-[11px] text-warn hover:bg-warn/10"><Trash2 size={13} /> {t('drawing.workspace.deleteAnnotation')}</button>; }
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="mb-3 block"><span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-mute">{label}</span>{children}</label>; }
function Toggle({ label, checked, onChange, icon }: { label: string; checked: boolean; onChange: (checked: boolean) => void; icon?: ReactNode }) { return <label className="mb-2 flex h-9 items-center gap-2 rounded border border-edge px-2.5 text-[11px] text-ink hover:bg-edge/30"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />{icon}{label}</label>; }

function drawingToolPrompt(tool: DrawingTool, pending: DrawingViewDto['kind'] | null, count: number): string {
  switch (tool) {
    case 'place_view': return pending
      ? translate('drawing.workspace.promptPlaceViewWithKind').replace('{kind}', lowerFirst(translate(viewKindWordKey(pending))))
      : translate('drawing.workspace.promptPlaceView');
    case 'dimension': return count === 0
      ? translate('drawing.workspace.promptDimensionStart')
      : count === 1
        ? translate('drawing.workspace.promptDimensionSecond')
        : count === 2
          ? translate('drawing.workspace.promptDimensionLengthPreview')
          : translate('drawing.workspace.promptDimensionPlace');
    case 'angle': return [
      translate('drawing.workspace.promptAngleVertex'),
      translate('drawing.workspace.promptAngleFirstRay'),
      translate('drawing.workspace.promptAngleSecondRay'),
    ][count] ?? translate('drawing.workspace.promptAngle');
    case 'chamfer_note': return count === 0 ? translate('drawing.workspace.promptChamferSelect') : translate('drawing.workspace.promptChamferPlace');
    case 'diameter': return translate('drawing.workspace.promptDiameter');
    case 'radius': return translate('drawing.workspace.promptRadius');
    case 'hole_note': return translate('drawing.workspace.promptHoleNote');
    case 'center_mark': return translate('drawing.workspace.promptCenterMark');
    case 'center_line': return count === 0
      ? translate('drawing.workspace.promptCenterlineFirst')
      : translate('drawing.workspace.promptCenterlineSecond');
    case 'symmetry_axis': return translate('drawing.workspace.promptSymmetryAxis');
    case 'bolt_circle': return translate('drawing.workspace.promptBoltCircle').replace('{index}', String(Math.min(count + 1, 3)));
    case 'chain_dimension': return translate('drawing.workspace.promptChainDimension').replace('{index}', String(Math.min(count + 1, 3)));
    case 'baseline_dimension': return translate('drawing.workspace.promptBaselineDimension').replace('{point}', count === 0 ? translate('drawing.workspace.promptPointFirst') : translate('drawing.workspace.promptPointRemaining'));
    case 'continued_dimension': return translate('drawing.workspace.promptContinuedDimension').replace('{index}', String(Math.min(count + 1, 3)));
    case 'ordinate_dimension': return count === 0 ? translate('drawing.workspace.promptOrdinateOrigin') : translate('drawing.workspace.promptOrdinateTarget');
    case 'arc_length': return count === 0 ? translate('drawing.workspace.promptArcLengthSelect') : translate('drawing.workspace.promptArcLengthEndpoint').replace('{index}', String(count));
    case 'jogged_radius': return translate('drawing.workspace.promptJoggedRadius');
    case 'section_view': return count === 0 ? translate('drawing.workspace.promptSectionStart') : translate('drawing.workspace.promptSectionEnd');
    case 'removed_section': return count === 0 ? translate('drawing.workspace.promptRemovedSectionStart') : translate('drawing.workspace.promptRemovedSectionEnd');
    case 'detail_view': return translate('drawing.workspace.promptDetailView');
    case 'auxiliary_view': return translate('drawing.workspace.promptAuxiliaryView');
    case 'broken_view': return count === 0 ? translate('drawing.workspace.promptBrokenViewFirst') : translate('drawing.workspace.promptBrokenViewSecond');
    case 'datum': return translate('drawing.workspace.promptDatum');
    case 'gdt': return translate('drawing.workspace.promptGdt');
    case 'surface_texture': return translate('drawing.workspace.promptSurfaceTexture');
    case 'edge_requirement': return translate('drawing.workspace.promptEdgeRequirement');
    case 'weld': return translate('drawing.workspace.promptWeld');
    case 'balloon': return translate('drawing.workspace.promptBalloon');
    case 'revision_cloud': return translate('drawing.workspace.promptRevisionCloud').replace('{count}', String(count));
    case 'reassociate': return translate('drawing.workspace.promptReassociate');
    case 'note': return translate('drawing.workspace.promptNote');
    case null: return '';
    default: return '';
  }
}

function lowerFirst(value: string): string { return value ? value.charAt(0).toLowerCase() + value.slice(1) : value; }

function nextDerivedViewLabel(sheet: DrawingSheetDto, prefix: string): string {
  const normalizedPrefix = prefix.trim().toUpperCase();
  const used = new Set(sheet.views.flatMap((view) => {
    const derivation = view.derivation;
    return derivation && 'label' in derivation ? [derivation.label.toUpperCase()] : [];
  }));
  for (let index = 0; index < 676; index += 1) {
    const first = String.fromCharCode(65 + Math.floor(index / 26) - (index >= 26 ? 1 : 0));
    const second = String.fromCharCode(65 + (index % 26));
    const suffix = index < 26 ? second : `${first}${second}`;
    const candidate = `${normalizedPrefix} ${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${normalizedPrefix} ${sheet.views.length + 1}`;
}

function sameDrawingAnchor(left: DrawingTopologyAnchorRefDto, right: DrawingTopologyAnchorRefDto): boolean { return (left.occurrence_id ?? null) === (right.occurrence_id ?? null) && left.body_id === right.body_id && left.edge_id === right.edge_id && left.endpoint === right.endpoint && Boolean(left.circle_center) === Boolean(right.circle_center); }
function sameDrawingCircle(left: DrawingCircularRefDto, right: DrawingCircularRefDto): boolean { return (left.occurrence_id ?? null) === (right.occurrence_id ?? null) && left.body_id === right.body_id && left.edge_id === right.edge_id; }
function uniqueProjectionCircleCenters(circles: DrawingProjectedCircleDto[]): DrawingProjectedCircleDto[] {
  const byCenter = new Map<string, DrawingProjectedCircleDto>();
  for (const circle of circles) {
    const key = circle.center.map((value) => Math.round(value * 1e6)).join(',');
    const current = byCenter.get(key);
    if (
      !current
      || (current.hidden && !circle.hidden)
      || (current.hidden === circle.hidden && circle.radius > current.radius + 1e-7)
      || (current.hidden === circle.hidden
        && Math.abs(circle.radius - current.radius) <= 1e-7
        && (circle.body_id < current.body_id
          || (circle.body_id === current.body_id && circle.edge_id < current.edge_id)))
    ) byCenter.set(key, circle);
  }
  return [...byCenter.values()].sort((left, right) =>
    left.center[0] - right.center[0]
      || left.center[1] - right.center[1]
      || left.body_id - right.body_id
      || left.edge_id - right.edge_id,
  );
}
function uniqueProjectionAnchors(
  anchors: DrawingProjectionAnchorDto[],
  view: DrawingViewDto,
): DrawingProjectionAnchorDto[] {
  const byPaperPoint = new Map<string, DrawingProjectionAnchorDto>();
  const depth = (anchor: DrawingProjectionAnchorDto) =>
    anchor.model_point[0] * view.direction[0]
      + anchor.model_point[1] * view.direction[1]
      + anchor.model_point[2] * view.direction[2];
  const stableOrder = (left: DrawingProjectionAnchorDto, right: DrawingProjectionAnchorDto) =>
    left.body_id - right.body_id
      || left.edge_id - right.edge_id
      || (left.endpoint === right.endpoint ? 0 : left.endpoint === 'start' ? -1 : 1);

  for (const anchor of anchors) {
    // Coincident screen points may represent front and rear model vertices.
    // Show one target and choose the visible/front-most semantic reference so
    // a click cannot silently acquire a depth diagonal.
    const key = anchor.point.map((value) => Math.round(value * 1e6)).join(',');
    const current = byPaperPoint.get(key);
    if (!current
      || (current.hidden && !anchor.hidden)
      || (current.hidden === anchor.hidden && depth(anchor) > depth(current) + 1e-7)
      || (current.hidden === anchor.hidden
        && Math.abs(depth(anchor) - depth(current)) <= 1e-7
        && stableOrder(anchor, current) < 0)) {
      byPaperPoint.set(key, anchor);
    }
  }
  return [...byPaperPoint.values()].sort(stableOrder);
}
function addPaperDelta(point: [number, number], delta: PaperDelta): [number, number] {
  return [point[0] + delta[0], point[1] + delta[1]];
}
function boundedDrawingPoint(
  point: [number, number],
  sheetWidth: number,
  sheetHeight: number,
): [number, number] {
  return [
    Math.max(5, Math.min(sheetWidth - 5, point[0])),
    Math.max(5, Math.min(sheetHeight - 5, point[1])),
  ];
}
function linearDimensionOffsetAfterDrag(
  first: [number, number],
  second: [number, number],
  mode: Extract<DrawingAnnotationDto, { kind: 'linear_dimension' }>['mode'],
  offset: number,
  delta: PaperDelta,
): number {
  if (mode === 'horizontal') return offset + delta[1];
  if (mode === 'vertical') return offset + delta[0];
  const span = [second[0] - first[0], second[1] - first[1]] as [number, number];
  const length = Math.hypot(...span);
  if (length < 1e-8) return offset;
  const normal: [number, number] = [-span[1] / length, span[0] / length];
  return offset + delta[0] * normal[0] + delta[1] * normal[1];
}
function radialDimensionPlacementAfterDrag(
  center: [number, number],
  paperRadius: number,
  shoulder: [number, number],
  delta: PaperDelta,
): { leader_angle_deg: number; offset: number } {
  const movedShoulder = addPaperDelta(shoulder, delta);
  const vector: [number, number] = [
    movedShoulder[0] - center[0],
    movedShoulder[1] - center[1],
  ];
  const distance = Math.max(paperRadius + 2, Math.hypot(...vector));
  return {
    leader_angle_deg: Math.atan2(vector[1], vector[0]) * 180 / Math.PI,
    offset: distance - paperRadius,
  };
}
function materialConditionSymbol(condition: Extract<DrawingAnnotationDto, { kind: 'gdt_frame' }>['material_condition']): string {
  switch (condition) {
    case 'maximum': return ' Ⓜ';
    case 'least': return ' Ⓛ';
    case 'regardless': return ' Ⓢ';
    case 'none': return '';
  }
}
function gdtCharacteristicSymbol(characteristic: Extract<DrawingAnnotationDto, { kind: 'gdt_frame' }>['characteristic']): string {
  const symbols: Record<typeof characteristic, string> = {
    straightness: '—', flatness: '▱', circularity: '○', cylindricity: '⌭',
    profile_line: '⌒', profile_surface: '⌓', angularity: '∠', perpendicularity: '⊥',
    parallelism: '∥', position: '⌖', concentricity: '◎', symmetry: '⌯',
    circular_runout: '↗', total_runout: '↗↗',
  };
  return symbols[characteristic];
}
function weldGlyphPath(weldType: Extract<DrawingAnnotationDto, { kind: 'weld_symbol' }>['weld_type'], position: [number, number]): string {
  const [x, y] = position;
  switch (weldType) {
    case 'fillet': return `M${x + 3} ${y}h4v-4z`;
    case 'square_groove': return `M${x + 4} ${y - 4}v8m3-8v8`;
    case 'v_groove': return `M${x + 3} ${y - 4}l3 4 3-4`;
    case 'bevel_groove': return `M${x + 4} ${y - 4}v4l4-4`;
    case 'u_groove': return `M${x + 3} ${y - 4}q0 4 3 4t3-4`;
    case 'j_groove': return `M${x + 3} ${y - 4}v4m0 0q4 0 4-4`;
    case 'plug_slot': return `M${x + 3} ${y - 4}h6v4h-6z`;
    case 'spot': return `M${x + 6} ${y - 2}a2 2 0 1 0 0 .01`;
    case 'seam': return `M${x + 3} ${y - 2}h6m-6-2h6`;
    case 'surfacing': return `M${x + 3} ${y - 1}q3-5 6 0`;
  }
}
function revisionCloudPath(points: Array<[number, number]>): string {
  if (points.length < 2) return '';
  const closed = [...points, points[0]];
  const segments: string[] = [`M${points[0].join(' ')}`];
  for (let index = 0; index < closed.length - 1; index += 1) {
    const start = closed[index];
    const end = closed[index + 1];
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const length = Math.hypot(dx, dy);
    const count = Math.max(1, Math.ceil(length / 5));
    const radius = Math.max(1.4, length / count * 0.58);
    for (let step = 1; step <= count; step += 1) {
      const target: [number, number] = [start[0] + dx * step / count, start[1] + dy * step / count];
      segments.push(`A${radius} ${radius} 0 0 1 ${target.join(' ')}`);
    }
  }
  segments.push('Z');
  return segments.join(' ');
}
function angularDimensionRadiusAfterDrag(
  vertex: [number, number],
  textPosition: [number, number],
  delta: PaperDelta,
): number {
  const movedText = addPaperDelta(textPosition, delta);
  return Math.max(2, Math.hypot(movedText[0] - vertex[0], movedText[1] - vertex[1]) - 4);
}
function drawingSheetPoint(event: ReactPointerEvent<SVGElement>, sheetWidth: number, sheetHeight: number): [number, number] { const svg = event.currentTarget instanceof SVGSVGElement ? event.currentTarget : event.currentTarget.ownerSVGElement; if (!svg) return [0, 0]; const rect = svg.getBoundingClientRect(); return [(event.clientX - rect.left) * sheetWidth / rect.width, (event.clientY - rect.top) * sheetHeight / rect.height]; }
function midpoint2(left: [number, number], right: [number, number]): [number, number] { return [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2]; }

function defaultPointLineDimensionPosition(
  point: [number, number],
  lineStart: [number, number],
  lineEnd: [number, number],
): [number, number] {
  const vector: [number, number] = [lineEnd[0] - lineStart[0], lineEnd[1] - lineStart[1]];
  const length = Math.hypot(...vector);
  if (length < 1e-7) return [point[0] + 12, point[1]];
  return [point[0] + vector[0] / length * 12, point[1] + vector[1] / length * 12];
}
function normalize2(vector: [number, number]): [number, number] { const length = Math.hypot(vector[0], vector[1]); return length < 1e-8 ? [1, 0] : [vector[0] / length, vector[1] / length]; }
function trimNumber(value: number): string { return Number(value.toFixed(3)).toString(); }
function scaleLabel(scale: number): string { return scale >= 1 ? `${scale}:1` : `1:${Number((1 / scale).toFixed(2))}`; }
function viewKindLabel(kind: DrawingViewKind): string { return translate(viewKindWordKey(kind)); }
