import type { AirHourly } from './airquality';
import { timelineDayWidth, type TimelineDay } from './chart';
import { t } from './i18n';

// Severity timeline for the pollutants with hourly EAQI thresholds (NO₂, O₃,
// SO₂, PM2.5, PM10). Structurally a slimmer sibling of chart.ts's weather
// timeline: same time→x mapping, scroll container, now-marker, day labels and
// night shading, but a fixed 0–6 severity Y domain and no canvas/wind/dual-axis
// machinery.
//
// Each line traces the pollutant's real hourly concentration (µg/m³); its Y is
// the concentration remapped through the EAQI breakpoints (concToBand), so the
// curve keeps its true shape while its height reads as a severity band. (EAQI
// PM bands are formally 24-h means; we band raw hourly PM for parity with the
// gases, so a short spike may read one band high.)

const PL = 88; // left gutter holds the band labels ("Extremely poor" is the longest)
const PR = 16;
const PT = 8;
const H  = 220;
const PB = 30; // day-label row
const CH = H - PT - PB;

// d3 schemeObservable10 (first five), hardcoded and theme-independent like the
// weather chart's line colours — five clearly distinguishable categorical hues.
const LINE_COLORS = {
  no2:  '#4269d0', // blue
  o3:   '#efb118', // amber
  so2:  '#ff725c', // red
  pm25: '#6cc5b0', // teal
  pm10: '#3ca951', // green
} as const;
type Pollutant = keyof typeof LINE_COLORS;
const POLLUTANTS: Pollutant[] = ['no2', 'o3', 'so2', 'pm25', 'pm10'];
const FORMULA: Record<Pollutant, string> = { no2: 'NO₂', o3: 'O₃', so2: 'SO₂', pm25: 'PM2.5', pm10: 'PM10' };

export type AirChartVisibility = Partial<Record<Pollutant, boolean>>;
// Pollutants to draw, honouring per-line toggles (default: all shown).
const shownPollutants = (vis?: AirChartVisibility): Pollutant[] =>
  POLLUTANTS.filter(p => vis?.[p] ?? true);

const LBL_STYLE = `<style>.albl{font-size:calc(var(--chart-lbl-size)*0.66);fill:var(--chart-label);font-family:ui-sans-serif,system-ui,sans-serif}</style>`;

// EAQI hourly breakpoints (µg/m³): six [lo, hi] intervals per pollutant, one per
// band Good(0)…Extremely poor(5). The top band's hi pegs the open-ended worst band.
const BREAKS: Record<Pollutant, [number, number][]> = {
  no2:  [[0, 40], [40, 90], [90, 120], [120, 230], [230, 340], [340, 1000]],
  o3:   [[0, 50], [50, 100], [100, 130], [130, 240], [240, 380], [380, 800]],
  so2:  [[0, 100], [100, 200], [200, 350], [350, 500], [500, 750], [750, 1250]],
  pm25: [[0, 10], [10, 20], [20, 25], [25, 50], [50, 75], [75, 800]],
  pm10: [[0, 20], [20, 40], [40, 50], [50, 100], [100, 150], [150, 1200]],
};

// The six band words, indexed by band 0..5. comp.airGood..airPoor already exist;
// airVeryPoor/airExtremelyPoor are added for this chart.
const BAND_KEYS = [
  'comp.airGood', 'comp.airFair', 'comp.airModerate',
  'comp.airPoor', 'comp.airVeryPoor', 'comp.airExtremelyPoor',
] as const;

// Raw µg/m³ → continuous 0–6 band position (piecewise-linear across breakpoints).
function concToBand(conc: number, breaks: [number, number][]): number {
  for (let k = 0; k < breaks.length; k++) {
    const [lo, hi] = breaks[k];
    if (conc < hi) return k + (conc - lo) / (hi - lo);
  }
  return 6; // above the worst band's ceiling
}

const bandIndex = (band: number): number => Math.max(0, Math.min(5, Math.floor(band)));

function yB(band: number): number {
  return PT + CH - (Math.max(0, Math.min(6, band)) / 6) * CH;
}

// "2026-07-13T05:04" -> 5.07 fractional hours, or null if absent
function sunHour(iso: string): number | null {
  if (!iso || iso.length < 16) return null;
  return Number(iso.slice(11, 13)) + Number(iso.slice(14, 16)) / 60;
}

// How many whole days the air series and the passed day labels both cover.
function dayCount(days: TimelineDay[], hourly: AirHourly): number {
  const hoursBySeries = Math.floor(hourly.no2.length / 24);
  return Math.max(0, Math.min(days.length, hoursBySeries));
}

export function buildAirChart(
  days: TimelineDay[],
  hourly: AirHourly,
  nowHours: number | null,
  viewportWidth: number,
  vis?: AirChartVisibility,
): string {
  const shown = shownPollutants(vis);
  const nDays = dayCount(days, hourly);
  const n     = nDays * 24;
  const dayW  = timelineDayWidth(viewportWidth);
  const cw    = nDays * dayW;
  const w     = PL + cw + PR;
  const slotW = dayW / 24;

  const xH = (hr: number) => PL + hr * slotW;      // continuous hour position
  const xP = (i: number) => xH(i + 0.5);           // sample at slot center

  // A line breaks at null samples rather than bridging them.
  const linePath = (vals: (number | null)[], breaks: [number, number][]): string => {
    let d = '';
    let pen = false;
    for (let i = 0; i < n; i++) {
      const v = vals[i];
      if (v == null || !Number.isFinite(v)) { pen = false; continue; }
      const cmd = pen ? 'L' : 'M';
      d += `${cmd}${xP(i).toFixed(1)},${yB(concToBand(v, breaks)).toFixed(1)}`;
      pen = true;
    }
    return d;
  };

  // Band zones (faint EEA-palette fills) + separators between bands 1..5.
  const bandZones: string[] = [];
  const sep: string[] = [];
  const bandLabels: string[] = [];
  for (let k = 0; k < 6; k++) {
    const yTop = yB(k + 1);
    const yBot = yB(k);
    bandZones.push(`<rect x="${PL}" y="${yTop.toFixed(1)}" width="${cw.toFixed(1)}" height="${(yBot - yTop).toFixed(1)}" fill="var(--eaqi-band-${k})"/>`);
    if (k > 0) sep.push(`<line x1="${PL}" y1="${yBot.toFixed(1)}" x2="${(w - PR).toFixed(1)}" y2="${yBot.toFixed(1)}" stroke="var(--chart-grid)" stroke-width="1"/>`);
    bandLabels.push(`<text x="8" y="${((yTop + yBot) / 2 + 3.5).toFixed(1)}" text-anchor="start" class="albl">${t(BAND_KEYS[k])}</text>`);
  }

  // Night shading from each day's sunrise/sunset
  const nightRects: string[] = [];
  const shade = (fromH: number, toH: number) => {
    const x1 = xH(fromH), x2 = xH(toH);
    if (x2 - x1 < 1) return;
    nightRects.push(`<rect x="${x1.toFixed(1)}" y="${PT}" width="${(x2 - x1).toFixed(1)}" height="${CH}" fill="var(--night-shade)"/>`);
  };
  for (let di = 0; di < nDays; di++) {
    const rise = sunHour(days[di].sunrise);
    const set  = sunHour(days[di].sunset);
    if (rise === null || set === null) continue;
    shade(di * 24, di * 24 + rise);
    shade(di * 24 + set, di * 24 + 24);
  }

  // Day boundaries + labels
  const dayLines: string[] = [];
  const dayLabels: string[] = [];
  for (let d = 0; d < nDays; d++) {
    const x = xH(d * 24);
    if (d > 0) dayLines.push(`<line x1="${x.toFixed(1)}" y1="${PT}" x2="${x.toFixed(1)}" y2="${(PT + CH).toFixed(1)}" stroke="var(--chart-label)" stroke-width="1" opacity="0.2"/>`);
    dayLabels.push(`<text x="${(x + dayW / 2).toFixed(1)}" y="${(H - 10).toFixed(1)}" text-anchor="middle" class="albl" style="font-weight:600">${days[d].label}</text>`);
  }

  const nowMarker = nowHours !== null && nowHours >= 0 && nowHours <= n
    ? (() => {
        const x = xH(nowHours);
        return `<line x1="${x.toFixed(1)}" y1="${PT}" x2="${x.toFixed(1)}" y2="${(PT + CH).toFixed(1)}" stroke="var(--color-accent)" stroke-width="1.5" opacity="0.9"/>`
             + `<path d="M${(x - 4).toFixed(1)},${PT} L${(x + 4).toFixed(1)},${PT} L${x.toFixed(1)},${PT + 6} Z" fill="var(--color-accent)"/>`;
      })()
    : '';

  const lines = shown
    .map(p => `<path d="${linePath(hourly[p], BREAKS[p])}" fill="none" stroke="${LINE_COLORS[p]}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`)
    .join('');

  const hoverDots = shown
    .map(p => `<circle class="air-dot" data-p="${p}" r="3.5" cx="0" cy="0" fill="${LINE_COLORS[p]}" stroke-width="1.5" style="stroke:var(--dot-bg)"/>`)
    .join('');

  const legend = shown
    .map(p => `<span class="flex items-center gap-1.5" title="${t(`tooltip.${p}`)}"><span style="display:inline-block;width:18px;height:2px;background:${LINE_COLORS[p]}"></span>${FORMULA[p]}</span>`)
    .join('');

  return `
    <div id="air-chart-container" class="rounded-2xl relative bg-surface hc:border-2 border-edge overflow-hidden mt-3">
      <div class="flex items-center gap-2 px-5 pt-4">
        <h2 class="text-sm font-semibold text-heading">${t('air.chartTitle')}</h2>
        <button class="info-btn w-4 h-4 rounded-full text-[10px] font-bold border shrink-0 flex items-center justify-center transition-colors border-muted text-muted hover:border-accent hover:text-accent" data-metric="eaqi">i</button>
      </div>
      <div class="relative">
        <div id="air-tl-scroll" style="overflow-x:auto">
          <div style="position:relative;width:${w}px">
          <svg id="air-svg" viewBox="0 0 ${w} ${H}" style="display:block;width:${w}px;height:${H}px">
            ${LBL_STYLE}
            ${bandZones.join('')}
            ${nightRects.join('')}
            ${sep.join('')}
            ${dayLines.join('')}
            ${lines}
            ${nowMarker}
            ${dayLabels.join('')}
            <g id="air-hover" style="display:none">
              <line id="air-hover-line" x1="0" y1="${PT}" x2="0" y2="${PT + CH}" style="stroke:var(--hover-line);stroke-width:1;stroke-dasharray:3 3"/>
              ${hoverDots}
            </g>
            <rect id="air-overlay" x="${PL}" y="${PT}" width="${cw.toFixed(1)}" height="${CH}" fill="transparent" pointer-events="all" style="cursor:crosshair"/>
          </svg>
          </div>
        </div>
        <div style="position:absolute;top:0;left:0;width:${PL}px;height:${H}px;pointer-events:none;background:linear-gradient(to right, var(--color-surface) 86%, transparent)">
          <svg viewBox="0 0 ${PL} ${H}" width="${PL}" height="${H}" style="display:block;overflow:visible">${LBL_STYLE}${bandLabels.join('')}</svg>
        </div>
      </div>
      <div id="air-tooltip" class="rounded-xl px-3 py-2 shadow-lg" style="display:none;position:absolute;pointer-events:none;z-index:10;background-color:var(--tooltip-bg);border:1px solid var(--tooltip-border)"></div>
      <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted px-5 pt-2 pb-4">
        ${legend}
      </div>
    </div>
  `;
}

export function setupAirChartTooltip(
  container: HTMLElement,
  days: TimelineDay[],
  hourly: AirHourly,
  vis?: AirChartVisibility,
): void {
  const shown     = shownPollutants(vis);
  const svg       = container.querySelector<SVGSVGElement>('#air-svg')!;
  const overlay   = container.querySelector<SVGRectElement>('#air-overlay')!;
  const hoverG    = container.querySelector<SVGGElement>('#air-hover')!;
  const hoverLine = container.querySelector<SVGLineElement>('#air-hover-line')!;
  const dots      = Array.from(container.querySelectorAll<SVGCircleElement>('.air-dot'));
  const tooltip   = container.querySelector<HTMLElement>('#air-tooltip')!;

  const nDays = dayCount(days, hourly);
  const n     = nDays * 24;
  const cw    = svg.viewBox.baseVal.width - PL - PR;
  const slotW = cw / n;

  const fmt = (v: number | null): string =>
    v == null || !Number.isFinite(v) ? '–' : `${Math.round(v)} µg/m³`;

  const showAt = (clientX: number): void => {
    const svgRect = svg.getBoundingClientRect();
    const svgX = clientX - svgRect.left; // SVG is 1:1 (no viewBox scaling)
    const idx = Math.max(0, Math.min(n - 1, Math.floor((svgX - PL) / slotW)));
    const x = PL + (idx + 0.5) * slotW;

    hoverLine.setAttribute('x1', x.toFixed(1));
    hoverLine.setAttribute('x2', x.toFixed(1));
    shown.forEach((p, i) => {
      const v = hourly[p][idx];
      if (v == null || !Number.isFinite(v)) { dots[i].style.display = 'none'; return; }
      dots[i].style.display = '';
      dots[i].setAttribute('cx', x.toFixed(1));
      dots[i].setAttribute('cy', yB(concToBand(v, BREAKS[p])).toFixed(1));
    });
    hoverG.style.display = '';

    const dayLabel = days[Math.floor(idx / 24)]?.label ?? '';
    const hh = `${String(idx % 24).padStart(2, '0')}:00`;
    const rows = shown.map(p => {
      const v = hourly[p][idx];
      const band = v != null && Number.isFinite(v) ? t(BAND_KEYS[bandIndex(concToBand(v, BREAKS[p]))]) : '';
      return `
        <span style="color:${LINE_COLORS[p]}" title="${t(`tooltip.${p}`)}">${FORMULA[p]}</span>
        <span style="color:var(--tooltip-text-main)">${fmt(v)}${band ? ` · ${band}` : ''}</span>`;
    }).join('');

    tooltip.innerHTML = `
      <div style="font-weight:600;color:var(--tooltip-text-main);margin-bottom:4px;font-size:12px">${dayLabel}, ${hh}</div>
      <div style="display:grid;grid-template-columns:auto auto;gap:2px 10px;font-size:11px">${rows}</div>`;
    tooltip.style.display = 'block';

    const containerRect = container.getBoundingClientRect();
    const tipX = (svgRect.left - containerRect.left) + x;
    const tipW = tooltip.offsetWidth;
    tooltip.style.top  = '8px';
    tooltip.style.left = tipX + tipW + 14 > containerRect.width ? `${tipX - tipW - 8}px` : `${tipX + 12}px`;
  };

  const hide = (): void => { hoverG.style.display = 'none'; tooltip.style.display = 'none'; };
  overlay.addEventListener('mousemove', (e: MouseEvent) => showAt(e.clientX));
  overlay.addEventListener('mouseleave', hide);
  overlay.addEventListener('touchstart', (e: TouchEvent) => showAt(e.touches[0].clientX), { passive: true });
  overlay.addEventListener('touchmove',  (e: TouchEvent) => showAt(e.touches[0].clientX), { passive: true });
  overlay.addEventListener('touchend', hide);
  overlay.addEventListener('touchcancel', hide);
}
