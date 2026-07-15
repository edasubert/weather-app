import { t, fmtNum, getLocale } from './i18n';
import { ICONS } from './icons';
import { findModel } from './models';
import type { CompareData, CompareModelSeries } from './weather';

// Hourly-applicable card parameters (daylight is daily, so excluded). Order is
// the CSV order in the URL — append only.
export const COMPARE_PARAMS = ['temp', 'apparentTemp', 'precip', 'wind', 'pressure'] as const;
export type CompareParam = typeof COMPARE_PARAMS[number];

export const CMP_PARAM_ICON: Record<CompareParam, string> = {
  temp: ICONS.temp, apparentTemp: ICONS.feels, precip: ICONS.rain, wind: ICONS.wind, pressure: ICONS.pressure,
};

const COMPASS8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = (deg: number): string => COMPASS8[Math.round(deg / 45) % 8];
const NBSP = ' '; // narrow no-break space between value and unit

function fmtParam(p: CompareParam, m: CompareModelSeries, i: number, unit: 'C' | 'F'): string {
  switch (p) {
    case 'temp':
    case 'apparentTemp': {
      const v = (p === 'temp' ? m.temp : m.apparentTemp)[i];
      return v == null ? '—' : `${Math.round(unit === 'F' ? v * 9 / 5 + 32 : v)}°`;
    }
    case 'precip': {
      const v = m.precip[i];
      return v == null ? '—' : v < 0.05 ? '0' : `${fmtNum(v)}${NBSP}mm`;
    }
    case 'wind': {
      const s = m.windSpeed[i];
      if (s == null) return '—';
      const d = m.windDirection[i];
      const dir = d == null ? '' : ` <span style="display:inline-block;transform:rotate(${(d + 180).toFixed(0)}deg)">↑</span>${NBSP}${compass(d)}`;
      return `${Math.round(s)}${NBSP}km/h${dir}`;
    }
    case 'pressure': {
      const v = m.pressure[i];
      return v == null ? '—' : `${Math.round(v)}${NBSP}hPa`;
    }
  }
}

// Table: models in columns, hours in rows, selected params stacked in each cell.
// Sticky header (models) and sticky first column (time); the "now" hour is
// highlighted and each new day starts a heavier top border.
export function buildCompareTable(
  data: CompareData,
  models: string[],
  params: CompareParam[],
  unit: 'C' | 'F',
  rangeHours: number,
  nowIdx: number,
): string {
  const n = Math.min(rangeHours, data.time.length);

  const headCols = models.map(id => {
    const mm = findModel(id);
    const empty = !data.models[id] || data.models[id].temp.every(v => v == null);
    return `<th class="sticky top-0 z-10 bg-panel border-b border-l border-edge px-2 py-1.5 text-center align-bottom" style="min-width:92px">
      <div class="font-semibold text-body text-xs">${mm.shortLabel}</div>
      <div class="text-[10px] text-muted leading-tight">${empty ? t('compare.noData') : mm.name}</div>
      <button class="cmp-remove text-muted hover:text-body text-xs mt-0.5" data-model="${id}" title="${t('compare.remove')}" aria-label="${t('compare.remove')}">✕</button>
    </th>`;
  }).join('');

  // date → sunrise/sunset (HH:MM + the hour they fall in), for the time column
  const sun: Record<string, { rise?: string; riseHr?: number; set?: string; setHr?: number }> = {};
  data.days.forEach((day, di) => {
    const rise = data.sunrise[di];
    const set = data.sunset[di];
    sun[day] = {
      rise: rise ? rise.slice(11, 16) : undefined, riseHr: rise ? Number(rise.slice(11, 13)) : undefined,
      set:  set  ? set.slice(11, 16)  : undefined, setHr:  set  ? Number(set.slice(11, 13))  : undefined,
    };
  });

  let lastDay = '';
  const rows: string[] = [];
  for (let i = 0; i < n; i++) {
    const iso = data.time[i] ?? '';
    const day = iso.slice(0, 10);
    const hr = Number(iso.slice(11, 13));
    // Accumulated values (precip…) are for the hour ending at the timestamp, so
    // show the preceding hour above the bold current hour to frame the interval.
    const prevHH = `${String((hr + 23) % 24).padStart(2, '0')}:00`;
    const currHH = iso.slice(11, 16);
    const newDay = day !== lastDay;
    lastDay = day;
    const isNow = i === nowIdx;
    const dayLabel = newDay ? new Date(day + 'T12:00:00').toLocaleDateString(getLocale(), { weekday: 'short', month: 'short', day: 'numeric' }) : '';
    const s = sun[day];
    const sunLine = [
      s?.riseHr === hr ? `<div class="text-[10px] text-muted whitespace-nowrap">🌅 ${s!.rise}</div>` : '',
      s?.setHr === hr ? `<div class="text-[10px] text-muted whitespace-nowrap">🌇 ${s!.set}</div>` : '',
    ].join('');
    const timeCell = `<th class="sticky left-0 z-10 bg-surface ${newDay ? 'border-t-2' : ''} border-r border-edge px-2 py-1 text-left whitespace-nowrap" style="${isNow ? 'border-left:3px solid var(--color-accent);' : ''}">
      ${newDay ? `<div class="text-[10px] font-semibold text-muted uppercase">${dayLabel}</div>` : ''}
      <div class="text-[10px] text-muted leading-tight">${prevHH}</div>
      <div class="text-xs font-semibold leading-tight ${isNow ? 'text-heading' : 'text-body'}">${currHH}</div>
      ${sunLine}
    </th>`;
    const cells = models.map(id => {
      const m = data.models[id];
      const body = params.map(p => `<div class="flex items-center gap-1 leading-tight"><span class="shrink-0">${CMP_PARAM_ICON[p]}</span><span class="whitespace-nowrap">${m ? fmtParam(p, m, i, unit) : '—'}</span></div>`).join('');
      return `<td class="border-l border-edge ${newDay ? 'border-t-2' : ''} px-2 py-1 text-xs text-detail align-top">${body}</td>`;
    }).join('');
    rows.push(`<tr class="cmp-row">${timeCell}${cells}</tr>`);
  }

  return `
    <div class="rounded-2xl bg-surface hc:border-2 border-edge overflow-auto" style="max-height:72vh">
      <table style="border-collapse:separate;border-spacing:0">
        <thead>
          <tr>
            <th class="sticky left-0 top-0 z-20 bg-panel border-b border-r border-edge"></th>
            ${headCols}
          </tr>
        </thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    </div>`;
}
