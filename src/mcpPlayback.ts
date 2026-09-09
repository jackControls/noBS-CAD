/** One presentation lane shared by UI, camera and modeling inbox work. */
export class SerialPlayback {
  private running = false;
  async tick(work: () => Promise<void>): Promise<boolean> {
    if (this.running) return false;
    this.running = true;
    try { await work(); return true; } finally { this.running = false; }
  }
}

let paceMs = 180;
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

export async function presentMcpOperation(label: string, target?: HTMLElement | null): Promise<void> {
  const node = document.createElement('div');
  node.dataset.mcpPresentation = 'true';
  node.setAttribute('role', 'status');
  node.textContent = label;
  Object.assign(node.style, { position: 'fixed', bottom: '40px', left: '50%', transform: 'translateX(-50%)',
    zIndex: '1000', pointerEvents: 'none', background: 'var(--color-panel, #23262b)', color: 'var(--color-ink, #eee)',
    border: '1px solid currentColor', padding: '6px 12px', font: '12px sans-serif' });
  document.body.append(node);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const animation = !reduced && target?.isConnected ? target.animate([{ outline: '2px solid #8ab4f8', outlineOffset: '2px' }, { outline: '2px solid transparent', outlineOffset: '5px' }], { duration: Math.max(paceMs, 32) }) : null;
  try {
    // Timers keep sequencing alive while the window is in the background.
    // A hidden document must never be reported as visually presented.
    await waitForPlayback(Math.max(paceMs, 32));
  } finally { animation?.cancel(); node.remove(); }
}
