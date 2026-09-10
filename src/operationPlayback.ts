import {operationGroup} from './interface';
/** One presentation lane shared by UI, camera and modeling inbox work. */
export class SerialPlayback {
  private running = false;
  async tick(work: () => Promise<void>): Promise<boolean> {
    if (this.running) return false;
    this.running = true;
    try { await work(); return true; } finally { this.running = false; }
  }
}

let paceMs = 0;
const wakeups = new Set<() => void>();
export function wakePlayback(): void { for (const wake of [...wakeups]) wake(); }
export function waitForPlayback(ms: number): Promise<void> {
  return new Promise(resolve => {
    const deadline = Date.now() + ms;
    const finish = () => { clearTimeout(timer); wakeups.delete(wake); resolve(); };
    const wake = () => { if (Date.now() >= deadline) finish(); };
    const timer = setTimeout(finish, ms);
    wakeups.add(wake);
  });
}
export function setPlaybackPace(ms: number): void {
  if (!Number.isInteger(ms) || ms < 0 || ms > 2000) throw new Error('pace_ms must be an integer from 0 to 2000');
  paceMs = ms;
}

export function installOperationFeedback(): () => void {
  const touch = (event: PointerEvent) => {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    const target = event.target.closest<HTMLElement>('button,[role="button"],[role="menuitem"]');
    if (target && !target.matches(':disabled,[aria-disabled="true"]')) {
      void presentOperation(target.getAttribute('aria-label') || target.title || target.textContent || 'Select', target);
    }
  };
  document.addEventListener('pointerdown',touch,true);
  return ()=>document.removeEventListener('pointerdown',touch,true);
}

export async function presentOperation(label: string, target?: HTMLElement | null): Promise<void> {
  // Rendering is an observer of the operation, not another operation or a
  // mandatory delay. An explicit demo pace can still slow down a lesson.
  if (document.visibilityState !== 'visible') return;
  const group = operationGroup(label);
  target ??= [...document.querySelectorAll<HTMLElement>('[data-interface-group]')]
    .find(element => element.dataset.interfaceGroup === group);
  const node = document.createElement('div');
  node.dataset.mcpPresentation = 'true';
  node.setAttribute('role', 'status');
  node.textContent = label.replace(/^(sketch|solid|assembly)_/, '').replace(/_/g, ' ');
  Object.assign(node.style, { position: 'fixed', bottom: '40px', left: '50%', transform: 'translateX(-50%)',
    zIndex: '1000', pointerEvents: 'none', background: 'var(--color-panel, #23262b)', color: 'var(--color-ink, #eee)',
    border: '1px solid currentColor', padding: '6px 12px', font: '12px sans-serif' });
  document.body.append(node);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const duration = Math.max(paceMs, 420);
  if (!reduced && group && /^(sketch|solid)\//.test(group)) {
    document.querySelector<HTMLElement>('[data-mcp-canvas="viewport"]')?.animate([
      {outline:'2px solid #64d8b0',outlineOffset:'-2px'},
      {outline:'2px solid transparent',outlineOffset:'-2px'},
    ],{duration});
  }
  const animation = !reduced && target?.isConnected ? target.animate([
    { outline: '2px solid #64d8b0', outlineOffset: '0px', filter: 'brightness(1.25)' },
    { outline: '2px solid transparent', outlineOffset: '8px', filter: 'brightness(1)' },
  ], { duration }) : null;
  if (!reduced) node.animate([{opacity:0,translate:'0 8px'},{opacity:1,translate:'0 0',offset:0.2},{opacity:0,translate:'0 -4px'}],{duration});
  // Keep effects visible even in fast execution. Cleanup never blocks the
  // next operation; only an explicitly requested lesson pace does.
  setTimeout(()=>{animation?.cancel();node.remove();},duration);
  if (paceMs) await waitForPlayback(paceMs);
}
