import { useEffect, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { useCamActivity } from '../../cam/simulationUi';

/** Small indeterminate activity ring, not a blocking OS beachball. Navigation
 * stays usable; a status label also covers keyboard-only and screen-reader use. */
export function CamBusyIndicator() {
  const jobs = useCamActivity((state) => state.jobs);
  const active = jobs.size > 0;
  const [visible, setVisible] = useState(false);
  const cursor = useRef<HTMLDivElement>(null);
  const point = useRef({ x: -100, y: -100 });
  const lastCursorUpdate = useRef(0);
  useEffect(() => {
    const move = (event: PointerEvent) => {
      point.current = { x: event.clientX + 16, y: event.clientY + 18 };
      // Native overlay cutouts also follow this position. Bound their updates
      // to 20 Hz rather than forcing layout at high-rate mouse polling speed.
      const now = performance.now();
      if (cursor.current && now - lastCursorUpdate.current >= 50) {
        cursor.current.style.transform = `translate(${point.current.x}px, ${point.current.y}px)`;
        lastCursorUpdate.current = now;
      }
    };
    window.addEventListener('pointermove', move, { passive: true });
    return () => window.removeEventListener('pointermove', move);
  }, []);
  useEffect(() => {
    if (!active) { setVisible(false); return; }
    // Cache hits should not flash a spinner. Long work gets immediate text
    // feedback and a ring after the system-style short delay.
    const timer = window.setTimeout(() => setVisible(true), 150);
    return () => window.clearTimeout(timer);
  }, [active]);
  if (!active) return null;
  const labels = [...jobs.values()];
  const label = labels[labels.length - 1] ?? 'Working…';
  return <>
    <div data-native-viewport-overlay role="status" aria-live={label === 'Updating simulated stock…' ? 'off' : 'polite'}
      className="pointer-events-none absolute left-3 top-3 z-40 flex items-center gap-2 rounded-md border border-edge bg-header/95 px-3 py-1.5 text-[11px] text-mute shadow-sm backdrop-blur-sm">
      <LoaderCircle size={13} className="animate-spin text-accent" aria-hidden="true" />{label}
    </div>
    {visible && <div ref={cursor} data-testid="cam-busy-cursor" data-native-viewport-overlay aria-hidden="true"
      style={{ transform: `translate(${point.current.x}px, ${point.current.y}px)` }}
      className="pointer-events-none fixed left-0 top-0 z-[200] flex h-5 w-5 items-center justify-center rounded-full border border-edge bg-panel/95 shadow-sm">
      <LoaderCircle size={13} className="animate-spin text-accent" />
    </div>}
  </>;
}
