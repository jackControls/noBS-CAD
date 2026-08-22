import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Crosshair, MousePointer2, X } from 'lucide-react';
import { createCamSetup, type CamSetupDraft } from '../../cam/document';
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
  CamStockFace,
  CamStockShape,
  CamStockSpecDto,
  CamWcsOriginSpec,
  CamWorkOffset,
} from '../../engine/types';
import { useAppStore, type CamPointPickCandidate } from '../../store/appStore';
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
  min: 'Min',
  center: 'Center',
  max: 'Max',
};

const WORK_OFFSETS: CamWorkOffset[] = ['g54', 'g55', 'g56', 'g57', 'g58', 'g59'];

const FACE_LABELS: Record<CamStockFace, string> = {
  x_min: 'Model X min face',
  x_max: 'Model X max face',
  y_min: 'Model Y min face',
  y_max: 'Model Y max face',
  z_min: 'Model bottom (Z min)',
  z_max: 'Model top (Z max)',
};

/** Fully operator-driven setup creation: bodies, stock definition, WCS origin
 *  picked on the geometry, orientation, and work offsets. Nothing is derived
 *  silently — every derived value is previewed before the setup is created. */
export function CamSetupDialog() {
  const cam = useAppStore((state) => state.camDocument);
  const scene = useAppStore((state) => state.solidScene);
  const sketches = useAppStore((state) => state.finishedSketches);
  const pickSession = useAppStore((state) => state.camPointPick);
  const close = () => useAppStore.getState().setCamDialog(null);
  const units = cam.units;
  const lu = lengthUnit(units);

  const [name, setName] = useState(`Setup ${cam.setups.length + 1}`);
  const [bodyIds, setBodyIds] = useState<number[]>(scene.bodies.map((body) => body.id));

  // --- Stock drafts (display units; converted once at submit) --------------
  const [stockShape, setStockShape] = useState<CamStockShape>('box');
  const [stockMode, setStockMode] = useState<StockMode>('from_model');
  const modelBoundsAtMount = useMemo(
    () => modelBoundsOfBodies(scene, scene.bodies.map((body) => body.id)),
    // Prefill only: deliberate mount-time snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const prefill = (valueMm: number) => displayLength(valueMm, units).toFixed(3);
  const [sizeX, setSizeX] = useState(() =>
    prefill(modelBoundsAtMount ? modelBoundsAtMount.max.x - modelBoundsAtMount.min.x + 4 : 60),
  );
  const [sizeY, setSizeY] = useState(() =>
    prefill(modelBoundsAtMount ? modelBoundsAtMount.max.y - modelBoundsAtMount.min.y + 4 : 60),
  );
  const [sizeZ, setSizeZ] = useState(() =>
    prefill(modelBoundsAtMount ? modelBoundsAtMount.max.z - modelBoundsAtMount.min.z + 3 : 30),
  );
  const [centered, setCentered] = useState(true);
  const [face, setFace] = useState<CamStockFace>('z_min');
  const [faceOffset, setFaceOffset] = useState('0');
  const [offXMin, setOffXMin] = useState(prefill(2));
  const [offXMax, setOffXMax] = useState(prefill(2));
  const [offYMin, setOffYMin] = useState(prefill(2));
  const [offYMax, setOffYMax] = useState(prefill(2));
  const [offZMin, setOffZMin] = useState(prefill(2));
  const [offZMax, setOffZMax] = useState(prefill(1));
  const [radial, setRadial] = useState(prefill(2));
  const [restSetupId, setRestSetupId] = useState('');
  const [stockBodyId, setStockBodyId] = useState('');

  // --- WCS drafts -----------------------------------------------------------
  const [originMode, setOriginMode] = useState<OriginMode>('stock_box_point');
  const [anchorX, setAnchorX] = useState<CamBoxAnchor>('min');
  const [anchorY, setAnchorY] = useState<CamBoxAnchor>('min');
  const [anchorZ, setAnchorZ] = useState<CamBoxAnchor>('max');
  const [sketchPointKey, setSketchPointKey] = useState('');
  const [explicit, setExplicit] = useState({ x: '0', y: '0', z: '0' });
  const [zDown, setZDown] = useState(false);
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);

  // --- Work offsets ----------------------------------------------------------
  const [workOffset, setWorkOffset] = useState<CamWorkOffset>('g54');
  const [partCount, setPartCount] = useState('1');

  const [error, setError] = useState<string | null>(null);

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
        if (!bodyId) throw new Error('Pick the modeled body used as stock.');
        return { mode: 'model_body', body_id: bodyId };
      }
      if (stockMode === 'fixed') {
        return {
          mode: 'fixed',
          shape: stockShape,
          size: {
            x: commitLength(parseDraft(sizeX, stockShape === 'box' ? 'Size X' : stockShape === 'cylinder' ? 'Diameter' : 'Across flats'), units),
            y: stockShape === 'box' ? commitLength(parseDraft(sizeY, 'Size Y'), units) : 0,
            z: commitLength(parseDraft(sizeZ, 'Height'), units),
          },
          placement: {
            center: centered,
            face: centered ? null : face,
            offset: centered ? 0 : commitLength(parseDraft(faceOffset, 'Face offset'), units),
          },
        };
      }
      if (stockMode === 'from_model') {
        const allowance = (value: string, label: string) =>
          commitLength(parseDraft(value, label), units);
        const offsets =
          stockShape === 'box'
            ? {
                x_min: allowance(offXMin, 'X min allowance'),
                x_max: allowance(offXMax, 'X max allowance'),
                y_min: allowance(offYMin, 'Y min allowance'),
                y_max: allowance(offYMax, 'Y max allowance'),
                z_min: allowance(offZMin, 'Z min allowance'),
                z_max: allowance(offZMax, 'Z max allowance'),
              }
            : {
                x_min: allowance(radial, 'Radial allowance'),
                x_max: allowance(radial, 'Radial allowance'),
                y_min: allowance(radial, 'Radial allowance'),
                y_max: allowance(radial, 'Radial allowance'),
                z_min: allowance(offZMin, 'Z min allowance'),
                z_max: allowance(offZMax, 'Z max allowance'),
              };
        return { mode: 'from_model', shape: stockShape, offsets };
      }
      const sourceId = Number(restSetupId || cam.setups[0]?.id);
      if (!sourceId) throw new Error('Pick the earlier setup to continue from.');
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
              x: commitLength(parseDraft(explicit.x, 'Origin X'), units),
              y: commitLength(parseDraft(explicit.y, 'Origin Y'), units),
              z: commitLength(parseDraft(explicit.z, 'Origin Z'), units),
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
      'Pick the WCS origin on the stock box',
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
      'Pick the WCS origin on the model box',
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
      'Pick a sketch point as the WCS origin',
      (chosen) => setSketchPointKey(chosen.payload as string),
    );
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      if (bodyIds.length === 0) throw new Error('Select at least one body for this setup.');
      const stockSpec = buildStockSpec(false);
      if (!stockSpec) throw new Error('Complete the stock definition.');
      if (originSpec.mode === 'sketch_point' && !originSpec.sketch) {
        throw new Error('Pick the sketch point used as the WCS origin.');
      }
      const firstIndex = WORK_OFFSETS.indexOf(workOffset);
      const count = Math.max(
        1,
        Math.min(WORK_OFFSETS.length - firstIndex, Math.round(parseDraft(partCount, 'Duplicate parts'))),
      );
      const draft: CamSetupDraft = {
        name,
        body_ids: bodyIds,
        work_offset: workOffset,
        work_offset_count: count,
        stock_spec: stockSpec,
        wcs_origin: originSpec,
        explicit_origin: {
          x: commitLength(parseDraft(explicit.x, 'Origin X'), units),
          y: commitLength(parseDraft(explicit.y, 'Origin Y'), units),
          z: commitLength(parseDraft(explicit.z, 'Origin Z'), units),
        },
        z_down: zDown,
        z_rotation_deg: rotation,
      };
      runCamAction(() => createCamSetup(draft).then(() => close()));
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
            {ANCHOR_LABELS[anchor]}
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
          <Crosshair size={15} className="text-accent" />
          <span className="flex-1 text-xs font-semibold text-ink">New CAM Setup</span>
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
            <span className={CAM_DIALOG_LABEL}>Setup name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} className={CAM_DIALOG_INPUT} />
          </label>

          <DialogSection title={`PART BODIES · ${bodyIds.length} SELECTED`}>
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

          <DialogSection title="STOCK">
            <div className="grid grid-cols-2 gap-1.5">
              <label className="block">
                <span className={CAM_DIALOG_LABEL}>Shape</span>
                <select
                  value={stockShape}
                  onChange={(event) => setStockShape(event.target.value as CamStockShape)}
                  className={CAM_DIALOG_INPUT}
                >
                  <option value="box">Box</option>
                  <option value="cylinder">Cylinder</option>
                  <option value="hex">Hex bar</option>
                  <option value="model_body">Modeled body</option>
                </select>
              </label>
              {stockShape !== 'model_body' && (
                <label className="block">
                  <span className={CAM_DIALOG_LABEL}>Definition</span>
                  <select
                    value={stockMode}
                    onChange={(event) => setStockMode(event.target.value as StockMode)}
                    className={CAM_DIALOG_INPUT}
                  >
                    <option value="fixed">Fixed size</option>
                    <option value="from_model">From model box</option>
                    <option value="rest_from_setup">Remaining from setup</option>
                  </select>
                </label>
              )}
            </div>

            {stockShape !== 'model_body' && stockMode === 'fixed' && (
              <div className="mt-2 space-y-2">
                <div className="grid grid-cols-3 gap-2">
                  <DraftNumber
                    label={stockShape === 'box' ? 'Size X' : stockShape === 'cylinder' ? 'Diameter' : 'Across flats'}
                    value={sizeX}
                    onChange={setSizeX}
                    unit={lu}
                  />
                  {stockShape === 'box' && (
                    <DraftNumber label="Size Y" value={sizeY} onChange={setSizeY} unit={lu} />
                  )}
                  <DraftNumber label="Height (Z)" value={sizeZ} onChange={setSizeZ} unit={lu} />
                </div>
                <label className="flex items-center gap-2 text-[11px] text-ink">
                  <input
                    type="checkbox"
                    checked={centered}
                    onChange={(event) => setCentered(event.target.checked)}
                  />
                  Center the model in the stock
                </label>
                {!centered && (
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className={CAM_DIALOG_LABEL}>Park against</span>
                      <select
                        value={face}
                        onChange={(event) => setFace(event.target.value as CamStockFace)}
                        className={CAM_DIALOG_INPUT}
                      >
                        {(Object.keys(FACE_LABELS) as CamStockFace[]).map((candidate) => (
                          <option key={candidate} value={candidate}>
                            {FACE_LABELS[candidate]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <DraftNumber
                      label="Gap to face"
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
                    <DraftNumber label="X −" value={offXMin} onChange={setOffXMin} unit={lu} />
                    <DraftNumber label="X +" value={offXMax} onChange={setOffXMax} unit={lu} />
                    <DraftNumber label="Y −" value={offYMin} onChange={setOffYMin} unit={lu} />
                    <DraftNumber label="Y +" value={offYMax} onChange={setOffYMax} unit={lu} />
                    <DraftNumber label="Z −" value={offZMin} onChange={setOffZMin} unit={lu} />
                    <DraftNumber label="Z +" value={offZMax} onChange={setOffZMax} unit={lu} />
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    <DraftNumber label="Radial" value={radial} onChange={setRadial} unit={lu} />
                    <DraftNumber label="Z −" value={offZMin} onChange={setOffZMin} unit={lu} />
                    <DraftNumber label="Z +" value={offZMax} onChange={setOffZMax} unit={lu} />
                  </div>
                )}
                <p className="mt-1.5 text-[9px] leading-relaxed text-mute">
                  Allowances added to the part bounding box on each side.
                  {isRoundStock && ' The round shape wraps the box corners.'}
                </p>
              </div>
            )}

            {stockShape !== 'model_body' && stockMode === 'rest_from_setup' && (
              <div className="mt-2">
                {cam.setups.length > 0 ? (
                  <label className="block">
                    <span className={CAM_DIALOG_LABEL}>Continue from</span>
                    <select
                      value={restSetupId || String(cam.setups[0]?.id ?? '')}
                      onChange={(event) => setRestSetupId(event.target.value)}
                      className={CAM_DIALOG_INPUT}
                    >
                      {cam.setups.map((setup) => (
                        <option key={setup.id} value={setup.id}>
                          {setup.name} (remaining stock)
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <p className="text-[10px] italic text-mute">
                    No earlier setup exists yet — rest stock continues from a previous setup’s
                    simulated remainder.
                  </p>
                )}
              </div>
            )}

            {stockShape === 'model_body' && (
              <div className="mt-2">
                <label className="block">
                  <span className={CAM_DIALOG_LABEL}>Stock body</span>
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
                  The body’s mesh is voxelized as the starting stock; keep it out of the part
                  selection above if it is only stock.
                </p>
              </div>
            )}

            {stockPreview && (
              <div className="mt-2 rounded border border-edge/70 bg-header/40 p-2 font-mono text-[9px] leading-relaxed text-ink">
                Stock box (model):{' '}
                {displayLength(stockPreview.modelBox.max.x - stockPreview.modelBox.min.x, units).toFixed(2)} ×{' '}
                {displayLength(stockPreview.modelBox.max.y - stockPreview.modelBox.min.y, units).toFixed(2)} ×{' '}
                {displayLength(stockPreview.modelBox.max.z - stockPreview.modelBox.min.z, units).toFixed(2)} {lu}
              </div>
            )}
          </DialogSection>

          <DialogSection title="WCS ORIGIN">
            {inheritsWcs ? (
              <p className="text-[10px] leading-relaxed text-mute">
                Rest machining inherits the WCS of “{restSource?.name}” — the remaining material
                only makes sense in the same frame.
              </p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-1.5">
                  {(
                    [
                      ['stock_box_point', 'Stock box point'],
                      ['model_box_point', 'Model box point'],
                      ['sketch_point', 'Sketch point'],
                      ['explicit', 'Explicit XYZ'],
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
                      <MousePointer2 size={12} /> Pick on the stock box in the viewport
                    </button>
                    <div className="grid grid-cols-3 gap-2">
                      {anchorSelect('X at', anchorX, setAnchorX)}
                      {anchorSelect('Y at', anchorY, setAnchorY)}
                      {anchorSelect('Z at', anchorZ, setAnchorZ)}
                    </div>
                    {!stockPreview && (
                      <p className="text-[9px] italic text-mute/80">
                        Complete the stock definition above to enable viewport picking.
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
                      <MousePointer2 size={12} /> Pick on the model box in the viewport
                    </button>
                    <div className="grid grid-cols-3 gap-2">
                      {anchorSelect('X at', anchorX, setAnchorX)}
                      {anchorSelect('Y at', anchorY, setAnchorY)}
                      {anchorSelect('Z at', anchorZ, setAnchorZ)}
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
                      <MousePointer2 size={12} /> Pick a sketch point in the viewport
                    </button>
                    {pointRefs.length > 0 ? (
                      <select
                        value={sketchPointKey}
                        onChange={(event) => setSketchPointKey(event.target.value)}
                        className={CAM_DIALOG_INPUT}
                      >
                        <option value="">…or choose from the list</option>
                        {pointRefs.map((ref) => (
                          <option key={`${ref.sketch}:${ref.entityId}`} value={`${ref.sketch}:${ref.entityId}`}>
                            {ref.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <p className="text-[10px] italic text-mute">
                        No sketch points yet. Draw a point in a sketch first, then select it here.
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
                    <span className={CAM_DIALOG_LABEL}>Z direction</span>
                    <select
                      value={zDown ? 'down' : 'up'}
                      onChange={(event) => setZDown(event.target.value === 'down')}
                      className={CAM_DIALOG_INPUT}
                    >
                      <option value="up">Model +Z (spindle up)</option>
                      <option value="down">Model −Z (flipped)</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className={CAM_DIALOG_LABEL}>Rotate about Z</span>
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
                  WCS origin (model): {displayLength(preview.origin.x, units).toFixed(3)},{' '}
                  {displayLength(preview.origin.y, units).toFixed(3)},{' '}
                  {displayLength(preview.origin.z, units).toFixed(3)} {lu}
                </div>
                <div>
                  Stock in setup:{' '}
                  {displayLength(preview.stock.max.x - preview.stock.min.x, units).toFixed(2)} ×{' '}
                  {displayLength(preview.stock.max.y - preview.stock.min.y, units).toFixed(2)} ×{' '}
                  {displayLength(preview.stock.max.z - preview.stock.min.z, units).toFixed(2)} {lu}{' '}
                  · top Z {displayLength(preview.stock.max.z, units).toFixed(3)} {lu}
                </div>
              </div>
            ) : (
              <p className="mt-2 text-[9px] italic text-mute/80">
                Complete the stock definition and pick an origin to preview the resolved frame.
              </p>
            )}
          </DialogSection>

          <DialogSection title="WORK OFFSETS">
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className={CAM_DIALOG_LABEL}>First offset</span>
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
                label="Duplicate parts"
                value={partCount}
                onChange={setPartCount}
                integer
                unit="offsets"
              />
            </div>
            <p className="text-[9px] leading-relaxed text-mute">
              Posting one program repeats the toolpaths under that many consecutive offsets
              starting at the first (e.g. 3 from G54 → G54, G55, G56). Safe heights live on each
              operation; the post dialect is chosen when exporting.
            </p>
          </DialogSection>
        </div>
        <footer className="flex h-11 shrink-0 items-center justify-end gap-2 border-t border-edge px-3">
          <button
            type="button"
            onClick={close}
            className="h-7 rounded border border-edge px-3 text-[10px] font-semibold text-mute hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="h-7 rounded border border-accent/50 bg-accent/15 px-3 text-[10px] font-semibold text-accent hover:bg-accent/25"
          >
            Create empty setup
          </button>
        </footer>
      </form>
    </div>
  );
}
