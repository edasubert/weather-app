import './style.css';
import { fetchWeather, fetchModelAvailability, WeatherNoDataError } from './weather';
import type { TimelineDayInfo, UnusableReason } from './weather';
import { WEATHER_MODELS, MODEL_MAP, findModel, DEFAULT_MODEL } from './models';
import { searchCity } from './geocoding';
import { describeCode } from './wmo';
import { buildTimeline, setupTimelineTooltip, startWindField, timelineDayWidth, type ChartVisibility } from './chart';
import { t, setLang, getLang, getLocale, fmtNum, LANGS, type Lang } from './i18n';
import { ICONS, feelsIcon } from './icons';
import type { DailyWeather, GeoResult, HourlyData } from './types';

const root = document.getElementById('app')!;
let unit: 'C' | 'F' = 'C';
let model = DEFAULT_MODEL;

// Which parameters the cards and chart display. Order is the URL bitmask bit
// order — APPEND only, never reorder, or shared `hide` URLs would change meaning.
// `precip` covers all precipitation kinds (rain, showers, snow), matching the chart.
const CARD_PARAMS  = ['temp', 'apparentTemp', 'precip', 'wind', 'pressure', 'daylight'] as const;
const CHART_PARAMS = ['temp', 'apparentTemp', 'precip', 'pressure', 'cloud', 'wind'] as const;
type CardParam  = typeof CARD_PARAMS[number];
type ChartParam = typeof CHART_PARAMS[number];
// Default = everything shown.
const cardVis  = new Set<string>(CARD_PARAMS);
const chartVis = new Set<string>(CHART_PARAMS);
const cardOn  = (id: CardParam)  => cardVis.has(id);
const chartOn = (id: ChartParam) => chartVis.has(id);
const chartVisibility = (): ChartVisibility => ({
  temp:         chartOn('temp'),
  apparentTemp: chartOn('apparentTemp'),
  precip:       chartOn('precip'),
  pressure:     chartOn('pressure'),
  cloud:        chartOn('cloud'),
  wind:         chartOn('wind'),
});
// Icon + label per settings param — reuses existing metric/tooltip i18n keys.
const PARAM_ICON: Record<string, string> = {
  temp: ICONS.temp, apparentTemp: ICONS.feels, precip: ICONS.rain,
  wind: ICONS.wind, pressure: ICONS.pressure, daylight: ICONS.daylight, cloud: ICONS.cloud,
};
const paramLabel = (id: string): string => id === 'cloud' ? t('tooltip.cloudCover') : t(`metric.${id}.title`);

const LANG_NAMES: Record<Lang, string> = {
  en: 'English', cs: 'Čeština', de: 'Deutsch',
  es: 'Español', fr: 'Français', ja: '日本語',
  pt: 'Português', uk: 'Українська',
};

// Cross-fade DOM swaps where the browser supports the View Transitions API
function transition(render: () => void): void {
  const doc = document as Document & {
    startViewTransition?: (cb: () => void) => { ready?: Promise<unknown>; finished?: Promise<unknown> };
  };
  if (doc.startViewTransition) {
    // A new transition skips any pending one, rejecting its promises with
    // AbortError — swallow those so rapid interactions don't log errors
    const vt = doc.startViewTransition(render);
    vt.ready?.catch(() => {});
    vt.finished?.catch(() => {});
  } else {
    render();
  }
}

// ─── Dropdown menus ───────────────────────────────────────────────────────────

function langMenuHTML(openUp = false): string {
  const pos = openUp ? 'bottom-full mb-1' : 'top-full mt-1';
  const items = LANGS.map((lang, i) => {
    const sep = i > 0 ? ' border-t border-edge' : '';
    const active = getLang() === lang ? ' font-semibold' : '';
    return `<button class="w-full text-left px-3 py-2 pointer-coarse:py-3 text-sm hover-item text-body${sep}${active}" data-lang="${lang}">${LANG_NAMES[lang]}</button>`;
  }).join('');
  return `<div id="lang-menu" class="absolute left-0 ${pos} rounded-xl shadow-lg z-20 hidden overflow-hidden bg-surface border border-edge" style="min-width:130px">${items}</div>`;
}

function modelMenuHTML(openUp = false, hasLocation = false): string {
  const pos = openUp ? 'bottom-full mb-1' : 'top-full mt-1';
  const groups = ['auto', 'seamless', 'global', 'regional'] as const;
  const groupLabels: Record<string, string> = {
    auto:     t('model.groupAuto'),
    seamless: t('model.groupSeamless'),
    global:   t('model.groupGlobal'),
    regional: t('model.groupRegional'),
  };
  let list = '';
  let first = true;
  for (const group of groups) {
    const groupModels = WEATHER_MODELS.filter(m => m.group === group);
    if (!groupModels.length) continue;
    const groupBorder = first ? '' : ' border-t border-edge';
    list += `<div class="model-group px-3 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-body opacity-50${groupBorder}" data-group="${group}">${groupLabels[group]}</div>`;
    for (const m of groupModels) {
      const active = model === m.id ? ' font-semibold' : '';
      const search = `${m.name} ${m.provider} ${m.coverage} ${m.shortLabel}`.toLowerCase().replace(/"/g, '');
      list += `<button class="model-item w-full text-left px-3 py-2 pointer-coarse:py-3 text-sm hover-item text-body border-t border-edge${active}" data-model="${m.id}" data-group="${group}" data-search="${search}">
        <div class="flex items-center gap-1.5">
          <span class="avail-mark hidden text-sky-500 shrink-0" title="${t('model.availableHere')}">✓</span>
          <span class="min-w-0 flex-1">${m.name}</span>
        </div>
        <div class="text-xs opacity-50">${m.provider} · ${m.coverage}</div>
      </button>`;
    }
    first = false;
  }

  const toggle = hasLocation
    ? `<button id="model-here-only" type="button" aria-pressed="false" class="shrink-0 flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-edge text-muted hover-btn"><span aria-hidden="true">✓</span><span>${t('model.hereOnly')}</span></button>`
    : '';
  const searchBar = `<div class="sticky top-0 z-10 bg-surface border-b border-edge p-2 flex items-center gap-2">
    <input id="model-search" type="text" autocomplete="off" placeholder="${t('model.searchPlaceholder')}" class="min-w-0 flex-1 px-2 py-1.5 rounded-lg border border-edge bg-surface text-body text-sm placeholder:text-placeholder focus:outline-hidden focus:ring-2 focus:ring-sky-400" />
    ${toggle}
  </div>`;
  const noMatch = `<div id="model-nomatch" class="hidden px-3 py-6 text-sm text-muted text-center">${t('model.noMatches')}</div>`;

  return `<div id="model-menu" class="absolute left-0 ${pos} rounded-xl shadow-lg z-20 hidden flex flex-col text-left bg-surface border border-edge" style="min-width:300px;max-height:400px">
    ${searchBar}
    <div id="model-list" class="overflow-y-auto">${list}${noMatch}</div>
  </div>`;
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let suggestions: GeoResult[] = [];
let chartResizeObserver: ResizeObserver | null = null;

// ─── Theme ────────────────────────────────────────────────────────────────────

type Theme = 'auto' | 'dark' | 'light';
type Comparison = 'yesterday-today' | 'today-tomorrow';
type WeatherData = { today: DailyWeather; yesterday: DailyWeather; tomorrow: DailyWeather; todayHourly: HourlyData; yesterdayHourly: HourlyData; tomorrowHourly: HourlyData; days: TimelineDayInfo[]; hourlyAll: HourlyData; utcOffsetSeconds: number };
type ViewState =
  | { type: 'search' }
  | { type: 'loading' }
  | { type: 'weather'; location: GeoResult; weather: WeatherData }
  | { type: 'settings'; location: GeoResult; weather: WeatherData }
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

function setupDropdown(btnId: string, menuId: string, dataAttr: string, onSelect: (value: string) => void): void {
  const btn  = document.getElementById(btnId);
  const menu = document.getElementById(menuId);
  if (!btn || !menu) return;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const wasHidden = menu.classList.contains('hidden');
    closeAllMenus();
    if (wasHidden) {
      menu.classList.remove('hidden');
      setTimeout(() => document.addEventListener('click', () => menu.classList.add('hidden'), { once: true }), 0);
    }
  });
  menu.querySelectorAll<HTMLButtonElement>(`[data-${dataAttr}]`).forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      onSelect(item.dataset[dataAttr]!);
    });
  });
}

// ─── Model selector: search + per-location availability ───────────────────────
const availabilityCache = new Map<string, Set<string>>();
const availabilityInflight = new Map<string, Promise<Set<string>>>();
const ALL_MODEL_IDS = WEATHER_MODELS.map(m => m.id);

function availabilityKey(loc: GeoResult): string {
  return `${loc.latitude.toFixed(2)},${loc.longitude.toFixed(2)}`;
}

// Deliver the usable-model set for a location: synchronously from cache (no
// marker flash) or once the single multi-model probe resolves. One request per
// location, deduped across rapid re-opens.
function ensureAvailability(loc: GeoResult, apply: (set: Set<string>) => void): void {
  const key = availabilityKey(loc);
  const cached = availabilityCache.get(key);
  if (cached) { apply(cached); return; }
  let inflight = availabilityInflight.get(key);
  if (!inflight) {
    inflight = fetchModelAvailability(loc.latitude, loc.longitude, ALL_MODEL_IDS).then(set => {
      availabilityCache.set(key, set);
      availabilityInflight.delete(key);
      return set;
    });
    availabilityInflight.set(key, inflight);
  }
  void inflight.then(apply);
}

function filterModelMenu(): void {
  const menu = document.getElementById('model-menu');
  if (!menu) return;
  const q = (menu.querySelector<HTMLInputElement>('#model-search')?.value ?? '').trim().toLowerCase();
  const hereOnly = menu.querySelector('#model-here-only')?.getAttribute('aria-pressed') === 'true';
  let anyVisible = false;
  menu.querySelectorAll<HTMLElement>('.model-item').forEach(item => {
    const matchesQ = !q || (item.dataset.search ?? '').includes(q);
    const visible = matchesQ && (!hereOnly || item.dataset.avail === '1');
    item.classList.toggle('hidden', !visible);
    if (visible) anyVisible = true;
  });
  menu.querySelectorAll<HTMLElement>('.model-group').forEach(header => {
    const items = menu.querySelectorAll<HTMLElement>(`.model-item[data-group="${header.dataset.group}"]`);
    const hasVisible = Array.from(items).some(i => !i.classList.contains('hidden'));
    header.classList.toggle('hidden', !hasVisible);
  });
  menu.querySelector('#model-nomatch')?.classList.toggle('hidden', anyVisible);
}

function applyModelAvailability(set: Set<string>): void {
  const menu = document.getElementById('model-menu');
  if (!menu) return;
  if (!set.size) {
    // Unknown (probe failed / no coords) — leave the list plain, drop the toggle.
    menu.querySelector('#model-here-only')?.classList.add('hidden');
    return;
  }
  menu.querySelectorAll<HTMLElement>('.model-item').forEach(item => {
    const avail = set.has(item.dataset.model ?? '');
    item.dataset.avail = avail ? '1' : '0';
    item.querySelector('.avail-mark')?.classList.toggle('hidden', !avail);
  });
  filterModelMenu();
}

function setupModelDropdown(location: GeoResult | null): void {
  const btn  = document.getElementById('model-btn');
  const menu = document.getElementById('model-menu');
  if (!btn || !menu) return;

  const onSelect = (value: string): void => {
    model = value;
    if (currentView?.type === 'search') renderSearch();
    else if (currentView?.type === 'weather') void loadWeather(currentView.location);
    else if (location) void loadWeather(location);
  };

  let outside: ((e: MouseEvent) => void) | null = null;
  const close = (): void => {
    menu.classList.add('hidden');
    if (outside) { document.removeEventListener('click', outside); outside = null; }
  };

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const wasHidden = menu.classList.contains('hidden');
    closeAllMenus();
    if (!wasHidden) { close(); return; }
    menu.classList.remove('hidden');
    const search = menu.querySelector<HTMLInputElement>('#model-search');
    outside = (ev: MouseEvent) => { if (!menu.contains(ev.target as Node)) close(); };
    setTimeout(() => {
      search?.focus();
      document.addEventListener('click', outside!);
    }, 0);
    if (location) ensureAvailability(location, applyModelAvailability);
  });

  // Clicks inside the menu (search box, toggle) must not bubble out and close it
  menu.addEventListener('click', (e) => e.stopPropagation());
  menu.querySelector<HTMLInputElement>('#model-search')?.addEventListener('input', filterModelMenu);

  const toggle = menu.querySelector<HTMLButtonElement>('#model-here-only');
  toggle?.addEventListener('click', () => {
    const on = toggle.getAttribute('aria-pressed') !== 'true';
    toggle.setAttribute('aria-pressed', String(on));
    toggle.classList.toggle('bg-sky-500', on);
    toggle.classList.toggle('text-white', on);
    toggle.classList.toggle('border-sky-500', on);
    toggle.classList.toggle('text-muted', !on);
    filterModelMenu();
  });

  menu.querySelectorAll<HTMLButtonElement>('[data-model]').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      close();
      onSelect(item.dataset.model!);
    });
  });
}

function rerenderCurrentView(): void {
  if (currentView?.type === 'search') renderSearch();
  else if (currentView?.type === 'weather') renderWeather(currentView.location, currentView.weather);
}

function attachDropdownHandlers(): void {
  setupDropdown('lang-btn', 'lang-menu', 'lang', (value) => {
    void setLang(value as Lang).then(rerenderCurrentView);
  });
  setupModelDropdown(currentView?.type === 'weather' ? currentView.location : null);
  setupDropdown('unit-btn', 'unit-menu', 'unit', (value) => {
    unit = value as 'C' | 'F';
    if (currentView?.type === 'weather') renderWeather(currentView.location, currentView.weather);
  });
}

// No view transition here: the browser swallows clicks that land during a
// transition's capture window, which breaks rapidly cycling the theme button
function applyTheme(): void {
  const dark = isDark();
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.classList.toggle('hc', highContrast);
  // Keep browser chrome (mobile address bar, etc.) in sync with the page background
  const themeColor = highContrast ? (dark ? '#000000' : '#ffffff') : (dark ? '#0f172a' : '#f0f9ff');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColor);
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

// Label for geolocated positions — no reverse-geocoding service is used,
// so the coordinates themselves serve as the location name
function coordsLabel(lat: number, lon: number): string {
  const fmt = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? pos : neg}`;
  return `${fmt(lat, 'N', 'S')}, ${fmt(lon, 'E', 'W')}`;
}

// ─── Comparison summaries ─────────────────────────────────────────────────────

function tempComparison(today: DailyWeather, yesterday: DailyWeather, apparent = false): string {
  const dMax  = apparent ? today.apparentTempMax  - yesterday.apparentTempMax  : today.tempMax  - yesterday.tempMax;
  const dMean = apparent ? today.apparentTempMean - yesterday.apparentTempMean : today.tempMean - yesterday.tempMean;
  const dMin  = apparent ? today.apparentTempMin  - yesterday.apparentTempMin  : today.tempMin  - yesterday.tempMin;
  const absMean = Math.abs(dMean);

  const sameKey   = apparent ? 'comp.feelsSame'   : 'comp.sameTemp';
  const warmerKey = apparent ? 'comp.feelsWarmer' : 'comp.warmer';
  const coolerKey = apparent ? 'comp.feelsCooler' : 'comp.cooler';

  const headline = absMean < 0.5
    ? t(sameKey)
    : `${t(dMean > 0 ? warmerKey : coolerKey, { diff: diffStr(absMean) })}${tempSig(absMean)}`;

  const fmtD = (d: number) => (d >= 0 ? '+' : '−') + diffStr(Math.abs(d));
  const sub = `${t('card.high')} ${fmtD(dMax)} · ${t('card.avg')} ${fmtD(dMean)} · ${t('card.low')} ${fmtD(dMin)}`;

  return `${headline}<span class="block text-xs opacity-50 mt-0.5">${sub}</span>`;
}

function precipComparison(today: DailyWeather, yesterday: DailyWeather, isTomorrowMode = false): string {
  const todayMm = today.rainSum + today.showersSum;
  const yestMm  = yesterday.rainSum + yesterday.showersSum;
  const ctx = isTomorrowMode ? 'tomorrow' : 'today';
  if (todayMm < 0.1 && yestMm < 0.1) return t('comp.noRain');
  if (yestMm >= 0.1 && todayMm < 0.1) return t(`comp.noRain_${ctx}`);
  if (yestMm < 0.1 && todayMm >= 0.1) return t(`comp.rainExpected_${ctx}`);
  const diff = todayMm - yestMm;
  if (Math.abs(diff) < 0.5) return t('comp.sameRain');
  return t(diff > 0 ? 'comp.moreRain' : 'comp.lessRain');
}

function snowComparison(today: DailyWeather, yesterday: DailyWeather, isTomorrowMode = false): string {
  const todayCm = today.snowfallSum;
  const yestCm  = yesterday.snowfallSum;
  const ctx = isTomorrowMode ? 'tomorrow' : 'today';
  if (yestCm >= 0.1 && todayCm < 0.1) return t(`comp.noSnow_${ctx}`);
  if (yestCm < 0.1 && todayCm >= 0.1) return t(`comp.snowExpected_${ctx}`);
  const diff = todayCm - yestCm;
  if (Math.abs(diff) < 0.2) return t('comp.sameSnow');
  return t(diff > 0 ? 'comp.moreSnow' : 'comp.lessSnow');
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

function daylightComparison(today: DailyWeather, yesterday: DailyWeather): string {
  const diff = today.daylightDuration - yesterday.daylightDuration;
  const mins = Math.round(Math.abs(diff) / 60);
  if (mins < 1) return t('comp.sameDaylight');
  return t(diff > 0 ? 'comp.moreDaylight' : 'comp.lessDaylight', { diff: mins });
}

// ─── Metric info (modal content) ─────────────────────────────────────────────

const DOCS_HTML = `<a class="text-accent underline" target="_blank" rel="noopener noreferrer" href="https://open-meteo.com/en/docs">Open-Meteo API docs ↗</a>`;
const LINK = 'class="text-accent underline" target="_blank" rel="noopener noreferrer"';

function getMetricInfo(id: string): { title: string; body: string } {
  return {
    title: t(`metric.${id}.title`),
    body:  t(`metric.${id}.body`, { docs: DOCS_HTML }),
  };
}

// ─── Comparison row ───────────────────────────────────────────────────────────

function infoBtnHTML(id: string): string {
  return `<button class="info-btn w-4 h-4 rounded-full text-[10px] font-bold border shrink-0 flex items-center justify-center transition-colors border-muted text-muted hover:border-accent hover:text-accent" data-metric="${id}">i</button>`;
}

function comparisonRowHTML(icon: string, id: string, summary: string): string {
  return `
    <div class="flex items-center gap-2 text-sm text-detail">
      <span class="w-5 shrink-0">${icon}</span>
      <span class="flex-1">${summary}</span>
      ${infoBtnHTML(id)}
    </div>
  `;
}

// ─── Card HTML ────────────────────────────────────────────────────────────────

// ─── Day-by-day stat table ────────────────────────────────────────────────────

function statTableHTML(a: DailyWeather, b: DailyWeather, labelA: string, labelB: string): string {
  const dayHead = (d: DailyWeather, label: string) => {
    const { emoji, label: cond } = describeCode(d.weatherCode);
    const date = new Date(d.date + 'T12:00:00').toLocaleDateString(getLocale(), {
      weekday: 'short', month: 'short', day: 'numeric',
    });
    return `
      <th class="text-left font-normal align-top pb-2 pl-3 w-[38%]">
        <div class="text-xs font-semibold uppercase tracking-wider text-muted">${label}</div>
        <div class="text-xs text-muted">${date}</div>
        <div class="text-3xl my-1.5">${emoji}</div>
        <div class="font-medium text-body text-sm leading-tight">${cond}</div>
      </th>
    `;
  };

  // temperature with feels-like in parentheses
  const temp2 = (v: number, feels: number, strong = false) => {
    const feelsPart = cardOn('apparentTemp')
      ? ` <span class="text-xs text-muted whitespace-nowrap" title="${t('tooltip.apparentTemp')}">(${feelsIcon(feels)} ${tempStr(feels)})</span>`
      : '';
    return `<span class="${strong ? 'text-base font-semibold text-heading' : 'text-detail'}">${tempStr(v)}</span>${feelsPart}`;
  };

  const row = (labelHTML: string, cellA: string, cellB: string) => `
    <tr>
      <td class="text-xs text-muted py-1 pr-2 whitespace-nowrap">${labelHTML}</td>
      <td class="py-1 pl-3 text-sm">${cellA}</td>
      <td class="py-1 pl-3 text-sm">${cellB}</td>
    </tr>
  `;
  const icon = (key: string, tip: string) => `<span title="${tip}">${key}</span>`;

  const hasRain    = a.rainSum > 0.1     || b.rainSum > 0.1;
  const hasShowers = a.showersSum > 0.1  || b.showersSum > 0.1;
  const hasSnow    = a.snowfallSum > 0.1 || b.snowfallSum > 0.1;
  const showLiquid = !hasSnow || hasRain || hasShowers;
  const mm = (v: number) => v > 0.1 ? `<span class="text-detail">${fmtNum(v)} mm</span>` : `<span class="text-muted">${t('card.noRain')}</span>`;
  const cm = (v: number) => v > 0.1 ? `<span class="text-detail">${fmtNum(v)} cm</span>` : '<span class="text-muted">–</span>';

  return `
    <div class="rounded-2xl p-5 bg-surface hc:border-2 border-edge overflow-x-auto">
      <table class="w-full">
        <thead>
          <tr>
            <th></th>
            ${dayHead(a, labelA)}
            ${dayHead(b, labelB)}
          </tr>
        </thead>
        <tbody>
          ${cardOn('temp') ? row(`${icon(ICONS.temp, t('tooltip.temperature'))} ${t('card.high')}`, temp2(a.tempMax, a.apparentTempMax), temp2(b.tempMax, b.apparentTempMax)) : ''}
          ${cardOn('temp') ? row(`${icon(ICONS.temp, t('tooltip.temperature'))} ${t('card.avg')}`,  temp2(a.tempMean, a.apparentTempMean, true), temp2(b.tempMean, b.apparentTempMean, true)) : ''}
          ${cardOn('temp') ? row(`${icon(ICONS.temp, t('tooltip.temperature'))} ${t('card.low')}`,  temp2(a.tempMin, a.apparentTempMin), temp2(b.tempMin, b.apparentTempMin)) : ''}
          ${cardOn('precip') && showLiquid ? row(icon(ICONS.rain, t('tooltip.precipitation')), mm(a.rainSum), mm(b.rainSum)) : ''}
          ${cardOn('precip') && hasShowers ? row(icon(ICONS.showers, t('tooltip.showers')), mm(a.showersSum), mm(b.showersSum)) : ''}
          ${cardOn('precip') && hasSnow ? row(icon(ICONS.snow, t('tooltip.snowfall')), cm(a.snowfallSum), cm(b.snowfallSum)) : ''}
          ${cardOn('wind') ? row(icon(ICONS.wind, t('tooltip.wind')),
            `<span class="text-detail">${Math.round(a.windSpeedMax)} km/h ${windDirLabel(a.windDirection)}</span>`,
            `<span class="text-detail">${Math.round(b.windSpeedMax)} km/h ${windDirLabel(b.windDirection)}</span>`) : ''}
          ${cardOn('pressure') ? row(icon(ICONS.pressure, t('tooltip.pressure')),
            `<span class="text-detail">${Math.round(a.pressureMean)} hPa</span>`,
            `<span class="text-detail">${Math.round(b.pressureMean)} hPa</span>`) : ''}
          ${cardOn('daylight') && a.sunrise && b.sunrise ? row(icon(ICONS.daylight, t('tooltip.daylight')),
            `<span class="text-detail">${a.sunrise.slice(11, 16)} – ${a.sunset.slice(11, 16)}</span>`,
            `<span class="text-detail">${b.sunrise.slice(11, 16)} – ${b.sunset.slice(11, 16)}</span>`) : ''}
        </tbody>
      </table>
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

async function readUrlSettings(): Promise<void> {
  const p = new URLSearchParams(window.location.search);
  const u = p.get('unit');
  if (u === 'F') unit = 'F';
  const th = p.get('theme');
  if (th === 'dark' || th === 'light' || th === 'auto') theme = th;
  if (p.get('hc') === '1') highContrast = true;
  if (p.get('comp') === 'tomorrow') comparison = 'today-tomorrow';
  const m = p.get('model');
  if (m && MODEL_MAP.has(m)) model = m;
  const hide = p.get('hide');
  if (hide) {
    const [c, g] = hide.split('.');
    applyHideMask(CARD_PARAMS, cardVis, parseInt(c ?? '', 36) || 0);
    applyHideMask(CHART_PARAMS, chartVis, parseInt(g ?? '', 36) || 0);
  }
  // Keep the locale load last — everything above is set synchronously,
  // so the bootstrap can apply the theme before this resolves
  const lg = p.get('lang');
  if (lg && (LANGS as string[]).includes(lg)) {
    await setLang(lg as Lang);
  } else if (!lg) {
    const detected = (navigator.languages ?? [navigator.language])
      .map(l => l.slice(0, 2).toLowerCase())
      .find((l): l is Lang => (LANGS as string[]).includes(l));
    if (detected && detected !== 'en') await setLang(detected);
  }
}

function settingsParams(): URLSearchParams {
  const p = new URLSearchParams();
  p.set('unit', unit);
  if (theme !== 'auto') p.set('theme', theme);
  if (highContrast) p.set('hc', '1');
  if (comparison === 'today-tomorrow') p.set('comp', 'tomorrow');
  if (getLang() !== 'en') p.set('lang', getLang());
  if (model !== DEFAULT_MODEL) p.set('model', model);
  const cMask = maskFromVis(CARD_PARAMS, cardVis);
  const gMask = maskFromVis(CHART_PARAMS, chartVis);
  if (cMask || gMask) p.set('hide', `${cMask.toString(36)}.${gMask.toString(36)}`);
  return p;
}

// Hidden params packed as a base36 bitmask (bit i set = PARAMS[i] hidden), so the
// default (all shown) is 0 and the `hide` param drops out of the URL entirely.
function maskFromVis(params: readonly string[], vis: Set<string>): number {
  let mask = 0;
  params.forEach((param, i) => { if (!vis.has(param)) mask |= 1 << i; });
  return mask;
}
function applyHideMask(params: readonly string[], vis: Set<string>, mask: number): void {
  params.forEach((param, i) => { if (mask & (1 << i)) vis.delete(param); else vis.add(param); });
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
  transition(doRenderSearch);
}

function doRenderSearch(): void {
  currentView = { type: 'search' };
  clearUrlParams();

  root.innerHTML = `
    <div class="min-h-screen flex items-center justify-center p-4">
      <div class="w-full max-w-sm">
        <div class="text-center mb-8">
          <div class="text-5xl mb-3">🌤️</div>
          <h1 class="text-2xl font-semibold text-heading">${t('search.title')}</h1>
          <p class="text-muted mt-1 text-sm">${t('search.subtitle')}</p>
        </div>

        <div class="relative mb-3">
          <input
            id="city-input"
            type="text"
            placeholder="${t('search.placeholder')}"
            autocomplete="off"
            class="w-full px-4 py-3 rounded-xl border border-edge bg-surface text-body placeholder:text-placeholder shadow-xs focus:outline-hidden focus:ring-2 focus:ring-sky-400"
          />
          <div
            id="suggestions-box"
            class="absolute top-full mt-1 w-full bg-surface border border-edge-soft rounded-xl shadow-lg z-10 hidden overflow-hidden"
          ></div>
        </div>

        ${'geolocation' in navigator ? `
          <div class="flex items-center gap-3 my-4">
            <div class="flex-1 h-px bg-edge"></div>
            <span class="text-xs text-muted uppercase tracking-wide">${t('search.or')}</span>
            <div class="flex-1 h-px bg-edge"></div>
          </div>
          <button
            id="geolocate-btn"
            class="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl border border-edge text-detail bg-surface shadow-xs hover-btn"
          >
            📍 ${t('search.useLocation')}
          </button>
        ` : ''}

        <div class="flex justify-center gap-6 mt-8">
          <button id="theme-btn" class="flex items-center gap-2 text-xs subtle-text">
            <span>${THEME_ICONS[theme]}</span>
            <span>${themeLabel()}</span>
          </button>
          <button id="hc-btn" class="flex items-center gap-2 text-xs subtle-text" aria-pressed="${highContrast}" title="Toggle easy to read mode">
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

  // Keyboard navigation over suggestions: arrows move, Enter picks, Esc closes
  let activeIdx = -1;
  const suggestionItems = () => Array.from(box.querySelectorAll<HTMLButtonElement>('button[data-i]'));
  const setActive = (idx: number): void => {
    const items = suggestionItems();
    if (!items.length) return;
    activeIdx = ((idx % items.length) + items.length) % items.length;
    items.forEach((el, i) => el.classList.toggle('kb-active', i === activeIdx));
  };

  input.addEventListener('keydown', (e) => {
    if (box.classList.contains('hidden')) return;
    if (e.key === 'ArrowDown')    { e.preventDefault(); setActive(activeIdx + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(activeIdx - 1); }
    else if (e.key === 'Enter')   { e.preventDefault(); (suggestionItems()[activeIdx] ?? suggestionItems()[0])?.click(); }
    else if (e.key === 'Escape')  { box.classList.add('hidden'); }
  });

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
            class="w-full text-left px-4 py-3 hover-item border-b border-edge-soft last:border-0"
            data-i="${i}"
          >
            <span class="font-medium text-body">${r.name}</span>
            <span class="text-muted text-sm ml-1.5">${[r.admin1, r.country].filter(Boolean).join(', ')}</span>
          </button>
        `).join('');

        box.classList.remove('hidden');
        activeIdx = -1;
        box.querySelectorAll<HTMLButtonElement>('button[data-i]').forEach(btn => {
          btn.addEventListener('click', () => void loadWeather(suggestions[Number(btn.dataset.i)]));
        });
      } catch {
        box.classList.add('hidden');
      }
    }, 300);
  });

  document.getElementById('geolocate-btn')?.addEventListener('click', () => void handleGeolocate());
  attachThemeHandler();
  attachHCHandler();
  attachDropdownHandlers();
}

// Skeleton in the shape of the weather view — feels faster than a spinner
// and avoids the layout flashing in when the data arrives
function renderLoading(msg = t('error.loading')): void {
  currentView = { type: 'loading' };
  transition(() => {
    root.innerHTML = `
      <div class="min-h-screen p-4 sm:p-8">
        <div class="max-w-lg wide:max-w-4xl mx-auto">
          <p class="text-center text-sm text-muted mb-4">${msg}</p>
          <div class="animate-pulse">
            <div class="h-10 rounded-lg mb-3 skeleton"></div>
            <div class="flex flex-col gap-3 mb-3 wide:grid wide:grid-cols-2 wide:items-start">
              <div class="rounded-2xl skeleton" style="height:280px"></div>
              <div class="rounded-2xl skeleton" style="height:340px"></div>
            </div>
            <div class="rounded-2xl skeleton" style="height:300px"></div>
          </div>
        </div>
      </div>
    `;
  });
}

function renderError(msg: string): void {
  transition(() => {
    root.innerHTML = `
      <div class="min-h-screen flex items-center justify-center p-4">
        <div class="text-center">
          <div class="text-4xl mb-4">⚠️</div>
          <p class="text-body mb-5">${msg}</p>
          <button id="back-btn" class="px-5 py-2.5 bg-sky-500 text-white rounded-xl hover:bg-sky-600 transition-colors">
            ${t('error.tryAgain')}
          </button>
        </div>
      </div>
    `;
    document.getElementById('back-btn')!.addEventListener('click', renderSearch);
  });
}

function renderSettings(location: GeoResult, weather: WeatherData): void {
  transition(() => doRenderSettings(location, weather));
}

function doRenderSettings(location: GeoResult, weather: WeatherData): void {
  currentView = { type: 'settings', location, weather };

  const rowHTML = (scope: 'card' | 'chart', id: string, checked: boolean): string => `
    <label class="flex items-center gap-3 py-2.5 px-1 cursor-pointer hover-item rounded-lg">
      <input type="checkbox" class="param-check w-4 h-4 accent-sky-500" data-scope="${scope}" data-id="${id}" ${checked ? 'checked' : ''} />
      <span class="w-5 text-center shrink-0">${PARAM_ICON[id] ?? ''}</span>
      <span class="flex-1 text-sm text-body">${paramLabel(id)}</span>
    </label>`;

  const section = (titleKey: string, rows: string): string => `
    <div class="rounded-2xl p-4 bg-surface hc:border-2 border-edge">
      <h2 class="text-xs font-semibold uppercase tracking-wider text-muted mb-1">${t(titleKey)}</h2>
      ${rows}
    </div>`;

  root.innerHTML = `
    <div class="min-h-screen p-4 sm:p-8">
      <div class="max-w-lg mx-auto">
        <div class="flex items-center justify-between mb-4">
          <h1 class="text-xl font-semibold text-heading">${t('settings.title')}</h1>
          <button id="settings-done" class="text-sm px-4 py-2 rounded-xl bg-sky-500 text-white hover:bg-sky-600 transition-colors">${t('settings.done')}</button>
        </div>
        <div class="flex flex-col gap-3">
          ${section('settings.cards', CARD_PARAMS.map(id => rowHTML('card', id, cardOn(id))).join(''))}
          ${section('settings.chart', CHART_PARAMS.map(id => rowHTML('chart', id, chartOn(id))).join(''))}
        </div>
      </div>
    </div>`;

  document.querySelectorAll<HTMLInputElement>('.param-check').forEach(cb => {
    cb.addEventListener('change', () => {
      const set = cb.dataset.scope === 'card' ? cardVis : chartVis;
      if (cb.checked) set.add(cb.dataset.id!); else set.delete(cb.dataset.id!);
      setUrlParams(location);
    });
  });
  document.getElementById('settings-done')!.addEventListener('click', () => renderWeather(location, weather));
}

function renderWeather(location: GeoResult, weather: WeatherData): void {
  transition(() => doRenderWeather(location, weather));
}

function doRenderWeather(location: GeoResult, weather: WeatherData): void {
  currentView = { type: 'weather', location, weather };
  setUrlParams(location);
  const { today, yesterday, tomorrow } = weather;
  const isTomorrow = comparison === 'today-tomorrow';
  const primary         = isTomorrow ? tomorrow   : today;
  const secondary       = isTomorrow ? today      : yesterday;
  const primaryLabel    = isTomorrow ? t('card.tomorrow') : t('card.today');
  const secondaryLabel  = isTomorrow ? t('card.today')    : t('card.yesterday');
  const locationLabel = [location.name, location.admin1, location.country].filter(Boolean).join(', ');
  const compHeader = isTomorrow ? t('comp.headerTodayTomorrow') : t('comp.headerYesterdayToday');
  // Position of "now" on the timeline, in the location's timezone
  const nowHours = (() => {
    const nowLoc = new Date(Date.now() + weather.utcOffsetSeconds * 1000);
    const dayIdx = weather.days.findIndex(d => d.date === nowLoc.toISOString().slice(0, 10));
    return dayIdx < 0 ? null : dayIdx * 24 + nowLoc.getUTCHours() + nowLoc.getUTCMinutes() / 60;
  })();

  // Day labels: named for the comparison days, locale dates beyond
  const timelineDays = weather.days.map((d, i) => ({
    label: i === 0 ? t('card.yesterday') : i === 1 ? t('card.today') : i === 2 ? t('card.tomorrow')
         : new Date(d.date + 'T12:00:00').toLocaleDateString(getLocale(), { weekday: 'short', month: 'short', day: 'numeric' }),
    sunrise: d.sunrise,
    sunset: d.sunset,
  }));

  root.innerHTML = `
    <div class="min-h-screen p-4 sm:p-8">
      <div class="max-w-lg wide:max-w-4xl mx-auto">
        <div class="flex flex-col sm:flex-row sm:items-center gap-2 mb-4">
          <div class="flex items-center gap-2 min-w-0 sm:flex-1">
            <div class="text-sm text-muted min-w-0 truncate flex-1">📍 ${locationLabel}</div>
            <button class="search-btn sm:hidden text-sm px-3 py-1.5 pointer-coarse:py-2.5 rounded-lg border border-edge text-muted hover-btn shrink-0">
              ${t('weather.changeLocation')}
            </button>
          </div>
          <div class="flex gap-2 shrink-0">
            <div class="relative">
              <button id="model-btn" class="text-sm px-3 py-1.5 pointer-coarse:py-2.5 rounded-lg border border-edge text-muted hover-btn flex items-center gap-1">
                ${findModel(model).shortLabel} <span class="text-xs opacity-50">▾</span>
              </button>
              ${modelMenuHTML(false, true)}
            </div>
            <div class="relative">
              <button id="lang-btn" class="text-sm px-3 py-1.5 pointer-coarse:py-2.5 rounded-lg border border-edge text-muted hover-btn flex items-center gap-1">
                ${getLang().toUpperCase()} <span class="text-xs opacity-50">▾</span>
              </button>
              ${langMenuHTML()}
            </div>
            <div class="relative">
              <button id="unit-btn" class="text-sm px-3 py-1.5 pointer-coarse:py-2.5 rounded-lg border border-edge text-muted hover-btn flex items-center gap-1">
                °${unit} <span class="text-xs opacity-50">▾</span>
              </button>
              <div id="unit-menu" class="absolute left-0 top-full mt-1 rounded-xl shadow-lg z-20 hidden overflow-hidden bg-surface border border-edge" style="min-width:72px">
                <button class="w-full text-left px-3 py-2 pointer-coarse:py-3 text-sm hover-item text-body${unit === 'C' ? ' font-semibold' : ''}" data-unit="C">°C</button>
                <button class="w-full text-left px-3 py-2 pointer-coarse:py-3 text-sm hover-item text-body border-t border-edge${unit === 'F' ? ' font-semibold' : ''}" data-unit="F">°F</button>
              </div>
            </div>
            <button id="settings-btn" title="${t('settings.open')}" aria-label="${t('settings.open')}" class="text-sm px-3 py-1.5 pointer-coarse:py-2.5 rounded-lg border border-edge text-muted hover-btn">
              ⚙️
            </button>
            <button class="search-btn hidden sm:block text-sm px-3 py-1.5 pointer-coarse:py-2.5 rounded-lg border border-edge text-muted hover-btn">
              ${t('weather.changeLocation')}
            </button>
          </div>
        </div>

        <div class="flex mb-3 rounded-lg overflow-hidden border border-edge">
          ${(['yesterday-today', 'today-tomorrow'] as Comparison[]).map((mode, i) => {
            const active = comparison === mode;
            const label  = mode === 'yesterday-today' ? t('comp.headerYesterdayToday') : t('comp.headerTodayTomorrow');
            const divider = i === 0 ? 'border-r border-edge' : '';
            const activeCls   = 'bg-selected text-selected-text';
            const inactiveCls = 'text-muted hover-btn';
            return `<button class="flex-1 text-sm py-2 text-center transition-colors ${divider} ${active ? activeCls : inactiveCls}" data-comp="${mode}">${label}</button>`;
          }).join('')}
        </div>

        <div class="flex flex-col gap-3 mb-3 wide:grid wide:grid-cols-2 wide:items-start">
        <div class="rounded-2xl p-4 bg-panel hc:border-2 border-edge">
          <h1 class="sr-only">${compHeader}</h1>
          <div class="flex flex-col gap-2">
            ${cardOn('temp') ? comparisonRowHTML(ICONS.temp, 'temp', tempComparison(primary, secondary)) : ''}
            ${cardOn('apparentTemp') ? comparisonRowHTML(`<span title="${t('tooltip.apparentTemp')}">${ICONS.feels}</span>`, 'apparentTemp', tempComparison(primary, secondary, true)) : ''}
            ${cardOn('precip') ? (() => {
              const hasAnySnow = primary.snowfallSum > 0.1 || secondary.snowfallSum > 0.1;
              const hasAnyRain = (primary.rainSum + primary.showersSum) > 0.1 || (secondary.rainSum + secondary.showersSum) > 0.1;
              const showRain = !hasAnySnow || hasAnyRain;
              const showSnow = hasAnySnow;
              return (showRain ? comparisonRowHTML(`<span title="${t('tooltip.precipitation')}">${ICONS.rain}</span>`, 'precip', precipComparison(primary, secondary, isTomorrow)) : '')
                   + (showSnow ? comparisonRowHTML(`<span title="${t('tooltip.snowfall')}">${ICONS.snow}</span>`, 'snow', snowComparison(primary, secondary, isTomorrow)) : '');
            })() : ''}
            ${cardOn('wind') ? comparisonRowHTML(`<span title="${t('tooltip.wind')}">${ICONS.wind}</span>`, 'wind', windComparison(primary, secondary)) : ''}
            ${cardOn('pressure') ? comparisonRowHTML(`<span title="${t('tooltip.pressure')}">${ICONS.pressure}</span>`, 'pressure', pressureComparison(primary, secondary)) : ''}
            ${cardOn('daylight') ? comparisonRowHTML(`<span title="${t('tooltip.daylight')}">${ICONS.daylight}</span>`, 'daylight', daylightComparison(primary, secondary)) : ''}
          </div>
        </div>

        ${statTableHTML(secondary, primary, secondaryLabel, primaryLabel)}
        </div>

        <div id="chart-slot"></div>

        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mt-3">
          <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
            <span>${t('weather.dataSource')} <a ${LINK} href="https://open-meteo.com/">Open-Meteo ↗</a></span>
            <a class="subtle-text" href="https://github.com/edasubert/weather-app/issues" target="_blank" rel="noopener noreferrer">${t('footer.reportIssue')} ↗</a>
          </div>
          <div class="flex items-center gap-4 shrink-0">
            <button id="theme-btn" class="flex items-center gap-1.5 text-xs subtle-text">
              <span>${THEME_ICONS[theme]}</span>
              <span>${themeLabel()}</span>
            </button>
            <button id="hc-btn" class="flex items-center gap-1.5 text-xs subtle-text" aria-pressed="${highContrast}">
              <span>◑</span>
              <span>${highContrast ? t('theme.easyReadOn') : t('theme.easyRead')}</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <div id="info-modal" class="fixed inset-0 z-50 flex items-center justify-center p-4 hidden" role="dialog" aria-modal="true">
      <div id="modal-backdrop" class="absolute inset-0" style="background-color:rgba(0,0,0,0.5)"></div>
      <div class="relative w-full max-w-sm rounded-2xl p-6 shadow-2xl bg-surface hc:border-2 border-edge">
        <button id="modal-close" class="absolute top-4 right-4 text-2xl leading-none transition-colors text-muted hover:text-body">&times;</button>
        <h2 id="modal-title" class="text-base font-semibold text-heading mb-3 pr-6"></h2>
        <div id="modal-body" class="text-sm text-detail flex flex-col gap-2"></div>
      </div>
    </div>

  `;

  document.querySelectorAll<HTMLButtonElement>('[data-comp]').forEach(btn => {
    btn.addEventListener('click', () => {
      comparison = btn.dataset.comp as Comparison;
      renderWeather(location, weather);
    });
  });
  document.querySelectorAll<HTMLButtonElement>('.search-btn').forEach(btn => btn.addEventListener('click', renderSearch));
  document.getElementById('settings-btn')?.addEventListener('click', () => renderSettings(location, weather));
  attachThemeHandler();
  attachHCHandler();
  attachDropdownHandlers();

  const modal = document.getElementById('info-modal')!;
  const modalTitle = document.getElementById('modal-title')!;
  const modalBody = document.getElementById('modal-body')!;
  const closeModal = () => modal.classList.add('hidden');

  document.getElementById('modal-close')!.addEventListener('click', closeModal);
  document.getElementById('modal-backdrop')!.addEventListener('click', closeModal);

  document.querySelectorAll<HTMLButtonElement>('.info-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const info = getMetricInfo(btn.dataset.metric!);
      modalTitle.textContent = info.title;
      modalBody.innerHTML = info.body;
      modal.classList.remove('hidden');
    });
  });

  // The chart renders 1:1 at the slot's measured width and re-renders on
  // resize. The viewport shows the two compared days; the remaining forecast
  // days are reachable by scrolling right.
  const chartSlot = root.querySelector<HTMLElement>('#chart-slot')!;
  let currentDayW = 0;
  let windStop: (() => void) | null = null;
  const mountChart = (): void => {
    windStop?.(); // cancel the previous animation loop before re-rendering
    const innerWidth = chartSlot.clientWidth - (highContrast ? 4 : 0); // chart bleeds to the card edges (hc border excepted)
    // keep the scroll position (in days) across resize re-renders
    const prevScroll = chartSlot.querySelector<HTMLElement>('#tl-scroll');
    const scrollDays = prevScroll && currentDayW ? prevScroll.scrollLeft / currentDayW : (isTomorrow ? 1 : 0);
    const vis = chartVisibility();
    chartSlot.innerHTML = buildTimeline(timelineDays, weather.hourlyAll, unit, innerWidth, nowHours, vis);
    const container = chartSlot.querySelector<HTMLElement>('#chart-container')!;
    setupTimelineTooltip(container, timelineDays, weather.hourlyAll, unit, vis);
    currentDayW = timelineDayWidth(innerWidth);
    chartSlot.querySelector<HTMLElement>('#tl-scroll')!.scrollLeft = scrollDays * currentDayW;
    windStop = vis.wind ? startWindField(container, weather.hourlyAll) : null;
  };
  mountChart();

  chartResizeObserver?.disconnect();
  let chartWidth = chartSlot.clientWidth;
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  chartResizeObserver = new ResizeObserver(() => {
    if (Math.abs(chartSlot.clientWidth - chartWidth) < 8) return;
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      chartWidth = chartSlot.clientWidth;
      mountChart();
    }, 150);
  });
  chartResizeObserver.observe(chartSlot);
}

// ─── Actions ──────────────────────────────────────────────────────────────────

function renderNoDataError(location: GeoResult, reason: UnusableReason = 'no_coverage'): void {
  transition(() => doRenderNoDataError(location, reason));
}

function doRenderNoDataError(location: GeoResult, reason: UnusableReason): void {
  const currentModel = findModel(model);
  const noTomorrow = reason === 'no_tomorrow';
  const icon  = noTomorrow ? '📅' : '📡';
  const title = t(noTomorrow ? 'error.noForecastTitle' : 'error.noDataTitle');
  const body  = t(noTomorrow ? 'error.noForecastBody' : 'error.noDataBody', { model: currentModel.name, location: location.name });

  root.innerHTML = `
    <div class="min-h-screen flex items-center justify-center p-4">
      <div class="text-center max-w-sm w-full">
        <div class="text-4xl mb-4">${icon}</div>
        <h2 class="text-xl font-semibold text-heading mb-2">${title}</h2>
        <p class="text-muted text-sm mb-6">${body}</p>
        <div class="relative inline-block mb-3">
          <button id="model-btn" class="text-sm px-4 py-2 rounded-xl border border-edge text-muted hover-btn flex items-center gap-1.5">
            ${currentModel.shortLabel} <span class="text-xs opacity-50">▾</span>
          </button>
          ${modelMenuHTML(true, true)}
        </div>
        <div>
          <button id="back-btn" class="px-5 py-2.5 bg-sky-500 text-white rounded-xl hover:bg-sky-600 transition-colors text-sm">
            ${t('error.changeLocation')}
          </button>
        </div>
      </div>
    </div>
  `;

  setupModelDropdown(location);
  document.getElementById('back-btn')!.addEventListener('click', renderSearch);
}

async function loadWeather(location: GeoResult): Promise<void> {
  renderLoading(t('error.loadingFor', { name: location.name }));
  try {
    const weather = await fetchWeather(location.latitude, location.longitude, model);
    renderWeather(location, weather);
  } catch (err) {
    if (err instanceof WeatherNoDataError || (err instanceof Error && err.name === 'WeatherNoDataError')) {
      renderNoDataError(location, (err as WeatherNoDataError).reason ?? 'no_coverage');
    } else {
      renderError(t('error.failed'));
    }
  }
}

async function handleGeolocate(): Promise<void> {
  renderLoading(t('error.detecting'));
  let location: GeoResult | null = null;
  try {
    const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 }),
    );
    const { latitude, longitude } = pos.coords;
    location = {
      name: coordsLabel(latitude, longitude),
      country: '',
      latitude,
      longitude,
    };
    const weather = await fetchWeather(latitude, longitude, model);
    renderWeather(location, weather);
  } catch (err) {
    if (location && (err instanceof WeatherNoDataError || (err instanceof Error && err.name === 'WeatherNoDataError'))) {
      renderNoDataError(location, (err as WeatherNoDataError).reason ?? 'no_coverage');
    } else {
      renderError(
        err instanceof GeolocationPositionError
          ? t('error.locationDenied')
          : t('error.failed'),
      );
    }
  }
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (theme === 'auto') applyTheme();
});

// Hide city suggestions when clicking outside the search box
document.addEventListener('click', (e) => {
  const b = document.getElementById('suggestions-box');
  const inp = document.getElementById('city-input');
  if (b && !b.contains(e.target as Node) && e.target !== inp) b.classList.add('hidden');
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  document.getElementById('info-modal')?.classList.add('hidden');
});

void (async () => {
  const settingsReady = readUrlSettings();
  applyTheme();
  await settingsReady;

  const initialLocation = getLocationFromUrl();
  if (initialLocation) {
    void loadWeather(initialLocation);
  } else {
    renderSearch();
  }
})();
