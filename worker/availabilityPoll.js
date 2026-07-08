/**
 * Background availability poller — snapshots vendor tee sheets into Supabase.
 *
 * Cron is a UTC heartbeat every 5 minutes; golf hours, tiers, and burst windows
 * are evaluated in America/Denver inside handleAvailabilityPoll.
 */

const MT = 'America/Denver';

/** Phase 2: today only. Raise to 14 when expanding the poll horizon. */
const POLL_MAX_DAY_OFFSET = 0;

const GOLF_HOUR_START = 6;
const GOLF_HOUR_END = 23;
/**
 * Claims per 5-minute tick. Hot tier target is 5 min/course but with ~67 courses
 * effective cadence ≈ ceil(67 / CLAIM_BATCH_SIZE) × 5 min (~35 min today).
 * Raise batch size (or use Queues) before alerts v2 / reopened badges depend on hot latency.
 */
const CLAIM_BATCH_SIZE = 10;

const MS_HOT = 5 * 60 * 1000;
const MS_WARM = 15 * 60 * 1000;
const MS_COLD = 60 * 60 * 1000;

const SUPPORTED_PLATFORMS = new Set([
  'foreup',
  'chronogolf',
  'chronogolf_slc',
  'membersports',
]);

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

function wallClockToUtcInstant(y, mo, d, hh, mm) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: MT,
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

function playStartsAtIso(dateYmd, rawTime) {
  const local = rawTimeToLocalTime(dateYmd, rawTime);
  if (!local) return new Date(0).toISOString();
  const [hh, mm] = local.split(':').map(Number);
  const [y, mo, d] = dateYmd.split('-').map(Number);
  return wallClockToUtcInstant(y, mo, d, hh, mm).toISOString();
}

function parsePriceCents(priceStr) {
  if (!priceStr) return null;
  const n = parseInt(String(priceStr).replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) ? n * 100 : null;
}

function canonicalHolesForPoll(course) {
  return course.holes === 9 ? 9 : 18;
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
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/availability_poll_runs`, {
    method: 'POST',
    headers: sbHeaders(env, {
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    }),
    body: JSON.stringify({ status: 'running' }),
  });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0]?.id ?? null;
}

async function finishPollRun(env, id, patch) {
  await fetch(`${env.SUPABASE_URL}/rest/v1/availability_poll_runs?id=eq.${id}`, {
    method: 'PATCH',
    headers: sbHeaders(env, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ finished_at: new Date().toISOString(), ...patch }),
  });
}

async function insertPollRunCourse(env, row) {
  await fetch(`${env.SUPABASE_URL}/rest/v1/availability_poll_run_courses`, {
    method: 'POST',
    headers: sbHeaders(env, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(row),
  });
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

async function loadExistingSlots(env, course_slug, play_date) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/tee_time_slots` +
      `?course_slug=eq.${encodeURIComponent(course_slug)}` +
      `&play_date=eq.${play_date}` +
      `&status=in.(open,closed)` +
      `&select=*`,
    { headers: sbHeaders(env) },
  );
  if (!res.ok) return [];
  return res.json();
}

async function upsertSlot(env, row) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/tee_time_slots?on_conflict=course_slug,play_date,starts_at_local,holes`,
    {
      method: 'POST',
      headers: sbHeaders(env, {
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=representation',
      }),
      body: JSON.stringify(row),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    console.error('[poll] slot upsert failed', res.status, text.slice(0, 300));
    return null;
  }
  const rows = await res.json();
  return rows[0] ?? null;
}

async function patchSlot(env, id, patch) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/tee_time_slots?id=eq.${id}`, {
    method: 'PATCH',
    headers: sbHeaders(env, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ updated_at: new Date().toISOString(), ...patch }),
  });
  return res.ok;
}

async function insertEvent(env, event) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/tee_time_slot_events`, {
    method: 'POST',
    headers: sbHeaders(env, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(event),
  });
  return res.ok;
}

// ── Schedule planning ───────────────────────────────────────────────

function pollableCourses(courses) {
  return courses
    .filter((c) => c.platform && SUPPORTED_PLATFORMS.has(c.platform))
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
}) {
  const now = new Date().toISOString();
  const existing = await loadExistingSlots(env, course.slug, play_date);
  const byKey = new Map();
  for (const slot of existing) {
    byKey.set(slotKey(normalizeLocalTime(slot.starts_at_local), slot.holes), slot);
  }

  const seen = new Set();
  let slotsWritten = 0;
  let eventsWritten = 0;

  for (const row of normalizedRows) {
    if (!row.rawTime) continue;
    const startsAtLocal = rawTimeToLocalTime(play_date, row.rawTime);
    if (!startsAtLocal) continue;
    const holes = row.holes === 9 ? 9 : 18;
    const key = slotKey(startsAtLocal, holes);
    seen.add(key);

    const price_cents = parsePriceCents(row.price);
    const spots_open = row.spots != null ? row.spots : null;
    const play_starts_at = playStartsAtIso(play_date, row.rawTime);
    const prev = byKey.get(key);

    if (!prev) {
      const inserted = await upsertSlot(env, {
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
      if (inserted) {
        slotsWritten++;
        if (await insertEvent(env, {
          slot_id: inserted.id,
          course_slug: course.slug,
          play_date,
          starts_at_local: startsAtLocal,
          holes,
          event_type: 'opened',
          price_cents,
          spots_open,
          poll_run_id,
        })) eventsWritten++;
      }
      continue;
    }

    if (prev.status === 'closed') {
      await patchSlot(env, prev.id, {
        status: 'open',
        closed_at: null,
        price_cents,
        spots_open,
        last_seen_at: now,
        last_polled_at: now,
      });
      slotsWritten++;
      if (await insertEvent(env, {
        slot_id: prev.id,
        course_slug: course.slug,
        play_date,
        starts_at_local: startsAtLocal,
        holes,
        event_type: 'reopened',
        price_cents,
        spots_open,
        poll_run_id,
      })) eventsWritten++;
      continue;
    }

    const patch = { last_seen_at: now, last_polled_at: now, spots_open };
    if (price_cents != null) patch.price_cents = price_cents;
    await patchSlot(env, prev.id, patch);
    slotsWritten++;

    if (price_cents != null && prev.price_cents != null && price_cents !== prev.price_cents) {
      if (await insertEvent(env, {
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
      })) eventsWritten++;
    }
  }

  for (const slot of existing) {
    const local = normalizeLocalTime(slot.starts_at_local);
    const key = slotKey(local, slot.holes);
    if (seen.has(key) || slot.status === 'closed') continue;

    await patchSlot(env, slot.id, {
      status: 'closed',
      closed_at: now,
      last_polled_at: now,
    });
    slotsWritten++;
    if (await insertEvent(env, {
      slot_id: slot.id,
      course_slug: course.slug,
      play_date: slot.play_date,
      starts_at_local: local,
      holes: slot.holes,
      event_type: 'closed',
      price_cents: slot.price_cents,
      spots_open: slot.spots_open,
      poll_run_id,
    })) eventsWritten++;
  }

  return { slotsWritten, eventsWritten };
}

// ── Single (course, date) poll ──────────────────────────────────────

async function pollCourseDate(env, course, play_date, poll_run_id, fetchTimesForCourse, normalizeTimesWorker) {
  const holes = String(canonicalHolesForPoll(course));
  const started = Date.now();
  const data = await fetchTimesForCourse(course, play_date, holes, '1');
  if (!data || data.error) {
    return {
      status: 'failed',
      slots_written: 0,
      events_written: 0,
      latency_ms: Date.now() - started,
      error_message: data?.error || 'fetch_failed',
    };
  }

  const rows = normalizeTimesWorker(course, data, holes);
  const { slotsWritten, eventsWritten } = await applyPollDiff(env, {
    course,
    play_date,
    normalizedRows: rows,
    poll_run_id,
  });

  return {
    status: 'ok',
    slots_written: slotsWritten,
    events_written: eventsWritten,
    latency_ms: Date.now() - started,
    error_message: null,
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
      const burst = burstCandidates.find(
        (b) => b.slug === row.course_slug && b.play_date === row.play_date,
      );
      if (burst) await markBurstPollDone(env, burst.course, todayMt);
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

export async function handleAvailabilityPoll(env, deps) {
  const { loadCourses, fetchTimesForCourse, normalizeTimesWorker } = deps;

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
    const claimed = await claimPollBatch(env, todayMt, maxPlayDate, CLAIM_BATCH_SIZE);

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

    for (const row of claimed) {
      const course = courseBySlug.get(row.course_slug);
      if (!course) {
        console.warn(`[poll] unknown course_slug claimed: ${row.course_slug}`);
        continue;
      }
      coursesClaimed++;

      const result = await pollOneClaimedCourse(env, {
        pollRunId,
        row,
        course,
        burstCandidates,
        todayMt,
        fetchTimesForCourse,
        normalizeTimesWorker,
      });

      if (result.status === 'ok') {
        coursesOk++;
        slotsUpserted += result.slots_written;
        eventsWritten += result.events_written;
      } else {
        coursesFailed++;
        if (result.error_message) {
          errors.push(`${row.course_slug}:${result.error_message}`);
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
