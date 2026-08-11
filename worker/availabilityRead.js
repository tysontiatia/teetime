/**
 * Read path: serve polled tee_time_slots snapshots via GET /v1/availability
 * and batched GET /v1/tee-times?ids= (with optional server-side live fill).
 */

import { slugFromCourseName } from './courseAdmin.js';

const REOPENED_LOOKBACK_MS = 6 * 60 * 60 * 1000;
/** Max course slugs per /v1/tee-times request (URL + PostgREST bound). */
export const TEE_TIMES_BATCH_MAX_IDS = 20;

const MT_TZ = 'America/Denver';
/** Prefer live fill when snapshot older than this (empty or non-empty). */
const SNAPSHOT_REVALIDATE_AFTER_MS = 12 * 60 * 1000;
const LIVE_FILL_CONCURRENCY = 6;
const LIVE_FILL_TIMEOUT_MS = 12_000;
const LIVE_FILL_SLOW_TIMEOUT_MS = 28_000;
const SLOW_LIVE_PLATFORMS = new Set(['golfpay']);

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

/** PostgREST `in.("a","b")` list — strip quotes from input slugs. */
export function postgrestInList(slugs) {
  return slugs
    .map((s) => `"${String(s).replace(/"/g, '')}"`)
    .join(',');
}

/** Parse + dedupe ids= query (preserve first-seen order). */
export function parseTeeTimesIds(raw, maxIds = TEE_TIMES_BATCH_MAX_IDS) {
  const seen = new Set();
  const out = [];
  for (const part of String(raw || '').split(',')) {
    const slug = part.trim();
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push(slug);
  }
  if (out.length === 0) return { ok: false, error: 'missing_params', slugs: [] };
  if (out.length > maxIds) return { ok: false, error: 'too_many_ids', slugs: out };
  return { ok: true, slugs: out };
}

async function loadPollCoverage(env, course_slug, play_date) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/availability_poll_schedule` +
      `?course_slug=eq.${encodeURIComponent(course_slug)}` +
      `&play_date=eq.${play_date}` +
      `&select=last_polled_at,last_success_at`,
    { headers: sbHeaders(env) },
  );
  if (!res.ok) return { last_polled_at: null, has_poll_coverage: false };
  const rows = await res.json();
  const row = rows[0];
  // Coverage/freshness follow successful polls only. last_polled_at is the claim
  // cursor and advances even when the vendor fetch fails.
  const last_success_at = row?.last_success_at ?? null;
  return {
    last_polled_at: last_success_at,
    has_poll_coverage: last_success_at != null,
  };
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
    // Sold out or insufficient capacity.
    if (slot.spots_open != null && slot.spots_open < players) return false;
    // Without spot counts we cannot honor multi-player searches (chronogolf_slc legacy rows).
    if (players > 1 && slot.spots_open == null) return false;
    return true;
  });
}

function mapSlotToTime(slot, reopenedMap) {
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
}

/**
 * Build per-slug snapshot payloads from batched schedule/slot/event rows.
 * Exported for unit tests.
 */
export function buildTeeTimesBySlug(slugs, scheduleRows, slotRows, eventRows, players) {
  const coverageBySlug = new Map();
  for (const row of scheduleRows || []) {
    const slug = row?.course_slug;
    if (!slug) continue;
    const last_success_at = row.last_success_at ?? null;
    coverageBySlug.set(slug, {
      last_polled_at: last_success_at,
      has_poll_coverage: last_success_at != null,
    });
  }

  const slotsBySlug = new Map();
  for (const slot of slotRows || []) {
    const slug = slot?.course_slug;
    if (!slug) continue;
    if (!slotsBySlug.has(slug)) slotsBySlug.set(slug, []);
    slotsBySlug.get(slug).push(slot);
  }

  /** @type {Map<string, Map<string, string>>} */
  const reopenedBySlug = new Map();
  for (const row of eventRows || []) {
    const slug = row?.course_slug;
    if (!slug) continue;
    if (!reopenedBySlug.has(slug)) reopenedBySlug.set(slug, new Map());
    const map = reopenedBySlug.get(slug);
    const key = slotEventKey(row.starts_at_local, row.holes);
    const prev = map.get(key);
    if (!prev || new Date(row.created_at) > new Date(prev)) {
      map.set(key, row.created_at);
    }
  }

  const by_slug = {};
  for (const slug of slugs) {
    const coverage = coverageBySlug.get(slug) || {
      last_polled_at: null,
      has_poll_coverage: false,
    };
    const slotRowsForSlug = slotsBySlug.get(slug) || [];
    const spots_known =
      slotRowsForSlug.length === 0 || slotRowsForSlug.every((s) => s.spots_open != null);
    const reopenedMap = reopenedBySlug.get(slug) || new Map();
    const times = filterSlotsForPlayers(slotRowsForSlug, players).map((slot) =>
      mapSlotToTime(slot, reopenedMap),
    );
    by_slug[slug] = {
      has_poll_coverage: coverage.has_poll_coverage,
      spots_known,
      last_polled_at: coverage.last_polled_at,
      times,
      source: 'snapshot',
    };
  }
  return by_slug;
}

async function loadPollCoverageBatch(env, slugs, play_date) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/availability_poll_schedule` +
      `?course_slug=in.(${postgrestInList(slugs)})` +
      `&play_date=eq.${play_date}` +
      `&select=course_slug,last_polled_at,last_success_at`,
    { headers: sbHeaders(env) },
  );
  if (!res.ok) return [];
  return res.json();
}

async function loadOpenSlotsBatch(env, slugs, play_date, holes) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/tee_time_slots` +
      `?course_slug=in.(${postgrestInList(slugs)})` +
      `&play_date=eq.${play_date}` +
      `&holes=eq.${holes}` +
      `&status=eq.open` +
      `&select=id,course_slug,play_starts_at,starts_at_local,price_cents,spots_open,holes,last_polled_at` +
      `&order=starts_at_local.asc`,
    { headers: sbHeaders(env) },
  );
  if (!res.ok) return [];
  return res.json();
}

async function loadRecentReopenedBatch(env, slugs, play_date) {
  const since = new Date(Date.now() - REOPENED_LOOKBACK_MS).toISOString();
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/tee_time_slot_events` +
      `?course_slug=in.(${postgrestInList(slugs)})` +
      `&play_date=eq.${play_date}` +
      `&event_type=eq.reopened` +
      `&created_at=gte.${since}` +
      `&select=course_slug,starts_at_local,holes,created_at`,
    { headers: sbHeaders(env) },
  );
  if (!res.ok) return [];
  return res.json();
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

  const slotRows = await loadOpenSlots(env, course_slug, play_date, h);
  const spots_known = slotRows.length === 0 || slotRows.every((s) => s.spots_open != null);
  // Multi-player with unknown spots → force live fallback in alert cron.
  if (p > 1 && !spots_known) {
    return { has_poll_coverage: false, times: [] };
  }

  const slots = filterSlotsForPlayers(slotRows, p);
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

  // False until chronogolf_slc multi-pass (or other platforms) write spots_open.
  const spots_known = slotRows.length === 0 || slotRows.every((s) => s.spots_open != null);

  const slots = filterSlotsForPlayers(slotRows, players);
  const times = slots.map((slot) => mapSlotToTime(slot, reopenedMap));

  return corsResponse({
    ok: true,
    source: 'snapshot',
    has_poll_coverage: coverage.has_poll_coverage,
    spots_known,
    last_polled_at: coverage.last_polled_at,
    course_slug,
    play_date,
    holes,
    times,
  });
}

/**
 * Batched snapshot read for Finder: GET /v1/tee-times?date=&holes=&players=&ids=a,b,c
 * When `deps` includes live fetch helpers, miss/stale/empty rows are filled from
 * vendors in parallel so the browser sees one request instead of a live waterfall.
 *
 * @param {object} [deps]
 * @param {() => Promise<object[]>} [deps.loadCourses]
 * @param {(course: object, date: string, holes: string, players: string) => Promise<unknown>} [deps.fetchTimesForCourse]
 * @param {(course: object, data: unknown, holes: string) => Array<{rawTime:string,spots:number|null,price:string|null,holes:number}>} [deps.normalizeTimesWorker]
 */
export async function handleTeeTimesBatchRequest(env, params, deps = null) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return corsResponse({ error: 'availability_unconfigured' }, 503);
  }

  const play_date = parseYmd(params.date);
  const holes = parseHoles(params.holes);
  const players = parsePlayers(params.players);
  const parsed = parseTeeTimesIds(params.ids);

  if (!play_date || !holes || !parsed.ok) {
    const err = !parsed.ok ? parsed.error : 'missing_params';
    return corsResponse({ error: err }, 400);
  }

  const slugs = parsed.slugs;
  const [scheduleRows, slotRows, eventRows] = await Promise.all([
    loadPollCoverageBatch(env, slugs, play_date),
    loadOpenSlotsBatch(env, slugs, play_date, holes),
    loadRecentReopenedBatch(env, slugs, play_date),
  ]);

  const by_slug = buildTeeTimesBySlug(slugs, scheduleRows, slotRows, eventRows, players);

  let live_filled = 0;
  let live_failed = 0;
  if (deps?.loadCourses && deps?.fetchTimesForCourse && deps?.normalizeTimesWorker) {
    try {
      const fill = await liveFillTeeTimesBatch(by_slug, slugs, play_date, holes, players, deps);
      live_filled = fill.filled;
      live_failed = fill.failed;
    } catch (err) {
      console.error('[tee-times] live fill failed:', err);
      live_failed = slugs.length;
    }
  }

  return corsResponse({
    ok: true,
    source: live_filled > 0 ? 'mixed' : 'snapshot',
    date: play_date,
    holes,
    live_filled,
    live_failed,
    by_slug,
  });
}

function snapshotAgeMs(row, nowMs = Date.now()) {
  if (!row?.last_polled_at) return null;
  const age = nowMs - new Date(row.last_polled_at).getTime();
  return Number.isFinite(age) ? age : null;
}

/** Exported for unit tests — when true, batch handler should vendor-fetch this slug. */
export function snapshotNeedsLiveFill(row, players, playDateYmd, nowMs = Date.now()) {
  if (!row || row.has_poll_coverage !== true) return true;
  if (players > 1 && row.spots_known === false) return true;
  const age = snapshotAgeMs(row, nowMs);
  if (age == null || age < 0) return true;
  // Refresh any aging row (including non-empty overnight). Trusting a 12h-old
  // non-empty sheet under-counts openings that appeared after the last poll.
  return age > SNAPSHOT_REVALIDATE_AFTER_MS;
}

function wallClockToUtcInstant(y, mo, d, hh, mm) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: MT_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const read = (ms) => {
    const parts = fmt.formatToParts(new Date(ms));
    const get = (t) => Number(parts.find((p) => p.type === t)?.value ?? NaN);
    return { y: get('year'), mo: get('month'), d: get('day'), hh: get('hour'), mm: get('minute') };
  };
  const lo = Date.UTC(y, mo - 1, d - 1, 6, 0, 0);
  const hi = Date.UTC(y, mo - 1, d + 1, 6, 0, 0);
  for (let t = lo; t <= hi; t += 60 * 1000) {
    const g = read(t);
    if (g.y === y && g.mo === mo && g.d === d && g.hh === hh && g.mm === mm) return new Date(t);
  }
  return new Date(Date.UTC(y, mo - 1, d, hh + 7, mm, 0));
}

/** Convert vendor rawTime + play date to UTC ISO (America/Denver wall clock). */
export function rawTimeToStartsAtIso(dateYmd, rawTime) {
  const s = String(rawTime || '').trim();
  if (!s) return null;
  if (s.includes('T') && (/Z$/i.test(s) || /[+-]\d{2}:?\d{2}$/.test(s))) {
    const ms = Date.parse(s);
    return Number.isNaN(ms) ? null : new Date(ms).toISOString();
  }
  const full = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/);
  if (full) {
    return wallClockToUtcInstant(
      Number(full[1]),
      Number(full[2]),
      Number(full[3]),
      Number(full[4]),
      Number(full[5]),
    ).toISOString();
  }
  const timeOnly = s.match(/^(\d{1,2}):(\d{2})/);
  if (!timeOnly) return null;
  const [ys, ms, ds] = dateYmd.split('-').map(Number);
  if (!ys || !ms || !ds) return null;
  return wallClockToUtcInstant(ys, ms, ds, Number(timeOnly[1]), Number(timeOnly[2])).toISOString();
}

function parsePriceDollars(price) {
  if (price == null || price === '') return undefined;
  if (typeof price === 'number' && Number.isFinite(price)) return Math.round(price);
  const n = parseInt(String(price).replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) ? n : undefined;
}

/** Map normalizeTimesWorker rows → batch time objects (player-filtered, future only). */
export function normalizedRowsToBatchTimes(slug, dateYmd, holes, players, rows) {
  const nowMs = Date.now();
  const out = [];
  let i = 0;
  for (const row of rows || []) {
    if (!row?.rawTime) continue;
    const h = row.holes === 9 ? 9 : 18;
    if (h !== holes) continue;
    let spots = row.spots;
    if (spots != null && (!Number.isFinite(spots) || spots <= 0)) continue;
    if (players > 1 && spots == null) continue;
    if (spots != null && spots < players) continue;
    const startsAt = rawTimeToStartsAtIso(dateYmd, row.rawTime);
    if (!startsAt) continue;
    if (new Date(startsAt).getTime() <= nowMs) continue;
    out.push({
      id: `${slug}-${dateYmd}-${i++}-${row.rawTime}`,
      startsAt,
      price: parsePriceDollars(row.price),
      spots: spots ?? undefined,
      holes: h,
    });
  }
  out.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  return out;
}

async function withTimeout(promise, ms) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('live_fill_timeout')), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function mapPool(items, concurrency, fn) {
  if (!items.length) return [];
  const results = new Array(items.length);
  let index = 0;
  async function worker() {
    for (;;) {
      const i = index++;
      if (i >= items.length) break;
      results[i] = await fn(items[i], i);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

async function liveFillTeeTimesBatch(by_slug, slugs, play_date, holes, players, deps) {
  const need = slugs.filter((slug) => snapshotNeedsLiveFill(by_slug[slug], players, play_date));
  if (!need.length) return { filled: 0, failed: 0 };

  const courses = await deps.loadCourses();
  const byCourseSlug = new Map();
  for (const course of courses || []) {
    if (!course?.platform) continue;
    const slug = course.slug || slugFromCourseName(course.name);
    if (slug) byCourseSlug.set(slug, { ...course, slug });
  }

  const ordered = [
    ...need.filter((s) => !SLOW_LIVE_PLATFORMS.has(byCourseSlug.get(s)?.platform)),
    ...need.filter((s) => SLOW_LIVE_PLATFORMS.has(byCourseSlug.get(s)?.platform)),
  ];

  let filled = 0;
  let failed = 0;

  await mapPool(ordered, LIVE_FILL_CONCURRENCY, async (slug) => {
    const course = byCourseSlug.get(slug);
    if (!course) {
      failed++;
      by_slug[slug] = {
        ...(by_slug[slug] || { times: [], has_poll_coverage: false, spots_known: true, last_polled_at: null }),
        live_failed: true,
        source: by_slug[slug]?.source || 'snapshot',
      };
      return;
    }

    const timeoutMs = SLOW_LIVE_PLATFORMS.has(course.platform)
      ? LIVE_FILL_SLOW_TIMEOUT_MS
      : LIVE_FILL_TIMEOUT_MS;

    try {
      const data = await withTimeout(
        deps.fetchTimesForCourse(course, play_date, String(holes), String(players)),
        timeoutMs,
      );
      if (data == null || (typeof data === 'object' && data.error)) {
        failed++;
        by_slug[slug] = { ...by_slug[slug], live_failed: true };
        return;
      }
      let rows = deps.normalizeTimesWorker(course, data, String(holes));
      if (course.platform === 'chronogolf_slc') {
        rows = rows.map((row) => ({ ...row, spots: row.spots ?? players }));
      }
      const times = normalizedRowsToBatchTimes(slug, play_date, holes, players, rows);
      by_slug[slug] = {
        has_poll_coverage: true,
        spots_known: true,
        last_polled_at: new Date().toISOString(),
        times,
        source: 'live',
        live_failed: false,
      };
      filled++;
    } catch {
      failed++;
      by_slug[slug] = { ...by_slug[slug], live_failed: true };
    }
  });

  return { filled, failed };
}