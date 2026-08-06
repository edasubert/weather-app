import './style.css';
import { fetchWeather, fetchModelAvailability, fetchModelComparison, WeatherNoDataError } from './weather';
import type { TimelineDayInfo, UnusableReason, CompareData } from './weather';
import { fetchAirQuality } from './airquality';
import type { AirData } from './airquality';
import { buildCompareTable, COMPARE_PARAMS, CMP_PARAM_ICON } from './compare';
import { WEATHER_MODELS, MODEL_MAP, findModel, DEFAULT_MODEL } from './models';
import { searchCity } from './geocoding';
import { buildTimeline, setupTimelineTooltip, startWindField, timelineDayWidth, type ChartVisibility } from './chart';
import { buildAirChart, setupAirChartTooltip, type AirChartVisibility } from './airchart';
import { buildPollenChart, setupPollenChartTooltip, type PollenChartVisibility } from './pollenchart';
import { t, setLang, getLang, getLocale, LANGS, type Lang } from './i18n';
import { ICONS, BADGE_ICONS, feelsIcon } from './icons';
import type { DailyWeather, GeoResult, HourlyData } from './types';

const root = document.getElementById('app')!;
let unit: 'C' | 'F' = 'C';
let model = DEFAULT_MODEL;

// Which parameters the cards and chart display. Order is the URL bitmask bit
// order — APPEND only, never reorder, or shared `hide` URLs would change meaning.
// `precip` covers all precipitation kinds (rain, showers, snow), matching the chart.
const CARD_PARAMS  = ['temp', 'apparentTemp', 'precip', 'precipHours', 'wind', 'gusts', 'humidity', 'visibility', 'cloud', 'pressure', 'daylight', 'sunshine', 'uv'] as const;
const CHART_PARAMS = ['temp', 'apparentTemp', 'precip', 'pressure', 'cloud', 'wind', 'uv'] as const;

type CardParam  = typeof CARD_PARAMS[number];
type ChartParam = typeof CHART_PARAMS[number];
// Default = everything shown.
const cardVis  = new Set<string>(CARD_PARAMS);
const chartVis = new Set<string>(CHART_PARAMS);
// User-controlled column order for the comparison chart. Persisted in `co=` URL param.
// Always a permutation of CARD_PARAMS; new metrics append at end, removed ones drop silently.
let cardOrder: string[] = [...CARD_PARAMS];
const cardOn  = (id: CardParam)  => cardVis.has(id);
const chartOn = (id: ChartParam) => chartVis.has(id);
const chartVisibility = (): ChartVisibility => ({
  temp:         chartOn('temp'),
  apparentTemp: chartOn('apparentTemp'),
  precip:       chartOn('precip'),
  pressure:     chartOn('pressure'),
  cloud:        chartOn('cloud'),
  wind:         chartOn('wind'),
  uv:           chartOn('uv'),
});

// Air-quality and pollen severity charts. Bit 0 of each group ('airChart' /
// 'pollenChart') is the whole-chart hide toggle; the rest are per-line switches
// (per gas / per taxon). Same APPEND-only bitmask contract as the arrays above.
const AIR_PARAMS    = ['airChart', 'no2', 'o3', 'so2', 'pm25', 'pm10'] as const;
const POLLEN_PARAMS = ['pollenChart', 'alder', 'birch', 'grass', 'mugwort', 'olive', 'ragweed'] as const;
const airVis    = new Set<string>(AIR_PARAMS);
const pollenVis = new Set<string>(POLLEN_PARAMS);
const airOn    = (id: string) => airVis.has(id);
const pollenOn = (id: string) => pollenVis.has(id);
const airChartVisibility = (): AirChartVisibility =>
  ({ no2: airVis.has('no2'), o3: airVis.has('o3'), so2: airVis.has('so2'),
     pm25: airVis.has('pm25'), pm10: airVis.has('pm10') });
const pollenChartVisibility = (): PollenChartVisibility => ({
  alder: pollenVis.has('alder'), birch: pollenVis.has('birch'), grass: pollenVis.has('grass'),
  mugwort: pollenVis.has('mugwort'), olive: pollenVis.has('olive'), ragweed: pollenVis.has('ragweed'),
});

// Icon + label per settings param — reuses existing metric/tooltip i18n keys.
// Air-quality and pollen rows are intentionally text-only (no icon), so their
// ids are absent here and fall back to an empty icon column.
const PARAM_ICON: Record<string, string> = {
  temp: ICONS.temp, apparentTemp: ICONS.feels, precip: ICONS.rain,
  wind: ICONS.wind, pressure: ICONS.pressure, daylight: ICONS.daylight, cloud: ICONS.cloud, uv: ICONS.uv,
  humidity: ICONS.humidity, visibility: ICONS.visibility,
  gusts: ICONS.gusts, precipHours: ICONS.precipHours, sunshine: ICONS.sunshine,
};
const paramLabel = (id: string): string =>
  id === 'showers' ? t('tooltip.showers') :
  t(`metric.${id}.title`);

// ─── Model comparison state ("app in the app") ────────────────────────────────
let cmpModels: string[] = [];
let cmpParams = new Set<string>(COMPARE_PARAMS);
let cmpRange: 2 | 7 | 'all' = 2;
let cmpData: CompareData | null = null;
let cmpLocation: GeoResult | null = null;

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
let compScrollObserver: ResizeObserver | null = null;

// ─── Theme ────────────────────────────────────────────────────────────────────

type Theme = 'auto' | 'dark' | 'light';
type Comparison = 'yesterday-today' | 'today-tomorrow';
type WeatherData = { today: DailyWeather; yesterday: DailyWeather; tomorrow: DailyWeather; todayHourly: HourlyData; yesterdayHourly: HourlyData; tomorrowHourly: HourlyData; days: TimelineDayInfo[]; hourlyAll: HourlyData; utcOffsetSeconds: number; air?: AirData | null };
type ViewState =
  | { type: 'search' }
  | { type: 'loading' }
  | { type: 'weather'; location: GeoResult; weather: WeatherData }
  | { type: 'settings'; location: GeoResult; weather: WeatherData }
  | { type: 'compare'; location: GeoResult }
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
  document.getElementById('cmp-model-menu')?.classList.add('hidden');
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
  else if (currentView?.type === 'compare') renderCompare(currentView.location);
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


// ─── Comparison bar chart ─────────────────────────────────────────────────────

interface CompBarMetric {
  id: string;
  emoji: string;
  primaryVal: number;
  secondaryVal: number;
  primaryLabel: string;
  secondaryLabel: string;
  unit: string;
  diffLabel?: string;
  primaryMin?: number;
  primaryMax?: number;
  secondaryMin?: number;
  secondaryMax?: number;
  scaleMin?: number; // override gMin for the error-bar y-axis (shared scale across metrics)
  scaleMax?: number; // override gMax for the error-bar y-axis
  primaryFloatStart?: number;   // decimal hours 0-24: renders a floating bar from start→end
  primaryFloatEnd?: number;
  secondaryFloatStart?: number;
  secondaryFloatEnd?: number;
  primaryProbability?: number | null;   // 0-100; drives fill-opacity on precipitation bars
  secondaryProbability?: number | null;
  noData?: boolean;  // both days have no data; column moves to end and renders a placeholder
}

function buildComparisonChart(
  metrics: CompBarMetric[],
  primaryDayLabel: string,
  secondaryDayLabel: string,
): string {
  if (metrics.length === 0) return '';

  // No-data columns move to the end so they don't interrupt the main sequence
  const sorted = [...metrics].sort((a, b) => (a.noData ? 1 : 0) - (b.noData ? 1 : 0));

  const COL_W  = 56;
  const H      = 192;
  const BOTTOM = 148;
  const MAX_H  = 90;
  const BAR_W  = 12;
  const GAP    = 4;
  const svgW   = sorted.length * COL_W;

  const hasNoData = sorted.some(m => m.noData);
  const parts: string[] = [
    hasNoData
      ? `<defs><pattern id="comp-nodata" x="0" y="0" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="8" stroke="var(--chart-grid)" stroke-width="2.5"/></pattern></defs>`
      : '',
    `<line x1="0" y1="${BOTTOM}" x2="${svgW}" y2="${BOTTOM}" stroke="var(--chart-grid)" stroke-width="1"/>`,
  ];

  for (let i = 0; i < sorted.length; i++) {
    const { id, emoji, primaryVal, secondaryVal, primaryLabel, secondaryLabel,
            unit: mUnit, diffLabel, primaryMin, primaryMax, secondaryMin, secondaryMax,
            scaleMin, scaleMax,
            primaryFloatStart, primaryFloatEnd, secondaryFloatStart, secondaryFloatEnd,
            primaryProbability, secondaryProbability, noData } = sorted[i];
    const cx  = i * COL_W + COL_W / 2;

    const secXL = cx - GAP / 2 - BAR_W;  // left edge of secondary bar
    const secXR = cx - GAP / 2;           // right edge of secondary bar
    const secCX = cx - 8;                 // centre of secondary bar
    const priXL = cx + GAP / 2;           // left edge of primary bar
    const priXR = cx + GAP / 2 + BAR_W;  // right edge of primary bar
    const priCX = cx + 8;                 // centre of primary bar

    if (noData) {
      // ── No-data placeholder ───────────────────────────────────────────
      const plW  = priXR - secXL;
      const plX  = secXL;
      const plY  = BOTTOM - MAX_H;
      parts.push(
        `<rect x="${plX.toFixed(1)}" y="${plY}" width="${plW.toFixed(1)}" height="${MAX_H}" rx="3" fill="url(#comp-nodata)" opacity="0.4"/>`,
        `<rect x="${plX.toFixed(1)}" y="${plY}" width="${plW.toFixed(1)}" height="${MAX_H}" rx="3" fill="none" stroke="var(--chart-grid)" stroke-width="1"/>`,
        `<text x="${cx}" y="${(BOTTOM - MAX_H / 2 + 4).toFixed(1)}" text-anchor="middle" font-size="8" fill="var(--chart-label)">No data</text>`,
      );
    } else if (primaryMin !== undefined && primaryMax !== undefined &&
        secondaryMin !== undefined && secondaryMax !== undefined) {
      // ── Error-bar mode (temperature metrics) ──────────────────────────
      const gMin = scaleMin ?? Math.min(primaryMin, secondaryMin);
      const gMax = scaleMax ?? Math.max(primaryMax, secondaryMax);
      // Scale from 0 when all values are positive; fall back to gMin otherwise
      const scaleBase = Math.min(gMin, 0);
      const scY = (v: number) =>
        gMax > scaleBase ? BOTTOM - ((v - scaleBase) / (gMax - scaleBase)) * MAX_H : BOTTOM - MAX_H / 2;

      for (const [cL, cR, cX, dMin, dMean, dMax, col] of [
        [secXL, secXR, secCX, secondaryMin, secondaryVal, secondaryMax, 'var(--comp-bar-neg)'],
        [priXL, priXR, priCX, primaryMin,   primaryVal,   primaryMax,   'var(--comp-bar-pos)'],
      ] as [number, number, number, number, number, number, string][]) {
        const yMin  = scY(dMin);
        const yMax  = scY(dMax);
        const yMean = scY(dMean);
        parts.push(
          // stem
          `<line x1="${cX}" y1="${yMax.toFixed(1)}" x2="${cX}" y2="${yMin.toFixed(1)}" stroke="${col}" stroke-width="1.5" stroke-linecap="round"/>`,
          // top cap
          `<line x1="${cL}" y1="${yMax.toFixed(1)}" x2="${cR}" y2="${yMax.toFixed(1)}" stroke="${col}" stroke-width="1.5" stroke-linecap="round"/>`,
          // bottom cap
          `<line x1="${cL}" y1="${yMin.toFixed(1)}" x2="${cR}" y2="${yMin.toFixed(1)}" stroke="${col}" stroke-width="1.5" stroke-linecap="round"/>`,
          // mean tick (bold)
          `<line x1="${cL}" y1="${yMean.toFixed(1)}" x2="${cR}" y2="${yMean.toFixed(1)}" stroke="${col}" stroke-width="3.5" stroke-linecap="round"/>`,
        );
      }

    } else if (primaryFloatStart !== undefined && primaryFloatEnd !== undefined &&
               secondaryFloatStart !== undefined && secondaryFloatEnd !== undefined) {
      // ── Interval mode (daylight: sunrise→sunset on 0–24 h scale) ──────
      // Matches the error-bar visual style (stem + end-caps, no mean tick).
      // 0 h maps to BOTTOM, 24 h maps to BOTTOM − MAX_H.
      const scY = (h: number) => BOTTOM - (h / 24) * MAX_H;

      const yTop24 = (BOTTOM - MAX_H).toFixed(1);

      for (const [cL, cR, cX, xL, fStart, fEnd, col] of [
        [secXL, secXR, secCX, secXL, secondaryFloatStart, secondaryFloatEnd, 'var(--comp-bar-neg)'],
        [priXL, priXR, priCX, priXL, primaryFloatStart,   primaryFloatEnd,   'var(--comp-bar-pos)'],
      ] as [number, number, number, number, number, number, string][]) {
        // Full 0–24 h stem + caps (matches temperature error-bar style)
        parts.push(
          `<line x1="${cX.toFixed(1)}" y1="${yTop24}" x2="${cX.toFixed(1)}" y2="${BOTTOM}" stroke="${col}" stroke-width="1.5" stroke-linecap="round"/>`,
          `<line x1="${cL.toFixed(1)}" y1="${yTop24}" x2="${cR.toFixed(1)}" y2="${yTop24}" stroke="${col}" stroke-width="1.5" stroke-linecap="round"/>`,
          `<line x1="${cL.toFixed(1)}" y1="${BOTTOM}" x2="${cR.toFixed(1)}" y2="${BOTTOM}" stroke="${col}" stroke-width="1.5" stroke-linecap="round"/>`,
        );
        // Daylight window overlaid as a filled bar (always full opacity)
        const yBar = scY(fEnd);
        const barH = (fEnd - fStart) / 24 * MAX_H;
        parts.push(`<rect x="${xL.toFixed(1)}" y="${yBar.toFixed(1)}" width="${BAR_W}" height="${barH.toFixed(1)}" rx="3" fill="${col}" stroke="${col}" stroke-width="1"/>`);
      }

    } else {
      // ── Regular bar mode ───────────────────────────────────────────────
      const ref  = scaleMax ?? Math.max(Math.abs(primaryVal), Math.abs(secondaryVal));
      const priH = ref > 0 ? Math.max(primaryVal   !== 0 ? 3 : 0, (Math.abs(primaryVal)   / ref) * MAX_H) : 0;
      const secH = ref > 0 ? Math.max(secondaryVal !== 0 ? 3 : 0, (Math.abs(secondaryVal) / ref) * MAX_H) : 0;

      // Precipitation bars use probability as fill-opacity (null/undefined = full opacity, i.e. observed past day)
      const priFo = primaryProbability   != null ? (primaryProbability   / 100).toFixed(2) : '1';
      const secFo = secondaryProbability != null ? (secondaryProbability / 100).toFixed(2) : '1';

      if (secH >= 1) parts.push(`<rect x="${secXL.toFixed(1)}" y="${(BOTTOM - secH).toFixed(1)}" width="${BAR_W}" height="${secH.toFixed(1)}" rx="3" fill="var(--comp-bar-neg)" fill-opacity="${secFo}" stroke="var(--comp-bar-neg)" stroke-width="1"/>`);
      if (priH >= 1) parts.push(`<rect x="${priXL.toFixed(1)}" y="${(BOTTOM - priH).toFixed(1)}" width="${BAR_W}" height="${priH.toFixed(1)}" rx="3" fill="var(--comp-bar-pos)" fill-opacity="${priFo}" stroke="var(--comp-bar-pos)" stroke-width="1"/>`);
    }

    // Emoji and diff label sit in a fixed header row above all bars
    const EMOJI_Y      = BOTTOM - MAX_H - 30;  // fixed: same row for every column
    const DIFF_LABEL_Y = BOTTOM - MAX_H - 8;  // fixed: row just below emoji
    if (diffLabel) {
      parts.push(`<text x="${cx}" y="${DIFF_LABEL_Y}" text-anchor="middle" font-size="9" fill="var(--chart-label)">${diffLabel}</text>`);
    }
    const emojiId = `comp-emoji-${i}`;
    parts.push(`<text id="${emojiId}" x="${cx}" y="${EMOJI_Y}" text-anchor="middle" font-size="16" role="img" aria-label="${paramLabel(id)}" data-tooltip="${paramLabel(id)}">${emoji}</text>`);
    const badge = BADGE_ICONS[id];
    if (badge) {
      parts.push(`<text x="${(cx + 8).toFixed(1)}" y="${EMOJI_Y + 6}" text-anchor="middle" font-size="14" data-tooltip="${paramLabel(id)}" data-tooltip-anchor="${emojiId}">${badge}</text>`);
    }

    // Value labels below bars
    parts.push(
      `<text x="${secCX}" y="${BOTTOM + 12}" text-anchor="middle" font-size="8" fill="var(--chart-label)">${secondaryLabel}</text>`,
      `<text x="${priCX}" y="${BOTTOM + 12}" text-anchor="middle" font-size="8" fill="var(--comp-bar-pos)">${primaryLabel}</text>`,
    );
    if (mUnit) {
      parts.push(`<text x="${cx}" y="${BOTTOM + 25}" text-anchor="middle" font-size="9" fill="var(--chart-label)">${mUnit}</text>`);
    }
  }

  // Scroll hint arrow drawn inside the SVG — below value labels (max y=BOTTOM+25=173),
  // above the scrollbar which lives outside the SVG. Span 25%–75% of chart width.
  const aY  = H - 9;
  const aX1 = 16;
  const aX2 = 156;
  parts.push(
    `<path id="comp-scroll-hint" d="M${aX1.toFixed(1)},${aY} L${aX2.toFixed(1)},${aY} M${(aX2 - 7).toFixed(1)},${(aY - 4).toFixed(1)} L${aX2.toFixed(1)},${aY} L${(aX2 - 7).toFixed(1)},${(aY + 4).toFixed(1)}" stroke="var(--chart-label)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="0.35" aria-hidden="true"/>`,
  );

  const metricIds = sorted.filter(m => !m.noData).map(m => m.id).join(',');
  const legend = `<div style="display:flex;justify-content:center;align-items:center;gap:16px;padding:4px 0 2px;font-size:11px;color:var(--chart-label);"><div style="display:flex;align-items:center;gap:5px;"><div style="width:10px;height:10px;border-radius:2px;background:var(--comp-bar-neg);flex-shrink:0;"></div><span>${secondaryDayLabel}</span></div><div style="display:flex;align-items:center;gap:5px;"><div style="width:10px;height:10px;border-radius:2px;background:var(--comp-bar-pos);flex-shrink:0;"></div><span>${primaryDayLabel}</span></div><button id="comp-info-btn" data-metrics="${metricIds}" class="info-btn w-4 h-4 rounded-full text-[10px] font-bold border shrink-0 flex items-center justify-center transition-colors border-muted text-muted hover:border-accent hover:text-accent" aria-label="About these metrics">i</button></div>`;

  const fadeW = 32;
  const fadeStyle = (dir: 'right' | 'left', id: string, extra = '') =>
    `<div id="${id}" style="position:absolute;top:0;${dir === 'left' ? 'left' : 'right'}:0;width:${fadeW}px;height:${H}px;pointer-events:none;background:linear-gradient(to ${dir === 'left' ? 'right' : 'left'},var(--color-surface) 10%,transparent);transition:opacity 0.15s;${extra}"></div>`;
  return `<div><div style="position:relative"><div class="overflow-x-auto" id="comp-chart-scroll"><svg width="${svgW}" height="${H}" aria-hidden="true">${parts.join('')}</svg></div>${fadeStyle('left', 'comp-fade-left', 'opacity:0')}${fadeStyle('right', 'comp-fade-right', 'opacity:1')}</div>${legend}</div>`;
}


// Label for geolocated positions — no reverse-geocoding service is used,
// so the coordinates themselves serve as the location name
function coordsLabel(lat: number, lon: number): string {
  const fmt = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? pos : neg}`;
  return `${fmt(lat, 'N', 'S')}, ${fmt(lon, 'E', 'W')}`;
}

// Peak-of-day UV from the CAMS hourly series (yesterday=0, today=1, tomorrow=2).
function uvPeakForDay(air: AirData | null | undefined, dayIdx: number): number | null {
  const vals = (air?.uv ?? []).slice(dayIdx * 24, dayIdx * 24 + 24).filter((v): v is number => v != null);
  return vals.length ? Math.max(...vals) : null;
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
    // Positional base36 segments: card.chart.air.pollen. Old 2-segment URLs omit
    // the air/pollen segments, which parse to 0 → those groups stay fully shown.
    const [c, g, a, po] = hide.split('.');
    applyHideMask(CARD_PARAMS, cardVis, parseInt(c ?? '', 36) || 0);
    applyHideMask(CHART_PARAMS, chartVis, parseInt(g ?? '', 36) || 0);
    applyHideMask(AIR_PARAMS, airVis, parseInt(a ?? '', 36) || 0);
    applyHideMask(POLLEN_PARAMS, pollenVis, parseInt(po ?? '', 36) || 0);
  }
  const co = p.get('co');
  if (co) {
    const known = new Set<string>(CARD_PARAMS);
    const parsed = co.split(',').filter(id => known.has(id));
    const parsedSet = new Set(parsed);
    const trailing = [...CARD_PARAMS].filter(id => !parsedSet.has(id));
    cardOrder = [...parsed, ...trailing];
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
  const masks = [
    maskFromVis(CARD_PARAMS, cardVis),
    maskFromVis(CHART_PARAMS, chartVis),
    maskFromVis(AIR_PARAMS, airVis),
    maskFromVis(POLLEN_PARAMS, pollenVis),
  ];
  // Trim trailing zero segments (min 2) so old card.chart URLs still round-trip.
  const segs = masks.map(m => m.toString(36));
  while (segs.length > 2 && segs[segs.length - 1] === '0') segs.pop();
  if (masks.some(m => m)) p.set('hide', segs.join('.'));
  if (cardOrder.join(',') !== [...CARD_PARAMS].join(',')) p.set('co', cardOrder.join(','));
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

// The comparison view has its own URL: view=compare + its own attributes
// (m=models, p=shown params, d=range in days), plus the shared location and
// global unit/theme/lang. Kept separate from the weather view's params.
function setCompareUrl(location: GeoResult): void {
  const p = new URLSearchParams();
  p.set('view', 'compare');
  p.set('lat', location.latitude.toFixed(4));
  p.set('lon', location.longitude.toFixed(4));
  p.set('name', location.name);
  if (location.country) p.set('country', location.country);
  if (location.admin1) p.set('admin1', location.admin1);
  if (unit === 'F') p.set('unit', 'F');
  if (theme !== 'auto') p.set('theme', theme);
  if (highContrast) p.set('hc', '1');
  if (getLang() !== 'en') p.set('lang', getLang());
  if (cmpModels.length) p.set('m', cmpModels.join(','));
  if (cmpParams.size !== COMPARE_PARAMS.length) p.set('p', COMPARE_PARAMS.filter(x => cmpParams.has(x)).join(','));
  if (cmpRange !== 2) p.set('d', String(cmpRange));
  history.replaceState(null, '', '?' + p.toString());
}

function readCompareUrl(): void {
  const p = new URLSearchParams(window.location.search);
  const m = p.get('m');
  if (m !== null) cmpModels = m.split(',').filter(id => MODEL_MAP.has(id));
  const pp = p.get('p');
  if (pp !== null) cmpParams = new Set((COMPARE_PARAMS as readonly string[]).filter(x => pp.split(',').includes(x)));
  const d = p.get('d');
  cmpRange = d === '7' ? 7 : d === 'all' ? 'all' : 2;
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

  const rowHTML = (scope: 'card' | 'chart' | 'air' | 'pollen', id: string, checked: boolean): string => `
    <label class="flex items-center gap-3 py-2.5 px-1 cursor-pointer hover-item rounded-lg">
      <input type="checkbox" class="param-check w-4 h-4 accent-sky-500" data-scope="${scope}" data-id="${id}" ${checked ? 'checked' : ''} />
      <span class="w-6 shrink-0 flex justify-center">${PARAM_ICON[id] ? `<span style="position:relative;display:inline-block">${PARAM_ICON[id]}${BADGE_ICONS[id] ? `<span style="position:absolute;right:-0.3em;bottom:-0.1em;font-size:0.8em;line-height:1">${BADGE_ICONS[id]}</span>` : ''}</span>` : ''}</span>
      <span class="flex-1 text-sm text-body">${paramLabel(id)}</span>
    </label>`;

  const cardRowHTML = (id: string, idx: number, total: number): string => {
    const checked = cardOn(id as CardParam);
    const iconSpan = PARAM_ICON[id]
      ? `<span style="position:relative;display:inline-block">${PARAM_ICON[id]}${BADGE_ICONS[id] ? `<span style="position:absolute;right:-0.3em;bottom:-0.1em;font-size:0.8em;line-height:1">${BADGE_ICONS[id]}</span>` : ''}</span>`
      : '';
    const upDim   = idx === 0          ? ' opacity-25 cursor-default pointer-events-none' : '';
    const downDim = idx === total - 1  ? ' opacity-25 cursor-default pointer-events-none' : '';
    return `
      <div class="flex items-center gap-1 py-2.5 px-1 hover-item rounded-lg">
        <label class="flex items-center gap-3 flex-1 cursor-pointer min-w-0">
          <input type="checkbox" class="param-check w-4 h-4 accent-sky-500 shrink-0" data-scope="card" data-id="${id}" ${checked ? 'checked' : ''} />
          <span class="w-6 shrink-0 flex justify-center">${iconSpan}</span>
          <span class="flex-1 text-sm text-body truncate">${paramLabel(id)}</span>
        </label>
        <div class="flex flex-col shrink-0">
          <button class="card-move-btn w-6 h-4 flex items-center justify-center text-[10px] text-muted hover:text-body${upDim}" data-id="${id}" data-dir="-1" aria-label="Move up">▲</button>
          <button class="card-move-btn w-6 h-4 flex items-center justify-center text-[10px] text-muted hover:text-body${downDim}" data-id="${id}" data-dir="1" aria-label="Move down">▼</button>
        </div>
      </div>`;
  };

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
          ${section('settings.cards', cardOrder.map((id, i) => cardRowHTML(id, i, cardOrder.length)).join(''))}
          ${section('settings.chart', CHART_PARAMS.map(id => rowHTML('chart', id, chartOn(id))).join(''))}
          ${section('settings.air', AIR_PARAMS.map(id => rowHTML('air', id, airOn(id))).join(''))}
          ${section('settings.pollen', POLLEN_PARAMS.map(id => rowHTML('pollen', id, pollenOn(id))).join(''))}
        </div>
      </div>
    </div>`;

  document.querySelectorAll<HTMLInputElement>('.param-check').forEach(cb => {
    cb.addEventListener('change', () => {
      const set = cb.dataset.scope === 'card' ? cardVis
                : cb.dataset.scope === 'chart' ? chartVis
                : cb.dataset.scope === 'air' ? airVis
                : pollenVis;
      if (cb.checked) set.add(cb.dataset.id!); else set.delete(cb.dataset.id!);
      setUrlParams(location);
    });
  });
  document.querySelectorAll<HTMLButtonElement>('.card-move-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id!;
      const dir = parseInt(btn.dataset.dir!);
      const idx = cardOrder.indexOf(id);
      const newIdx = idx + dir;
      if (newIdx < 0 || newIdx >= cardOrder.length) return;
      [cardOrder[idx], cardOrder[newIdx]] = [cardOrder[newIdx], cardOrder[idx]];
      setUrlParams(location);
      doRenderSettings(location, weather);
    });
  });
  document.getElementById('settings-done')!.addEventListener('click', () => renderWeather(location, weather));
}

// ─── Model comparison view ("app in the app") ─────────────────────────────────

function cmpModelMenuHTML(): string {
  const groups = ['auto', 'seamless', 'global', 'regional'] as const;
  const groupLabels: Record<string, string> = {
    auto: t('model.groupAuto'), seamless: t('model.groupSeamless'),
    global: t('model.groupGlobal'), regional: t('model.groupRegional'),
  };
  let list = '';
  let first = true;
  for (const group of groups) {
    const models = WEATHER_MODELS.filter(m => m.group === group);
    if (!models.length) continue;
    list += `<div class="model-group px-3 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-body opacity-50${first ? '' : ' border-t border-edge'}" data-group="${group}">${groupLabels[group]}</div>`;
    for (const m of models) {
      const search = `${m.name} ${m.provider} ${m.coverage} ${m.shortLabel}`.toLowerCase().replace(/"/g, '');
      list += `<label class="model-item flex items-center gap-2 px-3 py-2 text-sm hover-item text-body border-t border-edge cursor-pointer" data-group="${group}" data-search="${search}">
        <input type="checkbox" class="cmp-model-check w-4 h-4 accent-sky-500 shrink-0" data-model="${m.id}" ${cmpModels.includes(m.id) ? 'checked' : ''}/>
        <span class="avail-mark hidden text-sky-500 shrink-0" title="${t('model.availableHere')}">✓</span>
        <span class="min-w-0 flex-1"><span>${m.name}</span><span class="block text-xs opacity-50">${m.provider} · ${m.coverage}</span></span>
      </label>`;
    }
    first = false;
  }
  return `<div id="cmp-model-menu" class="absolute left-0 top-full mt-1 rounded-xl shadow-lg z-30 hidden flex flex-col text-left bg-surface border border-edge" style="min-width:300px;max-height:60vh">
    <div class="sticky top-0 z-10 bg-surface border-b border-edge p-2 flex items-center gap-2">
      <input id="cmp-model-search" type="text" autocomplete="off" placeholder="${t('model.searchPlaceholder')}" class="min-w-0 flex-1 px-2 py-1.5 rounded-lg border border-edge bg-surface text-body text-sm placeholder:text-placeholder focus:outline-hidden focus:ring-2 focus:ring-sky-400"/>
      <button id="cmp-here-only" type="button" aria-pressed="false" class="shrink-0 flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-edge text-muted hover-btn"><span aria-hidden="true">✓</span><span>${t('model.hereOnly')}</span></button>
    </div>
    <div class="overflow-y-auto">${list}<div id="cmp-model-nomatch" class="hidden px-3 py-6 text-sm text-muted text-center">${t('model.noMatches')}</div></div>
  </div>`;
}

function filterCmpMenu(): void {
  const menu = document.getElementById('cmp-model-menu');
  if (!menu) return;
  const q = (menu.querySelector<HTMLInputElement>('#cmp-model-search')?.value ?? '').trim().toLowerCase();
  const hereOnly = menu.querySelector('#cmp-here-only')?.getAttribute('aria-pressed') === 'true';
  let any = false;
  menu.querySelectorAll<HTMLElement>('.model-item').forEach(it => {
    const vis = (!q || (it.dataset.search ?? '').includes(q)) && (!hereOnly || it.dataset.avail === '1');
    it.classList.toggle('hidden', !vis);
    if (vis) any = true;
  });
  menu.querySelectorAll<HTMLElement>('.model-group').forEach(h => {
    const items = menu.querySelectorAll<HTMLElement>(`.model-item[data-group="${h.dataset.group}"]`);
    h.classList.toggle('hidden', !Array.from(items).some(i => !i.classList.contains('hidden')));
  });
  menu.querySelector('#cmp-model-nomatch')?.classList.toggle('hidden', any);
}

function applyCmpAvailability(set: Set<string>): void {
  const menu = document.getElementById('cmp-model-menu');
  if (!menu) return;
  if (!set.size) {
    // Unknown (probe failed) — drop the toggle, leave every model selectable.
    menu.querySelector('#cmp-here-only')?.classList.add('hidden');
    return;
  }
  menu.querySelectorAll<HTMLElement>('.model-item').forEach(it => {
    const id = it.querySelector<HTMLInputElement>('.cmp-model-check')?.dataset.model ?? '';
    const avail = set.has(id);
    it.dataset.avail = avail ? '1' : '0';
    it.querySelector('.avail-mark')?.classList.toggle('hidden', !avail);
  });
  filterCmpMenu();
}

function setupCmpModelMenu(location: GeoResult): void {
  const btn = document.getElementById('cmp-model-btn');
  const menu = document.getElementById('cmp-model-menu');
  if (!btn || !menu) return;
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
    const search = menu.querySelector<HTMLInputElement>('#cmp-model-search');
    outside = (ev: MouseEvent) => { if (!menu.contains(ev.target as Node)) close(); };
    setTimeout(() => { search?.focus(); document.addEventListener('click', outside!); }, 0);
    ensureAvailability(location, applyCmpAvailability);
  });
  menu.addEventListener('click', (e) => e.stopPropagation());
  menu.querySelector<HTMLInputElement>('#cmp-model-search')?.addEventListener('input', filterCmpMenu);
  const toggle = menu.querySelector<HTMLButtonElement>('#cmp-here-only');
  toggle?.addEventListener('click', () => {
    const on = toggle.getAttribute('aria-pressed') !== 'true';
    toggle.setAttribute('aria-pressed', String(on));
    toggle.classList.toggle('bg-sky-500', on);
    toggle.classList.toggle('text-white', on);
    toggle.classList.toggle('border-sky-500', on);
    toggle.classList.toggle('text-muted', !on);
    filterCmpMenu();
  });
  menu.querySelectorAll<HTMLInputElement>('.cmp-model-check').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = cb.dataset.model!;
      if (cb.checked) { if (!cmpModels.includes(id)) cmpModels.push(id); }
      else cmpModels = cmpModels.filter(x => x !== id);
      setCompareUrl(location);
      void refreshCompareTable(); // keeps the popover open
    });
  });
}

function cmpNowIdx(data: CompareData): number {
  const nowIso = new Date(Date.now() + data.utcOffsetSeconds * 1000).toISOString().slice(0, 13);
  return data.time.findIndex(tt => tt.slice(0, 13) === nowIso);
}

function cmpMessage(msgKey: string): string {
  return `<div class="rounded-2xl bg-surface hc:border-2 border-edge p-10 text-center text-muted text-sm">${t(msgKey)}</div>`;
}

function drawCompareTable(slot: HTMLElement): void {
  if (!cmpData) return;
  const rangeHours = cmpRange === 'all' ? cmpData.time.length : cmpRange * 24;
  const params = COMPARE_PARAMS.filter(p => cmpParams.has(p));
  slot.innerHTML = buildCompareTable(cmpData, cmpModels, params, unit, rangeHours, cmpNowIdx(cmpData));
  slot.querySelectorAll<HTMLButtonElement>('.cmp-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.model!;
      cmpModels = cmpModels.filter(x => x !== id);
      document.querySelector<HTMLInputElement>(`.cmp-model-check[data-model="${id}"]`)?.removeAttribute('checked');
      const cb = document.querySelector<HTMLInputElement>(`.cmp-model-check[data-model="${id}"]`);
      if (cb) cb.checked = false;
      if (cmpLocation) setCompareUrl(cmpLocation);
      void refreshCompareTable();
    });
  });
}

// Fill the #cmp-table slot: fetch only when the current data doesn't already
// cover the selected models (range/param/unit changes never refetch).
async function refreshCompareTable(): Promise<void> {
  const slot = document.getElementById('cmp-table');
  if (!slot || !cmpLocation) return;
  if (!cmpModels.length) { slot.innerHTML = cmpMessage('compare.emptyModels'); return; }
  if (!cmpParams.size)   { slot.innerHTML = cmpMessage('compare.emptyParams'); return; }
  const covered = cmpData && cmpModels.every(id => id in cmpData!.models);
  if (!covered) {
    slot.innerHTML = `<div class="rounded-2xl bg-surface hc:border-2 border-edge p-10 text-center text-muted text-sm animate-pulse">${t('error.loading')}</div>`;
    try {
      cmpData = await fetchModelComparison(cmpLocation.latitude, cmpLocation.longitude, cmpModels);
    } catch {
      slot.innerHTML = cmpMessage('error.failed');
      return;
    }
  }
  drawCompareTable(slot);
}

function renderCompare(location: GeoResult): void {
  transition(() => doRenderCompare(location));
}

function doRenderCompare(location: GeoResult): void {
  currentView = { type: 'compare', location };
  cmpLocation = location;
  setCompareUrl(location);
  const locationLabel = [location.name, location.admin1, location.country].filter(Boolean).join(', ');
  const rangeBtn = (v: string, key: string) => {
    const active = String(cmpRange) === v;
    return `<button class="cmp-range px-3 py-1.5 text-sm ${active ? 'bg-selected text-selected-text' : 'text-muted hover-btn'}" data-range="${v}">${t(key)}</button>`;
  };
  const paramChecks = COMPARE_PARAMS.map(p => `
    <label class="flex items-center gap-1.5 text-sm cursor-pointer">
      <input type="checkbox" class="cmp-param-check w-4 h-4 accent-sky-500" data-param="${p}" ${cmpParams.has(p) ? 'checked' : ''}/>
      <span>${CMP_PARAM_ICON[p]}</span><span class="text-body">${paramLabel(p)}</span>
    </label>`).join('');

  root.innerHTML = `
    <div class="min-h-screen p-4 sm:p-8">
      <div class="max-w-6xl mx-auto">
        <div class="flex flex-wrap items-center gap-2 mb-4">
          <button id="cmp-back" class="text-sm px-3 py-1.5 rounded-lg border border-edge text-muted hover-btn shrink-0">← ${t('compare.back')}</button>
          <div class="text-sm text-muted min-w-0 truncate flex-1">📍 ${locationLabel}</div>
          <div class="flex gap-2 shrink-0">
            <div class="relative">
              <button id="unit-btn" class="text-sm px-3 py-1.5 rounded-lg border border-edge text-muted hover-btn flex items-center gap-1">°${unit} <span class="text-xs opacity-50">▾</span></button>
              <div id="unit-menu" class="absolute right-0 top-full mt-1 rounded-xl shadow-lg z-20 hidden overflow-hidden bg-surface border border-edge" style="min-width:72px">
                <button class="w-full text-left px-3 py-2 text-sm hover-item text-body${unit === 'C' ? ' font-semibold' : ''}" data-unit="C">°C</button>
                <button class="w-full text-left px-3 py-2 text-sm hover-item text-body border-t border-edge${unit === 'F' ? ' font-semibold' : ''}" data-unit="F">°F</button>
              </div>
            </div>
            <div class="relative">
              <button id="lang-btn" class="text-sm px-3 py-1.5 rounded-lg border border-edge text-muted hover-btn flex items-center gap-1">${getLang().toUpperCase()} <span class="text-xs opacity-50">▾</span></button>
              ${langMenuHTML()}
            </div>
          </div>
        </div>

        <h1 class="text-xl font-semibold text-heading">${t('compare.title')}</h1>
        <p class="text-muted text-sm mb-4">${t('compare.subtitle')}</p>

        <div class="flex flex-wrap items-center gap-x-5 gap-y-3 mb-4">
          <div class="relative shrink-0">
            <button id="cmp-model-btn" class="text-sm px-3 py-1.5 rounded-lg border border-edge text-body hover-btn flex items-center gap-1">＋ ${t('compare.addModels')} <span class="text-xs opacity-50">▾</span></button>
            ${cmpModelMenuHTML()}
          </div>
          <div class="flex rounded-lg overflow-hidden border border-edge shrink-0">
            ${rangeBtn('2', 'compare.range2')}${rangeBtn('7', 'compare.range7')}${rangeBtn('all', 'compare.rangeAll')}
          </div>
          <div class="flex flex-wrap items-center gap-x-4 gap-y-1">${paramChecks}</div>
        </div>

        <div id="cmp-table"></div>

        <div class="flex items-center gap-4 mt-4 text-xs text-muted">
          <span>${t('weather.dataSource')} <a ${LINK} href="https://open-meteo.com/">Open-Meteo ↗</a></span>
          <button id="theme-btn" class="flex items-center gap-1.5 subtle-text"><span>${THEME_ICONS[theme]}</span><span>${themeLabel()}</span></button>
          <button id="hc-btn" class="flex items-center gap-1.5 subtle-text" aria-pressed="${highContrast}"><span>◑</span><span>${highContrast ? t('theme.easyReadOn') : t('theme.easyRead')}</span></button>
        </div>
      </div>
    </div>`;

  document.getElementById('cmp-back')!.addEventListener('click', () => void loadWeather(location));
  setupCmpModelMenu(location);
  setupDropdown('unit-btn', 'unit-menu', 'unit', (value) => {
    unit = value as 'C' | 'F';
    setCompareUrl(location);
    renderCompare(location);
  });
  setupDropdown('lang-btn', 'lang-menu', 'lang', (value) => {
    void setLang(value as Lang).then(rerenderCurrentView);
  });
  attachThemeHandler();
  attachHCHandler();

  document.querySelectorAll<HTMLButtonElement>('.cmp-range').forEach(btn => {
    btn.addEventListener('click', () => {
      const v = btn.dataset.range!;
      cmpRange = v === '7' ? 7 : v === 'all' ? 'all' : 2;
      document.querySelectorAll<HTMLButtonElement>('.cmp-range').forEach(b => {
        const on = b === btn;
        b.classList.toggle('bg-selected', on);
        b.classList.toggle('text-selected-text', on);
        b.classList.toggle('text-muted', !on);
        b.classList.toggle('hover-btn', !on);
      });
      setCompareUrl(location);
      void refreshCompareTable();
    });
  });
  document.querySelectorAll<HTMLInputElement>('.cmp-param-check').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) cmpParams.add(cb.dataset.param!); else cmpParams.delete(cb.dataset.param!);
      setCompareUrl(location);
      void refreshCompareTable();
    });
  });

  void refreshCompareTable();
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
  const uvPrimaryPeak   = uvPeakForDay(weather.air, isTomorrow ? 2 : 1);
  const uvSecondaryPeak = uvPeakForDay(weather.air, isTomorrow ? 1 : 0);
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

  const compMetrics: CompBarMetric[] = [];
  {
    const fmtT  = (v: number) => String(unit === 'F' ? Math.round(v * 9 / 5 + 32) : Math.round(v));
    const fmtMm = (v: number) => v.toFixed(1);
    const fmtN  = (v: number) => String(Math.round(v));
    const tUnit = unit === 'F' ? '°F' : '°C';
    const sign  = (d: number) => d >= 0 ? '+' : '−';
    // Returns a formatted diff label, or undefined when the relative difference is below 2%
    // or the numeric part rounds to zero (avoids "+0 km/h", "−0" etc.)
    const mkDiff = (diff: number, ref: number, formatted: string): string | undefined => {
      if (ref <= 0 || Math.abs(diff) / ref < 0.02) return undefined;
      if (parseFloat(formatted) === 0) return undefined;
      return sign(diff) + formatted;
    };

    // Shared y-axis scale for temp + apparentTemp so they're visually comparable
    const bothTemps = cardOn('temp') && cardOn('apparentTemp');
    const sharedTempMin = bothTemps ? Math.min(
      primary.tempMin, primary.apparentTempMin, secondary.tempMin, secondary.apparentTempMin,
    ) : undefined;
    const sharedTempMax = bothTemps ? Math.max(
      primary.tempMax, primary.apparentTempMax, secondary.tempMax, secondary.apparentTempMax,
    ) : undefined;

    if (cardOn('temp')) {
      const pV = primary.tempMean, sV = secondary.tempMean;
      const diff = pV - sV, ref = Math.max(Math.abs(pV), Math.abs(sV));
      const dNum = unit === 'F' ? String(Math.round(Math.abs(diff) * 9 / 5)) : String(Math.round(Math.abs(diff)));
      compMetrics.push({ id: 'temp', emoji: ICONS.temp,
        primaryVal: pV, secondaryVal: sV,
        primaryLabel: fmtT(pV), secondaryLabel: fmtT(sV), unit: tUnit,
        diffLabel: mkDiff(diff, ref, dNum + tUnit),
        primaryMin: primary.tempMin,     primaryMax: primary.tempMax,
        secondaryMin: secondary.tempMin, secondaryMax: secondary.tempMax,
        scaleMin: sharedTempMin, scaleMax: sharedTempMax });
    }
    if (cardOn('apparentTemp')) {
      const pV = primary.apparentTempMean, sV = secondary.apparentTempMean;
      const diff = pV - sV, ref = Math.max(Math.abs(pV), Math.abs(sV));
      const dNum = unit === 'F' ? String(Math.round(Math.abs(diff) * 9 / 5)) : String(Math.round(Math.abs(diff)));
      compMetrics.push({ id: 'apparentTemp', emoji: feelsIcon(primary.apparentTempMax),
        primaryVal: pV, secondaryVal: sV,
        primaryLabel: fmtT(pV), secondaryLabel: fmtT(sV), unit: tUnit,
        diffLabel: mkDiff(diff, ref, dNum + tUnit),
        primaryMin: primary.apparentTempMin,     primaryMax: primary.apparentTempMax,
        secondaryMin: secondary.apparentTempMin, secondaryMax: secondary.apparentTempMax,
        scaleMin: sharedTempMin, scaleMax: sharedTempMax });
    }
    if (cardOn('precip')) {
      const hasRain    = primary.rainSum > 0.1     || secondary.rainSum > 0.1;
      const hasShowers = primary.showersSum > 0.1  || secondary.showersSum > 0.1;
      const hasSnow    = primary.snowfallSum > 0.1 || secondary.snowfallSum > 0.1;
      const showLiquid = !hasSnow || hasRain || hasShowers;
      const pProb = primary.precipProbabilityMax, sProb = secondary.precipProbabilityMax;
      if (showLiquid) {
        const pR = primary.rainSum, sR = secondary.rainSum;
        const dR = pR - sR;
        compMetrics.push({ id: 'precip', emoji: ICONS.rain,
          primaryVal: pR, secondaryVal: sR, primaryLabel: fmtMm(pR), secondaryLabel: fmtMm(sR), unit: 'mm',
          diffLabel: mkDiff(dR, Math.max(pR, sR), Math.abs(dR).toFixed(1) + ' mm'),
          primaryProbability: pProb, secondaryProbability: sProb });
      }
      if (hasShowers) {
        const pS = primary.showersSum, sS = secondary.showersSum;
        const dS = pS - sS;
        compMetrics.push({ id: 'showers', emoji: ICONS.showers,
          primaryVal: pS, secondaryVal: sS, primaryLabel: fmtMm(pS), secondaryLabel: fmtMm(sS), unit: 'mm',
          diffLabel: mkDiff(dS, Math.max(pS, sS), Math.abs(dS).toFixed(1) + ' mm'),
          primaryProbability: pProb, secondaryProbability: sProb });
      }
      if (hasSnow) {
        const pSn = primary.snowfallSum, sSn = secondary.snowfallSum;
        const dSn = pSn - sSn;
        compMetrics.push({ id: 'snow', emoji: ICONS.snow,
          primaryVal: pSn, secondaryVal: sSn, primaryLabel: fmtMm(pSn), secondaryLabel: fmtMm(sSn), unit: 'cm',
          diffLabel: mkDiff(dSn, Math.max(pSn, sSn), Math.abs(dSn).toFixed(1) + ' cm'),
          primaryProbability: pProb, secondaryProbability: sProb });
      }
    }
    if (cardOn('precipHours')) {
      const pV = primary.precipHours, sV = secondary.precipHours;
      compMetrics.push({ id: 'precipHours', emoji: ICONS.rain,
        primaryVal: pV, secondaryVal: sV, primaryLabel: fmtN(pV), secondaryLabel: fmtN(sV), unit: 'h',
        diffLabel: mkDiff(pV - sV, 24, fmtN(Math.abs(pV - sV)) + ' h'),
        primaryFloatStart: 0, primaryFloatEnd: pV,
        secondaryFloatStart: 0, secondaryFloatEnd: sV,
      });
    }
    if (cardOn('wind') || cardOn('gusts')) {
      const sharedWindMax = Math.max(
        cardOn('wind')  ? Math.max(primary.windSpeedMax, secondary.windSpeedMax) : 0,
        cardOn('gusts') ? Math.max(primary.gustMax,      secondary.gustMax)      : 0,
      );
      if (cardOn('wind')) {
        const pV = primary.windSpeedMax, sV = secondary.windSpeedMax;
        compMetrics.push({ id: 'wind', emoji: ICONS.wind,
          primaryVal: pV, secondaryVal: sV, primaryLabel: fmtN(pV), secondaryLabel: fmtN(sV), unit: 'km/h',
          diffLabel: mkDiff(pV - sV, Math.max(pV, sV), fmtN(Math.abs(pV - sV)) + ' km/h'),
          scaleMax: sharedWindMax });
      }
      if (cardOn('gusts')) {
        const pV = primary.gustMax, sV = secondary.gustMax;
        compMetrics.push({ id: 'gusts', emoji: ICONS.wind,
          primaryVal: pV, secondaryVal: sV, primaryLabel: fmtN(pV), secondaryLabel: fmtN(sV), unit: 'km/h',
          diffLabel: mkDiff(pV - sV, Math.max(pV, sV), fmtN(Math.abs(pV - sV)) + ' km/h'),
          scaleMax: sharedWindMax });
      }
    }
    if (cardOn('humidity')) {
      const diff = primary.humidityMean - secondary.humidityMean;
      const ref  = Math.max(primary.humidityMax, secondary.humidityMax);
      compMetrics.push({ id: 'humidity', emoji: ICONS.humidity,
        primaryVal: primary.humidityMean, secondaryVal: secondary.humidityMean,
        primaryLabel: fmtN(primary.humidityMean), secondaryLabel: fmtN(secondary.humidityMean), unit: '%',
        diffLabel: mkDiff(diff, ref, fmtN(Math.abs(diff)) + '%'),
        primaryMin: primary.humidityMin,     primaryMax: primary.humidityMax,
        secondaryMin: secondary.humidityMin, secondaryMax: secondary.humidityMax,
      });
    }
    if (cardOn('visibility')) {
      const pMean = primary.visibilityMean, sMean = secondary.visibilityMean;
      const noData = pMean == null && sMean == null;
      const pMin = primary.visibilityMin ?? 0, pMax = primary.visibilityMax ?? 0;
      const sMin = secondary.visibilityMin ?? 0, sMax = secondary.visibilityMax ?? 0;
      const ref  = Math.max(pMax, sMax);
      const diff = (pMean ?? 0) - (sMean ?? 0);
      compMetrics.push({ id: 'visibility', emoji: ICONS.visibility,
        primaryVal: pMean ?? 0, secondaryVal: sMean ?? 0,
        primaryLabel: pMean != null ? fmtN(pMean) : '—', secondaryLabel: sMean != null ? fmtN(sMean) : '—', unit: 'km',
        diffLabel: noData ? undefined : mkDiff(diff, ref, Math.abs(diff).toFixed(1) + ' km'),
        primaryMin: pMin, primaryMax: pMax,
        secondaryMin: sMin, secondaryMax: sMax,
        noData,
      });
    }
    if (cardOn('cloud')) {
      const pV = primary.cloudMean, sV = secondary.cloudMean;
      compMetrics.push({ id: 'cloud', emoji: ICONS.cloud,
        primaryVal: pV, secondaryVal: sV, primaryLabel: fmtN(pV), secondaryLabel: fmtN(sV), unit: '%',
        diffLabel: mkDiff(pV - sV, Math.max(pV, sV), fmtN(Math.abs(pV - sV)) + '%') });
    }
    if (cardOn('pressure')) {
      const pV = primary.pressureMean, sV = secondary.pressureMean;
      const dP = pV - sV;
      compMetrics.push({ id: 'pressure', emoji: ICONS.pressure,
        primaryVal: pV, secondaryVal: sV, primaryLabel: fmtN(pV), secondaryLabel: fmtN(sV), unit: 'hPa',
        diffLabel: mkDiff(dP, Math.max(pV, sV), fmtN(Math.abs(dP)) + ' hPa') });
    }
    if (cardOn('daylight')) {
      const pD = primary.daylightDuration / 60, sD = secondary.daylightDuration / 60;
      const dL = pD - sD;
      const parseHours = (iso: string): number => {
        const m = iso.match(/T(\d{2}):(\d{2})/);
        return m ? +m[1] + +m[2] / 60 : 0;
      };
      compMetrics.push({ id: 'daylight', emoji: ICONS.daylight,
        primaryVal: pD, secondaryVal: sD, primaryLabel: fmtN(pD), secondaryLabel: fmtN(sD), unit: 'min',
        diffLabel: mkDiff(dL, Math.max(pD, sD), fmtN(Math.abs(dL)) + ' min'),
        primaryFloatStart:   parseHours(primary.sunrise),
        primaryFloatEnd:     parseHours(primary.sunset),
        secondaryFloatStart: parseHours(secondary.sunrise),
        secondaryFloatEnd:   parseHours(secondary.sunset),
      });
    }
    if (cardOn('sunshine')) {
      const pV = primary.sunshineDuration / 3600, sV = secondary.sunshineDuration / 3600;
      compMetrics.push({ id: 'sunshine', emoji: ICONS.sunshine,
        primaryVal: pV, secondaryVal: sV, primaryLabel: pV.toFixed(1), secondaryLabel: sV.toFixed(1), unit: 'h',
        diffLabel: mkDiff(pV - sV, 24, Math.abs(pV - sV).toFixed(1) + ' h'),
        primaryFloatStart: 0, primaryFloatEnd: pV,
        secondaryFloatStart: 0, secondaryFloatEnd: sV,
      });
    }
    if (cardOn('uv') && uvPrimaryPeak != null) {
      const sUV = uvSecondaryPeak ?? 0;
      const dU = uvPrimaryPeak - sUV;
      compMetrics.push({ id: 'uv', emoji: ICONS.uv,
        primaryVal: uvPrimaryPeak, secondaryVal: sUV,
        primaryLabel: fmtN(uvPrimaryPeak), secondaryLabel: fmtN(sUV), unit: '',
        diffLabel: mkDiff(dU, Math.max(uvPrimaryPeak, sUV), fmtN(Math.abs(dU))) });
    }
    // Reorder to match user's cardOrder. Sub-metrics (showers, snow) inherit precip's position.
    const orderIdx = new Map<string, number>(cardOrder.map((id, i) => [id, i]));
    const getOrder = (id: string) => orderIdx.get(id) ?? orderIdx.get('precip') ?? cardOrder.length;
    compMetrics.sort((a, b) => getOrder(a.id) - getOrder(b.id));
  }

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

        <div class="rounded-2xl p-4 bg-surface hc:border-2 border-edge overflow-hidden mb-3">
          <h1 class="sr-only">${compHeader}</h1>
          ${buildComparisonChart(compMetrics, primaryLabel, secondaryLabel)}
        </div>

        <div id="chart-slot"></div>
        <div id="air-chart-slot"></div>
        <div id="pollen-chart-slot"></div>

        <button id="cmp-open" class="w-full mt-3 py-2.5 rounded-xl border border-edge text-body hover-btn text-sm flex items-center justify-center gap-2">${t('compare.open')} →</button>

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
      <div class="relative w-full max-w-sm rounded-2xl p-6 shadow-2xl bg-surface hc:border-2 border-edge flex flex-col" style="max-height:85dvh">
        <button id="modal-close" class="absolute top-4 right-4 text-2xl leading-none transition-colors text-muted hover:text-body">&times;</button>
        <h2 id="modal-title" class="text-base font-semibold text-heading mb-3 pr-6 shrink-0"></h2>
        <div id="modal-body" class="text-sm text-detail flex flex-col gap-2 overflow-y-auto"></div>
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
  document.getElementById('cmp-open')?.addEventListener('click', () => {
    if (!cmpModels.length) cmpModels = [model]; // seed with the currently selected model
    renderCompare(location);
  });
  attachThemeHandler();
  attachHCHandler();
  attachDropdownHandlers();

  const modal = document.getElementById('info-modal')!;
  const modalTitle = document.getElementById('modal-title')!;
  const modalBody = document.getElementById('modal-body')!;
  const closeModal = () => modal.classList.add('hidden');

  document.getElementById('modal-close')!.addEventListener('click', closeModal);
  document.getElementById('modal-backdrop')!.addEventListener('click', closeModal);

  const openMetricModal = (metric: string): void => {
    const info = getMetricInfo(metric);
    modalTitle.textContent = info.title;
    modalBody.innerHTML = info.body;
    modal.classList.remove('hidden');
  };

  document.querySelectorAll<HTMLButtonElement>('.info-btn').forEach(btn => {
    btn.addEventListener('click', () => openMetricModal(btn.dataset.metric!));
  });

  document.getElementById('comp-info-btn')?.addEventListener('click', () => {
    const btn = document.getElementById('comp-info-btn') as HTMLButtonElement;
    const ids = (btn.dataset.metrics ?? '').split(',').filter(Boolean);
    const infos = ids.map(id => getMetricInfo(id));
    modalTitle.textContent = t('settings.cards');
    modalBody.innerHTML = infos.map((info, i) =>
      `${i > 0 ? '<hr style="border:none;border-top:1px solid var(--color-edge);margin:10px 0">' : ''}<p style="font-weight:600;margin-bottom:4px">${info.title}</p>${info.body}`
    ).join('');
    modal.classList.remove('hidden');
  });

  // The chart renders 1:1 at the slot's measured width and re-renders on
  // resize. The viewport shows the two compared days; the remaining forecast
  // days are reachable by scrolling right.
  const chartSlot = root.querySelector<HTMLElement>('#chart-slot')!;
  const airSlot = root.querySelector<HTMLElement>('#air-chart-slot')!;
  const pollenSlot = root.querySelector<HTMLElement>('#pollen-chart-slot')!;
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

    // Air-quality severity chart — hidden when toggled off or there's no data.
    const air = weather.air;
    const hasAir = !!air?.hourly && [air.hourly.no2, air.hourly.o3, air.hourly.so2, air.hourly.pm25, air.hourly.pm10].some(s => s.some(v => v != null));
    if (hasAir && airOn('airChart')) {
      const aVis = airChartVisibility();
      airSlot.style.display = '';
      airSlot.innerHTML = buildAirChart(timelineDays.slice(0, 7), air!.hourly, nowHours, innerWidth, aVis);
      const airContainer = airSlot.querySelector<HTMLElement>('#air-chart-container')!;
      setupAirChartTooltip(airContainer, timelineDays.slice(0, 7), air!.hourly, aVis);
      airContainer.querySelector<HTMLButtonElement>('.info-btn')?.addEventListener('click', () => openMetricModal('eaqi'));
      const airScrollEl = airSlot.querySelector<HTMLElement>('#air-tl-scroll')!;
      airScrollEl.scrollLeft = scrollDays * currentDayW;
      const airFadeRight = airSlot.querySelector<HTMLElement>('#air-fade-right');
      const syncAirFade = () => {
        if (airFadeRight) airFadeRight.style.opacity = airScrollEl.scrollLeft < airScrollEl.scrollWidth - airScrollEl.clientWidth - 1 ? '1' : '0';
      };
      syncAirFade();
      airScrollEl.addEventListener('scroll', syncAirFade, { passive: true });
    } else {
      airSlot.style.display = 'none';
      airSlot.innerHTML = '';
    }

    // Pollen severity chart — Europe/in-season only; hidden when toggled off or
    // there's no data.
    const pollen = air?.pollen;
    const hasPollen = !!pollen && Object.values(pollen).some(s => s.some((v: number | null) => v != null));
    if (hasPollen && pollenOn('pollenChart')) {
      const pVis = pollenChartVisibility();
      pollenSlot.style.display = '';
      pollenSlot.innerHTML = buildPollenChart(timelineDays.slice(0, 7), pollen!, nowHours, innerWidth, pVis);
      const pollenContainer = pollenSlot.querySelector<HTMLElement>('#pollen-chart-container')!;
      setupPollenChartTooltip(pollenContainer, timelineDays.slice(0, 7), pollen!, pVis);
      pollenContainer.querySelector<HTMLButtonElement>('.info-btn')?.addEventListener('click', () => openMetricModal('pollen'));
      const pollenScrollEl = pollenSlot.querySelector<HTMLElement>('#pollen-tl-scroll')!;
      pollenScrollEl.scrollLeft = scrollDays * currentDayW;
      const pollenFadeRight = pollenSlot.querySelector<HTMLElement>('#pollen-fade-right');
      const syncPollenFade = () => {
        if (pollenFadeRight) pollenFadeRight.style.opacity = pollenScrollEl.scrollLeft < pollenScrollEl.scrollWidth - pollenScrollEl.clientWidth - 1 ? '1' : '0';
      };
      syncPollenFade();
      pollenScrollEl.addEventListener('scroll', syncPollenFade, { passive: true });
    } else {
      pollenSlot.style.display = 'none';
      pollenSlot.innerHTML = '';
    }
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

  // Show the comparison chart scroll hint only when the SVG is actually wider
  // than its container (i.e. horizontal scrolling is possible).
  compScrollObserver?.disconnect();
  const compScrollEl = root.querySelector<HTMLElement>('#comp-chart-scroll');
  if (compScrollEl) {
    const fadeLeft  = document.getElementById('comp-fade-left');
    const fadeRight = document.getElementById('comp-fade-right');
    const syncCompFades = () => {
      const sl = compScrollEl.scrollLeft;
      const maxSl = compScrollEl.scrollWidth - compScrollEl.clientWidth;
      if (fadeLeft)  fadeLeft.style.opacity  = sl > 1        ? '1' : '0';
      if (fadeRight) fadeRight.style.opacity = sl < maxSl - 1 ? '1' : '0';
      const hint = compScrollEl.querySelector<SVGElement>('#comp-scroll-hint');
      if (hint) hint.style.display = maxSl > 1 ? '' : 'none';
    };
    syncCompFades();
    compScrollEl.addEventListener('scroll', syncCompFades, { passive: true });
    compScrollObserver = new ResizeObserver(syncCompFades);
    compScrollObserver.observe(compScrollEl);
  }
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
    // Air quality is best-effort (never rejects) and enriches, so it can't fail
    // the load; fetch it alongside the weather rather than serially after it.
    const [weather, air] = await Promise.all([
      fetchWeather(location.latitude, location.longitude, model),
      fetchAirQuality(location.latitude, location.longitude),
    ]);
    if (air?.uv) weather.hourlyAll.uvIndex = air.uv;
    renderWeather(location, { ...weather, air });
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
    const [weather, air] = await Promise.all([
      fetchWeather(latitude, longitude, model),
      fetchAirQuality(latitude, longitude),
    ]);
    if (air?.uv) weather.hourlyAll.uvIndex = air.uv;
    renderWeather(location, { ...weather, air });
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

// ─── Custom tooltip ───────────────────────────────────────────────────────────
// Replaces native `title` attribute (hover-only) with a positioned div that
// also responds to tap on touch devices. Any element with data-tooltip="text"
// gets the behaviour automatically via event delegation.

function initAppTooltip(): void {
  const tip = document.createElement('div');
  tip.id = 'app-tooltip';
  tip.style.cssText = [
    'position:fixed',
    'z-index:9999',
    'padding:4px 8px',
    'border-radius:6px',
    'font-size:11px',
    'pointer-events:none',
    'white-space:nowrap',
    'opacity:0',
    'transition:opacity 0.1s',
    'background:var(--tooltip-bg)',
    'color:var(--tooltip-text-main)',
    'border:1px solid var(--tooltip-border)',
    'box-shadow:0 2px 8px rgba(0,0,0,0.18)',
  ].join(';');
  document.body.appendChild(tip);

  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let currentText = '';

  const show = (text: string, anchor: Element) => {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    // Same label already visible — keep the tooltip exactly where it is
    if (text === currentText && tip.style.opacity === '1') return;
    currentText = text;
    tip.textContent = text;
    tip.style.opacity = '0';
    tip.style.display = 'block';
    const anchorId = (anchor as HTMLElement).dataset.tooltipAnchor;
    const posEl = anchorId ? (document.getElementById(anchorId) ?? anchor) : anchor;
    const r = posEl.getBoundingClientRect();
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = r.left + r.width / 2 - tw / 2;
    let y = r.top - th - 6;
    if (y < 4) y = r.bottom + 6;
    x = Math.max(6, Math.min(x, window.innerWidth - tw - 6));
    tip.style.left = `${x}px`;
    tip.style.top  = `${y}px`;
    tip.style.opacity = '1';
  };

  const hide = (delay = 0) => {
    const doHide = () => { tip.style.opacity = '0'; currentText = ''; };
    if (delay) {
      hideTimer = setTimeout(doHide, delay);
    } else {
      doHide();
    }
  };

  // Desktop: hover — use a tiny grace period on mouseout so crossing from
  // main emoji to badge (same label) doesn't cause a hide+reshow flicker
  document.addEventListener('mouseover', (e) => {
    const el = (e.target as Element).closest('[data-tooltip]');
    if (el) show((el as HTMLElement).dataset.tooltip!, el);
  });
  document.addEventListener('mouseout', (e) => {
    if ((e.target as Element).closest('[data-tooltip]')) hide(80);
  });

  // Touch: tap shows briefly then auto-hides
  document.addEventListener('touchend', (e) => {
    const el = (e.target as Element).closest('[data-tooltip]');
    if (!el) { hide(); return; }
    e.preventDefault();
    show((el as HTMLElement).dataset.tooltip!, el);
    hide(1800);
  }, { passive: false });
}

initAppTooltip();

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
  if (initialLocation && new URLSearchParams(window.location.search).get('view') === 'compare') {
    readCompareUrl();
    renderCompare(initialLocation);
  } else if (initialLocation) {
    void loadWeather(initialLocation);
  } else {
    renderSearch();
  }
})();
