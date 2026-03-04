import en from './en.json';
import it from './it.json';
import type { Locale } from '../lib/types';

const translations: Record<Locale, Record<string, string>> = { en, it };

export function t(locale: Locale, key: string, params?: Record<string, string>): string {
  let text = translations[locale]?.[key] ?? translations.en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(`{${k}}`, v);
    }
  }
  return text;
}

export function getLocaleFromUrl(url: URL): Locale {
  const [, lang] = url.pathname.split('/');
  if (lang === 'it') return 'it';
  return 'en';
}
