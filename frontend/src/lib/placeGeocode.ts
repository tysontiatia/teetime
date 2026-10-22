import type { Course } from '../types';
import { extractZip } from './zipSearch';
import { parseCityStateQuery, resolvePlaceAnchor, type ResolvedPlaceAnchor } from './timesFetchScope';

const cache = new Map<string, ResolvedPlaceAnchor | null>();

function normalize(value: string): string {
  return value.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
}

/** A committed search that should become a map point when the local tables don't know it. */
export function shouldGeocodeQuery(query: string, courses: Course[]): boolean {
  const trimmed = query.trim();
  if (!trimmed || resolvePlaceAnchor(trimmed, courses)) return false;
  const zip = extractZip(trimmed);
  if (zip && trimmed.replace(/\D/g, '') === zip) return true;
  if (trimmed.length < 3 || /\d/.test(trimmed)) return false;
  const q = normalize(trimmed);
  const exactCourse = courses.some((course) => {
    const name = normalize(course.name);
    const short = normalize(course.catalogName || course.name);
    return name === q || short === q;
  });
  if (exactCourse) return false;
  return /^[a-z][a-z\s,.'-]*$/i.test(trimmed);
}

async function geocodeZip(zip: string): Promise<ResolvedPlaceAnchor | null> {
  const res = await fetch(`https://api.zippopotam.us/us/${zip}`);
  if (!res.ok) return null;
  const data = await res.json();
  const place = data?.places?.[0];
  const lat = Number(place?.latitude);
  const lng = Number(place?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { kind: 'zip', label: zip, anchor: { lat, lng } };
}

function stateCodeOf(name: string): string | null {
  return parseCityStateQuery(`place ${name}`).state;
}

async function geocodeCity(query: string): Promise<ResolvedPlaceAnchor | null> {
  const url = new URL('https://photon.komoot.io/api/');
  url.searchParams.set('q', query);
  url.searchParams.set('limit', '5');
  url.searchParams.set('lang', 'en');
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const features = Array.isArray(data?.features) ? data.features : [];
  const parsed = parseCityStateQuery(query);
  const inCountry = features.filter(
    (feature: { properties?: { countrycode?: string } }) =>
      String(feature?.properties?.countrycode || '').toUpperCase() === 'US',
  );
  const hit =
    (parsed.state
      ? inCountry.find(
          (feature: { properties?: { state?: string } }) => stateCodeOf(feature?.properties?.state || '') === parsed.state,
        )
      : null) || inCountry[0];
  const coords = hit?.geometry?.coordinates;
  const lng = Number(coords?.[0]);
  const lat = Number(coords?.[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const name = String(hit?.properties?.name || parsed.city || query).trim();
  const label = parsed.state ? `${name}, ${parsed.state}` : name;
  return { kind: 'city', label, anchor: { lat, lng } };
}

/** Locate a US zip or city that isn't in the bundled centroids or the catalog. */
export async function geocodePlaceQuery(query: string): Promise<ResolvedPlaceAnchor | null> {
  const key = normalize(query);
  if (!key) return null;
  if (cache.has(key)) return cache.get(key) ?? null;
  const zip = extractZip(query);
  const onlyZip = Boolean(zip && query.replace(/\D/g, '') === zip);
  let place: ResolvedPlaceAnchor | null;
  try {
    place = onlyZip && zip ? await geocodeZip(zip) : await geocodeCity(query.trim());
  } catch {
    place = null;
  }
  cache.set(key, place);
  return place;
}
