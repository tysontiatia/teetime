import type { FeedItem } from './feedApi';
import type { Course } from '../types';
import { filterWorkerCourses } from './platformRegistry';
import { buildTimesFetchScope, type TimesFetchScope } from './timesFetchScope';

export type FeedScopeInput = {
  fetchAllUtah?: boolean;
  locationQuery?: string;
  radiusMi?: number;
};

export type FeedScopeResult = {
  scope: TimesFetchScope;
  /** Null when showing statewide (no slug filter). */
  slugAllowlist: Set<string> | null;
  isRegional: boolean;
  /** False while course catalog is still loading — avoid filtering against an empty pool. */
  scopeReady: boolean;
};

export function buildFeedScope(
  courses: Course[],
  userLocation: { lat: number; lng: number } | null,
  input: FeedScopeInput = {},
): FeedScopeResult {
  const workerCourses = filterWorkerCourses(courses);
  const scope = buildTimesFetchScope(workerCourses, userLocation, {
    fetchAllUtah: input.fetchAllUtah === true,
    locationQuery: input.locationQuery?.trim() ?? '',
    radiusMi: input.radiusMi,
  });

  const scopeReady = workerCourses.length > 0;

  if (scope.mode === 'statewide') {
    return { scope, slugAllowlist: null, isRegional: false, scopeReady };
  }

  return {
    scope,
    slugAllowlist: new Set(scope.fetchPool.map((c) => c.id)),
    isRegional: true,
    scopeReady,
  };
}

export function filterFeedItems(items: FeedItem[], slugAllowlist: Set<string> | null): FeedItem[] {
  if (!slugAllowlist) return items;
  return items.filter((item) => slugAllowlist.has(item.course_slug));
}

export function feedScopeLabel(scope: TimesFetchScope): string {
  if (scope.mode === 'statewide') return 'All Utah';
  if (scope.mode === 'search' && scope.searchQuery) return `Near “${scope.searchQuery}”`;
  if (scope.anchor.source === 'gps') return 'Nearby';
  return 'Wasatch Front area';
}
