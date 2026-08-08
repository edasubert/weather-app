import type { HourlyData } from './types';
import { t, fmtNum } from './i18n';
import { ICONS, BADGE_ICONS, feelsIcon } from './icons';

const badged = (icon: string, key: string): string => {
  const b = BADGE_ICONS[key];
  return b ? `<span style="position:relative;display:inline-block">${icon}<span style="position:absolute;right:-0.3em;bottom:-0.1em;font-size:0.8em;line-height:1">${b}</span></span>` : icon;
};

const PL = 52;
const PR = 60;
// No top padding: night shading and cloud fill run to the card edge. The
// temperature/pressure ranges carry their own headroom (computeRange pads
// 15–20%), so curves never touch the top.
const PT = 0;
const TL_H  = 230;
const TL_PB = 44; // two-row x axis: day labels + hour ticks
const TL_CH = TL_H - PT - TL_PB;
const WIND_LANE_H = 30; // wind lane inserted between the plot and the x axis when enabled

// Per-metric colors — consistent across the whole timeline
const TEMP_COLOR     = '#ef4444';         // red
const FEELS_COLOR    = '#eab308';         // yellow
const PRECIP_COLOR   = '#38bdf8';         // sky
const SNOW_COLOR     = 'var(--snow-color)'; // black (light) / white (dark)
const PRESSURE_COLOR = '#a78bfa';         // violet
const SOLAR_COLOR    = '#f59e0b';         // amber
const CLOUD_COLOR    = 'var(--chart-label)'; // adapts to theme

// UV index — WHO/WMO category colours (hardcoded, theme-independent) for the
// hourly strip beneath the plot: Low / Moderate / High / Very high / Extreme.
const UV_LANE_H = 12;
const ARROW_SPACE = 16; // extra SVG height at bottom reserved for the scroll-hint arrow
const UV_COLORS = ['#4eb400', '#f7e400', '#f85900', '#d8001d', '#6b49c8'] as const;
export const UV_CAT_KEYS = ['comp.uvLow', 'comp.uvModerate', 'comp.uvHigh', 'comp.uvVeryHigh', 'comp.uvExtreme'] as const;
export const uvCategory = (uv: number): number => uv < 3 ? 0 : uv < 6 ? 1 : uv < 8 ? 2 : uv < 11 ? 3 : 4;

const LBL_STYLE = `<style>.lbl{font-size:calc(var(--chart-lbl-size)*0.75);fill:var(--chart-label);font-family:ui-sans-serif,system-ui,sans-serif}</style>`;

export interface TimelineDay {
  label: string;   // pre-localized: "Yesterday", "Today", "Tomorrow", or a date
  sunrise: string; // ISO local, e.g. "2026-07-13T05:04"
  sunset: string;
}

// Which series the chart draws — driven by the display settings.
export interface ChartVisibility {
  temp: boolean;
  apparentTemp: boolean;
  precip: boolean;   // rain + snow bars
  pressure: boolean;
  cloud: boolean;
  wind: boolean;     // wind lane: direction arrows + speed particles
  uv: boolean;       // UV strip: per-hour WHO category colour band under the plot
}
const ALL_VISIBLE: ChartVisibility = { temp: true, apparentTemp: true, precip: true, pressure: true, cloud: true, wind: true, uv: true };

// 8-point compass for the direction a wind blows *from* (Open-Meteo convention).
const COMPASS8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = (deg: number): string => COMPASS8[Math.round(deg / 45) % 8];

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
    maxWind: Math.max(...hourly.windSpeed, 1),
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
  vis: ChartVisibility = ALL_VISIBLE,
  solarAltitude?: number[],
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

  const { cvt, minT, maxT, maxRain, maxSnow, minPressure, maxPressure, maxWind } = computeRange(hourly, unit);
  const temps = hourly.temp.map(cvt);
  const feels = hourly.apparentTemp.map(cvt);
  const press = hourly.pressure;

  // Wind lane sits directly below the plot body; the x axis shifts down by its
  // height, so the total SVG height H grows only when wind is enabled.
  const windLaneH = vis.wind ? WIND_LANE_H : 0;
  // UV strip sits directly under the plot; the wind lane and x-axis shift below it.
  const hasUV = hourly.uvIndex.some(v => v != null && v > 0);
  const uvLaneH = vis.uv && hasUV ? UV_LANE_H : 0;
  const H = TL_H + windLaneH + uvLaneH + ARROW_SPACE;
  const uvLaneTop = TL_CH;
  const laneTop = TL_CH + uvLaneH;
  const laneMid = laneTop + windLaneH / 2;
  // Hover cursor + overlay span the plot plus the UV strip and wind lane, so
  // hovering any of them scrubs the tooltip (which includes wind and UV).
  const hoverBottom = PT + TL_CH + uvLaneH + windLaneH;
  const uvStrip = uvLaneH
    ? hourly.uvIndex.map((uv, i) => uv == null ? '' : `<rect x="${xH(i).toFixed(1)}" y="${uvLaneTop.toFixed(1)}" width="${(slotW + 0.5).toFixed(1)}" height="${UV_LANE_H}" fill="${UV_COLORS[uvCategory(uv)]}"/>`).join('')
    : '';
  const windArrows: string[] = [];
  if (vis.wind) {
    const step = Math.max(1, Math.round(22 / slotW)); // ~1 arrow per 22px
    for (let i = Math.floor(step / 2); i < n; i += step) {
      const s = 0.45 + 0.55 * Math.min(1, hourly.windSpeed[i] / maxWind); // size ∝ speed (reduced-motion cue)
      const dirTo = hourly.windDirection[i] + 180; // Open-Meteo gives the "from" bearing; arrow points where it blows to
      windArrows.push(`<g transform="translate(${xP(i).toFixed(1)},${laneMid.toFixed(1)}) rotate(${dirTo.toFixed(0)}) scale(${s.toFixed(2)})" stroke="var(--chart-label)" stroke-width="1.2" fill="var(--chart-label)" style="opacity:0.75"><line x1="0" y1="5" x2="0" y2="-4"/><path d="M0,-8 L-3.2,-2.5 L3.2,-2.5 Z"/></g>`);
    }
  }
  const windSpeedPath = vis.wind ? (() => {
    const pad = 3;
    const d = hourly.windSpeed.map((sp, i) => {
      const x = xP(i).toFixed(1);
      const y = (laneTop + pad + (1 - Math.min(sp, maxWind) / maxWind) * (WIND_LANE_H - pad * 2)).toFixed(1);
      return `${i === 0 ? 'M' : 'L'}${x},${y}`;
    }).join(' ');
    return `<path d="${d}" fill="none" stroke="var(--chart-label)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" opacity="0.3"/>`;
  })() : '';
  const windLane = vis.wind
    ? `<line x1="${PL}" y1="${laneTop.toFixed(1)}" x2="${(w - PR).toFixed(1)}" y2="${laneTop.toFixed(1)}" stroke="var(--chart-grid)" stroke-width="1"/>${windSpeedPath}${windArrows.join('')}`
    : '';

  const hasAnyRain = hourly.rain.some(v => v > 0.05);
  const hasAnySnow = hourly.snow.some(v => v > 0.05);
  const showBoth   = hasAnyRain && hasAnySnow;
  const bw      = showBoth ? slotW * 0.32 : slotW * 0.55;
  const rainOff = showBoth ? -(bw / 2 + 0.5) : 0;
  const snowOff = showBoth ?  (bw / 2 + 0.5) : 0;
  const maxBarH = TL_CH * 0.25;

  // Precipitation probability drives each bar's fill opacity: faint = unlikely,
  // solid = near-certain. A floor keeps even low-chance bars faintly filled, and
  // the same-hue outline (--precip-bar-stroke) keeps the bar shape visible below
  // it. Past hours have null probability (observed truth) → rendered solid.
  const hasProb = hourly.precipProbability.some(v => v != null);
  const OPACITY_FLOOR = 0.2;
  const barOpacity = (i: number): number => {
    const p = hourly.precipProbability[i];
    if (p == null) return 1;
    return OPACITY_FLOOR + (p / 100) * (1 - OPACITY_FLOOR);
  };

  // Models without a probability series get striped bars — the amount is known,
  // the likelihood isn't.
  const bars = (vals: number[], maxV: number, color: string, xOff: number, hatchId: string) =>
    vals.map((v, i) => {
      const barH = (v / maxV) * maxBarH;
      if (barH < 0.5) return '';
      const fill = hasProb ? color : `url(#${hatchId})`;
      const op   = hasProb ? barOpacity(i) : 1;
      return `<rect x="${(xP(i) + xOff - bw / 2).toFixed(1)}" y="${(PT + TL_CH - barH).toFixed(1)}" width="${bw.toFixed(1)}" height="${barH.toFixed(1)}" rx="1" style="fill:${fill};fill-opacity:${op.toFixed(2)};stroke:${color};stroke-width:var(--precip-bar-stroke)"/>`;
    }).join('');

  const hatch = (id: string, color: string) =>
    `<pattern id="${id}" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="5" stroke="${color}" stroke-width="5" stroke-opacity="0.55"/></pattern>`;
  const barDefs = `<defs>${hatch('precip-hatch', PRECIP_COLOR)}${hatch('snow-hatch', SNOW_COLOR)}</defs>`;

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
    if (y < 10) continue; // label would clip at the card's top edge
    grid.push(`<line x1="${PL}" y1="${y.toFixed(1)}" x2="${(w - PR).toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--chart-grid)" stroke-width="1"/>`);
    leftLabels.push(`<text x="${(PL - 5).toFixed(1)}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" class="lbl">${Math.round(v)}°${unit}</text>`);
  }

  const pressureRange = maxPressure - minPressure;
  const pStep = pressureRange > 20 ? 10 : pressureRange > 10 ? 5 : 2;
  const rightLabels: string[] = [];
  for (let p = Math.ceil(minPressure / pStep) * pStep; p < maxPressure; p += pStep) {
    const y = yP(p, minPressure, maxPressure);
    if (y < 10) continue; // label would clip at the card's top edge
    rightLabels.push(`<text x="6" y="${(y + 3.5).toFixed(1)}" text-anchor="start" class="lbl">${Math.round(p)} hPa</text>`);
  }

  // Day boundaries, day labels, hour ticks
  const showHrAll = dayW >= 160;
  const dayLines: string[] = [];
  const dayLabels: string[] = [];
  const hrTicks: string[] = [];
  for (let d = 0; d < nDays; d++) {
    const x = xH(d * 24);
    if (d > 0) dayLines.push(`<line x1="${x.toFixed(1)}" y1="${PT}" x2="${x.toFixed(1)}" y2="${H - ARROW_SPACE - 18}" stroke="var(--chart-label)" stroke-width="1" opacity="0.2"/>`);
    dayLabels.push(`<text x="${(x + dayW / 2).toFixed(1)}" y="${(H - ARROW_SPACE - 6).toFixed(1)}" text-anchor="middle" class="lbl" style="font-weight:600">${days[d].label}</text>`);
    for (const hr of showHrAll ? [6, 12, 18] : [12]) {
      hrTicks.push(`<text x="${xH(d * 24 + hr).toFixed(1)}" y="${(H - ARROW_SPACE - 24).toFixed(1)}" text-anchor="middle" class="lbl" style="font-size:9px;opacity:0.55">${String(hr).padStart(2, '0')}</text>`);
    }
  }

  // Moon phase markers — new moon 🌑 and full moon 🌕 in the bottom axis row.
  // Uses a linear synodic model (29.53 d, ref new moon 2000-01-06 18:14 UTC);
  // accuracy is typically < 1 day, sufficient for a day-level indicator.
  const moonMarkers: string[] = [];
  {
    const SYNODIC_MS = 29.53058770576 * 86400 * 1000;
    const REF_NEW_MS = Date.UTC(2000, 0, 6, 18, 14);
    const yMoon = 18; // floats over the chart near the top edge

    const d0str = days[0]?.sunrise?.slice(0, 10) ?? '';
    const dNstr = days[nDays - 1]?.sunrise?.slice(0, 10) ?? '';
    if (d0str.length >= 10 && dNstr.length >= 10) {
      const toUTC = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
      const t0 = toUTC(d0str);
      const tN = toUTC(dNstr) + 86400000; // end of last day
      // First new moon at or before chart start
      const ageAtStart = (((t0 - REF_NEW_MS) % SYNODIC_MS) + SYNODIC_MS) % SYNODIC_MS;
      let nm = t0 - ageAtStart;
      while (nm <= tN) {
        for (const [ts, emoji, tipKey] of [
          [nm,                    '🌑', 'tooltip.newMoon'] as const,
          [nm + SYNODIC_MS / 2,  '🌕', 'tooltip.fullMoon'] as const,
        ]) {
          if (ts >= t0 && ts < tN) {
            const dayIdx = Math.min(nDays - 1, Math.floor((ts - t0) / 86400000));
            const cx = (xH(dayIdx * 24) + xH((dayIdx + 1) * 24)) / 2;
            const backdrop = `<circle cx="${cx.toFixed(1)}" cy="${(yMoon - 4).toFixed(1)}" r="9" fill="var(--chart-label)" opacity="0.3"/>`;
            moonMarkers.push(`${backdrop}<text x="${cx.toFixed(1)}" y="${yMoon.toFixed(1)}" text-anchor="middle" style="font-size:13px" data-tooltip="${t(tipKey)}">${emoji}</text>`);
          }
        }
        nm += SYNODIC_MS;
      }
    }
  }

  const nowMarker = nowHours !== null && nowHours >= 0 && nowHours <= n
    ? (() => {
        const x = xH(nowHours);
        return `
          <line x1="${x.toFixed(1)}" y1="${PT}" x2="${x.toFixed(1)}" y2="${hoverBottom.toFixed(1)}" stroke="var(--color-accent)" stroke-width="1.5" opacity="0.9"/>
          <path d="M${(x - 4).toFixed(1)},${PT} L${(x + 4).toFixed(1)},${PT} L${x.toFixed(1)},${PT + 6} Z" fill="var(--color-accent)"/>
        `;
      })()
    : '';

  const cloudPts = hourly.cloud.map((c, i) => `L${xP(i).toFixed(1)},${(PT + (c / 100) * TL_CH).toFixed(1)}`).join('');
  const cloudFill = `<path d="M${xP(0).toFixed(1)},${PT}${cloudPts}L${xP(n - 1).toFixed(1)},${PT}Z" fill="${CLOUD_COLOR}" fill-opacity="0.18"/>`;

  const solarLine = solarAltitude && solarAltitude.length >= n
    ? (() => {
        const SOLAR_MIN = -90, SOLAR_MAX = 90, THRESHOLD = 30;
        const yS = (alt: number) => PT + TL_CH - ((Math.max(SOLAR_MIN, Math.min(SOLAR_MAX, alt)) - SOLAR_MIN) / (SOLAR_MAX - SOLAR_MIN)) * TL_CH;
        const yThresh = yS(THRESHOLD);
        const sph = solarAltitude.length / n; // steps per hour (e.g. 4 for 15-min)
        const d = solarAltitude.map((alt, i) => `${i === 0 ? 'M' : 'L'}${xH(i / sph).toFixed(2)},${yS(alt).toFixed(1)}`).join(' ');
        const yHorizon = yS(0);
        const hw = slotW / 2; // half an hour in pixels
        const horizonTicks = solarAltitude.slice(0, -1).flatMap((a0, i) => {
          const a1 = solarAltitude[i + 1];
          if ((a0 < 0) === (a1 < 0)) return [];
          const xCross = xH((i + (-a0 / (a1 - a0))) / sph);
          return [`<line x1="${(xCross - hw).toFixed(1)}" y1="${yHorizon.toFixed(1)}" x2="${(xCross + hw).toFixed(1)}" y2="${yHorizon.toFixed(1)}" stroke="white" stroke-width="1.5" opacity="0.7"/>`];
        });
        const attrs = `fill="none" stroke-width="1.5" stroke-dasharray="3 3" stroke-linejoin="round" stroke-linecap="round"`;
        return `<defs>
          <clipPath id="solar-below"><rect x="${PL}" y="${yThresh.toFixed(1)}" width="${cw}" height="${(PT + TL_CH - yThresh).toFixed(1)}"/></clipPath>
          <clipPath id="solar-above"><rect x="${PL}" y="${PT}" width="${cw}" height="${(yThresh - PT).toFixed(1)}"/></clipPath>
        </defs>
        <path d="${d}" ${attrs} stroke="white" opacity="0.55" clip-path="url(#solar-below)"/>
        <path d="${d}" ${attrs} stroke="${SOLAR_COLOR}" opacity="0.85" clip-path="url(#solar-above)"/>
        ${horizonTicks.join('')}`;
      })()
    : '';

  return `
    <div id="chart-container" class="rounded-2xl relative bg-surface hc:border-2 border-edge overflow-hidden">
      <div class="relative">
        <div id="tl-scroll" style="overflow-x:auto">
          <div style="position:relative;width:${w}px">
          <svg id="tl-svg" viewBox="0 0 ${w} ${H}" style="display:block;width:${w}px;height:${H}px">
            ${LBL_STYLE}
            ${barDefs}
            ${nightRects.join('')}
            ${grid.join('')}
            ${dayLines.join('')}
            ${vis.cloud ? cloudFill : ''}
            ${solarLine}
            ${vis.precip && hasAnyRain ? bars(hourly.rain, maxRain, PRECIP_COLOR, rainOff, 'precip-hatch') : ''}
            ${vis.precip && hasAnySnow ? bars(hourly.snow, maxSnow, SNOW_COLOR,   snowOff, 'snow-hatch') : ''}
            ${vis.pressure ? `<path d="${linePath(press, minPressure, maxPressure)}" fill="none" stroke="${PRESSURE_COLOR}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>` : ''}
            ${vis.temp ? `<path d="${linePath(temps, minT, maxT)}" fill="none" stroke="${TEMP_COLOR}"  stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` : ''}
            ${vis.apparentTemp ? `<path d="${linePath(feels, minT, maxT)}" fill="none" stroke="${FEELS_COLOR}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` : ''}
            ${nowMarker}
            ${uvStrip}
            ${windLane}
            ${hrTicks.join('')}
            ${dayLabels.join('')}
            <g id="chart-hover" style="display:none">
              <line id="hover-line" x1="0" y1="${PT}" x2="0" y2="${hoverBottom}" style="stroke:var(--hover-line);stroke-width:1;stroke-dasharray:3 3"/>
              ${vis.temp ? `<circle class="hover-dot" r="3.5" cx="0" cy="0" fill="${TEMP_COLOR}"     stroke-width="1.5" style="stroke:var(--dot-bg)"/>` : ''}
              ${vis.apparentTemp ? `<circle class="hover-dot" r="3.5" cx="0" cy="0" fill="${FEELS_COLOR}"    stroke-width="1.5" style="stroke:var(--dot-bg)"/>` : ''}
              ${vis.pressure ? `<circle class="hover-dot" r="3.5" cx="0" cy="0" fill="${PRESSURE_COLOR}" stroke-width="1.5" style="stroke:var(--dot-bg)"/>` : ''}
            </g>
            <rect id="chart-overlay" x="${PL}" y="${PT}" width="${cw}" height="${hoverBottom - PT}" fill="transparent" pointer-events="all" style="cursor:crosshair"/>
            ${moonMarkers.join('')}
          </svg>
          ${vis.wind ? `<canvas id="wind-canvas" style="position:absolute;left:0;top:${laneTop}px;width:${w}px;height:${windLaneH}px;pointer-events:none"></canvas>` : ''}
          <svg width="140" height="14" aria-hidden="true" style="position:absolute;bottom:2px;left:60px;opacity:0.35"><path d="M0,7 L133,7 M126,3 L133,7 L126,11" stroke="var(--chart-label)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>
          </div>
        </div>
        <div style="position:absolute;top:0;left:0;width:${PL}px;height:${H}px;pointer-events:none;background:linear-gradient(to right, var(--color-surface) 70%, transparent)">
          <svg viewBox="0 0 ${PL} ${H}" width="${PL}" height="${H}" style="display:block;overflow:visible">${LBL_STYLE}${vis.temp || vis.apparentTemp ? leftLabels.join('') : ''}${uvLaneH ? `<text x="${(PL - 5).toFixed(1)}" y="${(uvLaneTop + UV_LANE_H / 2 + 3).toFixed(1)}" text-anchor="end" class="lbl" style="font-size:9px">UV</text>` : ''}</svg>
        </div>
        <div style="position:absolute;top:0;right:0;width:${PR}px;height:${H}px;pointer-events:none;background:linear-gradient(to left, var(--color-surface) 70%, transparent)">
          <svg viewBox="0 0 ${PR} ${H}" width="${PR}" height="${H}" style="display:block;overflow:visible">${LBL_STYLE}${vis.pressure ? rightLabels.join('') : ''}</svg>
        </div>
      </div>
      <div id="chart-tooltip" class="rounded-xl px-3 py-2 shadow-lg" style="display:none;position:absolute;pointer-events:none;z-index:10;background-color:var(--tooltip-bg);border:1px solid var(--tooltip-border)"></div>
      <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted px-5 pt-2 pb-4">
        ${vis.temp ? `
        <span class="flex items-center gap-1.5">
          <span style="display:inline-block;width:18px;height:2px;background:${TEMP_COLOR}"></span><span data-tooltip="${t('tooltip.temperature')}">${badged(ICONS.temp, 'temp')}</span>
        </span>` : ''}
        ${vis.apparentTemp ? `
        <span class="flex items-center gap-1.5">
          <span style="display:inline-block;width:18px;height:2px;background:${FEELS_COLOR}"></span><span data-tooltip="${t('tooltip.apparentTemp')}">${badged(ICONS.feels, 'feels')}</span>
        </span>` : ''}
        ${vis.precip && hasAnyRain ? `
        <span class="flex items-center gap-1.5">
          <span style="display:inline-block;width:11px;height:11px;border-radius:2px;border:1px solid ${PRECIP_COLOR};overflow:hidden"><span style="display:block;width:100%;height:100%;background:${PRECIP_COLOR};opacity:0.6"></span></span><span data-tooltip="${t('tooltip.precipitation')}">${badged(ICONS.rain, 'rain')}</span>
        </span>` : ''}
        ${vis.precip && hasAnySnow ? `
        <span class="flex items-center gap-1.5">
          <span style="display:inline-block;width:11px;height:11px;border-radius:2px;border:1px solid var(--snow-color);overflow:hidden"><span style="display:block;width:100%;height:100%;background:var(--snow-color);opacity:0.6"></span></span><span data-tooltip="${t('tooltip.snowfall')}">${badged(ICONS.snow, 'snow')}</span>
        </span>` : ''}
        ${vis.pressure ? `
        <span class="flex items-center gap-1.5">
          <span style="display:inline-block;width:18px;height:2px;background:${PRESSURE_COLOR}"></span><span data-tooltip="${t('tooltip.pressure')}">${badged(ICONS.pressure, 'pressure')}</span>
        </span>` : ''}
        ${vis.cloud ? `
        <span class="flex items-center gap-1.5">
          <span style="display:inline-block;width:14px;height:10px;background:var(--chart-label);opacity:0.28;border-radius:2px"></span><span data-tooltip="${t('tooltip.cloudCover')}">${badged(ICONS.cloud, 'cloud')}</span>
        </span>` : ''}
        ${vis.wind ? `
        <span class="flex items-center gap-1.5">
          <span style="color:var(--chart-label)">↑</span><span data-tooltip="${t('tooltip.wind')}">${badged(ICONS.wind, 'wind')}</span>
        </span>` : ''}
        ${vis.uv && hasUV ? `
        <span class="flex items-center gap-1.5">
          <span style="display:inline-block;width:18px;height:8px;border-radius:2px;background:linear-gradient(to right,#4eb400,#f7e400,#f85900,#d8001d,#6b49c8)"></span><span data-tooltip="${t('tooltip.uv')}">${badged(ICONS.uv, 'uv')}</span>
        </span>` : ''}
        ${solarAltitude ? `
        <span class="flex items-center gap-1.5">
          <svg width="18" height="6" style="display:inline-block;flex-shrink:0"><line x1="0" y1="3" x2="8" y2="3" stroke="white" stroke-width="1.5" stroke-dasharray="2 2" opacity="0.55"/><line x1="10" y1="3" x2="18" y2="3" stroke="${SOLAR_COLOR}" stroke-width="1.5" stroke-dasharray="2 2" opacity="0.85"/></svg><span data-tooltip="${t('tooltip.solarAltitude')}">${badged(ICONS.solar, 'solar')}</span>
        </span>` : ''}
      </div>
    </div>
  `;
}

export function setupTimelineTooltip(
  container: HTMLElement,
  days: TimelineDay[],
  hourly: HourlyData,
  unit: 'C' | 'F',
  vis: ChartVisibility = ALL_VISIBLE,
  solarAltitude?: number[],
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
  const solarSph = solarAltitude ? Math.round(solarAltitude.length / n) : 1;

  const { cvt, minT, maxT, minPressure, maxPressure } = computeRange(hourly, unit);
  const temps = hourly.temp.map(cvt);
  const feels = hourly.apparentTemp.map(cvt);
  const press = hourly.pressure;
  const hasAnyRain = hourly.rain.some(v => v > 0.05);
  const hasAnySnow = hourly.snow.some(v => v > 0.05);
  const hasUV = hourly.uvIndex.some(v => v != null && v > 0);

  // Order and membership must match the rendered .hover-dot circles (temp, feels,
  // pressure — each present only when visible) so dots[i] lines up with its series.
  const dotDefs: { vals: number[]; min: number; max: number }[] = [];
  if (vis.temp)         dotDefs.push({ vals: temps, min: minT,        max: maxT        });
  if (vis.apparentTemp) dotDefs.push({ vals: feels, min: minT,        max: maxT        });
  if (vis.pressure)     dotDefs.push({ vals: press, min: minPressure, max: maxPressure });

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
    // Chance of precipitation — null for observed past hours and unsupported models
    const prob = hourly.precipProbability[idx];
    const probStr = prob == null ? '' : `  ·  ${prob}%`;
    const uvNow = hourly.uvIndex[idx]; // null/undefined beyond the CAMS UV horizon

    tooltip.innerHTML = `
      <div style="font-weight:600;color:var(--tooltip-text-main);margin-bottom:4px;font-size:12px">${dayLabel}, ${hh}</div>
      <div style="display:grid;grid-template-columns:auto auto;gap:2px 10px;font-size:11px">
        ${vis.temp ? `
        <span style="color:${TEMP_COLOR}" data-tooltip="${t('tooltip.temperature')}">${badged(ICONS.temp, 'temp')}</span>
        <span style="color:var(--tooltip-text-main)">${fmt(temps[idx])}</span>` : ''}
        ${vis.apparentTemp ? `
        <span style="color:${FEELS_COLOR}" data-tooltip="${t('tooltip.apparentTemp')}">${badged(feelsIcon(hourly.apparentTemp[idx]), 'feels')}</span>
        <span style="color:var(--tooltip-text-main)">${fmt(feels[idx])}</span>` : ''}
        ${vis.precip && hasAnyRain ? `
        <span style="color:${PRECIP_COLOR}" data-tooltip="${t('tooltip.precipitation')}">${badged(ICONS.rain, 'rain')}</span>
        <span style="color:var(--tooltip-text-main)">${rainFmt(hourly.rain[idx])}${probStr}</span>` : ''}
        ${vis.precip && hasAnySnow ? `
        <span style="color:var(--snow-color)" data-tooltip="${t('tooltip.snowfall')}">${badged(ICONS.snow, 'snow')}</span>
        <span style="color:var(--tooltip-text-main)">${snowFmt(hourly.snow[idx])}${hasAnyRain ? '' : probStr}</span>` : ''}
        ${vis.pressure ? `
        <span style="color:${PRESSURE_COLOR}" data-tooltip="${t('tooltip.pressure')}">${badged(ICONS.pressure, 'pressure')}</span>
        <span style="color:var(--tooltip-text-main)">${Math.round(press[idx])} hPa</span>` : ''}
        ${vis.cloud ? `
        <span style="color:var(--tooltip-text-sub)" data-tooltip="${t('tooltip.cloudCover')}">${badged(ICONS.cloud, 'cloud')}</span>
        <span style="color:var(--tooltip-text-main)">${hourly.cloud[idx]}%</span>` : ''}
        ${vis.wind ? `
        <span style="color:var(--tooltip-text-sub)" data-tooltip="${t('tooltip.wind')}">${badged(ICONS.wind, 'wind')}</span>
        <span style="color:var(--tooltip-text-main)">${Math.round(hourly.windSpeed[idx])} km/h <span style="display:inline-block;transform:rotate(${(hourly.windDirection[idx] + 180).toFixed(0)}deg)">↑</span> ${compass(hourly.windDirection[idx])}</span>` : ''}
        ${vis.uv && hasUV && uvNow != null ? `
        <span style="color:var(--tooltip-text-sub)" data-tooltip="${t('tooltip.uv')}">${badged(ICONS.uv, 'uv')}</span>
        <span style="color:var(--tooltip-text-main)">${Math.round(uvNow)} · ${t(UV_CAT_KEYS[uvCategory(uvNow)])}</span>` : ''}
        ${(() => { const sa = solarAltitude?.[idx * solarSph]; return sa != null ? `
        <span style="color:${sa >= 30 ? SOLAR_COLOR : 'var(--tooltip-text-sub)'}" data-tooltip="${t('tooltip.solarAltitude')}">${badged(ICONS.solar, 'solar')}</span>
        <span style="color:${sa >= 30 ? SOLAR_COLOR : 'var(--tooltip-text-main)'}">${Math.round(sa)}°</span>` : ''; })()}
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

// Particle field over the wind lane: streaks drift left→right with velocity ∝
// local wind speed (the "windiness" feel). Motion encodes speed only — direction
// is carried by the SVG arrows, since horizontal drift can't honestly show a
// compass bearing on a time axis. Returns a stop() to cancel the loop.
export function startWindField(container: HTMLElement, hourly: HourlyData): () => void {
  const noop = (): void => {};
  const canvas = container.querySelector<HTMLCanvasElement>('#wind-canvas');
  const svg = container.querySelector<SVGSVGElement>('#tl-svg');
  if (!canvas || !svg) return noop;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return noop; // arrows still convey speed via size
  const ctx = canvas.getContext('2d');
  if (!ctx) return noop;

  const wpx = svg.viewBox.baseVal.width; // full content width in CSS px
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width  = Math.round(wpx * dpr);
  canvas.height = Math.round(WIND_LANE_H * dpr);
  ctx.scale(dpr, dpr);

  const n = hourly.windSpeed.length;
  const cw = wpx - PL - PR;
  const slotW = cw / n;
  const maxWind = Math.max(...hourly.windSpeed, 1);
  const color = getComputedStyle(document.documentElement).getPropertyValue('--chart-label').trim() || '#64748b';
  const speedAt = (x: number): number => {
    const i = Math.max(0, Math.min(n - 1, Math.floor((x - PL) / slotW)));
    return hourly.windSpeed[i] / maxWind; // 0..1
  };

  const count = Math.min(400, Math.max(30, Math.floor(cw / 6)));
  const parts = Array.from({ length: count }, () => ({ x: PL + Math.random() * cw, y: Math.random() * WIND_LANE_H }));

  let running = true;
  let raf = 0;
  const frame = (): void => {
    if (!running || !canvas.isConnected) return; // auto-stops on re-mount / view change
    ctx.clearRect(0, 0, wpx, WIND_LANE_H); // transparent — SVG arrows show through
    ctx.strokeStyle = color;
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    for (const p of parts) {
      const sp = speedAt(p.x);
      const v = 0.2 + 2.0 * sp;
      ctx.globalAlpha = 0.15 + 0.45 * sp;
      ctx.beginPath();
      ctx.moveTo(p.x - (4 + v * 6), p.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      p.x += v;
      if (p.x > PL + cw) { p.x = PL; p.y = Math.random() * WIND_LANE_H; }
    }
    ctx.globalAlpha = 1;
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => { running = false; cancelAnimationFrame(raf); };
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
