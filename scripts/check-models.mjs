// Fails (exit 1) if any model in src/models.ts no longer returns usable data
// from Open-Meteo — the defense against the catalog drifting under the hardcoded
// list (removed ids 400, renamed ids return all-null, archive-only models never
// forecast). Run in CI before merge and before deploy.
//
// Availability is location-dependent, so each model is probed at a set of points
// that together cover every region our regional models serve. A model is broken
// when:
//   - global / seamless / auto : it doesn't reach tomorrow at ANY point
//     (these are meant to work everywhere, so full data is expected)
//   - regional                 : it returns NO data at ANY point
//     (short-horizon models like HRDPS have data but may not reach tomorrow —
//      that's a handled case, not a regression)
//
// If a NEW regional model covers a region none of these points touch, it will be
// reported broken — add a covering coordinate below.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// [label, lat, lon] — one inside each region represented in the model list.
const TEST_POINTS = [
  ['US',           39.8,  -98.6],
  ['France',       48.85,   2.35],
  ['Germany',      52.5,   13.4],
  ['UK',           51.5,   -0.12],
  ['Netherlands',  52.37,   4.9],
  ['Nordics',      59.9,   10.75],
  ['Japan',        35.68, 139.76],
  ['Canada',       45.4,  -75.7],
];

function parseModels() {
  const src = readFileSync(join(ROOT, 'src/models.ts'), 'utf8');
  return [...src.matchAll(/id:\s*'([a-z0-9_]+)'[^}]*group:\s*'(\w+)'/g)]
    .map(m => ({ id: m[1], group: m[2] }));
}

async function fetchJson(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      return { ok: res.ok, body: res.ok ? await res.json() : null };
    } catch {
      if (attempt === 2) throw new Error('network');
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
}

// One request for a batch of ids at one point → { hasData:Set, tomorrow:Set }, or
// null if the request failed (so the caller can split to isolate a bad id).
async function probeOnce(lat, lon, ids) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
    + `&hourly=temperature_2m&timezone=auto&past_days=0&forecast_days=2&models=${ids.join(',')}`;
  const res = await fetchJson(url);
  if (!res.ok) return null;
  const hourly = res.body.hourly ?? {};
  const hasData = new Set();
  const tomorrow = new Set();
  for (const id of ids) {
    const s = hourly['temperature_2m_' + id] ?? (ids.length === 1 ? hourly['temperature_2m'] : undefined);
    if (!s?.length) continue;
    if (s.some(v => v != null)) hasData.add(id);
    if (s[s.length - 1] != null) tomorrow.add(id);
  }
  return { hasData, tomorrow };
}

// Split-on-failure: a single removed id 400s the whole batch, so halve and retry
// until the bad id is isolated to a lone probe that contributes nothing.
async function probe(lat, lon, ids) {
  if (!ids.length) return { hasData: new Set(), tomorrow: new Set() };
  const r = await probeOnce(lat, lon, ids);
  if (r) return r;
  if (ids.length === 1) return { hasData: new Set(), tomorrow: new Set() };
  const mid = ids.length >> 1;
  const [a, b] = await Promise.all([probe(lat, lon, ids.slice(0, mid)), probe(lat, lon, ids.slice(mid))]);
  return {
    hasData: new Set([...a.hasData, ...b.hasData]),
    tomorrow: new Set([...a.tomorrow, ...b.tomorrow]),
  };
}

const models = parseModels();
const ids = models.map(m => m.id);
console.log(`Checking ${ids.length} models across ${TEST_POINTS.length} locations…`);

const dataAnywhere = new Set();
const tomorrowAnywhere = new Set();
for (const [label, lat, lon] of TEST_POINTS) {
  const { hasData, tomorrow } = await probe(lat, lon, ids);
  for (const id of hasData) dataAnywhere.add(id);
  for (const id of tomorrow) tomorrowAnywhere.add(id);
  console.log(`  ${label.padEnd(12)} data:${String(hasData.size).padStart(2)}  reaches-tomorrow:${String(tomorrow.size).padStart(2)}`);
}

const broken = models.filter(m => {
  const needsTomorrow = m.group !== 'regional';
  return needsTomorrow ? !tomorrowAnywhere.has(m.id) : !dataAnywhere.has(m.id);
});

if (broken.length) {
  console.error('\n✖ Model check failed — these models return no usable data:');
  for (const m of broken) {
    const reason = m.group === 'regional'
      ? 'no data at any test point (removed/renamed id, or a new region needs a test point)'
      : (dataAnywhere.has(m.id) ? 'has data but never reaches tomorrow' : 'no data anywhere (removed/renamed/archive-only id)');
    console.error(`   - ${m.id} [${m.group}]: ${reason}`);
  }
  console.error('\nFix the id in src/models.ts, remove the model, or add a covering test point.');
  process.exit(1);
}

console.log(`\n✓ All ${ids.length} models return usable data.`);
