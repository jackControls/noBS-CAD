import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Eye, EyeOff, Minus, Plus, Printer, Trash2 } from 'lucide-react';
import { getEngine } from '../../engine';
import type {
  DrawingProjectionDto,
  DrawingSheetDto,
  DrawingViewDto,
} from '../../engine/types';
import {
  deleteDrawingView,
  updateActiveDrawingSheet,
  updateDrawingView,
} from '../../drawing/document';
import { printActiveDrawing } from '../../drawing/export';
import {
  drawingSheetSize,
  drawingViewPaperBounds,
  drawingViewTransform,
} from '../../drawing/sheet';
import { useAppStore } from '../../store/appStore';
import { showDrawingError } from './DrawingBrowser';

export function DrawingWorkspace() {
  const drawing = useAppStore((state) => state.drawingDocument);
  const selectedViewId = useAppStore((state) => state.selectedDrawingViewId);
  const selectView = useAppStore((state) => state.setSelectedDrawingViewId);
  const sheet = drawing.sheets.find((candidate) => candidate.id === drawing.active_sheet_id) ?? null;
  const [zoom, setZoom] = useState(1);

  if (!sheet) {
    return (
      <div className="flex h-full items-center justify-center bg-viewport text-mute">
        Create a drawing sheet to begin.
      </div>
    );
  }
  const [width, height] = drawingSheetSize(sheet.format, sheet.orientation);

  return (
    <div className="flex h-full min-h-0 bg-viewport" data-testid="drawing-workspace">
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-9 shrink-0 items-center justify-between border-b border-edge bg-header px-3">
          <div className="flex items-center gap-2 text-[11px] text-mute">
            <span className="font-semibold text-ink">{sheet.name}</span>
            <span>·</span>
            <span>{sheet.format.toUpperCase()} {sheet.orientation}</span>
            <span>·</span>
            <span>Vector HLR</span>
          </div>
          <div className="flex items-center gap-1">
            <button className="drawing-mini-button" type="button" onClick={() => setZoom((value) => Math.max(0.4, value - 0.1))} title="Zoom out">
              <Minus size={14} />
            </button>
            <span className="w-12 text-center font-mono text-[10px] text-mute">{Math.round(zoom * 100)}%</span>
            <button className="drawing-mini-button" type="button" onClick={() => setZoom((value) => Math.min(2.5, value + 0.1))} title="Zoom in">
              <Plus size={14} />
            </button>
            <button className="drawing-mini-button ml-2" type="button" onClick={printActiveDrawing} title="Print / Save as PDF">
              <Printer size={14} />
            </button>
          </div>
        </div>
        <div className="drawing-scroll min-h-0 flex-1 overflow-auto p-8" onPointerDown={(event) => {
          if (event.target === event.currentTarget) selectView(null);
        }}>
          <svg
            className="drawing-sheet mx-auto block overflow-visible bg-white shadow-2xl shadow-black/35"
            data-testid="drawing-sheet"
            width={width * 3 * zoom}
            height={height * 3 * zoom}
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={`${sheet.name} technical drawing`}
          >
            <rect width={width} height={height} fill="#fff" />
            <SheetFrame sheet={sheet} width={width} height={height} />
            {sheet.views.map((view) => (
              <ProjectedDrawingView
                key={view.id}
                view={view}
                sheetWidth={width}
                sheetHeight={height}
                selected={selectedViewId === view.id}
                onSelect={() => selectView(view.id)}
              />
            ))}
          </svg>
        </div>
      </section>
      <DrawingInspector sheet={sheet} selectedViewId={selectedViewId} />
    </div>
  );
}

function ProjectedDrawingView({
  view,
  sheetWidth,
  sheetHeight,
  selected,
  onSelect,
}: {
  view: DrawingViewDto;
  sheetWidth: number;
  sheetHeight: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const scene = useAppStore((state) => state.solidScene);
  const [projection, setProjection] = useState<DrawingProjectionDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const drag = useRef<{ pointerId: number; start: [number, number]; origin: [number, number] } | null>(null);
  const [dragPosition, setDragPosition] = useState<[number, number] | null>(null);
  const requestKey = `${view.body_ids.join(',')}|${view.direction.join(',')}|${view.up.join(',')}|${view.show_hidden_lines}|${view.show_tangent_edges}|${view.scale}`;

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setProjection(null);
    void getEngine()
      .then((engine) => engine.drawingProjection({
        body_ids: view.body_ids,
        direction: view.direction,
        up: view.up,
        include_hidden: view.show_hidden_lines,
        include_tangent_edges: view.show_tangent_edges,
        deflection: Math.max(0.01, 0.08 / view.scale),
      }))
      .then((result) => {
        if (!cancelled) setProjection(result);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => { cancelled = true; };
  }, [requestKey, scene]);

  if (error) {
    return <text x={view.position[0]} y={view.position[1]} fill="#b33" fontSize="3" textAnchor="middle">Projection failed</text>;
  }
  if (!projection) {
    return <g stroke="#9aa0a8" strokeWidth="0.25"><path d={`M${view.position[0] - 4} ${view.position[1]}h8M${view.position[0]} ${view.position[1] - 4}v8`} /></g>;
  }

  const position = dragPosition ?? view.position;
  const displayView = position === view.position ? view : { ...view, position };
  const [x, y, width, height] = drawingViewPaperBounds(displayView, projection);
  const labelY = y + Math.max(height, 1) + 5;

  const sheetPoint = (event: ReactPointerEvent<SVGGElement>): [number, number] => {
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return [0, 0];
    const rect = svg.getBoundingClientRect();
    return [
      (event.clientX - rect.left) * sheetWidth / rect.width,
      (event.clientY - rect.top) * sheetHeight / rect.height,
    ];
  };
  const onPointerDown = (event: ReactPointerEvent<SVGGElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    onSelect();
    const start = sheetPoint(event);
    drag.current = { pointerId: event.pointerId, start, origin: view.position };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<SVGGElement>) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    const current = sheetPoint(event);
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

  return (
    <g onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={finishDrag} onPointerCancel={finishDrag} className="cursor-move">
      <g transform={drawingViewTransform(displayView, projection)} fill="none" stroke="#17191c" strokeLinecap="round" strokeLinejoin="round">
        {projection.visible.map((polyline, index) => (
          <polyline key={`v-${index}`} points={polyline.points.map((point) => point.join(',')).join(' ')} vectorEffect="non-scaling-stroke" strokeWidth="0.35" />
        ))}
        {projection.hidden.map((polyline, index) => (
          <polyline key={`h-${index}`} points={polyline.points.map((point) => point.join(',')).join(' ')} vectorEffect="non-scaling-stroke" strokeWidth="0.25" strokeDasharray="2 1" opacity="0.68" />
        ))}
      </g>
      <rect x={x - 2} y={y - 2} width={Math.max(width + 4, 8)} height={Math.max(height + 4, 8)} fill="transparent" stroke={selected ? '#6654c7' : 'transparent'} strokeWidth="0.45" strokeDasharray="2 1" />
      <text x={position[0]} y={labelY} fill={selected ? '#6654c7' : '#4b5159'} fontSize="3.1" textAnchor="middle" className="pointer-events-none">
        {view.name} · {view.scale >= 1 ? `${view.scale}:1` : `1:${Number((1 / view.scale).toFixed(2))}`}
      </text>
    </g>
  );
}

function DrawingInspector({ sheet, selectedViewId }: { sheet: DrawingSheetDto; selectedViewId: number | null }) {
  const scene = useAppStore((state) => state.solidScene);
  const view = sheet.views.find((candidate) => candidate.id === selectedViewId) ?? null;
  const run = (action: Promise<void>) => void action.catch(showDrawingError);

  return (
    <aside className="w-[286px] shrink-0 overflow-y-auto border-l border-edge bg-panel p-3">
      <div className="mb-3 text-[10px] font-semibold tracking-[0.16em] text-mute">
        {view ? 'DRAWING VIEW' : 'SHEET PROPERTIES'}
      </div>
      {view ? (
        <>
          <Field label="Name">
            <input className="drawing-input" value={view.name} onChange={(event) => run(updateDrawingView(view.id, { name: event.target.value || 'View' }))} />
          </Field>
          <Field label="Scale">
            <select className="drawing-input" value={view.scale} onChange={(event) => run(updateDrawingView(view.id, { scale: Number(event.target.value) }))}>
              {[10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01].map((scale) => (
                <option key={scale} value={scale}>{scale >= 1 ? `${scale}:1` : `1:${1 / scale}`}</option>
              ))}
            </select>
          </Field>
          <Toggle label="Hidden lines" checked={view.show_hidden_lines} icon={view.show_hidden_lines ? <Eye size={14} /> : <EyeOff size={14} />} onChange={(checked) => run(updateDrawingView(view.id, { show_hidden_lines: checked }))} />
          <Toggle label="Tangent edges" checked={view.show_tangent_edges} onChange={(checked) => run(updateDrawingView(view.id, { show_tangent_edges: checked }))} />
          <div className="mt-4 border-t border-edge pt-3">
            <div className="mb-2 text-[10px] font-semibold tracking-wider text-mute">BODIES</div>
            <label className="flex items-center gap-2 py-1.5 text-[11px] text-ink">
              <input type="checkbox" checked={view.body_ids.length === 0} onChange={() => run(updateDrawingView(view.id, { body_ids: [] }))} />
              All active bodies
            </label>
            {scene.bodies.map((body) => {
              const allBodies = view.body_ids.length === 0;
              const explicit = view.body_ids.includes(body.id);
              return (
                <label key={body.id} className="flex items-center gap-2 py-1.5 pl-3 text-[11px] text-mute">
                  <input
                    type="checkbox"
                    checked={allBodies || explicit}
                    onChange={() => {
                      const base = allBodies ? scene.bodies.map((candidate) => candidate.id) : view.body_ids;
                      const ids = allBodies || explicit
                        ? base.filter((id) => id !== body.id)
                        : [...new Set([...base, body.id])];
                      // An empty filter means "all active bodies" in the
                      // persisted format, so do not let a click accidentally
                      // turn "none" back into "all".
                      if (ids.length === 0) return;
                      run(updateDrawingView(view.id, { body_ids: ids.length === scene.bodies.length ? [] : ids }));
                    }}
                  />
                  {body.name}
                </label>
              );
            })}
          </div>
          <button type="button" onClick={() => run(deleteDrawingView(view.id))} className="mt-5 flex h-8 w-full items-center justify-center gap-2 rounded border border-warn/35 text-[11px] text-warn hover:bg-warn/10">
            <Trash2 size={13} /> Delete view
          </button>
        </>
      ) : (
        <>
          <Field label="Sheet name">
            <input className="drawing-input" value={sheet.name} onChange={(event) => run(updateActiveDrawingSheet({ name: event.target.value || 'Sheet' }))} />
          </Field>
          <Field label="Paper">
            <select className="drawing-input" value={sheet.format} onChange={(event) => run(updateActiveDrawingSheet({ format: event.target.value as DrawingSheetDto['format'] }))}>
              <option value="a4">A4</option><option value="a3">A3</option><option value="letter">US Letter</option>
            </select>
          </Field>
          <Field label="Orientation">
            <select className="drawing-input" value={sheet.orientation} onChange={(event) => run(updateActiveDrawingSheet({ orientation: event.target.value as DrawingSheetDto['orientation'] }))}>
              <option value="landscape">Landscape</option><option value="portrait">Portrait</option>
            </select>
          </Field>
          <div className="mt-4 border-t border-edge pt-3 text-[10px] font-semibold tracking-wider text-mute">TITLE BLOCK</div>
          {(['title', 'drawing_number', 'revision', 'author'] as const).map((key) => (
            <Field key={key} label={key.replace('_', ' ')}>
              <input className="drawing-input" value={sheet.title_block[key]} onChange={(event) => run(updateActiveDrawingSheet({ title_block: { ...sheet.title_block, [key]: event.target.value } }))} />
            </Field>
          ))}
        </>
      )}
    </aside>
  );
}

function SheetFrame({ sheet, width, height }: { sheet: DrawingSheetDto; width: number; height: number }) {
  const blockWidth = Math.min(180, width - 10);
  const blockHeight = 27;
  const x = width - blockWidth - 5;
  const y = height - blockHeight - 5;
  return (
    <g fill="none" stroke="#4a5058" strokeWidth="0.25" className="pointer-events-none">
      <rect x="5" y="5" width={width - 10} height={height - 10} />
      <rect x={x} y={y} width={blockWidth} height={blockHeight} />
      <path d={`M${x} ${y + 16}H${x + blockWidth} M${x + blockWidth * 0.62} ${y}V${y + blockHeight} M${x + blockWidth * 0.82} ${y + 16}V${y + blockHeight}`} />
      <g fill="#30343a" stroke="none" fontFamily="system-ui, sans-serif">
        <text x={x + 4} y={y + 7} fontSize="4.6" fontWeight="650">{sheet.title_block.title || sheet.name}</text>
        <text x={x + 4} y={y + 13} fontSize="2.8">DRAWING: {sheet.title_block.drawing_number || '—'}</text>
        <text x={x + blockWidth * 0.64} y={y + 7} fontSize="2.8">SHEET: {sheet.name}</text>
        <text x={x + blockWidth * 0.64} y={y + 13} fontSize="2.8">FORMAT: {sheet.format.toUpperCase()}</text>
        <text x={x + 4} y={y + 23} fontSize="2.8">AUTHOR: {sheet.title_block.author || '—'}</text>
        <text x={x + blockWidth * 0.84} y={y + 23} fontSize="2.8">REV {sheet.title_block.revision || '—'}</text>
      </g>
    </g>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="mb-3 block"><span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-mute">{label}</span>{children}</label>;
}

function Toggle({ label, checked, onChange, icon }: { label: string; checked: boolean; onChange: (checked: boolean) => void; icon?: ReactNode }) {
  return <label className="mb-2 flex h-9 items-center gap-2 rounded border border-edge px-2.5 text-[11px] text-ink hover:bg-edge/30"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />{icon}{label}</label>;
}
