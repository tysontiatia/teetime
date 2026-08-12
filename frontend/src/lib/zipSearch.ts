import centroids from '../data/utahZipCentroids.json';

const ZIP_CENTROIDS = centroids as unknown as Record<string, [number, number]>;

/** Extract a 5-digit ZIP from a free-text location query, if present. */
export function extractZip(query: string): string | null {
  const m = query.trim().match(/\b(\d{5})\b/);
  return m ? m[1] : null;
}

/** Look up the centroid (lat/lng) for a known Utah ZIP code. */
export function lookupZipCentroid(zip: string): { lat: number; lng: number } | null {
  const c = ZIP_CENTROIDS[zip];
  return c ? { lat: c[0], lng: c[1] } : null;
}

/** Extract ZIP from a US street address when present. */
export function zipFromAddress(address?: string): string | null {
  if (!address) return null;
  const m = address.match(/\b(\d{5})(?:-\d{4})?\b/);
  return m ? m[1]! : null;
}

export type ResolvedZip = { zip: string; anchor: { lat: number; lng: number } };

type CourseZipAnchor = {
  address?: string;
  lat?: number;
  lng?: number;
};

/**
 * Mean lat/lng of catalog courses whose address contains this ZIP.
 * Used when the ZIP is outside the Utah centroids file (other states).
 */
export function lookupZipFromCatalog(
  zip: string,
  courses: CourseZipAnchor[],
): { lat: number; lng: number } | null {
  const hits = courses.filter((c) => {
    if (c.lat == null || c.lng == null || !Number.isFinite(c.lat) || !Number.isFinite(c.lng)) {
      return false;
    }
    return zipFromAddress(c.address) === zip;
  });
  if (!hits.length) return null;
  const lat = hits.reduce((sum, c) => sum + (c.lat as number), 0) / hits.length;
  const lng = hits.reduce((sum, c) => sum + (c.lng as number), 0) / hits.length;
  return { lat, lng };
}

/**
 * Resolve a location query to a ZIP anchor: Utah centroids first, then catalog
 * courses with that ZIP in their address (enables non-Utah ZIPs once catalogued).
 */
export function resolveZipQuery(
  query: string,
  courses?: CourseZipAnchor[],
): ResolvedZip | null {
  const zip = extractZip(query);
  if (!zip) return null;
  const fromUtah = lookupZipCentroid(zip);
  if (fromUtah) return { zip, anchor: fromUtah };
  if (courses?.length) {
    const fromCatalog = lookupZipFromCatalog(zip, courses);
    if (fromCatalog) return { zip, anchor: fromCatalog };
  }
  return null;
}
