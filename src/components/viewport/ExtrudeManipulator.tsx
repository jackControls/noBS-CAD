import {
  useEffect,
  useMemo,
  useRef,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { PlaneBasis, ProfileLoopDto } from '../../engine/types';
import { useTranslation } from '../../i18n';
import { DimensionInput } from '../DimensionInput';
import type { ViewportCameraApi } from './cameraApi';
import { nativeViewportIsActive } from './nativeViewportBridge';

interface Props {
  basis: PlaneBasis;
  profiles: ProfileLoopDto[];
  distance: string;
  flip: boolean;
  disabled: boolean;
  onDistanceChange: (value: string) => void;
  onCommit: () => void;
}

interface Projection {
  unitX: number;
  unitY: number;
  pixelsPerMm: number;
  effectiveDistance: number;
}

const EPS = 1e-6;

function polygonCentroid(profile: ProfileLoopDto): { x: number; y: number; weight: number } {
  let twiceArea = 0;
  let xMoment = 0;
  let yMoment = 0;
  for (let index = 0; index < profile.points.length; index += 1) {
    const point = profile.points[index];
    const next = profile.points[(index + 1) % profile.points.length];
    const cross = point.x * next.y - next.x * point.y;
    twiceArea += cross;
    xMoment += (point.x + next.x) * cross;
    yMoment += (point.y + next.y) * cross;
  }
  if (Math.abs(twiceArea) > EPS) {
    return {
      x: xMoment / (3 * twiceArea),
      y: yMoment / (3 * twiceArea),
      weight: Math.abs(twiceArea) * 0.5,
    };
  }
  const count = Math.max(1, profile.points.length);
  return {
    x: profile.points.reduce((sum, point) => sum + point.x, 0) / count,
    y: profile.points.reduce((sum, point) => sum + point.y, 0) / count,
    weight: 1,
  };
}

function worldAnchor(
  basis: PlaneBasis,
  profiles: ProfileLoopDto[],
): [number, number, number] {
  const centroids = profiles.map(polygonCentroid);
  const totalWeight = centroids.reduce((sum, centroid) => sum + centroid.weight, 0) || 1;
  const x =
    centroids.reduce((sum, centroid) => sum + centroid.x * centroid.weight, 0) / totalWeight;
  const y =
    centroids.reduce((sum, centroid) => sum + centroid.y * centroid.weight, 0) / totalWeight;
  return [
    basis.origin[0] + basis.u[0] * x + basis.v[0] * y,
    basis.origin[1] + basis.u[1] * x + basis.v[1] * y,
    basis.origin[2] + basis.u[2] * x + basis.v[2] * y,
  ];
}

function dragValue(value: number) {
  if (Math.abs(value) < 0.005) return '0';
  return value.toFixed(2).replace(/\.?0+$/, '');
}

/**
 * React owns only the projected input and an invisible drag hit target. Bevy
 * renders the actual 3D shaft, head, and origin marker. The hit target must not
 * become a visible DOM island: doing so masks the native arrowhead and forces
 * the webview/native-view cutout to move on every camera frame.
 */
export function ExtrudeManipulator({
  basis,
  profiles,
  distance,
  flip,
  disabled,
  onDistanceChange,
  onCommit,
}: Props) {
  const { t } = useTranslation();
  const handleRef = useRef<HTMLButtonElement>(null);
  const fieldRef = useRef<HTMLLabelElement>(null);
  const projectionRef = useRef<Projection | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    effectiveDistance: number;
  } | null>(null);
  const anchor = useMemo(() => worldAnchor(basis, profiles), [basis, profiles]);
  const parsedDistance = Number(distance);
  const effectiveDistance =
    (Number.isFinite(parsedDistance) ? parsedDistance : 10) * (flip ? -1 : 1);

  useEffect(() => {
    let frame = 0;
    let settleTimer = 0;

    const setDisplay = (element: HTMLElement, value: string) => {
      if (element.style.display !== value) element.style.display = value;
    };
    const setVisibility = (element: HTMLElement, value: string) => {
      if (element.style.visibility !== value) element.style.visibility = value;
    };
    const setPosition = (element: HTMLElement, left: number, top: number) => {
      const nextLeft = `${left.toFixed(2)}px`;
      const nextTop = `${top.toFixed(2)}px`;
      if (element.style.left !== nextLeft) element.style.left = nextLeft;
      if (element.style.top !== nextTop) element.style.top = nextTop;
    };

    const update = () => {
      const api = (
        window as unknown as {
          __cameraApi?: ViewportCameraApi;
        }
      ).__cameraApi;
      const handle = handleRef.current;
      const field = fieldRef.current;
      if (!api || !handle || !field) return;

      const normal = basis.normal;
      const base = api.worldToScreen(anchor);
      const unitTip = api.worldToScreen([
        anchor[0] + normal[0],
        anchor[1] + normal[1],
        anchor[2] + normal[2],
      ]);
      if (!base || !unitTip) {
        setDisplay(handle, 'none');
        setDisplay(field, 'none');
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
      const tip = {
        x: base.x + unitX * effectiveDistance * pixelsPerMm,
        y: base.y + unitY * effectiveDistance * pixelsPerMm,
      };
      projectionRef.current = {
        unitX,
        unitY,
        pixelsPerMm,
        effectiveDistance,
      };

      setPosition(handle, tip.x, tip.y);
      setDisplay(handle, '');
      setVisibility(handle, '');

      const midpointX = (base.x + tip.x) * 0.5 - unitY * 92;
      const midpointY = (base.y + tip.y) * 0.5 + unitX * 92;
      setPosition(
        field,
        Math.min(window.innerWidth - 390, Math.max(250, midpointX)),
        Math.min(window.innerHeight - 80, Math.max(150, midpointY)),
      );
      setDisplay(field, '');
      setVisibility(field, '');
    };

    const settleAfterCameraMotion = () => {
      const handle = handleRef.current;
      const field = fieldRef.current;
      if (handle) setVisibility(handle, 'hidden');
      if (field) setVisibility(field, 'hidden');
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(update, 96);
    };

    const onCameraChange = () => {
      if (nativeViewportIsActive()) settleAfterCameraMotion();
    };

    const tick = () => {
      update();
      // Browser development has no native camera event source. In the desktop
      // build, stop polling as soon as Bevy is active; camera events hide the
      // DOM islands during motion and position them once after navigation
      // settles.
      if (!nativeViewportIsActive()) frame = requestAnimationFrame(tick);
    };
    window.addEventListener('nbcad:camera-change', onCameraChange);
    window.addEventListener('resize', settleAfterCameraMotion);
    tick();
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(settleTimer);
      window.removeEventListener('nbcad:camera-change', onCameraChange);
      window.removeEventListener('resize', settleAfterCameraMotion);
    };
  }, [anchor, basis.normal, effectiveDistance]);

  const beginDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (disabled || event.button !== 0) return;
    const projection = projectionRef.current;
    if (!projection) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      effectiveDistance: projection.effectiveDistance,
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
      (event.clientX - active.startX) * projection.unitX +
      (event.clientY - active.startY) * projection.unitY;
    const nextEffective = active.effectiveDistance + pixels / projection.pixelsPerMm;
    onDistanceChange(dragValue(flip ? -nextEffective : nextEffective));
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
        data-testid="extrude-direction-handle"
        aria-label={t('extrude.dragHandle')}
        title={t('extrude.dragHandle')}
        tabIndex={-1}
        disabled={disabled}
        onPointerDown={beginDrag}
        onPointerMove={drag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="pointer-events-auto fixed z-[72] h-8 w-8 -translate-x-1/2 -translate-y-1/2 cursor-move touch-none opacity-0"
      />

      <label
        ref={fieldRef}
        data-native-viewport-overlay
        data-testid="extrude-canvas-input"
        className="pointer-events-auto fixed z-[72] flex h-8 -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-md border border-accent bg-header/95 px-2 font-mono text-[11px] text-ink shadow-lg shadow-black/50 backdrop-blur-sm"
        onPointerDown={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <span className="text-[9px] font-semibold uppercase tracking-wide text-mute">
          {t('extrude.distance')}
        </span>
        <DimensionInput
          data-testid="extrude-canvas-distance"
          aria-label={t('extrude.canvasDistance')}
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
