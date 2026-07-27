/**
 * Lightweight i18n provider.
 *
 * All user-facing strings live in locale JSON files; `en` is the default
 * and fallback. To add zh-CN later: create `zh-CN.json` with the same key
 * tree, register it in `dictionaries` below, and pass locale="zh-CN" to
 * the provider. Keys are dotted paths (e.g. "ribbon.tabs.model"); missing
 * keys render the key itself so gaps are visible during development.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import en from './en.json';

export type Locale = 'en' | (string & {});

type Messages = typeof en;

const dictionaries: Record<string, Messages> = {
  en,
  // 'zh-CN': zhCN, // TODO(locale): add Simplified Chinese dictionary
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

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useTranslation(): I18nContextValue {
  return useContext(I18nContext);
}

/**
 * Non-hook translation for non-React modules (engine controllers, dialog
 * builders). Always uses the default `en` dictionary — components should
 * prefer the hook.
 */
export function translate(key: string): string {
  return lookup(dictionaries.en, key) ?? key;
}
