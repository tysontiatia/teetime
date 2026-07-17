import centroids from '../data/utahZipCentroids.json';

const ZIP_CENTROIDS = centroids as unknown as Record<string, [number, number]>;

/** Extract a 5-digit ZIP from a free-text location query, if present. */
export function extractZip(query: string): string | null {
  const m = query.trim().match(/\b(\d{5})\b/);
  return m ? m[1] : null;
}

/** Look up the centroid (lat/lng) for a Utah ZIP code. */
export function lookupZipCentroid(zip: string): { lat: number; lng: number } | null {
  const c = ZIP_CENTROIDS[zip];
  return c ? { lat: c[0], lng: c[1] } : null;
}

export type ResolvedZip = { zip: string; anchor: { lat: number; lng: number } };

/**
 * Resolve a location query to a Utah ZIP centroid when it contains a known
 * Utah ZIP. Returns null for non-ZIP (or out-of-state ZIP) queries so callers
 * can fall back to text search.
 */
export function resolveZipQuery(query: string): ResolvedZip | null {
  const zip = extractZip(query);
  if (!zip) return null;
  const anchor = lookupZipCentroid(zip);
  return anchor ? { zip, anchor } : null;
}
