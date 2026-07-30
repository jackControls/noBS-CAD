/**
 * Body appearance + filament preset editor for the selected solid body.
 * Theme settings stay in AppearanceDialog; this owns manufacturing materials.
 */
import { useEffect, useMemo, useState } from 'react';
import { Palette } from 'lucide-react';
import {
  DEFAULT_BODY_COLOR,
  DEFAULT_MATERIAL_NAME,
  type BodyAppearance,
  type Rgba8,
} from '../engine/types';
import { useTranslation } from '../i18n';
import {
  materialBrands,
  presetToAppearance,
  presetsForBrand,
  readSlicerTarget,
  SLICER_TARGETS,
  writeSlicerTarget,
  type SlicerTargetId,
} from '../materials';
import { useAppStore } from '../store/appStore';

function toHex(color: Rgba8): string {
  return `#${[color.r, color.g, color.b]
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`;
}

function fromHex(hex: string, alpha: number): Rgba8 {
  const normalized = hex.replace('#', '');
  if (normalized.length !== 6) {
    return { ...DEFAULT_BODY_COLOR, a: alpha };
  }
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
    a: alpha,
  };
}

function defaultAppearance(bodyId: number): BodyAppearance {
  return {
    body_id: bodyId,
    color: DEFAULT_BODY_COLOR,
    material_name: DEFAULT_MATERIAL_NAME,
    filament_type: 'PLA',
    brand: 'Generic',
    color_name: '',
    filament_id: null,
    preset_id: null,
    density_g_cm3: null,
    diameter_mm: 1.75,
  };
}

export function BodyAppearancePanel() {
  const { t } = useTranslation();
  const mode = useAppStore((state) => state.mode);
  const selectedBody = useAppStore((state) => state.selectedBody);
  const bodies = useAppStore((state) => state.solidScene.bodies);
  const appearances = useAppStore((state) => state.bodyAppearances);
  const setBodyAppearance = useAppStore((state) => state.setBodyAppearance);
  const [colorHex, setColorHex] = useState(toHex(DEFAULT_BODY_COLOR));
  const [brand, setBrand] = useState('Generic');
  const [presetId, setPresetId] = useState('');
  const [filamentType, setFilamentType] = useState('PLA');
  const [materialName, setMaterialName] = useState(DEFAULT_MATERIAL_NAME);
  const [colorName, setColorName] = useState('');
  const [slicerTarget, setSlicerTarget] = useState<SlicerTargetId>(readSlicerTarget);
  const [saving, setSaving] = useState(false);

  const brands = useMemo(() => materialBrands(), []);
  const brandPresets = useMemo(() => presetsForBrand(brand), [brand]);

  const body = bodies.find((entry) => entry.id === selectedBody) ?? null;
  const current: BodyAppearance | null =
    selectedBody === null
      ? null
      : appearances.find((entry) => entry.body_id === selectedBody) ?? defaultAppearance(selectedBody);

  useEffect(() => {
    if (!current) return;
    setColorHex(toHex(current.color));
    setBrand(current.brand || 'Generic');
    setPresetId(current.preset_id ?? '');
    setFilamentType(current.filament_type || 'PLA');
    setMaterialName(current.material_name);
    setColorName(current.color_name ?? '');
  }, [
    current?.body_id,
    current?.color.r,
    current?.color.g,
    current?.color.b,
    current?.brand,
    current?.preset_id,
    current?.filament_type,
    current?.material_name,
    current?.color_name,
  ]);

  if (mode !== 'solid' || selectedBody === null || body === null || current === null) {
    return null;
  }

  const save = async (next: BodyAppearance) => {
    setSaving(true);
    try {
      await setBodyAppearance(next);
    } finally {
      setSaving(false);
    }
  };

  return (
    <aside className="pointer-events-auto absolute right-[156px] top-3 z-20 w-64 rounded border border-edge bg-panel/95 p-3 shadow-sm backdrop-blur">
      <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-mute">
        <Palette size={14} />
        {t('bodyAppearance.title')}
      </div>
      <div className="mb-3 truncate text-xs text-ink">{body.name}</div>

      <label className="mb-2 block">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-mute">
          {t('bodyAppearance.slicerTarget')}
        </span>
        <select
          className="h-7 w-full rounded border border-edge bg-header px-2 text-xs text-ink"
          value={slicerTarget}
          onChange={(event) => {
            const next = event.target.value as SlicerTargetId;
            setSlicerTarget(next);
            writeSlicerTarget(next);
          }}
        >
          {SLICER_TARGETS.map((target) => (
            <option key={target.id} value={target.id}>
              {t(target.labelKey)}
            </option>
          ))}
        </select>
      </label>

      <label className="mb-2 block">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-mute">
          {t('bodyAppearance.brand')}
        </span>
        <select
          className="h-7 w-full rounded border border-edge bg-header px-2 text-xs text-ink"
          value={brand}
          disabled={saving}
          onChange={(event) => {
            setBrand(event.target.value);
            setPresetId('');
          }}
        >
          {brands.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>

      <label className="mb-2 block">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-mute">
          {t('bodyAppearance.preset')}
        </span>
        <select
          className="h-7 w-full rounded border border-edge bg-header px-2 text-xs text-ink"
          value={presetId}
          disabled={saving}
          onChange={(event) => {
            const id = event.target.value;
            setPresetId(id);
            const preset = brandPresets.find((entry) => entry.id === id);
            if (!preset) return;
            const next = presetToAppearance(preset, selectedBody);
            setColorHex(toHex(next.color));
            setFilamentType(next.filament_type);
            setMaterialName(next.material_name);
            setColorName(next.color_name);
            void save(next);
          }}
        >
          <option value="">{t('bodyAppearance.custom')}</option>
          {brandPresets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.material_name} — {preset.color_name}
            </option>
          ))}
        </select>
      </label>

      <label className="mb-2 block">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-mute">
          {t('bodyAppearance.filamentType')}
        </span>
        <input
          className="h-7 w-full rounded border border-edge bg-header px-2 text-xs text-ink outline-none focus:border-accent"
          value={filamentType}
          disabled={saving}
          onChange={(event) => setFilamentType(event.target.value)}
          onBlur={() => {
            const nextType = filamentType.trim() || 'PLA';
            setFilamentType(nextType);
            if (nextType === current.filament_type) return;
            void save({ ...current, filament_type: nextType, preset_id: null });
          }}
        />
      </label>

      <label className="mb-2 block">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-mute">
          {t('bodyAppearance.color')}
        </span>
        <input
          type="color"
          className="h-8 w-full cursor-pointer rounded border border-edge bg-header"
          value={colorHex}
          disabled={saving}
          onChange={(event) => {
            const nextColor = fromHex(event.target.value, current.color.a);
            setColorHex(event.target.value);
            void save({
              ...current,
              color: nextColor,
              material_name: materialName.trim() || DEFAULT_MATERIAL_NAME,
              brand,
              filament_type: filamentType.trim() || 'PLA',
              color_name: colorName,
              preset_id: null,
            });
          }}
        />
      </label>

      <label className="mb-2 block">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-mute">
          {t('bodyAppearance.colorName')}
        </span>
        <input
          className="h-7 w-full rounded border border-edge bg-header px-2 text-xs text-ink outline-none focus:border-accent"
          value={colorName}
          disabled={saving}
          onChange={(event) => setColorName(event.target.value)}
          onBlur={() => {
            if (colorName === current.color_name) return;
            void save({ ...current, color_name: colorName, preset_id: null });
          }}
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-mute">
          {t('bodyAppearance.material')}
        </span>
        <input
          className="h-7 w-full rounded border border-edge bg-header px-2 text-xs text-ink outline-none focus:border-accent"
          value={materialName}
          disabled={saving}
          onChange={(event) => setMaterialName(event.target.value)}
          onBlur={() => {
            const nextName = materialName.trim() || DEFAULT_MATERIAL_NAME;
            setMaterialName(nextName);
            if (nextName === current.material_name) return;
            void save({
              ...current,
              material_name: nextName,
              brand,
              filament_type: filamentType.trim() || 'PLA',
              color_name: colorName,
              preset_id: null,
            });
          }}
        />
      </label>
    </aside>
  );
}
