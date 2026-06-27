import { useI18nStore, currentLocale } from "./store";
import { ja } from "./messages/ja";
import { en } from "./messages/en";
import { zh } from "./messages/zh";
import { ko } from "./messages/ko";
import { es } from "./messages/es";
import { fr } from "./messages/fr";
import { de } from "./messages/de";
import type { Locale } from "./locales";

export { LOCALES, LOCALE_LABELS, isLocale, resolveLocale, type Locale } from "./locales";
export { useI18nStore, currentLocale } from "./store";

/** Common catalog type derived from ja's structure with leaves widened to string (other languages must satisfy this). */
type Widen<T> = { [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };
export type Messages = Widen<typeof ja>;

/** Derives the union of "a.b.c"-style key paths from a nested catalog. */
type DotPaths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${DotPaths<T[K]>}`;
}[keyof T & string];

export type MessageKey = DotPaths<typeof ja>;

const CATALOGS: Record<Locale, Messages> = { ja, en, zh, ko, es, fr, de };

/** Interpolation parameters. */
export type Params = Record<string, string | number>;

/** Walks the catalog by a dot-separated key. Returns undefined if not found. */
function lookup(catalog: Messages, key: string): string | undefined {
  const value = key
    .split(".")
    .reduce<unknown>((acc, part) => (acc as Record<string, unknown> | undefined)?.[part], catalog);
  return typeof value === "string" ? value : undefined;
}

/** Replaces {name}-style placeholders with values from params. */
function interpolate(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, name) =>
    name in params ? String(params[name]) : m
  );
}

/**
 * Pure function that resolves a key for the given locale (for tests and non-reactive use).
 * Falls back to ja if missing in that locale, and returns the key string if missing there too.
 */
export function translate(locale: Locale, key: MessageKey, params?: Params): string {
  const raw = lookup(CATALOGS[locale], key) ?? lookup(ja, key) ?? key;
  return interpolate(raw, params);
}

/**
 * Resolves a key for the current locale (for use outside React, e.g. the Pixi engine).
 * Note: inside React components use useT() instead (it re-renders on language change).
 */
export function t(key: MessageKey, params?: Params): string {
  return translate(currentLocale(), key, params);
}

/**
 * React hook. Subscribes to the locale; the returned t triggers a re-render on language change.
 */
export function useT(): (key: MessageKey, params?: Params) => string {
  const locale = useI18nStore((s) => s.locale);
  return (key, params) => translate(locale, key, params);
}
