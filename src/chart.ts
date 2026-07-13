import type { HourlyData } from './types';
import { t, fmtNum } from './i18n';
import { ICONS } from './icons';

const PL = 52;
const PR = 52;
const PT = 12;
const TL_H  = 230;
const TL_PB = 44; // two-row x axis: day labels + hour ticks
const TL_CH = TL_H - PT - TL_PB;

// Per-metric colors — consistent across the whole timeline
const TEMP_COLOR     = '#ef4444';         // red
const FEELS_COLOR    = '#eab308';         // yellow
const PRECIP_COLOR   = '#38bdf8';         // sky
const SNOW_COLOR     = 'var(--snow-color)'; // black (light) / white (dark)
const PRESSURE_COLOR = '#a78bfa';         // violet
const CLOUD_COLOR    = 'var(--chart-label)'; // adapts to theme

const LBL_STYLE = `<style>.lbl{font-size:calc(var(--chart-lbl-size)*0.75);fill:var(--chart-label);font-family:ui-sans-serif,system-ui,sans-serif}</style>`;

export interface TimelineDay {
  label: string;   // pre-localized: "Yesterday", "Today", "Tomorrow", or a date
  sunrise: string; // ISO local, e.g. "2026-07-13T05:04"
  sunset: string;
}

// The comparison toggle shows exactly two days in the viewport, so a day is
// half the visible width (with a floor so 14 days stay readable on phones)
export function timelineDayWidth(viewportWidth: number): number {
  return Math.max(100, Math.round(viewportWidth - PL - PR) / 2);
}

function computeRange(hourly: HourlyData, unit: 'C' | 'F') {
  const cvt = (c: number) => unit === 'F' ? c * 9 / 5 + 32 : c;
  const allT = [...hourly.temp, ...hourly.apparentTemp].map(cvt);
  const rawMin = Math.min(...allT);
  const rawMax = Math.max(...allT);
  const pad = Math.max((rawMax - rawMin) * 0.15, 2);

  const rawMinP = Math.min(...hourly.pressure);
  const rawMaxP = Math.max(...hourly.pressure);
  const padP = Math.max((rawMaxP - rawMinP) * 0.2, 3);

  return {
    cvt,
    minT: rawMin - pad,
    maxT: rawMax + pad,
    maxRain: Math.max(...hourly.rain, 0.1),
    maxSnow: Math.max(...hourly.snow, 0.01),
    minPressure: rawMinP - padP,
    maxPressure: rawMaxP + padP,
  };
}

// "2026-07-13T05:04" -> 5.07 (fractional hours), or null if absent
function sunHour(iso: string): number | null {
  if (!iso || iso.length < 16) return null;
  return Number(iso.slice(11, 13)) + Number(iso.slice(14, 16)) / 60;
}

function yP(val: number, min: number, max: number): number {
  return PT + TL_CH - ((val - min) / (max - min || 1)) * TL_CH;
}

export function buildTimeline(
  days: TimelineDay[],
  hourly: HourlyData,
  unit: 'C' | 'F',
  viewportWidth: number,
  nowHours: number | null = null,
): string {
  const nDays = days.length;
  const n     = nDays * 24;
  const dayW  = timelineDayWidth(viewportWidth);
  const cw    = nDays * dayW;
  const w     = PL + cw + PR;
  const slotW = dayW / 24;

  const xH = (hr: number) => PL + hr * slotW;          // continuous hour position
  const xP = (i: number) => xH(i + 0.5);               // sample point at slot center

  const linePath = (vals: number[], min: number, max: number) =>
    vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${xP(i).toFixed(1)},${yP(v, min, max).toFixed(1)}`).join(' ');

  const { cvt, minT, maxT, maxRain, maxSnow, minPressure, maxPressure } = computeRange(hourly, unit);
  const temps = hourly.temp.map(cvt);
  const feels = hourly.apparentTemp.map(cvt);
  const press = hourly.pressure;

  const hasAnyRain = hourly.rain.some(v => v > 0.05);
  const hasAnySnow = hourly.snow.some(v => v > 0.05);
  const showBoth   = hasAnyRain && hasAnySnow;
  const bw      = showBoth ? slotW * 0.32 : slotW * 0.55;
  const rainOff = showBoth ? -(bw / 2 + 0.5) : 0;
  const snowOff = showBoth ?  (bw / 2 + 0.5) : 0;
  const maxBarH = TL_CH * 0.25;

  const bars = (vals: number[], maxV: number, color: string, xOff: number) =>
    vals.map((p, i) => {
      const barH = (p / maxV) * maxBarH;
      if (barH < 0.5) return '';
      return `<rect x="${(xP(i) + xOff - bw / 2).toFixed(1)}" y="${(PT + TL_CH - barH).toFixed(1)}" width="${bw.toFixed(1)}" height="${barH.toFixed(1)}" style="fill:${color}" rx="1"/>`;
    }).join('');

  // Night shading from each day's sunrise/sunset
  const nightRects: string[] = [];
  const shade = (fromH: number, toH: number) => {
    const x1 = xH(fromH);
    const x2 = xH(toH);
    if (x2 - x1 < 1) return;
    nightRects.push(`<rect x="${x1.toFixed(1)}" y="${PT}" width="${(x2 - x1).toFixed(1)}" height="${TL_CH}" fill="var(--night-shade)"/>`);
  };
  days.forEach((d, di) => {
    const rise = sunHour(d.sunrise);
    const set  = sunHour(d.sunset);
    if (rise === null || set === null) return;
    shade(di * 24, di * 24 + rise);
    shade(di * 24 + set, di * 24 + 24);
  });

  // Temperature grid lines (labels live in the sticky overlays)
  const tempRange = maxT - minT;
  const step = tempRange > 20 ? 10 : tempRange > 10 ? 5 : 2;
  const grid: string[] = [];
  const leftLabels: string[] = [];
  for (let v = Math.ceil(minT / step) * step; v < maxT; v += step) {
    const y = yP(v, minT, maxT);
    grid.push(`<line x1="${PL}" y1="${y.toFixed(1)}" x2="${(w - PR).toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--chart-grid)" stroke-width="1"/>`);
    leftLabels.push(`<text x="${(PL - 5).toFixed(1)}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" class="lbl">${Math.round(v)}°${unit}</text>`);
  }

  const pressureRange = maxPressure - minPressure;
  const pStep = pressureRange > 20 ? 10 : pressureRange > 10 ? 5 : 2;
  const rightLabels: string[] = [];
  for (let p = Math.ceil(minPressure / pStep) * pStep; p < maxPressure; p += pStep) {
    const y = yP(p, minPressure, maxPressure);
    rightLabels.push(`<text x="6" y="${(y + 3.5).toFixed(1)}" text-anchor="start" class="lbl">${Math.round(p)} hPa</text>`);
  }

  // Day boundaries, day labels, hour ticks
  const showHrAll = dayW >= 160;
  const dayLines: string[] = [];
  const dayLabels: string[] = [];
  const hrTicks: string[] = [];
  for (let d = 0; d < nDays; d++) {
    const x = xH(d * 24);
    if (d > 0) dayLines.push(`<line x1="${x.toFixed(1)}" y1="${PT}" x2="${x.toFixed(1)}" y2="${TL_H - 18}" stroke="var(--chart-label)" stroke-width="1" opacity="0.2"/>`);
    dayLabels.push(`<text x="${(x + dayW / 2).toFixed(1)}" y="${(TL_H - 6).toFixed(1)}" text-anchor="middle" class="lbl" style="font-weight:600">${days[d].label}</text>`);
    for (const hr of showHrAll ? [6, 12, 18] : [12]) {
      hrTicks.push(`<text x="${xH(d * 24 + hr).toFixed(1)}" y="${(TL_H - 24).toFixed(1)}" text-anchor="middle" class="lbl" style="font-size:9px;opacity:0.55">${String(hr).padStart(2, '0')}</text>`);
    }
  }

  const nowMarker = nowHours !== null && nowHours >= 0 && nowHours <= n
    ? (() => {
        const x = xH(nowHours);
        return `
          <line x1="${x.toFixed(1)}" y1="${PT}" x2="${x.toFixed(1)}" y2="${(PT + TL_CH).toFixed(1)}" stroke="var(--color-accent)" stroke-width="1.5" opacity="0.9"/>
          <path d="M${(x - 4).toFixed(1)},${PT} L${(x + 4).toFixed(1)},${PT} L${x.toFixed(1)},${PT + 6} Z" fill="var(--color-accent)"/>
        `;
      })()
    : '';

  const cloudPts = hourly.cloud.map((c, i) => `L${xP(i).toFixed(1)},${(PT + (c / 100) * TL_CH).toFixed(1)}`).join('');
  const cloudFill = `<path d="M${xP(0).toFixed(1)},${PT}${cloudPts}L${xP(n - 1).toFixed(1)},${PT}Z" fill="${CLOUD_COLOR}" fill-opacity="0.18"/>`;

  return `
    <div id="chart-container" class="rounded-2xl p-5 relative bg-surface hc:border-2 border-edge">
      <div class="relative">
        <div id="tl-scroll" style="overflow-x:auto">
          <svg id="tl-svg" viewBox="0 0 ${w} ${TL_H}" style="display:block;width:${w}px;height:${TL_H}px">
            ${LBL_STYLE}
            ${nightRects.join('')}
            ${grid.join('')}
            ${dayLines.join('')}
            ${cloudFill}
            ${hasAnyRain ? bars(hourly.rain, maxRain, PRECIP_COLOR, rainOff) : ''}
            ${hasAnySnow ? bars(hourly.snow, maxSnow, SNOW_COLOR,   snowOff) : ''}
            <path d="${linePath(press, minPressure, maxPressure)}" fill="none" stroke="${PRESSURE_COLOR}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
            <path d="${linePath(temps, minT, maxT)}" fill="none" stroke="${TEMP_COLOR}"  stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
            <path d="${linePath(feels, minT, maxT)}" fill="none" stroke="${FEELS_COLOR}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
            ${nowMarker}
            ${hrTicks.join('')}
            ${dayLabels.join('')}
            <g id="chart-hover" style="display:none">
              <line id="hover-line" x1="0" y1="${PT}" x2="0" y2="${PT + TL_CH}" style="stroke:var(--hover-line);stroke-width:1;stroke-dasharray:3 3"/>
              <circle class="hover-dot" r="3.5" cx="0" cy="0" fill="${TEMP_COLOR}"     stroke-width="1.5" style="stroke:var(--dot-bg)"/>
              <circle class="hover-dot" r="3.5" cx="0" cy="0" fill="${FEELS_COLOR}"    stroke-width="1.5" style="stroke:var(--dot-bg)"/>
              <circle class="hover-dot" r="3.5" cx="0" cy="0" fill="${PRESSURE_COLOR}" stroke-width="1.5" style="stroke:var(--dot-bg)"/>
            </g>
            <rect id="chart-overlay" x="${PL}" y="${PT}" width="${cw}" height="${TL_CH}" fill="transparent" pointer-events="all" style="cursor:crosshair"/>
          </svg>
        </div>
        <div style="position:absolute;top:0;left:0;width:${PL}px;height:${TL_H}px;pointer-events:none">
          <svg viewBox="0 0 ${PL} ${TL_H}" width="${PL}" height="${TL_H}" style="display:block;overflow:visible">${LBL_STYLE}${leftLabels.join('')}</svg>
        </div>
        <div style="position:absolute;top:0;right:0;width:${PR}px;height:${TL_H}px;pointer-events:none">
          <svg viewBox="0 0 ${PR} ${TL_H}" width="${PR}" height="${TL_H}" style="display:block;overflow:visible">${LBL_STYLE}${rightLabels.join('')}</svg>
        </div>
      </div>
      <div id="chart-tooltip" class="rounded-xl px-3 py-2 shadow-lg" style="display:none;position:absolute;pointer-events:none;z-index:10;background-color:var(--tooltip-bg);border:1px solid var(--tooltip-border)"></div>
      <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted mt-3">
        <span class="flex items-center gap-1.5">
          <span style="display:inline-block;width:18px;height:2px;background:${TEMP_COLOR}"></span><span title="${t('tooltip.temperature')}">${ICONS.temp}</span>
        </span>
        <span class="flex items-center gap-1.5">
          <span style="display:inline-block;width:18px;height:2px;background:${FEELS_COLOR}"></span><span title="${t('tooltip.apparentTemp')}">${ICONS.feels}</span>
        </span>
        ${hasAnyRain ? `
        <span class="flex items-center gap-1.5">
          <span style="display:inline-block;width:10px;height:10px;background:${PRECIP_COLOR};border-radius:2px"></span><span title="${t('tooltip.precipitation')}">${ICONS.rain}</span>
        </span>` : ''}
        ${hasAnySnow ? `
        <span class="flex items-center gap-1.5">
          <span style="display:inline-block;width:10px;height:10px;background:var(--snow-color);border-radius:2px"></span><span title="${t('tooltip.snowfall')}">${ICONS.snow}</span>
        </span>` : ''}
        <span class="flex items-center gap-1.5">
          <span style="display:inline-block;width:18px;height:2px;background:${PRESSURE_COLOR}"></span><span title="${t('tooltip.pressure')}">${ICONS.pressure}</span>
        </span>
        <span class="flex items-center gap-1.5">
          <span style="display:inline-block;width:14px;height:10px;background:var(--chart-label);opacity:0.28;border-radius:2px"></span><span title="${t('tooltip.cloudCover')}">${ICONS.cloud}</span>
        </span>
      </div>
    </div>
  `;
}

export function setupTimelineTooltip(
  container: HTMLElement,
  days: TimelineDay[],
  hourly: HourlyData,
  unit: 'C' | 'F',
): void {
  const svg        = container.querySelector<SVGSVGElement>('#tl-svg')!;
  const overlay    = container.querySelector<SVGRectElement>('#chart-overlay')!;
  const hoverGroup = container.querySelector<SVGGElement>('#chart-hover')!;
  const hoverLine  = container.querySelector<SVGLineElement>('#hover-line')!;
  const dots       = Array.from(container.querySelectorAll<SVGCircleElement>('.hover-dot'));
  const tooltip    = container.querySelector<HTMLElement>('#chart-tooltip')!;

  const n     = days.length * 24;
  const cw    = svg.viewBox.baseVal.width - PL - PR;
  const slotW = cw / n;

  const { cvt, minT, maxT, minPressure, maxPressure } = computeRange(hourly, unit);
  const temps = hourly.temp.map(cvt);
  const feels = hourly.apparentTemp.map(cvt);
  const press = hourly.pressure;
  const hasAnyRain = hourly.rain.some(v => v > 0.05);
  const hasAnySnow = hourly.snow.some(v => v > 0.05);

  const dotDefs = [
    { vals: temps, min: minT,        max: maxT        },
    { vals: feels, min: minT,        max: maxT        },
    { vals: press, min: minPressure, max: maxPressure },
  ];

  const showAt = (clientX: number): void => {
    const svgRect = svg.getBoundingClientRect();
    // SVG is 1:1 (no viewBox scaling) — client coords map directly to SVG units
    const svgX = clientX - svgRect.left;
    const idx = Math.max(0, Math.min(n - 1, Math.floor((svgX - PL) / slotW)));
    const x = PL + (idx + 0.5) * slotW;

    hoverLine.setAttribute('x1', x.toFixed(1));
    hoverLine.setAttribute('x2', x.toFixed(1));

    dotDefs.forEach(({ vals, min, max }, i) => {
      dots[i].setAttribute('cx', x.toFixed(1));
      dots[i].setAttribute('cy', yP(vals[idx], min, max).toFixed(1));
    });

    hoverGroup.style.display = '';

    const dayLabel = days[Math.floor(idx / 24)]?.label ?? '';
    const hh = `${String(idx % 24).padStart(2, '0')}:00`;
    const fmt = (v: number) => `${Math.round(v)}°${unit}`;
    const rainFmt = (p: number) => p < 0.05 ? '–' : `${fmtNum(p)} mm`;
    const snowFmt = (s: number) => s < 0.05 ? '–' : `${fmtNum(s)} cm`;

    tooltip.innerHTML = `
      <div style="font-weight:600;color:var(--tooltip-text-main);margin-bottom:4px;font-size:12px">${dayLabel}, ${hh}</div>
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
