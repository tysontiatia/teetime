import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useCourseCatalog } from '../state/CourseCatalogContext';
import { useOpeningsPreview } from '../state/OpeningsPreviewContext';
import {
  buildFeedScope,
  feedScopeLabel,
  filterFeedItems,
  type FeedScopeInput,
} from '../lib/feedScope';
import { countFeedHotOpenings, sortFeedItemsByUrgency } from '../lib/feedDisplay';
import { courseDistanceMap } from '../lib/feedDistanceMap';

function scopeFromSearchParams(sp: URLSearchParams): FeedScopeInput {
  return {
    fetchAllUtah: sp.get('scope') === 'all',
    locationQuery: sp.get('q') || '',
  };
}

/**
 * Openings feed filtered to the same regional scope as finder search (local first).
 */
export function useScopedOpenings(override?: FeedScopeInput) {
  const preview = useOpeningsPreview();
  const { courses, userLocation, loading: catalogLoading } = useCourseCatalog();
  const [sp] = useSearchParams();
  const urlScope = scopeFromSearchParams(sp);
  const fetchAllUtah = override?.fetchAllUtah ?? urlScope.fetchAllUtah;
  const locationQuery = override?.locationQuery ?? urlScope.locationQuery ?? '';
  const radiusMi = override?.radiusMi ?? urlScope.radiusMi;

  const feedScopeResult = useMemo(
    () => buildFeedScope(courses, userLocation, { fetchAllUtah, locationQuery, radiusMi }),
    [courses, userLocation, fetchAllUtah, locationQuery, radiusMi],
  );

  const scopeReady = feedScopeResult.scopeReady && !catalogLoading;

  const distanceMiBySlug = useMemo(() => courseDistanceMap(courses), [courses]);

  const filteredItems = useMemo(() => {
    if (feedScopeResult.isRegional && !scopeReady) return [];
    return filterFeedItems(preview.items, feedScopeResult.slugAllowlist);
  }, [preview.items, feedScopeResult.slugAllowlist, feedScopeResult.isRegional, scopeReady]);

  const items = useMemo(
    () => sortFeedItemsByUrgency(filteredItems, distanceMiBySlug),
    [filteredItems, distanceMiBySlug],
  );

  const hotCount = useMemo(() => countFeedHotOpenings(items), [items]);

  const statewideHiddenCount = useMemo(() => {
    if (!scopeReady || !feedScopeResult.isRegional) return 0;
    return preview.items.length - filteredItems.length;
  }, [scopeReady, feedScopeResult.isRegional, preview.items.length, filteredItems.length]);

  const scopeLabel = useMemo(
    () => feedScopeLabel(feedScopeResult.scope),
    [feedScopeResult.scope],
  );

  return {
    ...preview,
    items,
    allItems: preview.items,
    openCount: items.length,
    hotCount,
    statewideCount: preview.items.length,
    statewideHiddenCount,
    feedScope: feedScopeResult.scope,
    isRegional: feedScopeResult.isRegional,
    scopeLabel,
    scopeReady,
    catalogLoading,
    fetchAllUtah: fetchAllUtah === true,
  };
}
