import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  Boxes,
  Combine,
  Copy,
  LoaderCircle,
  Move3d,
  PanelTop,
  RotateCw,
  Scissors,
  Shell,
  X,
} from 'lucide-react';
import { getEngine } from '../engine';
import { submitBodyFeature } from '../engine/controller';
import type {
  AssemblyDocumentDto,
  AssemblySolutionDto,
  AssemblyTransformDto,
  BodyFeatureDefinitionDto,
  BodyFeatureRequestDto,
  CombineOperation,
  ComponentOccurrenceDto,
  PlaneRef,
  Point3Dto,
} from '../engine/types';
import {
  useAppStore,
  type BodyFeatureKind,
  type MoveCopyCommandPreview,
  type MoveCopyGizmoInteraction,
} from '../store/appStore';
import { DimensionInput } from './DimensionInput';
import { MoveCopyManipulator } from './viewport/MoveCopyManipulator';

const INPUT =
  'h-7 w-full rounded border border-edge bg-header px-2 text-xs text-ink outline-none focus:border-accent';
const LABEL =
  'mb-1 block text-[10px] font-semibold uppercase tracking-wide text-mute';

interface PlaneOption {
  value: string;
  label: string;
  reference: PlaneRef;
}

function planeValue(reference: PlaneRef): string {
  if (reference.type === 'origin_plane') return `origin:${reference.plane}`;
  if (reference.type === 'planar_face') return `face:${reference.face_id}`;
  return `datum:${reference.datum_id}`;
}

function optionReference(options: PlaneOption[], value: string): PlaneRef {
  return (
    options.find((option) => option.value === value)?.reference ?? {
      type: 'origin_plane',
      plane: 'xy',
    }
  );
}

function vector(x: string, y: string, z: string): Point3Dto {
  return { x: Number(x), y: Number(y), z: Number(z) };
}

function validVector(value: Point3Dto): boolean {
  return (
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    Number.isFinite(value.z) &&
    Math.hypot(value.x, value.y, value.z) > 1e-9
  );
}

type MoveObjectType = 'bodies' | 'component';
type MoveMode = 'free' | 'translate' | 'rotate' | 'point_to_point';

function finiteVector(value: Point3Dto): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
}

function selectionBoundsCenter(
  bodies: Array<{ id: number; mesh: { positions: number[] } }>,
  bodyIds: number[],
): Point3Dto {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const body of bodies) {
    if (!bodyIds.includes(body.id)) continue;
    for (let index = 0; index + 2 < body.mesh.positions.length; index += 3) {
      const x = body.mesh.positions[index];
      const y = body.mesh.positions[index + 1];
      const z = body.mesh.positions[index + 2];
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      maxZ = Math.max(maxZ, z);
    }
  }
  return Number.isFinite(minX)
    ? { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 }
    : { x: 0, y: 0, z: 0 };
}

function quaternionFromEulerDegrees(xDeg: number, yDeg: number, zDeg: number): [number, number, number, number] {
  const x = (xDeg * Math.PI) / 360;
  const y = (yDeg * Math.PI) / 360;
  const z = (zDeg * Math.PI) / 360;
  const sx = Math.sin(x);
  const cx = Math.cos(x);
  const sy = Math.sin(y);
  const cy = Math.cos(y);
  const sz = Math.sin(z);
  const cz = Math.cos(z);
  return [
    sx * cy * cz - cx * sy * sz,
    cx * sy * cz + sx * cy * sz,
    cx * cy * sz - sx * sy * cz,
    cx * cy * cz + sx * sy * sz,
  ];
}

function quaternionFromAxisAngle(axis: Point3Dto, degrees: number): [number, number, number, number] {
  const length = Math.hypot(axis.x, axis.y, axis.z) || 1;
  const half = (degrees * Math.PI) / 360;
  const scale = Math.sin(half) / length;
  return [axis.x * scale, axis.y * scale, axis.z * scale, Math.cos(half)];
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

function normalizeQuaternion(
  value: [number, number, number, number],
): [number, number, number, number] {
  const length = Math.hypot(...value);
  return length > 1e-12
    ? value.map((component) => component / length) as [number, number, number, number]
    : [0, 0, 0, 1];
}

function inverseQuaternion(
  value: [number, number, number, number],
): [number, number, number, number] {
  const normalized = normalizeQuaternion(value);
  return [-normalized[0], -normalized[1], -normalized[2], normalized[3]];
}

function rotateVector(value: [number, number, number], quaternion: [number, number, number, number]): [number, number, number] {
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

function componentPivot(
  bodies: Array<{ id: number; mesh: { positions: number[] } }>,
  bodyIds: number[],
  localCoordinateSystem: { translation: [number, number, number]; rotation: [number, number, number, number] },
  occurrencePose: { translation: [number, number, number]; rotation: [number, number, number, number] },
): Point3Dto {
  const bodyCenter = selectionBoundsCenter(bodies, bodyIds);
  const localOffset = rotateVector(
    [
      bodyCenter.x - localCoordinateSystem.translation[0],
      bodyCenter.y - localCoordinateSystem.translation[1],
      bodyCenter.z - localCoordinateSystem.translation[2],
    ],
    [-localCoordinateSystem.rotation[0], -localCoordinateSystem.rotation[1], -localCoordinateSystem.rotation[2], localCoordinateSystem.rotation[3]],
  );
  const displayed = rotateVector(localOffset, occurrencePose.rotation);
  return {
    x: occurrencePose.translation[0] + displayed[0],
    y: occurrencePose.translation[1] + displayed[1],
    z: occurrencePose.translation[2] + displayed[2],
  };
}

function occurrenceWorldPose(
  occurrence: ComponentOccurrenceDto,
  solution: AssemblySolutionDto,
): AssemblyTransformDto {
  const solved = solution.occurrence_poses.find(
    (pose) => pose.occurrence_id === occurrence.id,
  );
  return solved
    ? { translation: solved.translation, rotation: solved.rotation }
    : occurrence.local_pose;
}

function occurrenceIdsConnectedTo(
  assembly: AssemblyDocumentDto,
  occurrenceId: number,
): number[] {
  const adjacent = new Map<number, Set<number>>();
  const connect = (a: number, b: number) => {
    if (!adjacent.has(a)) adjacent.set(a, new Set());
    if (!adjacent.has(b)) adjacent.set(b, new Set());
    adjacent.get(a)!.add(b);
    adjacent.get(b)!.add(a);
  };
  for (const joint of assembly.joints) {
    if (!joint.enabled) continue;
    const a = joint.advanced.connector_a_occurrence_id;
    const b = joint.advanced.connector_b_occurrence_id;
    if (a !== null && b !== null) connect(a, b);
  }
  const result: number[] = [];
  const pending = [occurrenceId];
  const visited = new Set<number>();
  while (pending.length > 0) {
    const current = pending.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    result.push(current);
    for (const next of adjacent.get(current) ?? []) pending.push(next);
  }
  return result;
}

function placementAnchorOccurrenceId(
  assembly: AssemblyDocumentDto,
  occurrenceId: number,
): number {
  const occurrence = assembly.component_structure.occurrences.find(
    (candidate) => candidate.id === occurrenceId,
  );
  if (!occurrence) return occurrenceId;
  const connected = new Set(occurrenceIdsConnectedTo(assembly, occurrenceId));
  const siblings = assembly.component_structure.occurrences
    .filter((candidate) =>
      candidate.parent_occurrence_id === occurrence.parent_occurrence_id
        && connected.has(candidate.id),
    )
    .sort((a, b) => a.id - b.id);
  return siblings.find((candidate) => candidate.grounded)?.id
    ?? siblings[0]?.id
    ?? occurrenceId;
}

function smartMoveOccurrence(
  assembly: AssemblyDocumentDto,
  selectedOccurrenceId: number | null,
  selectedBodyIds: number[],
): ComponentOccurrenceDto | undefined {
  const definitionsById = new Map(
    assembly.component_structure.definitions.map((definition) => [definition.id, definition]),
  );
  const containsSelection = (occurrence: ComponentOccurrenceDto) => {
    const bodyIds = definitionsById.get(occurrence.component_id)?.body_ids ?? [];
    return selectedBodyIds.length > 0
      && selectedBodyIds.every((bodyId) => bodyIds.includes(bodyId));
  };
  const explicit = assembly.component_structure.occurrences.find(
    (candidate) => candidate.id === selectedOccurrenceId && containsSelection(candidate),
  );
  if (explicit) return explicit;
  if (selectedBodyIds.length !== 1) return undefined;
  const matches = assembly.component_structure.occurrences.filter(containsSelection);
  if (matches.length !== 1) return undefined;
  const candidate = matches[0];
  const jointConnected = assembly.joints.some((joint) => joint.enabled && (
    joint.advanced.connector_a_occurrence_id === candidate.id
      || joint.advanced.connector_b_occurrence_id === candidate.id
  ));
  // A plain unassembled body keeps part-history Move/Copy as its default.
  // Fixed and joint-connected bodies represent assembly placement intent.
  return candidate.grounded || jointConnected ? candidate : undefined;
}

function worldPoseToLocal(
  worldPose: AssemblyTransformDto,
  parentWorldPose: AssemblyTransformDto | null,
): AssemblyTransformDto {
  if (!parentWorldPose) {
    return {
      translation: worldPose.translation,
      rotation: normalizeQuaternion(worldPose.rotation),
    };
  }
  const inverseParentRotation = inverseQuaternion(parentWorldPose.rotation);
  return {
    translation: rotateVector([
      worldPose.translation[0] - parentWorldPose.translation[0],
      worldPose.translation[1] - parentWorldPose.translation[1],
      worldPose.translation[2] - parentWorldPose.translation[2],
    ], inverseParentRotation),
    rotation: normalizeQuaternion(
      multiplyQuaternion(inverseParentRotation, worldPose.rotation),
    ),
  };
}

function VectorFields({
  label,
  values,
  onChange,
  unit,
  autoSelectKey,
}: {
  label: string;
  values: [string, string, string];
  onChange: (values: [string, string, string]) => void;
  unit?: 'mm' | '°';
  autoSelectKey?: string | number | boolean | null;
}) {
  return (
    <fieldset>
      <legend className={LABEL}>{label}</legend>
      <div className="grid grid-cols-3 gap-2">
        {(['X', 'Y', 'Z'] as const).map((axis, index) => (
          <label key={axis}>
            <span className="mb-1 block text-[9px] text-mute">{axis}</span>
            <span className="relative block">
              <DimensionInput
                autoSelectKey={index === 0 ? autoSelectKey : null}
                aria-label={`${label} ${axis}`}
                step="any"
                value={values[index]}
                onValueChange={(value) => {
                  const next = [...values] as [string, string, string];
                  next[index] = value;
                  onChange(next);
                }}
                className={`h-7 w-full rounded border border-edge bg-header px-2 text-xs text-ink outline-none focus:border-accent ${
                  unit ? 'pr-8' : ''
                }`}
              />
              {unit && (
                <span className="pointer-events-none absolute right-5 top-1/2 -translate-y-1/2 text-[10px] text-mute">
                  {unit}
                </span>
              )}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function MoveCopyPreviewPublisher({
  preview,
}: {
  preview: MoveCopyCommandPreview | null;
}) {
  const setPreview = useAppStore((state) => state.setSolidCommandPreview);
  const latestPreview = useRef(preview);
  const frame = useRef<number | null>(null);
  useEffect(() => {
    latestPreview.current = preview;
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      setPreview(latestPreview.current);
    });
  }, [preview, setPreview]);
  useEffect(() => () => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    setPreview(null);
  }, [setPreview]);
  return null;
}

const TITLES: Record<BodyFeatureKind, string> = {
  move_copy: 'Move/Copy',
  shell: 'Shell',
  mirror: 'Mirror',
  rectangular_pattern: 'Rectangular Pattern',
  circular_pattern: 'Circular Pattern',
  combine: 'Combine',
  split_body: 'Split Body',
};

const ICONS = {
  move_copy: Move3d,
  shell: Shell,
  mirror: Copy,
  rectangular_pattern: Boxes,
  circular_pattern: RotateCw,
  combine: Combine,
  split_body: Scissors,
} satisfies Record<BodyFeatureKind, typeof PanelTop>;

export function BodyFeatureDialog() {
  const dialog = useAppStore((state) => state.bodyFeatureDialog);
  const close = useAppStore((state) => state.closeBodyFeatureDialog);
  const busy = useAppStore((state) => state.solidBusy);
  const bodies = useAppStore((state) => state.solidScene.bodies);
  const selectedBody = useAppStore((state) => state.selectedBody);
  const selectedBodies = useAppStore((state) => state.selectedBodies);
  const selectedFace = useAppStore((state) => state.selectedFace);
  const selectedFaces = useAppStore((state) => state.selectedFaces);
  const replaceSelectedBodies = useAppStore(
    (state) => state.replaceSelectedBodies,
  );
  const replaceSelectedFaces = useAppStore(
    (state) => state.replaceSelectedFaces,
  );
  const datumPlanes = useAppStore((state) => state.datumPlanes);
  const assembly = useAppStore((state) => state.assemblyDocument);
  const assemblySolution = useAppStore((state) => state.assemblySolution);
  const selectedOccurrenceId = useAppStore((state) => state.selectedOccurrenceId);
  const moveCopyOccurrence = useAppStore((state) => state.moveCopyOccurrence);
  const [definitions, setDefinitions] = useState<BodyFeatureDefinitionDto[]>([]);
  const [bodyId, setBodyId] = useState(0);
  const [bodyIds, setBodyIds] = useState<number[]>([]);
  const [faceIds, setFaceIds] = useState<number[]>([]);
  const [thickness, setThickness] = useState('2');
  const [inward, setInward] = useState(true);
  const [plane, setPlane] = useState('origin:yz');
  const [direction, setDirection] = useState<[string, string, string]>([
    '10',
    '0',
    '0',
  ]);
  const [spacing, setSpacing] = useState('10');
  const [count, setCount] = useState('3');
  const [secondEnabled, setSecondEnabled] = useState(false);
  const [secondDirection, setSecondDirection] = useState<
    [string, string, string]
  >(['0', '10', '0']);
  const [secondSpacing, setSecondSpacing] = useState('10');
  const [secondCount, setSecondCount] = useState('2');
  const [axisOrigin, setAxisOrigin] = useState<[string, string, string]>([
    '0',
    '0',
    '0',
  ]);
  const [axisDirection, setAxisDirection] = useState<
    [string, string, string]
  >(['0', '0', '1']);
  const [totalAngle, setTotalAngle] = useState('360');
  const [targetBodyId, setTargetBodyId] = useState(0);
  const [toolBodyIds, setToolBodyIds] = useState<number[]>([]);
  const [combineOperation, setCombineOperation] =
    useState<CombineOperation>('join');
  const [keepTools, setKeepTools] = useState(false);
  const [moveObjectType, setMoveObjectType] = useState<MoveObjectType>('bodies');
  const [moveMode, setMoveMode] = useState<MoveMode>('free');
  const [moveTranslation, setMoveTranslation] = useState<[string, string, string]>(['0', '0', '0']);
  const [moveRotation, setMoveRotation] = useState<[string, string, string]>(['0', '0', '0']);
  const [moveDirection, setMoveDirection] = useState<[string, string, string]>(['1', '0', '0']);
  const [moveDistance, setMoveDistance] = useState('10');
  const [moveAxis, setMoveAxis] = useState<[string, string, string]>(['0', '0', '1']);
  const [moveAngle, setMoveAngle] = useState('90');
  const [moveFrom, setMoveFrom] = useState<[string, string, string]>(['0', '0', '0']);
  const [moveTo, setMoveTo] = useState<[string, string, string]>(['10', '0', '0']);
  const [movePivot, setMovePivot] = useState<[string, string, string]>(['0', '0', '0']);
  const [moveCopy, setMoveCopy] = useState(false);
  const [moveGizmoInteraction, setMoveGizmoInteraction] =
    useState<MoveCopyGizmoInteraction | null>(null);
  const [occurrenceId, setOccurrenceId] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectionDialogKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!dialog) selectionDialogKeyRef.current = null;
  }, [dialog]);

  useEffect(() => {
    setMoveGizmoInteraction(null);
  }, [dialog?.kind, moveMode, moveObjectType]);

  const planeOptions = useMemo<PlaneOption[]>(() => {
    const result: PlaneOption[] = [
      {
        value: 'origin:xy',
        label: 'XY origin plane',
        reference: { type: 'origin_plane', plane: 'xy' },
      },
      {
        value: 'origin:xz',
        label: 'XZ origin plane',
        reference: { type: 'origin_plane', plane: 'xz' },
      },
      {
        value: 'origin:yz',
        label: 'YZ origin plane',
        reference: { type: 'origin_plane', plane: 'yz' },
      },
    ];
    for (const body of bodies) {
      body.faces.forEach((face, index) => {
        if (!face.plane) return;
        result.push({
          value: `face:${face.id}`,
          label: `${body.name} · planar face ${index + 1} (#${face.id})`,
          reference: { type: 'planar_face', face_id: face.id },
        });
      });
    }
    for (const datum of datumPlanes) {
      result.push({
        value: `datum:${datum.datum_id}`,
        label: datum.name,
        reference: { type: 'datum_plane', datum_id: datum.datum_id },
      });
    }
    return result;
  }, [bodies, datumPlanes]);

  useEffect(() => {
    if (!dialog) return;
    const dialogKey = `${dialog.kind}:${dialog.featureId}`;
    const initializeSelection = selectionDialogKeyRef.current !== dialogKey;
    if (initializeSelection) selectionDialogKeyRef.current = dialogKey;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void getEngine()
      .then(async (engine) => {
        const values = await engine.bodyFeatureDefinitions();
        if (cancelled) return;
        setDefinitions(values);
        const current = useAppStore.getState();
        const edit =
          dialog.featureId > 0
            ? values.find(
                (definition) =>
                  definition.feature_id === dialog.featureId &&
                  definition.type === dialog.kind,
              )
            : undefined;
        const fallbackBody =
          selectedBodies[selectedBodies.length - 1] ?? selectedBody ?? bodies[0]?.id ?? 0;
        const directlySelectedBodies =
          selectedBodies.length > 0
            ? selectedBodies.filter((id) => bodies.some((body) => body.id === id))
            : fallbackBody > 0
              ? [fallbackBody]
              : [];
        const directlySelectedFaces = selectedFaces.filter((faceId) =>
          bodies
            .find((body) => body.id === fallbackBody)
            ?.faces.some((face) => face.id === faceId),
        );
        const defaultToolBodyIds =
          directlySelectedBodies.length > 1
            ? directlySelectedBodies.slice(1)
            : initializeSelection && bodies.find((body) => body.id !== fallbackBody)
              ? [bodies.find((body) => body.id !== fallbackBody)!.id]
              : [];
        const syncBodies = (ids: number[]) => {
          if (current.selectedBodies.join(',') !== ids.join(',')) {
            current.replaceSelectedBodies(ids);
          }
        };
        const syncFaces = (ownerBodyId: number, ids: number[]) => {
          if (
            current.selectedBodies.join(',') !== String(ownerBodyId)
            || current.selectedFaces.join(',') !== ids.join(',')
          ) {
            current.replaceSelectedFaces(ownerBodyId, ids);
          }
        };
        const selectedPlane =
          selectedFace !== null &&
          bodies.some((body) =>
            body.faces.some((face) => face.id === selectedFace && face.plane !== null),
          )
            ? `face:${selectedFace}`
            : null;
        setBodyId(fallbackBody);
        setBodyIds(directlySelectedBodies);
        setTargetBodyId(directlySelectedBodies[0] ?? fallbackBody);
        setToolBodyIds(defaultToolBodyIds);
        setFaceIds(
          directlySelectedFaces.length > 0
            ? directlySelectedFaces
            : selectedFace !== null &&
                bodies
                  .find((body) => body.id === fallbackBody)
                  ?.faces.some((face) => face.id === selectedFace)
              ? [selectedFace]
              : [],
        );
        if (
          selectedPlane &&
          (dialog.kind === 'mirror' || dialog.kind === 'split_body')
        ) {
          setPlane(selectedPlane);
        }
        if (!edit) {
          if (dialog.kind === 'move_copy') {
            if (initializeSelection) {
              setMoveMode('free');
              setMoveTranslation(['0', '0', '0']);
              setMoveRotation(['0', '0', '0']);
              setMoveDirection(['1', '0', '0']);
              setMoveDistance('10');
              setMoveAxis(['0', '0', '1']);
              setMoveAngle('90');
              setMoveFrom(['0', '0', '0']);
              setMoveTo(['10', '0', '0']);
              setMoveCopy(false);
              setMoveGizmoInteraction(null);
            }
            const occurrence = smartMoveOccurrence(
              assembly,
              selectedOccurrenceId,
              directlySelectedBodies,
            );
            setMoveObjectType(occurrence ? 'component' : 'bodies');
            setOccurrenceId(
              occurrence?.id ?? assembly.component_structure.occurrences[0]?.id ?? 0,
            );
            if (initializeSelection && occurrence && selectedOccurrenceId !== occurrence.id) {
              current.setSelectedOccurrenceId(occurrence.id);
            }
            const centerIds = occurrence
              ? assembly.component_structure.definitions.find(
                  (definition) => definition.id === occurrence.component_id,
                )?.body_ids ?? []
              : directlySelectedBodies;
            const component = occurrence
              ? assembly.component_structure.definitions.find(
                  (definition) => definition.id === occurrence.component_id,
                )
              : undefined;
            const worldPose = occurrence
              ? occurrenceWorldPose(occurrence, assemblySolution)
              : null;
            const center = occurrence && component
              ? componentPivot(
                  bodies,
                  centerIds,
                  component.local_coordinate_system,
                  worldPose ?? occurrence.local_pose,
                )
              : selectionBoundsCenter(bodies, centerIds);
            setMovePivot([String(center.x), String(center.y), String(center.z)]);
            syncBodies(occurrence ? centerIds : directlySelectedBodies);
          } else if (dialog.kind === 'shell') {
            syncFaces(fallbackBody, directlySelectedFaces);
          } else if (dialog.kind === 'combine') {
            syncBodies([
              directlySelectedBodies[0] ?? fallbackBody,
              ...defaultToolBodyIds,
            ]);
          } else if (dialog.kind === 'split_body') {
            syncBodies([fallbackBody]);
          } else {
            syncBodies(directlySelectedBodies);
          }
          return;
        }
        if (!initializeSelection) return;
        if (edit.type === 'move_copy') {
          setMoveObjectType('bodies');
          setBodyIds(edit.body_ids);
          syncBodies(edit.body_ids);
          setMoveMode('free');
          setMoveTranslation([
            String(edit.translation.x),
            String(edit.translation.y),
            String(edit.translation.z),
          ]);
          const rotation = eulerDegreesFromQuaternion(edit.rotation);
          setMoveRotation(rotation.map((value) => String(value)) as [string, string, string]);
          setMovePivot([String(edit.pivot.x), String(edit.pivot.y), String(edit.pivot.z)]);
          setMoveCopy(edit.copy);
        } else if (edit.type === 'shell') {
          setBodyId(edit.body_id);
          setFaceIds(edit.face_ids);
          setThickness(String(edit.thickness));
          setInward(edit.inward);
          syncFaces(edit.body_id, edit.face_ids);
        } else if (edit.type === 'mirror') {
          setBodyIds(edit.body_ids);
          setPlane(planeValue(edit.plane));
          syncBodies(edit.body_ids);
        } else if (edit.type === 'rectangular_pattern') {
          setBodyIds(edit.body_ids);
          syncBodies(edit.body_ids);
          setDirection([
            String(edit.direction.x),
            String(edit.direction.y),
            String(edit.direction.z),
          ]);
          setSpacing(String(edit.spacing));
          setCount(String(edit.count));
          setSecondEnabled(edit.second_direction !== null);
          if (edit.second_direction) {
            setSecondDirection([
              String(edit.second_direction.x),
              String(edit.second_direction.y),
              String(edit.second_direction.z),
            ]);
          }
          setSecondSpacing(String(edit.second_spacing));
          setSecondCount(String(edit.second_count));
        } else if (edit.type === 'circular_pattern') {
          setBodyIds(edit.body_ids);
          syncBodies(edit.body_ids);
          setAxisOrigin([
            String(edit.axis_origin.x),
            String(edit.axis_origin.y),
            String(edit.axis_origin.z),
          ]);
          setAxisDirection([
            String(edit.axis_direction.x),
            String(edit.axis_direction.y),
            String(edit.axis_direction.z),
          ]);
          setCount(String(edit.count));
          setTotalAngle(String(edit.total_angle_deg));
        } else if (edit.type === 'combine') {
          setTargetBodyId(edit.target_body_id);
          setToolBodyIds(edit.tool_body_ids);
          setCombineOperation(edit.operation);
          setKeepTools(edit.keep_tools);
          syncBodies([edit.target_body_id, ...edit.tool_body_ids]);
        } else if (edit.type === 'split_body') {
          setBodyId(edit.body_id);
          setPlane(planeValue(edit.plane));
          syncBodies([edit.body_id]);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? cause.message
              : 'Could not load body operations',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    bodies,
    dialog,
    selectedBodies,
    selectedBody,
    selectedFace,
    selectedFaces,
    assembly,
    assemblySolution,
    selectedOccurrenceId,
  ]);

  if (!dialog) return null;
  const edit = definitions.find(
    (definition) => definition.feature_id === dialog.featureId,
  );
  const body = bodies.find((candidate) => candidate.id === bodyId);
  const directionValue = vector(...direction);
  const secondDirectionValue = vector(...secondDirection);
  const axisOriginValue = vector(...axisOrigin);
  const axisDirectionValue = vector(...axisDirection);
  const thicknessValue = Number(thickness);
  const spacingValue = Number(spacing);
  const countValue = Number(count);
  const secondSpacingValue = Number(secondSpacing);
  const secondCountValue = Number(secondCount);
  const totalAngleValue = Number(totalAngle);
  const kind = dialog.kind;
  const freeTranslationValue = vector(...moveTranslation);
  const freeRotationValue = vector(...moveRotation);
  const moveDirectionValue = vector(...moveDirection);
  const moveAxisValue = vector(...moveAxis);
  const moveFromValue = vector(...moveFrom);
  const moveToValue = vector(...moveTo);
  const movePivotValue = vector(...movePivot);
  const moveDistanceValue = Number(moveDistance);
  const moveAngleValue = Number(moveAngle);
  const moveOccurrence = assembly.component_structure.occurrences.find(
    (candidate) => candidate.id === occurrenceId,
  );
  const moveOccurrenceCluster = moveOccurrence
    ? occurrenceIdsConnectedTo(assembly, moveOccurrence.id)
    : [];
  const moveOccurrenceAnchorId = moveOccurrence
    ? placementAnchorOccurrenceId(assembly, moveOccurrence.id)
    : 0;
  const constrainedNonAnchorMove = moveObjectType === 'component'
    && !moveCopy
    && moveOccurrenceCluster.length > 1
    && moveOccurrenceAnchorId !== occurrenceId;
  const moveTargetValid = moveObjectType === 'component'
    ? occurrenceId > 0 && !constrainedNonAnchorMove
    : bodyIds.length > 0;
  const moveValuesValid = finiteVector(movePivotValue) && (
    moveMode === 'free'
      ? finiteVector(freeTranslationValue) && finiteVector(freeRotationValue)
      : moveMode === 'translate'
        ? validVector(moveDirectionValue) && Number.isFinite(moveDistanceValue)
        : moveMode === 'rotate'
          ? validVector(moveAxisValue) && Number.isFinite(moveAngleValue)
          : finiteVector(moveFromValue) && finiteVector(moveToValue)
  );
  const valid =
    !loading &&
    !busy &&
    !error &&
    (kind === 'move_copy'
      ? moveTargetValid && moveValuesValid
      : kind === 'shell'
      ? bodyId > 0 &&
        faceIds.length > 0 &&
        Number.isFinite(thicknessValue) &&
        thicknessValue > 0
      : kind === 'mirror'
        ? bodyIds.length > 0
        : kind === 'rectangular_pattern'
          ? bodyIds.length > 0 &&
            validVector(directionValue) &&
            Number.isFinite(spacingValue) &&
            spacingValue !== 0 &&
            Number.isInteger(countValue) &&
            countValue >= 2 &&
            (!secondEnabled ||
              (validVector(secondDirectionValue) &&
                Number.isFinite(secondSpacingValue) &&
                secondSpacingValue !== 0 &&
                Number.isInteger(secondCountValue) &&
                secondCountValue >= 2))
          : kind === 'circular_pattern'
            ? bodyIds.length > 0 &&
              validVector(axisDirectionValue) &&
              Number.isFinite(axisOriginValue.x) &&
              Number.isFinite(axisOriginValue.y) &&
              Number.isFinite(axisOriginValue.z) &&
              Number.isInteger(countValue) &&
              countValue >= 2 &&
              Number.isFinite(totalAngleValue) &&
              totalAngleValue !== 0
            : kind === 'combine'
              ? targetBodyId > 0 &&
                toolBodyIds.length > 0 &&
                !toolBodyIds.includes(targetBodyId)
              : bodyId > 0);

  const toggleBody = (id: number) => {
    const next = bodyIds.includes(id)
      ? bodyIds.filter((candidate) => candidate !== id)
      : [...bodyIds, id];
    setBodyIds(next);
    replaceSelectedBodies(next);
  };
  const toggleFace = (id: number) => {
    const next = faceIds.includes(id)
      ? faceIds.filter((candidate) => candidate !== id)
      : [...faceIds, id];
    setFaceIds(next);
    replaceSelectedFaces(bodyId, next);
  };
  const toggleTool = (id: number) => {
    const next = toolBodyIds.includes(id)
      ? toolBodyIds.filter((candidate) => candidate !== id)
      : [...toolBodyIds, id];
    setToolBodyIds(next);
    replaceSelectedBodies([targetBodyId, ...next]);
  };
  const chooseShellBody = (id: number) => {
    setBodyId(id);
    setFaceIds([]);
    replaceSelectedBodies([id]);
  };
  const chooseTarget = (id: number) => {
    const nextTools = toolBodyIds.filter((candidate) => candidate !== id);
    setTargetBodyId(id);
    setToolBodyIds(nextTools);
    replaceSelectedBodies([id, ...nextTools]);
  };
  const chooseSplitBody = (id: number) => {
    setBodyId(id);
    replaceSelectedBodies([id]);
  };

  const resolveMove = () => {
    if (moveMode === 'free') {
      return {
        translation: freeTranslationValue,
        rotation: quaternionFromEulerDegrees(
          freeRotationValue.x,
          freeRotationValue.y,
          freeRotationValue.z,
        ),
      };
    }
    if (moveMode === 'translate') {
      const length = Math.hypot(
        moveDirectionValue.x,
        moveDirectionValue.y,
        moveDirectionValue.z,
      ) || 1;
      return {
        translation: {
          x: (moveDirectionValue.x / length) * moveDistanceValue,
          y: (moveDirectionValue.y / length) * moveDistanceValue,
          z: (moveDirectionValue.z / length) * moveDistanceValue,
        },
        rotation: [0, 0, 0, 1] as [number, number, number, number],
      };
    }
    if (moveMode === 'rotate') {
      return {
        translation: { x: 0, y: 0, z: 0 },
        rotation: quaternionFromAxisAngle(moveAxisValue, moveAngleValue),
      };
    }
    return {
      translation: {
        x: moveToValue.x - moveFromValue.x,
        y: moveToValue.y - moveFromValue.y,
        z: moveToValue.z - moveFromValue.z,
      },
      rotation: [0, 0, 0, 1] as [number, number, number, number],
    };
  };

  const movePreview = (() => {
    if (kind !== 'move_copy' || !moveTargetValid || !moveValuesValid) return null;
    const resolved = resolveMove();
    const targets: MoveCopyCommandPreview['targets'] = [];
    if (moveObjectType === 'component') {
      const previewOccurrenceIds = new Set(
        moveCopy ? [occurrenceId] : moveOccurrenceCluster,
      );
      targets.push(...assemblySolution.instance_body_poses
        .filter((pose) => previewOccurrenceIds.has(pose.occurrence_id))
        .map((pose) => ({
          bodyId: pose.body_id,
          occurrenceId: pose.occurrence_id,
          baseTranslation: pose.translation,
          baseRotation: pose.rotation,
        })));
    } else {
      for (const targetBodyId of bodyIds) {
        const instancePoses = assemblySolution.instance_body_poses.filter(
          (pose) => pose.body_id === targetBodyId,
        );
        if (instancePoses.length > 0) {
          targets.push(...instancePoses.map((pose) => ({
            bodyId: targetBodyId,
            occurrenceId: pose.occurrence_id,
            baseTranslation: pose.translation,
            baseRotation: pose.rotation,
          })));
          continue;
        }
        const pose = assemblySolution.body_poses.find(
          (candidate) => candidate.body_id === targetBodyId,
        );
        targets.push({
          bodyId: targetBodyId,
          occurrenceId: null,
          baseTranslation: pose?.translation ?? [0, 0, 0],
          baseRotation: pose?.rotation ?? [0, 0, 0, 1],
        });
      }
    }
    const transformInBodySpace = moveObjectType === 'bodies';
    let gizmoPivot = {
      x: movePivotValue.x + resolved.translation.x,
      y: movePivotValue.y + resolved.translation.y,
      z: movePivotValue.z + resolved.translation.z,
    };
    let gizmoOrientation: [number, number, number, number] = [0, 0, 0, 1];
    const displayTarget = targets[0];
    if (transformInBodySpace && displayTarget) {
      const [x, y, z] = rotateVector(
        [gizmoPivot.x, gizmoPivot.y, gizmoPivot.z],
        displayTarget.baseRotation,
      );
      gizmoPivot = {
        x: displayTarget.baseTranslation[0] + x,
        y: displayTarget.baseTranslation[1] + y,
        z: displayTarget.baseTranslation[2] + z,
      };
      gizmoOrientation = displayTarget.baseRotation;
    }
    return {
      kind: 'move_copy',
      targets,
      pivot: movePivotValue,
      translation: resolved.translation,
      rotation: resolved.rotation,
      copy: moveCopy,
      transformInBodySpace,
      showSixAxisGizmo: moveMode === 'free',
      gizmoPivot,
      gizmoOrientation,
      gizmoInteraction: moveGizmoInteraction,
    } satisfies MoveCopyCommandPreview;
  })();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    const resolvedMove = resolveMove();
    if (kind === 'move_copy' && moveObjectType === 'component') {
      const occurrence = moveOccurrence;
      if (!occurrence) return;
      const deltaRotation = resolvedMove.rotation;
      const currentWorldPose = occurrenceWorldPose(occurrence, assemblySolution);
      const [rotatedX, rotatedY, rotatedZ] = rotateVector(
        [
          currentWorldPose.translation[0] - movePivotValue.x,
          currentWorldPose.translation[1] - movePivotValue.y,
          currentWorldPose.translation[2] - movePivotValue.z,
        ],
        deltaRotation,
      );
      const desiredWorldPose: AssemblyTransformDto = {
        translation: [
          movePivotValue.x + rotatedX + resolvedMove.translation.x,
          movePivotValue.y + rotatedY + resolvedMove.translation.y,
          movePivotValue.z + rotatedZ + resolvedMove.translation.z,
        ] as [number, number, number],
        rotation: normalizeQuaternion(
          multiplyQuaternion(deltaRotation, currentWorldPose.rotation),
        ),
      };
      const parentOccurrence = occurrence.parent_occurrence_id === null
        ? null
        : assembly.component_structure.occurrences.find(
            (candidate) => candidate.id === occurrence.parent_occurrence_id,
          ) ?? null;
      const localPose = worldPoseToLocal(
        desiredWorldPose,
        parentOccurrence ? occurrenceWorldPose(parentOccurrence, assemblySolution) : null,
      );
      setError(null);
      setLoading(true);
      void moveCopyOccurrence(occurrence.id, localPose, moveCopy)
        .then(close)
        .catch((cause: unknown) => setError(
          cause instanceof Error ? cause.message : 'Component Move/Copy failed',
        ))
        .finally(() => setLoading(false));
      return;
    }
    let request: BodyFeatureRequestDto;
    if (kind === 'move_copy') {
      request = {
        type: 'move_copy',
        request: {
          body_ids: bodyIds,
          translation: resolvedMove.translation,
          rotation: resolvedMove.rotation,
          pivot: movePivotValue,
          copy: moveCopy,
        },
      };
    } else if (kind === 'shell') {
      request = {
        type: 'shell',
        request: {
          body_id: bodyId,
          face_ids: faceIds,
          thickness: thicknessValue,
          inward,
        },
      };
    } else if (kind === 'mirror') {
      request = {
        type: 'mirror',
        request: {
          body_ids: bodyIds,
          plane: optionReference(planeOptions, plane),
        },
      };
    } else if (kind === 'rectangular_pattern') {
      request = {
        type: 'rectangular_pattern',
        request: {
          body_ids: bodyIds,
          direction: directionValue,
          spacing: spacingValue,
          count: countValue,
          second_direction: secondEnabled ? secondDirectionValue : null,
          second_spacing: secondEnabled ? secondSpacingValue : 0,
          second_count: secondEnabled ? secondCountValue : 1,
        },
      };
    } else if (kind === 'circular_pattern') {
      request = {
        type: 'circular_pattern',
        request: {
          body_ids: bodyIds,
          axis_origin: axisOriginValue,
          axis_direction: axisDirectionValue,
          count: countValue,
          total_angle_deg: totalAngleValue,
        },
      };
    } else if (kind === 'combine') {
      request = {
        type: 'combine',
        request: {
          target_body_id: targetBodyId,
          tool_body_ids: toolBodyIds,
          operation: combineOperation,
          keep_tools: keepTools,
        },
      };
    } else {
      request = {
        type: 'split_body',
        request: {
          body_id: bodyId,
          plane: optionReference(planeOptions, plane),
        },
      };
    }
    void submitBodyFeature(
      request,
      dialog.featureId > 0 ? dialog.featureId : undefined,
    );
  };

  const Icon = ICONS[kind];
  const bodyChecklist = (
    <fieldset>
      <legend className={LABEL}>Bodies</legend>
      <div className="max-h-32 space-y-1 overflow-y-auto rounded border border-edge bg-header p-2">
        {bodies.map((candidate) => (
          <label
            key={candidate.id}
            className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs text-ink hover:bg-edge"
          >
            <input
              type="checkbox"
              checked={bodyIds.includes(candidate.id)}
              onChange={() => toggleBody(candidate.id)}
              className="accent-accent"
            />
            {candidate.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
  const planeField = (
    <label>
      <span className={LABEL}>Reference plane</span>
      <select
        value={plane}
        onChange={(event) => setPlane(event.target.value)}
        className={INPUT}
      >
        {planeOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div
      data-native-viewport-dim="0.15"
      className="pointer-events-none fixed inset-0 z-[70] bg-black/15"
    >
      {kind === 'move_copy' && (
        <MoveCopyPreviewPublisher preview={movePreview} />
      )}
      {kind === 'move_copy' && moveMode === 'free' && moveValuesValid && (
        <MoveCopyManipulator
          pivot={movePreview?.gizmoPivot ?? movePivotValue}
          orientation={movePreview?.gizmoOrientation ?? [0, 0, 0, 1]}
          translation={moveTranslation}
          rotation={moveRotation}
          disabled={!valid}
          onTranslationChange={setMoveTranslation}
          onRotationChange={setMoveRotation}
          onInteractionChange={setMoveGizmoInteraction}
        />
      )}
      <form
        data-testid="body-feature-dialog"
        onSubmit={submit}
        className="feature-dialog pointer-events-auto absolute right-5 top-[132px] flex max-h-[calc(100vh-190px)] w-80 flex-col overflow-hidden border border-edge bg-panel"
      >
        <header className="feature-dialog-header flex h-10 shrink-0 items-center gap-2 border-b border-edge px-3">
          <Icon size={15} className="text-accent" />
          <span className="flex-1 text-xs font-semibold text-ink">
            {dialog.featureId > 0 ? `Edit ${TITLES[kind]}` : TITLES[kind]}
          </span>
          <button
            type="button"
            onClick={close}
            disabled={busy}
            className="rounded p-1 text-mute hover:bg-edge hover:text-ink"
          >
            <X size={14} />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
          {loading ? (
            <p className="flex items-center gap-2 text-xs text-mute">
              <LoaderCircle size={14} className="animate-spin" />
              Loading definition…
            </p>
          ) : error ? (
            <p className="rounded border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-300">
              {error}
            </p>
          ) : bodies.length === 0 ? (
            <p className="text-xs text-mute">
              Create a solid body before using {TITLES[kind]}.
            </p>
          ) : kind === 'move_copy' ? (
            <>
              <fieldset>
                <legend className={LABEL}>Object type</legend>
                <div className="grid grid-cols-2 gap-2">
                  {(['bodies', 'component'] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      disabled={value === 'component' && assembly.component_structure.occurrences.length === 0}
                      onClick={() => setMoveObjectType(value)}
                      className={`h-8 rounded border text-xs font-medium ${
                        moveObjectType === value
                          ? 'border-accent bg-accent/15 text-accent'
                          : 'border-edge bg-header text-ink hover:bg-edge'
                      } disabled:opacity-40`}
                    >
                      {value === 'bodies' ? 'Bodies' : 'Component'}
                    </button>
                  ))}
                </div>
              </fieldset>
              {moveObjectType === 'bodies' ? bodyChecklist : (
                <label>
                  <span className={LABEL}>Component occurrence</span>
                  <select
                    value={occurrenceId}
                    onChange={(event) => {
                      const id = Number(event.target.value);
                      setOccurrenceId(id);
                      const occurrence = assembly.component_structure.occurrences.find(
                        (candidate) => candidate.id === id,
                      );
                      const component = assembly.component_structure.definitions.find(
                        (definition) => definition.id === occurrence?.component_id,
                      );
                      const ids = component?.body_ids ?? [];
                      const center = occurrence && component
                        ? componentPivot(
                            bodies,
                            ids,
                            component.local_coordinate_system,
                            occurrenceWorldPose(occurrence, assemblySolution),
                          )
                        : selectionBoundsCenter(bodies, ids);
                      setMovePivot([String(center.x), String(center.y), String(center.z)]);
                    }}
                    className={INPUT}
                  >
                    {assembly.component_structure.occurrences.map((occurrence) => (
                      <option key={occurrence.id} value={occurrence.id}>
                        {occurrence.name}
                      </option>
                    ))}
                  </select>
                  {moveOccurrenceCluster.length > 1 && moveOccurrenceAnchorId === occurrenceId && (
                    <span className="mt-1 block text-[10px] leading-4 text-mute">
                      This is the mechanism anchor. Move/Copy keeps all {moveOccurrenceCluster.length} connected components together.
                    </span>
                  )}
                  {constrainedNonAnchorMove && (
                    <span className="mt-1 block rounded border border-warn/40 bg-warn/10 p-2 text-[10px] leading-4 text-warn">
                      This component is constrained by the mechanism. Move the anchored component or use joint motion dragging instead.
                    </span>
                  )}
                </label>
              )}
              {moveObjectType === 'bodies' && (() => {
                const candidate = smartMoveOccurrence(assembly, null, bodyIds);
                return candidate ? (
                  <p className="rounded border border-warn/40 bg-warn/10 p-2 text-[10px] leading-4 text-warn">
                    Bodies edits the part geometry used by every occurrence. Choose Component to reposition this fixed or joint-connected part without changing its feature history.
                  </p>
                ) : null;
              })()}
              <label>
                <span className={LABEL}>Move type</span>
                <select
                  value={moveMode}
                  onChange={(event) => setMoveMode(event.target.value as MoveMode)}
                  className={INPUT}
                >
                  <option value="free">Free move — XYZ + XYZ rotation</option>
                  <option value="translate">Translate — direction and distance</option>
                  <option value="rotate">Rotate — axis and angle</option>
                  <option value="point_to_point">Point to point</option>
                </select>
              </label>
              {moveMode === 'free' ? (
                <>
                  <VectorFields
                    label="Translation"
                    unit="mm"
                    values={moveTranslation}
                    onChange={setMoveTranslation}
                    autoSelectKey={moveObjectType === 'component'
                      ? `component:${occurrenceId}`
                      : bodyIds.length > 0 ? `bodies:${bodyIds.join(',')}` : null}
                  />
                  <VectorFields label="Rotation" unit="°" values={moveRotation} onChange={setMoveRotation} />
                </>
              ) : moveMode === 'translate' ? (
                <>
                  <VectorFields label="Direction" values={moveDirection} onChange={setMoveDirection} />
                  <label>
                    <span className={LABEL}>Distance (mm)</span>
                    <DimensionInput autoSelectKey={bodyIds.length > 0 ? bodyIds.join(',') : null} step="any" value={moveDistance} onValueChange={setMoveDistance} />
                  </label>
                </>
              ) : moveMode === 'rotate' ? (
                <>
                  <VectorFields label="Axis" values={moveAxis} onChange={setMoveAxis} />
                  <label>
                    <span className={LABEL}>Angle (degrees)</span>
                    <span className="relative block">
                      <DimensionInput
                        autoSelectKey={bodyIds.length > 0 ? bodyIds.join(',') : null}
                        step="any"
                        value={moveAngle}
                        onValueChange={setMoveAngle}
                        className="h-7 w-full rounded border border-edge bg-header px-2 pr-8 text-xs text-ink outline-none focus:border-accent"
                      />
                      <span className="pointer-events-none absolute right-5 top-1/2 -translate-y-1/2 text-[10px] text-mute">°</span>
                    </span>
                  </label>
                </>
              ) : (
                <>
                  <VectorFields label="From point" unit="mm" values={moveFrom} onChange={setMoveFrom} />
                  <VectorFields label="To point" unit="mm" values={moveTo} onChange={setMoveTo} />
                </>
              )}
              {(moveMode === 'free' || moveMode === 'rotate') && (
                <VectorFields label="Rotation pivot" unit="mm" values={movePivot} onChange={setMovePivot} />
              )}
              <label className="flex cursor-pointer items-start gap-2 rounded border border-edge bg-header p-2 text-xs text-ink">
                <input
                  type="checkbox"
                  checked={moveCopy}
                  disabled={dialog.featureId > 0}
                  onChange={(event) => setMoveCopy(event.target.checked)}
                  className="mt-0.5 accent-accent"
                />
                <span>
                  <strong>Create copy</strong>
                  <span className="mt-0.5 block text-[10px] leading-4 text-mute">
                    {moveObjectType === 'component'
                      ? 'Creates a linked occurrence of the same component definition.'
                      : 'Creates independent body geometry with its own stable body identity.'}
                  </span>
                </span>
              </label>
            </>
          ) : kind === 'shell' ? (
            <>
              <label>
                <span className={LABEL}>Body</span>
                <select
                  value={bodyId}
                  onChange={(event) => chooseShellBody(Number(event.target.value))}
                  className={INPUT}
                >
                  {bodies.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </option>
                  ))}
                </select>
              </label>
              <fieldset>
                <legend className={LABEL}>Faces to remove</legend>
                <div className="max-h-36 space-y-1 overflow-y-auto rounded border border-edge bg-header p-2">
                  {body?.faces.map((face, index) => (
                    <label
                      key={face.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs text-ink hover:bg-edge"
                    >
                      <input
                        type="checkbox"
                        checked={faceIds.includes(face.id)}
                        onChange={() => toggleFace(face.id)}
                        className="accent-accent"
                      />
                      Face {index + 1} (#{face.id})
                    </label>
                  ))}
                </div>
              </fieldset>
              <label>
                <span className={LABEL}>Wall thickness (mm)</span>
                <DimensionInput
                  autoSelectKey={faceIds.length > 0 ? `${bodyId}:${faceIds.join(',')}` : null}
                  min="0.000001"
                  step="any"
                  value={thickness}
                  onValueChange={setThickness}
                />
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-ink">
                <input
                  type="checkbox"
                  checked={inward}
                  onChange={(event) => setInward(event.target.checked)}
                  className="accent-accent"
                />
                Offset walls inward
              </label>
            </>
          ) : kind === 'mirror' ? (
            <>
              {bodyChecklist}
              {planeField}
            </>
          ) : kind === 'rectangular_pattern' ? (
            <>
              {bodyChecklist}
              <VectorFields
                label="First direction"
                values={direction}
                onChange={setDirection}
              />
              <div className="grid grid-cols-2 gap-2">
                <label>
                  <span className={LABEL}>Spacing (mm)</span>
                  <DimensionInput
                    autoSelectKey={bodyIds.length > 0 ? bodyIds.join(',') : null}
                    step="any"
                    value={spacing}
                    onValueChange={setSpacing}
                  />
                </label>
                <label>
                  <span className={LABEL}>Count</span>
                  <DimensionInput
                    min="2"
                    step="1"
                    value={count}
                    onValueChange={setCount}
                  />
                </label>
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-ink">
                <input
                  type="checkbox"
                  checked={secondEnabled}
                  onChange={(event) => setSecondEnabled(event.target.checked)}
                  className="accent-accent"
                />
                Add a second direction
              </label>
              {secondEnabled && (
                <>
                  <VectorFields
                    label="Second direction"
                    values={secondDirection}
                    onChange={setSecondDirection}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <label>
                      <span className={LABEL}>Spacing (mm)</span>
                      <DimensionInput
                        step="any"
                        value={secondSpacing}
                        onValueChange={setSecondSpacing}
                      />
                    </label>
                    <label>
                      <span className={LABEL}>Count</span>
                      <DimensionInput
                        min="2"
                        step="1"
                        value={secondCount}
                        onValueChange={setSecondCount}
                      />
                    </label>
                  </div>
                </>
              )}
            </>
          ) : kind === 'circular_pattern' ? (
            <>
              {bodyChecklist}
              <VectorFields
                label="Axis origin"
                values={axisOrigin}
                onChange={setAxisOrigin}
              />
              <VectorFields
                label="Axis direction"
                values={axisDirection}
                onChange={setAxisDirection}
              />
              <div className="grid grid-cols-2 gap-2">
                <label>
                  <span className={LABEL}>Count</span>
                  <DimensionInput
                    autoSelectKey={bodyIds.length > 0 ? bodyIds.join(',') : null}
                    min="2"
                    step="1"
                    value={count}
                    onValueChange={setCount}
                  />
                </label>
                <label>
                  <span className={LABEL}>Total angle (degrees)</span>
                  <DimensionInput
                    step="any"
                    value={totalAngle}
                    onValueChange={setTotalAngle}
                  />
                </label>
              </div>
            </>
          ) : kind === 'combine' ? (
            <>
              <label>
                <span className={LABEL}>Target body</span>
                <select
                  value={targetBodyId}
                  onChange={(event) => chooseTarget(Number(event.target.value))}
                  className={INPUT}
                >
                  {bodies.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </option>
                  ))}
                </select>
              </label>
              <fieldset>
                <legend className={LABEL}>Tool bodies</legend>
                <div className="max-h-32 space-y-1 overflow-y-auto rounded border border-edge bg-header p-2">
                  {bodies
                    .filter((candidate) => candidate.id !== targetBodyId)
                    .map((candidate) => (
                      <label
                        key={candidate.id}
                        className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs text-ink hover:bg-edge"
                      >
                        <input
                          type="checkbox"
                          checked={toolBodyIds.includes(candidate.id)}
                          onChange={() => toggleTool(candidate.id)}
                          className="accent-accent"
                        />
                        {candidate.name}
                      </label>
                    ))}
                </div>
              </fieldset>
              <label>
                <span className={LABEL}>Operation</span>
                <select
                  value={combineOperation}
                  onChange={(event) =>
                    setCombineOperation(event.target.value as CombineOperation)
                  }
                  className={INPUT}
                >
                  <option value="join">Add</option>
                  <option value="cut">Subtract</option>
                  <option value="intersect">Common</option>
                </select>
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-ink">
                <input
                  type="checkbox"
                  checked={keepTools}
                  onChange={(event) => setKeepTools(event.target.checked)}
                  className="accent-accent"
                />
                Keep tool bodies
              </label>
            </>
          ) : (
            <>
              <label>
                <span className={LABEL}>Body to split</span>
                <select
                  value={bodyId}
                  onChange={(event) =>
                    chooseSplitBody(Number(event.target.value))
                  }
                  className={INPUT}
                >
                  {bodies.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </option>
                  ))}
                </select>
              </label>
              {planeField}
            </>
          )}
          {edit && edit.type !== kind && (
            <p className="text-xs text-red-300">
              This timeline feature does not match the requested operation.
            </p>
          )}
        </div>

        <footer className="flex h-11 shrink-0 items-center justify-end gap-2 border-t border-edge bg-header px-3">
          <button
            type="button"
            onClick={close}
            disabled={busy}
            className="h-7 rounded border border-edge px-3 text-xs text-ink hover:bg-edge"
          >
            Cancel
          </button>
          <button
            data-testid="body-feature-ok"
            type="submit"
            disabled={!valid}
            className="h-7 rounded bg-accent px-3 text-xs font-semibold text-white disabled:opacity-40"
          >
            OK
          </button>
        </footer>
      </form>
    </div>
  );
}
