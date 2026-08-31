/**
 * Background availability poller — snapshots vendor tee sheets into Supabase.
 *
 * Cron is a UTC heartbeat every 5 minutes; golf hours, tiers, and burst windows
 * are evaluated in America/Denver inside handleAvailabilityPoll.
 */

const MT = 'America/Denver';

/** Poll horizon: today through +14 days (alert + search window). */
const POLL_MAX_DAY_OFFSET = 14;

const GOLF_HOUR_START = 6;
const GOLF_HOUR_END = 23;
/**
 * Claims per 5-minute tick. Hot tier target is 5 min/course; ~67 courses × 2 hot
 * dates need a large hot claim + parallel vendor fetches to approach that.
 * Warm/cold get a smaller residual claim so they do not starve hot refresh.
 */
const HOT_CLAIM_BATCH_SIZE = 48;
const REST_CLAIM_BATCH_SIZE = 12;
/** Parallel (course, date) polls within one cron tick (vendor + Supabase I/O bound). */
const POLL_CONCURRENCY = 8;

const MS_HOT = 5 * 60 * 1000;
const MS_WARM = 15 * 60 * 1000;
const MS_COLD = 60 * 60 * 1000;

const SUPPORTED_PLATFORMS = new Set([
  'foreup',
  'chronogolf',
  'chronogolf_slc',
  'membersports',
  'teeitup',
  'trutee',
  'golfpay',
  'quick18',
]);

/**
 * Phantom-churn guards (3b): suppress false closed/reopened on flaky vendor sheets.
 * • Partial-fetch: if this poll returns far fewer rows than open inventory, skip ALL
 *   closes for the tick (incomplete API response — not proof slots were booked).
 *   Ratio is intentionally low: normal booking shrink (e.g. 8→5) must still close.
 * • Close debounce: only close after a slot has been missing longer than this window
 *   since last_seen_at (~1–2 effective hot poll cycles).
 */
const MIN_OPEN_SLOTS_FOR_PARTIAL_GUARD = 8;
const PARTIAL_FETCH_MIN_RATIO = 0.35;
const CLOSE_DEBOUNCE_MS = 20 * 60 * 1000;
/** Alert micro-poller: faster closes so real cancels become reopens quickly. */
const ALERT_CLOSE_DEBOUNCE_MS = 2.5 * 60 * 1000;
/** Skip alert pairs polled this recently (dedupe vs full poller / prior tick). */
const ALERT_POLL_MIN_INTERVAL_MS = 75 * 1000;
const ALERT_POLL_CONCURRENCY = 6;
/** Cap vendor fetches per alert cron tick. */
const ALERT_POLL_MAX_PAIRS = 40;

// ── Mountain Time helpers ───────────────────────────────────────────

function mtParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: MT,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value ?? '';
  return {
    dateYmd: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')),
    minute: Number(get('minute')),
  };
}

function addDaysYmd(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

function daysUntil(playDateYmd, todayMtYmd) {
  const [y1, m1, d1] = playDateYmd.split('-').map(Number);
  const [y2, m2, d2] = todayMtYmd.split('-').map(Number);
  const a = Date.UTC(y1, m1 - 1, d1);
  const b = Date.UTC(y2, m2 - 1, d2);
  return Math.round((a - b) / 86400000);
}

function pollIntervalMs(days) {
  if (days <= 1) return MS_HOT;
  if (days <= 6) return MS_WARM;
  if (days <= 14) return MS_COLD;
  return null;
}

function isGolfHours(mt) {
  return mt.hour >= GOLF_HOUR_START && mt.hour < GOLF_HOUR_END;
}

function isBookingBurstWindow(mt) {
  return mt.hour === 8 && mt.minute < 10;
}

function slugFromCourseName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function courseTimezone(course) {
  const tz = String(course?.timezone || '').trim();
  return tz || MT;
}

function wallClockToUtcInstant(y, mo, d, hh, mm, timeZone = MT) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
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

function rawTimeToLocalTime(dateYmd, rawTime) {
  const s = String(rawTime || '').trim();
  const full = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/);
  if (full) {
    const hh = Number(full[4]);
    const mm = Number(full[5]);
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`;
  }
  const timeOnly = s.match(/^(\d{1,2}):(\d{2})/);
  if (timeOnly) {
    const hh = Number(timeOnly[1]);
    const mm = Number(timeOnly[2]);
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`;
  }
  return null;
}

function playStartsAtIso(dateYmd, rawTime, timeZone = MT) {
  const local = rawTimeToLocalTime(dateYmd, rawTime);
  if (!local) return new Date(0).toISOString();
  const [hh, mm] = local.split(':').map(Number);
  const [y, mo, d] = dateYmd.split('-').map(Number);
  return wallClockToUtcInstant(y, mo, d, hh, mm, timeZone).toISOString();
}

function parsePriceCents(priceStr) {
  if (!priceStr) return null;
  const n = parseInt(String(priceStr).replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) ? n * 100 : null;
}

function holesToPoll(course) {
  // 9-only catalog: one pass. Multi / unknown: poll both so Find holes=9 has snapshot
  // fallback when Chronogolf live-fill 429s (canonical-18-only left those empty).
  if (course.holes === 9) return ['9'];
  return ['18', '9'];
}

function normalizeLocalTime(t) {
  if (!t) return null;
  const m = String(t).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return String(t).slice(0, 8);
  return `${String(Number(m[1])).padStart(2, '0')}:${m[2]}:00`;
}

function slotKey(startsAtLocal, holes) {
  return `${normalizeLocalTime(startsAtLocal) ?? startsAtLocal}|${holes}`;
}

// ── Supabase REST helpers ───────────────────────────────────────────

function sbHeaders(env, extra = {}) {
  return {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    ...extra,
  };
}

async function isPollingEnabled(env) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/app_config?key=eq.polling_enabled&select=value`,
    { headers: sbHeaders(env) },
  );
  if (!res.ok) return true;
  const rows = await res.json();
  const val = rows[0]?.value;
  if (val === false || val === 'false') return false;
  return true;
}

async function createPollRun(env) {
  const id = crypto.randomUUID();
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/availability_poll_runs`, {
    method: 'POST',
    headers: sbHeaders(env, {
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    }),
    body: JSON.stringify({ id, status: 'running' }),
  });
  if (!res.ok) return null;
  return id;
}

async function finishPollRun(env, id, patch) {
  await fetch(`${env.SUPABASE_URL}/rest/v1/availability_poll_runs?id=eq.${id}`, {
    method: 'PATCH',
    headers: sbHeaders(env, {
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    }),
    body: JSON.stringify({ finished_at: new Date().toISOString(), ...patch }),
  });
}

async function insertPollRunCourse(env, row) {
  await fetch(`${env.SUPABASE_URL}/rest/v1/availability_poll_run_courses`, {
    method: 'POST',
    headers: sbHeaders(env, {
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    }),
    body: JSON.stringify(row),
  });
}

/** Mark that search may trust the snapshot for this (course, date). Claim time is separate. */
async function markScheduleSuccess(env, course_slug, play_date) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/availability_poll_schedule` +
      `?course_slug=eq.${encodeURIComponent(course_slug)}` +
      `&play_date=eq.${play_date}`,
    {
      method: 'PATCH',
      headers: sbHeaders(env, {
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      }),
      body: JSON.stringify({ last_success_at: new Date().toISOString() }),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    console.error(
      `[poll] markScheduleSuccess failed ${course_slug} ${play_date}:`,
      res.status,
      text.slice(0, 200),
    );
  }
}

async function ensureScheduleRows(env, pairs) {
  if (!pairs.length) return 0;
  const body = pairs.map(({ course_slug, play_date }) => ({
    course_slug,
    play_date,
  }));
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/availability_poll_schedule?on_conflict=course_slug,play_date`,
    {
      method: 'POST',
      headers: sbHeaders(env, {
        'Content-Type': 'application/json',
        Prefer: 'resolution=ignore-duplicates,return=minimal',
      }),
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    const detail = `ensureScheduleRows HTTP ${res.status}: ${text.slice(0, 400)}`;
    console.error(`[poll] FATAL: ${detail}`);
    throw new Error(detail);
  }
  return body.length;
}

async function countDueScheduleRows(env, todayMt, maxPlayDate) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/availability_poll_schedule` +
      `?play_date=gte.${todayMt}&play_date=lte.${maxPlayDate}` +
      `&select=course_slug`,
    { headers: sbHeaders(env, { Prefer: 'count=exact' }) },
  );
  if (!res.ok) return null;
  const range = res.headers.get('content-range');
  if (!range) return null;
  const m = range.match(/\/(\d+)$/);
  return m ? Number(m[1]) : null;
}

/**
 * Single-statement batch claim via Postgres RPC (FOR UPDATE SKIP LOCKED).
 * Concurrent ticks cannot claim the same (course_slug, play_date).
 * Throws on RPC/HTTP failure — never masquerade a broken claim as "nothing due".
 */
async function claimPollBatch(env, todayMt, maxPlayDate, batchSize) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/claim_availability_poll_batch`, {
    method: 'POST',
    headers: sbHeaders(env, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      p_today_mt: todayMt,
      p_max_play_date: maxPlayDate,
      p_batch_size: batchSize,
      p_now: new Date().toISOString(),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    const detail = `claim_availability_poll_batch HTTP ${res.status}: ${text.slice(0, 400)}`;
    console.error(
      `[poll] FATAL: claim RPC failed — poller cannot run (is 20260708170100_claim_poll_batch_rpc.sql applied?). ${detail}`,
    );
    throw new Error(detail);
  }
  return res.json();
}

/**
 * Hot dates first (today+tomorrow), then a residual warm/cold fill.
 * Dedupes if a pair somehow appears in both claims.
 */
async function claimPollBatches(env, todayMt, maxPlayDate) {
  const hotMax = addDaysYmd(todayMt, 1);
  const claimedHot = await claimPollBatch(env, todayMt, hotMax, HOT_CLAIM_BATCH_SIZE);
  const claimedRest = await claimPollBatch(env, todayMt, maxPlayDate, REST_CLAIM_BATCH_SIZE);
  const seen = new Set();
  const out = [];
  for (const row of [...claimedHot, ...claimedRest]) {
    const key = `${row.course_slug}|${row.play_date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

async function mapPool(items, concurrency, fn) {
  if (items.length === 0) return [];
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

const SLOT_SELECT =
  'id,starts_at_local,holes,status,price_cents,spots_open,last_seen_at,play_date';
const ID_IN_CHUNK = 80;
const WRITE_CHUNK = 100;

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function loadExistingSlots(env, course_slug, play_date) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/tee_time_slots` +
      `?course_slug=eq.${encodeURIComponent(course_slug)}` +
      `&play_date=eq.${play_date}` +
      `&status=in.(open,closed)` +
      `&select=${SLOT_SELECT}`,
    { headers: sbHeaders(env) },
  );
  if (!res.ok) return [];
  return res.json();
}

async function bulkInsert(env, table, rows, { onConflict } = {}) {
  if (!rows.length) return true;
  const url = onConflict
    ? `${env.SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`
    : `${env.SUPABASE_URL}/rest/v1/${table}`;
  const prefer = onConflict
    ? 'resolution=merge-duplicates,return=minimal'
    : 'return=minimal';
  for (const part of chunk(rows, WRITE_CHUNK)) {
    const res = await fetch(url, {
      method: 'POST',
      headers: sbHeaders(env, {
        'Content-Type': 'application/json',
        Prefer: prefer,
      }),
      body: JSON.stringify(part),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(`[poll] bulk insert ${table} failed`, res.status, text.slice(0, 300));
      return false;
    }
  }
  return true;
}

async function bulkPatchSlotsByIds(env, ids, patch) {
  if (!ids.length) return true;
  const body = JSON.stringify({ updated_at: new Date().toISOString(), ...patch });
  for (const part of chunk(ids, ID_IN_CHUNK)) {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/tee_time_slots?id=in.(${part.join(',')})`,
      {
        method: 'PATCH',
        headers: sbHeaders(env, {
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        }),
        body,
      },
    );
    if (!res.ok) {
      const text = await res.text();
      console.error('[poll] bulk patch failed', res.status, text.slice(0, 300));
      return false;
    }
  }
  return true;
}

async function patchSlot(env, id, patch) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/tee_time_slots?id=eq.${id}`, {
    method: 'PATCH',
    headers: sbHeaders(env, {
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    }),
    body: JSON.stringify({ updated_at: new Date().toISOString(), ...patch }),
  });
  return res.ok;
}

async function pruneAvailabilityHistory(env) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/prune_availability_history`, {
    method: 'POST',
    headers: sbHeaders(env, { 'Content-Type': 'application/json' }),
    body: '{}',
  });
  if (!res.ok) {
    const text = await res.text();
    console.warn('[poll] prune_availability_history failed', res.status, text.slice(0, 200));
    return;
  }
  try {
    const summary = await res.json();
    if (summary && (summary.expired || summary.slots_deleted || summary.events_deleted || summary.runs_deleted)) {
      console.log('[poll] prune', summary);
    }
  } catch {
    // empty body
  }
}

// ── Schedule planning ───────────────────────────────────────────────

function pollableCourses(courses) {
  return courses
    .filter((c) => {
      const status = String(c.booking_status || '').trim();
      if (status === 'closed' || status === 'private' || status === 'phone' || status === 'unsupported') return false;
      return c.platform && SUPPORTED_PLATFORMS.has(c.platform);
    })
    .map((c) => ({ ...c, slug: slugFromCourseName(c.name) }));
}

function regularPlayDates(todayMt) {
  const dates = [];
  for (let offset = 0; offset <= POLL_MAX_DAY_OFFSET; offset++) {
    dates.push(addDaysYmd(todayMt, offset));
  }
  return dates;
}

function buildCandidatePairs(courses, todayMt, burstCourses = []) {
  const dates = new Set(regularPlayDates(todayMt));
  for (const { slug, play_date } of burstCourses) {
    if (daysUntil(play_date, todayMt) <= 14) dates.add(play_date);
  }
  const pairs = [];
  for (const course of courses) {
    for (const play_date of dates) {
      pairs.push({ course_slug: course.slug, play_date, course });
    }
  }
  return pairs;
}

// ── Diff engine ─────────────────────────────────────────────────────

async function applyPollDiff(env, {
  course,
  play_date,
  normalizedRows,
  poll_run_id,
  closeDebounceMs = CLOSE_DEBOUNCE_MS,
}) {
  const now = new Date().toISOString();
  const nowMs = Date.now();
  const debounceMs = Number.isFinite(closeDebounceMs) ? closeDebounceMs : CLOSE_DEBOUNCE_MS;
  const existing = await loadExistingSlots(env, course.slug, play_date);
  const byKey = new Map();
  for (const slot of existing) {
    byKey.set(slotKey(normalizeLocalTime(slot.starts_at_local), slot.holes), slot);
  }

  const seen = new Set();
  const toInsert = [];
  const toTouchIds = [];
  const toReopen = [];
  const toPatchMeta = [];
  const events = [];
  /** @type {{ event_type: string, starts_at_local: string, holes: number, price_cents: number|null, spots_open: number|null }[]} */
  const notifyEvents = [];

  for (const row of normalizedRows) {
    if (!row.rawTime) continue;
    const startsAtLocal = rawTimeToLocalTime(play_date, row.rawTime);
    if (!startsAtLocal) continue;
    const holes = row.holes === 9 ? 9 : 18;
    const key = slotKey(startsAtLocal, holes);
    seen.add(key);

    const price_cents = parsePriceCents(row.price);
    const spots_open = row.spots != null ? row.spots : null;
    const play_starts_at = playStartsAtIso(play_date, row.rawTime, courseTimezone(course));
    const prev = byKey.get(key);

    if (!prev) {
      const id = crypto.randomUUID();
      toInsert.push({
        id,
        course_slug: course.slug,
        play_date,
        starts_at_local: startsAtLocal,
        play_starts_at,
        holes,
        status: 'open',
        price_cents,
        spots_open,
        platform: course.platform,
        first_opened_at: now,
        last_seen_at: now,
        last_polled_at: now,
      });
      events.push({
        slot_id: id,
        course_slug: course.slug,
        play_date,
        starts_at_local: startsAtLocal,
        holes,
        event_type: 'opened',
        price_cents,
        spots_open,
        poll_run_id,
      });
      notifyEvents.push({
        event_type: 'opened',
        starts_at_local: startsAtLocal,
        holes,
        price_cents,
        spots_open,
      });
      continue;
    }

    if (prev.status === 'closed') {
      toReopen.push({
        id: prev.id,
        price_cents,
        spots_open,
        startsAtLocal,
        holes,
      });
      events.push({
        slot_id: prev.id,
        course_slug: course.slug,
        play_date,
        starts_at_local: startsAtLocal,
        holes,
        event_type: 'reopened',
        price_cents,
        spots_open,
        poll_run_id,
      });
      notifyEvents.push({
        event_type: 'reopened',
        starts_at_local: startsAtLocal,
        holes,
        price_cents,
        spots_open,
      });
      continue;
    }

    const spotsChanged = spots_open !== prev.spots_open;
    const priceChanged = price_cents != null && price_cents !== prev.price_cents;
    if (spotsChanged || priceChanged) {
      const patch = { last_seen_at: now, last_polled_at: now, spots_open };
      if (price_cents != null) patch.price_cents = price_cents;
      toPatchMeta.push({ id: prev.id, patch });
    } else {
      toTouchIds.push(prev.id);
    }

    // Spots freed while row stayed open (partial book/cancel) — notify path only;
    // not persisted to tee_time_slot_events (DB check constraint).
    if (
      spots_open != null &&
      prev.spots_open != null &&
      spots_open > prev.spots_open
    ) {
      notifyEvents.push({
        event_type: 'spots_available',
        starts_at_local: startsAtLocal,
        holes,
        price_cents,
        spots_open,
      });
    }

    if (price_cents != null && prev.price_cents != null && price_cents !== prev.price_cents) {
      events.push({
        slot_id: prev.id,
        course_slug: course.slug,
        play_date,
        starts_at_local: startsAtLocal,
        holes,
        event_type: 'price_changed',
        old_price_cents: prev.price_cents,
        new_price_cents: price_cents,
        price_cents,
        spots_open,
        poll_run_id,
      });
    }
  }

  const openSlots = existing.filter((s) => s.status === 'open');
  const partialFetch =
    openSlots.length >= MIN_OPEN_SLOTS_FOR_PARTIAL_GUARD &&
    seen.size < openSlots.length * PARTIAL_FETCH_MIN_RATIO;

  if (partialFetch) {
    console.warn(
      `[poll] partial-fetch guard: ${course.slug} ${play_date} ` +
        `seen=${seen.size} open=${openSlots.length} — skipping closes`,
    );
  }

  let closesSkippedDebounce = 0;
  let closesSkippedPartial = 0;
  const toCloseIds = [];

  for (const slot of existing) {
    const local = normalizeLocalTime(slot.starts_at_local);
    const key = slotKey(local, slot.holes);
    if (seen.has(key) || slot.status === 'closed') continue;

    const lastSeenMs = slot.last_seen_at ? Date.parse(slot.last_seen_at) : 0;
    const withinDebounce = lastSeenMs && nowMs - lastSeenMs < debounceMs;

    // Partial-fetch only protects recently-seen slots. Aged missing slots must
    // still close — otherwise zombies inflate openSlots and the guard deadlocks.
    // Do not bump last_polled_at here — Find freshness uses last_seen_at, and a
    // refreshed last_polled with a stale last_seen was painting sold-out chips.
    if (partialFetch && withinDebounce) {
      closesSkippedPartial++;
      continue;
    }

    if (!partialFetch && withinDebounce) {
      closesSkippedDebounce++;
      continue;
    }

    toCloseIds.push(slot.id);
    events.push({
      slot_id: slot.id,
      course_slug: course.slug,
      play_date: slot.play_date,
      starts_at_local: local,
      holes: slot.holes,
      event_type: 'closed',
      price_cents: slot.price_cents,
      spots_open: slot.spots_open,
      poll_run_id,
    });
  }

  if (closesSkippedDebounce > 0) {
    console.warn(
      `[poll] close debounce: ${course.slug} ${play_date} ` +
        `skipped ${closesSkippedDebounce} close(s) (<${debounceMs / 60000}m since last_seen)`,
    );
  }

  const insertedOk = await bulkInsert(env, 'tee_time_slots', toInsert, {
    onConflict: 'course_slug,play_date,starts_at_local,holes',
  });
  if (!insertedOk) {
    const openedIds = new Set(toInsert.map((r) => r.id));
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].event_type === 'opened' && openedIds.has(events[i].slot_id)) {
        events.splice(i, 1);
      }
    }
    for (let i = notifyEvents.length - 1; i >= 0; i--) {
      if (notifyEvents[i].event_type === 'opened') notifyEvents.splice(i, 1);
    }
  }

  await bulkPatchSlotsByIds(env, toTouchIds, { last_seen_at: now, last_polled_at: now });

  for (const row of toReopen) {
    await patchSlot(env, row.id, {
      status: 'open',
      closed_at: null,
      price_cents: row.price_cents,
      spots_open: row.spots_open,
      last_seen_at: now,
      last_polled_at: now,
    });
  }
  for (const row of toPatchMeta) {
    await patchSlot(env, row.id, row.patch);
  }

  await bulkPatchSlotsByIds(env, toCloseIds, {
    status: 'closed',
    closed_at: now,
    last_polled_at: now,
  });

  const eventsOk = await bulkInsert(env, 'tee_time_slot_events', events);
  const slotsWritten =
    (insertedOk ? toInsert.length : 0) +
    toTouchIds.length +
    toReopen.length +
    toPatchMeta.length +
    toCloseIds.length;

  return {
    slotsWritten,
    eventsWritten: eventsOk ? events.length : 0,
    notifyEvents,
    diffMeta: {
      partialFetch,
      closesSkippedDebounce,
      closesSkippedPartial,
    },
  };
}

// ── Single (course, date) poll ──────────────────────────────────────

/** Chronogolf SLC filters capacity via affiliation_type_ids[] count — infer spots with 4→1 passes. */
async function pollNormalizedRows(course, play_date, holes, fetchTimesForCourse, normalizeTimesWorker) {
  if (course.platform !== 'chronogolf_slc') {
    const data = await fetchTimesForCourse(course, play_date, holes, '1');
    if (data && typeof data === 'object' && data.error) return { rows: null, error: data.error };
    if (data == null) return { rows: null, error: 'fetch_failed' };
    return { rows: data === false ? [] : normalizeTimesWorker(course, data, holes) };
  }

  const byTime = new Map();
  const passes = await Promise.all(
    [4, 3, 2, 1].map(async (players) => {
      const data = await fetchTimesForCourse(course, play_date, holes, String(players));
      if (!data || data === false || (typeof data === 'object' && data.error)) {
        return { players, rows: [] };
      }
      return { players, rows: normalizeTimesWorker(course, data, holes) };
    }),
  );

  for (const { players, rows } of passes) {
    for (const row of rows) {
      if (!row.rawTime || byTime.has(row.rawTime)) continue;
      byTime.set(row.rawTime, { ...row, spots: players });
    }
  }

  return { rows: Array.from(byTime.values()) };
}

async function pollCourseDate(
  env,
  course,
  play_date,
  poll_run_id,
  fetchTimesForCourse,
  normalizeTimesWorker,
  { closeDebounceMs = CLOSE_DEBOUNCE_MS } = {},
) {
  const started = Date.now();
  const holePasses = holesToPoll(course);
  /** @type {Array<{rawTime:string,spots:number|null,price:string|null,holes:number}>} */
  const mergedRows = [];
  let lastError = null;

  for (const holes of holePasses) {
    const { rows, error } = await pollNormalizedRows(
      course,
      play_date,
      holes,
      fetchTimesForCourse,
      normalizeTimesWorker,
    );
    if (error) {
      lastError = error;
      continue;
    }
    if (rows == null) {
      lastError = 'fetch_failed';
      continue;
    }
    mergedRows.push(...rows);
  }

  if (mergedRows.length === 0 && lastError) {
    return {
      status: 'failed',
      slots_written: 0,
      events_written: 0,
      latency_ms: Date.now() - started,
      error_message: lastError,
    };
  }

  const { slotsWritten, eventsWritten, notifyEvents, diffMeta } = await applyPollDiff(env, {
    course,
    play_date,
    normalizedRows: mergedRows,
    poll_run_id,
    closeDebounceMs,
  });

  const partialGuard =
    diffMeta?.partialFetch ||
    (diffMeta?.closesSkippedDebounce ?? 0) > 0 ||
    (diffMeta?.closesSkippedPartial ?? 0) > 0;

  return {
    status: 'ok',
    slots_written: slotsWritten,
    events_written: eventsWritten,
    notify_events: notifyEvents,
    latency_ms: Date.now() - started,
    error_message: partialGuard
      ? `churn_guard:partial=${diffMeta?.partialFetch ?? false},` +
        `debounce_skipped=${diffMeta?.closesSkippedDebounce ?? 0},` +
        `partial_skipped=${diffMeta?.closesSkippedPartial ?? 0}`
      : null,
  };
}

// ── Burst candidates (8:00–8:10 MT, once per course per day) ────────

async function loadBurstCandidates(env, courses, todayMt, mt) {
  if (!isBookingBurstWindow(mt)) return [];

  const slugs = courses.map((c) => c.slug);
  if (!slugs.length) return [];

  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/course_catalog` +
      `?slug=in.(${slugs.map((s) => `"${s}"`).join(',')})` +
      `&booking_window_days=not.is.null` +
      `&select=slug,booking_window_days,booking_opens_time,last_booking_burst_poll_on`,
    { headers: sbHeaders(env) },
  );
  if (!res.ok) return [];

  const catalog = await res.json();
  const bySlug = new Map(catalog.map((r) => [r.slug, r]));
  const out = [];

  for (const course of courses) {
    const meta = bySlug.get(course.slug);
    const windowDays = Number(meta?.booking_window_days ?? course.booking_window_days);
    if (!Number.isFinite(windowDays) || windowDays < 1) continue;
    if (meta?.last_booking_burst_poll_on === todayMt) continue;

    const play_date = addDaysYmd(todayMt, windowDays);
    if (daysUntil(play_date, todayMt) > 14) continue;
    out.push({ slug: course.slug, play_date, course });
  }
  return out;
}

async function markBurstPollDone(env, course, todayMt) {
  await fetch(`${env.SUPABASE_URL}/rest/v1/course_catalog?on_conflict=slug`, {
    method: 'POST',
    headers: sbHeaders(env, {
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    }),
    body: JSON.stringify({
      slug: course.slug,
      name: course.name,
      last_booking_burst_poll_on: todayMt,
    }),
  });
}

// ── Main cron entry ─────────────────────────────────────────────────

function summarizeRunStatus(coursesOk, coursesFailed, coursesClaimed, runErrored) {
  if (runErrored) return 'failed';
  if (!coursesClaimed) return 'ok';
  if (coursesFailed && coursesOk) return 'partial';
  if (coursesFailed && !coursesOk) return 'failed';
  return 'ok';
}

async function pollOneClaimedCourse(env, {
  pollRunId,
  row,
  course,
  burstCandidates,
  todayMt,
  fetchTimesForCourse,
  normalizeTimesWorker,
  onPollNotifyEvents,
  closeDebounceMs = CLOSE_DEBOUNCE_MS,
}) {
  const started = Date.now();
  const baseRow = {
    poll_run_id: pollRunId,
    course_slug: row.course_slug,
    play_date: row.play_date,
  };

  try {
    const result = await pollCourseDate(
      env,
      course,
      row.play_date,
      pollRunId,
      fetchTimesForCourse,
      normalizeTimesWorker,
      { closeDebounceMs },
    );

    await insertPollRunCourse(env, {
      ...baseRow,
      status: result.status,
      slots_written: result.slots_written,
      events_written: result.events_written,
      latency_ms: result.latency_ms,
      error_message: result.error_message,
    });

    if (result.status === 'ok') {
      await markScheduleSuccess(env, row.course_slug, row.play_date);

      const burst = burstCandidates.find(
        (b) => b.slug === row.course_slug && b.play_date === row.play_date,
      );
      if (burst) await markBurstPollDone(env, burst.course, todayMt);

      if (result.notify_events?.length && onPollNotifyEvents) {
        try {
          await onPollNotifyEvents({
            course,
            playDate: row.play_date,
            notifyEvents: result.notify_events,
            todayMt,
          });
        } catch (notifyErr) {
          console.error(`[poll] notify failed ${row.course_slug} ${row.play_date}:`, notifyErr);
        }
      }
    }

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[poll] ${row.course_slug} threw:`, err);
    await insertPollRunCourse(env, {
      ...baseRow,
      status: 'failed',
      slots_written: 0,
      events_written: 0,
      latency_ms: Date.now() - started,
      error_message: message.slice(0, 500),
    });
    return {
      status: 'failed',
      slots_written: 0,
      events_written: 0,
      latency_ms: Date.now() - started,
      error_message: message,
    };
  }
}

/** Mark schedule row as recently polled so the full poller claim skips it soon. */
async function touchSchedulePolled(env, course_slug, play_date) {
  const now = new Date().toISOString();
  await fetch(
    `${env.SUPABASE_URL}/rest/v1/availability_poll_schedule` +
      `?course_slug=eq.${encodeURIComponent(course_slug)}` +
      `&play_date=eq.${play_date}`,
    {
      method: 'PATCH',
      headers: sbHeaders(env, {
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      }),
      body: JSON.stringify({ last_polled_at: now, last_success_at: now }),
    },
  );
}

async function loadScheduleLastPolledMap(env, pairs) {
  /** @type {Map<string, number>} */
  const map = new Map();
  if (!pairs.length) return map;
  const chunks = chunk(pairs, 40);
  for (const part of chunks) {
    const or = part
      .map(({ course_slug, play_date }) => {
        const slug = String(course_slug).replace(/[^a-z0-9-]/gi, '');
        return `and(course_slug.eq."${slug}",play_date.eq.${play_date})`;
      })
      .join(',');
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/availability_poll_schedule` +
        `?or=(${or})&select=course_slug,play_date,last_polled_at`,
      { headers: sbHeaders(env) },
    );
    if (!res.ok) continue;
    const rows = await res.json();
    for (const row of rows || []) {
      const ts = row.last_polled_at ? Date.parse(row.last_polled_at) : 0;
      map.set(`${row.course_slug}|${row.play_date}`, Number.isFinite(ts) ? ts : 0);
    }
  }
  return map;
}

/**
 * Expand active notification_preferences into distinct (course, play_date) watches.
 * @returns {Promise<{ course: object, course_slug: string, play_date: string }[]>}
 */
async function loadAlertWatchPairs(env, courses, todayMt) {
  const byName = new Map(courses.map((c) => [c.name, c]));

  const [specRes, openRes] = await Promise.all([
    fetch(
      `${env.SUPABASE_URL}/rest/v1/notification_preferences` +
        `?active=eq.true&target_date=not.is.null&target_date=gte.${todayMt}` +
        `&select=course_id,target_date`,
      { headers: sbHeaders(env) },
    ),
    fetch(
      `${env.SUPABASE_URL}/rest/v1/notification_preferences` +
        `?active=eq.true&target_date=is.null&look_ahead_days=not.is.null` +
        `&select=course_id,days_of_week,look_ahead_days`,
      { headers: sbHeaders(env) },
    ),
  ]);

  const specific = specRes.ok ? await specRes.json() : [];
  const weekly = openRes.ok ? await openRes.json() : [];
  /** @type {Map<string, { course: object, course_slug: string, play_date: string }>} */
  const pairs = new Map();

  const add = (course, play_date) => {
    if (!course || !play_date || play_date < todayMt) return;
    if (daysUntil(play_date, todayMt) > POLL_MAX_DAY_OFFSET) return;
    const key = `${course.slug}|${play_date}`;
    if (!pairs.has(key)) pairs.set(key, { course, course_slug: course.slug, play_date });
  };

  for (const pref of specific) {
    const course = byName.get(pref.course_id);
    if (!course) continue;
    add(course, pref.target_date);
  }

  for (const pref of weekly) {
    const course = byName.get(pref.course_id);
    if (!course) continue;
    const horizon = Math.min(Math.max(Number(pref.look_ahead_days) || 14, 1), 60);
    const dowAllow =
      Array.isArray(pref.days_of_week) && pref.days_of_week.length
        ? pref.days_of_week
        : [0, 1, 2, 3, 4, 5, 6];
    for (let d = 0; d < horizon; d++) {
      const play_date = addDaysYmd(todayMt, d);
      const [y, m, day] = play_date.split('-').map(Number);
      const dow = new Date(Date.UTC(y, m - 1, day)).getUTCDay();
      if (!dowAllow.includes(dow)) continue;
      add(course, play_date);
    }
  }

  return [...pairs.values()];
}

/**
 * 24/7 micro-poller for (course, date) pairs with active alerts.
 * Uses a shorter close debounce so cancels reopen quickly enough to notify.
 */
export async function handleAlertMicroPoll(env, deps) {
  const { loadCourses, fetchTimesForCourse, normalizeTimesWorker, onPollNotifyEvents } = deps;

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    console.error('[alert-poll] missing Supabase credentials');
    return { polled: 0 };
  }

  if (!(await isPollingEnabled(env))) {
    console.warn('[alert-poll] skipped_kill_switch');
    return { polled: 0, skipped: 'kill_switch' };
  }

  const courses = pollableCourses(await loadCourses(env));
  if (!courses.length) return { polled: 0 };

  const todayMt = mtParts().dateYmd;
  const allPairs = await loadAlertWatchPairs(env, courses, todayMt);
  if (!allPairs.length) return { polled: 0 };

  await ensureScheduleRows(
    env,
    allPairs.map(({ course_slug, play_date }) => ({ course_slug, play_date })),
  );

  const lastPolled = await loadScheduleLastPolledMap(env, allPairs);
  const nowMs = Date.now();
  const due = allPairs
    .map((p) => {
      const ts = lastPolled.get(`${p.course_slug}|${p.play_date}`) || 0;
      return { ...p, lastPolledMs: ts };
    })
    .filter((p) => nowMs - p.lastPolledMs >= ALERT_POLL_MIN_INTERVAL_MS)
    .sort((a, b) => a.lastPolledMs - b.lastPolledMs)
    .slice(0, ALERT_POLL_MAX_PAIRS);

  if (!due.length) return { polled: 0, skipped: 'recent' };

  const pollRunId = await createPollRun(env);
  let polled = 0;
  let failed = 0;

  await mapPool(due, ALERT_POLL_CONCURRENCY, async (row) => {
    const result = await pollCourseDate(
      env,
      row.course,
      row.play_date,
      pollRunId,
      fetchTimesForCourse,
      normalizeTimesWorker,
      { closeDebounceMs: ALERT_CLOSE_DEBOUNCE_MS },
    );

    if (result.status === 'ok') {
      polled++;
      await touchSchedulePolled(env, row.course_slug, row.play_date);
      if (result.notify_events?.length && onPollNotifyEvents) {
        try {
          await onPollNotifyEvents({
            course: row.course,
            playDate: row.play_date,
            notifyEvents: result.notify_events,
            todayMt,
          });
        } catch (notifyErr) {
          console.error(`[alert-poll] notify failed ${row.course_slug} ${row.play_date}:`, notifyErr);
        }
      }
    } else {
      failed++;
      console.warn(
        `[alert-poll] failed ${row.course_slug} ${row.play_date}: ${result.error_message || 'unknown'}`,
      );
    }

    if (pollRunId) {
      await insertPollRunCourse(env, {
        poll_run_id: pollRunId,
        course_slug: row.course_slug,
        play_date: row.play_date,
        status: result.status,
        slots_written: result.slots_written,
        events_written: result.events_written,
        latency_ms: result.latency_ms,
        error_message: result.error_message
          ? `alert_micro:${result.error_message}`.slice(0, 500)
          : 'alert_micro',
      });
    }
  });

  if (pollRunId) {
    await finishPollRun(env, pollRunId, {
      status: failed && polled ? 'partial' : failed ? 'failed' : 'ok',
      courses_claimed: due.length,
      courses_ok: polled,
      courses_failed: failed,
      error_summary: failed ? `alert_micro failed=${failed}` : null,
    });
  }

  console.log(`[alert-poll] due=${due.length} ok=${polled} failed=${failed}`);
  return { polled, failed, due: due.length };
}

/**
 * Poll one (course, date) with alert-sensitive debounce — used on alert create.
 */
export async function pollAlertCourseDate(env, {
  course,
  playDate,
  fetchTimesForCourse,
  normalizeTimesWorker,
  onPollNotifyEvents,
  todayMt,
}) {
  const pollRunId = await createPollRun(env);
  await ensureScheduleRows(env, [{ course_slug: course.slug, play_date: playDate }]);
  const result = await pollCourseDate(
    env,
    course,
    playDate,
    pollRunId,
    fetchTimesForCourse,
    normalizeTimesWorker,
    { closeDebounceMs: ALERT_CLOSE_DEBOUNCE_MS },
  );
  if (result.status === 'ok') {
    await touchSchedulePolled(env, course.slug, playDate);
    if (result.notify_events?.length && onPollNotifyEvents) {
      await onPollNotifyEvents({
        course,
        playDate,
        notifyEvents: result.notify_events,
        todayMt: todayMt || mtParts().dateYmd,
      });
    }
  }
  if (pollRunId) {
    await insertPollRunCourse(env, {
      poll_run_id: pollRunId,
      course_slug: course.slug,
      play_date: playDate,
      status: result.status,
      slots_written: result.slots_written || 0,
      events_written: result.events_written || 0,
      latency_ms: result.latency_ms || 0,
      error_message: result.error_message
        ? `alert_create:${result.error_message}`.slice(0, 500)
        : 'alert_create',
    });
    await finishPollRun(env, pollRunId, {
      status: result.status === 'ok' ? 'ok' : 'failed',
      courses_claimed: 1,
      courses_ok: result.status === 'ok' ? 1 : 0,
      courses_failed: result.status === 'ok' ? 0 : 1,
    });
  }
  return result;
}

export async function handleAvailabilityPoll(env, deps) {
  const { loadCourses, fetchTimesForCourse, normalizeTimesWorker, onPollNotifyEvents } = deps;

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    console.error('[poll] missing Supabase credentials');
    return;
  }

  const mt = mtParts();
  if (!isGolfHours(mt)) {
    const runId = await createPollRun(env);
    if (runId) {
      await finishPollRun(env, runId, {
        status: 'skipped_off_hours',
        courses_claimed: 0,
      });
    }
    await pruneAvailabilityHistory(env);
    return;
  }

  if (!(await isPollingEnabled(env))) {
    const runId = await createPollRun(env);
    if (runId) {
      await finishPollRun(env, runId, {
        status: 'skipped_kill_switch',
        courses_claimed: 0,
      });
    }
    return;
  }

  const courses = pollableCourses(await loadCourses(env));
  if (!courses.length) return;

  const todayMt = mt.dateYmd;
  const burstCandidates = await loadBurstCandidates(env, courses, todayMt, mt);
  const candidatePairs = buildCandidatePairs(courses, todayMt, burstCandidates);

  const pollRunId = await createPollRun(env);
  if (!pollRunId) {
    console.error('[poll] failed to create poll run');
    return;
  }

  let coursesClaimed = 0;
  let coursesOk = 0;
  let coursesFailed = 0;
  let slotsUpserted = 0;
  let eventsWritten = 0;
  let runErrored = false;
  const errors = [];

  try {
    let maxPlayDate = addDaysYmd(todayMt, POLL_MAX_DAY_OFFSET);
    for (const b of burstCandidates) {
      if (b.play_date > maxPlayDate) maxPlayDate = b.play_date;
    }

    const courseBySlug = new Map(courses.map((c) => [c.slug, c]));
    const schedulePairs = candidatePairs.length;
    const ensured = await ensureScheduleRows(
      env,
      candidatePairs.map(({ course_slug, play_date }) => ({ course_slug, play_date })),
    );
    const claimed = await claimPollBatches(env, todayMt, maxPlayDate);

    if (!claimed.length) {
      const schedRows = await countDueScheduleRows(env, todayMt, maxPlayDate);
      const msg =
        `claim returned 0 (today=${todayMt}, pairs=${schedulePairs}, ensured=${ensured}, ` +
        `schedule_rows_in_range=${schedRows ?? 'unknown'})`;
      console.warn(`[poll] ${msg}`);
      if (schedRows != null && schedRows > 0) {
        runErrored = true;
        errors.push(`claim:${msg}`);
      }
    }

    const pollResults = await mapPool(claimed, POLL_CONCURRENCY, async (row) => {
      const course = courseBySlug.get(row.course_slug);
      if (!course) {
        console.warn(`[poll] unknown course_slug claimed: ${row.course_slug}`);
        return null;
      }
      const result = await pollOneClaimedCourse(env, {
        pollRunId,
        row,
        course,
        burstCandidates,
        todayMt,
        fetchTimesForCourse,
        normalizeTimesWorker,
        onPollNotifyEvents,
      });
      return { ...result, course_slug: row.course_slug, play_date: row.play_date };
    });

    for (const result of pollResults) {
      if (!result) continue;
      coursesClaimed++;
      if (result.status === 'ok') {
        coursesOk++;
        slotsUpserted += result.slots_written;
        eventsWritten += result.events_written;
      } else {
        coursesFailed++;
        if (result.error_message) {
          errors.push(`${result.course_slug}:${result.error_message}`);
        }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    runErrored = true;
    console.error('[poll] run-level failure:', err);
    errors.push(`run:${message}`);
  } finally {
    try {
      await finishPollRun(env, pollRunId, {
        status: summarizeRunStatus(coursesOk, coursesFailed, coursesClaimed, runErrored),
        courses_claimed: coursesClaimed,
        courses_ok: coursesOk,
        courses_failed: coursesFailed,
        slots_upserted: slotsUpserted,
        events_written: eventsWritten,
        error_summary: errors.length ? errors.slice(0, 5).join('; ') : null,
      });
    } catch (finishErr) {
      console.error('[poll] failed to finalize poll run:', finishErr);
    }
  }
}
