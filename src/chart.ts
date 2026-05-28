import type { HourlyData } from './types';

const W = 600;
const H = 200;
const PL = 52;
const PR = 16;
const PT = 12;
const PB = 28;
const CW = W - PL - PR;
const CH = H - PT - PB;

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

function precipBars(precips: number[], maxP: number, maxBarH: number, fill: string, xOffset: number): string {
  const bw = (CW / 24) * 0.32;
  return precips.map((p, i) => {
    const h = (p / maxP) * maxBarH;
    if (h < 0.5) return '';
    const bx = xPos(i) + xOffset - bw / 2;
    const by = PT + CH - h;
    return `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${fill}" rx="1"/>`;
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
  return {
    cvt,
    minT: rawMin - pad,
    maxT: rawMax + pad,
    maxP: Math.max(...today.precip, ...yesterday.precip, 0.1),
  };
}

export function buildChart(today: HourlyData, yesterday: HourlyData, unit: 'C' | 'F', dark: boolean, hc = false): string {
  const { cvt, minT, maxT, maxP } = computeRange(today, yesterday, unit);
  const tT  = today.temp.map(cvt);
  const tY  = yesterday.temp.map(cvt);
  const aT  = today.apparentTemp.map(cvt);
  const aY  = yesterday.apparentTemp.map(cvt);

  const maxBarH = CH * 0.25;
  const barOffset = (CW / 24) * 0.18;

  const tempRange = maxT - minT;
  const step = tempRange > 20 ? 10 : tempRange > 10 ? 5 : 2;
  const grid = [];
  for (let t = Math.ceil(minT / step) * step; t < maxT; t += step) {
    const y = yPos(t, minT, maxT);
    grid.push(`
      <line x1="${PL}" y1="${y.toFixed(1)}" x2="${W - PR}" y2="${y.toFixed(1)}" stroke="var(--chart-grid)" stroke-width="1"/>
      <text x="${(PL - 5).toFixed(1)}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" class="lbl">${Math.round(t)}°${unit}</text>
    `);
  }

  const xLabels = [0, 6, 12, 18].map(h =>
    `<text x="${xPos(h).toFixed(1)}" y="${H - 4}" text-anchor="middle" class="lbl">${String(h).padStart(2, '0')}:00</text>`
  ).join('');

  // Normal-mode colours
  const precipToday     = hc ? (dark ? '#bfdbfe' : '#1e40af') : (dark ? '#38bdf8' : '#bae6fd');
  const precipYesterday = hc ? (dark ? '#9ca3af' : '#374151') : (dark ? '#475569' : '#e2e8f0');
  const todayLine       = '#38bdf8';
  const yLine           = dark ? '#475569' : '#cbd5e1';
  const dotBg           = hc ? (dark ? '#000000'  : '#ffffff') : (dark ? '#1e293b' : '#ffffff');
  const hoverStroke     = hc ? (dark ? '#ffffff'  : '#000000') : (dark ? '#64748b' : '#94a3b8');
  const tooltipBg       = hc ? (dark ? '#000000'  : '#ffffff') : (dark ? '#0f172a' : '#ffffff');
  const tooltipBorder   = hc ? (dark ? '#ffffff'  : '#000000') : (dark ? '#334155' : '#e2e8f0');
  const cardBg          = hc ? (dark ? '#000000'  : '#ffffff') : (dark ? '#1e293b' : '#ffffff');
  const cardBorder      = hc ? `;border:2px solid ${dark ? '#ffffff' : '#000000'}` : '';
  const legendText      = hc ? (dark ? 'text-white' : 'text-black') : (dark ? 'text-slate-400' : 'text-slate-500');

  return `
    <div id="chart-container" class="rounded-2xl p-5 relative" style="background-color:${cardBg}${cardBorder}">
      <svg viewBox="0 0 ${W} ${H}" class="w-full" style="overflow:visible">
        <style>.lbl{font-size:${hc ? 18 : 16}px;fill:var(--chart-label);font-family:ui-sans-serif,system-ui,sans-serif}</style>
        ${grid.join('')}
        ${precipBars(yesterday.precip, maxP, maxBarH, precipYesterday, -barOffset)}
        ${precipBars(today.precip, maxP, maxBarH, precipToday, barOffset)}
        <path d="${linePath(tY, minT, maxT)}" fill="none" stroke="${yLine}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
        <path d="${linePath(aY, minT, maxT)}" fill="none" stroke="${yLine}" stroke-width="1.5" stroke-dasharray="4 4" stroke-linejoin="round" stroke-linecap="round"/>
        <path d="${linePath(tT, minT, maxT)}" fill="none" stroke="${todayLine}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        <path d="${linePath(aT, minT, maxT)}" fill="none" stroke="${todayLine}" stroke-width="2" stroke-dasharray="4 4" stroke-linejoin="round" stroke-linecap="round"/>
        ${xLabels}
        <g id="chart-hover" style="display:none">
          <line id="hover-line" x1="0" y1="${PT}" x2="0" y2="${PT + CH}" stroke="${hoverStroke}" stroke-width="1" stroke-dasharray="3 3"/>
          <circle class="hover-dot" r="3.5" cx="0" cy="0" fill="${todayLine}" stroke="${dotBg}" stroke-width="1.5"/>
          <circle class="hover-dot" r="3"   cx="0" cy="0" fill="${todayLine}" stroke="${dotBg}" stroke-width="1.5"/>
          <circle class="hover-dot" r="3.5" cx="0" cy="0" fill="${yLine}"     stroke="${dotBg}" stroke-width="1.5"/>
          <circle class="hover-dot" r="3"   cx="0" cy="0" fill="${yLine}"     stroke="${dotBg}" stroke-width="1.5"/>
        </g>
        <rect id="chart-overlay" x="${PL}" y="${PT}" width="${CW}" height="${CH}" fill="transparent" pointer-events="all" style="cursor:crosshair"/>
      </svg>
      <div id="chart-tooltip" class="rounded-xl px-3 py-2 shadow-lg" style="display:none;position:absolute;pointer-events:none;z-index:10;background-color:${tooltipBg};border:1px solid ${tooltipBorder}"></div>
      <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs ${legendText} mt-3">
        <span class="flex items-center gap-1.5">
          <span style="display:inline-block;width:18px;height:2px;background:${todayLine};vertical-align:middle"></span>🌡️ Today
        </span>
        <span class="flex items-center gap-1.5">
          <svg width="18" height="4" style="vertical-align:middle"><line x1="0" y1="2" x2="18" y2="2" stroke="${todayLine}" stroke-width="2" stroke-dasharray="4 4"/></svg><span title="Apparent temperature">🧑</span> Today
        </span>
        <span class="flex items-center gap-1.5">
          <span style="display:inline-block;width:18px;height:2px;background:${yLine};vertical-align:middle"></span>🌡️ Yesterday
        </span>
        <span class="flex items-center gap-1.5">
          <svg width="18" height="4" style="vertical-align:middle"><line x1="0" y1="2" x2="18" y2="2" stroke="${yLine}" stroke-width="1.5" stroke-dasharray="4 4"/></svg><span title="Apparent temperature">🧑</span> Yesterday
        </span>
        <span class="flex items-center gap-1.5">
          <span style="display:inline-block;width:10px;height:10px;background:${precipToday};border-radius:2px;vertical-align:middle"></span><span title="Precipitation">💧</span> Today
        </span>
        <span class="flex items-center gap-1.5">
          <span style="display:inline-block;width:10px;height:10px;background:${precipYesterday};border-radius:2px;vertical-align:middle"></span><span title="Precipitation">💧</span> Yesterday
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
  dark: boolean,
  hc = false,
): void {
  const svg        = container.querySelector('svg')!;
  const overlay    = container.querySelector<SVGRectElement>('#chart-overlay')!;
  const hoverGroup = container.querySelector<SVGGElement>('#chart-hover')!;
  const hoverLine  = container.querySelector<SVGLineElement>('#hover-line')!;
  const dots       = Array.from(container.querySelectorAll<SVGCircleElement>('.hover-dot'));
  const tooltip    = container.querySelector<HTMLElement>('#chart-tooltip')!;

  const { cvt, minT, maxT } = computeRange(today, yesterday, unit);
  const tT = today.temp.map(cvt);
  const tY = yesterday.temp.map(cvt);
  const aT = today.apparentTemp.map(cvt);
  const aY = yesterday.apparentTemp.map(cvt);

  const yColor   = dark ? '#475569' : '#cbd5e1';
  const todayCol = '#38bdf8';
  const textMain = hc ? (dark ? '#ffffff'  : '#000000') : (dark ? '#f1f5f9' : '#1e293b');
  const textSub  = hc ? (dark ? '#e5e7eb'  : '#1f2937') : (dark ? '#64748b' : '#94a3b8');

  overlay.addEventListener('mousemove', (e: MouseEvent) => {
    const svgRect = svg.getBoundingClientRect();
    const svgX = (e.clientX - svgRect.left) / svgRect.width * W;
    const hour = Math.max(0, Math.min(23, Math.round((svgX - PL) / CW * 23)));
    const x = xPos(hour);

    hoverLine.setAttribute('x1', x.toFixed(1));
    hoverLine.setAttribute('x2', x.toFixed(1));

    [
      { val: tT[hour], fill: todayCol },
      { val: aT[hour], fill: todayCol },
      { val: tY[hour], fill: yColor   },
      { val: aY[hour], fill: yColor   },
    ].forEach(({ val, fill }, i) => {
      dots[i].setAttribute('cx', x.toFixed(1));
      dots[i].setAttribute('cy', yPos(val, minT, maxT).toFixed(1));
      dots[i].setAttribute('fill', fill);
    });

    hoverGroup.style.display = '';

    const hh = `${String(hour).padStart(2, '0')}:00`;
    const fmt = (v: number) => `${Math.round(v)}°${unit}`;
    const precipFmt = (p: number) => p < 0.05 ? '–' : `${p.toFixed(1)} mm`;

    tooltip.innerHTML = `
      <div style="font-weight:600;color:${textMain};margin-bottom:6px;font-size:12px">${hh}</div>
      <div style="display:grid;grid-template-columns:auto auto auto;gap:2px 10px;font-size:11px">
        <span style="color:${textSub}"></span>
        <span style="color:${textSub}">Today</span>
        <span style="color:${textSub}">Yest.</span>
        <span style="color:${textSub}" title="Temperature">🌡️</span>
        <span style="color:${textMain}">${fmt(tT[hour])}</span>
        <span style="color:${textMain}">${fmt(tY[hour])}</span>
        <span style="color:${textSub}" title="Apparent temperature">🧑</span>
        <span style="color:${textMain}">${fmt(aT[hour])}</span>
        <span style="color:${textMain}">${fmt(aY[hour])}</span>
        <span style="color:${textSub}" title="Precipitation">💧</span>
        <span style="color:${textMain}">${precipFmt(today.precip[hour])}</span>
        <span style="color:${textMain}">${precipFmt(yesterday.precip[hour])}</span>
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
