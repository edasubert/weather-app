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
  rainSum: number;
  showersSum: number;
  snowfallSum: number;
  windSpeedMax: number;
  windDirection: number;
  pressureMean: number;
  sunrise: string;
  sunset: string;
  daylightDuration: number;
}

export interface HourlyData {
  temp: number[];
  apparentTemp: number[];
  precip: number[];
  precipProbability: (number | null)[];
  rain: number[];
  snow: number[];
  pressure: number[];
  cloud: number[];
}

export interface GeoResult {
  name: string;
  latitude: number;
  longitude: number;
  country: string;
  admin1?: string;
}
