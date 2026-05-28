const CODES: Record<number, [string, string]> = {
  0:  ['Clear sky',           '☀️'],
  1:  ['Mainly clear',        '🌤️'],
  2:  ['Partly cloudy',       '⛅'],
  3:  ['Overcast',            '☁️'],
  45: ['Fog',                 '🌫️'],
  48: ['Rime fog',            '🌫️'],
  51: ['Light drizzle',       '🌦️'],
  53: ['Drizzle',             '🌦️'],
  55: ['Heavy drizzle',       '🌦️'],
  61: ['Light rain',          '🌧️'],
  63: ['Rain',                '🌧️'],
  65: ['Heavy rain',          '🌧️'],
  71: ['Light snow',          '❄️'],
  73: ['Snow',                '❄️'],
  75: ['Heavy snow',          '❄️'],
  77: ['Snow grains',         '🌨️'],
  80: ['Light showers',       '🌦️'],
  81: ['Rain showers',        '🌦️'],
  82: ['Violent showers',     '⛈️'],
  85: ['Snow showers',        '🌨️'],
  86: ['Heavy snow showers',  '🌨️'],
  95: ['Thunderstorm',        '⛈️'],
  96: ['Thunderstorm',        '⛈️'],
  99: ['Thunderstorm',        '⛈️'],
};

export function describeCode(code: number): { label: string; emoji: string } {
  const entry = CODES[code];
  return entry ? { label: entry[0], emoji: entry[1] } : { label: 'Unknown', emoji: '🌡️' };
}
