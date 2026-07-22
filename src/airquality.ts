// Open-Meteo Air Quality (CAMS — the Copernicus Atmosphere Monitoring Service) is
// a separate host from the weather forecast API. One request covers yesterday
// (past_days=1) through 6 forecast days and carries the gases + PM (severity
// chart), the pollen taxa (pollen chart), and the UV index (timeline strip) — all
// from the same CAMS source, aligned to the forecast API's hour grid. UV lives
// here rather than on the forecast API because the app pins a `models=` on the
// latter, under which uv_index returns all-null.
//
// This whole module is best-effort: air quality *enriches* the weather view, so
// any failure (bad status, error payload, sparse/absent data) resolves to null
// and the dependent UI simply hides.

// Raw hourly concentrations (µg/m³) for the three gases. Their Y position on the
// chart is derived from the EAQI breakpoints in airchart.ts.
export interface AirHourly {
  no2:  (number | null)[];
  o3:   (number | null)[];
  so2:  (number | null)[];
  pm25: (number | null)[];
  pm10: (number | null)[];
}

// Raw hourly pollen counts (grains/m³) for the six CAMS taxa. Europe-only and
// in-season — outside coverage the arrays come back empty/null and the pollen
// chart hides. The pollen chart derives Y from EAACI clinical bands (pollenchart.ts).
export interface PollenHourly {
  alder:   (number | null)[];
  birch:   (number | null)[];
  grass:   (number | null)[];
  mugwort: (number | null)[];
  olive:   (number | null)[];
  ragweed: (number | null)[];
}

export interface AirData {
  hourly: AirHourly;
  pollen: PollenHourly;
  // Hourly UV index (WHO/WMO scale), model-independent CAMS value. Merged into
  // the weather timeline's hourly series (the UV strip). Nulls beyond the CAMS
  // horizon stay null so those hours render no strip.
  uv: (number | null)[];
  utcOffsetSeconds: number;
}

const HOURLY_VARS = [
  'nitrogen_dioxide', 'ozone', 'sulphur_dioxide', 'pm2_5', 'pm10',
  'alder_pollen', 'birch_pollen', 'grass_pollen',
  'mugwort_pollen', 'olive_pollen', 'ragweed_pollen',
  'uv_index',
].join(',');

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
    // Route each location to the best CAMS model: the higher-resolution European
    // regional domain where covered (0.1°, and the only one with pollen), falling
    // back to CAMS global (0.4°) elsewhere. This is Open-Meteo's default, set
    // explicitly so the Europe→regional / rest→global behaviour is guaranteed.
    url.searchParams.set('domains', 'auto');

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
        no2:  h['nitrogen_dioxide'] ?? [],
        o3:   h['ozone'] ?? [],
        so2:  h['sulphur_dioxide'] ?? [],
        pm25: h['pm2_5'] ?? [],
        pm10: h['pm10'] ?? [],
      },
      pollen: {
        alder:   h['alder_pollen'] ?? [],
        birch:   h['birch_pollen'] ?? [],
        grass:   h['grass_pollen'] ?? [],
        mugwort: h['mugwort_pollen'] ?? [],
        olive:   h['olive_pollen'] ?? [],
        ragweed: h['ragweed_pollen'] ?? [],
      },
      uv: h['uv_index'] ?? [],
      utcOffsetSeconds: data.utc_offset_seconds ?? 0,
    };
  } catch {
    return null;
  }
}
