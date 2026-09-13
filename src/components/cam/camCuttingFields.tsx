import { useState } from 'react';
import type { CamCoolantMode, CamCuttingParametersDto } from '../../engine/types';
import {
  convertCuttingDraftUnits, cuttingDraftFrom, cuttingDraftValues, editCuttingDraft, resolveCuttingDraft,
  type CuttingContext, type CuttingField,
} from '../../cam/cuttingDraft';
import { chipLoadUnitLabel, cuttingSpeedUnitLabel, feedUnitLabel } from '../../cam/units';
import { DraftNumber } from './camFields';

export function useCamCutting(context: CuttingContext, initial?: CamCuttingParametersDto) {
  const [state, setState] = useState(() => ({ units: context.units, draft: cuttingDraftFrom(initial, context.units) }));
  const draft = convertCuttingDraftUnits(state.draft, state.units, context.units);
  return {
    units: context.units,
    values: cuttingDraftValues(draft, context),
    change: (field: CuttingField, value: string) => setState(current => ({
      units: context.units,
      draft: editCuttingDraft(convertCuttingDraftUnits(current.draft, current.units, context.units), field, value),
    })),
    reset: (cutting: CamCuttingParametersDto) => setState({ units: context.units, draft: cuttingDraftFrom(cutting, context.units) }),
    read: (coolant: CamCoolantMode, holemaking = false) => resolveCuttingDraft(draft, context, coolant, holemaking),
  };
}
type Controller = ReturnType<typeof useCamCutting>;

/** Both sides are editable; shared by all operation dialogs. Drivers remain
 * draft intent only: the engine receives canonical, resolved cutting data. */
export function CamCuttingPair({ feeds, pair, onEdit, primaryLabel, secondaryLabel }: {
  feeds: Controller;
  pair: 'speed' | 'cutting' | 'plunge';
  onEdit?: () => void;
  primaryLabel?: string;
  secondaryLabel?: string;
}) {
  const fields: [CuttingField, string, string][] = pair === 'speed'
    ? [['rpm', 'Spindle speed', 'rpm'], ['surfaceSpeed', 'Surface speed', cuttingSpeedUnitLabel(feeds.units)]]
    : pair === 'cutting'
      ? [['feedXy', 'Cutting feedrate', feedUnitLabel(feeds.units)], ['feedPerTooth', 'Feed per tooth', `${chipLoadUnitLabel(feeds.units)}/tooth`]]
      : [['feedZ', 'Plunge feedrate', feedUnitLabel(feeds.units)], ['feedPerRev', 'Plunge feed per revolution', `${chipLoadUnitLabel(feeds.units)}/rev`]];
  return <>{fields.map(([key, label, unit], i) => <div key={key} data-testid={`cam-cutting-${key}`} className="flex flex-col justify-end">
    <DraftNumber label={(i === 0 ? primaryLabel : secondaryLabel) ?? label} value={feeds.values[key]}
      unit={unit} integer={key === 'rpm'} onChange={value => { onEdit?.(); feeds.change(key, value); }} />
  </div>)}</>;
}

export function CamCuttingHint() {
  return <p className="col-span-2 text-[10px] leading-relaxed text-mute">
    Edit either field in a pair; the last edited field drives its partner. Calculations use the tool’s nominal diameter and flute/insert count. RPM resolves to a whole number.
  </p>;
}
