import type { Course } from '../types';
import { haversineMiles } from './geo';

/** Default radius for regional tee-time fetches (Wasatch Front / near-me). */
export const DEFAULT_FETCH_RADIUS_MI = 60;

/** Salt Lake City — fallback when GPS is unavailable. */
export const WASATCH_FRONT_ANCHOR = { lat: 40.7608, lng: -111.891 };

export type FetchAnchor = { lat: number; lng: number; source: 'gps' | 'default' };

export type TimesFetchScopeMode = 'nearby' | 'search' | 'statewide';

export type TimesFetchScope = {
  anchor: FetchAnchor;
  radiusMi: number;
  /** Worker-backed courses we should request tee times for. */
  fetchPool: Course[];
  /** All worker-backed courses in the catalog. */
  workerCourses: Course[];
  mode: TimesFetchScopeMode;
  /** Committed location search, when mode is `search`. */
  searchQuery: string;
  searchMatchCount: number;
  /** True when fetch pool is narrowed (not statewide). */
  regional: boolean;
  /** Worker courses outside the current fetch pool. */
  outOfScopeCount: number;
};

export function resolveFetchAnchor(userLocation: { lat: number; lng: number } | null): FetchAnchor {
  if (userLocation) return { ...userLocation, source: 'gps' };
  return { ...WASATCH_FRONT_ANCHOR, source: 'default' };
}

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function courseHasCoords(course: Course): course is Course & { lat: number; lng: number } {
  return typeof course.lat === 'number' && typeof course.lng === 'number';
}

export function distanceFromAnchor(course: Course, anchor: FetchAnchor): number | null {
  if (!courseHasCoords(course)) return null;
  return haversineMiles(anchor, { lat: course.lat, lng: course.lng });
}

export function filterCoursesWithinRadius(courses: Course[], anchor: FetchAnchor, radiusMi: number): Course[] {
  return courses.filter((c) => {
    const d = distanceFromAnchor(c, anchor);
    return d != null && d <= radiusMi;
  });
}

export function courseMatchesLocationQuery(course: Course, query: string): boolean {
  const q = normalizeSearchText(query);
  if (!q) return false;
  return [course.catalogName, course.name, course.city, course.area ?? ''].some((value) =>
    normalizeSearchText(value).includes(q)
  );
}

export function filterCoursesByLocationQuery(courses: Course[], query: string): Course[] {
  const q = query.trim();
  if (!q) return [];
  return courses.filter((c) => courseMatchesLocationQuery(c, q));
}

export function buildTimesFetchScope(
  workerCourses: Course[],
  userLocation: { lat: number; lng: number } | null,
  options: { fetchAllUtah?: boolean; radiusMi?: number; locationQuery?: string } = {}
): TimesFetchScope {
  const anchor = resolveFetchAnchor(userLocation);
  const radiusMi = options.radiusMi ?? DEFAULT_FETCH_RADIUS_MI;
  const fetchAllUtah = options.fetchAllUtah === true;
  const locationQuery = options.locationQuery?.trim() ?? '';

  if (fetchAllUtah) {
    return {
      anchor,
      radiusMi,
      fetchPool: workerCourses,
      workerCourses,
      mode: 'statewide',
      searchQuery: locationQuery,
      searchMatchCount: 0,
      regional: false,
      outOfScopeCount: 0,
    };
  }

  if (locationQuery) {
    const searchMatches = filterCoursesByLocationQuery(workerCourses, locationQuery);
    if (searchMatches.length > 0) {
      return {
        anchor,
        radiusMi,
        fetchPool: searchMatches,
        workerCourses,
        mode: 'search',
        searchQuery: locationQuery,
        searchMatchCount: searchMatches.length,
        regional: true,
        outOfScopeCount: Math.max(0, workerCourses.length - searchMatches.length),
      };
    }
  }

  const fetchPool = filterCoursesWithinRadius(workerCourses, anchor, radiusMi);
  return {
    anchor,
    radiusMi,
    fetchPool,
    workerCourses,
    mode: 'nearby',
    searchQuery: '',
    searchMatchCount: 0,
    regional: true,
    outOfScopeCount: Math.max(0, workerCourses.length - fetchPool.length),
  };
}
