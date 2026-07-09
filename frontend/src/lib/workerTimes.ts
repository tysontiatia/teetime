import type { TeeTime } from '../types';
import type { CourseRecord } from './courseRecord';
import { getWorkerBaseUrl } from './env';
import { normalizeTimesWorker } from './normalizeTimes';
import { workerSupportedPlatform } from './platformRegistry';
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

export type TeeTimeFetchResult = { times: TeeTime[]; ok: boolean; source?: 'snapshot' | 'live' };

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
    const res = await fetch(url.toString(), { method: 'GET' });
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
  const out: TeeTime[] = rows.map((row, i) => ({
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
    default:
      return emptyOk;
  }

  try {
    const res = await fetch(url.toString(), { method: 'GET' });
    if (!res.ok) return { times: [], ok: false };
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

function canTrustSnapshotForPlayers(
  snapshot: SnapshotAvailabilityResponse,
  players: 1 | 2 | 3 | 4,
): boolean {
  if (!snapshot.ok || !snapshot.has_poll_coverage || !Array.isArray(snapshot.times)) return false;
  if (players === 1) return true;
  // Multi-player needs spot counts. Empty [].every() is vacuously true — don't trust that.
  if (snapshot.spots_known === false) return false;
  if (snapshot.times.length === 0) return snapshot.spots_known === true;
  return snapshot.times.every((row) => row.spots != null);
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
};

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
  let index = 0;

  async function runWorker() {
    for (;;) {
      const i = index++;
      if (i >= entries.length) break;
      const { slug, record } = entries[i];
      try {
        const { times, ok } = await fetchTeeTimesForCourse(record, slug, dateYmd, holes, players);
        out.set(slug, times);
        if (!ok) failedSlugs.push(slug);
        onCourseComplete?.({ slug, times, ok });
      } catch {
        out.set(slug, []);
        failedSlugs.push(slug);
        onCourseComplete?.({ slug, times: [], ok: false });
      }
    }
  }

  const n = Math.max(1, Math.min(concurrency, entries.length));
  await Promise.all(Array.from({ length: n }, () => runWorker()));
  return { bySlug: out, failedSlugs };
}
