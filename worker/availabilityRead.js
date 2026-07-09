/**
 * Read path: serve polled tee_time_slots snapshots via GET /v1/availability.
 */

const REOPENED_LOOKBACK_MS = 6 * 60 * 60 * 1000;

function corsResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Content-Type': 'application/json',
    },
  });
}

function sbHeaders(env) {
  return {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
  };
}

function parseYmd(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return null;
  return String(s);
}

function parseHoles(n) {
  const h = parseInt(n, 10);
  return h === 9 || h === 18 ? h : null;
}

function parsePlayers(n) {
  const p = parseInt(n, 10);
  if (p >= 1 && p <= 4) return p;
  return 2;
}

function localTimeToRawTime(startsAtLocal) {
  const m = String(startsAtLocal || '').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return '';
  return `${String(Number(m[1])).padStart(2, '0')}:${m[2]}`;
}

function slotEventKey(startsAtLocal, holes) {
  const raw = localTimeToRawTime(startsAtLocal);
  return raw ? `${raw}-${holes}` : `${startsAtLocal}-${holes}`;
}

async function loadPollCoverage(env, course_slug, play_date) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/availability_poll_schedule` +
      `?course_slug=eq.${encodeURIComponent(course_slug)}` +
      `&play_date=eq.${play_date}` +
      `&select=last_polled_at`,
    { headers: sbHeaders(env) },
  );
  if (!res.ok) return { last_polled_at: null, has_poll_coverage: false };
  const rows = await res.json();
  const last_polled_at = rows[0]?.last_polled_at ?? null;
  return { last_polled_at, has_poll_coverage: last_polled_at != null };
}

async function loadOpenSlots(env, course_slug, play_date, holes) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/tee_time_slots` +
      `?course_slug=eq.${encodeURIComponent(course_slug)}` +
      `&play_date=eq.${play_date}` +
      `&holes=eq.${holes}` +
      `&status=eq.open` +
      `&select=id,play_starts_at,starts_at_local,price_cents,spots_open,holes,last_polled_at` +
      `&order=starts_at_local.asc`,
    { headers: sbHeaders(env) },
  );
  if (!res.ok) return [];
  return res.json();
}

async function loadRecentReopenedMap(env, course_slug, play_date) {
  const since = new Date(Date.now() - REOPENED_LOOKBACK_MS).toISOString();
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/tee_time_slot_events` +
      `?course_slug=eq.${encodeURIComponent(course_slug)}` +
      `&play_date=eq.${play_date}` +
      `&event_type=eq.reopened` +
      `&created_at=gte.${since}` +
      `&select=starts_at_local,holes,created_at`,
    { headers: sbHeaders(env) },
  );
  if (!res.ok) return new Map();
  const rows = await res.json();
  const map = new Map();
  for (const row of rows) {
    const key = slotEventKey(row.starts_at_local, row.holes);
    const prev = map.get(key);
    if (!prev || new Date(row.created_at) > new Date(prev)) {
      map.set(key, row.created_at);
    }
  }
  return map;
}

function filterSlotsForPlayers(slots, players) {
  const nowMs = Date.now();
  return slots.filter((slot) => {
    if (!slot.play_starts_at) return false;
    if (new Date(slot.play_starts_at).getTime() <= nowMs) return false;
    if (slot.spots_open != null && slot.spots_open < players) return false;
    return true;
  });
}

/** Normalized rows for alert cron (matches normalizeTimesWorker shape). */
export async function fetchSnapshotNormalizedTimes(env, course_slug, play_date, holes, players) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return { has_poll_coverage: false, times: [] };
  }

  const h = parseHoles(holes);
  const p = parsePlayers(players);
  if (!course_slug || !parseYmd(play_date) || !h) {
    return { has_poll_coverage: false, times: [] };
  }

  const coverage = await loadPollCoverage(env, course_slug, play_date);
  if (!coverage.has_poll_coverage) {
    return { has_poll_coverage: false, times: [] };
  }

  const slots = filterSlotsForPlayers(await loadOpenSlots(env, course_slug, play_date, h), p);
  const times = slots
    .map((slot) => ({
      rawTime: localTimeToRawTime(slot.starts_at_local),
      spots: slot.spots_open ?? null,
      price: slot.price_cents != null ? `$${Math.round(slot.price_cents / 100)}` : null,
      holes: slot.holes === 9 ? 9 : 18,
    }))
    .filter((t) => t.rawTime);

  return {
    has_poll_coverage: true,
    last_polled_at: coverage.last_polled_at,
    times,
  };
}

export async function handleAvailabilityRequest(env, params) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return corsResponse({ error: 'availability_unconfigured' }, 503);
  }

  const course_slug = String(params.course_slug || '').trim();
  const play_date = parseYmd(params.date);
  const holes = parseHoles(params.holes);
  const players = parsePlayers(params.players);

  if (!course_slug || !play_date || !holes) {
    return corsResponse({ error: 'missing_params' }, 400);
  }

  const [coverage, slotRows, reopenedMap] = await Promise.all([
    loadPollCoverage(env, course_slug, play_date),
    loadOpenSlots(env, course_slug, play_date, holes),
    loadRecentReopenedMap(env, course_slug, play_date),
  ]);

  const slots = filterSlotsForPlayers(slotRows, players);
  const times = slots.map((slot) => {
    const key = slotEventKey(slot.starts_at_local, slot.holes);
    const reopenedAt = reopenedMap.get(key);
    return {
      id: slot.id,
      startsAt: slot.play_starts_at,
      price: slot.price_cents != null ? Math.round(slot.price_cents / 100) : undefined,
      spots: slot.spots_open ?? undefined,
      holes: slot.holes === 9 ? 9 : 18,
      reopenedAt: reopenedAt ?? undefined,
    };
  });

  return corsResponse({
    ok: true,
    source: 'snapshot',
    has_poll_coverage: coverage.has_poll_coverage,
    last_polled_at: coverage.last_polled_at,
    course_slug,
    play_date,
    holes,
    times,
  });
}
