import { handleAlertMicroPoll, handleAvailabilityPoll, pollAlertCourseDate } from './availabilityPoll.js';
import { createCourseAdminHandlers, fetchRegistryCourses, registryRowsToCourses, slugFromCourseName, withDerivedState } from './courseAdmin.js';
import { chronogolfSlcCourseIds } from './chronogolfSlc.js';
import {
  buildQuick18BookingUrl,
  handleQuick18,
  normalizeQuick18TimesWorker,
  courseHasQuick18Sheet,
  quick18CourseId,
  quick18SheetHost,
  quick18Tenant,
} from './quick18.js';
import {
  buildGolfWithAccessBookingUrl,
  courseHasGolfWithAccess,
  golfWithAccessCourseId,
  golfWithAccessFacilitySlug,
  handleGolfWithAccess,
  normalizeGolfWithAccessTimesWorker,
} from './golfwithaccess.js';
import {
  buildClubCaddieBookingUrl,
  clubCaddieApiKey,
  clubCaddieCourseId,
  clubCaddieHost,
  courseHasClubCaddie,
  handleClubCaddie,
  normalizeClubCaddieTimesWorker,
} from './clubcaddie.js';
import {
  buildTeeSnapBookingUrl,
  courseHasTeeSnap,
  handleTeeSnap,
  normalizeTeeSnapTimesWorker,
  teeSnapCourseId,
  teeSnapTenant,
} from './teesnap.js';
import {
  buildGolfRevBookingUrl,
  courseHasGolfRev,
  golfRevCourseId,
  golfRevHtc,
  handleGolfRev,
  normalizeGolfRevTimesWorker,
} from './golfrev.js';
import { fetchSnapshotNormalizedTimes, handleAvailabilityRequest, handleTeeTimesBatchRequest } from './availabilityRead.js';
import {
  evalDatesForPref,
  loadPreferenceForUser,
  notifyOnPollEvents,
  notifyPrefAgainstOpenInventory,
  runNotificationBackstop,
} from './notifications.js';
import { handleFeedRequest } from './feedRead.js';
import { checkIpRateLimit, rateLimitResponse, RATE_LIMITS } from './rateLimit.js';
import { getVapidPublicKey, sendWebPush, vapidConfigured } from './webPush.js';
import {
  bookingHolesForSlots,
  buildAlertEmail as buildAlertEmailHtml,
  buildAlertSmsBody,
  displayCourseName,
  formatTime12h,
} from './alertCopy.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Content-Type': 'application/json',
};

const courseAdmin = createCourseAdminHandlers({
  invalidateCoursesCache: () => {
    coursesCache = null;
    coursesCacheAt = 0;
  },
});

const IMAGE_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

function corsResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: CORS_HEADERS,
  });
}

/** Edge-cache GET JSON so repeat Finder/feed hits skip Supabase (egress). */
async function cachedGetResponse(request, ttlSec, producer) {
  const cache = caches.default;
  const key = new Request(request.url, { method: 'GET' });
  try {
    const hit = await cache.match(key);
    if (hit) {
      const headers = new Headers(hit.headers);
      headers.set('X-Worker-Cache', 'hit');
      return new Response(hit.body, { status: hit.status, headers });
    }
  } catch {
    // Cache API unavailable in some local/test runtimes
  }

  const res = await producer();
  if (!res.ok) return res;

  const headers = new Headers(res.headers);
  headers.set('Cache-Control', `public, max-age=${ttlSec}`);
  headers.set('X-Worker-Cache', 'miss');
  const out = new Response(res.body, { status: res.status, headers });
  try {
    await cache.put(key, out.clone());
  } catch {
    // ignore
  }
  return out;
}

function timeout(ms) {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error('timeout')), ms)
  );
}

async function fetchWithTimeout(url, options = {}, ms = 8000) {
  return Promise.race([fetch(url, options), timeout(ms)]);
}

let foreupSession = '';
let sessionFetchedAt = 0;
/** @type {Map<string, { cookie: string, at: number }>} */
const foreupBookingSessions = new Map();

let chronogolfSession = '';
let chronogolfSessionFetchedAt = 0;

async function ensureChronogolfSession() {
  if (chronogolfSession && Date.now() - chronogolfSessionFetchedAt < 1800000) return;
  try {
    const res = await fetchWithTimeout('https://www.chronogolf.com/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    }, 6000);
    const cookie = res.headers.get('set-cookie');
    if (cookie) {
      chronogolfSession = cookie.split(';')[0];
      chronogolfSessionFetchedAt = Date.now();
    }
  } catch {}
}

function foreupFacilityIdFromCourse(course) {
  // ForeUp public booking URLs are /booking/{facility}/{schedule}.
  const fromUrl = String(course?.booking_url || '').match(
    /\/booking\/(?:index\/)?(\d+)(?:\/(\d+))?/i,
  );
  if (fromUrl?.[1]) return fromUrl[1];
  return null;
}

function pickForeUpSessionCookie(res) {
  const raw =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : [res.headers.get('set-cookie')].filter(Boolean);
  for (const line of raw) {
    const part = String(line || '')
      .split(';')[0]
      .trim();
    if (/^PHPSESSID=/i.test(part)) return part;
  }
  const first = raw[0] ? String(raw[0]).split(';')[0].trim() : '';
  return first || '';
}

/**
 * Homepage PHPSESSID + api_key=no_limits can return phantom inventory (e.g. The Ridge
 * 18-hole chips that General Public never sees). Match the booking SPA: warm a session
 * on the facility tee-sheet page, then call times with an empty api_key.
 *
 * Returns the Cookie header value to use for this request. Do not rely on the
 * process-global `foreupSession` alone — the poller fetches many courses concurrently
 * and would otherwise clobber booking cookies mid-flight (reintroducing phantoms).
 */
async function ensureForeUpBookingSession(facilityId, scheduleId) {
  if (!facilityId) {
    await ensureForeUpSession();
    return foreupSession || '';
  }
  const key = `${facilityId}|${scheduleId || ''}`;
  const cached = foreupBookingSessions.get(key);
  if (cached && Date.now() - cached.at < 30 * 60 * 1000) {
    return cached.cookie;
  }

  const sheet = scheduleId
    ? `https://foreupsoftware.com/index.php/booking/${facilityId}/${scheduleId}`
    : `https://foreupsoftware.com/index.php/booking/${facilityId}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchWithTimeout(
        sheet,
        {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
          redirect: 'follow',
        },
        8000,
      );
      const cookie = pickForeUpSessionCookie(res);
      if (cookie) {
        const at = Date.now();
        foreupBookingSessions.set(key, { cookie, at });
        // Keep legacy global as a last-resort fallback for non-booking callers.
        foreupSession = cookie;
        sessionFetchedAt = at;
        return cookie;
      }
    } catch {}
  }
  await ensureForeUpSession();
  return foreupSession || '';
}

async function ensureForeUpSession() {
  if (foreupSession && Date.now() - sessionFetchedAt < 1800000) return;
  // Retry up to 2 times — cold-start worker instances lose session state
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchWithTimeout('https://foreupsoftware.com/', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      }, 5000);
      const cookie = pickForeUpSessionCookie(res);
      if (cookie) {
        foreupSession = cookie;
        sessionFetchedAt = Date.now();
        return;
      }
    } catch {}
  }
}

async function handleForeUpLogin(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return corsResponse({ error: 'invalid_body' });
  }

  const { course_id, username, password } = body;
  if (!course_id || !username || !password) {
    return corsResponse({ error: 'missing_params' });
  }

  const formData = new URLSearchParams();
  formData.set('username', username);
  formData.set('password', password);
  formData.set('booking_class_id', '0');
  formData.set('api_key', 'no_limits');
  formData.set('course_id', course_id);

  let res;
  try {
    res = await fetchWithTimeout(
      'https://foreupsoftware.com/index.php/api/booking/users/login',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        body: formData.toString(),
      }
    );
  } catch (err) {
    if (err.message === 'timeout') return corsResponse({ error: 'timeout' });
    return corsResponse({ error: 'upstream_error' });
  }

  let data;
  try {
    data = await res.json();
  } catch {
    return corsResponse({ error: 'parse_error' });
  }

  if (!data.jwt || !data.logged_in) {
    return corsResponse({ error: 'login_failed', msg: data.msg || 'Invalid credentials' });
  }

  return corsResponse({
    jwt: data.jwt,
    first_name: data.first_name || '',
    last_name: data.last_name || '',
    booking_class_ids: data.booking_class_ids || [],
  });
}

async function fetchForeUpTimes(url, foreupJwt, cookieOverride = null) {
  const cookie = cookieOverride != null && cookieOverride !== '' ? cookieOverride : foreupSession;
  const fetchOptions = {
    headers: {
      'Accept': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://foreupsoftware.com/',
      ...(cookie ? { 'Cookie': cookie } : {}),
    },
  };
  if (foreupJwt) fetchOptions.headers['Authorization'] = `Bearer ${foreupJwt}`;

  const res = await fetchWithTimeout(url, fetchOptions);
  return res;
}

function isSessionError(res, data) {
  if (!res.headers.get('content-type')?.includes('application/json')) return true;
  if (res.status === 401 || res.status === 403) return true;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    if (data.logged_in === false || data.success === false) return true;
    if (data.error && /login|auth/i.test(String(data.error))) return true;
  }
  return false;
}

async function handleForeUp(params, foreupJwt) {
  const {
    schedule_id,
    date,
    booking_class_id = '0',
    holes = '18',
    facility_id = '',
    course_id = '',
  } = params;

  if (!schedule_id || !date) {
    return corsResponse({ error: 'missing_params' });
  }

  const facilityId = String(facility_id || course_id || '').trim();
  let sheetCookie = await ensureForeUpBookingSession(facilityId, schedule_id);

  // ForeUp expects MM-DD-YYYY; frontend sends YYYY-MM-DD
  const [y, m, d] = date.split('-');
  const foreupDate = `${m}-${d}-${y}`;

  const url = new URL('https://foreupsoftware.com/index.php/api/booking/times');
  url.searchParams.set('time', 'all');
  url.searchParams.set('date', foreupDate);
  url.searchParams.set('holes', holes);
  url.searchParams.set('players', '0'); // 0 = all available, filter spots client-side
  url.searchParams.set('booking_class', booking_class_id);
  url.searchParams.set('schedule_id', schedule_id);
  url.searchParams.append('schedule_ids[]', schedule_id);
  url.searchParams.set('specials_only', '0');
  // Empty api_key matches the public booking SPA. `no_limits` can invent non-bookable rows.
  url.searchParams.set('api_key', '');

  let res;
  try {
    res = await fetchForeUpTimes(url.toString(), foreupJwt, sheetCookie);
  } catch (err) {
    if (err.message === 'timeout') return corsResponse({ error: 'timeout' });
    return corsResponse({ error: 'upstream_error' });
  }

  // If session looks stale, refresh and retry once
  let data;
  try { data = await res.clone().json(); } catch {}
  if (isSessionError(res, data)) {
    foreupSession = '';
    sessionFetchedAt = 0;
    if (facilityId) foreupBookingSessions.delete(`${facilityId}|${schedule_id || ''}`);
    sheetCookie = await ensureForeUpBookingSession(facilityId, schedule_id);
    try {
      res = await fetchForeUpTimes(url.toString(), foreupJwt, sheetCookie);
    } catch (err) {
      if (err.message === 'timeout') return corsResponse({ error: 'timeout' });
      return corsResponse({ error: 'upstream_error' });
    }
  }

  if (!res.ok) {
    return corsResponse({ error: 'upstream_error', status: res.status });
  }

  try {
    data = await res.json();
  } catch {
    return corsResponse({ error: 'parse_error' });
  }

  return corsResponse(data);
}

async function handleChronogolf(params) {
  await ensureChronogolfSession();
  const { course_ids, date } = params;

  if (!course_ids || !date) {
    return corsResponse({ error: 'missing_params' });
  }

  const url = new URL('https://www.chronogolf.com/marketplace/v2/teetimes');
  url.searchParams.set('start_date', date);
  url.searchParams.set('course_ids', course_ids);
  url.searchParams.set('holes', '9,18');
  url.searchParams.set('page', '1');

  let res;
  try {
    res = await fetchWithTimeout(url.toString(), {
      headers: {
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': 'https://www.chronogolf.com/',
        'Origin': 'https://www.chronogolf.com',
        ...(chronogolfSession ? { 'Cookie': chronogolfSession } : {}),
      },
    });
  } catch (err) {
    if (err.message === 'timeout') return corsResponse({ error: 'timeout' });
    return corsResponse({ error: 'upstream_error' });
  }

  if (!res.ok) {
    return corsResponse({ error: 'upstream_error', status: res.status });
  }

  let data;
  try {
    data = await res.json();
  } catch {
    return corsResponse({ error: 'parse_error' });
  }

  return corsResponse(data);
}

async function handleMemberSports(params) {
  const { golf_club_id, golf_course_id, date } = params;
  if (!golf_club_id || !golf_course_id || !date) {
    return corsResponse({ error: 'missing_params' });
  }

  let res;
  try {
    res = await fetchWithTimeout(
      'https://api.membersports.com/api/v1/golfclubs/onlineBookingTeeTimes',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'x-api-key': 'A9814038-9E19-4683-B171-5A06B39147FC',
          'Origin': 'https://app.membersports.com',
          'Referer': 'https://app.membersports.com/',
        },
        body: JSON.stringify({
          configurationTypeId: 0,
          date,
          golfClubGroupId: 0,
          golfClubId: parseInt(golf_club_id),
          golfCourseId: parseInt(golf_course_id),
          groupSheetTypeId: 0,
        }),
      }
    );
  } catch (err) {
    if (err.message === 'timeout') return corsResponse({ error: 'timeout' });
    return corsResponse({ error: 'upstream_error' });
  }

  if (!res.ok) {
    return corsResponse({ error: 'upstream_error', status: res.status });
  }

  let data;
  try {
    data = await res.json();
  } catch {
    return corsResponse({ error: 'parse_error' });
  }

  return corsResponse(data);
}

async function fetchChronogolfSlcTeetimes(club_id, course_id, affiliation_type_id, nb_holes, date, players) {
  const url = new URL(`https://www.chronogolf.com/marketplace/clubs/${club_id}/teetimes`);
  url.searchParams.set('date', date);
  url.searchParams.set('course_id', course_id);
  url.searchParams.set('nb_holes', nb_holes || '18');
  const n = Math.min(Math.max(parseInt(players, 10) || 1, 1), 4);
  for (let i = 0; i < n; i++) {
    url.searchParams.append('affiliation_type_ids[]', affiliation_type_id);
  }

  let res;
  try {
    res = await fetchWithTimeout(url.toString(), {
      headers: {
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': 'https://www.chronogolf.com/',
        'Origin': 'https://www.chronogolf.com',
        ...(chronogolfSession ? { 'Cookie': chronogolfSession } : {}),
      },
    });
  } catch (err) {
    if (err.message === 'timeout') return { error: 'timeout' };
    return { error: 'upstream_error' };
  }

  if (!res.ok) {
    return { error: 'upstream_error', status: res.status };
  }

  try {
    return await res.json();
  } catch {
    return { error: 'parse_error' };
  }
}

async function handleChronogolfSlc(params) {
  await ensureChronogolfSession();
  const { club_id, course_id, affiliation_type_id, nb_holes, date, players = '1' } = params;
  // Comma-separated course_id supports multi-layout clubs (Canyon + Lake).
  const courseIds = String(course_id || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (!club_id || !courseIds.length || !affiliation_type_id || !date) {
    return corsResponse({ error: 'missing_params' });
  }

  const parts = await Promise.all(
    courseIds.map((cid) =>
      fetchChronogolfSlcTeetimes(club_id, cid, affiliation_type_id, nb_holes, date, players),
    ),
  );

  const merged = [];
  let lastError = null;
  for (const part of parts) {
    if (Array.isArray(part)) {
      merged.push(...part);
      continue;
    }
    if (part && typeof part === 'object' && part.error) lastError = part;
  }

  if (!merged.length && lastError) return corsResponse(lastError);
  return corsResponse(merged);
}

// TeeItUp / Aspira (kenna.io) — one unauthenticated JSON endpoint serves all
// Aspira facilities. Reads need the tenant alias header; a bare request → 400.
const TEEITUP_API = 'https://phx-api-be-east-1b.kenna.io/v2/tee-times';
const TEEITUP_ALIAS = 'aspira-management-company';
const TEEITUP_USER_AGENT = 'TeeTimeIO/1.0 (+https://tee-time.io)';

/**
 * Tenant alias for the `x-be-alias` header — the subdomain label of the booking
 * URL (e.g. aspira-management-company.book-v2.teeitup.golf → aspira-management-company,
 * hideout-golf-club.book.teeitup.com → hideout-golf-club). Explicit override wins;
 * falls back to Aspira so existing courses need no change.
 */
export function teeItUpAlias(course) {
  const explicit = course.teeitup_alias != null ? String(course.teeitup_alias).trim() : '';
  if (explicit) return explicit;
  const m = String(course.booking_url || '').match(/^https?:\/\/([^.]+)\.book/i);
  return m ? m[1] : TEEITUP_ALIAS;
}

async function handleTeeItUp(params) {
  const { facility_id, date, alias } = params;
  if (!facility_id || !date) {
    return corsResponse({ error: 'missing_params' });
  }

  const beAlias = alias && String(alias).trim() ? String(alias).trim() : TEEITUP_ALIAS;

  const url = new URL(TEEITUP_API);
  url.searchParams.set('date', date);
  url.searchParams.set('facilityIds', String(facility_id));
  url.searchParams.set('returnPromotedRates', 'true');

  let res;
  try {
    res = await fetchWithTimeout(url.toString(), {
      headers: {
        'Accept': 'application/json',
        'x-be-alias': beAlias,
        'User-Agent': TEEITUP_USER_AGENT,
      },
    });
  } catch (err) {
    if (err.message === 'timeout') return corsResponse({ error: 'timeout' });
    return corsResponse({ error: 'upstream_error' });
  }

  if (!res.ok) {
    return corsResponse({ error: 'upstream_error', status: res.status });
  }

  let data;
  try {
    data = await res.json();
  } catch {
    return corsResponse({ error: 'parse_error' });
  }

  // Break loudly (poll_runs failure) on schema drift rather than writing garbage.
  if (!Array.isArray(data)) {
    return corsResponse({ error: 'teeitup_schema_drift' });
  }

  return corsResponse(data);
}

// Trutee (Convex) — public tee times, no auth. Fees are cents.
const TRUTEE_CONVEX_QUERY = 'https://backend.trutee.app/api/query';
const TRUTEE_USER_AGENT = 'TeeTimeIO/1.0 (+https://tee-time.io)';

async function handleTrutee(params) {
  const { course_id, date } = params;
  if (!course_id || !date) {
    return corsResponse({ error: 'missing_params' });
  }

  let res;
  try {
    res = await fetchWithTimeout(TRUTEE_CONVEX_QUERY, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': TRUTEE_USER_AGENT,
      },
      body: JSON.stringify({
        path: 'teetimes/publicTeeTimes:getSingleCourseTeeTimes',
        args: { courseId: String(course_id), date: String(date) },
        format: 'json',
      }),
    });
  } catch (err) {
    if (err.message === 'timeout') return corsResponse({ error: 'timeout' });
    return corsResponse({ error: 'upstream_error' });
  }

  if (!res.ok) {
    return corsResponse({ error: 'upstream_error', status: res.status });
  }

  let envelope;
  try {
    envelope = await res.json();
  } catch {
    return corsResponse({ error: 'parse_error' });
  }

  if (!envelope || envelope.status !== 'success' || !envelope.value) {
    return corsResponse({
      error: 'upstream_error',
      detail: envelope?.errorMessage || envelope?.code || 'trutee_query_failed',
    });
  }

  const data = envelope.value;
  if (!data || !Array.isArray(data.teeTimes)) {
    return corsResponse({ error: 'trutee_schema_drift' });
  }

  return corsResponse(data);
}

/**
 * Parse Trutee `available_holes` ("9", "18", "9/18") into hole options to emit.
 */
export function truteeAvailableHoles(raw) {
  return String(raw || '')
    .split('/')
    .map((part) => parseInt(part.trim(), 10))
    .filter((h) => h === 9 || h === 18);
}

/**
 * Trutee fees are cents. Fan out one row per bookable hole option on the slot
 * (Sunbrook "9/18" → 9h + 18h rows; Dixie "9" → single 9h row).
 */
export function normalizeTruteeTimesWorker(course, data) {
  if (!data || typeof data !== 'object' || data.error) return [];
  const teeTimes = data.teeTimes;
  if (!Array.isArray(teeTimes)) return [];
  const wantCourse = String(course?.trutee_course_id || '').trim();
  const rows = [];
  for (const tt of teeTimes) {
    if (!tt || typeof tt !== 'object') continue;
    if (wantCourse && tt.course_id && String(tt.course_id) !== wantCourse) continue;
    const spots = tt.available_spots != null ? Number(tt.available_spots) : null;
    if (spots != null && (!Number.isFinite(spots) || spots <= 0)) continue;
    const startDate = String(tt.start_date || '').trim();
    const startTime = String(tt.start_time || '').trim();
    if (!startTime) continue;
    const rawTime = startDate ? `${startDate} ${startTime}` : startTime;
    const holeOptions = truteeAvailableHoles(tt.available_holes);
    if (holeOptions.length === 0) continue;
    for (const holes of holeOptions) {
      const cents = Number(holes === 9 ? tt.green_fee_9 : tt.green_fee_18);
      rows.push({
        rawTime,
        spots: spots != null && Number.isFinite(spots) ? spots : null,
        price: Number.isFinite(cents) ? '$' + Math.round(cents / 100) : null,
        holes,
      });
    }
  }
  return rows;
}

// GolfPay — public Laravel JSON. Course id is `_gshcid` / data-course-id (Barn = 1466).
const GOLFPAY_TEE_TIMES = 'https://golfpay.co/api/tee-times';
const GOLFPAY_USER_AGENT = 'TeeTimeIO/1.0 (+https://tee-time.io)';

export function golfPayCourseId(course) {
  const explicit = course?.golfpay_course_id != null ? String(course.golfpay_course_id).trim() : '';
  if (explicit) return explicit;
  const fromTemplate = String(course?.booking_url_template || '').match(/[?&]_gshcid=(\d+)/i);
  if (fromTemplate) return fromTemplate[1];
  const fromUrl = String(course?.booking_url || '').match(/[?&]_gshcid=(\d+)/i);
  return fromUrl ? fromUrl[1] : '';
}

async function handleGolfPay(params) {
  const { course_id, date } = params;
  if (!course_id || !date) {
    return corsResponse({ error: 'missing_params' });
  }

  const url = new URL(GOLFPAY_TEE_TIMES);
  url.searchParams.set('course_id', String(course_id));
  url.searchParams.set('date', String(date));

  let res;
  try {
    // GolfPay’s Laravel tee-times endpoint often takes 15–30s cold.
    res = await fetchWithTimeout(url.toString(), {
      headers: {
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'User-Agent': GOLFPAY_USER_AGENT,
      },
    }, 30000);
  } catch (err) {
    if (err.message === 'timeout') return corsResponse({ error: 'timeout' });
    return corsResponse({ error: 'upstream_error' });
  }

  if (!res.ok) {
    return corsResponse({ error: 'upstream_error', status: res.status });
  }

  let data;
  try {
    data = await res.json();
  } catch {
    return corsResponse({ error: 'parse_error' });
  }

  if (!data || typeof data !== 'object' || !data.data || !Array.isArray(data.data.times)) {
    return corsResponse({ error: 'golfpay_schema_drift' });
  }

  return corsResponse(data);
}

/**
 * Skip online-blocked placeholders ($1.00). Prefer lowest public price when the
 * same wall-clock + holes appears twice (rate variants).
 */
export function normalizeGolfPayTimesWorker(_course, data) {
  if (!data || typeof data !== 'object' || data.error) return [];
  const times = data?.data?.times;
  if (!Array.isArray(times)) return [];
  const best = new Map();
  for (const tt of times) {
    if (!tt || typeof tt !== 'object') continue;
    if (tt.is_online_block) continue;
    const holesRaw = Number(tt.number_of_holes);
    const holes = holesRaw === 9 ? 9 : holesRaw === 18 ? 18 : null;
    if (!holes) continue;
    const local = String(tt.local_tee_time || '').trim();
    // "2026-08-14 06:30:00" → "2026-08-14 06:30"
    const rawTime = local.replace(/:\d{2}$/, '');
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(rawTime)) continue;
    const priceNum = Number(tt.booking_golfer_price ?? tt.regular_golfer_price);
    if (!Number.isFinite(priceNum) || priceNum <= 1) continue;
    // Prefer remaining spots from the provider slot when present; otherwise capacity.
    const availRaw = tt.provider_data?.tee_time_slot?.availableSpots;
    const spotsRaw =
      availRaw != null
        ? Number(availRaw)
        : tt.max_allowed_golfers != null
          ? Number(tt.max_allowed_golfers)
          : null;
    const spots = spotsRaw != null && Number.isFinite(spotsRaw) ? spotsRaw : null;
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
  return [...best.values()].map(({ _priceNum, ...row }) => row);
}

// ── Supabase + Resend config (set via wrangler secrets) ──────────────
// env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, env.RESEND_API_KEY

// ── Courses list (registry in Supabase, else static JSON) ─────────────
let coursesCache = null;
let coursesCacheAt = 0;
const COURSES_CACHE_MS = 60_000;

async function loadCourses(env) {
  if (coursesCache && Date.now() - coursesCacheAt < COURSES_CACHE_MS) {
    return coursesCache;
  }

  if (env.SUPABASE_SERVICE_KEY) {
    try {
      const rows = await fetchRegistryCourses(env);
      if (rows.length > 0) {
        coursesCache = registryRowsToCourses(rows);
        coursesCacheAt = Date.now();
        return coursesCache;
      }
    } catch {
      // fall through to static JSON
    }
  }

  const res = await fetch('https://tee-time.io/courses.json');
  coursesCache = withDerivedState(await res.json());
  coursesCacheAt = Date.now();
  return coursesCache;
}

// ── Normalize helpers (duplicated from app.html for worker context) ──
function normalizeForeUpTimesWorker(data, holes) {
  if (!Array.isArray(data)) return [];
  const requested = parseInt(holes, 10);
  const fallbackHoles = requested === 9 ? 9 : 18;
  return data
    .map(t => {
      const holesNum = Number(t.holes);
      const rowHoles = holesNum === 9 || holesNum === 18 ? holesNum : fallbackHoles;
      const spotsSide =
        rowHoles === 9
          ? t.available_spots_9
          : t.available_spots_18;
      const spotsRaw = spotsSide != null && spotsSide !== '' ? spotsSide : t.available_spots;
      const spots =
        typeof spotsRaw === 'number' && Number.isFinite(spotsRaw)
          ? spotsRaw
          : spotsRaw != null && spotsRaw !== ''
            ? Number(spotsRaw)
            : null;
      return {
        rawTime: t.time || '',
        spots: spots != null && Number.isFinite(spots) ? spots : null,
        price: t.green_fee != null && t.green_fee !== '' ? '$' + parseFloat(t.green_fee).toFixed(0) : null,
        holes: rowHoles,
      };
    })
    .filter(t => t.spots == null || t.spots > 0)
    // ForeUp sometimes returns 9-hole rows on an holes=18 request (or vice versa).
    .filter(t => t.holes === fallbackHoles);
}

function normalizeChronogolfTimesWorker(data) {
  const items = data?.teetimes;
  if (!Array.isArray(items)) return [];
  return items
    .map(t => {
      const spots = t.max_player_size != null ? Number(t.max_player_size) : null;
      return {
        rawTime: t.start_time || '',
        spots: spots != null && Number.isFinite(spots) ? spots : null,
        price: t.default_price?.green_fee != null ? '$' + parseFloat(t.default_price.green_fee).toFixed(0) : null,
        holes: t.default_price?.bookable_holes ?? t.course?.holes,
      };
    })
    .filter(t => t.spots == null || t.spots > 0);
}

function normalizeChronogolfSlcTimesWorker(data, holes) {
  if (!Array.isArray(data)) return [];
  const nh = parseInt(holes, 10) || 18;
  return data
    .filter((t) => {
      if (t.out_of_capacity || t.frozen) return false;
      // Unpriced rows are restricted for our public affiliation; Chronogolf hides them.
      const fee = Number(t.green_fees?.[0]?.green_fee);
      return Number.isFinite(fee) && fee > 0;
    })
    .map((t) => {
      const fee = Number(t.green_fees[0].green_fee);
      return {
        rawTime: t.start_time || '',
        spots: null,
        price: '$' + Math.round(fee),
        holes: nh,
      };
    });
}

function normalizeMemberSportsTimesWorker(data, holes) {
  if (!Array.isArray(data)) return [];
  const requestedHoles = parseInt(holes, 10);
  const result = [];
  for (const slot of data) {
    if (!slot.items?.length) continue;
    for (const item of slot.items) {
      if (item.hide || item.bookingNotAllowed) continue;
      const itemHoles = (item.holesRequirementTypeId !== 1 && !item.isBackNine) ? 18 : 9;
      if (itemHoles !== requestedHoles) continue;
      const availableSpots = 4 - (item.playerCount || 0);
      if (availableSpots <= 0) continue;
      const h = Math.floor(slot.teeTime / 60);
      const m = slot.teeTime % 60;
      const rawTime = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
      result.push({ rawTime, spots: availableSpots, price: item.price ? '$' + parseFloat(item.price).toFixed(0) : null, holes: itemHoles });
    }
  }
  return result;
}

/**
 * TeeItUp `teetime` is UTC ISO. The shared diff pipeline treats `rawTime` as
 * course wall clock, so render the instant in the course timezone first
 * ("YYYY-MM-DD HH:MM"). Defaults to America/Denver for Utah catalog courses.
 */
export function utcIsoToMtLocal(iso, timeZone = 'America/Denver') {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: String(timeZone || '').trim() || 'America/Denver',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value ?? '';
  const hh = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}-${get('month')}-${get('day')} ${hh}:${get('minute')}`;
}

/**
 * TeeItUp fan-out: emit one normalized row PER RATE (Palisade returns a 9-hole
 * AND an 18-hole rate on the same tee time). greenFeeCart is CENTS and is the
 * "Non-Utah Resident" price; the shared pipeline stores whole dollars via
 * parsePriceCents, so pass a dollar string. maxPlayers = open spots remaining.
 */
export function normalizeTeeItUpTimesWorker(course, data) {
  if (!Array.isArray(data)) return [];
  const wantHash = String(course?.teeitup_course_id || '').trim();
  const tz = String(course?.timezone || '').trim() || 'America/Denver';
  const rows = [];
  for (const entry of data) {
    if (!entry || !Array.isArray(entry.teetimes)) continue;
    if (wantHash && entry.courseId && entry.courseId !== wantHash) {
      // Aspira tenant returns sibling courses; log unmapped ids loudly, skip.
      console.warn(`[poll] teeitup unmapped courseId in response: ${entry.courseId}`);
      continue;
    }
    for (const tt of entry.teetimes) {
      const localTime = utcIsoToMtLocal(tt.teetime, tz);
      if (!localTime) continue;
      const spots = tt.maxPlayers != null ? tt.maxPlayers : null;
      if (spots != null && (!(Number.isFinite(Number(spots))) || Number(spots) <= 0)) continue;
      for (const rate of tt.rates || []) {
        const cents = Number(rate.greenFeeCart);
        rows.push({
          rawTime: localTime,
          spots: spots != null && Number.isFinite(Number(spots)) ? Number(spots) : null,
          price: Number.isFinite(cents) ? '$' + Math.round(cents / 100) : null,
          holes: rate.holes === 9 ? 9 : 18,
        });
      }
    }
  }
  return rows;
}

function normalizeTimesWorker(course, data, holes) {
  if (!data || data.error) return [];
  switch (course.platform) {
    case 'foreup':         return normalizeForeUpTimesWorker(data, holes);
    case 'membersports':   return normalizeMemberSportsTimesWorker(data, holes);
    case 'chronogolf_slc': return normalizeChronogolfSlcTimesWorker(data, holes);
    case 'chronogolf':     return normalizeChronogolfTimesWorker(data);
    case 'teeitup':        return normalizeTeeItUpTimesWorker(course, data);
    case 'trutee':         return normalizeTruteeTimesWorker(course, data);
    case 'golfpay':        return normalizeGolfPayTimesWorker(course, data);
    case 'quick18':        return normalizeQuick18TimesWorker(course, data);
    case 'golfwithaccess': return normalizeGolfWithAccessTimesWorker(course, data);
    case 'clubcaddie':     return normalizeClubCaddieTimesWorker(course, data);
    case 'teesnap':        return normalizeTeeSnapTimesWorker(course, data);
    case 'golfrev':        return normalizeGolfRevTimesWorker(course, data);
    default:
      if (courseHasQuick18Sheet(course)) return normalizeQuick18TimesWorker(course, data);
      if (courseHasGolfWithAccess(course)) return normalizeGolfWithAccessTimesWorker(course, data);
      if (courseHasClubCaddie(course)) return normalizeClubCaddieTimesWorker(course, data);
      if (courseHasTeeSnap(course)) return normalizeTeeSnapTimesWorker(course, data);
      if (courseHasGolfRev(course)) return normalizeGolfRevTimesWorker(course, data);
      return [];
  }
}

/** Proxy Google Places photos using a stable photo_reference (CDN URLs in catalog expire). */
async function handlePlacePhoto(params, env) {
  const ref = String(params.reference || params.photo_reference || '').trim();
  if (!ref || ref.length > 512 || /[\s<>"']/.test(ref)) {
    return corsResponse({ error: 'invalid_reference' }, 400);
  }
  if (!env.GOOGLE_PLACES_KEY) {
    return corsResponse({ error: 'photo_unconfigured' }, 503);
  }

  const maxwidth = Math.min(1600, Math.max(100, parseInt(params.maxwidth, 10) || 800));
  const googleUrl =
    `https://maps.googleapis.com/maps/api/place/photo?maxwidth=${maxwidth}` +
    `&photo_reference=${encodeURIComponent(ref)}&key=${env.GOOGLE_PLACES_KEY}`;

  let res;
  try {
    res = await fetchWithTimeout(googleUrl, { redirect: 'follow' }, 10000);
  } catch {
    return new Response('Photo upstream timeout', { status: 504, headers: IMAGE_CORS_HEADERS });
  }

  if (!res.ok) {
    return new Response('Photo not found', {
      status: res.status === 404 ? 404 : 502,
      headers: IMAGE_CORS_HEADERS,
    });
  }

  return new Response(res.body, {
    status: 200,
    headers: {
      ...IMAGE_CORS_HEADERS,
      'Content-Type': res.headers.get('Content-Type') || 'image/jpeg',
      'Cache-Control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400',
    },
  });
}

const PLACE_REVIEWS_CACHE_MS = 6 * 60 * 60 * 1000;
const placeReviewsCache = new Map();

function stripReviewHtml(text) {
  return String(text || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/**
 * Newest Google reviews for a course (Places Details, max 5).
 * Resolves place_id via Text Search when not provided.
 */
async function handlePlaceReviews(params, env) {
  if (!env.GOOGLE_PLACES_KEY) {
    return corsResponse({ error: 'places_unconfigured' }, 503);
  }

  const name = String(params.name || '').trim().slice(0, 200);
  const lat = Number(params.lat);
  const lng = Number(params.lng);
  let placeId = String(params.place_id || '').trim();
  if (placeId && !/^[\w-]+$/.test(placeId)) {
    return corsResponse({ error: 'invalid_place_id' }, 400);
  }

  if (!placeId && !name) {
    return corsResponse({ error: 'missing_name' }, 400);
  }

  const cacheKey = placeId
    ? `id:${placeId}`
    : `q:${name}|${Number.isFinite(lat) ? lat.toFixed(4) : ''}|${Number.isFinite(lng) ? lng.toFixed(4) : ''}`;
  const cached = placeReviewsCache.get(cacheKey);
  if (cached && Date.now() - cached.at < PLACE_REVIEWS_CACHE_MS) {
    return new Response(JSON.stringify(cached.body), {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        'Cache-Control': 'public, max-age=3600, s-maxage=21600',
      },
    });
  }

  try {
    if (!placeId) {
      let searchUrl =
        `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(`${name} golf course`)}` +
        `&key=${env.GOOGLE_PLACES_KEY}`;
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        searchUrl += `&location=${lat},${lng}&radius=8000`;
      }
      const searchRes = await fetchWithTimeout(searchUrl, {}, 8000);
      const searchData = await searchRes.json();
      if (searchData.status !== 'OK' || !searchData.results?.[0]?.place_id) {
        return corsResponse({ error: 'not_found', reviews: [] }, 404);
      }
      placeId = searchData.results[0].place_id;
    }

    const detailsUrl =
      `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}` +
      `&fields=name,rating,user_ratings_total,url,reviews` +
      `&reviews_sort=newest&key=${env.GOOGLE_PLACES_KEY}`;
    const detailsRes = await fetchWithTimeout(detailsUrl, {}, 8000);
    const detailsData = await detailsRes.json();
    if (detailsData.status !== 'OK' || !detailsData.result) {
      return corsResponse({ error: 'details_failed', status: detailsData.status || 'UNKNOWN' }, 502);
    }

    const result = detailsData.result;
    const reviews = (result.reviews || [])
      .map((r) => ({
        author: r.author_name || 'Google user',
        authorUrl: r.author_url || null,
        profilePhotoUrl: r.profile_photo_url || null,
        rating: typeof r.rating === 'number' ? r.rating : null,
        relativeTime: r.relative_time_description || null,
        time: typeof r.time === 'number' ? r.time : null,
        text: stripReviewHtml(r.text),
        language: r.language || null,
      }))
      .sort((a, b) => (b.time || 0) - (a.time || 0));

    const body = {
      placeId,
      name: result.name || name || null,
      rating: result.rating ?? null,
      reviewCount: result.user_ratings_total ?? null,
      mapsUrl: result.url || null,
      sort: 'newest',
      reviews,
    };

    placeReviewsCache.set(cacheKey, { at: Date.now(), body });
    if (placeId) placeReviewsCache.set(`id:${placeId}`, { at: Date.now(), body });

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        'Cache-Control': 'public, max-age=3600, s-maxage=21600',
      },
    });
  } catch (err) {
    if (err?.message === 'timeout') return corsResponse({ error: 'timeout' }, 504);
    return corsResponse({ error: 'upstream_error' }, 502);
  }
}

// formatTime12h imported from alertCopy.js

// ── Fetch tee times for a course (reuses existing API logic) ─────────
// Supported live platforms: foreup | chronogolf | chronogolf_slc | membersports | teeitup | trutee | golfpay | quick18 | golfwithaccess | clubcaddie | teesnap | golfrev.
// Add handlers here + GET routes in fetch() when onboarding new vendors.
async function fetchTimesForCourse(course, date, holes, players) {
  const params = new URLSearchParams({ date });
  let handler;

  if (course.platform === 'foreup') {
    params.set('schedule_id', course.schedule_id);
    if (course.booking_class_id) params.set('booking_class_id', course.booking_class_id);
    const facilityId = foreupFacilityIdFromCourse(course);
    if (facilityId) params.set('facility_id', facilityId);
    params.set('holes', holes);
    handler = () => handleForeUp(Object.fromEntries(params.entries()), null);
  } else if (course.platform === 'chronogolf') {
    if (!course.course_ids) return null;
    params.set('course_ids', course.course_ids.join(','));
    handler = () => handleChronogolf(Object.fromEntries(params.entries()));
  } else if (course.platform === 'membersports') {
    params.set('golf_club_id', course.golf_club_id);
    params.set('golf_course_id', course.golf_course_id);
    handler = () => handleMemberSports(Object.fromEntries(params.entries()));
  } else if (course.platform === 'chronogolf_slc') {
    const courseIds = chronogolfSlcCourseIds(course);
    if (!course.club_id || !courseIds.length || !course.affiliation_type_id) return null;
    params.set('club_id', course.club_id);
    params.set('course_id', courseIds.join(','));
    params.set('affiliation_type_id', course.affiliation_type_id);
    params.set('nb_holes', holes);
    params.set('players', players);
    handler = () => handleChronogolfSlc(Object.fromEntries(params.entries()));
  } else if (course.platform === 'teeitup') {
    // One facility per course; the shared endpoint returns all rates (9 + 18).
    if (!course.facility_id) return null;
    params.set('facility_id', String(course.facility_id));
    params.set('alias', teeItUpAlias(course));
    handler = () => handleTeeItUp(Object.fromEntries(params.entries()));
  } else if (course.platform === 'trutee') {
    if (!course.trutee_course_id) return null;
    params.set('course_id', String(course.trutee_course_id));
    handler = () => handleTrutee(Object.fromEntries(params.entries()));
  } else if (course.platform === 'golfpay') {
    const gpId = golfPayCourseId(course);
    if (!gpId) return null;
    params.set('course_id', gpId);
    handler = () => handleGolfPay(Object.fromEntries(params.entries()));
  } else if (courseHasQuick18Sheet(course)) {
    const tenant = quick18Tenant(course);
    if (!tenant) return null;
    params.set('tenant', tenant);
    const sheetHost = quick18SheetHost(course);
    if (sheetHost) params.set('host', sheetHost);
    const q18Course = quick18CourseId(course);
    if (q18Course) params.set('course_id', q18Course);
    handler = () => handleQuick18(Object.fromEntries(params.entries()));
  } else if (courseHasGolfWithAccess(course)) {
    const gwaId = golfWithAccessCourseId(course);
    const gwaSlug = golfWithAccessFacilitySlug(course);
    if (!gwaId && !gwaSlug) return null;
    if (gwaId) params.set('course_id', gwaId);
    if (gwaSlug) params.set('slug', gwaSlug);
    params.set('players', String(players || 4));
    handler = () => handleGolfWithAccess(Object.fromEntries(params.entries()));
  } else if (courseHasClubCaddie(course)) {
    const host = clubCaddieHost(course);
    const apiKey = clubCaddieApiKey(course);
    if (!host || !apiKey) return null;
    params.set('host', host);
    params.set('apikey', apiKey);
    const ccId = clubCaddieCourseId(course);
    if (ccId) params.set('course_id', ccId);
    params.set('players', String(players || 1));
    handler = () => handleClubCaddie(Object.fromEntries(params.entries()));
  } else if (courseHasTeeSnap(course)) {
    const tenant = teeSnapTenant(course);
    if (!tenant) return null;
    params.set('tenant', tenant);
    const tsId = teeSnapCourseId(course);
    if (tsId) params.set('course_id', tsId);
    params.set('players', String(players || 4));
    handler = () => handleTeeSnap(Object.fromEntries(params.entries()));
  } else if (courseHasGolfRev(course)) {
    const grId = golfRevCourseId(course);
    const grHtc = golfRevHtc(course);
    if (!grId || !grHtc) return null;
    params.set('course_id', grId);
    params.set('htc', grHtc);
    handler = () => handleGolfRev(Object.fromEntries(params.entries()));
  } else {
    return null; // unsupported platform (tenfore, foreup_login)
  }

  try {
    const response = await handler();
    const data = await response.json();
    return data;
  } catch {
    return null;
  }
}

// ── Build booking URL ────────────────────────────────────────────────
function foreupDateUs(ymd) {
  const [y, m, d] = String(ymd || '').split('-');
  if (!y || !m || !d) return ymd;
  return `${m}-${d}-${y}`;
}

function applyBookingTemplate(template, date, holes, players) {
  const holesStr = String(holes === 9 || holes === '9' ? 9 : 18);
  const playersStr = String(Math.min(Math.max(parseInt(players, 10) || 1, 1), 4));
  return template
    .replace(/\{date\}/g, date)
    .replace(/\{date_us\}/g, foreupDateUs(date))
    .replace(/\{players\}/g, playersStr)
    .replace(/\{holes\}/g, holesStr)
    .replace(/\{time\}/g, '');
}

function parseForeUpIds(url, scheduleFromRecord) {
  const hostMatch = String(url || '').match(/https?:\/\/([^/]+)/i);
  const host = hostMatch?.[1] || 'foreupsoftware.com';
  const path = String(url || '').split('#')[0] || '';

  const facilitySchedule = path.match(/\/booking\/(\d+)\/(\d+)/);
  if (facilitySchedule) {
    return {
      facilityId: facilitySchedule[1],
      scheduleId: scheduleFromRecord || facilitySchedule[2],
      host,
    };
  }
  const indexFacility = path.match(/\/booking\/index\/(\d+)/);
  if (indexFacility) {
    return { facilityId: indexFacility[1], scheduleId: scheduleFromRecord || null, host };
  }
  const facilityOnly = path.match(/\/booking\/(\d+)(?:\/?#|$|\?)/);
  if (facilityOnly) {
    return { facilityId: facilityOnly[1], scheduleId: scheduleFromRecord || null, host };
  }
  return { facilityId: null, scheduleId: scheduleFromRecord || null, host };
}

function ensureForeUpDateOnTeeSheet(url, date, holes, players, scheduleId, bookingClassId) {
  const beforeHash = String(url || '').trim().replace(/#.*$/, '').replace(/\/$/, '');
  const dateUs = foreupDateUs(date);
  const playersStr = String(Math.min(Math.max(parseInt(players, 10) || 1, 1), 4));
  const holesStr = String(holes === 9 || holes === '9' ? 9 : 18);

  try {
    const u = new URL(beforeHash);
    u.searchParams.set('date', dateUs);
    u.searchParams.set('players', playersStr);
    u.searchParams.set('holes', holesStr);
    if (scheduleId) u.searchParams.set('schedule_id', String(scheduleId));
    if (bookingClassId) u.searchParams.set('booking_class_id', String(bookingClassId));
    return `${u.toString().replace(/\/$/, '')}#/teetimes`;
  } catch {
    const q = new URLSearchParams({
      date: dateUs,
      players: playersStr,
      holes: holesStr,
    });
    if (scheduleId) q.set('schedule_id', String(scheduleId));
    if (bookingClassId) q.set('booking_class_id', String(bookingClassId));
    const sep = beforeHash.includes('?') ? '&' : '?';
    return `${beforeHash}${sep}${q.toString()}#/teetimes`;
  }
}

function buildForeUpTeeSheetUrl(course, date, holes, players) {
  const bookingUrl = String(course.booking_url || '').trim();
  const templateOverride = String(course.booking_url_template || '').trim();
  const scheduleId = course.schedule_id != null ? String(course.schedule_id).trim() : '';
  const bookingClassId = course.booking_class_id != null ? String(course.booking_class_id).trim() : '';
  const parseFrom = templateOverride || bookingUrl;
  const ids = parseForeUpIds(parseFrom, scheduleId || null);
  const resolvedSchedule = ids.scheduleId || scheduleId || null;
  const resolvedClass = bookingClassId || null;

  if (ids.facilityId && resolvedSchedule) {
    return ensureForeUpDateOnTeeSheet(
      `https://${ids.host}/index.php/booking/${ids.facilityId}/${resolvedSchedule}`,
      date,
      holes,
      players,
      resolvedSchedule,
      resolvedClass,
    );
  }

  if (templateOverride && !/\/booking\/index\//i.test(templateOverride)) {
    let sheet = templateOverride.includes('{')
      ? applyBookingTemplate(templateOverride, date, holes, players)
      : templateOverride;
    return ensureForeUpDateOnTeeSheet(sheet, date, holes, players, resolvedSchedule, resolvedClass);
  }

  if (ids.facilityId) {
    return ensureForeUpDateOnTeeSheet(
      `https://${ids.host}/index.php/booking/${ids.facilityId}`,
      date,
      holes,
      players,
      resolvedSchedule,
      resolvedClass,
    );
  }
  if (bookingUrl && /foreupsoftware\.com/i.test(bookingUrl) && !/\/booking\/index\//i.test(bookingUrl)) {
    return ensureForeUpDateOnTeeSheet(bookingUrl, date, holes, players, resolvedSchedule, resolvedClass);
  }
  return bookingUrl || null;
}

/** Numeric /club/{id} 308s to a slug and drops query params — remap known IDs. */
const CHRONOGOLF_CLUB_SLUGS = {
  '14158': 'bonneville-golf-course',
  '14180': 'forest-dale-golf-course',
  '14185': 'glendale-golf-course',
  '14203': 'mountain-dell-golf-club',
  '14207': 'nibley-park-golf-course',
  '14222': 'rose-park-golf-course',
  '14225': 'sand-hollow-resort',
  '14257': 'the-ledges-golf-club',
};

function chronogolfClubBase(url) {
  const cleaned = String(url || '').replace(/[?#].*$/, '').replace(/\/$/, '');
  const withoutBooking = cleaned.replace(/\/booking$/i, '');
  const m = withoutBooking.match(/^(https?:\/\/(?:www\.)?chronogolf\.com\/club\/)(\d+)$/i);
  if (!m) return withoutBooking;
  const slug = CHRONOGOLF_CLUB_SLUGS[m[2]];
  return slug ? `${m[1]}${slug}` : withoutBooking;
}

function buildChronogolfTeeTimesUrl(course, date, holes, players) {
  const bookingUrl = String(course.booking_url || '').trim();
  const templateOverride = String(course.booking_url_template || '').trim();

  if (templateOverride.includes('{')) {
    return applyBookingTemplate(templateOverride, date, holes, players);
  }

  const base = chronogolfClubBase(bookingUrl || templateOverride);
  if (!base) return null;

  const playersStr = String(Math.min(Math.max(parseInt(players, 10) || 1, 1), 4));
  const holesStr = String(holes === 9 || holes === '9' ? 9 : 18);
  // Empty coursesIds — catalog course_id can make Chronogolf show "released shortly".
  const courseId = '';

  try {
    const u = new URL(base);
    u.searchParams.set('date', date);
    u.searchParams.set('players', playersStr);
    u.searchParams.set('step', 'teetimes');
    u.searchParams.set('holes', holesStr);
    u.searchParams.set('coursesIds', courseId);
    u.searchParams.set('deals', 'false');
    u.searchParams.set('groupSize', playersStr);
    return u.toString();
  } catch {
    const q = new URLSearchParams({
      date,
      players: playersStr,
      step: 'teetimes',
      holes: holesStr,
      coursesIds: courseId,
      deals: 'false',
      groupSize: playersStr,
    });
    return `${base}?${q.toString()}`;
  }
}

function parseMemberSportsIds(url, course) {
  const fromUrl = String(url || '').match(
    /membersports\.com\/(?:tee-times|tee-sheet-linked|book-tee-time)\/(\d+)\/(\d+)(?:\/(\d+))?/i,
  );
  const clubId =
    course.golf_club_id != null && String(course.golf_club_id).trim()
      ? String(course.golf_club_id).trim()
      : fromUrl?.[1] ?? '';
  const courseId =
    course.golf_course_id != null && String(course.golf_course_id).trim()
      ? String(course.golf_course_id).trim()
      : fromUrl?.[2] ?? '';
  const configType = fromUrl?.[3] ?? '0';
  if (!clubId || !courseId) return null;
  return { clubId, courseId, configType };
}

function buildMemberSportsTeeTimesUrl(course, date) {
  const bookingUrl = String(course.booking_url || '').trim();
  const ids = parseMemberSportsIds(bookingUrl, course);
  if (!ids) return bookingUrl || null;
  return `https://app.membersports.com/tee-sheet-linked/${ids.clubId}/${ids.courseId}/${ids.configType}/0/false/${date}`;
}

function buildTruteeBookingUrl(course, date, holes, players) {
  const orgSlug =
    course.trutee_org_slug != null && String(course.trutee_org_slug).trim()
      ? String(course.trutee_org_slug).trim()
      : '';
  const courseKey =
    course.trutee_course_id != null && String(course.trutee_course_id).trim()
      ? String(course.trutee_course_id).trim()
      : '';
  let base = String(course.booking_url || '').trim();
  if (!base && orgSlug && courseKey) {
    base = `https://trutee.app/courses/o/${orgSlug}?course=${encodeURIComponent(courseKey)}`;
  }
  if (!base) return null;

  const playersStr = String(Math.min(Math.max(parseInt(players, 10) || 1, 1), 4));
  const holesStr = String(holes === 9 || holes === '9' ? 9 : 18);
  try {
    const u = new URL(base.split('#')[0] || base);
    if (courseKey) u.searchParams.set('course', courseKey);
    u.searchParams.set('date', date);
    u.searchParams.set('players', playersStr);
    u.searchParams.set('holes', holesStr);
    return u.toString();
  } catch {
    return base;
  }
}

function buildTeeItUpBookingUrl(course, date, holes, players) {
  const facilityId =
    course.facility_id != null && String(course.facility_id).trim()
      ? String(course.facility_id).trim()
      : '';
  // The tenant's booking host varies (book-v2.teeitup.golf vs book.teeitup.com);
  // the widget reads course, date, golfers, and holes from the query string.
  let base = String(course.booking_url || '').trim();
  if (!base && facilityId) {
    base = `https://${TEEITUP_ALIAS}.book-v2.teeitup.golf/?course=${facilityId}`;
  }
  if (!base) return null;
  const playersStr = String(Math.min(Math.max(parseInt(players, 10) || 1, 1), 4));
  const holesNum = parseInt(String(holes), 10);
  try {
    const u = new URL(base.split('#')[0] || base);
    if (facilityId) u.searchParams.set('course', facilityId);
    u.searchParams.set('date', date);
    u.searchParams.set('golfers', playersStr);
    if (holesNum === 9 || holesNum === 18) u.searchParams.set('holes', String(holesNum));
    else u.searchParams.delete('holes');
    return u.toString();
  } catch {
    return base;
  }
}

function buildGolfPayBookingUrl(course, date, holes, players) {
  const base = String(course.booking_url || '').trim();
  if (!base) return null;
  const playersStr = String(Math.min(Math.max(parseInt(players, 10) || 1, 1), 4));
  const holesNum = parseInt(String(holes), 10);
  try {
    const u = new URL(base.split('#')[0] || base);
    u.searchParams.set('date', date);
    u.searchParams.set('players', playersStr);
    if (holesNum === 9 || holesNum === 18) u.searchParams.set('holes', String(holesNum));
    if (!u.searchParams.has('sort')) u.searchParams.set('sort', 'lowest_price');
    return u.toString();
  } catch {
    return base;
  }
}

function buildCpsBookingUrl(course, date, holes, players) {
  const tenant = course?.cps_tenant != null ? String(course.cps_tenant).trim() : '';
  let base = String(course.booking_url || '').trim();
  if (!base && tenant) base = `https://${tenant}.cps.golf/onlineresweb/search-teetime`;
  if (!base) return null;
  const playersNum = Math.min(Math.max(parseInt(players, 10) || 1, 1), 4);
  const holesNum = parseInt(String(holes), 10);
  try {
    const u = new URL(base.split('#')[0] || base);
    u.searchParams.set('Date', date);
    u.searchParams.set('Player', String(playersNum));
    u.searchParams.set('Hole', holesNum === 9 || holesNum === 18 ? String(holesNum) : 'Any');
    const courseId =
      course?.cps_course_id != null && String(course.cps_course_id).trim()
        ? String(course.cps_course_id).trim()
        : u.searchParams.get('CourseId') || '';
    if (courseId) u.searchParams.set('CourseId', courseId);
    if (!u.searchParams.has('TeeOffTimeMin')) u.searchParams.set('TeeOffTimeMin', '0');
    if (!u.searchParams.has('TeeOffTimeMax')) u.searchParams.set('TeeOffTimeMax', '23');
    return u.toString();
  } catch {
    return base;
  }
}

function buildBookingUrlWorker(course, date, holes, players) {
  const base = course.booking_url;
  const supported = [
    'foreup',
    'foreup_login',
    'chronogolf',
    'chronogolf_slc',
    'membersports',
    'trutee',
    'golfpay',
    'cps',
    'teeitup',
    'quick18',
    'golfwithaccess',
    'clubcaddie',
    'teesnap',
    'golfrev',
  ];
  if (!base && !supported.includes(course.platform) && !courseHasQuick18Sheet(course) && !courseHasGolfWithAccess(course) && !courseHasClubCaddie(course) && !courseHasTeeSnap(course) && !courseHasGolfRev(course)) {
    return 'https://tee-time.io';
  }

  if (course.platform === 'foreup' || course.platform === 'foreup_login') {
    return buildForeUpTeeSheetUrl(course, date, holes, players) || base || 'https://tee-time.io';
  }

  if (course.platform === 'chronogolf' || course.platform === 'chronogolf_slc') {
    return buildChronogolfTeeTimesUrl(course, date, holes, players) || base || 'https://tee-time.io';
  }

  if (course.platform === 'membersports') {
    return buildMemberSportsTeeTimesUrl(course, date) || base || 'https://tee-time.io';
  }

  if (course.platform === 'trutee') {
    return buildTruteeBookingUrl(course, date, holes, players) || base || 'https://tee-time.io';
  }

  if (course.platform === 'golfpay') {
    return buildGolfPayBookingUrl(course, date, holes, players) || base || 'https://tee-time.io';
  }

  if (course.platform === 'cps') {
    return buildCpsBookingUrl(course, date, holes, players) || base || 'https://tee-time.io';
  }

  if (course.platform === 'teeitup') {
    return buildTeeItUpBookingUrl(course, date, holes, players) || base || 'https://tee-time.io';
  }

  if (courseHasQuick18Sheet(course)) {
    return buildQuick18BookingUrl(course, date) || base || 'https://tee-time.io';
  }

  if (courseHasGolfWithAccess(course)) {
    return buildGolfWithAccessBookingUrl(course, date, players) || base || 'https://tee-time.io';
  }

  if (courseHasClubCaddie(course)) {
    return buildClubCaddieBookingUrl(course, date, players) || base || 'https://tee-time.io';
  }

  if (courseHasTeeSnap(course)) {
    return buildTeeSnapBookingUrl(course, date, players, holes) || base || 'https://tee-time.io';
  }

  if (courseHasGolfRev(course)) {
    return buildGolfRevBookingUrl(course, date, players) || base || 'https://tee-time.io';
  }

  const templateOverride = String(course.booking_url_template || '').trim();
  if (templateOverride) {
    return templateOverride.includes('{')
      ? applyBookingTemplate(templateOverride, date, holes, players)
      : templateOverride;
  }

  return base || 'https://tee-time.io';
}

function twilioConfigured(env) {
  return Boolean(
    env.TWILIO_ACCOUNT_SID &&
      env.TWILIO_AUTH_TOKEN &&
      env.TWILIO_FROM_NUMBER,
  );
}

// ── Send SMS via Twilio ──────────────────────────────────────────────
async function sendSms(env, toPhone, body) {
  if (!twilioConfigured(env)) return false;
  const creds = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);
  const form = new URLSearchParams();
  form.set('To', toPhone);
  form.set('From', env.TWILIO_FROM_NUMBER);
  form.set('Body', body);
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${creds}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    },
  );
  const detail = await res.text();
  let data;
  try {
    data = JSON.parse(detail);
  } catch {
    data = { raw: detail.slice(0, 300) };
  }
  if (!res.ok) {
    console.error(
      `[notifications] Twilio SMS failed HTTP ${res.status}: ${detail.slice(0, 800)}`,
    );
    return false;
  }
  console.log(
    `[notifications] Twilio SMS queued to=${toPhone} sid=${data.sid || '?'} status=${data.status || '?'}`,
  );
  return true;
}

function normalizePhone(phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (phone.startsWith('+')) return phone;
  return null;
}

// ── Build SMS alert ──────────────────────────────────────────────────
function buildAlertSms(course, times, date, players) {
  const bookingUrl = buildBookingUrlWorker(course, date, bookingHolesForSlots(times), players);
  return buildAlertSmsBody(course, times, date, players, 'opened', bookingUrl);
}

function resendConfigured(env) {
  return Boolean(env.RESEND_API_KEY);
}

// ── Send email via Resend ────────────────────────────────────────────
async function sendEmail(env, to, subject, html) {
  if (!resendConfigured(env)) return false;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Tee-Time.io <alerts@tee-time.io>',
      to: [to],
      subject,
      html,
    }),
  });
  const detail = await res.text();
  let data;
  try {
    data = JSON.parse(detail);
  } catch {
    data = { raw: detail.slice(0, 300) };
  }
  if (!res.ok) {
    console.error(
      `[notifications] Resend email failed HTTP ${res.status} to=${to}: ${detail.slice(0, 800)}`,
    );
    return false;
  }
  console.log(`[notifications] Resend email queued to=${to} id=${data.id || '?'}`);
  return true;
}

// ── Build notification email ─────────────────────────────────────────

function displayCourseNameEmail(name) {
  return displayCourseName(name);
}

function buildAlertEmail(course, times, date, players, options = {}) {
  const holes = bookingHolesForSlots(times);
  const bookingUrl = buildBookingUrlWorker(course, date, holes, String(players));
  return buildAlertEmailHtml(course, times, date, players, {
    ...options,
    bookingUrl,
  });
}

// ── Date helpers (UTC date strings YYYY-MM-DD) ─────────────────────────
function addDaysToYmd(ymd, addDays) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d + addDays);
  return new Date(t).toISOString().slice(0, 10);
}

function ymdUtcWeekday(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function findCourseByCatalogId(courses, courseId) {
  return courses.find((c) => c.name === courseId || c.catalogName === courseId) || null;
}

function sbHeaders(env, json = false) {
  const h = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
  };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

function twilioVerifyConfigured(env) {
  return Boolean(
    env.TWILIO_ACCOUNT_SID &&
      env.TWILIO_AUTH_TOKEN &&
      env.TWILIO_VERIFY_SERVICE_SID,
  );
}

/** Resolve Supabase user id from browser session JWT (Authorization: Bearer …). */
async function getUserIdFromAccessToken(env, request) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) {
    return { error: 'missing_auth', status: 401 };
  }
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      Authorization: auth,
      apikey: env.SUPABASE_ANON_KEY || '',
    },
  });
  if (!res.ok) {
    return { error: 'invalid_session', status: 401 };
  }
  const u = await res.json();
  if (!u?.id) return { error: 'invalid_session', status: 401 };
  return { userId: u.id };
}

function twilioBasicAuth(env) {
  return `Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}`;
}

async function handlePhoneVerifyStart(request, env) {
  if (!twilioVerifyConfigured(env)) {
    return corsResponse({ error: 'verify_not_configured' }, 503);
  }
  const auth = await getUserIdFromAccessToken(env, request);
  if (auth.error) return corsResponse({ error: auth.error }, auth.status || 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return corsResponse({ error: 'invalid_body' }, 400);
  }
  const raw = body.phone ?? body.phone_e164 ?? '';
  const phoneE164 = normalizePhone(String(raw));
  if (!phoneE164 || !phoneE164.startsWith('+1')) {
    return corsResponse({ error: 'invalid_phone', message: 'US mobile (+1) required' }, 400);
  }

  const form = new URLSearchParams();
  form.set('To', phoneE164);
  form.set('Channel', 'sms');
  const url = `https://verify.twilio.com/v2/Services/${env.TWILIO_VERIFY_SERVICE_SID}/Verifications`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: twilioBasicAuth(env),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text.slice(0, 300) };
  }
  if (!res.ok) {
    console.error('[phone-verify] Twilio start failed', res.status, text.slice(0, 500));
    return corsResponse(
      { error: 'twilio_error', message: data.message || data.code || 'verification_start_failed' },
      400,
    );
  }
  return corsResponse({ ok: true, status: data.status || 'pending' });
}

async function handlePhoneVerifyCheck(request, env) {
  if (!twilioVerifyConfigured(env)) {
    return corsResponse({ error: 'verify_not_configured' }, 503);
  }
  const auth = await getUserIdFromAccessToken(env, request);
  if (auth.error) return corsResponse({ error: auth.error }, auth.status || 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return corsResponse({ error: 'invalid_body' }, 400);
  }
  const raw = body.phone ?? body.phone_e164 ?? '';
  const phoneE164 = normalizePhone(String(raw));
  const code = String(body.code ?? '').replace(/\D/g, '');
  if (!phoneE164 || !phoneE164.startsWith('+1')) {
    return corsResponse({ error: 'invalid_phone' }, 400);
  }
  if (code.length < 4 || code.length > 10) {
    return corsResponse({ error: 'invalid_code' }, 400);
  }

  const form = new URLSearchParams();
  form.set('To', phoneE164);
  form.set('Code', code);
  const url = `https://verify.twilio.com/v2/Services/${env.TWILIO_VERIFY_SERVICE_SID}/VerificationCheck`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: twilioBasicAuth(env),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = {};
  }
  if (!res.ok) {
    console.error('[phone-verify] Twilio check HTTP', res.status, text.slice(0, 500));
    return corsResponse({ error: 'twilio_error', message: data.message || 'check_failed' }, 400);
  }
  if (data.status !== 'approved') {
    return corsResponse({ error: 'not_approved', status: data.status || 'denied' }, 400);
  }

  const verifiedAt = new Date().toISOString();
  const patchRes = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${auth.userId}`, {
    method: 'PATCH',
    headers: sbHeaders(env, true),
    body: JSON.stringify({ phone: phoneE164, phone_verified_at: verifiedAt }),
  });
  if (!patchRes.ok) {
    const errText = await patchRes.text();
    console.error('[phone-verify] profile PATCH failed', patchRes.status, errText.slice(0, 500));
    return corsResponse({ error: 'profile_update_failed' }, 500);
  }
  return corsResponse({ ok: true, phone: phoneE164, phone_verified_at: verifiedAt });
}

function createAlertContext(env, courses) {
  return {
    env,
    courses,
    sendSms,
    sendEmail,
    resendConfigured,
    buildAlertSms,
    buildAlertEmail,
    findCourseByCatalogId,
    buildBookingUrlWorker,
    sendWebPush,
    vapidConfigured,
  };
}

// ── Cron handler: backstop alerts (event path runs from poller) ───────
async function handleScheduled(env) {
  const courses = await loadCourses(env);
  await runNotificationBackstop(createAlertContext(env, courses), {
    fetchSnapshotNormalizedTimes,
    fetchTimesForCourse,
    normalizeTimesWorker,
  });
}

async function handlePollWithAlerts(env) {
  const courses = await loadCourses(env);
  const ctx = createAlertContext(env, courses);
  await handleAvailabilityPoll(env, {
    loadCourses: async () => courses,
    fetchTimesForCourse,
    normalizeTimesWorker,
    onPollNotifyEvents: (payload) => notifyOnPollEvents(ctx, payload),
  });
}

async function handleAlertMicroPollWithNotify(env) {
  const courses = await loadCourses(env);
  const ctx = createAlertContext(env, courses);
  await handleAlertMicroPoll(env, {
    loadCourses: async () => courses,
    fetchTimesForCourse,
    normalizeTimesWorker,
    onPollNotifyEvents: (payload) => notifyOnPollEvents(ctx, payload),
  });
}

/** POST /v1/alerts/check — poll watched date(s) right after a preference is created. */
async function handleAlertCreateCheck(request, env) {
  const auth = await getUserIdFromAccessToken(env, request);
  if (auth.error) return corsResponse({ error: auth.error }, auth.status || 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return corsResponse({ error: 'invalid_body' }, 400);
  }
  const preferenceId = body.preference_id || body.preferenceId;
  if (!preferenceId) return corsResponse({ error: 'missing_preference_id' }, 400);

  const pref = await loadPreferenceForUser(env, preferenceId, auth.userId);
  if (!pref || !pref.active) return corsResponse({ error: 'preference_not_found' }, 404);

  const courses = await loadCourses(env);
  const ctx = createAlertContext(env, courses);
  const course = findCourseByCatalogId(courses, pref.course_id);
  if (!course) return corsResponse({ error: 'course_not_found' }, 404);

  const courseWithSlug = { ...course, slug: slugFromCourseName(course.name) };
  const todayMt = (() => {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Denver',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = fmt.formatToParts(new Date());
    const get = (t) => parts.find((p) => p.type === t)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  })();

  const dates = evalDatesForPref(pref, todayMt);
  if (!dates.length) return corsResponse({ ok: true, checked: 0, reason: 'no_dates' });

  const onPollNotifyEvents = (payload) => notifyOnPollEvents(ctx, payload);
  let checked = 0;
  let inventoryNotified = 0;

  for (const playDate of dates) {
    const result = await pollAlertCourseDate(env, {
      course: courseWithSlug,
      playDate,
      fetchTimesForCourse,
      normalizeTimesWorker,
      onPollNotifyEvents,
      todayMt,
    });
    checked++;

    // Always offer already-open matching inventory (create-time backstop).
    const snapshot = await fetchSnapshotNormalizedTimes(
      env,
      courseWithSlug.slug,
      playDate,
      '18',
      pref.players || pref.min_spots || 1,
    );
    let times = snapshot.has_poll_coverage ? snapshot.times : null;
    if (!times) {
      const data = await fetchTimesForCourse(
        courseWithSlug,
        playDate,
        '18',
        String(pref.players || pref.min_spots || 1),
      );
      if (data && data !== false && !(typeof data === 'object' && data.error)) {
        times = normalizeTimesWorker(courseWithSlug, data, '18');
      }
    }
    if (times?.length) {
      const { sent } = await notifyPrefAgainstOpenInventory(ctx, {
        pref,
        playDate,
        times,
      });
      if (sent) inventoryNotified++;
    }

    if (result.status !== 'ok') {
      console.warn(`[alert-check] poll failed ${courseWithSlug.slug} ${playDate}:`, result.error_message);
    }
  }

  return corsResponse({ ok: true, checked, inventory_notified: inventoryNotified });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 200, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/foreup-login') {
      if (request.method !== 'POST') {
        return corsResponse({ error: 'method_not_allowed' }, 405);
      }
      return handleForeUpLogin(request);
    }

    if (path === '/account/phone/start' || path === '/account/phone/check') {
      return corsResponse(
        {
          error: 'sms_paused',
          message: 'SMS alerts are temporarily paused. Email alerts still work.',
        },
        503,
      );
    }

    if (path === '/v1/push/vapid-public-key' && request.method === 'GET') {
      const publicKey = getVapidPublicKey(env);
      if (!publicKey) {
        return corsResponse({ error: 'vapid_not_configured' }, 503);
      }
      return corsResponse({ publicKey });
    }

    if (path === '/v1/courses' && request.method === 'GET') {
      return cachedGetResponse(request, 120, async () => {
        const courses = await loadCourses(env);
        return corsResponse(courses);
      });
    }

    if (path === '/v1/feed' && request.method === 'GET') {
      const rl = await checkIpRateLimit(request, RATE_LIMITS.feed);
      if (rl.limited) return rateLimitResponse(CORS_HEADERS, rl);
      const params = Object.fromEntries(url.searchParams.entries());
      return cachedGetResponse(request, 30, () => handleFeedRequest(env, params));
    }

    if (path === '/v1/availability' && request.method === 'GET') {
      const rl = await checkIpRateLimit(request, RATE_LIMITS.availability);
      if (rl.limited) return rateLimitResponse(CORS_HEADERS, rl);
      const params = Object.fromEntries(url.searchParams.entries());
      return cachedGetResponse(request, 45, () => handleAvailabilityRequest(env, params));
    }

    if (path === '/v1/tee-times' && request.method === 'GET') {
      const rl = await checkIpRateLimit(request, RATE_LIMITS.teeTimesBatch);
      if (rl.limited) return rateLimitResponse(CORS_HEADERS, rl);
      const params = Object.fromEntries(url.searchParams.entries());
      const produce = () =>
        handleTeeTimesBatchRequest(env, params, {
          loadCourses: () => loadCourses(env),
          fetchTimesForCourse,
          normalizeTimesWorker,
        });
      // Course detail passes fresh=1 after booking so we must not serve a cached sheet.
      if (params.fresh === '1' || params.fresh === 'true') {
        const res = await produce();
        const headers = new Headers(res.headers);
        headers.set('Cache-Control', 'no-store');
        headers.set('X-Worker-Cache', 'bypass');
        return new Response(res.body, { status: res.status, headers });
      }
      return cachedGetResponse(request, 45, produce);
    }

    if (path === '/v1/alerts/check' && request.method === 'POST') {
      const rl = await checkIpRateLimit(request, RATE_LIMITS.alertCheck);
      if (rl.limited) return rateLimitResponse(CORS_HEADERS, rl);
      return handleAlertCreateCheck(request, env);
    }

    if (path.startsWith('/admin/')) {
      const adminRes = await courseAdmin.handleAdminRequest(request, env, path);
      if (adminRes) return adminRes;
      return corsResponse({ error: 'not_found' }, 404);
    }

    if (request.method !== 'GET') {
      return corsResponse({ error: 'method_not_allowed' }, 405);
    }

    const params = Object.fromEntries(url.searchParams.entries());
    const foreupJwt = request.headers.get('foreup_jwt') || null;

    if (path === '/foreup' || path === '/chronogolf' || path === '/chronogolf-slc' || path === '/membersports' || path === '/teeitup' || path === '/trutee' || path === '/golfpay' || path === '/quick18' || path === '/golfwithaccess' || path === '/clubcaddie' || path === '/teesnap' || path === '/golfrev') {
      const rl = await checkIpRateLimit(request, RATE_LIMITS.vendorLive);
      if (rl.limited) return rateLimitResponse(CORS_HEADERS, rl);
    }

    if (path === '/foreup') {
      return handleForeUp(params, foreupJwt);
    }

    if (path === '/chronogolf') {
      return handleChronogolf(params);
    }

    if (path === '/chronogolf-slc') {
      return handleChronogolfSlc(params);
    }

    if (path === '/membersports') {
      return handleMemberSports(params);
    }

    if (path === '/teeitup') {
      return handleTeeItUp(params);
    }

    if (path === '/trutee') {
      return handleTrutee(params);
    }

    if (path === '/golfpay') {
      return handleGolfPay(params);
    }

    if (path === '/quick18') {
      return handleQuick18(params);
    }

    if (path === '/golfwithaccess') {
      return handleGolfWithAccess(params);
    }

    if (path === '/clubcaddie') {
      return handleClubCaddie(params);
    }

    if (path === '/teesnap') {
      return handleTeeSnap(params);
    }

    if (path === '/golfrev') {
      return handleGolfRev(params);
    }

    if (path === '/place-photo' || path === '/place-reviews') {
      const rl = await checkIpRateLimit(request, RATE_LIMITS.places);
      if (rl.limited) return rateLimitResponse(IMAGE_CORS_HEADERS, rl);
    }

    if (path === '/place-photo') {
      return handlePlacePhoto(params, env);
    }

    if (path === '/place-reviews') {
      return handlePlaceReviews(params, env);
    }

    return corsResponse({ error: 'not_found' }, 404);
  },

  async scheduled(event, env, ctx) {
    const cron = event.cron || '';
    // Alert micro-poller: every minute, watched (course, date) pairs only, 24/7.
    if (cron === '* * * * *') {
      ctx.waitUntil(handleAlertMicroPollWithNotify(env));
    }
    if (cron === '*/5 * * * *') {
      ctx.waitUntil(handlePollWithAlerts(env));
    }
    if (cron === '*/15 6-23 * * *') {
      ctx.waitUntil(handleScheduled(env));
    }
  },
};
