import {waitForPlayback} from './operationPlayback';

export type UiGesture = 'move' | 'click' | 'double_click' | 'drag';
/** Atomic gestures cannot leave a synthetic button held between MCP calls. */
export async function drivePointer(surface: Element, action: UiGesture, point: [number, number], shift = false, to?: [number, number]): Promise<void> {
  const rect = surface.getBoundingClientRect();
  const validate = (p: [number, number]) => {
    if (!p.every(Number.isFinite) || p[0] < rect.left || p[0] > rect.right || p[1] < rect.top || p[1] > rect.bottom) throw new Error('Point is outside the canvas');
  };
  validate(point);
  if (action === 'drag') { if (!to) throw new Error('drag requires an end point'); validate(to); }
  const hit = document.elementFromPoint(...point);
  const target = hit && surface.contains(hit) ? hit : surface;
  const init = {pointerId: 1, pointerType: 'mouse', button: 0, shiftKey: shift, bubbles: true, cancelable: true, isPrimary: true};
  const emit = (type: string, p: [number, number], buttons = 0) => target.dispatchEvent(new PointerEvent(type, {...init, clientX:p[0], clientY:p[1], buttons}));
  emit('pointermove', point);
  if (action === 'move') return;
  emit('pointerdown', point, 1);
  let end = point;
  try {
    // Let React commit pointer-down state before subsequent movement/release.
    await waitForPlayback(16);
    if (action === 'drag' && to) {
      for (let i=1; i<=8; i++) {
        end = [point[0]+(to[0]-point[0])*i/8, point[1]+(to[1]-point[1])*i/8];
        emit('pointermove', end, 1);
        await waitForPlayback(16);
      }
    }
  } finally { emit('pointerup', end); }
  if (action !== 'drag') {
    target.dispatchEvent(new MouseEvent('click', {...init, clientX:end[0], clientY:end[1], detail:1}));
    if (action === 'double_click') target.dispatchEvent(new MouseEvent('dblclick', {...init, clientX:end[0], clientY:end[1], detail:2}));
  }
}
