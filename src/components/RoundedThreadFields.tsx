import { DimensionInput } from './DimensionInput';
import type { RoundedThreadInputs } from '../lib/threadStandards';

export function RoundedThreadFields({values, onChange, prefix}: {
  values: RoundedThreadInputs;
  onChange: (values: RoundedThreadInputs) => void;
  prefix: 'hole' | 'external';
}) {
  const fields = [
    ['radial_depth', 'Thread radial depth (mm)', '0.000001'],
    ['corner_radius', 'Thread corner radius (mm)', '0.000001'],
    ['radial_clearance', 'Thread radial clearance (mm)', '0'],
    ['axial_clearance', 'Thread axial clearance (mm)', '0'],
  ] as const;
  return <section data-testid={`${prefix}-rounded-profile`} className="space-y-2">
    <div className="grid grid-cols-2 gap-2">
      {fields.map(([key, label, min]) => <label key={key}>
        <span className="mb-1 block text-[10px] text-mute">{label}</span>
        <DimensionInput data-testid={`${prefix}-${key}`} min={min} step="any"
          value={values[key]} onValueChange={value => onChange({...values, [key]: value})} />
      </label>)}
    </div>
    <p className="text-[10px] text-mute">
      Requires the native desktop kernel, which validates the chosen profile.
      Use matching nominal diameter, pitch and profile for both parts;
      clearances enlarge the female cavity. This is not an ISO or Unified fit class.
    </p>
  </section>;
}
