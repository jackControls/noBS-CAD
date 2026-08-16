import {
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { Point3Dto } from '../../engine/types';
import type { MoveCopyGizmoInteraction } from '../../store/appStore';
import type { ViewportCameraApi } from './cameraApi';
import { nativeViewportIsActive } from './nativeViewportBridge';

type AxisIndex = 0 | 1 | 2;

interface Props {
  pivot: Point3Dto;
  orientation: [number, number, number, number];
  translation: [string, string, string];
  rotation: [string, string, string];
  disabled: boolean;
  onTranslationChange: (value: [string, string, string]) => void;
  onRotationChange: (value: [string, string, string]) => void;
  onInteractionChange: (value: MoveCopyGizmoInteraction | null) => void;
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
const DIAGONAL = Math.SQRT1_2;
const RING_RADIALS: Array<[number, number, number]> = [
  [0, DIAGONAL, DIAGONAL],
  [DIAGONAL, 0, DIAGONAL],
  [DIAGONAL, DIAGONAL, 0],
];
const AXIS_NAMES = ['X', 'Y', 'Z'] as const;

function compact(value: number) {
  if (Math.abs(value) < 0.005) return '0';
  return value.toFixed(2).replace(/\.?0+$/, '');
}

function rotateVector(
  value: [number, number, number],
  quaternion: [number, number, number, number],
): [number, number, number] {
  const [x, y, z, w] = quaternion;
  const [vx, vy, vz] = value;
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [
    vx + w * tx + (y * tz - z * ty),
    vy + w * ty + (z * tx - x * tz),
    vz + w * tz + (x * ty - y * tx),
  ];
}

function quaternionFromEulerDegrees(
  values: [number, number, number],
): [number, number, number, number] {
  const [x, y, z] = values.map((value) => (value * Math.PI) / 360);
  const [sx, sy, sz] = [Math.sin(x), Math.sin(y), Math.sin(z)];
  const [cx, cy, cz] = [Math.cos(x), Math.cos(y), Math.cos(z)];
  return [
    sx * cy * cz - cx * sy * sz,
    cx * sy * cz + sx * cy * sz,
    cx * cy * sz - sx * sy * cz,
    cx * cy * cz + sx * sy * sz,
  ];
}

function eulerDegreesFromQuaternion(
  quaternion: [number, number, number, number],
): [number, number, number] {
  const [x, y, z, w] = quaternion;
  const sinXCosY = 2 * (w * x + y * z);
  const cosXCosY = 1 - 2 * (x * x + y * y);
  const sinY = 2 * (w * y - z * x);
  const sinZCosY = 2 * (w * z + x * y);
  const cosZCosY = 1 - 2 * (y * y + z * z);
  const degrees = 180 / Math.PI;
  return [
    Math.atan2(sinXCosY, cosXCosY) * degrees,
    (Math.abs(sinY) >= 1 ? Math.sign(sinY) * Math.PI / 2 : Math.asin(sinY)) * degrees,
    Math.atan2(sinZCosY, cosZCosY) * degrees,
  ];
}

function multiplyQuaternion(
  a: [number, number, number, number],
  b: [number, number, number, number],
): [number, number, number, number] {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

function axisAngleQuaternion(
  axis: AxisIndex,
  degrees: number,
): [number, number, number, number] {
  const half = (degrees * Math.PI) / 360;
  const sine = Math.sin(half);
  const vector = AXES[axis];
  return [vector[0] * sine, vector[1] * sine, vector[2] * sine, Math.cos(half)];
}

/**
 * Six independent native gizmo degrees of freedom: three translation arrows
 * and three rotation rings. Invisible DOM targets only bridge pointer drags;
 * all visible viewport pixels are original Bevy geometry.
 */
export function MoveCopyManipulator({
  pivot,
  orientation,
  translation,
  rotation,
  disabled,
  onTranslationChange,
  onRotationChange,
  onInteractionChange,
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
        startQuaternion: [number, number, number, number];
      }
    | null
  >(null);
  const displayedPivot: [number, number, number] = [
    pivot.x,
    pivot.y,
    pivot.z,
  ];

  useEffect(() => () => onInteractionChange(null), [onInteractionChange]);

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
      const axisSamples = AXES.map((localAxis) => {
        const axis = rotateVector(localAxis, orientation);
        const point = api.worldToScreen([
          displayedPivot[0] + axis[0],
          displayedPivot[1] + axis[1],
          displayedPivot[2] + axis[2],
        ]);
        return {
          axis,
          pixelsPerMm: point ? Math.hypot(point.x - center.x, point.y - center.y) : 0,
        };
      });
      // Perspective projection is locally an orthogonal 2x3 basis. The
      // Frobenius norm therefore recovers the common pixel/mm scale at the
      // pivot regardless of gizmo orientation. Use the same 96 px world
      // length as the Bevy primitive so DOM hit targets land on the pixels the
      // user can actually see, including when the part is away from the orbit
      // target or an axis is foreshortened.
      const pixelsPerWorld = Math.max(
        0.1,
        Math.sqrt(
          axisSamples.reduce((sum, sample) => sum + sample.pixelsPerMm ** 2, 0) / 2,
        ),
      );
      const worldLength = Math.max(6, 96 / pixelsPerWorld);
      const ringRadius = worldLength * 0.62;
      for (let index = 0 as AxisIndex; index < 3; index = (index + 1) as AxisIndex) {
        const { axis, pixelsPerMm } = axisSamples[index];
        const translate = translateRefs.current[index];
        const rotate = rotateRefs.current[index];
        if (!translate || !rotate) continue;
        const endpoint = api.worldToScreen([
          displayedPivot[0] + axis[0] * worldLength,
          displayedPivot[1] + axis[1] * worldLength,
          displayedPivot[2] + axis[2] * worldLength,
        ]);
        let dx = endpoint ? endpoint.x - center.x : 0;
        let dy = endpoint ? endpoint.y - center.y : 0;
        let screenLength = Math.hypot(dx, dy);
        if (screenLength < 0.1 || pixelsPerMm < 0.1) {
          const fallbacks = [
            { x: 1, y: 0 },
            { x: 0.45, y: -0.9 },
            { x: 0, y: -1 },
          ];
          dx = fallbacks[index].x;
          dy = fallbacks[index].y;
          screenLength = 24;
        } else {
          dx /= screenLength;
          dy /= screenLength;
        }
        projectedRef.current[index] = {
          x: center.x + dx * screenLength,
          y: center.y + dy * screenLength,
          unitX: dx,
          unitY: dy,
          pixelsPerMm: Math.max(0.1, pixelsPerMm),
        };
        // Cover the visible shaft and head, not merely a small square at its
        // mathematical endpoint. Starting away from the shared pivot avoids
        // three overlapping axis hit targets.
        const activeStart = Math.min(16, screenLength * 0.25);
        const activeEnd = screenLength + 12;
        const activeCenter = (activeStart + activeEnd) / 2;
        translate.style.left = `${(center.x + dx * activeCenter).toFixed(2)}px`;
        translate.style.top = `${(center.y + dy * activeCenter).toFixed(2)}px`;
        translate.style.width = `${Math.max(90, activeEnd - activeStart).toFixed(2)}px`;
        translate.style.transform = `translate(-50%, -50%) rotate(${Math.atan2(dy, dx)}rad)`;
        translate.style.display = '';
        const radial = rotateVector(RING_RADIALS[index], orientation);
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
  }, [
    displayedPivot[0],
    displayedPivot[1],
    displayedPivot[2],
    orientation[0],
    orientation[1],
    orientation[2],
    orientation[3],
  ]);

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
    onInteractionChange({ kind: 'translate', axis, active: true });
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
      startQuaternion: quaternionFromEulerDegrees(rotation.map((value) => (
        Number.isFinite(Number(value)) ? Number(value) : 0
      )) as [number, number, number]),
    };
    onInteractionChange({ kind: 'rotate', axis, active: true });
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
    const deltaDegrees = pixels / projected.pixelsPerDegree;
    // Compose an incremental right-hand-rule rotation about the exact ring
    // axis shown in the viewport. Editing one Euler component directly only
    // matches that axis while every other component is zero; after an earlier
    // rotation it makes the part turn about a different, coupled axis.
    const quaternion = multiplyQuaternion(
      axisAngleQuaternion(active.axis, deltaDegrees),
      active.startQuaternion,
    );
    const next = eulerDegreesFromQuaternion(quaternion).map(compact) as [string, string, string];
    onRotationChange(next);
  };
  const endDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    onInteractionChange(null);
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
          onPointerEnter={() => {
            if (!dragRef.current) {
              onInteractionChange({
                kind: 'translate',
                axis: index as AxisIndex,
                active: false,
              });
            }
          }}
          onPointerLeave={() => {
            if (!dragRef.current) onInteractionChange(null);
          }}
          onPointerMove={drag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className="pointer-events-auto fixed z-[72] h-7 w-24 cursor-move touch-none opacity-0"
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
          onPointerEnter={() => {
            if (!dragRef.current) {
              onInteractionChange({
                kind: 'rotate',
                axis: index as AxisIndex,
                active: false,
              });
            }
          }}
          onPointerLeave={() => {
            if (!dragRef.current) onInteractionChange(null);
          }}
          onPointerMove={drag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className="pointer-events-auto fixed z-[72] h-6 w-6 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none opacity-0 active:cursor-grabbing"
        />
      ))}
    </>
  );
}
