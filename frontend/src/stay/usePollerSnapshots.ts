import { useEffect, useState } from 'react';
import { fetchPollerSnapshots } from '../lib/workerTimes';
import type { Course, TeeTime } from '../types';

/** Snapshot sheets for home rows. One read per date and hole size, with no vendor fill. */
export function usePollerSnapshots(courses: Course[], dates: string[], enabled: boolean) {
  const [sheets, setSheets] = useState<Record<string, Map<string, TeeTime[]>>>({});
  const [loading, setLoading] = useState(enabled);
  const key = `${enabled ? dates.join(',') : ''}::${enabled ? courses.map((course) => course.id).join(',') : ''}`;

  useEffect(() => {
    if (!enabled || courses.length === 0 || dates.length === 0) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const nine = courses.filter((course) => course.holes === 9).map((course) => course.id);
    const eighteen = courses.filter((course) => course.holes !== 9).map((course) => course.id);
    void (async () => {
      try {
        const next: Record<string, Map<string, TeeTime[]>> = {};
        await Promise.all(
          dates.map(async (date) => {
            const [short, full] = await Promise.all([
              nine.length > 0 ? fetchPollerSnapshots(nine, date, 9) : Promise.resolve(new Map<string, TeeTime[]>()),
              eighteen.length > 0 ? fetchPollerSnapshots(eighteen, date, 18) : Promise.resolve(new Map<string, TeeTime[]>()),
            ]);
            const merged = new Map(short);
            for (const [slug, times] of full) merged.set(slug, times);
            next[date] = merged;
          }),
        );
        if (cancelled) return;
        setSheets((prev) => ({ ...prev, ...next }));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // key captures the course list and dates for this fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { sheets, loading };
}
