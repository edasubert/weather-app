export interface DailyWeather {
  date: string;
  weatherCode: number;
  tempMax: number;
  tempMin: number;
  precipitationSum: number;
  windSpeedMax: number;
  windDirection: number;
}

export interface HourlyData {
  temp: number[];    // 24 values, one per hour
  precip: number[];  // 24 values, one per hour
}

export interface GeoResult {
  name: string;
  latitude: number;
  longitude: number;
  country: string;
  admin1?: string;
}
