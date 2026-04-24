import type { SearchParams } from '../types';

/** Query string for `/course/:id?…` and “back to finder” — preserves filters + search box. */
export function courseDetailQueryString(params: SearchParams): string {
  const q = new URLSearchParams({
    date: params.date,
    players: String(params.players),
    holes: String(params.holes),
    tod: params.timeOfDay,
    sort: params.sortBy,
  });
  const loc = params.locationQuery.trim();
  if (loc) q.set('q', loc);
  return q.toString();
}
