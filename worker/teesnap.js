/**
 * TeeSnap public tee sheet.
 * Booking sites are `{tenant}.teesnap.net`. Live inventory is
 * GET `/customer-api/teetimes-day` (no session). CloudFront 403s the
 * TeeTimeIO UA, so we send a browser UA — not a captcha solve.
 */

const TS_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';
const TS_HOST_RE = /^([a-z0-9-]+)\.teesnap\.net$/i;
const COURSE_ID_RE = /^\d{2,10}$/;
const TENANT_RE = /^[a-z0-9-]{2,48}$/i;

/** Isolate-level tenant → { id, maxPlayers }. */
const courseCache = new Map();
const COURSE_CACHE_MS = 6 * 60 * 60 * 1000;

export function teeSnapTenant(course) {
  const explicit = course?.teesnap_tenant != null ? String(course.teesnap_tenant).trim() : '';
  if (TENANT_RE.test(explicit)) return explicit.toLowerCase();
  for (const raw of [course?.booking_url, course?.booking_url_template]) {
    const tenant = tenantFromUrl(raw);
    if (tenant) return tenant;
  }
  return '';
}

export function teeSnapCourseId(course) {
  const explicit = course?.teesnap_course_id != null ? String(course.teesnap_course_id).trim() : '';
  return COURSE_ID_RE.test(explicit) ? explicit : '';
}

export function tenantFromUrl(raw) {
  try {
    const host = new URL(String(raw || '').trim()).hostname.toLowerCase();
    const m = host.match(TS_HOST_RE);
    return m ? m[1] : '';
  } catch {
    return '';
  }
}

export function teeSnapHost(course) {
  const tenant = teeSnapTenant(course);
  return tenant ? `${tenant}.teesnap.net` : '';
}

export function courseHasTeeSnap(course) {
  if (String(course?.platform || '') === 'teesnap') return true;
  return Boolean(teeSnapTenant(course));
}

export function pickPrimaryTeeSnapCourse(courses) {
  const list = Array.isArray(courses) ? courses : [];
  const playable = list.filter(
    (c) =>
      c &&
      c.enabled !== false &&
      c.customer_enabled !== false &&
      !/simulator/i.test(String(c.name || '')),
  );
  const with18 = playable.find((c) => Array.isArray(c.holes_array) && c.holes_array.includes(18));
  return with18 || playable[0] || null;
}

export function parseTeeSnapPropertyHtml(html) {
  const source = String(html || '');
  const m = source.match(/window\.property\s*=\s*(\{[\s\S]*?\});/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

export function teeSnapWallClockToRaw(teeTime) {
  const m = String(teeTime || '')
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return '';
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
}

function golferCountForSection(section, bookingsById) {
  const ids = Array.isArray(section?.bookings) ? section.bookings : [];
  let n = 0;
  for (const id of ids) {
    const b = bookingsById.get(id);
    n += Array.isArray(b?.golfers) ? b.golfers.length : 0;
  }
  return n;
}

function sectionSpots(section, maxPlayers, bookingsById) {
  if (!section || section.isHeld) return 0;
  return Math.max(0, maxPlayers - golferCountForSection(section, bookingsById));
}

function priceForRound(prices, roundType) {
  const list = Array.isArray(prices) ? prices : [];
  const row = list.find((p) => String(p?.roundType || '') === roundType);
  const n = Number(row?.price);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function parseTeeSnapDayPayload(data, maxPlayers = 4) {
  const cap = Number.isFinite(maxPlayers) && maxPlayers > 0 ? maxPlayers : 4;
  const sheet = data?.teeTimes;
  if (!sheet || typeof sheet !== 'object') return [];
  const slots = Array.isArray(sheet.teeTimes) ? sheet.teeTimes : [];
  const bookingsById = new Map();
  for (const b of Array.isArray(sheet.bookings) ? sheet.bookings : []) {
    if (b && b.bookingId != null) bookingsById.set(b.bookingId, b);
  }
  const best = new Map();
  for (const slot of slots) {
    if (!slot || slot.squeezeTime || slot.shotgun) continue;
    const rawTime = teeSnapWallClockToRaw(slot.teeTime);
    if (!rawTime) continue;
    const sections = Array.isArray(slot.teeOffSections) ? slot.teeOffSections : [];
    const front = sections.find((s) => s?.teeOff === 'FRONT_NINE') || sections[0];
    const spots18 = sectionSpots(front, cap, bookingsById);
    const spots9 = Math.max(0, ...sections.map((s) => sectionSpots(s, cap, bookingsById)));
    const nine = priceForRound(slot.prices, 'NINE_HOLE');
    const eighteen = priceForRound(slot.prices, 'EIGHTEEN_HOLE');
    const rows = [];
    if (eighteen != null && spots18 > 0) {
      rows.push({ rawTime, spots: spots18, price: '$' + Math.round(eighteen), holes: 18, _priceNum: eighteen });
    }
    if (nine != null && spots9 > 0) {
      rows.push({ rawTime, spots: spots9, price: '$' + Math.round(nine), holes: 9, _priceNum: nine });
    }
    for (const row of rows) {
      const key = `${row.rawTime}|${row.holes}`;
      const prev = best.get(key);
      if (!prev || row._priceNum < prev._priceNum) best.set(key, row);
    }
  }
  return [...best.values()].map(({ _priceNum, ...row }) => {
    void _priceNum;
    return row;
  });
}

export function normalizeTeeSnapTimesWorker(_course, data) {
  if (!data || typeof data !== 'object' || data.error) return [];
  if (Array.isArray(data.times)) {
    return data.times.filter((r) => r && r.rawTime && (r.holes === 9 || r.holes === 18));
  }
  return parseTeeSnapDayPayload(data, 4);
}

export function buildTeeSnapBookingUrl(course, date, players, holes) {
  const host = teeSnapHost(course);
  const base = String(course?.booking_url || '').trim() || (host ? `https://${host}/` : '');
  if (!base) return null;
  const playersNum = Math.min(Math.max(parseInt(String(players), 10) || 1, 1), 4);
  const holesNum = holes === 9 || holes === '9' ? 9 : 18;
  try {
    const u = new URL(base.split('#')[0] || base);
    if (date) u.searchParams.set('teedate', date);
    u.searchParams.set('players', String(playersNum));
    u.searchParams.set('holes', String(holesNum));
    if (!u.searchParams.has('cart')) u.searchParams.set('cart', 'no');
    return u.toString();
  } catch {
    return base;
  }
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Content-Type': 'application/json',
    },
  });
}

async function fetchJson(url, fetchImpl) {
  const res = await fetchImpl(url, {
    headers: { 'User-Agent': TS_UA, Accept: 'application/json, text/plain, */*' },
  });
  if (!res.ok) {
    const err = new Error('upstream_error');
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function resolveCourse(tenant, courseIdHint, fetchImpl) {
  if (COURSE_ID_RE.test(courseIdHint)) {
    return { id: courseIdHint, maxPlayers: 4 };
  }
  const cached = courseCache.get(tenant);
  if (cached && Date.now() - cached.at < COURSE_CACHE_MS && cached.id) {
    return { id: cached.id, maxPlayers: cached.maxPlayers || 4 };
  }
  const res = await fetchImpl(`https://${tenant}.teesnap.net/`, {
    headers: { 'User-Agent': TS_UA, Accept: 'text/html' },
  });
  if (!res.ok) {
    const err = new Error('upstream_error');
    err.status = res.status;
    throw err;
  }
  const html = await res.text();
  const prop = parseTeeSnapPropertyHtml(html);
  const picked = pickPrimaryTeeSnapCourse(prop?.courses);
  const id = picked?.id != null ? String(picked.id) : '';
  const maxPlayers = Number(picked?.max_players) > 0 ? Number(picked.max_players) : 4;
  if (COURSE_ID_RE.test(id)) courseCache.set(tenant, { id, maxPlayers, at: Date.now() });
  return COURSE_ID_RE.test(id) ? { id, maxPlayers } : { id: '', maxPlayers: 4 };
}

export async function handleTeeSnap(params, fetchImpl = fetch) {
  const date = String(params.date || '').trim();
  const tenant = String(params.tenant || params.host || '')
    .trim()
    .toLowerCase()
    .replace(/\.teesnap\.net$/, '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !TENANT_RE.test(tenant) || !TS_HOST_RE.test(`${tenant}.teesnap.net`)) {
    return jsonResponse({ error: 'missing_params' });
  }
  const playersNum = Math.min(Math.max(parseInt(String(params.players || '4'), 10) || 4, 1), 4);

  let resolved;
  try {
    resolved = await resolveCourse(tenant, String(params.course_id || params.teesnap_course_id || '').trim(), fetchImpl);
  } catch (err) {
    if (err?.status) return jsonResponse({ error: 'upstream_error', status: err.status });
    return jsonResponse({ error: 'upstream_error' });
  }
  if (!resolved.id) return jsonResponse({ error: 'missing_params' });

  let data;
  try {
    const url =
      `https://${tenant}.teesnap.net/customer-api/teetimes-day` +
      `?course=${encodeURIComponent(resolved.id)}&date=${encodeURIComponent(date)}` +
      `&players=${playersNum}&holes=18&addons=off`;
    data = await fetchJson(url, fetchImpl);
  } catch (err) {
    if (err?.status) return jsonResponse({ error: 'upstream_error', status: err.status });
    return jsonResponse({ error: 'upstream_error' });
  }

  if (!data || typeof data !== 'object' || !data.teeTimes) {
    return jsonResponse({ error: 'teesnap_schema_drift' });
  }

  const times = parseTeeSnapDayPayload(data, resolved.maxPlayers);
  return jsonResponse({ date, tenant, times });
}
