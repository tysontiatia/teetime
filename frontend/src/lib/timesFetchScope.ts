import type { Course } from '../types';
import { haversineMiles } from './geo';
import { resolveZipQuery } from './zipSearch';

/** Default radius for regional tee-time fetches (near me, city, ZIP). */
export const DEFAULT_FETCH_RADIUS_MI = 25;

export const FETCH_RADIUS_OPTIONS_MI = [15, 25, 50] as const;

export type FetchRadiusOption = (typeof FETCH_RADIUS_OPTIONS_MI)[number];

export function parseFetchRadiusMi(raw: string | null | undefined): FetchRadiusOption {
  const n = Number(raw);
  if (n === 15 || n === 50) return n;
  return DEFAULT_FETCH_RADIUS_MI;
}

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

export type ResolvedPlaceAnchor = {
  kind: 'zip' | 'city';
  label: string;
  anchor: { lat: number; lng: number };
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
  return [course.catalogName, course.name, course.city, course.area ?? '', course.address ?? ''].some(
    (value) => normalizeSearchText(value).includes(q)
  );
}

export function filterCoursesByLocationQuery(courses: Course[], query: string): Course[] {
  const q = query.trim();
  if (!q) return [];
  return courses.filter((c) => courseMatchesLocationQuery(c, q));
}

function isGenericCityLabel(city: string): boolean {
  const n = normalizeSearchText(city);
  return !n || n === 'utah' || n === 'wy' || n === 'wyoming';
}

/**
 * Resolve a free-text query to a city centroid from catalog courses
 * (e.g. "Orem" → average lat/lng of Orem courses). Used for near-city search.
 */
export function resolveCityQuery(query: string, courses: Course[]): ResolvedPlaceAnchor | null {
  const q = normalizeSearchText(query);
  if (q.length < 3) return null;

  const cityCourses = courses.filter((c) => {
    if (!c.city || isGenericCityLabel(c.city)) return false;
    const city = normalizeSearchText(c.city);
    return city === q || city.startsWith(`${q} `) || city.startsWith(q);
  });

  // Prefer exact city equality when available (avoids "Le"→Lehi noise; q is ≥3).
  const exact = cityCourses.filter((c) => normalizeSearchText(c.city) === q);
  const matched = exact.length > 0 ? exact : cityCourses;
  const withCoords = matched.filter(courseHasCoords);
  if (withCoords.length === 0) return null;

  // If the query is clearly a course title (not a place), keep text search.
  const nameOnlyHits = courses.filter((c) => {
    const name = normalizeSearchText(c.name);
    const short = normalizeSearchText(c.catalogName || c.name);
    return name === q || short === q || name.startsWith(`${q} `);
  });
  const cityLabels = new Set(matched.map((c) => normalizeSearchText(c.city)));
  if (nameOnlyHits.length > 0 && !cityLabels.has(q) && exact.length === 0) {
    return null;
  }

  const lat = withCoords.reduce((sum, c) => sum + c.lat, 0) / withCoords.length;
  const lng = withCoords.reduce((sum, c) => sum + c.lng, 0) / withCoords.length;
  return {
    kind: 'city',
    label: matched[0]!.city,
    anchor: { lat, lng },
  };
}

/** ZIP centroid (Utah file or catalog fallback) or city centroid from the catalog. */
export function resolvePlaceAnchor(query: string, courses: Course[]): ResolvedPlaceAnchor | null {
  const zip = resolveZipQuery(query, courses);
  if (zip) {
    return { kind: 'zip', label: zip.zip, anchor: zip.anchor };
  }
  return resolveCityQuery(query, courses);
}

export function buildTimesFetchScope(
  workerCourses: Course[],
  userLocation: { lat: number; lng: number } | null,
  options: {
    fetchAllUtah?: boolean;
    radiusMi?: number;
    locationQuery?: string;
    /** Catalog used to resolve city/ZIP anchors (defaults to workerCourses). */
    placeCourses?: Course[];
  } = {}
): TimesFetchScope {
  const anchor = resolveFetchAnchor(userLocation);
  const radiusMi = options.radiusMi ?? DEFAULT_FETCH_RADIUS_MI;
  const fetchAllUtah = options.fetchAllUtah === true;
  const locationQuery = options.locationQuery?.trim() ?? '';
  const placeCourses = options.placeCourses ?? workerCourses;

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
    // ZIP or city: fetch courses near that place instead of text-matching only.
    const place = resolvePlaceAnchor(locationQuery, placeCourses);
    if (place) {
      const placeAnchor: FetchAnchor = { ...place.anchor, source: 'default' };
      const nearPlace = filterCoursesWithinRadius(workerCourses, placeAnchor, radiusMi);
      return {
        anchor: placeAnchor,
        radiusMi,
        fetchPool: nearPlace,
        workerCourses,
        mode: 'search',
        searchQuery: locationQuery,
        searchMatchCount: nearPlace.length,
        regional: true,
        outOfScopeCount: Math.max(0, workerCourses.length - nearPlace.length),
      };
    }

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
