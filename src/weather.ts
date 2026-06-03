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
  'wind_speed_10m_max',
  'wind_direction_10m_dominant',
].join(',');

const HOURLY_VARS = 'temperature_2m,apparent_temperature,precipitation,surface_pressure';

export class WeatherNoDataError extends Error {
  constructor() {
    super('No data is available for this location');
    this.name = 'WeatherNoDataError';
  }
}

export async function fetchWeather(
  lat: number,
  lon: number,
  model?: string,
): Promise<{ today: DailyWeather; yesterday: DailyWeather; tomorrow: DailyWeather; todayHourly: HourlyData; yesterdayHourly: HourlyData; tomorrowHourly: HourlyData }> {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lon));
  url.searchParams.set('daily', DAILY_VARS);
  url.searchParams.set('hourly', HOURLY_VARS);
  url.searchParams.set('timezone', 'auto');
  url.searchParams.set('past_days', '1');
  url.searchParams.set('forecast_days', '2');
  if (model && model !== 'best_match') {
    url.searchParams.set('models', model);
  }

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: boolean; reason?: string } | null;
    if (body?.error === true) {
      throw new WeatherNoDataError();
    }
    throw new Error(`Weather API error ${res.status}`);
  }
  const data: Record<string, unknown> = await res.json().catch(() => { throw new WeatherNoDataError(); });

  const yHourly  = parseHourly(data, 0);
  const tHourly  = parseHourly(data, 24);
  const tmHourly = parseHourly(data, 48);
  const avgPressure = (h: HourlyData) => h.pressure.reduce((a, b) => a + b, 0) / 24;

  return {
    yesterday: parseDay(data, 0, avgPressure(yHourly)),
    today:     parseDay(data, 1, avgPressure(tHourly)),
    tomorrow:  parseDay(data, 2, avgPressure(tmHourly)),
    yesterdayHourly: yHourly,
    todayHourly:     tHourly,
    tomorrowHourly:  tmHourly,
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
    windSpeedMax: (d.wind_speed_10m_max[i] as number | null) ?? 0,
    windDirection: (d.wind_direction_10m_dominant[i] as number | null) ?? 0,
    pressureMean,
  };
}

function parseHourly(data: Record<string, unknown>, start: number): HourlyData {
  const h = data.hourly as Record<string, (number | null)[]>;
  return {
    temp: h.temperature_2m.slice(start, start + 24).map(v => v ?? 0),
    apparentTemp: h.apparent_temperature.slice(start, start + 24).map(v => v ?? 0),
    precip: h.precipitation.slice(start, start + 24).map(v => v ?? 0),
    pressure: h.surface_pressure.slice(start, start + 24).map(v => v ?? 0),
  };
}
