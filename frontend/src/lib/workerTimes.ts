import type { TeeTime } from '../types';
import type { CourseRecord } from './courseRecord';
import { getWorkerBaseUrl } from './env';
import type { HolesFilter } from './holesFilter';
import { normalizeTimesWorker } from './normalizeTimes';
import { teeItUpAlias, workerSupportedPlatform } from './platformRegistry';
import { courseTimezone, rawTeeTimeToIsoUtc } from './teeTimeInstant';

type SnapshotAvailabilityResponse = {
  ok: boolean;
  source?: string;
  has_poll_coverage?: boolean;
  /** False when open slots lack spots_open (legacy chronogolf_slc polls). */
  spots_known?: boolean;
  last_polled_at?: string | null;
  times?: Array<{
    id: string;
    startsAt: string;
    price?: number;
    spots?: number;
    holes: 9 | 18;
    reopenedAt?: string;
  }>;
};

/**
 * Snapshot freshness for Find.
 *
 * The poller claims ~20 (course, date) pairs every 5 minutes across ~67 courses × 15
 * dates, so a given pair is often 30–240+ minutes between successful polls — far
 * longer than a naive "hot = 5 min" target. A tight window (e.g. 12 min) rejects
 * almost every snapshot and forces per-course live vendor calls, which is what
 * Network shows as "each course being fetched."
 *
 * Tiered max age mirrors poller hot/warm/cold with claim-lag headroom. Outside
 * Mountain golf hours the poller sleeps — trust last evening's snapshot overnight.
 */
const MT_TZ = 'America/Denver';
const GOLF_HOUR_START = 6;
const GOLF_HOUR_END = 23;
const SNAPSHOT_OFF_HOURS_MAX_AGE_MS = 18 * 60 * 60 * 1000;
/**
 * After painting a trusted snapshot, live-refresh in the background when older
 * than this (stale-while-revalidate). Skipped outside Mountain golf hours so
 * overnight Find does not hammer every vendor.
 */
const SNAPSHOT_REVALIDATE_AFTER_MS = 12 * 60 * 1000;

/** Max wait for /v1/tee-times (may server-side live-fill several vendors). */
const TEE_TIMES_BATCH_TIMEOUT_MS = 35_000;
/** Abort a single worker request if it stalls, so it can't hold a concurrency slot forever. */
const REQUEST_TIMEOUT_MS = 15_000;
/** GolfPay upstream often takes 15–25s; worker allows 30s — client must wait longer. */
const GOLFPAY_REQUEST_TIMEOUT_MS = 35_000;
/** Max slugs per /v1/tee-times request (matches worker TEE_TIMES_BATCH_MAX_IDS). */
const TEE_TIMES_BATCH_CHUNK = 20;

async function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function parsePrice(s: string | null): number | undefined {
  if (!s) return undefined;
  const n = parseInt(s.replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) ? n : undefined;
}

function rowsToTeeTimes(
  courseSlug: string,
  dateYmd: string,
  rows: ReturnType<typeof normalizeTimesWorker>,
  holesFilter: 9 | 18,
  timeZone?: string | null,
): TeeTime[] {
  const tz = courseTimezone(timeZone);
  const out: TeeTime[] = [];
  let i = 0;
  for (const row of rows) {
    const h = (row.holes === 9 ? 9 : 18) as 9 | 18;
    if (h !== holesFilter) continue;
    if (!row.rawTime) continue;
    if (row.spots != null && row.spots <= 0) continue;
    const iso = rawTeeTimeToIsoUtc(dateYmd, row.rawTime, tz);
    out.push({
      id: `${courseSlug}-${dateYmd}-${h}-${i++}-${row.rawTime}`,
      courseId: courseSlug,
      startsAt: iso,
      price: parsePrice(row.price),
      spots: row.spots ?? undefined,
      holes: h,
    });
  }
  out.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  return out;
}

/** Drop slots that have already started (wall clock vs instant is encoded in ISO). */
function excludePastTeeTimes(times: TeeTime[], nowMs: number = Date.now()): TeeTime[] {
  return times.filter((t) => new Date(t.startsAt).getTime() > nowMs);
}

export type TeeTimeFetchResult = {
  times: TeeTime[];
  ok: boolean;
  source?: 'snapshot' | 'live';
  /** True when the worker returned 429; caller should back off, not hammer. */
  rateLimited?: boolean;
};

const emptyOk: TeeTimeFetchResult = { times: [], ok: true };

function snapshotToTeeTimes(
  courseSlug: string,
  dateYmd: string,
  rows: NonNullable<SnapshotAvailabilityResponse['times']>,
): TeeTime[] {
  const out: TeeTime[] = rows
    .filter((row) => row.spots == null || row.spots > 0)
    .map((row, i) => {
      const holes = row.holes === 9 ? 9 : 18;
      const baseId = row.id || `${courseSlug}-${dateYmd}-${i}-${row.startsAt}`;
      return {
        // Hole count in the id so 9+18 merges (holes=any) stay unique for React keys / selection.
        id: baseId.endsWith(`-${holes}`) ? baseId : `${baseId}-${holes}`,
        courseId: courseSlug,
        startsAt: row.startsAt,
        price: row.price,
        spots: row.spots,
        holes,
        reopenedAt: row.reopenedAt,
      };
    });
  out.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  return excludePastTeeTimes(out);
}

async function fetchTeeTimesLive(
  course: CourseRecord,
  courseSlug: string,
  dateYmd: string,
  holes: 9 | 18,
  players: 1 | 2 | 3 | 4
): Promise<TeeTimeFetchResult> {
  const base = getWorkerBaseUrl();
  let url: URL;

  switch (course.platform) {
    case 'foreup': {
      if (!course.schedule_id) return emptyOk;
      url = new URL(`${base}/foreup`);
      url.searchParams.set('schedule_id', course.schedule_id);
      url.searchParams.set('date', dateYmd);
      url.searchParams.set('holes', String(holes));
      if (course.booking_class_id) url.searchParams.set('booking_class_id', course.booking_class_id);
      break;
    }
    case 'chronogolf_slc': {
      const { club_id, course_id, affiliation_type_id } = course;
      if (!club_id || !course_id || !affiliation_type_id) return emptyOk;
      url = new URL(`${base}/chronogolf-slc`);
      url.searchParams.set('club_id', club_id);
      url.searchParams.set('course_id', course_id);
      url.searchParams.set('affiliation_type_id', affiliation_type_id);
      url.searchParams.set('nb_holes', String(holes));
      url.searchParams.set('date', dateYmd);
      url.searchParams.set('players', String(players));
      break;
    }
    case 'membersports': {
      if (!course.golf_club_id || !course.golf_course_id) return emptyOk;
      url = new URL(`${base}/membersports`);
      url.searchParams.set('golf_club_id', course.golf_club_id);
      url.searchParams.set('golf_course_id', course.golf_course_id);
      url.searchParams.set('date', dateYmd);
      break;
    }
    case 'chronogolf': {
      if (!course.course_ids?.length) return emptyOk;
      url = new URL(`${base}/chronogolf`);
      url.searchParams.set('course_ids', course.course_ids.join(','));
      url.searchParams.set('date', dateYmd);
      break;
    }
    case 'teeitup': {
      if (!course.facility_id) return emptyOk;
      url = new URL(`${base}/teeitup`);
      url.searchParams.set('facility_id', course.facility_id);
      url.searchParams.set('alias', teeItUpAlias(course));
      url.searchParams.set('date', dateYmd);
      break;
    }
    case 'trutee': {
      if (!course.trutee_course_id) return emptyOk;
      url = new URL(`${base}/trutee`);
      url.searchParams.set('course_id', course.trutee_course_id);
      url.searchParams.set('date', dateYmd);
      break;
    }
    case 'golfpay': {
      const gpId =
        (course.golfpay_course_id && String(course.golfpay_course_id).trim()) ||
        String(course.booking_url_template || '').match(/[?&]_gshcid=(\d+)/i)?.[1] ||
        String(course.booking_url || '').match(/[?&]_gshcid=(\d+)/i)?.[1] ||
        '';
      if (!gpId) return emptyOk;
      url = new URL(`${base}/golfpay`);
      url.searchParams.set('course_id', gpId);
      url.searchParams.set('date', dateYmd);
      break;
    }
    default:
      return emptyOk;
  }

  try {
    const timeoutMs =
      course.platform === 'golfpay' ? GOLFPAY_REQUEST_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
    const res = await fetchWithTimeout(url.toString(), { method: 'GET' }, timeoutMs);
    if (!res.ok) return { times: [], ok: false, rateLimited: res.status === 429 };
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      return { times: [], ok: false };
    }
    let rows = normalizeTimesWorker(course, data, String(holes));
    // Chronogolf SLC capacity is applied upstream via affiliation_type_ids[] count;
    // the payload has no spot field — stamp the requested size so UI filters work.
    if (course.platform === 'chronogolf_slc') {
      rows = rows.map((row) => ({ ...row, spots: row.spots ?? players }));
    }
    const times = excludePastTeeTimes(
      rowsToTeeTimes(courseSlug, dateYmd, rows, holes, course.timezone),
    );
    return { times, ok: true, source: 'live' };
  } catch {
    return { times: [], ok: false };
  }
}

function mtNowParts(nowMs: number = Date.now()): { dateYmd: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: MT_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(new Date(nowMs));
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? '';
  return {
    dateYmd: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')),
  };
}

function daysUntilPlay(playDateYmd: string, todayMtYmd: string): number {
  const [y1, m1, d1] = playDateYmd.split('-').map(Number);
  const [y2, m2, d2] = todayMtYmd.split('-').map(Number);
  return Math.round((Date.UTC(y1!, m1! - 1, d1!) - Date.UTC(y2!, m2! - 1, d2!)) / 86400000);
}

/** Max snapshot age before Find falls back to live — mirrors poller tiers + claim lag. */
function snapshotMaxAgeMs(playDateYmd: string, nowMs: number = Date.now()): number {
  const mt = mtNowParts(nowMs);
  if (mt.hour < GOLF_HOUR_START || mt.hour >= GOLF_HOUR_END) {
    return SNAPSHOT_OFF_HOURS_MAX_AGE_MS;
  }
  const days = daysUntilPlay(playDateYmd, mt.dateYmd);
  if (days <= 1) return 90 * 60 * 1000; // hot + claim-lag headroom
  if (days <= 6) return 4 * 60 * 60 * 1000; // warm sweep
  return 8 * 60 * 60 * 1000; // cold sweep
}

function snapshotIsFresh(
  snapshot: SnapshotAvailabilityResponse,
  playDateYmd: string,
  nowMs: number = Date.now(),
): boolean {
  if (!snapshot.last_polled_at) return false;
  const age = nowMs - new Date(snapshot.last_polled_at).getTime();
  return Number.isFinite(age) && age >= 0 && age <= snapshotMaxAgeMs(playDateYmd, nowMs);
}

function snapshotAgeMs(snapshot: SnapshotAvailabilityResponse, nowMs: number = Date.now()): number | null {
  if (!snapshot.last_polled_at) return null;
  const age = nowMs - new Date(snapshot.last_polled_at).getTime();
  return Number.isFinite(age) ? age : null;
}

function canTrustSnapshotForPlayers(
  snapshot: SnapshotAvailabilityResponse,
  players: 1 | 2 | 3 | 4,
  playDateYmd: string,
): boolean {
  if (!snapshot.ok || !snapshot.has_poll_coverage || !Array.isArray(snapshot.times)) return false;
  if (!snapshotIsFresh(snapshot, playDateYmd)) return false;
  // Empty "fully booked" is high-regret if wrong (e.g. Stonebridge opened seats after
  // the last poll). Only trust a fresh empty sheet; otherwise force live.
  if (snapshot.times.length === 0) {
    if (snapshot.spots_known !== true) return false;
    const age = snapshotAgeMs(snapshot);
    return age != null && age <= SNAPSHOT_REVALIDATE_AFTER_MS;
  }
  if (players === 1) return true;
  // Multi-player needs spot counts. Empty [].every() is vacuously true — don't trust that.
  if (snapshot.spots_known === false) return false;
  return snapshot.times.every((row) => row.spots != null);
}

/** Paint from snapshot, then live-refresh when aging (golf hours only). */
function shouldBackgroundRevalidate(
  snapshot: SnapshotAvailabilityResponse,
  playDateYmd: string,
  players: 1 | 2 | 3 | 4,
  nowMs: number = Date.now(),
): boolean {
  if (!canTrustSnapshotForPlayers(snapshot, players, playDateYmd)) return false;
  const mt = mtNowParts(nowMs);
  if (mt.hour < GOLF_HOUR_START || mt.hour >= GOLF_HOUR_END) return false;
  const age = snapshotAgeMs(snapshot, nowMs);
  return age != null && age > SNAPSHOT_REVALIDATE_AFTER_MS;
}

type BatchSlugSnapshot = {
  has_poll_coverage?: boolean;
  spots_known?: boolean;
  last_polled_at?: string | null;
  times?: SnapshotAvailabilityResponse['times'];
  /** snapshot = poller cache; live = worker filled from vendor in this request. */
  source?: 'snapshot' | 'live';
  live_failed?: boolean;
};

type BatchTeeTimesResponse = {
  ok?: boolean;
  by_slug?: Record<string, BatchSlugSnapshot>;
  live_filled?: number;
  live_failed?: number;
};

function chunkSlugs<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Batched read via GET /v1/tee-times?ids= (snapshots + server-side live fill).
 * Returns a map of slug → payload (missing slugs omitted on transport failure).
 */
async function fetchTeeTimesBatchFromSnapshot(
  slugs: string[],
  dateYmd: string,
  holes: 9 | 18,
  players: 1 | 2 | 3 | 4,
): Promise<Map<string, SnapshotAvailabilityResponse & { batchSource?: 'snapshot' | 'live'; live_failed?: boolean }>> {
  const out = new Map<
    string,
    SnapshotAvailabilityResponse & { batchSource?: 'snapshot' | 'live'; live_failed?: boolean }
  >();
  if (slugs.length === 0) return out;
  const base = getWorkerBaseUrl();

  await Promise.all(
    chunkSlugs(slugs, TEE_TIMES_BATCH_CHUNK).map(async (chunk) => {
      const url = new URL(`${base}/v1/tee-times`);
      url.searchParams.set('date', dateYmd);
      url.searchParams.set('holes', String(holes));
      url.searchParams.set('players', String(players));
      url.searchParams.set('ids', chunk.join(','));
      try {
        const res = await fetchWithTimeout(url.toString(), { method: 'GET' }, TEE_TIMES_BATCH_TIMEOUT_MS);
        if (!res.ok) return;
        const data = (await res.json()) as BatchTeeTimesResponse;
        if (!data?.by_slug || typeof data.by_slug !== 'object') return;
        for (const slug of chunk) {
          const row = data.by_slug[slug];
          if (!row) continue;
          const batchSource = row.source === 'live' ? 'live' : 'snapshot';
          out.set(slug, {
            ok: true,
            source: batchSource,
            has_poll_coverage: row.has_poll_coverage === true,
            spots_known: row.spots_known !== false,
            last_polled_at: row.last_polled_at ?? null,
            times: Array.isArray(row.times) ? row.times : [],
            batchSource,
            live_failed: row.live_failed === true,
          });
        }
      } catch {
        // miss → live fallback per course
      }
    }),
  );

  return out;
}

/** Whether Finder can paint from a /v1/tee-times row without a client live call. */
function canUseBatchRow(
  row: SnapshotAvailabilityResponse & { batchSource?: 'snapshot' | 'live'; live_failed?: boolean },
  players: 1 | 2 | 3 | 4,
  playDateYmd: string,
): boolean {
  if (row.live_failed) return false;
  // Server completed a vendor fill for this slug (including confirmed empty).
  if (row.batchSource === 'live') return Array.isArray(row.times);
  return canTrustSnapshotForPlayers(row, players, playDateYmd);
}

function mergeTeeTimesByStartAndHoles(a: TeeTime[], b: TeeTime[]): TeeTime[] {
  const byKey = new Map<string, TeeTime>();
  for (const t of [...a, ...b]) {
    byKey.set(`${t.startsAt}|${t.holes}`, t);
  }
  return [...byKey.values()].sort(
    (x, y) => new Date(x.startsAt).getTime() - new Date(y.startsAt).getTime(),
  );
}

export async function fetchTeeTimesForCourse(
  course: CourseRecord,
  courseSlug: string,
  dateYmd: string,
  holes: HolesFilter,
  players: 1 | 2 | 3 | 4
): Promise<TeeTimeFetchResult> {
  if (holes === 'any') {
    const [r9, r18] = await Promise.all([
      fetchTeeTimesForCourse(course, courseSlug, dateYmd, 9, players),
      fetchTeeTimesForCourse(course, courseSlug, dateYmd, 18, players),
    ]);
    const live = r9.source === 'live' || r18.source === 'live';
    return {
      times: mergeTeeTimesByStartAndHoles(r9.times, r18.times),
      ok: r9.ok || r18.ok,
      source: live ? 'live' : r9.source ?? r18.source,
    };
  }

  // Same path as Find: /v1/tee-times live-fills miss/stale/empty so detail matches the grid.
  if (course.platform && workerSupportedPlatform(course.platform)) {
    const batchMap = await fetchTeeTimesBatchFromSnapshot([courseSlug], dateYmd, holes, players);
    const row = batchMap.get(courseSlug);
    if (row && canUseBatchRow(row, players, dateYmd)) {
      return {
        times: snapshotToTeeTimes(courseSlug, dateYmd, row.times!),
        ok: true,
        source: row.batchSource === 'live' ? 'live' : 'snapshot',
      };
    }
  }

  return fetchTeeTimesLiveWithRetry(course, courseSlug, dateYmd, holes, players);
}

export type TimesBySlugFetchResult = {
  bySlug: Map<string, TeeTime[]>;
  /** Slugs where the worker request failed (network, HTTP error, or parse error). */
  failedSlugs: string[];
};

export type CourseTimesUpdate = {
  slug: string;
  times: TeeTime[];
  ok: boolean;
  source?: 'snapshot' | 'live';
};

/** Retry transient transport failures (network resets, ERR_INSUFFICIENT_RESOURCES, timeouts). */
const MAX_FETCH_ATTEMPTS = 3;

/** Platforms whose upstream is routinely multi-second — fetch last; don't thrash retries. */
function isSlowLivePlatform(platform: string | undefined): boolean {
  return platform === 'golfpay';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Live vendor only (skip snapshot) — used after a batch snapshot miss/stale. */
async function fetchTeeTimesLiveWithRetry(
  record: CourseRecord,
  slug: string,
  dateYmd: string,
  holes: 9 | 18,
  players: 1 | 2 | 3 | 4,
): Promise<TeeTimeFetchResult> {
  const maxAttempts = isSlowLivePlatform(record.platform) ? 1 : MAX_FETCH_ATTEMPTS;
  let last: TeeTimeFetchResult = { times: [], ok: false };
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      last = await fetchTeeTimesLive(record, slug, dateYmd, holes, players);
    } catch {
      last = { times: [], ok: false };
    }
    if (last.ok) return last;
    if (last.rateLimited) return last;
    // Backoff with jitter so transient-error retries don't stampede the same origin at once.
    if (attempt < maxAttempts - 1) {
      await sleep(250 * 2 ** attempt + Math.random() * 200);
    }
  }
  return last;
}

export type FetchTimesForCourseSlugsOptions = {
  /**
   * Fires after snapshot paint + blocking live misses finish.
   * Background revalidation may still be in flight.
   */
  onBlockingComplete?: () => void;
  /** When false, skip stale-while-revalidate live refresh. Default true. */
  revalidateStale?: boolean;
};

export async function fetchTimesForCourseSlugs(
  entries: { slug: string; record: CourseRecord }[],
  dateYmd: string,
  holes: HolesFilter,
  players: 1 | 2 | 3 | 4,
  concurrency: number,
  onCourseComplete?: (update: CourseTimesUpdate) => void,
  options?: FetchTimesForCourseSlugsOptions,
): Promise<TimesBySlugFetchResult> {
  if (holes === 'any') {
    const bySlug = new Map<string, TeeTime[]>();
    const okBySlug = new Map<string, boolean>();
    const halfConcurrency = Math.max(1, Math.ceil(concurrency / 2));
    let blockingLeft = 2;
    const wrapOpts: FetchTimesForCourseSlugsOptions = {
      revalidateStale: options?.revalidateStale,
      onBlockingComplete: () => {
        blockingLeft -= 1;
        if (blockingLeft === 0) options?.onBlockingComplete?.();
      },
    };

    const handle =
      (holeSize: 9 | 18) =>
      (update: CourseTimesUpdate) => {
        const prev = bySlug.get(update.slug) ?? [];
        const kept = prev.filter((t) => t.holes !== holeSize);
        const next = mergeTeeTimesByStartAndHoles(kept, update.times);
        bySlug.set(update.slug, next);
        const prevOk = okBySlug.get(update.slug) === true;
        const ok = prevOk || update.ok;
        okBySlug.set(update.slug, ok);
        onCourseComplete?.({
          slug: update.slug,
          times: next,
          ok,
          source: update.source,
        });
      };

    const [r9, r18] = await Promise.all([
      fetchTimesForCourseSlugs(entries, dateYmd, 9, players, halfConcurrency, handle(9), wrapOpts),
      fetchTimesForCourseSlugs(entries, dateYmd, 18, players, halfConcurrency, handle(18), wrapOpts),
    ]);

    const failedSlugs = [...new Set([...r9.failedSlugs, ...r18.failedSlugs])].filter(
      (slug) => r9.failedSlugs.includes(slug) && r18.failedSlugs.includes(slug),
    );
    const allSlugs = new Set([...r9.bySlug.keys(), ...r18.bySlug.keys()]);
    const out = new Map<string, TeeTime[]>();
    for (const slug of allSlugs) {
      out.set(
        slug,
        mergeTeeTimesByStartAndHoles(r9.bySlug.get(slug) ?? [], r18.bySlug.get(slug) ?? []),
      );
    }
    return { bySlug: out, failedSlugs };
  }

  const holeSize: 9 | 18 = holes;
  const out = new Map<string, TeeTime[]>();
  const failedSlugs: string[] = [];
  const revalidateStale = options?.revalidateStale !== false;

  const workerEntries = entries.filter(
    (e) => e.record.platform && workerSupportedPlatform(e.record.platform),
  );
  const batchMap = await fetchTeeTimesBatchFromSnapshot(
    workerEntries.map((e) => e.slug),
    dateYmd,
    holeSize,
    players,
  );

  const needLive: { slug: string; record: CourseRecord }[] = [];
  const needRevalidate: { slug: string; record: CourseRecord; ageMs: number }[] = [];

  for (const entry of entries) {
    const snap = batchMap.get(entry.slug);
    if (snap && canUseBatchRow(snap, players, dateYmd)) {
      const times = snapshotToTeeTimes(entry.slug, dateYmd, snap.times!);
      out.set(entry.slug, times);
      const source = snap.batchSource === 'live' ? 'live' : 'snapshot';
      onCourseComplete?.({ slug: entry.slug, times, ok: true, source });
      // Only background-revalidate poller snapshots (server live rows are already fresh).
      if (
        revalidateStale &&
        source === 'snapshot' &&
        shouldBackgroundRevalidate(snap, dateYmd, players)
      ) {
        needRevalidate.push({
          slug: entry.slug,
          record: entry.record,
          ageMs: snapshotAgeMs(snap) ?? 0,
        });
      }
    } else {
      needLive.push(entry);
    }
  }

  async function runLiveQueue(
    queue: { slug: string; record: CourseRecord }[],
    mode: 'blocking' | 'revalidate',
  ) {
    const ordered = [
      ...queue.filter((e) => !isSlowLivePlatform(e.record.platform)),
      ...queue.filter((e) => isSlowLivePlatform(e.record.platform)),
    ];
    let index = 0;
    async function runWorker() {
      for (;;) {
        const i = index++;
        if (i >= ordered.length) break;
        const { slug, record } = ordered[i]!;
        const { times, ok, source } = await fetchTeeTimesLiveWithRetry(
          record,
          slug,
          dateYmd,
          holeSize,
          players,
        );
        if (mode === 'revalidate') {
          // Keep painted snapshot if live refresh fails.
          if (!ok) continue;
          out.set(slug, times);
          onCourseComplete?.({ slug, times, ok: true, source: source ?? 'live' });
          continue;
        }
        out.set(slug, times);
        if (!ok) failedSlugs.push(slug);
        onCourseComplete?.({ slug, times, ok, source });
      }
    }
    const n = Math.max(1, Math.min(concurrency, ordered.length || 1));
    if (ordered.length > 0) {
      await Promise.all(Array.from({ length: n }, () => runWorker()));
    }
  }

  // Fast vendors first so the grid fills before GolfPay's cold start.
  await runLiveQueue(needLive, 'blocking');
  options?.onBlockingComplete?.();

  // Oldest snapshots first so the most stale cards refresh sooner.
  needRevalidate.sort((a, b) => b.ageMs - a.ageMs);
  await runLiveQueue(
    needRevalidate.map(({ slug, record }) => ({ slug, record })),
    'revalidate',
  );

  return { bySlug: out, failedSlugs };
}
