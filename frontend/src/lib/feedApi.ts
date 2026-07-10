import { getWorkerBaseUrl } from './env';

export type FeedEventType = 'opened' | 'reopened';

export type FeedItem = {
  id: string;
  event_type: FeedEventType;
  course_slug: string;
  course_name: string;
  play_date: string;
  starts_at_local: string;
  play_starts_at: string | null;
  holes: 9 | 18;
  price_cents: number | null;
  spots_open: number | null;
  detected_at: string;
  still_open: boolean;
};

export type FeedResponse = {
  ok: boolean;
  items: FeedItem[];
  meta: {
    hours: number;
    min_players: number;
    open_only: boolean;
    count: number;
    generated_at: string;
  };
};

export type FeedQuery = {
  hours?: number;
  min_players?: number;
  open_only?: boolean;
  limit?: number;
};

export async function fetchRecentOpenings(query: FeedQuery = {}): Promise<FeedResponse> {
  const url = new URL(`${getWorkerBaseUrl()}/v1/feed`);
  if (query.hours != null) url.searchParams.set('hours', String(query.hours));
  if (query.min_players != null) url.searchParams.set('min_players', String(query.min_players));
  if (query.open_only === false) url.searchParams.set('open_only', 'false');
  if (query.limit != null) url.searchParams.set('limit', String(query.limit));

  const res = await fetch(url.toString(), { method: 'GET' });
  if (!res.ok) {
    throw new Error(`feed HTTP ${res.status}`);
  }
  return (await res.json()) as FeedResponse;
}
