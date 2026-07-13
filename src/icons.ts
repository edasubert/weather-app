export const ICONS = {
  temp:     '🌡️',
  feels:    '🧑',
  rain:     '💧',
  showers:  '💦',
  snow:     '❄️',
  wind:     '💨',
  pressure: '🔵',
  cloud:    '☁️',
  daylight: '🌅',
} as const;

// Next to a concrete apparent-temperature value the icon reflects it;
// generic contexts (legend, comparison rows) keep the neutral icon.
// Thresholds are on the Celsius value, independent of the display unit.
export function feelsIcon(celsius: number): string {
  if (celsius > 25) return '🥵';
  if (celsius < 5) return '🥶';
  return ICONS.feels;
}
