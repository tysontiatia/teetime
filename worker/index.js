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

async function fetchWithTimeout(url, options = {}, ms = 5000) {
  return Promise.race([fetch(url, options), timeout(ms)]);
}

let foreupSession = '';
let sessionFetchedAt = 0;

async function ensureForeUpSession() {
  if (foreupSession && Date.now() - sessionFetchedAt < 1800000) return;
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
    }
  } catch {}
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

async function handleForeUp(params, foreupJwt) {
  await ensureForeUpSession();
  const { schedule_id, date, players, holes = '18', booking_class_id = '0' } = params;

  if (!schedule_id || !date || !players) {
    return corsResponse({ error: 'missing_params' });
  }

  // ForeUp expects MM-DD-YYYY; frontend sends YYYY-MM-DD
  const [y, m, d] = date.split('-');
  const foreupDate = `${m}-${d}-${y}`;

  const url = new URL('https://foreupsoftware.com/index.php/api/booking/times');
  url.searchParams.set('time', 'all');
  url.searchParams.set('date', foreupDate);
  url.searchParams.set('holes', holes);
  url.searchParams.set('players', players);
  url.searchParams.set('booking_class', booking_class_id);
  url.searchParams.set('schedule_id', schedule_id);
  url.searchParams.set('specials_only', '0');
  url.searchParams.set('api_key', 'no_limits');

  const fetchOptions = {
    headers: {
      'Accept': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://foreupsoftware.com/',
      ...(foreupSession ? { 'Cookie': foreupSession } : {}),
    },
  };

  if (foreupJwt) {
    fetchOptions.headers['Authorization'] = `Bearer ${foreupJwt}`;
  }

  let res;
  try {
    res = await fetchWithTimeout(url.toString(), fetchOptions);
  } catch (err) {
    if (err.message === 'timeout') return corsResponse({ error: 'timeout' });
    return corsResponse({ error: 'upstream_error' });
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return corsResponse({ error: 'login_required' });
  }

  if (res.status === 401 || res.status === 403) {
    return corsResponse({ error: 'login_required' });
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

  if (data && typeof data === 'object' && !Array.isArray(data)) {
    if (data.logged_in === false || data.success === false) {
      return corsResponse({ error: 'login_required' });
    }
    if (data.error && (
      String(data.error).toLowerCase().includes('login') ||
      String(data.error).toLowerCase().includes('auth')
    )) {
      return corsResponse({ error: 'login_required' });
    }
  }

  return corsResponse(data);
}

async function handleChronogolf(params) {
  const { club_id, date, players, holes = '18' } = params;

  if (!club_id || !date || !players) {
    return corsResponse({ error: 'missing_params' });
  }

  const url = new URL(`https://www.chronogolf.com/club/${encodeURIComponent(club_id)}/teetimes`);
  url.searchParams.set('date', date);
  url.searchParams.set('nb_holes', holes);
  url.searchParams.set('nb_players', players);

  let res;
  try {
    res = await fetchWithTimeout(url.toString(), {
      headers: {
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
    });
  } catch (err) {
    if (err.message === 'timeout') return corsResponse({ error: 'timeout' });
    return corsResponse({ error: 'upstream_error' });
  }

  if (res.status === 403 || res.status === 404) {
    return corsResponse({ error: 'unavailable', status: res.status });
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

    return corsResponse({ error: 'not_found' }, 404);
  },
};
