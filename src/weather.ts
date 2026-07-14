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

const HOURLY_VARS = 'temperature_2m,apparent_temperature,precipitation,precipitation_probability,rain,showers,snowfall,surface_pressure,cloud_cover';

// 'no_coverage': the model returns nothing for this location.
// 'no_tomorrow': it has near-term data but doesn't forecast through tomorrow,
//   which the comparison view (yesterday · today · tomorrow) needs.
export type UnusableReason = 'no_coverage' | 'no_tomorrow';

export class WeatherNoDataError extends Error {
  reason: UnusableReason;
  constructor(reason: UnusableReason = 'no_coverage') {
    super('Weather data is not usable for this location');
    this.name = 'WeatherNoDataError';
    this.reason = reason;
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

// Which of the given models are usable at these coordinates. A single request
// with a comma-joined `models=` list returns a per-model `temperature_2m_<id>`
// series and omits models that have no data here, so the set of returned series
// with a non-null last hour (i.e. reaching tomorrow — matching the usability
// gate in fetchWeather) is exactly the usable set.
//
// Open-Meteo has no endpoint to list its models, and it rejects the whole batch
// with a 400 if any single id is one it no longer accepts (its catalog changes
// over time). So on request failure we split the id list and retry each half,
// isolating a bad id to a single-model probe that we simply drop — one dead id
// can never hide the markers of the valid models around it. Never rejects.
export async function fetchModelAvailability(
  lat: number,
  lon: number,
  modelIds: string[],
): Promise<Set<string>> {
  if (!modelIds.length) return new Set();

  const result = await probeModels(lat, lon, modelIds);
  if (result) return result;                 // request succeeded (subset, maybe empty)
  if (modelIds.length === 1) return new Set(); // lone id Open-Meteo rejects → drop it

  const mid = modelIds.length >> 1;
  const [a, b] = await Promise.all([
    fetchModelAvailability(lat, lon, modelIds.slice(0, mid)),
    fetchModelAvailability(lat, lon, modelIds.slice(mid)),
  ]);
  for (const id of b) a.add(id);
  return a;
}

// One availability request. Returns the usable subset, or null if the request
// itself failed (so the caller can split and retry to isolate a bad id).
async function probeModels(lat: number, lon: number, ids: string[]): Promise<Set<string> | null> {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lon));
  url.searchParams.set('hourly', 'temperature_2m');
  url.searchParams.set('timezone', 'auto');
  url.searchParams.set('past_days', '0');
  url.searchParams.set('forecast_days', '2');
  url.searchParams.set('models', ids.join(','));

  try {
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const data = await res.json() as { hourly?: Record<string, (number | null)[]> };
    const hourly = data.hourly ?? {};
    const available = new Set<string>();
    for (const id of ids) {
      // A single-model request comes back unsuffixed (`temperature_2m`).
      const series = hourly['temperature_2m_' + id] ?? (ids.length === 1 ? hourly['temperature_2m'] : undefined);
      if (series?.length && series[series.length - 1] != null) available.add(id);
    }
    return available;
  } catch {
    return null;
  }
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
  const allDays: TimelineDayInfo[] = (daily.time as string[]).map((date, i) => ({
    date,
    sunrise: (daily.sunrise[i] as string | null) ?? '',
    sunset:  (daily.sunset[i]  as string | null) ?? '',
  }));

  const hourlyRaw = data.hourly as Record<string, (number | null)[]>;

  // Not every model covers the full 14-day forecast; Open-Meteo still returns
  // the requested range but fills uncovered days with null. Trim the timeline to
  // the whole days the model actually provides so it doesn't flatline at 0. The
  // app needs at least yesterday · today · tomorrow (3 whole days) to be usable;
  // below that, surface it as a "pick another model" prompt.
  const nDays = coveredDays(hourlyRaw, allDays.length);
  if (nDays === 0) throw new WeatherNoDataError('no_coverage');
  if (nDays < 3)   throw new WeatherNoDataError('no_tomorrow');
  const days = allDays.slice(0, nDays);

  return {
    yesterday: parseDay(data, 0, avgPressure(yHourly)),
    today:     parseDay(data, 1, avgPressure(tHourly)),
    tomorrow:  parseDay(data, 2, avgPressure(tmHourly)),
    yesterdayHourly: yHourly,
    todayHourly:     tHourly,
    tomorrowHourly:  tmHourly,
    days,
    hourlyAll: toHourly(hourlyRaw, 0, nDays * 24),
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

// How many whole days the model actually covers, capped at maxDays. Temperature
// is the core series every model returns; the uncovered tail comes back as null,
// so leading non-null hours (rounded down to full days) is the real extent.
function coveredDays(h: Record<string, (number | null)[]>, maxDays: number): number {
  const temp = h['temperature_2m'] ?? [];
  let hours = 0;
  while (hours < temp.length && temp[hours] != null) hours++;
  return Math.min(maxDays, Math.floor(hours / 24));
}

function toHourly(h: Record<string, (number | null)[]>, start: number, len: number): HourlyData {
  const series = (key: string) => h[key].slice(start, start + len).map(v => v ?? 0);
  const rain    = series('rain');
  const showers = series('showers');
  // Probability is forecast-only: null for past hours (observed), and the whole
  // series is absent for models that don't provide it. Keep the nulls — the
  // chart distinguishes "observed" from "unsupported" from them.
  const prob = h['precipitation_probability'];
  return {
    temp:         series('temperature_2m'),
    apparentTemp: series('apparent_temperature'),
    precip:       series('precipitation'),
    precipProbability: prob ? prob.slice(start, start + len) : Array(len).fill(null),
    rain:         rain.map((v, i) => v + showers[i]),
    snow:         series('snowfall'),
    pressure:     series('surface_pressure'),
    cloud:        series('cloud_cover'),
  };
}

function parseHourly(data: Record<string, unknown>, start: number): HourlyData {
  return toHourly(data.hourly as Record<string, (number | null)[]>, start, 24);
}
