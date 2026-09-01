import type { TeeTime } from '../types';
import type { CourseRecord } from './courseRecord';
import { chronogolfSlcCourseIds } from './chronogolfSlc';
import { getWorkerBaseUrl } from './env';
import type { HolesFilter } from './holesFilter';
import { normalizeTimesWorker } from './normalizeTimes';
import { effectivePlatform, teeItUpAlias, workerSupportedPlatform } from './platformRegistry';
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
 * Mountain golf hours the poller sleeps — trust last evening's warm/cold snapshot
 * overnight, but never give today/tomorrow the long grace (stale hot sheets must
 * fall through to live).
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

  switch (effectivePlatform(course)) {
    case 'foreup': {
      if (!course.schedule_id) return emptyOk;
      url = new URL(`${base}/foreup`);
      url.searchParams.set('schedule_id', course.schedule_id);
      url.searchParams.set('date', dateYmd);
      url.searchParams.set('holes', String(holes));
      if (course.booking_class_id) url.searchParams.set('booking_class_id', course.booking_class_id);
      const facilityMatch = String(course.booking_url || '').match(
        /\/booking\/(?:index\/)?(\d+)(?:\/(\d+))?/i,
      );
      if (facilityMatch?.[1]) url.searchParams.set('facility_id', facilityMatch[1]);
      break;
    }
    case 'chronogolf_slc': {
      const { club_id, affiliation_type_id } = course;
      const courseIds = chronogolfSlcCourseIds(course);
      if (!club_id || !courseIds.length || !affiliation_type_id) return emptyOk;
      url = new URL(`${base}/chronogolf-slc`);
      url.searchParams.set('club_id', club_id);
      url.searchParams.set('course_id', courseIds.join(','));
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
    case 'quick18': {
      let host: string;
      try {
        host = new URL(String(course.booking_url || '').trim()).hostname.toLowerCase();
      } catch {
        return emptyOk;
      }
      const tenant = host.match(/^([a-z0-9-]+)\.(quick18|play18)\.com$/i)?.[1] || '';
      if (!tenant) return emptyOk;
      url = new URL(`${base}/quick18`);
      url.searchParams.set('tenant', tenant);
      url.searchParams.set('host', host);
      url.searchParams.set('date', dateYmd);
      if (course.quick18_course_id) url.searchParams.set('course_id', String(course.quick18_course_id));
      break;
    }
    case 'golfwithaccess': {
      const courseId = String(course.golfwithaccess_course_id || '').trim();
      let slug = String(course.golfwithaccess_slug || '').trim();
      if (!slug) {
        try {
          const path = new URL(String(course.booking_url || '').trim()).pathname;
          slug = path.match(/\/course\/([a-z0-9-]+)(?:\/|$)/i)?.[1] || '';
        } catch {
          slug = '';
        }
      }
      if (!courseId && !slug) return emptyOk;
      url = new URL(`${base}/golfwithaccess`);
      url.searchParams.set('date', dateYmd);
      url.searchParams.set('players', String(players));
      if (courseId) url.searchParams.set('course_id', courseId);
      if (slug) url.searchParams.set('slug', slug);
      break;
    }
    case 'clubcaddie': {
      let host: string;
      try {
        host = new URL(String(course.booking_url || '').trim()).hostname.toLowerCase();
      } catch {
        return emptyOk;
      }
      if (!/^apimanager-[a-z0-9-]+\.clubcaddie\.com$/i.test(host)) return emptyOk;
      const apiKey =
        String(course.clubcaddie_apikey || '').trim() ||
        (() => {
          try {
            return new URL(String(course.booking_url || '').trim()).pathname.match(
              /\/webapi\/view\/([a-z0-9]+)(?:\/|$)/i,
            )?.[1] || '';
          } catch {
            return '';
          }
        })();
      if (!apiKey) return emptyOk;
      url = new URL(`${base}/clubcaddie`);
      url.searchParams.set('host', host);
      url.searchParams.set('apikey', apiKey);
      url.searchParams.set('date', dateYmd);
      url.searchParams.set('players', String(players));
      if (course.clubcaddie_course_id) url.searchParams.set('course_id', String(course.clubcaddie_course_id));
      break;
    }
    case 'teesnap': {
      let host: string;
      try {
        host = new URL(String(course.booking_url || '').trim()).hostname.toLowerCase();
      } catch {
        return emptyOk;
      }
      const tenant =
        String(course.teesnap_tenant || '').trim() || host.match(/^([a-z0-9-]+)\.teesnap\.net$/i)?.[1] || '';
      if (!tenant) return emptyOk;
      url = new URL(`${base}/teesnap`);
      url.searchParams.set('tenant', tenant);
      url.searchParams.set('date', dateYmd);
      url.searchParams.set('players', String(players));
      if (course.teesnap_course_id) url.searchParams.set('course_id', String(course.teesnap_course_id));
      break;
    }
    case 'golfrev': {
      let courseId = String(course.golfrev_course_id || '').trim();
      let htc = String(course.golfrev_htc || '').trim();
      if (!courseId || !htc) {
        try {
          const u = new URL(String(course.booking_url || '').trim());
          if (!courseId) courseId = u.searchParams.get('courseid') || u.searchParams.get('courseId') || '';
          if (!htc) htc = u.searchParams.get('htc') || '';
        } catch {
          /* keep empty */
        }
      }
      if (!courseId || !htc) return emptyOk;
      url = new URL(`${base}/golfrev`);
      url.searchParams.set('date', dateYmd);
      url.searchParams.set('course_id', courseId);
      url.searchParams.set('htc', htc);
      break;
    }
    default:
      return emptyOk;
  }

  try {
    const timeoutMs =
      effectivePlatform(course) === 'golfpay' ? GOLFPAY_REQUEST_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
    const res = await fetchWithTimeout(url.toString(), { method: 'GET' }, timeoutMs);
    if (!res.ok) return { times: [], ok: false, rateLimited: res.status === 429 };
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      return { times: [], ok: false };
    }
    // Worker proxies often return HTTP 200 with `{ error, status: 429 }` on upstream
    // rate limits. Treating that as ok+[] paints a fake empty sheet and wipes Find.
    const payloadErr = workerProxyError(data);
    if (payloadErr) {
      return {
        times: [],
        ok: false,
        rateLimited: payloadErr.rateLimited,
      };
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

/** Worker route error body (HTTP may still be 200). */
function workerProxyError(data: unknown): { rateLimited: boolean } | null {
  if (!data || typeof data !== 'object') return null;
  const err = (data as { error?: unknown }).error;
  if (err == null || err === false || err === '') return null;
  const status = Number((data as { status?: unknown }).status);
  const msg = String(err);
  return {
    rateLimited: status === 429 || /429|rate.?limit/i.test(msg),
  };
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
  const days = daysUntilPlay(playDateYmd, mt.dateYmd);
  const offHours = mt.hour < GOLF_HOUR_START || mt.hour >= GOLF_HOUR_END;
  // Off-hours grace is for warm/cold only. Today/tomorrow always use the hot gate so
  // overnight ~15h poller rows (e.g. Sleepy Ridge) reject and live-fill from ForeUp.
  if (offHours && days > 1) {
    return SNAPSHOT_OFF_HOURS_MAX_AGE_MS;
  }
  if (days <= 1) return 12 * 60 * 1000; // hot: refuse hour-old "open" chips
  if (days <= 6) return 45 * 60 * 1000; // warm
  return 3 * 60 * 60 * 1000; // cold
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
  /** Worker skipped or timed out live-fill — do not treat empty as sold-out. */
  needs_live?: boolean;
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
type BatchRow = SnapshotAvailabilityResponse & {
  batchSource?: 'snapshot' | 'live';
  live_failed?: boolean;
  needs_live?: boolean;
};

async function fetchTeeTimesBatchFromSnapshot(
  slugs: string[],
  dateYmd: string,
  holes: 9 | 18,
  players: 1 | 2 | 3 | 4,
  options?: { fresh?: boolean; onChunk?: (chunk: Map<string, BatchRow>) => void },
): Promise<Map<string, BatchRow>> {
  const out = new Map<string, BatchRow>();
  if (slugs.length === 0) return out;
  const base = getWorkerBaseUrl();

  // Serialize chunks. Parallel chunk live-fills stampede Chronogolf (each chunk runs
  // up to 8 vendor calls server-side) and holes=9 multi-course inventory collapses
  // to live_failed + empty snapshots (poller only stores canonical 18 for those).
  for (const chunk of chunkSlugs(slugs, TEE_TIMES_BATCH_CHUNK)) {
    const url = new URL(`${base}/v1/tee-times`);
    url.searchParams.set('date', dateYmd);
    url.searchParams.set('holes', String(holes));
    url.searchParams.set('players', String(players));
    url.searchParams.set('ids', chunk.join(','));
    if (options?.fresh) url.searchParams.set('fresh', '1');
    const chunkMap = new Map<string, BatchRow>();
    try {
      const res = await fetchWithTimeout(
        url.toString(),
        { method: 'GET', cache: options?.fresh ? 'no-store' : 'default' },
        TEE_TIMES_BATCH_TIMEOUT_MS,
      );
      if (!res.ok) {
        options?.onChunk?.(chunkMap);
        continue;
      }
      const data = (await res.json()) as BatchTeeTimesResponse;
      if (!data?.by_slug || typeof data.by_slug !== 'object') {
        options?.onChunk?.(chunkMap);
        continue;
      }
      for (const slug of chunk) {
        const row = data.by_slug[slug];
        if (!row) continue;
        const batchSource = row.source === 'live' ? 'live' : 'snapshot';
        const parsed: BatchRow = {
          ok: true,
          source: batchSource,
          has_poll_coverage: row.has_poll_coverage === true,
          spots_known: row.spots_known !== false,
          last_polled_at: row.last_polled_at ?? null,
          times: Array.isArray(row.times) ? row.times : [],
          batchSource,
          live_failed: row.live_failed === true,
          needs_live: row.needs_live === true,
        };
        chunkMap.set(slug, parsed);
        out.set(slug, parsed);
      }
    } catch {
      // miss → live fallback per course
    }
    options?.onChunk?.(chunkMap);
  }

  return out;
}

/** Whether Finder can paint from a /v1/tee-times row without a client live call. */
function canUseBatchRow(
  row: BatchRow,
  players: 1 | 2 | 3 | 4,
  playDateYmd: string,
): boolean {
  // Worker deferred this slug (budget / skip) — empty is not a confirmed sold-out.
  if (row.needs_live) return false;
  // Server live fill failed — still paint a trustable non-empty poller snapshot instead
  // of forcing a client live call that often 429s and used to wipe the card to [].
  if (row.live_failed) {
    return (
      canTrustSnapshotForPlayers(row, players, playDateYmd) && (row.times?.length ?? 0) > 0
    );
  }
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

/** Match poller partial-fetch guard: a live sheet that's still this fraction of
 * the prior one is a real booking/cancel, not a 429 that returned 2 of 20 slots. */
const LIVE_SHRINK_KEEP_RATIO = 0.35;

/**
 * Apply a fetch update without dropping richer same-hole inventory.
 * Hole sizes present in `next` replace those sizes in `prev` (so holes=9 drops
 * stale 18s from an any→9 switch). Within those sizes, keep the denser set only
 * when live looks like a collapsed/partial vendor response.
 */
export function preferRicherSameHoles(prev: TeeTime[], next: TeeTime[]): TeeTime[] {
  // Empty `next` means the caller already decided to clear or skip — don't resurrect
  // a prior sheet here (that kept ForeUp phantoms after confirmed live empty).
  if (next.length === 0) return next;
  if (prev.length === 0) return next;
  const nextHoles = new Set(next.map((t) => t.holes));
  const prevMatching = prev.filter((t) => nextHoles.has(t.holes));
  if (prevMatching.length > next.length) {
    const minKeep = Math.max(1, Math.ceil(prevMatching.length * LIVE_SHRINK_KEEP_RATIO));
    if (next.length >= minKeep) return next;
    return mergeTeeTimesByStartAndHoles(prevMatching, next);
  }
  return next;
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

  // Same path as Find: /v1/tee-times. Course detail always prefers a vendor sheet so
  // a slot you just booked isn't stuck on a 25-minute snapshot (or a 45s CDN cache).
  if (workerSupportedPlatform(effectivePlatform(course))) {
    const batchMap = await fetchTeeTimesBatchFromSnapshot([courseSlug], dateYmd, holes, players, {
      fresh: true,
    });
    const row = batchMap.get(courseSlug);
    if (row && canUseBatchRow(row, players, dateYmd)) {
      const times = snapshotToTeeTimes(courseSlug, dateYmd, row.times!);
      const fromLive = row.batchSource === 'live' && !row.live_failed;
      if (fromLive) {
        return { times, ok: true, source: 'live' };
      }
      const live = await fetchTeeTimesLiveWithRetry(course, courseSlug, dateYmd, holes, players);
      if (live.ok) return live;
      if (times.length > 0) return { times, ok: true, source: 'snapshot' };
      return live;
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
/** Chronogolf SLC 429s under Find load — retry with backoff instead of giving up. */
const MAX_RATE_LIMIT_ATTEMPTS = 4;

/** Platforms whose upstream is routinely multi-second — fetch last; don't thrash retries. */
function isSlowLivePlatform(platform: string | undefined): boolean {
  return platform === 'golfpay';
}

function isRateLimitSensitivePlatform(platform: string | undefined): boolean {
  return platform === 'chronogolf_slc' || platform === 'chronogolf';
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
  let rateLimitTries = 0;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      last = await fetchTeeTimesLive(record, slug, dateYmd, holes, players);
    } catch {
      last = { times: [], ok: false };
    }
    if (last.ok) return last;
    if (last.rateLimited) {
      rateLimitTries += 1;
      if (
        !isRateLimitSensitivePlatform(record.platform) ||
        rateLimitTries >= MAX_RATE_LIMIT_ATTEMPTS
      ) {
        return last;
      }
      // Honor upstream rate limit with jittered backoff, then retry the same attempt slot.
      await sleep(400 * 2 ** (rateLimitTries - 1) + Math.random() * 300);
      attempt -= 1;
      continue;
    }
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
  /** Re-check vendors even when the poller snapshot is still "fresh" (tab focus after booking). */
  fresh?: boolean;
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
    // 9-only catalog courses must be fetched once as holes=9. Running them through both
    // the 9 pass and the 18→nineOnly redirect lets an empty result from one pass wipe
    // good times from the other (handle(9) clears all 9-hole slots).
    const nineOnlyEntries = entries.filter((e) => e.record.holes === 9);
    const multiHoleEntries = entries.filter((e) => e.record.holes !== 9);

    const bySlug = new Map<string, TeeTime[]>();
    const okBySlug = new Map<string, boolean>();
    const halfConcurrency = Math.max(1, Math.ceil(concurrency / 2));
    let blockingLeft =
      (nineOnlyEntries.length > 0 ? 1 : 0) + (multiHoleEntries.length > 0 ? 2 : 0);
    if (blockingLeft === 0) {
      options?.onBlockingComplete?.();
      return { bySlug: new Map(), failedSlugs: [] };
    }

    const wrapOpts: FetchTimesForCourseSlugsOptions = {
      revalidateStale: options?.revalidateStale,
      fresh: options?.fresh,
      onBlockingComplete: () => {
        blockingLeft -= 1;
        if (blockingLeft === 0) options?.onBlockingComplete?.();
      },
    };

    const handle =
      (holeSize: 9 | 18) =>
      (update: CourseTimesUpdate) => {
        const prev = bySlug.get(update.slug) ?? [];
        // Empty update: keep prior on failed/untrusted fills (Chronogolf 429). Confirmed
        // live empty must clear that hole size so ForeUp phantoms disappear.
        if (update.times.length === 0) {
          if (update.ok && update.source === 'live') {
            const kept = prev.filter((t) => t.holes !== holeSize);
            bySlug.set(update.slug, kept);
            const prevOk = okBySlug.get(update.slug) === true;
            const ok = prevOk || update.ok;
            okBySlug.set(update.slug, ok);
            onCourseComplete?.({
              slug: update.slug,
              times: kept,
              ok,
              source: update.source,
            });
            return;
          }
          const prevSame = prev.filter((t) => t.holes === holeSize);
          if (prevSame.length > 0) return;
          if (!update.ok && prev.length > 0) return;
        }
        const kept = prev.filter((t) => t.holes !== holeSize);
        const prevSame = prev.filter((t) => t.holes === holeSize);
        const holeTimes =
          update.ok && update.times.length > 0
            ? preferRicherSameHoles(prevSame, update.times)
            : update.times;
        const next = mergeTeeTimesByStartAndHoles(kept, holeTimes);
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

    const paintNineOnly = (update: CourseTimesUpdate) => {
      const prev = bySlug.get(update.slug) ?? [];
      if (update.times.length === 0 && prev.length > 0 && !(update.ok && update.source === 'live')) {
        return;
      }
      const next =
        update.ok && update.times.length > 0
          ? preferRicherSameHoles(prev, update.times)
          : update.times;
      bySlug.set(update.slug, next);
      okBySlug.set(update.slug, update.ok || okBySlug.get(update.slug) === true);
      onCourseComplete?.({ ...update, times: next });
    };

    const tasks: Promise<TimesBySlugFetchResult>[] = [];
    if (nineOnlyEntries.length > 0) {
      tasks.push(
        fetchTimesForCourseSlugs(
          nineOnlyEntries,
          dateYmd,
          9,
          players,
          concurrency,
          paintNineOnly,
          wrapOpts,
        ),
      );
    }
    if (multiHoleEntries.length > 0) {
      tasks.push(
        fetchTimesForCourseSlugs(
          multiHoleEntries,
          dateYmd,
          9,
          players,
          halfConcurrency,
          handle(9),
          wrapOpts,
        ),
        fetchTimesForCourseSlugs(
          multiHoleEntries,
          dateYmd,
          18,
          players,
          halfConcurrency,
          handle(18),
          wrapOpts,
        ),
      );
    }

    const results = await Promise.all(tasks);
    const failedSlugs: string[] = [];
    let nineOnlyResult: TimesBySlugFetchResult | null = null;
    let multi9: TimesBySlugFetchResult | null = null;
    let multi18: TimesBySlugFetchResult | null = null;
    let offset = 0;
    if (nineOnlyEntries.length > 0) {
      nineOnlyResult = results[offset]!;
      offset += 1;
    }
    if (multiHoleEntries.length > 0) {
      multi9 = results[offset]!;
      multi18 = results[offset + 1]!;
    }
    if (nineOnlyResult) failedSlugs.push(...nineOnlyResult.failedSlugs);
    if (multi9 && multi18) {
      failedSlugs.push(
        ...[...new Set([...multi9.failedSlugs, ...multi18.failedSlugs])].filter(
          (slug) => multi9!.failedSlugs.includes(slug) && multi18!.failedSlugs.includes(slug),
        ),
      );
    }

    const allSlugs = new Set<string>([
      ...(nineOnlyResult?.bySlug.keys() ?? []),
      ...(multi9?.bySlug.keys() ?? []),
      ...(multi18?.bySlug.keys() ?? []),
    ]);
    const out = new Map<string, TeeTime[]>();
    for (const slug of allSlugs) {
      out.set(
        slug,
        mergeTeeTimesByStartAndHoles(
          nineOnlyResult?.bySlug.get(slug) ?? [],
          mergeTeeTimesByStartAndHoles(multi9?.bySlug.get(slug) ?? [], multi18?.bySlug.get(slug) ?? []),
        ),
      );
    }
    return { bySlug: out, failedSlugs };
  }

  const holeSize: 9 | 18 = holes;
  const out = new Map<string, TeeTime[]>();
  const failedSlugs: string[] = [];
  const revalidateStale = options?.revalidateStale !== false;

  const workerEntries = entries.filter(
    (e) => workerSupportedPlatform(effectivePlatform(e.record)),
  );
  const nineOnlyEntries = workerEntries.filter((e) => e.record.holes === 9);
  const standardEntries = workerEntries.filter((e) => e.record.holes !== 9);

  // Split 9-only courses into their own holes=9 pass when Find filter is 18
  // (city search still needs 9-only inventory). Nested nine-only-only calls fall through.
  // For holes=9: do NOT split/await nine-only first — that burned the Chronogolf budget
  // before multi-course holes=9 live fills (empty snapshots; poller stores canonical 18).
  // Instead order nine-only first in one serialized batch pass below.
  const splitNineOnly = holeSize === 18 && nineOnlyEntries.length > 0;

  if (splitNineOnly) {
    let resolveNineBlocking!: () => void;
    const nineBlocking = new Promise<void>((r) => {
      resolveNineBlocking = r;
    });
    let nineBlockingDone = false;
    let standardBlockingDone = standardEntries.length === 0;
    const maybeAllBlockingDone = () => {
      if (nineBlockingDone && standardBlockingDone) options?.onBlockingComplete?.();
    };

    const ninePromise = fetchTimesForCourseSlugs(
      nineOnlyEntries,
      dateYmd,
      9,
      players,
      concurrency,
      onCourseComplete,
      {
        revalidateStale: options?.revalidateStale,
        fresh: options?.fresh,
        onBlockingComplete: () => {
          nineBlockingDone = true;
          resolveNineBlocking();
          maybeAllBlockingDone();
        },
      },
    );

    await nineBlocking;

    if (standardEntries.length === 0) {
      const nineResult = await ninePromise;
      for (const [slug, times] of nineResult.bySlug) out.set(slug, times);
      failedSlugs.push(...nineResult.failedSlugs);
      return { bySlug: out, failedSlugs };
    }

    const standardPromise = fetchTimesForCourseSlugs(
      standardEntries,
      dateYmd,
      holeSize,
      players,
      concurrency,
      onCourseComplete,
      {
        revalidateStale: options?.revalidateStale,
        fresh: options?.fresh,
        onBlockingComplete: () => {
          standardBlockingDone = true;
          maybeAllBlockingDone();
        },
      },
    );

    const [nineResult, standardResult] = await Promise.all([ninePromise, standardPromise]);
    for (const [slug, times] of nineResult.bySlug) out.set(slug, times);
    for (const [slug, times] of standardResult.bySlug) out.set(slug, times);
    failedSlugs.push(...nineResult.failedSlugs, ...standardResult.failedSlugs);
    return { bySlug: out, failedSlugs };
  }

  // Prefer 9-only catalog courses early in the holes=9 batch so they live-fill first
  // without a separate pre-pass that rate-limits everyone else.
  const batchEntries =
    holeSize === 9
      ? [...nineOnlyEntries, ...standardEntries]
      : workerEntries;

  const needLive: { slug: string; record: CourseRecord }[] = [];
  const needRevalidate: { slug: string; record: CourseRecord; ageMs: number }[] = [];
  const applied = new Set<string>();
  const bySlug = new Map(batchEntries.map((e) => [e.slug, e]));

  const applyBatchRow = (entry: { slug: string; record: CourseRecord }, snap: BatchRow) => {
    if (applied.has(entry.slug)) return;
    applied.add(entry.slug);
    if (snap && canUseBatchRow(snap, players, dateYmd)) {
      const times = snapshotToTeeTimes(entry.slug, dateYmd, snap.times!);
      const fromLive = snap.batchSource === 'live' && !snap.live_failed;
      // Snapshot that paints empty after past/filter — blocking live, not a fake sold-out.
      if (times.length === 0 && !fromLive) {
        needLive.push(entry);
        return;
      }
      const prev = out.get(entry.slug) ?? [];
      const next = preferRicherSameHoles(prev, times);
      out.set(entry.slug, next);
      // live_failed + trusted snapshot paints as snapshot (server live did not succeed).
      const source =
        snap.live_failed || snap.batchSource !== 'live' ? 'snapshot' : 'live';
      onCourseComplete?.({ slug: entry.slug, times: next, ok: true, source });
      // Background-revalidate poller snapshots, and always retry after a failed live fill.
      // Tab-focus `fresh` re-hits vendors even when the snapshot is still inside the
      // 8–25m trust window — that's how a just-booked Stonebridge chip drops off Find.
      if (
        revalidateStale &&
        (source === 'snapshot' || snap.live_failed) &&
        (options?.fresh || snap.live_failed || shouldBackgroundRevalidate(snap, dateYmd, players))
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
  };

  await fetchTeeTimesBatchFromSnapshot(
    batchEntries.map((e) => e.slug),
    dateYmd,
    holeSize,
    players,
    {
      fresh: options?.fresh === true,
      onChunk: (chunkMap) => {
        for (const [slug, snap] of chunkMap) {
          const entry = bySlug.get(slug);
          if (entry) applyBatchRow(entry, snap);
        }
      },
    },
  );

  for (const entry of batchEntries) {
    if (!applied.has(entry.slug)) needLive.push(entry);
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
          // Keep painted snapshot if live refresh fails. Confirmed empty must clear ghosts.
          if (!ok) continue;
          const prev = out.get(slug) ?? [];
          if (times.length === 0) {
            out.set(slug, []);
            onCourseComplete?.({ slug, times: [], ok: true, source: source ?? 'live' });
            continue;
          }
          const next = preferRicherSameHoles(prev, times);
          out.set(slug, next);
          onCourseComplete?.({ slug, times: next, ok: true, source: source ?? 'live' });
          continue;
        }
        if (!ok) {
          // Do not wipe prior/snapshot times with a failed empty live response.
          const prev = out.get(slug);
          if (prev && prev.length > 0) {
            // Still painted — not a hard miss for the Find banner.
            continue;
          }
          failedSlugs.push(slug);
          out.set(slug, times);
          onCourseComplete?.({ slug, times, ok: false, source });
          continue;
        }
        const prev = out.get(slug) ?? [];
        const next = preferRicherSameHoles(prev, times);
        out.set(slug, next);
        onCourseComplete?.({ slug, times: next, ok: true, source });
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
