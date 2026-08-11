import type { TeeTime } from '../types';
import type { CourseRecord } from './courseRecord';
import { getWorkerBaseUrl } from './env';
import { normalizeTimesWorker } from './normalizeTimes';
import { teeItUpAlias, workerSupportedPlatform } from './platformRegistry';
import { rawTeeTimeToIsoUtc } from './teeTimeInstant';

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

/** Snapshots older than this fall back to live vendor (avoids stale open slots). */
const SNAPSHOT_STALE_MS = 12 * 60 * 1000;

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
  holesFilter: 9 | 18
): TeeTime[] {
  const out: TeeTime[] = [];
  let i = 0;
  for (const row of rows) {
    const h = (row.holes === 9 ? 9 : 18) as 9 | 18;
    if (h !== holesFilter) continue;
    if (!row.rawTime) continue;
    if (row.spots != null && row.spots <= 0) continue;
    const iso = rawTeeTimeToIsoUtc(dateYmd, row.rawTime);
    out.push({
      id: `${courseSlug}-${dateYmd}-${i++}-${row.rawTime}`,
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

async function fetchTeeTimesFromSnapshot(
  courseSlug: string,
  dateYmd: string,
  holes: 9 | 18,
  players: 1 | 2 | 3 | 4,
): Promise<SnapshotAvailabilityResponse | null> {
  const base = getWorkerBaseUrl();
  const url = new URL(`${base}/v1/availability`);
  url.searchParams.set('course_slug', courseSlug);
  url.searchParams.set('date', dateYmd);
  url.searchParams.set('holes', String(holes));
  url.searchParams.set('players', String(players));

  try {
    const res = await fetchWithTimeout(url.toString(), { method: 'GET' });
    if (!res.ok) return null;
    return (await res.json()) as SnapshotAvailabilityResponse;
  } catch {
    return null;
  }
}

function snapshotToTeeTimes(
  courseSlug: string,
  dateYmd: string,
  rows: NonNullable<SnapshotAvailabilityResponse['times']>,
): TeeTime[] {
  const out: TeeTime[] = rows
    .filter((row) => row.spots == null || row.spots > 0)
    .map((row, i) => ({
      id: row.id || `${courseSlug}-${dateYmd}-${i}-${row.startsAt}`,
      courseId: courseSlug,
      startsAt: row.startsAt,
      price: row.price,
      spots: row.spots,
      holes: row.holes === 9 ? 9 : 18,
      reopenedAt: row.reopenedAt,
    }));
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
    const times = excludePastTeeTimes(rowsToTeeTimes(courseSlug, dateYmd, rows, holes));
    return { times, ok: true, source: 'live' };
  } catch {
    return { times: [], ok: false };
  }
}

function snapshotIsFresh(snapshot: SnapshotAvailabilityResponse): boolean {
  if (!snapshot.last_polled_at) return false;
  const age = Date.now() - new Date(snapshot.last_polled_at).getTime();
  return Number.isFinite(age) && age >= 0 && age <= SNAPSHOT_STALE_MS;
}

function canTrustSnapshotForPlayers(
  snapshot: SnapshotAvailabilityResponse,
  players: 1 | 2 | 3 | 4,
): boolean {
  if (!snapshot.ok || !snapshot.has_poll_coverage || !Array.isArray(snapshot.times)) return false;
  if (!snapshotIsFresh(snapshot)) return false;
  if (players === 1) return true;
  // Multi-player needs spot counts. Empty [].every() is vacuously true — don't trust that.
  if (snapshot.spots_known === false) return false;
  if (snapshot.times.length === 0) return snapshot.spots_known === true;
  return snapshot.times.every((row) => row.spots != null);
}

type BatchSlugSnapshot = {
  has_poll_coverage?: boolean;
  spots_known?: boolean;
  last_polled_at?: string | null;
  times?: SnapshotAvailabilityResponse['times'];
};

type BatchTeeTimesResponse = {
  ok?: boolean;
  by_slug?: Record<string, BatchSlugSnapshot>;
};

function chunkSlugs<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Batched snapshot read via GET /v1/tee-times?ids=.
 * Returns a map of slug → snapshot payload (missing slugs omitted on transport failure).
 */
async function fetchTeeTimesBatchFromSnapshot(
  slugs: string[],
  dateYmd: string,
  holes: 9 | 18,
  players: 1 | 2 | 3 | 4,
): Promise<Map<string, SnapshotAvailabilityResponse>> {
  const out = new Map<string, SnapshotAvailabilityResponse>();
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
        const res = await fetchWithTimeout(url.toString(), { method: 'GET' }, REQUEST_TIMEOUT_MS);
        if (!res.ok) return;
        const data = (await res.json()) as BatchTeeTimesResponse;
        if (!data?.by_slug || typeof data.by_slug !== 'object') return;
        for (const slug of chunk) {
          const row = data.by_slug[slug];
          if (!row) continue;
          out.set(slug, {
            ok: true,
            source: 'snapshot',
            has_poll_coverage: row.has_poll_coverage === true,
            spots_known: row.spots_known !== false,
            last_polled_at: row.last_polled_at ?? null,
            times: Array.isArray(row.times) ? row.times : [],
          });
        }
      } catch {
        // miss → live fallback per course
      }
    }),
  );

  return out;
}

export async function fetchTeeTimesForCourse(
  course: CourseRecord,
  courseSlug: string,
  dateYmd: string,
  holes: 9 | 18,
  players: 1 | 2 | 3 | 4
): Promise<TeeTimeFetchResult> {
  if (course.platform && workerSupportedPlatform(course.platform)) {
    const snapshot = await fetchTeeTimesFromSnapshot(courseSlug, dateYmd, holes, players);
    if (snapshot && canTrustSnapshotForPlayers(snapshot, players)) {
      return {
        times: snapshotToTeeTimes(courseSlug, dateYmd, snapshot.times!),
        ok: true,
        source: 'snapshot',
      };
    }
  }

  return fetchTeeTimesLive(course, courseSlug, dateYmd, holes, players);
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
    if (attempt < maxAttempts - 1) {
      await sleep(250 * 2 ** attempt + Math.random() * 200);
    }
  }
  return last;
}

export async function fetchTimesForCourseSlugs(
  entries: { slug: string; record: CourseRecord }[],
  dateYmd: string,
  holes: 9 | 18,
  players: 1 | 2 | 3 | 4,
  concurrency: number,
  onCourseComplete?: (update: CourseTimesUpdate) => void
): Promise<TimesBySlugFetchResult> {
  const out = new Map<string, TeeTime[]>();
  const failedSlugs: string[] = [];

  const workerEntries = entries.filter(
    (e) => e.record.platform && workerSupportedPlatform(e.record.platform),
  );
  const batchMap = await fetchTeeTimesBatchFromSnapshot(
    workerEntries.map((e) => e.slug),
    dateYmd,
    holes,
    players,
  );

  const needLive: { slug: string; record: CourseRecord }[] = [];
  for (const entry of entries) {
    const snap = batchMap.get(entry.slug);
    if (snap && canTrustSnapshotForPlayers(snap, players)) {
      const times = snapshotToTeeTimes(entry.slug, dateYmd, snap.times!);
      out.set(entry.slug, times);
      onCourseComplete?.({ slug: entry.slug, times, ok: true, source: 'snapshot' });
    } else {
      needLive.push(entry);
    }
  }

  // Fast vendors first so the grid fills before GolfPay's cold start.
  const orderedLive = [
    ...needLive.filter((e) => !isSlowLivePlatform(e.record.platform)),
    ...needLive.filter((e) => isSlowLivePlatform(e.record.platform)),
  ];

  let index = 0;
  async function runWorker() {
    for (;;) {
      const i = index++;
      if (i >= orderedLive.length) break;
      const { slug, record } = orderedLive[i]!;
      const { times, ok, source } = await fetchTeeTimesLiveWithRetry(
        record,
        slug,
        dateYmd,
        holes,
        players,
      );
      out.set(slug, times);
      if (!ok) failedSlugs.push(slug);
      onCourseComplete?.({ slug, times, ok, source });
    }
  }

  const n = Math.max(1, Math.min(concurrency, orderedLive.length || 1));
  if (orderedLive.length > 0) {
    await Promise.all(Array.from({ length: n }, () => runWorker()));
  }
  return { bySlug: out, failedSlugs };
}
