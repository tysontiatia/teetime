import { getWorkerBaseUrl } from './env';

export type PlaceReview = {
  author: string;
  authorUrl: string | null;
  profilePhotoUrl: string | null;
  rating: number | null;
  relativeTime: string | null;
  time: number | null;
  text: string;
  language: string | null;
};

export type PlaceReviewsResponse = {
  placeId: string;
  name: string | null;
  rating: number | null;
  reviewCount: number | null;
  mapsUrl: string | null;
  sort: 'newest';
  reviews: PlaceReview[];
};

type FetchArgs = {
  name: string;
  lat?: number;
  lng?: number;
  placeId?: string | null;
};

/** Newest Google reviews via worker Places Details proxy (max 5). */
export async function fetchPlaceReviews(args: FetchArgs): Promise<PlaceReviewsResponse | null> {
  const name = args.name?.trim();
  if (!name && !args.placeId) return null;

  const url = new URL(`${getWorkerBaseUrl()}/place-reviews`);
  if (name) url.searchParams.set('name', name);
  if (typeof args.lat === 'number' && Number.isFinite(args.lat)) {
    url.searchParams.set('lat', String(args.lat));
  }
  if (typeof args.lng === 'number' && Number.isFinite(args.lng)) {
    url.searchParams.set('lng', String(args.lng));
  }
  if (args.placeId) url.searchParams.set('place_id', args.placeId);

  try {
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const data = (await res.json()) as PlaceReviewsResponse;
    if (!data || !Array.isArray(data.reviews)) return null;
    return data;
  } catch {
    return null;
  }
}
