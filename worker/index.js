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

export default {
  async fetch(request) {
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

    return corsResponse({ error: 'not_found' }, 404);
  },
};
