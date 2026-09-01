/**
 * GolfWithAccess (Troon Access) public JSON adapter.
 * Facility page is `/course/{slug}/reserve-tee-time`. Live times need Troon client headers
 * (`x-session-id`, `x-troon-client-platform`, `x-troon-client-version`); without them the
 * API returns `{ teeTimes: [] }`.
 */

const GWA_ORIGIN = 'https://golfwithaccess.com';
const GWA_UA = 'TeeTimeIO/1.0 (+https://tee-time.io)';
const GWA_PLATFORM = 'access-web';
const GWA_VERSION = 'tee-time.io';
const COURSE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9-]+$/i;

/** Isolate-level facility → course UUID cache (poller hits many dates per course). */
const facilityCourseCache = new Map();
const FACILITY_CACHE_MS = 6 * 60 * 60 * 1000;

export function golfWithAccessFacilitySlug(course) {
  const explicit = course?.golfwithaccess_slug != null ? String(course.golfwithaccess_slug).trim() : '';
  if (SLUG_RE.test(explicit)) return explicit.toLowerCase();
  for (const raw of [course?.booking_url, course?.booking_url_template]) {
    const slug = facilitySlugFromUrl(raw);
    if (slug) return slug;
  }
  return '';
}

export function golfWithAccessCourseId(course) {
  const explicit = course?.golfwithaccess_course_id != null ? String(course.golfwithaccess_course_id).trim() : '';
  return COURSE_UUID_RE.test(explicit) ? explicit.toLowerCase() : '';
}

export function courseHasGolfWithAccess(course) {
  if (String(course?.platform || '') === 'golfwithaccess') return true;
  return Boolean(golfWithAccessFacilitySlug(course));
}

export function facilitySlugFromUrl(raw) {
  try {
    const u = new URL(String(raw || '').trim());
    if (!/golfwithaccess\.com$/i.test(u.hostname)) return '';
    const m = u.pathname.match(/\/course\/([a-z0-9-]+)(?:\/|$)/i);
    return m && SLUG_RE.test(m[1]) ? m[1].toLowerCase() : '';
  } catch {
    return '';
  }
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

export function golfWithAccessDayTimeToRaw(dayTime) {
  if (!dayTime || typeof dayTime !== 'object') return '';
  const year = Number(dayTime.year);
  const month = Number(dayTime.month);
  const day = Number(dayTime.day);
  const hour = Number(dayTime.hour);
  const minute = Number(dayTime.minute);
  if (![year, month, day, hour, minute].every((n) => Number.isFinite(n))) return '';
  return `${year}-${pad2(month)}-${pad2(day)} ${pad2(hour)}:${pad2(minute)}`;
}

function holesFromOption(value) {
  const t = String(value || '').toUpperCase();
  if (t === 'EIGHTEEN') return 18;
  if (t === 'NINE') return 9;
  return null;
}

function dollarsCents(rate) {
  const cents = Number(rate?.price?.dollars?.cents);
  return Number.isFinite(cents) && cents > 0 ? cents : null;
}

/** Walk-up public cash rate only — skip Troon Access member prices. */
export function golfWithAccessPublicPriceCents(tt) {
  const rates = Array.isArray(tt?.rates) ? tt.rates : [];
  const publicRates = rates.filter(
    (r) => r && r.rateType === 'PUBLIC' && r.isAvailableToUser !== false,
  );
  const pick =
    publicRates[0] ||
    (tt?.displayRate?.rateType === 'PUBLIC' && tt.displayRate.isAvailableToUser !== false
      ? tt.displayRate
      : null);
  return pick ? dollarsCents(pick) : null;
}

export function normalizeGolfWithAccessTimesWorker(_course, data) {
  if (!data || typeof data !== 'object' || data.error) return [];
  const times = data.teeTimes;
  if (!Array.isArray(times)) return [];
  const best = new Map();
  for (const tt of times) {
    if (!tt || typeof tt !== 'object') continue;
    const holes = holesFromOption(tt.holesOption);
    if (!holes) continue;
    const rawTime = golfWithAccessDayTimeToRaw(tt.dayTime);
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(rawTime)) continue;
    const cents = golfWithAccessPublicPriceCents(tt);
    if (cents == null) continue;
    const spotsRaw = tt.players != null ? Number(tt.players.max) : null;
    const spots = spotsRaw != null && Number.isFinite(spotsRaw) ? spotsRaw : null;
    if (spots != null && spots <= 0) continue;
    const key = `${rawTime}|${holes}`;
    const row = {
      rawTime,
      spots,
      price: '$' + Math.round(cents / 100),
      holes,
      _cents: cents,
    };
    const prev = best.get(key);
    if (!prev || cents < prev._cents) best.set(key, row);
  }
  return [...best.values()].map(({ _cents, ...row }) => {
    void _cents;
    return row;
  });
}

export function buildGolfWithAccessBookingUrl(course, date, players) {
  const slug = golfWithAccessFacilitySlug(course);
  const base = String(course?.booking_url || '').trim();
  const playersNum = Math.min(Math.max(parseInt(String(players), 10) || 1, 1), 4);
  const href =
    base || (slug ? `${GWA_ORIGIN}/course/${slug}/reserve-tee-time` : '');
  if (!href) return null;
  try {
    const u = new URL(href.split('#')[0] || href);
    if (date) u.searchParams.set('date', String(date));
    u.searchParams.set('players', String(playersNum));
    if (!u.searchParams.has('startAt')) u.searchParams.set('startAt', '0');
    if (!u.searchParams.has('endAt')) u.searchParams.set('endAt', '24');
    if (!u.searchParams.has('view')) u.searchParams.set('view', 'time');
    if (!u.searchParams.has('payMode')) u.searchParams.set('payMode', 'dollars');
    return u.toString();
  } catch {
    return base || null;
  }
}

function newUuid() {
  try {
    return crypto.randomUUID();
  } catch {
    return '00000000-0000-4000-8000-000000000000';
  }
}

export function golfWithAccessClientHeaders() {
  return {
    Accept: 'application/json',
    Origin: GWA_ORIGIN,
    Referer: `${GWA_ORIGIN}/`,
    'User-Agent': GWA_UA,
    'x-session-id': newUuid(),
    'x-trace-id': newUuid(),
    'x-troon-client-platform': GWA_PLATFORM,
    'x-troon-client-version': GWA_VERSION,
  };
}

async function fetchJson(url, fetchImpl) {
  const res = await fetchImpl(url, { headers: golfWithAccessClientHeaders() });
  if (!res.ok) {
    const err = new Error('upstream_error');
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function resolveCourseId(params, fetchImpl) {
  const direct = String(params.course_id || params.golfwithaccess_course_id || '').trim();
  if (COURSE_UUID_RE.test(direct)) return direct.toLowerCase();

  const slug = String(params.slug || params.facility_slug || '').trim().toLowerCase();
  if (!SLUG_RE.test(slug)) return '';

  const cached = facilityCourseCache.get(slug);
  if (cached && Date.now() - cached.at < FACILITY_CACHE_MS && cached.id) return cached.id;

  const fac = await fetchJson(`${GWA_ORIGIN}/api/v0/facilities/${encodeURIComponent(slug)}`, fetchImpl);
  const courses = Array.isArray(fac?.courses) ? fac.courses : [];
  const bookable = courses.find((c) => c && c.isBookable !== false && COURSE_UUID_RE.test(String(c.id || '')));
  const fallback = courses.find((c) => c && COURSE_UUID_RE.test(String(c.id || '')));
  const id = String((bookable || fallback)?.id || '').toLowerCase();
  if (COURSE_UUID_RE.test(id)) facilityCourseCache.set(slug, { id, at: Date.now() });
  return COURSE_UUID_RE.test(id) ? id : '';
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

export async function handleGolfWithAccess(params, fetchImpl = fetch) {
  const date = String(params.date || params.day || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return jsonResponse({ error: 'missing_params' });
  }
  const playersNum = Math.min(Math.max(parseInt(String(params.players), 10) || 4, 1), 4);

  let courseId;
  try {
    courseId = await resolveCourseId(params, fetchImpl);
  } catch (err) {
    if (err?.status) return jsonResponse({ error: 'upstream_error', status: err.status });
    return jsonResponse({ error: 'upstream_error' });
  }
  if (!courseId) return jsonResponse({ error: 'missing_params' });

  const url = new URL(`${GWA_ORIGIN}/api/v1/tee-times`);
  url.searchParams.set('courseIds', courseId);
  url.searchParams.set('players', String(playersNum));
  url.searchParams.set('startAt', '00:00:00');
  url.searchParams.set('endAt', '23:59:59');
  url.searchParams.set('day', date);

  let data;
  try {
    data = await fetchJson(url.toString(), fetchImpl);
  } catch (err) {
    if (err?.status) return jsonResponse({ error: 'upstream_error', status: err.status });
    return jsonResponse({ error: 'upstream_error' });
  }

  if (!data || typeof data !== 'object' || !Array.isArray(data.teeTimes)) {
    return jsonResponse({ error: 'golfwithaccess_schema_drift' });
  }

  return jsonResponse(data);
}
