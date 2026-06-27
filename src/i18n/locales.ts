/** Supported locales. ja is the source of truth (types are derived from it). */
export const LOCALES = ["ja", "en", "zh", "ko", "es", "fr", "de"] as const;

export type Locale = (typeof LOCALES)[number];

/** Display names used in the language selector etc. (each language's endonym). */
export const LOCALE_LABELS: Record<Locale, string> = {
  ja: "日本語",
  en: "English",
  zh: "中文",
  ko: "한국어",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
};

/** Type guard that checks whether a possibly-unknown value is a supported locale. */
export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v);
}

/**
 * Infers a supported locale from a BCP-47 tag such as navigator.language.
 * Falls back to en if there's no match (a Japanese product, but defaulting to international users).
 */
export function resolveLocale(tag: string | null | undefined): Locale {
  if (!tag) return "en";
  const lower = tag.toLowerCase();
  const primary = lower.split("-")[0];
  if (isLocale(primary)) return primary;
  // Map zh-Hant / zh-TW etc. to the Simplified Chinese catalog too (currently only zh exists).
  if (primary === "zh") return "zh";
  return "en";
}
