import type { FeedItem } from './feedApi';
import { formatDateShort, formatReopenedAgo, formatTime12h, minutesSince } from './time';

/** Finder teaser + nav poll window — short pulse, not 6h inventory. */
export const FINDER_PREVIEW_HOURS = 2;

/** Still-open slots detected within this window get “Live” treatment. */
export const FEED_HOT_MINUTES = 60;

/** “Just detected” section on full feed page. */
export const FEED_JUST_DETECTED_MINUTES = 60;

/** Recent-but-not-live tier (matches finder preview window). */
export const FEED_WARM_MINUTES = FINDER_PREVIEW_HOURS * 60;

export type FeedUrgency = 'hot' | 'warm' | 'cool';

export function feedMinutesSinceDetected(item: FeedItem): number {
  return minutesSince(new Date(item.detected_at).getTime()) ?? Number.POSITIVE_INFINITY;
}

export function feedUrgency(item: FeedItem): FeedUrgency {
  const mins = feedMinutesSinceDetected(item);
  if (item.still_open && mins <= FEED_HOT_MINUTES) return 'hot';
  if (mins <= FEED_WARM_MINUTES) return 'warm';
  return 'cool';
}

export function isFeedHotOpening(item: FeedItem): boolean {
  return feedUrgency(item) === 'hot';
}

export function isFeedWarmOpening(item: FeedItem): boolean {
  return feedUrgency(item) === 'warm';
}

export function countFeedHotOpenings(items: FeedItem[]): number {
  return items.filter(isFeedHotOpening).length;
}

/** Compact “Xm ago” for teaser chips — always shown. */
export function feedChipDetectedShort(item: FeedItem): string {
  const mins = feedMinutesSinceDetected(item);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

/** Short urgency label for Live badges. */
export function feedHotLabel(item: FeedItem): string | null {
  if (!isFeedHotOpening(item)) return null;
  return feedChipDetectedShort(item);
}

export function sortFeedItemsByUrgency(
  items: FeedItem[],
  distanceMiBySlug?: Map<string, number>,
): FeedItem[] {
  const rank: Record<FeedUrgency, number> = { hot: 0, warm: 1, cool: 2 };
  return [...items].sort((a, b) => {
    const byUrgency = rank[feedUrgency(a)] - rank[feedUrgency(b)];
    if (byUrgency !== 0) return byUrgency;
    const byDetected = new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime();
    if (byDetected !== 0) return byDetected;
    if (distanceMiBySlug) {
      const da = distanceMiBySlug.get(a.course_slug) ?? Number.POSITIVE_INFINITY;
      const db = distanceMiBySlug.get(b.course_slug) ?? Number.POSITIVE_INFINITY;
      return da - db;
    }
    return 0;
  });
}

export function feedTimeLabel(item: FeedItem): string {
  if (item.play_starts_at) return formatTime12h(item.play_starts_at);
  const m = item.starts_at_local.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return item.starts_at_local;
  const h = Number(m[1]);
  const mm = m[2];
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${mm} ${ampm}`;
}

export function feedDetectedLabel(item: FeedItem): string {
  const hot = feedHotLabel(item);
  if (hot) return hot;
  const base = formatReopenedAgo(item.detected_at);
  if (item.event_type === 'reopened' && base.startsWith('Opened')) {
    return base.replace(/^Opened/, 'Reopened');
  }
  if (item.event_type === 'reopened' && base === 'Just opened') return 'Just reopened';
  return base;
}

export function feedPlayWhenLabel(item: FeedItem): string {
  return `${formatDateShort(item.play_date)} · ${feedTimeLabel(item)}`;
}

export function feedSpotsLabel(spots: number | null): string | null {
  if (spots == null) return null;
  return `${spots} spot${spots !== 1 ? 's' : ''}`;
}

export function feedPlayWhenWithSpots(item: FeedItem): string {
  const base = feedPlayWhenLabel(item);
  const spots = feedSpotsLabel(item.spots_open);
  return spots ? `${base} · ${spots}` : base;
}

export function feedActivityBadgeLabel(item: FeedItem): string {
  if (isFeedHotOpening(item)) return 'Live';
  if (item.event_type === 'reopened') return 'Reopened';
  return 'New opening';
}

export function formatFeedPrice(cents: number | null): string | null {
  if (cents == null) return null;
  return `$${Math.round(cents / 100)}`;
}

export function feedChipTimeLabel(item: FeedItem): string {
  return feedTimeLabel(item).replace(/\s/g, '').toLowerCase();
}
