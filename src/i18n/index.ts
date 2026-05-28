import i18next from 'i18next';
import en from './en';
import cs from './cs';
import de from './de';
import es from './es';
import fr from './fr';
import ja from './ja';
import pt from './pt';
import uk from './uk';

export type Lang = 'en' | 'cs' | 'de' | 'es' | 'fr' | 'ja' | 'pt' | 'uk';
export const LANGS: Lang[] = ['en', 'cs', 'de', 'es', 'fr', 'ja', 'pt', 'uk'];

i18next.init({
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  resources: {
    en: { translation: en },
    cs: { translation: cs },
    de: { translation: de },
    es: { translation: es },
    fr: { translation: fr },
    ja: { translation: ja },
    pt: { translation: pt },
    uk: { translation: uk },
  },
});

export const t = i18next.t.bind(i18next);

export function setLang(lang: Lang): void {
  i18next.changeLanguage(lang);
}

export function getLang(): Lang {
  return (i18next.language ?? 'en') as Lang;
}
