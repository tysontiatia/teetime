import type { FetchRadiusMi, SearchParams } from '../types';
import { DEFAULT_FETCH_RADIUS_MI } from './timesFetchScope';

/** Query string for `/feed?…` — preserves party size + regional scope. */
export function feedQueryString(params: {
  players: number;
  locationQuery?: string;
  fetchScope?: SearchParams['fetchScope'];
  radiusMi?: FetchRadiusMi;
}): string {
  const q = new URLSearchParams({ players: String(params.players) });
  const loc = params.locationQuery?.trim();
  if (loc) q.set('q', loc);
  if (params.fetchScope === 'all') q.set('scope', 'all');
  else if (params.radiusMi != null && params.radiusMi !== DEFAULT_FETCH_RADIUS_MI) {
    q.set('radius', String(params.radiusMi));
  }
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
  else if (params.radiusMi !== DEFAULT_FETCH_RADIUS_MI) q.set('radius', String(params.radiusMi));
  return q.toString();
}
