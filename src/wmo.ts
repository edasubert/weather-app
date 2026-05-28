import { t } from './i18n';

const EMOJIS: Record<number, string> = {
  0:  '☀️',
  1:  '🌤️',
  2:  '⛅',
  3:  '☁️',
  45: '🌫️',
  48: '🌫️',
  51: '🌦️',
  53: '🌦️',
  55: '🌦️',
  61: '🌧️',
  63: '🌧️',
  65: '🌧️',
  71: '❄️',
  73: '❄️',
  75: '❄️',
  77: '🌨️',
  80: '🌦️',
  81: '🌦️',
  82: '⛈️',
  85: '🌨️',
  86: '🌨️',
  95: '⛈️',
  96: '⛈️',
  99: '⛈️',
};

export function describeCode(code: number): { label: string; emoji: string } {
  const emoji = EMOJIS[code];
  if (!emoji) return { label: t(`wmo.unknown`), emoji: '🌡️' };
  return { label: t(`wmo.${code}` as never), emoji };
}
