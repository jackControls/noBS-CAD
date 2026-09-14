import { CircleDot, ChevronDown, ChevronRight, Crosshair, FilePlus2, Gauge, Hash, Layers3, MessageSquareText, Minus, Trash2, Type } from 'lucide-react';
import {
  beginDrawingSheetSetup,
  deleteDrawingSheet,
  setActiveDrawingSheet,
} from '../../drawing/document';
import { useTranslation } from '../../i18n';
import { useAppStore } from '../../store/appStore';

export function DrawingBrowser() {
  const { t } = useTranslation();
  const drawing = useAppStore((state) => state.drawingDocument);
  const selectedViewId = useAppStore((state) => state.selectedDrawingViewId);
  const selectedAnnotationId = useAppStore((state) => state.selectedDrawingAnnotationId);
  const selectView = useAppStore((state) => state.setSelectedDrawingViewId);
  const selectAnnotation = useAppStore((state) => state.setSelectedDrawingAnnotationId);

  const run = (action: () => Promise<void>) => {
    void action().catch(showDrawingError);
  };

  return (
    <aside data-testid="drawing-browser" className="flex w-[228px] shrink-0 flex-col border-r border-edge bg-panel">
      <header className="flex h-8 items-center justify-between border-b border-edge px-2.5 text-[10px] font-semibold tracking-[0.16em] text-mute">
        <span>{t('drawing.browser.title')}</span>
        <button
          type="button"
          title={t('drawing.browser.newDrawingSheet')}
          onClick={beginDrawingSheetSetup}
          className="rounded p-1 text-mute hover:bg-edge hover:text-ink"
        >
          <FilePlus2 size={15} />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {drawing.sheets.length === 0 && (
          <div className="px-4 py-8 text-center">
            <Layers3 className="mx-auto mb-2 text-mute/50" size={28} />
            <p className="text-[11px] font-medium text-ink">{t('drawing.browser.noDrawingSheets')}</p>
            <p className="mt-1 text-[10px] leading-relaxed text-mute">{t('drawing.browser.emptyHint')}</p>
            <button type="button" onClick={beginDrawingSheetSetup} className="mt-3 rounded bg-accent px-3 py-1.5 text-[10px] font-semibold text-white hover:brightness-110">{t('drawing.browser.createSheet')}</button>
          </div>
        )}
        {drawing.sheets.map((sheet) => {
          const active = sheet.id === drawing.active_sheet_id;
          return (
            <section key={sheet.id}>
              <div
                className={`group flex h-8 items-center gap-1 px-2 ${
                  active ? 'bg-accent/18 text-ink' : 'text-mute hover:bg-edge/50 hover:text-ink'
                }`}
              >
                <button
                  type="button"
                  onClick={() => run(() => setActiveDrawingSheet(sheet.id))}
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                >
                  {active ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  <Layers3 size={14} />
                  <span className="truncate text-[12px]">{sheet.name}</span>
                  <span className="ml-auto text-[9px] uppercase text-mute/70">{sheet.format}</span>
                </button>
                {(
                  <button
                    type="button"
                    title={t('drawing.browser.deleteSheet').replace('{name}', sheet.name)}
                    onClick={() => run(() => deleteDrawingSheet(sheet.id))}
                    className="invisible rounded p-1 text-mute hover:bg-warn/15 hover:text-warn group-hover:visible"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
              {active && (
                <div className="pb-1">
                  {sheet.views.map((view) => (
                    <button
                      key={view.id}
                      type="button"
                      onClick={() => {
                        selectAnnotation(null);
                        selectView(view.id);
                      }}
                      className={`flex h-7 w-full items-center gap-2 pl-9 pr-2 text-left text-[11px] ${
                        selectedViewId === view.id
                          ? 'bg-accent/25 text-ink'
                          : 'text-mute hover:bg-edge/40 hover:text-ink'
                      }`}
                    >
                      <span className="h-2 w-2 rounded-sm border border-current" />
                      <span className="truncate">{view.name}</span>
                      <span className="ml-auto font-mono text-[9px] opacity-65">
                        {view.scale >= 1 ? `${view.scale}:1` : `1:${Math.round(1 / view.scale)}`}
                      </span>
                    </button>
                  ))}
                  {sheet.views.length === 0 && (
                    <div className="px-9 py-2 text-[10px] italic text-mute/70">{t('drawing.browser.noProjectedViews')}</div>
                  )}
                  {sheet.annotations.length > 0 && (
                    <div className="mb-1 mt-1 px-9 text-[9px] font-semibold tracking-[0.14em] text-mute/60">
                      {t('drawing.browser.sectionAnnotations')}
                    </div>
                  )}
                  {sheet.annotations.map((annotation) => (
                    <button
                      key={annotation.id}
                      type="button"
                      onClick={() => {
                        selectView(null);
                        selectAnnotation(annotation.id);
                      }}
                      className={`flex h-7 w-full items-center gap-2 pl-9 pr-2 text-left text-[11px] ${
                        selectedAnnotationId === annotation.id
                          ? 'bg-accent/25 text-ink'
                          : 'text-mute hover:bg-edge/40 hover:text-ink'
                      }`}
                    >
                      {(annotation.kind === 'linear_dimension'
                        || annotation.kind === 'line_dimension'
                        || annotation.kind === 'point_line_dimension') && <Hash size={12} />}
                      {(annotation.kind === 'radial_dimension' || annotation.kind === 'angular_dimension') && <Gauge size={12} />}
                      {annotation.kind === 'hole_note' && <CircleDot size={12} />}
                      {annotation.kind === 'center_mark' && <Crosshair size={12} />}
                      {(annotation.kind === 'center_line'
                        || annotation.kind === 'center_line_between_edges'
                        || annotation.kind === 'automatic_symmetry_axis'
                        || annotation.kind === 'bolt_circle_center_line') && <Minus size={12} />}
                      {annotation.kind === 'chamfer_note' && <MessageSquareText size={12} />}
                      {annotation.kind === 'note' && <Type size={12} />}
                      <span className="truncate">
                        {drawingAnnotationLabel(annotation, t)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </aside>
  );
}

function drawingAnnotationLabel(
  annotation: import('../../engine/types').DrawingAnnotationDto,
  t: (key: string) => string,
): string {
  const id = String(annotation.id);
  switch (annotation.kind) {
    case 'linear_dimension': return t('drawing.browser.annotationLinearDimension').replace('{id}', id);
    case 'line_dimension': return t(annotation.mode === 'length' ? 'drawing.browser.annotationEdgeLength' : annotation.mode === 'distance' ? 'drawing.browser.annotationEdgeDistance' : 'drawing.browser.annotationEdgeAngle').replace('{id}', id);
    case 'point_line_dimension': return t('drawing.browser.annotationPointToEdge').replace('{id}', id);
    case 'radial_dimension': return t(annotation.mode === 'diameter' ? 'drawing.browser.annotationDiameter' : 'drawing.browser.annotationRadius').replace('{id}', id);
    case 'angular_dimension': return t('drawing.browser.annotationAngle').replace('{id}', id);
    case 'hole_note': return t('drawing.browser.annotationHoleNote').replace('{id}', id);
    case 'chamfer_note': return t('drawing.browser.annotationChamferNote').replace('{id}', id);
    case 'center_mark': return t('drawing.browser.annotationCenterMark').replace('{id}', id);
    case 'center_line': return t('drawing.browser.annotationCenterline').replace('{id}', id);
    case 'center_line_between_edges': return t('drawing.browser.annotationCenterline').replace('{id}', id);
    case 'automatic_symmetry_axis': return t('drawing.browser.annotationSymmetryAxis').replace('{id}', id);
    case 'bolt_circle_center_line': return t('drawing.browser.annotationBoltCircle').replace('{id}', id);
    case 'chain_dimension': return t('drawing.browser.annotationChainDimensions').replace('{layout}', String(annotation.layout)).replace('{id}', id);
    case 'ordinate_dimension': return t('drawing.browser.annotationOrdinate').replace('{id}', id);
    case 'arc_length_dimension': return t('drawing.browser.annotationArcLength').replace('{id}', id);
    case 'jogged_radius_dimension': return t('drawing.browser.annotationJoggedRadius').replace('{id}', id);
    case 'datum_feature': return t('drawing.browser.annotationDatum').replace('{label}', String(annotation.label));
    case 'gdt_frame': return t('drawing.browser.annotationGdtFrame').replace('{characteristic}', String(annotation.characteristic));
    case 'surface_texture': return t('drawing.browser.annotationSurfaceTexture').replace('{ra}', String(annotation.roughness_ra));
    case 'edge_requirement': return t('drawing.browser.annotationEdgeRequirement').replace('{id}', id);
    case 'weld_symbol': return t('drawing.browser.annotationWeld').replace('{id}', id);
    case 'item_balloon': return t('drawing.browser.annotationBalloon').replace('{id}', id);
    case 'revision_cloud': return t('drawing.browser.annotationRevisionCloud').replace('{revision}', String(annotation.revision));
    case 'note': return annotation.text.split('\n')[0];
  }
}

export function showDrawingError(error: unknown): void {
  useAppStore.getState().setConstraintDialog({
    titleKey: 'file.errorTitle',
    message: error instanceof Error ? error.message : String(error),
  });
}
