/**
 * Read path: serve polled tee_time_slots snapshots via GET /v1/availability.
 */

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

  const [schedRes, slotsRes] = await Promise.all([
    fetch(
      `${env.SUPABASE_URL}/rest/v1/availability_poll_schedule` +
        `?course_slug=eq.${encodeURIComponent(course_slug)}` +
        `&play_date=eq.${play_date}` +
        `&select=last_polled_at`,
      { headers: sbHeaders(env) },
    ),
    fetch(
      `${env.SUPABASE_URL}/rest/v1/tee_time_slots` +
        `?course_slug=eq.${encodeURIComponent(course_slug)}` +
        `&play_date=eq.${play_date}` +
        `&holes=eq.${holes}` +
        `&status=eq.open` +
        `&select=id,play_starts_at,price_cents,spots_open,holes,last_polled_at` +
        `&order=starts_at_local.asc`,
      { headers: sbHeaders(env) },
    ),
  ]);

  if (!schedRes.ok || !slotsRes.ok) {
    return corsResponse({ error: 'upstream_error', ok: false }, 502);
  }

  const schedRows = await schedRes.json();
  const slotRows = await slotsRes.json();
  const last_polled_at = schedRows[0]?.last_polled_at ?? null;
  const has_poll_coverage = last_polled_at != null;

  const nowMs = Date.now();
  const times = [];
  for (const slot of slotRows) {
    if (!slot.play_starts_at) continue;
    if (new Date(slot.play_starts_at).getTime() <= nowMs) continue;
    if (slot.spots_open != null && slot.spots_open < players) continue;

    times.push({
      id: slot.id,
      startsAt: slot.play_starts_at,
      price: slot.price_cents != null ? Math.round(slot.price_cents / 100) : undefined,
      spots: slot.spots_open ?? undefined,
      holes: slot.holes === 9 ? 9 : 18,
    });
  }

  return corsResponse({
    ok: true,
    source: 'snapshot',
    has_poll_coverage,
    last_polled_at,
    course_slug,
    play_date,
    holes,
    times,
  });
}
