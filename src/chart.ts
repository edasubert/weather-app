import type { HourlyData } from './types';
import { t } from './i18n';
import { ICONS } from './icons';

const W = 600;
const H = 200;
const PL = 52;
const PR = 52;
const PT = 12;
const PB = 28;
const CW = W - PL - PR;
const CH = H - PT - PB;

const OL_DAYS  = 14;
const OL_DAY_W = 150;
const OL_W     = PL + OL_DAYS * OL_DAY_W + PR;
const OL_H     = 220;
const OL_PB    = 44;
const OL_CH    = OL_H - PT - OL_PB;
const OL_CW    = OL_DAYS * OL_DAY_W;
const OL_N     = OL_DAYS * 24;

// Per-metric colors — shared between primary and secondary day
const TEMP_COLOR     = '#ef4444';         // red
const FEELS_COLOR    = '#eab308';         // yellow
const PRECIP_COLOR   = '#38bdf8';         // sky
const SNOW_COLOR     = 'var(--snow-color)'; // black (light) / white (dark)
const PRESSURE_COLOR = '#a78bfa';         // violet
const CLOUD_COLOR    = 'var(--chart-label)'; // adapts to theme

function xPos(hour: number): number {
  return PL + (hour / 23) * CW;
}

function yPos(val: number, min: number, max: number): number {
  return PT + CH - ((val - min) / (max - min || 1)) * CH;
}

function cloudPath(clouds: number[]): string {
  const n = clouds.length;
  const pts = clouds.map((c, i) => `L${xPos(i).toFixed(1)},${(PT + (c / 100) * CH).toFixed(1)}`).join('');
  return `M${xPos(0).toFixed(1)},${PT}${pts}L${xPos(n - 1).toFixed(1)},${PT}Z`;
}

function linePath(vals: number[], min: number, max: number): string {
  return vals
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${xPos(i).toFixed(1)},${yPos(v, min, max).toFixed(1)}`)
    .join(' ');
}

function precipBars(precips: number[], maxPrecip: number, maxBarH: number, color: string, xOffset: number, outlined: boolean, bw: number): string {
  return precips.map((p, i) => {
    const h = (p / maxPrecip) * maxBarH;
    if (h < 0.5) return '';
    const bx = xPos(i) + xOffset - bw / 2;
    const by = PT + CH - h;
    const attrs = outlined
      ? `fill="none" stroke-width="1.5" style="stroke:${color}"`
      : `style="fill:${color}"`;
    return `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" ${attrs} rx="1"/>`;
  }).join('');
}

function computeRange(today: HourlyData, yesterday: HourlyData, unit: 'C' | 'F') {
  const cvt = (c: number) => unit === 'F' ? c * 9 / 5 + 32 : c;
  const allT = [
    ...today.temp, ...yesterday.temp,
    ...today.apparentTemp, ...yesterday.apparentTemp,
  ].map(cvt);
  const rawMin = Math.min(...allT);
  const rawMax = Math.max(...allT);
  const pad = Math.max((rawMax - rawMin) * 0.15, 2);

  const allP = [...today.pressure, ...yesterday.pressure];
  const rawMinP = Math.min(...allP);
  const rawMaxP = Math.max(...allP);
  const padP = Math.max((rawMaxP - rawMinP) * 0.2, 3);

  return {
    cvt,
    minT: rawMin - pad,
    maxT: rawMax + pad,
    maxRain: Math.max(...today.rain, ...yesterday.rain, 0.1),
    maxSnow: Math.max(...today.snow, ...yesterday.snow, 0.01),
    minPressure: rawMinP - padP,
    maxPressure: rawMaxP + padP,
  };
}

export function buildChart(today: HourlyData, yesterday: HourlyData, unit: 'C' | 'F', label1 = 'Today', label2 = 'Yesterday'): string {
  const { cvt, minT, maxT, maxRain, maxSnow, minPressure, maxPressure } = computeRange(today, yesterday, unit);
  const tT = today.temp.map(cvt);
  const tY = yesterday.temp.map(cvt);
  const aT = today.apparentTemp.map(cvt);
  const aY = yesterday.apparentTemp.map(cvt);
  const pT = today.pressure;
  const pY = yesterday.pressure;

  const hasAnyRain = today.rain.some(v => v > 0.05) || yesterday.rain.some(v => v > 0.05);
  const hasAnySnow = today.snow.some(v => v > 0.05) || yesterday.snow.some(v => v > 0.05);
  const showBoth   = hasAnyRain && hasAnySnow;
  const slot = CW / 24;
  const rainBW     = showBoth ? slot * 0.18 : slot * 0.32;
  const rainOffset = showBoth ? slot * 0.10 : slot * 0.18;
  const snowBW     = showBoth ? slot * 0.18 : slot * 0.32;
  const snowOffset = showBoth ? slot * 0.30 : slot * 0.18;

  const maxBarH = CH * 0.25;

  const tempRange = maxT - minT;
  const step = tempRange > 20 ? 10 : tempRange > 10 ? 5 : 2;
  const grid = [];
  for (let v = Math.ceil(minT / step) * step; v < maxT; v += step) {
    const y = yPos(v, minT, maxT);
    grid.push(`
      <line x1="${PL}" y1="${y.toFixed(1)}" x2="${W - PR}" y2="${y.toFixed(1)}" stroke="var(--chart-grid)" stroke-width="1"/>
      <text x="${(PL - 5).toFixed(1)}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" class="lbl">${Math.round(v)}°${unit}</text>
    `);
  }

  const pressureRange = maxPressure - minPressure;
  const pStep = pressureRange > 20 ? 10 : pressureRange > 10 ? 5 : 2;
  const pressureLabels = [];
  for (let p = Math.ceil(minPressure / pStep) * pStep; p < maxPressure; p += pStep) {
    const y = yPos(p, minPressure, maxPressure);
    pressureLabels.push(`<text x="${(W - PR + 6).toFixed(1)}" y="${(y + 3.5).toFixed(1)}" text-anchor="start" class="lbl">${Math.round(p)}</text>`);
  }

  const xLabels = [0, 6, 12, 18].map(h =>
    `<text x="${xPos(h).toFixed(1)}" y="${H - 4}" text-anchor="middle" class="lbl">${String(h).padStart(2, '0')}:00</text>`
  ).join('');

  const dash = '4 4';

  return `
    <div id="chart-container" class="rounded-2xl p-5 relative" style="background-color:var(--card-bg);border:var(--card-border)">
      <svg viewBox="0 0 ${W} ${H}" class="w-full" style="overflow:visible">
        <defs>
          <pattern id="cloud-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="3" height="6" fill="var(--chart-label)" fill-opacity="0.40"/>
          </pattern>
        </defs>
        <style>.lbl{font-size:var(--chart-lbl-size);fill:var(--chart-label);font-family:ui-sans-serif,system-ui,sans-serif}</style>
        ${grid.join('')}
        <path d="${cloudPath(yesterday.cloud)}" fill="url(#cloud-hatch)"/>
        <path d="${cloudPath(today.cloud)}"     fill="${CLOUD_COLOR}" fill-opacity="0.20"/>
        ${hasAnyRain ? precipBars(yesterday.rain, maxRain, maxBarH, PRECIP_COLOR, -rainOffset, true,  rainBW) : ''}
        ${hasAnyRain ? precipBars(today.rain,     maxRain, maxBarH, PRECIP_COLOR,  rainOffset, false, rainBW) : ''}
        ${hasAnySnow ? precipBars(yesterday.snow, maxSnow, maxBarH, SNOW_COLOR,   -snowOffset, true,  snowBW) : ''}
        ${hasAnySnow ? precipBars(today.snow,     maxSnow, maxBarH, SNOW_COLOR,    snowOffset, false, snowBW) : ''}
        <path d="${linePath(tY, minT, maxT)}"               fill="none" stroke="${TEMP_COLOR}"     stroke-width="1.5" stroke-dasharray="${dash}" stroke-linejoin="round" stroke-linecap="round"/>
        <path d="${linePath(aY, minT, maxT)}"               fill="none" stroke="${FEELS_COLOR}"    stroke-width="1.5" stroke-dasharray="${dash}" stroke-linejoin="round" stroke-linecap="round"/>
        <path d="${linePath(pY, minPressure, maxPressure)}" fill="none" stroke="${PRESSURE_COLOR}" stroke-width="1.5" stroke-dasharray="${dash}" stroke-linejoin="round" stroke-linecap="round"/>
        <path d="${linePath(tT, minT, maxT)}"               fill="none" stroke="${TEMP_COLOR}"     stroke-width="2"   stroke-linejoin="round" stroke-linecap="round"/>
        <path d="${linePath(aT, minT, maxT)}"               fill="none" stroke="${FEELS_COLOR}"    stroke-width="2"   stroke-linejoin="round" stroke-linecap="round"/>
        <path d="${linePath(pT, minPressure, maxPressure)}" fill="none" stroke="${PRESSURE_COLOR}" stroke-width="2"   stroke-linejoin="round" stroke-linecap="round"/>
        ${pressureLabels.join('')}
        ${xLabels}
        <g id="chart-hover" style="display:none">
          <line id="hover-line" x1="0" y1="${PT}" x2="0" y2="${PT + CH}" style="stroke:var(--hover-line);stroke-width:1;stroke-dasharray:3 3"/>
          <circle class="hover-dot" r="3.5" cx="0" cy="0" fill="${TEMP_COLOR}"     stroke-width="1.5" style="stroke:var(--dot-bg)"/>
          <circle class="hover-dot" r="3.5" cx="0" cy="0" fill="${FEELS_COLOR}"    stroke-width="1.5" style="stroke:var(--dot-bg)"/>
          <circle class="hover-dot" r="3.5" cx="0" cy="0" fill="${PRESSURE_COLOR}" stroke-width="1.5" style="stroke:var(--dot-bg)"/>
          <circle class="hover-dot" r="3"   cx="0" cy="0" fill="${TEMP_COLOR}"     stroke-width="1.5" style="stroke:var(--dot-bg)"/>
          <circle class="hover-dot" r="3"   cx="0" cy="0" fill="${FEELS_COLOR}"    stroke-width="1.5" style="stroke:var(--dot-bg)"/>
          <circle class="hover-dot" r="3"   cx="0" cy="0" fill="${PRESSURE_COLOR}" stroke-width="1.5" style="stroke:var(--dot-bg)"/>
        </g>
        <rect id="chart-overlay" x="${PL}" y="${PT}" width="${CW}" height="${CH}" fill="transparent" pointer-events="all" style="cursor:crosshair"/>
      </svg>
      <div id="chart-tooltip" class="rounded-xl px-3 py-2 shadow-lg" style="display:none;position:absolute;pointer-events:none;z-index:10;background-color:var(--tooltip-bg);border:1px solid var(--tooltip-border)"></div>
      <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400 hc:text-black dark-hc:text-white mt-3">
        <span class="flex items-center gap-1.5">
          <span style="display:inline-block;width:18px;height:2px;background:${TEMP_COLOR};vertical-align:middle"></span>${ICONS.temp} ${label1}
        </span>
        <span class="flex items-center gap-1.5">
          <svg width="18" height="4" style="vertical-align:middle"><line x1="0" y1="2" x2="18" y2="2" stroke="${TEMP_COLOR}" stroke-width="1.5" stroke-dasharray="${dash}"/></svg>${ICONS.temp} ${label2}
        </span>
        <span class="flex items-center gap-1.5">
          <span style="display:inline-block;width:18px;height:2px;background:${FEELS_COLOR};vertical-align:middle"></span><span title="${t('tooltip.apparentTemp')}">${ICONS.feels}</span> ${label1}
        </span>
        <span class="flex items-center gap-1.5">
          <svg width="18" height="4" style="vertical-align:middle"><line x1="0" y1="2" x2="18" y2="2" stroke="${FEELS_COLOR}" stroke-width="1.5" stroke-dasharray="${dash}"/></svg><span title="${t('tooltip.apparentTemp')}">${ICONS.feels}</span> ${label2}
        </span>
        ${hasAnyRain ? `
        <span class="flex items-center gap-1.5">
          <span style="display:inline-block;width:10px;height:10px;background:${PRECIP_COLOR};border-radius:2px;vertical-align:middle"></span><span title="${t('tooltip.precipitation')}">${ICONS.rain}</span> ${label1}
        </span>
        <span class="flex items-center gap-1.5">
          <svg width="10" height="10" style="vertical-align:middle"><rect x="0.75" y="0.75" width="8.5" height="8.5" fill="none" stroke="${PRECIP_COLOR}" stroke-width="1.5" rx="1"/></svg><span title="${t('tooltip.precipitation')}">${ICONS.rain}</span> ${label2}
        </span>` : ''}
        ${hasAnySnow ? `
        <span class="flex items-center gap-1.5">
          <span style="display:inline-block;width:10px;height:10px;background:var(--snow-color);border-radius:2px;vertical-align:middle"></span><span title="${t('tooltip.snowfall')}">${ICONS.snow}</span> ${label1}
        </span>
        <span class="flex items-center gap-1.5">
          <svg width="10" height="10" style="vertical-align:middle"><rect x="0.75" y="0.75" width="8.5" height="8.5" fill="none" stroke-width="1.5" rx="1" style="stroke:var(--snow-color)"/></svg><span title="${t('tooltip.snowfall')}">${ICONS.snow}</span> ${label2}
        </span>` : ''}
        <span class="flex items-center gap-1.5">
          <span style="display:inline-block;width:18px;height:2px;background:${PRESSURE_COLOR};vertical-align:middle"></span><span title="${t('tooltip.pressure')}">${ICONS.pressure}</span> ${label1}
        </span>
        <span class="flex items-center gap-1.5">
          <svg width="18" height="4" style="vertical-align:middle"><line x1="0" y1="2" x2="18" y2="2" stroke="${PRESSURE_COLOR}" stroke-width="1.5" stroke-dasharray="${dash}"/></svg><span title="${t('tooltip.pressure')}">${ICONS.pressure}</span> ${label2}
        </span>
        <span class="flex items-center gap-1.5">
          <span style="display:inline-block;width:14px;height:10px;background:var(--chart-label);opacity:0.28;border-radius:2px;vertical-align:middle"></span><span title="${t('tooltip.cloudCover')}">${ICONS.cloud}</span> ${label1}
        </span>
        <span class="flex items-center gap-1.5">
          <svg width="14" height="10" style="vertical-align:middle;border-radius:2px;overflow:hidden"><defs><pattern id="cl-leg" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="3" height="6" fill="var(--chart-label)" fill-opacity="0.50"/></pattern></defs><rect width="14" height="10" fill="url(#cl-leg)"/></svg><span title="${t('tooltip.cloudCover')}">${ICONS.cloud}</span> ${label2}
        </span>
      </div>
    </div>
  `;
}

export function setupChartTooltip(
  container: HTMLElement,
  today: HourlyData,
  yesterday: HourlyData,
  unit: 'C' | 'F',
  label1 = 'Today',
  label2 = 'Yest.',
): void {
  const svg        = container.querySelector('svg')!;
  const overlay    = container.querySelector<SVGRectElement>('#chart-overlay')!;
  const hoverGroup = container.querySelector<SVGGElement>('#chart-hover')!;
  const hoverLine  = container.querySelector<SVGLineElement>('#hover-line')!;
  const dots       = Array.from(container.querySelectorAll<SVGCircleElement>('.hover-dot'));
  const tooltip    = container.querySelector<HTMLElement>('#chart-tooltip')!;

  const { cvt, minT, maxT, minPressure, maxPressure } = computeRange(today, yesterday, unit);
  const hasAnyRain = today.rain.some(v => v > 0.05) || yesterday.rain.some(v => v > 0.05);
  const hasAnySnow = today.snow.some(v => v > 0.05) || yesterday.snow.some(v => v > 0.05);
  const tT = today.temp.map(cvt);
  const tY = yesterday.temp.map(cvt);
  const aT = today.apparentTemp.map(cvt);
  const aY = yesterday.apparentTemp.map(cvt);
  const pT = today.pressure;
  const pY = yesterday.pressure;

  // Dot order: today temp, today feels, today pressure, yesterday temp, yesterday feels, yesterday pressure
  const dotDefs = [
    { vals: tT, color: TEMP_COLOR,     min: minT,        max: maxT        },
    { vals: aT, color: FEELS_COLOR,    min: minT,        max: maxT        },
    { vals: pT, color: PRESSURE_COLOR, min: minPressure, max: maxPressure },
    { vals: tY, color: TEMP_COLOR,     min: minT,        max: maxT        },
    { vals: aY, color: FEELS_COLOR,    min: minT,        max: maxT        },
    { vals: pY, color: PRESSURE_COLOR, min: minPressure, max: maxPressure },
  ];

  const showAt = (clientX: number): void => {
    const svgRect = svg.getBoundingClientRect();
    const svgX = (clientX - svgRect.left) / svgRect.width * W;
    const hour = Math.max(0, Math.min(23, Math.round((svgX - PL) / CW * 23)));
    const x = xPos(hour);

    hoverLine.setAttribute('x1', x.toFixed(1));
    hoverLine.setAttribute('x2', x.toFixed(1));

    dotDefs.forEach(({ vals, color, min, max }, i) => {
      dots[i].setAttribute('cx', x.toFixed(1));
      dots[i].setAttribute('cy', yPos(vals[hour], min, max).toFixed(1));
      dots[i].setAttribute('fill', color);
    });

    hoverGroup.style.display = '';

    const hh = `${String(hour).padStart(2, '0')}:00`;
    const fmt = (v: number) => `${Math.round(v)}°${unit}`;
    const rainFmt = (p: number) => p < 0.05 ? '–' : `${p.toFixed(1)} mm`;
    const snowFmt = (s: number) => s < 0.05 ? '–' : `${s.toFixed(1)} cm`;

    tooltip.innerHTML = `
      <div style="font-weight:600;color:var(--tooltip-text-main);margin-bottom:6px;font-size:12px">${hh}</div>
      <div style="display:grid;grid-template-columns:auto auto auto;gap:2px 10px;font-size:11px">
        <span style="color:var(--tooltip-text-sub)"></span>
        <span style="color:var(--tooltip-text-sub)">${label1}</span>
        <span style="color:var(--tooltip-text-sub)">${label2}</span>
        <span style="color:${TEMP_COLOR}" title="${t('tooltip.temperature')}">${ICONS.temp}</span>
        <span style="color:var(--tooltip-text-main)">${fmt(tT[hour])}</span>
        <span style="color:var(--tooltip-text-main)">${fmt(tY[hour])}</span>
        <span style="color:${FEELS_COLOR}" title="${t('tooltip.apparentTemp')}">${ICONS.feels}</span>
        <span style="color:var(--tooltip-text-main)">${fmt(aT[hour])}</span>
        <span style="color:var(--tooltip-text-main)">${fmt(aY[hour])}</span>
        ${hasAnyRain ? `
        <span style="color:${PRECIP_COLOR}" title="${t('tooltip.precipitation')}">${ICONS.rain}</span>
        <span style="color:var(--tooltip-text-main)">${rainFmt(today.rain[hour])}</span>
        <span style="color:var(--tooltip-text-main)">${rainFmt(yesterday.rain[hour])}</span>` : ''}
        ${hasAnySnow ? `
        <span style="color:var(--snow-color)" title="${t('tooltip.snowfall')}">${ICONS.snow}</span>
        <span style="color:var(--tooltip-text-main)">${snowFmt(today.snow[hour])}</span>
        <span style="color:var(--tooltip-text-main)">${snowFmt(yesterday.snow[hour])}</span>` : ''}
        <span style="color:${PRESSURE_COLOR}" title="${t('tooltip.pressure')}">${ICONS.pressure}</span>
        <span style="color:var(--tooltip-text-main)">${Math.round(pT[hour])} hPa</span>
        <span style="color:var(--tooltip-text-main)">${Math.round(pY[hour])} hPa</span>
        <span style="color:var(--tooltip-text-sub)" title="${t('tooltip.cloudCover')}">${ICONS.cloud}</span>
        <span style="color:var(--tooltip-text-main)">${today.cloud[hour]}%</span>
        <span style="color:var(--tooltip-text-main)">${yesterday.cloud[hour]}%</span>
      </div>
    `;

    tooltip.style.display = 'block';

    const containerRect = container.getBoundingClientRect();
    const scale = svgRect.width / W;
    const tipX = (svgRect.left - containerRect.left) + x * scale;
    const tipY = (svgRect.top - containerRect.top) + 8;
    const tipW = tooltip.offsetWidth;

    tooltip.style.top  = `${tipY}px`;
    tooltip.style.left = tipX + tipW + 14 > containerRect.width
      ? `${tipX - tipW - 8}px`
      : `${tipX + 12}px`;
  };

  attachPointerHandlers(overlay, showAt, () => {
    hoverGroup.style.display = 'none';
    tooltip.style.display = 'none';
  });
}

// Hover on mouse devices; scrub-while-touching on touch devices. Touch
// listeners stay passive so they never block page scrolling or panning.
function attachPointerHandlers(overlay: SVGRectElement, showAt: (clientX: number) => void, hide: () => void): void {
  overlay.addEventListener('mousemove', (e: MouseEvent) => showAt(e.clientX));
  overlay.addEventListener('mouseleave', hide);
  overlay.addEventListener('touchstart', (e: TouchEvent) => showAt(e.touches[0].clientX), { passive: true });
  overlay.addEventListener('touchmove',  (e: TouchEvent) => showAt(e.touches[0].clientX), { passive: true });
  overlay.addEventListener('touchend', hide);
  overlay.addEventListener('touchcancel', hide);
}

// ─── Outlook chart helpers ────────────────────────────────────────────────────


function yOl(val: number, min: number, max: number): number {
  return PT + OL_CH - (val - min) / (max - min || 1) * OL_CH;
}


function computeOutlookRange(hourly: HourlyData, unit: 'C' | 'F') {
  const cvt = (c: number) => unit === 'F' ? c * 9 / 5 + 32 : c;
  const allT = [...hourly.temp, ...hourly.apparentTemp].map(cvt);
  const rawMin = Math.min(...allT);
  const rawMax = Math.max(...allT);
  const pad = Math.max((rawMax - rawMin) * 0.15, 2);

  const allP = hourly.pressure;
  const rawMinP = Math.min(...allP);
  const rawMaxP = Math.max(...allP);
  const padP = Math.max((rawMaxP - rawMinP) * 0.2, 3);

  return {
    cvt,
    minT: rawMin - pad,
    maxT: rawMax + pad,
    maxRain: Math.max(...hourly.rain, 0.1),
    maxSnow: Math.max(...hourly.snow, 0.01),
    minP: rawMinP - padP,
    maxP: rawMaxP + padP,
  };
}

// ─── Outlook chart (14-day) ───────────────────────────────────────────────────

// Generates the replaceable SVG content at the given zoom level.
// zoom=1 → OL_CW wide; zoom=2 → 2× wider x axis, same y scale, same stroke widths.
type OlRange = ReturnType<typeof computeOutlookRange>;

function olContent(
  hourly: HourlyData, dates: string[], locale: string,
  zoom: number, range: OlRange,
): string {
  const { cvt, minT, maxT, maxRain, maxSnow, minP, maxP } = range;
  const cw    = OL_CW * zoom;            // zoomed chart width (x axis only)
  const totalW = OL_W * zoom;            // full SVG width at this zoom

  const xZ = (i: number) => PL + (i / (OL_N - 1)) * cw;

  const temps = hourly.temp.map(cvt);
  const feels = hourly.apparentTemp.map(cvt);
  const press = hourly.pressure;
  const hasAnyRain = hourly.rain.some(v => v > 0.05);
  const hasAnySnow = hourly.snow.some(v => v > 0.05);
  const showBoth = hasAnyRain && hasAnySnow;
  const slot = cw / OL_N;
  const bw   = showBoth ? slot * 0.38 : slot * 0.65;
  const rainOff = showBoth ? -(bw / 2 + 0.5) : 0;
  const snowOff = showBoth ?  (bw / 2 + 0.5) : 0;
  const maxBarH = OL_CH * 0.22;

  const lp = (vals: number[], mn: number, mx: number) =>
    vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${xZ(i).toFixed(1)},${yOl(v, mn, mx).toFixed(1)}`).join(' ');

  const brect = (precips: number[], maxP2: number, color: string, xOff: number) =>
    precips.map((p, i) => {
      const barH = (p / maxP2) * maxBarH;
      if (barH < 0.3) return '';
      const bx = xZ(i) + xOff - bw / 2;
      return `<rect x="${bx.toFixed(1)}" y="${(PT + OL_CH - barH).toFixed(1)}" width="${bw.toFixed(1)}" height="${barH.toFixed(1)}" style="fill:${color}" rx="0.5"/>`;
    }).join('');

  // Horizontal grid lines only — labels live in sticky overlays outside the scroll
  const tempRange = maxT - minT;
  const step = tempRange > 20 ? 10 : tempRange > 10 ? 5 : 2;
  const grid: string[] = [];
  for (let v = Math.ceil(minT / step) * step; v < maxT; v += step) {
    const y = yOl(v, minT, maxT);
    grid.push(`<line x1="${PL}" y1="${y.toFixed(1)}" x2="${(totalW - PR).toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--chart-grid)" stroke-width="1"/>`);
  }

  // Day separator lines + date labels + hour ticks (all x-position dependent)
  // Thin labels dynamically so they never overlap as zoom changes.
  const dayW = OL_DAY_W * zoom;
  const rawDayStep = Math.ceil(68 / dayW);  // 68px ≈ width of a short date label
  const dayStep = ([1, 2, 7, 14] as const).find(s => s >= rawDayStep) ?? 14;
  const showHrAll = dayW >= 80;   // show 6, 12, 18 ticks
  const showHrMid = dayW >= 40;   // show only 12 tick

  const dayLines: string[] = [];
  const dayLabels: string[] = [];
  const hrTicks: string[] = [];
  for (let d = 0; d < OL_DAYS; d++) {
    const x = xZ(d * 24);
    if (d > 0) dayLines.push(`<line x1="${x.toFixed(1)}" y1="0" x2="${x.toFixed(1)}" y2="${OL_H}" stroke="var(--chart-label)" stroke-width="1" opacity="0.2"/>`);
    if (d % dayStep === 0) {
      const dateStr = dates[d] ?? '';
      const label = dateStr ? new Date(dateStr + 'T12:00:00').toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' }) : '';
      dayLabels.push(`<text x="${(x + 3).toFixed(1)}" y="${(OL_H - 26).toFixed(1)}" text-anchor="start" class="lbl" style="font-size:10px">${label}</text>`);
    }
    if (showHrAll) {
      for (const hr of [6, 12, 18]) {
        const hx = xZ(d * 24 + hr);
        hrTicks.push(`<text x="${hx.toFixed(1)}" y="${(OL_H - 8).toFixed(1)}" text-anchor="middle" class="lbl" style="font-size:9px;opacity:0.45">${hr}</text>`);
      }
    } else if (showHrMid) {
      const hx = xZ(d * 24 + 12);
      hrTicks.push(`<text x="${hx.toFixed(1)}" y="${(OL_H - 8).toFixed(1)}" text-anchor="middle" class="lbl" style="font-size:9px;opacity:0.45">12</text>`);
    }
  }

  const cloudPts = hourly.cloud.map((c, i) => `L${xZ(i).toFixed(1)},${(PT + (c / 100) * OL_CH).toFixed(1)}`).join('');
  const cloudFill = `<path d="M${xZ(0).toFixed(1)},${PT}${cloudPts}L${xZ(OL_N - 1).toFixed(1)},${PT}Z" fill="${CLOUD_COLOR}" fill-opacity="0.20"/>`;

  return `
    ${grid.join('')}
    ${dayLines.join('')}
    ${cloudFill}
    ${hasAnyRain ? brect(hourly.rain, maxRain, PRECIP_COLOR, rainOff) : ''}
    ${hasAnySnow ? brect(hourly.snow, maxSnow, SNOW_COLOR,   snowOff) : ''}
    <path d="${lp(temps, minT, maxT)}" fill="none" stroke="${TEMP_COLOR}"     stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
    <path d="${lp(feels, minT, maxT)}" fill="none" stroke="${FEELS_COLOR}"    stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
    <path d="${lp(press, minP, maxP)}" fill="none" stroke="${PRESSURE_COLOR}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${dayLabels.join('')}
    ${hrTicks.join('')}
  `;
}

export function buildOutlookChart(hourly: HourlyData, unit: 'C' | 'F', dates: string[], locale: string): string {
  const range = computeOutlookRange(hourly, unit);
  const hasAnyRain = hourly.rain.some(v => v > 0.05);
  const hasAnySnow = hourly.snow.some(v => v > 0.05);
  const zBtn = 'w-7 h-7 rounded-lg border flex items-center justify-center text-sm font-bold hover-btn border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-400 hc:border-black hc:text-black dark-hc:border-white dark-hc:text-white';

  // Static y-axis labels — these never change with zoom, only with data range
  const { minT, maxT, minP, maxP } = range;
  const tRange = maxT - minT;
  const tStep = tRange > 20 ? 10 : tRange > 10 ? 5 : 2;
  const leftLabels: string[] = [];
  for (let v = Math.ceil(minT / tStep) * tStep; v < maxT; v += tStep) {
    const y = yOl(v, minT, maxT);
    leftLabels.push(`<text x="${(PL - 5).toFixed(1)}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" class="lbl">${Math.round(v)}°${unit}</text>`);
  }
  const pRange = maxP - minP;
  const pStep = pRange > 20 ? 10 : pRange > 10 ? 5 : 2;
  const rightLabels: string[] = [];
  for (let p = Math.ceil(minP / pStep) * pStep; p < maxP; p += pStep) {
    const y = yOl(p, minP, maxP);
    rightLabels.push(`<text x="6" y="${(y + 3.5).toFixed(1)}" text-anchor="start" class="lbl">${Math.round(p)} hPa</text>`);
  }
  const axisSvgStyle = 'display:block;overflow:visible';
  const axisStyle = `<style>.lbl{font-size:var(--chart-lbl-size);fill:var(--chart-label);font-family:ui-sans-serif,system-ui,sans-serif}</style>`;

  return `
    <div id="outlook-chart-container" class="rounded-2xl p-4 relative" style="background-color:var(--card-bg);border:var(--card-border)">
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs select-none" style="color:var(--chart-label)">Ctrl + scroll to zoom</span>
        <div class="flex items-center gap-1">
          <button id="ol-zoom-out" title="Zoom out" class="${zBtn}">−</button>
          <button id="ol-zoom-in"  title="Zoom in"  class="${zBtn}">+</button>
        </div>
      </div>
      <div class="relative">
      <div id="ol-scroll" style="overflow-x:auto">
        <svg id="ol-svg" viewBox="0 0 ${OL_W} ${OL_H}" style="display:block;width:${OL_W}px;height:${OL_H}px">
          <style>.lbl{font-size:var(--chart-lbl-size);fill:var(--chart-label);font-family:ui-sans-serif,system-ui,sans-serif}</style>
          <g id="ol-content">${olContent(hourly, dates, locale, 1, range)}</g>
          <g id="ol-chart-hover" style="display:none">
            <line id="ol-hover-line" x1="0" y1="${PT}" x2="0" y2="${PT + OL_CH}" style="stroke:var(--hover-line);stroke-width:1;stroke-dasharray:3 3"/>
            <circle class="ol-hover-dot" r="3" cx="0" cy="0" fill="${TEMP_COLOR}"     stroke-width="1.5" style="stroke:var(--dot-bg)"/>
            <circle class="ol-hover-dot" r="3" cx="0" cy="0" fill="${FEELS_COLOR}"    stroke-width="1.5" style="stroke:var(--dot-bg)"/>
            <circle class="ol-hover-dot" r="3" cx="0" cy="0" fill="${PRESSURE_COLOR}" stroke-width="1.5" style="stroke:var(--dot-bg)"/>
          </g>
          <rect id="ol-chart-overlay" x="${PL}" y="${PT}" width="${OL_CW}" height="${OL_CH}" fill="transparent" pointer-events="all" style="cursor:crosshair"/>
        </svg>
      </div>
      <div style="position:absolute;top:0;left:0;width:${PL}px;height:${OL_H}px;pointer-events:none">
        <svg viewBox="0 0 ${PL} ${OL_H}" width="${PL}" height="${OL_H}" style="${axisSvgStyle}">${axisStyle}${leftLabels.join('')}</svg>
      </div>
      <div style="position:absolute;top:0;right:0;width:${PR}px;height:${OL_H}px;pointer-events:none">
        <svg viewBox="0 0 ${PR} ${OL_H}" width="${PR}" height="${OL_H}" style="${axisSvgStyle}">${axisStyle}${rightLabels.join('')}</svg>
      </div>
      </div>
      <div id="ol-chart-tooltip" class="rounded-xl px-3 py-2 shadow-lg" style="display:none;position:absolute;pointer-events:none;z-index:10;background-color:var(--tooltip-bg);border:1px solid var(--tooltip-border)"></div>
      <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400 hc:text-black dark-hc:text-white mt-3">
        <span class="flex items-center gap-1.5">
          <span style="display:inline-block;width:18px;height:2px;background:${TEMP_COLOR};vertical-align:middle"></span><span title="${t('tooltip.temperature')}">${ICONS.temp}</span>
        </span>
        <span class="flex items-center gap-1.5">
          <span style="display:inline-block;width:18px;height:2px;background:${FEELS_COLOR};vertical-align:middle"></span><span title="${t('tooltip.apparentTemp')}">${ICONS.feels}</span>
        </span>
        ${hasAnyRain ? `
        <span class="flex items-center gap-1.5">
          <span style="display:inline-block;width:10px;height:10px;background:${PRECIP_COLOR};border-radius:2px;vertical-align:middle"></span><span title="${t('tooltip.precipitation')}">${ICONS.rain}</span>
        </span>` : ''}
        ${hasAnySnow ? `
        <span class="flex items-center gap-1.5">
          <span style="display:inline-block;width:10px;height:10px;background:var(--snow-color);border-radius:2px;vertical-align:middle"></span><span title="${t('tooltip.snowfall')}">${ICONS.snow}</span>
        </span>` : ''}
        <span class="flex items-center gap-1.5">
          <span style="display:inline-block;width:18px;height:2px;background:${PRESSURE_COLOR};vertical-align:middle"></span><span title="${t('tooltip.pressure')}">${ICONS.pressure}</span>
        </span>
        <span class="flex items-center gap-1.5">
          <span style="display:inline-block;width:14px;height:10px;background:${CLOUD_COLOR};opacity:0.3;border-radius:2px;vertical-align:middle"></span><span title="${t('tooltip.cloudCover')}">${ICONS.cloud}</span>
        </span>
      </div>
    </div>
  `;
}

export function setupOutlookTooltip(
  container: HTMLElement,
  hourly: HourlyData,
  unit: 'C' | 'F',
  dates: string[],
  locale: string,
): void {
  const svg        = container.querySelector<SVGSVGElement>('#ol-svg')!;
  const scrollWrap = container.querySelector<HTMLElement>('#ol-scroll')!;
  const contentGrp = container.querySelector<SVGGElement>('#ol-content')!;
  const overlay    = container.querySelector<SVGRectElement>('#ol-chart-overlay')!;
  const hoverGroup = container.querySelector<SVGGElement>('#ol-chart-hover')!;
  const hoverLine  = container.querySelector<SVGLineElement>('#ol-hover-line')!;
  const dots       = Array.from(container.querySelectorAll<SVGCircleElement>('.ol-hover-dot'));
  const tooltip    = container.querySelector<HTMLElement>('#ol-chart-tooltip')!;

  const range = computeOutlookRange(hourly, unit);

  // ── Zoom: expand SVG canvas in x only; y axis and strokes stay constant ───
  let zoom = 1;

  const setZoom = (newZoom: number) => {
    const containerW = scrollWrap.clientWidth;
    const minZoom    = containerW / OL_W;  // fit-to-container floor
    const scrollCenter = scrollWrap.scrollLeft + containerW / 2;
    const prevTotalW   = OL_W * zoom;

    zoom = Math.max(minZoom, Math.min(10, newZoom));
    const newTotalW = OL_W * zoom;

    // Expand the SVG canvas (viewBox + CSS width) — height unchanged
    svg.setAttribute('viewBox', `0 0 ${newTotalW.toFixed(1)} ${OL_H}`);
    svg.style.width = `${newTotalW}px`;

    // Recompute all x-position-dependent elements at the new zoom
    contentGrp.innerHTML = olContent(hourly, dates, locale, zoom, range);

    // Expand the overlay to cover the new chart width
    overlay.setAttribute('width', (OL_CW * zoom).toFixed(1));

    // Keep the scroll center stable
    scrollWrap.scrollLeft = Math.max(0, (scrollCenter / prevTotalW) * newTotalW - containerW / 2);
  };

  container.querySelector('#ol-zoom-out')?.addEventListener('click', () => setZoom(zoom / 1.6));
  container.querySelector('#ol-zoom-in')?.addEventListener('click',  () => setZoom(zoom * 1.6));
  scrollWrap.addEventListener('wheel', (e: WheelEvent) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    setZoom(zoom * (e.deltaY > 0 ? 1 / 1.15 : 1.15));
  }, { passive: false });

  // ── Hover tooltip ─────────────────────────────────────────────────────────
  const { cvt, minT, maxT, minP, maxP } = range;
  const temps = hourly.temp.map(cvt);
  const feels = hourly.apparentTemp.map(cvt);
  const press = hourly.pressure;
  const hasAnyRain = hourly.rain.some(v => v > 0.05);
  const hasAnySnow = hourly.snow.some(v => v > 0.05);

  const dotDefs = [
    { vals: temps, min: minT, max: maxT },
    { vals: feels, min: minT, max: maxT },
    { vals: press, min: minP, max: maxP },
  ];

  const showAt = (clientX: number): void => {
    const svgRect = svg.getBoundingClientRect();
    // SVG is 1:1 (no viewBox scaling) — client coords map directly to SVG units
    const svgX = clientX - svgRect.left;
    const xRange = OL_CW * zoom;
    const idx = Math.max(0, Math.min(OL_N - 1, Math.round((svgX - PL) / xRange * (OL_N - 1))));
    const x = PL + (idx / (OL_N - 1)) * xRange;

    hoverLine.setAttribute('x1', x.toFixed(1));
    hoverLine.setAttribute('x2', x.toFixed(1));

    dotDefs.forEach(({ vals, min, max }, i) => {
      dots[i].setAttribute('cx', x.toFixed(1));
      dots[i].setAttribute('cy', yOl(vals[idx], min, max).toFixed(1));
    });

    hoverGroup.style.display = '';

    const day  = Math.floor(idx / 24);
    const hour = idx % 24;
    const dateStr = dates[day] ?? '';
    const dateLabel = dateStr
      ? new Date(dateStr + 'T12:00:00').toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' })
      : '';
    const hh = `${String(hour).padStart(2, '0')}:00`;
    const fmt = (v: number) => `${Math.round(v)}°${unit}`;
    const rainFmt = (p: number) => p < 0.05 ? '–' : `${p.toFixed(1)} mm`;
    const snowFmt = (s: number) => s < 0.05 ? '–' : `${s.toFixed(1)} cm`;

    tooltip.innerHTML = `
      <div style="font-weight:600;color:var(--tooltip-text-main);margin-bottom:4px;font-size:12px">${dateLabel}, ${hh}</div>
      <div style="display:grid;grid-template-columns:auto auto;gap:2px 10px;font-size:11px">
        <span style="color:${TEMP_COLOR}" title="${t('tooltip.temperature')}">${ICONS.temp}</span>
        <span style="color:var(--tooltip-text-main)">${fmt(temps[idx])}</span>
        <span style="color:${FEELS_COLOR}" title="${t('tooltip.apparentTemp')}">${ICONS.feels}</span>
        <span style="color:var(--tooltip-text-main)">${fmt(feels[idx])}</span>
        ${hasAnyRain ? `
        <span style="color:${PRECIP_COLOR}" title="${t('tooltip.precipitation')}">${ICONS.rain}</span>
        <span style="color:var(--tooltip-text-main)">${rainFmt(hourly.rain[idx])}</span>` : ''}
        ${hasAnySnow ? `
        <span style="color:var(--snow-color)" title="${t('tooltip.snowfall')}">${ICONS.snow}</span>
        <span style="color:var(--tooltip-text-main)">${snowFmt(hourly.snow[idx])}</span>` : ''}
        <span style="color:${PRESSURE_COLOR}" title="${t('tooltip.pressure')}">${ICONS.pressure}</span>
        <span style="color:var(--tooltip-text-main)">${Math.round(press[idx])} hPa</span>
        <span style="color:var(--tooltip-text-sub)" title="${t('tooltip.cloudCover')}">${ICONS.cloud}</span>
        <span style="color:var(--tooltip-text-main)">${hourly.cloud[idx]}%</span>
      </div>
    `;

    tooltip.style.display = 'block';

    const containerRect = container.getBoundingClientRect();
    const tipX = (svgRect.left - containerRect.left) + x;
    const tipW = tooltip.offsetWidth;

    tooltip.style.top  = '8px';
    tooltip.style.left = tipX + tipW + 14 > containerRect.width
      ? `${tipX - tipW - 8}px`
      : `${tipX + 12}px`;
  };

  attachPointerHandlers(overlay, showAt, () => {
    hoverGroup.style.display = 'none';
    tooltip.style.display = 'none';
  });
}
