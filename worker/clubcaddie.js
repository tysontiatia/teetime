/**
 * ClubCaddie public tee sheet.
 * Booking URLs look like `/webapi/view/{apikey}/slots` but that route is an HTML
 * app. Live inventory is POST `/webapi/TeeTimes` with CourseId + apikey; the
 * response is slot HTML (same as the on-page AJAX refresh).
 */

const CC_UA = 'TeeTimeIO/1.0 (+https://tee-time.io)';
const CC_HOST_RE = /^(apimanager-[a-z0-9-]+)\.clubcaddie\.com$/i;
const API_KEY_RE = /^[a-z0-9]{6,16}$/i;
const COURSE_ID_RE = /^\d{4,10}$/;

/** Isolate-level apikey → numeric CourseId (slots page handshake). */
const courseIdCache = new Map();
const COURSE_ID_CACHE_MS = 6 * 60 * 60 * 1000;

export function ymdToClubCaddieDate(ymd) {
  const m = String(ymd || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : '';
}

export function clubCaddieHost(course) {
  for (const raw of [course?.booking_url, course?.booking_url_template]) {
    const host = hostnameOf(raw);
    if (CC_HOST_RE.test(host)) return host;
  }
  return '';
}

export function clubCaddieApiKey(course) {
  const explicit = course?.clubcaddie_apikey != null ? String(course.clubcaddie_apikey).trim() : '';
  if (API_KEY_RE.test(explicit)) return explicit.toLowerCase();
  for (const raw of [course?.booking_url, course?.booking_url_template]) {
    const key = apiKeyFromUrl(raw);
    if (key) return key;
  }
  return '';
}

export function clubCaddieCourseId(course) {
  const explicit = course?.clubcaddie_course_id != null ? String(course.clubcaddie_course_id).trim() : '';
  return COURSE_ID_RE.test(explicit) ? explicit : '';
}

export function courseHasClubCaddie(course) {
  if (String(course?.platform || '') === 'clubcaddie') return true;
  return Boolean(clubCaddieHost(course) && clubCaddieApiKey(course));
}

export function apiKeyFromUrl(raw) {
  try {
    const u = new URL(String(raw || '').trim());
    if (!CC_HOST_RE.test(u.hostname)) return '';
    const m = u.pathname.match(/\/webapi\/view\/([a-z0-9]+)(?:\/|$)/i);
    return m && API_KEY_RE.test(m[1]) ? m[1].toLowerCase() : '';
  } catch {
    return '';
  }
}

function hostnameOf(raw) {
  try {
    return new URL(String(raw || '').trim()).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

export function clubCaddieClockToRaw(ymd, clock) {
  const m = String(clock || '')
    .trim()
    .match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i);
  if (!m || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return '';
  let hour = Number(m[1]);
  const minute = Number(m[2]);
  const ampm = m[3].toUpperCase();
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return '';
  if (ampm === 'AM') {
    if (hour === 12) hour = 0;
  } else if (hour !== 12) {
    hour += 12;
  }
  return `${ymd} ${pad2(hour)}:${pad2(minute)}`;
}

function stripTags(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseClubCaddieTeeTimesHtml(html, dateYmd) {
  const source = String(html || '');
  if (!source || !/teetime bigscreen/i.test(source)) return [];
  const chunks = source.split(/class="[^"]*teetime bigscreen[^"]*"/i).slice(1);
  const best = new Map();
  for (const chunk of chunks) {
    const text = stripTags(chunk);
    const clock = text.match(/(\d{1,2}:\d{2}\s*[AP]M)/i)?.[1];
    const rawTime = clubCaddieClockToRaw(dateYmd, clock);
    if (!rawTime) continue;
    const holesRaw = Number(text.match(/\b(9|18)\s*Holes\b/i)?.[1]);
    const holes = holesRaw === 9 ? 9 : holesRaw === 18 ? 18 : null;
    if (!holes) continue;
    const priceNums = [...text.matchAll(/\$(\d+(?:\.\d{2})?)/g)].map((m) => Number(m[1]));
    const priceNum = priceNums.find((n) => Number.isFinite(n) && n > 0);
    if (priceNum == null) continue;
    const golferMax = Number(text.match(/(\d+)\s*-\s*(\d+)/)?.[2] || text.match(/Golfers:\s*(\d+)/i)?.[1]);
    const spots = Number.isFinite(golferMax) && golferMax > 0 ? golferMax : null;
    if (spots != null && spots <= 0) continue;
    const key = `${rawTime}|${holes}`;
    const row = {
      rawTime,
      spots,
      price: '$' + Math.round(priceNum),
      holes,
      _priceNum: priceNum,
    };
    const prev = best.get(key);
    if (!prev || priceNum < prev._priceNum) best.set(key, row);
  }
  return [...best.values()].map(({ _priceNum, ...row }) => {
    void _priceNum;
    return row;
  });
}

export function normalizeClubCaddieTimesWorker(_course, data) {
  if (!data || typeof data !== 'object' || data.error) return [];
  if (Array.isArray(data.times)) {
    return data.times.filter((r) => r && r.rawTime && (r.holes === 9 || r.holes === 18));
  }
  if (typeof data.html === 'string') {
    return parseClubCaddieTeeTimesHtml(data.html, data.date);
  }
  return [];
}

export function buildClubCaddieBookingUrl(course, date, players) {
  const base = String(course?.booking_url || '').trim();
  if (!base) return null;
  const us = ymdToClubCaddieDate(date);
  const playersNum = Math.min(Math.max(parseInt(String(players), 10) || 1, 1), 4);
  try {
    const u = new URL(base.split('#')[0] || base);
    if (us) u.searchParams.set('date', us);
    u.searchParams.set('player', String(playersNum));
    if (!u.searchParams.has('ratetype')) u.searchParams.set('ratetype', 'any');
    u.searchParams.delete('Interaction');
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

async function fetchText(url, fetchImpl, init = {}) {
  const res = await fetchImpl(url, {
    ...init,
    headers: {
      'User-Agent': CC_UA,
      Accept: 'text/html,application/xhtml+xml',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const err = new Error('upstream_error');
    err.status = res.status;
    throw err;
  }
  return { res, text: await res.text() };
}

async function resolveCourseId(host, apiKey, courseIdHint, fetchImpl) {
  if (COURSE_ID_RE.test(courseIdHint)) return courseIdHint;
  const cacheKey = `${host}|${apiKey}`;
  const cached = courseIdCache.get(cacheKey);
  if (cached && Date.now() - cached.at < COURSE_ID_CACHE_MS && cached.id) return cached.id;

  const slotsUrl = `https://${host}/webapi/view/${apiKey}/slots?date=01%2F01%2F2026&player=1`;
  const boot = await fetchImpl(`${slotsUrl}&SetSessionIdInLocalStorage=true`, {
    headers: { 'User-Agent': CC_UA, Accept: 'text/html' },
  });
  const sessionId = boot.headers.get('Session-Id') || boot.headers.get('session-id') || '';
  const pageUrl = sessionId ? `${slotsUrl}&Interaction=${encodeURIComponent(sessionId)}` : slotsUrl;
  const page = await fetchText(pageUrl, fetchImpl);
  const m = page.text.match(/name="CourseId"[^>]*value="(\d+)"/i);
  const id = m ? m[1] : '';
  if (COURSE_ID_RE.test(id)) courseIdCache.set(cacheKey, { id, at: Date.now() });
  return COURSE_ID_RE.test(id) ? id : '';
}

export async function handleClubCaddie(params, fetchImpl = fetch) {
  const date = String(params.date || '').trim();
  const usDate = ymdToClubCaddieDate(date);
  const host = String(params.host || '').trim().toLowerCase();
  const apiKey = String(params.apikey || params.api_key || '').trim().toLowerCase();
  if (!usDate || !CC_HOST_RE.test(host) || !API_KEY_RE.test(apiKey)) {
    return jsonResponse({ error: 'missing_params' });
  }
  const playersNum = Math.min(Math.max(parseInt(String(params.players || params.player), 10) || 1, 1), 4);

  let courseId;
  try {
    courseId = await resolveCourseId(host, apiKey, String(params.course_id || params.clubcaddie_course_id || '').trim(), fetchImpl);
  } catch (err) {
    if (err?.status) return jsonResponse({ error: 'upstream_error', status: err.status });
    return jsonResponse({ error: 'upstream_error' });
  }
  if (!courseId) return jsonResponse({ error: 'missing_params' });

  const body = new URLSearchParams({
    date: usDate,
    player: String(playersNum),
    holes: 'any',
    fromtime: '0',
    totime: '23',
    minprice: '0',
    maxprice: '999',
    ratetype: 'any',
    HoleGroup: 'front',
    CourseId: courseId,
    apikey: apiKey,
  });

  let html;
  try {
    const fetched = await fetchText(`https://${host}/webapi/TeeTimes`, fetchImpl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: `https://${host}/webapi/view/${apiKey}/slots`,
      },
      body: body.toString(),
    });
    html = fetched.text;
  } catch (err) {
    if (err?.status) return jsonResponse({ error: 'upstream_error', status: err.status });
    return jsonResponse({ error: 'upstream_error' });
  }

  if (/SetSessionIdInLocalStorage|PHPSESSID == null/i.test(html) && !/teetime bigscreen/i.test(html)) {
    return jsonResponse({ error: 'clubcaddie_schema_drift' });
  }
  if (/border:1px solid #990000/i.test(html) && !/teetime bigscreen/i.test(html)) {
    return jsonResponse({ error: 'clubcaddie_schema_drift' });
  }

  const times = parseClubCaddieTeeTimesHtml(html, date);
  return jsonResponse({ date, host, apikey: apiKey, times });
}
