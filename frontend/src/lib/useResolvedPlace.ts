import { useEffect, useMemo, useState } from 'react';
import type { Course } from '../types';
import { geocodePlaceQuery, shouldGeocodeQuery } from './placeGeocode';
import { resolvePlaceAnchor, type ResolvedPlaceAnchor } from './timesFetchScope';

/** Local zip/city tables first, then a one-time geocode so the radius search can run. */
export function useResolvedPlace(query: string, courses: Course[]): {
  place: ResolvedPlaceAnchor | null;
  pending: boolean;
} {
  const local = useMemo(() => {
    const q = query.trim();
    if (!q) return null;
    return resolvePlaceAnchor(q, courses);
  }, [query, courses]);

  const [remote, setRemote] = useState<ResolvedPlaceAnchor | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (!q || local || !shouldGeocodeQuery(q, courses)) {
      setRemote(null);
      setPending(false);
      return;
    }
    let cancelled = false;
    setRemote(null);
    setPending(true);
    geocodePlaceQuery(q).then((place) => {
      if (cancelled) return;
      setRemote(place);
      setPending(false);
    });
    return () => {
      cancelled = true;
    };
  }, [query, local, courses]);

  return useMemo(
    () => ({ place: local ?? remote, pending: pending && !local }),
    [local, remote, pending],
  );
}
