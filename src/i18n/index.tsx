/**
 * Lightweight i18n provider.
 *
 * All user-facing strings live in locale JSON files; `en` is the default
 * and fallback. To add a language: create `<locale>.json` with the same key
 * tree, register it in `dictionaries` below, and pass its locale to the
 * provider (see `src/i18n/locales.ts` for the supported set). Keys are
 * dotted paths (e.g. "ribbon.tabs.model"); missing keys fall back to `en`,
 * then render the key itself so gaps are visible during development.
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';
import en from './en.json';
import zhCN from './zh-CN.json';
import es from './es.json';
import de from './de.json';

export type Locale = 'en' | 'zh-CN' | 'es' | 'de' | (string & {});

type Messages = typeof en;

const dictionaries: Record<string, Messages> = {
  en,
  'zh-CN': zhCN,
  es,
  de,
};

interface I18nContextValue {
  locale: Locale;
  /** Translate a dotted key against the active locale with `en` fallback. */
  t: (key: string) => string;
}

const I18nContext = createContext<I18nContextValue>({
  locale: 'en',
  t: (key) => key,
});

function lookup(dict: unknown, key: string): string | undefined {
  let node: unknown = dict;
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/**
 * Active locale for the non-hook `translate()` function. Kept in sync with
 * the provider via `setActiveLocale` so engine controllers and dialog
 * builders (which cannot use the React hook) still localize.
 */
let activeLocale: Locale = 'en';

export function setActiveLocale(locale: Locale): void {
  activeLocale = locale;
}

export function I18nProvider({
  locale = 'en',
  children,
}: {
  locale?: Locale;
  children: ReactNode;
}) {
  const value = useMemo<I18nContextValue>(() => {
    const dict = dictionaries[locale] ?? dictionaries.en;
    return {
      locale,
      t: (key) => lookup(dict, key) ?? lookup(dictionaries.en, key) ?? key,
    };
  }, [locale]);

  useEffect(() => {
    setActiveLocale(locale);
  }, [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useTranslation(): I18nContextValue {
  return useContext(I18nContext);
}

/**
 * Non-hook translation for non-React modules (engine controllers, dialog
 * builders). Uses the active locale with `en` fallback; components should
 * prefer the hook.
 */
export function translate(key: string): string {
  return (
    lookup(dictionaries[activeLocale], key) ??
    lookup(dictionaries.en, key) ??
    key
  );
}
