import type { HourlyData } from './types';

const W = 600;
const H = 200;
const PL = 44; // left (y-axis labels)
const PR = 16; // right
const PT = 12; // top
const PB = 24; // bottom (x-axis labels)
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

export function buildChart(today: HourlyData, yesterday: HourlyData, unit: 'C' | 'F'): string {
  const cvt = (c: number) => unit === 'F' ? c * 9 / 5 + 32 : c;
  const tT = today.temp.map(cvt);
  const tY = yesterday.temp.map(cvt);

  const allT = [...tT, ...tY];
  const rawMin = Math.min(...allT);
  const rawMax = Math.max(...allT);
  const pad = Math.max((rawMax - rawMin) * 0.15, 2);
  const minT = rawMin - pad;
  const maxT = rawMax + pad;

  const maxP = Math.max(...today.precip, ...yesterday.precip, 0.1);
  const maxBarH = CH * 0.25;
  const barOffset = (CW / 24) * 0.18;

  // Grid lines + y-axis labels
  const tempRange = maxT - minT;
  const step = tempRange > 20 ? 10 : tempRange > 10 ? 5 : 2;
  const grid = [];
  for (let t = Math.ceil(minT / step) * step; t < maxT; t += step) {
    const y = yPos(t, minT, maxT);
    grid.push(`
      <line x1="${PL}" y1="${y.toFixed(1)}" x2="${W - PR}" y2="${y.toFixed(1)}" stroke="#f1f5f9" stroke-width="1"/>
      <text x="${(PL - 5).toFixed(1)}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" class="lbl">${Math.round(t)}°${unit}</text>
    `);
  }

  // X-axis labels
  const xLabels = [0, 6, 12, 18].map(h =>
    `<text x="${xPos(h).toFixed(1)}" y="${H - 4}" text-anchor="middle" class="lbl">${String(h).padStart(2, '0')}:00</text>`
  ).join('');

  return `
    <div class="bg-white rounded-2xl shadow-sm p-5">
      <div class="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">Hourly breakdown</div>
      <svg viewBox="0 0 ${W} ${H}" class="w-full" style="overflow:visible">
        <style>.lbl{font-size:10px;fill:#94a3b8;font-family:ui-sans-serif,system-ui,sans-serif}</style>
        ${grid.join('')}
        ${precipBars(yesterday.precip, maxP, maxBarH, '#e2e8f0', -barOffset)}
        ${precipBars(today.precip, maxP, maxBarH, '#bae6fd', barOffset)}
        <path d="${linePath(tY, minT, maxT)}" fill="none" stroke="#cbd5e1" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
        <path d="${linePath(tT, minT, maxT)}" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        ${xLabels}
      </svg>
      <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400 mt-3">
        <span class="flex items-center gap-1.5">
          <span style="display:inline-block;width:18px;height:2px;background:#38bdf8;border-radius:1px;vertical-align:middle"></span>Today temp
        </span>
        <span class="flex items-center gap-1.5">
          <span style="display:inline-block;width:18px;height:2px;background:#cbd5e1;border-radius:1px;vertical-align:middle"></span>Yesterday temp
        </span>
        <span class="flex items-center gap-1.5">
          <span style="display:inline-block;width:10px;height:10px;background:#bae6fd;border-radius:2px;vertical-align:middle"></span>Today rain
        </span>
        <span class="flex items-center gap-1.5">
          <span style="display:inline-block;width:10px;height:10px;background:#e2e8f0;border-radius:2px;vertical-align:middle"></span>Yesterday rain
        </span>
      </div>
    </div>
  `;
}
