import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  Boxes,
  Combine,
  Copy,
  LoaderCircle,
  PanelTop,
  RotateCw,
  Scissors,
  Shell,
  X,
} from 'lucide-react';
import { getEngine } from '../engine';
import { submitBodyFeature } from '../engine/controller';
import type {
  BodyFeatureDefinitionDto,
  BodyFeatureRequestDto,
  CombineOperation,
  PlaneRef,
  Point3Dto,
} from '../engine/types';
import { useAppStore, type BodyFeatureKind } from '../store/appStore';
import { DimensionInput } from './DimensionInput';

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

function VectorFields({
  label,
  values,
  onChange,
}: {
  label: string;
  values: [string, string, string];
  onChange: (values: [string, string, string]) => void;
}) {
  return (
    <fieldset>
      <legend className={LABEL}>{label}</legend>
      <div className="grid grid-cols-3 gap-2">
        {(['X', 'Y', 'Z'] as const).map((axis, index) => (
          <label key={axis}>
            <span className="mb-1 block text-[9px] text-mute">{axis}</span>
            <DimensionInput
              aria-label={`${label} ${axis}`}
              step="any"
              value={values[index]}
              onValueChange={(value) => {
                const next = [...values] as [string, string, string];
                next[index] = value;
                onChange(next);
              }}
            />
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const TITLES: Record<BodyFeatureKind, string> = {
  shell: 'Shell',
  mirror: 'Mirror',
  rectangular_pattern: 'Rectangular Pattern',
  circular_pattern: 'Circular Pattern',
  combine: 'Combine',
  split_body: 'Split Body',
};

const ICONS = {
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectionDialogKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!dialog) selectionDialogKeyRef.current = null;
  }, [dialog]);

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
          if (dialog.kind === 'shell') {
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
        if (edit.type === 'shell') {
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
  const valid =
    !loading &&
    !busy &&
    !error &&
    (kind === 'shell'
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

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    let request: BodyFeatureRequestDto;
    if (kind === 'shell') {
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
