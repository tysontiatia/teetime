import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Course } from '../types';
import type { CourseRecord } from '../lib/courseRecord';
import { recordToCourse } from '../lib/courseRecord';
import { slugFromCourseName } from '../lib/courseSlug';
import { haversineMiles } from '../lib/geo';

type Api = {
  loading: boolean;
  error: string | null;
  /** Full JSON rows */
  records: CourseRecord[];
  recordsBySlug: Map<string, CourseRecord>;
  /** UI courses with optional distance when geolocation is available */
  courses: Course[];
  userLocation: { lat: number; lng: number } | null;
  refresh: () => void;
};

const CourseCatalogContext = createContext<Api | null>(null);

function coursesJsonUrl(): string {
  if (import.meta.env.DEV) {
    return '/courses.json';
  }
  return `${window.location.origin}/courses.json`;
}

export function CourseCatalogProvider({ children }: { children: React.ReactNode }) {
  const [records, setRecords] = useState<CourseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(coursesJsonUrl(), { credentials: 'omit' });
      if (!res.ok) throw new Error(`courses.json HTTP ${res.status}`);
      const data = (await res.json()) as CourseRecord[];
      if (!Array.isArray(data)) throw new Error('Invalid courses.json');
      setRecords(data);
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

  const recordsBySlug = useMemo(() => {
    const m = new Map<string, CourseRecord>();
    for (const r of records) {
      m.set(slugFromCourseName(r.name), r);
    }
    return m;
  }, [records]);

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
      courses,
      userLocation,
      refresh: load,
    }),
    [loading, error, records, recordsBySlug, courses, userLocation, load]
  );

  return <CourseCatalogContext.Provider value={api}>{children}</CourseCatalogContext.Provider>;
}

export function useCourseCatalog() {
  const ctx = useContext(CourseCatalogContext);
  if (!ctx) throw new Error('useCourseCatalog must be used within CourseCatalogProvider');
  return ctx;
}
