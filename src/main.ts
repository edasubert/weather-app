import './style.css';
import { fetchWeather } from './weather';
import { searchCity } from './geocoding';
import { describeCode } from './wmo';
import { buildChart, setupChartTooltip } from './chart';
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
let highContrast = false;
let currentView: ViewState = null;
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

function attachHCHandler(): void {
  document.getElementById('hc-btn')?.addEventListener('click', () => {
    highContrast = !highContrast;
    applyTheme();
  });
}

function applyTheme(): void {
  document.documentElement.classList.toggle('dark', isDark());
  document.documentElement.classList.toggle('hc', highContrast);
  if (currentView?.type === 'search') {
    renderSearch();
  } else if (currentView?.type === 'weather') {
    renderWeather(currentView.location, currentView.weather);
  }
}

// ─── Temperature helpers ──────────────────────────────────────────────────────

function tempStr(c: number): string {
  if (unit === 'F') return `${Math.round(c * 9 / 5 + 32)}°F`;
  return `${Math.round(c)}°C`;
}

function diffStr(abs: number): string {
  if (unit === 'F') return `${Math.round(abs * 9 / 5)}°F`;
  return `${Math.round(abs)}°C`;
}

function tempSig(abs: number): string {
  return abs < 2 ? '' : abs < 5 ? ' 👀' : abs < 10 ? ' ⚠️' : ' 🤯';
}

function windSig(abs: number): string {
  return abs < 5 ? '' : abs < 10 ? ' 👀' : abs < 20 ? ' ⚠️' : ' 🤯';
}

// ─── Wind helpers ─────────────────────────────────────────────────────────────

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

function windDirLabel(degrees: number): string {
  return COMPASS[Math.round(degrees / 45) % 8];
}

// ─── Comparison summaries ─────────────────────────────────────────────────────

function tempComparison(today: DailyWeather, yesterday: DailyWeather): string {
  const diff = today.tempMean - yesterday.tempMean;
  const abs = Math.abs(diff);
  if (abs < 0.5) return 'About the same temperature';
  return `${diffStr(abs)} ${diff > 0 ? 'warmer' : 'cooler'}${tempSig(abs)}`;
}

function precipComparison(today: DailyWeather, yesterday: DailyWeather): string {
  const t = today.precipitationSum;
  const y = yesterday.precipitationSum;
  if (t < 0.1 && y < 0.1) return 'Still no rain';
  if (y >= 0.1 && t < 0.1) return 'No rain today';
  if (y < 0.1 && t >= 0.1) return 'Rain expected today';
  const diff = t - y;
  if (Math.abs(diff) < 0.5) return 'About the same amount of rain';
  return diff > 0 ? 'More rain expected' : 'Less rain expected';
}

function apparentTempComparison(today: DailyWeather, yesterday: DailyWeather): string {
  const diff = today.apparentTempMean - yesterday.apparentTempMean;
  const abs = Math.abs(diff);
  if (abs < 0.5) return 'Feels about the same';
  return `Feels ${diffStr(abs)} ${diff > 0 ? 'warmer' : 'cooler'}${tempSig(abs)}`;
}

function windComparison(today: DailyWeather, yesterday: DailyWeather): string {
  const diff = today.windSpeedMax - yesterday.windSpeedMax;
  const abs = Math.abs(diff);
  if (abs < 1) return 'About the same wind speed';
  return `${Math.round(abs)} km/h ${diff > 0 ? 'windier' : 'calmer'}${windSig(abs)}`;
}

// ─── Metric info (modal content) ─────────────────────────────────────────────

const LINK = 'class="text-sky-500 underline" target="_blank" rel="noopener noreferrer"';
const DOCS = `<a ${LINK} href="https://open-meteo.com/en/docs">Open-Meteo API docs ↗</a>`;

const METRIC_INFO: Record<string, { title: string; body: string }> = {
  temp: {
    title: 'Actual temperature',
    body: `
      <p><strong>Air temperature at 2 m above ground</strong> — the raw measured value, unaffected by wind or humidity.</p>
      <p>The comparison uses the daily mean temperature as reported by the model, not the simple (high + low) ÷ 2 average.</p>
      <p class="opacity-60 text-xs">Source: <code>temperature_2m_max/mean/min</code> — ${DOCS}</p>
    `,
  },
  apparentTemp: {
    title: 'Feels-like temperature',
    body: `
      <p><strong>Apparent temperature</strong> combines air temperature with wind chill and humidity to estimate how hot or cold conditions actually feel to the human body.</p>
      <p>It uses the <a ${LINK} href="https://en.wikipedia.org/wiki/Universal_thermal_climate_index">Universal Thermal Climate Index (UTCI)</a> model — on cold windy days it will be lower than the actual temperature; on hot humid days it will be higher.</p>
      <p class="opacity-60 text-xs">Source: <code>apparent_temperature_max/mean/min</code> — ${DOCS}</p>
    `,
  },
  precip: {
    title: 'Precipitation',
    body: `
      <p>Total precipitation accumulated over the day: <strong>rain, showers, and snowfall combined</strong>, expressed in millimetres of liquid water equivalent.</p>
      <p>Snowfall is converted to mm using a density factor. Trace amounts below 0.1 mm are shown as "no rain."</p>
      <p><a ${LINK} href="https://en.wikipedia.org/wiki/Precipitation">About precipitation ↗</a></p>
      <p class="opacity-60 text-xs">Source: <code>precipitation_sum</code> — ${DOCS}</p>
    `,
  },
  wind: {
    title: 'Wind speed',
    body: `
      <p><strong>Maximum sustained wind speed</strong> at 10 m above ground recorded during the day, paired with the day's dominant wind direction (the direction the wind blows <em>from</em>).</p>
      <p>Gusts — brief spikes above the sustained speed — are a separate variable and can be considerably higher.</p>
      <p><a ${LINK} href="https://en.wikipedia.org/wiki/Wind_speed">About wind speed ↗</a></p>
      <p class="opacity-60 text-xs">Source: <code>wind_speed_10m_max</code> / <code>wind_direction_10m_dominant</code> — ${DOCS}</p>
    `,
  },
};

// ─── Comparison row ───────────────────────────────────────────────────────────

function comparisonRowHTML(icon: string, id: string, summary: string, dark: boolean, hc: boolean): string {
  const rowText = hc
    ? (dark ? 'text-white'      : 'text-black')
    : (dark ? 'text-slate-300'  : 'text-slate-600');
  const btnClass = hc
    ? (dark ? 'border-white  text-white  hover:border-sky-300 hover:text-sky-300'
            : 'border-black  text-black  hover:border-sky-700 hover:text-sky-700')
    : (dark ? 'border-slate-500 text-slate-400 hover:border-sky-500 hover:text-sky-400'
            : 'border-slate-400 text-slate-500 hover:border-sky-400 hover:text-sky-500');
  return `
    <div class="flex items-center gap-2 text-sm ${rowText}">
      <span class="w-5 shrink-0">${icon}</span>
      <span class="flex-1">${summary}</span>
      <button class="info-btn w-4 h-4 rounded-full text-[10px] font-bold border shrink-0 flex items-center justify-center transition-colors ${btnClass}" data-metric="${id}">i</button>
    </div>
  `;
}

// ─── Card HTML ────────────────────────────────────────────────────────────────

function weatherCardHTML(data: DailyWeather, heading: string, dark: boolean, hc: boolean): string {
  const { emoji, label } = describeCode(data.weatherCode);
  const date = new Date(data.date + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });

  const cardBg  = hc ? (dark ? '#000000' : '#ffffff') : (dark ? '#1e293b' : '#ffffff');
  const border  = hc ? `border:2px solid ${dark ? '#ffffff' : '#000000'};` : '';
  const tA = hc ? (dark ? 'text-white'     : 'text-black')     : (dark ? 'text-slate-100' : 'text-slate-800');
  const tB = hc ? (dark ? 'text-white'     : 'text-black')     : (dark ? 'text-slate-200' : 'text-slate-700');
  const tC = hc ? (dark ? 'text-gray-100'  : 'text-gray-900')  : (dark ? 'text-slate-300' : 'text-slate-600');
  const tD = hc ? (dark ? 'text-gray-100'  : 'text-gray-900')  : (dark ? 'text-slate-400' : 'text-slate-500');
  const tE = hc ? (dark ? 'text-gray-200'  : 'text-gray-800')  : (dark ? 'text-slate-400' : 'text-slate-500');

  return `
    <div class="rounded-2xl p-5 flex flex-col gap-2" style="background-color:${cardBg};${border}">
      <div class="text-xs font-semibold uppercase tracking-wider ${tD}">${heading}</div>
      <div class="text-sm ${tD}">${date}</div>
      <div class="text-5xl my-2">${emoji}</div>
      <div class="font-medium ${tB}">${label}</div>
      <table class="mt-2 w-full text-sm [&_td]:align-bottom [&_th]:align-bottom [&_td:not(:first-child)]:pl-3 [&_th:not(:first-child)]:pl-3">
        <thead>
          <tr>
            <th></th>
            <th class="text-right font-normal pb-0.5" title="Temperature">🌡️</th>
            <th class="text-right font-normal pb-0.5" title="Apparent temperature">🧑</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="text-xs ${tE}">high</td>
            <td class="${tC} text-right">${tempStr(data.tempMax)}</td>
            <td class="${tC} text-right">${tempStr(data.apparentTempMax)}</td>
          </tr>
          <tr>
            <td class="text-base font-semibold ${tE}">avg</td>
            <td class="text-base font-semibold ${tA} text-right">${tempStr(data.tempMean)}</td>
            <td class="text-base font-semibold ${tB} text-right">${tempStr(data.apparentTempMean)}</td>
          </tr>
          <tr>
            <td class="text-xs ${tE}">low</td>
            <td class="${tC} text-right">${tempStr(data.tempMin)}</td>
            <td class="${tC} text-right">${tempStr(data.apparentTempMin)}</td>
          </tr>
        </tbody>
      </table>
      <div class="text-sm ${tD}">
        <span title="Precipitation">💧</span> ${data.precipitationSum > 0 ? `${data.precipitationSum.toFixed(1)} mm` : 'No rain'}
      </div>
      <div class="text-sm ${tD}">
        <span title="Wind">💨</span> ${Math.round(data.windSpeedMax)} km/h ${windDirLabel(data.windDirection)}
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

function readUrlSettings(): void {
  const p = new URLSearchParams(window.location.search);
  const u = p.get('unit');
  if (u === 'F') unit = 'F';
  const t = p.get('theme');
  if (t === 'dark' || t === 'light' || t === 'auto') theme = t;
  if (p.get('hc') === '1') highContrast = true;
}

function settingsParams(): URLSearchParams {
  const p = new URLSearchParams();
  p.set('unit', unit);
  if (theme !== 'auto') p.set('theme', theme);
  if (highContrast) p.set('hc', '1');
  return p;
}

function setUrlParams(location: GeoResult): void {
  const p = settingsParams();
  p.set('lat', location.latitude.toFixed(4));
  p.set('lon', location.longitude.toFixed(4));
  p.set('name', location.name);
  p.set('country', location.country);
  if (location.admin1) p.set('admin1', location.admin1);
  history.replaceState(null, '', '?' + p.toString());
}

function clearUrlParams(): void {
  const str = settingsParams().toString();
  history.replaceState(null, '', str ? '?' + str : window.location.pathname);
}

// ─── Views ────────────────────────────────────────────────────────────────────

function renderSearch(): void {
  currentView = { type: 'search' };
  clearUrlParams();
  const dark = isDark();
  const hc   = highContrast;

  const inputCls  = hc
    ? (dark ? 'border-white bg-black text-white placeholder-gray-400'
            : 'border-black bg-white text-black placeholder-gray-600')
    : (dark ? 'border-slate-700 bg-slate-800 text-slate-200 placeholder-slate-500'
            : 'border-slate-200 bg-white text-slate-700 placeholder-slate-400');
  const suggestCls = hc
    ? (dark ? 'bg-black border-white' : 'bg-white border-black')
    : (dark ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-100');
  const dividerBg  = hc ? (dark ? 'bg-white' : 'bg-black') : (dark ? 'bg-slate-700' : 'bg-slate-200');
  const geoBtnCls  = hc
    ? (dark ? 'border-white text-white bg-black' : 'border-black text-black bg-white')
    : (dark ? 'border-slate-700 text-slate-300 bg-slate-800' : 'border-slate-200 text-slate-600 bg-white');
  const hcBtnCls   = hc ? (dark ? 'text-white' : 'text-black') : 'subtle-text';
  const heading    = hc ? (dark ? 'text-white' : 'text-black') : (dark ? 'text-slate-100' : 'text-slate-800');
  const subtext    = hc ? (dark ? 'text-gray-100' : 'text-gray-900') : (dark ? 'text-slate-400' : 'text-slate-500');

  root.innerHTML = `
    <div class="min-h-screen flex items-center justify-center p-4">
      <div class="w-full max-w-sm">
        <div class="text-center mb-8">
          <div class="text-5xl mb-3">🌤️</div>
          <h1 class="text-2xl font-semibold ${heading}">Weather</h1>
          <p class="${subtext} mt-1 text-sm">Today's forecast vs yesterday's weather</p>
        </div>

        <div class="relative mb-3">
          <input
            id="city-input"
            type="text"
            placeholder="Search for a city…"
            autocomplete="off"
            class="w-full px-4 py-3 rounded-xl border ${inputCls} shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
          />
          <div
            id="suggestions-box"
            class="absolute top-full mt-1 w-full ${suggestCls} rounded-xl shadow-lg border z-10 hidden overflow-hidden"
          ></div>
        </div>

        ${'geolocation' in navigator ? `
          <div class="flex items-center gap-3 my-4">
            <div class="flex-1 h-px ${dividerBg}"></div>
            <span class="text-xs ${subtext} uppercase tracking-wide">or</span>
            <div class="flex-1 h-px ${dividerBg}"></div>
          </div>
          <button
            id="geolocate-btn"
            class="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl border ${geoBtnCls} shadow-sm hover-btn"
          >
            📍 Use my location
          </button>
        ` : ''}

        <div class="flex justify-center gap-6 mt-8">
          <button id="theme-btn" class="flex items-center gap-2 text-xs subtle-text">
            <span>${THEME_ICONS[theme]}</span>
            <span>${themeLabel()}</span>
          </button>
          <button id="hc-btn" class="flex items-center gap-2 text-xs ${hcBtnCls}" aria-pressed="${hc}" title="Toggle easy to read mode">
            <span>◑</span>
            <span>Easy to read${hc ? ' on' : ''}</span>
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

        const itemBorder = hc ? (dark ? 'border-white' : 'border-black')   : (dark ? 'border-slate-700' : 'border-slate-50');
        const itemMain   = hc ? (dark ? 'text-white'  : 'text-black')      : (dark ? 'text-slate-200'   : 'text-slate-700');
        const itemSub    = hc ? (dark ? 'text-gray-100' : 'text-gray-900') : (dark ? 'text-slate-400'   : 'text-slate-500');
        box.innerHTML = suggestions.map((r, i) => `
          <button
            class="w-full text-left px-4 py-3 hover-item border-b ${itemBorder} last:border-0"
            data-i="${i}"
          >
            <span class="font-medium ${itemMain}">${r.name}</span>
            <span class="${itemSub} text-sm ml-1.5">${[r.admin1, r.country].filter(Boolean).join(', ')}</span>
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
  attachHCHandler();
}

function renderLoading(msg = 'Loading weather…'): void {
  currentView = { type: 'loading' };
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
  currentView = { type: 'weather', location, weather };
  setUrlParams(location);
  const { today, yesterday, todayHourly, yesterdayHourly } = weather;
  const dark = isDark();
  const hc   = highContrast;
  const locationLabel = [location.name, location.admin1, location.country].filter(Boolean).join(', ');

  const btnCls = hc
    ? (dark ? 'border-white text-white' : 'border-black text-black')
    : (dark ? 'border-slate-700 text-slate-400' : 'border-slate-200 text-slate-500');
  const locText    = hc ? (dark ? 'text-white'    : 'text-black')    : (dark ? 'text-slate-400'  : 'text-slate-500');
  const cmpBg      = hc
    ? `${dark ? '#000000' : '#ffffff'};border:2px solid ${dark ? '#ffffff' : '#000000'}`
    : (dark ? 'rgba(12,74,110,0.3)' : '#f0f9ff');
  const cmpHeading = hc ? (dark ? 'text-white' : 'text-black') : (dark ? 'text-slate-100' : 'text-slate-800');
  const modalBg       = hc ? (dark ? '#000000' : '#ffffff') : (dark ? '#1e293b' : '#fff');
  const modalCloseCls = hc
    ? (dark ? 'text-white hover:text-gray-300' : 'text-black hover:text-gray-700')
    : (dark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-500 hover:text-slate-700');
  const modalTitleCls = hc ? (dark ? 'text-white' : 'text-black') : (dark ? 'text-slate-100' : 'text-slate-800');
  const modalBodyCls  = hc ? (dark ? 'text-gray-100' : 'text-gray-900') : (dark ? 'text-slate-300' : 'text-slate-600');
  const footerText = hc ? (dark ? 'text-gray-100' : 'text-gray-900') : (dark ? 'text-slate-400' : 'text-slate-500');

  root.innerHTML = `
    <div class="min-h-screen p-4 sm:p-8">
      <div class="max-w-lg mx-auto">
        <div class="flex items-center justify-between gap-4 mb-4">
          <div class="text-sm ${locText} min-w-0 truncate">📍 ${locationLabel}</div>
          <div class="flex gap-2 shrink-0">
            <button id="unit-btn" class="text-sm px-3 py-1.5 rounded-lg border ${btnCls} hover-btn">
              °${unit === 'C' ? 'F' : 'C'}
            </button>
            <button id="search-btn" class="text-sm px-3 py-1.5 rounded-lg border ${btnCls} hover-btn">
              Change location
            </button>
          </div>
        </div>

        <div class="rounded-2xl p-4 mb-4" style="background-color:${cmpBg}">
          <h1 class="text-xl font-semibold ${cmpHeading} mb-3">Today vs Yesterday</h1>
          <div class="flex flex-col gap-2">
            ${comparisonRowHTML('🌡️', 'temp', tempComparison(today, yesterday), dark, hc)}
            ${comparisonRowHTML('<span title="Apparent temperature">🧑</span>', 'apparentTemp', apparentTempComparison(today, yesterday), dark, hc)}
            ${comparisonRowHTML('<span title="Precipitation">💧</span>', 'precip', precipComparison(today, yesterday), dark, hc)}
            ${comparisonRowHTML('<span title="Wind">💨</span>', 'wind', windComparison(today, yesterday), dark, hc)}
          </div>
        </div>

        <div class="${hc ? 'grid grid-cols-1' : 'grid grid-cols-2'} gap-3 mb-3">
          ${weatherCardHTML(yesterday, 'Yesterday', dark, hc)}
          ${weatherCardHTML(today, 'Today', dark, hc)}
        </div>

        ${buildChart(todayHourly, yesterdayHourly, unit, dark, hc)}

        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mt-2">
          <div class="text-sm ${footerText}">
            Data source: <a ${LINK} href="https://open-meteo.com/">Open-Meteo ↗</a>
          </div>
          <div class="flex items-center gap-4">
            <button id="theme-btn" class="flex items-center gap-1.5 text-xs subtle-text">
              <span>${THEME_ICONS[theme]}</span>
              <span>${themeLabel()}</span>
            </button>
            <button id="hc-btn" class="flex items-center gap-1.5 text-xs ${hc ? (dark ? 'text-white' : 'text-black') : 'subtle-text'}" aria-pressed="${hc}">
              <span>◑</span>
              <span>Easy to read${hc ? ' on' : ''}</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <div id="info-modal" class="fixed inset-0 z-50 flex items-center justify-center p-4 hidden" role="dialog" aria-modal="true">
      <div id="modal-backdrop" class="absolute inset-0" style="background-color:rgba(0,0,0,0.5)"></div>
      <div class="relative w-full max-w-sm rounded-2xl p-6 shadow-2xl" style="background-color:${modalBg}${hc ? `;border:2px solid ${dark ? '#fff' : '#000'}` : ''}">
        <button id="modal-close" class="absolute top-4 right-4 text-2xl leading-none ${modalCloseCls} transition-colors">&times;</button>
        <h2 id="modal-title" class="text-base font-semibold ${modalTitleCls} mb-3 pr-6"></h2>
        <div id="modal-body" class="text-sm ${modalBodyCls} flex flex-col gap-2"></div>
      </div>
    </div>
  `;

  const chartContainer = root.querySelector<HTMLElement>('#chart-container');
  if (chartContainer) setupChartTooltip(chartContainer, todayHourly, yesterdayHourly, unit, dark, hc);

  document.getElementById('unit-btn')!.addEventListener('click', () => {
    unit = unit === 'C' ? 'F' : 'C';
    renderWeather(location, weather);
  });
  document.getElementById('search-btn')!.addEventListener('click', renderSearch);
  attachThemeHandler();
  attachHCHandler();

  const modal = document.getElementById('info-modal')!;
  const modalTitle = document.getElementById('modal-title')!;
  const modalBody = document.getElementById('modal-body')!;
  const closeModal = () => modal.classList.add('hidden');

  document.getElementById('modal-close')!.addEventListener('click', closeModal);
  document.getElementById('modal-backdrop')!.addEventListener('click', closeModal);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  document.querySelectorAll<HTMLButtonElement>('.info-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const info = METRIC_INFO[btn.dataset.metric!];
      if (!info) return;
      modalTitle.textContent = info.title;
      modalBody.innerHTML = info.body;
      modal.classList.remove('hidden');
    });
  });
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

readUrlSettings();
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
