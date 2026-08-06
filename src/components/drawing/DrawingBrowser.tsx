import { ChevronDown, ChevronRight, FilePlus2, Hash, Layers3, Trash2, Type } from 'lucide-react';
import {
  addDrawingSheet,
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
          onClick={() => run(addDrawingSheet)}
          className="rounded p-1 text-mute hover:bg-edge hover:text-ink"
        >
          <FilePlus2 size={15} />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
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
                {drawing.sheets.length > 1 && (
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
                      {annotation.kind === 'linear_dimension'
                        ? <Hash size={12} />
                        : <Type size={12} />}
                      <span className="truncate">
                        {annotation.kind === 'linear_dimension'
                          ? `Dimension ${annotation.id}`
                          : annotation.text.split('\n')[0]}
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

export function showDrawingError(error: unknown): void {
  useAppStore.getState().setConstraintDialog({
    titleKey: 'file.errorTitle',
    message: error instanceof Error ? error.message : String(error),
  });
}
