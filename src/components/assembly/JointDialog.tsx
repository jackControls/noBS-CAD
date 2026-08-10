import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Crosshair, Link2, MousePointer2, X } from 'lucide-react';
import type {
  CreateJointRequestDto,
  FaceDto,
  JointConnectorDto,
  JointKindDto,
} from '../../engine/types';
import { useAppStore } from '../../store/appStore';

const INPUT =
  'h-8 w-full rounded border border-edge bg-header px-2 text-xs text-ink outline-none focus:border-accent';
const LABEL = 'mb-1 block text-[10px] font-semibold uppercase tracking-wide text-mute';

interface FaceSelection {
  bodyId: number;
  bodyName: string;
  face: FaceDto;
  faceIndex: number;
}

export function JointDialog() {
  const open = useAppStore((state) => state.jointDialogOpen);
  const close = useAppStore((state) => state.setJointDialogOpen);
  const selectedFaceIds = useAppStore((state) => state.selectedFaces);
  const bodies = useAppStore((state) => state.solidScene.bodies);
  const nextJointId = useAppStore((state) => state.assemblyDocument.next_joint_id);
  const createJoint = useAppStore((state) => state.createJoint);
  const clearSelection = useAppStore((state) => state.clearSolidSelection);
  const [name, setName] = useState('Joint1');
  const [kind, setKind] = useState<JointKindDto>('rigid');
  const [flipped, setFlipped] = useState(false);
  const [offset, setOffset] = useState('0');
  const [limitsEnabled, setLimitsEnabled] = useState(false);
  const [minimum, setMinimum] = useState('-90');
  const [maximum, setMaximum] = useState('90');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(`Joint${nextJointId}`);
    setKind('rigid');
    setFlipped(false);
    setOffset('0');
    setLimitsEnabled(false);
    setMinimum('-90');
    setMaximum('90');
    setError(null);
  }, [open, nextJointId]);

  const selections = useMemo(() => {
    const result: FaceSelection[] = [];
    for (const faceId of selectedFaceIds) {
      const body = bodies.find((candidate) => candidate.faces.some((face) => face.id === faceId));
      const faceIndex = body?.faces.findIndex((face) => face.id === faceId) ?? -1;
      const face = faceIndex >= 0 ? body?.faces[faceIndex] : undefined;
      if (body && face?.plane) {
        result.push({ bodyId: body.id, bodyName: body.name, face, faceIndex });
      }
    }
    return result;
  }, [bodies, selectedFaceIds]);

  if (!open) return null;

  const validSelection =
    selections.length === 2 && selections[0].bodyId !== selections[1].bodyId;
  const offsetValue = Number(offset);
  const minimumValue = Number(minimum);
  const maximumValue = Number(maximum);
  const canSubmit =
    !busy && name.trim().length > 0 && validSelection && Number.isFinite(offsetValue)
    && (!limitsEnabled || (
      Number.isFinite(minimumValue)
      && Number.isFinite(maximumValue)
      && minimumValue <= offsetValue
      && offsetValue <= maximumValue
    ));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    const request: CreateJointRequestDto = {
      name: name.trim(),
      kind,
      connector_a: connectorFromSelection(selections[0]),
      connector_b: connectorFromSelection(selections[1]),
      flipped,
      angle_offset_deg: kind === 'revolute' ? offsetValue : 0,
      linear_offset_mm: kind === 'slider' ? offsetValue : 0,
      limits: limitsEnabled ? { min: minimumValue, max: maximumValue } : null,
    };
    setBusy(true);
    setError(null);
    void createJoint(request)
      .then(() => clearSelection())
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setBusy(false));
  };

  return (
    <div data-native-viewport-dim="0.04" className="pointer-events-none fixed inset-0 z-[70] bg-black/[0.04]">
      <form
        data-testid="joint-dialog"
        onSubmit={submit}
        className="feature-dialog pointer-events-auto absolute right-5 top-[132px] flex max-h-[calc(100vh-190px)] w-[360px] flex-col overflow-hidden border border-edge bg-panel"
      >
        <header className="feature-dialog-header flex h-11 items-center gap-2 border-b border-edge px-3">
          <Link2 size={16} className="text-accent" />
          <span className="flex-1 text-xs font-semibold text-ink">Create Joint</span>
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
              <p className="font-semibold text-accent">Selecting joint connectors</p>
              <p className="mt-0.5 leading-4">
                Pick exactly two planar faces on different bodies. Picks remain active while this dialog is open.
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
                    Connector {index === 0 ? 'A' : 'B'}
                  </p>
                  {selection ? (
                    <p className="mt-1 truncate text-[11px] text-ink">
                      {selection.bodyName} · Face {selection.faceIndex + 1}
                    </p>
                  ) : (
                    <p className="mt-1 flex items-center gap-1 text-[11px] text-mute">
                      <Crosshair size={11} /> Pick a face
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {selections.length > 2 && (
            <p className="rounded border border-warn/40 bg-warn/10 p-2 text-[10px] text-warn">
              More than two planar faces are selected. Clear the selection and pick the two connectors again.
            </p>
          )}
          {selections.length === 2 && selections[0].bodyId === selections[1].bodyId && (
            <p className="rounded border border-warn/40 bg-warn/10 p-2 text-[10px] text-warn">
              A joint must connect two different bodies.
            </p>
          )}
          <button
            type="button"
            onClick={clearSelection}
            className="h-7 rounded border border-edge px-2 text-[10px] text-ink hover:border-accent hover:bg-edge"
          >
            Clear connector selection
          </button>

          <label>
            <span className={LABEL}>Name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} className={INPUT} />
          </label>
          <label>
            <span className={LABEL}>Joint type</span>
            <select
              value={kind}
              onChange={(event) => {
                const next = event.target.value as JointKindDto;
                setKind(next);
                if (next === 'revolute') {
                  setMinimum('-90');
                  setMaximum('90');
                } else if (next === 'slider') {
                  setMinimum('-25');
                  setMaximum('25');
                }
              }}
              className={INPUT}
            >
              <option value="rigid">Rigid</option>
              <option value="revolute">Revolute</option>
              <option value="slider">Slider</option>
            </select>
          </label>
          {kind !== 'rigid' && (
            <>
              <label>
                <span className={LABEL}>{kind === 'revolute' ? 'Angle (deg)' : 'Position (mm)'}</span>
                <input
                  type="number"
                  step="any"
                  value={offset}
                  onChange={(event) => setOffset(event.target.value)}
                  className={INPUT}
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-ink">
                <input type="checkbox" checked={limitsEnabled} onChange={(event) => setLimitsEnabled(event.target.checked)} />
                Limit motion
              </label>
              {limitsEnabled && (
                <div className="grid grid-cols-2 gap-2">
                  <label>
                    <span className={LABEL}>Minimum</span>
                    <input type="number" step="any" value={minimum} onChange={(event) => setMinimum(event.target.value)} className={INPUT} />
                  </label>
                  <label>
                    <span className={LABEL}>Maximum</span>
                    <input type="number" step="any" value={maximum} onChange={(event) => setMaximum(event.target.value)} className={INPUT} />
                  </label>
                </div>
              )}
            </>
          )}
          <label className="flex items-center gap-2 text-xs text-ink">
            <input type="checkbox" checked={flipped} onChange={(event) => setFlipped(event.target.checked)} />
            Flip connector alignment
          </label>
          <p className="text-[10px] leading-4 text-mute">
            The first connector body is grounded automatically. Motion is solved without changing the OCCT model.
          </p>
          {error && <p className="rounded border border-warn/40 bg-warn/10 p-2 text-[10px] text-warn">{error}</p>}
        </div>
        <footer className="flex h-11 items-center justify-end gap-2 border-t border-edge bg-header px-3">
          <button type="button" onClick={() => close(false)} disabled={busy} className="h-7 rounded border border-edge px-3 text-xs text-ink hover:bg-edge">
            Cancel
          </button>
          <button type="submit" disabled={!canSubmit} className="h-7 rounded bg-accent px-3 text-xs font-semibold text-white disabled:opacity-40">
            Create Joint
          </button>
        </footer>
      </form>
    </div>
  );
}

function connectorFromSelection(selection: FaceSelection): JointConnectorDto {
  const plane = selection.face.plane!;
  const signature = selection.face.signature;
  return {
    body_id: selection.bodyId,
    face_id: selection.face.id,
    face_key: selection.face.key,
    frame: {
      origin: signature
        ? [signature.centroid.x, signature.centroid.y, signature.centroid.z]
        : plane.origin,
      primary_axis: plane.normal,
      secondary_axis: plane.u,
    },
  };
}
