import { useEffect, useMemo, useState } from 'react';
import type { Course } from '../types';
import type { TeeTime } from '../types';
import type { CourseRecord } from '../lib/courseRecord';
import { fetchTimesForCourseSlugs } from '../lib/workerTimes';
import { filterWorkerCourses } from '../lib/platformRegistry';

export function useTimesByCourseMap(
  courses: Course[],
  recordsBySlug: Map<string, CourseRecord>,
  dateYmd: string,
  holes: 9 | 18,
  players: 1 | 2 | 3 | 4,
  refreshNonce: number,
  catalogLoading: boolean
) {
  const workerCourses = useMemo(() => filterWorkerCourses(courses), [courses]);
  const slugKey = useMemo(() => workerCourses.map((c) => c.id).join('|'), [workerCourses]);

  const [map, setMap] = useState<Map<string, TeeTime[]>>(new Map());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (catalogLoading) {
      setLoading(false);
      return;
    }
    if (workerCourses.length === 0) {
      setMap(new Map());
      setLoading(false);
      return;
    }

    const entries = workerCourses
      .map((c) => {
        const record = recordsBySlug.get(c.id);
        return record ? { slug: c.id, record } : null;
      })
      .filter((x): x is { slug: string; record: CourseRecord } => x != null);

    if (entries.length === 0) {
      setMap(new Map());
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const runFetch = () => {
      void (async () => {
        const next = await fetchTimesForCourseSlugs(entries, dateYmd, holes, players, 6);
        if (!cancelled) {
          setMap(next);
          setLoading(false);
        }
      })();
    };

    // Let the shell paint before we open many worker connections (major win vs old single-file cold start perception).
    if (typeof requestIdleCallback !== 'undefined') {
      const id = requestIdleCallback(() => !cancelled && runFetch(), { timeout: 1800 });
      return () => {
        cancelled = true;
        cancelIdleCallback(id);
      };
    }
    const t = window.setTimeout(() => !cancelled && runFetch(), 150);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [slugKey, dateYmd, holes, players, refreshNonce, catalogLoading, workerCourses, recordsBySlug]);

  return { timesByCourse: map, loadingTimes: loading };
}
