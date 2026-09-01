import type { FetchRadiusMi, SearchParams } from '../types';
import { DEFAULT_FETCH_RADIUS_MI } from './timesFetchScope';

const LAST_FIND_SEARCH_KEY = 'tt_last_find_search';

/** Remember the Find query so Alerts/Plan (and the Find tab) can return to it. */
export function rememberFinderSearch(search: string): void {
  const normalized = String(search || '').trim();
  const value = !normalized || normalized === '?' ? '' : normalized.startsWith('?') ? normalized : `?${normalized}`;
  try {
    sessionStorage.setItem(LAST_FIND_SEARCH_KEY, value);
  } catch {
    /* private mode / quota */
  }
}

/** Last Find query (`?date=…`) or null. */
export function rememberedFinderSearchParams(): URLSearchParams | null {
  try {
    const raw = sessionStorage.getItem(LAST_FIND_SEARCH_KEY) || '';
    if (!raw || raw === '?') return null;
    return new URLSearchParams(raw.startsWith('?') ? raw.slice(1) : raw);
  } catch {
    return null;
  }
}

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
