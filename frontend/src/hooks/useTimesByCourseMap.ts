import { useEffect, useMemo, useState } from 'react';
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
        const failed: string[] = [];
        let blockingDone = false;
        await fetchTimesForCourseSlugs(
          entries,
          dateYmd,
          holes,
          players,
          6,
          ({ slug, times, ok, source }) => {
            if (cancelled) return;
            setMap((prev) => {
              const existing = prev.get(slug) ?? [];
              // Never replace a painted sheet with [] — failed live, confirmed-empty
              // blips, and Strict Mode double-fetch races were wiping good holes=9 inventory.
              if (times.length === 0 && existing.length > 0) return prev;
              // Keep denser same-hole inventory; drop hole sizes absent from this update
              // (e.g. any→9 should not keep stale 18s once the 9 pass paints).
              const merged =
                ok && times.length > 0 ? preferRicherSameHoles(existing, times) : times;
              const next = new Map(prev);
              next.set(slug, merged);
              return next;
            });
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
            // Only count hard misses (no trusted snapshot) toward the failure banner.
            if (!ok && !blockingDone) failed.push(slug);
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
