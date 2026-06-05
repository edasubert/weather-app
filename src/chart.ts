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

// Per-metric colors — shared between primary and secondary day
const TEMP_COLOR     = '#ef4444';         // red
const FEELS_COLOR    = '#eab308';         // yellow
const PRECIP_COLOR   = '#38bdf8';         // sky
const SNOW_COLOR     = 'var(--snow-color)'; // black (light) / white (dark)
const PRESSURE_COLOR = '#a78bfa';         // violet

function xPos(hour: number): number {
  return PL + (hour / 23) * CW;
}

function yPos(val: number, min: number, max: number): number {
  return PT + CH - ((val - min) / (max - min || 1)) * CH;
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
        <style>.lbl{font-size:var(--chart-lbl-size);fill:var(--chart-label);font-family:ui-sans-serif,system-ui,sans-serif}</style>
        ${grid.join('')}
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

  overlay.addEventListener('mousemove', (e: MouseEvent) => {
    const svgRect = svg.getBoundingClientRect();
    const svgX = (e.clientX - svgRect.left) / svgRect.width * W;
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
  });

  overlay.addEventListener('mouseleave', () => {
    hoverGroup.style.display = 'none';
    tooltip.style.display = 'none';
  });
}
