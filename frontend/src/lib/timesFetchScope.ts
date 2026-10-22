import type { Course } from '../types';
import { haversineMiles } from './geo';
import { resolveZipQuery } from './zipSearch';
import { formatCityState } from './courseRecord';

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

/** Longest suffix first so "north carolina" wins over "carolina" and "washington dc" over "washington". */
const STATE_SUFFIXES: Array<[string, string]> = [
  ['district of columbia', 'DC'],
  ['washington dc', 'DC'],
  ['north carolina', 'NC'],
  ['north dakota', 'ND'],
  ['south carolina', 'SC'],
  ['south dakota', 'SD'],
  ['west virginia', 'WV'],
  ['new hampshire', 'NH'],
  ['new jersey', 'NJ'],
  ['new mexico', 'NM'],
  ['new york', 'NY'],
  ['rhode island', 'RI'],
  ['alabama', 'AL'],
  ['alaska', 'AK'],
  ['arizona', 'AZ'],
  ['arkansas', 'AR'],
  ['california', 'CA'],
  ['colorado', 'CO'],
  ['connecticut', 'CT'],
  ['delaware', 'DE'],
  ['florida', 'FL'],
  ['georgia', 'GA'],
  ['hawaii', 'HI'],
  ['idaho', 'ID'],
  ['illinois', 'IL'],
  ['indiana', 'IN'],
  ['iowa', 'IA'],
  ['kansas', 'KS'],
  ['kentucky', 'KY'],
  ['louisiana', 'LA'],
  ['maine', 'ME'],
  ['maryland', 'MD'],
  ['massachusetts', 'MA'],
  ['michigan', 'MI'],
  ['minnesota', 'MN'],
  ['mississippi', 'MS'],
  ['missouri', 'MO'],
  ['montana', 'MT'],
  ['nebraska', 'NE'],
  ['nevada', 'NV'],
  ['ohio', 'OH'],
  ['oklahoma', 'OK'],
  ['oregon', 'OR'],
  ['pennsylvania', 'PA'],
  ['tennessee', 'TN'],
  ['texas', 'TX'],
  ['utah', 'UT'],
  ['vermont', 'VT'],
  ['virginia', 'VA'],
  ['washington', 'WA'],
  ['wisconsin', 'WI'],
  ['wyoming', 'WY'],
  ['al', 'AL'],
  ['ak', 'AK'],
  ['az', 'AZ'],
  ['ar', 'AR'],
  ['ca', 'CA'],
  ['co', 'CO'],
  ['ct', 'CT'],
  ['dc', 'DC'],
  ['de', 'DE'],
  ['fl', 'FL'],
  ['ga', 'GA'],
  ['hi', 'HI'],
  ['id', 'ID'],
  ['il', 'IL'],
  ['in', 'IN'],
  ['ia', 'IA'],
  ['ks', 'KS'],
  ['ky', 'KY'],
  ['la', 'LA'],
  ['ma', 'MA'],
  ['md', 'MD'],
  ['me', 'ME'],
  ['mi', 'MI'],
  ['mn', 'MN'],
  ['mo', 'MO'],
  ['ms', 'MS'],
  ['mt', 'MT'],
  ['nc', 'NC'],
  ['nd', 'ND'],
  ['ne', 'NE'],
  ['nh', 'NH'],
  ['nj', 'NJ'],
  ['nm', 'NM'],
  ['nv', 'NV'],
  ['ny', 'NY'],
  ['oh', 'OH'],
  ['ok', 'OK'],
  ['or', 'OR'],
  ['pa', 'PA'],
  ['ri', 'RI'],
  ['sc', 'SC'],
  ['sd', 'SD'],
  ['tn', 'TN'],
  ['tx', 'TX'],
  ['ut', 'UT'],
  ['va', 'VA'],
  ['vt', 'VT'],
  ['wa', 'WA'],
  ['wi', 'WI'],
  ['wv', 'WV'],
  ['wy', 'WY'],
];

/** "Eagle ID" / "Bend, Oregon" → { city: "bend", state: "OR" }. */
export function parseCityStateQuery(query: string): { city: string; state: string | null } {
  const q = normalizeSearchText(query).replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  if (!q) return { city: '', state: null };
  for (const [suffix, code] of STATE_SUFFIXES) {
    if (q === suffix) return { city: q, state: null };
    const tail = ` ${suffix}`;
    if (!q.endsWith(tail)) continue;
    const city = q.slice(0, -tail.length).trim();
    if (!city) return { city: q, state: null };
    return { city, state: code };
  }
  return { city: q, state: null };
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
  const { city, state } = parseCityStateQuery(query);
  const cityState = formatCityState(course.city, course.state);
  const haystacks = [
    course.catalogName,
    course.name,
    course.city,
    cityState,
    course.state ?? '',
    course.area ?? '',
    course.address ?? '',
  ];
  if (state) {
    const courseState = String(course.state || '').toUpperCase();
    if (courseState && courseState !== state) return false;
    const cityQ = normalizeSearchText(city);
    return haystacks.some((value) => normalizeSearchText(value).includes(cityQ));
  }
  return haystacks.some((value) => normalizeSearchText(value).includes(q));
}

export function filterCoursesByLocationQuery(courses: Course[], query: string): Course[] {
  const q = query.trim();
  if (!q) return [];
  return courses.filter((c) => courseMatchesLocationQuery(c, q));
}

function isGenericCityLabel(city: string): boolean {
  const n = normalizeSearchText(city);
  return !n || n === 'utah' || n === 'idaho' || n === 'wy' || n === 'wyoming';
}

function centroidOf(courses: Array<Course & { lat: number; lng: number }>): { lat: number; lng: number } {
  const lat = courses.reduce((sum, c) => sum + c.lat, 0) / courses.length;
  const lng = courses.reduce((sum, c) => sum + c.lng, 0) / courses.length;
  return { lat, lng };
}

/**
 * Resolve a free-text query to a city centroid from catalog courses
 * (e.g. "Orem" → average lat/lng of Orem courses). Used for near-city search.
 * Same city in multiple states (Eagle UT vs Eagle ID) is not averaged together.
 */
export function resolveCityQuery(query: string, courses: Course[]): ResolvedPlaceAnchor | null {
  const raw = normalizeSearchText(query);
  if (raw.length < 3) return null;
  const { city: cityQ, state: stateQ } = parseCityStateQuery(query);
  const q = cityQ || raw;
  if (q.length < 3) return null;

  const cityCourses = courses.filter((c) => {
    if (!c.city || isGenericCityLabel(c.city)) return false;
    if (stateQ && String(c.state || '').toUpperCase() !== stateQ) return false;
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

  // Ambiguous city name across states and no state in the query → text search instead
  // of averaging Eagle UT + Eagle ID into a useless midpoint.
  if (!stateQ) {
    const states = new Set(
      withCoords.map((c) => String(c.state || '').toUpperCase()).filter(Boolean),
    );
    if (states.size > 1) return null;
  }

  const anchor = centroidOf(withCoords);
  const label = formatCityState(matched[0]!.city, stateQ || matched[0]!.state);
  return {
    kind: 'city',
    label,
    anchor,
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

/** True when a course belongs to the resolved city / ZIP (exact city, or address contains ZIP). */
export function courseMatchesResolvedPlace(course: Course, place: ResolvedPlaceAnchor): boolean {
  if (place.kind === 'city') {
    const { city, state } = parseCityStateQuery(place.label);
    const q = normalizeSearchText(city || place.label);
    if (!q) return false;
    const courseCity = normalizeSearchText(course.city);
    if (courseCity !== q) return false;
    if (state) {
      const courseState = String(course.state || '').toUpperCase();
      if (courseState && courseState !== state) return false;
    }
    return true;
  }
  const zip = normalizeSearchText(place.label);
  if (!zip) return false;
  return normalizeSearchText(course.address || '').includes(zip);
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
    /** Anchor already resolved, including a geocoded zip or city outside the local tables. */
    resolvedPlace?: ResolvedPlaceAnchor | null;
    /** A zip or city is still being located. Don't fall back to the GPS area. */
    placePending?: boolean;
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
    const place =
      options.resolvedPlace !== undefined
        ? options.resolvedPlace
        : resolvePlaceAnchor(locationQuery, placeCourses);
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

    if (options.placePending) {
      return {
        anchor,
        radiusMi,
        fetchPool: [],
        workerCourses,
        mode: 'search',
        searchQuery: locationQuery,
        searchMatchCount: 0,
        regional: true,
        outOfScopeCount: workerCourses.length,
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
