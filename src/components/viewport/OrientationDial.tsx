/**
 * Flat camera-orientation control. The dial shows the projected world axes,
 * offers six explicit axis presets, and supports drag-to-orbit. Its geometry
 * and interaction language are intentionally native to noBS CAD.
 */
import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { useTranslation } from '../../i18n';
import type { ViewportCameraApi } from './cameraApi';
import { Vector3 } from './cadInteraction';
import { nativeViewportIsActive } from './nativeViewportBridge';

type AxisPreset = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';

const PRESET_DIRECTIONS: Record<AxisPreset, [number, number, number]> = {
  front: [0, -1, 0],
  back: [0, 1, 0],
  left: [-1, 0, 0],
  right: [1, 0, 0],
  top: [0, 0, 1],
  bottom: [0, 0, -1],
};

const AXES = [
  { key: 'x', vector: new Vector3(1, 0, 0), color: '#e15b64' },
  { key: 'y', vector: new Vector3(0, 1, 0), color: '#58ad72' },
  { key: 'z', vector: new Vector3(0, 0, 1), color: '#42a5e8' },
] as const;

export function OrientationDial({
  apiRef,
}: {
  apiRef: RefObject<ViewportCameraApi | null>;
}) {
  const indicatorRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const { t } = useTranslation();

  useEffect(() => {
    let raf = 0;
    const position = new Vector3();
    const target = new Vector3();
    const upHint = new Vector3();
    const forward = new Vector3();
    const right = new Vector3();
    const screenUp = new Vector3();

    const update = () => {
      const svg = indicatorRef.current;
      const snapshot = apiRef.current?.getSnapshot();
      if (!svg || !snapshot) return;

      position.fromArray(snapshot.position);
      target.fromArray(snapshot.target);
      upHint.fromArray(snapshot.up).normalize();
      forward.copy(target).sub(position).normalize();
      right.crossVectors(forward, upHint).normalize();
      if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
      screenUp.crossVectors(right, forward).normalize();

      for (const axis of AXES) {
        const x = 38 + axis.vector.dot(right) * 25;
        const y = 38 - axis.vector.dot(screenUp) * 25;
        const depth = axis.vector.dot(forward);
        const opacity = String(0.55 + Math.max(0, depth) * 0.45);
        const line = svg.querySelector<SVGLineElement>(`[data-axis-line="${axis.key}"]`);
        const dot = svg.querySelector<SVGCircleElement>(`[data-axis-dot="${axis.key}"]`);
        const label = svg.querySelector<SVGTextElement>(`[data-axis-label="${axis.key}"]`);
        line?.setAttribute('x2', x.toFixed(2));
        line?.setAttribute('y2', y.toFixed(2));
        line?.setAttribute('opacity', opacity);
        dot?.setAttribute('cx', x.toFixed(2));
        dot?.setAttribute('cy', y.toFixed(2));
        dot?.setAttribute('opacity', opacity);
        label?.setAttribute('x', (x + (x >= 38 ? 4 : -4)).toFixed(2));
        label?.setAttribute('y', (y + (y >= 38 ? 8 : -3)).toFixed(2));
        label?.setAttribute('text-anchor', x >= 38 ? 'start' : 'end');
        label?.setAttribute('opacity', opacity);
      }
    };
    const tick = () => {
      update();
      // Browser/dev rendering has no native bridge event source and needs to
      // follow Orbit/6-DOF camera changes continuously. Once Bevy is active,
      // bridge camera events own updates so the DOM dial costs no idle frame.
      if (!nativeViewportIsActive()) raf = requestAnimationFrame(tick);
    };
    tick();
    window.addEventListener('nbcad:camera-change', update);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('nbcad:camera-change', update);
    };
  }, [apiRef]);

  const snap = (preset: AxisPreset) => {
    apiRef.current?.snapToDirection(PRESET_DIRECTIONS[preset]);
  };

  const beginOrbit = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // The native Windows viewport owns OS capture while its WebView message
      // adapter supplies the matching pointermove/pointerup events.
    }
  };

  const orbit = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (dx !== 0 || dy !== 0) apiRef.current?.orbitBy(dx, dy);
    drag.x = event.clientX;
    drag.y = event.clientY;
  };

  const endOrbit = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const presetButton = (
    preset: Exclude<AxisPreset, 'top' | 'bottom'>,
    shortLabel: string,
    className: string,
  ) => (
    <button
      type="button"
      data-orientation-preset={preset}
      title={t(`orientationDial.${preset}`)}
      aria-label={t(`orientationDial.${preset}`)}
      onClick={() => snap(preset)}
      className={`absolute z-10 flex h-5 w-7 items-center justify-center rounded-full border border-edge bg-header/95 text-[9px] font-bold text-mute shadow-sm transition-all duration-150 ease-out hover:scale-105 hover:border-accent hover:bg-accent/15 hover:text-accent ${className}`}
    >
      {shortLabel}
    </button>
  );

  return (
    <div
      className="absolute right-3 top-3 z-10 w-[132px]"
      data-orientation-dial
      data-native-hud="orientation"
    >
      <aside
        data-native-viewport-overlay
        className="select-none rounded-xl border border-edge/90 bg-panel/90 px-2 pb-2 pt-1.5 shadow-lg shadow-black/20 backdrop-blur-sm"
        aria-label={t('orientationDial.label')}
      >
      <div className="mb-0.5 text-center text-[8px] font-semibold tracking-[0.16em] text-mute">
        {t('orientationDial.label')}
      </div>

      <div className="relative mx-auto h-[104px] w-[104px]">
        {presetButton('front', 'F', 'left-1/2 top-0 -translate-x-1/2')}
        {presetButton('right', 'R', 'right-0 top-1/2 -translate-y-1/2')}
        {presetButton('back', 'B', 'bottom-0 left-1/2 -translate-x-1/2')}
        {presetButton('left', 'L', 'left-0 top-1/2 -translate-y-1/2')}

        <div className="absolute left-1/2 top-1/2 h-[76px] w-[76px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-full border border-edge bg-viewport/80 shadow-inner">
          <svg
            ref={indicatorRef}
            data-native-hud-control="orientation:orbit"
            viewBox="0 0 76 76"
            role="img"
            aria-label={t('orientationDial.axes')}
            onPointerDown={beginOrbit}
            onPointerMove={orbit}
            onPointerUp={endOrbit}
            onPointerCancel={endOrbit}
            className="h-full w-full cursor-grab touch-none active:cursor-grabbing"
          >
            <circle cx="38" cy="38" r="32" fill="none" stroke="currentColor" strokeDasharray="2 4" className="text-edge/70" />
            {AXES.map((axis) => (
              <g key={axis.key} style={{ color: axis.color }}>
                <line data-axis-line={axis.key} x1="38" y1="38" x2="38" y2="38" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                <circle data-axis-dot={axis.key} cx="38" cy="38" r="2.5" fill="currentColor" />
                <text data-axis-label={axis.key} x="38" y="38" fill="currentColor" fontSize="8" fontWeight="800">
                  {axis.key.toUpperCase()}
                </text>
              </g>
            ))}
            <circle cx="38" cy="38" r="2.5" className="fill-ink" />
          </svg>
        </div>
      </div>

      <div className="mt-1 grid grid-cols-3 gap-1">
        <button
          type="button"
          data-orientation-preset="top"
          title={t('orientationDial.top')}
          onClick={() => snap('top')}
          className="h-5 whitespace-nowrap rounded border border-edge bg-header/90 text-[9px] font-semibold text-mute transition-all duration-150 ease-out hover:-translate-y-px hover:border-accent hover:bg-accent/15 hover:text-accent"
        >
          +Z
        </button>
        <button
          type="button"
          data-orientation-preset="axonometric"
          title={t('orientationDial.axonometric')}
          aria-label={t('orientationDial.axonometric')}
          onClick={() => apiRef.current?.home()}
          className="h-5 whitespace-nowrap rounded border border-edge bg-header/90 text-[9px] font-bold text-ink transition-all duration-150 ease-out hover:-translate-y-px hover:border-accent hover:bg-accent/15 hover:text-accent"
        >
          ISO
        </button>
        <button
          type="button"
          data-orientation-preset="bottom"
          title={t('orientationDial.bottom')}
          onClick={() => snap('bottom')}
          className="h-5 whitespace-nowrap rounded border border-edge bg-header/90 text-[9px] font-semibold text-mute transition-all duration-150 ease-out hover:-translate-y-px hover:border-accent hover:bg-accent/15 hover:text-accent"
        >
          −Z
        </button>
      </div>
      <div className="mt-1 text-center text-[8px] text-mute/70">{t('orientationDial.orbit')}</div>
      </aside>
    </div>
  );
}
