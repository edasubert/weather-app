// Open-Meteo Air Quality is a separate host from the weather forecast API. We
// fetch only the three gases with genuine hourly EAQI thresholds — the severity
// chart plots their raw hourly concentrations and derives Y from the EAQI bands
// in airchart.ts. One request covers yesterday (past_days=1) through 6 forecast
// days, matching the forecast API's hour alignment.
//
// This whole module is best-effort: air quality *enriches* the weather view, so
// any failure (bad status, error payload, sparse/absent data) resolves to null
// and the dependent UI simply hides.

// Raw hourly concentrations (µg/m³) for the three gases. Their Y position on the
// chart is derived from the EAQI breakpoints in airchart.ts.
export interface AirHourly {
  no2: (number | null)[];
  o3:  (number | null)[];
  so2: (number | null)[];
}

export interface AirData {
  hourly: AirHourly;
  utcOffsetSeconds: number;
}

const HOURLY_VARS = ['nitrogen_dioxide', 'ozone', 'sulphur_dioxide'].join(',');

type Hourly = Record<string, (number | null)[]>;

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
