import type { TeeTime } from '../types';
import type { CourseRecord } from './courseRecord';
import { getWorkerBaseUrl } from './env';
import { normalizeTimesWorker } from './normalizeTimes';

function parsePrice(s: string | null): number | undefined {
  if (!s) return undefined;
  const n = parseInt(s.replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) ? n : undefined;
}

/** Local date + "HH:MM" → ISO (browser-local wall clock). */
function toIso(dateYmd: string, hhmm: string): string {
  const [y, mo, d] = dateYmd.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  if (!y || !mo || !d || Number.isNaN(hh) || Number.isNaN(mm)) return new Date().toISOString();
  const dt = new Date(y, mo - 1, d, hh, mm, 0, 0);
  if (Number.isNaN(dt.getTime())) return new Date().toISOString();
  return dt.toISOString();
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
    const iso = toIso(dateYmd, row.rawTime);
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
      if (!course.club_id || !course.course_id || !course.affiliation_type_id) return [];
      url = new URL(`${base}/chronogolf-slc`);
      url.searchParams.set('club_id', course.club_id);
      url.searchParams.set('course_id', course.course_id);
      url.searchParams.set('affiliation_type_id', course.affiliation_type_id);
      url.searchParams.set('nb_holes', String(holes));
      url.searchParams.set('date', dateYmd);
      url.searchParams.set('players', String(players));
      break;
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
