import type { PollenHourly } from './airquality';
import { timelineDayWidth, type TimelineDay } from './chart';
import { t } from './i18n';

// Severity timeline for the six CAMS pollen taxa. A sibling of airchart.ts with
// the same time→x mapping, scroll container, now-marker, day labels and night
// shading, but a fixed 0–3 severity Y domain instead of 0–6.
//
// Each line traces a taxon's real hourly count (grains/m³); its Y is the count
// remapped through the EAACI clinical thresholds (concToBand), so the curve keeps
// its true shape while its height reads as a Low/Moderate/High band. Thresholds:
// Pfaar et al., EAACI position paper (Allergy 2017) — the same clinically-relevant
// levels SILAM/CAMS uses for the official ground-level pollen forecast.

const PL = 88; // left gutter for band labels
const PR = 16;
const PT = 8;
const H  = 200;
const PB = 30; // day-label row
const CH = H - PT - PB;
const NBANDS = 3;

const LINE_COLORS = {
  alder:   'var(--pollen-alder)',
  birch:   'var(--pollen-birch)',
  grass:   'var(--pollen-grass)',
  mugwort: 'var(--pollen-mugwort)',
  olive:   'var(--pollen-olive)',
  ragweed: 'var(--pollen-ragweed)',
} as const;
type Taxon = keyof typeof LINE_COLORS;
const TAXA: Taxon[] = ['alder', 'birch', 'grass', 'mugwort', 'olive', 'ragweed'];

const LBL_STYLE = `<style>.plbl{font-size:calc(var(--chart-lbl-size)*0.66);fill:var(--chart-label);font-family:ui-sans-serif,system-ui,sans-serif}</style>`;

// EAACI clinical thresholds (grains/m³): three [lo, hi] intervals per taxon, one
// per band Low(0) / Moderate/in-season(1) / High/peak(2). The open peak band gets
// a display-only ceiling so a line has somewhere to sit within it.
const TREE_LIKE: [number, number][] = [[0, 10], [10, 100], [100, 1000]]; // alder, birch, olive, mugwort
const HERB_LIKE: [number, number][] = [[0, 3],  [3, 50],   [50, 500]];   // grass, ragweed
const BREAKS: Record<Taxon, [number, number][]> = {
  alder: TREE_LIKE, birch: TREE_LIKE, olive: TREE_LIKE, mugwort: TREE_LIKE,
  grass: HERB_LIKE, ragweed: HERB_LIKE,
};

// The three band words, indexed by band 0..2.
const BAND_KEYS = ['comp.pollenLow', 'comp.pollenModerate', 'comp.pollenHigh'] as const;

export type PollenChartVisibility = Partial<Record<Taxon, boolean>>;
// Taxa to draw, honouring per-line toggles (default: all shown).
const shownTaxa = (vis?: PollenChartVisibility): Taxon[] =>
  TAXA.filter(tx => vis?.[tx] ?? true);

// Raw grains/m³ → continuous 0–NBANDS band position (piecewise-linear).
function concToBand(conc: number, breaks: [number, number][]): number {
  for (let k = 0; k < breaks.length; k++) {
    const [lo, hi] = breaks[k];
    if (conc < hi) return k + (conc - lo) / (hi - lo);
  }
  return NBANDS; // above the peak band's ceiling
}

const bandIndex = (band: number): number => Math.max(0, Math.min(NBANDS - 1, Math.floor(band)));

function yB(band: number): number {
  return PT + CH - (Math.max(0, Math.min(NBANDS, band)) / NBANDS) * CH;
}

// "2026-07-13T05:04" -> 5.07 fractional hours, or null if absent
function sunHour(iso: string): number | null {
  if (!iso || iso.length < 16) return null;
  return Number(iso.slice(11, 13)) + Number(iso.slice(14, 16)) / 60;
}

// Whole days covered, trimming trailing days that carry no pollen data at all
// (pollen has a shorter horizon than the ~7-day request, so later days are null).
function dayCount(days: TimelineDay[], pollen: PollenHourly): number {
  const len = TAXA.reduce((m, tx) => Math.max(m, pollen[tx].length), 0);
  const maxDays = Math.min(days.length, Math.floor(len / 24));
  let last = 0;
  for (let d = 0; d < maxDays; d++) {
    const has = TAXA.some(tx => {
      for (let i = d * 24; i < d * 24 + 24; i++) {
        const v = pollen[tx][i];
        if (v != null && Number.isFinite(v)) return true;
      }
      return false;
    });
    if (has) last = d + 1;
  }
  return last;
}

export function buildPollenChart(
  days: TimelineDay[],
  pollen: PollenHourly,
  nowHours: number | null,
  viewportWidth: number,
  vis?: PollenChartVisibility,
): string {
  const shown = shownTaxa(vis);
  const nDays = dayCount(days, pollen);
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

  // Band zones (faint tints) + separators between bands 1..NBANDS-1.
  const bandZones: string[] = [];
  const sep: string[] = [];
  const bandLabels: string[] = [];
  for (let k = 0; k < NBANDS; k++) {
    const yTop = yB(k + 1);
    const yBot = yB(k);
    bandZones.push(`<rect x="${PL}" y="${yTop.toFixed(1)}" width="${cw.toFixed(1)}" height="${(yBot - yTop).toFixed(1)}" fill="var(--pollen-band-${k})"/>`);
    if (k > 0) sep.push(`<line x1="${PL}" y1="${yBot.toFixed(1)}" x2="${(w - PR).toFixed(1)}" y2="${yBot.toFixed(1)}" stroke="var(--chart-grid)" stroke-width="1"/>`);
    bandLabels.push(`<text x="8" y="${((yTop + yBot) / 2 + 3.5).toFixed(1)}" text-anchor="start" class="plbl">${t(BAND_KEYS[k])}</text>`);
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
    dayLabels.push(`<text x="${(x + dayW / 2).toFixed(1)}" y="${(H - 10).toFixed(1)}" text-anchor="middle" class="plbl" style="font-weight:600">${days[d].label}</text>`);
  }

  const nowMarker = nowHours !== null && nowHours >= 0 && nowHours <= n
    ? (() => {
        const x = xH(nowHours);
        return `<line x1="${x.toFixed(1)}" y1="${PT}" x2="${x.toFixed(1)}" y2="${(PT + CH).toFixed(1)}" stroke="var(--color-accent)" stroke-width="1.5" opacity="0.9"/>`
             + `<path d="M${(x - 4).toFixed(1)},${PT} L${(x + 4).toFixed(1)},${PT} L${x.toFixed(1)},${PT + 6} Z" fill="var(--color-accent)"/>`;
      })()
    : '';

  const lines = shown
    .map(tx => `<path d="${linePath(pollen[tx], BREAKS[tx])}" fill="none" stroke="${LINE_COLORS[tx]}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`)
    .join('');

  const hoverDots = shown
    .map(tx => `<circle class="pollen-dot" data-p="${tx}" r="3.5" cx="0" cy="0" fill="${LINE_COLORS[tx]}" stroke-width="1.5" style="stroke:var(--dot-bg)"/>`)
    .join('');

  const legend = shown
    .map(tx => `<span class="flex items-center gap-1.5" title="${t(`tooltip.${tx}`)}"><span style="display:inline-block;width:18px;height:2px;background:${LINE_COLORS[tx]}"></span>${t(`metric.${tx}.title`)}</span>`)
    .join('');

  return `
    <div id="pollen-chart-container" class="rounded-2xl relative bg-surface hc:border-2 border-edge overflow-hidden mt-3">
      <div class="flex items-center gap-2 px-5 pt-4">
        <h2 class="text-sm font-semibold text-heading">${t('pollen.chartTitle')}</h2>
        <button class="info-btn w-4 h-4 rounded-full text-[10px] font-bold border shrink-0 flex items-center justify-center transition-colors border-muted text-muted hover:border-accent hover:text-accent" data-metric="pollen">i</button>
      </div>
      <div class="relative">
        <div id="pollen-tl-scroll" style="overflow-x:auto">
          <div style="position:relative;width:${w}px">
          <svg id="pollen-svg" viewBox="0 0 ${w} ${H}" style="display:block;width:${w}px;height:${H}px">
            ${LBL_STYLE}
            ${bandZones.join('')}
            ${nightRects.join('')}
            ${sep.join('')}
            ${dayLines.join('')}
            ${lines}
            ${nowMarker}
            ${dayLabels.join('')}
            <g id="pollen-hover" style="display:none">
              <line id="pollen-hover-line" x1="0" y1="${PT}" x2="0" y2="${PT + CH}" style="stroke:var(--hover-line);stroke-width:1;stroke-dasharray:3 3"/>
              ${hoverDots}
            </g>
            <rect id="pollen-overlay" x="${PL}" y="${PT}" width="${cw.toFixed(1)}" height="${CH}" fill="transparent" pointer-events="all" style="cursor:crosshair"/>
          </svg>
          </div>
        </div>
        <div style="position:absolute;top:0;left:0;width:${PL}px;height:${H}px;pointer-events:none;background:linear-gradient(to right, var(--color-surface) 86%, transparent)">
          <svg viewBox="0 0 ${PL} ${H}" width="${PL}" height="${H}" style="display:block;overflow:visible">${LBL_STYLE}${bandLabels.join('')}</svg>
        </div>
      </div>
      <div id="pollen-tooltip" class="rounded-xl px-3 py-2 shadow-lg" style="display:none;position:absolute;pointer-events:none;z-index:10;background-color:var(--tooltip-bg);border:1px solid var(--tooltip-border)"></div>
      <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted px-5 pt-2 pb-4">
        ${legend}
      </div>
    </div>
  `;
}

export function setupPollenChartTooltip(
  container: HTMLElement,
  days: TimelineDay[],
  pollen: PollenHourly,
  vis?: PollenChartVisibility,
): void {
  const shown     = shownTaxa(vis);
  const svg       = container.querySelector<SVGSVGElement>('#pollen-svg')!;
  const overlay   = container.querySelector<SVGRectElement>('#pollen-overlay')!;
  const hoverG    = container.querySelector<SVGGElement>('#pollen-hover')!;
  const hoverLine = container.querySelector<SVGLineElement>('#pollen-hover-line')!;
  const dots      = Array.from(container.querySelectorAll<SVGCircleElement>('.pollen-dot'));
  const tooltip   = container.querySelector<HTMLElement>('#pollen-tooltip')!;

  const nDays = dayCount(days, pollen);
  const n     = nDays * 24;
  const cw    = svg.viewBox.baseVal.width - PL - PR;
  const slotW = cw / n;

  const fmt = (v: number | null): string =>
    v == null || !Number.isFinite(v) ? '–' : `${Math.round(v)} grains/m³`;

  const showAt = (clientX: number): void => {
    const svgRect = svg.getBoundingClientRect();
    const svgX = clientX - svgRect.left; // SVG is 1:1 (no viewBox scaling)
    const idx = Math.max(0, Math.min(n - 1, Math.floor((svgX - PL) / slotW)));
    const x = PL + (idx + 0.5) * slotW;

    hoverLine.setAttribute('x1', x.toFixed(1));
    hoverLine.setAttribute('x2', x.toFixed(1));
    shown.forEach((tx, i) => {
      const v = pollen[tx][idx];
      if (v == null || !Number.isFinite(v)) { dots[i].style.display = 'none'; return; }
      dots[i].style.display = '';
      dots[i].setAttribute('cx', x.toFixed(1));
      dots[i].setAttribute('cy', yB(concToBand(v, BREAKS[tx])).toFixed(1));
    });
    hoverG.style.display = '';

    const dayLabel = days[Math.floor(idx / 24)]?.label ?? '';
    const hh = `${String(idx % 24).padStart(2, '0')}:00`;
    const rows = shown.map(tx => {
      const v = pollen[tx][idx];
      const band = v != null && Number.isFinite(v) ? t(BAND_KEYS[bandIndex(concToBand(v, BREAKS[tx]))]) : '';
      return `
        <span style="color:${LINE_COLORS[tx]}" title="${t(`tooltip.${tx}`)}">${t(`metric.${tx}.title`)}</span>
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
