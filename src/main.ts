import './style.css';
import { fetchWeather, WeatherNoDataError } from './weather';
import type { TimelineDayInfo } from './weather';
import { WEATHER_MODELS, MODEL_MAP, findModel, DEFAULT_MODEL } from './models';
import { searchCity } from './geocoding';
import { describeCode } from './wmo';
import { buildTimeline, setupTimelineTooltip, timelineDayWidth } from './chart';
import { t, setLang, getLang, getLocale, fmtNum, LANGS, type Lang } from './i18n';
import { ICONS } from './icons';
import type { DailyWeather, GeoResult, HourlyData } from './types';

const root = document.getElementById('app')!;
let unit: 'C' | 'F' = 'C';
let model = DEFAULT_MODEL;

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
    const groupBorder = first ? '' : ' border-t border-edge';
    html += `<div class="px-3 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-body opacity-50${groupBorder}">${groupLabels[group]}</div>`;
    for (const m of groupModels) {
      const active = model === m.id ? ' font-semibold' : '';
      html += `<button class="w-full text-left px-3 py-2 pointer-coarse:py-3 text-sm hover-item text-body border-t border-edge${active}" data-model="${m.id}"><div>${m.name}</div><div class="text-xs opacity-50">${m.provider} · ${m.coverage}</div></button>`;
    }
    first = false;
  }
  return `<div id="model-menu" class="absolute left-0 ${pos} rounded-xl shadow-lg z-20 hidden overflow-y-auto bg-surface border border-edge" style="min-width:300px;max-height:360px">${html}</div>`;
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let suggestions: GeoResult[] = [];
let chartResizeObserver: ResizeObserver | null = null;

// ─── Theme ────────────────────────────────────────────────────────────────────

type Theme = 'auto' | 'dark' | 'light';
type Comparison = 'yesterday-today' | 'today-tomorrow';
type WeatherData = { today: DailyWeather; yesterday: DailyWeather; tomorrow: DailyWeather; days: TimelineDayInfo[]; hourlyAll: HourlyData; utcOffsetSeconds: number };
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

function rerenderCurrentView(): void {
  if (currentView?.type === 'search') renderSearch();
  else if (currentView?.type === 'weather') renderWeather(currentView.location, currentView.weather);
}

function attachDropdownHandlers(): void {
  setupDropdown('lang-btn', 'lang-menu', 'lang', (value) => {
    void setLang(value as Lang).then(rerenderCurrentView);
  });
  setupDropdown('model-btn', 'model-menu', 'model', (value) => {
    model = value;
    if (currentView?.type === 'search') renderSearch();
    else if (currentView?.type === 'weather') void loadWeather(currentView.location);
  });
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
  const temp2 = (v: number, feels: number, strong = false) =>
    `<span class="${strong ? 'text-base font-semibold text-heading' : 'text-detail'}">${tempStr(v)}</span> <span class="text-xs text-muted" title="${t('tooltip.apparentTemp')}">(${tempStr(feels)})</span>`;

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
          ${row(t('card.high'), temp2(a.tempMax, a.apparentTempMax), temp2(b.tempMax, b.apparentTempMax))}
          ${row(t('card.avg'),  temp2(a.tempMean, a.apparentTempMean, true), temp2(b.tempMean, b.apparentTempMean, true))}
          ${row(t('card.low'),  temp2(a.tempMin, a.apparentTempMin), temp2(b.tempMin, b.apparentTempMin))}
          ${showLiquid ? row(icon(ICONS.rain, t('tooltip.precipitation')), mm(a.rainSum), mm(b.rainSum)) : ''}
          ${hasShowers ? row(icon(ICONS.showers, t('tooltip.showers')), mm(a.showersSum), mm(b.showersSum)) : ''}
          ${hasSnow ? row(icon(ICONS.snow, t('tooltip.snowfall')), cm(a.snowfallSum), cm(b.snowfallSum)) : ''}
          ${row(icon(ICONS.wind, t('tooltip.wind')),
            `<span class="text-detail">${Math.round(a.windSpeedMax)} km/h ${windDirLabel(a.windDirection)}</span>`,
            `<span class="text-detail">${Math.round(b.windSpeedMax)} km/h ${windDirLabel(b.windDirection)}</span>`)}
          ${row(icon(ICONS.pressure, t('tooltip.pressure')),
            `<span class="text-detail">${Math.round(a.pressureMean)} hPa</span>`,
            `<span class="text-detail">${Math.round(b.pressureMean)} hPa</span>`)}
          ${a.sunrise && b.sunrise ? row(icon(ICONS.daylight, t('tooltip.daylight')),
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
              ${modelMenuHTML()}
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
            ${comparisonRowHTML(ICONS.temp, 'temp', tempComparison(primary, secondary))}
            ${comparisonRowHTML(`<span title="${t('tooltip.apparentTemp')}">${ICONS.feels}</span>`, 'apparentTemp', tempComparison(primary, secondary, true))}
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
            ${comparisonRowHTML(`<span title="${t('tooltip.daylight')}">${ICONS.daylight}</span>`, 'daylight', daylightComparison(primary, secondary))}
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
  const mountChart = (): void => {
    const innerWidth = chartSlot.clientWidth - (highContrast ? 44 : 40); // card p-5 padding (+ hc border)
    // keep the scroll position (in days) across resize re-renders
    const prevScroll = chartSlot.querySelector<HTMLElement>('#tl-scroll');
    const scrollDays = prevScroll && currentDayW ? prevScroll.scrollLeft / currentDayW : (isTomorrow ? 1 : 0);
    chartSlot.innerHTML = buildTimeline(timelineDays, weather.hourlyAll, unit, innerWidth, nowHours);
    setupTimelineTooltip(chartSlot.querySelector<HTMLElement>('#chart-container')!, timelineDays, weather.hourlyAll, unit);
    currentDayW = timelineDayWidth(innerWidth);
    chartSlot.querySelector<HTMLElement>('#tl-scroll')!.scrollLeft = scrollDays * currentDayW;
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

function renderNoDataError(location: GeoResult): void {
  transition(() => doRenderNoDataError(location));
}

function doRenderNoDataError(location: GeoResult): void {
  const currentModel = findModel(model);

  root.innerHTML = `
    <div class="min-h-screen flex items-center justify-center p-4">
      <div class="text-center max-w-sm w-full">
        <div class="text-4xl mb-4">📡</div>
        <h2 class="text-xl font-semibold text-heading mb-2">${t('error.noDataTitle')}</h2>
        <p class="text-muted text-sm mb-6">${t('error.noDataBody', { model: currentModel.name, location: location.name })}</p>
        <div class="relative inline-block mb-3">
          <button id="model-btn" class="text-sm px-4 py-2 rounded-xl border border-edge text-muted hover-btn flex items-center gap-1.5">
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

  setupDropdown('model-btn', 'model-menu', 'model', (value) => {
    model = value;
    void loadWeather(location);
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
    const { latitude, longitude } = pos.coords;
    const location: GeoResult = {
      name: coordsLabel(latitude, longitude),
      country: '',
      latitude,
      longitude,
    };
    const weather = await fetchWeather(latitude, longitude, model);
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
