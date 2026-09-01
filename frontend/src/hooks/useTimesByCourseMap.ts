import { useEffect, useMemo, useRef, useState } from 'react';
import type { Course } from '../types';
import type { TeeTime } from '../types';
import type { CourseRecord } from '../lib/courseRecord';
import type { HolesFilter } from '../lib/holesFilter';
import { fetchTimesForCourseSlugs, preferRicherSameHoles } from '../lib/workerTimes';
import { filterWorkerCourses } from '../lib/platformRegistry';

export type InventorySource = 'snapshot' | 'live';

type TimesMemCache = {
  key: string;
  map: Map<string, TeeTime[]>;
  sourceBySlug: Map<string, InventorySource>;
  failedSlugs: string[];
  attemptedSlugCount: number;
};

let timesMemCache: TimesMemCache | null = null;

function timesSearchKey(slugKey: string, dateYmd: string, holes: HolesFilter, players: number): string {
  return `${slugKey}|${dateYmd}|${holes}|${players}`;
}

function cloneTimesMap(src: Map<string, TeeTime[]>): Map<string, TeeTime[]> {
  return new Map(src);
}

function cloneSourceMap(src: Map<string, InventorySource>): Map<string, InventorySource> {
  return new Map(src);
}

export function useTimesByCourseMap(
  courses: Course[],
  recordsBySlug: Map<string, CourseRecord>,
  dateYmd: string,
  holes: HolesFilter,
  players: 1 | 2 | 3 | 4,
  refreshNonce: number,
  catalogLoading: boolean,
  options?: { fresh?: boolean },
) {
  const fresh = options?.fresh === true;
  const workerCourses = useMemo(() => filterWorkerCourses(courses), [courses]);
  const slugKey = useMemo(() => workerCourses.map((c) => c.id).join('|'), [workerCourses]);
  const searchKey = timesSearchKey(slugKey, dateYmd, holes, players);
  const cacheHit = timesMemCache?.key === searchKey ? timesMemCache : null;

  const [map, setMap] = useState<Map<string, TeeTime[]>>(() =>
    cacheHit ? cloneTimesMap(cacheHit.map) : new Map(),
  );
  const [sourceBySlug, setSourceBySlug] = useState<Map<string, InventorySource>>(() =>
    cacheHit ? cloneSourceMap(cacheHit.sourceBySlug) : new Map(),
  );
  const [loading, setLoading] = useState(false);
  const [failedSlugs, setFailedSlugs] = useState<string[]>(() => cacheHit?.failedSlugs ?? []);
  const [attemptedSlugCount, setAttemptedSlugCount] = useState(() => cacheHit?.attemptedSlugCount ?? 0);
  const [pendingSlugs, setPendingSlugs] = useState<Set<string>>(new Set());
  const mapRef = useRef(map);
  const consumedNonceRef = useRef(0);

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
    const forceRefresh = fresh || (refreshNonce > 0 && refreshNonce !== consumedNonceRef.current);
    if (timesMemCache?.key === searchKey && !forceRefresh) {
      setMap(cloneTimesMap(timesMemCache.map));
      setSourceBySlug(cloneSourceMap(timesMemCache.sourceBySlug));
      setFailedSlugs(timesMemCache.failedSlugs);
      setAttemptedSlugCount(timesMemCache.attemptedSlugCount);
      setPendingSlugs(new Set());
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

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

    const failed = new Set<string>();
    const painted = new Map<string, TeeTime[]>();
    const paintedSources = new Map<string, InventorySource>();
    for (const [slug, times] of mapRef.current) {
      if (slugSet.has(slug) && times.length > 0) painted.set(slug, times);
    }
    const persistCache = () => {
      if (painted.size === 0) return;
      timesMemCache = {
        key: searchKey,
        map: cloneTimesMap(painted),
        sourceBySlug: cloneSourceMap(paintedSources),
        failedSlugs: [...failed],
        attemptedSlugCount: entries.length,
      };
    };

    // Defer so React Strict Mode's mount→unmount→remount only runs one fetch.
    // Without this, the cancelled first pass still hammers Chronogolf and the
    // second pass often rate-limits holes=9 multi-course live fills to empty.
    const timer = window.setTimeout(() => {
      void (async () => {
        let blockingDone = false;

        await fetchTimesForCourseSlugs(
          entries,
          dateYmd,
          holes,
          players,
          6,
          ({ slug, times, ok, source }) => {
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
            if (source) paintedSources.set(slug, source);
            persistCache();
            if (cancelled) return;

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
            fresh: forceRefresh,
            onBlockingComplete: () => {
              blockingDone = true;
              persistCache();
              if (cancelled) return;
              setFailedSlugs([...failed]);
              setPendingSlugs(new Set());
              setLoading(false);
            },
          },
        );

        persistCache();
        if (!cancelled) {
          setFailedSlugs([...failed]);
          setPendingSlugs(new Set());
          setLoading(false);
          consumedNonceRef.current = refreshNonce;
        }
      })();
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      persistCache();
    };
  }, [searchKey, slugKey, dateYmd, holes, players, refreshNonce, catalogLoading, workerCourses, recordsBySlug, fresh]);

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
