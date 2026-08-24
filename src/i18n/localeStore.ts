/**
 * Tiny zustand store for the active UI locale. Lives above `I18nProvider`
 * (mounted in `src/main.tsx`) so components can switch language from
 * anywhere in the tree (see the picker in `AppearanceDialog`).
 */
import { create } from 'zustand';
import {
  detectLocale,
  persistLocale,
  type SupportedLocale,
} from './locales';

interface LocaleState {
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;
}

export const useLocaleStore = create<LocaleState>((set) => ({
  locale: detectLocale(),
  setLocale: (locale) => {
    persistLocale(locale);
    set({ locale });
  },
}));
