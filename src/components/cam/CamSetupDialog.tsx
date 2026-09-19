import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { MousePointer2, X } from 'lucide-react';
import { CamToolIcon } from './CamToolIcon';
import { createCamSetup, replaceCamSetup, type CamSetupDraft } from '../../cam/document';
import { readDefaultMachine, reviseMachine, saveDefaultMachine } from '../../cam/machines';
import { CamMachineFields } from './CamMachineFields';
import {
  boxLatticePoints,
  listSketchPointRefs,
  modelBoundsOfBodies,
  resolveStock,
  resolveWcsOrigin,
  sketchUvToModel,
  stockToSetup,
  wcsFromOrientation,
  type Bounds3,
} from '../../cam/geometry';
import { cancelCamPointPick, requestCamPointPick } from '../../cam/pointPick';
import { commitLength, displayLength } from '../../cam/units';
import type {
  CamBoxAnchor,
  CamSetupDto,
  CamStockFace,
  CamStockShape,
  CamStockSpecDto,
  CamWcsOriginSpec,
  CamWorkOffset,
} from '../../engine/types';
import { useAppStore, type CamPointPickCandidate } from '../../store/appStore';
import { useTranslation } from '../../i18n';
import { runCamAction } from './CamBrowser';
import {
  CAM_DIALOG_INPUT,
  CAM_DIALOG_LABEL,
  DialogSection,
  DraftNumber,
  lengthUnit,
  parseDraft,
} from './camFields';

type OriginMode = CamWcsOriginSpec['mode'];
type StockMode = 'fixed' | 'from_model' | 'rest_from_setup';

const ANCHOR_LABELS: Record<CamBoxAnchor, string> = {
  min: 'cam.setup.anchorMin',
  center: 'cam.setup.anchorCenter',
  max: 'cam.setup.anchorMax',
};

const WORK_OFFSETS: CamWorkOffset[] = ['g54', 'g55', 'g56', 'g57', 'g58', 'g59'];

const FACE_LABELS: Record<CamStockFace, string> = {
  x_min: 'cam.setup.faceModelXMin',
  x_max: 'cam.setup.faceModelXMax',
  y_min: 'cam.setup.faceModelYMin',
  y_max: 'cam.setup.faceModelYMax',
  z_min: 'cam.setup.faceModelBottom',
  z_max: 'cam.setup.faceModelTop',
};

/** Fully operator-driven setup creation: bodies, stock definition, WCS origin
 *  picked on the geometry, orientation, and work offsets. Nothing is derived
 *  silently — every derived value is previewed before the setup is created.
 *  Editing reuses this exact dialog: drafts seed from the stored setup and
 *  Save writes back through the same validation as Create. */
export function CamSetupDialog({ editing }: { editing?: CamSetupDto }) {
  const { t } = useTranslation();
  const cam = useAppStore((state) => state.camDocument);
  const scene = useAppStore((state) => state.solidScene);
  const sketches = useAppStore((state) => state.finishedSketches);
  const pickSession = useAppStore((state) => state.camPointPick);
  const close = () => useAppStore.getState().setCamDialog(null);
  const units = cam.units;
  const lu = lengthUnit(units);

  // --- Editing seeds: re-express the stored spec as dialog drafts ----------
  const spec = editing?.stock_spec ?? null;
  const wcsSeed = editing?.wcs_origin ?? null;
  const seedLen = (mm: number) => String(Number(displayLength(mm, units).toFixed(4)) + 0);
  // Reverse the stored WCS axes into the (zDown, rotation) pair this dialog
  // can express, by replaying every orientation and comparing axes.
  const orientationSeed = (() => {
    const fallback = { zDown: false, rotation: 0 as 0 | 90 | 180 | 270 };
    if (!editing) return fallback;
    const close = (a: [number, number, number], b: [number, number, number]) =>
      Math.abs(a[0] - b[0]) < 1e-9 &&
      Math.abs(a[1] - b[1]) < 1e-9 &&
      Math.abs(a[2] - b[2]) < 1e-9;
    for (const zd of [false, true]) {
      for (const rot of [0, 90, 180, 270] as const) {
        const wcs = wcsFromOrientation(editing.wcs.origin, zd, rot);
        if (
          close(wcs.x_axis, editing.wcs.x_axis) &&
          close(wcs.y_axis, editing.wcs.y_axis) &&
          close(wcs.z_axis, editing.wcs.z_axis)
        ) {
          return { zDown: zd, rotation: rot };
        }
      }
    }
    return fallback;
  })();
  const boxAnchors =
    wcsSeed?.mode === 'stock_box_point' || wcsSeed?.mode === 'model_box_point' ? wcsSeed : null;
  // Rest machining must continue from a DIFFERENT setup than the one edited.
  const restCandidates = cam.setups.filter((setup) => setup.id !== editing?.id);

  const [name, setName] = useState(editing?.name ?? t('cam.setup.defaultName').replace('{number}', String(cam.setups.length + 1)));
  const [bodyIds, setBodyIds] = useState<number[]>(
    editing?.body_ids ?? scene.bodies.map((body) => body.id),
  );

  // --- Stock drafts (display units; converted once at submit) --------------
  const [stockShape, setStockShape] = useState<CamStockShape>(
    spec?.mode === 'fixed' || spec?.mode === 'from_model'
      ? spec.shape
      : spec?.mode === 'model_body'
        ? 'model_body'
        : 'box',
  );
  const [stockMode, setStockMode] = useState<StockMode>(
    spec?.mode === 'fixed'
      ? 'fixed'
      : spec?.mode === 'rest_from_setup'
        ? 'rest_from_setup'
        : 'from_model',
  );
  const modelBoundsAtMount = useMemo(
    () => modelBoundsOfBodies(scene, scene.bodies.map((body) => body.id)),
    // Prefill only: deliberate mount-time snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const prefill = (valueMm: number) => displayLength(valueMm, units).toFixed(3);
  const [sizeX, setSizeX] = useState(() =>
    spec?.mode === 'fixed'
      ? seedLen(spec.size.x)
      : prefill(modelBoundsAtMount ? modelBoundsAtMount.max.x - modelBoundsAtMount.min.x + 4 : 60),
  );
  const [sizeY, setSizeY] = useState(() =>
    spec?.mode === 'fixed' && spec.shape === 'box'
      ? seedLen(spec.size.y)
      : prefill(modelBoundsAtMount ? modelBoundsAtMount.max.y - modelBoundsAtMount.min.y + 4 : 60),
  );
  const [sizeZ, setSizeZ] = useState(() =>
    spec?.mode === 'fixed'
      ? seedLen(spec.size.z)
      : prefill(modelBoundsAtMount ? modelBoundsAtMount.max.z - modelBoundsAtMount.min.z + 3 : 30),
  );
  const [centered, setCentered] = useState(spec?.mode === 'fixed' ? spec.placement.center : true);
  const [face, setFace] = useState<CamStockFace>(
    spec?.mode === 'fixed' ? (spec.placement.face ?? 'z_min') : 'z_min',
  );
  const [faceOffset, setFaceOffset] = useState(
    spec?.mode === 'fixed' ? seedLen(spec.placement.offset) : '0',
  );
  const [offXMin, setOffXMin] = useState(spec?.mode === 'from_model' ? seedLen(spec.offsets.x_min) : prefill(2));
  const [offXMax, setOffXMax] = useState(spec?.mode === 'from_model' ? seedLen(spec.offsets.x_max) : prefill(2));
  const [offYMin, setOffYMin] = useState(spec?.mode === 'from_model' ? seedLen(spec.offsets.y_min) : prefill(2));
  const [offYMax, setOffYMax] = useState(spec?.mode === 'from_model' ? seedLen(spec.offsets.y_max) : prefill(2));
  const [offZMin, setOffZMin] = useState(spec?.mode === 'from_model' ? seedLen(spec.offsets.z_min) : prefill(2));
  const [offZMax, setOffZMax] = useState(spec?.mode === 'from_model' ? seedLen(spec.offsets.z_max) : prefill(1));
  const [radial, setRadial] = useState(spec?.mode === 'from_model' ? seedLen(spec.offsets.x_min) : prefill(2));
  const [restSetupId, setRestSetupId] = useState(spec?.mode === 'rest_from_setup' ? String(spec.setup_id) : '');
  const [stockBodyId, setStockBodyId] = useState(spec?.mode === 'model_body' ? String(spec.body_id) : '');

  // --- WCS drafts -----------------------------------------------------------
  const [originMode, setOriginMode] = useState<OriginMode>(wcsSeed?.mode ?? 'stock_box_point');
  const [anchorX, setAnchorX] = useState<CamBoxAnchor>(boxAnchors?.x ?? 'min');
  const [anchorY, setAnchorY] = useState<CamBoxAnchor>(boxAnchors?.y ?? 'min');
  const [anchorZ, setAnchorZ] = useState<CamBoxAnchor>(boxAnchors?.z ?? 'max');
  const [sketchPointKey, setSketchPointKey] = useState(
    wcsSeed?.mode === 'sketch_point' ? `${wcsSeed.sketch}:${wcsSeed.entity_id}` : '',
  );
  const [explicit, setExplicit] = useState(
    editing
      ? { x: seedLen(editing.wcs.origin.x), y: seedLen(editing.wcs.origin.y), z: seedLen(editing.wcs.origin.z) }
      : { x: '0', y: '0', z: '0' },
  );
  const [zDown, setZDown] = useState(orientationSeed.zDown);
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(orientationSeed.rotation);

  // --- Work offsets ----------------------------------------------------------
  const [workOffset, setWorkOffset] = useState<CamWorkOffset>(editing?.work_offset ?? 'g54');
  const [partCount, setPartCount] = useState(String(editing?.work_offset_count ?? 1));

  const [error, setError] = useState<string | null>(null);
  // Old projects stay generic. Only a genuinely new setup uses the device default.
  const [machine, setMachine] = useState(() => editing ? editing.machine ?? null : readDefaultMachine());
  const [makeDefaultMachine, setMakeDefaultMachine] = useState(false);

  // Cancel any dangling pick session when the dialog closes.
  useEffect(() => () => cancelCamPointPick(), []);

  const pointRefs = useMemo(() => listSketchPointRefs(sketches), [sketches]);
  const modelBounds: Bounds3 | null = useMemo(
    () => modelBoundsOfBodies(scene, bodyIds),
    [scene, bodyIds],
  );

  /** Parse the stock drafts. `lenient` returns null instead of throwing so
   *  the live preview can simply disappear while the operator is typing. */
  const buildStockSpec = (lenient: boolean): CamStockSpecDto | null => {
    try {
      if (stockShape === 'model_body') {
        const bodyId = Number(stockBodyId || scene.bodies[0]?.id);
        if (!bodyId) throw new Error(t('cam.setup.errorPickStockBody'));
        return { mode: 'model_body', body_id: bodyId };
      }
      if (stockMode === 'fixed') {
        return {
          mode: 'fixed',
          shape: stockShape,
          size: {
            x: commitLength(parseDraft(sizeX, stockShape === 'box' ? t('cam.setup.sizeX') : stockShape === 'cylinder' ? t('cam.setup.diameter') : t('cam.setup.acrossFlats')), units),
            y: stockShape === 'box' ? commitLength(parseDraft(sizeY, t('cam.setup.sizeY')), units) : 0,
            z: commitLength(parseDraft(sizeZ, t('cam.setup.height')), units),
          },
          placement: {
            center: centered,
            face: centered ? null : face,
            offset: centered ? 0 : commitLength(parseDraft(faceOffset, t('cam.setup.faceOffset')), units),
          },
        };
      }
      if (stockMode === 'from_model') {
        const allowance = (value: string, label: string) =>
          commitLength(parseDraft(value, label), units);
        const offsets =
          stockShape === 'box'
            ? {
                x_min: allowance(offXMin, t('cam.setup.allowanceXMin')),
                x_max: allowance(offXMax, t('cam.setup.allowanceXMax')),
                y_min: allowance(offYMin, t('cam.setup.allowanceYMin')),
                y_max: allowance(offYMax, t('cam.setup.allowanceYMax')),
                z_min: allowance(offZMin, t('cam.setup.allowanceZMin')),
                z_max: allowance(offZMax, t('cam.setup.allowanceZMax')),
              }
            : {
                x_min: allowance(radial, t('cam.setup.radialAllowance')),
                x_max: allowance(radial, t('cam.setup.radialAllowance')),
                y_min: allowance(radial, t('cam.setup.radialAllowance')),
                y_max: allowance(radial, t('cam.setup.radialAllowance')),
                z_min: allowance(offZMin, t('cam.setup.allowanceZMin')),
                z_max: allowance(offZMax, t('cam.setup.allowanceZMax')),
              };
        return { mode: 'from_model', shape: stockShape, offsets };
      }
      const sourceId = Number(restSetupId || restCandidates[0]?.id);
      if (!sourceId) throw new Error(t('cam.setup.errorPickEarlierSetup'));
      return { mode: 'rest_from_setup', setup_id: sourceId };
    } catch (cause) {
      if (lenient) return null;
      throw cause;
    }
  };

  const specPreview = useMemo(
    () => buildStockSpec(true),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      stockShape, stockMode, sizeX, sizeY, sizeZ, centered, face, faceOffset,
      offXMin, offXMax, offYMin, offYMax, offZMin, offZMax, radial,
      restSetupId, stockBodyId, units, scene, cam.setups,
    ],
  );

  const restSource =
    specPreview?.mode === 'rest_from_setup'
      ? cam.setups.find((setup) => setup.id === specPreview.setup_id) ?? null
      : null;

  /** Live-resolved stock envelope (model coordinates) for preview + lattice
   *  picking. Null while drafts are incomplete. */
  const stockPreview = useMemo(() => {
    if (!specPreview) return null;
    try {
      const stockBounds =
        specPreview.mode === 'model_body'
          ? modelBoundsOfBodies(scene, [specPreview.body_id])
          : modelBounds;
      return resolveStock(specPreview, stockBounds, restSource, rotation);
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specPreview, modelBounds, restSource, rotation, scene]);

  const originSpec: CamWcsOriginSpec = useMemo(() => {
    if (originMode === 'stock_box_point' || originMode === 'model_box_point') {
      return { mode: originMode, x: anchorX, y: anchorY, z: anchorZ };
    }
    if (originMode === 'sketch_point') {
      const [sketch, id] = sketchPointKey.split(':');
      return { mode: 'sketch_point', sketch: sketch ?? '', entity_id: Number(id ?? 0) };
    }
    return { mode: 'explicit' };
  }, [originMode, anchorX, anchorY, anchorZ, sketchPointKey]);

  // Rest machining inherits the source setup's WCS; anything else would cut a
  // different frame into the same remaining material.
  const inheritsWcs = specPreview?.mode === 'rest_from_setup' && restSource !== null;

  /** Live preview of the resolved WCS + stock, in display units. */
  const preview = useMemo(() => {
    if (!stockPreview) return null;
    if (inheritsWcs && restSource) {
      return { origin: restSource.wcs.origin, stock: restSource.stock };
    }
    try {
      const origin =
        originSpec.mode === 'explicit'
          ? {
              x: commitLength(parseDraft(explicit.x, t('cam.setup.originX')), units),
              y: commitLength(parseDraft(explicit.y, t('cam.setup.originY')), units),
              z: commitLength(parseDraft(explicit.z, t('cam.setup.originZ')), units),
            }
          : resolveWcsOrigin(originSpec, stockPreview.modelBox, modelBounds, sketches);
      const wcs = wcsFromOrientation(origin, zDown, rotation);
      const stock = stockToSetup(stockPreview.modelBox, wcs);
      return { origin, stock };
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stockPreview, inheritsWcs, restSource, originSpec, explicit, units, modelBounds, sketches, zDown, rotation]);

  /** Start a viewport pick session; the dialog hides (but stays mounted)
   *  while the session is active. */
  const startPick = (
    candidates: CamPointPickCandidate[],
    prompt: string,
    apply: (chosen: CamPointPickCandidate) => void,
  ) => {
    if (candidates.length === 0) return;
    void requestCamPointPick(candidates, prompt).then((chosen) => {
      if (chosen) apply(chosen);
    });
  };

  const pickStockBoxPoint = () => {
    if (!stockPreview) return;
    startPick(
      boxLatticePoints(stockPreview.modelBox).map((entry) => ({
        point: entry.point,
        label: entry.label,
        payload: { x: entry.x, y: entry.y, z: entry.z },
      })),
      t('cam.setup.pickStockBoxPoint'),
      (chosen) => {
        const anchors = chosen.payload as { x: CamBoxAnchor; y: CamBoxAnchor; z: CamBoxAnchor };
        setAnchorX(anchors.x);
        setAnchorY(anchors.y);
        setAnchorZ(anchors.z);
      },
    );
  };

  const pickModelBoxPoint = () => {
    if (!modelBounds) return;
    startPick(
      boxLatticePoints({ min: modelBounds.min, max: modelBounds.max }).map((entry) => ({
        point: entry.point,
        label: entry.label,
        payload: { x: entry.x, y: entry.y, z: entry.z },
      })),
      t('cam.setup.pickModelBoxPoint'),
      (chosen) => {
        const anchors = chosen.payload as { x: CamBoxAnchor; y: CamBoxAnchor; z: CamBoxAnchor };
        setAnchorX(anchors.x);
        setAnchorY(anchors.y);
        setAnchorZ(anchors.z);
      },
    );
  };

  const pickSketchPoint = () => {
    startPick(
      pointRefs.flatMap((ref) => {
        const sketch = sketches.find((candidate) => candidate.name === ref.sketch);
        return sketch
          ? [
              {
                point: sketchUvToModel(sketch.basis, ref.uv),
                label: ref.label,
                payload: `${ref.sketch}:${ref.entityId}`,
              },
            ]
          : [];
      }),
      t('cam.setup.pickSketchPoint'),
      (chosen) => setSketchPointKey(chosen.payload as string),
    );
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      if (bodyIds.length === 0) throw new Error(t('cam.setup.errorSelectBody'));
      const stockSpec = buildStockSpec(false);
      if (!stockSpec) throw new Error(t('cam.setup.errorCompleteStock'));
      if (originSpec.mode === 'sketch_point' && !originSpec.sketch) {
        throw new Error(t('cam.setup.errorPickSketchPoint'));
      }
      const firstIndex = WORK_OFFSETS.indexOf(workOffset);
      const count = Math.max(
        1,
        Math.min(WORK_OFFSETS.length - firstIndex, Math.round(parseDraft(partCount, t('cam.setup.duplicateParts')))),
      );
      const draft: CamSetupDraft = {
        name,
        machine: machine ? reviseMachine(
          editing?.machine?.profile.id === machine.profile.id ? editing.machine : machine,
          machine.profile.name, machine.profile.post,
        ) : null,
        body_ids: bodyIds,
        work_offset: workOffset,
        work_offset_count: count,
        stock_spec: stockSpec,
        wcs_origin: originSpec,
        explicit_origin: {
          x: commitLength(parseDraft(explicit.x, t('cam.setup.originX')), units),
          y: commitLength(parseDraft(explicit.y, t('cam.setup.originY')), units),
          z: commitLength(parseDraft(explicit.z, t('cam.setup.originZ')), units),
        },
        z_down: zDown,
        z_rotation_deg: rotation,
      };
      runCamAction(() =>
        (editing ? replaceCamSetup(editing.id, draft) : createCamSetup(draft)).then(() => {
          if (makeDefaultMachine) saveDefaultMachine(draft.machine ?? null);
          close();
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const anchorSelect = (
    label: string,
    value: CamBoxAnchor,
    onChange: (anchor: CamBoxAnchor) => void,
  ) => (
    <label className="block">
      <span className={CAM_DIALOG_LABEL}>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as CamBoxAnchor)}
        className={CAM_DIALOG_INPUT}
      >
        {(Object.keys(ANCHOR_LABELS) as CamBoxAnchor[]).map((anchor) => (
          <option key={anchor} value={anchor}>
            {t(ANCHOR_LABELS[anchor])}
          </option>
        ))}
      </select>
    </label>
  );

  // While a viewport pick session is running the dialog steps aside (state is
  // preserved; the viewport renders the candidates and owns the click).
  if (pickSession) return null;

  const isRoundStock = stockShape === 'cylinder' || stockShape === 'hex';

  return (
    <div
      data-native-viewport-dim="0.25"
      className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center bg-black/25 p-6"
    >
      <form
        data-testid="cam-setup-dialog"
        onSubmit={submit}
        className="feature-dialog pointer-events-auto flex max-h-full w-[560px] max-w-full flex-col overflow-hidden rounded border border-edge bg-panel shadow-2xl"
      >
        <header className="flex h-10 shrink-0 items-center gap-2 border-b border-edge px-3">
          <CamToolIcon id={editing ? 'camSetup' : 'camNewSetup'} size={18} />
          <span className="flex-1 text-xs font-semibold text-ink">
            {editing ? t('cam.setup.editTitle').replace('{name}', editing.name) : t('cam.setup.newTitle')}
          </span>
          <button
            type="button"
            onClick={close}
            className="rounded p-1 text-mute hover:bg-edge hover:text-ink"
          >
            <X size={14} />
          </button>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
          {error && (
            <p className="rounded border border-warn/40 bg-warn/10 p-2 text-[10px] text-warn">
              {error}
            </p>
          )}
          <label className="block">
            <span className={CAM_DIALOG_LABEL}>{t('cam.setup.name')}</span>
            <input value={name} onChange={(event) => setName(event.target.value)} className={CAM_DIALOG_INPUT} />
          </label>

          <CamMachineFields machine={machine} onChange={setMachine} />
          <label className="flex items-center gap-2 text-[11px] text-ink">
            <input type="checkbox" checked={makeDefaultMachine} onChange={e => setMakeDefaultMachine(e.target.checked)} />
            {t('cam.setup.useDefaultMachine')}
          </label>

          <DialogSection title={t('cam.setup.sectionPartBodies').replace('{count}', String(bodyIds.length))}>
            <div className="max-h-28 space-y-1 overflow-y-auto rounded border border-edge/70 p-1.5">
              {scene.bodies.map((body) => (
                <label key={body.id} className="flex items-center gap-2 text-[11px] text-ink">
                  <input
                    type="checkbox"
                    checked={bodyIds.includes(body.id)}
                    onChange={(event) =>
                      setBodyIds((current) =>
                        event.target.checked
                          ? [...current, body.id]
                          : current.filter((id) => id !== body.id),
                      )
                    }
                  />
                  <span className="truncate">{body.name}</span>
                </label>
              ))}
            </div>
          </DialogSection>

          <DialogSection title={t('cam.setup.sectionStock')}>
            <div className="grid grid-cols-2 gap-1.5">
              <label className="block">
                <span className={CAM_DIALOG_LABEL}>{t('cam.setup.shape')}</span>
                <select
                  value={stockShape}
                  onChange={(event) => setStockShape(event.target.value as CamStockShape)}
                  className={CAM_DIALOG_INPUT}
                >
                  <option value="box">{t('cam.setup.shapeBox')}</option>
                  <option value="cylinder">{t('cam.setup.shapeCylinder')}</option>
                  <option value="hex">{t('cam.setup.shapeHex')}</option>
                  <option value="model_body">{t('cam.setup.shapeModelBody')}</option>
                </select>
              </label>
              {stockShape !== 'model_body' && (
                <label className="block">
                  <span className={CAM_DIALOG_LABEL}>{t('cam.setup.definition')}</span>
                  <select
                    value={stockMode}
                    onChange={(event) => setStockMode(event.target.value as StockMode)}
                    className={CAM_DIALOG_INPUT}
                  >
                    <option value="fixed">{t('cam.setup.defFixed')}</option>
                    <option value="from_model">{t('cam.setup.defFromModel')}</option>
                    <option value="rest_from_setup">{t('cam.setup.defRest')}</option>
                  </select>
                </label>
              )}
            </div>

            {stockShape !== 'model_body' && stockMode === 'fixed' && (
              <div className="mt-2 space-y-2">
                <div className="grid grid-cols-3 gap-2">
                  <DraftNumber
                    label={stockShape === 'box' ? t('cam.setup.sizeX') : stockShape === 'cylinder' ? t('cam.setup.diameter') : t('cam.setup.acrossFlats')}
                    value={sizeX}
                    onChange={setSizeX}
                    unit={lu}
                  />
                  {stockShape === 'box' && (
                    <DraftNumber label={t('cam.setup.sizeY')} value={sizeY} onChange={setSizeY} unit={lu} />
                  )}
                  <DraftNumber label={t('cam.setup.heightZ')} value={sizeZ} onChange={setSizeZ} unit={lu} />
                </div>
                <label className="flex items-center gap-2 text-[11px] text-ink">
                  <input
                    type="checkbox"
                    checked={centered}
                    onChange={(event) => setCentered(event.target.checked)}
                  />
                  {t('cam.setup.centerModel')}
                </label>
                {!centered && (
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className={CAM_DIALOG_LABEL}>{t('cam.setup.parkAgainst')}</span>
                      <select
                        value={face}
                        onChange={(event) => setFace(event.target.value as CamStockFace)}
                        className={CAM_DIALOG_INPUT}
                      >
                        {(Object.keys(FACE_LABELS) as CamStockFace[]).map((candidate) => (
                          <option key={candidate} value={candidate}>
                            {t(FACE_LABELS[candidate])}
                          </option>
                        ))}
                      </select>
                    </label>
                    <DraftNumber
                      label={t('cam.setup.gapToFace')}
                      value={faceOffset}
                      onChange={setFaceOffset}
                      unit={lu}
                    />
                  </div>
                )}
              </div>
            )}

            {stockShape !== 'model_body' && stockMode === 'from_model' && (
              <div className="mt-2">
                {stockShape === 'box' ? (
                  <div className="grid grid-cols-3 gap-2">
                    <DraftNumber label={t('cam.setup.xMinus')} value={offXMin} onChange={setOffXMin} unit={lu} />
                    <DraftNumber label={t('cam.setup.xPlus')} value={offXMax} onChange={setOffXMax} unit={lu} />
                    <DraftNumber label={t('cam.setup.yMinus')} value={offYMin} onChange={setOffYMin} unit={lu} />
                    <DraftNumber label={t('cam.setup.yPlus')} value={offYMax} onChange={setOffYMax} unit={lu} />
                    <DraftNumber label={t('cam.setup.zMinus')} value={offZMin} onChange={setOffZMin} unit={lu} />
                    <DraftNumber label={t('cam.setup.zPlus')} value={offZMax} onChange={setOffZMax} unit={lu} />
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    <DraftNumber label={t('cam.setup.radial')} value={radial} onChange={setRadial} unit={lu} />
                    <DraftNumber label={t('cam.setup.zMinus')} value={offZMin} onChange={setOffZMin} unit={lu} />
                    <DraftNumber label={t('cam.setup.zPlus')} value={offZMax} onChange={setOffZMax} unit={lu} />
                  </div>
                )}
                <p className="mt-1.5 text-[9px] leading-relaxed text-mute">
                  {t('cam.setup.allowanceHelp')}
                  {isRoundStock && t('cam.setup.roundShapeHelp')}
                </p>
              </div>
            )}

            {stockShape !== 'model_body' && stockMode === 'rest_from_setup' && (
              <div className="mt-2">
                {restCandidates.length > 0 ? (
                  <label className="block">
                    <span className={CAM_DIALOG_LABEL}>{t('cam.setup.continueFrom')}</span>
                    <select
                      value={restSetupId || String(restCandidates[0]?.id ?? '')}
                      onChange={(event) => setRestSetupId(event.target.value)}
                      className={CAM_DIALOG_INPUT}
                    >
                      {restCandidates.map((setup) => (
                        <option key={setup.id} value={setup.id}>
                          {setup.name}{t('cam.setup.remainingStockSuffix')}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <p className="text-[10px] italic text-mute">
                    {t('cam.setup.noEarlierSetup')}
                  </p>
                )}
              </div>
            )}

            {stockShape === 'model_body' && (
              <div className="mt-2">
                <label className="block">
                  <span className={CAM_DIALOG_LABEL}>{t('cam.setup.stockBody')}</span>
                  <select
                    value={stockBodyId || String(scene.bodies[0]?.id ?? '')}
                    onChange={(event) => setStockBodyId(event.target.value)}
                    className={CAM_DIALOG_INPUT}
                  >
                    {scene.bodies.map((body) => (
                      <option key={body.id} value={body.id}>
                        {body.name}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="mt-1.5 text-[9px] leading-relaxed text-mute">
                  {t('cam.setup.stockBodyHelp')}
                </p>
              </div>
            )}

            {stockPreview && (
              <div className="mt-2 rounded border border-edge/70 bg-header/40 p-2 font-mono text-[9px] leading-relaxed text-ink">
                {t('cam.setup.stockBoxModel')}{' '}
                {displayLength(stockPreview.modelBox.max.x - stockPreview.modelBox.min.x, units).toFixed(2)} ×{' '}
                {displayLength(stockPreview.modelBox.max.y - stockPreview.modelBox.min.y, units).toFixed(2)} ×{' '}
                {displayLength(stockPreview.modelBox.max.z - stockPreview.modelBox.min.z, units).toFixed(2)} {lu}
              </div>
            )}
          </DialogSection>

          <DialogSection title={t('cam.setup.sectionWcsOrigin')}>
            {inheritsWcs ? (
              <p className="text-[10px] leading-relaxed text-mute">
                {t('cam.setup.restInheritsWcs').replace('{name}', restSource?.name ?? '')}
              </p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-1.5">
                  {(
                    [
                      ['stock_box_point', t('cam.setup.originStockBoxPoint')],
                      ['model_box_point', t('cam.setup.originModelBoxPoint')],
                      ['sketch_point', t('cam.setup.originSketchPoint')],
                      ['explicit', t('cam.setup.originExplicitXyz')],
                    ] as [OriginMode, string][]
                  ).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setOriginMode(mode)}
                      className={`h-7 rounded border text-[10px] font-semibold ${
                        originMode === mode
                          ? 'border-accent/50 bg-accent/15 text-accent'
                          : 'border-edge bg-header/50 text-mute hover:text-ink'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {originMode === 'stock_box_point' && (
                  <div className="mt-2 space-y-2">
                    <button
                      type="button"
                      disabled={!stockPreview}
                      onClick={pickStockBoxPoint}
                      className="flex h-7 w-full items-center justify-center gap-1.5 rounded border border-accent/40 bg-accent/10 text-[10px] font-semibold text-accent hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <MousePointer2 size={12} /> {t('cam.setup.pickStockBoxButton')}
                    </button>
                    <div className="grid grid-cols-3 gap-2">
                      {anchorSelect(t('cam.setup.xAt'), anchorX, setAnchorX)}
                      {anchorSelect(t('cam.setup.yAt'), anchorY, setAnchorY)}
                      {anchorSelect(t('cam.setup.zAt'), anchorZ, setAnchorZ)}
                    </div>
                    {!stockPreview && (
                      <p className="text-[9px] italic text-mute/80">
                        {t('cam.setup.completeStockToPick')}
                      </p>
                    )}
                  </div>
                )}
                {originMode === 'model_box_point' && (
                  <div className="mt-2 space-y-2">
                    <button
                      type="button"
                      disabled={!modelBounds}
                      onClick={pickModelBoxPoint}
                      className="flex h-7 w-full items-center justify-center gap-1.5 rounded border border-accent/40 bg-accent/10 text-[10px] font-semibold text-accent hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <MousePointer2 size={12} /> {t('cam.setup.pickModelBoxButton')}
                    </button>
                    <div className="grid grid-cols-3 gap-2">
                      {anchorSelect(t('cam.setup.xAt'), anchorX, setAnchorX)}
                      {anchorSelect(t('cam.setup.yAt'), anchorY, setAnchorY)}
                      {anchorSelect(t('cam.setup.zAt'), anchorZ, setAnchorZ)}
                    </div>
                  </div>
                )}
                {originMode === 'sketch_point' && (
                  <div className="mt-2 space-y-2">
                    <button
                      type="button"
                      disabled={pointRefs.length === 0}
                      onClick={pickSketchPoint}
                      className="flex h-7 w-full items-center justify-center gap-1.5 rounded border border-accent/40 bg-accent/10 text-[10px] font-semibold text-accent hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <MousePointer2 size={12} /> {t('cam.setup.pickSketchPointButton')}
                    </button>
                    {pointRefs.length > 0 ? (
                      <select
                        value={sketchPointKey}
                        onChange={(event) => setSketchPointKey(event.target.value)}
                        className={CAM_DIALOG_INPUT}
                      >
                        <option value="">{t('cam.setup.orChooseFromList')}</option>
                        {pointRefs.map((ref) => (
                          <option key={`${ref.sketch}:${ref.entityId}`} value={`${ref.sketch}:${ref.entityId}`}>
                            {ref.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <p className="text-[10px] italic text-mute">
                        {t('cam.setup.noSketchPoints')}
                      </p>
                    )}
                  </div>
                )}
                {originMode === 'explicit' && (
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <DraftNumber label="Origin X" value={explicit.x} onChange={(value) => setExplicit((c) => ({ ...c, x: value }))} unit={lu} />
                    <DraftNumber label="Origin Y" value={explicit.y} onChange={(value) => setExplicit((c) => ({ ...c, y: value }))} unit={lu} />
                    <DraftNumber label="Origin Z" value={explicit.z} onChange={(value) => setExplicit((c) => ({ ...c, z: value }))} unit={lu} />
                  </div>
                )}
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className={CAM_DIALOG_LABEL}>{t('cam.setup.zDirection')}</span>
                    <select
                      value={zDown ? 'down' : 'up'}
                      onChange={(event) => setZDown(event.target.value === 'down')}
                      className={CAM_DIALOG_INPUT}
                    >
                      <option value="up">{t('cam.setup.zUp')}</option>
                      <option value="down">{t('cam.setup.zDown')}</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className={CAM_DIALOG_LABEL}>{t('cam.setup.rotateAboutZ')}</span>
                    <select
                      value={rotation}
                      onChange={(event) => setRotation(Number(event.target.value) as 0 | 90 | 180 | 270)}
                      className={CAM_DIALOG_INPUT}
                    >
                      {[0, 90, 180, 270].map((deg) => (
                        <option key={deg} value={deg}>
                          {deg}°
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </>
            )}
            {preview ? (
              <div className="mt-2 rounded border border-accent/30 bg-accent/5 p-2 font-mono text-[9px] leading-relaxed text-ink">
                <div>
                  {t('cam.setup.wcsOriginModel')} {displayLength(preview.origin.x, units).toFixed(3)},{' '}
                  {displayLength(preview.origin.y, units).toFixed(3)},{' '}
                  {displayLength(preview.origin.z, units).toFixed(3)} {lu}
                </div>
                <div>
                  {t('cam.setup.stockInSetup')}{' '}
                  {displayLength(preview.stock.max.x - preview.stock.min.x, units).toFixed(2)} ×{' '}
                  {displayLength(preview.stock.max.y - preview.stock.min.y, units).toFixed(2)} ×{' '}
                  {displayLength(preview.stock.max.z - preview.stock.min.z, units).toFixed(2)} {lu}{' '}
                  · {t('cam.setup.topZ')} {displayLength(preview.stock.max.z, units).toFixed(3)} {lu}
                </div>
              </div>
            ) : (
              <p className="mt-2 text-[9px] italic text-mute/80">
                {t('cam.setup.completeForPreview')}
              </p>
            )}
          </DialogSection>

          <DialogSection title={t('cam.setup.sectionWorkOffsets')}>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className={CAM_DIALOG_LABEL}>{t('cam.setup.firstOffset')}</span>
                <select
                  value={workOffset}
                  onChange={(event) => setWorkOffset(event.target.value as CamWorkOffset)}
                  className={CAM_DIALOG_INPUT}
                >
                  {WORK_OFFSETS.map((offset) => (
                    <option key={offset} value={offset}>
                      {offset.toUpperCase()}
                    </option>
                  ))}
                </select>
              </label>
              <DraftNumber
                label={t('cam.setup.duplicateParts')}
                value={partCount}
                onChange={setPartCount}
                integer
                unit="offsets"
              />
            </div>
            <p className="text-[9px] leading-relaxed text-mute">
              {t('cam.setup.workOffsetsHelp')}
            </p>
          </DialogSection>
        </div>
        <footer className="flex h-11 shrink-0 items-center justify-end gap-2 border-t border-edge px-3">
          <button
            type="button"
            onClick={close}
            className="h-7 rounded border border-edge px-3 text-[10px] font-semibold text-mute hover:text-ink"
          >
            {t('cam.setup.cancel')}
          </button>
          <button
            type="submit"
            className="h-7 rounded border border-accent/50 bg-accent/15 px-3 text-[10px] font-semibold text-accent hover:bg-accent/25"
          >
            {editing ? t('cam.setup.saveChanges') : t('cam.setup.createEmptySetup')}
          </button>
        </footer>
      </form>
    </div>
  );
}
