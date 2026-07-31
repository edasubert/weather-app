export const ICONS = {
  temp:     '🌡️',
  feels:    '🧑',
  rain:     '🌧️',
  showers:  '💦',
  snow:     '❄️',
  wind:     '💨',
  pressure: '🗜️',
  cloud:    '☁️',
  daylight:   '🌅',
  uv:         '☀️',
  humidity:         '💧',
  visibility:       '👁️',
  gusts:            '💨',
  precipHours:      '🌧️',
  sunshine:         '😎',
} as const;

// Badge emojis rendered at the lower-right corner of a column's main emoji.
// Add an entry here to attach a badge to any metric id.
export const BADGE_ICONS: Partial<Record<string, string>> = {
  precipHours: '🕐',
  daylight: '🕐',
  sunshine: '🕐',
  gusts:       '💪',
  visibility: '↔️',
};

// Next to a concrete apparent-temperature value the icon reflects it;
// generic contexts (legend, comparison rows) keep the neutral icon.
// Thresholds are on the Celsius value, independent of the display unit.
export function feelsIcon(celsius: number): string {
  if (celsius > 25) return '🥵';
  if (celsius < 5) return '🥶';
  return ICONS.feels;
}
