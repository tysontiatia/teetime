/**
 * Recent openings feed — activity from tee_time_slot_events (opened / reopened).
 */

const MT = 'America/Denver';
const DEFAULT_HOURS = 6;
const DEFAULT_LIMIT = 40;
const EVENT_FETCH_CAP = 250;
const SLOT_ID_BATCH = 100;

function sbHeaders(env) {
  return {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
  };
}

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

function mtTodayYmd() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: MT,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

async function loadCatalogNames(env, slugs) {
  const map = new Map();
  if (!slugs.length) return map;
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/course_catalog?slug=in.(${slugs.map((s) => `"${s}"`).join(',')})&select=slug,name`,
    { headers: sbHeaders(env) },
  );
  if (!res.ok) return map;
  for (const row of await res.json()) {
    map.set(row.slug, row.name);
  }
  return map;
}

/** Load current slot rows for feed events (avoids scanning all ~17k open slots). */
async function loadSlotsByIds(env, slotIds) {
  const unique = [...new Set(slotIds.filter(Boolean))];
  const map = new Map();
  if (!unique.length) return map;

  for (let i = 0; i < unique.length; i += SLOT_ID_BATCH) {
    const chunk = unique.slice(i, i + SLOT_ID_BATCH);
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/tee_time_slots` +
        `?id=in.(${chunk.join(',')})` +
        `&select=id,play_starts_at,price_cents,spots_open,status`,
      { headers: sbHeaders(env) },
    );
    if (!res.ok) continue;
    for (const slot of await res.json()) {
      map.set(slot.id, slot);
    }
  }
  return map;
}

export async function handleFeedRequest(env, params) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return corsResponse({ error: 'feed_unconfigured' }, 503);
  }

  const hours = Math.min(48, Math.max(1, parseInt(params.hours, 10) || DEFAULT_HOURS));
  const minPlayers = Math.min(4, Math.max(1, parseInt(params.min_players, 10) || 1));
  const limit = Math.min(80, Math.max(1, parseInt(params.limit, 10) || DEFAULT_LIMIT));
  const openOnly = params.open_only !== 'false';

  const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  const todayMt = mtTodayYmd();
  const nowMs = Date.now();

  const evRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/tee_time_slot_events` +
      `?event_type=in.(opened,reopened)` +
      `&created_at=gte.${since}` +
      `&play_date=gte.${todayMt}` +
      `&select=id,slot_id,course_slug,play_date,starts_at_local,holes,event_type,price_cents,spots_open,created_at` +
      `&order=created_at.desc` +
      `&limit=${EVENT_FETCH_CAP}`,
    { headers: sbHeaders(env) },
  );

  if (!evRes.ok) {
    const detail = await evRes.text();
    console.error('[feed] events query failed', evRes.status, detail.slice(0, 400));
    return corsResponse({ error: 'feed_query_failed' }, 502);
  }

  const events = await evRes.json();
  const deduped = [];
  const seen = new Set();
  for (const ev of events) {
    const key = `${ev.course_slug}|${ev.play_date}|${String(ev.starts_at_local).slice(0, 8)}|${ev.holes === 9 ? 9 : 18}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(ev);
  }

  const slotsById = await loadSlotsByIds(env, deduped.map((e) => e.slot_id));
  const catalogNames = await loadCatalogNames(
    env,
    [...new Set(deduped.map((e) => e.course_slug))],
  );

  const items = [];
  for (const ev of deduped) {
    const slot = ev.slot_id ? slotsById.get(ev.slot_id) : null;
    const stillOpen = slot?.status === 'open';
    if (openOnly && !stillOpen) continue;

    const playStartsAt = slot?.play_starts_at ?? null;
    if (playStartsAt && new Date(playStartsAt).getTime() <= nowMs) continue;

    const spots = slot?.spots_open ?? ev.spots_open ?? null;
    if (minPlayers > 1 && spots != null && spots < minPlayers) continue;

    const priceCents = slot?.price_cents ?? ev.price_cents ?? null;

    items.push({
      id: ev.id,
      event_type: ev.event_type,
      course_slug: ev.course_slug,
      course_name: catalogNames.get(ev.course_slug) || ev.course_slug.replace(/-/g, ' '),
      play_date: ev.play_date,
      starts_at_local: String(ev.starts_at_local || '').slice(0, 8),
      play_starts_at: playStartsAt,
      holes: ev.holes === 9 ? 9 : 18,
      price_cents: priceCents,
      spots_open: spots,
      detected_at: ev.created_at,
      still_open: stillOpen,
    });

    if (items.length >= limit) break;
  }

  return corsResponse({
    ok: true,
    items,
    meta: {
      hours,
      min_players: minPlayers,
      open_only: openOnly,
      count: items.length,
      generated_at: new Date().toISOString(),
    },
  });
}
