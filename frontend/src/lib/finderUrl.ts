import type { SearchParams } from '../types';

/** Query string for `/feed?…` — preserves party size + regional scope. */
export function feedQueryString(params: {
  players: number;
  locationQuery?: string;
  fetchScope?: SearchParams['fetchScope'];
}): string {
  const q = new URLSearchParams({ players: String(params.players) });
  const loc = params.locationQuery?.trim();
  if (loc) q.set('q', loc);
  if (params.fetchScope === 'all') q.set('scope', 'all');
  return q.toString();
}

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
  if (params.fetchScope === 'all') q.set('scope', 'all');
  return q.toString();
}
