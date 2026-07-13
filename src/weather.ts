import type { DailyWeather, HourlyData } from './types';

const DAILY_VARS = [
  'weather_code',
  'temperature_2m_max',
  'temperature_2m_mean',
  'temperature_2m_min',
  'apparent_temperature_max',
  'apparent_temperature_mean',
  'apparent_temperature_min',
  'precipitation_sum',
  'rain_sum',
  'showers_sum',
  'snowfall_sum',
  'wind_speed_10m_max',
  'wind_direction_10m_dominant',
  'sunrise',
  'sunset',
  'daylight_duration',
].join(',');

const HOURLY_VARS = 'temperature_2m,apparent_temperature,precipitation,rain,showers,snowfall,surface_pressure,cloud_cover';

export class WeatherNoDataError extends Error {
  constructor() {
    super('No data is available for this location');
    this.name = 'WeatherNoDataError';
  }
}

async function fetchForecast(
  lat: number,
  lon: number,
  params: Record<string, string>,
  model?: string,
): Promise<Record<string, unknown>> {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lon));
  url.searchParams.set('hourly', HOURLY_VARS);
  url.searchParams.set('timezone', 'auto');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (model && model !== 'best_match') {
    url.searchParams.set('models', model);
  }

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: boolean; reason?: string } | null;
    if (body?.error === true) throw new WeatherNoDataError();
    throw new Error(`Weather API error ${res.status}`);
  }
  // Some models return 200 with NaN payloads for out-of-coverage locations
  return await res.json().catch(() => { throw new WeatherNoDataError(); }) as Record<string, unknown>;
}

export interface TimelineDayInfo {
  date: string;
  sunrise: string;
  sunset: string;
}

// One request covers everything: yesterday (past_days=1) through 14 forecast
// days, both daily and hourly — the comparison and the scrollable timeline
// render from the same response.
export async function fetchWeather(
  lat: number,
  lon: number,
  model?: string,
): Promise<{ today: DailyWeather; yesterday: DailyWeather; tomorrow: DailyWeather; todayHourly: HourlyData; yesterdayHourly: HourlyData; tomorrowHourly: HourlyData; days: TimelineDayInfo[]; hourlyAll: HourlyData; utcOffsetSeconds: number }> {
  const data = await fetchForecast(lat, lon, {
    daily: DAILY_VARS,
    past_days: '1',
    forecast_days: '14',
  }, model);

  const yHourly  = parseHourly(data, 0);
  const tHourly  = parseHourly(data, 24);
  const tmHourly = parseHourly(data, 48);
  const avgPressure = (h: HourlyData) => h.pressure.reduce((a, b) => a + b, 0) / 24;

  const daily = data.daily as Record<string, unknown[]>;
  const days: TimelineDayInfo[] = (daily.time as string[]).map((date, i) => ({
    date,
    sunrise: (daily.sunrise[i] as string | null) ?? '',
    sunset:  (daily.sunset[i]  as string | null) ?? '',
  }));

  const hourlyRaw = data.hourly as Record<string, (number | null)[]>;

  return {
    yesterday: parseDay(data, 0, avgPressure(yHourly)),
    today:     parseDay(data, 1, avgPressure(tHourly)),
    tomorrow:  parseDay(data, 2, avgPressure(tmHourly)),
    yesterdayHourly: yHourly,
    todayHourly:     tHourly,
    tomorrowHourly:  tmHourly,
    days,
    hourlyAll: toHourly(hourlyRaw, 0, days.length * 24),
    utcOffsetSeconds: (data.utc_offset_seconds as number | undefined) ?? 0,
  };
}

function parseDay(data: Record<string, unknown>, i: number, pressureMean: number): DailyWeather {
  const d = data.daily as Record<string, unknown[]>;
  return {
    date: d.time[i] as string,
    weatherCode: d.weather_code[i] as number,
    tempMax: d.temperature_2m_max[i] as number,
    tempMean: d.temperature_2m_mean[i] as number,
    tempMin: d.temperature_2m_min[i] as number,
    apparentTempMax: d.apparent_temperature_max[i] as number,
    apparentTempMean: d.apparent_temperature_mean[i] as number,
    apparentTempMin: d.apparent_temperature_min[i] as number,
    precipitationSum: (d.precipitation_sum[i] as number | null) ?? 0,
    rainSum: (d.rain_sum[i] as number | null) ?? 0,
    showersSum: (d.showers_sum[i] as number | null) ?? 0,
    snowfallSum: (d.snowfall_sum[i] as number | null) ?? 0,
    windSpeedMax: (d.wind_speed_10m_max[i] as number | null) ?? 0,
    windDirection: (d.wind_direction_10m_dominant[i] as number | null) ?? 0,
    pressureMean,
    sunrise: (d.sunrise[i] as string | null) ?? '',
    sunset: (d.sunset[i] as string | null) ?? '',
    daylightDuration: (d.daylight_duration[i] as number | null) ?? 0,
  };
}

function toHourly(h: Record<string, (number | null)[]>, start: number, len: number): HourlyData {
  const series = (key: string) => h[key].slice(start, start + len).map(v => v ?? 0);
  const rain    = series('rain');
  const showers = series('showers');
  return {
    temp:         series('temperature_2m'),
    apparentTemp: series('apparent_temperature'),
    precip:       series('precipitation'),
    rain:         rain.map((v, i) => v + showers[i]),
    snow:         series('snowfall'),
    pressure:     series('surface_pressure'),
    cloud:        series('cloud_cover'),
  };
}

function parseHourly(data: Record<string, unknown>, start: number): HourlyData {
  return toHourly(data.hourly as Record<string, (number | null)[]>, start, 24);
}
