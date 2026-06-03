import './style.css';
import { fetchWeather, WeatherNoDataError } from './weather';
import { WEATHER_MODELS, MODEL_MAP, findModel, DEFAULT_MODEL } from './models';
import { searchCity } from './geocoding';
import { describeCode } from './wmo';
import { buildChart, setupChartTooltip } from './chart';
import { t, setLang, getLang, LANGS, type Lang } from './i18n';
import type { DailyWeather, GeoResult, HourlyData } from './types';

const root = document.getElementById('app')!;
let unit: 'C' | 'F' = 'C';
let model = DEFAULT_MODEL;

const LANG_NAMES: Record<Lang, string> = {
  en: 'English', cs: 'Čeština', de: 'Deutsch',
  es: 'Español', fr: 'Français', ja: '日本語',
  pt: 'Português', uk: 'Українська',
};

const LOCALE_MAP: Record<Lang, string> = {
  en: 'en-US', cs: 'cs-CZ', de: 'de-DE',
  es: 'es-ES', fr: 'fr-FR', ja: 'ja-JP',
  pt: 'pt-BR', uk: 'uk-UA',
};

function langMenuHTML(menuBg: string, menuBorderColor: string, menuItemTextCls: string, openUp = false): string {
  const pos = openUp ? 'bottom-full mb-1' : 'top-full mt-1';
  const items = LANGS.map((lang, i) => {
    const border = i > 0 ? ` style="border-top:1px solid ${menuBorderColor}"` : '';
    const active = getLang() === lang ? ' font-semibold' : '';
    return `<button class="w-full text-left px-3 py-2 text-sm hover-item ${menuItemTextCls}${active}" data-lang="${lang}"${border}>${LANG_NAMES[lang]}</button>`;
  }).join('');
  return `<div id="lang-menu" class="absolute right-0 ${pos} rounded-xl shadow-lg z-20 hidden overflow-hidden" style="background-color:${menuBg};border:1px solid ${menuBorderColor};min-width:130px">${items}</div>`;
}
function modelMenuHTML(menuBg: string, menuBorderColor: string, menuItemTextCls: string, openUp = false): string {
  const pos = openUp ? 'bottom-full mb-1' : 'top-full mt-1';
  const groups = ['auto', 'seamless', 'global', 'regional'] as const;
  const groupLabels: Record<string, string> = {
    auto:     t('model.groupAuto'),
    seamless: t('model.groupSeamless'),
    global:   t('model.groupGlobal'),
    regional: t('model.groupRegional'),
  };
  let html = '';
  let first = true;
  for (const group of groups) {
    const groupModels = WEATHER_MODELS.filter(m => m.group === group);
    if (!groupModels.length) continue;
    const groupBorder = first ? '' : `border-top:1px solid ${menuBorderColor};`;
    html += `<div class="px-3 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wider ${menuItemTextCls}" style="${groupBorder}opacity:0.5">${groupLabels[group]}</div>`;
    for (const m of groupModels) {
      const active = model === m.id ? ' font-semibold' : '';
      html += `<button class="w-full text-left px-3 py-2 text-sm hover-item ${menuItemTextCls}${active}" data-model="${m.id}" style="border-top:1px solid ${menuBorderColor}"><div>${m.name}</div><div class="text-xs" style="opacity:0.5">${m.provider} · ${m.coverage}</div></button>`;
    }
    first = false;
  }
  return `<div id="model-menu" class="absolute right-0 ${pos} rounded-xl shadow-lg z-20 hidden overflow-y-auto" style="background-color:${menuBg};border:1px solid ${menuBorderColor};min-width:300px;max-height:360px">${html}</div>`;
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let suggestions: GeoResult[] = [];

// ─── Theme ────────────────────────────────────────────────────────────────────

type Theme = 'auto' | 'dark' | 'light';
type Comparison = 'yesterday-today' | 'today-tomorrow';
type WeatherData = { today: DailyWeather; yesterday: DailyWeather; tomorrow: DailyWeather; todayHourly: HourlyData; yesterdayHourly: HourlyData; tomorrowHourly: HourlyData };
type ViewState =
  | { type: 'search' }
  | { type: 'loading' }
  | { type: 'weather'; location: GeoResult; weather: WeatherData }
  | null;

let theme: Theme = 'auto';
let highContrast = false;
let comparison: Comparison = 'yesterday-today';
let currentView: ViewState = null;
const THEME_ICONS: Record<Theme, string> = { auto: '🌗', dark: '🌙', light: '☀️' };
const THEME_CYCLE: Record<Theme, Theme> = { auto: 'dark', dark: 'light', light: 'auto' };

function isDark(): boolean {
  return theme === 'dark' || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
}

function themeLabel(): string {
  return theme === 'auto' ? t('theme.auto') : theme === 'dark' ? t('theme.dark') : t('theme.light');
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

function attachDropdownHandlers(): void {
  const langBtn  = document.getElementById('lang-btn');
  const langMenu = document.getElementById('lang-menu');
  if (langBtn && langMenu) {
    langBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const wasHidden = langMenu.classList.contains('hidden');
      langMenu.classList.toggle('hidden');
      if (wasHidden) {
        setTimeout(() => document.addEventListener('click', () => langMenu.classList.add('hidden'), { once: true }), 0);
      }
    });
    langMenu.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        setLang(btn.dataset.lang as Lang);
        if (currentView?.type === 'search') renderSearch();
        else if (currentView?.type === 'weather') renderWeather(currentView.location, currentView.weather);
      });
    });
  }

  const modelBtn  = document.getElementById('model-btn');
  const modelMenu = document.getElementById('model-menu');
  if (modelBtn && modelMenu) {
    modelBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const wasHidden = modelMenu.classList.contains('hidden');
      modelMenu.classList.toggle('hidden');
      if (wasHidden) {
        setTimeout(() => document.addEventListener('click', () => modelMenu.classList.add('hidden'), { once: true }), 0);
      }
    });
    modelMenu.querySelectorAll<HTMLButtonElement>('[data-model]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        model = btn.dataset.model as string;
        if (currentView?.type === 'search') renderSearch();
        else if (currentView?.type === 'weather') void loadWeather(currentView.location);
      });
    });
  }

  const unitBtn  = document.getElementById('unit-btn');
  const unitMenu = document.getElementById('unit-menu');
  if (unitBtn && unitMenu) {
    unitBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const wasHidden = unitMenu.classList.contains('hidden');
      unitMenu.classList.toggle('hidden');
      if (wasHidden) {
        setTimeout(() => document.addEventListener('click', () => unitMenu.classList.add('hidden'), { once: true }), 0);
      }
    });
    unitMenu.querySelectorAll<HTMLButtonElement>('[data-unit]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        unit = btn.dataset.unit as 'C' | 'F';
        if (currentView?.type === 'weather') renderWeather(currentView.location, currentView.weather);
      });
    });
  }
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
  if (abs < 0.5) return t('comp.sameTemp');
  return t(diff > 0 ? 'comp.warmer' : 'comp.cooler', { diff: diffStr(abs) }) + tempSig(abs);
}

function precipComparison(today: DailyWeather, yesterday: DailyWeather, isTomorrowMode = false): string {
  const todayMm = today.precipitationSum;
  const yestMm  = yesterday.precipitationSum;
  const ctx = isTomorrowMode ? 'tomorrow' : 'today';
  if (todayMm < 0.1 && yestMm < 0.1) return t('comp.noRain');
  if (yestMm >= 0.1 && todayMm < 0.1) return t(`comp.noRain_${ctx}` as string);
  if (yestMm < 0.1 && todayMm >= 0.1) return t(`comp.rainExpected_${ctx}` as string);
  const diff = todayMm - yestMm;
  if (Math.abs(diff) < 0.5) return t('comp.sameRain');
  return t(diff > 0 ? 'comp.moreRain' : 'comp.lessRain');
}

function apparentTempComparison(today: DailyWeather, yesterday: DailyWeather): string {
  const diff = today.apparentTempMean - yesterday.apparentTempMean;
  const abs = Math.abs(diff);
  if (abs < 0.5) return t('comp.feelsSame');
  return t(diff > 0 ? 'comp.feelsWarmer' : 'comp.feelsCooler', { diff: diffStr(abs) }) + tempSig(abs);
}

function windComparison(today: DailyWeather, yesterday: DailyWeather): string {
  const diff = today.windSpeedMax - yesterday.windSpeedMax;
  const abs = Math.abs(diff);
  if (abs < 1) return t('comp.sameWind');
  return t(diff > 0 ? 'comp.windier' : 'comp.calmer', { diff: Math.round(abs) }) + windSig(abs);
}

function pressureComparison(today: DailyWeather, yesterday: DailyWeather): string {
  const diff = today.pressureMean - yesterday.pressureMean;
  const abs = Math.abs(diff);
  if (abs < 1) return t('comp.samePressure');
  return t(diff > 0 ? 'comp.higherPressure' : 'comp.lowerPressure', { diff: Math.round(abs) });
}

// ─── Metric info (modal content) ─────────────────────────────────────────────

const DOCS_HTML = `<a class="text-sky-500 underline" target="_blank" rel="noopener noreferrer" href="https://open-meteo.com/en/docs">Open-Meteo API docs ↗</a>`;
const LINK = 'class="text-sky-500 underline" target="_blank" rel="noopener noreferrer"';

function getMetricInfo(id: string): { title: string; body: string } {
  return {
    title: t(`metric.${id}.title` as string),
    body:  t(`metric.${id}.body`  as string, { docs: DOCS_HTML }),
  };
}

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
  const locale = LOCALE_MAP[getLang()] ?? 'en-US';
  const date = new Date(data.date + 'T12:00:00').toLocaleDateString(locale, {
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
            <th class="text-right font-normal pb-0.5" title="${t('tooltip.temperature')}">🌡️</th>
            <th class="text-right font-normal pb-0.5" title="${t('tooltip.apparentTemp')}">🧑</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="text-xs ${tE}">${t('card.high')}</td>
            <td class="${tC} text-right">${tempStr(data.tempMax)}</td>
            <td class="${tC} text-right">${tempStr(data.apparentTempMax)}</td>
          </tr>
          <tr>
            <td class="text-xs font-medium ${tE}">${t('card.avg')}</td>
            <td class="text-base font-semibold ${tA} text-right">${tempStr(data.tempMean)}</td>
            <td class="text-base font-semibold ${tB} text-right">${tempStr(data.apparentTempMean)}</td>
          </tr>
          <tr>
            <td class="text-xs ${tE}">${t('card.low')}</td>
            <td class="${tC} text-right">${tempStr(data.tempMin)}</td>
            <td class="${tC} text-right">${tempStr(data.apparentTempMin)}</td>
          </tr>
        </tbody>
      </table>
      <div class="text-sm ${tD}">
        <span title="${t('tooltip.precipitation')}">💧</span> ${data.precipitationSum > 0 ? `${data.precipitationSum.toFixed(1)} mm` : t('card.noRain')}
      </div>
      <div class="text-sm ${tD}">
        <span title="${t('tooltip.wind')}">💨</span> ${Math.round(data.windSpeedMax)} km/h ${windDirLabel(data.windDirection)}
      </div>
      <div class="text-sm ${tD}">
        <span title="${t('tooltip.pressure')}">🔵</span> ${Math.round(data.pressureMean)} hPa
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
  const th = p.get('theme');
  if (th === 'dark' || th === 'light' || th === 'auto') theme = th;
  if (p.get('hc') === '1') highContrast = true;
  if (p.get('comp') === 'tomorrow') comparison = 'today-tomorrow';
  const lg = p.get('lang');
  if (lg && (LANGS as string[]).includes(lg)) setLang(lg as Lang);
  const m = p.get('model');
  if (m && MODEL_MAP.has(m)) model = m;
}

function settingsParams(): URLSearchParams {
  const p = new URLSearchParams();
  p.set('unit', unit);
  if (theme !== 'auto') p.set('theme', theme);
  if (highContrast) p.set('hc', '1');
  if (comparison === 'today-tomorrow') p.set('comp', 'tomorrow');
  if (getLang() !== 'en') p.set('lang', getLang());
  if (model !== DEFAULT_MODEL) p.set('model', model);
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
  const menuBg            = hc ? (dark ? '#000000' : '#ffffff') : (dark ? '#1e293b' : '#ffffff');
  const menuBorderColor   = hc ? (dark ? '#ffffff' : '#000000') : (dark ? '#334155' : '#e2e8f0');
  const menuItemTextCls   = hc ? (dark ? 'text-white' : 'text-black') : (dark ? 'text-slate-200' : 'text-slate-700');
  const subtext    = hc ? (dark ? 'text-gray-100' : 'text-gray-900') : (dark ? 'text-slate-400' : 'text-slate-500');

  root.innerHTML = `
    <div class="min-h-screen flex items-center justify-center p-4">
      <div class="w-full max-w-sm">
        <div class="text-center mb-8">
          <div class="text-5xl mb-3">🌤️</div>
          <h1 class="text-2xl font-semibold ${heading}">${t('search.title')}</h1>
          <p class="${subtext} mt-1 text-sm">${t('search.subtitle')}</p>
        </div>

        <div class="relative mb-3">
          <input
            id="city-input"
            type="text"
            placeholder="${t('search.placeholder')}"
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
            <span class="text-xs ${subtext} uppercase tracking-wide">${t('search.or')}</span>
            <div class="flex-1 h-px ${dividerBg}"></div>
          </div>
          <button
            id="geolocate-btn"
            class="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl border ${geoBtnCls} shadow-sm hover-btn"
          >
            📍 ${t('search.useLocation')}
          </button>
        ` : ''}

        <div class="flex justify-center gap-6 mt-8">
          <button id="theme-btn" class="flex items-center gap-2 text-xs subtle-text">
            <span>${THEME_ICONS[theme]}</span>
            <span>${themeLabel()}</span>
          </button>
          <button id="hc-btn" class="flex items-center gap-2 text-xs ${hcBtnCls}" aria-pressed="${hc}" title="Toggle easy to read mode">
            <span>◑</span>
            <span>${hc ? t('theme.easyReadOn') : t('theme.easyRead')}</span>
          </button>
          <div class="relative">
            <button id="lang-btn" class="flex items-center gap-1 text-xs subtle-text">
              <span>${getLang().toUpperCase()}</span>
              <span class="opacity-50">▾</span>
            </button>
            ${langMenuHTML(menuBg, menuBorderColor, menuItemTextCls, true)}
          </div>
          <div class="relative">
            <button id="model-btn" class="flex items-center gap-1 text-xs subtle-text">
              <span>${findModel(model).shortLabel}</span>
              <span class="opacity-50">▾</span>
            </button>
            ${modelMenuHTML(menuBg, menuBorderColor, menuItemTextCls, true)}
          </div>
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
  attachDropdownHandlers();
}

function renderLoading(msg = t('error.loading')): void {
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
          ${t('error.tryAgain')}
        </button>
      </div>
    </div>
  `;
  document.getElementById('back-btn')!.addEventListener('click', renderSearch);
}

function renderWeather(location: GeoResult, weather: WeatherData): void {
  currentView = { type: 'weather', location, weather };
  setUrlParams(location);
  const { today, yesterday, tomorrow, todayHourly, yesterdayHourly, tomorrowHourly } = weather;
  const dark = isDark();
  const hc   = highContrast;
  const isTomorrow = comparison === 'today-tomorrow';
  const primary         = isTomorrow ? tomorrow   : today;
  const secondary       = isTomorrow ? today      : yesterday;
  const primaryHourly   = isTomorrow ? tomorrowHourly   : todayHourly;
  const secondaryHourly = isTomorrow ? todayHourly      : yesterdayHourly;
  const primaryLabel    = isTomorrow ? t('card.tomorrow') : t('card.today');
  const secondaryLabel  = isTomorrow ? t('card.today')    : t('card.yesterday');
  const primaryLabelShort   = isTomorrow ? t('chart.tomorrowShort') : t('chart.todayShort');
  const secondaryLabelShort = isTomorrow ? t('chart.todayShort')    : t('chart.yesterdayShort');
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
  const menuBg          = hc ? (dark ? '#000000' : '#ffffff') : (dark ? '#1e293b' : '#ffffff');
  const menuBorderColor = hc ? (dark ? '#ffffff' : '#000000') : (dark ? '#334155' : '#e2e8f0');
  const menuItemTextCls = hc ? (dark ? 'text-white' : 'text-black') : (dark ? 'text-slate-200' : 'text-slate-700');
  const compHeader = isTomorrow ? t('comp.headerTodayTomorrow') : t('comp.headerYesterdayToday');
  const groupBorder = hc ? (dark ? 'border-white' : 'border-black') : (dark ? 'border-slate-700' : 'border-slate-200');
  const dividerCls  = `border-r ${groupBorder}`;

  root.innerHTML = `
    <div class="min-h-screen p-4 sm:p-8">
      <div class="max-w-lg mx-auto">
        <div class="flex items-center justify-between gap-4 mb-4">
          <div class="text-sm ${locText} min-w-0 truncate">📍 ${locationLabel}</div>
          <div class="flex gap-2 shrink-0">
            <div class="relative">
              <button id="model-btn" class="text-sm px-3 py-1.5 rounded-lg border ${btnCls} hover-btn flex items-center gap-1">
                ${findModel(model).shortLabel} <span class="text-xs opacity-50">▾</span>
              </button>
              ${modelMenuHTML(menuBg, menuBorderColor, menuItemTextCls)}
            </div>
            <div class="relative">
              <button id="lang-btn" class="text-sm px-3 py-1.5 rounded-lg border ${btnCls} hover-btn flex items-center gap-1">
                ${getLang().toUpperCase()} <span class="text-xs opacity-50">▾</span>
              </button>
              ${langMenuHTML(menuBg, menuBorderColor, menuItemTextCls)}
            </div>
            <div class="relative">
              <button id="unit-btn" class="text-sm px-3 py-1.5 rounded-lg border ${btnCls} hover-btn flex items-center gap-1">
                °${unit} <span class="text-xs opacity-50">▾</span>
              </button>
              <div id="unit-menu" class="absolute right-0 top-full mt-1 rounded-xl shadow-lg z-20 hidden overflow-hidden" style="background-color:${menuBg};border:1px solid ${menuBorderColor};min-width:72px">
                <button class="w-full text-left px-3 py-2 text-sm hover-item ${menuItemTextCls}${unit === 'C' ? ' font-semibold' : ''}" data-unit="C">°C</button>
                <button class="w-full text-left px-3 py-2 text-sm hover-item ${menuItemTextCls}${unit === 'F' ? ' font-semibold' : ''}" data-unit="F" style="border-top:1px solid ${menuBorderColor}">°F</button>
              </div>
            </div>
            <button id="search-btn" class="text-sm px-3 py-1.5 rounded-lg border ${btnCls} hover-btn">
              ${t('weather.changeLocation')}
            </button>
          </div>
        </div>

        <div class="flex mb-3 rounded-lg overflow-hidden border ${groupBorder}">
          ${(['yesterday-today', 'today-tomorrow'] as Comparison[]).map((mode, i) => {
            const active = comparison === mode;
            const label  = mode === 'yesterday-today' ? t('comp.headerYesterdayToday') : t('comp.headerTodayTomorrow');
            const activeCls   = hc ? (dark ? 'bg-white text-black' : 'bg-black text-white') : 'bg-sky-500 text-white';
            const inactiveCls = hc ? (dark ? 'text-white' : 'text-black') : (dark ? 'text-slate-400' : 'text-slate-500');
            const divider = i === 0 ? dividerCls : '';
            return `<button class="flex-1 text-sm py-2 text-center transition-colors ${divider} ${active ? activeCls : inactiveCls + ' hover-btn'}" data-comp="${mode}">${label}</button>`;
          }).join('')}
        </div>

        <div class="rounded-2xl p-4 mb-4" style="background-color:${cmpBg}">
          <h1 class="text-xl font-semibold ${cmpHeading} mb-3">${compHeader}</h1>
          <div class="flex flex-col gap-2">
            ${comparisonRowHTML('🌡️', 'temp', tempComparison(primary, secondary), dark, hc)}
            ${comparisonRowHTML(`<span title="${t('tooltip.apparentTemp')}">🧑</span>`, 'apparentTemp', apparentTempComparison(primary, secondary), dark, hc)}
            ${comparisonRowHTML(`<span title="${t('tooltip.precipitation')}">💧</span>`, 'precip', precipComparison(primary, secondary, isTomorrow), dark, hc)}
            ${comparisonRowHTML(`<span title="${t('tooltip.wind')}">💨</span>`, 'wind', windComparison(primary, secondary), dark, hc)}
            ${comparisonRowHTML(`<span title="${t('tooltip.pressure')}">🔵</span>`, 'pressure', pressureComparison(primary, secondary), dark, hc)}
          </div>
        </div>

        <div class="${hc ? 'grid grid-cols-1' : 'grid grid-cols-2'} gap-3 mb-3">
          ${weatherCardHTML(secondary, secondaryLabel, dark, hc)}
          ${weatherCardHTML(primary, primaryLabel, dark, hc)}
        </div>

        ${buildChart(primaryHourly, secondaryHourly, unit, dark, hc, t('chart.' + (isTomorrow ? 'tomorrow' : 'today') as string), t('chart.' + (isTomorrow ? 'today' : 'yesterday') as string))}

        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mt-2">
          <div class="text-sm ${footerText}">
            ${t('weather.dataSource')} <a ${LINK} href="https://open-meteo.com/">Open-Meteo ↗</a>
          </div>
          <div class="flex items-center gap-4">
            <button id="theme-btn" class="flex items-center gap-1.5 text-xs subtle-text">
              <span>${THEME_ICONS[theme]}</span>
              <span>${themeLabel()}</span>
            </button>
            <button id="hc-btn" class="flex items-center gap-1.5 text-xs ${hc ? (dark ? 'text-white' : 'text-black') : 'subtle-text'}" aria-pressed="${hc}">
              <span>◑</span>
              <span>${hc ? t('theme.easyReadOn') : t('theme.easyRead')}</span>
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
  if (chartContainer) setupChartTooltip(chartContainer, primaryHourly, secondaryHourly, unit, dark, hc, primaryLabelShort, secondaryLabelShort);

  document.querySelectorAll<HTMLButtonElement>('[data-comp]').forEach(btn => {
    btn.addEventListener('click', () => {
      comparison = btn.dataset.comp as Comparison;
      renderWeather(location, weather);
    });
  });
  document.getElementById('search-btn')!.addEventListener('click', renderSearch);
  attachThemeHandler();
  attachHCHandler();
  attachDropdownHandlers();

  const modal = document.getElementById('info-modal')!;
  const modalTitle = document.getElementById('modal-title')!;
  const modalBody = document.getElementById('modal-body')!;
  const closeModal = () => modal.classList.add('hidden');

  document.getElementById('modal-close')!.addEventListener('click', closeModal);
  document.getElementById('modal-backdrop')!.addEventListener('click', closeModal);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  document.querySelectorAll<HTMLButtonElement>('.info-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const info = getMetricInfo(btn.dataset.metric!);
      if (!info) return;
      modalTitle.textContent = info.title;
      modalBody.innerHTML = info.body;
      modal.classList.remove('hidden');
    });
  });
}

// ─── Actions ──────────────────────────────────────────────────────────────────

function renderNoDataError(location: GeoResult): void {
  const dark = isDark();
  const hc   = highContrast;
  const currentModel = findModel(model);
  const menuBg          = hc ? (dark ? '#000000' : '#ffffff') : (dark ? '#1e293b' : '#ffffff');
  const menuBorderColor = hc ? (dark ? '#ffffff' : '#000000') : (dark ? '#334155' : '#e2e8f0');
  const menuItemTextCls = hc ? (dark ? 'text-white' : 'text-black') : (dark ? 'text-slate-200' : 'text-slate-700');
  const btnCls = hc
    ? (dark ? 'border-white text-white' : 'border-black text-black')
    : (dark ? 'border-slate-700 text-slate-300' : 'border-slate-200 text-slate-600');
  const headingCls = hc ? (dark ? 'text-white' : 'text-black') : (dark ? 'text-slate-200' : 'text-slate-800');
  const textCls = hc ? (dark ? 'text-gray-100' : 'text-gray-900') : (dark ? 'text-slate-400' : 'text-slate-500');

  root.innerHTML = `
    <div class="min-h-screen flex items-center justify-center p-4">
      <div class="text-center max-w-sm w-full">
        <div class="text-4xl mb-4">📡</div>
        <h2 class="text-xl font-semibold ${headingCls} mb-2">${t('error.noDataTitle')}</h2>
        <p class="${textCls} text-sm mb-6">${t('error.noDataBody', { model: currentModel.name, location: location.name })}</p>
        <div class="relative inline-block mb-3">
          <button id="model-btn" class="text-sm px-4 py-2 rounded-xl border ${btnCls} hover-btn flex items-center gap-1.5">
            ${currentModel.shortLabel} <span class="text-xs opacity-50">▾</span>
          </button>
          ${modelMenuHTML(menuBg, menuBorderColor, menuItemTextCls, true)}
        </div>
        <div>
          <button id="back-btn" class="px-5 py-2.5 bg-sky-500 text-white rounded-xl hover:bg-sky-600 transition-colors text-sm">
            ${t('error.changeLocation')}
          </button>
        </div>
      </div>
    </div>
  `;

  const modelBtn  = document.getElementById('model-btn')!;
  const modelMenu = document.getElementById('model-menu')!;
  modelBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const wasHidden = modelMenu.classList.contains('hidden');
    modelMenu.classList.toggle('hidden');
    if (wasHidden) {
      setTimeout(() => document.addEventListener('click', () => modelMenu.classList.add('hidden'), { once: true }), 0);
    }
  });
  modelMenu.querySelectorAll<HTMLButtonElement>('[data-model]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      model = btn.dataset.model as string;
      void loadWeather(location);
    });
  });
  document.getElementById('back-btn')!.addEventListener('click', renderSearch);
}

async function loadWeather(location: GeoResult): Promise<void> {
  renderLoading(t('error.loadingFor', { name: location.name }));
  try {
    const weather = await fetchWeather(location.latitude, location.longitude, model);
    renderWeather(location, weather);
  } catch (err) {
    if (err instanceof WeatherNoDataError || (err instanceof Error && err.name === 'WeatherNoDataError')) {
      renderNoDataError(location);
    } else {
      renderError(t('error.failed'));
    }
  }
}

async function handleGeolocate(): Promise<void> {
  renderLoading(t('error.detecting'));
  try {
    const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 }),
    );
    const location: GeoResult = {
      name: t('geo.yourLocation'),
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      country: '',
    };
    const weather = await fetchWeather(location.latitude, location.longitude);
    renderWeather(location, weather);
  } catch (err) {
    renderError(
      err instanceof GeolocationPositionError
        ? t('error.locationDenied')
        : t('error.failed'),
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
