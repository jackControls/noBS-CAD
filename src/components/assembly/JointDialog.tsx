import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Crosshair, Link2, MousePointer2, RotateCw, Wrench, X } from 'lucide-react';
import {
  DEFAULT_JOINT_ADVANCED,
  type CreateJointRequestDto,
  type EdgeDto,
  type FaceDto,
  type JointAdvancedDto,
  type JointConnectorDto,
  type JointDefinitionDto,
  type JointKindDto,
  type JointLimitsDto,
  type UpdateJointRequestDto,
} from '../../engine/types';
import { useTranslation } from '../../i18n';
import { useAppStore } from '../../store/appStore';

const INPUT =
  'h-8 w-full rounded border border-edge bg-header px-2 text-xs text-ink outline-none focus:border-accent';
const LABEL = 'mb-1 block text-[10px] font-semibold uppercase tracking-wide text-mute';

interface ConnectorSelection {
  bodyId: number;
  bodyName: string;
  face?: FaceDto;
  faceIndex?: number;
  edge?: EdgeDto;
  edgeIndex?: number;
  connector: JointConnectorDto;
}

interface CoordinateFieldState {
  value: string;
  limited: boolean;
  minimum: string;
  maximum: string;
}

interface JointFormState {
  name: string;
  kind: JointKindDto;
  flipped: boolean;
  primaryAngle: CoordinateFieldState;
  primaryLinear: CoordinateFieldState;
  secondaryAngle: CoordinateFieldState;
  tertiaryAngle: CoordinateFieldState;
  secondaryLinear: CoordinateFieldState;
  screwPitch: string;
  connectorATwist: string;
  connectorBTwist: string;
}

const coordinate = (
  value = 0,
  limits: JointLimitsDto | null = null,
  fallbackMinimum = -90,
  fallbackMaximum = 90,
): CoordinateFieldState => ({
  value: String(value),
  limited: limits !== null,
  minimum: String(limits?.min ?? fallbackMinimum),
  maximum: String(limits?.max ?? fallbackMaximum),
});

function newJointForm(nextJointId: number): JointFormState {
  return {
    name: `Joint${nextJointId}`,
    kind: 'rigid',
    // The solver's flipped branch aligns connector frame directions. It is
    // the least-surprising default for joint origins because it preserves the
    // authored orientation; users can still choose the opposing-normal mate.
    flipped: true,
    primaryAngle: coordinate(),
    primaryLinear: coordinate(0, null, -25, 25),
    secondaryAngle: coordinate(),
    tertiaryAngle: coordinate(),
    secondaryLinear: coordinate(0, null, -25, 25),
    screwPitch: '1',
    connectorATwist: '0',
    connectorBTwist: '0',
  };
}

function formFromJoint(joint: JointDefinitionDto): JointFormState {
  return {
    name: joint.name,
    kind: joint.kind,
    flipped: joint.flipped,
    primaryAngle: coordinate(
      joint.angle_offset_deg,
      joint.angle_limits ?? (joint.kind === 'revolute' || joint.kind === 'screw' ? joint.limits : null),
    ),
    primaryLinear: coordinate(
      joint.linear_offset_mm,
      joint.linear_limits ?? (joint.kind === 'slider' ? joint.limits : null),
      -25,
      25,
    ),
    secondaryAngle: coordinate(
      joint.advanced.secondary_angle_offset_deg,
      joint.advanced.secondary_angle_limits,
    ),
    tertiaryAngle: coordinate(
      joint.advanced.tertiary_angle_offset_deg,
      joint.advanced.tertiary_angle_limits,
    ),
    secondaryLinear: coordinate(
      joint.advanced.secondary_linear_offset_mm,
      joint.advanced.secondary_linear_limits,
      -25,
      25,
    ),
    screwPitch: String(joint.advanced.screw_pitch_mm_per_revolution),
    connectorATwist: String(joint.advanced.connector_a_twist_deg),
    connectorBTwist: String(joint.advanced.connector_b_twist_deg),
  };
}

export function JointDialog() {
  const { t } = useTranslation();
  const open = useAppStore((state) => state.jointDialogOpen);
  const editingId = useAppStore((state) => state.jointEditingId);
  const assembly = useAppStore((state) => state.assemblyDocument);
  const close = useAppStore((state) => state.setJointDialogOpen);
  const connectorPicks = useAppStore((state) => state.jointConnectorPicks);
  const bodies = useAppStore((state) => state.solidScene.bodies);
  const nextJointId = assembly.next_joint_id;
  const createJoint = useAppStore((state) => state.createJoint);
  const updateJoint = useAppStore((state) => state.updateJoint);
  const previewJoint = useAppStore((state) => state.previewJoint);
  const previewJointUpdate = useAppStore((state) => state.previewJointUpdate);
  const clearJointPreview = useAppStore((state) => state.clearJointPreview);
  const clearSelection = useAppStore((state) => state.clearJointConnectorPicks);
  const editingJoint = assembly.joints.find((joint) => joint.id === editingId) ?? null;
  const [form, setForm] = useState<JointFormState>(() => newJointForm(nextJointId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groundedSide, setGroundedSide] = useState<0 | 1 | null>(0);
  const [groundChanged, setGroundChanged] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(editingJoint ? formFromJoint(editingJoint) : newJointForm(nextJointId));
    setError(null);
    setGroundChanged(false);
  }, [editingJoint, nextJointId, open]);

  const selections = useMemo(() => {
    const result: ConnectorSelection[] = [];
    for (const connector of connectorPicks) {
      const body = bodies.find((candidate) => candidate.id === connector.body_id);
      const faceIndex = body?.faces.findIndex((face) => face.id === connector.face_id) ?? -1;
      const face = faceIndex >= 0 ? body?.faces[faceIndex] : undefined;
      const edgeIndex = connector.edge_id
        ? body?.edges.findIndex((edge) => edge.id === connector.edge_id) ?? -1
        : -1;
      const edge = edgeIndex >= 0 ? body?.edges[edgeIndex] : undefined;
      if (body && (face || edge)) {
        result.push({
          bodyId: body.id,
          bodyName: body.name,
          face,
          faceIndex: face ? faceIndex : undefined,
          edge,
          edgeIndex: edge ? edgeIndex : undefined,
          connector,
        });
      }
    }
    return result;
  }, [bodies, connectorPicks]);

  const validSelection = selections.length === 2 && (
    selections[0].connector.occurrence_id !== null
    && selections[0].connector.occurrence_id !== undefined
    && selections[1].connector.occurrence_id !== null
    && selections[1].connector.occurrence_id !== undefined
      ? selections[0].connector.occurrence_id !== selections[1].connector.occurrence_id
      : selections[0].bodyId !== selections[1].bodyId
  );
  const connectorParentId = selections[0]?.connector.occurrence_id == null
    ? undefined
    : assembly.component_structure.occurrences.find(
      (occurrence) => occurrence.id === selections[0].connector.occurrence_id,
    )?.parent_occurrence_id;
  const existingGroundedOccurrence = assembly.component_structure.occurrences.find(
    (occurrence) => occurrence.grounded
      && (connectorParentId === undefined || occurrence.parent_occurrence_id === connectorParentId),
  ) ?? null;

  useEffect(() => {
    if (!open || groundChanged) return;
    if (selections.length !== 2) {
      setGroundedSide(existingGroundedOccurrence ? null : 0);
      return;
    }
    const groundedIndex = selections.findIndex(
      (selection) => selection.connector.occurrence_id === existingGroundedOccurrence?.id,
    );
    // Preserve a previously fixed component even when it is not one of this
    // joint's connectors. With no authored ground, connector A remains the
    // deterministic default used by the Rust solver.
    setGroundedSide(
      groundedIndex === 0 || groundedIndex === 1
        ? groundedIndex
        : existingGroundedOccurrence
          ? null
          : 0,
    );
  }, [existingGroundedOccurrence?.id, groundChanged, open, selections]);
  const coordinateStates = coordinatesForKind(form.kind).map((entry) => form[entry.key]);
  const coordinateValuesValid = coordinateStates.every(validCoordinate);
  const twistsValid = [form.connectorATwist, form.connectorBTwist]
    .every((value) => Number.isFinite(Number(value)));
  const screwPitchValid = form.kind !== 'screw'
    || (Number.isFinite(Number(form.screwPitch)) && Number(form.screwPitch) > 0);
  const canSubmit = !busy
    && form.name.trim().length > 0
    && validSelection
    && coordinateValuesValid
    && twistsValid
    && screwPitchValid;

  const requestPair = useMemo((): {
    create: CreateJointRequestDto;
    update: UpdateJointRequestDto | null;
  } | null => {
    if (
      form.name.trim().length === 0
      || !validSelection
      || !coordinateValuesValid
      || !twistsValid
      || !screwPitchValid
    ) return null;
    const primaryAngle = numericCoordinate(form.primaryAngle);
    const primaryLinear = numericCoordinate(form.primaryLinear);
    const advanced: JointAdvancedDto = {
      ...DEFAULT_JOINT_ADVANCED,
      connector_a_occurrence_id: selections[0].connector.occurrence_id
        ?? editingJoint?.advanced.connector_a_occurrence_id
        ?? null,
      connector_b_occurrence_id: selections[1].connector.occurrence_id
        ?? editingJoint?.advanced.connector_b_occurrence_id
        ?? null,
      secondary_angle_offset_deg: numericCoordinate(form.secondaryAngle).value,
      tertiary_angle_offset_deg: numericCoordinate(form.tertiaryAngle).value,
      secondary_linear_offset_mm: numericCoordinate(form.secondaryLinear).value,
      screw_pitch_mm_per_revolution: Number(form.screwPitch),
      connector_a_twist_deg: Number(form.connectorATwist),
      connector_b_twist_deg: Number(form.connectorBTwist),
      secondary_angle_limits: numericCoordinate(form.secondaryAngle).limits,
      tertiary_angle_limits: numericCoordinate(form.tertiaryAngle).limits,
      secondary_linear_limits: numericCoordinate(form.secondaryLinear).limits,
    };
    const create: CreateJointRequestDto = {
      name: form.name.trim() || `Joint${nextJointId}`,
      kind: form.kind,
      connector_a: selections[0].connector,
      connector_b: selections[1].connector,
      flipped: form.flipped,
      angle_offset_deg: usesPrimaryAngle(form.kind) ? primaryAngle.value : 0,
      linear_offset_mm: usesPrimaryLinear(form.kind) ? primaryLinear.value : 0,
      limits: null,
      angle_limits: usesPrimaryAngle(form.kind) ? primaryAngle.limits : null,
      linear_limits: usesPrimaryLinear(form.kind) ? primaryLinear.limits : null,
      advanced,
      grounded_body_id: groundChanged && groundedSide !== null
        ? selections[groundedSide].bodyId
        : null,
      grounded_occurrence_id: groundChanged && groundedSide !== null
        ? selections[groundedSide].connector.occurrence_id ?? null
        : null,
    };
    const {
      grounded_body_id: _groundedBodyId,
      grounded_occurrence_id: _groundedOccurrenceId,
      ...jointFields
    } = create;
    const updatedDefinition = editingJoint ? {
      ...editingJoint,
      ...jointFields,
      id: editingJoint.id,
      enabled: editingJoint.enabled,
    } satisfies JointDefinitionDto : null;
    return {
      create,
      update: updatedDefinition ? {
        joint: updatedDefinition,
        grounded_body_id: groundChanged && groundedSide !== null
          ? selections[groundedSide].bodyId
          : null,
        grounded_occurrence_id: groundChanged && groundedSide !== null
          ? selections[groundedSide].connector.occurrence_id ?? null
          : null,
      } : null,
    };
  }, [
    coordinateValuesValid,
    editingJoint,
    form,
    groundChanged,
    groundedSide,
    nextJointId,
    screwPitchValid,
    selections,
    twistsValid,
    validSelection,
  ]);

  useEffect(() => {
    if (!open || !requestPair) {
      clearJointPreview();
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      const operation = requestPair.update
        ? previewJointUpdate(requestPair.update)
        : previewJoint(requestPair.create);
      void operation.catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    }, 60);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [clearJointPreview, open, previewJoint, previewJointUpdate, requestPair]);

  if (!open) return null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit || !requestPair) return;
    setBusy(true);
    setError(null);
    const operation = requestPair.update
      ? updateJoint(requestPair.update)
      : createJoint(requestPair.create);
    void operation
      .then(() => clearSelection())
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setBusy(false));
  };

  const setCoordinate = (
    key: keyof Pick<JointFormState,
      'primaryAngle' | 'primaryLinear' | 'secondaryAngle' | 'tertiaryAngle' | 'secondaryLinear'>,
    next: CoordinateFieldState,
  ) => setForm((current) => ({ ...current, [key]: next }));

  return (
    <div data-native-viewport-dim="0.04" className="pointer-events-none fixed inset-0 z-[70] bg-black/[0.04]">
      <form
        data-testid="joint-dialog"
        onSubmit={submit}
        className="feature-dialog pointer-events-auto absolute right-5 top-[132px] flex max-h-[calc(100vh-190px)] w-[380px] flex-col overflow-hidden border border-edge bg-panel"
      >
        <header className="feature-dialog-header flex h-11 items-center gap-2 border-b border-edge px-3">
          {editingJoint ? <Wrench size={16} className="text-accent" /> : <Link2 size={16} className="text-accent" />}
          <span className="flex-1 text-xs font-semibold text-ink">
            {editingJoint ? t('assembly.joint.editTitle').replace('{name}', editingJoint.name) : t('assembly.joint.createTitle')}
          </span>
          <button
            type="button"
            onClick={() => close(false)}
            className="rounded p-1 text-mute hover:bg-edge hover:text-ink"
          >
            <X size={14} />
          </button>
        </header>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
          <div className="flex items-start gap-2 rounded border border-accent bg-accent/10 p-2 text-xs text-ink">
            <MousePointer2 size={15} className="mt-0.5 shrink-0 text-accent" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-accent">
                {editingJoint ? t('assembly.joint.connectorsEditable') : t('assembly.joint.selectingConnectors')}
              </p>
              <p className="mt-0.5 leading-4">
                {t('assembly.joint.pickHint')}
              </p>
            </div>
            <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[9px] font-semibold text-accent">
              {selections.length}/2
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {[0, 1].map((index) => {
              const selection = selections[index];
              return (
                <div key={index} className="rounded border border-edge bg-header p-2">
                  <p className="text-[9px] font-semibold uppercase tracking-wide text-mute">
                    {t('assembly.joint.connectorLabel').replace('{letter}', index === 0 ? 'A' : 'B')}
                  </p>
                  {selection ? (
                    <>
                      <p className="mt-1 truncate text-[11px] text-ink">
                        {selection.bodyName} · {selection.edge
                          ? t('assembly.joint.edgeNumber').replace('{n}', String((selection.edgeIndex ?? 0) + 1))
                          : t('assembly.joint.faceNumber').replace('{n}', String((selection.faceIndex ?? 0) + 1))}
                      </p>
                      <p className="mt-0.5 text-[9px] text-mute">
                        {t(connectorKindLabel(selection.connector.kind))}
                      </p>
                    </>
                  ) : (
                    <p className="mt-1 flex items-center gap-1 text-[11px] text-warn">
                      <Crosshair size={11} /> {editingJoint ? t('assembly.joint.missingRepick') : t('assembly.joint.pickConnector')}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {selections.length === 2 && selections[0].bodyId === selections[1].bodyId && (
            <p className="rounded border border-warn/40 bg-warn/10 p-2 text-[10px] text-warn">
              {t('assembly.joint.sameBodyWarning')}
            </p>
          )}
          <button
            type="button"
            onClick={clearSelection}
            className="h-7 rounded border border-edge px-2 text-[10px] text-ink hover:border-accent hover:bg-edge"
          >
            {t('assembly.joint.clearSelection')}
          </button>

          {validSelection && (
            <fieldset className="rounded border border-edge bg-header p-2">
              <legend className={`${LABEL} px-1`}>{t('assembly.joint.fixedComponent')}</legend>
              <p className="mb-2 text-[10px] leading-4 text-mute">
                {t('assembly.joint.fixedComponentHint')}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {selections.map((selection, index) => (
                  <label
                    key={`${selection.connector.occurrence_id ?? selection.bodyId}:${index}`}
                    className={`flex cursor-pointer items-center gap-2 rounded border p-2 text-[10px] ${
                      groundedSide === index
                        ? 'border-accent bg-accent/10 text-ink'
                        : 'border-edge text-mute hover:border-accent/60'
                    }`}
                  >
                    <input
                      type="radio"
                      name="grounded-component"
                      checked={groundedSide === index}
                      onChange={() => {
                        setGroundedSide(index as 0 | 1);
                        setGroundChanged(true);
                      }}
                    />
                    <span className="truncate">{selection.bodyName}</span>
                  </label>
                ))}
              </div>
              {!groundChanged && existingGroundedOccurrence && (
                <p className="mt-1.5 text-[9px] text-mute">
                  {groundedSide === null
                    ? t('assembly.joint.remainsFixed').replace('{name}', existingGroundedOccurrence.name)
                    : t('assembly.joint.existingFixedPreserved')}
                </p>
              )}
            </fieldset>
          )}

          <label>
            <span className={LABEL}>{t('assembly.joint.name')}</span>
            <input
              data-testid="joint-name"
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              className={INPUT}
            />
          </label>
          <label>
            <span className={LABEL}>{t('assembly.joint.jointType')}</span>
            <select
              data-testid="joint-kind"
              value={form.kind}
              onChange={(event) => setForm((current) => ({
                ...current,
                kind: event.target.value as JointKindDto,
              }))}
              className={INPUT}
            >
              <option value="rigid">{t('assembly.joint.kindRigid')}</option>
              <option value="revolute">{t('assembly.joint.kindRevolute')}</option>
              <option value="slider">{t('assembly.joint.kindSlider')}</option>
              <option value="cylindrical">{t('assembly.joint.kindCylindrical')}</option>
              <option value="planar">{t('assembly.joint.kindPlanar')}</option>
              <option value="ball">{t('assembly.joint.kindBall')}</option>
              <option value="pin_slot">{t('assembly.joint.kindPinSlot')}</option>
              <option value="screw">{t('assembly.joint.kindScrew')}</option>
              <option value="universal">{t('assembly.joint.kindUniversal')}</option>
            </select>
            <p className="mt-1 text-[9px] leading-3 text-mute">{t(jointKindHelp(form.kind))}</p>
          </label>

          {coordinatesForKind(form.kind).map((entry) => (
            <MotionFields
              key={entry.key}
              testId={entry.key === 'primaryAngle'
                ? 'joint-create-angle'
                : entry.key === 'primaryLinear'
                  ? 'joint-create-linear'
                  : `joint-${entry.key}`}
              title={t(entry.labelKey)}
              unit={entry.unit}
              state={form[entry.key]}
              onChange={(next) => setCoordinate(entry.key, next)}
            />
          ))}

          {form.kind === 'screw' && (
            <label>
              <span className={LABEL}>{t('assembly.joint.pitch')}</span>
              <input
                data-testid="joint-screw-pitch"
                type="number"
                min="0.000001"
                step="any"
                value={form.screwPitch}
                onChange={(event) => setForm((current) => ({ ...current, screwPitch: event.target.value }))}
                className={INPUT}
              />
            </label>
          )}

          <details className="rounded border border-edge bg-header/40 p-2">
            <summary className="flex cursor-pointer items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-mute">
              <RotateCw size={12} /> {t('assembly.joint.connectorOrientation')}
            </summary>
            <p className="mt-2 text-[9px] leading-3 text-mute">
              {t('assembly.joint.connectorOrientationHint')}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label>
                <span className={LABEL}>{t('assembly.joint.aTwist')}</span>
                <input
                  type="number"
                  step="any"
                  value={form.connectorATwist}
                  onChange={(event) => setForm((current) => ({ ...current, connectorATwist: event.target.value }))}
                  className={INPUT}
                />
              </label>
              <label>
                <span className={LABEL}>{t('assembly.joint.bTwist')}</span>
                <input
                  type="number"
                  step="any"
                  value={form.connectorBTwist}
                  onChange={(event) => setForm((current) => ({ ...current, connectorBTwist: event.target.value }))}
                  className={INPUT}
                />
              </label>
            </div>
          </details>

          <label className="flex items-center gap-2 text-xs text-ink">
            <input
              type="checkbox"
              checked={form.flipped}
              onChange={(event) => setForm((current) => ({ ...current, flipped: event.target.checked }))}
            />
            {t('assembly.joint.flipDirection')}
          </label>
          <p className="-mt-1 text-[9px] leading-3 text-mute">
            {t('assembly.joint.flipHint')}
          </p>
          <p className="text-[10px] leading-4 text-mute">
            {t('assembly.joint.motionNote')}
          </p>
          {error && <p className="rounded border border-warn/40 bg-warn/10 p-2 text-[10px] text-warn">{error}</p>}
        </div>
        <footer className="flex h-11 items-center justify-end gap-2 border-t border-edge bg-header px-3">
          <button type="button" onClick={() => close(false)} disabled={busy} className="h-7 rounded border border-edge px-3 text-xs text-ink hover:bg-edge">
            {t('assembly.joint.cancel')}
          </button>
          <button type="submit" disabled={!canSubmit} className="h-7 rounded bg-accent px-3 text-xs font-semibold text-white disabled:opacity-40">
            {editingJoint ? t('assembly.joint.save') : t('assembly.joint.createTitle')}
          </button>
        </footer>
      </form>
    </div>
  );
}

function connectorKindLabel(kind: JointConnectorDto['kind']): string {
  if (kind === 'circular_edge') return 'assembly.joint.connectorCircularEdge';
  if (kind === 'virtual_circular_face') return 'assembly.joint.connectorCircularOpening';
  if (kind === 'cylindrical_face') return 'assembly.joint.connectorCylindricalAxis';
  return 'assembly.joint.connectorPlanarFace';
}

function usesPrimaryAngle(kind: JointKindDto): boolean {
  return ['revolute', 'cylindrical', 'planar', 'ball', 'pin_slot', 'screw', 'universal'].includes(kind);
}

function usesPrimaryLinear(kind: JointKindDto): boolean {
  return ['slider', 'cylindrical', 'planar', 'pin_slot'].includes(kind);
}

function coordinatesForKind(kind: JointKindDto): Array<{
  key: keyof Pick<JointFormState,
    'primaryAngle' | 'primaryLinear' | 'secondaryAngle' | 'tertiaryAngle' | 'secondaryLinear'>;
  labelKey: string;
  unit: 'deg' | 'mm';
}> {
  const result: ReturnType<typeof coordinatesForKind> = [];
  if (usesPrimaryAngle(kind)) result.push({ key: 'primaryAngle', labelKey: kind === 'screw' ? 'assembly.joint.rotationTravel' : 'assembly.joint.primaryRotation', unit: 'deg' });
  if (usesPrimaryLinear(kind)) result.push({ key: 'primaryLinear', labelKey: kind === 'planar' || kind === 'pin_slot' ? 'assembly.joint.xSlide' : 'assembly.joint.slide', unit: 'mm' });
  if (kind === 'ball' || kind === 'universal') result.push({ key: 'secondaryAngle', labelKey: 'assembly.joint.secondaryRotation', unit: 'deg' });
  if (kind === 'ball') result.push({ key: 'tertiaryAngle', labelKey: 'assembly.joint.tertiaryRotation', unit: 'deg' });
  if (kind === 'planar') result.push({ key: 'secondaryLinear', labelKey: 'assembly.joint.ySlide', unit: 'mm' });
  return result;
}

function validCoordinate(state: CoordinateFieldState): boolean {
  const value = Number(state.value);
  if (!Number.isFinite(value)) return false;
  if (!state.limited) return true;
  const minimum = Number(state.minimum);
  const maximum = Number(state.maximum);
  return Number.isFinite(minimum)
    && Number.isFinite(maximum)
    && minimum <= value
    && value <= maximum;
}

function numericCoordinate(state: CoordinateFieldState): {
  value: number;
  limits: JointLimitsDto | null;
} {
  return {
    value: Number(state.value),
    limits: state.limited
      ? { min: Number(state.minimum), max: Number(state.maximum) }
      : null,
  };
}

function jointKindHelp(kind: JointKindDto): string {
  switch (kind) {
    case 'rigid': return 'assembly.joint.helpRigid';
    case 'revolute': return 'assembly.joint.helpRevolute';
    case 'slider': return 'assembly.joint.helpSlider';
    case 'cylindrical': return 'assembly.joint.helpCylindrical';
    case 'planar': return 'assembly.joint.helpPlanar';
    case 'ball': return 'assembly.joint.helpBall';
    case 'pin_slot': return 'assembly.joint.helpPinSlot';
    case 'screw': return 'assembly.joint.helpScrew';
    case 'universal': return 'assembly.joint.helpUniversal';
  }
}

function MotionFields({
  testId,
  title,
  unit,
  state,
  onChange,
}: {
  testId: string;
  title: string;
  unit: string;
  state: CoordinateFieldState;
  onChange: (state: CoordinateFieldState) => void;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className="rounded border border-edge bg-header/50 p-2">
      <legend className={`${LABEL} px-1`}>{title}</legend>
      <label>
        <span className={LABEL}>{t('assembly.joint.offset')} ({unit})</span>
        <input
          data-testid={`${testId}-value`}
          type="number"
          step="any"
          value={state.value}
          onChange={(event) => onChange({ ...state, value: event.target.value })}
          className={INPUT}
        />
      </label>
      <label className="mt-2 flex items-center gap-2 text-xs text-ink">
        <input
          type="checkbox"
          checked={state.limited}
          onChange={(event) => onChange({ ...state, limited: event.target.checked })}
        />
        {t('assembly.joint.limitField').replace('{label}', title.toLowerCase())}
      </label>
      {state.limited && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label>
            <span className={LABEL}>{t('assembly.joint.minimum')}</span>
            <input
              type="number"
              step="any"
              value={state.minimum}
              onChange={(event) => onChange({ ...state, minimum: event.target.value })}
              className={INPUT}
            />
          </label>
          <label>
            <span className={LABEL}>{t('assembly.joint.maximum')}</span>
            <input
              type="number"
              step="any"
              value={state.maximum}
              onChange={(event) => onChange({ ...state, maximum: event.target.value })}
              className={INPUT}
            />
          </label>
        </div>
      )}
    </fieldset>
  );
}
