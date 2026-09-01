/**
 * Quick18 / Play18-style search matrix adapter.
 * Tenant tee sheets are HTML (`/teetimes/searchmatrix?teedate=YYYYMMDD`), not JSON.
 */

const QUICK18_UA = 'TeeTimeIO/1.0 (+https://tee-time.io)';

export function ymdToQuick18Date(ymd) {
  const m = String(ymd || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[1]}${m[2]}${m[3]}` : '';
}

export function quick18StampToRawTime(stamp) {
  const s = String(stamp || '');
  if (!/^\d{12}$/.test(s)) return '';
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)} ${s.slice(8, 10)}:${s.slice(10, 12)}`;
}

/** Tenant subdomain on `*.quick18.com` or the older `*.play18.com` sheet. */
const QUICK18_SHEET_HOST_RE = /^([a-z0-9-]+)\.(quick18|play18)\.com$/i;

export function quick18Tenant(course) {
  const explicit = course?.quick18_tenant != null ? String(course.quick18_tenant).trim() : '';
  if (explicit) return explicit.replace(/[^a-z0-9-]/gi, '').toLowerCase();
  for (const raw of [course?.booking_url, course?.booking_url_template]) {
    const host = hostnameOf(raw);
    const m = host.match(QUICK18_SHEET_HOST_RE);
    if (m) return m[1].toLowerCase();
  }
  return '';
}

/** Full sheet hostname so Play18 tenants are not rewritten onto quick18.com. */
export function quick18SheetHost(course) {
  for (const raw of [course?.booking_url, course?.booking_url_template]) {
    const host = hostnameOf(raw);
    if (QUICK18_SHEET_HOST_RE.test(host)) return host;
  }
  const tenant = quick18Tenant(course);
  return tenant ? `${tenant}.quick18.com` : '';
}

export function courseHasQuick18Sheet(course) {
  if (String(course?.platform || '') === 'quick18') return true;
  return QUICK18_SHEET_HOST_RE.test(quick18SheetHost(course));
}

export function quick18CourseId(course) {
  const explicit = course?.quick18_course_id != null ? String(course.quick18_course_id).trim() : '';
  return /^\d+$/.test(explicit) ? explicit : '';
}

function hostnameOf(raw) {
  try {
    return new URL(String(raw || '').trim()).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function stripTags(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parsePlayersToSpots(text) {
  const nums = [...String(text || '').matchAll(/\d+/g)].map((m) => Number(m[0]));
  if (!nums.length) return null;
  const max = Math.max(...nums);
  return Number.isFinite(max) && max > 0 ? max : null;
}

/** 18-hole (or unlabeled riding/walking) rates only. 27/36-hole packages are skipped. */
export function holesFromScheduleHeader(label) {
  const t = String(label || '').toLowerCase();
  if (/\b27\b/.test(t) || /\b36\b/.test(t)) return null;
  if (/\b9\b/.test(t)) return 9;
  if (/\b18\b/.test(t)) return 18;
  return 18;
}

function parseTableHeaders(tableHtml) {
  const head = tableHtml.match(/<thead[\s\S]*?<\/thead>/i)?.[0] || '';
  return [...head.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((m) => stripTags(m[1]));
}

/**
 * @param {string} html
 * @param {{ dateYmd?: string, courseId?: string }} [opts]
 */
export function parseQuick18SearchMatrix(html, opts = {}) {
  if (!html || typeof html !== 'string') return [];
  const table = html.match(/<table[^>]*class="[^"]*matrixTable[^"]*"[\s\S]*?<\/table>/i)?.[0];
  if (!table) return [];

  const headers = parseTableHeaders(table);
  const dateWanted = ymdToQuick18Date(opts.dateYmd);
  const filterCourseId = opts.courseId ? String(opts.courseId).trim() : '';

  const body = table.match(/<tbody[\s\S]*?<\/tbody>/i)?.[0] || table;
  const best = new Map();

  for (const trChunk of body.split(/<tr(?=[\s>])/i).slice(1)) {
    const tds = [...trChunk.matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi)];
    if (!tds.length) continue;

    const spots = parsePlayersToSpots(stripTags(tds.find((td) => /matrixPlayers/i.test(td[1] + td[2]))?.[2] || ''));

    tds.forEach((td, idx) => {
      const attrs = td[1] || '';
      const inner = td[2] || '';
      if (!/matrixsched/i.test(attrs) && !/matrixsched/i.test(inner)) return;
      if (/mtrxPriceNA/i.test(inner) && !/mtrxSelect/i.test(inner)) return;

      const link = inner.match(/\/teetimes\/course\/(\d+)\/teetime\/(\d{12})/i);
      if (!link) return;
      const courseId = link[1];
      const stamp = link[2];
      if (filterCourseId && courseId !== filterCourseId) return;
      if (dateWanted && !stamp.startsWith(dateWanted)) return;

      const header = headers[idx] || '';
      const holes = holesFromScheduleHeader(header);
      if (!holes) return;

      const rawTime = quick18StampToRawTime(stamp);
      if (!rawTime) return;

      const priceRaw = stripTags(inner.match(/<div[^>]*class="[^"]*mtrxPrice[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1] || '');
      const priceNum = Number(String(priceRaw).replace(/[^0-9.]+/g, ''));
      if (!Number.isFinite(priceNum) || priceNum <= 0) return;

      const key = `${rawTime}|${holes}|${courseId}`;
      const row = {
        rawTime,
        spots,
        price: '$' + Math.round(priceNum),
        holes,
        _priceNum: priceNum,
      };
      const prev = best.get(key);
      if (!prev || priceNum < prev._priceNum) best.set(key, row);
    });
  }

  return [...best.values()].map(({ _priceNum, ...row }) => row);
}

export function normalizeQuick18TimesWorker(course, data) {
  if (!data || typeof data !== 'object' || data.error) return [];
  if (Array.isArray(data.times)) {
    return data.times.filter((r) => r && r.rawTime && (r.holes === 9 || r.holes === 18));
  }
  if (typeof data.html === 'string') {
    return parseQuick18SearchMatrix(data.html, {
      dateYmd: data.date,
      courseId: quick18CourseId(course),
    });
  }
  return [];
}

export function buildQuick18BookingUrl(course, date) {
  const host = quick18SheetHost(course);
  const ymd = ymdToQuick18Date(date);
  const base = String(course?.booking_url || '').trim();
  if (host && ymd) {
    return `https://${host}/teetimes/searchmatrix?teedate=${ymd}`;
  }
  if (!base || !ymd) return base || null;
  try {
    const u = new URL(base.split('#')[0] || base);
    u.searchParams.set('teedate', ymd);
    return u.toString();
  } catch {
    return base;
  }
}

function sheetHostFromParams(params) {
  const raw = String(params.host || params.sheet_host || '').trim().toLowerCase();
  if (QUICK18_SHEET_HOST_RE.test(raw)) return raw;
  const tenant = String(params.tenant || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  return tenant ? `${tenant}.quick18.com` : '';
}

export async function handleQuick18(params, fetchImpl = fetch) {
  const host = sheetHostFromParams(params);
  const tenant = host.match(QUICK18_SHEET_HOST_RE)?.[1] || '';
  const date = String(params.date || '').trim();
  const ymd = ymdToQuick18Date(date);
  if (!tenant || !ymd) {
    return jsonResponse({ error: 'missing_params' });
  }

  const courseId = String(params.course_id || params.quick18_course_id || '').trim();
  const url = `https://${host}/teetimes/searchmatrix?teedate=${ymd}`;

  let res;
  try {
    res = await fetchImpl(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': QUICK18_UA,
      },
    });
  } catch {
    return jsonResponse({ error: 'upstream_error' });
  }

  if (!res.ok) {
    return jsonResponse({ error: 'upstream_error', status: res.status });
  }

  let html;
  try {
    html = await res.text();
  } catch {
    return jsonResponse({ error: 'parse_error' });
  }

  if (!html || !/matrixTable/i.test(html)) {
    return jsonResponse({ error: 'quick18_schema_drift' });
  }

  const times = parseQuick18SearchMatrix(html, { dateYmd: date, courseId });
  return jsonResponse({ date, tenant, times });
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
