import { CircleDot, ChevronDown, ChevronRight, Crosshair, FilePlus2, Gauge, Hash, Layers3, MessageSquareText, Minus, Trash2, Type } from 'lucide-react';
import {
  beginDrawingSheetSetup,
  deleteDrawingSheet,
  setActiveDrawingSheet,
} from '../../drawing/document';
import { useAppStore } from '../../store/appStore';

export function DrawingBrowser() {
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
        <span>DRAWINGS</span>
        <button
          type="button"
          title="New drawing sheet"
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
            <p className="text-[11px] font-medium text-ink">No drawing sheets</p>
            <p className="mt-1 text-[10px] leading-relaxed text-mute">Choose an ISO or ANSI paper size to begin.</p>
            <button type="button" onClick={beginDrawingSheetSetup} className="mt-3 rounded bg-accent px-3 py-1.5 text-[10px] font-semibold text-white hover:brightness-110">Create sheet</button>
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
                    title={`Delete ${sheet.name}`}
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
                    <div className="px-9 py-2 text-[10px] italic text-mute/70">No projected views</div>
                  )}
                  {sheet.annotations.length > 0 && (
                    <div className="mb-1 mt-1 px-9 text-[9px] font-semibold tracking-[0.14em] text-mute/60">
                      ANNOTATIONS
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
                        {drawingAnnotationLabel(annotation)}
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

function drawingAnnotationLabel(annotation: import('../../engine/types').DrawingAnnotationDto): string {
  switch (annotation.kind) {
    case 'linear_dimension': return `Linear dimension ${annotation.id}`;
    case 'line_dimension': return `${annotation.mode === 'length' ? 'Edge length' : annotation.mode === 'distance' ? 'Edge distance' : 'Edge angle'} ${annotation.id}`;
    case 'point_line_dimension': return `Point to edge ${annotation.id}`;
    case 'radial_dimension': return `${annotation.mode === 'diameter' ? 'Diameter' : 'Radius'} ${annotation.id}`;
    case 'angular_dimension': return `Angle ${annotation.id}`;
    case 'hole_note': return `Hole note ${annotation.id}`;
    case 'chamfer_note': return `Chamfer note ${annotation.id}`;
    case 'center_mark': return `Center mark ${annotation.id}`;
    case 'center_line': return `Centerline ${annotation.id}`;
    case 'center_line_between_edges': return `Centerline ${annotation.id}`;
    case 'automatic_symmetry_axis': return `Symmetry axis ${annotation.id}`;
    case 'bolt_circle_center_line': return `Bolt circle ${annotation.id}`;
    case 'chain_dimension': return `${annotation.layout} dimensions ${annotation.id}`;
    case 'ordinate_dimension': return `Ordinate ${annotation.id}`;
    case 'arc_length_dimension': return `Arc length ${annotation.id}`;
    case 'jogged_radius_dimension': return `Jogged radius ${annotation.id}`;
    case 'datum_feature': return `Datum ${annotation.label}`;
    case 'gdt_frame': return `GD&T ${annotation.characteristic}`;
    case 'surface_texture': return `Surface texture Ra ${annotation.roughness_ra}`;
    case 'edge_requirement': return `Edge requirement ${annotation.id}`;
    case 'weld_symbol': return `Weld ${annotation.id}`;
    case 'item_balloon': return `Balloon ${annotation.id}`;
    case 'revision_cloud': return `Revision cloud ${annotation.revision}`;
    case 'note': return annotation.text.split('\n')[0];
  }
}

export function showDrawingError(error: unknown): void {
  useAppStore.getState().setConstraintDialog({
    titleKey: 'file.errorTitle',
    message: error instanceof Error ? error.message : String(error),
  });
}
