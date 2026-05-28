import type { GeoResult } from './types';

export async function searchCity(query: string): Promise<GeoResult[]> {
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.searchParams.set('name', query);
  url.searchParams.set('count', '5');
  url.searchParams.set('language', 'en');
  url.searchParams.set('format', 'json');

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Geocoding error ${res.status}`);
  const data: { results?: GeoResult[] } = await res.json();
  return data.results ?? [];
}
