import { Check, Monitor, Moon, Sun, X } from 'lucide-react';
import { useTranslation } from '../i18n';
import { cx } from '../lib/cx';
import { useAppStore } from '../store/appStore';
import type { ThemePreference } from '../theme';
import {
  DEFAULT_SIX_DOF_SPEED,
  MAX_SIX_DOF_SPEED,
  MIN_SIX_DOF_SPEED,
} from '../navigationPreferences';

const OPTIONS: Array<{
  value: ThemePreference;
  labelKey: string;
  descriptionKey: string;
  icon: typeof Monitor;
}> = [
  {
    value: 'system',
    labelKey: 'appearance.system',
    descriptionKey: 'appearance.systemDescription',
    icon: Monitor,
  },
  {
    value: 'light',
    labelKey: 'appearance.light',
    descriptionKey: 'appearance.lightDescription',
    icon: Sun,
  },
  {
    value: 'dark',
    labelKey: 'appearance.dark',
    descriptionKey: 'appearance.darkDescription',
    icon: Moon,
  },
];

export function AppearanceDialog() {
  const { t } = useTranslation();
  const open = useAppStore((s) => s.settingsOpen);
  const preference = useAppStore((s) => s.themePreference);
  const resolved = useAppStore((s) => s.resolvedTheme);
  const sixDofSpeed = useAppStore((s) => s.sixDofSpeed);
  const setPreference = useAppStore((s) => s.setThemePreference);
  const setSixDofSpeed = useAppStore((s) => s.setSixDofSpeed);
  const setOpen = useAppStore((s) => s.setSettingsOpen);

  if (!open) return null;

  return (
    <div
      data-native-viewport-dim="0.30"
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 px-4"
      onClick={() => setOpen(false)}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="appearance-title"
        data-testid="appearance-dialog"
        className="feature-dialog w-[430px] max-w-full overflow-hidden border border-edge bg-panel text-ink"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="feature-dialog-header flex h-11 items-center gap-2 border-b border-edge px-4">
          <Monitor size={16} className="text-accent" />
          <h2 id="appearance-title" className="flex-1 text-sm font-semibold">
            {t('appearance.title')}
          </h2>
          <button
            type="button"
            aria-label={t('appearance.close')}
            onClick={() => setOpen(false)}
            className="rounded p-1 text-mute hover:bg-edge hover:text-ink"
          >
            <X size={15} />
          </button>
        </header>

        <div className="p-4">
          <div className="mb-2 text-[10px] font-semibold tracking-widest text-mute">
            {t('appearance.theme')}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {OPTIONS.map((option) => {
              const selected = option.value === preference;
              const Icon = option.icon;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  data-testid={`theme-${option.value}`}
                  onClick={() => setPreference(option.value)}
                  className={cx(
                    'relative flex min-h-28 flex-col items-start rounded-lg border p-3 text-left transition-colors',
                    selected
                      ? 'border-accent bg-accent/10'
                      : 'border-edge bg-header/55 hover:border-accent/60 hover:bg-header',
                  )}
                >
                  <Icon size={20} className={selected ? 'text-accent' : 'text-mute'} />
                  <span className="mt-3 text-xs font-semibold text-ink">
                    {t(option.labelKey)}
                  </span>
                  <span className="mt-1 text-[10px] leading-snug text-mute">
                    {t(option.descriptionKey)}
                  </span>
                  {selected && (
                    <span className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-white">
                      <Check size={10} strokeWidth={3} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-[10px] text-mute" data-testid="resolved-theme">
            {t('appearance.current').replace(
              '{theme}',
              t(resolved === 'light' ? 'appearance.light' : 'appearance.dark'),
            )}
          </p>

          <div className="mt-4 border-t border-edge pt-4">
            <div className="mb-2 text-[10px] font-semibold tracking-widest text-mute">
              {t('appearance.navigation')}
            </div>
            <div className="rounded-lg border border-edge bg-header/55 p-3">
              <div className="flex items-center justify-between gap-3">
                <label
                  htmlFor="six-dof-speed"
                  className="text-xs font-semibold text-ink"
                >
                  {t('appearance.sixDofSpeed')}
                </label>
                <output
                  htmlFor="six-dof-speed"
                  data-testid="six-dof-speed-value"
                  className="min-w-12 rounded bg-accent/15 px-2 py-1 text-center text-[10px] font-semibold text-accent"
                >
                  {Math.round(sixDofSpeed * 100)}%
                </output>
              </div>
              <input
                id="six-dof-speed"
                data-testid="six-dof-speed"
                type="range"
                min={MIN_SIX_DOF_SPEED}
                max={MAX_SIX_DOF_SPEED}
                step={0.05}
                value={sixDofSpeed}
                onChange={(event) => setSixDofSpeed(Number(event.target.value))}
                className="mt-3 w-full accent-accent"
              />
              <div className="mt-1 flex items-start justify-between gap-3">
                <p className="text-[10px] leading-relaxed text-mute">
                  {t('appearance.sixDofSpeedDescription')}
                </p>
                <button
                  type="button"
                  onClick={() => setSixDofSpeed(DEFAULT_SIX_DOF_SPEED)}
                  className="shrink-0 rounded border border-edge px-2 py-1 text-[10px] text-ink hover:border-accent/60 hover:bg-edge"
                >
                  {t('appearance.reset')}
                </button>
              </div>
            </div>
          </div>

          <div
            className="mt-4 border-t border-edge pt-4"
            data-testid="legal-credits"
          >
            <div className="mb-2 text-[10px] font-semibold tracking-widest text-mute">
              {t('appearance.legal')}
            </div>
            <p className="text-[10px] leading-relaxed text-ink">
              {t('appearance.spaceMouseCompatibility')}
            </p>
            <p className="mt-2 text-[10px] leading-relaxed text-mute">
              {t('appearance.threeDconnexionAttribution')}
            </p>
            <p className="mt-2 text-[10px] leading-relaxed text-mute">
              {t('appearance.threeDconnexionIndependence')}
            </p>
          </div>
        </div>

        <footer className="flex justify-end border-t border-edge bg-header/35 px-4 py-3">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="h-7 rounded bg-accent px-4 text-xs font-semibold text-white hover:brightness-110"
          >
            {t('appearance.done')}
          </button>
        </footer>
      </section>
    </div>
  );
}
