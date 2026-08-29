import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  detectInitialLocale,
  getDictionary,
  interpolate,
  type Locale,
  type TranslationKey,
} from '../i18n';

const STORAGE_KEY = 'nostr_filesync_locale';

let currentLocale: Locale = detectInitialLocale();
const listeners = new Set<(l: Locale) => void>();

export function getLocale(): Locale {
  return currentLocale;
}

export function setLocale(l: Locale): void {
  if (currentLocale === l) return;
  currentLocale = l;
  localStorage.setItem(STORAGE_KEY, l);
  for (const fn of listeners) fn(l);
}

export function onLocaleChange(fn: (l: Locale) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export interface UseTResult {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

export function useT(): UseTResult {
  const [locale, setLocaleState] = useState<Locale>(currentLocale);
  useEffect(() => {
    const unsub = onLocaleChange(setLocaleState);
    return unsub;
  }, []);
  const t = useCallback(
    (key: TranslationKey, params?: Record<string, string | number>) => {
      const dict = getDictionary(locale);
      const template = dict[key] ?? key;
      return interpolate(template, params);
    },
    [locale]
  );
  return useMemo(() => ({ locale, setLocale: (l: Locale) => setLocale(l), t }), [locale, t]);
}