import type { Course } from '../types';
import { haversineMiles } from './geo';
import { courseHasCoords } from './timesFetchScope';

/** GPS / search is “away” when the nearest live course is farther than this. */
export const OUT_OF_MARKET_MI = 100;

export type UsRegion = { code: string; name: string };

type StateBox = UsRegion & {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
};

/** Rough bounding boxes — good enough to name a visitor’s state, not for legal borders. */
const STATE_BOXES: StateBox[] = [
  { code: 'AL', name: 'Alabama', minLat: 30.22, maxLat: 35.01, minLng: -88.47, maxLng: -84.89 },
  { code: 'AK', name: 'Alaska', minLat: 51.22, maxLat: 71.4, minLng: -179.15, maxLng: -129.98 },
  { code: 'AZ', name: 'Arizona', minLat: 31.33, maxLat: 37.0, minLng: -114.82, maxLng: -109.04 },
  { code: 'AR', name: 'Arkansas', minLat: 33.0, maxLat: 36.5, minLng: -94.62, maxLng: -89.64 },
  { code: 'CA', name: 'California', minLat: 32.53, maxLat: 42.01, minLng: -124.41, maxLng: -114.13 },
  { code: 'CO', name: 'Colorado', minLat: 36.99, maxLat: 41.0, minLng: -109.06, maxLng: -102.04 },
  { code: 'CT', name: 'Connecticut', minLat: 40.98, maxLat: 42.05, minLng: -73.73, maxLng: -71.79 },
  { code: 'DE', name: 'Delaware', minLat: 38.45, maxLat: 39.84, minLng: -75.79, maxLng: -75.05 },
  { code: 'FL', name: 'Florida', minLat: 24.52, maxLat: 31.0, minLng: -87.63, maxLng: -80.03 },
  { code: 'GA', name: 'Georgia', minLat: 30.36, maxLat: 35.0, minLng: -85.61, maxLng: -80.84 },
  { code: 'HI', name: 'Hawaii', minLat: 18.91, maxLat: 22.24, minLng: -160.25, maxLng: -154.81 },
  { code: 'ID', name: 'Idaho', minLat: 41.99, maxLat: 49.0, minLng: -117.24, maxLng: -111.04 },
  { code: 'IL', name: 'Illinois', minLat: 36.97, maxLat: 42.51, minLng: -91.51, maxLng: -87.5 },
  { code: 'IN', name: 'Indiana', minLat: 37.77, maxLat: 41.76, minLng: -88.1, maxLng: -84.78 },
  { code: 'IA', name: 'Iowa', minLat: 40.38, maxLat: 43.5, minLng: -96.64, maxLng: -90.14 },
  { code: 'KS', name: 'Kansas', minLat: 36.99, maxLat: 40.0, minLng: -102.05, maxLng: -94.59 },
  { code: 'KY', name: 'Kentucky', minLat: 36.5, maxLat: 39.15, minLng: -89.57, maxLng: -81.96 },
  { code: 'LA', name: 'Louisiana', minLat: 28.93, maxLat: 33.02, minLng: -94.04, maxLng: -88.82 },
  { code: 'ME', name: 'Maine', minLat: 43.06, maxLat: 47.46, minLng: -71.08, maxLng: -66.95 },
  { code: 'MD', name: 'Maryland', minLat: 37.91, maxLat: 39.72, minLng: -79.49, maxLng: -75.05 },
  { code: 'MA', name: 'Massachusetts', minLat: 41.24, maxLat: 42.89, minLng: -73.51, maxLng: -69.93 },
  { code: 'MI', name: 'Michigan', minLat: 41.7, maxLat: 48.17, minLng: -90.42, maxLng: -82.41 },
  { code: 'MN', name: 'Minnesota', minLat: 43.5, maxLat: 49.38, minLng: -97.24, maxLng: -89.49 },
  { code: 'MS', name: 'Mississippi', minLat: 30.17, maxLat: 35.0, minLng: -91.66, maxLng: -88.1 },
  { code: 'MO', name: 'Missouri', minLat: 35.99, maxLat: 40.61, minLng: -95.77, maxLng: -89.1 },
  { code: 'MT', name: 'Montana', minLat: 44.36, maxLat: 49.0, minLng: -116.05, maxLng: -104.04 },
  { code: 'NE', name: 'Nebraska', minLat: 39.99, maxLat: 43.0, minLng: -104.05, maxLng: -95.31 },
  { code: 'NV', name: 'Nevada', minLat: 35.0, maxLat: 42.0, minLng: -120.01, maxLng: -114.04 },
  { code: 'NH', name: 'New Hampshire', minLat: 42.7, maxLat: 45.31, minLng: -72.56, maxLng: -70.7 },
  { code: 'NJ', name: 'New Jersey', minLat: 38.93, maxLat: 41.36, minLng: -75.56, maxLng: -73.89 },
  { code: 'NM', name: 'New Mexico', minLat: 31.33, maxLat: 37.0, minLng: -109.05, maxLng: -103.0 },
  { code: 'NY', name: 'New York', minLat: 40.5, maxLat: 45.02, minLng: -79.76, maxLng: -71.86 },
  { code: 'NC', name: 'North Carolina', minLat: 33.84, maxLat: 36.59, minLng: -84.32, maxLng: -75.46 },
  { code: 'ND', name: 'North Dakota', minLat: 45.94, maxLat: 49.0, minLng: -104.05, maxLng: -96.55 },
  { code: 'OH', name: 'Ohio', minLat: 38.4, maxLat: 41.98, minLng: -84.82, maxLng: -80.52 },
  { code: 'OK', name: 'Oklahoma', minLat: 33.62, maxLat: 37.0, minLng: -103.0, maxLng: -94.43 },
  { code: 'OR', name: 'Oregon', minLat: 41.99, maxLat: 46.27, minLng: -124.57, maxLng: -116.46 },
  { code: 'PA', name: 'Pennsylvania', minLat: 39.72, maxLat: 42.27, minLng: -80.52, maxLng: -74.69 },
  { code: 'RI', name: 'Rhode Island', minLat: 41.15, maxLat: 42.02, minLng: -71.86, maxLng: -71.12 },
  { code: 'SC', name: 'South Carolina', minLat: 32.03, maxLat: 35.22, minLng: -83.35, maxLng: -78.54 },
  { code: 'SD', name: 'South Dakota', minLat: 42.48, maxLat: 45.94, minLng: -104.06, maxLng: -96.44 },
  { code: 'TN', name: 'Tennessee', minLat: 34.98, maxLat: 36.68, minLng: -90.31, maxLng: -81.65 },
  { code: 'TX', name: 'Texas', minLat: 25.84, maxLat: 36.5, minLng: -106.65, maxLng: -93.51 },
  { code: 'UT', name: 'Utah', minLat: 36.99, maxLat: 42.0, minLng: -114.05, maxLng: -109.04 },
  { code: 'VT', name: 'Vermont', minLat: 42.73, maxLat: 45.02, minLng: -73.44, maxLng: -71.46 },
  { code: 'VA', name: 'Virginia', minLat: 36.54, maxLat: 39.47, minLng: -83.68, maxLng: -75.24 },
  { code: 'WA', name: 'Washington', minLat: 45.54, maxLat: 49.0, minLng: -124.76, maxLng: -116.92 },
  { code: 'WV', name: 'West Virginia', minLat: 37.2, maxLat: 40.64, minLng: -82.64, maxLng: -77.72 },
  { code: 'WI', name: 'Wisconsin', minLat: 42.49, maxLat: 47.08, minLng: -92.89, maxLng: -86.25 },
  { code: 'WY', name: 'Wyoming', minLat: 40.99, maxLat: 45.01, minLng: -111.05, maxLng: -104.05 },
  { code: 'DC', name: 'Washington, D.C.', minLat: 38.79, maxLat: 39.0, minLng: -77.12, maxLng: -76.91 },
];

const REGION_BY_KEY = new Map<string, UsRegion>();
for (const s of STATE_BOXES) {
  REGION_BY_KEY.set(s.code.toLowerCase(), { code: s.code, name: s.name });
  REGION_BY_KEY.set(s.name.toLowerCase(), { code: s.code, name: s.name });
}

/** Well-known cities → state. Ambiguous names (Portland, Springfield) are omitted on purpose. */
const CITY_TO_STATE: Record<string, string> = {
  denver: 'CO',
  boulder: 'CO',
  aspen: 'CO',
  vail: 'CO',
  breckenridge: 'CO',
  durango: 'CO',
  telluride: 'CO',
  pueblo: 'CO',
  loveland: 'CO',
  greeley: 'CO',
  longmont: 'CO',
  broomfield: 'CO',
  littleton: 'CO',
  lakewood: 'CO',
  arvada: 'CO',
  thornton: 'CO',
  westminster: 'CO',
  centennial: 'CO',
  englewood: 'CO',
  golden: 'CO',
  'colorado springs': 'CO',
  'fort collins': 'CO',
  'grand junction': 'CO',
  'steamboat springs': 'CO',
  'castle rock': 'CO',
  'highlands ranch': 'CO',
  'cherry creek': 'CO',
  phoenix: 'AZ',
  scottsdale: 'AZ',
  tucson: 'AZ',
  mesa: 'AZ',
  tempe: 'AZ',
  flagstaff: 'AZ',
  sedona: 'AZ',
  'las vegas': 'NV',
  vegas: 'NV',
  henderson: 'NV',
  reno: 'NV',
  albuquerque: 'NM',
  'santa fe': 'NM',
  taos: 'NM',
  cheyenne: 'WY',
  jackson: 'WY',
  'jackson hole': 'WY',
  casper: 'WY',
  bozeman: 'MT',
  billings: 'MT',
  missoula: 'MT',
  'los angeles': 'CA',
  'san diego': 'CA',
  'san francisco': 'CA',
  'san jose': 'CA',
  oakland: 'CA',
  sacramento: 'CA',
  'palm springs': 'CA',
  'orange county': 'CA',
  seattle: 'WA',
  'new york': 'NY',
  brooklyn: 'NY',
  manhattan: 'NY',
  chicago: 'IL',
  austin: 'TX',
  dallas: 'TX',
  houston: 'TX',
  'san antonio': 'TX',
  miami: 'FL',
  orlando: 'FL',
  tampa: 'FL',
  atlanta: 'GA',
  nashville: 'TN',
  'washington dc': 'DC',
  boston: 'MA',
  philadelphia: 'PA',
  detroit: 'MI',
  minneapolis: 'MN',
  'kansas city': 'MO',
  'st louis': 'MO',
  'new orleans': 'LA',
  charlotte: 'NC',
  raleigh: 'NC',
};

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function catalogStateCodes(courses: Array<{ state?: string | null }>): Set<string> {
  const out = new Set<string>();
  for (const c of courses) {
    const st = String(c.state || '').trim().toUpperCase();
    if (st.length === 2) out.add(st);
  }
  if (out.size === 0) out.add('UT');
  return out;
}

/** States with enough catalog to mention in copy (drops 1-off imports). */
const LIVE_MARKET_MIN_COURSES = 5;

export function formatLiveMarkets(courses: Array<{ state?: string | null }>): string {
  const counts = new Map<string, number>();
  for (const c of courses) {
    const st = String(c.state || '').trim().toUpperCase();
    if (st.length === 2) counts.set(st, (counts.get(st) || 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const primary = ranked.filter(([, n]) => n >= LIVE_MARKET_MIN_COURSES).map(([code]) => code);
  const codes = primary.length > 0 ? primary : ranked.map(([code]) => code);
  const names = codes
    .map((code) => REGION_BY_KEY.get(code.toLowerCase())?.name)
    .filter((n): n is string => Boolean(n));
  const unique = [...new Set(names)];
  if (unique.length === 0) return 'Utah';
  if (unique.length === 1) return unique[0]!;
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`;
  return `${unique.slice(0, -1).join(', ')}, and ${unique[unique.length - 1]}`;
}

export function nearestCourseMiles(
  point: { lat: number; lng: number },
  courses: Course[],
): number | null {
  let best: number | null = null;
  for (const c of courses) {
    if (!courseHasCoords(c)) continue;
    const d = haversineMiles(point, { lat: c.lat, lng: c.lng });
    if (best == null || d < best) best = d;
  }
  return best;
}

export function regionFromLatLng(lat: number, lng: number): UsRegion | null {
  const hits = STATE_BOXES.filter(
    (s) => lat >= s.minLat && lat <= s.maxLat && lng >= s.minLng && lng <= s.maxLng,
  );
  if (hits.length === 0) return null;
  hits.sort(
    (a, b) => (a.maxLat - a.minLat) * (a.maxLng - a.minLng) - (b.maxLat - b.minLat) * (b.maxLng - b.minLng),
  );
  const s = hits[0]!;
  return { code: s.code, name: s.name };
}

export function regionFromQuery(query: string): UsRegion | null {
  const q = normalize(query);
  if (!q) return null;
  const exact = REGION_BY_KEY.get(q);
  if (exact) return exact;
  const cityCode = CITY_TO_STATE[q];
  if (cityCode) {
    const region = REGION_BY_KEY.get(cityCode.toLowerCase());
    if (region) return region;
  }
  const m = q.match(/^(.*?)(?:[,\s]+)([a-z]{2}|[a-z ]+)$/);
  if (!m) return null;
  const tail = REGION_BY_KEY.get(normalize(m[2]!));
  if (tail) return tail;
  const cityWithState = CITY_TO_STATE[normalize(m[1]!)];
  if (!cityWithState) return null;
  return REGION_BY_KEY.get(cityWithState.toLowerCase()) ?? null;
}

export type ServiceAreaStatus = {
  outside: boolean;
  visitorRegion: UsRegion | null;
  liveMarkets: string;
};

export function resolveServiceArea(input: {
  courses: Course[];
  userLocation: { lat: number; lng: number } | null;
  locationQuery: string;
  fetchAll: boolean;
  /** Catalog courses that actually matched the typed query (not the GPS/nearby fallback pool). */
  catalogHitsForQuery: number;
}): ServiceAreaStatus {
  const liveCodes = catalogStateCodes(input.courses);
  const liveMarkets = formatLiveMarkets(input.courses);
  const empty: ServiceAreaStatus = { outside: false, visitorRegion: null, liveMarkets };

  if (input.fetchAll) return empty;

  const fromQuery = regionFromQuery(input.locationQuery);
  if (fromQuery && !liveCodes.has(fromQuery.code) && input.catalogHitsForQuery === 0) {
    return { outside: true, visitorRegion: fromQuery, liveMarkets };
  }

  const loc = input.userLocation;
  if (!loc) {
    if (input.locationQuery.trim() && input.catalogHitsForQuery === 0 && fromQuery) {
      return { outside: true, visitorRegion: fromQuery, liveMarkets };
    }
    return empty;
  }

  const nearest = nearestCourseMiles(loc, input.courses);
  if (nearest == null || nearest <= OUT_OF_MARKET_MI) return empty;

  const gpsRegion = regionFromLatLng(loc.lat, loc.lng);
  if (gpsRegion && liveCodes.has(gpsRegion.code)) return empty;

  return {
    outside: true,
    visitorRegion: fromQuery || gpsRegion,
    liveMarkets,
  };
}
