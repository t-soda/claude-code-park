import { create } from "zustand";
import { isLocale, resolveLocale, type Locale } from "./locales";

/**
 * Client-side display-language setting (persisted to localStorage).
 * On first run it's inferred from the OS locale (navigator.language); thereafter the user's choice is respected.
 */
const STORAGE_KEY = "claude-code-park:locale";

/** Pure function that infers the locale from the OS locale when there's no persisted value. */
export function initialLocale(stored: string | null, navLang: string | null): Locale {
  if (isLocale(stored)) return stored;
  return resolveLocale(navLang);
}

function load(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const navLang = typeof navigator !== "undefined" ? navigator.language : null;
    return initialLocale(stored, navLang);
  } catch {
    return "en";
  }
}

function persist(locale: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Silently ignore when storage is unavailable (it just reverts to the OS locale on next launch).
  }
}

interface I18nState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

export const useI18nStore = create<I18nState>((set) => ({
  locale: load(),
  setLocale(locale) {
    set({ locale });
    persist(locale);
  },
}));

/** Helper for reading the current locale from outside React (e.g. the Pixi engine). */
export function currentLocale(): Locale {
  return useI18nStore.getState().locale;
}
