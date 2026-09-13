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
                throw new Error('Positions need one X, Y pair per line, in setup coordinates.');
              return {
                x: commitLength(parseDraft(pair[0], 'Position X'), units),
                y: commitLength(parseDraft(pair[1], 'Position Y'), units),
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
          `Horizontal ${prefix === 'lead_in' ? 'lead-in' : 'lead-out'} radius`,
          length,
          'Physical tool-center arc radius. Zero gives a straight lead.',
        )}
      {(isContour || isChamfer) && (
        <>
          {number(
            `${prefix}.sweep_degrees`,
            `${prefix === 'lead_in' ? 'Lead-in' : 'Lead-out'} sweep angle`,
            'deg',
            '0° removes the horizontal arc; 90° is a quarter circle.',
          )}
          {number(
            `${prefix}.linear_distance`,
            `Linear ${prefix === 'lead_in' ? 'lead-in' : 'lead-out'} distance`,
            length,
            isChamfer ? 'Straight tool-center travel before the entry arc or after the exit arc. Zero omits it.'
              : 'A positive straight move is required to engage or cancel controller compensation.',
          )}
          {check(
            `${prefix}.perpendicular`,
            'Perpendicular',
            'Approach toward the arc radially instead of tangentially. Software compensation only.',
          )}
        </>
      )}
      {number(
        `${prefix}.vertical_radius`,
        `Vertical ${prefix === 'lead_in' ? 'lead-in' : 'lead-out'} radius`,
        length,
        'Round the plunge/withdrawal into the horizontal move. Zero disables vertical rounding.',
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
            label: `${op.name} · drilled center`,
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
            candidates.push({ point: p, label: 'Preferred station near model vertex' });
          }
        }
      }
    }
    if (!candidates.length) {
      setPickMessage(
        key === 'predrill_positions'
          ? 'No earlier drilling positions are available. Add or move drilling before this operation.'
          : 'No model vertices are available. Enter a setup X, Y coordinate instead.',
      );
      return;
    }
    setPickMessage('');
    try {
      const result = await requestCamPointPick(
        candidates,
        key === 'predrill_positions'
          ? 'Pick an earlier drilled hole'
          : 'Pick near the preferred lead station',
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
      <DialogSection title="LINKING">
        {isAdaptive &&
          select(
            'retraction_policy',
            'Retraction policy',
            [
              ['full', 'Full retraction'],
              ['minimum', 'Minimum retraction'],
              ['shortest', 'Shortest checked link'],
            ],
            'Unproven links retract. Shortest links use G1 to avoid diagonal rapid ambiguity.',
          )}
        {select('high_feed_mode', 'High feedrate mode', [
          ['preserve', 'Preserve rapid movement'],
          ['axial_radial', 'Preserve axial and radial rapids'],
          ['axial', 'Preserve axial rapids'],
          ['radial', 'Preserve radial rapids'],
          ['single_axis', 'Preserve single-axis rapids'],
          ['always', 'Always use high feed'],
        ])}
        {(draft.high_feed_mode !== 'preserve' || draft.retraction_policy === 'shortest') &&
          number('high_feed', 'High feedrate', feed)}
        {check(
          'allow_rapid_retract',
          'Allow rapid retract',
          'Disable to withdraw at lead-out feed instead of G0.',
        )}
        {(isContour || isFace || draft.retraction_policy !== 'full') &&
          number(
            'safe_distance',
            'Safe distance',
            length,
            'Clearance for entry/retract and non-cutting links. Cannot authorize an uncut shortcut.',
          )}
        {!isChamfer && check('keep_tool_down', 'Keep tool down', 'Only links proved clear of stock may stay down.')}
        {!isChamfer && !!draft.keep_tool_down && (
          <>
            {number('maximum_stay_down', 'Maximum stay-down distance')}
            {!isFace && number('minimum_clearance', 'Minimum stay-down clearance')}
            {isAdaptive &&
              select(
                'stay_down_level',
                'Stay-down search level',
                Array.from({ length: 11 }, (_, i) => [
                  String(i * 10),
                  i === 0 ? 'Least' : i === 10 ? 'Most' : `${i * 10}%`,
                ]),
                'Higher settings try more checked links; clearance and engagement limits never change.',
              )}
            {!isFace && number('lift_height', 'Lift height')}
          </>
        )}
        {isFace &&
          check(
            'extend_before_retract',
            'Extend before retract',
            'Carry the cutter beyond incoming stock before lifting.',
          )}
        {!isChamfer && number('no_engagement_feed', 'No-engagement feedrate', feed)}
        {isChamfer && <p className="text-[10px] text-mute">Every chain retracts to Clearance Height before transferring to the next. Set transfer heights on the Heights tab.</p>}
      </DialogSection>
      <DialogSection title="LEADS & TRANSITIONS">
        {check('lead_in.enabled', 'Lead-in (Entry)')}
        {!!draft['lead_in.enabled'] && lead('lead_in')}
        {check('lead_out.enabled', 'Lead-out (Exit)')}
        {!!draft['lead_out.enabled'] && (
          <>
            {check('same_as_lead_in', 'Same as lead-in')}
            {!draft.same_as_lead_in && lead('lead_out')}
          </>
        )}
        {number('lead_in_feed', 'Lead-in feedrate', feed)}
        {number('lead_out_feed', 'Lead-out feedrate', feed)}
        {isFace &&
          select(
            'transition',
            'Transition type',
            [
              ['no_contact', 'No contact'],
              ['straight', 'Straight line'],
              ['shortest', 'Shortest path'],
              ['smooth', 'Smooth'],
            ],
            'Stay-down transitions need Keep tool down and a clear path; otherwise retract.',
          )}
        <p className="text-[10px] text-mute">
          {isChamfer && 'These values apply to every selected chain. Manual dimensions are never automatically reduced; a chain that cannot fit blocks generation. '}
          Radii describe the physical tool center. Leads are checked before posting; neighboring fixtures and
          holders still need separate verification.
        </p>
      </DialogSection>
      {(isContour || isAdaptive) && (
        <DialogSection title="RAMP">
          {isContour && check('ramp_enabled', 'Ramp along closed contour')}
          {(!!draft.ramp_enabled || isAdaptive) && (
            <>
              {isAdaptive &&
                select(
                  'ramp_type',
                  'Ramp type',
                  [
                    ['predrill', 'Predrill'],
                    ['plunge', 'Plunge'],
                    ['helix', 'Helix'],
                  ],
                  'Predrill requires earlier hole-removal evidence. Plunge explicitly permits full-width axial cutting at Ramp Feed with a center-cutting tool.',
                )}
              {(isContour || draft.ramp_type === 'helix') && (
                <>
                  {number('ramp_angle', 'Ramping angle', 'deg')}
                  {number('ramp_stepdown', 'Maximum ramp stepdown')}
                  {isAdaptive && number('ramp_taper_angle', 'Ramp taper angle', 'deg')}
                  {number('ramp_clearance', 'Ramp clearance height')}
                  {isAdaptive && (
                    <>
                      {number('helix_diameter', 'Maximum helical ramp diameter')}
                      {number('minimum_helix_diameter', 'Minimum ramp diameter')}
                    </>
                  )}
                </>
              )}
              {number('ramp_feed', 'Ramp feedrate', feed)}
            </>
          )}
        </DialogSection>
      )}
      {(isContour || isAdaptive) && (
        <DialogSection title="POSITIONS">
          {pointsKeys
            .filter((key) => key !== 'exit_positions' || isContour)
            .map((key) => (
              <div key={key} className="space-y-1">
                <label className="block">
                  <span className={CAM_DIALOG_LABEL}>
                    {key === 'predrill_positions'
                      ? 'Predrill positions'
                      : key === 'entry_positions'
                        ? 'Preferred lead-in position'
                        : 'Preferred exit position'}
                  </span>
                  <textarea
                    aria-label={key.replace(/_/g, ' ')}
                    rows={2}
                    className={`${CAM_DIALOG_INPUT} h-auto font-mono`}
                    placeholder={`X, Y (${length}, setup WCS)`}
                    value={String(draft[key])}
                    onChange={(e) => change(key, e.target.value)}
                  />
                </label>
                <button type="button" className="text-[10px] text-accent" onClick={() => void pick(key)}>
                  {picking ? 'Pick in viewport…' : 'Select in viewport…'}
                </button>
              </div>
            ))}
          <p className="text-[10px] text-mute">
            Entry/exit points are preferences, not plunge permissions. A predrill position must be backed by
            an earlier enabled hole deep and wide enough for the tool. Coordinates are saved in this setup’s
            WCS.
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
