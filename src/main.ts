import './style.css';
import { fetchWeather } from './weather';
import { searchCity } from './geocoding';
import { describeCode } from './wmo';
import type { DailyWeather, GeoResult } from './types';

const root = document.getElementById('app')!;
let unit: 'C' | 'F' = 'C';
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let suggestions: GeoResult[] = [];

// ─── Temperature helpers ────────────────────────────────────────────────────

function tempStr(c: number): string {
  if (unit === 'F') return `${Math.round(c * 9 / 5 + 32)}°F`;
  return `${Math.round(c)}°C`;
}

function diffStr(diffC: number): string {
  if (unit === 'F') return `${Math.abs(Math.round(diffC * 9 / 5))}°F`;
  return `${Math.abs(Math.round(diffC))}°C`;
}

// ─── Comparison summaries ───────────────────────────────────────────────────

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

// ─── Card HTML ───────────────────────────────────────────────────────────────

function weatherCardHTML(data: DailyWeather, heading: string): string {
  const { emoji, label } = describeCode(data.weatherCode);
  const date = new Date(data.date + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
  return `
    <div class="bg-white rounded-2xl shadow-sm p-5 flex flex-col gap-2">
      <div class="text-xs font-semibold uppercase tracking-wider text-slate-400">${heading}</div>
      <div class="text-xs text-slate-400">${date}</div>
      <div class="text-5xl my-2">${emoji}</div>
      <div class="font-medium text-slate-700">${label}</div>
      <div class="text-2xl font-semibold text-slate-800">
        ${tempStr(data.tempMax)}
        <span class="text-base font-normal text-slate-400">/ ${tempStr(data.tempMin)}</span>
      </div>
      <div class="text-sm text-slate-400">
        ${data.precipitationSum > 0 ? `${data.precipitationSum.toFixed(1)} mm rain` : 'No rain'}
      </div>
    </div>
  `;
}

// ─── URL state ──────────────────────────────────────────────────────────────

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

// ─── Views ───────────────────────────────────────────────────────────────────

function renderSearch(): void {
  clearUrlParams();
  root.innerHTML = `
    <div class="min-h-screen flex items-center justify-center p-4">
      <div class="w-full max-w-sm">
        <div class="text-center mb-8">
          <div class="text-5xl mb-3">🌤️</div>
          <h1 class="text-2xl font-semibold text-slate-800">Weather</h1>
          <p class="text-slate-500 mt-1 text-sm">Today's forecast vs yesterday's weather</p>
        </div>

        <div class="relative mb-3">
          <input
            id="city-input"
            type="text"
            placeholder="Search for a city…"
            autocomplete="off"
            class="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white shadow-sm
                   text-slate-700 placeholder-slate-400
                   focus:outline-none focus:ring-2 focus:ring-sky-300"
          />
          <div
            id="suggestions-box"
            class="absolute top-full mt-1 w-full bg-white rounded-xl shadow-lg border border-slate-100 z-10 hidden overflow-hidden"
          ></div>
        </div>

        ${'geolocation' in navigator ? `
          <div class="flex items-center gap-3 my-4">
            <div class="flex-1 h-px bg-slate-200"></div>
            <span class="text-xs text-slate-400 uppercase tracking-wide">or</span>
            <div class="flex-1 h-px bg-slate-200"></div>
          </div>
          <button
            id="geolocate-btn"
            class="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl
                   border border-slate-200 text-slate-600 bg-white shadow-sm
                   hover:bg-slate-50 transition-colors"
          >
            📍 Use my location
          </button>
        ` : ''}
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
            class="w-full text-left px-4 py-3 hover:bg-sky-50 transition-colors border-b border-slate-50 last:border-0"
            data-i="${i}"
          >
            <span class="font-medium text-slate-700">${r.name}</span>
            <span class="text-slate-400 text-sm ml-1.5">${[r.admin1, r.country].filter(Boolean).join(', ')}</span>
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
}

function renderLoading(msg = 'Loading weather…'): void {
  root.innerHTML = `
    <div class="min-h-screen flex items-center justify-center">
      <div class="text-center text-slate-500">
        <div class="w-10 h-10 border-4 border-sky-200 border-t-sky-500 rounded-full animate-spin mx-auto mb-4"></div>
        <p>${msg}</p>
      </div>
    </div>
  `;
}

function renderError(msg: string): void {
  root.innerHTML = `
    <div class="min-h-screen flex items-center justify-center p-4">
      <div class="text-center">
        <div class="text-4xl mb-4">⚠️</div>
        <p class="text-slate-700 mb-5">${msg}</p>
        <button id="back-btn" class="px-5 py-2.5 bg-sky-500 text-white rounded-xl hover:bg-sky-600 transition-colors">
          Try again
        </button>
      </div>
    </div>
  `;
  document.getElementById('back-btn')!.addEventListener('click', renderSearch);
}

function renderWeather(location: GeoResult, weather: { today: DailyWeather; yesterday: DailyWeather }): void {
  setUrlParams(location);
  const { today, yesterday } = weather;
  const locationLabel = [location.name, location.admin1, location.country].filter(Boolean).join(', ');

  root.innerHTML = `
    <div class="min-h-screen p-4 sm:p-8">
      <div class="max-w-lg mx-auto">
        <div class="flex items-start justify-between mb-7 gap-4">
          <div>
            <div class="text-sm text-slate-400 mb-0.5">📍 ${locationLabel}</div>
            <h1 class="text-xl font-semibold text-slate-800">Today vs Yesterday</h1>
          </div>
          <div class="flex gap-2 shrink-0">
            <button id="unit-btn" class="text-sm px-3 py-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors">
              °${unit === 'C' ? 'F' : 'C'}
            </button>
            <button id="search-btn" class="text-sm px-3 py-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors">
              Change
            </button>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3 mb-4">
          ${weatherCardHTML(today, "Today's forecast")}
          ${weatherCardHTML(yesterday, 'Yesterday')}
        </div>

        <div class="bg-sky-50 rounded-2xl p-4">
          <div class="text-xs font-semibold uppercase tracking-wider text-sky-500 mb-2">Vs yesterday</div>
          <div class="flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-600">
            <span>🌡️ ${tempComparison(today, yesterday)}</span>
            <span>💧 ${precipComparison(today, yesterday)}</span>
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
}

// ─── Actions ─────────────────────────────────────────────────────────────────

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

// ─── Bootstrap ───────────────────────────────────────────────────────────────

const initialLocation = getLocationFromUrl();
if (initialLocation) {
  void loadWeather(initialLocation);
} else {
  renderSearch();
}
