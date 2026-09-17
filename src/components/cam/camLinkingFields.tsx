import { useEffect, useRef, useState } from 'react';
import type {
  CamLeadDto,
  CamLinkingDto,
  CamOperationDto,
  CamSetupDto,
  CamToolDto,
  CamUnits,
} from '../../engine/types';
type Point2Dto = { x: number; y: number };
import { displayLength, commitLength } from '../../cam/units';
import { modelPointToSetup, setupPointToModel } from '../../cam/geometry';
import { cancelCamPointPick, requestCamPointPick } from '../../cam/pointPick';
import { useAppStore, type CamPointPickCandidate } from '../../store/appStore';
import { translate, useTranslation } from '../../i18n';
import {
  CAM_DIALOG_INPUT,
  CAM_DIALOG_LABEL,
  DialogSection,
  DraftNumber,
  feedUnit,
  lengthUnit,
  parseDraft,
} from './camFields';

export function defaultCamLinking(
  kind: CamOperationDto['kind'],
  tool?: CamToolDto | null,
  operation?: CamOperationDto,
): CamLinkingDto {
  const d = tool?.diameter ?? 6;
  const contour = operation?.kind === 'contour2d' ? operation : null;
  const adaptive = operation?.kind === 'adaptive3d' ? operation.parameters : null;
  const cut = operation?.cutting ?? tool?.cutting;
  const lead: CamLeadDto = {
    enabled: true,
    horizontal_radius: kind === 'face' ? 0 : contour ? (contour.lead_arc_radius ?? 0) : d * 0.1,
    sweep_degrees: 90,
    linear_distance: kind === 'chamfer2d' ? d * 0.1 : kind === 'contour2d' ? (contour?.lead_in ?? d * 0.1) : 0,
    perpendicular: false,
    vertical_radius: operation || kind === 'chamfer2d' ? 0 : d * 0.1,
  };
  return {
    operation_id: operation?.id ?? 0,
    high_feed_mode: 'preserve',
    high_feed: 5000,
    allow_rapid_retract: true,
    keep_tool_down: kind === 'face',
    maximum_stay_down: adaptive?.stay_down_distance ?? d * 5,
    minimum_clearance: 0,
    stay_down_level: 0,
    lift_height: 0,
    retraction_policy: 'full',
    safe_distance: operation?.kind === 'face' ? operation.safe_distance : Math.min(1, d * 0.1),
    extend_before_retract: true,
    transition: 'smooth',
    lead_in: lead,
    lead_out: { ...lead, linear_distance: contour?.lead_out ?? lead.linear_distance },
    same_as_lead_in: !contour || contour.lead_in === contour.lead_out,
    lead_in_feed: cut?.feed_xy || 600,
    lead_out_feed: cut?.feed_xy || 600,
    no_engagement_feed: adaptive?.linking_feed ?? (cut?.feed_xy || 1000),
    ramp_enabled: kind === 'adaptive3d',
    ramp_type: 'helix',
    ramp_angle: adaptive?.ramp_angle_degrees ?? 3,
    ramp_stepdown: adaptive?.maximum_ramp_stepdown ?? Math.min(1, d * 0.25),
    ramp_clearance: 1,
    ramp_taper_angle: 0,
    helix_diameter: d * 0.95,
    minimum_helix_diameter: d * 0.5,
    ramp_feed: adaptive?.ramp_feed ?? (cut?.feed_z || 180),
    predrill_positions: [],
    entry_positions: [],
    exit_positions: [],
  };
}
type Draft = Record<string, string | boolean>;
const scalar = new Set([
  'operation_id',
  'stay_down_level',
  'ramp_angle',
  'ramp_taper_angle',
  'sweep_degrees',
]);
const pointsKeys = ['predrill_positions', 'entry_positions', 'exit_positions'] as const;
function makeDraft(value: CamLinkingDto, units: CamUnits): Draft {
  const draft: Draft = {};
  const add = (object: object, prefix = '') =>
    Object.entries(object).forEach(([key, v]) => {
      if (key === 'lead_in' || key === 'lead_out') add(v, `${key}.`);
      else if (Array.isArray(v))
        draft[key] = v
          .map((p: Point2Dto) => `${displayLength(p.x, units)}, ${displayLength(p.y, units)}`)
          .join('\n');
      else
        draft[prefix + key] =
          typeof v === 'number'
            ? String(Number((scalar.has(key) ? v : displayLength(v, units)).toFixed(8)))
            : v;
    });
  add(value);
  return draft;
}
export function useCamLinking(
  kind: CamOperationDto['kind'],
  units: CamUnits,
  tool?: CamToolDto | null,
  editing?: CamOperationDto,
) {
  const stored = useAppStore.getState().camDocument.linking?.find((l) => l.operation_id === editing?.id);
  const [draft, setDraft] = useState(() =>
    makeDraft(stored ?? defaultCamLinking(kind, tool, editing), units),
  );
  const touched = useRef(!!editing);
  useEffect(() => {
    if (!touched.current) setDraft(makeDraft(defaultCamLinking(kind, tool), units));
  }, [kind, tool?.id, units]);
  const change = (key: string, value: string | boolean) => {
    touched.current = true;
    setDraft((d) => ({ ...d, [key]: value }));
  };
  const read = (): CamLinkingDto => {
    const result = defaultCamLinking(kind, tool, editing);
    const parse = (object: object, prefix = '') =>
      Object.entries(object).forEach(([key, value]) => {
        const target = object as Record<string, unknown>;
        if (key === 'lead_in' || key === 'lead_out') parse(value, `${key}.`);
        else if (Array.isArray(value))
          target[key] = String(draft[key])
            .split(/[\n;]/)
            .filter((s) => s.trim())
            .map((line) => {
              const pair = line.trim().split(/[,\s]+/);
              if (pair.length !== 2)
                throw new Error(translate('cam.linking.errorPositionsFormat'));
              return {
                x: commitLength(parseDraft(pair[0], translate('cam.linking.positionX')), units),
                y: commitLength(parseDraft(pair[1], translate('cam.linking.positionY')), units),
              };
            });
        else if (typeof value === 'number') {
          const number = parseDraft(String(draft[prefix + key]), key.replace(/_/g, ' '));
          target[key] = scalar.has(key) ? number : commitLength(number, units);
        } else target[key] = draft[prefix + key];
      });
    parse(result);
    return result;
  };
  return { draft, change, read, kind, units };
}
type Controller = ReturnType<typeof useCamLinking>;
export function CamLinkingFields({ value, setup }: { value: Controller; setup: CamSetupDto }) {
  const { t } = useTranslation();
  const { draft, change, kind, units } = value;
  const isFace = kind === 'face',
    isContour = kind === 'contour2d',
    isChamfer = kind === 'chamfer2d',
    isAdaptive = kind === 'adaptive3d';
  const length = lengthUnit(units),
    feed = feedUnit(units);
  const picking = useAppStore((s) => s.camPointPick);
  const [pickMessage, setPickMessage] = useState('');
  useEffect(() => () => cancelCamPointPick(), []);
  const check = (key: string, label: string, hint?: string) => (
    <label title={hint} className="flex items-center gap-2 text-[11px] text-ink">
      <input type="checkbox" checked={!!draft[key]} onChange={(e) => change(key, e.target.checked)} />
      {label}
    </label>
  );
  const number = (key: string, label: string, unit = length, hint?: string) => (
    <div title={hint}>
      <DraftNumber label={label} value={String(draft[key])} onChange={(v) => change(key, v)} unit={unit} />
    </div>
  );
  const select = (key: string, label: string, options: Array<[string, string]>, hint?: string) => (
    <label title={hint} className="block">
      <span className={CAM_DIALOG_LABEL}>{label}</span>
      <select
        className={CAM_DIALOG_INPUT}
        value={String(draft[key])}
        onChange={(e) => change(key, e.target.value)}
      >
        {options.map(([v, name]) => (
          <option key={v} value={v}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
  const lead = (prefix: 'lead_in' | 'lead_out') => (
    <div className="space-y-2 border-l-2 border-accent/20 pl-2">
      {!isFace &&
        number(
          `${prefix}.horizontal_radius`,
          t(prefix === 'lead_in' ? 'cam.linking.horizontalLeadInRadius' : 'cam.linking.horizontalLeadOutRadius'),
          length,
          t('cam.linking.horizontalRadiusHint'),
        )}
      {(isContour || isChamfer) && (
        <>
          {number(
            `${prefix}.sweep_degrees`,
            t(prefix === 'lead_in' ? 'cam.linking.leadInSweepAngle' : 'cam.linking.leadOutSweepAngle'),
            'deg',
            t('cam.linking.sweepHint'),
          )}
          {number(
            `${prefix}.linear_distance`,
            t(prefix === 'lead_in' ? 'cam.linking.linearLeadInDistance' : 'cam.linking.linearLeadOutDistance'),
            length,
            isChamfer ? t('cam.linking.linearChamferHint')
              : t('cam.linking.linearContourHint'),
          )}
          {check(
            `${prefix}.perpendicular`,
            t('cam.linking.perpendicular'),
            t('cam.linking.perpendicularHint'),
          )}
        </>
      )}
      {number(
        `${prefix}.vertical_radius`,
        t(prefix === 'lead_in' ? 'cam.linking.verticalLeadInRadius' : 'cam.linking.verticalLeadOutRadius'),
        length,
        t('cam.linking.verticalRadiusHint'),
      )}
    </div>
  );
  const pick = async (key: (typeof pointsKeys)[number]) => {
    const state = useAppStore.getState();
    const candidates: CamPointPickCandidate[] = [];
    if (key === 'predrill_positions') {
      for (const op of setup.operations) {
        if (op.id === Number(draft.operation_id)) break;
        if (!op.enabled || op.kind !== 'drill') continue;
        for (const point of [...op.points, ...(op.holes ?? []).map((h) => h.point)])
          candidates.push({
            point: setupPointToModel({ ...point, z: setup.stock.max.z }, setup.wcs),
            label: `${op.name} · ${t('cam.linking.drilledCenter')}`,
          });
      }
    } else {
      const seen = new Set<string>();
      for (const body of state.solidScene.bodies.filter((b) => setup.body_ids.includes(b.id))) {
        const positions = body.mesh.positions;
        for (let i = 0; i + 2 < positions.length && candidates.length < 2000; i += 3) {
          const p = { x: positions[i], y: positions[i + 1], z: positions[i + 2] };
          const key = `${p.x.toFixed(5)}:${p.y.toFixed(5)}:${p.z.toFixed(5)}`;
          if (!seen.has(key)) {
            seen.add(key);
            candidates.push({ point: p, label: t('cam.linking.preferredStationLabel') });
          }
        }
      }
    }
    if (!candidates.length) {
      setPickMessage(
        key === 'predrill_positions'
          ? t('cam.linking.noDrillPositions')
          : t('cam.linking.noModelVertices'),
      );
      return;
    }
    setPickMessage('');
    try {
      const result = await requestCamPointPick(
        candidates,
        key === 'predrill_positions'
          ? t('cam.linking.pickEarlierHole')
          : t('cam.linking.pickLeadStation'),
      );
      if (result) {
        const p = modelPointToSetup(result.point, setup.wcs);
        const row = `${displayLength(p.x, units)}, ${displayLength(p.y, units)}`;
        change(key, key === 'predrill_positions' && draft[key] ? `${draft[key]}\n${row}` : row);
      }
    } catch (error) {
      setPickMessage(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <div className="space-y-4" data-testid="cam-linking-fields">
      <DialogSection title={t('cam.linking.sectionLinking')}>
        {isAdaptive &&
          select(
            'retraction_policy',
            t('cam.linking.retractionPolicy'),
            [
              ['full', t('cam.linking.retractionFull')],
              ['minimum', t('cam.linking.retractionMinimum')],
              ['shortest', t('cam.linking.retractionShortest')],
            ],
            t('cam.linking.retractionHint'),
          )}
        {select('high_feed_mode', t('cam.linking.highFeedMode'), [
          ['preserve', t('cam.linking.highFeedPreserve')],
          ['axial_radial', t('cam.linking.highFeedAxialRadial')],
          ['axial', t('cam.linking.highFeedAxial')],
          ['radial', t('cam.linking.highFeedRadial')],
          ['single_axis', t('cam.linking.highFeedSingleAxis')],
          ['always', t('cam.linking.highFeedAlways')],
        ])}
        {(draft.high_feed_mode !== 'preserve' || draft.retraction_policy === 'shortest') &&
          number('high_feed', t('cam.linking.highFeedrate'), feed)}
        {check(
          'allow_rapid_retract',
          t('cam.linking.allowRapidRetract'),
          t('cam.linking.allowRapidRetractHint'),
        )}
        {(isContour || isFace || draft.retraction_policy !== 'full') &&
          number(
            'safe_distance',
            t('cam.linking.safeDistance'),
            length,
            t('cam.linking.safeDistanceHint'),
          )}
        {!isChamfer && check('keep_tool_down', t('cam.linking.keepToolDown'), t('cam.linking.keepToolDownHint'))}
        {!isChamfer && !!draft.keep_tool_down && (
          <>
            {number('maximum_stay_down', t('cam.linking.maxStayDown'))}
            {!isFace && number('minimum_clearance', t('cam.linking.minStayDownClearance'))}
            {isAdaptive &&
              select(
                'stay_down_level',
                t('cam.linking.stayDownLevel'),
                Array.from({ length: 11 }, (_, i) => [
                  String(i * 10),
                  i === 0 ? t('cam.linking.least') : i === 10 ? t('cam.linking.most') : `${i * 10}%`,
                ]),
                t('cam.linking.stayDownLevelHint'),
              )}
            {!isFace && number('lift_height', t('cam.linking.liftHeight'))}
          </>
        )}
        {isFace &&
          check(
            'extend_before_retract',
            t('cam.linking.extendBeforeRetract'),
            t('cam.linking.extendBeforeRetractHint'),
          )}
        {!isChamfer && number('no_engagement_feed', t('cam.linking.noEngagementFeedrate'), feed)}
        {isChamfer && <p className="text-[10px] text-mute">{t('cam.linking.chamferNote')}</p>}
      </DialogSection>
      <DialogSection title={t('cam.linking.sectionLeadsTransitions')}>
        {check('lead_in.enabled', t('cam.linking.leadInEntry'))}
        {!!draft['lead_in.enabled'] && lead('lead_in')}
        {check('lead_out.enabled', t('cam.linking.leadOutExit'))}
        {!!draft['lead_out.enabled'] && (
          <>
            {check('same_as_lead_in', t('cam.linking.sameAsLeadIn'))}
            {!draft.same_as_lead_in && lead('lead_out')}
          </>
        )}
        {number('lead_in_feed', t('cam.linking.leadInFeedrate'), feed)}
        {number('lead_out_feed', t('cam.linking.leadOutFeedrate'), feed)}
        {isFace &&
          select(
            'transition',
            t('cam.linking.transitionType'),
            [
              ['no_contact', t('cam.linking.transitionNoContact')],
              ['straight', t('cam.linking.transitionStraight')],
              ['shortest', t('cam.linking.transitionShortest')],
              ['smooth', t('cam.linking.transitionSmooth')],
            ],
            t('cam.linking.transitionHint'),
          )}
        <p className="text-[10px] text-mute">
          {isChamfer && t('cam.linking.chamferValuesHelp')}
          {t('cam.linking.leadHelp')}
        </p>
      </DialogSection>
      {(isContour || isAdaptive) && (
        <DialogSection title={t('cam.linking.sectionRamp')}>
          {isContour && check('ramp_enabled', t('cam.linking.rampAlongContour'))}
          {(!!draft.ramp_enabled || isAdaptive) && (
            <>
              {isAdaptive &&
                select(
                  'ramp_type',
                  t('cam.linking.rampType'),
                  [
                    ['predrill', t('cam.linking.rampPredrill')],
                    ['plunge', t('cam.linking.rampPlunge')],
                    ['helix', t('cam.linking.rampHelix')],
                  ],
                  t('cam.linking.rampTypeHint'),
                )}
              {(isContour || draft.ramp_type === 'helix') && (
                <>
                  {number('ramp_angle', t('cam.linking.rampingAngle'), 'deg')}
                  {number('ramp_stepdown', t('cam.linking.maxRampStepdown'))}
                  {isAdaptive && number('ramp_taper_angle', t('cam.linking.rampTaperAngle'), 'deg')}
                  {number('ramp_clearance', t('cam.linking.rampClearanceHeight'))}
                  {isAdaptive && (
                    <>
                      {number('helix_diameter', t('cam.linking.maxHelicalRampDiameter'))}
                      {number('minimum_helix_diameter', t('cam.linking.minRampDiameter'))}
                    </>
                  )}
                </>
              )}
              {number('ramp_feed', t('cam.linking.rampFeedrate'), feed)}
            </>
          )}
        </DialogSection>
      )}
      {(isContour || isAdaptive) && (
        <DialogSection title={t('cam.linking.sectionPositions')}>
          {pointsKeys
            .filter((key) => key !== 'exit_positions' || isContour)
            .map((key) => (
              <div key={key} className="space-y-1">
                <label className="block">
                  <span className={CAM_DIALOG_LABEL}>
                    {key === 'predrill_positions'
                      ? t('cam.linking.predrillPositions')
                      : key === 'entry_positions'
                        ? t('cam.linking.preferredLeadInPosition')
                        : t('cam.linking.preferredExitPosition')}
                  </span>
                  <textarea
                    aria-label={key === 'predrill_positions'
                      ? t('cam.linking.predrillPositions')
                      : key === 'entry_positions'
                        ? t('cam.linking.preferredLeadInPosition')
                        : t('cam.linking.preferredExitPosition')}
                    rows={2}
                    className={`${CAM_DIALOG_INPUT} h-auto font-mono`}
                    placeholder={t('cam.linking.textareaPlaceholder').replace('{unit}', length)}
                    value={String(draft[key])}
                    onChange={(e) => change(key, e.target.value)}
                  />
                </label>
                <button type="button" className="text-[10px] text-accent" onClick={() => void pick(key)}>
                  {picking ? t('cam.linking.pickInViewport') : t('cam.linking.selectInViewport')}
                </button>
              </div>
            ))}
          <p className="text-[10px] text-mute">
            {t('cam.linking.positionsHelp')}
          </p>
          {pickMessage && (
            <p role="status" className="text-[10px] text-amber-600">
              {pickMessage}
            </p>
          )}
        </DialogSection>
      )}
    </div>
  );
}
