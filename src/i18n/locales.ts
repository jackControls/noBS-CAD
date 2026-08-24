/**
 * Supported UI locales and their detection/persistence.
 *
 * Detection order: saved preference (localStorage) → browser language →
 * English default. `zh-CN`, `es`, and `de` are community translations; the
 * UI shows a hint that they may be incomplete in places (see
 * `appearance.languageHint`).
 */

export const SUPPORTED_LOCALES = ['en', 'zh-CN', 'es', 'de'] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_STORAGE_KEY = 'nbcad.locale';

/** Native display names — shown in the language picker in every locale. */
export const LOCALE_NAMES: Record<SupportedLocale, string> = {
  en: 'English',
  'zh-CN': '简体中文',
  es: 'Español',
  de: 'Deutsch',
};

export function isSupportedLocale(value: string): value is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function detectLocale(): SupportedLocale {
  if (typeof window !== 'undefined') {
    try {
      const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
      if (stored && isSupportedLocale(stored)) return stored;
    } catch {
      // A locked-down webview can deny storage; fall through to detection.
    }
    try {
      const nav = window.navigator.language?.toLowerCase() ?? '';
      if (nav.startsWith('zh')) return 'zh-CN';
      if (nav.startsWith('es')) return 'es';
      if (nav.startsWith('de')) return 'de';
    } catch {
      // navigator.language can throw in exotic webviews; default to English.
    }
  }
  return 'en';
}

export function persistLocale(locale: SupportedLocale): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Storage can be denied; the in-memory preference still works.
  }
}
