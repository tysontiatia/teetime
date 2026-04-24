const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Content-Type': 'application/json',
};

function corsResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: CORS_HEADERS,
  });
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
      const cookie = res.headers.get('set-cookie');
      if (cookie) {
        foreupSession = cookie.split(';')[0];
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

async function fetchForeUpTimes(url, foreupJwt) {
  const fetchOptions = {
    headers: {
      'Accept': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://foreupsoftware.com/',
      ...(foreupSession ? { 'Cookie': foreupSession } : {}),
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
  await ensureForeUpSession();
  const { schedule_id, date, booking_class_id = '0', holes = '18' } = params;

  if (!schedule_id || !date) {
    return corsResponse({ error: 'missing_params' });
  }

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
  url.searchParams.set('api_key', 'no_limits');

  let res;
  try {
    res = await fetchForeUpTimes(url.toString(), foreupJwt);
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
    await ensureForeUpSession();
    try {
      res = await fetchForeUpTimes(url.toString(), foreupJwt);
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

async function handleChronogolfSlc(params) {
  await ensureChronogolfSession();
  const { club_id, course_id, affiliation_type_id, nb_holes, date, players = '1' } = params;

  if (!club_id || !course_id || !affiliation_type_id || !date) {
    return corsResponse({ error: 'missing_params' });
  }

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

// ── Supabase + Resend config (set via wrangler secrets) ──────────────
// env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, env.RESEND_API_KEY

// ── Courses list (embedded at build, or fetched) ─────────────────────
let coursesCache = null;

async function loadCourses(env) {
  if (coursesCache) return coursesCache;
  // Fetch from the Pages site so we have one source of truth
  const res = await fetch('https://tee-time.io/courses.json');
  coursesCache = await res.json();
  return coursesCache;
}

// ── Normalize helpers (duplicated from app.html for worker context) ──
function normalizeForeUpTimesWorker(data) {
  if (!Array.isArray(data)) return [];
  return data.map(t => ({
    rawTime: t.time || '',
    spots: t.available_spots || null,
    price: t.green_fee ? '$' + parseFloat(t.green_fee).toFixed(0) : null,
    holes: t.holes,
  }));
}

function normalizeChronogolfTimesWorker(data) {
  const items = data?.teetimes;
  if (!Array.isArray(items)) return [];
  return items.map(t => ({
    rawTime: t.start_time || '',
    spots: t.max_player_size ?? null,
    price: t.default_price?.green_fee ? '$' + parseFloat(t.default_price.green_fee).toFixed(0) : null,
    holes: t.default_price?.bookable_holes ?? t.course?.holes,
  }));
}

function normalizeChronogolfSlcTimesWorker(data, holes) {
  if (!Array.isArray(data)) return [];
  return data
    .filter(t => !t.out_of_capacity && !t.frozen)
    .map(t => ({
      rawTime: t.start_time || '',
      spots: null,
      price: t.green_fees?.[0]?.green_fee ? '$' + parseFloat(t.green_fees[0].green_fee).toFixed(0) : null,
      holes: parseInt(holes, 10),
    }));
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

function normalizeTimesWorker(course, data, holes) {
  if (!data || data.error) return [];
  switch (course.platform) {
    case 'foreup':         return normalizeForeUpTimesWorker(data);
    case 'membersports':   return normalizeMemberSportsTimesWorker(data, holes);
    case 'chronogolf_slc': return normalizeChronogolfSlcTimesWorker(data, holes);
    case 'chronogolf':     return normalizeChronogolfTimesWorker(data);
    default:               return [];
  }
}

function formatTime12h(timeStr) {
  const match = timeStr.match(/(\d{1,2}):(\d{2})/);
  if (!match) return timeStr;
  let h = parseInt(match[1], 10);
  const m = match[2];
  const ampm = h >= 12 ? 'PM' : 'AM';
  if (h > 12) h -= 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${ampm}`;
}

// ── Fetch tee times for a course (reuses existing API logic) ─────────
// Supported live platforms: foreup | chronogolf | chronogolf_slc | membersports.
// Add handlers here + GET routes in fetch() when onboarding new vendors (GolfPay, TenFore, etc.).
async function fetchTimesForCourse(course, date, holes, players) {
  const params = new URLSearchParams({ date });
  let handler;

  if (course.platform === 'foreup') {
    params.set('schedule_id', course.schedule_id);
    if (course.booking_class_id) params.set('booking_class_id', course.booking_class_id);
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
    params.set('club_id', course.club_id);
    params.set('course_id', course.course_id);
    params.set('affiliation_type_id', course.affiliation_type_id);
    params.set('nb_holes', holes);
    params.set('players', players);
    handler = () => handleChronogolfSlc(Object.fromEntries(params.entries()));
  } else {
    return null; // unsupported platform (golfpay, tenfore, foreup_login)
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
function buildBookingUrlWorker(course, date, holes, players) {
  const base = course.booking_url;
  if (!base) return 'https://tee-time.io';
  if (course.platform === 'foreup' && base.includes('foreupsoftware.com')) {
    const [y, m, d] = date.split('-');
    return `${base}?date=${m}-${d}-${y}&players=${players}&holes=${holes}`;
  }
  return base;
}

// ── Send SMS via Twilio ──────────────────────────────────────────────
async function sendSms(env, toPhone, body) {
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
  return res.ok;
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
  const dateFormatted = new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
  const top = times.slice(0, 5).map(t => formatTime12h(t.rawTime)).join(', ');
  const more = times.length > 5 ? ` +${times.length - 5} more` : '';
  const bookingUrl = buildBookingUrlWorker(course, date, '18', players);
  return `⛳ ${times.length} tee time${times.length !== 1 ? 's' : ''} at ${course.name} on ${dateFormatted}\n${top}${more}\nBook: ${bookingUrl}`;
}

// ── Send email via Resend ────────────────────────────────────────────
async function sendEmail(env, to, subject, html) {
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
  return res.ok;
}

// ── Build notification email ─────────────────────────────────────────
function buildAlertEmail(course, times, date, players) {
  const dateFormatted = new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
  const bookingUrl = buildBookingUrlWorker(course, date, '18', players);

  const timeRows = times.slice(0, 12).map(t => {
    const time = formatTime12h(t.rawTime);
    const price = t.price || '';
    const spots = t.spots != null ? `${t.spots} spot${t.spots !== 1 ? 's' : ''}` : '';
    return `<tr><td style="padding:8px 16px;border-bottom:1px solid #f0f0f0;font-size:15px">${time}</td><td style="padding:8px 16px;border-bottom:1px solid #f0f0f0;font-size:15px;color:#666">${price}</td><td style="padding:8px 16px;border-bottom:1px solid #f0f0f0;font-size:15px;color:#666">${spots}</td></tr>`;
  }).join('');

  const moreText = times.length > 12 ? `<p style="color:#888;font-size:13px;margin-top:8px">+ ${times.length - 12} more times available</p>` : '';

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f6f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<div style="max-width:520px;margin:0 auto;padding:24px">
  <div style="background:#1A2E1A;border-radius:12px 12px 0 0;padding:20px 24px">
    <h1 style="margin:0;color:#fff;font-size:18px;font-weight:600">⛳ Tee Times Available!</h1>
  </div>
  <div style="background:#fff;padding:24px;border-radius:0 0 12px 12px;box-shadow:0 2px 8px rgba(0,0,0,0.06)">
    <h2 style="margin:0 0 4px;font-size:17px;color:#111">${course.name}</h2>
    <p style="margin:0 0 16px;color:#666;font-size:14px">${dateFormatted} · ${players} player${players !== 1 ? 's' : ''}</p>
    <table style="width:100%;border-collapse:collapse">
      <thead><tr style="background:#f8faf8">
        <th style="padding:8px 16px;text-align:left;font-size:12px;color:#888;font-weight:600;text-transform:uppercase">Time</th>
        <th style="padding:8px 16px;text-align:left;font-size:12px;color:#888;font-weight:600;text-transform:uppercase">Price</th>
        <th style="padding:8px 16px;text-align:left;font-size:12px;color:#888;font-weight:600;text-transform:uppercase">Spots</th>
      </tr></thead>
      <tbody>${timeRows}</tbody>
    </table>
    ${moreText}
    <a href="${bookingUrl}" style="display:block;text-align:center;background:#2D7A3A;color:#fff;padding:14px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;margin-top:20px">Book Now →</a>
    <p style="color:#aaa;font-size:12px;text-align:center;margin-top:16px">You received this because you set a tee time alert on <a href="https://tee-time.io" style="color:#2D7A3A">tee-time.io</a>.</p>
  </div>
</div>
</body>
</html>`;
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

/** One-time per calendar date + channel (specific-date alerts). */
function wasAlreadySent(pref, evalDate, channel, logs) {
  return logs.some(
    (l) => l.user_id === pref.user_id && l.course_id === pref.course_id && l.target_date === evalDate && l.channel === channel,
  );
}

/** Weekly / open-ended: same course+date+channel can re-notify after 24h. */
function wasInCooldown(pref, evalDate, channel, logs) {
  const threshold = Date.now() - 24 * 3600 * 1000;
  return logs.some((l) => {
    if (l.user_id !== pref.user_id || l.course_id !== pref.course_id || l.target_date !== evalDate || l.channel !== channel) return false;
    const ts = new Date(l.sent_at).getTime();
    return Number.isFinite(ts) && ts > threshold;
  });
}

function appendSyntheticLog(logs, row) {
  logs.push({ ...row, sent_at: new Date().toISOString() });
}

// ── Cron handler: check alerts and send notifications ────────────────
async function handleScheduled(env) {
  const courses = await loadCourses(env);
  const todayStr = new Date().toISOString().slice(0, 10);

  const cutoffStr = addDaysToYmd(todayStr, 14);
  const logSinceStr = addDaysToYmd(todayStr, -45);

  const [specRes, openRes] = await Promise.all([
    fetch(
      `${env.SUPABASE_URL}/rest/v1/notification_preferences?active=eq.true&target_date=not.is.null&target_date=gte.${todayStr}&select=*`,
      { headers: sbHeaders(env) },
    ),
    fetch(
      `${env.SUPABASE_URL}/rest/v1/notification_preferences?active=eq.true&target_date=is.null&look_ahead_days=not.is.null&select=*`,
      { headers: sbHeaders(env) },
    ),
  ]);

  const specificPrefs = specRes.ok ? await specRes.json() : [];
  const openPrefs = openRes.ok ? await openRes.json() : [];

  const activeSpecific = specificPrefs.filter((p) => p.target_date && p.target_date <= cutoffStr);

  /** @type {{ type: 'specific' | 'open', pref: object, evalDate: string }[]} */
  const work = [];
  for (const pref of activeSpecific) {
    work.push({ type: 'specific', pref, evalDate: pref.target_date });
  }
  for (const pref of openPrefs) {
    const horizon = Math.min(Math.max(Number(pref.look_ahead_days) || 14, 1), 60);
    const dowAllow = Array.isArray(pref.days_of_week) && pref.days_of_week.length ? pref.days_of_week : [0, 1, 2, 3, 4, 5, 6];
    for (let d = 0; d < horizon; d++) {
      const evalDate = addDaysToYmd(todayStr, d);
      if (evalDate < todayStr) continue;
      if (!dowAllow.includes(ymdUtcWeekday(evalDate))) continue;
      work.push({ type: 'open', pref, evalDate });
    }
  }

  if (!work.length) return;

  const userIds = [...new Set(work.map((w) => w.pref.user_id))];
  const logRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/notification_log?user_id=in.(${userIds.join(',')})&sent_at=gte.${logSinceStr}&select=user_id,course_id,target_date,channel,sent_at&order=sent_at.desc`,
    { headers: sbHeaders(env) },
  );
  const logs = logRes.ok ? await logRes.json() : [];

  const groups = {};
  for (const item of work) {
    const k = `${item.pref.course_id}||${item.evalDate}`;
    if (!groups[k]) {
      groups[k] = {
        course_id: item.pref.course_id,
        evalDate: item.evalDate,
        items: [],
      };
    }
    groups[k].items.push(item);
  }

  for (const group of Object.values(groups)) {
    const course = findCourseByCatalogId(courses, group.course_id);
    if (!course) continue;

    const maxPlayers = Math.min(
      4,
      Math.max(1, ...group.items.map((it) => Number(it.pref.players || it.pref.min_spots || 1))),
    );
    const playersStr = String(maxPlayers);

    const data = await fetchTimesForCourse(course, group.evalDate, '18', playersStr);
    if (!data) continue;

    const allTimes = normalizeTimesWorker(course, data, '18');
    if (!allTimes.length) continue;

    for (const item of group.items) {
      const { pref, type, evalDate } = item;

      const earliest = pref.earliest_time?.slice(0, 5) || '00:00';
      const latest = pref.latest_time?.slice(0, 5) || '23:59';
      const minSpots = pref.min_spots || pref.players || 1;

      const matching = allTimes.filter((t) => {
        if (t.rawTime < earliest || t.rawTime > latest) return false;
        if (t.spots != null && t.spots < minSpots) return false;
        return true;
      });

      if (!matching.length) continue;

      const [userRes, profileRes] = await Promise.all([
        fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${pref.user_id}`, { headers: sbHeaders(env) }),
        fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${pref.user_id}&select=phone,notify_via`, { headers: sbHeaders(env) }),
      ]);
      if (!userRes.ok) continue;
      const user = await userRes.json();
      const profiles = profileRes.ok ? await profileRes.json() : [];
      const profile = profiles[0] || {};

      const notifyVia = profile.notify_via || 'email';
      const wantEmail = notifyVia === 'email' || notifyVia === 'both';
      const wantSms = (notifyVia === 'sms' || notifyVia === 'both') && profile.phone;
      const phoneE164 = wantSms ? normalizePhone(profile.phone) : null;
      const playersStr = String(pref.players || 1);

      if (wantEmail && user.email) {
        const alreadyBlocked = type === 'specific'
          ? wasAlreadySent(pref, evalDate, 'email', logs)
          : wasInCooldown(pref, evalDate, 'email', logs);
        if (!alreadyBlocked) {
          const subject = `⛳ ${matching.length} tee time${matching.length !== 1 ? 's' : ''} at ${course.name}`;
          const html = buildAlertEmail(course, matching, evalDate, pref.players || 1);
          const sent = await sendEmail(env, user.email, subject, html);
          if (sent) {
            await fetch(`${env.SUPABASE_URL}/rest/v1/notification_log`, {
              method: 'POST',
              headers: sbHeaders(env, true),
              body: JSON.stringify({ user_id: pref.user_id, course_id: pref.course_id, target_date: evalDate, channel: 'email', times_found: matching.length }),
            });
            appendSyntheticLog(logs, { user_id: pref.user_id, course_id: pref.course_id, target_date: evalDate, channel: 'email' });
          }
        }
      }

      if (wantSms && phoneE164) {
        const alreadyBlocked = type === 'specific'
          ? wasAlreadySent(pref, evalDate, 'sms', logs)
          : wasInCooldown(pref, evalDate, 'sms', logs);
        if (!alreadyBlocked) {
          const body = buildAlertSms(course, matching, evalDate, playersStr);
          const sent = await sendSms(env, phoneE164, body);
          if (sent) {
            await fetch(`${env.SUPABASE_URL}/rest/v1/notification_log`, {
              method: 'POST',
              headers: sbHeaders(env, true),
              body: JSON.stringify({ user_id: pref.user_id, course_id: pref.course_id, target_date: evalDate, channel: 'sms', times_found: matching.length }),
            });
            appendSyntheticLog(logs, { user_id: pref.user_id, course_id: pref.course_id, target_date: evalDate, channel: 'sms' });
          }
        }
      }
    }
  }
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

    if (request.method !== 'GET') {
      return corsResponse({ error: 'method_not_allowed' }, 405);
    }

    const params = Object.fromEntries(url.searchParams.entries());
    const foreupJwt = request.headers.get('foreup_jwt') || null;

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

    return corsResponse({ error: 'not_found' }, 404);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleScheduled(env));
  },
};
