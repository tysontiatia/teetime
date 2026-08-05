import { useEffect, useState } from 'react';
import type { WeatherPoint } from '../types';
import { fetchHourlyWeather } from '../lib/weather';

/**
 * Deferred hourly weather for a course/day. Shares the Open-Meteo cache in
 * `fetchHourlyWeather` so the finder grid does not stampede the network.
 */
export function useCourseHourlyWeather(
  lat: number | undefined,
  lng: number | undefined,
  dateYmd: string | undefined,
  enabled = true,
): WeatherPoint[] | null {
  const [points, setPoints] = useState<WeatherPoint[] | null>(null);

  useEffect(() => {
    if (!enabled || lat == null || lng == null || !dateYmd) {
      setPoints(null);
      return;
    }

    let cancelled = false;
    const run = () => {
      void (async () => {
        try {
          const data = await fetchHourlyWeather({ lat, lng, dateYmd });
          if (!cancelled) setPoints(data);
        } catch {
          if (!cancelled) setPoints(null);
        }
      })();
    };

    if (typeof requestIdleCallback !== 'undefined') {
      const id = requestIdleCallback(() => !cancelled && run(), { timeout: 2500 });
      return () => {
        cancelled = true;
        cancelIdleCallback(id);
      };
    }

    const t = window.setTimeout(() => !cancelled && run(), 400);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [enabled, lat, lng, dateYmd]);

  return points;
}
