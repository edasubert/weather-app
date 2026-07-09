import en from './en';

export type Lang = 'en' | 'cs' | 'de' | 'es' | 'fr' | 'ja' | 'pt' | 'uk';
export const LANGS: Lang[] = ['en', 'cs', 'de', 'es', 'fr', 'ja', 'pt', 'uk'];

type Dict = { [key: string]: unknown };

// Non-English locales are code-split and fetched only when selected
const LOADERS: Record<Lang, () => Promise<{ default: Dict }>> = {
  en: () => Promise.resolve({ default: en }),
  cs: () => import('./cs'),
  de: () => import('./de'),
  es: () => import('./es'),
  fr: () => import('./fr'),
  ja: () => import('./ja'),
  pt: () => import('./pt'),
  uk: () => import('./uk'),
};

const loaded: Partial<Record<Lang, Dict>> = { en };
let current: Lang = 'en';

function lookup(dict: Dict | undefined, key: string): string | undefined {
  let node: unknown = dict;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Dict)[part];
  }
  return typeof node === 'string' ? node : undefined;
}

export function t(key: string, vars?: Record<string, string | number>): string {
  let str = lookup(loaded[current], key) ?? lookup(en, key) ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.split(`{{${k}}}`).join(String(v));
    }
  }
  return str;
}

export async function setLang(lang: Lang): Promise<void> {
  if (!loaded[lang]) loaded[lang] = (await LOADERS[lang]()).default;
  current = lang;
}

export function getLang(): Lang {
  return current;
}
