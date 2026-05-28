import './style.css';
import { fetchWeather } from './weather';
import { searchCity } from './geocoding';
import { describeCode } from './wmo';
import { buildChart } from './chart';
import type { DailyWeather, GeoResult, HourlyData } from './types';

const root = document.getElementById('app')!;
let unit: 'C' | 'F' = 'C';
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let suggestions: GeoResult[] = [];

// ─── Theme ────────────────────────────────────────────────────────────────────

type Theme = 'auto' | 'dark' | 'light';
type WeatherData = { today: DailyWeather; yesterday: DailyWeather; todayHourly: HourlyData; yesterdayHourly: HourlyData };
type ViewState =
  | { type: 'search' }
  | { type: 'loading' }
  | { type: 'weather'; location: GeoResult; weather: WeatherData }
  | null;

let theme: Theme = 'auto';
let _currentView: ViewState = null;
const THEME_ICONS: Record<Theme, string> = { auto: '🌗', dark: '🌙', light: '☀️' };
const THEME_CYCLE: Record<Theme, Theme> = { auto: 'dark', dark: 'light', light: 'auto' };

function isDark(): boolean {
  return theme === 'dark' || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
}

function themeLabel(): string {
  return theme === 'auto' ? 'Auto' : theme === 'dark' ? 'Dark mode' : 'Light mode';
}

function attachThemeHandler(): void {
  document.getElementById('theme-btn')?.addEventListener('click', () => {
    theme = THEME_CYCLE[theme];
    applyTheme();
  });
}

function applyTheme(): void {
  document.documentElement.classList.toggle('dark', isDark());
  if (_currentView?.type === 'search') {
    renderSearch();
  } else if (_currentView?.type === 'weather') {
    renderWeather(_currentView.location, _currentView.weather);
  }
}

// ─── Temperature helpers ──────────────────────────────────────────────────────

function tempStr(c: number): string {
  if (unit === 'F') return `${Math.round(c * 9 / 5 + 32)}°F`;
  return `${Math.round(c)}°C`;
}

function diffStr(diffC: number): string {
  if (unit === 'F') return `${Math.abs(Math.round(diffC * 9 / 5))}°F`;
  return `${Math.abs(Math.round(diffC))}°C`;
}

// ─── Wind helpers ─────────────────────────────────────────────────────────────

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

function windDirLabel(degrees: number): string {
  return COMPASS[Math.round(degrees / 45) % 8];
}

// ─── Comparison summaries ─────────────────────────────────────────────────────

function tempComparison(today: DailyWeather, yesterday: DailyWeather): string {
  const diff = (today.tempMax + today.tempMin) / 2 - (yesterday.tempMax + yesterday.tempMin) / 2;
  if (Math.abs(diff) < 0.5) return 'Similar temperature';
  return diff > 0 ? `${diffStr(diff)} warmer` : `${diffStr(-diff)} cooler`;
}

function precipComparison(today: DailyWeather, yesterday: DailyWeather): string {
  const diff = today.precipitationSum - yesterday.precipitationSum;
  if (Math.abs(diff) < 0.1) return 'Similar precipitation';
  return diff > 0
    ? `${Math.abs(diff).toFixed(1)} mm more rain`
    : `${Math.abs(diff).toFixed(1)} mm less rain`;
}

function windComparison(today: DailyWeather, yesterday: DailyWeather): string {
  const diff = today.windSpeedMax - yesterday.windSpeedMax;
  if (Math.abs(diff) < 1) return 'Similar wind';
  return diff > 0 ? `${Math.round(diff)} km/h windier` : `${Math.round(-diff)} km/h calmer`;
}

// ─── Card HTML ────────────────────────────────────────────────────────────────

function weatherCardHTML(data: DailyWeather, heading: string, dark: boolean): string {
  const { emoji, label } = describeCode(data.weatherCode);
  const date = new Date(data.date + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
  return `
    <div class="rounded-2xl shadow-sm p-5 flex flex-col gap-2" style="background-color:${dark ? '#1e293b' : '#fff'}">
      <div class="text-xs font-semibold uppercase tracking-wider ${dark ? 'text-slate-500' : 'text-slate-400'}">${heading}</div>
      <div class="text-xs ${dark ? 'text-slate-500' : 'text-slate-400'}">${date}</div>
      <div class="text-5xl my-2">${emoji}</div>
      <div class="font-medium ${dark ? 'text-slate-200' : 'text-slate-700'}">${label}</div>
      <div class="text-2xl font-semibold ${dark ? 'text-slate-100' : 'text-slate-800'}">
        ${tempStr(data.tempMax)}
        <span class="text-base font-normal ${dark ? 'text-slate-500' : 'text-slate-400'}">/ ${tempStr(data.tempMin)}</span>
      </div>
      <div class="text-sm ${dark ? 'text-slate-500' : 'text-slate-400'}">
        ${data.precipitationSum > 0 ? `${data.precipitationSum.toFixed(1)} mm rain` : 'No rain'}
      </div>
      <div class="text-sm ${dark ? 'text-slate-500' : 'text-slate-400'}">
        💨 ${Math.round(data.windSpeedMax)} km/h ${windDirLabel(data.windDirection)}
      </div>
    </div>
  `;
}

// ─── URL state ────────────────────────────────────────────────────────────────

function getLocationFromUrl(): GeoResult | null {
  const p = new URLSearchParams(window.location.search);
  const lat = p.get('lat');
  const lon = p.get('lon');
  const name = p.get('name');
  if (!lat || !lon || !name) return null;
  return {
    latitude: parseFloat(lat),
    longitude: parseFloat(lon),
    name,
    country: p.get('country') ?? '',
    admin1: p.get('admin1') ?? undefined,
  };
}

function setUrlParams(location: GeoResult): void {
  const p = new URLSearchParams();
  p.set('lat', location.latitude.toFixed(4));
  p.set('lon', location.longitude.toFixed(4));
  p.set('name', location.name);
  p.set('country', location.country);
  if (location.admin1) p.set('admin1', location.admin1);
  history.replaceState(null, '', '?' + p.toString());
}

function clearUrlParams(): void {
  history.replaceState(null, '', window.location.pathname);
}

// ─── Views ────────────────────────────────────────────────────────────────────

function renderSearch(): void {
  _currentView = { type: 'search' };
  clearUrlParams();
  const dark = isDark();
  root.innerHTML = `
    <div class="min-h-screen flex items-center justify-center p-4">
      <div class="w-full max-w-sm">
        <div class="text-center mb-8">
          <div class="text-5xl mb-3">🌤️</div>
          <h1 class="text-2xl font-semibold ${dark ? 'text-slate-100' : 'text-slate-800'}">Weather</h1>
          <p class="${dark ? 'text-slate-400' : 'text-slate-500'} mt-1 text-sm">Today's forecast vs yesterday's weather</p>
        </div>

        <div class="relative mb-3">
          <input
            id="city-input"
            type="text"
            placeholder="Search for a city…"
            autocomplete="off"
            class="w-full px-4 py-3 rounded-xl border ${dark ? 'border-slate-700 bg-slate-800 text-slate-200 placeholder-slate-500' : 'border-slate-200 bg-white text-slate-700 placeholder-slate-400'} shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
          />
          <div
            id="suggestions-box"
            class="absolute top-full mt-1 w-full ${dark ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-100'} rounded-xl shadow-lg border z-10 hidden overflow-hidden"
          ></div>
        </div>

        ${'geolocation' in navigator ? `
          <div class="flex items-center gap-3 my-4">
            <div class="flex-1 h-px ${dark ? 'bg-slate-700' : 'bg-slate-200'}"></div>
            <span class="text-xs ${dark ? 'text-slate-500' : 'text-slate-400'} uppercase tracking-wide">or</span>
            <div class="flex-1 h-px ${dark ? 'bg-slate-700' : 'bg-slate-200'}"></div>
          </div>
          <button
            id="geolocate-btn"
            class="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl border ${dark ? 'border-slate-700 text-slate-300 bg-slate-800' : 'border-slate-200 text-slate-600 bg-white'} shadow-sm hover-btn"
          >
            📍 Use my location
          </button>
        ` : ''}

        <div class="flex justify-center mt-8">
          <button id="theme-btn" class="flex items-center gap-2 text-xs subtle-text">
            <span>${THEME_ICONS[theme]}</span>
            <span>${themeLabel()}</span>
          </button>
        </div>
      </div>
    </div>
  `;

  const input = document.getElementById('city-input') as HTMLInputElement;
  const box = document.getElementById('suggestions-box')!;

  input.addEventListener('input', () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    const q = input.value.trim();
    if (q.length < 2) { box.classList.add('hidden'); return; }

    debounceTimer = setTimeout(async () => {
      try {
        suggestions = await searchCity(q);
        if (!suggestions.length) { box.classList.add('hidden'); return; }

        box.innerHTML = suggestions.map((r, i) => `
          <button
            class="w-full text-left px-4 py-3 hover-item border-b ${dark ? 'border-slate-700' : 'border-slate-50'} last:border-0"
            data-i="${i}"
          >
            <span class="font-medium ${dark ? 'text-slate-200' : 'text-slate-700'}">${r.name}</span>
            <span class="${dark ? 'text-slate-500' : 'text-slate-400'} text-sm ml-1.5">${[r.admin1, r.country].filter(Boolean).join(', ')}</span>
          </button>
        `).join('');

        box.classList.remove('hidden');
        box.querySelectorAll<HTMLButtonElement>('button[data-i]').forEach(btn => {
          btn.addEventListener('click', () => void loadWeather(suggestions[Number(btn.dataset.i)]));
        });
      } catch {
        box.classList.add('hidden');
      }
    }, 300);
  });

  document.addEventListener('click', (e) => {
    const b = document.getElementById('suggestions-box');
    const inp = document.getElementById('city-input');
    if (b && !b.contains(e.target as Node) && e.target !== inp) b.classList.add('hidden');
  });

  document.getElementById('geolocate-btn')?.addEventListener('click', () => void handleGeolocate());
  attachThemeHandler();
}

function renderLoading(msg = 'Loading weather…'): void {
  _currentView = { type: 'loading' };
  const dark = isDark();
  root.innerHTML = `
    <div class="min-h-screen flex items-center justify-center">
      <div class="text-center ${dark ? 'text-slate-400' : 'text-slate-500'}">
        <div class="w-10 h-10 border-4 ${dark ? 'border-sky-900' : 'border-sky-200'} border-t-sky-500 rounded-full animate-spin mx-auto mb-4"></div>
        <p>${msg}</p>
      </div>
    </div>
  `;
}

function renderError(msg: string): void {
  const dark = isDark();
  root.innerHTML = `
    <div class="min-h-screen flex items-center justify-center p-4">
      <div class="text-center">
        <div class="text-4xl mb-4">⚠️</div>
        <p class="${dark ? 'text-slate-200' : 'text-slate-700'} mb-5">${msg}</p>
        <button id="back-btn" class="px-5 py-2.5 bg-sky-500 text-white rounded-xl hover:bg-sky-600 transition-colors">
          Try again
        </button>
      </div>
    </div>
  `;
  document.getElementById('back-btn')!.addEventListener('click', renderSearch);
}

function renderWeather(location: GeoResult, weather: WeatherData): void {
  _currentView = { type: 'weather', location, weather };
  setUrlParams(location);
  const { today, yesterday, todayHourly, yesterdayHourly } = weather;
  const dark = isDark();
  const locationLabel = [location.name, location.admin1, location.country].filter(Boolean).join(', ');

  root.innerHTML = `
    <div class="min-h-screen p-4 sm:p-8">
      <div class="max-w-lg mx-auto">
        <div class="mb-7">
          <div class="flex items-center justify-between gap-4 mb-2">
            <div class="text-sm ${dark ? 'text-slate-500' : 'text-slate-400'} min-w-0 truncate">📍 ${locationLabel}</div>
            <div class="flex gap-2 shrink-0">
              <button id="unit-btn" class="text-sm px-3 py-1.5 rounded-lg border ${dark ? 'border-slate-700 text-slate-400' : 'border-slate-200 text-slate-500'} hover-btn">
                °${unit === 'C' ? 'F' : 'C'}
              </button>
              <button id="search-btn" class="text-sm px-3 py-1.5 rounded-lg border ${dark ? 'border-slate-700 text-slate-400' : 'border-slate-200 text-slate-500'} hover-btn">
                Change location
              </button>
            </div>
          </div>
          <h1 class="text-xl font-semibold ${dark ? 'text-slate-100' : 'text-slate-800'}">Today vs Yesterday</h1>
        </div>

        <div class="rounded-2xl p-4 mb-4" style="background-color:${dark ? 'rgba(12,74,110,0.3)' : '#f0f9ff'}">
          <div class="text-xs font-semibold uppercase tracking-wider ${dark ? 'text-sky-400' : 'text-sky-500'} mb-2">Vs yesterday</div>
          <div class="flex flex-wrap gap-x-6 gap-y-1 text-sm ${dark ? 'text-slate-300' : 'text-slate-600'}">
            <span>🌡️ ${tempComparison(today, yesterday)}</span>
            <span>💧 ${precipComparison(today, yesterday)}</span>
            <span>💨 ${windComparison(today, yesterday)}</span>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3 mb-3">
          ${weatherCardHTML(today, "Today's forecast", dark)}
          ${weatherCardHTML(yesterday, 'Yesterday', dark)}
        </div>

        ${buildChart(todayHourly, yesterdayHourly, unit, dark)}

        <div class="flex items-center justify-between mt-2">
          <button id="theme-btn" class="flex items-center gap-1.5 text-xs subtle-text">
            <span>${THEME_ICONS[theme]}</span>
            <span>${themeLabel()}</span>
          </button>
          <div class="text-xs ${dark ? 'text-slate-600' : 'text-slate-400'}">
            Open-Meteo · best match
          </div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('unit-btn')!.addEventListener('click', () => {
    unit = unit === 'C' ? 'F' : 'C';
    renderWeather(location, weather);
  });
  document.getElementById('search-btn')!.addEventListener('click', renderSearch);
  attachThemeHandler();
}

// ─── Actions ──────────────────────────────────────────────────────────────────

async function loadWeather(location: GeoResult): Promise<void> {
  renderLoading(`Loading weather for ${location.name}…`);
  try {
    const weather = await fetchWeather(location.latitude, location.longitude);
    renderWeather(location, weather);
  } catch {
    renderError('Could not load weather data. Please try again.');
  }
}

async function handleGeolocate(): Promise<void> {
  renderLoading('Detecting your location…');
  try {
    const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 }),
    );
    const location: GeoResult = {
      name: 'Your location',
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      country: '',
    };
    const weather = await fetchWeather(location.latitude, location.longitude);
    renderWeather(location, weather);
  } catch (err) {
    renderError(
      err instanceof GeolocationPositionError
        ? 'Location access denied. Please search for a city instead.'
        : 'Could not load weather data. Please try again.',
    );
  }
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

applyTheme();

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (theme === 'auto') applyTheme();
});

const initialLocation = getLocationFromUrl();
if (initialLocation) {
  void loadWeather(initialLocation);
} else {
  renderSearch();
}
