import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Course } from '../types';
import type { CourseRecord } from '../lib/courseRecord';
import { recordToCourse } from '../lib/courseRecord';
import { slugFromCourseName } from '../lib/courseSlug';
import { haversineMiles } from '../lib/geo';
import { getWorkerBaseUrl } from '../lib/env';

/**
 * Course catalog for the app.
 *
 * The app loads a small index of every public course (name, location, photo,
 * platform, booking window) for search, the map, and result cards. Full records
 * (vendor ids for booking deep links, notes, phone, website) load per course
 * through useFullRecords(slugs), so a visit no longer downloads the whole catalog.
 */
type Api = {
  loading: boolean;
  error: string | null;
  /** Index rows for every public course. */
  records: CourseRecord[];
  /**
   * Index rows by slug, upgraded to the full record once useFullRecords has
   * loaded it. Read booking fields from useFullRecords instead of this.
   */
  recordsBySlug: Map<string, CourseRecord>;
  /**
   * Index rows by slug, never upgraded. Stable once loaded, so tee-time
   * effects keyed on it do not run again when a full record arrives.
   */
  indexBySlug: Map<string, CourseRecord>;
  /** UI courses with optional distance when geolocation is available */
  courses: Course[];
  userLocation: { lat: number; lng: number } | null;
  refresh: () => void;
  /** Starts loading full records for these slugs (cached; batched). */
  requestFullRecords: (slugs: string[]) => void;
  fullBySlug: Map<string, CourseRecord>;
};

const CourseCatalogContext = createContext<Api | null>(null);

/** Max slugs per /v1/courses?slugs= request (the Worker allows 60). */
const FULL_BATCH = 50;

function withRecordDefaults(row: Partial<CourseRecord>): CourseRecord {
  return { ...row, name: row.name ?? '', area: row.area ?? '', platform: row.platform ?? '', booking_url: row.booking_url ?? '' } as CourseRecord;
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { credentials: 'omit' });
  if (!res.ok) throw new Error(`courses HTTP ${res.status}`);
  return res.json();
}

/** The index, or the full list from a Worker that does not have the index yet. */
async function loadIndex(): Promise<{ rows: CourseRecord[]; full: boolean }> {
  const base = getWorkerBaseUrl();
  try {
    const data = await fetchJson(`${base}/v1/courses/index`);
    if (Array.isArray(data) && data.length > 0) return { rows: data.map(withRecordDefaults), full: false };
  } catch {
    // Fall through to the full list.
  }
  let data = await fetchJson(`${base}/v1/courses`).catch(() => null);
  if (!Array.isArray(data) || data.length === 0) {
    data = await fetchJson(import.meta.env.DEV ? '/courses.json' : `${window.location.origin}/courses.json`);
  }
  if (!Array.isArray(data)) throw new Error('Invalid courses payload');
  return { rows: data.map(withRecordDefaults), full: true };
}

export function CourseCatalogProvider({ children }: { children: React.ReactNode }) {
  const [records, setRecords] = useState<CourseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [fullBySlug, setFullBySlug] = useState<Map<string, CourseRecord>>(() => new Map());
  const requested = useRef(new Set<string>());
  const indexIsFull = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { rows, full } = await loadIndex();
      indexIsFull.current = full;
      if (full) {
        // An older Worker sent every full record; use them directly.
        setFullBySlug(new Map(rows.map((r) => [slugFromCourseName(r.name), r])));
      }
      setRecords(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load courses');
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {},
      { enableHighAccuracy: false, maximumAge: 120_000, timeout: 10_000 }
    );
  }, []);

  const requestFullRecords = useCallback((slugs: string[]) => {
    if (indexIsFull.current) return;
    const missing = [...new Set(slugs.filter(Boolean))].filter((slug) => !requested.current.has(slug));
    if (!missing.length) return;
    for (const slug of missing) requested.current.add(slug);
    const base = getWorkerBaseUrl();
    for (let i = 0; i < missing.length; i += FULL_BATCH) {
      const part = missing.slice(i, i + FULL_BATCH);
      void fetchJson(`${base}/v1/courses?slugs=${encodeURIComponent(part.join(','))}`)
        .then((data) => {
          if (!Array.isArray(data)) throw new Error('Invalid courses payload');
          setFullBySlug((prev) => {
            const next = new Map(prev);
            for (const row of data) {
              const rec = withRecordDefaults(row as Partial<CourseRecord>);
              next.set(slugFromCourseName(rec.name), rec);
            }
            return next;
          });
        })
        .catch(() => {
          // Let a later screen ask again.
          for (const slug of part) requested.current.delete(slug);
        });
    }
  }, []);

  const indexBySlug = useMemo(
    () => new Map(records.map((r) => [slugFromCourseName(r.name), r] as const)),
    [records],
  );

  const recordsBySlug = useMemo(() => {
    const m = new Map<string, CourseRecord>();
    for (const r of records) {
      const slug = slugFromCourseName(r.name);
      m.set(slug, fullBySlug.get(slug) ?? r);
    }
    return m;
  }, [records, fullBySlug]);

  const courses = useMemo(() => {
    return records.map((r) => {
      let distanceMi: number | undefined;
      if (userLocation && typeof r.lat === 'number' && typeof r.lng === 'number') {
        distanceMi = haversineMiles(userLocation, { lat: r.lat, lng: r.lng });
      }
      return recordToCourse(r, distanceMi);
    });
  }, [records, userLocation]);

  const api = useMemo<Api>(
    () => ({
      loading,
      error,
      records,
      recordsBySlug,
      indexBySlug,
      courses,
      userLocation,
      refresh: load,
      requestFullRecords,
      fullBySlug,
    }),
    [loading, error, records, recordsBySlug, indexBySlug, courses, userLocation, load, requestFullRecords, fullBySlug]
  );

  return <CourseCatalogContext.Provider value={api}>{children}</CourseCatalogContext.Provider>;
}

export function useCourseCatalog() {
  const ctx = useContext(CourseCatalogContext);
  if (!ctx) throw new Error('useCourseCatalog must be used within CourseCatalogProvider');
  return ctx;
}

/**
 * Full records for these courses, loading any that are missing.
 * `ready` is true once every requested course has its full record (or the
 * catalog is not in the index). Until then `bySlug` holds index rows, so
 * plain booking links still work.
 */
export function useFullRecords(slugs: readonly string[]) {
  const { recordsBySlug, fullBySlug, requestFullRecords, loading } = useCourseCatalog();
  const key = [...new Set(slugs.filter(Boolean))].sort().join(',');
  useEffect(() => {
    if (!loading && key) requestFullRecords(key.split(','));
  }, [key, loading, requestFullRecords]);
  return useMemo(() => {
    const wanted = key ? key.split(',') : [];
    const bySlug = new Map<string, CourseRecord>();
    let ready = !loading;
    for (const slug of wanted) {
      const full = fullBySlug.get(slug);
      const row = full ?? recordsBySlug.get(slug);
      if (row) bySlug.set(slug, row);
      if (!full && recordsBySlug.has(slug)) ready = false;
    }
    return { bySlug, ready };
  }, [key, fullBySlug, recordsBySlug, loading]);
}
