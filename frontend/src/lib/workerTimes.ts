import type { TeeTime } from '../types';
import type { CourseRecord } from './courseRecord';
import { getWorkerBaseUrl } from './env';
import { normalizeTimesWorker } from './normalizeTimes';
import { rawTeeTimeToIsoUtc } from './teeTimeInstant';

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

/** Chrono SLC often publishes twilight / back-nine as 9-hole-only; merge those when the user asked for 18. */
function mergeChronoSlcNineOnlySlots(primary: TeeTime[], nineHoleTimes: TeeTime[]): TeeTime[] {
  const seen = new Set(primary.map((t) => t.startsAt));
  const merged = [...primary];
  for (const t of nineHoleTimes) {
    if (!seen.has(t.startsAt)) {
      seen.add(t.startsAt);
      merged.push(t);
    }
  }
  merged.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  return merged;
}

export async function fetchTeeTimesForCourse(
  course: CourseRecord,
  courseSlug: string,
  dateYmd: string,
  holes: 9 | 18,
  players: 1 | 2 | 3 | 4
): Promise<TeeTime[]> {
  const base = getWorkerBaseUrl();
  let url: URL;

  switch (course.platform) {
    case 'foreup': {
      if (!course.schedule_id) return [];
      url = new URL(`${base}/foreup`);
      url.searchParams.set('schedule_id', course.schedule_id);
      url.searchParams.set('date', dateYmd);
      url.searchParams.set('holes', String(holes));
      if (course.booking_class_id) url.searchParams.set('booking_class_id', course.booking_class_id);
      break;
    }
    case 'chronogolf_slc': {
      const { club_id, course_id, affiliation_type_id } = course;
      if (!club_id || !course_id || !affiliation_type_id) return [];
      const buildUrl = (nb: 9 | 18) => {
        const u = new URL(`${base}/chronogolf-slc`);
        u.searchParams.set('club_id', club_id);
        u.searchParams.set('course_id', course_id);
        u.searchParams.set('affiliation_type_id', affiliation_type_id);
        u.searchParams.set('nb_holes', String(nb));
        u.searchParams.set('date', dateYmd);
        u.searchParams.set('players', String(players));
        return u;
      };
      const load = async (nb: 9 | 18) => {
        const res = await fetch(buildUrl(nb).toString(), { method: 'GET' });
        if (!res.ok) return null;
        try {
          return (await res.json()) as unknown;
        } catch {
          return null;
        }
      };
      const primaryData = await load(holes);
      if (!primaryData) return [];
      const primaryRows = normalizeTimesWorker(course, primaryData, String(holes));
      let times = rowsToTeeTimes(courseSlug, dateYmd, primaryRows, holes);
      if (holes === 18) {
        const nineData = await load(9);
        if (nineData) {
          const nineRows = normalizeTimesWorker(course, nineData, '9');
          const nineTimes = rowsToTeeTimes(courseSlug, dateYmd, nineRows, 9);
          times = mergeChronoSlcNineOnlySlots(times, nineTimes);
        }
      }
      return times;
    }
    case 'membersports': {
      if (!course.golf_club_id || !course.golf_course_id) return [];
      url = new URL(`${base}/membersports`);
      url.searchParams.set('golf_club_id', course.golf_club_id);
      url.searchParams.set('golf_course_id', course.golf_course_id);
      url.searchParams.set('date', dateYmd);
      break;
    }
    case 'chronogolf': {
      if (!course.course_ids?.length) return [];
      url = new URL(`${base}/chronogolf`);
      url.searchParams.set('course_ids', course.course_ids.join(','));
      url.searchParams.set('date', dateYmd);
      break;
    }
    default:
      return [];
  }

  const res = await fetch(url.toString(), { method: 'GET' });
  if (!res.ok) return [];
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return [];
  }
  const rows = normalizeTimesWorker(course, data, String(holes));
  return rowsToTeeTimes(courseSlug, dateYmd, rows, holes);
}

export async function fetchTimesForCourseSlugs(
  entries: { slug: string; record: CourseRecord }[],
  dateYmd: string,
  holes: 9 | 18,
  players: 1 | 2 | 3 | 4,
  concurrency: number
): Promise<Map<string, TeeTime[]>> {
  const out = new Map<string, TeeTime[]>();
  let index = 0;

  async function worker() {
    for (;;) {
      const i = index++;
      if (i >= entries.length) break;
      const { slug, record } = entries[i];
      try {
        const times = await fetchTeeTimesForCourse(record, slug, dateYmd, holes, players);
        out.set(slug, times);
      } catch {
        out.set(slug, []);
      }
    }
  }

  const n = Math.max(1, Math.min(concurrency, entries.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}
