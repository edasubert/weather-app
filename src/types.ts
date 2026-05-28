export interface DailyWeather {
  date: string;
  weatherCode: number;
  tempMax: number;
  tempMin: number;
  precipitationSum: number;
}

export interface GeoResult {
  name: string;
  latitude: number;
  longitude: number;
  country: string;
  admin1?: string;
}
