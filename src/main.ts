import './style.css';
import { fetchWeather, fetchOutlook, WeatherNoDataError } from './weather';
import { WEATHER_MODELS, MODEL_MAP, findModel, DEFAULT_MODEL } from './models';
import { searchCity } from './geocoding';
import { describeCode } from './wmo';
import { buildChart, setupChartTooltip, buildOutlookChart, setupOutlookTooltip } from './chart';
import { t, setLang, getLang, LANGS, type Lang } from './i18n';
import { ICONS } from './icons';
import type { DailyWeather, GeoResult, HourlyData } from './types';

const root = document.getElementById('app')!;
let unit: 'C' | 'F' = 'C';
let model = DEFAULT_MODEL;
let outlookData: { dates: string[]; hourly: import('./types').HourlyData } | null = null;

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

// ─── Shared menu class strings ────────────────────────────────────────────────

const MENU_ITEM_CLS = 'text-slate-700 dark:text-slate-200 hc:text-black dark-hc:text-white';
const BTN_CLS       = 'border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-400 hc:border-black hc:text-black dark-hc:border-white dark-hc:text-white';

function langMenuHTML(openUp = false): string {
  const pos = openUp ? 'bottom-full mb-1' : 'top-full mt-1';
  const items = LANGS.map((lang, i) => {
    const sep = i > 0 ? ` style="border-top:1px solid var(--menu-border)"` : '';
    const active = getLang() === lang ? ' font-semibold' : '';
    return `<button class="w-full text-left px-3 py-2 text-sm hover-item ${MENU_ITEM_CLS}${active}" data-lang="${lang}"${sep}>${LANG_NAMES[lang]}</button>`;
  }).join('');
  return `<div id="lang-menu" class="absolute left-0 ${pos} rounded-xl shadow-lg z-20 hidden overflow-hidden" style="background-color:var(--menu-bg);border:1px solid var(--menu-border);min-width:130px">${items}</div>`;
}

function modelMenuHTML(openUp = false): string {
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
    const groupBorder = first ? '' : `border-top:1px solid var(--menu-border);`;
    html += `<div class="px-3 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wider ${MENU_ITEM_CLS}" style="${groupBorder}opacity:0.5">${groupLabels[group]}</div>`;
    for (const m of groupModels) {
      const active = model === m.id ? ' font-semibold' : '';
      html += `<button class="w-full text-left px-3 py-2 text-sm hover-item ${MENU_ITEM_CLS}${active}" data-model="${m.id}" style="border-top:1px solid var(--menu-border)"><div>${m.name}</div><div class="text-xs" style="opacity:0.5">${m.provider} · ${m.coverage}</div></button>`;
    }
    first = false;
  }
  return `<div id="model-menu" class="absolute left-0 ${pos} rounded-xl shadow-lg z-20 hidden overflow-y-auto" style="background-color:var(--menu-bg);border:1px solid var(--menu-border);min-width:300px;max-height:360px">${html}</div>`;
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

function closeAllMenus(): void {
  document.getElementById('lang-menu')?.classList.add('hidden');
  document.getElementById('model-menu')?.classList.add('hidden');
  document.getElementById('unit-menu')?.classList.add('hidden');
}

function attachDropdownHandlers(): void {
  const langBtn  = document.getElementById('lang-btn');
  const langMenu = document.getElementById('lang-menu');
  if (langBtn && langMenu) {
    langBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const wasHidden = langMenu.classList.contains('hidden');
      closeAllMenus();
      if (wasHidden) {
        langMenu.classList.remove('hidden');
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
      closeAllMenus();
      if (wasHidden) {
        modelMenu.classList.remove('hidden');
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
      closeAllMenus();
      if (wasHidden) {
        unitMenu.classList.remove('hidden');
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
  // Update theme/hc button labels without re-rendering
  document.querySelectorAll('#theme-btn').forEach(btn => {
    const spans = btn.querySelectorAll('span');
    if (spans[0]) spans[0].textContent = THEME_ICONS[theme];
    if (spans[1]) spans[1].textContent = themeLabel();
  });
  document.querySelectorAll('#hc-btn').forEach(btn => {
    btn.setAttribute('aria-pressed', String(highContrast));
    const spans = btn.querySelectorAll('span');
    if (spans[1]) spans[1].textContent = highContrast ? t('theme.easyReadOn') : t('theme.easyRead');
  });
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
  const todayMm = today.rainSum + today.showersSum;
  const yestMm  = yesterday.rainSum + yesterday.showersSum;
  const ctx = isTomorrowMode ? 'tomorrow' : 'today';
  if (todayMm < 0.1 && yestMm < 0.1) return t('comp.noRain');
  if (yestMm >= 0.1 && todayMm < 0.1) return t(`comp.noRain_${ctx}` as string);
  if (yestMm < 0.1 && todayMm >= 0.1) return t(`comp.rainExpected_${ctx}` as string);
  const diff = todayMm - yestMm;
  if (Math.abs(diff) < 0.5) return t('comp.sameRain');
  return t(diff > 0 ? 'comp.moreRain' : 'comp.lessRain');
}

function snowComparison(today: DailyWeather, yesterday: DailyWeather, isTomorrowMode = false): string {
  const todayCm = today.snowfallSum;
  const yestCm  = yesterday.snowfallSum;
  const ctx = isTomorrowMode ? 'tomorrow' : 'today';
  if (yestCm >= 0.1 && todayCm < 0.1) return t(`comp.noSnow_${ctx}` as string);
  if (yestCm < 0.1 && todayCm >= 0.1) return t(`comp.snowExpected_${ctx}` as string);
  const diff = todayCm - yestCm;
  if (Math.abs(diff) < 0.2) return t('comp.sameSnow');
  return t(diff > 0 ? 'comp.moreSnow' : 'comp.lessSnow');
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

function comparisonRowHTML(icon: string, id: string, summary: string): string {
  return `
    <div class="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300 hc:text-black dark-hc:text-white">
      <span class="w-5 shrink-0">${icon}</span>
      <span class="flex-1">${summary}</span>
      <button class="info-btn w-4 h-4 rounded-full text-[10px] font-bold border shrink-0 flex items-center justify-center transition-colors border-slate-400 text-slate-500 hover:border-sky-400 hover:text-sky-500 dark:border-slate-500 dark:text-slate-400 dark:hover:border-sky-500 dark:hover:text-sky-400 hc:border-black hc:text-black hc:hover:border-sky-700 hc:hover:text-sky-700 dark-hc:border-white dark-hc:text-white dark-hc:hover:border-sky-300 dark-hc:hover:text-sky-300" data-metric="${id}">i</button>
    </div>
  `;
}

// ─── Card HTML ────────────────────────────────────────────────────────────────

function weatherCardHTML(data: DailyWeather, heading: string): string {
  const { emoji, label } = describeCode(data.weatherCode);
  const locale = LOCALE_MAP[getLang()] ?? 'en-US';
  const date = new Date(data.date + 'T12:00:00').toLocaleDateString(locale, {
    weekday: 'short', month: 'short', day: 'numeric',
  });

  return `
    <div class="rounded-2xl p-5 flex flex-col gap-2" style="background-color:var(--card-bg);border:var(--card-border)">
      <div class="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 hc:text-gray-900 dark-hc:text-gray-100">${heading}</div>
      <div class="text-sm text-slate-500 dark:text-slate-400 hc:text-gray-900 dark-hc:text-gray-100">${date}</div>
      <div class="text-5xl my-2">${emoji}</div>
      <div class="font-medium text-slate-700 dark:text-slate-200 hc:text-black dark-hc:text-white">${label}</div>
      <table class="mt-2 w-full text-sm [&_td]:align-bottom [&_th]:align-bottom [&_td:not(:first-child)]:pl-3 [&_th:not(:first-child)]:pl-3">
        <thead>
          <tr>
            <th></th>
            <th class="text-right font-normal pb-0.5" title="${t('tooltip.temperature')}">${ICONS.temp}</th>
            <th class="text-right font-normal pb-0.5" title="${t('tooltip.apparentTemp')}">${ICONS.feels}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="text-xs text-slate-500 dark:text-slate-400 hc:text-gray-800 dark-hc:text-gray-200">${t('card.high')}</td>
            <td class="text-slate-600 dark:text-slate-300 hc:text-gray-900 dark-hc:text-gray-100 text-right">${tempStr(data.tempMax)}</td>
            <td class="text-slate-600 dark:text-slate-300 hc:text-gray-900 dark-hc:text-gray-100 text-right">${tempStr(data.apparentTempMax)}</td>
          </tr>
          <tr>
            <td class="text-xs font-medium text-slate-500 dark:text-slate-400 hc:text-gray-800 dark-hc:text-gray-200">${t('card.avg')}</td>
            <td class="text-base font-semibold text-slate-800 dark:text-slate-100 hc:text-black dark-hc:text-white text-right">${tempStr(data.tempMean)}</td>
            <td class="text-base font-semibold text-slate-700 dark:text-slate-200 hc:text-black dark-hc:text-white text-right">${tempStr(data.apparentTempMean)}</td>
          </tr>
          <tr>
            <td class="text-xs text-slate-500 dark:text-slate-400 hc:text-gray-800 dark-hc:text-gray-200">${t('card.low')}</td>
            <td class="text-slate-600 dark:text-slate-300 hc:text-gray-900 dark-hc:text-gray-100 text-right">${tempStr(data.tempMin)}</td>
            <td class="text-slate-600 dark:text-slate-300 hc:text-gray-900 dark-hc:text-gray-100 text-right">${tempStr(data.apparentTempMin)}</td>
          </tr>
        </tbody>
      </table>
      ${(() => {
        const hasRain    = data.rainSum > 0.1;
        const hasShowers = data.showersSum > 0.1;
        const hasLiquid  = hasRain || hasShowers;
        const hasSnow    = data.snowfallSum > 0.1;
        const cls = 'text-sm text-slate-500 dark:text-slate-400 hc:text-gray-900 dark-hc:text-gray-100';
        const showLiquidRows = !hasSnow || hasLiquid;
        const rainRow    = showLiquidRows && (hasRain || !hasShowers) ? `<div class="${cls}"><span title="${t('tooltip.precipitation')}">${ICONS.rain}</span> ${hasRain ? `${data.rainSum.toFixed(1)} mm` : t('card.noRain')}</div>` : '';
        const showersRow = showLiquidRows && hasShowers ? `<div class="${cls}"><span title="${t('tooltip.showers')}">${ICONS.showers}</span> ${data.showersSum.toFixed(1)} mm</div>` : '';
        const snowRow    = hasSnow ? `<div class="${cls}"><span title="${t('tooltip.snowfall')}">${ICONS.snow}</span> ${data.snowfallSum.toFixed(1)} cm</div>` : '';
        return rainRow + showersRow + snowRow;
      })()}
      <div class="text-sm text-slate-500 dark:text-slate-400 hc:text-gray-900 dark-hc:text-gray-100">
        <span title="${t('tooltip.wind')}">${ICONS.wind}</span> ${Math.round(data.windSpeedMax)} km/h ${windDirLabel(data.windDirection)}
      </div>
      <div class="text-sm text-slate-500 dark:text-slate-400 hc:text-gray-900 dark-hc:text-gray-100">
        <span title="${t('tooltip.pressure')}">${ICONS.pressure}</span> ${Math.round(data.pressureMean)} hPa
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

  root.innerHTML = `
    <div class="min-h-screen flex items-center justify-center p-4">
      <div class="w-full max-w-sm">
        <div class="text-center mb-8">
          <div class="text-5xl mb-3">🌤️</div>
          <h1 class="text-2xl font-semibold text-slate-800 dark:text-slate-100 hc:text-black dark-hc:text-white">${t('search.title')}</h1>
          <p class="text-slate-500 dark:text-slate-400 hc:text-gray-900 dark-hc:text-gray-100 mt-1 text-sm">${t('search.subtitle')}</p>
        </div>

        <div class="relative mb-3">
          <input
            id="city-input"
            type="text"
            placeholder="${t('search.placeholder')}"
            autocomplete="off"
            class="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-700 placeholder-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:placeholder-slate-500 hc:border-black hc:bg-white hc:text-black hc:placeholder-gray-600 dark-hc:border-white dark-hc:bg-black dark-hc:text-white dark-hc:placeholder-gray-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
          />
          <div
            id="suggestions-box"
            class="absolute top-full mt-1 w-full bg-white border border-slate-100 dark:bg-slate-800 dark:border-slate-700 hc:bg-white hc:border-black dark-hc:bg-black dark-hc:border-white rounded-xl shadow-lg z-10 hidden overflow-hidden"
          ></div>
        </div>

        ${'geolocation' in navigator ? `
          <div class="flex items-center gap-3 my-4">
            <div class="flex-1 h-px bg-slate-200 dark:bg-slate-700 hc:bg-black dark-hc:bg-white"></div>
            <span class="text-xs text-slate-500 dark:text-slate-400 hc:text-gray-900 dark-hc:text-gray-100 uppercase tracking-wide">${t('search.or')}</span>
            <div class="flex-1 h-px bg-slate-200 dark:bg-slate-700 hc:bg-black dark-hc:bg-white"></div>
          </div>
          <button
            id="geolocate-btn"
            class="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl border border-slate-200 text-slate-600 bg-white dark:border-slate-700 dark:text-slate-300 dark:bg-slate-800 hc:border-black hc:text-black hc:bg-white dark-hc:border-white dark-hc:text-white dark-hc:bg-black shadow-sm hover-btn"
          >
            📍 ${t('search.useLocation')}
          </button>
        ` : ''}

        <div class="flex justify-center gap-6 mt-8">
          <button id="theme-btn" class="flex items-center gap-2 text-xs subtle-text">
            <span>${THEME_ICONS[theme]}</span>
            <span>${themeLabel()}</span>
          </button>
          <button id="hc-btn" class="flex items-center gap-2 text-xs subtle-text hc:text-black dark-hc:text-white" aria-pressed="${highContrast}" title="Toggle easy to read mode">
            <span>◑</span>
            <span>${highContrast ? t('theme.easyReadOn') : t('theme.easyRead')}</span>
          </button>
          <div class="relative">
            <button id="lang-btn" class="flex items-center gap-1 text-xs subtle-text">
              <span>${getLang().toUpperCase()}</span>
              <span class="opacity-50">▾</span>
            </button>
            ${langMenuHTML(true)}
          </div>
          <div class="relative">
            <button id="model-btn" class="flex items-center gap-1 text-xs subtle-text">
              <span>${findModel(model).shortLabel}</span>
              <span class="opacity-50">▾</span>
            </button>
            ${modelMenuHTML(true)}
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

        box.innerHTML = suggestions.map((r, i) => `
          <button
            class="w-full text-left px-4 py-3 hover-item border-b border-slate-50 dark:border-slate-700 hc:border-black dark-hc:border-white last:border-0"
            data-i="${i}"
          >
            <span class="font-medium text-slate-700 dark:text-slate-200 hc:text-black dark-hc:text-white">${r.name}</span>
            <span class="text-slate-500 dark:text-slate-400 hc:text-gray-900 dark-hc:text-gray-100 text-sm ml-1.5">${[r.admin1, r.country].filter(Boolean).join(', ')}</span>
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
  root.innerHTML = `
    <div class="min-h-screen flex items-center justify-center">
      <div class="text-center text-slate-500 dark:text-slate-400">
        <div class="w-10 h-10 border-4 border-sky-200 dark:border-sky-900 border-t-sky-500 rounded-full animate-spin mx-auto mb-4"></div>
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
        <p class="text-slate-700 dark:text-slate-200 mb-5">${msg}</p>
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
  const compHeader = isTomorrow ? t('comp.headerTodayTomorrow') : t('comp.headerYesterdayToday');

  root.innerHTML = `
    <div class="min-h-screen p-4 sm:p-8">
      <div class="max-w-lg mx-auto">
        <div class="flex flex-col sm:flex-row sm:items-center gap-2 mb-4">
          <div class="flex items-center gap-2 min-w-0 sm:flex-1">
            <div class="text-sm text-slate-500 dark:text-slate-400 hc:text-black dark-hc:text-white min-w-0 truncate flex-1">📍 ${locationLabel}</div>
            <button class="search-btn sm:hidden text-sm px-3 py-1.5 rounded-lg border ${BTN_CLS} hover-btn shrink-0">
              ${t('weather.changeLocation')}
            </button>
          </div>
          <div class="flex gap-2 shrink-0">
            <div class="relative">
              <button id="model-btn" class="text-sm px-3 py-1.5 rounded-lg border ${BTN_CLS} hover-btn flex items-center gap-1">
                ${findModel(model).shortLabel} <span class="text-xs opacity-50">▾</span>
              </button>
              ${modelMenuHTML()}
            </div>
            <div class="relative">
              <button id="lang-btn" class="text-sm px-3 py-1.5 rounded-lg border ${BTN_CLS} hover-btn flex items-center gap-1">
                ${getLang().toUpperCase()} <span class="text-xs opacity-50">▾</span>
              </button>
              ${langMenuHTML()}
            </div>
            <div class="relative">
              <button id="unit-btn" class="text-sm px-3 py-1.5 rounded-lg border ${BTN_CLS} hover-btn flex items-center gap-1">
                °${unit} <span class="text-xs opacity-50">▾</span>
              </button>
              <div id="unit-menu" class="absolute left-0 top-full mt-1 rounded-xl shadow-lg z-20 hidden overflow-hidden" style="background-color:var(--menu-bg);border:1px solid var(--menu-border);min-width:72px">
                <button class="w-full text-left px-3 py-2 text-sm hover-item ${MENU_ITEM_CLS}${unit === 'C' ? ' font-semibold' : ''}" data-unit="C">°C</button>
                <button class="w-full text-left px-3 py-2 text-sm hover-item ${MENU_ITEM_CLS}${unit === 'F' ? ' font-semibold' : ''}" data-unit="F" style="border-top:1px solid var(--menu-border)">°F</button>
              </div>
            </div>
            <button class="search-btn hidden sm:block text-sm px-3 py-1.5 rounded-lg border ${BTN_CLS} hover-btn">
              ${t('weather.changeLocation')}
            </button>
          </div>
        </div>

        <div class="flex mb-3 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 hc:border-black dark-hc:border-white">
          ${(['yesterday-today', 'today-tomorrow'] as Comparison[]).map((mode, i) => {
            const active = comparison === mode;
            const label  = mode === 'yesterday-today' ? t('comp.headerYesterdayToday') : t('comp.headerTodayTomorrow');
            const divider = i === 0 ? 'border-r border-slate-200 dark:border-slate-700 hc:border-black dark-hc:border-white' : '';
            const activeCls   = 'bg-sky-500 text-white hc:bg-black dark-hc:bg-white dark-hc:text-black';
            const inactiveCls = 'text-slate-500 dark:text-slate-400 hc:text-black dark-hc:text-white hover-btn';
            return `<button class="flex-1 text-sm py-2 text-center transition-colors ${divider} ${active ? activeCls : inactiveCls}" data-comp="${mode}">${label}</button>`;
          }).join('')}
        </div>

        <div class="rounded-2xl p-4 mb-4" style="background-color:var(--cmp-bg);border:var(--cmp-border)">
          <h1 class="text-xl font-semibold text-slate-800 dark:text-slate-100 hc:text-black dark-hc:text-white mb-3">${compHeader}</h1>
          <div class="flex flex-col gap-2">
            ${comparisonRowHTML(ICONS.temp, 'temp', tempComparison(primary, secondary))}
            ${comparisonRowHTML(`<span title="${t('tooltip.apparentTemp')}">${ICONS.feels}</span>`, 'apparentTemp', apparentTempComparison(primary, secondary))}
            ${(() => {
              const hasAnySnow = primary.snowfallSum > 0.1 || secondary.snowfallSum > 0.1;
              const hasAnyRain = (primary.rainSum + primary.showersSum) > 0.1 || (secondary.rainSum + secondary.showersSum) > 0.1;
              const showRain = !hasAnySnow || hasAnyRain;
              const showSnow = hasAnySnow;
              return (showRain ? comparisonRowHTML(`<span title="${t('tooltip.precipitation')}">${ICONS.rain}</span>`, 'precip', precipComparison(primary, secondary, isTomorrow)) : '')
                   + (showSnow ? comparisonRowHTML(`<span title="${t('tooltip.snowfall')}">${ICONS.snow}</span>`, 'snow', snowComparison(primary, secondary, isTomorrow)) : '');
            })()}
            ${comparisonRowHTML(`<span title="${t('tooltip.wind')}">${ICONS.wind}</span>`, 'wind', windComparison(primary, secondary))}
            ${comparisonRowHTML(`<span title="${t('tooltip.pressure')}">${ICONS.pressure}</span>`, 'pressure', pressureComparison(primary, secondary))}
          </div>
        </div>

        <div class="grid grid-cols-2 hc:grid-cols-1 gap-3 mb-3">
          ${weatherCardHTML(secondary, secondaryLabel)}
          ${weatherCardHTML(primary, primaryLabel)}
        </div>

        ${buildChart(primaryHourly, secondaryHourly, unit, t('chart.' + (isTomorrow ? 'tomorrow' : 'today') as string), t('chart.' + (isTomorrow ? 'today' : 'yesterday') as string))}

        <div class="flex justify-center mt-3">
          <button id="outlook-btn" class="text-sm px-4 py-2 rounded-xl border ${BTN_CLS} hover-btn">
            ${t('outlook.button')}
          </button>
        </div>

        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mt-2">
          <div class="text-sm text-slate-500 dark:text-slate-400 hc:text-gray-900 dark-hc:text-gray-100">
            ${t('weather.dataSource')} <a ${LINK} href="https://open-meteo.com/">Open-Meteo ↗</a>
          </div>
          <div class="flex items-center gap-4">
            <button id="theme-btn" class="flex items-center gap-1.5 text-xs subtle-text">
              <span>${THEME_ICONS[theme]}</span>
              <span>${themeLabel()}</span>
            </button>
            <button id="hc-btn" class="flex items-center gap-1.5 text-xs subtle-text hc:text-black dark-hc:text-white" aria-pressed="${highContrast}">
              <span>◑</span>
              <span>${highContrast ? t('theme.easyReadOn') : t('theme.easyRead')}</span>
            </button>
          </div>
        </div>
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mt-2">
          <div class="flex items-center gap-4">
            <a class="text-sm subtle-text" href="https://github.com/edasubert/weather-app/issues" target="_blank" rel="noopener noreferrer">
            ${t('footer.reportIssue')} ↗
          </a>
        </div>
        </div>
      </div>
    </div>

    <div id="info-modal" class="fixed inset-0 z-50 flex items-center justify-center p-4 hidden" role="dialog" aria-modal="true">
      <div id="modal-backdrop" class="absolute inset-0" style="background-color:rgba(0,0,0,0.5)"></div>
      <div class="relative w-full max-w-sm rounded-2xl p-6 shadow-2xl" style="background-color:var(--modal-bg);border:var(--modal-border)">
        <button id="modal-close" class="absolute top-4 right-4 text-2xl leading-none transition-colors text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hc:text-black hc:hover:text-gray-700 dark-hc:text-white dark-hc:hover:text-gray-300">&times;</button>
        <h2 id="modal-title" class="text-base font-semibold text-slate-800 dark:text-slate-100 hc:text-black dark-hc:text-white mb-3 pr-6"></h2>
        <div id="modal-body" class="text-sm text-slate-600 dark:text-slate-300 hc:text-gray-900 dark-hc:text-gray-100 flex flex-col gap-2"></div>
      </div>
    </div>

    <div id="outlook-modal" class="fixed inset-0 z-50 flex flex-col hidden" style="background-color:var(--modal-bg)" role="dialog" aria-modal="true">
      <div class="flex items-center justify-between px-4 sm:px-6 py-3 shrink-0" style="border-bottom:1px solid var(--menu-border)">
        <h2 class="text-base font-semibold text-slate-800 dark:text-slate-100 hc:text-black dark-hc:text-white">${t('outlook.title')}</h2>
        <button id="outlook-close" class="w-8 h-8 flex items-center justify-center text-xl leading-none transition-colors text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hc:text-black dark-hc:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 hc:hover:bg-gray-200 dark-hc:hover:bg-gray-800">&times;</button>
      </div>
      <div id="outlook-content" class="flex-1 overflow-auto p-4 sm:p-6">
      </div>
    </div>
  `;

  const chartContainer = root.querySelector<HTMLElement>('#chart-container');
  if (chartContainer) setupChartTooltip(chartContainer, primaryHourly, secondaryHourly, unit, primaryLabelShort, secondaryLabelShort);

  document.querySelectorAll<HTMLButtonElement>('[data-comp]').forEach(btn => {
    btn.addEventListener('click', () => {
      comparison = btn.dataset.comp as Comparison;
      renderWeather(location, weather);
    });
  });
  document.querySelectorAll<HTMLButtonElement>('.search-btn').forEach(btn => btn.addEventListener('click', renderSearch));
  attachThemeHandler();
  attachHCHandler();
  attachDropdownHandlers();

  const modal = document.getElementById('info-modal')!;
  const modalTitle = document.getElementById('modal-title')!;
  const modalBody = document.getElementById('modal-body')!;
  const closeModal = () => modal.classList.add('hidden');

  document.getElementById('modal-close')!.addEventListener('click', closeModal);
  document.getElementById('modal-backdrop')!.addEventListener('click', closeModal);

  const outlookModal   = document.getElementById('outlook-modal')!;
  const outlookContent = document.getElementById('outlook-content')!;
  const closeOutlook   = () => outlookModal.classList.add('hidden');

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeModal(); closeOutlook(); }
  });

  document.querySelectorAll<HTMLButtonElement>('.info-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const info = getMetricInfo(btn.dataset.metric!);
      if (!info) return;
      modalTitle.textContent = info.title;
      modalBody.innerHTML = info.body;
      modal.classList.remove('hidden');
    });
  });

  document.getElementById('outlook-close')!.addEventListener('click', closeOutlook);

  const renderOutlookChart = () => {
    if (!outlookData) return;
    const locale = LOCALE_MAP[getLang()] ?? 'en-US';
    outlookContent.innerHTML = buildOutlookChart(outlookData.hourly, unit, outlookData.dates, locale);
    const cc = outlookContent.querySelector<HTMLElement>('#outlook-chart-container');
    if (cc) setupOutlookTooltip(cc, outlookData.hourly, unit, outlookData.dates, locale);
  };

  document.getElementById('outlook-btn')!.addEventListener('click', async () => {
    outlookModal.classList.remove('hidden');
    if (outlookData) {
      renderOutlookChart();
      return;
    }
    outlookContent.innerHTML = `
      <div class="flex items-center justify-center min-h-[200px]">
        <div class="w-10 h-10 border-4 border-sky-200 dark:border-sky-900 border-t-sky-500 rounded-full animate-spin"></div>
      </div>
    `;
    try {
      outlookData = await fetchOutlook(location.latitude, location.longitude, model);
      renderOutlookChart();
    } catch {
      outlookContent.innerHTML = `<p class="text-center text-slate-500 dark:text-slate-400 p-8">${t('error.failed')}</p>`;
    }
  });
}

// ─── Actions ──────────────────────────────────────────────────────────────────

function renderNoDataError(location: GeoResult): void {
  const currentModel = findModel(model);

  root.innerHTML = `
    <div class="min-h-screen flex items-center justify-center p-4">
      <div class="text-center max-w-sm w-full">
        <div class="text-4xl mb-4">📡</div>
        <h2 class="text-xl font-semibold text-slate-800 dark:text-slate-200 hc:text-black dark-hc:text-white mb-2">${t('error.noDataTitle')}</h2>
        <p class="text-slate-500 dark:text-slate-400 hc:text-gray-900 dark-hc:text-gray-100 text-sm mb-6">${t('error.noDataBody', { model: currentModel.name, location: location.name })}</p>
        <div class="relative inline-block mb-3">
          <button id="model-btn" class="text-sm px-4 py-2 rounded-xl border ${BTN_CLS} hover-btn flex items-center gap-1.5">
            ${currentModel.shortLabel} <span class="text-xs opacity-50">▾</span>
          </button>
          ${modelMenuHTML(true)}
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
  outlookData = null;
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
