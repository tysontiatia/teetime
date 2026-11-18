/**
 * Rank US states we do not publish yet, from PostHog GeoIP and request_state.
 * The personal API key stays on the worker. The public project key cannot run queries.
 */

const POSTHOG_API = 'https://us.posthog.com';
const WINDOW_DAYS = 30;
const CACHE_MS = 6 * 60 * 60 * 1000;

const STATE_NAMES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho',
  IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi',
  MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
  OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', DC: 'Washington, D.C.',
};

const NAME_TO_CODE = Object.fromEntries(Object.entries(STATE_NAMES).map(([code, name]) => [name.toLowerCase(), code]));

let projectIdCache = null;
let snapshotCache = null;

export function stateCodeFromRecord(record) {
  const stored = String(record?.state || '').trim().toUpperCase();
  if (STATE_NAMES[stored]) return stored;
  const fromAddress = String(record?.address || '').match(/\b([A-Z]{2})\s+\d{5}/);
  if (fromAddress && STATE_NAMES[fromAddress[1]]) return fromAddress[1];
  const areaName = String(record?.area || '').split('·')[0].trim().toLowerCase();
  return NAME_TO_CODE[areaName] || null;
}

function isPublished(record) {
  const status = String(record?.booking_status || '').trim();
  if (status === 'closed' || status === 'private' || status === 'pending') return false;
  if (status === 'ready' || status === 'phone' || status === 'unsupported') return true;
  return Boolean(String(record?.platform || '').trim());
}

export function coveredStateCodes(rows) {
  const covered = new Set();
  for (const row of rows || []) {
    const record = row?.record || row;
    if (!isPublished(record)) continue;
    const code = stateCodeFromRecord(record);
    if (code) covered.add(code);
  }
  return covered;
}

function normalizeCode(raw) {
  const code = String(raw || '').trim().toUpperCase();
  return STATE_NAMES[code] ? code : null;
}

/** States not yet published, busiest first. `asked` is someone tapping the out-of-market ZIP button. */
export function rankUncoveredStates({ visitors, asked, covered }) {
  const byCode = new Map();
  for (const row of visitors || []) {
    const code = normalizeCode(row.code);
    if (!code || covered?.has(code)) continue;
    byCode.set(code, { code, visitors: Number(row.visitors) || 0, asked: 0 });
  }
  for (const row of asked || []) {
    const code = normalizeCode(row.code);
    if (!code || covered?.has(code)) continue;
    const current = byCode.get(code) || { code, visitors: 0, asked: 0 };
    current.asked += Number(row.asked) || 0;
    byCode.set(code, current);
  }
  return [...byCode.values()]
    .filter((row) => row.visitors > 0 || row.asked > 0)
    .sort((a, b) => b.visitors - a.visitors || b.asked - a.asked || a.code.localeCompare(b.code));
}

async function hogql(env, projectId, query) {
  const res = await fetch(`${POSTHOG_API}/api/projects/${projectId}/query/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.POSTHOG_PERSONAL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`posthog_${res.status}:${detail.slice(0, 180)}`);
  }
  const body = await res.json();
  return Array.isArray(body.results) ? body.results : [];
}

async function resolveProjectId(env) {
  if (projectIdCache) return projectIdCache;
  const res = await fetch(`${POSTHOG_API}/api/projects/`, {
    headers: { Authorization: `Bearer ${env.POSTHOG_PERSONAL_API_KEY}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`posthog_projects_${res.status}`);
  const body = await res.json();
  const id = body.results?.[0]?.id;
  if (!id) throw new Error('posthog_project_missing');
  projectIdCache = id;
  return id;
}

async function loadSnapshot(env) {
  if (snapshotCache && Date.now() - snapshotCache.at < CACHE_MS) return snapshotCache;
  const projectId = await resolveProjectId(env);
  const [visitorRows, askedRows] = await Promise.all([
    hogql(
      env,
      projectId,
      `SELECT properties.$geoip_subdivision_1_code AS code, count(DISTINCT person_id) AS visitors
       FROM events
       WHERE event = '$pageview'
         AND timestamp > now() - INTERVAL ${WINDOW_DAYS} DAY
         AND properties.$geoip_country_code = 'US'
         AND notEmpty(properties.$geoip_subdivision_1_code)
         AND ifNull(person.properties.is_admin, false) = false
       GROUP BY code`,
    ),
    hogql(
      env,
      projectId,
      `SELECT properties.state AS code, count() AS asked
       FROM events
       WHERE event = 'request_state'
         AND timestamp > now() - INTERVAL ${WINDOW_DAYS} DAY
         AND ifNull(person.properties.is_admin, false) = false
       GROUP BY code`,
    ),
  ]);
  snapshotCache = {
    at: Date.now(),
    visitors: visitorRows.map(([code, visitors]) => ({ code, visitors })),
    asked: askedRows.map(([code, asked]) => ({ code, asked })),
  };
  return snapshotCache;
}

export async function loadVisitorStateRanking(env, registryRows) {
  if (!env?.POSTHOG_PERSONAL_API_KEY) {
    return { error: 'visitor_states_unconfigured', status: 503 };
  }
  try {
    const snapshot = await loadSnapshot(env);
    return {
      days: WINDOW_DAYS,
      states: rankUncoveredStates({
        visitors: snapshot.visitors,
        asked: snapshot.asked,
        covered: coveredStateCodes(registryRows),
      }),
    };
  } catch (err) {
    console.error('[visitor-states]', err?.message || err);
    return { error: 'visitor_states_unavailable', status: 502 };
  }
}
