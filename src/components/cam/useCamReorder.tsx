import {
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';

type Drag = {
  scope: number | null;
  id: number;
  ids: number[];
  label: string;
  x: number;
  y: number;
  width: number;
};

/** Pointer threshold keeps ordinary click/double-click behavior intact. Only
 * the final drop writes the document; all intermediate positions are UI-only. */
export function useCamReorder(commit: (scope: number | null, ids: number[]) => Promise<void>) {
  const root = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [message, setMessage] = useState('');
  const dragRef = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const cleanup = useRef<(() => void) | null>(null);
  const rectangles = useRef(new Map<string, number>());
  const pending = useRef(false);

  useLayoutEffect(() => () => cleanup.current?.(), []);
  useLayoutEffect(() => {
    const next = new Map<string, number>();
    root.current?.querySelectorAll<HTMLElement>('[data-cam-sort-key]').forEach((node) => {
      // offsetTop is independent of an in-flight FLIP animation.
      const key = node.dataset.camSortKey!;
      const top = node.offsetTop;
      next.set(key, top);
      const previous = rectangles.current.get(key);
      if (
        previous !== undefined &&
        previous !== top &&
        !matchMedia('(prefers-reduced-motion: reduce)').matches
      ) {
        node.getAnimations().forEach((animation) => animation.cancel());
        node.animate([{ transform: `translateY(${previous - top}px)` }, { transform: 'translateY(0)' }], {
          duration: 180,
          easing: 'cubic-bezier(.2,.8,.2,1)',
        });
      }
    });
    rectangles.current = next;
  });

  const start = (
    event: ReactPointerEvent<HTMLElement>,
    scope: number | null,
    id: number,
    ids: number[],
    label: string,
  ) => {
    if (event.button !== 0 || pending.current || ids.length < 2) return;
    const node = event.currentTarget;
    const rect = node.getBoundingClientRect();
    const x = event.clientX,
      y = event.clientY,
      offsetY = y - rect.top;
    let started = false;
    const finish = (cancelled: boolean) => {
      cleanup.current?.();
      cleanup.current = null;
      const value = dragRef.current;
      dragRef.current = null;
      if (!started || !value) return;
      // A browser click following pointerup must not select the dropped row.
      suppressClick.current = true;
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 0);
      if (cancelled || value.ids.every((value, index) => value === ids[index])) {
        setDrag(null);
        setMessage(cancelled ? 'Reorder cancelled.' : '');
        return;
      }
      pending.current = true;
      void commit(scope, value.ids)
        .then(() => setMessage(`${label} reordered. Only paths marked out of date need regeneration.`))
        .catch((error) => setMessage(error instanceof Error ? error.message : String(error)))
        .finally(() => {
          pending.current = false;
          setDrag(null);
        });
    };
    const move = (e: PointerEvent) => {
      if (!started && Math.hypot(e.clientX - x, e.clientY - y) < 5) return;
      e.preventDefault();
      if (!started) {
        started = true;
        setMessage('');
        window.getSelection()?.removeAllRanges();
      }
      const current = dragRef.current?.ids ?? ids;
      const scopeKey = scope === null ? 'setups' : `operations-${scope}`;
      const rows = Array.from(
        root.current?.querySelectorAll<HTMLElement>(`[data-cam-sort-scope="${scopeKey}"]`) ?? [],
      );
      let targetIndex = current.indexOf(id);
      for (const row of rows) {
        const rowId = Number(row.dataset.camSortId);
        const box = row.getBoundingClientRect();
        // Remove presentation transform when comparing to the layout slot.
        const transform = getComputedStyle(row).transform;
        const shift = transform === 'none' ? 0 : new DOMMatrix(transform).m42;
        const middle = box.top - shift + box.height / 2;
        const index = current.indexOf(rowId);
        if (index < current.indexOf(id) && e.clientY < middle) {
          targetIndex = index;
          break;
        }
        if (index > current.indexOf(id) && e.clientY > middle) targetIndex = index;
      }
      const ordered = [...current];
      ordered.splice(ordered.indexOf(id), 1);
      ordered.splice(targetIndex, 0, id);
      const value: Drag = {
        scope,
        id,
        ids: ordered,
        label,
        x: rect.left,
        y: e.clientY - offsetY,
        width: rect.width,
      };
      dragRef.current = value;
      setDrag(value);
      const scroll = root.current;
      if (scroll) {
        const box = scroll.getBoundingClientRect();
        if (e.clientY < box.top + 32) scroll.scrollTop -= 14;
        if (e.clientY > box.bottom - 32) scroll.scrollTop += 14;
      }
    };
    const up = () => finish(false);
    const cancel = () => finish(true);
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up, { once: true });
    window.addEventListener('pointercancel', cancel, { once: true });
    window.addEventListener('blur', cancel, { once: true });
    window.addEventListener('keydown', key);
    cleanup.current = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', key);
    };
  };
  return {
    root,
    drag,
    start,
    message,
    keyboard: (event: ReactKeyboardEvent, scope: number | null, id: number, ids: number[]) => {
      if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key) || pending.current) return;
      event.preventDefault();
      event.stopPropagation();
      const index = ids.indexOf(id),
        to = index + (event.key === 'ArrowUp' ? -1 : 1);
      if (to < 0 || to >= ids.length) return;
      const ordered = [...ids];
      ordered.splice(index, 1);
      ordered.splice(to, 0, id);
      pending.current = true;
      void commit(scope, ordered)
        .then(() => setMessage('CAM order updated. Only paths marked out of date need regeneration.'))
        .catch((e) => setMessage(e instanceof Error ? e.message : String(e)))
        .finally(() => {
          pending.current = false;
        });
    },
    captureClick: (event: ReactPointerEvent | React.MouseEvent) => {
      if (suppressClick.current) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    order: (scope: number | null, ids: number[]) => (drag?.scope === scope ? drag.ids : ids),
    ghost: drag && (
      <div
        aria-hidden="true"
        className="pointer-events-none fixed z-[110] flex h-7 items-center rounded border border-accent/60 bg-panel px-3 text-xs text-ink shadow-xl"
        style={{ left: drag.x, top: drag.y, width: drag.width, opacity: 0.92 }}
      >
        {drag.label}
      </div>
    ),
  };
}
