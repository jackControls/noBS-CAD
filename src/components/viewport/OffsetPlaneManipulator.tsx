import {
  useEffect,
  useRef,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { PlaneBasis } from '../../engine/types';
import { useAppStore } from '../../store/appStore';
import { DimensionInput } from '../DimensionInput';
import type { ViewportCameraApi } from './cameraApi';
import { nativeViewportIsActive } from './nativeViewportBridge';

interface Props {
  basis: PlaneBasis;
  halfSize: [number, number];
  distance: string;
  disabled: boolean;
  onDistanceChange: (value: string) => void;
  onCommit: () => void;
}

interface Projection {
  unitX: number;
  unitY: number;
  pixelsPerMm: number;
  distance: number;
}

function dragValue(value: number) {
  if (Math.abs(value) < 0.005) return '0';
  return value.toFixed(2).replace(/\.?0+$/, '');
}

/**
 * Bevy owns the visible plane, normal arrow, and arrowhead. React contributes
 * only an invisible projected hit target plus a compact numeric editor. This
 * keeps the geometry camera-correct without copying another application's UI.
 */
export function OffsetPlaneManipulator({
  basis,
  halfSize,
  distance,
  disabled,
  onDistanceChange,
  onCommit,
}: Props) {
  const setPreview = useAppStore((state) => state.setSolidCommandPreview);
  const handleRef = useRef<HTMLButtonElement>(null);
  const fieldRef = useRef<HTMLLabelElement>(null);
  const projectionRef = useRef<Projection | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    distance: number;
  } | null>(null);
  const parsedDistance = Number(distance);
  const finiteDistance = Number.isFinite(parsedDistance) ? parsedDistance : 0;

  useEffect(() => {
    if (!Number.isFinite(parsedDistance)) {
      setPreview(null);
      return;
    }
    const timer = window.setTimeout(() => {
      setPreview({
        kind: 'offset_plane',
        basis,
        distance: parsedDistance,
        halfSize,
      });
    }, 24);
    return () => window.clearTimeout(timer);
  }, [basis, halfSize, parsedDistance, setPreview]);

  useEffect(() => () => setPreview(null), [setPreview]);

  useEffect(() => {
    let frame = 0;
    let settleTimer = 0;
    const setPosition = (element: HTMLElement, left: number, top: number) => {
      element.style.left = `${left.toFixed(2)}px`;
      element.style.top = `${top.toFixed(2)}px`;
    };
    const setVisible = (visible: boolean) => {
      const display = visible ? '' : 'none';
      if (handleRef.current) handleRef.current.style.display = display;
      if (fieldRef.current) fieldRef.current.style.display = display;
    };
    const update = () => {
      const api = (window as unknown as { __cameraApi?: ViewportCameraApi }).__cameraApi;
      const handle = handleRef.current;
      const field = fieldRef.current;
      if (!api || !handle || !field) return;
      const base = api.worldToScreen(basis.origin);
      const unitTip = api.worldToScreen([
        basis.origin[0] + basis.normal[0],
        basis.origin[1] + basis.normal[1],
        basis.origin[2] + basis.normal[2],
      ]);
      if (!base || !unitTip) {
        setVisible(false);
        projectionRef.current = null;
        return;
      }
      let unitX = unitTip.x - base.x;
      let unitY = unitTip.y - base.y;
      let pixelsPerMm = Math.hypot(unitX, unitY);
      if (pixelsPerMm < 0.15) {
        unitX = 0;
        unitY = -1;
        pixelsPerMm = 4;
      } else {
        unitX /= pixelsPerMm;
        unitY /= pixelsPerMm;
      }
      const tipX = base.x + unitX * finiteDistance * pixelsPerMm;
      const tipY = base.y + unitY * finiteDistance * pixelsPerMm;
      projectionRef.current = { unitX, unitY, pixelsPerMm, distance: finiteDistance };
      setPosition(handle, tipX, tipY);
      setPosition(
        field,
        Math.min(window.innerWidth - 390, Math.max(250, (base.x + tipX) * 0.5 - unitY * 86)),
        Math.min(window.innerHeight - 80, Math.max(150, (base.y + tipY) * 0.5 + unitX * 86)),
      );
      setVisible(true);
      handle.style.visibility = '';
      field.style.visibility = '';
    };
    const settle = () => {
      if (handleRef.current) handleRef.current.style.visibility = 'hidden';
      if (fieldRef.current) fieldRef.current.style.visibility = 'hidden';
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(update, 96);
    };
    const cameraChange = () => {
      if (nativeViewportIsActive()) settle();
    };
    const tick = () => {
      update();
      if (!nativeViewportIsActive()) frame = requestAnimationFrame(tick);
    };
    window.addEventListener('nbcad:camera-change', cameraChange);
    window.addEventListener('resize', settle);
    tick();
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(settleTimer);
      window.removeEventListener('nbcad:camera-change', cameraChange);
      window.removeEventListener('resize', settle);
    };
  }, [basis, finiteDistance]);

  const beginDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const projection = projectionRef.current;
    if (disabled || event.button !== 0 || !projection) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      distance: projection.distance,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const drag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const active = dragRef.current;
    const projection = projectionRef.current;
    if (!active || !projection || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const pixels =
      (event.clientX - active.startX) * projection.unitX
      + (event.clientY - active.startY) * projection.unitY;
    onDistanceChange(dragValue(active.distance + pixels / projection.pixelsPerMm));
  };
  const endDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const commitFromField = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (!disabled) onCommit();
  };

  return (
    <>
      <button
        ref={handleRef}
        type="button"
        data-testid="offset-plane-direction-handle"
        aria-label="Drag to change the signed plane offset"
        title="Drag to change the signed plane offset"
        tabIndex={-1}
        disabled={disabled}
        onPointerDown={beginDrag}
        onPointerMove={drag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="pointer-events-auto fixed z-[72] h-9 w-9 -translate-x-1/2 -translate-y-1/2 cursor-move touch-none opacity-0"
      />
      <label
        ref={fieldRef}
        data-native-viewport-overlay
        data-testid="offset-plane-canvas-input"
        className="pointer-events-auto fixed z-[72] flex h-8 -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-md border border-accent bg-header/95 px-2 font-mono text-[11px] text-ink shadow-lg shadow-black/40 backdrop-blur-sm"
        onPointerDown={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <span className="text-[9px] font-semibold uppercase tracking-wide text-mute">
          Offset
        </span>
        <DimensionInput
          autoSelectKey={`offset:${basis.origin.join(',')}:${basis.normal.join(',')}`}
          data-testid="offset-plane-canvas-distance"
          aria-label="Offset plane distance"
          step="any"
          value={distance}
          disabled={disabled}
          onValueChange={onDistanceChange}
          onKeyDown={commitFromField}
          className="h-6 w-16 bg-transparent text-right text-ink outline-none selection:bg-accent/40"
        />
        <span className="text-mute">mm</span>
      </label>
    </>
  );
}
