import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Layers3, LoaderCircle, X } from 'lucide-react';
import { getEngine } from '../engine';
import { submitConstructionPlane } from '../engine/controller';
import type {
  DatumPlaneDefinitionDto,
  DatumPlaneSourceDto,
  PlaneRef,
} from '../engine/types';
import { isStraightSolidEdge } from '../solidEdgeEligibility';
import { useAppStore } from '../store/appStore';
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

export function ConstructionPlaneDialog() {
  const dialog = useAppStore((state) => state.constructionPlaneDialog);
  const close = useAppStore((state) => state.closeConstructionPlaneDialog);
  const busy = useAppStore((state) => state.solidBusy);
  const bodies = useAppStore((state) => state.solidScene.bodies);
  const selectedBody = useAppStore((state) => state.selectedBody);
  const selectedFace = useAppStore((state) => state.selectedFace);
  const selectedFaces = useAppStore((state) => state.selectedFaces);
  const selectedEdges = useAppStore((state) => state.selectedEdges);
  const knownPlanes = useAppStore((state) => state.datumPlanes);
  const [definitions, setDefinitions] = useState<DatumPlaneDefinitionDto[]>([]);
  const [first, setFirst] = useState('origin:xy');
  const [second, setSecond] = useState('origin:xz');
  const [distance, setDistance] = useState('10');
  const [bodyId, setBodyId] = useState(0);
  const [edgeId, setEdgeId] = useState(0);
  const [angle, setAngle] = useState('45');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = useMemo<PlaneOption[]>(() => {
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
    for (const plane of knownPlanes) {
      if (plane.feature_id === dialog?.featureId) continue;
      result.push({
        value: `datum:${plane.datum_id}`,
        label: plane.name,
        reference: { type: 'datum_plane', datum_id: plane.datum_id },
      });
    }
    return result;
  }, [bodies, dialog?.featureId, knownPlanes]);

  useEffect(() => {
    if (!dialog) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void getEngine()
      .then(async (engine) => {
        const values = await engine.datumPlaneDefinitions();
        if (cancelled) return;
        setDefinitions(values);
        const edit =
          dialog.featureId > 0
            ? values.find((definition) => definition.feature_id === dialog.featureId)
            : undefined;
        const source = edit?.source;
        const selectedReference =
          selectedFace !== null
            ? ({ type: 'planar_face', face_id: selectedFace } as PlaneRef)
            : ({ type: 'origin_plane', plane: 'xy' } as PlaneRef);
        if (source?.type === 'offset') {
          setFirst(planeValue(source.reference));
          setDistance(String(source.distance));
        } else if (source?.type === 'midplane') {
          setFirst(planeValue(source.first));
          setSecond(planeValue(source.second));
        } else if (source?.type === 'at_angle') {
          setFirst(planeValue(source.reference));
          setBodyId(source.body_id);
          setEdgeId(source.edge_id);
          setAngle(String(source.angle_deg));
        } else {
          setFirst(planeValue(selectedReference));
          const selectedEdge = selectedEdges[0];
          const edgeBody = bodies.find((body) =>
            body.edges.some(
              (edge) =>
                edge.id === selectedEdge && isStraightSolidEdge(edge.points),
            ),
          );
          const initialBody =
            edgeBody?.id ??
            selectedBody ??
            bodies.find((body) =>
              body.edges.some((edge) => isStraightSolidEdge(edge.points)),
            )?.id ??
            0;
          setBodyId(initialBody);
          setEdgeId(
            selectedEdge && edgeBody?.id === initialBody
              ? selectedEdge
              : bodies
                  .find((body) => body.id === initialBody)
                  ?.edges.find((edge) => isStraightSolidEdge(edge.points))?.id ??
                0,
          );
          if (dialog.kind === 'midplane') {
            const directFaces = selectedFaces.filter((faceId) =>
              bodies.some((body) =>
                body.faces.some((face) => face.id === faceId && face.plane !== null),
              ),
            );
            if (directFaces.length >= 2) {
              setFirst(`face:${directFaces[0]}`);
              setSecond(`face:${directFaces[1]}`);
              return;
            }
            const planarFaces = bodies.flatMap((candidate) =>
              candidate.faces
                .filter((face) => face.plane)
                .map((face) => ({ face, basis: face.plane! })),
            );
            const firstFace =
              planarFaces.find(({ face }) => face.id === selectedFace) ??
              planarFaces.find(({ face }, index) =>
                planarFaces.slice(index + 1).some(({ basis }) => {
                  const normal = face.plane!.normal;
                  return (
                    Math.abs(
                      normal[0] * basis.normal[0] +
                        normal[1] * basis.normal[1] +
                        normal[2] * basis.normal[2],
                    ) >
                    1 - 1e-6
                  );
                }),
              );
            const parallel = firstFace
              ? planarFaces.find(({ face, basis }) => {
                  if (face.id === firstFace.face.id) return false;
                  const normal = firstFace.basis.normal;
                  return (
                    Math.abs(
                      normal[0] * basis.normal[0] +
                        normal[1] * basis.normal[1] +
                        normal[2] * basis.normal[2],
                    ) >
                    1 - 1e-6
                  );
                })
              : undefined;
            if (firstFace && parallel) {
              setFirst(`face:${firstFace.face.id}`);
              setSecond(`face:${parallel.face.id}`);
            }
          }
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'Could not load planes');
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
    selectedBody,
    selectedEdges,
    selectedFace,
    selectedFaces,
  ]);

  if (!dialog) return null;
  const edit = definitions.find(
    (definition) => definition.feature_id === dialog.featureId,
  );
  const body = bodies.find((candidate) => candidate.id === bodyId);
  const straightBodyEdges =
    body?.edges.filter((edge) => isStraightSolidEdge(edge.points)) ?? [];
  const distanceValue = Number(distance);
  const angleValue = Number(angle);
  const valid =
    !loading &&
    !busy &&
    !error &&
    (dialog.kind === 'offset'
      ? Number.isFinite(distanceValue)
      : dialog.kind === 'midplane'
        ? first !== second
        : bodyId > 0 &&
          edgeId > 0 &&
          Number.isFinite(angleValue) &&
          Math.abs(angleValue) <= 360);

  const chooseBody = (id: number) => {
    setBodyId(id);
    setEdgeId(
      bodies
        .find((candidate) => candidate.id === id)
        ?.edges.find((edge) => isStraightSolidEdge(edge.points))?.id ?? 0,
    );
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    let source: DatumPlaneSourceDto;
    if (dialog.kind === 'offset') {
      source = {
        type: 'offset',
        reference: optionReference(options, first),
        distance: distanceValue,
      };
    } else if (dialog.kind === 'midplane') {
      source = {
        type: 'midplane',
        first: optionReference(options, first),
        second: optionReference(options, second),
      };
    } else {
      source = {
        type: 'at_angle',
        reference: optionReference(options, first),
        body_id: bodyId,
        edge_id: edgeId,
        angle_deg: angleValue,
        axis_points:
          edit?.source.type === 'at_angle' ? edit.source.axis_points : null,
      };
    }
    void submitConstructionPlane(
      { source },
      dialog.featureId > 0 ? dialog.featureId : undefined,
    );
  };

  const title =
    dialog.kind === 'offset'
      ? 'Offset Plane'
      : dialog.kind === 'midplane'
        ? 'Midplane'
        : 'Plane at Angle';

  return (
    <div
      data-native-viewport-dim="0.15"
      className="pointer-events-none fixed inset-0 z-[70] bg-black/15"
    >
      <form
        data-testid="construction-plane-dialog"
        onSubmit={submit}
        className="feature-dialog pointer-events-auto absolute right-5 top-[132px] flex max-h-[calc(100vh-190px)] w-80 flex-col overflow-hidden border border-edge bg-panel"
      >
        <header className="feature-dialog-header flex h-10 items-center gap-2 border-b border-edge px-3">
          <Layers3 size={15} className="text-accent" />
          <span className="flex-1 text-xs font-semibold text-ink">
            {dialog.featureId > 0 ? `Edit ${title}` : title}
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
              Loading references…
            </p>
          ) : error ? (
            <p className="rounded border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-300">
              {error}
            </p>
          ) : (
            <>
              <label>
                <span className={LABEL}>
                  {dialog.kind === 'midplane' ? 'First reference' : 'Reference plane'}
                </span>
                <select value={first} onChange={(event) => setFirst(event.target.value)} className={INPUT}>
                  {options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              {dialog.kind === 'offset' && (
                <label>
                  <span className={LABEL}>Offset distance (mm)</span>
                  <DimensionInput
                    step="any"
                    value={distance}
                    onValueChange={setDistance}
                  />
                </label>
              )}
              {dialog.kind === 'midplane' && (
                <label>
                  <span className={LABEL}>Second reference</span>
                  <select value={second} onChange={(event) => setSecond(event.target.value)} className={INPUT}>
                    {options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {dialog.kind === 'at_angle' && (
                <>
                  <label>
                    <span className={LABEL}>Axis body</span>
                    <select value={bodyId} onChange={(event) => chooseBody(Number(event.target.value))} className={INPUT}>
                      {bodies.filter((candidate) => candidate.edges.some((edge) => isStraightSolidEdge(edge.points))).map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span className={LABEL}>Straight axis edge</span>
                    <select value={edgeId} onChange={(event) => setEdgeId(Number(event.target.value))} className={INPUT}>
                      {straightBodyEdges.map((edge, index) => (
                        <option key={edge.id} value={edge.id}>Edge {index + 1} (#{edge.id})</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span className={LABEL}>Angle (degrees)</span>
                    <DimensionInput
                      step="any"
                      value={angle}
                      onValueChange={setAngle}
                    />
                  </label>
                  <p className="text-[10px] leading-4 text-mute">
                    The selected straight edge must lie on the reference plane.
                  </p>
                </>
              )}
            </>
          )}
        </div>
        <footer className="flex h-11 items-center justify-end gap-2 border-t border-edge bg-header px-3">
          <button type="button" onClick={close} disabled={busy} className="h-7 rounded border border-edge px-3 text-xs text-ink hover:bg-edge">Cancel</button>
          <button data-testid="construction-plane-ok" type="submit" disabled={!valid} className="h-7 rounded bg-accent px-3 text-xs font-semibold text-white disabled:opacity-40">OK</button>
        </footer>
      </form>
    </div>
  );
}
