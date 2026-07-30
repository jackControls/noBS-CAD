import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { CircleDot, LoaderCircle, X } from 'lucide-react';
import { getEngine } from '../engine';
import { submitHole } from '../engine/controller';
import type {
  BodyDto,
  FaceDto,
  HoleBottomStyle,
  HoleExtent,
  HolePositionDto,
  HoleStyle,
  HoleThreadHand,
  HoleThreadRepresentation,
  HoleThreadSeries,
  HoleThreadStandard,
  PlaneBasis,
  Point3Dto,
  SketchDto,
  SketchPointRefDto,
} from '../engine/types';
import { useTranslation } from '../i18n';
import {
  defaultThreadPreset,
  presetsForSeries,
  THREAD_PRESETS,
  threadDtoFromPreset,
} from '../lib/threadStandards';
import type { ThreadPreset } from '../lib/threadStandards';
import { useAppStore } from '../store/appStore';
import { DimensionInput } from './DimensionInput';

const INPUT_CLASS = 'h-7 w-full rounded border border-edge bg-header px-2 text-xs text-ink outline-none focus:border-accent';
const LABEL_CLASS = 'mb-1 block text-[10px] font-semibold uppercase tracking-wide text-mute';

function localPoint(basis: PlaneBasis, point: Point3Dto): { x: number; y: number } {
  const delta = point
    ? [point.x - basis.origin[0], point.y - basis.origin[1], point.z - basis.origin[2]]
    : [0, 0, 0];
  return {
    x: delta[0] * basis.u[0] + delta[1] * basis.u[1] + delta[2] * basis.u[2],
    y: delta[0] * basis.v[0] + delta[1] * basis.v[1] + delta[2] * basis.v[2],
  };
}

function faceCenter(body: BodyDto, face: FaceDto): Point3Dto {
  let bestArea = -1;
  let best: Point3Dto | null = null;
  const end = face.first_index + face.index_count;
  for (let offset = face.first_index; offset + 2 < end; offset += 3) {
    const ids = [
      body.mesh.indices[offset],
      body.mesh.indices[offset + 1],
      body.mesh.indices[offset + 2],
    ];
    if (ids.some((id) => id === undefined)) continue;
    const points = ids.map((id) => ({
      x: body.mesh.positions[id! * 3] ?? 0,
      y: body.mesh.positions[id! * 3 + 1] ?? 0,
      z: body.mesh.positions[id! * 3 + 2] ?? 0,
    }));
    const ab = {
      x: points[1].x - points[0].x,
      y: points[1].y - points[0].y,
      z: points[1].z - points[0].z,
    };
    const ac = {
      x: points[2].x - points[0].x,
      y: points[2].y - points[0].y,
      z: points[2].z - points[0].z,
    };
    const area = Math.hypot(
      ab.y * ac.z - ab.z * ac.y,
      ab.z * ac.x - ab.x * ac.z,
      ab.x * ac.y - ab.y * ac.x,
    );
    if (area <= bestArea) continue;
    bestArea = area;
    best = {
      x: (points[0].x + points[1].x + points[2].x) / 3,
      y: (points[0].y + points[1].y + points[2].y) / 3,
      z: (points[0].z + points[1].z + points[2].z) / 3,
    };
  }
  return best ?? {
    x: face.plane?.origin[0] ?? 0,
    y: face.plane?.origin[1] ?? 0,
    z: face.plane?.origin[2] ?? 0,
  };
}

function referencedWorldPoint(
  sketches: SketchDto[],
  reference: SketchPointRefDto,
): Point3Dto | null {
  const sketch = sketches.find((candidate) => candidate.name === reference.sketch_name);
  const entity = sketch?.entities.find((candidate) => candidate.id === reference.entity_id);
  if (!sketch || !entity) return null;
  let point: { x: number; y: number } | null = null;
  if (reference.kind === 'point' && entity.kind === 'point') point = entity.position;
  if (reference.kind === 'start' && entity.kind === 'line') point = entity.start;
  if (reference.kind === 'end' && entity.kind === 'line') point = entity.end;
  if (reference.kind === 'center' && (entity.kind === 'circle' || entity.kind === 'arc')) {
    point = entity.center;
  }
  if (reference.kind === 'start' && entity.kind === 'arc') {
    point = {
      x: entity.center.x + Math.cos(entity.start_angle) * entity.radius,
      y: entity.center.y + Math.sin(entity.start_angle) * entity.radius,
    };
  }
  if (reference.kind === 'end' && entity.kind === 'arc') {
    point = {
      x: entity.center.x + Math.cos(entity.end_angle) * entity.radius,
      y: entity.center.y + Math.sin(entity.end_angle) * entity.radius,
    };
  }
  if (reference.kind === 'fit_point' && entity.kind === 'spline') {
    point = entity.points[reference.index] ?? null;
  }
  if (!point) return null;
  const basis = sketch.basis;
  return {
    x: basis.origin[0] + basis.u[0] * point.x + basis.v[0] * point.y,
    y: basis.origin[1] + basis.u[1] * point.x + basis.v[1] * point.y,
    z: basis.origin[2] + basis.u[2] * point.x + basis.v[2] * point.y,
  };
}

export function HoleDialog() {
  const { t } = useTranslation();
  const featureId = useAppStore((state) => state.holeDialogFeature);
  const close = useAppStore((state) => state.closeHoleDialog);
  const busy = useAppStore((state) => state.solidBusy);
  const bodies = useAppStore((state) => state.solidScene.bodies);
  const selectedFace = useAppStore((state) => state.selectedFace);
  const selectedPoint = useAppStore((state) => state.selectedFacePoint);
  const pickedSketchPoints = useAppStore((state) => state.holePositionSelections);
  const setPickedSketchPoints = useAppStore((state) => state.setHolePositionSelections);
  const [bodyId, setBodyId] = useState(0);
  const [faceId, setFaceId] = useState(0);
  const [x, setX] = useState('0');
  const [y, setY] = useState('0');
  const [diameter, setDiameter] = useState('5');
  const [extentType, setExtentType] = useState<HoleExtent['type']>('through_all');
  const [depth, setDepth] = useState('10');
  const [style, setStyle] = useState<HoleStyle>('simple');
  const [counterboreDiameter, setCounterboreDiameter] = useState('9');
  const [counterboreDepth, setCounterboreDepth] = useState('3');
  const [countersinkDiameter, setCountersinkDiameter] = useState('9');
  const [countersinkAngle, setCountersinkAngle] = useState('90');
  const [bottomStyle, setBottomStyle] = useState<HoleBottomStyle>('drill_point');
  const [drillPointAngle, setDrillPointAngle] = useState('118');
  const defaultThread = defaultThreadPreset();
  const [threaded, setThreaded] = useState(false);
  const [threadStandard, setThreadStandard] = useState<HoleThreadStandard>(
    defaultThread.standard,
  );
  const [threadSeries, setThreadSeries] = useState<HoleThreadSeries>(defaultThread.series);
  const [threadPresetId, setThreadPresetId] = useState(defaultThread.id);
  const [customThreadPreset, setCustomThreadPreset] = useState<ThreadPreset | null>(null);
  const [threadRepresentation, setThreadRepresentation] =
    useState<HoleThreadRepresentation>('modeled');
  const [threadHand, setThreadHand] = useState<HoleThreadHand>('right');
  const [fullThreadDepth, setFullThreadDepth] = useState(true);
  const [threadDepth, setThreadDepth] = useState('8');
  const [flip, setFlip] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const planarBodies = useMemo(
    () => bodies.filter((body) => body.faces.some((face) => face.plane !== null)),
    [bodies],
  );
  const threadPresets = useMemo(() => {
    const catalog = presetsForSeries(threadSeries);
    return customThreadPreset?.series === threadSeries
      ? [customThreadPreset, ...catalog]
      : catalog;
  }, [customThreadPreset, threadSeries]);
  const selectedThreadPreset = useMemo(
    () => threadPresets.find((preset) => preset.id === threadPresetId)
      ?? threadPresets[0]
      ?? defaultThreadPreset(),
    [threadPresetId, threadPresets],
  );

  useEffect(() => {
    if (featureId === null) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void getEngine().then(async (engine) => {
      const definitions = await engine.holeDefinitions();
      if (cancelled) return;
      const selection = useAppStore.getState();
      const edit = featureId > 0
        ? definitions.find((definition) => definition.feature_id === featureId)
        : undefined;
      const initialBodyId = edit?.body_id ?? selection.selectedBody ?? planarBodies[0]?.id ?? 0;
      const body = planarBodies.find((candidate) => candidate.id === initialBodyId) ?? planarBodies[0];
      const face = edit
        ? body?.faces.find((candidate) => candidate.id === edit.face_id)
        : body?.faces.find((candidate) => candidate.id === selection.selectedFace && candidate.plane !== null)
          ?? body?.faces.find((candidate) => candidate.plane !== null);
      setBodyId(body?.id ?? 0);
      setFaceId(face?.id ?? 0);
      if (edit) {
        const editPositions = edit.positions.length > 0
          ? edit.positions
          : [{
              position: edit.position,
              position_reference: edit.position_reference,
            }];
        setX(String(editPositions[0]?.position.x ?? edit.position.x));
        setY(String(editPositions[0]?.position.y ?? edit.position.y));
        selection.setHolePositionSelections(
          editPositions.flatMap((position) => {
            if (!position.position_reference) return [];
            const world = referencedWorldPoint(
              selection.finishedSketches,
              position.position_reference,
            );
            return world ? [{ ...position.position_reference, world }] : [];
          }),
        );
      } else if (body && face?.plane) {
        const placementPoint = selection.selectedFace === face.id && selection.selectedFacePoint
          ? selection.selectedFacePoint
          : faceCenter(body, face);
        const local = localPoint(face.plane, placementPoint);
        setX(String(Number(local.x.toFixed(6))));
        setY(String(Number(local.y.toFixed(6))));
        selection.setHolePositionSelections([]);
      }
      setDiameter(String(edit?.diameter ?? 5));
      setExtentType(edit?.extent.type ?? 'through_all');
      setDepth(String(edit?.extent.type === 'distance' ? edit.extent.depth : 10));
      setStyle(edit?.style ?? 'simple');
      setCounterboreDiameter(String(edit?.counterbore_diameter || 9));
      setCounterboreDepth(String(edit?.counterbore_depth || 3));
      setCountersinkDiameter(String(edit?.countersink_diameter || 9));
      setCountersinkAngle(String(edit?.countersink_angle_deg || 90));
      setBottomStyle(edit?.bottom_style ?? 'drill_point');
      setDrillPointAngle(String(edit?.drill_point_angle_deg || 118));
      const editThread = edit?.thread ?? null;
      setThreaded(editThread !== null);
      if (editThread && edit) {
        const matchingPreset = THREAD_PRESETS.find((preset) =>
          preset.standard === editThread.standard
          && preset.series === editThread.series
          && Math.abs(preset.nominalDiameterMm - editThread.nominal_diameter) < 1e-6
          && Math.abs(preset.pitchMm - editThread.pitch) < 1e-6,
        );
        setThreadStandard(editThread.standard);
        setThreadSeries(editThread.series);
        if (matchingPreset) {
          setCustomThreadPreset(null);
          setThreadPresetId(matchingPreset.id);
        } else {
          const customPreset: ThreadPreset = {
            id: `custom-${edit.feature_id}`,
            label: `${editThread.designation} — custom`,
            standard: editThread.standard,
            series: editThread.series,
            designation: editThread.designation,
            class: editThread.class,
            nominalDiameterMm: editThread.nominal_diameter,
            pitchMm: editThread.pitch,
            threadsPerInch: editThread.threads_per_inch,
            tapDrillDiameterMm: edit.diameter,
            tapDrillDesignation: editThread.tap_drill_designation
              ?? `${edit.diameter} mm`,
          };
          setCustomThreadPreset(customPreset);
          setThreadPresetId(customPreset.id);
        }
        setThreadRepresentation(editThread.representation);
        setThreadHand(editThread.hand);
        setFullThreadDepth(editThread.depth === null);
        setThreadDepth(String(editThread.depth ?? (
          edit?.extent.type === 'distance' ? edit.extent.depth : 8
        )));
      } else {
        const preset = defaultThreadPreset();
        setCustomThreadPreset(null);
        setThreadStandard(preset.standard);
        setThreadSeries(preset.series);
        setThreadPresetId(preset.id);
        setThreadRepresentation('modeled');
        setThreadHand('right');
        setFullThreadDepth(true);
        setThreadDepth(String(edit?.extent.type === 'distance' ? edit.extent.depth : 8));
      }
      setFlip(edit?.flip ?? false);
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : t('hole.loadFailed'));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [featureId, planarBodies, t]);

  // The Hole panel is modeless: clicking another planar face retargets the
  // feature and uses the exact click as its center without resetting the
  // diameter/style values already entered in the panel.
  useEffect(() => {
    if (featureId === null || selectedFace === null) return;
    const body = planarBodies.find((candidate) =>
      candidate.faces.some((face) => face.id === selectedFace && face.plane !== null),
    );
    const face = body?.faces.find((candidate) => candidate.id === selectedFace);
    if (!body || !face?.plane) return;
    setBodyId(body.id);
    setFaceId(face.id);
    const local = localPoint(face.plane, selectedPoint ?? faceCenter(body, face));
    setX(String(Number(local.x.toFixed(6))));
    setY(String(Number(local.y.toFixed(6))));
  }, [featureId, planarBodies, selectedFace, selectedPoint]);

  useEffect(() => {
    if (featureId === null) return;
    const currentBody = planarBodies.find((candidate) => candidate.id === bodyId);
    const currentFace = currentBody?.faces.find((candidate) => candidate.id === faceId);
    const latest = pickedSketchPoints[pickedSketchPoints.length - 1];
    if (!latest || !currentFace?.plane) return;
    const local = localPoint(currentFace.plane, latest.world);
    setX(String(Number(local.x.toFixed(6))));
    setY(String(Number(local.y.toFixed(6))));
  }, [bodyId, faceId, featureId, pickedSketchPoints, planarBodies]);

  if (featureId === null) return null;
  const body = planarBodies.find((candidate) => candidate.id === bodyId);
  const faces = body?.faces.filter((face) => face.plane !== null) ?? [];
  const values = {
    x: Number(x), y: Number(y), diameter: Number(diameter), depth: Number(depth),
    counterboreDiameter: Number(counterboreDiameter), counterboreDepth: Number(counterboreDepth),
    countersinkDiameter: Number(countersinkDiameter), countersinkAngle: Number(countersinkAngle),
    drillPointAngle: Number(drillPointAngle), threadDepth: Number(threadDepth),
  };
  const commonValid = bodyId > 0 && faceId > 0 && Number.isFinite(values.x) && Number.isFinite(values.y)
    && Number.isFinite(values.diameter) && values.diameter > 0
    && (extentType === 'through_all' || Number.isFinite(values.depth) && values.depth > 0);
  const counterboreValid = Number.isFinite(values.counterboreDiameter)
    && values.counterboreDiameter > values.diameter
    && Number.isFinite(values.counterboreDepth)
    && values.counterboreDepth > 0;
  const countersinkValid = Number.isFinite(values.countersinkDiameter)
    && values.countersinkDiameter > values.diameter
    && Number.isFinite(values.countersinkAngle)
    && values.countersinkAngle > 0
    && values.countersinkAngle < 180;
  const styleValid = style === 'simple'
    || (style === 'counterbore' && counterboreValid)
    || (style === 'countersink' && countersinkValid);
  const bottomValid = bottomStyle === 'flat'
    || Number.isFinite(values.drillPointAngle)
      && values.drillPointAngle > 0
      && values.drillPointAngle < 180;
  const threadRadialDepth = (
    selectedThreadPreset.nominalDiameterMm - values.diameter
  ) * 0.5;
  const threadInnerHalfWidth = selectedThreadPreset.pitchMm * 0.0625
    + threadRadialDepth * Math.tan(Math.PI / 6);
  const threadValid = !threaded || (
    selectedThreadPreset.standard === threadStandard
    && selectedThreadPreset.series === threadSeries
    && selectedThreadPreset.nominalDiameterMm > values.diameter
    && (fullThreadDepth || (
      Number.isFinite(values.threadDepth)
      && values.threadDepth > 0
      && (extentType !== 'distance' || values.threadDepth <= values.depth)
    ))
    && (threadRepresentation !== 'modeled'
      || threadInnerHalfWidth < selectedThreadPreset.pitchMm * 0.499)
  );
  const canSubmit = !loading && !busy && !error
    && commonValid && styleValid && bottomValid && threadValid;
  const chooseThreadPreset = (id: string) => {
    const preset = THREAD_PRESETS.find((candidate) => candidate.id === id)
      ?? (customThreadPreset?.id === id ? customThreadPreset : null);
    if (!preset) return;
    setThreadPresetId(id);
    setDiameter(String(Number(preset.tapDrillDiameterMm.toFixed(6))));
  };
  const chooseThreadStandard = (standard: HoleThreadStandard) => {
    const series: HoleThreadSeries = standard === 'iso_metric' ? 'metric_coarse' : 'unc';
    const preset = presetsForSeries(series)[0] ?? defaultThreadPreset();
    setCustomThreadPreset(null);
    setThreadStandard(standard);
    setThreadSeries(series);
    chooseThreadPreset(preset.id);
  };
  const chooseThreadSeries = (series: HoleThreadSeries) => {
    const preset = presetsForSeries(series)[0] ?? defaultThreadPreset();
    setCustomThreadPreset(null);
    setThreadSeries(series);
    chooseThreadPreset(preset.id);
  };
  const chooseBody = (nextBodyId: number) => {
    const nextBody = planarBodies.find((candidate) => candidate.id === nextBodyId);
    const nextFace = nextBody?.faces.find((candidate) => candidate.plane !== null);
    setBodyId(nextBodyId);
    setFaceId(nextFace?.id ?? 0);
    setPickedSketchPoints([]);
    if (nextBody && nextFace?.plane) {
      const local = localPoint(nextFace.plane, faceCenter(nextBody, nextFace));
      setX(String(Number(local.x.toFixed(6))));
      setY(String(Number(local.y.toFixed(6))));
    }
  };
  const chooseFace = (nextFaceId: number) => {
    const nextFace = body?.faces.find((candidate) => candidate.id === nextFaceId);
    setFaceId(nextFaceId);
    setPickedSketchPoints([]);
    if (body && nextFace?.plane) {
      const local = localPoint(nextFace.plane, faceCenter(body, nextFace));
      setX(String(Number(local.x.toFixed(6))));
      setY(String(Number(local.y.toFixed(6))));
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    const supportFace = body?.faces.find((candidate) => candidate.id === faceId);
    const positions: HolePositionDto[] = pickedSketchPoints.length > 0 && supportFace?.plane
      ? pickedSketchPoints.map((pick) => {
          const { world, ...position_reference } = pick;
          return {
            position: localPoint(supportFace.plane!, world),
            position_reference,
          };
        })
      : [{
          position: { x: values.x, y: values.y },
          position_reference: null,
        }];
    const firstPosition = positions[0]!;
    void submitHole({
      body_id: bodyId,
      face_id: faceId,
      position: firstPosition.position,
      position_reference: firstPosition.position_reference,
      positions,
      diameter: values.diameter,
      extent: extentType === 'through_all' ? { type: 'through_all' } : { type: 'distance', depth: values.depth },
      style,
      counterbore_diameter: style === 'counterbore' ? values.counterboreDiameter : 0,
      counterbore_depth: style === 'counterbore' ? values.counterboreDepth : 0,
      countersink_diameter: style === 'countersink' ? values.countersinkDiameter : 0,
      countersink_angle_deg: style === 'countersink' ? values.countersinkAngle : 90,
      bottom_style: bottomStyle,
      drill_point_angle_deg: values.drillPointAngle,
      thread: threaded
        ? threadDtoFromPreset(selectedThreadPreset, {
            hand: threadHand,
            depth: fullThreadDepth ? null : values.threadDepth,
            representation: threadRepresentation,
          })
        : null,
      flip,
    }, featureId > 0 ? featureId : undefined);
  };

  return (
    <div
      data-native-viewport-dim="0.15"
      className="pointer-events-none fixed inset-0 z-[70] bg-black/15"
    >
      <form data-testid="hole-dialog" onSubmit={submit} className="feature-dialog pointer-events-auto absolute right-5 top-[132px] flex max-h-[calc(100vh-190px)] w-80 flex-col overflow-hidden border border-edge bg-panel">
        <header className="feature-dialog-header flex h-10 shrink-0 items-center gap-2 border-b border-edge px-3"><CircleDot size={15} className="text-accent" /><span className="flex-1 text-xs font-semibold text-ink">{t(featureId > 0 ? 'hole.editTitle' : 'hole.title')}</span><button type="button" onClick={close} disabled={busy} className="rounded p-1 text-mute hover:bg-edge hover:text-ink"><X size={14} /></button></header>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
          {loading ? <p className="flex items-center gap-2 text-xs text-mute"><LoaderCircle size={14} className="animate-spin" />{t('hole.loading')}</p>
            : error ? <p className="rounded border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-300">{error}</p>
              : planarBodies.length === 0 ? <p className="text-xs text-mute">{t('hole.noFaces')}</p>
                : <>
                  <label><span className={LABEL_CLASS}>{t('hole.body')}</span><select value={bodyId} onChange={(event) => chooseBody(Number(event.target.value))} className={INPUT_CLASS}>{planarBodies.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label>
                  <label><span className={LABEL_CLASS}>{t('hole.face')}</span><select data-testid="hole-face" value={faceId} onChange={(event) => chooseFace(Number(event.target.value))} className={INPUT_CLASS}>{faces.map((face, index) => <option key={face.id} value={face.id}>{t('hole.face')} {index + 1} (#{face.id})</option>)}</select></label>
                  <div className="grid grid-cols-2 gap-2"><label><span className={LABEL_CLASS}>{t('hole.positionX')}</span><DimensionInput step="any" value={x} onValueChange={(value) => { setX(value); setPickedSketchPoints([]); }} /></label><label><span className={LABEL_CLASS}>{t('hole.positionY')}</span><DimensionInput step="any" value={y} onValueChange={(value) => { setY(value); setPickedSketchPoints([]); }} /></label></div>
                  {pickedSketchPoints.length > 0 && (
                    <div className="rounded border border-accent/40 bg-accent/10 px-2 py-1.5 text-[10px] text-ink">
                      <div className="flex items-center justify-between gap-2">
                        <span>{t('hole.associativeCount').replace('{count}', String(pickedSketchPoints.length))}</span>
                        <button type="button" onClick={() => setPickedSketchPoints([])} className="text-mute hover:text-ink">{t('hole.clearPositions')}</button>
                      </div>
                      <div className="mt-1 truncate font-mono text-[9px] text-mute">
                        {pickedSketchPoints.map((pick) => `${pick.sketch_name}:${pick.entity_id}`).join(', ')}
                      </div>
                    </div>
                  )}
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-ink">
                    <input
                      data-testid="hole-threaded"
                      type="checkbox"
                      checked={threaded}
                      onChange={(event) => {
                        setThreaded(event.target.checked);
                        if (event.target.checked) chooseThreadPreset(selectedThreadPreset.id);
                      }}
                      className="accent-accent"
                    />
                    {t('hole.threaded')}
                  </label>
                  {threaded && (
                    <section className="space-y-2 rounded border border-edge bg-header/50 p-2">
                      <div className="grid grid-cols-2 gap-2">
                        <label>
                          <span className={LABEL_CLASS}>{t('hole.threadStandard')}</span>
                          <select
                            data-testid="hole-thread-standard"
                            value={threadStandard}
                            onChange={(event) => chooseThreadStandard(
                              event.target.value as HoleThreadStandard,
                            )}
                            className={INPUT_CLASS}
                          >
                            <option value="iso_metric">{t('hole.isoMetric')}</option>
                            <option value="unified_inch">{t('hole.asmeUnified')}</option>
                          </select>
                        </label>
                        <label>
                          <span className={LABEL_CLASS}>{t('hole.threadSeries')}</span>
                          <select
                            value={threadSeries}
                            onChange={(event) => chooseThreadSeries(
                              event.target.value as HoleThreadSeries,
                            )}
                            className={INPUT_CLASS}
                          >
                            {threadStandard === 'iso_metric' ? (
                              <>
                                <option value="metric_coarse">{t('hole.metricCoarse')}</option>
                                <option value="metric_fine">{t('hole.metricFine')}</option>
                              </>
                            ) : (
                              <>
                                <option value="unc">{t('hole.unc')}</option>
                                <option value="unf">{t('hole.unf')}</option>
                              </>
                            )}
                          </select>
                        </label>
                      </div>
                      <label>
                        <span className={LABEL_CLASS}>{t('hole.threadSize')}</span>
                        <select
                          data-testid="hole-thread-size"
                          value={selectedThreadPreset.id}
                          onChange={(event) => chooseThreadPreset(event.target.value)}
                          className={INPUT_CLASS}
                        >
                          {threadPresets.map((preset) => (
                            <option key={preset.id} value={preset.id}>{preset.label}</option>
                          ))}
                        </select>
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <label>
                          <span className={LABEL_CLASS}>{t('hole.threadRepresentation')}</span>
                          <select
                            data-testid="hole-thread-representation"
                            value={threadRepresentation}
                            onChange={(event) => setThreadRepresentation(
                              event.target.value as HoleThreadRepresentation,
                            )}
                            className={INPUT_CLASS}
                          >
                            <option value="modeled">{t('hole.modeledThread')}</option>
                            <option value="simplified">{t('hole.simplifiedThread')}</option>
                          </select>
                        </label>
                        <label>
                          <span className={LABEL_CLASS}>{t('hole.threadHand')}</span>
                          <select
                            value={threadHand}
                            onChange={(event) => setThreadHand(
                              event.target.value as HoleThreadHand,
                            )}
                            className={INPUT_CLASS}
                          >
                            <option value="right">{t('hole.rightHand')}</option>
                            <option value="left">{t('hole.leftHand')}</option>
                          </select>
                        </label>
                      </div>
                      <label className="flex cursor-pointer items-center gap-2 text-[11px] text-ink">
                        <input
                          type="checkbox"
                          checked={fullThreadDepth}
                          onChange={(event) => setFullThreadDepth(event.target.checked)}
                          className="accent-accent"
                        />
                        {t('hole.fullThreadDepth')}
                      </label>
                      {!fullThreadDepth && (
                        <label>
                          <span className={LABEL_CLASS}>{t('hole.threadDepth')}</span>
                          <DimensionInput
                            data-testid="hole-thread-depth"
                            min="0.000001"
                            step="any"
                            value={threadDepth}
                            onValueChange={setThreadDepth}
                          />
                        </label>
                      )}
                      <p className="text-[10px] leading-4 text-mute">
                        {t(threadRepresentation === 'modeled'
                          ? 'hole.modeledThreadHint'
                          : 'hole.simplifiedThreadHint')}
                      </p>
                      <dl className="grid grid-cols-[1fr_auto] gap-x-2 gap-y-1 text-[10px]">
                        <dt className="text-mute">{t('hole.majorDiameter')}</dt>
                        <dd className="font-mono text-ink">
                          Ø{selectedThreadPreset.nominalDiameterMm.toFixed(3)} mm
                        </dd>
                        <dt className="text-mute">{t('hole.pitch')}</dt>
                        <dd className="font-mono text-ink">
                          {selectedThreadPreset.pitchMm.toFixed(4)} mm
                          {selectedThreadPreset.threadsPerInch
                            ? ` (${selectedThreadPreset.threadsPerInch} TPI)`
                            : ''}
                        </dd>
                        <dt className="text-mute">{t('hole.threadClass')}</dt>
                        <dd className="font-mono text-ink">{selectedThreadPreset.class}</dd>
                      </dl>
                    </section>
                  )}
                  <label><span className={LABEL_CLASS}>{t(threaded ? 'hole.predrillDiameter' : 'hole.diameter')}</span><DimensionInput data-testid="hole-diameter" min="0.000001" step="any" value={diameter} onValueChange={setDiameter} /></label>
                  <label><span className={LABEL_CLASS}>{t('hole.extent')}</span><select data-testid="hole-extent" value={extentType} onChange={(event) => setExtentType(event.target.value as HoleExtent['type'])} className={INPUT_CLASS}><option value="through_all">{t('hole.throughAll')}</option><option value="distance">{t('hole.distance')}</option></select></label>
                  {extentType === 'distance' && <label><span className={LABEL_CLASS}>{t('hole.depth')}</span><DimensionInput min="0.000001" step="any" value={depth} onValueChange={setDepth} /></label>}
                  <label><span className={LABEL_CLASS}>{t('hole.style')}</span><select value={style} onChange={(event) => setStyle(event.target.value as HoleStyle)} className={INPUT_CLASS}><option value="simple">{t('hole.simple')}</option><option value="counterbore">{t('hole.counterbore')}</option><option value="countersink">{t('hole.countersink')}</option></select></label>
                  {style === 'counterbore' && <div className="grid grid-cols-2 gap-2"><label><span className={LABEL_CLASS}>{t('hole.counterboreDiameter')}</span><DimensionInput step="any" value={counterboreDiameter} onValueChange={setCounterboreDiameter} /></label><label><span className={LABEL_CLASS}>{t('hole.counterboreDepth')}</span><DimensionInput step="any" value={counterboreDepth} onValueChange={setCounterboreDepth} /></label></div>}
                  {style === 'countersink' && <div className="grid grid-cols-2 gap-2"><label><span className={LABEL_CLASS}>{t('hole.countersinkDiameter')}</span><DimensionInput step="any" value={countersinkDiameter} onValueChange={setCountersinkDiameter} /></label><label><span className={LABEL_CLASS}>{t('hole.angle')}</span><DimensionInput step="any" value={countersinkAngle} onValueChange={setCountersinkAngle} /></label></div>}
                  <label><span className={LABEL_CLASS}>{t('hole.bottomStyle')}</span><select data-testid="hole-bottom-style" value={bottomStyle} onChange={(event) => setBottomStyle(event.target.value as HoleBottomStyle)} className={INPUT_CLASS}><option value="drill_point">{t('hole.drillPoint')}</option><option value="flat">{t('hole.flatBottom')}</option></select></label>
                  {bottomStyle === 'drill_point' && extentType === 'distance' && <label><span className={LABEL_CLASS}>{t('hole.drillPointAngle')}</span><DimensionInput data-testid="hole-drill-point-angle" min="0.000001" max="179.999999" step="any" value={drillPointAngle} onValueChange={setDrillPointAngle} /></label>}
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-ink"><input type="checkbox" checked={flip} onChange={(event) => setFlip(event.target.checked)} className="accent-accent" />{t('hole.flip')}</label>
                  <p className="text-[10px] text-mute">{t('hole.selectionHint')}</p>
                </>}
        </div>
        <footer className="flex h-11 shrink-0 items-center justify-end gap-2 border-t border-edge bg-header px-3"><button type="button" onClick={close} disabled={busy} className="h-7 rounded border border-edge px-3 text-xs text-ink hover:bg-edge">{t('hole.cancel')}</button><button data-testid="hole-ok" type="submit" disabled={!canSubmit} className="h-7 rounded bg-accent px-3 text-xs font-semibold text-white disabled:opacity-40">{t('hole.ok')}</button></footer>
      </form>
    </div>
  );
}
