import { useEffect, useMemo, useRef, useState } from 'react';
import type { Course } from '../types';
import type { TeeTime } from '../types';
import type { CourseRecord } from '../lib/courseRecord';
import type { HolesFilter } from '../lib/holesFilter';
import { fetchTimesForCourseSlugs, preferRicherSameHoles } from '../lib/workerTimes';
import { filterWorkerCourses } from '../lib/platformRegistry';

export type InventorySource = 'snapshot' | 'live';

export function useTimesByCourseMap(
  courses: Course[],
  recordsBySlug: Map<string, CourseRecord>,
  dateYmd: string,
  holes: HolesFilter,
  players: 1 | 2 | 3 | 4,
  refreshNonce: number,
  catalogLoading: boolean
) {
  const workerCourses = useMemo(() => filterWorkerCourses(courses), [courses]);
  const slugKey = useMemo(() => workerCourses.map((c) => c.id).join('|'), [workerCourses]);

  const [map, setMap] = useState<Map<string, TeeTime[]>>(new Map());
  const [sourceBySlug, setSourceBySlug] = useState<Map<string, InventorySource>>(new Map());
  const [loading, setLoading] = useState(false);
  const [failedSlugs, setFailedSlugs] = useState<string[]>([]);
  const [attemptedSlugCount, setAttemptedSlugCount] = useState(0);
  const [pendingSlugs, setPendingSlugs] = useState<Set<string>>(new Set());
  const mapRef = useRef(map);

  useEffect(() => {
    mapRef.current = map;
  }, [map]);

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
      setSourceBySlug(new Map());
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
      setSourceBySlug(new Map());
      setFailedSlugs([]);
      setAttemptedSlugCount(0);
      setPendingSlugs(new Set());
      setLoading(false);
      return;
    }

    let cancelled = false;
    const slugs = entries.map((e) => e.slug);
    const slugSet = new Set(slugs);

    // Keep prior times painted across refetch (date/players/holes/retry). Drop slugs
    // no longer in the pool; don't blank the whole grid at fetch start.
    setMap((prev) => {
      if (prev.size === 0) return prev;
      let changed = false;
      const next = new Map<string, TeeTime[]>();
      for (const [slug, times] of prev) {
        if (slugSet.has(slug)) next.set(slug, times);
        else changed = true;
      }
      return changed || next.size !== prev.size ? next : prev;
    });
    setSourceBySlug((prev) => {
      if (prev.size === 0) return prev;
      let changed = false;
      const next = new Map<string, InventorySource>();
      for (const [slug, source] of prev) {
        if (slugSet.has(slug)) next.set(slug, source);
        else changed = true;
      }
      return changed || next.size !== prev.size ? next : prev;
    });
    setFailedSlugs([]);
    setAttemptedSlugCount(entries.length);
    setPendingSlugs(new Set(slugs));
    setLoading(true);

    // Defer so React Strict Mode's mount→unmount→remount only runs one fetch.
    // Without this, the cancelled first pass still hammers Chronogolf and the
    // second pass often rate-limits holes=9 multi-course live fills to empty.
    const timer = window.setTimeout(() => {
      void (async () => {
        const failed = new Set<string>();
        /** Sync mirror for this fetch — seeded from whatever is already on screen. */
        const painted = new Map<string, TeeTime[]>();
        for (const [slug, times] of mapRef.current) {
          if (slugSet.has(slug) && times.length > 0) painted.set(slug, times);
        }
        let blockingDone = false;

        await fetchTimesForCourseSlugs(
          entries,
          dateYmd,
          holes,
          players,
          6,
          ({ slug, times, ok, source }) => {
            if (cancelled) return;
            const existing = painted.get(slug) ?? [];
            let nextTimes: TeeTime[];
            // Confirmed live empty must clear ghosts (The Ridge 18-hole phantoms).
            // Only keep a prior sheet when the update failed / was untrusted.
            if (times.length === 0 && existing.length > 0 && !(ok && source === 'live')) {
              nextTimes = existing;
            } else if (ok && times.length > 0) {
              nextTimes = preferRicherSameHoles(existing, times);
            } else {
              nextTimes = times;
            }
            painted.set(slug, nextTimes);
            if (nextTimes.length > 0) failed.delete(slug);
            else if (!ok && !blockingDone) failed.add(slug);
            else failed.delete(slug);

            setMap((prev) => {
              const next = new Map(prev);
              next.set(slug, nextTimes);
              return next;
            });
            // Keep banner state in sync when a late live fill recovers a course.
            if (blockingDone) {
              setFailedSlugs([...failed]);
            }
            if (source) {
              setSourceBySlug((prev) => {
                const next = new Map(prev);
                next.set(slug, source);
                return next;
              });
            }
            setPendingSlugs((prev) => {
              if (!prev.has(slug)) return prev;
              const next = new Set(prev);
              next.delete(slug);
              return next;
            });
          },
          {
            onBlockingComplete: () => {
              blockingDone = true;
              if (cancelled) return;
              setFailedSlugs([...failed]);
              setPendingSlugs(new Set());
              setLoading(false);
            },
          },
        );

        if (!cancelled) {
          setFailedSlugs([...failed]);
          setPendingSlugs(new Set());
          setLoading(false);
        }
      })();
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [slugKey, dateYmd, holes, players, refreshNonce, catalogLoading, workerCourses, recordsBySlug]);

  const loadedSlugCount = attemptedSlugCount - pendingSlugs.size;

  return {
    timesByCourse: map,
    sourceBySlug,
    loadingTimes: loading,
    failedSlugs,
    attemptedSlugCount,
    pendingSlugs,
    loadedSlugCount,
  };
}
