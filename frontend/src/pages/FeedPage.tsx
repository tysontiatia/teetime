import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { fetchRecentOpenings, type FeedItem } from '../lib/feedApi';
import { useCourseCatalog } from '../state/CourseCatalogContext';
import { useOpeningsPreview } from '../state/OpeningsPreviewContext';
import { FeedOpeningRow } from '../components/FeedOpeningRow';
import { buildFeedScope, feedScopeLabel, filterFeedItems } from '../lib/feedScope';
import { sortFeedItemsByUrgency } from '../lib/feedDisplay';
import { courseDistanceMap } from '../lib/feedDistanceMap';

type PlayersFilter = 1 | 2 | 3 | 4;

const FEED_HOURS = 6;

function clampPlayers(n: number): PlayersFilter {
  if (n <= 1) return 1;
  if (n === 2) return 2;
  if (n === 3) return 3;
  return 4;
}

export function FeedPage() {
  const { recordsBySlug, courses, userLocation, loading: catalogLoading } = useCourseCatalog();
  const { setMinPlayers: syncPreviewPlayers } = useOpeningsPreview();
  const [sp, setSp] = useSearchParams();
  const urlPlayers = clampPlayers(Number(sp.get('players') || 2));
  const fetchAllUtah = sp.get('scope') === 'all';
  const locationQuery = sp.get('q') || '';

  const [minPlayers, setMinPlayers] = useState<PlayersFilter>(urlPlayers);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const setFetchScope = useCallback(
    (scope: 'nearby' | 'all') => {
      const next = new URLSearchParams(sp);
      if (scope === 'all') next.set('scope', 'all');
      else next.delete('scope');
      setSp(next, { replace: true });
    },
    [sp, setSp],
  );

  const setParty = useCallback(
    (players: PlayersFilter) => {
      setMinPlayers(players);
      const next = new URLSearchParams(sp);
      next.set('players', String(players));
      setSp(next, { replace: true });
    },
    [sp, setSp],
  );

  useEffect(() => {
    setMinPlayers(urlPlayers);
  }, [urlPlayers]);

  useEffect(() => {
    syncPreviewPlayers(minPlayers);
  }, [minPlayers, syncPreviewPlayers]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const data = await fetchRecentOpenings({
        hours: FEED_HOURS,
        min_players: minPlayers,
        open_only: true,
        limit: 80,
      });
      setItems(data.items);
      setGeneratedAt(data.meta.generated_at);
    } catch {
      setErr('Could not load openings. Try again in a moment.');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [minPlayers]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(id);
  }, [load]);

  const feedScopeResult = useMemo(
    () =>
      buildFeedScope(courses, userLocation, {
        fetchAllUtah,
        locationQuery,
      }),
    [courses, userLocation, fetchAllUtah, locationQuery],
  );

  const scopeReady = feedScopeResult.scopeReady && !catalogLoading;

  const distanceMiBySlug = useMemo(() => courseDistanceMap(courses), [courses]);

  const filteredItems = useMemo(() => {
    if (feedScopeResult.isRegional && !scopeReady) return [];
    return filterFeedItems(items, feedScopeResult.slugAllowlist);
  }, [items, feedScopeResult.slugAllowlist, feedScopeResult.isRegional, scopeReady]);

  const scopedItems = useMemo(
    () => sortFeedItemsByUrgency(filteredItems, distanceMiBySlug),
    [filteredItems, distanceMiBySlug],
  );

  const scopeLabel = useMemo(() => feedScopeLabel(feedScopeResult.scope), [feedScopeResult.scope]);
  const statewideHiddenCount =
    scopeReady && feedScopeResult.isRegional ? items.length - filteredItems.length : 0;

  const partyLabel = `${minPlayers} player${minPlayers !== 1 ? 's' : ''}`;

  return (
    <div className="container feed-page">
      <header className="feed-page-head">
        <h1 className="feed-page-title">Openings</h1>
        <p className="feed-page-lede">Cancellations and new releases · last {FEED_HOURS} hours</p>
      </header>

      <div className="feed-filters" role="group" aria-label="Feed filters">
        <div className="feed-filter-group">
          <span className="feed-filter-label">Area</span>
          <div className="seg feed-filter-seg">
            <button
              type="button"
              className={!fetchAllUtah ? 'on' : ''}
              onClick={() => setFetchScope('nearby')}
            >
              Nearby
            </button>
            <button
              type="button"
              className={fetchAllUtah ? 'on' : ''}
              onClick={() => setFetchScope('all')}
            >
              All Utah
            </button>
          </div>
        </div>
        <div className="feed-filter-group">
          <span className="feed-filter-label">Party</span>
          <div className="seg feed-filter-seg">
            {([1, 2, 3, 4] as PlayersFilter[]).map((p) => (
              <button
                key={p}
                type="button"
                className={minPlayers === p ? 'on' : ''}
                onClick={() => setParty(p)}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>

      {generatedAt ? (
        <p className="feed-meta mono">
          Updated {new Date(generatedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
          {loading ? ' · refreshing…' : null}
        </p>
      ) : null}

      {err ? <p className="feed-page-err">{err}</p> : null}

      {loading && scopedItems.length === 0 && !err ? (
        <p className="feed-page-status">Loading openings…</p>
      ) : !loading && scopedItems.length === 0 && !err ? (
        <div className="feed-page-status">
          <p>
            No openings {scopeLabel.toLowerCase()} in the last {FEED_HOURS} hours for {partyLabel}.
          </p>
          {!fetchAllUtah && statewideHiddenCount > 0 ? (
            <button type="button" className="btn btn-primary feed-scope-expand" onClick={() => setFetchScope('all')}>
              See {statewideHiddenCount} statewide →
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <ul className="feed-opening-list">
            {scopedItems.map((item) => (
              <li key={item.id}>
                <FeedOpeningRow
                  item={item}
                  record={recordsBySlug.get(item.course_slug)}
                  minPlayers={minPlayers}
                />
              </li>
            ))}
          </ul>
          {!fetchAllUtah && statewideHiddenCount > 0 ? (
            <p className="feed-scope-foot">
              <button type="button" className="feed-teaser-link feed-scope-more-btn" onClick={() => setFetchScope('all')}>
                +{statewideHiddenCount} more statewide →
              </button>
            </p>
          ) : null}
        </>
      )}

      <Link to="/" className="btn btn-ghost feed-page-back">
        Browse all courses →
      </Link>
    </div>
  );
}
