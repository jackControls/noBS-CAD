import {
  Focus,
  Gamepad2,
  Grid3x3,
  Hand,
  Maximize,
  Monitor,
  Move3d,
  Redo2,
  SquareDashed,
  Undo2,
  ZoomIn,
} from 'lucide-react';

type LabMode = 'compare' | 'native' | 'reference';

function referenceUrl(mode: LabMode): string {
  const url = new URL(window.location.href);
  url.searchParams.set('bevy-ui-lab', mode);
  return url.toString();
}
function ReferenceDial() {
  return (
    <aside className="absolute right-3 top-3 z-20 w-[132px] select-none rounded-xl border border-edge/90 bg-panel/90 px-2 pb-2 pt-1.5 shadow-lg shadow-black/20">
      <div className="mb-0.5 text-center text-[8px] font-semibold tracking-[0.16em] text-mute">
        ORIENTATION DIAL
      </div>
      <div className="relative mx-auto h-[104px] w-[104px]">
        {[
          ['F', 'left-1/2 top-0 -translate-x-1/2'],
          ['R', 'right-0 top-1/2 -translate-y-1/2'],
          ['B', 'bottom-0 left-1/2 -translate-x-1/2'],
          ['L', 'left-0 top-1/2 -translate-y-1/2'],
        ].map(([label, position]) => (
          <span
            key={label}
            className={`absolute z-10 flex h-5 w-7 items-center justify-center rounded-full border border-edge bg-header/95 text-[9px] font-bold text-mute shadow-sm ${position}`}
          >
            {label}
          </span>
        ))}
        <div className="absolute left-1/2 top-1/2 h-[76px] w-[76px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-full border border-edge bg-viewport/80 shadow-inner">
          <svg viewBox="0 0 76 76" className="h-full w-full">
            <circle
              cx="38"
              cy="38"
              r="32"
              fill="none"
              stroke="currentColor"
              strokeDasharray="2 4"
              className="text-edge/70"
            />
            <line x1="38" y1="38" x2="59" y2="50" stroke="#e35c63" strokeWidth="2.2" />
            <line x1="38" y1="38" x2="23" y2="47" stroke="#59ad73" strokeWidth="2.2" />
            <line x1="38" y1="38" x2="38" y2="13" stroke="#42a6e8" strokeWidth="2.2" />
            <circle cx="59" cy="50" r="2.5" fill="#e35c63" />
            <circle cx="23" cy="47" r="2.5" fill="#59ad73" />
            <circle cx="38" cy="13" r="2.5" fill="#42a6e8" />
            <circle cx="38" cy="38" r="2.5" className="fill-ink" />
            <text x="62" y="56" fill="#e35c63" fontSize="8" fontWeight="800">X</text>
            <text x="13" y="53" fill="#59ad73" fontSize="8" fontWeight="800">Y</text>
            <text x="43" y="13" fill="#42a6e8" fontSize="8" fontWeight="800">Z</text>
          </svg>
        </div>
      </div>
      <div className="mt-1 grid grid-cols-3 gap-1">
        {['+Z', 'ISO', '−Z'].map((label) => (
          <span
            key={label}
            className={`flex h-5 items-center justify-center rounded border border-edge bg-header/90 text-[9px] ${
              label === 'ISO' ? 'font-bold text-ink' : 'font-semibold text-mute'
            }`}
          >
            {label}
          </span>
        ))}
      </div>
      <div className="mt-1 text-center text-[8px] text-mute/70">
        Drag the dial to orbit
      </div>
    </aside>
  );
}

function ReferenceNav() {
  const icons = [
    Undo2,
    Redo2,
    Focus,
    Move3d,
    Hand,
    ZoomIn,
    SquareDashed,
    Maximize,
    Monitor,
    Grid3x3,
    Gamepad2,
  ];
  return (
    <div className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-0.5 rounded border border-edge bg-header/90 px-1.5 py-1 shadow-lg shadow-black/10">
      {icons.map((Icon, index) => (
        <div key={index} className="contents">
          {(index === 3 || index === 10) && <div className="mx-1 h-4 w-px bg-edge" />}
          <span
            className={`relative flex h-6 w-6 items-center justify-center rounded ${
              index === 3
                ? 'bg-accent/30 text-accent'
                : index === 4
                  ? 'bg-edge text-ink'
                  : index === 1 || index === 8 || index === 9
                    ? 'text-mute opacity-35'
                    : 'text-mute'
            }`}
          >
            <Icon size={15} />
            {index === 10 && (
              <span className="absolute bottom-0.5 right-0.5 h-1.5 w-1.5 rounded-full border border-header bg-emerald-400" />
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

function ReferenceSelection() {
  return (
    <aside className="absolute bottom-12 right-3 z-20 min-w-[238px] rounded border border-edge bg-header/95 px-2.5 py-2 text-[11px] text-ink shadow-lg shadow-black/15">
      <div className="mb-1.5 flex items-center justify-between gap-4 border-b border-edge/80 pb-1.5">
        <span className="text-[9px] font-semibold tracking-[0.14em] text-mute">SELECTION</span>
        <span className="font-medium">Body1</span>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        {[
          ['Size', '30 × 30 × 30 mm'],
          ['Surface area', '≈ 5,400 mm²'],
          ['Volume', '≈ 27,000 mm³'],
        ].map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-mute">{label}</dt>
            <dd className="text-right font-mono tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-1.5 border-t border-edge/60 pt-1 text-right text-[9px] text-mute">
        ≈ from display geometry
      </div>
    </aside>
  );
}

function ReferenceDialog() {
  return (
    <div className="feature-dialog absolute left-1/2 top-1/2 z-40 w-[440px] -translate-x-1/2 -translate-y-1/2 overflow-hidden border border-edge bg-panel">
      <header className="feature-dialog-header flex h-[52px] items-center gap-2.5 border-b border-edge px-4">
        <span className="h-[18px] w-[18px] rounded-full border-2 border-accent" />
        <span className="flex-1 text-base font-semibold text-ink">Sketch coordinate origin</span>
        <span className="text-[22px] text-mute">×</span>
      </header>
      <div className="space-y-3.5 p-5">
        <p className="text-sm leading-5 text-mute">
          Choose where sketch (0, 0) is placed on planar face #603509456585486.
        </p>
        {[
          ['Center of selected face', 'Places zero at the area-weighted center of this face.', true],
          ['Project the global origin', 'Projects the document XYZ origin onto the selected face plane.', false],
        ].map(([title, hint, selected]) => (
          <div
            key={String(title)}
            className={`flex min-h-[74px] gap-3 rounded-md border bg-header p-3 ${
              selected ? 'border-[1.5px] border-accent' : 'border-edge'
            }`}
          >
            <span
              className={`mt-1 h-3.5 w-3.5 rounded-full border-2 ${
                selected ? 'border-accent bg-accent' : 'border-mute'
              }`}
            />
            <span>
              <span className="block text-[15px] font-medium text-ink">{String(title)}</span>
              <span className="mt-1 block text-xs text-mute">{String(hint)}</span>
            </span>
          </div>
        ))}
      </div>
      <footer className="flex h-[54px] items-center justify-end gap-2.5 border-t border-edge bg-header px-4">
        <span className="flex h-8 items-center rounded border border-edge px-4 text-sm font-semibold text-ink">Cancel</span>
        <span className="flex h-8 items-center rounded bg-accent px-4 text-sm font-semibold text-white">Create Sketch</span>
      </footer>
    </div>
  );
}

function ReferenceSurface() {
  return (
    <div className="relative h-full w-full overflow-hidden bg-viewport text-ink">
      <div
        className="absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            'linear-gradient(rgb(var(--edge-rgb) / .32) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--edge-rgb) / .32) 1px, transparent 1px)',
          backgroundSize: '60px 60px',
        }}
      />
      <ReferenceDial />
      <ReferenceNav />
      <ReferenceSelection />
      <div className="absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded border border-edge bg-header/90 px-3 py-1.5 text-xs text-ink shadow-lg">
        Select a plane or planar face (Esc to cancel)
      </div>
      <div className="absolute inset-0 z-30 bg-black/20" />
      <ReferenceDialog />
    </div>
  );
}

function NativeCapture() {
  return (
    <img
      src={`/__bevy_ui__/native.png?v=${Date.now()}`}
      alt="Actual native Bevy UI capture"
      className="h-full w-full bg-viewport object-fill"
    />
  );
}

export function BevyUiParityLab() {
  const requested = new URLSearchParams(window.location.search).get('bevy-ui-lab');
  const mode: LabMode =
    requested === 'native' || requested === 'reference' ? requested : 'compare';

  if (mode === 'native') return <NativeCapture />;
  if (mode === 'reference') return <ReferenceSurface />;

  return (
    <div className="flex h-screen flex-col bg-panel text-ink">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-edge bg-header px-4">
        <span className="font-semibold">Bevy native UI visual regression lab</span>
        <span className="text-mute">Actual production renderer beside the React contract.</span>
        <span className="flex-1" />
        <a className="rounded border border-edge px-2 py-1 hover:border-accent" href={referenceUrl('native')}>Native 1:1</a>
        <a className="rounded border border-edge px-2 py-1 hover:border-accent" href={referenceUrl('reference')}>React 1:1</a>
      </header>
      <main className="grid min-h-0 flex-1 grid-cols-2 gap-3 p-3">
        <section className="flex min-h-0 flex-col">
          <h1 className="mb-2 text-xs font-semibold uppercase tracking-wider text-mute">Native Bevy capture</h1>
          <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-edge shadow-xl">
            <NativeCapture />
          </div>
        </section>
        <section className="flex min-h-0 flex-col">
          <h1 className="mb-2 text-xs font-semibold uppercase tracking-wider text-mute">React visual contract</h1>
          <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-edge shadow-xl">
            <ReferenceSurface />
          </div>
        </section>
      </main>
    </div>
  );
}
