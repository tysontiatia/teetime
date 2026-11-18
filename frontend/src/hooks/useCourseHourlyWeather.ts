import { useEffect, useRef, useState } from 'react';
import type { WeatherPoint } from '../types';
import { fetchHourlyWeather, readHourlyWeatherCache, subscribeWeatherRefresh } from '../lib/weather';

/** Bumps when a pull-to-refresh drops the weather cache. */
export function useWeatherRefreshEpoch(): number {
  const [epoch, setEpoch] = useState(0);
  useEffect(() => subscribeWeatherRefresh(() => setEpoch((n) => n + 1)), []);
  return epoch;
}

/**
 * Hourly weather for a course/day. Starts immediately (a shared queue paces
 * Open-Meteo) so a busy PWA thread cannot skip the request the way
 * requestIdleCallback did.
 */
export function useCourseHourlyWeather(
  lat: number | undefined,
  lng: number | undefined,
  dateYmd: string | undefined,
  enabled = true,
): { points: WeatherPoint[] | null; pending: boolean } {
  const epoch = useWeatherRefreshEpoch();
  const ready = enabled && lat != null && lng != null && Boolean(dateYmd);
  const cached = ready && dateYmd ? readHourlyWeatherCache(lat, lng, dateYmd) : null;
  const [points, setPoints] = useState<WeatherPoint[] | null>(cached);
  const [pending, setPending] = useState(ready && !cached);
  const pointsRef = useRef(points);
  useEffect(() => {
    pointsRef.current = points;
  }, [points]);

  useEffect(() => {
    if (!enabled || lat == null || lng == null || !dateYmd) {
      setPoints(null);
      setPending(false);
      return;
    }

    const hit = readHourlyWeatherCache(lat, lng, dateYmd);
    if (hit) {
      setPoints(hit);
      setPending(false);
      return;
    }

    let cancelled = false;
    setPending(pointsRef.current == null);
    void fetchHourlyWeather({ lat, lng, dateYmd })
      .then((data) => {
        if (cancelled) return;
        setPoints(data);
        setPending(false);
      })
      .catch(() => {
        if (cancelled) return;
        setPending(false);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, lat, lng, dateYmd, epoch]);

  return { points, pending };
}
