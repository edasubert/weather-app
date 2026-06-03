export interface DailyWeather {
  date: string;
  weatherCode: number;
  tempMax: number;
  tempMean: number;
  tempMin: number;
  apparentTempMax: number;
  apparentTempMean: number;
  apparentTempMin: number;
  precipitationSum: number;
  windSpeedMax: number;
  windDirection: number;
  pressureMean: number;
}

export interface HourlyData {
  temp: number[];
  apparentTemp: number[];
  precip: number[];
  pressure: number[];
}

export interface GeoResult {
  name: string;
  latitude: number;
  longitude: number;
  country: string;
  admin1?: string;
}
