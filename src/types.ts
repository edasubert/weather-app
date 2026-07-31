export interface DailyWeather {
  date: string;
  tempMax: number;
  tempMean: number;
  tempMin: number;
  apparentTempMax: number;
  apparentTempMean: number;
  apparentTempMin: number;
  rainSum: number;
  showersSum: number;
  snowfallSum: number;
  precipHours: number;
  precipProbabilityMax: number | null;
  windSpeedMax: number;
  gustMax: number;
  pressureMean: number;
  sunrise: string;
  sunset: string;
  daylightDuration: number;
  sunshineDuration: number;
  humidityMin: number;
  humidityMean: number;
  humidityMax: number;
  visibilityMin: number;   // km
  visibilityMean: number;  // km
  visibilityMax: number;   // km
  cloudMean: number;       // % daily mean from hourly
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
  windSpeed: number[];
  windDirection: number[];
  uvIndex: (number | null)[]; // from CAMS (air-quality); null past its ~7-day horizon
  humidity: number[];         // %
}

export interface GeoResult {
  name: string;
  latitude: number;
  longitude: number;
  country: string;
  admin1?: string;
}
