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
  const [failedSlugs, setFailedSlugs] = useState<string[]>([]);
  const [attemptedSlugCount, setAttemptedSlugCount] = useState(0);
  const [pendingSlugs, setPendingSlugs] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (catalogLoading) {
      setLoading(false);
      setFailedSlugs([]);
      setAttemptedSlugCount(0);
      setPendingSlugs(new Set());
      return;
    }
    if (workerCourses.length === 0) {
      setMap(new Map());
      setFailedSlugs([]);
      setAttemptedSlugCount(0);
      setPendingSlugs(new Set());
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
      setFailedSlugs([]);
      setAttemptedSlugCount(0);
      setPendingSlugs(new Set());
      setLoading(false);
      return;
    }

    let cancelled = false;
    const slugs = entries.map((e) => e.slug);

    setMap(new Map());
    setFailedSlugs([]);
    setAttemptedSlugCount(entries.length);
    setPendingSlugs(new Set(slugs));
    setLoading(true);

    void (async () => {
      const failed: string[] = [];
      await fetchTimesForCourseSlugs(entries, dateYmd, holes, players, 6, ({ slug, times, ok }) => {
        if (cancelled) return;
        setMap((prev) => {
          const next = new Map(prev);
          next.set(slug, times);
          return next;
        });
        setPendingSlugs((prev) => {
          if (!prev.has(slug)) return prev;
          const next = new Set(prev);
          next.delete(slug);
          return next;
        });
        if (!ok) failed.push(slug);
      });

      if (!cancelled) {
        setFailedSlugs(failed);
        setPendingSlugs(new Set());
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [slugKey, dateYmd, holes, players, refreshNonce, catalogLoading, workerCourses, recordsBySlug]);

  const loadedSlugCount = attemptedSlugCount - pendingSlugs.size;

  return {
    timesByCourse: map,
    loadingTimes: loading,
    failedSlugs,
    attemptedSlugCount,
    pendingSlugs,
    loadedSlugCount,
  };
}
