export type Locale = 'pt-BR' | 'en' | 'es';

export const SUPPORTED_LOCALES: Locale[] = ['pt-BR', 'en', 'es'];

export const LOCALE_LABELS: Record<Locale, string> = {
  'pt-BR': 'Português (BR)',
  en: 'English',
  es: 'Español',
};

export type TranslationKey = keyof typeof ptBR;

import { ptBR } from './pt-BR';
import { en } from './en';
import { es } from './es';

const dictionaries = { 'pt-BR': ptBR, en, es } as const;

export function detectInitialLocale(): Locale {
  const stored = localStorage.getItem('nostr_filesync_locale');
  if (stored && stored in dictionaries) return stored as Locale;
  for (const l of SUPPORTED_LOCALES) {
    if (l === 'pt-BR' && navigator.language.startsWith('pt')) return 'pt-BR';
    if (l === 'es' && navigator.language.startsWith('es')) return 'es';
    if (l === 'en' && navigator.language.startsWith('en')) return 'en';
  }
  return 'pt-BR';
}

export function getDictionary(locale: Locale): Record<TranslationKey, string> {
  return dictionaries[locale] as Record<TranslationKey, string>;
}

export function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, k) =>
    params[k] !== undefined ? String(params[k]) : `{${k}}`
  );
}