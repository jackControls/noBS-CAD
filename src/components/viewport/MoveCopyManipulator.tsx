import {
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { Point3Dto } from '../../engine/types';
import type { ViewportCameraApi } from './cameraApi';
import { nativeViewportIsActive } from './nativeViewportBridge';

type AxisIndex = 0 | 1 | 2;

interface Props {
  pivot: Point3Dto;
  translation: [string, string, string];
  rotation: [string, string, string];
  disabled: boolean;
  onTranslationChange: (value: [string, string, string]) => void;
  onRotationChange: (value: [string, string, string]) => void;
}

interface ProjectedHandle {
  x: number;
  y: number;
  unitX: number;
  unitY: number;
  pixelsPerMm: number;
}

interface ProjectedRingHandle {
  x: number;
  y: number;
  tangentX: number;
  tangentY: number;
  pixelsPerDegree: number;
}

const AXES: Array<[number, number, number]> = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];
const RING_RADIALS: Array<[number, number, number]> = [
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 0],
];
const AXIS_NAMES = ['X', 'Y', 'Z'] as const;

function compact(value: number) {
  if (Math.abs(value) < 0.005) return '0';
  return value.toFixed(2).replace(/\.?0+$/, '');
}

/**
 * Six independent native gizmo degrees of freedom: three translation arrows
 * and three rotation rings. Invisible DOM targets only bridge pointer drags;
 * all visible viewport pixels are original Bevy geometry.
 */
export function MoveCopyManipulator({
  pivot,
  translation,
  rotation,
  disabled,
  onTranslationChange,
  onRotationChange,
}: Props) {
  const translateRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const rotateRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const projectedRef = useRef<Array<ProjectedHandle | null>>([null, null, null]);
  const ringProjectedRef = useRef<Array<ProjectedRingHandle | null>>([
    null,
    null,
    null,
  ]);
  const dragRef = useRef<
    | {
        kind: 'translate';
        axis: AxisIndex;
        pointerId: number;
        startX: number;
        startY: number;
        startValue: number;
      }
    | {
        kind: 'rotate';
        axis: AxisIndex;
        pointerId: number;
        startX: number;
        startY: number;
        startValue: number;
      }
    | null
  >(null);
  const numericTranslation: [number, number, number] = translation.map((value) =>
    Number.isFinite(Number(value)) ? Number(value) : 0,
  ) as [number, number, number];
  const displayedPivot: [number, number, number] = [
    pivot.x + numericTranslation[0],
    pivot.y + numericTranslation[1],
    pivot.z + numericTranslation[2],
  ];

  useEffect(() => {
    let frame = 0;
    let settleTimer = 0;
    const setHidden = (hidden: boolean) => {
      for (const element of [...translateRefs.current, ...rotateRefs.current]) {
        if (element) element.style.visibility = hidden ? 'hidden' : '';
      }
    };
    const update = () => {
      const api = (window as unknown as { __cameraApi?: ViewportCameraApi }).__cameraApi;
      if (!api) return;
      const center = api.worldToScreen(displayedPivot);
      if (!center) {
        for (const element of [...translateRefs.current, ...rotateRefs.current]) {
          if (element) element.style.display = 'none';
        }
        return;
      }
      for (let index = 0 as AxisIndex; index < 3; index = (index + 1) as AxisIndex) {
        const axis = AXES[index];
        const unit = api.worldToScreen([
          displayedPivot[0] + axis[0],
          displayedPivot[1] + axis[1],
          displayedPivot[2] + axis[2],
        ]);
        const translate = translateRefs.current[index];
        const rotate = rotateRefs.current[index];
        if (!unit || !translate || !rotate) continue;
        let dx = unit.x - center.x;
        let dy = unit.y - center.y;
        let pixelsPerMm = Math.hypot(dx, dy);
        if (pixelsPerMm < 0.1) {
          const fallbacks = [
            { x: 1, y: 0 },
            { x: 0.45, y: -0.9 },
            { x: 0, y: -1 },
          ];
          dx = fallbacks[index].x;
          dy = fallbacks[index].y;
          pixelsPerMm = 3;
        } else {
          dx /= pixelsPerMm;
          dy /= pixelsPerMm;
        }
        projectedRef.current[index] = {
          x: center.x + dx * 72,
          y: center.y + dy * 72,
          unitX: dx,
          unitY: dy,
          pixelsPerMm,
        };
        translate.style.left = `${(center.x + dx * 72).toFixed(2)}px`;
        translate.style.top = `${(center.y + dy * 72).toFixed(2)}px`;
        translate.style.display = '';
        const radial = RING_RADIALS[index];
        const radialUnit = api.worldToScreen([
          displayedPivot[0] + radial[0],
          displayedPivot[1] + radial[1],
          displayedPivot[2] + radial[2],
        ]);
        const radialPixelsPerMm = radialUnit
          ? Math.hypot(radialUnit.x - center.x, radialUnit.y - center.y)
          : 0;
        const ringRadius = radialPixelsPerMm > 0.1 ? 45 / radialPixelsPerMm : 12;
        const ringWorld: [number, number, number] = [
          displayedPivot[0] + radial[0] * ringRadius,
          displayedPivot[1] + radial[1] * ringRadius,
          displayedPivot[2] + radial[2] * ringRadius,
        ];
        const ringPoint = api.worldToScreen(ringWorld);
        // Right-hand-rule tangent: axis × radial. Its projected sign remains
        // correct when the camera crosses behind or above the part.
        const tangent: [number, number, number] = [
          axis[1] * radial[2] - axis[2] * radial[1],
          axis[2] * radial[0] - axis[0] * radial[2],
          axis[0] * radial[1] - axis[1] * radial[0],
        ];
        const tangentPoint = api.worldToScreen([
          ringWorld[0] + tangent[0],
          ringWorld[1] + tangent[1],
          ringWorld[2] + tangent[2],
        ]);
        if (!ringPoint || !tangentPoint) {
          rotate.style.display = 'none';
          ringProjectedRef.current[index] = null;
          continue;
        }
        let tangentX = tangentPoint.x - ringPoint.x;
        let tangentY = tangentPoint.y - ringPoint.y;
        const tangentPixelsPerMm = Math.hypot(tangentX, tangentY);
        if (tangentPixelsPerMm < 0.1) {
          rotate.style.display = 'none';
          ringProjectedRef.current[index] = null;
          continue;
        }
        tangentX /= tangentPixelsPerMm;
        tangentY /= tangentPixelsPerMm;
        ringProjectedRef.current[index] = {
          x: ringPoint.x,
          y: ringPoint.y,
          tangentX,
          tangentY,
          pixelsPerDegree: Math.max(
            0.08,
            (tangentPixelsPerMm * ringRadius * Math.PI) / 180,
          ),
        };
        rotate.style.left = `${ringPoint.x.toFixed(2)}px`;
        rotate.style.top = `${ringPoint.y.toFixed(2)}px`;
        rotate.style.display = '';
      }
      setHidden(false);
    };
    const settle = () => {
      setHidden(true);
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
  }, [displayedPivot[0], displayedPivot[1], displayedPivot[2]]);

  const beginTranslate = (
    axis: AxisIndex,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (disabled || event.button !== 0 || !projectedRef.current[axis]) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = {
      kind: 'translate',
      axis,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startValue: Number(translation[axis]) || 0,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const beginRotate = (
    axis: AxisIndex,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    const projected = ringProjectedRef.current[axis];
    if (disabled || event.button !== 0 || !projected) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = {
      kind: 'rotate',
      axis,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startValue: Number(rotation[axis]) || 0,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const drag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const active = dragRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (active.kind === 'translate') {
      const projection = projectedRef.current[active.axis];
      if (!projection) return;
      const pixels =
        (event.clientX - active.startX) * projection.unitX
        + (event.clientY - active.startY) * projection.unitY;
      const next = [...translation] as [string, string, string];
      next[active.axis] = compact(active.startValue + pixels / projection.pixelsPerMm);
      onTranslationChange(next);
      return;
    }
    const projected = ringProjectedRef.current[active.axis];
    if (!projected) return;
    const pixels =
      (event.clientX - active.startX) * projected.tangentX
      + (event.clientY - active.startY) * projected.tangentY;
    const next = [...rotation] as [string, string, string];
    next[active.axis] = compact(active.startValue + pixels / projected.pixelsPerDegree);
    onRotationChange(next);
  };
  const endDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <>
      {AXIS_NAMES.map((name, index) => (
        <button
          key={`translate-${name}`}
          ref={(element) => { translateRefs.current[index] = element; }}
          type="button"
          data-testid={`move-copy-translate-${name.toLowerCase()}-handle`}
          aria-label={`Drag to translate along ${name}`}
          title={`Translate ${name}`}
          tabIndex={-1}
          disabled={disabled}
          onPointerDown={(event) => beginTranslate(index as AxisIndex, event)}
          onPointerMove={drag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className="pointer-events-auto fixed z-[72] h-8 w-8 -translate-x-1/2 -translate-y-1/2 cursor-move touch-none opacity-0"
        />
      ))}
      {AXIS_NAMES.map((name, index) => (
        <button
          key={`rotate-${name}`}
          ref={(element) => { rotateRefs.current[index] = element; }}
          type="button"
          data-testid={`move-copy-rotate-${name.toLowerCase()}-handle`}
          aria-label={`Drag to rotate about ${name}`}
          title={`Rotate ${name}`}
          tabIndex={-1}
          disabled={disabled}
          onPointerDown={(event) => beginRotate(index as AxisIndex, event)}
          onPointerMove={drag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className="pointer-events-auto fixed z-[72] h-8 w-8 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none opacity-0 active:cursor-grabbing"
        />
      ))}
    </>
  );
}
