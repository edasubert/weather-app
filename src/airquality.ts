// Open-Meteo Air Quality is a separate host from the weather forecast API and has
// no daily endpoint, so daily means are aggregated client-side from the hourly
// series. One request covers yesterday (past_days=1) through 6 forecast days —
// the daily comparison tiles and the scrollable severity chart share it.
//
// This whole module is best-effort: air quality *enriches* the weather view, so
// any failure (bad status, error payload, sparse/absent data) resolves to null
// and the dependent UI simply hides.

// Daily-mean pollutant levels for one day, in the units the comparison tiles show
// (pm25/pm10/co in µg/m³, co2 in ppm). null when the day has no reading.
export interface AirDaily {
  pm25: number | null;
  pm10: number | null;
  co:   number | null;
  co2:  number | null;
}

// Raw hourly concentrations (µg/m³) for the three gases with genuine hourly EAQI
// thresholds. These are the values the severity chart plots; their Y position is
// derived from the EAQI breakpoints in airchart.ts.
export interface AirHourly {
  no2: (number | null)[];
  o3:  (number | null)[];
  so2: (number | null)[];
}

export interface AirData {
  yesterday: AirDaily;
  today: AirDaily;
  tomorrow: AirDaily;
  hourly: AirHourly;
  utcOffsetSeconds: number;
}

const HOURLY_VARS = [
  'pm2_5',
  'pm10',
  'carbon_monoxide',
  'carbon_dioxide',
  'nitrogen_dioxide',
  'ozone',
  'sulphur_dioxide',
].join(',');

type Hourly = Record<string, (number | null)[]>;

// Mean of a 24-hour block, skipping nulls. Returns null when the day has no
// (finite) readings at all, so the tile drops rather than showing a fake 0.
function dayMean(series: (number | null)[] | undefined, dayIdx: number): number | null {
  if (!series) return null;
  let sum = 0;
  let count = 0;
  for (let i = dayIdx * 24; i < dayIdx * 24 + 24 && i < series.length; i++) {
    const v = series[i];
    if (v != null && Number.isFinite(v)) { sum += v; count++; }
  }
  return count ? sum / count : null;
}

function aggregateDay(h: Hourly, dayIdx: number): AirDaily {
  return {
    pm25: dayMean(h['pm2_5'], dayIdx),
    pm10: dayMean(h['pm10'], dayIdx),
    co:   dayMean(h['carbon_monoxide'], dayIdx),
    co2:  dayMean(h['carbon_dioxide'], dayIdx),
  };
}

// Never rejects — returns null on any failure so callers can Promise.all it
// alongside the weather fetch without a try/catch of their own.
export async function fetchAirQuality(lat: number, lon: number): Promise<AirData | null> {
  try {
    const url = new URL('https://air-quality-api.open-meteo.com/v1/air-quality');
    url.searchParams.set('latitude', String(lat));
    url.searchParams.set('longitude', String(lon));
    url.searchParams.set('hourly', HOURLY_VARS);
    url.searchParams.set('timezone', 'auto');
    url.searchParams.set('past_days', '1');
    url.searchParams.set('forecast_days', '6');

    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const data = await res.json().catch(() => null) as
      | { error?: boolean; hourly?: Hourly; utc_offset_seconds?: number }
      | null;
    if (!data || data.error === true) return null;

    const h = data.hourly;
    // With timezone=auto & past_days=1, hour 0 is yesterday 00:00 local — the same
    // alignment the forecast API uses, so hour indices match weather.hourlyAll.
    if (!h || !Array.isArray(h['time']) || h['time'].length === 0) return null;

    return {
      yesterday: aggregateDay(h, 0),
      today:     aggregateDay(h, 1),
      tomorrow:  aggregateDay(h, 2),
      hourly: {
        no2: h['nitrogen_dioxide'] ?? [],
        o3:  h['ozone'] ?? [],
        so2: h['sulphur_dioxide'] ?? [],
      },
      utcOffsetSeconds: data.utc_offset_seconds ?? 0,
    };
  } catch {
    return null;
  }
}
